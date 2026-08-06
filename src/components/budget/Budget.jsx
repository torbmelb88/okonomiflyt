import { useBudget } from '../../contexts/BudgetContext';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts';
import { DollarSign, Users, ArrowRight, Plus, Calendar, RotateCcw, History } from 'lucide-react';
import { useState, useEffect } from 'react';
import AddBudgetItemModal from './AddBudgetItemModal';
import BudgetItemDetailsModal from './BudgetItemDetailsModal';
import AnnualBudgetPlannerModal from './AnnualBudgetPlannerModal';
import { isVirtualExpense, SCOPE_LABEL } from '../../utils/categoryMigration';
import clsx from 'clsx';

function BudgetAmountInput({ value, onCommit, className }) {
    const [draft, setDraft] = useState(String(value));
    useEffect(() => { setDraft(String(value)); }, [value]);
    const commit = () => {
        const newAmount = parseFloat(draft) || 0;
        if (newAmount !== value) onCommit(newAmount);
    };
    return (
        <input type="number" value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={commit}
            onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }} className={className} />
    );
}

/**
 * Budsjett = the plan. Budget items are auto-included from the owner-level
 * library by scope (this budget shows defs scoped to it or 'both'). The amount
 * lives on a per-budget instance (expense) that is materialized lazily the
 * first time you set an amount. Actuals/split live on Forbruk.
 */
