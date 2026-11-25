// SB1 ids (externalId = `<accountKey>:<nonUniqueId>`) that the bank REPLACES
// when the transaction is booked. A row carrying one is a reservation / fresh
// payment still in the bank's "recent" bucket: importing it as final guarantees
// a twin once the booked row arrives under its permanent (18-digit) id.
//
// Two shapes:
//  - `recent:<hash>` — sb1-sync's own content key for rows the bank gave the
//    all-zero nonUniqueId (seen 2026-09-09: six purchases re-ided overnight).
//  - a UUID — from ~2026-11-20 the bank hands recent rows a UUID instead of
//    zeros. It looks like a real id, so seven rows were imported as booked and
//    came back days later under numeric ids, with the booked name and date
//    («261400 COOP EXTRA LENA» 20. Nov → «EXTRA LENA» 23. Nov).
const UUID_TAIL = /:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(#\d+)?$/i;

export const isProvisionalBankId = (id) =>
    typeof id === 'string' && (id.includes(':recent:') || UUID_TAIL.test(id));
