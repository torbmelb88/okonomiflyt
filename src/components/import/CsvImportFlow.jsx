import Papa from 'papaparse';
import { useBudget } from '../../contexts/BudgetContext';
import { api } from '../../services/firebase';
import ImportCSVModal from '../accounts/ImportCSVModal';
import { matchRowsAgainstExisting } from './importPipeline';
import { useImportReview } from './useImportReview';

/**
 * The manual CSV import flow: file/account picker and CSV parsing. The
 * parsing quirks (Norwegian dates, Beløp inn/ut columns, encoding) live
 * here; duplicate matching and the review/reconcile tail are shared with the
 * other manual imports (importPipeline.js + useImportReview).
 *
 * Only rows inside `selectedMonth` are imported; the parent owns that choice.
 */
export default function CsvImportFlow({ isOpen, onClose, accounts, selectedMonth }) {
    const { transactions, updateTransaction } = useBudget();
    const { review, modals } = useImportReview();

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
                    const rows = [];
                    const skippedReport = [];
                    let skippedCount = 0;

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

                            rows.push({
                                date,
                                month,
                                name,
                                comment,
                                amount: Math.abs(amount),
                                type,
                                category,
                                accountId,
                            });
                        } catch (err) {
                            console.error('Error processing row:', row, err);
                            skippedReport.push(`Feil på rad: ${err.message}`);
                            skippedCount++;
                        }
                    }

                    const matchResult = await matchRowsAgainstExisting({
                        rows,
                        existing: existingAccountTransactions,
                        updateTransaction,
                    });
                    await review(matchResult, { skipped: skippedCount, skippedReport });
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
            {modals}
        </>
    );
}
