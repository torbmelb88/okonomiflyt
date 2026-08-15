import { useState, useEffect } from 'react';
import {
    Upload, ArrowDownLeft, ArrowUpRight, Edit2, Trash2, CheckCircle,
    Link2, FolderKanban, ReceiptText, ArrowRight, CreditCard,
    MessageSquare, Smartphone, Landmark, ArrowUpDown, X, Undo2, Merge, FileText,
} from 'lucide-react';
import clsx from 'clsx';
import { useBudget } from '../../contexts/BudgetContext';
import ReconcileTransactionsModal from '../accounts/ReconcileTransactionsModal';
import MergeTransactionsModal from './MergeTransactionsModal';
import ConfirmationModal from '../common/ConfirmationModal';
import { isHandled, reconcileState } from '../../utils/reconciliation';

/**
 * Reusable transaction engine: month navigation, summary, account filter,
 * the transaction list and reconciliation. Shows ALL accounts (bank + credit
 * card) in one view — filter chips narrow down to a single account or to the
 * credit cards as a group. Import lives on its own page (ImportPage).
 */
export default function TransactionsPanel({
    accounts,
    selectedMonth,
    setSelectedMonth,
    reconcileNonce,
}) {
    const {
        expenses, transactions, projects, receipts,
        deleteTransaction, deleteTransactions,
    } = useBudget();

    const [selectedAccount, setSelectedAccount] = useState(null);
    const [deleteConfirmation, setDeleteConfirmation] = useState({ isOpen: false, id: null, type: null, count: 0 });
    const [sortBy, setSortBy] = useState('date-desc');
    const [activeFilters, setActiveFilters] = useState([]);

    // Reconciliation
    const [isReconcileModalOpen, setIsReconcileModalOpen] = useState(false);
    const [transactionsToReconcile, setTransactionsToReconcile] = useState([]);

    // Manual duplicate merge
    const [mergeTarget, setMergeTarget] = useState(null);

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

    // Three states (see utils/reconciliation.js): avstemt = matched against
    // the bank, bokført = categorized but awaiting the bank copy (companion
    // app), uavstemt = needs follow-up. Booked rows need no follow-up.

    const creditCardIds = new Set(accounts.filter(a => a.type === 'Kredittkort').map(a => a.id));
    const accountNameById = new Map(accounts.map(a => [a.id, a.name]));
    const panelTransactions = transactions;

    // Extra filters (AND-combined chips). "Manuell/CSV" = no source field:
    // the companion app stamps source:'companion_app', the SB1 import
    // stamps source:'sb1' and the credit-card invoice import
    // source:'trumf-invoice'; everything else was entered by hand or CSV.
    const extraFilters = [
        { key: 'comment', label: 'Kommentar', Icon: MessageSquare, test: (t) => !!t.comment },
        { key: 'companion', label: 'Companion-app', Icon: Smartphone, test: (t) => t.source === 'companion_app' },
        { key: 'sb1', label: 'Bank (SB1)', Icon: Landmark, test: (t) => t.source === 'sb1' },
        { key: 'invoice', label: 'Kortfaktura', Icon: FileText, test: (t) => t.source === 'trumf-invoice' },
        { key: 'manual', label: 'Manuell/CSV', Icon: Upload, test: (t) => !t.source },
        { key: 'creditcard', label: 'Kredittkort', Icon: CreditCard, test: (t) => creditCardIds.has(t.accountId) },
        { key: 'unreconciled', label: 'Uavstemt', Icon: null, test: (t) => !isHandled(t) },
        { key: 'booked', label: 'Venter avstemming', Icon: null, test: (t) => reconcileState(t) === 'booked' },
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
        'account-asc': (a, b) =>
            (accountNameById.get(a.accountId) || '').localeCompare(accountNameById.get(b.accountId) || '', 'no-NO') ||
            (b.date || '').localeCompare(a.date || ''),
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
    // One combined summary for bank + credit card. Money movement (bill
    // payments, transfers, savings) is excluded via category, so card
    // purchases count once and the payment of the card bill counts never.
    const summaryItems = [
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
                            {creditCardIds.has(acc.id) && <CreditCard className="inline w-3.5 h-3.5 mr-1 -mt-0.5" />}
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
                        <option value="account-asc">Konto (A–Å)</option>
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
                                                {trans.currency && trans.currency !== 'NOK' && (
                                                    <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-sky-100 dark:bg-sky-900/30 text-sky-700 dark:text-sky-300 text-[10px] font-bold uppercase tracking-wider" title="Beløpet er i utenlandsk valuta og er omtrentlig — banken fører det vekslede NOK-beløpet senere. Slå sammen med banktransaksjonen når den kommer.">{trans.currency} ~</span>
                                                )}
                                                {trans.originalCurrency && (
                                                    <span className="inline-flex items-center gap-1 text-sky-600 dark:text-sky-400" title="Opprinnelig beløp betalt i utenlandsk valuta">
                                                        {(trans.originalAmount ?? 0).toLocaleString('no-NO')} {trans.originalCurrency} betalt
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
                                                {reconcileState(trans) === 'reconciled'
                                                    ? <span className="text-green-600 dark:text-green-400">✓ Avstemt</span>
                                                    : reconcileState(trans) === 'booked'
                                                        ? <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 text-[10px] font-bold uppercase tracking-wider" title="Bokført, men ikke matchet mot en banktransaksjon ennå — avstemmes når bankens kopi kommer inn via import">Bokført</span>
                                                        : <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 text-[10px] font-bold uppercase tracking-wider">Uavstemt</span>}
                                            </div>
                                            {trans.comment && (
                                                <div className="text-xs text-blue-600 dark:text-blue-400 mt-0.5 italic">💬 {trans.comment}</div>
                                            )}
                                        </div>
                                    </div>
                                    <div className="flex items-center space-x-4">
                                        <div className={clsx('font-bold', trans.type === 'income' ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400')}>
                                            {trans.type === 'income' ? '+' : '-'}{trans.amount.toLocaleString('no-NO')} {trans.currency && trans.currency !== 'NOK' ? trans.currency : 'kr'}
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

            <ReconcileTransactionsModal
                isOpen={isReconcileModalOpen}
                onClose={() => setIsReconcileModalOpen(false)}
                transactions={transactionsToReconcile}
                onComplete={() => { setIsReconcileModalOpen(false); setTransactionsToReconcile([]); }}
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
