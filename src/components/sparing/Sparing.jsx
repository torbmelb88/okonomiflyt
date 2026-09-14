import { useEffect, useMemo, useState } from 'react';
import { PiggyBank, TrendingUp, Loader2, Users, Wallet } from 'lucide-react';
import { useBudget } from '../../contexts/BudgetContext';
import { api } from '../../services/firebase';
import InfoTip from '../common/InfoTip';

const datesClose = (d1, d2, tol = 4) => Math.ceil(Math.abs(new Date(d2) - new Date(d1)) / 86400000) <= tol;

const formatMonth = (m) => {
    const [y, mo] = m.split('-');
    return new Date(y, parseInt(mo) - 1).toLocaleDateString('no-NO', { month: 'short', year: 'numeric' });
};

/**
 * Sparing = savings overview for the ACTIVE budget: the savings accounts
 * whose default budget is the one selected in the header (accounts without
 * a budget show in every budget, like legacy projects). Shows current
 * balance (from the sb1Accounts snapshot) and contributions over time —
 * incoming transfers detected by pairing an incoming on a savings account
 * with an outgoing of the same amount on another account. The pairing looks
 * at every transaction, since the outgoing leg may sit in another budget.
 */
export default function Sparing() {
    const { accounts, activeBudget, bankBalances, loading } = useBudget();
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

    const items = useMemo(() => {
        if (!allTx || !activeBudget) return [];
        const balanceFor = (a) => a.sb1AccountKey ? bankBalances.find(b => b.sb1AccountKey === a.sb1AccountKey) : null;
        const inBudget = (a) => {
            const id = a.defaultBudgetId || a.budgetId;
            return !id || id === activeBudget.id;
        };

        return accounts.filter(a => a.type === 'Sparing' && inBudget(a)).map(acc => {
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
                total: contributions.reduce((s, c) => s + c.amount, 0),
                months: Object.entries(byMonth).sort((a, b) => b[0].localeCompare(a[0])),
            };
        });
    }, [allTx, accounts, activeBudget, bankBalances]);

    if (loading) return <div>Laster sparing...</div>;
    if (!activeBudget) return <div>Ingen budsjett valgt.</div>;

    const isShared = activeBudget.type === 'shared';
    const totalBalance = items.reduce((s, p) => s + (typeof p.bal?.balance === 'number' ? p.bal.balance : 0), 0);
    const totalContributed = items.reduce((s, p) => s + p.total, 0);

    return (
        <div className="space-y-6">
            <div className="flex items-center gap-3">
                <div className="p-2 bg-green-50 dark:bg-green-900/20 rounded-lg">
                    <PiggyBank className="w-6 h-6 text-green-600 dark:text-green-400" />
                </div>
                <div>
                    <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Sparing</h1>
                    <p className="text-sm text-gray-500 dark:text-gray-400 flex items-center gap-1.5">
                        {isShared ? <Users className="w-4 h-4 text-purple-500" /> : <Wallet className="w-4 h-4 text-blue-500" />}
                        Sparekontoer i {activeBudget.name} — bytt budsjett øverst for å se de andre.
                    </p>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700">
                    <div className="text-sm text-gray-500 dark:text-gray-400 flex items-center gap-1">Total sparesaldo
                        <InfoTip text="Saldo hentet fra banken for sparekontoene i dette budsjettet. Kontoer som ikke er koblet til SpareBank 1 vises som «—» og teller ikke med." />
                    </div>
                    <div className="text-3xl font-bold text-gray-900 dark:text-white mt-1">{Math.round(totalBalance).toLocaleString('no-NO')} kr</div>
                </div>
                <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700">
                    <div className="text-sm text-gray-500 dark:text-gray-400 flex items-center gap-1"><TrendingUp className="w-4 h-4" /> Innskutt (registrerte bidrag)
                        <InfoTip text="Bare overføringer appen klarte å pare: en innbetaling på sparekontoen med et likt uttak fra en annen konto innen fire dager. Renter og innskudd uten motpost telles ikke." />
                    </div>
                    <div className="text-3xl font-bold text-gray-900 dark:text-white mt-1">{Math.round(totalContributed).toLocaleString('no-NO')} kr</div>
                </div>
            </div>

            {allTx === null ? (
                <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400 py-6 justify-center"><Loader2 className="w-5 h-5 animate-spin" /> Beregner bidrag…</div>
            ) : items.length === 0 ? (
                <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 px-6 py-10 text-center text-gray-500 dark:text-gray-400">
                    Ingen sparekontoer i {activeBudget.name} ennå. Sett en konto til type «Sparing» med dette budsjettet som standard (eller importer den fra banken).
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {items.map(({ acc, bal, total, months }) => (
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
            )}
        </div>
    );
}
