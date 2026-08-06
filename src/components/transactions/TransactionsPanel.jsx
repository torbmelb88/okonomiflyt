import { useState, useEffect } from 'react';
import {
    Upload, ArrowDownLeft, ArrowUpRight, Edit2, Trash2, CheckCircle,
    Link2, FolderKanban, ReceiptText, ArrowRight,
    MessageSquare, Smartphone, Landmark, ArrowUpDown, X, Undo2, Merge,
} from 'lucide-react';
import clsx from 'clsx';
import Papa from 'papaparse';
import { useBudget } from '../../contexts/BudgetContext';
import { api } from '../../services/firebase';
import { stringsAreSimilar } from '../../utils/textMatch';
import ImportCSVModal from '../accounts/ImportCSVModal';
import ReconcileTransactionsModal from '../accounts/ReconcileTransactionsModal';
import DuplicateReviewModal from '../accounts/DuplicateReviewModal';
import MergeTransactionsModal from './MergeTransactionsModal';
import ConfirmationModal from '../common/ConfirmationModal';

/**
 * Reusable transaction engine: month navigation, summary, account filter,
 * the transaction list, CSV import (with duplicate review) and reconciliation.
 *
 * Shared by the Forbruk (bank) and Kredittkort (manual) pages — each passes the
 * subset of accounts it owns plus a transactionFilter that decides which
 * transactions belong to that page. The only money logic that differs is the
 * month summary (summaryMode): bank shows Inn/Ut/Netto, credit cards show
 * Kjøp/Returer/Forbruk since bill payments are money movement, not consumption.
 */
