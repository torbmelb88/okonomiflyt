import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useBudget } from '../../contexts/BudgetContext';
import { Download } from 'lucide-react';
import TransactionsPanel from './TransactionsPanel';
import MonthStatusCard from './MonthStatusCard';
import { currentMonth } from '../../utils/provisional';
import { isHandled, reconcileState } from '../../utils/reconciliation';
import { coverIssues } from '../../utils/coverage';
import { useDialog } from '../../contexts/DialogContext';

/**
 * Transaksjoner = the raw transaction list and reconciliation. Owns the
 * complete list (bank + credit card in one view) plus the two-state banner:
 * everything reconciled, or transactions still needing follow-up.
 *
 * Household-wide: every budget's rows. Getting transactions in happens on
 * the Import page; plan vs. actual lives on the Budsjett page.
 */
export default function Transactions() {
    const { confirm } = useDialog();
    const { allTransactions: transactions, accounts, loading, isMonthReconciled, monthStatuses, setMonthReconciled } = useBudget();

    const [selectedMonth, setSelectedMonth] = useState(() => {
        const now = new Date();
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    });
    const [reconcileNonce, setReconcileNonce] = useState(0);
    const [focusNonce, setFocusNonce] = useState(0);
    const [savingReconciled, setSavingReconciled] = useState(false);

    if (loading) return <div>Laster transaksjoner...</div>;

    const monthEndLabel = (monthStr) => {
        const [year, month] = monthStr.split('-').map(Number);
        return new Date(year, month, 0).toLocaleDateString('no-NO', { day: 'numeric', month: 'long' });
    };
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
    // Red flag: transfers marked «dekkes av innbetaling» whose payment is
    // missing or doesn't add up (utils/coverage.js). Independent of the
    // reconcile state — such a row may well be «avstemt» as Sparing.
    const coverProblems = coverIssues(transactions, selectedMonth);
    const coverProblemRows = coverProblems.flatMap(g => g.expenses);

    // «Måneden er avstemt» (monthStatuses, household-wide) is set here, where
    // the work is done: it means every row for the month is handled. Min
    // Oversikt shows liquidity as final once it is set; Oppgjør only reads it.
    const monthReconciled = isMonthReconciled(selectedMonth);
    const reconciledAt = monthStatuses.find(ms => ms.month === selectedMonth)?.reconciledAt;
    const pendingLabel = () => {
        const n = (x) => x === 1 ? '1 transaksjon' : `${x} transaksjoner`;
        const parts = [];
        if (bookedCount > 0) parts.push(`${n(bookedCount)} er kun bokført (venter på bankmatch)`);
        if (unreconciledCount > 0) parts.push(`${n(unreconciledCount)} er ikke kategorisert`);
        if (coverProblemRows.length > 0) parts.push(`${coverProblemRows.length === 1 ? '1 overføring' : `${coverProblemRows.length} overføringer`} på gjennomreise mangler innbetaling`);
        return parts.join(', ').replace(/, ([^,]*)$/, ' og $1');
    };
    const toggleReconciled = async () => {
        if (!monthReconciled && bookedCount + unreconciledCount + coverProblemRows.length > 0) {
            if (!await confirm({ title: 'Markere måneden som avstemt likevel?', message: `${pendingLabel()} i ${formatMonth(selectedMonth)}.`, confirmText: 'Marker som avstemt', variant: 'warning' })) return;
        }
        setSavingReconciled(true);
        try { await setMonthReconciled(selectedMonth, !monthReconciled); }
        catch { /* logget i BudgetContext */ }
        finally { setSavingReconciled(false); }
    };

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Transaksjoner</h1>
                    <p className="text-sm text-gray-500 dark:text-gray-400">Alle kontoer og budsjetter i ett. Her gjøres arbeidet; resultatet står på Min Oversikt, Oppgjør og Budsjett.</p>
                </div>
                <Link to="/import" className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 font-medium shadow-sm text-sm">
                    <Download className="w-4 h-4" />
                    <span>Til import</span>
                </Link>
            </div>

            {/* Where the month stands: checklist + marking (MonthStatusCard) */}
            <MonthStatusCard

                monthLabel={formatMonth(selectedMonth)}
                isOver={selectedMonth < currentMonth()}
                endsLabel={monthEndLabel(selectedMonth)}
                unreconciledCount={unreconciledCount}
                coverProblemCount={coverProblemRows.length}
                bookedCount={bookedCount}
                monthReconciled={monthReconciled}
                reconciledAt={reconciledAt}
                saving={savingReconciled}
                onReconcileNow={() => setReconcileNonce(n => n + 1)}
                onFixCover={() => setFocusNonce(n => n + 1)}
                onToggleReconciled={toggleReconciled}
            />

            {/* Transactions (all accounts, bank + credit card) */}
            <TransactionsPanel
                accounts={accounts}
                selectedMonth={selectedMonth}
                setSelectedMonth={setSelectedMonth}
                reconcileNonce={reconcileNonce}
                focusIds={coverProblemRows.map(t => t.id)}
                focusNonce={focusNonce}
            />
        </div>
    );
}