export default function Budget() {
    const {
        activeBudget, expenses, transactions, categories, budgetItemDefs, loading,
        addCategory, addBudgetItemDef, addExpense, getMonthlyBudget, setMonthlyBudget, deleteMonthlyBudget,
    } = useBudget();

    const [isAddModalOpen, setIsAddModalOpen] = useState(false);
    const [selectedBudgetItem, setSelectedBudgetItem] = useState(null);
    const [isAnnualPlannerOpen, setIsAnnualPlannerOpen] = useState(false);
    const [selectedMonth, setSelectedMonth] = useState(() => {
        const now = new Date();
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    });

    if (loading) return <div>Laster budsjett...</div>;
    if (!activeBudget) return <div>Ingen budsjett valgt.</div>;

    const budgetScope = activeBudget.type === 'shared' ? 'shared' : 'private';
    const catName = (id) => categories.find(c => c.id === id)?.name || 'Annet';

    const formatMonth = (monthStr) => {
        const [year, month] = monthStr.split('-');
        return new Date(year, parseInt(month) - 1).toLocaleDateString('no-NO', { month: 'long', year: 'numeric' });
    };
    const changeMonth = (delta) => {
        const [year, month] = selectedMonth.split('-').map(Number);
        const newDate = new Date(year, month - 1 + delta);
        setSelectedMonth(`${newDate.getFullYear()}-${String(newDate.getMonth() + 1).padStart(2, '0')}`);
    };
    const getPreviousMonth = (monthStr) => {
        const [year, month] = monthStr.split('-');
        const date = new Date(year, parseInt(month) - 2);
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    };

    // Auto-included defs (by scope) -> rows, with the per-budget instance if any
    const eligibleDefs = budgetItemDefs.filter(d => d.scope === 'both' || d.scope === budgetScope);

    const defRows = eligibleDefs.map(def => {
        const inst = expenses.find(e => e.defId === def.id && !isVirtualExpense(e));
        const mb = inst ? getMonthlyBudget(inst.id, selectedMonth) : { amount: 0, isOverride: false };
        return {
            key: `def-${def.id}`, defId: def.id, instId: inst?.id || null,
            name: def.name, category: catName(def.categoryId), scope: def.scope,
            budgetedAmount: mb.amount, isOverride: mb.isOverride, materialized: !!inst, isVirtual: false,
        };
    });

    // Anything not represented by a def row: legacy (no defId) or the injected
    // virtual shared-share. Kept so nothing disappears from the plan.
    const usedInstIds = new Set(defRows.filter(r => r.instId).map(r => r.instId));
    const extraRows = expenses.filter(e => !usedInstIds.has(e.id)).map(e => {
        const def = e.defId ? budgetItemDefs.find(d => d.id === e.defId) : null;
        const mb = getMonthlyBudget(e.id, selectedMonth);
        return {
            key: `exp-${e.id}`, defId: e.defId || null, instId: isVirtualExpense(e) ? null : e.id,
            name: e.name, category: def ? catName(def.categoryId) : (e.category || 'Annet'), scope: def?.scope || null,
            budgetedAmount: mb.amount, isOverride: mb.isOverride, materialized: !isVirtualExpense(e), isVirtual: isVirtualExpense(e),
        };
    });

    const rows = [...defRows, ...extraRows].sort((a, b) =>
        a.category.localeCompare(b.category, 'no-NO') || a.name.localeCompare(b.name, 'no-NO'));

    const totalBudgeted = rows.reduce((sum, r) => sum + r.budgetedAmount, 0);

    // Plan pie by category
    const byCat = {};
    rows.forEach(r => { byCat[r.category] = (byCat[r.category] || 0) + r.budgetedAmount; });
    const data = Object.keys(byCat)
        .map((cat, i) => ({ name: cat, value: byCat[cat], color: ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#6b7280', '#ef4444'][i % 6] }))
        .filter(d => d.value > 0);
    if (data.length === 0) data.push({ name: 'Ingen data', value: 1, color: '#e5e7eb' });

    const commitAmount = async (row, newAmount) => {
        if (row.isVirtual) return;
        try {
            if (row.materialized) {
                await setMonthlyBudget(row.instId, selectedMonth, newAmount);
            } else {
                // Lazy-materialize the per-budget instance the first time an
                // amount is set for an auto-included def.
                await addExpense({ defId: row.defId, name: row.name, category: row.category, amount: newAmount, frequency: 'monthly' });
            }
        } catch (e) {
            console.error('Failed to set amount', e);
            alert('Kunne ikke lagre beløp: ' + e.message);
        }
    };

    const handleSetToPreviousActual = (row) => {
        if (!row.materialized) return;
        const prevMonth = getPreviousMonth(selectedMonth);
        const target = transactions
            .filter(t => t.budgetItemId === row.instId && t.month === prevMonth && t.type !== 'income')
            .reduce((sum, t) => sum + t.amount, 0);
        setMonthlyBudget(row.instId, selectedMonth, target);
    };

    const handleResetBudget = (row) => {
        if (row.materialized) deleteMonthlyBudget(row.instId, selectedMonth);
    };

    const handleCreateBudgetItem = async ({ name, categoryId, newCategoryName, scope, amount }) => {
        let catId = categoryId;
        let catLabel = categories.find(c => c.id === catId)?.name;
        if (!catId && newCategoryName) {
            const cat = await addCategory(newCategoryName);
            catId = cat.id;
            catLabel = cat.name;
        }
        const def = await addBudgetItemDef({ name, categoryId: catId, scope });
        // Materialize an instance in the active budget if its scope covers it
        const coversActive = scope === 'both' || scope === budgetScope;
        if (coversActive) {
            await addExpense({ defId: def.id, name, category: catLabel || 'Annet', amount, frequency: 'monthly' });
        }
    };

    return (
        <div className="space-y-6">
            {/* Month nav */}
            <div className="flex items-center justify-between bg-white dark:bg-gray-800 p-4 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700">
                <button onClick={() => changeMonth(-1)} className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full transition-colors">
                    <ArrowRight className="w-5 h-5 transform rotate-180 text-gray-600 dark:text-gray-400" />
                </button>
                <div className="text-center">
                    <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 capitalize">{formatMonth(selectedMonth)}</h2>
                    <div className="text-sm text-gray-500 dark:text-gray-400 mt-1">Planlagt budsjett: <span className="font-medium">{totalBudgeted.toLocaleString('no-NO')} kr</span></div>
                </div>
                <button onClick={() => changeMonth(1)} className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full transition-colors">
                    <ArrowRight className="w-5 h-5 text-gray-600 dark:text-gray-400" />
                </button>
            </div>

            <div className="flex items-center justify-between">
                <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Budsjett</h1>
                <div className="flex space-x-2">
                    <button onClick={() => setIsAnnualPlannerOpen(true)} className="flex items-center justify-center w-10 h-10 bg-white dark:bg-gray-800 text-blue-600 dark:text-blue-400 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors" title="Årsplanlegger">
                        <Calendar className="w-5 h-5" />
                    </button>
                    <button onClick={() => setIsAddModalOpen(true)} className="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium shadow-sm transition-colors">
                        <Plus className="w-4 h-4" />
                        <span>Ny budsjettpost</span>
                    </button>
                </div>
            </div>

            {/* Plan chart */}
            <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700">
                <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-4">Budsjettfordeling (Plan)</h3>
                <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                            <Pie data={data} cx="50%" cy="50%" innerRadius={60} outerRadius={80} paddingAngle={5} dataKey="value">
                                {data.map((entry, index) => <Cell key={`cell-${index}`} fill={entry.color} />)}
                            </Pie>
                            <Tooltip formatter={(value) => `${value.toLocaleString('no-NO')} kr`} />
                            <Legend />
                        </PieChart>
                    </ResponsiveContainer>
                </div>
            </div>

            {/* Plan list */}
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
                <div className="hidden md:grid px-6 py-4 border-b border-gray-100 dark:border-gray-700 grid-cols-12 gap-2 text-sm font-bold text-gray-900 dark:text-gray-100">
                    <div className="col-span-7">Budsjettpost</div>
                    <div className="col-span-5 text-right">Planlagt beløp</div>
                </div>
                <div className="divide-y divide-gray-100 dark:divide-gray-700">
                    {rows.length > 0 ? rows.map((row) => (
                        <div key={row.key}
                            onClick={() => row.instId && setSelectedBudgetItem(expenses.find(e => e.id === row.instId))}
                            className={clsx('px-4 md:px-6 py-4 transition-colors flex items-center justify-between', row.instId ? 'hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer' : '')}>
                            <div className="flex items-center space-x-3 min-w-0">
                                <div className={clsx('w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0', row.isVirtual ? 'bg-purple-100 text-purple-600' : 'bg-blue-100 text-blue-600')}>
                                    {row.isVirtual ? <Users className="w-4 h-4" /> : <DollarSign className="w-4 h-4" />}
                                </div>
                                <div className="min-w-0">
                                    <div className="font-medium text-gray-900 dark:text-gray-100 truncate">{row.name}</div>
                                    <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
                                        {row.category}
                                        {row.scope === 'both' && <span className="ml-1 text-purple-500">· {SCOPE_LABEL.both}</span>}
                                        {row.isOverride && <span className="ml-1 text-blue-500">· overstyrt</span>}
                                        {!row.materialized && !row.isVirtual && <span className="ml-1 text-gray-400">· ikke satt</span>}
                                    </div>
                                </div>
                            </div>
                            <div className="flex items-center justify-end gap-1 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                                {row.materialized && (
                                    <>
                                        <button onClick={() => handleSetToPreviousActual(row)} className="p-1.5 text-gray-400 hover:text-purple-600 hover:bg-purple-50 rounded transition-colors" title="Sett til forrige måneds forbruk">
                                            <History className="w-3.5 h-3.5" />
                                        </button>
                                        <button onClick={() => handleResetBudget(row)} className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-50 rounded transition-colors" title="Tilbakestill til standard">
                                            <RotateCcw className="w-3.5 h-3.5" />
                                        </button>
                                    </>
                                )}
                                {row.isVirtual ? (
                                    <span className="w-28 text-right font-medium text-gray-700 dark:text-gray-300 pr-2">{row.budgetedAmount.toLocaleString('no-NO')} kr</span>
                                ) : (
                                    <>
                                        <BudgetAmountInput value={row.budgetedAmount} onCommit={(amt) => commitAmount(row, amt)} className="w-24 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded px-2 py-1 text-right" />
                                        <span className="dark:text-gray-400 text-sm">kr</span>
                                    </>
                                )}
                            </div>
                        </div>
                    )) : (
                        <div className="text-center text-gray-500 dark:text-gray-400 py-8">
                            Ingen budsjettposter for dette budsjettet ennå. Legg til én, eller opprett dem i Innstillinger → Kategorier &amp; budsjettposter.
                        </div>
                    )}
                </div>
            </div>

            <AddBudgetItemModal isOpen={isAddModalOpen} onClose={() => setIsAddModalOpen(false)} onCreate={handleCreateBudgetItem} defaultScope={budgetScope} />
            <AnnualBudgetPlannerModal isOpen={isAnnualPlannerOpen} onClose={() => setIsAnnualPlannerOpen(false)} />
            <BudgetItemDetailsModal isOpen={!!selectedBudgetItem} onClose={() => setSelectedBudgetItem(null)} budgetItem={selectedBudgetItem} selectedMonth={selectedMonth} />
        </div>
    );
}
