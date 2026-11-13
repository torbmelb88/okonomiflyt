// Display names for transactions. The stored `name` is never changed — it
// feeds budget-item suggestions, receipt chain detection and duplicate
// matching — so all tidying happens here, at display time.
//
// The same shop reaches the app under several names (seen Nov 2026, all
// Coop Extra Lena): «Extra» (Wallet notification via the companion app),
// «261400 COOP EXTRA LENA» (bank, booked) and «EXTRA LENA» (bank, SB1's own
// cleanup). Three layers bring them together:
//   1. bankName — a companion row linked to the bank also stores the bank's
//      name; it is the more precise one («Extra» says nothing about which shop)
//   2. cleanMerchantName — strips terminal numbers and place tails, de-shouts
//   3. merchantAliases — the user's own «X vises som Y» rules

const KEEP_UPPER = new Set(['AS', 'ASA', 'AB', 'SA', 'BA', 'DA', 'ANS', 'NAV', 'DNB', 'IKEA', 'XXL', 'H&M', 'YX', 'NOR']);

const titleCaseWord = (w) => {
    if (KEEP_UPPER.has(w)) return w;
    // Keep tokens with digits as they are (e.g. «P4882F116D», «AVD»-numbers)
    if (/\d/.test(w)) return w;
    return w.charAt(0) + w.slice(1).toLowerCase();
};

/**
 * Tidy a raw merchant name for display:
 *  - leading terminal/store numbers: «261400 COOP EXTRA LENA», «2614 EXTRA …»,
 *    «7080000642847 KIWI 002 RE»
 *  - card-network place tails: «EXTRA SKREIA, SKREIA, NOR» → «EXTRA SKREIA»
 *  - trailing long reference numbers: «McDonalds 57800048»
 *  - ALL-CAPS names are title-cased; names with lowercase are left alone
 *    (they were typed or already tidy, e.g. «Overføring til Brukskonto»).
 */
export function cleanMerchantName(raw) {
    let s = String(raw || '').replace(/\s+/g, ' ').trim();
    if (!s) return s;
    const original = s;
    s = s.replace(/^(\d{3,}\s+)+/, '');                       // leading numbers
    s = s.replace(/,\s*[^,]*,\s*[A-Z]{3}$/, '');              // «, SKREIA, NOR»
    s = s.replace(/,\s*[A-Z]{3}$/, '');                       // «, NOR»
    s = s.replace(/\s+\d{5,}$/, '');                          // trailing reference
    s = s.trim();
    if (!s) return original;
    // De-shout only names written entirely in capitals
    if (/[A-ZÆØÅ]/.test(s) && !/[a-zæøå]/.test(s)) {
        s = s.split(' ').map(titleCaseWord).join(' ');
    }
    return s;
}

// Key an alias pattern is matched on: cleaned and case-folded, so one alias
// «extra lena» covers «EXTRA LENA», «261400 EXTRA LENA», «Extra Lena».
export const aliasKey = (name) => cleanMerchantName(name).toLowerCase();

/**
 * Build the display-name function for a set of aliases
 * ({ pattern, displayName, accountId? }). An alias scoped to an account wins
 * over an unscoped one with the same pattern.
 */
export function makeDisplayName(aliases = []) {
    const scoped = new Map();
    const global = new Map();
    for (const a of aliases) {
        if (!a?.pattern || !a?.displayName) continue;
        const key = aliasKey(a.pattern);
        if (a.accountId) scoped.set(`${a.accountId}|${key}`, a.displayName);
        else global.set(key, a.displayName);
    }
    const lookup = (name, accountId) => {
        const key = aliasKey(name);
        return (accountId && scoped.get(`${accountId}|${key}`)) || global.get(key) || null;
    };
    return (t) => {
        if (!t) return '';
        // Alias on either name, own name first (it is what the user sees today)
        const hit = lookup(t.name, t.accountId) || (t.bankName && lookup(t.bankName, t.accountId));
        if (hit) return hit;
        return cleanMerchantName(t.bankName || t.name) || t.name || '';
    };
}
