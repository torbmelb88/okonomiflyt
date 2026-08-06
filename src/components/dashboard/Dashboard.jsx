import { useBudget } from '../../contexts/BudgetContext';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { ArrowRight } from 'lucide-react';
import clsx from 'clsx';

export default function Dashboard() {
    const { activeBudget, expenses, transactions, loading, currentUser, getMonthlyBudget } = useBudget();

    if (loading) return <div className="p-8 text-center">Laster dashbord...</div>;
    if (!activeBudget) return <div className="p-8 text-center">Ingen budsjett valgt.</div>;

    const isShared = activeBudget.type === 'shared';

    // Calculate total expenses (all time, used for transfer need)
    const totalExpenses = expenses.reduce((sum, exp) => sum + exp.amount, 0);

    // Previous month calculations
    const now = new Date();
    const previousMonth = `${now.getFullYear()}-${String(now.getMonth()).padStart(2, '0')}`; // month index is 0‑based, so this gives the previous month
    const previousMonthName = new Date(now.getFullYear(), now.getMonth() - 1).toLocaleDateString('no-NO', { month: 'long', year: 'numeric' });

    const previousMonthTransactions = transactions.filter(t => t.month === previousMonth);

    // Budget vs actual for each expense (previous month)
    const budgetComparison = expenses.map(expense => {
        const expenseTransactions = previousMonthTransactions.filter(t => t.budgetItemId === expense.id);
        const actualAmount = expenseTransactions.reduce((sum, t) => sum + t.amount, 0);
        const monthlyBudgetInfo = getMonthlyBudget(expense.id, previousMonth);
        const budgetedAmount = monthlyBudgetInfo.amount;
        return {
            name: expense.name,
            category: expense.category,
            budgeted: budgetedAmount,
            actual: actualAmount,
            diff: budgetedAmount - actualAmount,
            percentage: budgetedAmount > 0 ? (actualAmount / budgetedAmount) * 100 : 0,
        };
    }).filter(item => item.budgeted > 0 || item.actual > 0);

    const totalBudgeted = budgetComparison.reduce((sum, item) => sum + item.budgeted, 0);
    const totalActual = budgetComparison.reduce((sum, item) => sum + item.actual, 0);
    const totalDiff = totalBudgeted - totalActual;

    // Savings (category "sparing") for previous month
    const savingsExpenses = expenses.filter(e => e.category?.toLowerCase() === 'sparing');
    const previousMonthSavingsTransactions = previousMonthTransactions.filter(t =>
        savingsExpenses.some(se => se.id === t.budgetItemId)
    );
    const totalSavings = previousMonthSavingsTransactions.reduce((sum, t) => sum + t.amount, 0);
    const savingsBudget = savingsExpenses.reduce((sum, e) => {
        const monthlyInfo = getMonthlyBudget(e.id, previousMonth);
        return sum + monthlyInfo.amount;
    }, 0);

    // Chart data: actual spending per category for previous month
    const categoriesPrev = {};
    previousMonthTransactions.forEach(t => {
        const exp = expenses.find(e => e.id === t.budgetItemId);
        if (exp) {
            const cat = exp.category || 'Annet';
            categoriesPrev[cat] = (categoriesPrev[cat] || 0) + t.amount;
        }
    });
    const data = Object.keys(categoriesPrev).map((cat, i) => ({
        name: cat,
        value: categoriesPrev[cat],
        color: ['#3b82f6', '#10b981', '#f59e0b', '#6b7280', '#8b5cf6'][i % 5],
    }));
    if (data.length === 0) {
        data.push({ name: 'Ingen utgifter', value: 1, color: '#e5e7eb' });
    }

    // Transfer need (shared vs personal)
    let transferNeed = 0;
    let splitDescription = '';
    if (isShared) {
        const totalIncome = activeBudget.members?.reduce((sum, m) => sum + (m.income || 0), 0) || 0;
        const userMember = activeBudget.members?.find(m => m.uid === currentUser?.uid);
        const userIncome = userMember?.income || 0;
        const splitRatio = totalIncome > 0 ? userIncome / totalIncome : 0.5;
        transferNeed = Math.round(totalExpenses * splitRatio);
        splitDescription = `Basert på ${(splitRatio * 100).toFixed(0)}/${(100 - (splitRatio * 100)).toFixed(0)} fordeling`;
    } else {
        const virtualExp = expenses.find(e => e.isVirtual);
        transferNeed = virtualExp ? virtualExp.amount : 0;
    }

    return (
        <div className="space-y-6">
            {/* Top Stats Card */}
            <div className="grid grid-cols-1 gap-6">
                <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="text-gray-500 text-sm font-medium">Månedlige Utgifter</h3>
                        <ArrowRight className="w-5 h-5 text-red-500" />
                    </div>
                    <div className="text-2xl font-bold text-gray-900">
                        {totalExpenses.toLocaleString('no-NO')} kr
                    </div>
                    <span className="text-gray-500">Budsjett vs Faktisk</span>
                </div>
            </div>

            {/* Savings Card (Previous Month) */}
            <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
                <div className="flex items-center justify-between mb-4">
                    <h3 className="text-gray-500 text-sm font-medium">Sparing ({previousMonthName})</h3>
                </div>
                <div className="text-2xl font-bold text-gray-900">
                    {totalSavings.toLocaleString('no-NO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kr
                </div>
                <div className="mt-2 text-xs text-gray-500">
                    {previousMonthSavingsTransactions.length} transaksjoner
                </div>
                <div className="mt-2 text-sm">
                    <span className="text-blue-600">Budsjettert: {savingsBudget.toLocaleString('no-NO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kr</span>
                    <span className="ml-4">
                        {totalSavings >= savingsBudget ? 'Spart' : 'Overforbruk'}: {Math.abs(totalSavings - savingsBudget).toLocaleString('no-NO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kr
                    </span>
                </div>
            </div>

            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                <div className="bg-blue-50 p-4 rounded-lg">
                    <div className="text-xs text-blue-600 font-medium mb-1">Budsjettert</div>
                    <div className="text-2xl font-bold text-blue-900">{totalBudgeted.toLocaleString('no-NO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kr</div>
                </div>
                <div className="bg-purple-50 p-4 rounded-lg">
                    <div className="text-xs text-purple-600 font-medium mb-1">Faktisk</div>
                    <div className="text-2xl font-bold text-purple-900">{totalActual.toLocaleString('no-NO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kr</div>
                </div>
                <div className={clsx('p-4 rounded-lg', totalDiff >= 0 ? 'bg-green-50' : 'bg-red-50')}>
                    <div className={clsx('text-xs font-medium mb-1', totalDiff >= 0 ? 'text-green-600' : 'text-red-600')}>
                        {totalDiff >= 0 ? 'Spart' : 'Overforbruk'}
                    </div>
                    <div className={clsx('text-2xl font-bold', totalDiff >= 0 ? 'text-green-900' : 'text-red-900')}>
                        {Math.abs(totalDiff).toLocaleString('no-NO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kr
                    </div>
                </div>
            </div>

            {/* Detailed Breakdown */}
            {budgetComparison.length > 0 ? (
                <div className="space-y-3">
                    <h4 className="text-sm font-semibold text-gray-700 mb-3">Detaljert oversikt</h4>
                    {budgetComparison.slice(0, 5).map((item, index) => (
                        <div key={index} className="border-b border-gray-100 pb-3 last:border-b-0">
                            <div className="flex items-center justify-between mb-2">
                                <div className="flex-1">
                                    <div className="font-medium text-gray-900">{item.name}</div>
                                    <div className="text-xs text-gray-500">{item.category}</div>
                                </div>
                                <div className="text-right ml-4">
                                    <div className="text-sm font-semibold text-gray-900">
                                        {item.actual.toLocaleString('no-NO')} / {item.budgeted.toLocaleString('no-NO')} kr
                                    </div>
                                    <div className={clsx('text-xs font-medium', item.diff >= 0 ? 'text-green-600' : 'text-red-600')}>
                                        {item.diff >= 0 ? '+' : ''}{item.diff.toLocaleString('no-NO')} kr
                                    </div>
                                </div>
                            </div>
                            <div className="w-full bg-gray-100 rounded-full h-2 overflow-hidden">
                                <div
                                    className={clsx('h-full rounded-full transition-all', item.actual > item.budgeted ? 'bg-red-500' : 'bg-blue-500')}
                                    style={{ width: `${Math.min(item.percentage, 100)}%` }}
                                />
                            </div>
                        </div>
                    ))}
                    {budgetComparison.length > 5 && (
                        <div className="text-center text-sm text-gray-500 pt-2">
                            +{budgetComparison.length - 5} flere budsjettpost{budgetComparison.length - 5 > 1 ? 'er' : ''}
                        </div>
                    )}
                </div>
            ) : (
                <div className="text-center text-gray-500 py-8">Ingen data for forrige måned</div>
            )}

            {/* Main Content Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Transfer Needs (Shared Only) or Budget Status */}
                <div className="lg:col-span-2 bg-white p-6 rounded-xl shadow-sm border border-gray-100">
                    <h3 className="text-lg font-bold text-gray-900 mb-4">
                        {isShared ? 'Overføringsbehov' : 'Budsjettstatus'}
                    </h3>
                    {isShared ? (
                        <div className="bg-purple-50 p-4 rounded-lg border border-purple-100 flex items-center justify-between">
                            <div>
                                <p className="text-sm text-purple-800 font-medium">Din andel til felleskonto</p>
                                <p className="text-xs text-purple-600 mt-1">{splitDescription}</p>
                            </div>
                            <div className="text-2xl font-bold text-purple-700">
                                {transferNeed.toLocaleString('no-NO')} kr
                            </div>
                        </div>
                    ) : (
                        <div className="bg-blue-50 p-4 rounded-lg border border-blue-100">
                            <p className="text-sm text-blue-800">
                                {transferNeed > 0
                                    ? `Du skylder ${transferNeed.toLocaleString('no-NO')} kr til felleskontoen.`
                                    : 'Alt ser bra ut!'}
                            </p>
                        </div>
                    )}
                </div>

                {/* Distribution Chart */}
                <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
                    <h3 className="text-lg font-bold text-gray-900 mb-4">Fordeling</h3>
                    <div className="h-64">
                        <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                                <Pie
                                    data={data}
                                    cx="50%"
                                    cy="50%"
                                    innerRadius={60}
                                    outerRadius={80}
                                    paddingAngle={5}
                                    dataKey="value"
                                >
                                    {data.map((entry, index) => (
                                        <Cell key={`cell-${index}`} fill={entry.color} />
                                    ))}
                                </Pie>
                                <Tooltip formatter={(value) => `${value.toLocaleString('no-NO')} kr`} />
                            </PieChart>
                        </ResponsiveContainer>
                    </div>
                    <div className="space-y-2 mt-4">
                        {data.slice(0, 5).map((item, index) => (
                            <div key={index} className="flex items-center justify-between text-sm">
                                <div className="flex items-center">
                                    <div className="w-3 h-3 rounded-full mr-2" style={{ backgroundColor: item.color }}></div>
                                    <span className="text-gray-600">{item.name}</span>
                                </div>
                                <span className="font-medium text-gray-900">{item.value} kr</span>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}
