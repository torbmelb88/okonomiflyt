const BASE = 'https://api.sparebank1.no/personal/banking';

// SB1 ruter på egne media-typer. Kontoer krever v5, transaksjoner v1.
const ACCEPT_ACCOUNTS = 'application/vnd.sparebank1.v5+json';
const ACCEPT_TRANSACTIONS = 'application/vnd.sparebank1.v1+json';

async function get(url, accessToken, accept) {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: accept },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GET ${url} feilet (${res.status}): ${text}`);
  }
  return res.json();
}

export async function fetchAccounts(accessToken) {
  const data = await get(`${BASE}/accounts`, accessToken, ACCEPT_ACCOUNTS);
  return data.accounts ?? [];
}

export async function fetchTransactions(accessToken, accountKey, fromDate, toDate) {
  const qs = new URLSearchParams({ accountKey, fromDate, toDate });
  const data = await get(`${BASE}/transactions?${qs}`, accessToken, ACCEPT_TRANSACTIONS);
  return data.transactions ?? [];
}

// Transaction details — includes the counterparty (remoteAccountName/Number),
// used to label internal transfers with their destination. One call per
// transaction, so only fetch for transfers (no description).
export async function fetchTransactionDetails(accessToken, id) {
    return get(`${BASE}/transactions/${encodeURIComponent(id)}/details`, accessToken, ACCEPT_TRANSACTIONS);
}

// Bankens kategorier + berikelse. NB: query-parameternavnet er ikke verifisert
// ennå (spec viste "Account keys"); valider mot ett kall før produksjon.
export async function fetchClassifiedTransactions(accessToken, accountKey, fromDate, toDate) {
  const qs = new URLSearchParams({ accountKey, fromDate, toDate });
  const data = await get(`${BASE}/transactions/classified?${qs}`, accessToken, ACCEPT_TRANSACTIONS);
  return data.transactions ?? [];
}
