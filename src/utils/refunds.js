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
