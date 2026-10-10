import { useBudget } from '../../contexts/BudgetContext';
import { useAuth } from '../../contexts/AuthContext';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts';
import { DollarSign, Users, ArrowRight, CalendarDays, List } from 'lucide-react';
import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import BudgetItemDetailsModal from './BudgetItemDetailsModal';
import BudgetItemHistoryModal from './BudgetItemHistoryModal';
import BudgetToggle from '../common/BudgetToggle';
import { isVirtualExpense, SCOPE_LABEL } from '../../utils/categoryMigration';
import { computeSplit, readRoundingMode } from '../../utils/settlement';
import InfoTip from '../common/InfoTip';
import clsx from 'clsx';
import { useDialog } from '../../contexts/DialogContext';

const PIE_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#6b7280', '#ef4444'];
const fmt = (n) => Math.round(n).toLocaleString('no-NO');

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
 * Budsjett = plan and actual for one month, one budget, in one table:
 * every budget item with its planned amount (editable), what was actually
 * spent (transactions linked to it, refunds net) and the difference.
 *
 * Budget items are created in Innstillinger and auto-included here by scope.
 * The planned amount is per month only (monthlyBudgets) — there is no
 * standard amount on the item, so a figure typed into one month never leaks
 * into another. The calendar button next to the amount shows the last year's
 * actual spending on the item (and the average) to base the plan on. The
 * per-budget instance (expense) is materialized lazily the first time an
 * amount is set or a transaction is linked. Items flagged «utenfor
 * statistikk» stay in the table (greyed) but out of the totals and the pie.
 */
