import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useBudget } from '../../contexts/BudgetContext';
import { ArrowRight, Scale, Loader2, PiggyBank, CheckCircle2, AlertTriangle, ArrowLeftRight } from 'lucide-react';
import BufferCard from './BufferCard';
import InfoTip from '../common/InfoTip';
import { totalBufferContributionPerParty } from '../../utils/bufferPlan';
import { reconcileState } from '../../utils/reconciliation';
import { coveredByAccountOf, computeSplit, readRoundingMode } from '../../utils/settlement';
import { coverIssues } from '../../utils/coverage';

/**
 * Oppgjør = settlement. Household-level, always the shared budget: what each
 * party transfers (utils/settlement.js computeSplit — the same computation
 * Min Oversikt shows), «betales fra andre kontoer», the buffer plan, the
 * gjennomreise red flag and the month-reconciled toggle.
 */
export default function Oppgjor() {
    const { sharedBudget, accounts, allProjects, allTransactions, currentUser, loading, monthStatuses, isMonthReconciled } = useBudget();
    const [selectedMonth, setSelectedMonth] = useState(() => {
        const now = new Date();
        now.setMonth(now.getMonth() - 1); // previous month — what you settle now
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    });
    const roundingMode = readRoundingMode();

    const formatMonth = (m) => { const [y, mo] = m.split('-'); return new Date(y, parseInt(mo) - 1).toLocaleDateString('no-NO', { month: 'long', year: 'numeric' }); };
    const changeMonth = (delta) => { const [y, mo] = selectedMonth.split('-').map(Number); const d = new Date(y, mo - 1 + delta); setSelectedMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`); };
    const accountName = (id) => accounts.find(a => a.id === id)?.name || 'Konto';
    const fmt = (n) => Math.round(n).toLocaleString('no-NO');

    // Buffer on the shared bill account(s): target vs. balance, and the
    // build-up plan whose equal per-party extra rides on top of the settlement.
    const parties = sharedBudget?.members?.length || 2;
    const bufferAccounts = useMemo(
        () => sharedBudget
            ? accounts.filter(a => a.isBillAccount && a.bufferTarget > 0 && (a.defaultBudgetId || a.budgetId) === sharedBudget.id)
            : [],
        [accounts, sharedBudget]
    );
    const bufferPerParty = totalBufferContributionPerParty(bufferAccounts, selectedMonth, parties);

    const split = useMemo(
        () => computeSplit({ transactions: allTransactions, sharedBudget, accounts, projects: allProjects, month: selectedMonth, userUid: currentUser?.uid, roundingMode }),
        [allTransactions, sharedBudget, accounts, allProjects, selectedMonth, currentUser, roundingMode]
    );

    // Set on Transaksjoner, where the work is done; read here.
    const monthReconciled = isMonthReconciled(selectedMonth);
    const reconciledAt = monthStatuses.find(ms => ms.month === selectedMonth)?.reconciledAt;
    // Rows the month can't really close on, shown as a hint under the status.
    const pending = useMemo(() => {
        const states = allTransactions.filter(t => t.month === selectedMonth).map(reconcileState);
        return {
            booked: states.filter(s => s === 'booked').length,
            unreconciled: states.filter(s => s === 'unreconciled').length,
        };
    }, [allTransactions, selectedMonth]);
    // Transfers on gjennomreise whose payment is missing or doesn't add up.
    const coverProblems = useMemo(() => coverIssues(allTransactions, selectedMonth), [allTransactions, selectedMonth]);
    const coverProblemCount = coverProblems.reduce((s, g) => s + g.expenses.length, 0);
    const pendingCount = pending.booked + pending.unreconciled + coverProblemCount;

    const coveredFromList = useMemo(() => {
        const byAcc = {};
        // The covering account comes from the row itself or from its project
        for (const t of allTransactions.filter(t => t.month === selectedMonth)) {
            const id = coveredByAccountOf(t, allProjects);
            if (!id) continue;
            if (!byAcc[id]) byAcc[id] = { accountId: id, total: 0, items: [] };
            byAcc[id].total += (t.type === 'income' ? -1 : 1) * (parseFloat(t.amount) || 0);
            byAcc[id].items.push(t);
        }
        return Object.values(byAcc);
    }, [allTransactions, selectedMonth, allProjects]);

    if (loading) return <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400 py-8 justify-center"><Loader2 className="w-5 h-5 animate-spin" /> Beregner oppgjør…</div>;

    // Render helper (not a component, so it is not recreated per render)
    const partyCard = ({ title, share, amount, utlegg, utleggLabel }) => (
        <div className="p-4 bg-purple-50 dark:bg-purple-900/20 rounded-lg border border-purple-100 dark:border-purple-800">
            <div className="text-sm text-gray-600 dark:text-gray-400">{title} ({(share * 100).toFixed(0)}%)</div>
            <div className="text-2xl font-bold text-gray-900 dark:text-gray-100">{fmt(amount)} kr</div>
            {Math.abs(utlegg) >= 0.5 && (
                <div className="text-xs text-orange-600 dark:text-orange-400 mt-1">
                    {utlegg > 0 ? `Inkl. ${utleggLabel} −${fmt(utlegg)} kr` : `Inkl. felles innbetaling mottatt privat +${fmt(-utlegg)} kr`}
                </div>
            )}
            {bufferPerParty > 0 && (
                <div className="text-xs text-purple-700 dark:text-purple-300 mt-1 flex items-center gap-1">
                    <PiggyBank className="w-3 h-3" /> + bufferoppbygging {fmt(bufferPerParty)} kr = <span className="font-semibold">{fmt(amount + bufferPerParty)} kr</span> å overføre
                </div>
            )}
        </div>
    );

    return (
        <div className="max-w-4xl mx-auto space-y-6">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-purple-50 dark:bg-purple-900/20 rounded-lg">
                        <Scale className="w-6 h-6 text-purple-600 dark:text-purple-400" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Oppgjør</h1>
                        <p className="text-sm text-gray-500 dark:text-gray-400">Fellesbudsjettet, hele husholdningen</p>
                    </div>
                </div>
                <div className="flex items-center space-x-2 bg-white dark:bg-gray-800 p-2 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700">
                    <button onClick={() => changeMonth(-1)} className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"><ArrowRight className="w-5 h-5 transform rotate-180 text-gray-500" /></button>
                    <span className="text-sm font-semibold capitalize min-w-[120px] text-center text-gray-900 dark:text-white">{formatMonth(selectedMonth)}</span>
                    <button onClick={() => changeMonth(1)} className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"><ArrowRight className="w-5 h-5 text-gray-500" /></button>
                </div>
            </div>

            {/* Fordeling av Fellesutgifter */}
            {sharedBudget ? (
                <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700">
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">Fordeling av Fellesutgifter
                            <InfoTip text="Det hver av dere skal overføre: egen andel av fellesutgiftene etter fordelingsnøkkelen, minus utlegg dere allerede har lagt ut — rundet opp etter innstillingen for avrunding. Bufferoppbygging kommer i tillegg og vises som egen linje. Bare kjøp som er knyttet til en budsjettpost er med. Samme tall som «Andel fellesutgifter» på Min Oversikt." />
                        </h3>
                        <span className="text-sm text-purple-700 dark:text-purple-300 font-medium flex items-center gap-1">{split.splitLabel} · {(split.userShare * 100).toFixed(0)}% / {(split.partnerShare * 100).toFixed(0)}%
                            <InfoTip text="Fordelingsnøkkelen fra Innstillinger for fellesbudsjettet. «Basert på inntekt» bruker inntektene som er lagt inn der; er ingen registrert, deles det 50/50." />
                        </span>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {partyCard({ title: 'Du betaler', share: split.userShare, amount: split.userAmount, utlegg: split.utleggSelf, utleggLabel: 'dine utlegg' })}
                        {partyCard({ title: 'Partner betaler', share: split.partnerShare, amount: split.partnerAmount, utlegg: split.utleggPartner, utleggLabel: 'partners utlegg' })}
                    </div>
                    <div className="flex justify-between items-center text-sm pt-4 mt-4 border-t border-gray-100 dark:border-gray-700">
                        <span className="text-gray-600 dark:text-gray-400 flex items-center gap-1">Fordeles:
                            <InfoTip text="Summen som fordeles mellom dere denne måneden. Uavstemte kjøp og alt som holdes utenfor oppgjør (på transaksjon, prosjekt eller konto) er ikke med. Dette er ikke det samme som forbruket på Budsjett-siden, som teller alle poster." />
                        </span>
                        <span className="font-medium dark:text-gray-200">{split.total.toLocaleString('no-NO', { maximumFractionDigits: 0 })} kr</span>
                    </div>
                </div>
            ) : (
                <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 px-6 py-8 text-center text-gray-500 dark:text-gray-400">
                    Ingen fellesbudsjett funnet — fordelingen vises når du har et felles budsjett.
                </div>
            )}

            {/* Betales fra andre kontoer */}
            {coveredFromList.length > 0 && (
                <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700">
                    <h3 className="text-lg font-bold text-gray-900 dark:text-white">Betales fra andre kontoer</h3>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">Overfør til felles regningskonto ({formatMonth(selectedMonth)})</p>
                    <div className="space-y-3">
                        {coveredFromList.map(g => (
                            <div key={g.accountId} className="border border-gray-100 dark:border-gray-700 rounded-lg p-3">
                                <div className="flex justify-between items-center mb-2">
                                    <span className="font-medium text-gray-900 dark:text-gray-100">Fra {accountName(g.accountId)}</span>
                                    <span className="font-bold text-gray-900 dark:text-gray-100">{fmt(g.total)} kr</span>
                                </div>
                                <div className="space-y-1">
                                    {g.items.map(t => (
                                        <div key={t.id} className="flex justify-between text-xs text-gray-500 dark:text-gray-400">
                                            <span className="truncate mr-2">{t.date} · {t.name}</span>
                                            <span className="flex-shrink-0">{fmt(t.amount)} kr</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Buffer på felles regningskonto */}
            {bufferAccounts.map(a => (
                <BufferCard key={a.id} account={a} parties={parties} settlementMonth={selectedMonth} />
            ))}

            {/* Rødt flagg: penger som skulle komme inn og gå videre, men ikke henger sammen */}
            {coverProblems.length > 0 && (
                <div className="bg-red-50 dark:bg-red-900/20 p-6 rounded-xl border border-red-200 dark:border-red-800">
                    <div className="flex items-center gap-3 mb-1">
                        <AlertTriangle className="w-6 h-6 text-red-600 dark:text-red-400 flex-shrink-0" />
                        <h3 className="text-lg font-bold text-red-800 dark:text-red-200">Gjennomreise: innbetaling mangler</h3>
                    </div>
                    <p className="text-sm text-red-700 dark:text-red-300 mb-4">
                        Disse overføringene er merket som gjennomreise, men innbetalingen er ikke koblet eller summene stemmer ikke. Sjekk at pengene faktisk kom inn, og koble dem i avstemmingen.
                    </p>
                    <div className="space-y-3">
                        {coverProblems.map((g, i) => (
                            <div key={i} className="bg-white dark:bg-gray-800 border border-red-100 dark:border-red-900/50 rounded-lg p-3">
                                <div className="text-xs font-semibold uppercase tracking-wider text-red-700 dark:text-red-300 mb-2 flex items-center gap-1.5">
                                    <ArrowLeftRight className="w-3.5 h-3.5" />
                                    {g.status === 'missing'
                                        ? 'Ingen innbetaling koblet'
                                        : `Avvik: inn ${g.in.toLocaleString('no-NO')} kr, ut ${g.out.toLocaleString('no-NO')} kr`}
                                </div>
                                <div className="space-y-1">
                                    {g.expenses.map(t => (
                                        <div key={t.id} className="flex justify-between text-sm text-gray-800 dark:text-gray-200">
                                            <span className="truncate mr-2">{t.date} · {t.name}</span>
                                            <span className="flex-shrink-0 text-red-600 dark:text-red-400">−{t.amount.toLocaleString('no-NO')} kr</span>
                                        </div>
                                    ))}
                                    {g.incomes.map(t => (
                                        <div key={t.id} className="flex justify-between text-sm text-gray-800 dark:text-gray-200">
                                            <span className="truncate mr-2">{t.date} · {t.name}</span>
                                            <span className="flex-shrink-0 text-green-600 dark:text-green-400">+{t.amount.toLocaleString('no-NO')} kr</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Månedsstatus (monthStatuses, husholdningsvid) — settes på Transaksjoner */}
            <div className={`p-4 rounded-xl border flex items-center gap-3 ${monthReconciled ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800' : 'bg-white dark:bg-gray-800 border-gray-100 dark:border-gray-700'}`}>
                {monthReconciled ? <CheckCircle2 className="w-5 h-5 text-green-600 dark:text-green-400 flex-shrink-0" /> : <AlertTriangle className="w-5 h-5 text-gray-400 flex-shrink-0" />}
                <div className="text-sm">
                    {monthReconciled ? (
                        <span className="text-green-800 dark:text-green-200">
                            <span className="capitalize font-medium">{formatMonth(selectedMonth)}</span> er markert som avstemt{reconciledAt ? ` ${new Date(reconciledAt).toLocaleDateString('no-NO', { day: 'numeric', month: 'long' })}` : ''}.
                        </span>
                    ) : (
                        <span className="text-gray-600 dark:text-gray-400">
                            <span className="capitalize font-medium">{formatMonth(selectedMonth)}</span> er ikke markert som avstemt ennå
                            {pendingCount > 0 && <span className={coverProblemCount > 0 ? 'text-red-600 dark:text-red-400' : 'text-orange-600 dark:text-orange-400'}> ({pendingCount} {pendingCount === 1 ? 'rad venter' : 'rader venter'})</span>}
                            . Det gjøres på <Link to="/transaksjoner" className="underline">Transaksjoner</Link> når alle radene er håndtert.
                        </span>
                    )}
                </div>
            </div>
        </div>
    );
}
