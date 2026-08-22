import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useBudget } from '../../contexts/BudgetContext';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts';
import { Users, DollarSign, ArrowRight, List } from 'lucide-react';
import clsx from 'clsx';
import BudgetItemDetailsModal from '../budget/BudgetItemDetailsModal';

/**
 * Forbruk = spending statistics: the budget-vs-actual comparison and the
 * actual-spending pie for a chosen month. The raw transaction list and
 * reconciliation live on the Transaksjoner page; getting transactions in
 * happens on the Import page; planning (editing budgeted amounts) stays on
 * Budsjett — here the budget figures are read-only context for the actuals.
 */
export default function Forbruk() {
    const { activeBudget, expenses, transactions, budgetItemDefs, categories, loading, getMonthlyBudget } = useBudget();

    const [selectedMonth, setSelectedMonth] = useState(() => {
        const now = new Date();
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    });
    const [detailsItem, setDetailsItem] = useState(null);

    if (loading) return <div>Laster forbruk...</div>;
    if (!activeBudget) return <div>Ingen budsjett valgt.</div>;

    const formatMonth = (monthStr) => {
        const [year, month] = monthStr.split('-');
        return new Date(year, parseInt(month) - 1).toLocaleDateString('no-NO', { month: 'long', year: 'numeric' });
    };

    const changeMonth = (delta) => {
        const [year, month] = selectedMonth.split('-').map(Number);
        const newDate = new Date(year, month - 1 + delta);
        setSelectedMonth(`${newDate.getFullYear()}-${String(newDate.getMonth() + 1).padStart(2, '0')}`);
    };

    // --- Budget vs Actual (read-only context, computed budget-wide) ---
    // Items whose def or category is flagged "utenfor statistikk" are kept out
    // of the actual-consumption stats (pie + totals). Used e.g. for a felleskort
    // top-up: the card purchases count here, the top-up does not. The split is
    // computed separately and still counts those.
    const isItemExcludedFromStats = (item) => {
        const def = item.defId ? budgetItemDefs.find(d => d.id === item.defId) : null;
        if (def?.excludeFromStats) return true;
        const cat = def ? categories.find(c => c.id === def.categoryId) : null;
        return !!cat?.excludeFromStats;
    };
    const budgetItemsWithActuals = expenses
        .filter(item => !isItemExcludedFromStats(item))
        .map((item) => {
            const linked = transactions.filter(t => t.budgetItemId === item.id && t.month === selectedMonth);
            const actualAmount = linked.reduce((sum, t) => (t.type === 'income' ? sum - t.amount : sum + t.amount), 0);
            const budgetedAmount = getMonthlyBudget(item.id, selectedMonth).amount;
            return { ...item, budgetedAmount, actualAmount, diff: budgetedAmount - actualAmount, transactionCount: linked.length };
        })
        .sort((a, b) => {
            const catCompare = (a.category || 'Annet').localeCompare(b.category || 'Annet', 'no-NO');
            return catCompare === 0 ? a.name.localeCompare(b.name, 'no-NO') : catCompare;
        });

    const totalBudgeted = budgetItemsWithActuals.reduce((sum, i) => sum + i.budgetedAmount, 0);
    const totalActual = budgetItemsWithActuals.reduce((sum, i) => sum + i.actualAmount, 0);

    // Actual spending pie (by category)
    const actualCategories = {};
    budgetItemsWithActuals.forEach((item) => {
        if (item.actualAmount > 0) {
            const cat = item.isVirtual ? 'Felles' : item.category || 'Annet';
            actualCategories[cat] = (actualCategories[cat] || 0) + item.actualAmount;
        }
    });
    const actualData = Object.keys(actualCategories)
        .map((cat, index) => ({ name: cat, value: actualCategories[cat], color: cat === 'Felles' ? '#8b5cf6' : ['#3b82f6', '#10b981', '#f59e0b', '#6b7280'][index % 4] }))
        .filter(i => i.value > 0);
    if (actualData.length === 0) actualData.push({ name: 'Ingen data', value: 1, color: '#e5e7eb' });

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Forbruk</h1>
                <Link to="/transaksjoner" className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 font-medium shadow-sm text-sm">
                    <List className="w-4 h-4" />
                    <span>Til transaksjoner</span>
                </Link>
            </div>

            {/* Month Navigation */}
            <div className="bg-white dark:bg-gray-800 p-4 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700">
                <div className="flex items-center justify-between">
                    <button onClick={() => changeMonth(-1)} className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full transition-colors">
                        <ArrowRight className="w-5 h-5 transform rotate-180 text-gray-600 dark:text-gray-400" />
                    </button>
                    <div className="text-center flex-1 mx-4">
                        <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 capitalize">{formatMonth(selectedMonth)}</h2>
                        <span className="text-sm text-gray-500 dark:text-gray-400">
                            {Math.round(totalActual).toLocaleString('no-NO')} av {Math.round(totalBudgeted).toLocaleString('no-NO')} kr brukt
                        </span>
                    </div>
                    <button onClick={() => changeMonth(1)} className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full transition-colors ml-2">
                        <ArrowRight className="w-5 h-5 text-gray-600 dark:text-gray-400" />
                    </button>
                </div>
            </div>

            {/* Budget vs Actual + Actual pie */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
                    <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
                        <h3 className="font-bold text-gray-900 dark:text-gray-100">Budsjett vs Faktisk</h3>
                        <span className="text-sm text-gray-500 dark:text-gray-400">
                            {Math.round(totalActual).toLocaleString('no-NO')} / {Math.round(totalBudgeted).toLocaleString('no-NO')} kr
                        </span>
                    </div>
                    <div className="divide-y divide-gray-100 dark:divide-gray-700 max-h-96 overflow-y-auto">
                        {budgetItemsWithActuals.filter(i => i.actualAmount !== 0 || i.budgetedAmount !== 0).map(item => (
                            <button key={item.id} onClick={() => setDetailsItem(item)} className="w-full text-left px-6 py-3 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                                <div className="flex items-center gap-3 min-w-0">
                                    <div className={clsx('w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0', item.isVirtual ? 'bg-purple-100 text-purple-600' : 'bg-blue-100 text-blue-600')}>
                                        {item.isVirtual ? <Users className="w-4 h-4" /> : <DollarSign className="w-4 h-4" />}
                                    </div>
                                    <div className="min-w-0">
                                        <div className="font-medium text-gray-900 dark:text-gray-100 truncate">{item.name}</div>
                                        <div className="text-xs text-gray-500 dark:text-gray-400 truncate">{item.category} · {item.transactionCount} transaksjoner</div>
                                    </div>
                                </div>
                                <div className="text-right flex-shrink-0 ml-3">
                                    <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">{Math.round(item.actualAmount).toLocaleString('no-NO')} kr</div>
                                    <div className={clsx('text-xs', item.diff < 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400')}>
                                        {item.diff < 0 ? 'over' : 'igjen'} {Math.abs(Math.round(item.diff)).toLocaleString('no-NO')} av {Math.round(item.budgetedAmount).toLocaleString('no-NO')}
                                    </div>
                                </div>
                            </button>
                        ))}
                        {budgetItemsWithActuals.filter(i => i.actualAmount !== 0 || i.budgetedAmount !== 0).length === 0 && (
                            <div className="px-6 py-8 text-center text-gray-500 dark:text-gray-400">Ingen budsjettposter med aktivitet denne måneden.</div>
                        )}
                    </div>
                </div>

                <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700">
                    <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-4">Faktisk forbruk</h3>
                    <div className="h-64">
                        <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                                <Pie data={actualData} cx="50%" cy="50%" innerRadius={60} outerRadius={80} paddingAngle={5} dataKey="value">
                                    {actualData.map((entry, index) => <Cell key={`cell-${index}`} fill={entry.color} />)}
                                </Pie>
                                <Tooltip formatter={(value) => `${value.toLocaleString('no-NO')} kr`} />
                                <Legend />
                            </PieChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            </div>

            <BudgetItemDetailsModal
                isOpen={!!detailsItem}
                onClose={() => setDetailsItem(null)}
                budgetItem={detailsItem}
                selectedMonth={selectedMonth}
            />
        </div>
    );
}
