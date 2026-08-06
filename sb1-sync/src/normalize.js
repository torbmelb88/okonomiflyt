/**
 * Adapter: gjør en rå SB1-transaksjon om til ØkonomiFlyts standardform.
 * Dette er det eneste stedet SB1-spesifikke feltnavn finnes — alt nedstrøms
 * (dedup, lagring, avstemming) jobber kun mot denne formen.
 */
export function normalizeTransaction(tx) {
  const amount = typeof tx.amount === 'number' ? tx.amount : 0;
  // SB1's `id` is a volatile per-response token — the SAME transaction comes
  // back with different `id`s, which doubled everything. `nonUniqueId` is the
  // stable identity; scope it by account to be safe. Fall back to id.
  const externalId = tx.nonUniqueId ? `${tx.accountKey}:${tx.nonUniqueId}` : tx.id;
  return {
    externalId,                        // stabil ID -> eksakt dedup
    source: 'sb1',
    date: epochToOsloDate(tx.date),    // YYYY-MM-DD
    amount: Math.abs(amount),
    type: amount < 0 ? 'expense' : 'income',
    // Internal transfers get a counterparty label ("Overføring til Sparekonto")
    // which wins over the (often unhelpful) person-name description. Otherwise
    // use the description, then the SB1 type text, then a last-resort fallback.
    name: tx.transferLabel || tx.cleanedDescription || tx.description || tx.typeText || 'Ukjent transaksjon',
    rawDescription: tx.description ?? null,
    typeText: tx.typeText ?? null,
    remoteAccountNumber: tx.remoteAccountNumber ?? null,
    remoteAccountName: tx.remoteAccountName ?? null,
    category: tx.category ?? null,     // finnes på /classified
    accountKey: tx.accountKey ?? null,
    accountName: tx.accountName ?? null,
    accountNumber: tx.accountNumber?.value ?? null,
    currency: tx.currencyCode ?? null,
    bookingStatus: tx.bookingStatus ?? null,
    raw: tx,                           // behold original for framtidige felt/debug
  };
}

/**
 * SB1 leverer dato som epoch-millisekunder ved midnatt norsk tid.
 * Konverter i Europe/Oslo for å unngå off-by-one rundt midnatt (UTC ville
 * trukket datoen én dag tilbake om vinteren).
 */
function epochToOsloDate(epochMs) {
  if (epochMs === null || epochMs === undefined) return null;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Oslo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(epochMs));
}

const numOrNull = (v) => (typeof v === 'number' ? v : null);

/**
 * Normalize an SB1 account for the sb1Accounts staging collection. Field names
 * for balance vary, so we try the common ones and always keep the raw object.
 */
export function normalizeAccount(acc) {
  return {
    sb1AccountKey: acc.key ?? null,
    name: acc.name ?? null,
    accountNumber: acc.accountNumber?.value ?? (typeof acc.accountNumber === 'string' ? acc.accountNumber : null),
    accountType: acc.type ?? acc.accountType ?? null,
    balance: numOrNull(acc.balance ?? acc.bookedBalance),
    availableBalance: numOrNull(acc.availableBalance ?? acc.available ?? acc.disposableAmount),
    currency: acc.currencyCode ?? acc.currency ?? null,
    raw: acc,
  };
}
