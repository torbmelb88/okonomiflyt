import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const TOKEN_URL = 'https://api-auth.sparebank1.no/oauth/token';

/**
 * Henter et ferskt access token via refresh_token-flyten (ingen BankID).
 * SB1 roterer refresh-token-en, så den nye persisteres umiddelbart — ellers
 * låser du deg ute neste gang.
 */
export async function getAccessToken({ clientId, clientSecret, tokenStorePath, seedRefreshToken }) {
  const refreshToken = await loadRefreshToken(tokenStorePath, seedRefreshToken);
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token-fornying feilet (${res.status}): ${text}`);
  }

  const data = await res.json();
  if (data.refresh_token) {
    await saveRefreshToken(tokenStorePath, data.refresh_token);
  }
  if (!data.access_token) {
    throw new Error('Token-svar manglet access_token.');
  }
  return data.access_token;
}

async function loadRefreshToken(storePath, seed) {
  try {
    const raw = await readFile(storePath, 'utf8');
    const { refresh_token } = JSON.parse(raw);
    if (refresh_token) return refresh_token;
  } catch {
    // Filen finnes ikke ennå -> fall tilbake på bootstrap-seed.
  }
  if (!seed) {
    throw new Error(
      `Ingen refresh-token i ${storePath} og ingen SB1_REFRESH_TOKEN å bootstrappe fra. ` +
      'Kjør BankID-innloggingen på nytt for å skaffe en.'
    );
  }
  await saveRefreshToken(storePath, seed);
  return seed;
}

async function saveRefreshToken(storePath, token) {
  await mkdir(path.dirname(storePath), { recursive: true });
  await writeFile(
    storePath,
    JSON.stringify({ refresh_token: token, updatedAt: new Date().toISOString() }, null, 2)
  );
}
