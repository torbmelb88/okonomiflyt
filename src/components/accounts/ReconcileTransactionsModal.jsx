import { useState, useMemo } from 'react';
import { X, Check, Plus, CreditCard, Edit2, FolderKanban, Sparkles, Wallet, Undo2 } from 'lucide-react';
import { useBudget } from '../../contexts/BudgetContext';
import AddBudgetItemModal from '../budget/AddBudgetItemModal';
import TransactionReceipt from './TransactionReceipt';
import InfoTip from '../common/InfoTip';
import { findBudgetItemSuggestion } from '../../utils/textMatch';
import clsx from 'clsx';

export default function ReconcileTransactionsModal({ isOpen, onClose, transactions, onComplete }) {
    const {
        expenses, budgetItemDefs, categories, ensureInstanceForDef,
        addCategory, addBudgetItemDef, updateTransaction, accounts, budgets, allProjects, transactions: allTransactions,
    } = useBudget();
    const [currentIndex, setCurrentIndex] = useState(0);
    const [selectedBudgetItemId, setSelectedBudgetItemId] = useState(''); // holds a def id
    const [selectedBudgetId, setSelectedBudgetId] = useState('');
    const [isAddOpen, setIsAddOpen] = useState(false);
    const [processedCount, setProcessedCount] = useState(0);
    const [isUnnecessary, setIsUnnecessary] = useState(false);
    const [selectedProjectId, setSelectedProjectId] = useState('');
    const [selectedProjectSubcategory, setSelectedProjectSubcategory] = useState('');
    const [handledIds, setHandledIds] = useState(() => new Set());
    const [bulkSaving, setBulkSaving] = useState(false);
    const [asUtlegg, setAsUtlegg] = useState(false);
    const [isEditingDate, setIsEditingDate] = useState(false);
    const [tempDate, setTempDate] = useState('');
    const [excludeFromSharedCalc, setExcludeFromSharedCalc] = useState(false);
    const [coveredByAccountId, setCoveredByAccountId] = useState('');
    const [comment, setComment] = useState('');
    const [refundMode, setRefundMode] = useState(false);
    const [refundSearch, setRefundSearch] = useState('');
    const [selectedRefundId, setSelectedRefundId] = useState('');

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

    // Reset per-transaction state when switching transactions
    const [prevTransactionId, setPrevTransactionId] = useState(null);
    if ((currentTransaction?.id || null) !== prevTransactionId) {
        setPrevTransactionId(currentTransaction?.id || null);
        setIsEditingDate(false);
        setTempDate(currentTransaction?.date || '');
        setComment(currentTransaction?.comment || '');
        setSelectedBudgetItemId(currentTransaction ? (resolveDefId(currentTransaction.budgetItemId) || resolveDefId(suggestions[currentTransaction.id]?.budgetItemId) || '') : '');
        setIsUnnecessary(!!currentTransaction?.isUnnecessary);
        setExcludeFromSharedCalc(!!currentTransaction?.excludeFromSharedCalc);
        setCoveredByAccountId(currentTransaction?.coveredByAccountId || '');
        setSelectedProjectId(currentTransaction?.projectId || '');
        setSelectedProjectSubcategory(currentTransaction?.projectSubcategory || '');
        setRefundMode(false);
        setRefundSearch('');
        setSelectedRefundId(currentTransaction?.refundOfTransactionId || '');
        // Default the budget to the account's default (overridable). For an
        // already-reconciled transaction, keep its stored budget so a prior
        // override isn't lost.
        const txAccount = accounts.find(a => a.id === currentTransaction?.accountId);
        const accountDefault = txAccount?.defaultBudgetId || txAccount?.budgetId;
        setSelectedBudgetId(currentTransaction?.reconciled
            ? (currentTransaction.budgetId || accountDefault || '')
            : (accountDefault || currentTransaction?.budgetId || ''));
        // Utlegg is an explicit opt-in (off by default) — the user confirms when
        // they actually fronted a shared expense with private money.
        setAsUtlegg(false);
    }

    if (!isOpen || !transactions || transactions.length === 0 || !currentTransaction) return null;

    const currentSuggestion = suggestions[currentTransaction.id] || null;
    const remainingWithSuggestions = transactions.filter(t => !handledIds.has(t.id) && suggestions[t.id]);
    const account = accounts.find(a => a.id === currentTransaction.accountId);

    // Credit-note candidates: earlier expenses the refund can be linked to.
    // Same account and matching amount rank first, but the original purchase
    // may be in an earlier month, so the whole history is searchable.
    const refundCandidates = currentTransaction.type === 'income'
        ? allTransactions
            .filter(t => t.type === 'expense' && t.date <= currentTransaction.date)
            .filter(t => !refundSearch || t.name.toLowerCase().includes(refundSearch.toLowerCase()))
            .sort((a, b) => {
                const rank = (t) =>
                    (t.accountId === currentTransaction.accountId ? 0 : 4) +
                    (t.amount === currentTransaction.amount ? 0 : t.amount > currentTransaction.amount ? 1 : 2);
                return rank(a) - rank(b) || b.date.localeCompare(a.date);
            })
            .slice(0, 30)
        : [];

    // Budget items are the library defs eligible for the SELECTED budget's scope.
    const selectedBudget = budgets.find(b => b.id === selectedBudgetId);
    const scope = selectedBudget?.type === 'shared' ? 'shared' : 'private';
    const isSharedTarget = selectedBudget?.type === 'shared';
    // Utlegg = a shared expense paid with PRIVATE money. Only relevant when the
    // money came from a private account (its default budget is personal) AND the
    // expense is assigned to a shared budget. Joint-account money is never utlegg.
    const accountDefaultBudget = budgets.find(b => b.id === (account?.defaultBudgetId || account?.budgetId));
    const accountIsPrivate = accountDefaultBudget?.type === 'personal';
    const showUtlegg = isSharedTarget && accountIsPrivate;
    const paidPrivatelyBy = (showUtlegg && asUtlegg) ? 'self' : null;
    // Projects belong to a budget — follow the selected budget (plus legacy
    // budget-less projects, which show everywhere).
    const budgetProjects = allProjects.filter(p => !p.budgetId || p.budgetId === selectedBudgetId);
    const selectedProjectSubcats = allProjects.find(p => p.id === selectedProjectId)?.subcategories || [];
    const eligibleDefs = budgetItemDefs
        .filter(d => d.scope === 'both' || d.scope === scope)
        .sort((a, b) => catName(a.categoryId).localeCompare(catName(b.categoryId), 'no-NO') || a.name.localeCompare(b.name, 'no-NO'));

    const advance = (idsJustHandled) => {
        const handled = new Set(handledIds);
        idsJustHandled.forEach(id => handled.add(id));
        setHandledIds(handled);
        setProcessedCount(prev => prev + idsJustHandled.length);
        const nextIdx = transactions.findIndex(t => !handled.has(t.id));
        if (nextIdx === -1) onComplete();
        else setCurrentIndex(nextIdx);
    };
    const nextTransaction = () => advance([currentTransaction.id]);

    const handleLink = async () => {
        if (!selectedBudgetItemId) return;
        try {
            const def = budgetItemDefs.find(d => d.id === selectedBudgetItemId);
            if (!def) return;
            const instId = await ensureInstanceForDef(def, selectedBudgetId);
            await updateTransaction(currentTransaction.id, {
                budgetId: selectedBudgetId,
                budgetItemId: instId,
                reconciled: true,
                isUnnecessary, excludeFromSharedCalc,
                coveredByAccountId: excludeFromSharedCalc ? (coveredByAccountId || null) : null,
                projectId: selectedProjectId || null,
                projectSubcategory: selectedProjectId ? (selectedProjectSubcategory || null) : null,
                comment, paidPrivatelyBy,
            });
            nextTransaction();
        } catch (error) {
            console.error("Failed to link transaction", error);
            alert("Kunne ikke knytte transaksjon.");
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
        await updateTransaction(currentTransaction.id, {
            budgetId: selectedBudgetId,
            budgetItemId: instId,
            reconciled: true,
            isUnnecessary, excludeFromSharedCalc,
            projectId: selectedProjectId || null,
            projectSubcategory: selectedProjectId ? (selectedProjectSubcategory || null) : null,
            comment, paidPrivatelyBy,
        });
        setIsAddOpen(false);
        nextTransaction();
    };

    const markAs = async (extra) => {
        try {
            await updateTransaction(currentTransaction.id, { budgetId: selectedBudgetId, reconciled: true, budgetItemId: null, isRefund: false, refundOfTransactionId: null, ...extra });
            nextTransaction();
        } catch (error) {
            console.error("Failed to mark transaction", error);
            alert("Kunne ikke markere transaksjon.");
        }
    };
    const handleMarkAsSalary = () => markAs({ category: 'Lønn', type: 'income' });
    const handleMarkAsInternalTransfer = () => markAs({ category: 'Intern Overføring' });
    const handleMarkAsCreditCardBill = () => markAs({ category: 'Kredittkortregning' });
    const handleMarkAsSavings = () => markAs({ category: 'Sparing' });

    // A credit note inherits the original's budget placement and split flags so
    // the two net out everywhere the original counted: the budget item's actual,
    // oppgjør (payer/utlegg/exclusion) and any project.
    const handleLinkRefund = async () => {
        const original = allTransactions.find(t => t.id === selectedRefundId);
        if (!original) return;
        try {
            await updateTransaction(currentTransaction.id, {
                reconciled: true,
                isRefund: true,
                refundOfTransactionId: original.id,
                budgetId: original.budgetId || selectedBudgetId,
                budgetItemId: original.budgetItemId || null,
                category: original.category || 'Retur',
                projectId: original.projectId || null,
                projectSubcategory: original.projectSubcategory || null,
                payer: original.payer || null,
                paidPrivatelyBy: original.paidPrivatelyBy || null,
                excludeFromSharedCalc: !!original.excludeFromSharedCalc,
                coveredByAccountId: original.coveredByAccountId || null,
                comment,
            });
            nextTransaction();
        } catch (error) {
            console.error("Failed to link refund", error);
            alert("Kunne ikke registrere retur.");
        }
    };
    const handleUnlinkedRefund = () => markAs({ category: 'Retur', isRefund: true });

    const handleSaveDate = async () => {
        if (!tempDate) return;
        try {
            await updateTransaction(currentTransaction.id, { date: tempDate, month: tempDate.slice(0, 7) });
            setIsEditingDate(false);
        } catch (error) {
            console.error("Failed to update date", error);
            alert("Kunne ikke oppdatere dato.");
        }
    };

    const handleAcceptAllSuggestions = async () => {
        if (remainingWithSuggestions.length === 0) return;
        setBulkSaving(true);
        try {
            await Promise.all(remainingWithSuggestions.map(t => updateTransaction(t.id, {
                budgetItemId: suggestions[t.id].budgetItemId,
                reconciled: true,
            })));
            advance(remainingWithSuggestions.map(t => t.id));
        } catch (error) {
            console.error("Failed to bulk-accept suggestions", error);
            alert("Kunne ikke godta alle forslagene.");
        } finally {
            setBulkSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/50 backdrop-blur-sm">
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-lg md:max-w-2xl overflow-hidden animate-in fade-in zoom-in duration-200 flex flex-col max-h-[90vh]">
                <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between bg-gray-50 dark:bg-gray-800/50">
                    <div>
                        <h2 className="text-lg font-bold text-gray-900 dark:text-white">Avstem Transaksjoner</h2>
                        <p className="text-sm text-gray-500 dark:text-gray-400">Transaksjon {currentIndex + 1} av {transactions.length}</p>
                    </div>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"><X className="w-5 h-5" /></button>
                </div>

                <div className="p-4 md:p-6 overflow-y-auto">
                    {/* Transaction Card */}
                    <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800 rounded-xl p-6 mb-8">
                        <div className="flex justify-between items-start mb-4">
                            <div>
                                <div className="flex items-center space-x-2 mb-1">
                                    {isEditingDate ? (
                                        <div className="flex items-center space-x-2">
                                            <input type="date" value={tempDate} onChange={(e) => setTempDate(e.target.value)} className="px-2 py-1 text-sm border border-blue-300 rounded dark:bg-gray-700 dark:border-gray-600 dark:text-white" />
                                            <button onClick={handleSaveDate} className="p-1 text-green-600 hover:bg-green-100 rounded dark:hover:bg-green-900/30"><Check className="w-4 h-4" /></button>
                                            <button onClick={() => setIsEditingDate(false)} className="p-1 text-red-600 hover:bg-red-100 rounded dark:hover:bg-red-900/30"><X className="w-4 h-4" /></button>
                                        </div>
                                    ) : (
                                        <div className="flex items-center group cursor-pointer" onClick={() => setIsEditingDate(true)}>
                                            <p className="text-sm text-blue-600 dark:text-blue-400 font-medium group-hover:underline">{currentTransaction.date}</p>
                                            <Edit2 className="w-3 h-3 ml-2 text-blue-400 opacity-0 group-hover:opacity-100 transition-opacity" />
                                        </div>
                                    )}
                                </div>
                                <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100 break-words">{currentTransaction.name}</h3>
                                <p className="text-gray-600 dark:text-gray-400">{currentTransaction.category}</p>
                                {account && (
                                    <p className="text-xs text-gray-500 mt-1 flex items-center gap-1"><CreditCard className="w-3 h-3" />{account.name}</p>
                                )}
                            </div>
                            <div className="text-right">
                                <span className={clsx("text-2xl font-bold", currentTransaction.type === 'income' ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400")}>
                                    {currentTransaction.type === 'income' ? '+' : '-'}{currentTransaction.amount.toLocaleString('no-NO')} kr
                                </span>
                            </div>
                        </div>

                        <div className="mt-4 pt-4 border-t border-blue-100 dark:border-blue-800 flex flex-col gap-2">
                            <div className="flex items-center">
                                <input type="checkbox" id="isUnnecessaryReconcile" checked={isUnnecessary} onChange={(e) => setIsUnnecessary(e.target.checked)} className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600" />
                                <label htmlFor="isUnnecessaryReconcile" className="ml-2 text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-1.5">Unødvendig kjøp 💸
                                    <InfoTip text="Ren merkelapp for egen bevisstgjøring. Kjøpet telles helt som normalt i budsjett og beregninger." />
                                </label>
                            </div>
                            <div className="flex items-center">
                                <input type="checkbox" id="excludeFromSharedCalc" checked={excludeFromSharedCalc} onChange={(e) => setExcludeFromSharedCalc(e.target.checked)} className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600" />
                                <label htmlFor="excludeFromSharedCalc" className="ml-2 text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-1.5">
                                    {isSharedTarget ? 'Hold kostnad utenfor fordeling 🚫' : 'Hold kostnad utenfor overføringsberegning 🚫'}
                                    <InfoTip text={isSharedTarget
                                        ? 'Kjøpet telles fortsatt mot budsjettposten, men holdes utenfor oppgjøret mellom dere — ingen skylder noe for det.'
                                        : 'Kjøpet telles fortsatt mot budsjettposten, men holdes utenfor overføringsberegningen i Min Oversikt (kredittkortbruk / påfyll av regningskonto).'} />
                                </label>
                            </div>
                            {excludeFromSharedCalc && (
                                <div className="ml-6 flex flex-col gap-1">
                                    <label className="text-xs text-gray-600 dark:text-gray-400">Skal transaksjonen dekkes fra en annen konto?</label>
                                    <select value={coveredByAccountId} onChange={e => setCoveredByAccountId(e.target.value)} className="text-sm px-2 py-1 border border-blue-200 dark:border-blue-700 rounded-lg bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 focus:ring-2 focus:ring-blue-400 outline-none">
                                        <option value="">Nei / ikke spesifisert</option>
                                        {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                                    </select>
                                </div>
                            )}
                            <div className="pt-1">
                                <textarea value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Kommentar (valgfritt)" rows={2} className="w-full text-sm px-3 py-2 border border-blue-200 dark:border-blue-700 rounded-lg bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 focus:ring-2 focus:ring-blue-400 outline-none resize-none" />
                            </div>
                            {budgetProjects.length > 0 && (
                                <div className="flex items-center gap-2 pt-1">
                                    <FolderKanban className="w-4 h-4 text-blue-500 flex-shrink-0" />
                                    <select value={selectedProjectId} onChange={e => { setSelectedProjectId(e.target.value); setSelectedProjectSubcategory(''); }} className="flex-1 text-sm px-2 py-1 border border-blue-200 dark:border-blue-700 rounded-lg bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 focus:ring-2 focus:ring-blue-400 outline-none">
                                        <option value="">Ingen prosjekt</option>
                                        {budgetProjects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                                    </select>
                                    <InfoTip text="Knytter kjøpet til et prosjekt, slik at det også telles i prosjektregnskapet — i tillegg til budsjettet." />
                                </div>
                            )}
                            {selectedProjectId && selectedProjectSubcats.length > 0 && (
                                <div className="ml-6 flex flex-col gap-1">
                                    <label className="text-xs text-gray-600 dark:text-gray-400">Underkategori i prosjektet</label>
                                    <select value={selectedProjectSubcategory} onChange={e => setSelectedProjectSubcategory(e.target.value)} className="text-sm px-2 py-1 border border-blue-200 dark:border-blue-700 rounded-lg bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 focus:ring-2 focus:ring-blue-400 outline-none">
                                        <option value="">Ingen underkategori</option>
                                        {selectedProjectSubcats.map(s => <option key={s} value={s}>{s}</option>)}
                                    </select>
                                </div>
                            )}
                        </div>
                    </div>

                    <TransactionReceipt transaction={currentTransaction} />

                    {/* Action Area */}
                    <div className="space-y-6">
                        {/* Budget selector (default from account, overridable) */}
                        <div className="space-y-2">
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-1.5"><Wallet className="w-4 h-4" /> Budsjett
                                <InfoTip text="Hvilket budsjett (felles eller privat) transaksjonen føres mot. Settes automatisk fra kontoens standardbudsjett, men kan overstyres per transaksjon." />
                            </label>
                            <select
                                value={selectedBudgetId}
                                onChange={(e) => { setSelectedBudgetId(e.target.value); setSelectedBudgetItemId(''); setSelectedProjectId(''); setSelectedProjectSubcategory(''); }}
                                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none bg-white dark:bg-gray-700 dark:text-white text-sm"
                            >
                                {budgets.map(b => <option key={b.id} value={b.id}>{b.name} ({b.type === 'shared' ? 'felles' : 'privat'})</option>)}
                            </select>
                            {showUtlegg && (
                                <label className="flex items-start gap-2 p-2 bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded-lg">
                                    <input type="checkbox" checked={asUtlegg} onChange={(e) => setAsUtlegg(e.target.checked)} className="w-4 h-4 mt-0.5 text-orange-600 border-gray-300 rounded focus:ring-orange-500 dark:bg-gray-700 dark:border-gray-600" />
                                    <span className="text-sm text-gray-700 dark:text-gray-300">
                                        <span className="font-medium">Utlegg — jeg la ut med egne penger</span>
                                        <span className="block text-xs text-gray-500 dark:text-gray-400">En felles utgift du betalte fra en privat konto. Beløpet trekkes fra det du skal overføre til felleskontoen, siden du allerede har lagt ut.</span>
                                    </span>
                                </label>
                            )}
                        </div>

                        {remainingWithSuggestions.length > 1 && (
                            <button onClick={handleAcceptAllSuggestions} disabled={bulkSaving} className="w-full flex items-center justify-center gap-2 py-3 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-300 text-white font-medium rounded-xl transition-colors shadow-sm">
                                <Sparkles className="w-4 h-4" />
                                {bulkSaving ? 'Godtar forslag...' : `Godta alle ${remainingWithSuggestions.length} automatiske forslag`}
                            </button>
                        )}

                        <div className="space-y-2">
                            <label className="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-1.5">Knytt til budsjettpost
                                <InfoTip text="Kobler beløpet til en budsjettpost, slik at det telles som faktisk forbruk mot budsjettet denne måneden. Dette er det vanlige valget for kjøp og utgifter." />
                            </label>
                            <div className="flex gap-2">
                                <select value={selectedBudgetItemId} onChange={(e) => setSelectedBudgetItemId(e.target.value)} className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none dark:bg-gray-700 dark:text-white text-sm">
                                    <option value="">-- Velg budsjettpost --</option>
                                    {eligibleDefs.map(def => <option key={def.id} value={def.id}>{catName(def.categoryId)} — {def.name}</option>)}
                                </select>
                                <button onClick={handleLink} disabled={!selectedBudgetItemId} className="px-4 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 disabled:bg-gray-300 transition-colors flex items-center whitespace-nowrap">
                                    <Check className="w-4 h-4 mr-1.5" />Knytt
                                </button>
                            </div>
                            {currentSuggestion && selectedBudgetItemId === resolveDefId(currentSuggestion.budgetItemId) && (
                                <p className="text-xs text-purple-600 dark:text-purple-400 flex items-center gap-1.5">
                                    <Sparkles className="w-3.5 h-3.5 flex-shrink-0" />
                                    <span>Foreslått automatisk — tidligere avstemt som «{expenses.find(e => e.id === currentSuggestion.budgetItemId)?.name}»{currentSuggestion.matchType === 'similar' && ` (lignet på "${currentSuggestion.matchedName}")`}</span>
                                </p>
                            )}
                            <button onClick={() => setIsAddOpen(true)} className="w-full py-2 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg text-gray-500 dark:text-gray-400 text-sm font-medium hover:border-blue-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-all flex items-center justify-center">
                                <Plus className="w-4 h-4 mr-1.5" />Opprett ny budsjettpost
                            </button>
                        </div>

                        <div className="relative">
                            <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-gray-200 dark:border-gray-700"></div></div>
                            <div className="relative flex justify-center text-sm"><span className="px-2 bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400">eller</span></div>
                        </div>

                        <div className="flex gap-3">
                            <button onClick={handleMarkAsSalary} className="flex-1 flex items-center justify-center gap-2 py-3 bg-green-50 hover:bg-green-100 dark:bg-green-900/20 text-green-700 dark:text-green-300 rounded-xl transition-colors font-medium text-sm"><span>💰</span>Lønn
                                <InfoTip text="Merker inntekten som lønn. Summeres som netto lønn i Min Oversikt og er utgangspunktet for «igjen å bruke»." />
                            </button>
                            <button onClick={handleMarkAsInternalTransfer} className="flex-1 flex items-center justify-center gap-2 py-3 bg-purple-50 hover:bg-purple-100 dark:bg-purple-900/20 text-purple-700 dark:text-purple-300 rounded-xl transition-colors font-medium text-sm"><span>🔄</span>Intern overføring
                                <InfoTip text="Flytting av penger mellom egne kontoer. Holdes utenfor alle summer og beregninger." />
                            </button>
                            <button onClick={handleMarkAsSavings} className="flex-1 flex items-center justify-center gap-2 py-3 bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300 rounded-xl transition-colors font-medium text-sm"><span>🐷</span>Sparing
                                <InfoTip text="Overføring til sparing. Holdes utenfor forbruk, men vises som «Overført til sparing» i Min Oversikt og trekkes fra i «igjen å bruke». Bruk den på det utgående beløpet." />
                            </button>
                        </div>

                        {currentTransaction.type === 'income' && (
                            <div className="space-y-2">
                                <button onClick={() => setRefundMode(v => !v)} className={clsx(
                                    "w-full flex items-center justify-center gap-2 py-3 rounded-xl transition-colors font-medium text-sm",
                                    refundMode
                                        ? "bg-teal-600 text-white"
                                        : "bg-teal-50 hover:bg-teal-100 dark:bg-teal-900/20 text-teal-700 dark:text-teal-300"
                                )}>
                                    <Undo2 className="w-4 h-4" />Kreditnota / retur av tidligere kjøp
                                    <InfoTip text="For inntekter som egentlig er tilbakebetaling av et tidligere kjøp. Returen kobles til kjøpet og nettes mot det i alle beregninger — i stedet for å telle som inntekt." />
                                </button>
                                {refundMode && (
                                    <div className="border border-teal-200 dark:border-teal-800 rounded-xl p-3 space-y-2 bg-teal-50/50 dark:bg-teal-900/10">
                                        <p className="text-xs text-gray-600 dark:text-gray-400">
                                            Velg kjøpet pengene er retur for. Returen arver budsjettpost og kategori fra kjøpet, slik at beløpene nettes mot hverandre — også på tvers av måneder.
                                        </p>
                                        <input
                                            type="text"
                                            value={refundSearch}
                                            onChange={(e) => { setRefundSearch(e.target.value); setSelectedRefundId(''); }}
                                            placeholder="Søk i tidligere kjøp..."
                                            className="w-full text-sm px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white outline-none focus:ring-2 focus:ring-teal-400"
                                        />
                                        <div className="max-h-56 overflow-y-auto divide-y divide-gray-100 dark:divide-gray-700 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800">
                                            {refundCandidates.length === 0 && (
                                                <p className="p-3 text-sm text-gray-500 dark:text-gray-400">Ingen tidligere kjøp funnet.</p>
                                            )}
                                            {refundCandidates.map(t => {
                                                const tAccount = accounts.find(a => a.id === t.accountId);
                                                return (
                                                    <button key={t.id} onClick={() => setSelectedRefundId(t.id === selectedRefundId ? '' : t.id)} className={clsx(
                                                        "w-full text-left px-3 py-2 flex items-center justify-between gap-2 text-sm transition-colors",
                                                        selectedRefundId === t.id ? "bg-teal-100 dark:bg-teal-900/40" : "hover:bg-gray-50 dark:hover:bg-gray-700/50"
                                                    )}>
                                                        <span className="min-w-0">
                                                            <span className="block font-medium text-gray-900 dark:text-gray-100 truncate">{t.name}</span>
                                                            <span className="block text-xs text-gray-500 dark:text-gray-400">{t.date}{tAccount ? ` • ${tAccount.name}` : ''}</span>
                                                        </span>
                                                        <span className="font-semibold text-red-600 dark:text-red-400 whitespace-nowrap">-{t.amount.toLocaleString('no-NO')} kr</span>
                                                    </button>
                                                );
                                            })}
                                        </div>
                                        <button onClick={handleLinkRefund} disabled={!selectedRefundId} className="w-full py-2.5 bg-teal-600 hover:bg-teal-700 disabled:bg-gray-300 text-white font-medium rounded-lg transition-colors flex items-center justify-center gap-2 text-sm">
                                            <Check className="w-4 h-4" />Registrer som retur
                                        </button>
                                        <button onClick={handleUnlinkedRefund} className="w-full py-1.5 text-xs text-gray-500 dark:text-gray-400 hover:text-teal-600 dark:hover:text-teal-400">
                                            Fant ikke kjøpet? Registrer retur uten kobling
                                        </button>
                                    </div>
                                )}
                            </div>
                        )}
                        <button onClick={handleMarkAsCreditCardBill} className="w-full py-3 border border-gray-300 dark:border-gray-600 rounded-xl text-gray-500 dark:text-gray-400 font-medium hover:bg-gray-50 dark:hover:bg-gray-700 transition-all flex items-center justify-center gap-2 text-sm">
                            <CreditCard className="w-4 h-4" />Betaling kredittkortregning
                            <InfoTip text="Selve betalingen av kortregningen. Holdes utenfor forbruk — kortbruken telles i stedet fra de enkelte transaksjonene på kredittkortet." />
                        </button>
                    </div>
                </div>

                <div className="px-6 py-4 bg-gray-50 dark:bg-gray-800/50 border-t border-gray-100 dark:border-gray-700 flex justify-between items-center">
                    <button onClick={nextTransaction} className="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 font-medium">Hopp over (marker som uavstemt)</button>
                    <div className="text-sm text-gray-500 dark:text-gray-400">{processedCount} behandlet</div>
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
