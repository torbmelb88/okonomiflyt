// Foreign currencies the app understands — mirrors the companion app's
// notification whitelist (NotificationService.foreignCurrencies); keep the two
// in sync. Values are rough NOK per unit, used only to reject implausible
// pairings when the import suggests currency matches; the bank's converted
// amount is always the truth. The generous ±25% band absorbs rate drift and
// card fees.
export const FX_GUESS = {
    SEK: 0.95, DKK: 1.55, EUR: 11.5, USD: 10.5, GBP: 13.5, CHF: 12.5,
    PLN: 2.7, CZK: 0.47, HUF: 0.03, ISK: 0.075, THB: 0.30, JPY: 0.07,
    CAD: 7.6, AUD: 6.9, NZD: 6.3, TRY: 0.25, AED: 2.9, SGD: 7.9, HKD: 1.35,
};

export const FOREIGN_CURRENCIES = Object.keys(FX_GUESS);

export const fxPlausible = (code, foreignAmount, nokAmount) => {
    const rate = FX_GUESS[code];
    if (!rate || !foreignAmount || !nokAmount) return false;
    const implied = nokAmount / foreignAmount;
    return implied >= rate * 0.75 && implied <= rate * 1.25;
};
