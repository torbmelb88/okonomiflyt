import 'dotenv/config';
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import cron from 'node-cron';
import { getAccessToken } from './auth.js';
import { fetchAccounts, fetchTransactions, fetchClassifiedTransactions } from './sb1.js';
import { normalizeTransaction, normalizeAccount } from './normalize.js';
import { initFirestore, upsertTransactions, upsertAccounts, pruneStaleTransactions } from './firestore.js';

const config = {
  clientId: requireEnv('SB1_CLIENT_ID'),
  clientSecret: requireEnv('SB1_CLIENT_SECRET'),
  seedRefreshToken: process.env.SB1_REFRESH_TOKEN || null,
  tokenStorePath: process.env.SB1_TOKEN_STORE || './data/token.json',
  outDir: process.env.SB1_OUT_DIR || './data',
  lookbackDays: Number(process.env.SB1_LOOKBACK_DAYS || 90),
  useClassified: process.env.SB1_USE_CLASSIFIED === 'true',
  schedule: process.env.SB1_SCHEDULE || null,
  // Output sink: 'file' (default), 'firestore', or 'both'
  sink: process.env.SB1_SINK || 'file',
  saKeyPath: process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.SB1_SA_KEY_PATH || null,
  firestoreCollection: process.env.SB1_FIRESTORE_COLLECTION || 'sb1Transactions',
  accountsCollection: process.env.SB1_ACCOUNTS_COLLECTION || 'sb1Accounts',
};

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Mangler påkrevd miljøvariabel ${name}`);
  return v;
}

function osloDate(d) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Oslo' }).format(d);
}

const digits = (s) => String(s ?? '').replace(/\D/g, '');

function dateRange(days) {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - days);
  return { fromDate: osloDate(from), toDate: osloDate(to) };
}

async function runOnce() {
  const startedAt = new Date().toISOString();
  console.log(`[${startedAt}] SB1-synk starter…`);

  const accessToken = await getAccessToken(config);
  const accounts = await fetchAccounts(accessToken);
  console.log(`Hentet ${accounts.length} kontoer.`);
  if (accounts[0]) console.log('Konto-felt (første konto):', Object.keys(accounts[0]).join(', '));

  const { fromDate, toDate } = dateRange(config.lookbackDays);
  const fetchTx = config.useClassified ? fetchClassifiedTransactions : fetchTransactions;

  const rawTxs = [];
  for (const acc of accounts) {
    if (!acc.key) continue;
    const txs = await fetchTx(accessToken, acc.key, fromDate, toDate);
    console.log(`  ${acc.name}: ${txs.length} transaksjoner (${fromDate} → ${toDate})`);
    rawTxs.push(...txs);
  }

  // Label internal transfers by their counterparty. The base transaction list
  // already includes remoteAccountNumber, so we just match it to the user's own
  // accounts — no extra API calls. External transfers keep their description.
  const ownByNumber = new Map(
    accounts.map(a => [digits(a.accountNumber?.value ?? a.accountNumber), a.name]).filter(([n]) => n)
  );
  let labelled = 0;
  for (const t of rawTxs) {
    const ownName = ownByNumber.get(digits(t.remoteAccountNumber));
    if (ownName) {
      const dir = (typeof t.amount === 'number' && t.amount < 0) ? 'til' : 'fra';
      t.transferLabel = `Overføring ${dir} ${ownName}`;
      labelled++;
    }
  }
  if (labelled) console.log(`Merket ${labelled} interne overføringer med motkonto.`);

  const all = rawTxs.map(normalizeTransaction);

  // File sink (kept for inspection/debugging)
  if (config.sink === 'file' || config.sink === 'both') {
    await mkdir(config.outDir, { recursive: true });
    const outPath = path.join(config.outDir, 'transactions.json');
    await writeFile(
      outPath,
      JSON.stringify({ syncedAt: startedAt, fromDate, toDate, count: all.length, transactions: all }, null, 2)
    );
    console.log(`Skrev ${all.length} normaliserte transaksjoner → ${outPath}`);
  }

  // Firestore sink — upsert into the staging collection by externalId
  if (config.sink === 'firestore' || config.sink === 'both') {
    if (!config.saKeyPath) {
      throw new Error('SB1_SINK=firestore krever GOOGLE_APPLICATION_CREDENTIALS (sti til service account-nøkkel).');
    }
    const db = await initFirestore({ keyPath: config.saKeyPath });
    const syncedAt = new Date().toISOString();
    const n = await upsertTransactions(db, config.firestoreCollection, all, syncedAt);
    console.log(`Upsertet ${n} transaksjoner til Firestore-collection «${config.firestoreCollection}».`);
    // Then drop what the bank no longer reports inside the fetched window —
    // mostly placeholders for payments that have since been booked. Skipped on
    // an empty run so a hiccup at the bank can't wipe the window.
    if (all.length > 0) {
      const pruned = await pruneStaleTransactions(db, config.firestoreCollection, { fromDate, toDate, syncedAt });
      if (pruned) console.log(`Ryddet bort ${pruned} foreldede rader (ikke lenger rapportert av banken).`);
    }
    const accN = await upsertAccounts(db, config.accountsCollection, accounts.map(normalizeAccount));
    console.log(`Upsertet ${accN} kontoer (m/ saldo) til «${config.accountsCollection}».`);
  }

  return all.length;
}

async function main() {
  if (config.schedule) {
    console.log(`Scheduler-modus: "${config.schedule}" (Europe/Oslo). Kjører én gang nå, så på timeplan.`);
    await runOnce().catch((e) => console.error('Første kjøring feilet:', e));
    cron.schedule(config.schedule, () => {
      runOnce().catch((e) => console.error('Planlagt kjøring feilet:', e));
    }, { timezone: 'Europe/Oslo' });
  } else {
    await runOnce();
  }
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
