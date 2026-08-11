# ØkonomiFlyt MCP-server

En ekstern [MCP](https://modelcontextprotocol.io)-server (Model Context Protocol)
som gjør ØkonomiFlyt tilgjengelig som **custom connector** i Claude på
[claude.ai](https://claude.ai) — inkludert mobilappen. Da kan du snakke med
Claude om økonomien fra telefonen:

> «Hvordan ligger vi an på matbudsjettet denne måneden?» ·
> «Hva kostet kyllingfilet sist, og hvor var den billigst?» ·
> «Jeg la ut 350 kr på Rema for fellesmiddagen — registrer det.»

Serveren kjører som en Cloud Function (2nd gen) i samme Firebase-prosjekt som
appen (samme oppskrift som
[Family Dash sin MCP-server](https://github.com/torbmelb88/family-dash/tree/main/mcp-server)). Den
bruker `firebase-admin` med prosjektets innebygde tjenestekonto — ingen
nøkkelfiler trengs, og de UID-låste Firestore-reglene som beskytter
klienttilgangen berøres ikke.

Siden MCP er en åpen standard fungerer serveren også med andre klienter som
støtter remote MCP over Streamable HTTP, f.eks. ChatGPT (utviklermodus),
Cursor og VS Code.

## Verktøy

| Verktøy | Gjør |
| --- | --- |
| `get_accounts` | Kontoer med sanntidssaldo fra SpareBank 1-synken |
| `list_budgets` | Budsjetter, medlemmer og budsjettposter med beløp |
| `get_month_summary` | Budsjett vs. faktisk per måned og budsjett, med avstemmingsstatus |
| `list_transactions` | Transaksjoner filtrert på måned/budsjett/konto/søk/uavstemt |
| `add_transaction` | Registrer manuell transaksjon — lander **uavstemt**, som companion-appen |
| `list_receipts` | Kvitteringer fra companion-appen, med matchestatus |
| `get_receipt_items` | Varelinjene på én kvittering |
| `search_grocery_prices` | Prishistorikk per vare på tvers av kjeder |
| `list_projects` | Prosjekter (oppussing, ferie …) med forbruk mot mål |

Skriving er med vilje begrenset til `add_transaction`, og alt den skriver
lander med `reconciled: false` — avstemmingen i webappen er fortsatt fasit,
akkurat som for companion-appen og sb1-sync. Summeringene bruker samme
eksklusjonsregler som appen (sparing, interne overføringer og
kredittkortregning telles som pengeflytting, ikke forbruk).

## Oppsett

Forutsetter et Firebase-prosjekt med ØkonomiFlyt i drift (se
[hoved-README-en](../README.md)) på **Blaze-plan** — Cloud Functions er ikke
tilgjengelig på gratisplanen. Forbruket for én husholdning ligger godt
innenfor gratiskvoten.

```bash
cd mcp-server
npm install
cp .env.example .env
```

Fyll inn `.env`:

```
MCP_SECRET=<lang tilfeldig streng>   # generer: node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

`MCP_SECRET` er tilgangsnøkkelen (se [Autentisering](#autentisering)).
`.env` er gitignorert og skal ikke committes.

Deploy fra repo-roten:

```bash
firebase deploy --only functions
```

Endepunktet blir:

```
https://europe-west1-<PROSJEKT-ID>.cloudfunctions.net/mcp/<MCP_SECRET>
```

## Koble til claude.ai

1. Gå til **Settings → Connectors → Add custom connector** på claude.ai
2. Lim inn endepunkt-URL-en (med `MCP_SECRET` i stien). La OAuth-feltene stå tomme.
3. I en samtale: åpne **+**-menyen → **Connectors** og slå på connectoren

Connectoren blir tilgjengelig i mobilappen på samme konto.

## Autentisering

Serveren er «authless» i MCP-forstand, men krever den hemmelige tokenen i
URL-stien — alternativt som `Authorization: Bearer`- eller `x-api-key`-header
for klienter som støtter det. Uten gyldig token svarer serveren 401 på alt.

Sikkerhetsmodellen er en *capability-URL*: alle som kjenner URL-en kan lese
transaksjoner, saldoer og kvitteringer, og registrere uavstemte
transaksjoner. Det er **økonomidata**, altså mer sensitivt enn en handleliste
— behandle URL-en som et passord, og ikke del connectoren videre. Tokenen
roteres på minutter ved behov: generer en ny `MCP_SECRET` i `.env`, deploy på
nytt, og oppdater URL-en i connectoren. Vurder full OAuth 2.1 hvis omfanget
vokser.

## Lokal testing

```bash
firebase emulators:start --only functions
# endepunkt: http://127.0.0.1:5001/<PROSJEKT-ID>/europe-west1/mcp/<MCP_SECRET>
```

Merk at Functions-emulatoren bruker Firebase CLI-innloggingen og snakker med
**produksjons**-Firestore, ikke en lokal kopi.
