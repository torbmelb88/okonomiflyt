import { useState } from 'react';
import { X, Plus } from 'lucide-react';
import clsx from 'clsx';
import { refundStatus, allocationsTotal, allocationComplete, parseAmount } from '../../utils/refunds';

/**
 * Splits one incoming payment across one or more purchases. The allocations
 * must add up to the payment — the remainder line and «Legg resten på …»
 * keep that honest. Each purchase awaiting refund gets its own «Ferdig
 * refundert» toggle (default: this allocation covers what is outstanding).
 *
 * allocations: [{ transactionId, amount (string), complete (bool|null) }]
 */
export default function RefundAllocationEditor({ income, allocations, onChange, candidates, allTransactions, accounts, lockedIds = [] }) {
    const [search, setSearch] = useState('');
    const [adding, setAdding] = useState(false);

    const total = allocationsTotal(allocations);
    const rest = Math.round(((income?.amount || 0) - total) * 100) / 100;
    const fmt = (n) => (Math.round(n * 100) / 100).toLocaleString('no-NO');
    const txById = (id) => allTransactions.find(t => t.id === id);
    const accountName = (id) => accounts.find(a => a.id === id)?.name || '';

    const update = (id, patch) => onChange(allocations.map(a => a.transactionId === id ? { ...a, ...patch } : a));
    const remove = (id) => onChange(allocations.filter(a => a.transactionId !== id));
    const defaultAmount = (t) => {
        const info = refundStatus(t, allTransactions);
        const want = t.awaitingRefund ? Math.max(0, info.expected - info.refunded) : t.amount;
        const room = Math.max(0, rest);
        const v = room > 0 ? Math.min(want, room) : want;
        return String(Math.round(v * 100) / 100);
    };
    const add = (t) => {
        onChange([...allocations, { transactionId: t.id, amount: defaultAmount(t), complete: null }]);
        setAdding(false);
        setSearch('');
    };
    const putRestOn = () => {
        if (allocations.length === 0 || rest <= 0) return;
        const biggest = [...allocations].sort((a, b) => parseAmount(b.amount) - parseAmount(a.amount))[0];
        update(biggest.transactionId, { amount: String(Math.round((parseAmount(biggest.amount) + rest) * 100) / 100) });
    };

    const selectedIds = new Set(allocations.map(a => a.transactionId));
    const addable = candidates
        .filter(t => !selectedIds.has(t.id))
        .filter(t => !search || t.name.toLowerCase().includes(search.toLowerCase()))
        .slice(0, 20);

    return (
        <div className="space-y-2">
            <p className="text-xs text-gray-600 dark:text-gray-400">
                Fordel <span className="font-semibold">{fmt(income?.amount || 0)} kr</span> på kjøpene innbetalingen dekker. Summen må gå opp — legg overskytende på et av kjøpene (det blir «overrefundert»).
            </p>

            {allocations.map(a => {
                const t = txById(a.transactionId);
                if (!t) return null;
                const info = refundStatus(t, allTransactions);
                const outstanding = Math.max(0, info.expected - info.refunded);
                const complete = allocationComplete(a, t, allTransactions);
                return (
                    <div key={a.transactionId} className="bg-white dark:bg-gray-800 rounded-lg border border-gray-100 dark:border-gray-700 px-3 py-2 space-y-1.5">
                        <div className="flex items-center justify-between gap-2">
                            <span className="min-w-0">
                                <span className="block text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{t.name}</span>
                                <span className="block text-xs text-gray-500 dark:text-gray-400">
                                    {t.date}{accountName(t.accountId) ? ` • ${accountName(t.accountId)}` : ''} • kjøp {fmt(t.amount)} kr
                                    {t.awaitingRefund && ` • utestående ${fmt(outstanding)} kr`}
                                </span>
                            </span>
                            <span className="flex items-center gap-1.5 whitespace-nowrap">
                                <input
                                    type="number" inputMode="decimal" min="0" step="0.01"
                                    value={a.amount}
                                    onChange={(e) => update(a.transactionId, { amount: e.target.value })}
                                    className="w-24 text-sm text-right px-2 py-1 border border-teal-200 dark:border-teal-700 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-teal-400 outline-none"
                                />
                                <span className="text-xs text-gray-500">kr</span>
                                {!lockedIds.includes(a.transactionId) && (
                                    <button onClick={() => remove(a.transactionId)} title="Fjern fra fordelingen" className="p-1 text-gray-400 hover:text-red-600 rounded"><X className="w-3.5 h-3.5" /></button>
                                )}
                            </span>
                        </div>
                        {t.awaitingRefund && (
                            <label className="flex items-center gap-2 text-xs text-gray-700 dark:text-gray-300">
                                <input type="checkbox" checked={complete} onChange={(e) => update(a.transactionId, { complete: e.target.checked })} className="w-3.5 h-3.5 text-teal-600 border-gray-300 rounded focus:ring-teal-500 dark:bg-gray-700 dark:border-gray-600" />
                                Ferdig refundert etter denne — kjøpet venter ikke på flere innbetalinger
                            </label>
                        )}
                    </div>
                );
            })}

            <div className={clsx("flex items-center justify-between text-xs px-1", Math.abs(rest) < 0.005 ? "text-green-700 dark:text-green-300" : rest < 0 ? "text-red-600 dark:text-red-400" : "text-amber-700 dark:text-amber-300")}>
                <span>Fordelt {fmt(total)} av {fmt(income?.amount || 0)} kr{Math.abs(rest) >= 0.005 && (rest > 0 ? ` · rest ${fmt(rest)} kr` : ` · ${fmt(-rest)} kr for mye`)}</span>
                {rest >= 0.005 && allocations.length > 0 && (
                    <button onClick={putRestOn} className="hover:underline font-medium">Legg resten på det største kjøpet</button>
                )}
            </div>

            {adding ? (
                <div className="space-y-1.5">
                    <input
                        type="text" value={search} onChange={(e) => setSearch(e.target.value)} autoFocus
                        placeholder="Søk i kjøp..."
                        className="w-full text-sm px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white outline-none focus:ring-2 focus:ring-teal-400"
                    />
                    <div className="max-h-48 overflow-y-auto divide-y divide-gray-100 dark:divide-gray-700 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800">
                        {addable.length === 0 && <p className="p-3 text-sm text-gray-500 dark:text-gray-400">Ingen flere kjøp funnet.</p>}
                        {addable.map(t => {
                            const info = refundStatus(t, allTransactions);
                            return (
                                <button key={t.id} onClick={() => add(t)} className="w-full text-left px-3 py-2 flex items-center justify-between gap-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                                    <span className="min-w-0">
                                        <span className="block font-medium text-gray-900 dark:text-gray-100 truncate">{t.name}</span>
                                        <span className="block text-xs text-gray-500 dark:text-gray-400">{t.date}{accountName(t.accountId) ? ` • ${accountName(t.accountId)}` : ''}</span>
                                        {t.awaitingRefund && (
                                            <span className="inline-flex items-center mt-0.5 px-1.5 py-0.5 rounded bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-300 text-[10px] font-bold uppercase tracking-wider">
                                                Venter refusjon · {fmt(info.refunded)} av {fmt(info.expected)} kr
                                            </span>
                                        )}
                                    </span>
                                    <span className="font-semibold text-red-600 dark:text-red-400 whitespace-nowrap">-{fmt(t.amount)} kr</span>
                                </button>
                            );
                        })}
                    </div>
                    <button onClick={() => { setAdding(false); setSearch(''); }} className="w-full py-1 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700">Avbryt</button>
                </div>
            ) : (
                <button onClick={() => setAdding(true)} className="w-full py-2 border-2 border-dashed border-teal-200 dark:border-teal-800 rounded-lg text-teal-700 dark:text-teal-300 text-sm font-medium hover:bg-teal-50 dark:hover:bg-teal-900/20 transition-colors flex items-center justify-center gap-1.5">
                    <Plus className="w-4 h-4" />Legg til et kjøp til i fordelingen
                </button>
            )}
        </div>
    );
}
