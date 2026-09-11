// Net salary on Min Oversikt, from three sources in priority order:
//
// 1. 'actual'   — the month's transactions marked «Lønn». Always wins.
// 2. 'estimate' — a provisional amount typed in for that one month (from
//                 the payslip, days before the money lands). Stored on the
//                 personal budget as `salaryEstimates: { 'YYYY-MM': n }`.
// 3. 'default'  — `expectedSalary` on the personal budget (Innstillinger),
//                 applied to the current and future months only, so old
//                 months without a salary row keep showing what really came.
//
// Estimates never become transactions — they only fill the salary line
// until the real row arrives, and are then ignored (a mismatch is surfaced
// as a note, nothing to clean up).

export const SALARY_SOURCE_LABEL = {
    actual: 'Basert på transaksjoner merket «Lønn»',
    estimate: 'Foreløpig — fra lønnsslippen, erstattes av lønnstransaksjonen',
    default: 'Anslag — ca. lønn fra Innstillinger, erstattes av lønnstransaksjonen',
    none: 'Basert på transaksjoner merket «Lønn» (ingen ennå)',
};

const isSalaryRow = (t, month) =>
    t.month === month && t.type === 'income' && (t.category || '').trim().toLowerCase() === 'lønn';

export const actualSalary = (transactions, month) =>
    (Array.isArray(transactions) ? transactions : [])
        .filter(t => isSalaryRow(t, month))
        .reduce((sum, t) => sum + (parseFloat(t.amount) || 0), 0);

export const salaryEstimateFor = (budget, month) => {
    const v = budget?.salaryEstimates?.[month];
    return typeof v === 'number' && v > 0 ? v : null;
};

export const currentMonth = (today = new Date()) =>
    `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;

/** { amount, source, actual, estimate, defaultAmount } for one month. */
export function resolveSalary({ budget, transactions, month, today }) {
    const actual = actualSalary(transactions, month);
    const estimate = salaryEstimateFor(budget, month);
    const defaultAmount = typeof budget?.expectedSalary === 'number' && budget.expectedSalary > 0 ? budget.expectedSalary : null;
    const hasActual = (Array.isArray(transactions) ? transactions : []).some(t => isSalaryRow(t, month));
    if (hasActual) return { amount: actual, source: 'actual', actual, estimate, defaultAmount };
    if (estimate != null) return { amount: estimate, source: 'estimate', actual: 0, estimate, defaultAmount };
    if (defaultAmount != null && month >= currentMonth(today)) return { amount: defaultAmount, source: 'default', actual: 0, estimate, defaultAmount };
    return { amount: 0, source: 'none', actual: 0, estimate, defaultAmount };
}
