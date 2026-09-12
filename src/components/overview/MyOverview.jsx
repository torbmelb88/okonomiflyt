import { useState, useEffect, useMemo } from 'react';
import { useBudget } from '../../contexts/BudgetContext';
import { useAuth } from '../../contexts/AuthContext';
import { api } from '../../services/firebase';
import { ArrowRight, Wallet, CreditCard, PiggyBank, Calculator, Info, Landmark, Pencil, Check, X } from 'lucide-react';
import { resolveSalary, resolveSavings, parseAmount2, SALARY_SOURCE_LABEL, SAVINGS_SOURCE_LABEL } from '../../utils/provisional';
import { totalBufferContributionPerParty } from '../../utils/bufferPlan';
import UnnecessaryPurchasesCard from './UnnecessaryPurchasesCard';
import LiquidityCard from './LiquidityCard';
import BufferCard from '../oppgjor/BufferCard';
import { refundStatus } from '../../utils/refunds';
import { coveringIncomeIds, isCoverNeutral } from '../../utils/coverage';
import { isExcludedFromSplit, heldOutOfTransfer, coveredByAccountOf } from '../../utils/settlement';

export default function MyOverview() {
    const { activeBudget, budgets, transactions, accounts, allProjects, isMonthReconciled, updateBudget } = useBudget();
    // Provisional salary / savings for the shown month (utils/provisional.js):
    // which line is being edited ('salary' | 'savings' | null) and its input.
    const [editing, setEditing] = useState(null);
    const [editInput, setEditInput] = useState('');
    const [savingEstimate, setSavingEstimate] = useState(false);
    const { currentUser } = useAuth();

    // Month Selection (Default to current)
    const [selectedMonth, setSelectedMonth] = useState(() => {
        const now = new Date();
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    });

    const [sharedShareAmount, setSharedShareAmount] = useState(0);
    const [loadingShared, setLoadingShared] = useState(false);

    // Helpers
    const formatMonth = (monthStr) => {
        const [year, month] = monthStr.split('-');
        const date = new Date(year, parseInt(month) - 1);
        return date.toLocaleDateString('no-NO', { month: 'long', year: 'numeric' });
    };

    const changeMonth = (delta) => {
        const [year, month] = selectedMonth.split('-').map(Number);
        const newDate = new Date(year, month - 1 + delta);
        const newMonthStr = `${newDate.getFullYear()}-${String(newDate.getMonth() + 1).padStart(2, '0')}`;
        setSelectedMonth(newMonthStr);
    };

    const getPreviousMonth = (currentMonth) => {
        const [year, month] = currentMonth.split('-').map(Number);
        const prevDate = new Date(year, month - 2);
        return `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`;
    };

    // --- CALCULATIONS ---

    // 0. Salary: the month's «Lønn» rows, else a provisional amount typed in
    // for the month, else the budget's expected salary (utils/provisional.js).
    const NONE = { amount: 0, source: 'none', actual: 0, estimate: null, defaultAmount: null };
    const salary = useMemo(() => {
        if (!activeBudget || activeBudget.type !== 'personal') return NONE;
        return resolveSalary({ budget: activeBudget, transactions, month: selectedMonth });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [transactions, selectedMonth, activeBudget]);
    const netSalary = salary.amount;

    // Per-month estimate for salary or savings; 0 removes it.
    const saveEstimate = async (kind, value) => {
        const field = kind === 'salary' ? 'salaryEstimates' : 'savingsEstimates';
        const n = parseAmount2(value);
        setSavingEstimate(true);
        try {
            const estimates = { ...(activeBudget[field] || {}) };
            if (n > 0) estimates[selectedMonth] = n; else delete estimates[selectedMonth];
            await updateBudget(activeBudget.id, { [field]: estimates });
            setEditing(null);
        } catch (err) {
            console.error('Could not save estimate', err);
            alert('Kunne ikke lagre beløpet.');
        } finally {
            setSavingEstimate(false);
        }
    };
    const startEditing = (kind, current) => { setEditInput(current != null ? String(current) : ''); setEditing(kind); };
    // Inline editor shared by the salary and savings cards (a render helper,
    // not a component, so the input keeps focus while typing)
    const renderEstimateEditor = (kind, placeholder) => (
        <form onSubmit={(e) => { e.preventDefault(); saveEstimate(kind, editInput); }} className="flex items-center gap-2">
            <input
                type="number" inputMode="decimal" min="0" step="0.01" autoFocus
                value={editInput}
                onChange={(e) => setEditInput(e.target.value)}
                placeholder={placeholder}
                className="w-40 px-3 py-2 text-right border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white focus:ring-2 focus:ring-green-500 outline-none"
            />
            <button type="submit" disabled={savingEstimate} title="Lagre" className="p-2 text-green-600 hover:bg-green-50 dark:hover:bg-green-900/30 rounded-lg disabled:opacity-50"><Check className="w-4 h-4" /></button>
            <button type="button" onClick={() => setEditing(null)} title="Avbryt" className="p-2 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"><X className="w-4 h-4" /></button>
        </form>
    );
    const sourceBadge = (source) => source === 'estimate'
        ? <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 text-[10px] font-bold uppercase tracking-wider">Foreløpig</span>
        : source === 'default'
            ? <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 text-[10px] font-bold uppercase tracking-wider">Anslag</span>
            : null;

    // 1. Joint Budget Share (ACTUALS from Prev Month)
    const prevMonthStr = getPreviousMonth(selectedMonth);

    useEffect(() => {
        if (!activeBudget || activeBudget.type !== 'personal') return;

        const calculateSharedShare = async () => {
            const sharedBudget = budgets.find(b => b.type === 'shared');
            if (!sharedBudget || !currentUser) {
                setSharedShareAmount(0);
                return;
            }

            setLoadingShared(true);
            try {
                // Fetch ALL transactions
                const allTransactions = await api.getCollection('transactions');

                // Filter for Shared Budget + Previous Month. Only linked
                // transactions enter the split (matching Oppgjor.jsx), and
                // rows held out by their own flag, their project or their
                // account stay out (utils/settlement.js).
                const monthTransactions = allTransactions.filter(t =>
                    t.budgetId === sharedBudget.id &&
                    t.month === prevMonthStr &&
                    !isExcludedFromSplit(t, accounts, allProjects)
                );

                // Calculate totals based on Payer. Income-type transactions
                // (credit notes/refunds) reduce the settlement.
                const signedAmount = (t) => (t.type === 'income' ? -1 : 1) * (parseFloat(t.amount) || 0);
                const totalSharedActual = monthTransactions
                    .filter((t) => !t.payer || t.payer === 'shared')
                    .reduce((sum, t) => sum + signedAmount(t), 0);

                const selfActual = monthTransactions
                    .filter((t) => t.payer === 'self')
                    .reduce((sum, t) => sum + signedAmount(t), 0);

                // Outlays paid with my private money: already paid, so they
                // are deducted from my transfer (mirrors Budget.jsx)
                const utleggSelf = monthTransactions
                    .filter((t) => t.paidPrivatelyBy === 'self')
                    .reduce((sum, t) => sum + signedAmount(t), 0);

                // Calculate Split Ratio
                let userShare = 0.5;
                const method = sharedBudget.splitMethod || 'income';

                if (method === '5050') {
                    userShare = 0.5;
                } else if (method === 'custom') {
                    userShare = (sharedBudget.customUserShare || 50) / 100;
                } else { // 'income' based
                    const totalIncome = sharedBudget.members?.reduce((sum, m) => sum + (m.income || 0), 0) || 0;
                    const currentUserMember = sharedBudget.members?.find(m => m.uid === currentUser.uid);
                    const currentUserIncome = currentUserMember ? (currentUserMember.income || 0) : 0;

                    if (totalIncome > 0) {
                        userShare = currentUserIncome / totalIncome;
                    } else {
                        userShare = 0.5;
                    }
                }

                // Calculate Raw Amount
                const rawUserAmount = totalSharedActual * userShare + selfActual - utleggSelf;

                // Apply Rounding (Read from localStorage)
                const roundingMode = parseInt(localStorage.getItem('roundingMode') || '1');
                let finalAmount = 0;

                if (roundingMode > 1) {
                    finalAmount = Math.ceil(rawUserAmount / roundingMode) * roundingMode;
                } else {
                    finalAmount = Math.round(rawUserAmount);
                }

                setSharedShareAmount(finalAmount);
            } catch (error) {
                console.error("Failed to calc shared actuals", error);
                setSharedShareAmount(0);
            } finally {
                setLoadingShared(false);
            }
        };
        calculateSharedShare();
    }, [activeBudget, budgets, prevMonthStr, currentUser, accounts, allProjects]);

    // Pass-through money (utils/coverage.js): a transfer funded by an incoming
    // payment, and that payment, are nobody's consumption — out of every sum.
    const coveringIds = useMemo(() => coveringIncomeIds(transactions), [transactions]);

    const creditCardUsage = useMemo(() => {
        if (!activeBudget || activeBudget.type !== 'personal') return 0;
        if (!Array.isArray(transactions)) return 0;
        return transactions
            .filter(t => {
                if (t.month !== prevMonthStr) return false;
                // Expenses count; credit notes/refunds count negatively. Other
                // income on the card (e.g. bill payments) is ignored.
                if (t.type !== 'expense' && !(t.type === 'income' && t.isRefund)) return false;
                if (t.refundSplit) return false; // represented by its split children
                // Held out of the transfer calc, or covered from another
                // account — on the row or via its project
                if (heldOutOfTransfer(t, allProjects)) return false;
                if (isCoverNeutral(t, coveringIds)) return false;
                // Must be linked to a Credit Card account
                const account = accounts.find(a => a.id === t.accountId);
                return account && account.type === 'Kredittkort';
            })
            .reduce((sum, t) => sum + (t.type === 'income' ? -t.amount : t.amount), 0);
    }, [transactions, prevMonthStr, accounts, activeBudget, coveringIds, allProjects]);

    // Buffer build-up on the shared bill account (plan made on Oppgjør): my
    // equal share of the monthly extra rides on top of the settlement transfer.
    const bufferContribution = useMemo(() => {
        const sharedBudget = budgets.find(b => b.type === 'shared');
        if (!sharedBudget) return 0;
        const parties = sharedBudget.members?.length || 2;
        const bufferAccounts = accounts.filter(a => a.isBillAccount && a.bufferTarget > 0 && (a.defaultBudgetId || a.budgetId) === sharedBudget.id);
        return totalBufferContributionPerParty(bufferAccounts, prevMonthStr, parties);
    }, [budgets, accounts, prevMonthStr]);

    const totalToJointAccount = sharedShareAmount + creditCardUsage + bufferContribution;

    // 3. Savings — transactions marked «Sparing» this month (only the outgoing
    // leg; incoming legs on the savings account are ignored so a pair never
    // nets to zero or double-counts), else the provisional/expected fixed
    // savings so liquidity isn't overstated before the transfer has left.
    const savings = useMemo(() => {
        if (!activeBudget || activeBudget.type !== 'personal') return NONE;
        return resolveSavings({ budget: activeBudget, transactions, month: selectedMonth });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [transactions, selectedMonth, activeBudget]);
    const savingsAmount = savings.amount;

    // 4. Bill account top-up — last month's ACTUAL consumption from accounts
    // flagged as regningskonto (money movement excluded), which is the amount
    // to transfer there now. Replaces the old budget-based fixed-expenses line
    // so the whole overview is driven by reconciled transactions.
    const billAccounts = useMemo(
        () => accounts.filter(a => a.isBillAccount && (a.defaultBudgetId || a.budgetId) === activeBudget?.id),
        [accounts, activeBudget]
    );
    const billAccountUsage = useMemo(() => {
        if (!activeBudget || activeBudget.type !== 'personal') return 0;
        if (!Array.isArray(transactions) || billAccounts.length === 0) return 0;
        const billIds = new Set(billAccounts.map(a => a.id));
        const isMoneyMovement = (t) => ['kredittkortregning', 'sparing', 'overføring', 'intern overføring']
            .includes((t.category || '').trim().toLowerCase());
        return transactions
            .filter(t => {
                if (t.month !== prevMonthStr) return false;
                if (!billIds.has(t.accountId)) return false;
                if (t.type !== 'expense' && !(t.type === 'income' && t.isRefund)) return false;
                if (t.refundSplit) return false; // represented by its split children
                // «Hold kostnad utenfor» excludes it from the top-up transfer,
                // whether or not another covering account was specified
                if (heldOutOfTransfer(t, allProjects)) return false;
                if (isMoneyMovement(t) || isCoverNeutral(t, coveringIds)) return false;
                return true;
            })
            .reduce((sum, t) => sum + (t.type === 'income' ? -t.amount : t.amount), 0);
    }, [transactions, prevMonthStr, billAccounts, activeBudget, coveringIds, allProjects]);

    // Buffer build-up on MY bill account(s): one party, so the whole monthly
    // extra from the plan (made on the BufferCard below) rides on the top-up.
    const personalBufferAccounts = useMemo(() => billAccounts.filter(a => a.bufferTarget > 0), [billAccounts]);
    const billBufferContribution = useMemo(
        () => totalBufferContributionPerParty(personalBufferAccounts, prevMonthStr, 1),
        [personalBufferAccounts, prevMonthStr]
    );
    const billAccountTotal = billAccountUsage + billBufferContribution;

    // 5. Total Calculations
    const totalObligations = totalToJointAccount + billAccountTotal + savingsAmount;
    const leftToSpend = netSalary - totalObligations;

    // 6. Likviditet — what actually left the checking account(s) THIS month,
    // on top of the transfers above. Money movement (the transfers to joint/
    // bill/savings accounts, card bills) is skipped because it is already in
    // the obligations; rows covered from another account are skipped because
    // that account, not the checking account, footed the bill. Salary is
    // netSalary already, so only other income is added back.
    const checkingAccounts = useMemo(
        () => accounts.filter(a => a.type === 'Bankkonto' && !a.isBillAccount && (a.defaultBudgetId || a.budgetId) === activeBudget?.id),
        [accounts, activeBudget]
    );
    const checkingFlow = useMemo(() => {
        if (!activeBudget || activeBudget.type !== 'personal') return { spending: 0, otherIncome: 0 };
        if (!Array.isArray(transactions) || checkingAccounts.length === 0) return { spending: 0, otherIncome: 0 };
        const ids = new Set(checkingAccounts.map(a => a.id));
        const cat = (t) => (t.category || '').trim().toLowerCase();
        const isMoneyMovement = (t) => ['kredittkortregning', 'sparing', 'overføring', 'intern overføring'].includes(cat(t));
        let spending = 0, otherIncome = 0;
        for (const t of transactions) {
            if (t.month !== selectedMonth || !ids.has(t.accountId)) continue;
            if (isMoneyMovement(t) || coveredByAccountOf(t, allProjects) || t.refundSplit || isCoverNeutral(t, coveringIds)) continue;
            const amount = parseFloat(t.amount) || 0;
            if (t.type === 'expense') spending += amount;
            else if (t.type === 'income' && t.isRefund) spending -= amount;
            else if (t.type === 'income' && cat(t) !== 'lønn') otherIncome += amount;
        }
        return { spending: Math.round(spending), otherIncome: Math.round(otherIncome) };
    }, [transactions, selectedMonth, checkingAccounts, activeBudget, coveringIds, allProjects]);

    // Refunds still expected on this month's purchases (a partner's Vipps
    // etc.). Informational: the purchase is already deducted in full above,
    // and the incoming payment nets it out once it is linked.
    const pendingRefunds = useMemo(() => {
        if (!Array.isArray(transactions)) return 0;
        return Math.round(transactions
            .filter(t => t.awaitingRefund && t.type === 'expense' && t.month === selectedMonth)
            .reduce((s, t) => { const r = refundStatus(t, transactions); return s + Math.max(0, r.expected - r.refunded); }, 0));
    }, [transactions, selectedMonth]);

    // --- RENDER ---
    if (!activeBudget) return null;

    if (activeBudget.type !== 'personal') {
        return (
            <div className="flex flex-col items-center justify-center p-12 text-center h-[50vh]">
                <Wallet className="w-16 h-16 text-gray-300 mb-4" />
                <h2 className="text-xl font-bold text-gray-900 dark:text-white">Min Oversikt er kun for private budsjett</h2>
                <p className="text-gray-500 max-w-md mt-2">Denne oversikten er laget for å hjelpe deg med din private økonomi og overføringer til felleskonto.</p>
            </div>
        );
    }

    return (
        <div className="max-w-4xl mx-auto space-y-8 animate-in fade-in duration-500">

            {/* Header / Month Selector */}
            <div className="flex items-center justify-between mb-8">
                <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Min Oversikt</h1>

                <div className="flex items-center space-x-4 bg-white dark:bg-gray-800 p-2 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700">
                    <button onClick={() => changeMonth(-1)} className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors">
                        <ArrowRight className="w-5 h-5 transform rotate-180 text-gray-500" />
                    </button>
                    <span className="text-lg font-semibold capitalize min-w-[140px] text-center text-gray-900 dark:text-white">
                        {formatMonth(selectedMonth)}
                    </span>
                    <button onClick={() => changeMonth(1)} className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors">
                        <ArrowRight className="w-5 h-5 text-gray-500" />
                    </button>
                </div>
            </div>

            {/* Salary: actual «Lønn» rows, else provisional (payslip), else the expected salary from Innstillinger */}
            <div className="bg-white dark:bg-gray-800 p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700">
                <div className="flex items-center justify-between gap-4">
                    <div className="min-w-0">
                        <div className="flex items-center gap-2">
                            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Din Lønn (Netto)</h2>
                            <Info
                                className="w-4 h-4 text-gray-400 cursor-help"
                                title="Transaksjoner merket «Lønn» vinner alltid. Til de kommer kan du legge inn beløpet fra lønnsslippen for denne måneden, eller la anslaget fra Innstillinger gjelde."
                            />
                            {sourceBadge(salary.source)}
                        </div>
                        <p className="text-sm text-gray-500 dark:text-gray-400">{SALARY_SOURCE_LABEL[salary.source]}</p>
                        {salary.source === 'actual' && salary.estimate != null && Math.abs(salary.estimate - salary.actual) >= 1 && (
                            <p className="text-xs text-amber-700 dark:text-amber-300 mt-1">
                                Lønnsslippen sa {salary.estimate.toLocaleString('no-NO')} kr — faktisk {salary.actual.toLocaleString('no-NO')} kr ({salary.actual > salary.estimate ? '+' : '−'}{Math.abs(salary.actual - salary.estimate).toLocaleString('no-NO')} kr).
                            </p>
                        )}
                    </div>
                    <div className="text-right flex-shrink-0">
                        {editing === 'salary' ? renderEstimateEditor('salary', 'Beløp fra lønnsslippen') : (
                            <div className="flex items-center justify-end gap-2">
                                <span className={`text-3xl font-bold ${salary.source === 'actual' ? 'text-gray-900 dark:text-white' : 'text-gray-600 dark:text-gray-300'}`}>{netSalary.toLocaleString('no-NO')} kr</span>
                                {salary.source !== 'actual' && (
                                    <button onClick={() => startEditing('salary', salary.estimate)} title="Legg inn beløpet fra lønnsslippen for denne måneden" className="p-2 text-gray-400 hover:text-green-600 hover:bg-green-50 dark:hover:bg-green-900/30 rounded-lg">
                                        <Pencil className="w-4 h-4" />
                                    </button>
                                )}
                            </div>
                        )}
                        {editing !== 'salary' && salary.source === 'estimate' && (
                            <button onClick={() => saveEstimate('salary', 0)} disabled={savingEstimate} className="text-xs text-gray-400 hover:text-red-600 dark:hover:text-red-400 mt-1">Fjern foreløpig beløp</button>
                        )}
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

                {/* Left Column: TRANSFERS */}
                <div className="space-y-6">
                    <h3 className="text-sm uppercase tracking-wider text-gray-500 font-bold ml-1">Må Overføres</h3>

                    {/* To Joint Account */}
                    <div className="bg-white dark:bg-gray-800 p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 relative overflow-hidden group">
                        <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                            <CreditCard className="w-24 h-24 text-blue-600" />
                        </div>

                        <div className="relative z-10">
                            <div className="flex items-center mb-4">
                                <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-xl mr-4">
                                    <CreditCard className="w-6 h-6 text-blue-600 dark:text-blue-400" />
                                </div>
                                <div>
                                    <h3 className="text-lg font-bold text-gray-900 dark:text-white">Til Felleskonto</h3>
                                    <p className="text-sm text-gray-500 dark:text-gray-400">Total overføring</p>
                                </div>
                            </div>

                            <div className="space-y-3 mb-6">
                                <div className="flex justify-between text-sm">
                                    <span className="text-gray-600 dark:text-gray-400">Andel fellesutgifter ({formatMonth(prevMonthStr)})</span>
                                    <span className="font-medium text-gray-900 dark:text-white">
                                        {loadingShared ? '...' : sharedShareAmount.toLocaleString('no-NO')} kr
                                    </span>
                                </div>
                                <div className="flex justify-between text-sm">
                                    <span className="text-gray-600 dark:text-gray-400">Kredittkort ({formatMonth(prevMonthStr)})</span>
                                    <span className="font-medium text-gray-900 dark:text-white">{creditCardUsage.toLocaleString('no-NO')} kr</span>
                                </div>
                                {bufferContribution > 0 && (
                                    <div className="flex justify-between text-sm">
                                        <span className="text-gray-600 dark:text-gray-400 flex items-center gap-1"><PiggyBank className="w-3.5 h-3.5 text-purple-500" /> Bufferoppbygging regningskonto</span>
                                        <span className="font-medium text-gray-900 dark:text-white">{bufferContribution.toLocaleString('no-NO')} kr</span>
                                    </div>
                                )}
                                <div className="h-px bg-gray-100 dark:bg-gray-700 my-2"></div>
                            </div>

                            <div className="flex justify-between items-end">
                                <span className="text-sm font-medium text-blue-600 dark:text-blue-400">Totalt å overføre</span>
                                <span className="text-3xl font-bold text-gray-900 dark:text-white">{totalToJointAccount.toLocaleString('no-NO')} kr</span>
                            </div>
                        </div>
                    </div>

                    {/* To Bill Account */}
                    {billAccounts.length > 0 && (
                        <div className="bg-white dark:bg-gray-800 p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 relative overflow-hidden group">
                            <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                                <Landmark className="w-24 h-24 text-amber-600" />
                            </div>

                            <div className="relative z-10">
                                <div className="flex items-center mb-4">
                                    <div className="p-3 bg-amber-50 dark:bg-amber-900/20 rounded-xl mr-4">
                                        <Landmark className="w-6 h-6 text-amber-600 dark:text-amber-400" />
                                    </div>
                                    <div>
                                        <h3 className="text-lg font-bold text-gray-900 dark:text-white">Til Regningskonto</h3>
                                        <p className="text-sm text-gray-500 dark:text-gray-400">{billAccounts.map(a => a.name).join(', ')}</p>
                                    </div>
                                </div>

                                <div className="space-y-3 mb-6">
                                    <div className="flex justify-between text-sm">
                                        <span className="text-gray-600 dark:text-gray-400">Faktisk forbruk ({formatMonth(prevMonthStr)})</span>
                                        <span className="font-medium text-gray-900 dark:text-white">{billAccountUsage.toLocaleString('no-NO')} kr</span>
                                    </div>
                                    {billBufferContribution > 0 && (
                                        <div className="flex justify-between text-sm">
                                            <span className="text-gray-600 dark:text-gray-400 flex items-center gap-1"><PiggyBank className="w-3.5 h-3.5 text-purple-500" /> Bufferoppbygging</span>
                                            <span className="font-medium text-gray-900 dark:text-white">{billBufferContribution.toLocaleString('no-NO')} kr</span>
                                        </div>
                                    )}
                                    <div className="h-px bg-gray-100 dark:bg-gray-700 my-2"></div>
                                </div>

                                <div className="flex justify-between items-end">
                                    <span className="text-sm font-medium text-amber-600 dark:text-amber-400">Totalt å overføre</span>
                                    <span className="text-3xl font-bold text-gray-900 dark:text-white">{billAccountTotal.toLocaleString('no-NO')} kr</span>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* To Savings */}
                    <div className="bg-white dark:bg-gray-800 p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 relative overflow-hidden group">
                        <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                            <PiggyBank className="w-24 h-24 text-green-600" />
                        </div>

                        <div className="relative z-10">
                            <div className="flex items-center mb-4">
                                <div className="p-3 bg-green-50 dark:bg-green-900/20 rounded-xl mr-4">
                                    <PiggyBank className="w-6 h-6 text-green-600 dark:text-green-400" />
                                </div>
                                <div className="min-w-0">
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <h3 className="text-lg font-bold text-gray-900 dark:text-white">Til Sparing</h3>
                                        {sourceBadge(savings.source)}
                                    </div>
                                    <p className="text-sm text-gray-500 dark:text-gray-400">{SAVINGS_SOURCE_LABEL[savings.source]} · {formatMonth(selectedMonth)}</p>
                                </div>
                            </div>

                            {savings.source === 'actual' && savings.estimate != null && Math.abs(savings.estimate - savings.actual) >= 1 && (
                                <p className="text-xs text-amber-700 dark:text-amber-300 mb-2">
                                    Foreløpig beløp var {savings.estimate.toLocaleString('no-NO')} kr — faktisk overført {savings.actual.toLocaleString('no-NO')} kr.
                                </p>
                            )}
                            {savings.source === 'actual' && savings.estimate == null && savings.defaultAmount != null && savings.actual < savings.defaultAmount - 0.5 && (
                                <p className="text-xs text-amber-700 dark:text-amber-300 mb-2">
                                    Fast sparing er {savings.defaultAmount.toLocaleString('no-NO')} kr — hittil overført {savings.actual.toLocaleString('no-NO')} kr.
                                </p>
                            )}

                            <div className="flex justify-between items-end mt-8 gap-3">
                                <span className="text-sm font-medium text-green-600 dark:text-green-400">Overført til sparing</span>
                                <div className="text-right">
                                    {editing === 'savings' ? renderEstimateEditor('savings', 'Forventet sparebeløp') : (
                                        <div className="flex items-center justify-end gap-2">
                                            <span className={`text-3xl font-bold ${savings.source === 'actual' ? 'text-gray-900 dark:text-white' : 'text-gray-600 dark:text-gray-300'}`}>{savingsAmount.toLocaleString('no-NO')} kr</span>
                                            {savings.source !== 'actual' && (
                                                <button onClick={() => startEditing('savings', savings.estimate)} title="Legg inn forventet sparebeløp for denne måneden" className="p-2 text-gray-400 hover:text-green-600 hover:bg-green-50 dark:hover:bg-green-900/30 rounded-lg">
                                                    <Pencil className="w-4 h-4" />
                                                </button>
                                            )}
                                        </div>
                                    )}
                                    {editing !== 'savings' && savings.source === 'estimate' && (
                                        <button onClick={() => saveEstimate('savings', 0)} disabled={savingEstimate} className="text-xs text-gray-400 hover:text-red-600 dark:hover:text-red-400 mt-1">Fjern foreløpig beløp</button>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Buffer on my bill account(s): same card as Oppgjør, one party */}
                    {personalBufferAccounts.map(a => (
                        <BufferCard key={a.id} account={a} parties={1} settlementMonth={prevMonthStr} />
                    ))}

                </div>

                {/* Right Column: SUMMARY */}
                <div className="space-y-6">
                    <h3 className="text-sm uppercase tracking-wider text-gray-500 font-bold ml-1">Resultat</h3>

                    <div className="bg-gradient-to-br from-indigo-600 to-purple-700 p-6 rounded-2xl shadow-lg text-white">
                        <div className="flex items-start justify-between mb-8">
                            <div>
                                <h3 className="text-xl font-bold opacity-90">Til Forbruk</h3>
                                <p className="text-indigo-200 text-sm">Etter at alle forpliktelser er dekket</p>
                            </div>
                            <Calculator className="w-8 h-8 text-indigo-300 opacity-50" />
                        </div>

                        <div className="space-y-2 mb-8">
                            <div className="flex justify-between text-indigo-100 text-sm">
                                <span>Netto Lønn</span>
                                <span>{netSalary.toLocaleString('no-NO')} kr</span>
                            </div>
                            <div className="flex justify-between text-indigo-100 text-sm">
                                <span>- Felleskonto & Kredittkort</span>
                                <span>- {totalToJointAccount.toLocaleString('no-NO')} kr</span>
                            </div>
                            <div className="flex justify-between text-indigo-100 text-sm">
                                <span>- Regningskonto</span>
                                <span>- {billAccountTotal.toLocaleString('no-NO')} kr</span>
                            </div>
                            <div className="flex justify-between text-indigo-100 text-sm">
                                <span>- Sparing</span>
                                <span>- {savingsAmount.toLocaleString('no-NO')} kr</span>
                            </div>
                        </div>

                        <div className="pt-6 border-t border-white/10">
                            <div className="flex justify-between items-end">
                                <span className="text-lg font-medium text-indigo-200">Disponibelt</span>
                                <span className="text-4xl font-bold">{leftToSpend.toLocaleString('no-NO')} kr</span>
                            </div>
                        </div>
                    </div>

                    <LiquidityCard
                        leftToSpend={leftToSpend}
                        checkingSpending={checkingFlow.spending}
                        checkingOtherIncome={checkingFlow.otherIncome}
                        checkingAccounts={checkingAccounts}
                        selectedMonth={selectedMonth}
                        formatMonth={formatMonth}
                        monthReconciled={isMonthReconciled(selectedMonth)}
                        pendingRefunds={pendingRefunds}
                    />

                    <UnnecessaryPurchasesCard
                        transactions={transactions}
                        selectedMonth={selectedMonth}
                        prevMonth={prevMonthStr}
                        formatMonth={formatMonth}
                        accounts={accounts}
                        leftToSpend={leftToSpend}
                    />

                    <div className="bg-white dark:bg-gray-800 p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700">
                        <h4 className="font-bold text-gray-900 dark:text-white mb-2">Tips</h4>
                        <p className="text-sm text-gray-600 dark:text-gray-400">
                            Summen "Til Felleskonto" inkluderer din *faktiske* andel av fellesutgiftene fra forrige måned ({sharedShareAmount.toLocaleString('no-NO')} kr) pluss ditt private kredittkortforbruk som nå forfaller ({creditCardUsage.toLocaleString('no-NO')} kr){bufferContribution > 0 ? ` og din del av bufferoppbyggingen på regningskontoen (${bufferContribution.toLocaleString('no-NO')} kr, avtalt på Oppgjør)` : ''}.
                        </p>
                    </div>

                </div>
            </div>
        </div>
    );
}
