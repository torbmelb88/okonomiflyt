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

// «Holdes utenfor oppgjør» is the one wording for this, whichever level set it.
import { coveringIncomeIds, isCoverNeutral } from './coverage';

export const EXCLUSION_LABEL = {
    transaction: 'Holdes utenfor oppgjør',
    project: 'Holdes utenfor oppgjør av prosjektet',
    account: 'Holdes utenfor oppgjør av kontoen',
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
/**
 * The settlement split for one month — THE one computation Oppgjør and Min
 * Oversikt both show, so the two can never drift apart.
 *
 * Shared-budget rows of the month that sit on a budget line, are not held
 * out (row/project/account) and are not pass-through money are summed
 * (refunds count negative). Each party owes its share by the budget's split
 * method, minus the utlegg it already paid privately, rounded up to the
 * rounding mode. Buffer build-up is NOT included — callers add it as a
 * separate, visible line.
 */
export function computeSplit({ transactions, sharedBudget, accounts, projects, month, userUid, roundingMode = 1 }) {
    const empty = { userShare: 0.5, partnerShare: 0.5, userAmount: 0, partnerAmount: 0, splitLabel: '', utleggSelf: 0, utleggPartner: 0, total: 0, rows: [] };
    if (!sharedBudget) return empty;
    const covering = coveringIncomeIds(transactions);
    const rows = (Array.isArray(transactions) ? transactions : []).filter(t =>
        t.budgetId === sharedBudget.id && t.month === month &&
        !isExcludedFromSplit(t, accounts, projects) && !isCoverNeutral(t, covering));
    const sum = (arr) => arr.reduce((s, t) => s + (t.type === 'income' ? -1 : 1) * (parseFloat(t.amount) || 0), 0);
    const total = sum(rows);
    const utleggSelf = sum(rows.filter(t => t.paidPrivatelyBy === 'self'));
    const utleggPartner = sum(rows.filter(t => t.paidPrivatelyBy === 'partner'));

    let userShare = 0.5, splitLabel = 'Basert på inntekt';
    const method = sharedBudget.splitMethod || 'income';
    if (method === '5050') { splitLabel = '50 / 50'; }
    else if (method === 'custom') {
        userShare = (sharedBudget.customUserShare || 50) / 100;
        splitLabel = `Egendefinert (${sharedBudget.customUserShare || 50} / ${100 - (sharedBudget.customUserShare || 50)})`;
    } else {
        const totalIncome = sharedBudget.members?.reduce((s, m) => s + (m.income || 0), 0) || 0;
        const userIncome = sharedBudget.members?.find(m => m.uid === userUid)?.income || 0;
        userShare = totalIncome > 0 ? userIncome / totalIncome : 0.5;
    }
    const partnerShare = 1 - userShare;
    const round = (n) => roundingMode > 1 ? Math.ceil(n / roundingMode) * roundingMode : Math.round(n);
    return {
        userShare, partnerShare, splitLabel, total, utleggSelf, utleggPartner, rows,
        userAmount: round(total * userShare - utleggSelf),
        partnerAmount: round(total * partnerShare - utleggPartner),
    };
}

/** Rounding mode for the settlement, as PartnerSettings stores it. */
export const readRoundingMode = () => {
    try { return parseInt(localStorage.getItem('roundingMode') || '1') || 1; } catch { return 1; }
};

export const heldOutOfTransfer = (t, projects) =>
    !!(t?.excludeFromSharedCalc || t?.coveredByAccountId || projectExcludes(t, projects));
