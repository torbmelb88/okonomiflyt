# sb1-sync

Henter transaksjoner fra SpareBank 1 sitt person-API og normaliserer dem til
ØkonomiFlyts standardform. Kjører som en selvstendig Docker-tjeneste på
hjemmeserveren, hodeløst, på timeplan.

> **Status:** uthenting + normalisering. Skriving til Firestore er bevisst
> _ikke_ med ennå — det venter til den nye datamodellen er bestemt (se nederst).

## Hvordan det henger sammen

To jobber, ett skille:

1. **Engangs, interaktiv (BankID):** gir den første `refresh_token`. Gjøres i
   nettleser/PowerShell på en PC. Du har allerede gjort dette.
2. **Tilbakevendende, hodeløs (denne tjenesten):** bruker `refresh_token` til å
   hente ferske access tokens og laste ned transaksjoner. Ingen BankID.

**30-dagers-regelen:** `refresh_token` varer 30 dager og roterer for hver bruk.
Kjører tjenesten daglig, fornyer den seg selv i det uendelige. Står den
avslått i mer enn 30 dager, må du gjøre BankID på nytt (steg 1).

## Oppsett

1. Kopier `.env.example` til `.env` og fyll inn:
   - `SB1_CLIENT_ID`, `SB1_CLIENT_SECRET` (fra developer.sparebank1.no)
   - `SB1_REFRESH_TOKEN` (bootstrap — refresh-token fra BankID-innloggingen)

2. **Test lokalt** (krever Node 20+):
   ```bash
   npm install
   npm run once
   ```
   Skriver `data/transactions.json` og lagrer den roterte token-en i
   `data/token.json`. Etter første kjøring kan `SB1_REFRESH_TOKEN` stå tom —
   `data/token.json` er nå fasit.

3. **Deploy på serveren (Docker):**
   ```bash
   docker compose up -d --build
   ```
   `docker-compose.yml` setter `SB1_SCHEDULE=0 6 * * *` (daglig 06:00 norsk tid)
   og monterer `./data` som volum slik at den roterende token-en overlever
   restart. **Dette volumet er kritisk** — mister du `token.json`, må du
   bootstrappe på nytt.

## Konfigurasjon (miljøvariabler)

| Variabel | Default | Forklaring |
|---|---|---|
| `SB1_CLIENT_ID` | — | Klient-ID fra SB1 |
| `SB1_CLIENT_SECRET` | — | Klient-secret fra SB1 |
| `SB1_REFRESH_TOKEN` | — | Kun bootstrap; brukes hvis `token.json` mangler |
| `SB1_TOKEN_STORE` | `./data/token.json` | Hvor den roterende token-en lagres |
| `SB1_OUT_DIR` | `./data` | Hvor `transactions.json` skrives |
| `SB1_LOOKBACK_DAYS` | `90` | Antall dager bakover per synk |
| `SB1_USE_CLASSIFIED` | `false` | Bruk `/classified` for bankens kategorier |
| `SB1_SCHEDULE` | _(tom)_ | Cron (Europe/Oslo). Tom = kjør én gang og avslutt |

## Normalisert form

`src/normalize.js` er den eneste filen som kjenner SB1-feltnavn. Hver
transaksjon blir:

```json
{
  "externalId": "AbC123_...",      // stabil ID -> eksakt dedup
  "source": "sb1",
  "date": "2026-05-28",
  "amount": 90,
  "type": "expense",
  "name": "Eksempelbutikken",
  "rawDescription": "Vipps*Eksempelbutikken",
  "category": null,                 // fylles av /classified
  "accountKey": "XyZ9-...",
  "accountName": "Brukskonto",
  "accountNumber": "12345678903",
  "currency": "NOK",
  "bookingStatus": "BOOKED",
  "raw": { "...": "hele SB1-objektet" }
}
```

## Validerte endepunkter

| Hva | Metode + URL | Accept |
|---|---|---|
| Kontoer | `GET /personal/banking/accounts` | `v5+json` |
| Transaksjoner | `GET /personal/banking/transactions?accountKey=&fromDate=&toDate=` | `v1+json` |
| Token-fornying | `POST https://api-auth.sparebank1.no/oauth/token` (Basic auth) | — |

`/transactions/classified` er kartlagt men ikke kjørt mot ennå — verifiser
query-parameternavnet (`accountKey` vs «Account keys») før du skrur på
`SB1_USE_CLASSIFIED`.

## Firestore-sink (mellomlager)

Med `SB1_SINK=firestore` (eller `both`) upsertes normaliserte transaksjoner til
en **mellomlagrings-collection** (`SB1_FIRESTORE_COLLECTION`, default
`sb1Transactions`), med `externalId` som dokument-ID (re-kjøring overskriver,
ingen duplikater). Dette er en rå landingssone — ruting inn i appens egen
`transactions` (budsjett/konto-tilordning, dedup mot CSV) kommer som eget steg.

**Oppsett av service account-nøkkel:**
1. Firebase Console → Prosjektinnstillinger → Tjenestekontoer → «Generer ny
   privat nøkkel». Last ned JSON-fila.
2. Legg den på serveren i data-volumet som `sa-key.json`
   (monteres som `/app/data/sa-key.json` i containeren).
3. `SB1_SINK=firestore` og `GOOGLE_APPLICATION_CREDENTIALS=/app/data/sa-key.json`
   er satt i `docker-compose.yml`. Nøkkelen ligger på volumet, ikke i git.

## Neste steg (ikke implementert)

- **Ruting til appens `transactions`:** transformer fra mellomlageret til appens
  modell (budsjett/konto, konto-oppretting, dedup mot CSV, avstemming).
- **Kredittkort** dekkes ikke av SB1 — beholder CSV-importen som egen
  "manuell" kilde.
