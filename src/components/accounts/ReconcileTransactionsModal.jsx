import { useState, useMemo } from 'react';
import { X, Check, Plus, CreditCard, Edit2, FolderKanban, Sparkles, Wallet, Undo2, ArrowLeftRight, AlertTriangle, ChevronDown, ChevronUp, HelpCircle, Loader2 } from 'lucide-react';
import { useBudget } from '../../contexts/BudgetContext';
import AddBudgetItemModal from '../budget/AddBudgetItemModal';
import TransactionReceipt from './TransactionReceipt';
import InfoTip from '../common/InfoTip';
import { findBudgetItemSuggestion } from '../../utils/textMatch';
import { FOREIGN_CURRENCIES } from '../../utils/currency';
import { reconcilesOnLink, isHandled } from '../../utils/reconciliation';
import { refundStatus, refundsOf, allocationsValid, allocationComplete, parseAmount } from '../../utils/refunds';
import RefundAllocationEditor from './RefundAllocationEditor';
import { isCoveredExpense, isCoveringIncome, coverGroupOf, coveringIncomesOf, expensesCoveredBy, coverLinkIds } from '../../utils/coverage';
import { KIND, KIND_CATEGORY, KIND_EMOJI, KIND_HELP, kindsForType, kindLabelFor, transactionKind, isKindCategory, isSalary } from '../../utils/kinds';
import clsx from 'clsx';

const fmtKr = (n) => (Math.round((n || 0) * 100) / 100).toLocaleString('no-NO');
const daysBetween = (a, b) => Math.abs((new Date(a) - new Date(b)) / 86400000);
const coverStatusText = (g) => {
    if (g.status === 'missing') return 'Ingen innbetaling koblet';
    if (g.status === 'mismatch') return `Avvik — inn ${fmtKr(g.in)} kr, ut ${fmtKr(g.out)} kr (${g.diff > 0 ? '+' : ''}${fmtKr(g.diff)} kr)`;
    return `Inn ${fmtKr(g.in)} kr = ut ${fmtKr(g.out)} kr`;
};

const inputCls = "text-sm px-2 py-1 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 focus:ring-2 focus:ring-blue-400 outline-none";
const searchCls = "w-full text-sm px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white outline-none focus:ring-2 focus:ring-blue-400";
const listCls = "max-h-56 overflow-y-auto divide-y divide-gray-100 dark:divide-gray-700 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800";

/**
 * The reconcile dialog. Three questions, top to bottom:
 *
 *   1. Hva er dette?   — one choice (utils/kinds.js): kjøp, lønn, sparing, …
 *   2. Detaljer        — what that choice needs: budsjettpost, kjøpet en
 *                        refusjon gjelder, overføringen en innbetaling dekker
 *   3. Flere valg      — adjustments that ride on top: utenfor oppgjør,
 *                        utlegg, venter refusjon, gjennomreise, kommentar …
 *
 * Everything is staged in local state and written by ONE «Lagre» — whichever
 * kind was chosen — so nothing typed is lost and there is only one thing to
 * remember. The two exceptions are deliberate: removing an existing refund
 * link (it deletes split rows, so it asks first and acts at once) and the
 * receipt widget, which has its own button.
 *
 * `mode`: 'queue' walks a batch (import, «Avstem»), 'edit' opens one row.
 */
