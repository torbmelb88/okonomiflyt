// «Hva er dette?» — the one classification every transaction gets in the
// reconcile dialog, derived from the fields the app already stores:
//
// - purchase        — knyttet til en budsjettpost (budgetItemId). Kjøp/utgift,
//                     eller en inntekt som føres mot en post.
// - salary          — category «Lønn» (inntekt)
// - savings         — category «Sparing» (den utgående overføringen)
// - transfer        — category «Intern Overføring» (eldre rader: «Overføring»)
// - creditCardBill  — category «Kredittkortregning» (betaling av kortregning)
// - refund          — isRefund: innbetaling som er refusjon av et kjøp,
//                     koblet (refundOfTransactionId) eller ikke («Retur»),
//                     eller en fordelt forelder (refundSplit)
// - passthrough     — inntekt som dekker en utgående overføring (gjennomreise,
//                     utils/coverage.js). Avledet fra utgiftene, så `all` må
//                     med for å se den.
// - null            — ikke klassifisert ennå (uavstemt)
//
// The kind is what the dialog preselects when a row is reopened, and what
// every list badge and sum should agree on. The category strings themselves
// stay as they are in Firestore; this module is the only place that knows
// how they spell.

import { isCoveringIncome } from './coverage';

export const KIND = {
    purchase: 'purchase',
    salary: 'salary',
    savings: 'savings',
    transfer: 'transfer',
    creditCardBill: 'creditCardBill',
    refund: 'refund',
    passthrough: 'passthrough',
};

// Stored `category` value per kind (the exact spelling the app writes).
export const KIND_CATEGORY = {
    salary: 'Lønn',
    savings: 'Sparing',
    transfer: 'Intern Overføring',
    creditCardBill: 'Kredittkortregning',
    refund: 'Retur',
};

const CATEGORY_KIND = {
    'lønn': KIND.salary,
    'sparing': KIND.savings,
    'intern overføring': KIND.transfer,
    'overføring': KIND.transfer,
    'kredittkortregning': KIND.creditCardBill,
    'retur': KIND.refund,
    'retur (fordelt)': KIND.refund,
};

const cat = (t) => (t?.category || '').trim().toLowerCase();

/** The kind a category string encodes, or null for an ordinary category. */
export const categoryKind = (t) => CATEGORY_KIND[cat(t)] || null;

/** True when the category is one of the reserved kind spellings. */
export const isKindCategory = (t) => !!categoryKind(t);

/** Classify one row. `all` is optional; without it 'passthrough' is not detected. */
export function transactionKind(t, all) {
    if (!t) return null;
    if (t.isRefund || t.refundSplit) return KIND.refund;
    const byCategory = categoryKind(t);
    if (byCategory) return byCategory;
    if (t.type === 'income' && Array.isArray(all) && isCoveringIncome(t, all)) return KIND.passthrough;
    if (t.budgetItemId) return KIND.purchase;
    return null;
}

/**
 * Money movement: rows that are neither income nor spending — transfers,
 * savings and card-bill payments. Kept out of every consumption sum.
 */
export const isMoneyMovement = (t) => {
    const k = categoryKind(t);
    return k === KIND.savings || k === KIND.transfer || k === KIND.creditCardBill;
};

export const isSalary = (t) => categoryKind(t) === KIND.salary;
export const isSavings = (t) => categoryKind(t) === KIND.savings;

// One word per concept — used in the dialog, the list badges and the banners.
export const KIND_LABEL = {
    purchase: 'Kjøp',
    salary: 'Lønn',
    savings: 'Sparing',
    transfer: 'Intern overføring',
    creditCardBill: 'Kortregning',
    refund: 'Refusjon',
    passthrough: 'Gjennomreise',
};

export const KIND_EMOJI = {
    purchase: '🛒',
    salary: '💰',
    savings: '🐷',
    transfer: '🔄',
    creditCardBill: '💳',
    refund: '↩️',
    passthrough: '🔃',
};

// Short «when to pick it» lines — the «Hvilken passer?» guide in the dialog.
export const KIND_HELP = {
    purchase: 'Vanlige kjøp og regninger. Telles som forbruk mot en budsjettpost.',
    salary: 'Lønn inn på konto. Utgangspunktet for «Til forbruk» på Min Oversikt.',
    savings: 'Overføring til sparekonto (den utgående raden). Trekkes fra i «Disponibelt».',
    transfer: 'Penger mellom egne kontoer. Holdes helt utenfor forbruk og oppgjør.',
    creditCardBill: 'Betaling av kortregningen: uttaket fra bankkontoen, og innbetalingen som lander på kortet. Kjøpene telles fra kortet, ikke fra disse.',
    refund: 'Innbetaling som er tilbakebetaling av et kjøp (Vipps, retur). Nettes mot kjøpet.',
    passthrough: 'Innbetaling som går rett videre ut igjen (f.eks. barnetrygd til sparing). Begge sider holdes utenfor oppgjør.',
};

/** The kinds a row of this type can be given, in the order the dialog shows them. */
export const kindsForType = (type) => type === 'income'
    ? [KIND.salary, KIND.refund, KIND.passthrough, KIND.transfer, KIND.creditCardBill, KIND.purchase]
    : [KIND.purchase, KIND.savings, KIND.transfer, KIND.creditCardBill];

/** Help text for the kind as it applies to this row's type. */
export const kindHelpFor = (kind, type) =>
    kind === KIND.purchase && type === 'income'
        ? 'Annen inntekt som hører til en budsjettpost, f.eks. at noen betaler deg for bensin. Trekkes fra forbruket på posten.'
        : KIND_HELP[kind];

/** Label for the kind as it applies to this row's type (income against a budget item is not a «kjøp»). */
export const kindLabelFor = (kind, type) =>
    kind === KIND.purchase && type === 'income' ? 'Inntekt mot budsjettpost' : KIND_LABEL[kind];
