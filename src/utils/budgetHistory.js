/**
 * Spending history for a budget item — the basis for «plan from history» on
 * the Budsjett page. Shared by the per-item history modal and the fill-all
 * modal so both show the same average.
 */

export const HISTORY_MONTHS = 12;

/** The `n` months before `month` (YYYY-MM), oldest first. */
export function monthsBefore(month, n = HISTORY_MONTHS) {
    const [y, m] = month.split('-').map(Number);
    const out = [];
    for (let i = n; i >= 1; i--) {
        const d = new Date(y, m - 1 - i, 1);
        out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    }
    return out;
}

/**
 * What was actually spent on one budget item, month by month for the year
 * before `month`, with the average over the reconciled months.
 *
 * `linked` is the item's transactions (any month). Refunds/income linked to
 * the item count negative. Reconciled months count even at 0 (a seasonal
 * post like bompenger is really 0 most months); unreconciled months are left
 * out, since their numbers aren't final or the history doesn't exist yet.
 */
export function itemHistory(linked, month, isMonthReconciled) {
    const perMonth = monthsBefore(month).map(m => {
        const txs = linked.filter(t => t.month === m);
        return {
            month: m,
            count: txs.length,
            reconciled: isMonthReconciled(m),
            actual: txs.reduce((sum, t) => (t.type === 'income' ? sum - t.amount : sum + t.amount), 0),
        };
    });
    const inAverage = perMonth.filter(r => r.reconciled);
    const average = inAverage.length ? inAverage.reduce((s, r) => s + r.actual, 0) / inAverage.length : 0;
    return { perMonth, reconciledCount: inAverage.length, average };
}

/** A historical figure as a planned amount: whole kroner, never negative. */
export const toPlanAmount = (amount) => Math.max(0, Math.round(amount));
