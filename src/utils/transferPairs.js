// Overføringspar: the two rows one money movement leaves in the books — the
// outgoing row on the sending account and the incoming row on the receiving
// one. There is no stored link; the pair is recognised the way the Sparing
// page has always recognised a contribution: same amount, opposite sides,
// different accounts, dates a few days apart.
//
// In the reconcile dialog the outgoing row is the one that carries meaning
// (a budget item, «Sparing», a settlement share); the incoming row is only
// its mirror and is set to «Intern overføring» (or «Kortregning» when the
// outgoing row is the card bill) in the same save.
//
// Pass-through money (utils/coverage.js) is never paired here: it has its own
// many-to-many links and an incoming payment with no same-sized counterpart.

import { isCoveredExpense, isCoveringIncome } from './coverage';
import { isHandled } from './reconciliation';
import { KIND, transactionKind } from './kinds';

export const PAIR_DAYS = 4;

export const datesClose = (d1, d2, tol = PAIR_DAYS) =>
    Math.ceil(Math.abs(new Date(d2) - new Date(d1)) / 86400000) <= tol;

const dayDiff = (a, b) => Math.abs(new Date(a) - new Date(b)) / 86400000;

const isForeign = (t) => !!(t.currency && t.currency !== 'NOK');

/** Rows that can never be one half of an overføringspar. */
const pairable = (t, all) =>
    !!t && !!t.date && !t.isRefund && !t.refundSplit && !isForeign(t) &&
    !isCoveredExpense(t) && !(t.type === 'income' && isCoveringIncome(t, all));

/**
 * The row on the other side of the same money movement, or null.
 * Nearest date wins; with equal distance the not-yet-handled row wins, so a
 * monthly transfer never grabs last month's already reconciled twin.
 */
export function findTransferPartner(t, all) {
    if (!Array.isArray(all) || !pairable(t, all)) return null;
    const wanted = t.type === 'expense' ? 'income' : 'expense';
    let best = null;
    for (const c of all) {
        if (c.id === t.id || c.type !== wanted || c.accountId === t.accountId) continue;
        if (Math.abs((c.amount || 0) - (t.amount || 0)) >= 0.01) continue;
        if (!pairable(c, all) || !datesClose(c.date, t.date)) continue;
        const rank = [dayDiff(c.date, t.date), isHandled(c) ? 1 : 0];
        if (!best || rank[0] < best.rank[0] || (rank[0] === best.rank[0] && rank[1] < best.rank[1])) best = { c, rank };
    }
    return best ? best.c : null;
}

/**
 * A queue with every outgoing row ahead of its incoming mirror (which then
 * follows right behind it): the outgoing row decides what the movement is, so
 * it is the one to meet first. Everything else keeps its order.
 */
export function outgoingFirst(list, all) {
    if (!Array.isArray(list) || list.length < 2) return list;
    const byId = new Map(list.map(t => [t.id, t]));
    const mirrorOf = new Map(); // outgoing id -> incoming row in the queue
    const deferred = new Set();  // incoming ids placed behind their outgoing row
    for (const t of list) {
        if (t.type !== 'expense' || isHandled(t)) continue;
        const p = findTransferPartner(t, all);
        const inQueue = p && byId.get(p.id);
        if (inQueue && !isHandled(inQueue) && !deferred.has(inQueue.id)) { mirrorOf.set(t.id, inQueue); deferred.add(inQueue.id); }
    }
    const out = [];
    for (const t of list) {
        if (deferred.has(t.id)) continue;
        out.push(t);
        if (mirrorOf.has(t.id)) out.push(mirrorOf.get(t.id));
    }
    return out;
}

/** The kind the incoming mirror row gets for a given kind on the outgoing row. */
export const partnerKind = (outKind) => outKind === KIND.creditCardBill ? KIND.creditCardBill : KIND.transfer;

/**
 * What the same pair was reconciled as last time: the most recent earlier
 * outgoing row on the same account whose own partner sits on the same other
 * account. An identical amount is preferred over a more recent one.
 * Returns { row, kind } or null.
 */
export function transferPairHistory(t, partner, all) {
    if (!t || !partner || t.type !== 'expense') return null;
    const earlier = all
        .filter(e => e.id !== t.id && e.type === 'expense' && e.accountId === t.accountId && e.date < t.date && isHandled(e))
        .map(e => ({ e, kind: transactionKind(e, all) }))
        .filter(x => x.kind === KIND.purchase || x.kind === KIND.savings || x.kind === KIND.transfer || x.kind === KIND.creditCardBill)
        .sort((a, b) =>
            (Math.abs(a.e.amount - t.amount) < 0.01 ? 0 : 1) - (Math.abs(b.e.amount - t.amount) < 0.01 ? 0 : 1) ||
            b.e.date.localeCompare(a.e.date))
        .slice(0, 24);
    for (const { e, kind } of earlier) {
        const p = findTransferPartner(e, all);
        if (p && p.accountId === partner.accountId) return { row: e, kind };
    }
    return null;
}
