import { stringsAreSimilar } from '../../utils/textMatch';
import { fxPlausible } from '../../utils/currency';
import { isSelfReported } from '../../utils/reconciliation';

/**
 * Source-agnostic half of manual imports (CSV, credit-card invoice PDF, …):
 * given already-parsed rows, decide per row whether it is brand new, already
 * imported, a likely duplicate of something in Firestore, or the bank/NOK
 * copy of a foreign-currency purchase logged by the companion app.
 *
 * Rows: { date, month, name, amount (positive), type, category, accountId,
 *         comment?, ...extra fields kept on the transaction }
 *
 * Returns { newTransactions, potentialDuplicates, mergedCount,
 *           alreadyImportedCount, failureReasons }
 * — the caller hands potentialDuplicates to DuplicateReviewModal.
 *
 * Every existing row can be the match of ONE imported row only. Without
 * that, two purchases of the same amount at the same merchant a couple of
 * days apart (EasyPark 14,90 on the 1st and the 3rd, seen 2026-09-30) both
 * matched the same existing row: the second merge overwrote the first, and
 * the other companion row never got its bank copy. Exact-date matches are
 * assigned first, then the nearest date, so each purchase finds its own.
 */

export const datesAreClose = (d1, d2, daysTolerance = 4) => {
    const diffTime = Math.abs(new Date(d2) - new Date(d1));
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays <= daysTolerance;
};

const dayDistance = (d1, d2) => Math.abs(new Date(d2) - new Date(d1)) / 86400000;

export const matchRowsAgainstExisting = async ({ rows, existing, updateTransaction }) => {
    const newTransactions = [];
    const potentialDuplicates = [];
    const fxClaimedIds = new Set();
    const claimedIds = new Set();
    const failureReasons = [];
    let mergedCount = 0;
    let alreadyImportedCount = 0;

    // Foreign-currency copies are excluded: their amount is in SEK/EUR/…, so
    // an equal number is coincidence — they go through the fx check below.
    const isCandidate = (t, row) =>
        !t.refundParentId && // split-refund children mirror a bank row, they are not one
        (!t.currency || t.currency === 'NOK') &&
        (!t.type || !row.type || t.type === row.type) &&
        datesAreClose(t.date, row.date) &&
        Math.abs(Math.abs(t.amount) - Math.abs(row.amount)) < 0.01 &&
        stringsAreSimilar(t.name, row.name);

    // Pass 1: same date. Pass 2: nearest date among what is left; a row still
    // waiting for its bank copy (companion app/MCP) wins a tie.
    const matchOf = new Array(rows.length).fill(null);
    rows.forEach((row, i) => {
        const hit = existing.find(t => !claimedIds.has(t.id) && t.date === row.date && isCandidate(t, row));
        if (hit) { matchOf[i] = hit; claimedIds.add(hit.id); }
    });
    rows.forEach((row, i) => {
        if (matchOf[i]) return;
        const hit = existing
            .filter(t => !claimedIds.has(t.id) && isCandidate(t, row))
            .sort((a, b) =>
                dayDistance(a.date, row.date) - dayDistance(b.date, row.date) ||
                (isSelfReported(a) ? 0 : 1) - (isSelfReported(b) ? 0 : 1))[0];
        if (hit) { matchOf[i] = hit; claimedIds.add(hit.id); }
    });

    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        try {
            const { comment, ...fields } = row;
            const { name, amount, type, date } = fields;
            const duplicate = matchOf[i];

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
                } else if (!isSelfReported(duplicate) && duplicate.date === date) {
                    // Same date, amount and name, and the existing row is
                    // already the bank's: this row was imported before.
                    alreadyImportedCount++;
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

    return { newTransactions, potentialDuplicates, mergedCount, alreadyImportedCount, failureReasons };
};
