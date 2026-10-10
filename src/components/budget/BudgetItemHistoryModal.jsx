import { X, CalendarDays } from 'lucide-react';
import { useBudget } from '../../contexts/BudgetContext';
import clsx from 'clsx';

const fmt = (n) => Math.round(n).toLocaleString('no-NO');

/** The `n` months before `month` (YYYY-MM), oldest first. */
function monthsBefore(month, n) {
    const [y, m] = month.split('-').map(Number);
    const out = [];
    for (let i = n; i >= 1; i--) {
        const d = new Date(y, m - 1 - i, 1);
        out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    }
    return out;
}

const monthLabel = (month) => {
    const [y, m] = month.split('-').map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString('no-NO', { month: 'long', year: 'numeric' });
};

/**
 * What was actually spent on one budget item, month by month for the year
 * before the selected month, with the average over the reconciled months.
 * Reconciled months count even at 0 (a seasonal post like bompenger is
 * really 0 most months); unreconciled months are left out, since their
 * numbers aren't final or the history doesn't exist yet. «Bruk» copies a month's actual (or the average) into the plan for
 * the selected month — the way to base a plan on history.
 */
export default function BudgetItemHistoryModal({ isOpen, onClose, row, selectedMonth, onUse }) {
    const { transactions, isMonthReconciled } = useBudget();
    if (!isOpen || !row) return null;

    const linked = transactions.filter(t => t.budgetItemId === row.instId);
    const perMonth = monthsBefore(selectedMonth, 12).map(month => {
        const txs = linked.filter(t => t.month === month);
        return {
            month,
            count: txs.length,
            reconciled: isMonthReconciled(month),
            actual: txs.reduce((sum, t) => (t.type === 'income' ? sum - t.amount : sum + t.amount), 0),
        };
    });
    const inAverage = perMonth.filter(r => r.reconciled);
    const average = inAverage.length ? inAverage.reduce((s, r) => s + r.actual, 0) / inAverage.length : 0;
    const maxActual = Math.max(1, ...perMonth.map(r => r.actual));

    const use = (amount) => { onUse(Math.max(0, Math.round(amount))); onClose(); };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={onClose}>
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-lg overflow-hidden animate-in fade-in zoom-in duration-200" onClick={(e) => e.stopPropagation()}>
                <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between bg-gray-50 dark:bg-gray-800/50">
                    <div className="flex items-center gap-3 min-w-0">
                        <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center flex-shrink-0">
                            <CalendarDays className="w-4 h-4" />
                        </div>
                        <div className="min-w-0">
                            <h2 className="text-lg font-bold text-gray-900 dark:text-white truncate">{row.name}</h2>
                            <p className="text-sm text-gray-500 dark:text-gray-400">Forbruk siste 12 måneder før {monthLabel(selectedMonth)}</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"><X className="w-5 h-5" /></button>
                </div>

                <div className="divide-y divide-gray-100 dark:divide-gray-700 max-h-[60vh] overflow-y-auto">
                    {perMonth.map(r => (
                        <div key={r.month} className={clsx('px-6 py-2 flex items-center gap-3', !r.reconciled && 'opacity-50')}>
                            <div className="w-32 flex-shrink-0">
                                <div className="text-sm font-medium text-gray-900 dark:text-gray-100 capitalize">{monthLabel(r.month)}</div>
                                <div className="text-[11px] text-gray-400">{r.count > 0 ? `${r.count} transaksjoner` : 'ingen transaksjoner'}{!r.reconciled && ' · ikke avstemt'}</div>
                            </div>
                            <div className="flex-1 h-2 rounded-full bg-gray-100 dark:bg-gray-700 overflow-hidden">
                                <div className="h-full bg-blue-500/70 rounded-full" style={{ width: `${Math.max(0, r.actual) / maxActual * 100}%` }} />
                            </div>
                            <div className="w-24 text-right text-sm font-semibold text-gray-900 dark:text-gray-100 tabular-nums">{fmt(r.actual)} kr</div>
                            <button onClick={() => use(r.actual)} disabled={r.count === 0}
                                className="text-xs font-medium px-2 py-1 rounded border border-gray-200 dark:border-gray-600 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 disabled:opacity-0 transition-colors"
                                title={`Sett planen for ${monthLabel(selectedMonth)} til dette beløpet`}>
                                Bruk
                            </button>
                        </div>
                    ))}
                </div>

                <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 flex items-center gap-3">
                    <div className="flex-1">
                        <div className="text-sm font-bold text-gray-900 dark:text-gray-100">Gjennomsnitt</div>
                        <div className="text-[11px] text-gray-400">
                            {inAverage.length > 0 ? `over ${inAverage.length} avstemte ${inAverage.length === 1 ? 'måned' : 'måneder'}` : 'ingen avstemte måneder i perioden'}
                        </div>
                    </div>
                    <div className="w-24 text-right text-base font-bold text-gray-900 dark:text-gray-100 tabular-nums">{fmt(average)} kr</div>
                    <button onClick={() => use(average)} disabled={inAverage.length === 0}
                        className="text-xs font-bold px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:bg-gray-300 dark:disabled:bg-gray-600 transition-colors"
                        title={`Sett planen for ${monthLabel(selectedMonth)} til gjennomsnittet`}>
                        Bruk
                    </button>
                </div>
            </div>
        </div>
    );
}
