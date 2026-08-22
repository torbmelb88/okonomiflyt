import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useBudget } from '../../contexts/BudgetContext';
import { AlertTriangle, CheckCircle2, Download } from 'lucide-react';
import TransactionsPanel from './TransactionsPanel';
import { isHandled, reconcileState } from '../../utils/reconciliation';

/**
 * Transaksjoner = the raw transaction list and reconciliation. Owns the
 * complete list (bank + credit card in one view) plus the two-state banner:
 * everything reconciled, or transactions still needing follow-up.
 *
 * Getting transactions in happens on the Import page; the spending statistics
 * (budget-vs-actual, pie) live on the Forbruk page.
 */
export default function Transactions() {
    const { activeBudget, transactions, accounts, loading } = useBudget();

    const [selectedMonth, setSelectedMonth] = useState(() => {
        const now = new Date();
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    });
    const [reconcileNonce, setReconcileNonce] = useState(0);

    if (loading) return <div>Laster transaksjoner...</div>;
    if (!activeBudget) return <div>Ingen budsjett valgt.</div>;

    const formatMonth = (monthStr) => {
        const [year, month] = monthStr.split('-');
        return new Date(year, parseInt(month) - 1).toLocaleDateString('no-NO', { month: 'long', year: 'numeric' });
    };

    // --- Two-state banner: transactions still needing follow-up this month.
    // Booked rows (categorized, awaiting bank match) need no follow-up but are
    // counted separately so the banner can say the month isn't final yet. ---
    const monthTransactions = transactions.filter(t => t.month === selectedMonth);
    const unreconciledCount = monthTransactions.filter(t => !isHandled(t)).length;
    const bookedCount = monthTransactions.filter(t => reconcileState(t) === 'booked').length;

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Transaksjoner</h1>
                <Link to="/import" className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 font-medium shadow-sm text-sm">
                    <Download className="w-4 h-4" />
                    <span>Til import</span>
                </Link>
            </div>

            {/* Two-state banner */}
            {unreconciledCount > 0 ? (
                <div className="flex items-center justify-between gap-4 p-4 rounded-xl border bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800">
                    <div className="flex items-center gap-3">
                        <AlertTriangle className="w-6 h-6 text-amber-600 dark:text-amber-400 flex-shrink-0" />
                        <div>
                            <div className="font-semibold text-amber-800 dark:text-amber-200">
                                {unreconciledCount} {unreconciledCount === 1 ? 'transaksjon trenger' : 'transaksjoner trenger'} oppfølging
                            </div>
                            <div className="text-sm text-amber-700 dark:text-amber-300">Koble dem til budsjettposter for å få riktig forbruk for {formatMonth(selectedMonth)}.</div>
                        </div>
                    </div>
                    <button
                        onClick={() => setReconcileNonce(n => n + 1)}
                        className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white font-medium rounded-lg shadow-sm whitespace-nowrap"
                    >
                        Avstem nå
                    </button>
                </div>
            ) : (
                <div className="flex items-center gap-3 p-4 rounded-xl border bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800">
                    <CheckCircle2 className="w-6 h-6 text-green-600 dark:text-green-400 flex-shrink-0" />
                    <div>
                        <div className="font-semibold text-green-800 dark:text-green-200">
                            Alt håndtert for {formatMonth(selectedMonth)} — forbruket er koblet til budsjettpostene.
                        </div>
                        {bookedCount > 0 && (
                            <div className="text-sm text-green-700 dark:text-green-300">
                                {bookedCount} {bookedCount === 1 ? 'bokført transaksjon venter' : 'bokførte transaksjoner venter'} på avstemming mot banken — beløpene bekreftes ved neste bankimport.
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Transactions (all accounts, bank + credit card) */}
            <TransactionsPanel
                accounts={accounts}
                selectedMonth={selectedMonth}
                setSelectedMonth={setSelectedMonth}
                reconcileNonce={reconcileNonce}
            />
        </div>
    );
}
