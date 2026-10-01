// «Telles i» — the month a transaction is counted in, as opposed to the
// month it was paid.
//
// Every transaction stores both `date` (the bank date) and `month`
// (YYYY-MM). Everything that sums per month — computeSplit, Oppgjør, Min
// Oversikt, Budsjett, the Transaksjoner list, the MCP server — reads
// `month`, never the date. Normally `month` is simply the date's month, but
// a bill that is paid in one month and belongs to another (a kindergarten
// invoice with a wandering due date) can be counted in the previous or next
// month instead. That is done by setting `month` to that month while `date`
// stays what the bank says; a row is «moved» when the two disagree. No extra
// field, so nothing else in the app needs to know.

export const dateMonth = (date) => (date || '').slice(0, 7);

/** True when the row is counted in a different month than it was paid. */
export const isCountedInOtherMonth = (t) => !!t?.month && !!t?.date && t.month !== dateMonth(t.date);

/**
 * The `month` to store when a row gets a (possibly new) date: a moved row
 * keeps the month it was moved to, everything else follows the date. Used
 * wherever the bank re-dates a row (import rebook, FX match) so a deliberate
 * move is not undone by the next import.
 */
export const monthAfterRedate = (t, newDate) => isCountedInOtherMonth(t) ? t.month : dateMonth(newDate);

export const addMonths = (month, delta) => {
    const [y, m] = month.split('-').map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

/** «september 2026» */
export const formatMonthLong = (month) => {
    if (!month) return '';
    const [y, m] = month.split('-').map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString('no-NO', { month: 'long', year: 'numeric' });
};

/** «sep.» — for badges */
export const formatMonthShort = (month) => {
    if (!month) return '';
    const [y, m] = month.split('-').map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString('no-NO', { month: 'short' });
};

/** One wording everywhere: badge text for a moved row. */
export const countedInLabel = (t) => `Telles i ${formatMonthShort(t.month)}`;
export const countedInTitle = (t) => `Betalt ${t.date}, telles i ${formatMonthLong(t.month)} i oppgjør, budsjett og oversikt.`;