export default function Budget() {
    const { notify } = useDialog();
    const {
        activeBudget, expenses, transactions, allTransactions, categories, budgetItemDefs, loading, accounts, allProjects, sharedBudget,
        addExpense, getMonthlyBudget, setMonthlyBudget,
    } = useBudget();
    const { currentUser } = useAuth();

    const [selectedBudgetItem, setSelectedBudgetItem] = useState(null);
    const [historyRow, setHistoryRow] = useState(null);
    const [pieMode, setPieMode] = useState('actual'); // 'plan' | 'actual'
    const [selectedMonth, setSelectedMonth] = useState(() => {
        const now = new Date();
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    });

    // My share of the shared budget this month — the actual behind the
    // virtual «Min andel felles» row on a personal budget.
    const split = useMemo(
        () => computeSplit({ transactions: allTransactions, sharedBudget, accounts, projects: allProjects, month: selectedMonth, userUid: currentUser?.uid, roundingMode: readRoundingMode() }),
        [allTransactions, sharedBudget, accounts, allProjects, selectedMonth, currentUser]
    );

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
    // «Utenfor statistikk» on the def or its category (Innstillinger)
    const defExcluded = (def) => {
        if (!def) return false;
        if (def.excludeFromStats) return true;
        return !!categories.find(c => c.id === def.categoryId)?.excludeFromStats;
    };
    const actualFor = (instId) => {
        const linked = transactions.filter(t => t.budgetItemId === instId && t.month === selectedMonth);
        return {
            actual: linked.reduce((sum, t) => (t.type === 'income' ? sum - t.amount : sum + t.amount), 0),
            count: linked.length,
        };
    };

    // Auto-included defs (by scope) -> rows, with the per-budget instance if any
    const eligibleDefs = budgetItemDefs.filter(d => d.scope === 'both' || d.scope === budgetScope);
    const defRows = eligibleDefs.map(def => {
        const inst = expenses.find(e => e.defId === def.id && !isVirtualExpense(e));
        const budgetedAmount = inst ? getMonthlyBudget(inst.id, selectedMonth).amount : 0;
        const { actual, count } = inst ? actualFor(inst.id) : { actual: 0, count: 0 };
        return {
            key: `def-${def.id}`, defId: def.id, instId: inst?.id || null,
            name: def.name, category: catName(def.categoryId), scope: def.scope,
            budgetedAmount, isVirtual: false,
            actual, count, excluded: defExcluded(def),
        };
    });

    // Anything not represented by a def row: legacy (no defId) or the injected
    // virtual shared-share. Kept so nothing disappears from the plan.
    const usedInstIds = new Set(defRows.filter(r => r.instId).map(r => r.instId));
    const extraRows = expenses.filter(e => !usedInstIds.has(e.id)).map(e => {
        const def = e.defId ? budgetItemDefs.find(d => d.id === e.defId) : null;
        const virtual = isVirtualExpense(e);
        const { actual, count } = virtual ? { actual: split.userAmount, count: split.rows.length } : actualFor(e.id);
        return {
            key: `exp-${e.id}`, defId: e.defId || null, instId: virtual ? null : e.id,
            name: e.name, category: virtual ? 'Felles' : (def ? catName(def.categoryId) : (e.category || 'Annet')), scope: def?.scope || null,
            budgetedAmount: getMonthlyBudget(e.id, selectedMonth).amount, isVirtual: virtual,
            actual, count, excluded: defExcluded(def),
        };
    });

    const rows = [...defRows, ...extraRows].sort((a, b) =>
        a.category.localeCompare(b.category, 'no-NO') || a.name.localeCompare(b.name, 'no-NO'));
    const counted = rows.filter(r => !r.excluded);
    const totalBudgeted = counted.reduce((sum, r) => sum + r.budgetedAmount, 0);
    const totalActual = counted.reduce((sum, r) => sum + r.actual, 0);
    const totalDiff = totalBudgeted - totalActual;

    // Pie by category: plan or actual, same rows as the totals
    const byCat = {};
    counted.forEach(r => {
        const v = pieMode === 'plan' ? r.budgetedAmount : r.actual;
        if (v > 0) byCat[r.category] = (byCat[r.category] || 0) + v;
    });
    const pieData = Object.keys(byCat)
        .map((cat, i) => ({ name: cat, value: byCat[cat], color: cat === 'Felles' ? '#8b5cf6' : PIE_COLORS[i % PIE_COLORS.length] }))
        .filter(d => d.value > 0);
    if (pieData.length === 0) pieData.push({ name: 'Ingen data', value: 1, color: '#e5e7eb' });

    // Sets this month's planned amount for the row (0 removes it). The
    // per-budget instance is created on the fly for a def that has none yet.
    const commitAmount = async (row, newAmount) => {
        if (row.isVirtual) return;
        try {
            let instId = row.instId;
            if (!instId) {
                const ref = await addExpense({ defId: row.defId, name: row.name, category: row.category });
                instId = ref?.id;
            }
            if (instId) await setMonthlyBudget(instId, selectedMonth, newAmount);
        } catch (e) {
            console.error('Failed to set amount', e);
            notify({ message: 'Kunne ikke lagre beløp: ' + e.message, variant: 'error' });
        }
    };

    const diffCls = (d) => d < 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400';

    return (
        <div className="space-y-6">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                <div className="flex items-center gap-3">
                    <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Budsjett</h1>
                    <BudgetToggle />
                </div>
                <div className="flex gap-2">
                    <Link to="/transaksjoner" className="flex items-center gap-2 px-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 font-medium shadow-sm text-sm">
                        <List className="w-4 h-4" /><span className="hidden sm:inline">Til transaksjoner</span>
                    </Link>
                </div>
            </div>

            {/* Month nav + totals */}
            <div className="bg-white dark:bg-gray-800 p-4 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700">
                <div className="flex items-center justify-between">
                    <button onClick={() => changeMonth(-1)} className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full transition-colors">
                        <ArrowRight className="w-5 h-5 transform rotate-180 text-gray-600 dark:text-gray-400" />
                    </button>
                    <div className="text-center flex-1 mx-4">
                        <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 capitalize">{formatMonth(selectedMonth)}</h2>
                        <span className="text-sm text-gray-500 dark:text-gray-400">{activeBudget.name}</span>
                    </div>
                    <div className="hidden md:flex items-center space-x-6">
                        {[
                            { label: 'Plan', text: `${fmt(totalBudgeted)} kr`, cls: 'text-gray-900 dark:text-gray-100' },
                            { label: 'Brukt', text: `${fmt(totalActual)} kr`, cls: 'text-gray-900 dark:text-gray-100' },
                            { label: totalDiff < 0 ? 'Over' : 'Igjen', text: `${fmt(Math.abs(totalDiff))} kr`, cls: diffCls(totalDiff) },
                        ].map((item, i) => (
                            <div key={item.label} className={clsx('text-right', i > 0 && 'pl-6 border-l border-gray-200 dark:border-gray-700')}>
                                <div className="text-xs text-gray-400 uppercase tracking-wider mb-0.5">{item.label}</div>
                                <div className={clsx('font-bold text-lg', item.cls)}>{item.text}</div>
                            </div>
                        ))}
                        <InfoTip text="Plan legges inn måned for måned — et beløp gjelder bare måneden du står i. Kalenderknappen ved beløpet viser hva posten faktisk har kostet de siste 12 månedene, med gjennomsnitt. Budsjettposter opprettes i Innstillinger. Samme rader og samme filter for alle tre tallene: poster merket «utenfor statistikk» (Innstillinger) står i tabellen, men telles ikke. Brukt = transaksjoner knyttet til postene, refusjoner trukket fra; uavstemte transaksjoner er ikke med før de er avstemt. På et privat budsjett er «Min andel felles» din andel av fellesutgiftene denne måneden, samme tall som Oppgjør." />
                    </div>
                    <button onClick={() => changeMonth(1)} className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full transition-colors ml-2">
                        <ArrowRight className="w-5 h-5 text-gray-600 dark:text-gray-400" />
                    </button>
                </div>
                <div className="md:hidden grid grid-cols-3 gap-2 mt-4 pt-4 border-t border-gray-100 dark:border-gray-700 text-center">
                    <div><div className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">Plan</div><div className="text-sm font-bold text-gray-900 dark:text-gray-100">{fmt(totalBudgeted)}</div></div>
                    <div className="border-l border-gray-200 dark:border-gray-700"><div className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">Brukt</div><div className="text-sm font-bold text-gray-900 dark:text-gray-100">{fmt(totalActual)}</div></div>
                    <div className="border-l border-gray-200 dark:border-gray-700"><div className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">{totalDiff < 0 ? 'Over' : 'Igjen'}</div><div className={clsx('text-sm font-bold', diffCls(totalDiff))}>{fmt(Math.abs(totalDiff))}</div></div>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Table: plan / actual / diff */}
                <div className="lg:col-span-2 bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
                    <div className="hidden md:grid px-6 py-3 border-b border-gray-100 dark:border-gray-700 grid-cols-12 gap-2 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                        <div className="col-span-5">Budsjettpost</div>
                        <div className="col-span-3 text-right">Plan</div>
                        <div className="col-span-2 text-right">Brukt</div>
                        <div className="col-span-2 text-right">Avvik</div>
                    </div>
                    <div className="divide-y divide-gray-100 dark:divide-gray-700">
                        {rows.length > 0 ? rows.map((row) => {
                            const diff = row.budgetedAmount - row.actual;
                            return (
                                <div key={row.key} className={clsx('px-4 md:px-6 py-3 grid grid-cols-12 gap-2 items-center', row.excluded && 'opacity-60')}>
                                    <button
                                        onClick={() => row.instId && setSelectedBudgetItem({ ...expenses.find(e => e.id === row.instId), budgetedAmount: row.budgetedAmount })}
                                        disabled={!row.instId}
                                        className={clsx('col-span-12 md:col-span-5 flex items-center space-x-3 min-w-0 text-left', row.instId && 'hover:text-blue-600 dark:hover:text-blue-400')}
                                        title={row.instId ? 'Vis transaksjonene på posten' : undefined}
                                    >
                                        <div className={clsx('w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0', row.isVirtual ? 'bg-purple-100 text-purple-600' : 'bg-blue-100 text-blue-600')}>
                                            {row.isVirtual ? <Users className="w-4 h-4" /> : <DollarSign className="w-4 h-4" />}
                                        </div>
                                        <div className="min-w-0">
                                            <div className="font-medium text-gray-900 dark:text-gray-100 truncate">{row.name}</div>
                                            <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
                                                {row.category}
                                                {row.count > 0 && <span> · {row.count} transaksjoner</span>}
                                                {row.scope === 'both' && <span className="ml-1 text-purple-500">· {SCOPE_LABEL.both}</span>}
                                                {row.excluded && <span className="ml-1 text-gray-400" title="Merket «utenfor statistikk» i Innstillinger — telles ikke i summene eller kakediagrammet">· utenfor statistikk</span>}
                                            </div>
                                        </div>
                                    </button>
                                    <div className="col-span-6 md:col-span-3 flex items-center justify-end gap-1">
                                        {!row.isVirtual && (
                                            <button onClick={() => setHistoryRow(row)} disabled={!row.instId}
                                                className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded transition-colors disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-gray-400"
                                                title={row.instId ? 'Vis forbruket siste 12 måneder' : 'Ingen historikk ennå'}>
                                                <CalendarDays className="w-4 h-4" />
                                            </button>
                                        )}
                                        {row.isVirtual ? (
                                            <span className="w-24 text-right font-medium text-gray-700 dark:text-gray-300 pr-2">{fmt(row.budgetedAmount)} kr</span>
                                        ) : (
                                            <BudgetAmountInput value={row.budgetedAmount} onCommit={(amt) => commitAmount(row, amt)} className="w-24 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded px-2 py-1 text-right text-sm" />
                                        )}
                                    </div>
                                    <div className="col-span-3 md:col-span-2 text-right text-sm font-semibold text-gray-900 dark:text-gray-100">
                                        <span className="md:hidden text-[10px] uppercase text-gray-400 mr-1">Brukt</span>{fmt(row.actual)}
                                    </div>
                                    <div className={clsx('col-span-3 md:col-span-2 text-right text-sm', diffCls(diff))}>
                                        {row.budgetedAmount === 0 && row.actual === 0 ? <span className="text-gray-300 dark:text-gray-600">–</span> : `${diff < 0 ? '−' : '+'}${fmt(Math.abs(diff))}`}
                                    </div>
                                </div>
                            );
                        }) : (
                            <div className="text-center text-gray-500 dark:text-gray-400 py-8">
                                Ingen budsjettposter for dette budsjettet ennå. Opprett dem i Innstillinger → Kategorier &amp; budsjettposter.
                            </div>
                        )}
                    </div>
                </div>

                {/* Pie: plan or actual */}
                <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700">
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">Fordeling
                            <InfoTip text="Gruppert etter budsjettpostens kategori. Poster med null eller negativt beløp vises ikke." />
                        </h3>
                        <div className="inline-flex rounded-lg border border-gray-200 dark:border-gray-700 p-0.5 text-xs font-medium">
                            {[['actual', 'Brukt'], ['plan', 'Plan']].map(([m, label]) => (
                                <button key={m} onClick={() => setPieMode(m)} className={clsx('px-2.5 py-1 rounded-md', pieMode === m ? 'bg-blue-600 text-white' : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700')}>{label}</button>
                            ))}
                        </div>
                    </div>
                    <div className="h-64">
                        <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                                <Pie data={pieData} cx="50%" cy="50%" innerRadius={60} outerRadius={80} paddingAngle={5} dataKey="value">
                                    {pieData.map((entry, index) => <Cell key={`cell-${index}`} fill={entry.color} />)}
                                </Pie>
                                <Tooltip formatter={(value) => `${value.toLocaleString('no-NO')} kr`} />
                                <Legend />
                            </PieChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            </div>

            <BudgetItemHistoryModal isOpen={!!historyRow} onClose={() => setHistoryRow(null)} row={historyRow} selectedMonth={selectedMonth} onUse={(amt) => commitAmount(historyRow, amt)} />
            <BudgetItemDetailsModal isOpen={!!selectedBudgetItem} onClose={() => setSelectedBudgetItem(null)} budgetItem={selectedBudgetItem} selectedMonth={selectedMonth} />
        </div>
    );
}
