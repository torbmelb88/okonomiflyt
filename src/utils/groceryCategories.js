// Fixed grocery category set — must match CATEGORIES in the companion app's
// ClaudeReceiptParser.kt
export const CATEGORY_LABELS = {
    meieri: 'Meieri',
    frukt_gront: 'Frukt & grønt',
    kjott_fisk: 'Kjøtt & fisk',
    brod_bakevarer: 'Brød & bakevarer',
    torrvarer: 'Tørrvarer',
    frys: 'Frys',
    drikke: 'Drikke',
    snacks_godteri: 'Snacks & godteri',
    husholdning: 'Husholdning',
    personlig_pleie: 'Personlig pleie',
    pant: 'Pant',
    annet: 'Annet'
};

export const CATEGORY_COLORS = {
    meieri: '#60a5fa',
    frukt_gront: '#34d399',
    kjott_fisk: '#f87171',
    brod_bakevarer: '#fbbf24',
    torrvarer: '#a78bfa',
    frys: '#22d3ee',
    drikke: '#38bdf8',
    snacks_godteri: '#f472b6',
    husholdning: '#94a3b8',
    personlig_pleie: '#fb923c',
    pant: '#2dd4bf',
    annet: '#9ca3af'
};

// Chain families for the per-chain tabs: receipts store the parser's chain
// enum (coop_extra, coop_obs, kiwi, ...); the UI groups all Coop variants
// (and Coop-owned Matkroken) into one family. Same grouping as chainGroup()
// in the companion app's ReceiptModels.kt.
export const CHAIN_LABELS = {
    coop: 'Coop',
    kiwi: 'Kiwi',
    rema_1000: 'Rema 1000',
    meny: 'Meny',
    spar: 'Spar',
    joker: 'Joker',
    bunnpris: 'Bunnpris',
    annet: 'Annet'
};

export const chainGroupOf = (receiptOrItem) => {
    const chain = receiptOrItem?.chain;
    if (chain) return chain.startsWith('coop') || chain === 'matkroken' ? 'coop' : chain;
    // Docs from before the chain field existed are all Coop-era data,
    // but check the store name to be safe
    const store = (receiptOrItem?.store || '').toLowerCase();
    if (store.includes('kiwi')) return 'kiwi';
    return 'coop';
};

export const chainLabel = (group) =>
    CHAIN_LABELS[group] || (group ? group.replace(/_/g, ' ') : 'Annet');

export const formatKr = (value) =>
    `${(value ?? 0).toLocaleString('no-NO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kr`;

// Mirror of canonicalizeName in the companion app's ClaudeReceiptParser.kt:
// folds trivial naming variants ("q-melk" vs "q melk", "1,75l" vs "1.75l")
// so they can't split the price statistics
export const canonicalizeVareName = (raw) => (raw || '')
    .toLowerCase()
    .replace(/(\d),(?=\d)/g, '$1.')
    .replace(/[-_/]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
