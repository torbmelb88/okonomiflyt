// Parser for the monthly Trumf Kredittkort invoice (NorgesGruppen Finans).
//
// The card falls outside the bank sync and TrumfPay purchases never hit
// Google Wallet, so the invoice PDF is the only transaction export for it.
// This module is a pure function over the PDF's text lines (see pdfText.js
// for extraction) so it can be unit-tested and later moved server-side.
//
// Layout (page 2, "Transaksjonsoversikt"):
//   Bokf. dato  Kjøpsdato  Spesifikasjon  Kurs  Valuta  Beløp  Beløp i NOK
//   14.08.26    14.08.26   TrumfPay, KIWI 204 Skreia, 2026-08-14 18.43.23  NOK  -600,30  -600,30
// Purchases are negative, refunds/payments positive.

const DATE_RE = /^(\d{2})\.(\d{2})\.(\d{2,4})$/;
const AMOUNT_RE = /^-?\d{1,3}(?:\.\d{3})*,\d{2}$|^-?\d+,\d{2}$/;

// dd.mm.yy → yyyy-mm-dd (2-digit years are 20xx)
export const parseNorwegianDate = (str) => {
    const m = (str || '').trim().match(DATE_RE);
    if (!m) return null;
    const [, dd, mm, yy] = m;
    const year = yy.length === 2 ? `20${yy}` : yy;
    return `${year}-${mm}-${dd}`;
};

// "4.761,33" → 4761.33, "-600,30" → -600.3
export const parseNorwegianAmount = (str) => {
    if (str == null) return NaN;
    const clean = String(str).trim().replace(/\s/g, '').replace(/\./g, '').replace(',', '.');
    return parseFloat(clean);
};

// Whitespace-normalize a line and split into cells on runs of 2+ spaces or tabs.
const cells = (line) => line.split(/\t|\s{2,}/).map(c => c.trim()).filter(Boolean);

// A transaction row: two dates first, then spec, [kurs], currency, amount, NOK amount.
const parseTransactionLine = (line) => {
    const c = cells(line);
    if (c.length < 5) return null;
    const booked = parseNorwegianDate(c[0]);
    const purchased = parseNorwegianDate(c[1]);
    if (!booked || !purchased) return null;

    const nokStr = c[c.length - 1];
    const amountStr = c[c.length - 2];
    if (!AMOUNT_RE.test(nokStr) || !AMOUNT_RE.test(amountStr)) return null;

    let idx = c.length - 3;
    let currency = null;
    if (idx >= 2 && /^[A-Z]{3}$/.test(c[idx])) { currency = c[idx]; idx--; }
    let rate = null;
    // Kurs only exists for foreign purchases; the spec always occupies index 2.
    if (idx > 2 && /^\d+([.,]\d+)?$/.test(c[idx])) { rate = parseNorwegianAmount(c[idx]); idx--; }
    const spec = c.slice(2, idx + 1).join(' ').trim();
    if (!spec) return null;

    return {
        bookedDate: booked,
        date: purchased,
        spec,
        currency: currency || 'NOK',
        rate,
        amountOriginal: parseNorwegianAmount(amountStr),
        amountNok: parseNorwegianAmount(nokStr),
    };
};

// "TrumfPay, KIWI 204 Skreia, 2026-08-14 18.43.23" → merchant + wall-clock time.
// Card-terminal purchases are just the merchant text.
const splitSpec = (spec) => {
    const m = spec.match(/^(TrumfPay),\s*(.+?),\s*(\d{4}-\d{2}-\d{2})\s+(\d{2})\.(\d{2})\.(\d{2})$/i);
    if (m) {
        return { name: m[2].trim(), method: 'TrumfPay', purchaseTime: `${m[4]}:${m[5]}:${m[6]}` };
    }
    return { name: spec, method: null, purchaseTime: null };
};

const PAYMENT_RE = /innbetal|betaling mottatt|takk for (din )?betaling|nettbank|avtalegiro|efaktura/i;

const classify = (row) => {
    if (row.amountNok < 0) return 'purchase';
    if (PAYMENT_RE.test(row.spec)) return 'payment';
    return 'refund';
};

// Header value that follows a label on the same line, e.g. "Fakturadato 14.08.26".
const headerValue = (lines, label) => {
    const re = new RegExp(`^${label}\\s+(.+)$`, 'i');
    for (const line of lines) {
        const m = line.trim().replace(/\s+/g, ' ').match(re);
        if (m) return m[1].trim();
    }
    return null;
};

