import { useState, useEffect, useMemo } from 'react';
import { PiggyBank, AlertTriangle, CheckCircle2, Landmark, X, Info, TrendingDown } from 'lucide-react';
import {
    ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine,
} from 'recharts';
import { useBudget } from '../../contexts/BudgetContext';
import { useTheme } from '../../contexts/ThemeContext';
import { api } from '../../services/firebase';
import {
    bufferBalanceFor, bufferContributionPerParty, makeBufferPlan,
    planEndMonth, planMonthIndex, addMonths, historyPoints, monthlyLows,
} from '../../utils/bufferPlan';

const kr = (n) => `${Math.round(n).toLocaleString('no-NO')} kr`;
const formatMonth = (m) => {
    const [y, mo] = m.split('-');
    return new Date(y, parseInt(mo) - 1).toLocaleDateString('no-NO', { month: 'long', year: 'numeric' });
};

/**
 * Buffer status for one bill account (regningskonto) with a bufferTarget:
 * target vs. bank balance, and the build-up plan that adds an equal extra per
 * party to the settlement for N months. Lives on Oppgjør because that is
 * where the parties agree on what to transfer.
 *
 * `settlementMonth` = the month currently shown on Oppgjør (consumption month
 * being settled) — a new plan starts there.
 */
export default function BufferCard({ account, parties, settlementMonth }) {
    const { bankBalances, updateAccount } = useBudget();
    const { theme } = useTheme();
    const [months, setMonths] = useState(3);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    // Daily balance snapshots from the sync (sb1BalanceHistory) — the month's
    // lowest point is the buffer's real verdict, since the balance dips right
    // before the monthly top-up and a single "today" number hides that.
    const [history, setHistory] = useState(null);

    useEffect(() => {
        if (!account.sb1AccountKey) { setHistory([]); return; }
        let cancelled = false;
        (async () => {
            try {
                const docs = await api.queryCollection('sb1BalanceHistory', 'sb1AccountKey', account.sb1AccountKey);
                if (!cancelled) setHistory(historyPoints(docs));
            } catch (err) {
                console.error('Could not load balance history', err);
                if (!cancelled) setHistory([]);
            }
        })();
        return () => { cancelled = true; };
    }, [account.sb1AccountKey]);

    const chartPoints = useMemo(() => (history || []).slice(-92), [history]);
    const lows = useMemo(() => monthlyLows(history || []), [history]);

    const target = account.bufferTarget || 0;
    const balance = bufferBalanceFor(account, bankBalances);
    const gap = balance == null ? null : Math.max(0, target - balance);
    const plan = account.bufferPlan || null;
    const planActive = plan && planMonthIndex(plan, settlementMonth) >= 0;
    const planFinished = plan && !planActive && settlementMonth > planEndMonth(plan);
    const perParty = bufferContributionPerParty(plan, settlementMonth, parties);
    const previewPerParty = gap ? Math.ceil(Math.ceil(gap / Math.max(1, months)) / Math.max(1, parties)) : 0;

    const startPlan = async () => {
        if (!gap) return;
        setSaving(true); setError('');
        try {
            await updateAccount(account.id, { bufferPlan: makeBufferPlan({ gap, months, startMonth: settlementMonth }) });
        } catch (err) {
            console.error('Could not save buffer plan', err);
            setError('Kunne ikke lagre planen.');
        } finally { setSaving(false); }
    };

    const endPlan = async () => {
        setSaving(true); setError('');
        try {
            await updateAccount(account.id, { bufferPlan: null });
        } catch (err) {
            console.error('Could not end buffer plan', err);
            setError('Kunne ikke avslutte planen.');
        } finally { setSaving(false); }
    };

    const ok = gap === 0;
    const pct = balance != null && target > 0 ? Math.min(100, Math.max(0, (balance / target) * 100)) : 0;

    return (
        <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700">
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                    <div className={`p-2 rounded-lg ${ok ? 'bg-green-50 dark:bg-green-900/20' : 'bg-amber-50 dark:bg-amber-900/20'}`}>
                        <PiggyBank className={`w-5 h-5 ${ok ? 'text-green-600 dark:text-green-400' : 'text-amber-600 dark:text-amber-400'}`} />
                    </div>
                    <div>
                        <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">Buffer på {account.name}</h3>
                        <p className="text-sm text-gray-500 dark:text-gray-400">Mål {kr(target)} — dekker regninger som forfaller før neste påfyll</p>
                    </div>
                </div>
                {balance != null && (
                    ok
                        ? <span className="flex items-center gap-1 text-sm font-medium text-green-700 dark:text-green-300"><CheckCircle2 className="w-4 h-4" /> Bufferen er på plass</span>
                        : <span className="flex items-center gap-1 text-sm font-medium text-amber-700 dark:text-amber-300"><AlertTriangle className="w-4 h-4" /> Mangler {kr(gap)}</span>
                )}
            </div>

            {balance == null ? (
                <div className="flex items-start gap-2 text-sm text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-700/40 rounded-lg p-3">
                    <Landmark className="w-4 h-4 mt-0.5 flex-shrink-0" />
                    Ingen saldo fra banken for denne kontoen ennå — knytt den til SpareBank 1 (Kontoer → Importer fra bank) for å sammenligne mot bufferen.
                </div>
            ) : (
                <>
                    <div className="grid grid-cols-3 gap-3 text-sm mb-3">
                        <div>
                            <div className="text-xs text-gray-500 dark:text-gray-400">Saldo (bank)</div>
                            <div className="font-semibold text-gray-900 dark:text-gray-100">{kr(balance)}</div>
                        </div>
                        <div>
                            <div className="text-xs text-gray-500 dark:text-gray-400">Ønsket buffer</div>
                            <div className="font-semibold text-gray-900 dark:text-gray-100">{kr(target)}</div>
                        </div>
                        <div>
                            <div className="text-xs text-gray-500 dark:text-gray-400">Avvik</div>
                            <div className={`font-semibold ${ok ? 'text-green-700 dark:text-green-300' : 'text-amber-700 dark:text-amber-300'}`}>{ok ? '0 kr' : `−${kr(gap)}`}</div>
                        </div>
                    </div>
                    <div className="h-2 rounded-full bg-gray-100 dark:bg-gray-700 overflow-hidden mb-4">
                        <div className={`h-full rounded-full ${ok ? 'bg-green-500' : 'bg-amber-500'}`} style={{ width: `${pct}%` }} />
                    </div>
                    <p className="text-xs text-gray-400 dark:text-gray-500 flex items-start gap-1 mb-4">
                        <Info className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                        Saldoen svinger gjennom måneden — sammenlign helst rett før påfyll, når månedens regninger er trukket.
                    </p>
                </>
            )}

            {/* Plan */}
            {plan ? (
                <div className="border border-purple-100 dark:border-purple-800 bg-purple-50 dark:bg-purple-900/20 rounded-lg p-4">
                    <div className="flex items-start justify-between gap-3">
                        <div className="text-sm">
                            <div className="font-semibold text-gray-900 dark:text-gray-100">
                                Oppbyggingsplan: {kr(plan.monthlyTotal)} per måned i {plan.months} måneder
                            </div>
                            <div className="text-gray-600 dark:text-gray-400 mt-0.5">
                                {kr(Math.ceil(plan.monthlyTotal / Math.max(1, parties)))} per part · gjelder oppgjørene for {formatMonth(plan.startMonth)} – {formatMonth(planEndMonth(plan))}
                                {' '}(startet med {kr(plan.gapAtStart)} manglende)
                            </div>
                            <div className="mt-1 text-xs">
                                {planActive && (
                                    <span className="text-purple-700 dark:text-purple-300 font-medium">
                                        Måned {planMonthIndex(plan, settlementMonth) + 1} av {plan.months} — {kr(perParty)} per part legges på oppgjøret for {formatMonth(settlementMonth)}.
                                    </span>
                                )}
                                {planFinished && <span className="text-gray-500 dark:text-gray-400">Planen er ferdig. {ok ? 'Bufferen er nådd — du kan avslutte den.' : 'Bufferen er fortsatt ikke nådd — avslutt og lag en ny plan.'}</span>}
                                {!planActive && !planFinished && <span className="text-gray-500 dark:text-gray-400">Planen starter med oppgjøret for {formatMonth(plan.startMonth)}.</span>}
                            </div>
                        </div>
                        <button onClick={endPlan} disabled={saving} className="flex items-center gap-1 text-xs px-2 py-1 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-white dark:hover:bg-gray-700 whitespace-nowrap">
                            <X className="w-3 h-3" /> Avslutt plan
                        </button>
                    </div>
                </div>
            ) : (gap > 0 && (
                <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-4">
                    <div className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-2">Spar opp bufferen via oppgjøret</div>
                    <div className="flex flex-wrap items-center gap-3 text-sm">
                        <span className="text-gray-600 dark:text-gray-400">Fordel {kr(gap)} over</span>
                        <input
                            type="number" min="1" max="24" value={months}
                            onChange={(e) => setMonths(Math.max(1, parseInt(e.target.value) || 1))}
                            className="w-20 px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white"
                        />
                        <span className="text-gray-600 dark:text-gray-400">måneder og {parties} parter</span>
                        <span className="text-gray-400">→</span>
                        <span className="font-bold text-gray-900 dark:text-gray-100">{kr(previewPerParty)} ekstra per part per måned</span>
                    </div>
                    <div className="flex items-center justify-between mt-3">
                        <span className="text-xs text-gray-500 dark:text-gray-400">
                            Første måned: oppgjøret for {formatMonth(settlementMonth)}, siste: {formatMonth(addMonths(settlementMonth, months - 1))}. Beløpet legges på «Du betaler» / «Partner betaler» og på Min Oversikt.
                        </span>
                        <button onClick={startPlan} disabled={saving} className="ml-3 px-4 py-2 bg-purple-600 text-white text-sm font-medium rounded-lg hover:bg-purple-700 whitespace-nowrap disabled:bg-gray-300">
                            {saving ? 'Lagrer…' : 'Start plan'}
                        </button>
                    </div>
                </div>
            ))}

            {error && <p className="text-sm text-red-600 mt-2">{error}</p>}

            {/* Historikk: daglig saldo mot mål, og laveste punkt per måned */}
            {chartPoints.length >= 2 && (
                <div className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-700">
                    <div className="flex items-center gap-2 mb-3">
                        <TrendingDown className="w-4 h-4 text-gray-400" />
                        <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Saldo dag for dag</h4>
                        <span className="text-xs text-gray-400">mot buffermålet — bunnpunktet rett før påfyll er fasiten</span>
                    </div>
                    <div className="h-44">
                        <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={chartPoints} margin={{ top: 5, right: 8, left: 0, bottom: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.2} vertical={false} />
                                <XAxis
                                    dataKey="date"
                                    fontSize={11}
                                    tickLine={false}
                                    tickFormatter={(d) => `${d.slice(8, 10)}.${d.slice(5, 7)}`}
                                    minTickGap={28}
                                    stroke="#9ca3af"
                                />
                                <YAxis
                                    fontSize={11}
                                    tickLine={false}
                                    width={52}
                                    domain={[0, 'auto']}
                                    tickFormatter={(v) => v >= 1000 ? `${Math.round(v / 1000)}k` : v}
                                    stroke="#9ca3af"
                                />
                                <Tooltip
                                    formatter={(value) => [kr(value), 'Saldo']}
                                    labelFormatter={(d) => `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}`}
                                    contentStyle={theme === 'dark'
                                        ? { backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: 8, color: '#f3f4f6' }
                                        : { borderRadius: 8 }}
                                    labelStyle={theme === 'dark' ? { color: '#f3f4f6' } : undefined}
                                />
                                <ReferenceLine
                                    y={target}
                                    stroke="#f59e0b"
                                    strokeDasharray="6 4"
                                    label={{ value: 'Mål', position: 'insideTopRight', fontSize: 11, fill: '#f59e0b' }}
                                />
                                <Line type="monotone" dataKey="balance" stroke="#3b82f6" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                            </LineChart>
                        </ResponsiveContainer>
                    </div>

                    {lows.length > 0 && (
                        <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-2">
                            {lows.slice(0, 3).map(m => {
                                const met = m.low >= target;
                                return (
                                    <div key={m.month} className={`rounded-lg border p-2.5 text-sm ${met ? 'border-green-100 dark:border-green-900 bg-green-50/60 dark:bg-green-900/15' : 'border-amber-100 dark:border-amber-900 bg-amber-50/60 dark:bg-amber-900/15'}`}>
                                        <div className="text-xs text-gray-500 dark:text-gray-400 capitalize">{formatMonth(m.month)}{m.days < 15 ? ' (delvis)' : ''}</div>
                                        <div className="font-semibold text-gray-900 dark:text-gray-100">Lavest {kr(m.low)}</div>
                                        <div className={`text-xs ${met ? 'text-green-700 dark:text-green-300' : 'text-amber-700 dark:text-amber-300'}`}>
                                            {met ? `${kr(m.low - target)} over målet` : `${kr(target - m.low)} under målet`} · {m.date.slice(8, 10)}.{m.date.slice(5, 7)}.
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
