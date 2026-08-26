import { Activity, CheckCircle2, Clock } from 'lucide-react';

/**
 * Likviditet — the month's final in-minus-out on the personal budget.
 * Starts from «Til Forbruk» (net salary minus the transfers that leave the
 * checking account: joint account, bill account, savings) and then deducts
 * what was actually spent straight from the checking account(s) this month.
 * Updates as transactions land; only final once the month is over and
 * reconciled, so the card says which of the two it is.
 */
export default function LiquidityCard({ leftToSpend, checkingSpending, checkingOtherIncome, checkingAccounts, selectedMonth, formatMonth, monthReconciled }) {
    const result = leftToSpend - checkingSpending + checkingOtherIncome;
    const positive = result >= 0;
    const names = checkingAccounts.map(a => a.name).join(', ') || 'brukskonto';

    return (
        <div className="bg-white dark:bg-gray-800 p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 relative overflow-hidden group">
            <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                <Activity className="w-24 h-24 text-teal-600" />
            </div>

            <div className="relative z-10">
                <div className="flex items-center mb-4">
                    <div className="p-3 bg-teal-50 dark:bg-teal-900/20 rounded-xl mr-4">
                        <Activity className="w-6 h-6 text-teal-600 dark:text-teal-400" />
                    </div>
                    <div>
                        <h3 className="text-lg font-bold text-gray-900 dark:text-white">Likviditet</h3>
                        <p className="text-sm text-gray-500 dark:text-gray-400">Inn minus ut i {formatMonth(selectedMonth)}</p>
                    </div>
                </div>

                <div className="space-y-3 mb-6">
                    <div className="flex justify-between text-sm">
                        <span className="text-gray-600 dark:text-gray-400">Til forbruk (etter forpliktelser)</span>
                        <span className="font-medium text-gray-900 dark:text-white">{leftToSpend.toLocaleString('no-NO')} kr</span>
                    </div>
                    <div className="flex justify-between text-sm">
                        <span className="text-gray-600 dark:text-gray-400">− Forbruk fra {names}</span>
                        <span className="font-medium text-gray-900 dark:text-white">− {checkingSpending.toLocaleString('no-NO')} kr</span>
                    </div>
                    {checkingOtherIncome > 0 && (
                        <div className="flex justify-between text-sm">
                            <span className="text-gray-600 dark:text-gray-400">+ Andre inntekter på {names}</span>
                            <span className="font-medium text-gray-900 dark:text-white">+ {checkingOtherIncome.toLocaleString('no-NO')} kr</span>
                        </div>
                    )}
                    <div className="h-px bg-gray-100 dark:bg-gray-700 my-2"></div>
                </div>

                <div className="flex justify-between items-end">
                    <span className={`text-sm font-medium ${positive ? 'text-teal-600 dark:text-teal-400' : 'text-red-600 dark:text-red-400'}`}>Resultat</span>
                    <span className={`text-3xl font-bold ${positive ? 'text-gray-900 dark:text-white' : 'text-red-600 dark:text-red-400'}`}>
                        {result.toLocaleString('no-NO')} kr
                    </span>
                </div>

                <div className={`mt-4 flex items-start gap-2 text-xs rounded-lg px-3 py-2 ${monthReconciled
                    ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300'
                    : 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300'}`}>
                    {monthReconciled
                        ? <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" />
                        : <Clock className="w-4 h-4 flex-shrink-0 mt-0.5" />}
                    <span>
                        {monthReconciled
                            ? 'Endelig — måneden er avstemt.'
                            : 'Foreløpig — oppdateres etter hvert som transaksjoner kommer inn, og blir endelig først når måneden er over og avstemt.'}
                    </span>
                </div>
            </div>
        </div>
    );
}
