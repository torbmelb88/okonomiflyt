// Provisional amounts on Min Oversikt — net salary and fixed savings — from
// three sources in priority order:
//
// 1. 'actual'   — the month's transactions («Lønn» income / «Sparing»
//                 expense). Always win once any exist.
// 2. 'estimate' — a provisional amount typed in for that one month (the
//                 payslip, days before the money lands). Stored on the
//                 personal budget as `salaryEstimates` / `savingsEstimates`:
//                 { 'YYYY-MM': n }.
// 3. 'default'  — `expectedSalary` / `expectedSavings` on the personal budget
//                 (Innstillinger), applied to the current and future months
//                 only, so old months keep showing what really happened.
//
// Estimates never become transactions — they only fill the line until the
// real rows arrive, and are then ignored (a mismatch is surfaced as a note,
// nothing to clean up). Without them liquidity looks too rosy early in the
// month: the salary is in, but the fixed savings transfer hasn't left yet.

import { isCoveredExpense } from './coverage';

export const currentMonth = (today = new Date()) =>
    `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;

const cat = (t) => (t.category || '').trim().toLowerCase();

const isSalaryRow = (t, month) => t.month === month && t.type === 'income' && cat(t) === 'lønn';
// Only the outgoing leg counts; a transfer funded by incoming money
// (barnetrygd → child's savings) is not my saving.
const isSavingsRow = (t, month) => t.month === month && t.type === 'expense' && cat(t) === 'sparing' && !isCoveredExpense(t);

const sumRows = (transactions, pred) =>
    (Array.isArray(transactions) ? transactions : []).filter(pred).reduce((s, t) => s + (parseFloat(t.amount) || 0), 0);

const positive = (v) => (typeof v === 'number' && v > 0 ? v : null);

/** { amount, source, actual, estimate, defaultAmount } for one month. */
function resolve({ transactions, month, isRow, estimate, defaultAmount, today }) {
    const rows = (Array.isArray(transactions) ? transactions : []).filter(t => isRow(t, month));
    const actual = sumRows(rows, () => true);
    if (rows.length > 0) return { amount: actual, source: 'actual', actual, estimate, defaultAmount };
    if (estimate != null) return { amount: estimate, source: 'estimate', actual: 0, estimate, defaultAmount };
    if (defaultAmount != null && month >= currentMonth(today)) return { amount: defaultAmount, source: 'default', actual: 0, estimate, defaultAmount };
    return { amount: 0, source: 'none', actual: 0, estimate, defaultAmount };
}

export const resolveSalary = ({ budget, transactions, month, today }) => resolve({
    transactions, month, today, isRow: isSalaryRow,
    estimate: positive(budget?.salaryEstimates?.[month]),
    defaultAmount: positive(budget?.expectedSalary),
});

export const resolveSavings = ({ budget, transactions, month, today }) => resolve({
    transactions, month, today, isRow: isSavingsRow,
    estimate: positive(budget?.savingsEstimates?.[month]),
    defaultAmount: positive(budget?.expectedSavings),
});

export const SALARY_SOURCE_LABEL = {
    actual: 'Basert på transaksjoner merket «Lønn»',
    estimate: 'Foreløpig — fra lønnsslippen, erstattes av lønnstransaksjonen',
    default: 'Anslag — ca. lønn fra Innstillinger, erstattes av lønnstransaksjonen',
    none: 'Basert på transaksjoner merket «Lønn» (ingen ennå)',
};

export const SAVINGS_SOURCE_LABEL = {
    actual: 'Transaksjoner merket «Sparing»',
    estimate: 'Foreløpig — erstattes av sparetransaksjonen når den kommer',
    default: 'Anslag — fast sparing fra Innstillinger, erstattes av sparetransaksjonen',
    none: 'Transaksjoner merket «Sparing» (ingen ennå)',
};

/** Parses «41 250,50» / «41250.5» to a number with two decimals, 0 when blank. */
export const parseAmount2 = (value) => Math.round((parseFloat(String(value ?? '').replace(/\s/g, '').replace(',', '.')) || 0) * 100) / 100;
