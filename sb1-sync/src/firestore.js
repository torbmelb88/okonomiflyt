import admin from 'firebase-admin';
import { readFile } from 'node:fs/promises';

let db = null;

/**
 * Initialise the Firebase Admin SDK from a service-account key file. The
 * project is read from the key, so nothing is hard-coded. Call once.
 */
export async function initFirestore({ keyPath }) {
    if (db) return db;
    const sa = JSON.parse(await readFile(keyPath, 'utf8'));
    admin.initializeApp({ credential: admin.credential.cert(sa) });
    db = admin.firestore();
    return db;
}

/**
 * Upsert normalized transactions into a staging collection, keyed by
 * externalId so re-runs overwrite rather than duplicate. This is the raw
 * landing zone — routing into the app's own `transactions` (budget/account
 * assignment, dedup against CSV) happens in a later step.
 */
/**
 * Upsert account snapshots (incl. balance) into a staging collection, keyed by
 * sb1AccountKey. Refreshed on every sync run.
 */
export async function upsertAccounts(database, collectionName, accounts) {
    const stampedAt = new Date().toISOString();
    const batch = database.batch();
    let n = 0;
    for (const a of accounts) {
        const id = String(a.sb1AccountKey || '').replace(/\//g, '_');
        if (!id) continue;
        batch.set(database.collection(collectionName).doc(id), { ...a, syncedAt: stampedAt }, { merge: true });
        n++;
    }
    if (n) await batch.commit();
    return n;
}

/**
 * One balance snapshot per account per (Oslo) day, keyed `<accountKey>_<date>`
 * so re-runs on the same day overwrite rather than duplicate. `sb1Accounts`
 * only holds the latest balance; this history is what lets the app look back
 * at e.g. the balance the day before the monthly top-up (the buffer's real
 * low point) or the lowest balance in a month.
 */
export async function upsertBalanceSnapshots(database, collectionName, accounts, date) {
    const stampedAt = new Date().toISOString();
    const batch = database.batch();
    let n = 0;
    for (const a of accounts) {
        const key = String(a.sb1AccountKey || '').replace(/\//g, '_');
        if (!key) continue;
        batch.set(database.collection(collectionName).doc(`${key}_${date}`), {
            sb1AccountKey: a.sb1AccountKey,
            accountNumber: a.accountNumber ?? null,
            name: a.name ?? null,
            date,
            balance: a.balance ?? null,
            availableBalance: a.availableBalance ?? null,
            currency: a.currency ?? null,
            syncedAt: stampedAt,
        }, { merge: true });
        n++;
    }
    if (n) await batch.commit();
    return n;
}

export async function upsertTransactions(database, collectionName, txs, syncedAt) {
    const stampedAt = syncedAt || new Date().toISOString();
    let written = 0;
    for (let i = 0; i < txs.length; i += 400) {
        const batch = database.batch();
        for (const tx of txs.slice(i, i + 400)) {
            const id = String(tx.externalId).replace(/\//g, '_');
            const ref = database.collection(collectionName).doc(id);
            batch.set(ref, { ...tx, syncedAt: stampedAt }, { merge: true });
        }
        await batch.commit();
        written += Math.min(400, txs.length - i);
    }
    return written;
}

/**
 * Delete staged docs the bank no longer reports. Upserts alone never remove
 * anything, so an unbooked payment leaves its placeholder behind forever: once
 * booked it returns under a NEW externalId (SB1 gives every unbooked row the
 * same all-zero nonUniqueId), and the app keeps counting the orphan as "venter
 * bokføring".
 *
 * Only docs inside the window we just fetched are considered — anything older
 * has simply fallen out of the lookback and must be left alone. Safe by
 * construction: this is the staging mirror, never the app's own transactions.
 */
export async function pruneStaleTransactions(database, collectionName, { fromDate, toDate, syncedAt }) {
    const snap = await database.collection(collectionName)
        .where('date', '>=', fromDate)
        .where('date', '<=', toDate)
        .get();
    const stale = snap.docs.filter((d) => d.get('syncedAt') !== syncedAt);
    for (let i = 0; i < stale.length; i += 400) {
        const batch = database.batch();
        for (const d of stale.slice(i, i + 400)) batch.delete(d.ref);
        await batch.commit();
    }
    return stale.length;
}
