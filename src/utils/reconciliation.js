// Three-state reconciliation model for transactions:
//
// - 'reconciled'   — bekreftet mot en faktisk banktransaksjon. Rader som selv
//                    kommer fra banken (SB1/CSV) ER bankens tall, så for dem
//                    holder det å knytte dem til en budsjettpost. Selv-
//                    rapporterte rader (companion-app/MCP) blir avstemt først
//                    når de slås sammen med bankens kopi.
// - 'booked'       — bokført: kategorisert (budgetItemId satt), men ennå ikke
//                    matchet mot banken. Hviletilstanden for companion-app-
//                    transaksjoner. Trenger ingen oppfølging, men beløpet er
//                    ikke endelig før bankmatch.
// - 'unreconciled' — trenger oppfølging (ikke kategorisert).

export const SELF_REPORTED_SOURCES = ['companion_app', 'mcp'];

// Self-reported rows are the user's own registration of a purchase, not the
// bank's record of it — the bank copy arrives later via SB1/CSV import.
export const isSelfReported = (t) => SELF_REPORTED_SOURCES.includes(t?.source);

// A row still carrying a foreign currency has by definition not been matched
// to the bank's NOK amount — merging with the bank copy always clears
// `currency` (keeping it as originalCurrency).
export const awaitingBankAmount = (t) => !!(t.currency && t.currency !== 'NOK');

// True when linking this row to a budget item is enough to reconcile it:
// it must be the bank's own record (not self-reported) and in NOK.
export const reconcilesOnLink = (t) => !isSelfReported(t) && !awaitingBankAmount(t);

export const reconcileState = (t) => {
    if (awaitingBankAmount(t)) return t.budgetItemId ? 'booked' : 'unreconciled';
    if (t.reconciled) return 'reconciled';
    if (!t.budgetItemId) return 'unreconciled';
    // Categorized but reconciled:false — for a bank-origin row (SB1/CSV, incl.
    // rows whose source was rewritten by a bank merge before reconciled was
    // introduced there) the record IS the bank's, so categorized = avstemt.
    // Self-reported rows wait for their bank copy.
    return isSelfReported(t) ? 'booked' : 'reconciled';
};

// "Handled" = needs no follow-up: reconciled or at least booked.
export const isHandled = (t) => reconcileState(t) !== 'unreconciled';
