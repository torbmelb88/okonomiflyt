// Why a transaction is kept out of the settlement split (Oppgjør).
//
// Three flags do that, in order of precedence: the transaction's own
// `excludeFromSharedCalc` («Hold kostnad utenfor fordeling» in the reconcile
// dialog), the project's `excludeFromSharedCalc` (every transaction logged
// on the project is held out — saves ticking the box on each purchase) and
// the account-level `excludeFromSharedCalc` («Hold transaksjoner utenfor
// fordeling» on the account, e.g. Felleskonto, which is funded by a fixed
// monthly transfer that IS in the split). The split itself lives in
// Oppgjor.jsx; this helper exists so the UI badges agree with it.
//
// «Dekkes fra en annen konto» follows the same two levels: the transaction's
// `coveredByAccountId` wins, else the excluding project's.

export const EXCLUSION_LABEL = {
    transaction: 'Ekskludert',
    project: 'Ekskludert av prosjekt',
    account: 'Ekskludert av kontoflagg',
};

export const projectOf = (t, projects) =>
    t?.projectId ? (projects || []).find(p => p.id === t.projectId) || null : null;

/** True when the transaction's project holds all its transactions out of the split. */
export const projectExcludes = (t, projects) => !!projectOf(t, projects)?.excludeFromSharedCalc;

/** 'transaction' | 'project' | 'account' | null — transaction flag wins when several apply. */
export function exclusionReason(t, accounts, projects) {
    if (!t) return null;
    if (t.excludeFromSharedCalc) return 'transaction';
    if (projectExcludes(t, projects)) return 'project';
    if (accounts?.find(a => a.id === t.accountId)?.excludeFromSharedCalc) return 'account';
    return null;
}

/** True when the row can never enter the split (no budget line, or excluded). */
export const isExcludedFromSplit = (t, accounts, projects) => !t?.budgetItemId || !!exclusionReason(t, accounts, projects);

/** The account that footed the bill instead: the transaction's own choice, else the excluding project's. */
export const coveredByAccountOf = (t, projects) =>
    t?.coveredByAccountId || (projectExcludes(t, projects) ? projectOf(t, projects).coveredByAccountId || null : null);

/**
 * «Hold kostnad utenfor overføringsberegning» as Min Oversikt reads it: the
 * row is held out, or another account covered it — on the row or via its
 * project. (The account-level flag is deliberately not part of this.)
 */
export const heldOutOfTransfer = (t, projects) =>
    !!(t?.excludeFromSharedCalc || t?.coveredByAccountId || projectExcludes(t, projects));
