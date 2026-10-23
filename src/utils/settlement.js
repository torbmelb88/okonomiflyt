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

// «Privat del»: part of a shared purchase that only one of the two should
// pay for (a mirror for one of you in the same Jysk trip as the shared
// table). The row stays one row — it is the bank's — and keeps counting in
// full against its budget line; only the settlement changes: the private
// part leaves the split and is charged in full to `privateFor` ('self' |
// 'partner', from the budget owner's point of view, like paidPrivatelyBy).
// `privateAmount` may equal the whole amount (nothing of it is shared).
export const PRIVATE_PARTY_LABEL = { self: 'meg', partner: 'partner' };

/** { amount, party } when the row has a private part, else null. */
export function privatePortionOf(t) {
    const amount = parseFloat(t?.privateAmount) || 0;
    if (amount <= 0 || !t?.privateFor) return null;
    return { amount: Math.min(amount, parseFloat(t.amount) || amount), party: t.privateFor === 'partner' ? 'partner' : 'self' };
}

/** The part of the amount that is actually shared (amount minus the private part). */
export const sharedAmountOf = (t) => Math.max(0, (parseFloat(t?.amount) || 0) - (privatePortionOf(t)?.amount || 0));

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
 * (refunds count negative). A row's private part («Privat del») is left out
 * of that sum and instead charged in full to the party it belongs to — also
 * when the row's ACCOUNT is held out (a topped-up felleskort: the top-up is
 * what splits, but a private item bought with it still has to be paid back).
 * A row held out by itself or by its project settles nothing, private part
 * included. Each party owes its share by the budget's split method, minus
 * the utlegg it already paid privately (the whole row — it laid out the
 * private part too), plus its private parts, rounded up to the rounding
 * mode. Buffer build-up is NOT included — callers add it as a separate,
 * visible line.
 */
export function computeSplit({ transactions, sharedBudget, accounts, projects, month, userUid, roundingMode = 1 }) {
    const empty = { userShare: 0.5, partnerShare: 0.5, userAmount: 0, partnerAmount: 0, splitLabel: '', utleggSelf: 0, utleggPartner: 0, privateSelf: 0, privatePartner: 0, total: 0, rows: [], privateRows: [] };
    if (!sharedBudget) return empty;
    const covering = coveringIncomeIds(transactions);
    const monthRows = (Array.isArray(transactions) ? transactions : []).filter(t =>
        t.budgetId === sharedBudget.id && t.month === month && !isCoverNeutral(t, covering));
    const rows = monthRows.filter(t => !isExcludedFromSplit(t, accounts, projects));
    const sign = (t) => (t.type === 'income' ? -1 : 1);
    const sum = (arr, of = (t) => parseFloat(t.amount) || 0) => arr.reduce((s, t) => s + sign(t) * of(t), 0);
    const total = sum(rows, sharedAmountOf);
    const utleggSelf = sum(rows.filter(t => t.paidPrivatelyBy === 'self'));
    const utleggPartner = sum(rows.filter(t => t.paidPrivatelyBy === 'partner'));
    // Private parts settle whenever the row is on a budget line and not held
    // out by itself or its project (account-level hold-out does not stop them).
    const privateRows = monthRows.filter(t => t.budgetItemId && privatePortionOf(t) && !['transaction', 'project'].includes(exclusionReason(t, accounts, projects)));
    const privateOf = (party) => sum(privateRows.filter(t => privatePortionOf(t).party === party), (t) => privatePortionOf(t).amount);
    const privateSelf = privateOf('self');
    const privatePartner = privateOf('partner');

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
        userShare, partnerShare, splitLabel, total, utleggSelf, utleggPartner, privateSelf, privatePartner, rows, privateRows,
        userAmount: round(total * userShare - utleggSelf + privateSelf),
        partnerAmount: round(total * partnerShare - utleggPartner + privatePartner),
    };
}

/** Rounding mode for the settlement, as PartnerSettings stores it. */
export const readRoundingMode = () => {
    try { return parseInt(localStorage.getItem('roundingMode') || '1') || 1; } catch { return 1; }
};

export const heldOutOfTransfer = (t, projects) =>
    !!(t?.excludeFromSharedCalc || t?.coveredByAccountId || projectExcludes(t, projects));
