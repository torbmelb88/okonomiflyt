import { useState } from 'react';
import Papa from 'papaparse';
import { useBudget } from '../../contexts/BudgetContext';
import { api } from '../../services/firebase';
import { stringsAreSimilar } from '../../utils/textMatch';
import { fxPlausible } from '../../utils/currency';
import ImportCSVModal from '../accounts/ImportCSVModal';
import ReconcileTransactionsModal from '../accounts/ReconcileTransactionsModal';
import DuplicateReviewModal from '../accounts/DuplicateReviewModal';

/**
 * The manual CSV import flow: file/account picker, duplicate review against
 * everything already in Firestore, and reconciliation of the fresh rows.
 * Extracted from TransactionsPanel when import moved to its own page — the
 * parsing quirks (Norwegian dates, Beløp inn/ut columns, encoding) live here.
 *
 * Only rows inside `selectedMonth` are imported; the parent owns that choice.
 */
export default function CsvImportFlow({ isOpen, onClose, accounts, selectedMonth }) {
    const { transactions, addTransaction, updateTransaction } = useBudget();

    // Reconciliation of freshly imported rows
    const [isReconcileModalOpen, setIsReconcileModalOpen] = useState(false);
    const [transactionsToReconcile, setTransactionsToReconcile] = useState([]);

    // Duplicate review
    const [isDuplicateReviewOpen, setIsDuplicateReviewOpen] = useState(false);
    const [potentialDuplicates, setPotentialDuplicates] = useState([]);
    const [pendingImportTransactions, setPendingImportTransactions] = useState([]);
    const [importStats, setImportStats] = useState({ success: 0, merged: 0, skipped: 0, duplicate: 0 });

    const finalizeImport = async (transactionsToSave, stats) => {
        let successCount = 0;
        let failureReasons = [];
        let finalNewTransactions = [];

        for (const t of transactionsToSave) {
            try {
                const transactionId = await addTransaction(t);
                finalNewTransactions.push({ ...t, id: transactionId });
                successCount++;
            } catch (err) {
                console.error('Error saving transaction:', t, err);
                failureReasons.push(`Feil ved lagring av ${t.name}: ${err.message}`);
            }
        }

        let msg = '';
        if (successCount > 0) msg += `Importerte ${successCount} nye transaksjoner. `;
        if (stats.merged > 0) msg += `Oppdaterte ${stats.merged} eksisterende med kommentarer. `;

        let skippedMsg = '';
        if (stats.skippedReport && stats.skippedReport.length > 0) {
            skippedMsg = '\n\nÅrsaker til at rader ble hoppet over:\n' +
                stats.skippedReport.slice(0, 5).join('\n') +
                (stats.skippedReport.length > 5 ? `\n...og ${stats.skippedReport.length - 5} til.` : '');
        }

        if (msg) {
            alert(msg + skippedMsg);
        } else if (failureReasons.length > 0) {
            alert('Noe gikk galt:\n' + failureReasons.join('\n'));
        } else {
            alert(`Ingen nye transaksjoner importert.${skippedMsg}`);
        }

        if (finalNewTransactions.length > 0) {
            setTransactionsToReconcile(finalNewTransactions);
            setIsReconcileModalOpen(true);
        }
    };

    const handleDuplicateReviewComplete = async (approvedActions) => {
        setIsDuplicateReviewOpen(false);
        setPotentialDuplicates([]);

        const imports = approvedActions.filter(a => a.action === 'import').map(a => a.new);
        const merges = approvedActions.filter(a => a.action === 'merge');

        const allTransactionsToImport = [...pendingImportTransactions, ...imports];

        let mergedCount = 0;
        for (const merge of merges) {
            try {
                // Merging onto a foreign-currency copy (companion app abroad):
                // the bank's NOK amount takes over, the foreign amount is kept
                // as originalAmount/-Currency and the currency flag cleared.
                const wasForeign = merge.existing.currency && merge.existing.currency !== 'NOK';
                await updateTransaction(merge.existing.id, {
                    date: merge.new.date,
                    amount: merge.new.amount,
                    name: merge.new.name,
                    // Bank match confirmed — avstemt if the row is also
                    // categorized; otherwise it still needs a budget item.
                    // The survivor takes over the bank row's identity, so it
                    // no longer counts as self-reported (companion app).
                    reconciled: !!(merge.existing.reconciled || merge.existing.budgetItemId),
                    source: null,
                    ...(wasForeign ? {
                        currency: null,
                        originalAmount: merge.existing.amount,
                        originalCurrency: merge.existing.currency,
                    } : {}),
                });
                mergedCount++;
            } catch (err) {
                console.error('Failed to merge transaction', err);
            }
        }

        const stats = {
            ...importStats,
            safeNewCount: pendingImportTransactions.length,
            merged: importStats.merged + mergedCount,
        };

        await finalizeImport(allTransactionsToImport, stats);
        setPendingImportTransactions([]);
    };

    const handleImport = async (csvText, accountId) => {
        try {
            const delimiter = csvText.includes(';') ? ';' : ',';

            // Fetch ALL transactions for this account from Firestore (across budgets)
            // for a complete duplicate check
            let existingAccountTransactions = [];
            try {
                existingAccountTransactions = await api.queryCollection('transactions', 'accountId', accountId);
            } catch (fetchErr) {
                console.error('Error fetching existing transactions for duplicate check:', fetchErr);
                alert('Advarsel: Kunne ikke hente alle eksisterende transaksjoner. Duplikatsjekk kan være ufullstendig.');
                existingAccountTransactions = transactions.filter(t => t.accountId === accountId);
            }

            Papa.parse(csvText, {
                header: true,
                delimiter,
                skipEmptyLines: true,
                complete: async (results) => {
                    let newTransactions = [];
                    let potentialDuplicatesList = [];
                    let fxClaimedIds = new Set();
                    let skippedReport = [];
                    let mergedCount = 0;
                    let skippedCount = 0;
                    let failureReasons = [];

                    const targetAccount = accounts.find(a => a.id === accountId);
                    const requiredCardLastFour = targetAccount?.cardLastFour;

                    for (const row of results.data) {
                        try {
                            if (requiredCardLastFour) {
                                let cardVal = row.Card || row.Kort || row.Source || row.Account || '';
                                let cardLast4 = cardVal.toString().replace(/\D/g, '');
                                if (cardLast4.length >= 4) {
                                    cardLast4 = cardLast4.slice(-4);
                                    if (cardLast4 !== requiredCardLastFour) continue;
                                }
                            }

                            const parseAmount = (val) => {
                                if (!val) return 0;
                                if (typeof val === 'number') return val;
                                let str = val.toString().trim();
                                const hasNegativeSign =
                                    str.includes('-') || str.includes('−') || str.includes('–') ||
                                    str.includes('—') || str.endsWith('-') ||
                                    (str.startsWith('â') && str.length > 3);

                                let cleanStr = str;
                                if (cleanStr.includes(',')) {
                                    cleanStr = cleanStr.replace(/\./g, '').replace(/\s/g, '');
                                    cleanStr = cleanStr.replace(',', '.');
                                } else {
                                    cleanStr = cleanStr.replace(/\s/g, '');
                                }
                                cleanStr = cleanStr.replace(/[^0-9.]/g, '');
                                let num = parseFloat(cleanStr);
                                if (isNaN(num)) return 0;
                                if (hasNegativeSign) num = -Math.abs(num);
                                return num;
                            };

                            const keys = Object.keys(row);
                            const findKey = (obj, search) => Object.keys(obj).find(key => key.toLowerCase().includes(search.toLowerCase()));
                            let dateStr = row['Bokført dato'] || row['Utført dato'] || row.Dato || row.Date || row.dato || row.date;
                            if (!dateStr) {
                                const dateKey = findKey(row, 'dato') || findKey(row, 'date');
                                if (dateKey) dateStr = row[dateKey];
                            }

                            if (!dateStr || dateStr.trim() === '' || !/^\d/.test(dateStr.trim())) continue;

                            let date;
                            const norwegianDateMatch = dateStr.match(/^(\d{2})\.(\d{2})\.(\d{4})/);
                            if (norwegianDateMatch) {
                                const [, day, month, year] = norwegianDateMatch;
                                date = `${year}-${month}-${day}`;
                            } else {
                                date = dateStr.split(' ')[0];
                            }

                            const month = date.substring(0, 7);

                            if (month !== selectedMonth) {
                                skippedCount++;
                                continue;
                            }

                            let name = row.Beskrivelse || row.Description || row.Navn || row.Name || row.Merchant || row.beskrivelse || row.description || 'Ukjent transaksjon';
                            const comment = row.Comment || row.Kommentar || row.comment || '';

                            let amount = 0;
                            let type = 'expense';

                            const findAmountKey = () => {
                                const belopRegex = /^bel.{1,2}p/i;
                                for (const key of keys) {
                                    if (key.match(belopRegex) && !key.toLowerCase().includes('valuta') && !key.toLowerCase().includes('curr')) {
                                        return key;
                                    }
                                }
                                const priorityMoves = ['amount', 'beløp (nok)', 'amount (nok)', 'transaksjonsbeløp', 'transaction amount'];
                                for (const p of priorityMoves) {
                                    const exactMatch = keys.find(k => k.toLowerCase() === p);
                                    if (exactMatch) return exactMatch;
                                }
                                const amountKeywords = ['beløp', 'amount'];
                                const excludeKeywords = ['valuta', 'currency', 'cur', 'utenlandsk'];
                                const validKeys = keys.filter(key => {
                                    const k = key.toLowerCase();
                                    const hasAmount = amountKeywords.some(ak => k.includes(ak));
                                    const hasExclude = excludeKeywords.some(ek => k.includes(ek));
                                    const isInOut = k.includes('inn') || k.includes('ut');
                                    return hasAmount && !hasExclude && !isInOut;
                                });
                                if (validKeys.length > 0) return validKeys.sort((a, b) => a.length - b.length)[0];
                                return keys.find(k => {
                                    const lower = k.toLowerCase();
                                    return (lower.includes('beløp') || lower.includes('amount')) && !lower.includes('valuta');
                                });
                            };

                            const keyIn = keys.find(k => ['beløp inn', 'inn', 'credit', 'innskudd'].includes(k.toLowerCase())) ||
                                keys.find(k => k.toLowerCase().includes('inn') && k.toLowerCase().includes('beløp') && !k.toLowerCase().includes('valuta'));
                            const keyOut = keys.find(k => ['beløp ut', 'ut', 'debit', 'uttak'].includes(k.toLowerCase())) ||
                                keys.find(k => k.toLowerCase().includes('ut') && k.toLowerCase().includes('beløp') && !k.toLowerCase().includes('valuta'));

                            if (keyIn && row[keyIn]) {
                                const val = parseAmount(row[keyIn]);
                                if (val > 0) { amount = val; type = 'income'; }
                            }
                            if (amount === 0 && keyOut && row[keyOut]) {
                                const val = parseAmount(row[keyOut]);
                                if (val !== 0) { amount = Math.abs(val); type = 'expense'; }
                            }
                            if (amount === 0) {
                                const amountKey = findAmountKey();
                                if (amountKey) {
                                    const rawAmount = parseAmount(row[amountKey]);
                                    amount = Math.abs(rawAmount);
                                    type = rawAmount < 0 ? 'expense' : 'income';
                                }
                            }

                            if (isNaN(amount) || amount === 0) {
                                const descSafe = (row.Beskrivelse || row.Description || 'Ukjent').substring(0, 20);
                                skippedReport.push(`Rad med dato ${dateStr}: Ugyldig beløp (0 eller NaN). Fant: ${name} (${descSafe})`);
                                skippedCount++;
                                continue;
                            }

                            const category = row.Kategori || row.Category || row.kategori || row.category || '';

                            const datesAreClose = (d1, d2, daysTolerance = 4) => {
                                const diffTime = Math.abs(new Date(d2) - new Date(d1));
                                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                                return diffDays <= daysTolerance;
                            };

                            // Foreign-currency copies are excluded: their amount is in
                            // SEK/EUR/…, so an equal number is coincidence — link manually
                            // via merge instead of dropping the bank row here.
                            const duplicate = existingAccountTransactions.find(t =>
                                (!t.currency || t.currency === 'NOK') &&
                                datesAreClose(t.date, date) &&
                                Math.abs(Math.abs(t.amount) - Math.abs(amount)) < 0.01 &&
                                stringsAreSimilar(t.name, name)
                            );

                            const newTransactionObj = {
                                date,
                                month,
                                name: comment ? `${name} (${comment})` : name,
                                amount: Math.abs(amount),
                                type,
                                category,
                                accountId,
                            };

                            // Foreign purchase logged by the companion app (amount in
                            // SEK/EUR/…): close date and a NOK/foreign ratio inside a
                            // plausible exchange-rate band. Goes through the same review
                            // as duplicates — "Knytt sammen" replaces the foreign amount
                            // with the bank's NOK amount.
                            const fxCandidate = !duplicate && existingAccountTransactions.find(t =>
                                t.currency && t.currency !== 'NOK' &&
                                !fxClaimedIds.has(t.id) &&
                                t.type === type &&
                                datesAreClose(t.date, date, 5) &&
                                fxPlausible(t.currency, t.amount, Math.abs(amount))
                            );

                            if (duplicate) {
                                if (comment && !duplicate.name.includes(comment)) {
                                    const newName = `${duplicate.name} (${comment})`;
                                    // Auto-merge with the bank row = bank match:
                                    // avstemt if the row is also categorized
                                    await updateTransaction(duplicate.id, {
                                        name: newName,
                                        reconciled: !!(duplicate.reconciled || duplicate.budgetItemId),
                                        source: null,
                                    });
                                    mergedCount++;
                                } else {
                                    potentialDuplicatesList.push({ new: newTransactionObj, existing: duplicate });
                                }
                            } else if (fxCandidate) {
                                fxClaimedIds.add(fxCandidate.id);
                                potentialDuplicatesList.push({ new: newTransactionObj, existing: fxCandidate });
                            } else {
                                newTransactions.push(newTransactionObj);
                            }
                        } catch (err) {
                            console.error('Error processing row:', row, err);
                            failureReasons.push(`Feil på rad: ${err.message}`);
                        }
                    }

                    setImportStats({
                        merged: mergedCount,
                        skipped: skippedCount,
                        skippedReport,
                        duplicate: potentialDuplicatesList.length,
                    });

                    if (potentialDuplicatesList.length > 0) {
                        setPendingImportTransactions(newTransactions);
                        setPotentialDuplicates(potentialDuplicatesList);
                        setIsDuplicateReviewOpen(true);
                    } else {
                        await finalizeImport(newTransactions, {
                            merged: mergedCount,
                            skipped: skippedCount,
                            duplicate: 0,
                            skippedReport,
                            safeNewCount: newTransactions.length,
                        });
                    }
                },
                error: (error) => {
                    console.error('CSV Parse Error:', error);
                    alert('Kunne ikke lese CSV-filen.');
                },
            });
        } catch (error) {
            console.error('CSV Import Error:', error);
            throw error;
        }
    };

    return (
        <>
            <ImportCSVModal
                isOpen={isOpen}
                onClose={onClose}
                onImport={handleImport}
                accounts={accounts}
            />
            <DuplicateReviewModal
                isOpen={isDuplicateReviewOpen}
                onClose={() => setIsDuplicateReviewOpen(false)}
                duplicates={potentialDuplicates}
                onComplete={handleDuplicateReviewComplete}
            />
            <ReconcileTransactionsModal
                isOpen={isReconcileModalOpen}
                onClose={() => setIsReconcileModalOpen(false)}
                transactions={transactionsToReconcile}
                onComplete={() => { setIsReconcileModalOpen(false); setTransactionsToReconcile([]); }}
            />
        </>
    );
}