export default function TransactionsPanel({
    accounts,
    selectedMonth,
    setSelectedMonth,
    transactionFilter,
    reconcileNonce,
    summaryMode = 'bank',
}) {
    const {
        expenses, transactions, projects, receipts,
        addTransaction, updateTransaction, deleteTransaction, deleteTransactions,
    } = useBudget();

    const [selectedAccount, setSelectedAccount] = useState(null);
    const [isImportModalOpen, setIsImportModalOpen] = useState(false);
    const [deleteConfirmation, setDeleteConfirmation] = useState({ isOpen: false, id: null, type: null, count: 0 });
    const [sortBy, setSortBy] = useState('date-desc');
    const [activeFilters, setActiveFilters] = useState([]);

    // Reconciliation
    const [isReconcileModalOpen, setIsReconcileModalOpen] = useState(false);
    const [transactionsToReconcile, setTransactionsToReconcile] = useState([]);

    // Manual duplicate merge
    const [mergeTarget, setMergeTarget] = useState(null);

    // Duplicate review
    const [isDuplicateReviewOpen, setIsDuplicateReviewOpen] = useState(false);
    const [potentialDuplicates, setPotentialDuplicates] = useState([]);
    const [pendingImportTransactions, setPendingImportTransactions] = useState([]);
    const [importStats, setImportStats] = useState({ success: 0, merged: 0, skipped: 0, duplicate: 0 });

    const formatMonth = (monthStr) => {
        const [year, month] = monthStr.split('-');
        const date = new Date(year, parseInt(month) - 1);
        return date.toLocaleDateString('no-NO', { month: 'long', year: 'numeric' });
    };

    const changeMonth = (delta) => {
        const [year, month] = selectedMonth.split('-').map(Number);
        const newDate = new Date(year, month - 1 + delta);
        setSelectedMonth(`${newDate.getFullYear()}-${String(newDate.getMonth() + 1).padStart(2, '0')}`);
    };

    // A transaction is "handled" if the user reconciled it OR it is already
    // linked to a budget item. The companion app writes transactions with a
    // budgetItemId but reconciled:false — those are categorized continuously
    // and should not be flagged as needing follow-up.
    const isHandled = (t) => t.reconciled || !!t.budgetItemId;

    // Transactions that belong to this panel (bank vs credit card)
    const panelTransactions = transactions.filter(transactionFilter);

    // Extra filters (AND-combined chips). "Manuell/CSV" = no source field:
    // the companion app stamps source:'companion_app' and the SB1 import
    // stamps source:'sb1'; everything else was entered by hand or CSV.
    const extraFilters = [
        { key: 'comment', label: 'Kommentar', Icon: MessageSquare, test: (t) => !!t.comment },
        { key: 'companion', label: 'Companion-app', Icon: Smartphone, test: (t) => t.source === 'companion_app' },
        { key: 'sb1', label: 'Bank (SB1)', Icon: Landmark, test: (t) => t.source === 'sb1' },
        { key: 'manual', label: 'Manuell/CSV', Icon: Upload, test: (t) => !t.source },
        { key: 'unreconciled', label: 'Uavstemt', Icon: null, test: (t) => !isHandled(t) },
        { key: 'utlegg', label: 'Utlegg', Icon: null, test: (t) => !!t.paidPrivatelyBy },
        { key: 'receipt', label: 'Kvittering', Icon: ReceiptText, test: (t) => !!t.receiptId || receipts.some(r => r.transactionId === t.id) },
    ];
    const toggleFilter = (key) => setActiveFilters(prev =>
        prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
    );

    const sortComparators = {
        'date-desc': (a, b) => (b.date || '').localeCompare(a.date || ''),
        'date-asc': (a, b) => (a.date || '').localeCompare(b.date || ''),
        'amount-desc': (a, b) => b.amount - a.amount,
        'amount-asc': (a, b) => a.amount - b.amount,
        'name-asc': (a, b) => (a.name || '').localeCompare(b.name || '', 'no-NO'),
    };

    const displayedTransactions = (selectedAccount
        ? panelTransactions.filter(t => t.accountId === selectedAccount.id)
        : panelTransactions
    )
        .filter(t => t.month === selectedMonth)
        .filter(t => extraFilters.every(f => !activeFilters.includes(f.key) || f.test(t)))
        .sort(sortComparators[sortBy] || sortComparators['date-desc']);

    // Accounts are global; only offer filter buttons for accounts that actually
    // have transactions in this view (plus the currently selected one).
    const accountsWithTx = accounts.filter(a =>
        (selectedAccount && a.id === selectedAccount.id) ||
        panelTransactions.some(t => t.accountId === a.id && t.month === selectedMonth)
    );

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
                await updateTransaction(merge.existing.id, {
                    date: merge.new.date,
                    amount: merge.new.amount,
                    name: merge.new.name,
                    reconciled: true,
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

                            const duplicate = existingAccountTransactions.find(t =>
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

                            if (duplicate) {
                                if (comment && !duplicate.name.includes(comment)) {
                                    const newName = `${duplicate.name} (${comment})`;
                                    await updateTransaction(duplicate.id, { name: newName });
                                    mergedCount++;
                                } else {
                                    potentialDuplicatesList.push({ new: newTransactionObj, existing: duplicate });
                                }
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

    const isExcludedFromSummary = (t) => {
        const normalize = (str) => (str ? str.trim().toLowerCase() : '');
        const category = normalize(t.category);
        if (['kredittkortregning', 'sparing', 'overføring', 'intern overføring'].includes(category)) return true;
        if (t.budgetItemId) {
            const linkedExpense = expenses.find(e => e.id === t.budgetItemId);
            if (linkedExpense && normalize(linkedExpense.category) === 'sparing') return true;
        }
        return false;
    };

    // Credit notes reduce spending rather than count as income
    const refundTotal = displayedTransactions
        .filter(t => t.type === 'income' && t.isRefund && !isExcludedFromSummary(t))
        .reduce((acc, t) => acc + t.amount, 0);
    const incomeTotal = displayedTransactions
        .filter(t => t.type === 'income' && !t.isRefund && !isExcludedFromSummary(t))
        .reduce((acc, t) => acc + t.amount, 0);
    const expenseTotal = displayedTransactions
        .filter(t => t.type === 'expense' && !isExcludedFromSummary(t))
        .reduce((acc, t) => acc + t.amount, 0) - refundTotal;
    const netTotal = incomeTotal - expenseTotal;

    const fmtKr = (n) => `${Math.round(n).toLocaleString('no-NO')} kr`;
    const green = 'text-green-600 dark:text-green-400';
    const red = 'text-red-600 dark:text-red-400';
    // Credit-card summary counts every purchase and every credit note, with no
    // category exclusions: bill payments (and other non-refund income) are the
    // only rows left out. Forbruk is the number Min Oversikt bills next month.
    const summaryItems = summaryMode === 'creditCard'
        ? (() => {
            const purchases = displayedTransactions
                .filter(t => t.type === 'expense')
                .reduce((acc, t) => acc + t.amount, 0);
            const refunds = displayedTransactions
                .filter(t => t.type === 'income' && t.isRefund)
                .reduce((acc, t) => acc + t.amount, 0);
            return [
                { label: 'Kjøp', text: `-${fmtKr(purchases)}`, cls: red },
                { label: 'Returer', text: `+${fmtKr(refunds)}`, cls: 'text-teal-600 dark:text-teal-400' },
                { label: 'Forbruk', text: fmtKr(purchases - refunds), cls: 'text-gray-900 dark:text-white' },
            ];
        })()
        : [
            { label: 'Inn', text: `+${fmtKr(incomeTotal)}`, cls: green },
            { label: 'Ut', text: `-${fmtKr(expenseTotal)}`, cls: red },
            { label: 'Netto', text: fmtKr(netTotal), cls: netTotal >= 0 ? green : red },
        ];

    // Refunded amount per original transaction, for the "returnert" badge
    const refundedByOriginal = new Map();
    for (const t of transactions) {
        if (t.isRefund && t.refundOfTransactionId) {
            refundedByOriginal.set(t.refundOfTransactionId, (refundedByOriginal.get(t.refundOfTransactionId) || 0) + t.amount);
        }
    }

    const handleDeleteAllTransactions = () => {
        if (displayedTransactions.length === 0) {
            alert('Ingen transaksjoner å slette.');
            return;
        }
        setDeleteConfirmation({ isOpen: true, id: null, type: 'all_transactions', count: displayedTransactions.length });
    };

    const confirmDelete = async () => {
        const { id, type } = deleteConfirmation;
        try {
            if (type === 'transaction') {
                await deleteTransaction(id);
            } else if (type === 'all_transactions') {
                await deleteTransactions(displayedTransactions.map(t => t.id));
            }
        } catch (err) {
            console.error('Delete failed:', err);
            alert('Kunne ikke slette: ' + err.message);
        }
    };

    const handleManualReconcile = () => {
        const unreconciled = displayedTransactions.filter(t => !isHandled(t));
        if (unreconciled.length > 0) {
            setTransactionsToReconcile(unreconciled);
            setIsReconcileModalOpen(true);
        } else {
            alert('Ingen uavstemte transaksjoner funnet.');
        }
    };

    // Lets a parent (e.g. the Forbruk "needs follow-up" banner) open the
    // reconcile flow by bumping a nonce.
    useEffect(() => {
        if (reconcileNonce) handleManualReconcile();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [reconcileNonce]);

    const handleEditTransaction = (e, transaction) => {
        e.stopPropagation();
        setTransactionsToReconcile([transaction]);
        setIsReconcileModalOpen(true);
    };

    return (
        <div className="space-y-6">
            {/* Month Navigation & Summary */}
            <div className="bg-white dark:bg-gray-800 p-4 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700">
                <div className="flex items-center justify-between">
                    <button onClick={() => changeMonth(-1)} className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full transition-colors">
                        <ArrowRight className="w-5 h-5 transform rotate-180 text-gray-600 dark:text-gray-400" />
                    </button>
                    <div className="text-center flex-1 mx-4">
                        <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 capitalize">{formatMonth(selectedMonth)}</h2>
                        <span className="text-sm text-gray-500 dark:text-gray-400">{displayedTransactions.length} transaksjoner</span>
                    </div>
                    <div className="hidden md:flex items-center space-x-6">
                        {summaryItems.map((item, i) => (
                            <div key={item.label} className={clsx('text-right', i > 0 && 'pl-6 border-l border-gray-200 dark:border-gray-700')}>
                                <div className="text-xs text-gray-400 uppercase tracking-wider mb-0.5">{item.label}</div>
                                <div className={clsx('font-bold text-lg', item.cls)}>{item.text}</div>
                            </div>
                        ))}
                    </div>
                    <button onClick={() => changeMonth(1)} className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full transition-colors ml-2">
                        <ArrowRight className="w-5 h-5 text-gray-600 dark:text-gray-400" />
                    </button>
                </div>
                {/* Mobile summary */}
                <div className="md:hidden grid grid-cols-3 gap-2 mt-4 pt-4 border-t border-gray-100 dark:border-gray-700">
                    {summaryItems.map((item, i) => (
                        <div key={item.label} className={clsx('flex flex-col items-center', i > 0 && 'border-l border-gray-200 dark:border-gray-700')}>
                            <span className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold mb-1">{item.label}</span>
                            <span className={clsx('text-sm font-bold', item.cls)}>{item.text.replace(' kr', '')}</span>
                        </div>
                    ))}
                </div>
            </div>

            {/* Actions + account filter */}
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                <div className="flex flex-wrap gap-2">
                    <button
                        onClick={() => setSelectedAccount(null)}
                        className={clsx(
                            'px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors',
                            !selectedAccount
                                ? 'bg-blue-50 border-blue-200 text-blue-700 dark:bg-blue-900/30 dark:border-blue-700 dark:text-blue-300'
                                : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300'
                        )}
                    >
                        Alle kontoer
                    </button>
                    {accountsWithTx.map(acc => (
                        <button
                            key={acc.id}
                            onClick={() => setSelectedAccount(acc)}
                            className={clsx(
                                'px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors',
                                selectedAccount?.id === acc.id
                                    ? 'bg-blue-50 border-blue-200 text-blue-700 dark:bg-blue-900/30 dark:border-blue-700 dark:text-blue-300'
                                    : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300'
                            )}
                        >
                            {acc.name}
                        </button>
                    ))}
                </div>
                <div className="flex flex-wrap gap-2">
                    <button onClick={handleDeleteAllTransactions} className="flex items-center space-x-2 px-3 py-2 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100 text-red-700 font-medium shadow-sm text-sm">
                        <Trash2 className="w-4 h-4" />
                        <span>Slett alle</span>
                    </button>
                    <button onClick={handleManualReconcile} className="flex items-center space-x-2 px-3 py-2 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 text-blue-700 font-medium shadow-sm text-sm">
                        <CheckCircle className="w-4 h-4" />
                        <span>Avstem</span>
                    </button>
                    <button onClick={() => setIsImportModalOpen(true)} className="flex items-center space-x-2 px-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 font-medium shadow-sm text-sm">
                        <Upload className="w-4 h-4" />
                        <span>Importer CSV</span>
                    </button>
                </div>
            </div>

            {/* Sort + extra filters */}
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs uppercase tracking-wider text-gray-400 font-semibold mr-1">Filter</span>
                    {extraFilters.map(f => (
                        <button
                            key={f.key}
                            onClick={() => toggleFilter(f.key)}
                            className={clsx(
                                'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors',
                                activeFilters.includes(f.key)
                                    ? 'bg-blue-50 border-blue-200 text-blue-700 dark:bg-blue-900/30 dark:border-blue-700 dark:text-blue-300'
                                    : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300'
                            )}
                        >
                            {f.Icon && <f.Icon className="w-3.5 h-3.5" />}
                            {f.label}
                        </button>
                    ))}
                    {activeFilters.length > 0 && (
                        <button
                            onClick={() => setActiveFilters([])}
                            className="inline-flex items-center gap-1 px-2 py-1.5 text-sm text-gray-500 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400 transition-colors"
                        >
                            <X className="w-3.5 h-3.5" />
                            Nullstill
                        </button>
                    )}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                    <ArrowUpDown className="w-4 h-4 text-gray-400" />
                    <select
                        value={sortBy}
                        onChange={(e) => setSortBy(e.target.value)}
                        className="px-3 py-1.5 rounded-lg text-sm font-medium border bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                        <option value="date-desc">Dato (nyeste først)</option>
                        <option value="date-asc">Dato (eldste først)</option>
                        <option value="amount-desc">Beløp (høyest først)</option>
                        <option value="amount-asc">Beløp (lavest først)</option>
                        <option value="name-asc">Navn (A–Å)</option>
                    </select>
                </div>
            </div>

            {/* Transaction list */}
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
                    <h2 className="font-bold text-gray-900 dark:text-gray-100">
                        {selectedAccount ? `Transaksjoner: ${selectedAccount.name}` : 'Alle Transaksjoner'}
                    </h2>
                    <span className="text-sm text-gray-500 dark:text-gray-400">{displayedTransactions.length} transaksjoner</span>
                </div>
                <div className="divide-y divide-gray-100 dark:divide-gray-700">
                    {displayedTransactions.length > 0 ? (
                        displayedTransactions.map(trans => {
                            const linkedExpense = trans.budgetItemId ? expenses.find(e => e.id === trans.budgetItemId) : null;
                            const linkedProject = trans.projectId ? projects.find(p => p.id === trans.projectId) : null;
                            const hasReceipt = !!trans.receiptId || receipts.some(r => r.transactionId === trans.id);
                            const refundOriginal = trans.isRefund && trans.refundOfTransactionId ? transactions.find(t => t.id === trans.refundOfTransactionId) : null;
                            const refundedAmount = refundedByOriginal.get(trans.id);
                            return (
                                <div key={trans.id} className="px-6 py-4 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors group">
                                    <div className="flex items-center space-x-4">
                                        <div className={clsx('w-10 h-10 rounded-full flex items-center justify-center',
                                            trans.type === 'income' ? 'bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400' : 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400')}>
                                            {trans.type === 'income' ? <ArrowDownLeft className="w-5 h-5" /> : <ArrowUpRight className="w-5 h-5" />}
                                        </div>
                                        <div>
                                            <div className="font-medium text-gray-900 dark:text-gray-100">
                                                {trans.name}
                                                {trans.excludeFromSharedCalc && <span className="ml-1 text-orange-500" title="Holdt utenfor fordeling">*</span>}
                                            </div>
                                            <div className="text-xs text-gray-500 dark:text-gray-400 flex items-center flex-wrap gap-x-2 gap-y-0.5">
                                                <span>{trans.date} • {linkedExpense ? linkedExpense.category : (trans.category || 'Ukategorisert')}</span>
                                                {linkedExpense && (
                                                    <span className="inline-flex items-center gap-1 text-blue-600 dark:text-blue-400">
                                                        <Link2 className="w-3 h-3 flex-shrink-0" />{linkedExpense.name}
                                                    </span>
                                                )}
                                                {linkedProject && (
                                                    <span className="inline-flex items-center gap-1 text-purple-600 dark:text-purple-400">
                                                        <FolderKanban className="w-3 h-3 flex-shrink-0" />{linkedProject.name}
                                                    </span>
                                                )}
                                                {trans.paidPrivatelyBy && (
                                                    <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300 text-[10px] font-bold uppercase tracking-wider">Utlegg</span>
                                                )}
                                                {trans.isRefund && (
                                                    <span className="inline-flex items-center gap-1 text-teal-600 dark:text-teal-400" title={refundOriginal ? `Retur av ${refundOriginal.name} (${refundOriginal.date})` : 'Retur / kreditnota'}>
                                                        <Undo2 className="w-3 h-3 flex-shrink-0" />Retur{refundOriginal ? ` av ${refundOriginal.name}` : ''}
                                                    </span>
                                                )}
                                                {refundedAmount > 0 && (
                                                    <span className="inline-flex items-center gap-1 text-teal-600 dark:text-teal-400" title="Hele eller deler av beløpet er returnert">
                                                        <Undo2 className="w-3 h-3 flex-shrink-0" />{refundedAmount.toLocaleString('no-NO')} kr returnert
                                                    </span>
                                                )}
                                                {hasReceipt && (
                                                    <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400" title="Kvittering med varelinjer er koblet">
                                                        <ReceiptText className="w-3 h-3 flex-shrink-0" />Kvittering
                                                    </span>
                                                )}
                                                {isHandled(trans)
                                                    ? <span className="text-green-600 dark:text-green-400">✓ Avstemt</span>
                                                    : <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 text-[10px] font-bold uppercase tracking-wider">Uavstemt</span>}
                                            </div>
                                            {trans.comment && (
                                                <div className="text-xs text-blue-600 dark:text-blue-400 mt-0.5 italic">💬 {trans.comment}</div>
                                            )}
                                        </div>
                                    </div>
                                    <div className="flex items-center space-x-4">
                                        <div className={clsx('font-bold', trans.type === 'income' ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400')}>
                                            {trans.type === 'income' ? '+' : '-'}{trans.amount.toLocaleString('no-NO')} kr
                                        </div>
                                        <div className="flex space-x-1 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
                                            <button onClick={(e) => handleEditTransaction(e, trans)} className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors">
                                                <Edit2 className="w-4 h-4" />
                                            </button>
                                            <button onClick={(e) => { e.stopPropagation(); setMergeTarget(trans); }} title="Slå sammen med duplikat" className="p-1.5 text-gray-400 hover:text-purple-600 hover:bg-purple-50 rounded-lg transition-colors">
                                                <Merge className="w-4 h-4" />
                                            </button>
                                            <button onClick={(e) => { e.stopPropagation(); setDeleteConfirmation({ isOpen: true, id: trans.id, type: 'transaction' }); }} className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                                                <Trash2 className="w-4 h-4" />
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            );
                        })
                    ) : (
                        <div className="px-6 py-8 text-center text-gray-500 dark:text-gray-400">
                            {activeFilters.length > 0
                                ? 'Ingen transaksjoner matcher de valgte filtrene denne måneden.'
                                : 'Ingen transaksjoner funnet for denne måneden.'}
                        </div>
                    )}
                </div>
            </div>

            <ImportCSVModal
                isOpen={isImportModalOpen}
                onClose={() => setIsImportModalOpen(false)}
                onImport={handleImport}
                accounts={accounts}
            />
            <ReconcileTransactionsModal
                isOpen={isReconcileModalOpen}
                onClose={() => setIsReconcileModalOpen(false)}
                transactions={transactionsToReconcile}
                onComplete={() => { setIsReconcileModalOpen(false); setTransactionsToReconcile([]); }}
            />
            <DuplicateReviewModal
                isOpen={isDuplicateReviewOpen}
                onClose={() => setIsDuplicateReviewOpen(false)}
                duplicates={potentialDuplicates}
                onComplete={handleDuplicateReviewComplete}
            />
            <MergeTransactionsModal
                isOpen={!!mergeTarget}
                onClose={() => setMergeTarget(null)}
                transaction={mergeTarget}
            />
            <ConfirmationModal
                isOpen={deleteConfirmation.isOpen}
                onClose={() => setDeleteConfirmation({ ...deleteConfirmation, isOpen: false })}
                onConfirm={confirmDelete}
                title={deleteConfirmation.type === 'all_transactions' ? 'Slett alle transaksjoner' : 'Slett transaksjon'}
                message={deleteConfirmation.type === 'all_transactions'
                    ? `Er du sikker på at du vil slette alle ${deleteConfirmation.count} transaksjonene i denne visningen?`
                    : 'Er du sikker på at du vil slette denne transaksjonen?'}
                confirmText="Slett"
                isDangerous={true}
            />
        </div>
    );
}
