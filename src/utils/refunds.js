// Refund bookkeeping for purchases someone pays you back for (a partner
// Vipps-ing for snus, friends paying for their cinema tickets, …).
//
// The purchase carries `awaitingRefund` (+ optional `expectedRefundAmount`,
// null = the whole purchase). Each incoming payment is a normal income row
// marked `isRefund` with `refundOfTransactionId` pointing at the purchase —
// several incomes may point at one purchase. Refunds net out against the
// purchase everywhere it counts, without capping: more refunded than paid
// simply makes the net negative (real money in).
//
// One payment covering several purchases (cinema tickets) is split
// physically: the bank row becomes a `refundSplit` parent that is kept out of
// every sum, and one child refund row per purchase (`refundParentId`) carries
// the allocated amount with the purchase's budget line — so every existing
// per-line/per-account/per-project sum stays exact without special cases.
//
// Completion is explicit: `awaitingRefund` is cleared when the user says the
// purchase is done, never inferred from amounts — a partner may pay back
// less (or more) than expected.

export const refundsOf = (t, all) =>
    (Array.isArray(all) ? all : []).filter(r => r.isRefund && r.refundOfTransactionId === t?.id);

export const refundedAmount = (t, all) =>
    refundsOf(t, all).reduce((s, r) => s + (parseFloat(r.amount) || 0), 0);

/** Expected refund: the explicit amount when set, else the whole purchase. */
export const expectedRefund = (t) =>
    t?.expectedRefundAmount != null && t.expectedRefundAmount > 0
        ? t.expectedRefundAmount
        : (parseFloat(t?.amount) || 0);

export const isRefundSplitParent = (t) => !!t?.refundSplit;
export const refundChildrenOf = (parent, all) =>
    (Array.isArray(all) ? all : []).filter(t => t.refundParentId === parent?.id);

export const parseAmount = (v) => Math.round((parseFloat(String(v ?? '').replace(',', '.')) || 0) * 100) / 100;
export const allocationsTotal = (allocs) => Math.round(allocs.reduce((s, a) => s + parseAmount(a.amount), 0) * 100) / 100;
/** Every allocation positive and the total equal to the payment. */
export const allocationsValid = (allocs, incomeAmount) =>
    allocs.length > 0 && allocs.every(a => parseAmount(a.amount) > 0) &&
    Math.abs(allocationsTotal(allocs) - (parseFloat(incomeAmount) || 0)) < 0.01;
/** «Ferdig refundert» for one allocation: explicit choice, else "covers the rest". */
export const allocationComplete = (a, tx, all) => {
    if (a.complete != null) return a.complete;
    if (!tx?.awaitingRefund) return false;
    const info = refundStatus(tx, all);
    return info.refunded + parseAmount(a.amount) >= info.expected - 0.5;
};

export function refundStatus(t, all) {
    const linked = refundsOf(t, all);
    const refunded = linked.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0);
    const amount = parseFloat(t?.amount) || 0;
    return {
        awaiting: !!t?.awaitingRefund,
        refunded,
        expected: expectedRefund(t),
        count: linked.length,
        over: refunded > amount + 0.005,
    };
}