export default function ReconcileTransactionsModal({ isOpen, onClose, transactions, onComplete, mode = 'queue' }) {
    const {
        expenses, budgetItemDefs, categories, ensureInstanceForDef,
        addCategory, addBudgetItemDef, updateTransaction, accounts, budgets, allProjects, transactions: allTransactions,
        linkRefund, linkRefundSplit, unlinkRefund,
        setExpenseCover, setIncomeCover,
    } = useBudget();

    // --- queue ---
    const [currentIndex, setCurrentIndex] = useState(0);
    const [handledIds, setHandledIds] = useState(() => new Set());
    const [processedCount, setProcessedCount] = useState(0);
    const [bulkSaving, setBulkSaving] = useState(false);
    const [saving, setSaving] = useState(false);

    // --- 1. hva er dette ---
    const [kind, setKind] = useState(null);
    const [showGuide, setShowGuide] = useState(false);

    // --- 2. detaljer ---
    const [selectedBudgetId, setSelectedBudgetId] = useState('');
    const [selectedBudgetItemId, setSelectedBudgetItemId] = useState(''); // def id
    const [selectedProjectId, setSelectedProjectId] = useState('');
    const [selectedProjectSubcategory, setSelectedProjectSubcategory] = useState('');
    const [isAddOpen, setIsAddOpen] = useState(false);
    // refund: allocations of ONE payment across purchases [{transactionId, amount, complete}]
    const [allocations, setAllocations] = useState([]);
    const [refundSearch, setRefundSearch] = useState('');
    const [refundUnlinked, setRefundUnlinked] = useState(false);
    // purchase side of a refund: the incoming payment picked for it
    const [incomingMode, setIncomingMode] = useState(false);
    const [incomingSearch, setIncomingSearch] = useState('');
    const [selectedIncomingId, setSelectedIncomingId] = useState('');
    const [markRefundComplete, setMarkRefundComplete] = useState(false);
    // gjennomreise, both sides: staged links (ids of the other side)
    const [coverMode, setCoverMode] = useState(false);
    const [coverSearch, setCoverSearch] = useState('');
    const [coverAdd, setCoverAdd] = useState([]);
    const [coverRemove, setCoverRemove] = useState([]);

    // --- 3. flere valg ---
    const [showMore, setShowMore] = useState(false);
    const [isUnnecessary, setIsUnnecessary] = useState(false);
    const [excludeFromSharedCalc, setExcludeFromSharedCalc] = useState(false);
    const [coveredByAccountId, setCoveredByAccountId] = useState('');
    const [asUtlegg, setAsUtlegg] = useState(false);
    const [awaitingRefund, setAwaitingRefund] = useState(false);
    const [expectedRefundAmount, setExpectedRefundAmount] = useState('');
    const [coveredByIncoming, setCoveredByIncoming] = useState(false);
    const [comment, setComment] = useState('');
    const [isEditingDate, setIsEditingDate] = useState(false);
    const [tempDate, setTempDate] = useState('');
    const [currency, setCurrency] = useState(''); // '' = NOK

    const suggestions = useMemo(() => {
        const map = {};
        if (!transactions) return map;
        for (const t of transactions) {
            const suggestion = findBudgetItemSuggestion(t, allTransactions, expenses);
            if (suggestion) map[t.id] = suggestion;
        }
        return map;
    }, [transactions, allTransactions, expenses]);

    const currentTransaction = (transactions && transactions.length > 0) ? transactions[currentIndex] : null;
    const catName = (id) => categories.find(c => c.id === id)?.name || 'Annet';
    const resolveDefId = (instId) => instId ? (expenses.find(e => e.id === instId)?.defId || '') : '';

    // Reset the queue when a new batch is opened
    const [prevTransactions, setPrevTransactions] = useState(transactions);
    if (transactions !== prevTransactions) {
        setPrevTransactions(transactions);
        setCurrentIndex(0);
        setHandledIds(new Set());
        setProcessedCount(0);
    }

    // Load the form from the row when switching transactions
    const [prevTransactionId, setPrevTransactionId] = useState(null);
    if ((currentTransaction?.id || null) !== prevTransactionId) {
        setPrevTransactionId(currentTransaction?.id || null);
        const t = currentTransaction;
        const live = t ? (allTransactions.find(x => x.id === t.id) || t) : null;
        const suggestedDef = t ? resolveDefId(suggestions[t.id]?.budgetItemId) : '';
        const storedKind = live ? transactionKind(live, allTransactions) : null;
        // Unreconciled expense: «kjøp» is the common case, so it is preselected
        // (with the suggestion when there is one). Income has no safe default.
        setKind(storedKind || (t?.type === 'expense' ? KIND.purchase : null));
        setShowGuide(false);
        setSelectedBudgetItemId(t ? (resolveDefId(t.budgetItemId) || suggestedDef || '') : '');
        setSelectedProjectId(t?.projectId || '');
        setSelectedProjectSubcategory(t?.projectSubcategory || '');
        setAllocations([]);
        setRefundSearch('');
        setRefundUnlinked(false);
        setIncomingMode(false);
        setIncomingSearch('');
        setSelectedIncomingId('');
        setMarkRefundComplete(false);
        setCoverMode(false);
        setCoverSearch('');
        setCoverAdd([]);
        setCoverRemove([]);
        setIsUnnecessary(!!t?.isUnnecessary);
        setExcludeFromSharedCalc(!!t?.excludeFromSharedCalc);
        setCoveredByAccountId(t?.coveredByAccountId || '');
        // Utlegg is kept as stored: the companion app sets it when logging,
        // and an already reconciled row must not lose it on edit.
        setAsUtlegg(t?.paidPrivatelyBy === 'self');
        setAwaitingRefund(!!t?.awaitingRefund);
        setExpectedRefundAmount(t?.expectedRefundAmount != null ? String(t.expectedRefundAmount) : '');
        setCoveredByIncoming(!!(live && isCoveredExpense(live)));
        setComment(t?.comment || '');
        setIsEditingDate(false);
        setTempDate(t?.date || '');
        setCurrency(t?.currency && t.currency !== 'NOK' ? t.currency : '');
        // «Flere valg» opens by itself when something in it is already set
        setShowMore(!!(t?.isUnnecessary || t?.excludeFromSharedCalc || t?.paidPrivatelyBy || t?.awaitingRefund || t?.comment || (live && isCoveredExpense(live)) || (t?.currency && t.currency !== 'NOK')));
        // Budget: the account's default, or the stored one for a reconciled row
        const txAccount = accounts.find(a => a.id === t?.accountId);
        const accountDefault = txAccount?.defaultBudgetId || txAccount?.budgetId;
        setSelectedBudgetId(t?.reconciled ? (t.budgetId || accountDefault || '') : (accountDefault || t?.budgetId || ''));
    }

    if (!isOpen || !transactions || transactions.length === 0 || !currentTransaction) return null;

    const isEdit = mode === 'edit';
    const isExpense = currentTransaction.type === 'expense';
    const isIncome = currentTransaction.type === 'income';
    const currentSuggestion = suggestions[currentTransaction.id] || null;
    const suggestedDefId = resolveDefId(currentSuggestion?.budgetItemId);
    const remainingWithSuggestions = transactions.filter(t => !handledIds.has(t.id) && suggestions[t.id]);
    const account = accounts.find(a => a.id === currentTransaction.accountId);
    const accountName = (id) => accounts.find(a => a.id === id)?.name || '';

    // Live copy of the row (the prop array is a snapshot)
    const liveTx = allTransactions.find(t => t.id === currentTransaction.id) || currentTransaction;
    const storedKind = transactionKind(liveTx, allTransactions);

    // --- budget / budget items ---
    const selectedBudget = budgets.find(b => b.id === selectedBudgetId);
    const scope = selectedBudget?.type === 'shared' ? 'shared' : 'private';
    const isSharedTarget = selectedBudget?.type === 'shared';
    const accountDefaultBudget = budgets.find(b => b.id === (account?.defaultBudgetId || account?.budgetId));
    const accountIsPrivate = accountDefaultBudget?.type === 'personal';
    // Utlegg = a shared expense paid with private money
    const showUtlegg = kind === KIND.purchase && isSharedTarget && accountIsPrivate;
    const budgetProjects = allProjects.filter(p => !p.budgetId || p.budgetId === selectedBudgetId);
    const selectedProject = allProjects.find(p => p.id === selectedProjectId) || null;
    const selectedProjectSubcats = selectedProject?.subcategories || [];
    const projectHoldsOut = !!selectedProject?.excludeFromSharedCalc;
    const projectCoverAccount = projectHoldsOut && selectedProject.coveredByAccountId
        ? accounts.find(a => a.id === selectedProject.coveredByAccountId) : null;
    const eligibleDefs = budgetItemDefs
        .filter(d => d.scope === 'both' || d.scope === scope)
        .sort((a, b) => catName(a.categoryId).localeCompare(catName(b.categoryId), 'no-NO') || a.name.localeCompare(b.name, 'no-NO'));
    const selectedDef = budgetItemDefs.find(d => d.id === selectedBudgetItemId) || null;

    // --- refund ---
    const refundInfo = refundStatus(liveTx, allTransactions);
    const linkedRefunds = refundsOf(liveTx, allTransactions);
    const outstandingRefund = Math.max(0, refundInfo.expected - refundInfo.refunded);
    const refundOriginal = liveTx.isRefund && liveTx.refundOfTransactionId ? allTransactions.find(t => t.id === liveTx.refundOfTransactionId) : null;
    const refundSplitChildren = liveTx.refundSplit ? allTransactions.filter(t => t.refundParentId === liveTx.id) : [];
    const existingRefundLink = !!(liveTx.isRefund && (liveTx.refundOfTransactionId || liveTx.refundSplit));
    // Income side: earlier purchases the payment can be a refund of
    const refundCandidates = isIncome
        ? allTransactions
            .filter(t => t.type === 'expense' && t.date <= currentTransaction.date)
            .filter(t => !refundSearch || t.name.toLowerCase().includes(refundSearch.toLowerCase()))
            .sort((a, b) => {
                const rank = (t) =>
                    (t.awaitingRefund ? -10 : 0) +
                    (t.accountId === currentTransaction.accountId ? 0 : 4) +
                    (t.amount === currentTransaction.amount ? 0 : t.amount > currentTransaction.amount ? 1 : 2);
                return rank(a) - rank(b) || b.date.localeCompare(a.date);
            })
            .slice(0, 30)
        : [];
    // Purchase side: incoming payments that can be its refund
    const incomingCandidates = isExpense
        ? allTransactions
            .filter(t => t.type === 'income' && !t.isRefund && t.date >= currentTransaction.date && !isKindCategory(t))
            .filter(t => !incomingSearch || t.name.toLowerCase().includes(incomingSearch.toLowerCase()))
            .sort((a, b) => Math.abs(a.amount - outstandingRefund) - Math.abs(b.amount - outstandingRefund) || a.date.localeCompare(b.date))
            .slice(0, 30)
        : [];
    const allocIncome = isIncome ? currentTransaction : (allTransactions.find(t => t.id === selectedIncomingId) || null);
    const splitCandidates = allocIncome
        ? allTransactions
            .filter(t => t.type === 'expense' && t.date <= allocIncome.date)
            .sort((a, b) => (b.awaitingRefund ? 1 : 0) - (a.awaitingRefund ? 1 : 0) || b.date.localeCompare(a.date))
        : [];
    const toggleAllocation = (t) => {
        if (allocations.some(a => a.transactionId === t.id)) {
            setAllocations(allocations.filter(a => a.transactionId !== t.id));
            return;
        }
        const info = refundStatus(t, allTransactions);
        const want = t.awaitingRefund ? Math.max(0, info.expected - info.refunded) : t.amount;
        const room = Math.max(0, (allocIncome?.amount || 0) - allocations.reduce((sum, a) => sum + parseAmount(a.amount), 0));
        const amount = room > 0 ? Math.min(want, room) : want;
        setAllocations([...allocations, { transactionId: t.id, amount: String(Math.round(amount * 100) / 100), complete: null }]);
    };
    const allocationsOk = !!allocIncome && allocationsValid(allocations, allocIncome.amount);

    // --- gjennomreise ---
    const storedCovered = isCoveredExpense(liveTx);
    const covering = isIncome && isCoveringIncome(liveTx, allTransactions);
    const coverGroup = (storedCovered || covering) ? coverGroupOf(liveTx, allTransactions) : null;
    const coverIncomesStored = storedCovered ? coveringIncomesOf(liveTx, allTransactions) : [];
    const coverExpensesStored = covering ? expensesCoveredBy(liveTx, allTransactions) : [];
    // What the links will be after save (stored minus removed plus added)
    const coverIncomeIdsAfter = [...coverLinkIds(liveTx).filter(id => !coverRemove.includes(id)), ...coverAdd];
    const coverExpensesAfter = [
        ...coverExpensesStored.filter(e => !coverRemove.includes(e.id)),
        ...coverAdd.map(id => allTransactions.find(t => t.id === id)).filter(Boolean),
    ];
    const coverRemaining = coverGroup ? Math.max(0, coverGroup.out - coverGroup.in) : liveTx.amount;
    const rankNear = (t, targetAmount) => (a, b) =>
        (a.accountId === t.accountId ? 0 : 1) - (b.accountId === t.accountId ? 0 : 1) ||
        daysBetween(a.date, t.date) - daysBetween(b.date, t.date) ||
        Math.abs(a.amount - targetAmount) - Math.abs(b.amount - targetAmount);
    const matchesSearch = (t) => !coverSearch || t.name.toLowerCase().includes(coverSearch.toLowerCase());
    const coverIncomeCandidates = isExpense && coveredByIncoming && coverMode
        ? allTransactions
            .filter(t => t.type === 'income' && !t.isRefund && !t.refundSplit && !isSalary(t) && !coverIncomeIdsAfter.includes(t.id))
            .filter(matchesSearch)
            .sort(rankNear(liveTx, coverRemaining || liveTx.amount))
            .slice(0, 30)
        : [];
    const coverExpenseCandidates = isIncome && kind === KIND.passthrough && coverMode
        ? allTransactions
            .filter(t => t.type === 'expense' && !t.refundSplit && !coverExpensesAfter.some(e => e.id === t.id))
            .filter(matchesSearch)
            .sort(rankNear(liveTx, liveTx.amount))
            .slice(0, 30)
        : [];
    const stageCoverAdd = (id) => {
        if (coverRemove.includes(id)) setCoverRemove(coverRemove.filter(x => x !== id));
        else if (!coverAdd.includes(id)) setCoverAdd([...coverAdd, id]);
        setCoverMode(false);
        setCoverSearch('');
    };
    const stageCoverRemove = (id) => {
        if (coverAdd.includes(id)) setCoverAdd(coverAdd.filter(x => x !== id));
        else if (!coverRemove.includes(id)) setCoverRemove([...coverRemove, id]);
    };

    // --- what «Lagre» will do ---
    const reconcilesNow = reconcilesOnLink({ ...currentTransaction, currency: currency || null });
    const canSave = !saving && !!tempDate && !!kind && (
        kind === KIND.purchase ? !!(selectedBudgetItemId && selectedBudgetId) :
        kind === KIND.refund ? (existingRefundLink || allocationsOk || refundUnlinked) :
        kind === KIND.passthrough ? coverExpensesAfter.length > 0 :
        true
    );
    const summaryParts = (() => {
        const parts = [];
        if (!kind) { parts.push('Velg hva dette er'); return parts; }
        if (kind === KIND.purchase) {
            parts.push(selectedDef ? `${kindLabelFor(kind, currentTransaction.type)} → ${selectedBudget?.name || 'budsjett'} › ${catName(selectedDef.categoryId)} › ${selectedDef.name}` : `${kindLabelFor(kind, currentTransaction.type)} → velg budsjettpost`);
            if (selectedProject) parts.push(`prosjekt ${selectedProject.name}${selectedProjectSubcategory ? ` / ${selectedProjectSubcategory}` : ''}`);
            if (!reconcilesNow) parts.push('bokføres, venter på bankens kopi');
        } else if (kind === KIND.refund) {
            if (existingRefundLink) parts.push(liveTx.refundSplit ? `Refusjon fordelt på ${refundSplitChildren.length} kjøp` : `Refusjon av ${refundOriginal?.name || 'kjøp'}`);
            else if (allocations.length > 1) parts.push(`Refusjon fordelt på ${allocations.length} kjøp`);
            else if (allocations.length === 1) parts.push(`Refusjon av ${allTransactions.find(t => t.id === allocations[0].transactionId)?.name || 'kjøp'}`);
            else if (refundUnlinked) parts.push('Refusjon uten kobling til kjøp');
            else parts.push('Refusjon → velg kjøpet');
        } else if (kind === KIND.passthrough) {
            parts.push(coverExpensesAfter.length > 0 ? `Gjennomreise → dekker ${coverExpensesAfter.length === 1 ? coverExpensesAfter[0].name : `${coverExpensesAfter.length} overføringer`}` : 'Gjennomreise → velg overføringen');
        } else {
            parts.push(kindLabelFor(kind, currentTransaction.type));
        }
        if (kind === KIND.purchase) {
            if (excludeFromSharedCalc || projectHoldsOut) parts.push(`utenfor oppgjør${(excludeFromSharedCalc ? coveredByAccountId : projectCoverAccount?.id) ? `, betales fra ${accountName(excludeFromSharedCalc ? coveredByAccountId : projectCoverAccount.id)}` : ''}`);
            if (showUtlegg && asUtlegg) parts.push('utlegg');
            if (isUnnecessary) parts.push('unødvendig');
            if (isExpense && awaitingRefund && !markRefundComplete) parts.push(`venter refusjon${expectedRefundAmount ? ` ${fmtKr(parseAmount(expectedRefundAmount))} kr` : ''}`);
            if (isExpense && markRefundComplete) parts.push('ferdig refundert');
            if (isExpense && selectedIncomingId && allocationsOk) parts.push(`kobler ${allocIncome.name}`);
        }
        if (isExpense && coveredByIncoming) parts.push(`gjennomreise${coverIncomeIdsAfter.length === 0 ? ' (innbetaling mangler)' : coverAdd.length ? ` (+${coverAdd.length} innbetaling)` : ''}`);
        if (tempDate && tempDate !== currentTransaction.date) parts.push(`dato ${tempDate}`);
        if (currency) parts.push(`beløp i ${currency}`);
        if (comment.trim()) parts.push('kommentar');
        return parts;
    })();

    const advance = (idsJustHandled) => {
        if (isEdit) { onComplete(); return; }
        const handled = new Set(handledIds);
        idsJustHandled.forEach(id => handled.add(id));
        setHandledIds(handled);
        setProcessedCount(prev => prev + idsJustHandled.length);
        const nextIdx = transactions.findIndex(t => !handled.has(t.id));
        if (nextIdx === -1) onComplete();
        else setCurrentIndex(nextIdx);
    };

    // ONE save for every kind. `overrides` lets the suggestion card and the
    // «ny budsjettpost» dialog save without waiting for a state round-trip.
    const save = async (overrides = {}) => {
        const k = overrides.kind ?? kind;
        const tx = currentTransaction;
        if (!k || saving) return;
        if (liveTx.refundSplit && k !== KIND.refund) {
            alert('Innbetalingen er fordelt på flere kjøp. Fjern fordelingen først, så kan den lagres som noe annet.');
            return;
        }
        setSaving(true);
        try {
            const purchase = k === KIND.purchase;
            const keepInherited = k === KIND.refund && existingRefundLink; // a linked refund mirrors its purchase
            const common = {
                budgetId: selectedBudgetId || tx.budgetId || null,
                comment: comment,
                date: tempDate, month: tempDate.slice(0, 7),
                currency: currency || null,
                ...(keepInherited ? {} : {
                    isUnnecessary: purchase && isUnnecessary,
                    excludeFromSharedCalc: purchase && excludeFromSharedCalc,
                    coveredByAccountId: purchase && excludeFromSharedCalc ? (coveredByAccountId || null) : null,
                    projectId: purchase ? (selectedProjectId || null) : null,
                    projectSubcategory: purchase && selectedProjectId ? (selectedProjectSubcategory || null) : null,
                    paidPrivatelyBy: purchase && showUtlegg && asUtlegg ? 'self' : null,
                    awaitingRefund: purchase && isExpense && awaitingRefund && !markRefundComplete,
                    expectedRefundAmount: purchase && isExpense && awaitingRefund && !markRefundComplete && expectedRefundAmount !== ''
                        ? (parseAmount(expectedRefundAmount) || null) : null,
                }),
            };
            // Leaving a reserved category behind (a row that was «Lønn» and
            // becomes a purchase) would keep counting it as salary.
            const clearKindCategory = isKindCategory(tx) ? { category: null } : {};

            if (purchase) {
                const defId = overrides.defId ?? selectedBudgetItemId;
                let instId = overrides.instId;
                if (!instId) {
                    const def = budgetItemDefs.find(d => d.id === defId);
                    if (!def) throw new Error('Velg en budsjettpost');
                    instId = await ensureInstanceForDef(def, common.budgetId);
                }
                await updateTransaction(tx.id, {
                    ...common, ...clearKindCategory,
                    budgetItemId: instId,
                    reconciled: !!tx.reconciled || reconcilesNow,
                    isRefund: false, refundOfTransactionId: null,
                });
            } else if (k === KIND.refund) {
                await updateTransaction(tx.id, common);
                if (!existingRefundLink) {
                    if (allocationsOk) {
                        const allocs = allocations.map(a => ({
                            transactionId: a.transactionId,
                            amount: parseAmount(a.amount),
                            complete: allocationComplete(a, allTransactions.find(t => t.id === a.transactionId), allTransactions),
                        }));
                        if (allocs.length === 1) await linkRefund(tx.id, allocs[0].transactionId, { complete: allocs[0].complete });
                        else await linkRefundSplit(tx.id, allocs);
                    } else if (refundUnlinked) {
                        await updateTransaction(tx.id, { category: KIND_CATEGORY.refund, isRefund: true, refundOfTransactionId: null, reconciled: true, budgetItemId: null });
                    }
                }
            } else if (k === KIND.passthrough) {
                await updateTransaction(tx.id, { ...common, ...clearKindCategory, isRefund: false, refundOfTransactionId: null, budgetItemId: null });
                if (coverAdd.length || coverRemove.length) await setIncomeCover(tx.id, { add: coverAdd, remove: coverRemove });
            } else {
                await updateTransaction(tx.id, {
                    ...common,
                    category: KIND_CATEGORY[k],
                    ...(k === KIND.salary ? { type: 'income' } : {}),
                    // A row that already is this kind may also sit on a budget
                    // line (e.g. «Sparing» linked to «Fast sparing»); an
                    // unchanged kind keeps that, a changed one drops it.
                    reconciled: true, budgetItemId: storedKind === k ? (tx.budgetItemId || null) : null,
                    isRefund: false, refundOfTransactionId: null,
                });
            }

            // Expense-side gjennomreise and the refund link from the purchase
            // side ride along whichever kind was chosen.
            if (isExpense) {
                const flagChanged = coveredByIncoming !== storedCovered;
                if (flagChanged || coverAdd.length || coverRemove.length) await setExpenseCover(tx.id, coveredByIncoming, coverIncomeIdsAfter);
                if (purchase && selectedIncomingId && allocationsOk) {
                    const allocs = allocations.map(a => ({
                        transactionId: a.transactionId,
                        amount: parseAmount(a.amount),
                        complete: allocationComplete(a, allTransactions.find(t => t.id === a.transactionId), allTransactions),
                    }));
                    if (allocs.length === 1) await linkRefund(allocIncome.id, allocs[0].transactionId, { complete: allocs[0].complete });
                    else await linkRefundSplit(allocIncome.id, allocs);
                }
            }
            advance([tx.id]);
        } catch (error) {
            console.error('Failed to save transaction', error);
            alert(error?.message || 'Kunne ikke lagre.');
        } finally {
            setSaving(false);
        }
    };

    const handleNewBudgetItem = async ({ name, categoryId, newCategoryName, scope: newScope, amount }) => {
        let catId = categoryId;
        if (!catId && newCategoryName) {
            const c = await addCategory(newCategoryName);
            catId = c.id;
        }
        const def = await addBudgetItemDef({ name, categoryId: catId, scope: newScope });
        const instId = await ensureInstanceForDef(def, selectedBudgetId, amount);
        setIsAddOpen(false);
        setKind(KIND.purchase);
        setSelectedBudgetItemId(def.id);
        await save({ kind: KIND.purchase, defId: def.id, instId });
    };

    const handleUnlinkRefund = async (row) => {
        const isSplit = !!(row.refundParentId || row.refundSplit);
        if (!window.confirm(isSplit
            ? 'Denne innbetalingen er fordelt på flere kjøp. Fjerne hele fordelingen? Innbetalingen blir uavstemt igjen. Skjer med en gang.'
            : 'Fjerne koblingen? Innbetalingen blir uavstemt igjen. Skjer med en gang.')) return;
        try { await unlinkRefund(row.id); }
        catch (error) {
            console.error('Failed to unlink refund', error);
            alert('Kunne ikke fjerne koblingen.');
        }
    };

    const handleAcceptAllSuggestions = async () => {
        if (remainingWithSuggestions.length === 0) return;
        setBulkSaving(true);
        try {
            await Promise.all(remainingWithSuggestions.map(t => updateTransaction(t.id, {
                budgetItemId: suggestions[t.id].budgetItemId,
                reconciled: !!t.reconciled || reconcilesOnLink(t),
                ...(isKindCategory(t) ? { category: null } : {}),
            })));
            advance(remainingWithSuggestions.map(t => t.id));
        } catch (error) {
            console.error('Failed to bulk-accept suggestions', error);
            alert('Kunne ikke godta alle forslagene.');
        } finally {
            setBulkSaving(false);
        }
    };

    // Enter saves, unless the focus is somewhere Enter means something else
    const onKeyDown = (e) => {
        if (e.key !== 'Enter' || !canSave || isAddOpen) return;
        const tag = e.target.tagName;
        const type = e.target.type;
        if (tag === 'TEXTAREA' || tag === 'BUTTON' || tag === 'SELECT' || tag === 'A' || e.target.getAttribute?.('role') === 'button' || (tag === 'INPUT' && (type === 'text' || type === 'search' || type === 'checkbox'))) return;
        e.preventDefault();
        save();
    };

    const kinds = kindsForType(currentTransaction.type);
    const activeAdjustments = [
        kind === KIND.purchase && (excludeFromSharedCalc || projectHoldsOut) && 'Utenfor oppgjør',
        kind === KIND.purchase && showUtlegg && asUtlegg && 'Utlegg',
        kind === KIND.purchase && isUnnecessary && 'Unødvendig',
        kind === KIND.purchase && isExpense && awaitingRefund && !markRefundComplete && 'Venter refusjon',
        kind === KIND.purchase && isExpense && (!awaitingRefund || markRefundComplete) && linkedRefunds.length > 0 && 'Refundert',
        isExpense && coveredByIncoming && 'Gjennomreise',
        comment.trim() && 'Kommentar',
        currency && currency,
    ].filter(Boolean);
    const showSuggestionCard = !!currentSuggestion && !storedKind && !!suggestedDefId;
    const suggestionInst = currentSuggestion ? expenses.find(e => e.id === currentSuggestion.budgetItemId) : null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/50 backdrop-blur-sm" onKeyDown={onKeyDown}>
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-lg md:max-w-2xl overflow-hidden animate-in fade-in zoom-in duration-200 flex flex-col max-h-[90vh]">
                {/* Header */}
                <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between bg-gray-50 dark:bg-gray-800/50">
                    <div>
                        <h2 className="text-lg font-bold text-gray-900 dark:text-white">{isEdit ? 'Rediger transaksjon' : 'Avstem transaksjoner'}</h2>
                        <p className="text-sm text-gray-500 dark:text-gray-400">
                            {isEdit
                                ? (storedKind ? `I dag: ${KIND_EMOJI[storedKind]} ${kindLabelFor(storedKind, currentTransaction.type)}` : 'Ikke avstemt ennå')
                                : `Transaksjon ${currentIndex + 1} av ${transactions.length}`}
                        </p>
                    </div>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"><X className="w-5 h-5" /></button>
                </div>

                <div className="p-4 md:p-6 overflow-y-auto space-y-6">
                    {/* Transaction card */}
                    <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800 rounded-xl p-4">
                        <div className="flex justify-between items-start gap-3">
                            <div className="min-w-0">
                                {isEditingDate ? (
                                    <div className="flex items-center gap-2 mb-1">
                                        <input type="date" value={tempDate} onChange={(e) => setTempDate(e.target.value)} className={inputCls} />
                                        <button onClick={() => setIsEditingDate(false)} className="p-1 text-green-600 hover:bg-green-100 rounded dark:hover:bg-green-900/30" title="Ferdig (lagres med Lagre)"><Check className="w-4 h-4" /></button>
                                        <button onClick={() => { setTempDate(currentTransaction.date); setIsEditingDate(false); }} className="p-1 text-red-600 hover:bg-red-100 rounded dark:hover:bg-red-900/30" title="Angre"><X className="w-4 h-4" /></button>
                                    </div>
                                ) : (
                                    <button onClick={() => setIsEditingDate(true)} className="flex items-center group text-sm text-blue-600 dark:text-blue-400 font-medium mb-1" title="Endre dato">
                                        {tempDate}{tempDate !== currentTransaction.date && <span className="ml-1 text-xs text-amber-600">(endret)</span>}
                                        <Edit2 className="w-3 h-3 ml-2 text-blue-400 opacity-50 group-hover:opacity-100 transition-opacity" />
                                    </button>
                                )}
                                <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100 break-words">{currentTransaction.name}</h3>
                                <p className="text-xs text-gray-500 mt-1 flex items-center gap-2 flex-wrap">
                                    {account && <span className="flex items-center gap-1"><CreditCard className="w-3 h-3" />{account.name}</span>}
                                    {currentTransaction.category && !isKindCategory(currentTransaction) && <span>· {currentTransaction.category}</span>}
                                    {liveTx.source === 'companion_app' && <span>· fra companion-appen</span>}
                                </p>
                            </div>
                            <div className="text-right flex-shrink-0">
                                <span className={clsx("text-2xl font-bold", isIncome ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400")}>
                                    {isIncome ? '+' : '-'}{currentTransaction.amount.toLocaleString('no-NO')} {currency || 'kr'}
                                </span>
                                {currency && <p className="text-[11px] text-sky-600 dark:text-sky-400 max-w-[160px] ml-auto">Omtrentlig — bankimporten foreslår kobling til NOK-beløpet</p>}
                            </div>
                        </div>
                    </div>

                    <TransactionReceipt transaction={currentTransaction} />

                    {/* 1. Hva er dette? */}
                    <section className="space-y-3">
                        <div className="flex items-center justify-between">
                            <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100">1. Hva er dette?</h4>
                            <button onClick={() => setShowGuide(v => !v)} className="text-xs text-gray-500 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 flex items-center gap-1">
                                <HelpCircle className="w-3.5 h-3.5" />Hvilken passer?
                            </button>
                        </div>
                        {showGuide && (
                            <ul className="text-xs text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-700/40 rounded-lg p-3 space-y-1">
                                {kinds.map(k => <li key={k}><span className="font-medium text-gray-800 dark:text-gray-200">{KIND_EMOJI[k]} {kindLabelFor(k, currentTransaction.type)}:</span> {KIND_HELP[k]}</li>)}
                                {isExpense && <li><span className="font-medium text-gray-800 dark:text-gray-200">🔃 Gjennomreise (under Flere valg):</span> {KIND_HELP.passthrough}</li>}
                            </ul>
                        )}

                        {showSuggestionCard && (
                            <div className="rounded-xl border border-purple-200 dark:border-purple-800 bg-purple-50 dark:bg-purple-900/20 p-3 flex items-center justify-between gap-3">
                                <div className="min-w-0 text-sm">
                                    <p className="font-medium text-purple-800 dark:text-purple-200 flex items-center gap-1.5"><Sparkles className="w-4 h-4 flex-shrink-0" />Foreslått: {suggestionInst?.category} › {suggestionInst?.name}</p>
                                    <p className="text-xs text-purple-700 dark:text-purple-300">Tidligere avstemt som «{currentSuggestion.matchedName}»{currentSuggestion.matchType === 'similar' ? ' (lignende navn)' : ''}. Enter godtar.</p>
                                </div>
                                <button onClick={() => save({ kind: KIND.purchase, defId: suggestedDefId })} disabled={saving} className="px-3 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-300 text-white text-sm font-medium rounded-lg whitespace-nowrap flex items-center gap-1.5">
                                    <Check className="w-4 h-4" />Godta{!isEdit && ' og neste'}
                                </button>
                            </div>
                        )}
                        {!isEdit && remainingWithSuggestions.length > 1 && (
                            <button onClick={handleAcceptAllSuggestions} disabled={bulkSaving} className="w-full flex items-center justify-center gap-2 py-2 border border-purple-300 dark:border-purple-700 text-purple-700 dark:text-purple-300 hover:bg-purple-50 dark:hover:bg-purple-900/20 disabled:opacity-50 text-sm font-medium rounded-lg transition-colors">
                                <Sparkles className="w-4 h-4" />{bulkSaving ? 'Godtar forslag...' : `Godta alle ${remainingWithSuggestions.length} forslag i køen`}
                            </button>
                        )}

                        <div className="flex flex-wrap gap-2">
                            {kinds.map(k => (
                                <button key={k} onClick={() => { setKind(k); if (k !== KIND.passthrough) setCoverMode(false); }} className={clsx(
                                    "px-3 py-2 rounded-lg text-sm font-medium border transition-colors flex items-center gap-1.5",
                                    kind === k
                                        ? "bg-blue-600 border-blue-600 text-white"
                                        : "bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:border-blue-400"
                                )}>
                                    <span>{KIND_EMOJI[k]}</span>{kindLabelFor(k, currentTransaction.type)}
                                </button>
                            ))}
                        </div>
                    </section>

                    {/* 2. Detaljer */}
                    {kind && (
                        <section className="space-y-3">
                            <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100">2. Detaljer</h4>

                            {kind === KIND.purchase && (
                                <div className="space-y-3">
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                        <label className="block text-sm">
                                            <span className="text-gray-700 dark:text-gray-300 font-medium flex items-center gap-1.5"><Wallet className="w-4 h-4" /> Budsjett
                                                <InfoTip text="Felles eller privat. Settes fra kontoens standardbudsjett, men kan overstyres per transaksjon." />
                                            </span>
                                            <select value={selectedBudgetId} onChange={(e) => { setSelectedBudgetId(e.target.value); setSelectedBudgetItemId(''); setSelectedProjectId(''); setSelectedProjectSubcategory(''); }} className={clsx(inputCls, "w-full mt-1 py-2")}>
                                                {budgets.map(b => <option key={b.id} value={b.id}>{b.name} ({b.type === 'shared' ? 'felles' : 'privat'})</option>)}
                                            </select>
                                        </label>
                                        <label className="block text-sm">
                                            <span className="text-gray-700 dark:text-gray-300 font-medium">Budsjettpost</span>
                                            <select value={selectedBudgetItemId} onChange={(e) => setSelectedBudgetItemId(e.target.value)} className={clsx(inputCls, "w-full mt-1 py-2")}>
                                                <option value="">-- Velg budsjettpost --</option>
                                                {eligibleDefs.map(def => <option key={def.id} value={def.id}>{catName(def.categoryId)} — {def.name}</option>)}
                                            </select>
                                        </label>
                                    </div>
                                    {currentSuggestion && selectedBudgetItemId === suggestedDefId && !showSuggestionCard && (
                                        <p className="text-xs text-purple-600 dark:text-purple-400 flex items-center gap-1.5"><Sparkles className="w-3.5 h-3.5 flex-shrink-0" />Foreslått fra tidligere avstemming</p>
                                    )}
                                    <button onClick={() => setIsAddOpen(true)} className="w-full py-2 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg text-gray-500 dark:text-gray-400 text-sm font-medium hover:border-blue-400 hover:text-blue-600 dark:hover:text-blue-400 transition-all flex items-center justify-center">
                                        <Plus className="w-4 h-4 mr-1.5" />Opprett ny budsjettpost
                                    </button>
                                    {budgetProjects.length > 0 && (
                                        <div className="flex items-center gap-2">
                                            <FolderKanban className="w-4 h-4 text-blue-500 flex-shrink-0" />
                                            <select value={selectedProjectId} onChange={e => { setSelectedProjectId(e.target.value); setSelectedProjectSubcategory(''); }} className={clsx(inputCls, "flex-1")}>
                                                <option value="">Ingen prosjekt</option>
                                                {budgetProjects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                                            </select>
                                            {selectedProjectId && selectedProjectSubcats.length > 0 && (
                                                <select value={selectedProjectSubcategory} onChange={e => setSelectedProjectSubcategory(e.target.value)} className={clsx(inputCls, "flex-1")}>
                                                    <option value="">Ingen underkategori</option>
                                                    {selectedProjectSubcats.map(s => <option key={s} value={s}>{s}</option>)}
                                                </select>
                                            )}
                                            <InfoTip text="Kjøpet telles også i prosjektregnskapet, i tillegg til budsjettet." />
                                        </div>
                                    )}
                                    {projectHoldsOut && (
                                        <p className="text-xs text-gray-600 dark:text-gray-400">Prosjektet «{selectedProject.name}» holder alle sine kjøp utenfor oppgjør{projectCoverAccount ? `, betales fra ${projectCoverAccount.name}` : ''}. Endres på prosjektet.</p>
                                    )}
                                </div>
                            )}

                            {kind === KIND.refund && (
                                <div className="border border-teal-200 dark:border-teal-800 rounded-xl p-3 space-y-2 bg-teal-50/50 dark:bg-teal-900/10">
                                    {existingRefundLink ? (
                                        <>
                                            <p className="text-sm text-teal-800 dark:text-teal-200 flex items-center gap-1.5"><Undo2 className="w-4 h-4" />{liveTx.refundSplit ? `Fordelt på ${refundSplitChildren.length} kjøp` : `Refusjon av ${refundOriginal?.name || 'kjøp'}${refundOriginal ? ` (${refundOriginal.date})` : ''}`}</p>
                                            {liveTx.refundSplit && refundSplitChildren.map(c => {
                                                const orig = allTransactions.find(t => t.id === c.refundOfTransactionId);
                                                return <p key={c.id} className="text-xs text-gray-600 dark:text-gray-400 px-1">{fmtKr(c.amount)} kr → {orig?.name || 'kjøp'}</p>;
                                            })}
                                            <button onClick={() => handleUnlinkRefund(liveTx)} className="text-xs text-gray-500 dark:text-gray-400 hover:text-red-600">Fjern koblingen (skjer med en gang)</button>
                                        </>
                                    ) : (
                                        <>
                                            <p className="text-xs text-gray-600 dark:text-gray-400">Velg kjøpet, eller kjøpene, innbetalingen dekker. Refusjonen arver budsjettpost fra kjøpet, så beløpene nettes, også på tvers av måneder. Kjøp som venter refusjon ligger øverst.</p>
                                            <input type="text" value={refundSearch} onChange={(e) => setRefundSearch(e.target.value)} placeholder="Søk i tidligere kjøp..." className={searchCls} />
                                            <div className={listCls}>
                                                {refundCandidates.length === 0 && <p className="p-3 text-sm text-gray-500 dark:text-gray-400">Ingen tidligere kjøp funnet.</p>}
                                                {refundCandidates.map(t => {
                                                    const picked = allocations.some(a => a.transactionId === t.id);
                                                    return (
                                                        <button key={t.id} onClick={() => { toggleAllocation(t); setRefundUnlinked(false); }} className={clsx("w-full text-left px-3 py-2 flex items-center justify-between gap-2 text-sm transition-colors", picked ? "bg-teal-100 dark:bg-teal-900/40" : "hover:bg-gray-50 dark:hover:bg-gray-700/50")}>
                                                            <span className="min-w-0">
                                                                <span className="block font-medium text-gray-900 dark:text-gray-100 truncate">{picked ? '✓ ' : ''}{t.name}</span>
                                                                <span className="block text-xs text-gray-500 dark:text-gray-400">{t.date}{accountName(t.accountId) ? ` • ${accountName(t.accountId)}` : ''}</span>
                                                                {t.awaitingRefund && (() => { const info = refundStatus(t, allTransactions); return (
                                                                    <span className="inline-flex items-center gap-1 mt-0.5 px-1.5 py-0.5 rounded bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-300 text-[10px] font-bold uppercase tracking-wider">Venter refusjon · {fmtKr(info.refunded)} av {fmtKr(info.expected)} kr</span>
                                                                ); })()}
                                                            </span>
                                                            <span className="font-semibold text-red-600 dark:text-red-400 whitespace-nowrap">-{fmtKr(t.amount)} kr</span>
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                            {allocations.length > 0 && (
                                                <RefundAllocationEditor income={currentTransaction} allocations={allocations} onChange={setAllocations} candidates={splitCandidates} allTransactions={allTransactions} accounts={accounts} />
                                            )}
                                            <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400">
                                                <input type="checkbox" checked={refundUnlinked} onChange={(e) => { setRefundUnlinked(e.target.checked); if (e.target.checked) setAllocations([]); }} className="w-3.5 h-3.5 rounded" />
                                                Fant ikke kjøpet — registrer som refusjon uten kobling
                                            </label>
                                        </>
                                    )}
                                </div>
                            )}

                            {kind === KIND.passthrough && (
                                <div className={clsx("border rounded-xl p-3 space-y-2", coverGroup && coverGroup.status !== 'ok' && coverAdd.length === 0 ? "border-red-300 dark:border-red-800 bg-red-50/60 dark:bg-red-900/10" : "border-emerald-200 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-900/10")}>
                                    <p className="text-xs text-gray-600 dark:text-gray-400">Velg overføringen, eller overføringene, denne innbetalingen finansierer. Begge sider holdes utenfor oppgjør og overføringsberegninger.</p>
                                    {coverGroup && <p className="text-xs font-medium text-gray-700 dark:text-gray-300 flex items-center gap-1.5">{coverGroup.status === 'ok' ? <ArrowLeftRight className="w-3.5 h-3.5" /> : <AlertTriangle className="w-3.5 h-3.5 text-red-600" />}I dag: {coverStatusText(coverGroup)}</p>}
                                    {coverExpensesAfter.map(r => (
                                        <div key={r.id} className="flex items-center justify-between gap-2 text-sm bg-white dark:bg-gray-800 rounded-lg px-3 py-1.5 border border-gray-100 dark:border-gray-700">
                                            <span className="min-w-0">
                                                <span className="block truncate text-gray-900 dark:text-gray-100">{r.name}{coverAdd.includes(r.id) && <span className="ml-1 text-xs text-emerald-600">(kobles ved lagring)</span>}</span>
                                                <span className="block text-xs text-gray-500 dark:text-gray-400">{r.date}{accountName(r.accountId) ? ` • ${accountName(r.accountId)}` : ''}</span>
                                            </span>
                                            <span className="flex items-center gap-2 whitespace-nowrap">
                                                <span className="font-semibold text-red-600 dark:text-red-400">-{fmtKr(r.amount)} kr</span>
                                                <button onClick={() => stageCoverRemove(r.id)} title="Fjern koblingen (ved lagring)" className="p-1 text-gray-400 hover:text-red-600 rounded"><X className="w-3.5 h-3.5" /></button>
                                            </span>
                                        </div>
                                    ))}
                                    {coverRemove.length > 0 && <p className="text-xs text-red-600 dark:text-red-400">{coverRemove.length} kobling{coverRemove.length > 1 ? 'er' : ''} fjernes ved lagring.</p>}
                                    <button onClick={() => { setCoverMode(v => !v); setCoverSearch(''); }} className={clsx("w-full py-2 rounded-lg text-sm font-medium transition-colors", coverMode ? "bg-emerald-600 text-white" : "bg-emerald-100 hover:bg-emerald-200 dark:bg-emerald-900/40 text-emerald-800 dark:text-emerald-200")}>
                                        {coverExpensesAfter.length > 0 ? 'Legg til enda en overføring' : 'Finn overføringen'}
                                    </button>
                                    {coverMode && (
                                        <div className="space-y-2">
                                            <input type="text" value={coverSearch} onChange={(e) => setCoverSearch(e.target.value)} placeholder="Søk i utbetalinger (alle måneder)..." className={searchCls} />
                                            <div className={listCls}>
                                                {coverExpenseCandidates.length === 0 && <p className="p-3 text-sm text-gray-500 dark:text-gray-400">Ingen utbetalinger funnet.</p>}
                                                {coverExpenseCandidates.map(t => (
                                                    <button key={t.id} onClick={() => stageCoverAdd(t.id)} className="w-full text-left px-3 py-2 flex items-center justify-between gap-2 text-sm transition-colors hover:bg-emerald-50 dark:hover:bg-emerald-900/20">
                                                        <span className="min-w-0">
                                                            <span className="block font-medium text-gray-900 dark:text-gray-100 truncate">{t.name}</span>
                                                            <span className="block text-xs text-gray-500 dark:text-gray-400">{t.date}{accountName(t.accountId) ? ` • ${accountName(t.accountId)}` : ''}{isCoveredExpense(t) ? (coverLinkIds(t).length ? ' • gjennomreise, delvis dekket' : ' • gjennomreise, venter innbetaling') : ''}</span>
                                                        </span>
                                                        <span className="font-semibold text-red-600 dark:text-red-400 whitespace-nowrap">-{fmtKr(t.amount)} kr</span>
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}

                            {(kind === KIND.salary || kind === KIND.savings || kind === KIND.transfer || kind === KIND.creditCardBill) && (
                                <p className="text-sm text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-700/40 rounded-lg p-3">{KIND_HELP[kind]}{kind === KIND.savings || kind === KIND.salary ? ' Erstatter et eventuelt foreløpig beløp for måneden på Min Oversikt.' : ''}</p>
                            )}
                        </section>
                    )}

                    {/* 3. Flere valg */}
                    {kind && (
                        <section className="space-y-3">
                            <button onClick={() => setShowMore(v => !v)} className="w-full flex items-center justify-between text-left">
                                <span className="text-sm font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2 flex-wrap">3. Flere valg
                                    {activeAdjustments.map(a => <span key={a} className="px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 text-[10px] font-bold uppercase tracking-wider">{a}</span>)}
                                </span>
                                {showMore ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
                            </button>
                            {showMore && (
                                <div className="space-y-3 pl-1">
                                    {kind === KIND.purchase && (
                                        <>
                                            <label className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-300">
                                                <input type="checkbox" checked={excludeFromSharedCalc || projectHoldsOut} disabled={projectHoldsOut} onChange={(e) => setExcludeFromSharedCalc(e.target.checked)} className="w-4 h-4 mt-0.5 rounded disabled:opacity-60" />
                                                <span>Holdes utenfor oppgjør 🚫
                                                    <InfoTip text={isSharedTarget
                                                        ? 'Telles mot budsjettposten, men ingen skylder noe for det i oppgjøret mellom dere.'
                                                        : 'Telles mot budsjettposten, men holdes utenfor overføringsberegningen på Min Oversikt (kortbruk / påfyll av regningskonto).'} />
                                                    {excludeFromSharedCalc && !projectHoldsOut && (
                                                        <span className="block mt-1">
                                                            <span className="text-xs text-gray-500 dark:text-gray-400 mr-2">Betales fra</span>
                                                            <select value={coveredByAccountId} onChange={e => setCoveredByAccountId(e.target.value)} className={inputCls}>
                                                                <option value="">ingen annen konto</option>
                                                                {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                                                            </select>
                                                        </span>
                                                    )}
                                                </span>
                                            </label>
                                            {showUtlegg && (
                                                <label className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-300">
                                                    <input type="checkbox" checked={asUtlegg} onChange={(e) => setAsUtlegg(e.target.checked)} className="w-4 h-4 mt-0.5 rounded" />
                                                    <span>Utlegg — jeg la ut med egne penger
                                                        <InfoTip text="En felles utgift betalt fra privat konto. Beløpet trekkes fra det du skal overføre til felleskontoen." />
                                                    </span>
                                                </label>
                                            )}
                                            <label className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-300">
                                                <input type="checkbox" checked={isUnnecessary} onChange={(e) => setIsUnnecessary(e.target.checked)} className="w-4 h-4 mt-0.5 rounded" />
                                                <span>Unødvendig kjøp 💸 <InfoTip text="Ren merkelapp for egen bevisstgjøring. Telles helt som normalt." /></span>
                                            </label>
                                            {isExpense && (
                                                <div className="space-y-2">
                                                    <label className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-300">
                                                        <input type="checkbox" checked={awaitingRefund} onChange={(e) => { setAwaitingRefund(e.target.checked); if (!e.target.checked) { setIncomingMode(false); setSelectedIncomingId(''); setAllocations([]); } }} className="w-4 h-4 mt-0.5 rounded" />
                                                        <span>Venter refusjon 🔁
                                                            <InfoTip text="Du la ut, og noen skal betale deg tilbake (Vipps e.l.). Kjøpet telles fullt ut inntil innbetalingen kobles til det — da nettes de. Flere innbetalinger kan kobles til samme kjøp." />
                                                            {awaitingRefund && (
                                                                <span className="block mt-1 flex items-center gap-2 flex-wrap">
                                                                    <span className="text-xs text-gray-500 dark:text-gray-400">Forventet</span>
                                                                    <input type="number" inputMode="decimal" min="0" step="0.01" value={expectedRefundAmount} onChange={(e) => setExpectedRefundAmount(e.target.value)} placeholder={`${currentTransaction.amount} (hele)`} className={clsx(inputCls, "w-32")} />
                                                                    <span className="text-xs text-gray-500 dark:text-gray-400">kr</span>
                                                                </span>
                                                            )}
                                                            {!awaitingRefund && linkedRefunds.length > 0 && (
                                                                <span className="block mt-0.5 text-xs text-gray-500 dark:text-gray-400">Ferdig refundert. Kryss av igjen hvis flere innbetalinger er ventet.</span>
                                                            )}
                                                        </span>
                                                    </label>
                                                    {(liveTx.awaitingRefund || linkedRefunds.length > 0) && (
                                                        <div className="ml-6 border border-teal-200 dark:border-teal-800 rounded-xl p-3 space-y-2 bg-teal-50/50 dark:bg-teal-900/10">
                                                            <p className="text-xs font-medium text-teal-800 dark:text-teal-200 flex items-center gap-1.5 flex-wrap"><Undo2 className="w-3.5 h-3.5" />Refundert {fmtKr(refundInfo.refunded)} av {fmtKr(refundInfo.expected)} kr{refundInfo.over ? ' (overrefundert)' : ''}</p>
                                                            {linkedRefunds.map(r => (
                                                                <div key={r.id} className="flex items-center justify-between gap-2 text-sm bg-white dark:bg-gray-800 rounded-lg px-3 py-1.5 border border-gray-100 dark:border-gray-700">
                                                                    <span className="min-w-0">
                                                                        <span className="block truncate text-gray-900 dark:text-gray-100">{r.name}</span>
                                                                        <span className="block text-xs text-gray-500 dark:text-gray-400">{r.date}{r.refundParentId ? ' • del av en fordelt innbetaling' : ''}</span>
                                                                    </span>
                                                                    <span className="flex items-center gap-2 whitespace-nowrap">
                                                                        <span className="font-semibold text-green-600 dark:text-green-400">+{fmtKr(r.amount)} kr</span>
                                                                        <button onClick={() => handleUnlinkRefund(r)} title="Fjern koblingen (skjer med en gang)" className="p-1 text-gray-400 hover:text-red-600 rounded"><X className="w-3.5 h-3.5" /></button>
                                                                    </span>
                                                                </div>
                                                            ))}
                                                            {liveTx.awaitingRefund && awaitingRefund && (
                                                                <>
                                                                    <label className="flex items-center gap-2 text-xs text-gray-700 dark:text-gray-300">
                                                                        <input type="checkbox" checked={markRefundComplete} onChange={(e) => setMarkRefundComplete(e.target.checked)} className="w-3.5 h-3.5 rounded" />
                                                                        Ferdig refundert — venter ikke på flere innbetalinger
                                                                    </label>
                                                                    <button onClick={() => setIncomingMode(v => !v)} className={clsx("w-full py-2 rounded-lg text-sm font-medium transition-colors", incomingMode ? "bg-teal-600 text-white" : "bg-teal-100 hover:bg-teal-200 dark:bg-teal-900/40 text-teal-800 dark:text-teal-200")}>
                                                                        {selectedIncomingId ? `Kobler ${allocIncome?.name} ved lagring` : 'Finn innbetalingen (Vipps e.l.)'}
                                                                    </button>
                                                                    {incomingMode && (
                                                                        <div className="space-y-2">
                                                                            <input type="text" value={incomingSearch} onChange={(e) => { setIncomingSearch(e.target.value); setSelectedIncomingId(''); setAllocations([]); }} placeholder="Søk i innbetalinger..." className={searchCls} />
                                                                            <div className={listCls}>
                                                                                {incomingCandidates.length === 0 && <p className="p-3 text-sm text-gray-500 dark:text-gray-400">Ingen innbetalinger fra {currentTransaction.date} og utover. Importer fra banken først.</p>}
                                                                                {incomingCandidates.map(t => (
                                                                                    <button key={t.id} onClick={() => { const next = t.id === selectedIncomingId ? '' : t.id; setSelectedIncomingId(next); setAllocations(next ? [{ transactionId: currentTransaction.id, amount: String(Math.round(Math.min(outstandingRefund || t.amount, t.amount) * 100) / 100), complete: null }] : []); }} className={clsx("w-full text-left px-3 py-2 flex items-center justify-between gap-2 text-sm transition-colors", selectedIncomingId === t.id ? "bg-teal-100 dark:bg-teal-900/40" : "hover:bg-gray-50 dark:hover:bg-gray-700/50")}>
                                                                                        <span className="min-w-0">
                                                                                            <span className="block font-medium text-gray-900 dark:text-gray-100 truncate">{t.name}</span>
                                                                                            <span className="block text-xs text-gray-500 dark:text-gray-400">{t.date}{accountName(t.accountId) ? ` • ${accountName(t.accountId)}` : ''}{isHandled(t) ? ` • ${t.category || 'kategorisert'}` : ' • uavstemt'}</span>
                                                                                        </span>
                                                                                        <span className="font-semibold text-green-600 dark:text-green-400 whitespace-nowrap">+{fmtKr(t.amount)} kr</span>
                                                                                    </button>
                                                                                ))}
                                                                            </div>
                                                                            {allocIncome && (
                                                                                <RefundAllocationEditor income={allocIncome} allocations={allocations} onChange={setAllocations} candidates={splitCandidates} allTransactions={allTransactions} accounts={accounts} lockedIds={[currentTransaction.id]} />
                                                                            )}
                                                                        </div>
                                                                    )}
                                                                </>
                                                            )}
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                        </>
                                    )}

                                    {isExpense && (
                                        <div className="space-y-2">
                                            <label className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-300">
                                                <input type="checkbox" checked={coveredByIncoming} onChange={(e) => { setCoveredByIncoming(e.target.checked); setCoverMode(e.target.checked && coverIncomeIdsAfter.length === 0); setCoverSearch(''); }} className="w-4 h-4 mt-0.5 rounded" />
                                                <span>Gjennomreise — dekkes av en innbetaling 🔃
                                                    <InfoTip text="Overføringen er finansiert av en innbetaling på samme konto (f.eks. barnetrygd som går videre til sparing og felleskonto). Begge sider holdes utenfor oppgjør og overføringsberegninger — men bare når innbetalingen faktisk er koblet. Mangler kobling, eller stemmer ikke summene, får du et rødt flagg." />
                                                </span>
                                            </label>
                                            {coveredByIncoming && (
                                                <div className={clsx("ml-6 border rounded-xl p-3 space-y-2", coverGroup && coverGroup.status !== 'ok' && coverAdd.length === 0 ? "border-red-300 dark:border-red-800 bg-red-50/60 dark:bg-red-900/10" : "border-emerald-200 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-900/10")}>
                                                    {coverGroup && <p className="text-xs font-medium text-gray-700 dark:text-gray-300 flex items-center gap-1.5">{coverGroup.status === 'ok' ? <ArrowLeftRight className="w-3.5 h-3.5" /> : <AlertTriangle className="w-3.5 h-3.5 text-red-600" />}I dag: {coverStatusText(coverGroup)}</p>}
                                                    {[...coverIncomesStored.filter(r => !coverRemove.includes(r.id)), ...coverAdd.map(id => allTransactions.find(t => t.id === id)).filter(Boolean)].map(r => (
                                                        <div key={r.id} className="flex items-center justify-between gap-2 text-sm bg-white dark:bg-gray-800 rounded-lg px-3 py-1.5 border border-gray-100 dark:border-gray-700">
                                                            <span className="min-w-0">
                                                                <span className="block truncate text-gray-900 dark:text-gray-100">{r.name}{coverAdd.includes(r.id) && <span className="ml-1 text-xs text-emerald-600">(kobles ved lagring)</span>}</span>
                                                                <span className="block text-xs text-gray-500 dark:text-gray-400">{r.date}{accountName(r.accountId) ? ` • ${accountName(r.accountId)}` : ''}</span>
                                                            </span>
                                                            <span className="flex items-center gap-2 whitespace-nowrap">
                                                                <span className="font-semibold text-green-600 dark:text-green-400">+{fmtKr(r.amount)} kr</span>
                                                                <button onClick={() => stageCoverRemove(r.id)} title="Fjern koblingen (ved lagring)" className="p-1 text-gray-400 hover:text-red-600 rounded"><X className="w-3.5 h-3.5" /></button>
                                                            </span>
                                                        </div>
                                                    ))}
                                                    {coverGroup && coverGroup.expenses.filter(e => e.id !== liveTx.id).map(e => (
                                                        <p key={e.id} className="text-xs text-gray-600 dark:text-gray-400 px-1">Samme innbetaling dekker også: {e.name} ({e.date}) −{fmtKr(e.amount)} kr</p>
                                                    ))}
                                                    <button onClick={() => { setCoverMode(v => !v); setCoverSearch(''); }} className={clsx("w-full py-2 rounded-lg text-sm font-medium transition-colors", coverMode ? "bg-emerald-600 text-white" : "bg-emerald-100 hover:bg-emerald-200 dark:bg-emerald-900/40 text-emerald-800 dark:text-emerald-200")}>
                                                        {coverIncomeIdsAfter.length > 0 ? 'Koble enda en innbetaling' : 'Finn innbetalingen'}
                                                    </button>
                                                    {coverMode && (
                                                        <div className="space-y-2">
                                                            <input type="text" value={coverSearch} onChange={(e) => setCoverSearch(e.target.value)} placeholder="Søk i innbetalinger (alle måneder)..." className={searchCls} />
                                                            <div className={listCls}>
                                                                {coverIncomeCandidates.length === 0 && <p className="p-3 text-sm text-gray-500 dark:text-gray-400">Ingen innbetalinger funnet. Er den importert fra banken ennå?</p>}
                                                                {coverIncomeCandidates.map(t => (
                                                                    <button key={t.id} onClick={() => stageCoverAdd(t.id)} className="w-full text-left px-3 py-2 flex items-center justify-between gap-2 text-sm transition-colors hover:bg-emerald-50 dark:hover:bg-emerald-900/20">
                                                                        <span className="min-w-0">
                                                                            <span className="block font-medium text-gray-900 dark:text-gray-100 truncate">{t.name}</span>
                                                                            <span className="block text-xs text-gray-500 dark:text-gray-400">{t.date}{accountName(t.accountId) ? ` • ${accountName(t.accountId)}` : ''}{isCoveringIncome(t, allTransactions) ? ' • dekker allerede en annen overføring' : isHandled(t) ? ` • ${t.category || 'kategorisert'}` : ' • uavstemt'}</span>
                                                                        </span>
                                                                        <span className="font-semibold text-green-600 dark:text-green-400 whitespace-nowrap">+{fmtKr(t.amount)} kr</span>
                                                                    </button>
                                                                ))}
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3 items-start">
                                        <textarea value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Kommentar (valgfritt)" rows={2} className={clsx(inputCls, "w-full px-3 py-2 resize-none")} />
                                        <label className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-2">
                                            Valuta
                                            <select value={currency} onChange={(e) => setCurrency(e.target.value)} title="Valutaen beløpet ble betalt i. Sett f.eks. SEK på utenlandskjøp, så foreslår bankimporten koblingen til NOK-beløpet." className={inputCls}>
                                                <option value="">NOK (kr)</option>
                                                {FOREIGN_CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                                            </select>
                                        </label>
                                    </div>
                                </div>
                            )}
                        </section>
                    )}

                    {/* Summary */}
                    <p className={clsx("text-sm rounded-lg px-3 py-2 border", canSave ? "bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800 text-green-800 dark:text-green-200" : "bg-gray-50 dark:bg-gray-700/40 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400")}>
                        <span className="font-medium">{isEdit ? 'Lagres som: ' : 'Blir: '}</span>{summaryParts.join(' · ')}
                    </p>
                </div>

                {/* Footer */}
                <div className="px-6 py-4 bg-gray-50 dark:bg-gray-800/50 border-t border-gray-100 dark:border-gray-700 flex justify-between items-center gap-3">
                    {isEdit ? (
                        <button onClick={onClose} className="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 font-medium">Avbryt</button>
                    ) : (
                        <div className="flex items-center gap-3">
                            <button onClick={() => advance([currentTransaction.id])} className="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 font-medium" title="Går videre uten å lagre noe på denne">Hopp over</button>
                            <span className="text-sm text-gray-400">{processedCount} behandlet</span>
                        </div>
                    )}
                    <button onClick={() => save()} disabled={!canSave} className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white font-medium rounded-lg transition-colors flex items-center gap-2">
                        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                        {isEdit ? 'Lagre' : 'Lagre og neste'}
                    </button>
                </div>
            </div>

            <AddBudgetItemModal
                isOpen={isAddOpen}
                onClose={() => setIsAddOpen(false)}
                onCreate={handleNewBudgetItem}
                defaultScope={scope}
            />
        </div>
    );
}
