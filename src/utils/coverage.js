// Pass-through money («dekkes av innbetaling»): an outgoing transfer that is
// funded by an incoming payment on the same account, e.g. barnetrygd landing
// on the joint bill account and going straight on to the child's savings
// account and the joint account. Neither leg is anyone's consumption, so
// both are kept out of the settlement (Oppgjør) and the transfer sums in
// Min Oversikt — but only once the incoming payment is actually linked.
// The whole point is verification: an expense flagged as covered without a
// linked income is a red flag, and so is a group whose amounts don't add up.
//
// Model: the expense carries `coveredByIncoming: true` and
// `coveredByTransactionIds: [incomeId, …]`. The income side stores nothing —
// which incomes are "covering" is derived from the expenses. Links are
// many-to-many (one barnetrygd covers two transfers; a transfer may be
// covered by two payments), so the amount check runs per connected group.
// An income auto-reconciled by a link gets `reconciledByCover: true` so an
// unlink can put it back to «uavstemt» without touching rows the user
// reconciled themselves.

export const isCoveredExpense = (t) => t?.type === 'expense' && !!t.coveredByIncoming;

export const coverLinkIds = (t) => Array.isArray(t?.coveredByTransactionIds) ? t.coveredByTransactionIds : [];

/** Ids of every income referenced by a covered expense. */
export function coveringIncomeIds(all) {
    const ids = new Set();
    for (const t of Array.isArray(all) ? all : []) {
        if (isCoveredExpense(t)) coverLinkIds(t).forEach(id => ids.add(id));
    }
    return ids;
}

export const isCoveringIncome = (t, all) => t?.type === 'income' && coveringIncomeIds(all).has(t.id);

/** Expenses that name this income as (part of) their cover. */
export const expensesCoveredBy = (income, all) =>
    (Array.isArray(all) ? all : []).filter(t => isCoveredExpense(t) && coverLinkIds(t).includes(income?.id));

/** Incomes linked to this expense that actually exist (dangling ids are ignored). */
export const coveringIncomesOf = (expense, all) => {
    const ids = new Set(coverLinkIds(expense));
    return (Array.isArray(all) ? all : []).filter(t => t.type === 'income' && ids.has(t.id));
};

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * Connected groups of covered expenses and their incomes, each with the sums
 * and a status: 'ok' | 'missing' (no income linked) | 'mismatch' (in ≠ out).
 */
export function coverGroups(all) {
    const list = Array.isArray(all) ? all : [];
    const byId = new Map(list.map(t => [t.id, t]));
    const seen = new Set();
    const groups = [];
    for (const start of list) {
        if (!isCoveredExpense(start) || seen.has(start.id)) continue;
        const expenses = [], incomes = [];
        const stack = [start];
        seen.add(start.id);
        while (stack.length) {
            const t = stack.pop();
            if (t.type === 'income') {
                incomes.push(t);
                for (const e of list) {
                    if (isCoveredExpense(e) && !seen.has(e.id) && coverLinkIds(e).includes(t.id)) { seen.add(e.id); stack.push(e); }
                }
            } else {
                expenses.push(t);
                for (const id of coverLinkIds(t)) {
                    const inc = byId.get(id);
                    if (inc && inc.type === 'income' && !seen.has(inc.id)) { seen.add(inc.id); stack.push(inc); }
                }
            }
        }
        const out = round2(expenses.reduce((s, t) => s + (parseFloat(t.amount) || 0), 0));
        const inn = round2(incomes.reduce((s, t) => s + (parseFloat(t.amount) || 0), 0));
        const status = incomes.length === 0 ? 'missing' : Math.abs(inn - out) >= 0.01 ? 'mismatch' : 'ok';
        groups.push({ expenses, incomes, out, in: inn, diff: round2(inn - out), status });
    }
    return groups;
}

/** The group a covered expense or covering income belongs to, or null. */
export function coverGroupOf(t, all) {
    if (!t) return null;
    return coverGroups(all).find(g => g.expenses.some(e => e.id === t.id) || g.incomes.some(i => i.id === t.id)) || null;
}

export const COVER_STATUS_LABEL = {
    ok: 'Dekket av innbetaling',
    missing: 'Dekning mangler',
    mismatch: 'Dekning stemmer ikke',
};

/**
 * Groups that are not in order and touch the month (by the expenses' month —
 * the outgoing transfer is what gets verified, and the payment may have
 * landed late the month before).
 */
export const coverIssues = (all, month) =>
    coverGroups(all).filter(g => g.status !== 'ok' && g.expenses.some(e => e.month === month));

/**
 * True when the row is pass-through money and must stay out of every
 * settlement/transfer sum: a covered expense, or an income that covers one.
 * `covering` is the Set from coveringIncomeIds(all), precomputed by callers
 * that loop over many rows.
 */
export const isCoverNeutral = (t, covering) =>
    isCoveredExpense(t) || (t?.type === 'income' && !!covering?.has(t.id));