export const isTrumfInvoice = (lines) => {
    const text = lines.join('\n');
    return /NorgesGruppen Finans/i.test(text) && /Transaksjonsoversikt/i.test(text);
};

/**
 * @param {string[]} lines — text lines of the whole PDF, in reading order.
 *   Cells within a line should be separated by a tab or 2+ spaces.
 * @returns {{ header: object, rows: object[], warnings: string[] }}
 */
export const parseTrumfInvoice = (lines) => {
    if (!isTrumfInvoice(lines)) {
        throw new Error('Dette ser ikke ut som en Trumf Kredittkort-faktura (fant ikke «NorgesGruppen Finans» / «Transaksjonsoversikt»).');
    }

    const warnings = [];
    const header = {
        invoiceNumber: headerValue(lines, 'Fakturanummer'),
        invoiceDate: parseNorwegianDate(headerValue(lines, 'Fakturadato')),
        dueDate: parseNorwegianDate(headerValue(lines, 'Forfallsdato')),
        minimumPayment: parseNorwegianAmount(headerValue(lines, 'Minstebeløp å betale')),
        totalDue: parseNorwegianAmount(headerValue(lines, 'Totalt skyldig beløp')),
        kid: headerValue(lines, 'KID')?.replace(/\s/g, '') || null,
        accountNumber: headerValue(lines, 'Til konto'),
    };
    if (Number.isNaN(header.totalDue)) header.totalDue = null;
    if (Number.isNaN(header.minimumPayment)) header.minimumPayment = null;

    // Transactions live between "Transaksjonsoversikt" and "Nytt skyldig beløp".
    const start = lines.findIndex(l => /Transaksjonsoversikt/i.test(l));
    const section = lines.slice(start + 1);
    const rows = [];
    let previousBalance = null;
    let newBalance = null;

    for (const line of section) {
        const flat = line.replace(/\s+/g, ' ').trim();
        let m;
        if ((m = flat.match(/^Totalt skyldig beløp forrige periode\s+(-?[\d.]+,\d{2})$/i))) {
            previousBalance = parseNorwegianAmount(m[1]);
            continue;
        }
        if ((m = flat.match(/^Nytt skyldig beløp\s+(-?[\d.]+,\d{2})$/i))) {
            newBalance = parseNorwegianAmount(m[1]);
            break;
        }
        const row = parseTransactionLine(line);
        if (!row) continue;
        const { name, method, purchaseTime } = splitSpec(row.spec);
        rows.push({ ...row, name, method, purchaseTime, kind: classify(row) });
    }

    if (rows.length === 0) {
        warnings.push('Fant ingen transaksjonslinjer i fakturaen.');
    }

    // Sanity: previous balance + all rows should equal the new balance.
    // (The invoice prints balances as negatives — "-4.761,33" owed.)
    if (previousBalance !== null && newBalance !== null) {
        const sum = rows.reduce((s, r) => s + r.amountNok, 0);
        const expected = newBalance - previousBalance;
        if (Math.abs(sum - expected) > 0.011) {
            warnings.push(
                `Summen av transaksjonene (${sum.toFixed(2)}) stemmer ikke med endringen i skyldig beløp (${expected.toFixed(2)}) — noen linjer kan mangle.`
            );
        }
    }

    // Older-first, matching how transactions are usually reviewed.
    rows.sort((a, b) => (a.date + (a.purchaseTime || '')).localeCompare(b.date + (b.purchaseTime || '')));

    return { header, rows, warnings, previousBalance, newBalance };
};

/**
 * Convert parsed invoice rows to the shape the import pipeline expects
 * (same as CSV rows): positive amount + type, plus a few Trumf-specific
 * fields kept on the transaction for traceability.
 */
export const invoiceRowsToImportRows = (parsed, accountId) => {
    return parsed.rows.map(row => {
        const isPayment = row.kind === 'payment';
        const type = row.amountNok < 0 ? 'expense' : 'income';
        return {
            date: row.date,
            month: row.date.substring(0, 7),
            name: row.name,
            amount: Math.abs(row.amountNok),
            type,
            // Payments of the previous invoice are money movement, not spending —
            // matches the reconcile modal's "Betaling kredittkortregning" action.
            category: isPayment ? 'Kredittkortregning' : '',
            accountId,
            source: 'trumf-invoice',
            invoiceNumber: parsed.header.invoiceNumber || null,
            bookedDate: row.bookedDate,
            purchaseTime: row.purchaseTime,
            paymentMethod: row.method,
            ...(row.currency !== 'NOK' ? {
                originalAmount: Math.abs(row.amountOriginal),
                originalCurrency: row.currency,
            } : {}),
        };
    });
};
