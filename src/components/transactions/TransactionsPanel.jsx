import { useState, useEffect } from 'react';
import {
    Upload, ArrowDownLeft, ArrowUpRight, Edit2, Trash2, CheckCircle,
    Link2, FolderKanban, ReceiptText, ArrowRight, CreditCard,
    MessageSquare, Smartphone, Landmark, ArrowUpDown, X, Undo2, Merge, FileText,
    ArrowLeftRight, AlertTriangle, SlidersHorizontal, ChevronDown, ChevronUp, CornerDownRight,
} from 'lucide-react';
import clsx from 'clsx';
import { useBudget } from '../../contexts/BudgetContext';
import ReconcileTransactionsModal from '../accounts/ReconcileTransactionsModal';
import { exclusionReason, EXCLUSION_LABEL } from '../../utils/settlement';
import { isCountedInOtherMonth, countedInLabel, countedInTitle } from '../../utils/countedMonth';
import MergeTransactionsModal from './MergeTransactionsModal';
import ConfirmationModal from '../common/ConfirmationModal';
import { isHandled, reconcileState } from '../../utils/reconciliation';
import { coverGroups, COVER_STATUS_LABEL } from '../../utils/coverage';
import { useDialog } from '../../contexts/DialogContext';

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
    focusIds,
    focusNonce,
}) {
    const { notify } = useDialog();
    // Household-wide: every budget's rows, with the names of budget items and
    // projects from every budget.
    const {
        allExpenses: expenses, allTransactions: transactions, allProjects: projects, allProjects, receipts, budgets,
        budgetItemDefs, categories,
        deleteTransaction, deleteTransactions,
    } = useBudget();
    // The name to show for a linked budget item: the library def's current
    // name and category win over the instance's stored copy (instances logged
    // before a rename may still carry the old name).
    const linkedLabel = (inst) => {
        const def = inst?.defId ? budgetItemDefs.find(d => d.id === inst.defId) : null;
        const cat = def ? categories.find(c => c.id === def.categoryId)?.name : null;
        return { name: def?.name || inst?.name, category: cat || inst?.category };
    };

    const [selectedAccount, setSelectedAccount] = useState(null);
    const [selectedBudgetId, setSelectedBudgetId] = useState(null); // null = all budgets
    const [deleteConfirmation, setDeleteConfirmation] = useState({ isOpen: false, id: null, type: null, count: 0 });
    const [sortBy, setSortBy] = useState('date-desc');
    const [activeFilters, setActiveFilters] = useState([]);
    const [showMoreFilters, setShowMoreFilters] = useState(false);
    const selectCls = 'px-3 py-1.5 rounded-lg text-sm font-medium border bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500';

    // Reconciliation: 'queue' walks the unreconciled rows, 'edit' opens one
    const [isReconcileModalOpen, setIsReconcileModalOpen] = useState(false);
    const [transactionsToReconcile, setTransactionsToReconcile] = useState([]);
    const [reconcileMode, setReconcileMode] = useState('queue');

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

    // Pass-through money («dekkes av innbetaling», utils/coverage.js): every
    // covered expense and covering income mapped to its group, whose status
    // drives the green/red badge.
    const coverGroupById = new Map();
    for (const g of coverGroups(transactions)) {
        for (const t of [...g.expenses, ...g.incomes]) coverGroupById.set(t.id, g);
    }

    // Extra filters (AND-combined chips), in three groups. "Manuell/CSV" = no
    // source field: the companion app stamps source:'companion_app', the SB1
    // import stamps source:'sb1' and the credit-card invoice import
    // source:'trumf-invoice'; everything else was entered by hand or CSV.
    const filterGroups = [
        { label: 'Kilde', filters: [
            { key: 'sb1', label: 'Bank (SB1)', Icon: Landmark, test: (t) => t.source === 'sb1' },
            { key: 'companion', label: 'Companion-app', Icon: Smartphone, test: (t) => t.source === 'companion_app' },
            { key: 'invoice', label: 'Kortfaktura', Icon: FileText, test: (t) => t.source === 'trumf-invoice' },
            { key: 'manual', label: 'Manuell/CSV', Icon: Upload, test: (t) => !t.source, hint: 'Lagt inn for hånd eller via CSV-fil — ikke fra bank, companion-app eller kortfaktura' },
            { key: 'creditcard', label: 'Kredittkort', Icon: CreditCard, test: (t) => creditCardIds.has(t.accountId) },
        ] },
        { label: 'Status', filters: [
            { key: 'unreconciled', label: 'Uavstemt', Icon: null, test: (t) => !isHandled(t), hint: 'Ikke knyttet til en budsjettpost ennå — teller ikke i forbruket' },
            { key: 'booked', label: 'Bokført', Icon: null, test: (t) => reconcileState(t) === 'booked', hint: 'Registrert i companion-appen og kategorisert, men bankens kopi har ikke kommet inn ennå' },
            { key: 'awaitingRefund', label: 'Venter refusjon', Icon: Undo2, test: (t) => !!t.awaitingRefund, hint: 'Kjøp noen skal betale tilbake, der innbetalingen ikke er koblet ennå' },
        ] },
        { label: 'Spesielt', filters: [
            { key: 'cover', label: 'Gjennomreise', Icon: ArrowLeftRight, test: (t) => coverGroupById.has(t.id), hint: 'Penger på gjennomreise: overføringer som dekkes av en innbetaling, og innbetalingene som dekker dem' },
            { key: 'utlegg', label: 'Utlegg', Icon: null, test: (t) => !!t.paidPrivatelyBy, hint: 'Felles utgifter betalt fra egen konto — trekkes fra det du skal overføre' },
            { key: 'comment', label: 'Kommentar', Icon: MessageSquare, test: (t) => !!t.comment },
            { key: 'receipt', label: 'Kvittering', Icon: ReceiptText, test: (t) => !!t.receiptId || receipts.some(r => r.transactionId === t.id) },
        ] },
    ];
    const extraFilters = filterGroups.flatMap(g => g.filters);
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
        .filter(t => !selectedBudgetId || t.budgetId === selectedBudgetId)
        .filter(t => extraFilters.every(f => !activeFilters.includes(f.key) || f.test(t)))
        .sort(sortComparators[sortBy] || sortComparators['date-desc']);

    // Refund-split children (utils/refunds.js) are drawn indented under their
    // parent when both are in the list. A child whose parent is filtered out
    // stays a row of its own, so nothing that passes the filters disappears.
    const displayedIds = new Set(displayedTransactions.map(t => t.id));
    const rows = displayedTransactions
        .filter(t => !(t.refundParentId && displayedIds.has(t.refundParentId)))
        .map(t => ({ row: t, children: t.refundSplit ? displayedTransactions.filter(c => c.refundParentId === t.id) : [] }));

    // Accounts are global; only offer filter buttons for accounts that actually
    // have transactions in this view (plus the currently selected one).
    const accountsWithTx = accounts.filter(a =>
        (selectedAccount && a.id === selectedAccount.id) ||
        panelTransactions.some(t => t.accountId === a.id && t.month === selectedMonth)
    );

    // Refunded amount per original transaction, for the "returnert" badge
    const refundedByOriginal = new Map();
    for (const t of transactions) {
        if (t.isRefund && t.refundOfTransactionId) {
            refundedByOriginal.set(t.refundOfTransactionId, (refundedByOriginal.get(t.refundOfTransactionId) || 0) + t.amount);
        }
    }

    const handleDeleteAllTransactions = () => {
        if (displayedTransactions.length === 0) {
            notify('Ingen transaksjoner å slette.');
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
            notify({ message: 'Kunne ikke slette: ' + err.message, variant: 'error' });
        }
    };

    const handleManualReconcile = () => {
        const unreconciled = displayedTransactions.filter(t => !isHandled(t));
        if (unreconciled.length > 0) {
            setTransactionsToReconcile(unreconciled);
            setReconcileMode('queue');
            setIsReconcileModalOpen(true);
        } else {
            notify('Ingen uavstemte transaksjoner funnet.');
        }
    };

    // Lets a parent (e.g. the Transaksjoner "needs follow-up" banner) open the
    // reconcile flow by bumping a nonce.
    useEffect(() => {
        if (reconcileNonce) handleManualReconcile();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [reconcileNonce]);

    // …or open it on a specific set of rows (the «dekning mangler» banner).
    useEffect(() => {
        if (!focusNonce) return;
        const rows = (focusIds || []).map(id => transactions.find(t => t.id === id)).filter(Boolean);
        if (rows.length > 0) { setTransactionsToReconcile(rows); setReconcileMode(rows.length === 1 ? 'edit' : 'queue'); setIsReconcileModalOpen(true); }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [focusNonce]);

    const handleEditTransaction = (e, transaction) => {
        e.stopPropagation();
        setTransactionsToReconcile([transaction]);
        setReconcileMode('edit');
        setIsReconcileModalOpen(true);
    };

    // One list row. `nested` = a refund-split child drawn under its parent:
    // indented, muted, and without merge/delete (the split is undone as a whole
    // from the parent or from the reconcile dialog).
    const renderRow = (trans, nested = false) => {
        const linkedExpense = trans.budgetItemId ? expenses.find(e => e.id === trans.budgetItemId) : null;
        const linkedProject = trans.projectId ? projects.find(p => p.id === trans.projectId) : null;
        const hasReceipt = !!trans.receiptId || receipts.some(r => r.transactionId === trans.id);
        const refundOriginal = trans.isRefund && trans.refundOfTransactionId ? transactions.find(t => t.id === trans.refundOfTransactionId) : null;
        const refundedAmount = refundedByOriginal.get(trans.id) || 0;
        const splitChildren = trans.refundSplit ? transactions.filter(t => t.refundParentId === trans.id).length : 0;
        const refundExpected = trans.expectedRefundAmount > 0 ? trans.expectedRefundAmount : trans.amount;
        return (
            <div key={trans.id} className={clsx('flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors group',
                nested ? 'pl-6 pr-6 py-3 bg-gray-50/60 dark:bg-gray-900/30' : 'px-6 py-4')}>
                <div className="flex items-center space-x-4">
                    {nested ? (
                        <div className="w-10 h-10 flex items-center justify-center text-teal-500 dark:text-teal-400" title="Del av den fordelte innbetalingen over">
                            <CornerDownRight className="w-5 h-5" />
                        </div>
                    ) : (
                        <div className={clsx('w-10 h-10 rounded-full flex items-center justify-center',
                            trans.type === 'income' ? 'bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400' : 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400')}>
                            {trans.type === 'income' ? <ArrowDownLeft className="w-5 h-5" /> : <ArrowUpRight className="w-5 h-5" />}
                        </div>
                    )}
                    <div>
                        <div className="font-medium text-gray-900 dark:text-gray-100">
                            {trans.name}
                            {exclusionReason(trans, accounts, allProjects) && <span className="ml-1 text-orange-500" title={EXCLUSION_LABEL[exclusionReason(trans, accounts, allProjects)]}>*</span>}
                        </div>
                        <div className="text-xs text-gray-500 dark:text-gray-400 flex items-center flex-wrap gap-x-2 gap-y-0.5">
                            <span>{trans.date} • {linkedExpense ? linkedLabel(linkedExpense).category : (trans.category || 'Ukategorisert')}</span>
                            {isCountedInOtherMonth(trans) && (
                                <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 text-[10px] font-bold uppercase tracking-wider" title={countedInTitle(trans)}>{countedInLabel(trans)}</span>
                            )}
                            {linkedExpense && (
                                <span className="inline-flex items-center gap-1 text-blue-600 dark:text-blue-400">
                                    <Link2 className="w-3 h-3 flex-shrink-0" />{linkedLabel(linkedExpense).name}
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
                                <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300 text-[10px] font-bold uppercase tracking-wider" title={trans.type === 'income'
                                    ? 'Felles innbetaling mottatt på egen konto — beløpet legges til det du skal overføre til felleskontoen'
                                    : 'Felles utgift betalt fra egen konto — beløpet trekkes fra det du skal overføre til felleskontoen'}>{trans.type === 'income' ? 'Mottatt privat' : 'Utlegg'}</span>
                            )}
                            {trans.refundSplit && (
                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-300 text-[10px] font-bold uppercase tracking-wider" title="Innbetalingen er fordelt på flere kjøp — beløpet telles via de fordelte radene, ikke denne">
                                    <Undo2 className="w-3 h-3 flex-shrink-0" />Fordelt på {splitChildren} kjøp
                                </span>
                            )}
                            {trans.isRefund && !trans.refundSplit && (
                                <span className="inline-flex items-center gap-1 text-teal-600 dark:text-teal-400" title={refundOriginal ? `Refusjon av ${refundOriginal.name} (${refundOriginal.date})${trans.refundParentId ? ' — del av en fordelt innbetaling' : ''}` : 'Refusjon uten kobling til et kjøp'}>
                                    <Undo2 className="w-3 h-3 flex-shrink-0" />Refusjon{refundOriginal ? ` av ${refundOriginal.name}` : ''}{trans.refundParentId ? ' (del)' : ''}
                                </span>
                            )}
                            {trans.awaitingRefund && (
                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-300 text-[10px] font-bold uppercase tracking-wider" title={`Venter på innkommende refusjon (Vipps e.l.). Forventet ${refundExpected.toLocaleString('no-NO')} kr${refundedAmount > 0 ? `, mottatt ${refundedAmount.toLocaleString('no-NO')} kr` : ''}. Knytt innbetalingen i avstemmingsdialogen.`}>
                                    <Undo2 className="w-3 h-3 flex-shrink-0" />Venter refusjon{refundedAmount > 0 ? ` · ${refundedAmount.toLocaleString('no-NO')} av ${refundExpected.toLocaleString('no-NO')}` : ''}
                                </span>
                            )}
                            {coverGroupById.has(trans.id) && (() => {
                                const g = coverGroupById.get(trans.id);
                                const ok = g.status === 'ok';
                                const sums = `Inn ${g.in.toLocaleString('no-NO')} kr, ut ${g.out.toLocaleString('no-NO')} kr.`;
                                const title = g.status === 'missing'
                                    ? 'Merket som gjennomreise, men ingen innbetaling er koblet. Åpne raden og koble innbetalingen — eller fjern merkingen.'
                                    : g.status === 'mismatch'
                                        ? `Gjennomreise: innbetalingen(e) og overføringen(e) stemmer ikke overens. ${sums}`
                                        : `Penger på gjennomreise — holdes utenfor oppgjør og overføringsberegninger. ${sums}`;
                                return (
                                    <span className={clsx('inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider',
                                        ok ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300' : 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300')} title={title}>
                                        {ok ? <ArrowLeftRight className="w-3 h-3 flex-shrink-0" /> : <AlertTriangle className="w-3 h-3 flex-shrink-0" />}
                                        {COVER_STATUS_LABEL[g.status]}
                                    </span>
                                );
                            })()}
                            {!trans.awaitingRefund && refundedAmount > 0 && (
                                <span className="inline-flex items-center gap-1 text-teal-600 dark:text-teal-400" title={refundedAmount > trans.amount ? 'Mer refundert enn kjøpet kostet — overskytende gjør netto negativt' : 'Hele eller deler av beløpet er refundert'}>
                                    <Undo2 className="w-3 h-3 flex-shrink-0" />{refundedAmount.toLocaleString('no-NO')} kr refundert{refundedAmount > trans.amount ? ' (overrefundert)' : ''}
                                </span>
                            )}
                            {hasReceipt && (
                                <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400" title="Kvittering med varelinjer er koblet">
                                    <ReceiptText className="w-3 h-3 flex-shrink-0" />Kvittering
                                </span>
                            )}
                            {reconcileState(trans) === 'reconciled'
                                ? <span className="text-green-600 dark:text-green-400" title="Knyttet til en budsjettpost og bekreftet mot banken — rader importert fra banken blir avstemt i det de knyttes">✓ Avstemt</span>
                                : reconcileState(trans) === 'booked'
                                    ? <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 text-[10px] font-bold uppercase tracking-wider" title="Bokført, men ikke matchet mot en banktransaksjon ennå — avstemmes når bankens kopi kommer inn via import">Bokført</span>
                                    : <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 text-[10px] font-bold uppercase tracking-wider" title="Ikke knyttet til en budsjettpost ennå, så beløpet teller ikke i forbruket — trykk blyanten for å avstemme">Uavstemt</span>}
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
                        {!nested && (
                            <button onClick={(e) => { e.stopPropagation(); setMergeTarget(trans); }} title="Slå sammen med duplikat" className="p-1.5 text-gray-400 hover:text-purple-600 hover:bg-purple-50 rounded-lg transition-colors">
                                <Merge className="w-4 h-4" />
                            </button>
                        )}
                        {!nested && (
                            <button onClick={(e) => { e.stopPropagation(); setDeleteConfirmation({ isOpen: true, id: trans.id, type: 'transaction' }); }} className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                                <Trash2 className="w-4 h-4" />
                            </button>
                        )}
                    </div>
                </div>
            </div>
        );
    };

    return (
        <div className="space-y-6">
            {/* Month navigation */}
            <div className="bg-white dark:bg-gray-800 p-4 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700">
                <div className="flex items-center justify-between">
                    <button onClick={() => changeMonth(-1)} className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full transition-colors">
                        <ArrowRight className="w-5 h-5 transform rotate-180 text-gray-600 dark:text-gray-400" />
                    </button>
                    <div className="text-center flex-1 mx-4">
                        <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 capitalize">{formatMonth(selectedMonth)}</h2>
                        <span className="text-sm text-gray-500 dark:text-gray-400">{displayedTransactions.length} transaksjoner</span>
                    </div>
                    <button onClick={() => changeMonth(1)} className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full transition-colors ml-2">
                        <ArrowRight className="w-5 h-5 text-gray-600 dark:text-gray-400" />
                    </button>
                </div>
            </div>

            {/* Filter bar: what to show, in one row; the chip groups behind «Flere filtre» */}
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-3 space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                    {budgets.length > 1 && (
                        <select value={selectedBudgetId || ''} onChange={(e) => setSelectedBudgetId(e.target.value || null)} className={selectCls} title="Budsjett">
                            <option value="">Alle budsjetter</option>
                            {budgets.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                        </select>
                    )}
                    <select value={selectedAccount?.id || ''} onChange={(e) => setSelectedAccount(accounts.find(a => a.id === e.target.value) || null)} className={selectCls} title="Konto">
                        <option value="">Alle kontoer</option>
                        {accountsWithTx.some(a => !creditCardIds.has(a.id)) && (
                            <optgroup label="Bankkontoer">
                                {accountsWithTx.filter(a => !creditCardIds.has(a.id)).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                            </optgroup>
                        )}
                        {accountsWithTx.some(a => creditCardIds.has(a.id)) && (
                            <optgroup label="Kredittkort">
                                {accountsWithTx.filter(a => creditCardIds.has(a.id)).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                            </optgroup>
                        )}
                    </select>
                    <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} className={selectCls} title="Sortering">
                        <option value="date-desc">Dato (nyeste først)</option>
                        <option value="date-asc">Dato (eldste først)</option>
                        <option value="amount-desc">Beløp (høyest først)</option>
                        <option value="amount-asc">Beløp (lavest først)</option>
                        <option value="name-asc">Navn (A–Å)</option>
                        <option value="account-asc">Konto (A–Å)</option>
                    </select>
                    <button
                        onClick={() => setShowMoreFilters(v => !v)}
                        className={clsx(
                            'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors',
                            showMoreFilters || activeFilters.length > 0
                                ? 'bg-blue-50 border-blue-200 text-blue-700 dark:bg-blue-900/30 dark:border-blue-700 dark:text-blue-300'
                                : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300'
                        )}
                    >
                        <SlidersHorizontal className="w-3.5 h-3.5" />
                        Flere filtre
                        {activeFilters.length > 0 && <span className="ml-0.5 px-1.5 rounded-full bg-blue-600 text-white text-[11px] font-bold">{activeFilters.length}</span>}
                        {showMoreFilters ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                    </button>
                    {activeFilters.length > 0 && (
                        <button onClick={() => setActiveFilters([])} className="inline-flex items-center gap-1 px-2 py-1.5 text-sm text-gray-500 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400 transition-colors">
                            <X className="w-3.5 h-3.5" />Nullstill
                        </button>
                    )}
                </div>
                {showMoreFilters && (
                    <div className="flex flex-wrap items-start gap-x-6 gap-y-3 pt-3 border-t border-gray-100 dark:border-gray-700">
                        {filterGroups.map(g => (
                            <div key={g.label} className="flex flex-wrap items-center gap-2">
                                <span className="text-xs uppercase tracking-wider text-gray-400 font-semibold w-full sm:w-auto">{g.label}</span>
                                {g.filters.map(f => (
                                    <button
                                        key={f.key}
                                        onClick={() => toggleFilter(f.key)}
                                        title={f.hint}
                                        className={clsx(
                                            'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-sm font-medium border transition-colors',
                                            activeFilters.includes(f.key)
                                                ? 'bg-blue-50 border-blue-200 text-blue-700 dark:bg-blue-900/30 dark:border-blue-700 dark:text-blue-300'
                                                : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300'
                                        )}
                                    >
                                        {f.Icon && <f.Icon className="w-3.5 h-3.5" />}
                                        {f.label}
                                    </button>
                                ))}
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Transaction list, with the actions that act on what is shown */}
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
                <div className="px-4 md:px-6 py-3 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                        <h2 className="font-bold text-gray-900 dark:text-gray-100 truncate">{selectedAccount ? selectedAccount.name : 'Alle transaksjoner'}</h2>
                        <span className="text-xs text-gray-500 dark:text-gray-400">{displayedTransactions.length} transaksjoner{activeFilters.length > 0 || selectedBudgetId ? ' (filtrert)' : ''}</span>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                        <button onClick={handleManualReconcile} className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg shadow-sm text-sm" title="Gå gjennom de uavstemte radene som vises">
                            <CheckCircle className="w-4 h-4" />
                            <span>Avstem</span>
                        </button>
                        <button onClick={handleDeleteAllTransactions} title="Slett alle transaksjonene som vises akkurat nå — valgt måned, budsjett, konto og filtre. Kan ikke angres." className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors">
                            <Trash2 className="w-4 h-4" />
                        </button>
                    </div>
                </div>
                <div className="divide-y divide-gray-100 dark:divide-gray-700">
                    {displayedTransactions.length > 0 ? (
                        rows.map(({ row, children }) => (
                            <div key={row.id}>
                                {renderRow(row)}
                                {children.map(c => renderRow(c, true))}
                            </div>
                        ))
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
                mode={reconcileMode}
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
