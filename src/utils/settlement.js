// Why a transaction is kept out of the settlement split (Oppgjør).
//
// Two flags do that: the transaction's own `excludeFromSharedCalc` («Hold
// kostnad utenfor fordeling» in the reconcile dialog) and the account-level
// `excludeFromSharedCalc` («Hold transaksjoner utenfor fordeling» on the
// account, e.g. Felleskonto, which is funded by a fixed monthly transfer that
// IS in the split). The split itself lives in Oppgjor.jsx; this helper exists
// so the UI badges agree with it.

export const EXCLUSION_LABEL = {
    transaction: 'Ekskludert',
    account: 'Ekskludert av kontoflagg',
};

/** 'transaction' | 'account' | null — transaction flag wins when both apply. */
export function exclusionReason(t, accounts) {
    if (!t) return null;
    if (t.excludeFromSharedCalc) return 'transaction';
    if (accounts?.find(a => a.id === t.accountId)?.excludeFromSharedCalc) return 'account';
    return null;
}

/** True when the row can never enter the split (no budget line, or excluded). */
export const isExcludedFromSplit = (t, accounts) => !t?.budgetItemId || !!exclusionReason(t, accounts);
