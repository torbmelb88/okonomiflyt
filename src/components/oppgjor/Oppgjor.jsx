import { useEffect, useMemo, useState } from 'react';
import { useBudget } from '../../contexts/BudgetContext';
import { ArrowRight, Scale, Loader2 } from 'lucide-react';
import { api } from '../../services/firebase';

/**
 * Oppgjør = settlement. Household-level, identical regardless of which budget is
 * active: the shared-expense split (moved from Forbruk) and the "covered from
 * other accounts" overview (moved from Min Oversikt). Always computed for the
 * shared budget, across all transactions.
 */
export default function Oppgjor() {
    const { budgets, accounts, currentUser, loading } = useBudget();
    const [allTx, setAllTx] = useState(null);
    const [selectedMonth, setSelectedMonth] = useState(() => {
        const now = new Date();
        now.setMonth(now.getMonth() - 1); // previous month — what you settle now
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    });
    const roundingMode = parseInt(localStorage.getItem('roundingMode') || '1');

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try { const t = await api.getCollection('transactions'); if (!cancelled) setAllTx(t); }
            catch { if (!cancelled) setAllTx([]); }
        })();
        return () => { cancelled = true; };
    }, []);

    const formatMonth = (m) => { const [y, mo] = m.split('-'); return new Date(y, parseInt(mo) - 1).toLocaleDateString('no-NO', { month: 'long', year: 'numeric' }); };
    const changeMonth = (delta) => { const [y, mo] = selectedMonth.split('-').map(Number); const d = new Date(y, mo - 1 + delta); setSelectedMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`); };
    const accountName = (id) => accounts.find(a => a.id === id)?.name || 'Konto';

    const sharedBudget = budgets.find(b => b.type === 'shared');

    const split = useMemo(() => {
        if (!allTx || !sharedBudget) return null;
        const accountExcludesSplit = (accountId) => !!accounts.find(a => a.id === accountId)?.excludeFromSharedCalc;
        const isExcluded = (t) => !t.budgetItemId || t.excludeFromSharedCalc || accountExcludesSplit(t.accountId);
        const monthTx = allTx.filter(t => t.budgetId === sharedBudget.id && t.month === selectedMonth && !isExcluded(t));
        // Income-type transactions (credit notes/refunds) reduce the settlement
        const sum = (arr) => arr.reduce((s, t) => s + (t.type === 'income' ? -1 : 1) * (parseFloat(t.amount) || 0), 0);
        const totalSharedActual = sum(monthTx.filter(t => !t.payer || t.payer === 'shared'));
        const selfActual = sum(monthTx.filter(t => t.payer === 'self'));
        const partnerActual = sum(monthTx.filter(t => t.payer === 'partner'));
        const utleggSelf = sum(monthTx.filter(t => t.paidPrivatelyBy === 'self'));
        const utleggPartner = sum(monthTx.filter(t => t.paidPrivatelyBy === 'partner'));
        const totalActualConsumption = totalSharedActual + selfActual + partnerActual;

        let userShare = 0.5, splitLabel = 'Basert på inntekt';
        const totalIncome = sharedBudget.members?.reduce((s, m) => s + (m.income || 0), 0) || 0;
        const userIncome = sharedBudget.members?.find(m => m.uid === currentUser?.uid)?.income || 0;
        const method = sharedBudget.splitMethod || 'income';
        if (method === '5050') { userShare = 0.5; splitLabel = '50 / 50'; }
        else if (method === 'custom') { userShare = (sharedBudget.customUserShare || 50) / 100; splitLabel = `Egendefinert (${sharedBudget.customUserShare || 50} / ${100 - (sharedBudget.customUserShare || 50)})`; }
        else { userShare = totalIncome > 0 ? userIncome / totalIncome : 0.5; }
        const partnerShare = 1 - userShare;

        const rawUser = totalSharedActual * userShare + selfActual - utleggSelf;
        const rawPartner = totalSharedActual * partnerShare + partnerActual - utleggPartner;
        const userAmount = roundingMode > 1 ? Math.ceil(rawUser / roundingMode) * roundingMode : Math.round(rawUser);
        const partnerAmount = roundingMode > 1 ? Math.ceil(rawPartner / roundingMode) * roundingMode : Math.round(rawPartner);

        return { userShare, partnerShare, userAmount, partnerAmount, splitLabel, utleggSelf, utleggPartner, totalActualConsumption };
    }, [allTx, sharedBudget, accounts, selectedMonth, currentUser, roundingMode]);

    const coveredFromList = useMemo(() => {
        if (!allTx) return [];
        const byAcc = {};
        for (const t of allTx.filter(t => t.coveredByAccountId && t.month === selectedMonth)) {
            const id = t.coveredByAccountId;
            if (!byAcc[id]) byAcc[id] = { accountId: id, total: 0, items: [] };
            byAcc[id].total += (t.type === 'income' ? -1 : 1) * (parseFloat(t.amount) || 0);
            byAcc[id].items.push(t);
        }
        return Object.values(byAcc);
    }, [allTx, selectedMonth]);

    if (loading) return <div>Laster oppgjør...</div>;

    return (
        <div className="max-w-4xl mx-auto space-y-6">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-purple-50 dark:bg-purple-900/20 rounded-lg">
                        <Scale className="w-6 h-6 text-purple-600 dark:text-purple-400" />
                    </div>
                    <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Oppgjør</h1>
                </div>
                <div className="flex items-center space-x-2 bg-white dark:bg-gray-800 p-2 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700">
                    <button onClick={() => changeMonth(-1)} className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"><ArrowRight className="w-5 h-5 transform rotate-180 text-gray-500" /></button>
                    <span className="text-sm font-semibold capitalize min-w-[120px] text-center text-gray-900 dark:text-white">{formatMonth(selectedMonth)}</span>
                    <button onClick={() => changeMonth(1)} className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"><ArrowRight className="w-5 h-5 text-gray-500" /></button>
                </div>
            </div>

            {allTx === null ? (
                <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400 py-8 justify-center"><Loader2 className="w-5 h-5 animate-spin" /> Beregner oppgjør…</div>
            ) : (
                <>
                    {/* Fordeling av Fellesutgifter */}
                    {sharedBudget && split ? (
                        <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700">
                            <div className="flex items-center justify-between mb-4">
                                <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">Fordeling av Fellesutgifter</h3>
                                <span className="text-sm text-purple-700 dark:text-purple-300 font-medium">{split.splitLabel} · {(split.userShare * 100).toFixed(0)}% / {(split.partnerShare * 100).toFixed(0)}%</span>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="p-4 bg-purple-50 dark:bg-purple-900/20 rounded-lg border border-purple-100 dark:border-purple-800">
                                    <div className="text-sm text-gray-600 dark:text-gray-400">Du betaler ({(split.userShare * 100).toFixed(0)}%)</div>
                                    <div className="text-2xl font-bold text-gray-900 dark:text-gray-100">{split.userAmount.toLocaleString('no-NO')} kr</div>
                                    {split.utleggSelf > 0 && <div className="text-xs text-orange-600 dark:text-orange-400 mt-1">Inkl. dine utlegg −{split.utleggSelf.toLocaleString('no-NO')} kr</div>}
                                </div>
                                <div className="p-4 bg-purple-50 dark:bg-purple-900/20 rounded-lg border border-purple-100 dark:border-purple-800">
                                    <div className="text-sm text-gray-600 dark:text-gray-400">Partner betaler ({(split.partnerShare * 100).toFixed(0)}%)</div>
                                    <div className="text-2xl font-bold text-gray-900 dark:text-gray-100">{split.partnerAmount.toLocaleString('no-NO')} kr</div>
                                    {split.utleggPartner > 0 && <div className="text-xs text-orange-600 dark:text-orange-400 mt-1">Inkl. partners utlegg −{split.utleggPartner.toLocaleString('no-NO')} kr</div>}
                                </div>
                            </div>
                            <div className="flex justify-between items-center text-sm pt-4 mt-4 border-t border-gray-100 dark:border-gray-700">
                                <span className="text-gray-600 dark:text-gray-400">Faktisk forbruk:</span>
                                <span className="font-medium dark:text-gray-200">{split.totalActualConsumption.toLocaleString('no-NO', { maximumFractionDigits: 0 })} kr</span>
                            </div>
                        </div>
                    ) : (
                        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 px-6 py-8 text-center text-gray-500 dark:text-gray-400">
                            Ingen fellesbudsjett funnet — fordelingen vises når du har et felles budsjett.
                        </div>
                    )}

                    {/* Dekkes fra andre kontoer */}
                    {coveredFromList.length > 0 && (
                        <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700">
                            <h3 className="text-lg font-bold text-gray-900 dark:text-white">Dekkes fra andre kontoer</h3>
                            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">Overfør til felles regningskonto ({formatMonth(selectedMonth)})</p>
                            <div className="space-y-3">
                                {coveredFromList.map(g => (
                                    <div key={g.accountId} className="border border-gray-100 dark:border-gray-700 rounded-lg p-3">
                                        <div className="flex justify-between items-center mb-2">
                                            <span className="font-medium text-gray-900 dark:text-gray-100">Fra {accountName(g.accountId)}</span>
                                            <span className="font-bold text-gray-900 dark:text-gray-100">{Math.round(g.total).toLocaleString('no-NO')} kr</span>
                                        </div>
                                        <div className="space-y-1">
                                            {g.items.map(t => (
                                                <div key={t.id} className="flex justify-between text-xs text-gray-500 dark:text-gray-400">
                                                    <span className="truncate mr-2">{t.date} · {t.name}</span>
                                                    <span className="flex-shrink-0">{Math.round(t.amount).toLocaleString('no-NO')} kr</span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
