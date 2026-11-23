import { useState } from 'react';
import { X, CalendarDays } from 'lucide-react';
import { useBudget } from '../../contexts/BudgetContext';
import { itemHistory, monthsBefore, toPlanAmount } from '../../utils/budgetHistory';
import clsx from 'clsx';

const fmt = (n) => Math.round(n).toLocaleString('no-NO');

const monthLabel = (month) => {
    const [y, m] = month.split('-').map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString('no-NO', { month: 'long', year: 'numeric' });
};

/**
 * «Plan fra snitt»: the per-item history average (BudgetItemHistoryModal's
 * «Bruk» on the average) for every budget item in one go — a starting point
 * for the selected month's plan, to be adjusted by hand afterwards.
 *
 * Lists every item that has an average to offer, with the current plan next
 * to it. Items without a plan are ticked; items that already have one are
 * left unticked so nothing typed in is overwritten unless asked for. Items
 * whose average is 0 are not listed at all: this fills amounts in, it never
 * clears a plan.
 *
 * Mounted only while open, so the selection starts fresh each time.
 */
export default function BudgetAverageFillModal({ rows, selectedMonth, onApply, onClose }) {
    const { transactions, isMonthReconciled } = useBudget();
    const [saving, setSaving] = useState(false);

    // Month statuses are household-global, so the count is the same for every item
    const reconciledCount = monthsBefore(selectedMonth).filter(isMonthReconciled).length;

    const linkedByItem = new Map();
    transactions.forEach(t => {
        if (!t.budgetItemId) return;
        if (!linkedByItem.has(t.budgetItemId)) linkedByItem.set(t.budgetItemId, []);
        linkedByItem.get(t.budgetItemId).push(t);
    });

    // No instance = nothing ever linked to the item = no history to average
    const items = rows
        .filter(r => r.instId && !r.isVirtual)
        .map(r => {
            const { average } = itemHistory(linkedByItem.get(r.instId) || [], selectedMonth, isMonthReconciled);
            const suggested = toPlanAmount(average);
            return { key: r.key, row: r, suggested, changes: suggested !== r.budgetedAmount };
        })
        .filter(i => i.suggested > 0);
    const selectable = items.filter(i => i.changes);

    const [selected, setSelected] = useState(() => new Set(selectable.filter(i => i.row.budgetedAmount === 0).map(i => i.key)));
    const chosen = selectable.filter(i => selected.has(i.key));
    const allSelected = selectable.length > 0 && chosen.length === selectable.length;

    const toggle = (key) => setSelected(prev => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key); else next.add(key);
        return next;
    });
    const toggleAll = () => setSelected(allSelected ? new Set() : new Set(selectable.map(i => i.key)));

    // Same rows as the page's «Plan» total (items «utenfor statistikk» don't count)
    const suggestedByKey = new Map(chosen.map(i => [i.key, i.suggested]));
    const counted = rows.filter(r => !r.excluded);
    const totalNow = counted.reduce((sum, r) => sum + r.budgetedAmount, 0);
    const totalAfter = counted.reduce((sum, r) => sum + (suggestedByKey.has(r.key) ? suggestedByKey.get(r.key) : r.budgetedAmount), 0);

    const apply = async () => {
        setSaving(true);
        await onApply(chosen.map(i => ({ instId: i.row.instId, amount: i.suggested })));
        onClose();
    };
    const close = () => { if (!saving) onClose(); };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={close}>
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-lg overflow-hidden animate-in fade-in zoom-in duration-200" onClick={(e) => e.stopPropagation()}>
                <div className="px-4 sm:px-6 py-4 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between bg-gray-50 dark:bg-gray-800/50">
                    <div className="flex items-center gap-3 min-w-0">
                        <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center flex-shrink-0">
                            <CalendarDays className="w-4 h-4" />
                        </div>
                        <div className="min-w-0">
                            <h2 className="text-lg font-bold text-gray-900 dark:text-white truncate">Plan fra snitt</h2>
                            <p className="text-sm text-gray-500 dark:text-gray-400">
                                {reconciledCount > 0
                                    ? `Snittforbruk over ${reconciledCount} avstemte ${reconciledCount === 1 ? 'måned' : 'måneder'} før ${monthLabel(selectedMonth)}`
                                    : `Siste 12 måneder før ${monthLabel(selectedMonth)}`}
                            </p>
                        </div>
                    </div>
                    <button onClick={close} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"><X className="w-5 h-5" /></button>
                </div>

                {items.length === 0 ? (
                    <div className="px-6 py-10 text-center text-sm text-gray-500 dark:text-gray-400">
                        {reconciledCount === 0
                            ? 'Ingen av de siste 12 månedene er avstemt, så det finnes ikke noe snitt å hente ennå.'
                            : 'Ingen budsjettposter har forbruk i de avstemte månedene.'}
                    </div>
                ) : (
                    <>
                        <div className="px-4 sm:px-6 py-2 border-b border-gray-100 dark:border-gray-700 flex items-center gap-3 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                            <input type="checkbox" checked={allSelected} onChange={toggleAll} disabled={selectable.length === 0 || saving}
                                className="w-4 h-4 rounded border-gray-300 text-blue-600 flex-shrink-0" title={allSelected ? 'Velg ingen' : 'Velg alle'} />
                            <div className="flex-1">Budsjettpost</div>
                            <div className="w-20 sm:w-24 text-right">Plan nå</div>
                            <div className="w-20 sm:w-24 text-right">Snitt</div>
                        </div>
                        <div className="divide-y divide-gray-100 dark:divide-gray-700 max-h-[55vh] overflow-y-auto">
                            {items.map(({ key, row, suggested, changes }) => {
                                const checked = selected.has(key);
                                return (
                                    <label key={key} className={clsx('px-4 sm:px-6 py-2 flex items-center gap-3', changes ? 'cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/40' : 'opacity-50')}>
                                        <input type="checkbox" checked={changes && checked} onChange={() => toggle(key)} disabled={!changes || saving}
                                            className="w-4 h-4 rounded border-gray-300 text-blue-600 flex-shrink-0" />
                                        <div className="flex-1 min-w-0">
                                            <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{row.name}</div>
                                            <div className="text-[11px] text-gray-400 truncate">{row.category}{!changes && ' · lik planen'}</div>
                                        </div>
                                        <div className={clsx('w-20 sm:w-24 text-right text-sm tabular-nums', checked && changes && row.budgetedAmount > 0 ? 'line-through text-gray-400' : 'text-gray-500 dark:text-gray-400')}>
                                            {row.budgetedAmount > 0 ? fmt(row.budgetedAmount) : '–'}
                                        </div>
                                        <div className="w-20 sm:w-24 text-right text-sm font-semibold text-gray-900 dark:text-gray-100 tabular-nums">{fmt(suggested)}</div>
                                    </label>
                                );
                            })}
                        </div>
                        <div className="px-4 sm:px-6 py-2 border-t border-gray-100 dark:border-gray-700 text-[11px] text-gray-400">
                            Poster som allerede har en plan, er ikke huket av. Huk av for å erstatte planen med snittet.
                        </div>
                    </>
                )}

                <div className="px-4 sm:px-6 py-4 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                        {items.length > 0 && (
                            <>
                                <div className="text-[11px] uppercase tracking-wider text-gray-400 font-semibold">Plan i alt</div>
                                <div className="text-sm font-bold text-gray-900 dark:text-gray-100 tabular-nums">
                                    {totalAfter !== totalNow && <span className="font-normal text-gray-400">{fmt(totalNow)} → </span>}{fmt(totalAfter)} kr
                                </div>
                            </>
                        )}
                    </div>
                    <button onClick={close} disabled={saving} className="px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition-colors">
                        Avbryt
                    </button>
                    <button onClick={apply} disabled={chosen.length === 0 || saving}
                        className="px-3 py-2 text-sm font-bold rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:bg-gray-300 dark:disabled:bg-gray-600 transition-colors">
                        {saving ? 'Lagrer…' : chosen.length > 0 ? `Bruk snitt på ${chosen.length} ${chosen.length === 1 ? 'post' : 'poster'}` : 'Bruk snitt'}
                    </button>
                </div>
            </div>
        </div>
    );
}
