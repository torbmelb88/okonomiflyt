import { useEffect, useMemo, useState } from 'react';
import { PiggyBank, TrendingUp, Loader2, Users, Wallet } from 'lucide-react';
import { useBudget } from '../../contexts/BudgetContext';
import { api } from '../../services/firebase';

const datesClose = (d1, d2, tol = 4) => Math.ceil(Math.abs(new Date(d2) - new Date(d1)) / 86400000) <= tol;

const formatMonth = (m) => {
    const [y, mo] = m.split('-');
    return new Date(y, parseInt(mo) - 1).toLocaleDateString('no-NO', { month: 'short', year: 'numeric' });
};

/**
 * Sparing = savings overview, grouped by the account's default budget so felles
 * and privat savings are kept apart. Shows current balance (from the
 * sb1Accounts snapshot) and contributions over time — incoming transfers
 * detected by pairing an incoming on a savings account with an outgoing of the
 * same amount on another account.
 */
export default function Sparing() {
    const { accounts, budgets, bankBalances, loading } = useBudget();
    const [allTx, setAllTx] = useState(null);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const t = await api.getCollection('transactions');
                if (!cancelled) setAllTx(t);
            } catch {
                if (!cancelled) setAllTx([]);
            }
        })();
        return () => { cancelled = true; };
    }, []);

    const groups = useMemo(() => {
        if (!allTx) return [];
        const balanceFor = (a) => a.sb1AccountKey ? bankBalances.find(b => b.sb1AccountKey === a.sb1AccountKey) : null;
        const budgetById = new Map(budgets.map(b => [b.id, b]));

        const perAccount = accounts.filter(a => a.type === 'Sparing').map(acc => {
            const incoming = allTx.filter(t => t.accountId === acc.id && t.type === 'income');
            const contributions = incoming.filter(inc => allTx.some(t =>
                t.accountId !== acc.id && t.type === 'expense' &&
                Math.abs((t.amount || 0) - (inc.amount || 0)) < 0.01 &&
                t.date && datesClose(t.date, inc.date)
            ));
            const byMonth = {};
            contributions.forEach(c => { const m = (c.date || '').slice(0, 7); byMonth[m] = (byMonth[m] || 0) + c.amount; });
            return {
                acc, bal: balanceFor(acc),
                budgetId: acc.defaultBudgetId || acc.budgetId || '__none__',
                total: contributions.reduce((s, c) => s + c.amount, 0),
                months: Object.entries(byMonth).sort((a, b) => b[0].localeCompare(a[0])),
            };
        });

        // Group by budget (felles / privat / uten)
        const map = new Map();
        for (const p of perAccount) {
            if (!map.has(p.budgetId)) {
                const b = budgetById.get(p.budgetId);
                map.set(p.budgetId, { budgetId: p.budgetId, name: b?.name || 'Uten budsjett', type: b?.type || null, items: [] });
            }
            map.get(p.budgetId).items.push(p);
        }
        // Shared budgets first, then personal, then none
        const order = { shared: 0, personal: 1 };
        return [...map.values()].sort((a, b) => (order[a.type] ?? 2) - (order[b.type] ?? 2));
    }, [allTx, accounts, budgets, bankBalances]);

    if (loading) return <div>Laster sparing...</div>;

    const allItems = groups.flatMap(g => g.items);
    const totalBalance = allItems.reduce((s, p) => s + (typeof p.bal?.balance === 'number' ? p.bal.balance : 0), 0);
    const totalContributed = allItems.reduce((s, p) => s + p.total, 0);

    return (
        <div className="space-y-6">
            <div className="flex items-center gap-3">
                <div className="p-2 bg-green-50 dark:bg-green-900/20 rounded-lg">
                    <PiggyBank className="w-6 h-6 text-green-600 dark:text-green-400" />
                </div>
                <div>
                    <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Sparing</h1>
                    <p className="text-sm text-gray-500 dark:text-gray-400">Saldo og bidrag over tid, delt på felles og privat.</p>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700">
                    <div className="text-sm text-gray-500 dark:text-gray-400">Total sparesaldo</div>
                    <div className="text-3xl font-bold text-gray-900 dark:text-white mt-1">{Math.round(totalBalance).toLocaleString('no-NO')} kr</div>
                </div>
                <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700">
                    <div className="text-sm text-gray-500 dark:text-gray-400 flex items-center gap-1"><TrendingUp className="w-4 h-4" /> Innskutt (registrerte bidrag)</div>
                    <div className="text-3xl font-bold text-gray-900 dark:text-white mt-1">{Math.round(totalContributed).toLocaleString('no-NO')} kr</div>
                </div>
            </div>

            {allTx === null ? (
                <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400 py-6 justify-center"><Loader2 className="w-5 h-5 animate-spin" /> Beregner bidrag…</div>
            ) : allItems.length === 0 ? (
                <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 px-6 py-10 text-center text-gray-500 dark:text-gray-400">
                    Ingen sparekontoer ennå. Sett en konto til type «Sparing» (eller importer den fra banken).
                </div>
            ) : (
                groups.map(group => {
                    const groupBalance = group.items.reduce((s, p) => s + (typeof p.bal?.balance === 'number' ? p.bal.balance : 0), 0);
                    return (
                        <div key={group.budgetId} className="space-y-3">
                            <div className="flex items-center justify-between">
                                <h2 className="flex items-center gap-2 text-lg font-bold text-gray-900 dark:text-white">
                                    {group.type === 'shared' ? <Users className="w-5 h-5 text-purple-500" /> : <Wallet className="w-5 h-5 text-blue-500" />}
                                    {group.name}
                                </h2>
                                <span className="text-sm font-medium text-gray-600 dark:text-gray-300">{Math.round(groupBalance).toLocaleString('no-NO')} kr</span>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {group.items.map(({ acc, bal, total, months }) => (
                                    <div key={acc.id} className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
                                        <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-700">
                                            <div className="flex items-center justify-between">
                                                <h3 className="font-bold text-gray-900 dark:text-gray-100">{acc.name}</h3>
                                                <span className="text-xl font-bold text-gray-900 dark:text-gray-100">
                                                    {typeof bal?.balance === 'number' ? `${bal.balance.toLocaleString('no-NO')} ${bal.currency || 'kr'}` : '—'}
                                                </span>
                                            </div>
                                            <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">Innskutt totalt: {Math.round(total).toLocaleString('no-NO')} kr</div>
                                        </div>
                                        <div className="divide-y divide-gray-100 dark:divide-gray-700 max-h-64 overflow-y-auto">
                                            {months.length > 0 ? months.map(([m, amt]) => (
                                                <div key={m} className="flex items-center justify-between px-6 py-2.5 text-sm">
                                                    <span className="text-gray-600 dark:text-gray-400 capitalize">{formatMonth(m)}</span>
                                                    <span className="font-medium text-green-600 dark:text-green-400">+{Math.round(amt).toLocaleString('no-NO')} kr</span>
                                                </div>
                                            )) : (
                                                <div className="px-6 py-6 text-center text-sm text-gray-400 dark:text-gray-500">Ingen registrerte bidrag ennå.</div>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    );
                })
            )}
        </div>
    );
}
