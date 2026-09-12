import { useMemo, useState } from 'react';
import { Edit2, Flame } from 'lucide-react';
import ReconcileTransactionsModal from '../accounts/ReconcileTransactionsModal';
import InfoTip from '../common/InfoTip';

/**
 * «Unødvendige kjøp» — the transactions the companion app (or the reconcile
 * dialog) flagged with isUnnecessary. Only personal transactions carry the
 * flag, hence the card lives on Min Oversikt. Read from the context's
 * transactions (already scoped to the active budget); expenses only, with
 * refunds of a flagged purchase left out so a returned item doesn't count.
 */
export default function UnnecessaryPurchasesCard({ transactions, selectedMonth, prevMonth, formatMonth, accounts, leftToSpend }) {
    const [editTransaction, setEditTransaction] = useState(null);

    const flagged = useMemo(() => {
        if (!Array.isArray(transactions)) return [];
        return transactions
            .filter(t => t.isUnnecessary && t.type === 'expense' && t.month === selectedMonth)
            .sort((a, b) => (b.amount || 0) - (a.amount || 0));
    }, [transactions, selectedMonth]);

    const total = flagged.reduce((s, t) => s + (parseFloat(t.amount) || 0), 0);
    const prevTotal = useMemo(() => (Array.isArray(transactions) ? transactions : [])
        .filter(t => t.isUnnecessary && t.type === 'expense' && t.month === prevMonth)
        .reduce((s, t) => s + (parseFloat(t.amount) || 0), 0), [transactions, prevMonth]);

    const accountName = (id) => accounts?.find(a => a.id === id)?.name || '';
    const shareOfDisposable = leftToSpend > 0 && total > 0 ? Math.round((total / leftToSpend) * 100) : null;

    return (
        <div className="bg-white dark:bg-gray-800 p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 relative overflow-hidden group">
            <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                <Flame className="w-24 h-24 text-rose-600" />
            </div>

            <div className="relative z-10">
                <div className="flex items-center mb-4">
                    <div className="p-3 bg-rose-50 dark:bg-rose-900/20 rounded-xl mr-4">
                        <Flame className="w-6 h-6 text-rose-600 dark:text-rose-400" />
                    </div>
                    <div>
                        <h3 className="text-lg font-bold text-gray-900 dark:text-white">Unødvendige kjøp</h3>
                        <p className="text-sm text-gray-500 dark:text-gray-400">Merket «unødvendig» i {formatMonth(selectedMonth)}</p>
                    </div>
                </div>

                <div className="flex justify-between items-end mb-4">
                    <div className="text-sm text-gray-600 dark:text-gray-400">
                        {flagged.length === 0
                            ? 'Ingen merkede kjøp'
                            : `${flagged.length} kjøp${shareOfDisposable !== null ? ` · ${shareOfDisposable} % av disponibelt` : ''}`}
                        {flagged.length > 0 && shareOfDisposable !== null && <InfoTip className="ml-1" text="Hvor stor del av månedens «Disponibelt» som gikk til kjøp du selv har merket som unødvendige. Ren bevisstgjøring — kjøpene teller helt normalt ellers." />}
                        <div className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                            {formatMonth(prevMonth)}: {prevTotal.toLocaleString('no-NO')} kr
                        </div>
                    </div>
                    <span className="text-3xl font-bold text-gray-900 dark:text-white">{total.toLocaleString('no-NO')} kr</span>
                </div>

                {flagged.length > 0 && (
                    <div className="border-t border-gray-100 dark:border-gray-700 pt-3 space-y-1 max-h-64 overflow-y-auto">
                        {flagged.map(t => (
                            <div key={t.id} className="flex items-center justify-between py-1.5 text-sm group/row">
                                <div className="min-w-0">
                                    <div className="font-medium text-gray-900 dark:text-gray-100 truncate">{t.name}</div>
                                    <div className="text-xs text-gray-500 dark:text-gray-400">
                                        {t.date}{accountName(t.accountId) ? ` · ${accountName(t.accountId)}` : ''}{t.comment ? ` · ${t.comment}` : ''}
                                    </div>
                                </div>
                                <div className="flex items-center gap-2 flex-shrink-0 ml-3">
                                    <span className="font-semibold text-rose-600 dark:text-rose-400">{(t.amount || 0).toLocaleString('no-NO')} kr</span>
                                    <button
                                        onClick={() => setEditTransaction(t)}
                                        className="p-1 text-gray-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg opacity-100 md:opacity-0 md:group-hover/row:opacity-100 transition-all"
                                        title="Rediger (f.eks. fjern merkingen)"
                                    >
                                        <Edit2 className="w-3.5 h-3.5" />
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            <ReconcileTransactionsModal
                isOpen={!!editTransaction}
                onClose={() => setEditTransaction(null)}
                transactions={editTransaction ? [editTransaction] : []}
                onComplete={() => setEditTransaction(null)}
            />
        </div>
    );
}
