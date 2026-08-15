import { stringsAreSimilar } from '../../utils/textMatch';
import { fxPlausible } from '../../utils/currency';

/**
 * Source-agnostic half of manual imports (CSV, credit-card invoice PDF, …):
 * given already-parsed rows, decide per row whether it is brand new, a
 * likely duplicate of something in Firestore, or the bank/NOK copy of a
 * foreign-currency purchase logged by the companion app.
 *
 * Rows: { date, month, name, amount (positive), type, category, accountId,
 *         comment?, ...extra fields kept on the transaction }
 *
 * Returns { newTransactions, potentialDuplicates, mergedCount, failureReasons }
 * — the caller hands potentialDuplicates to DuplicateReviewModal.
 */

export const datesAreClose = (d1, d2, daysTolerance = 4) => {
    const diffTime = Math.abs(new Date(d2) - new Date(d1));
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays <= daysTolerance;
};

export const matchRowsAgainstExisting = async ({ rows, existing, updateTransaction }) => {
    const newTransactions = [];
    const potentialDuplicates = [];
    const fxClaimedIds = new Set();
    const failureReasons = [];
    let mergedCount = 0;

    for (const row of rows) {
        try {
            const { comment, ...fields } = row;
            const { name, amount, type, date } = fields;

            // Foreign-currency copies are excluded: their amount is in
            // SEK/EUR/…, so an equal number is coincidence — link manually
            // via merge instead of dropping the bank row here.
            const duplicate = existing.find(t =>
                (!t.currency || t.currency === 'NOK') &&
                datesAreClose(t.date, date) &&
                Math.abs(Math.abs(t.amount) - Math.abs(amount)) < 0.01 &&
                stringsAreSimilar(t.name, name)
            );

            const newTransactionObj = {
                ...fields,
                name: comment ? `${name} (${comment})` : name,
                amount: Math.abs(amount),
            };

            // Foreign purchase logged by the companion app (amount in
            // SEK/EUR/…): close date and a NOK/foreign ratio inside a
            // plausible exchange-rate band. Goes through the same review
            // as duplicates — "Knytt sammen" replaces the foreign amount
            // with the bank's NOK amount.
            const fxCandidate = !duplicate && existing.find(t =>
                t.currency && t.currency !== 'NOK' &&
                !fxClaimedIds.has(t.id) &&
                t.type === type &&
                datesAreClose(t.date, date, 5) &&
                fxPlausible(t.currency, t.amount, Math.abs(amount))
            );

            if (duplicate) {
                if (comment && !duplicate.name.includes(comment)) {
                    // Auto-merge with the bank row = bank match:
                    // avstemt if the row is also categorized
                    await updateTransaction(duplicate.id, {
                        name: `${duplicate.name} (${comment})`,
                        reconciled: !!(duplicate.reconciled || duplicate.budgetItemId),
                        source: null,
                    });
                    mergedCount++;
                } else {
                    potentialDuplicates.push({ new: newTransactionObj, existing: duplicate });
                }
            } else if (fxCandidate) {
                fxClaimedIds.add(fxCandidate.id);
                potentialDuplicates.push({ new: newTransactionObj, existing: fxCandidate });
            } else {
                newTransactions.push(newTransactionObj);
            }
        } catch (err) {
            console.error('Error processing row:', row, err);
            failureReasons.push(`Feil på rad: ${err.message}`);
        }
    }

    return { newTransactions, potentialDuplicates, mergedCount, failureReasons };
};
