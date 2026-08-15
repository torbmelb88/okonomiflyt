// Buffer target + build-up plan on a bill account (regningskonto).
//
// Deliberately global and simple: one target amount per bill account,
// compared against the bank balance. When the balance is short, a plan
// spreads the gap over N settlement months, split equally between the
// parties in the settlement (the user's model — not the expense split ratio).
//
// account.bufferTarget: number (kr)
// account.bufferPlan: { startMonth: 'YYYY-MM', months: number, monthlyTotal: number,
//                       gapAtStart: number, createdAt: ISO }
// `startMonth` is the first *settlement month* (the consumption month being
// settled, i.e. Oppgjør's month picker) that carries the extra.

export const addMonths = (month, delta) => {
    const [y, m] = month.split('-').map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

// 0-based index of `month` inside the plan window, or -1 when outside.
export const planMonthIndex = (plan, month) => {
    if (!plan || !plan.startMonth || !plan.months || !month) return -1;
    const [sy, sm] = plan.startMonth.split('-').map(Number);
    const [y, m] = month.split('-').map(Number);
    const idx = (y - sy) * 12 + (m - sm);
    return idx >= 0 && idx < plan.months ? idx : -1;
};

export const planCoversMonth = (plan, month) => planMonthIndex(plan, month) >= 0;

// Extra each party pays into the bill account for `month` under `plan`.
// Rounded up to whole kroner so the plan never under-delivers.
export const bufferContributionPerParty = (plan, month, parties = 2) => {
    if (!planCoversMonth(plan, month)) return 0;
    const n = Math.max(1, parties || 2);
    return Math.ceil((plan.monthlyTotal || 0) / n);
};

// Sum of per-party contributions across a list of accounts for one month
// (Min Oversikt: what *I* add on top of my share this month).
export const totalBufferContributionPerParty = (accounts, month, parties = 2) =>
    (accounts || []).reduce((sum, a) => sum + bufferContributionPerParty(a.bufferPlan, month, parties), 0);

// Builds a plan for closing `gap` over `months` settlement months from `startMonth`.
export const makeBufferPlan = ({ gap, months, startMonth }) => ({
    startMonth,
    months: Math.max(1, Math.round(months)),
    monthlyTotal: Math.ceil(Math.max(0, gap) / Math.max(1, Math.round(months))),
    gapAtStart: Math.max(0, gap),
    createdAt: new Date().toISOString(),
});

export const planEndMonth = (plan) => plan ? addMonths(plan.startMonth, plan.months - 1) : null;

// Balance for a bill account from the SB1 balance sync (available if known,
// otherwise booked). Null when the account has no bank link yet.
export const bufferBalanceFor = (account, bankBalances) => {
    if (!account?.sb1AccountKey) return null;
    const b = (bankBalances || []).find(x => x.sb1AccountKey === account.sb1AccountKey);
    if (!b) return null;
    if (typeof b.availableBalance === 'number') return b.availableBalance;
    if (typeof b.balance === 'number') return b.balance;
    return null;
};
