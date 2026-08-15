import { useState, useEffect, useMemo } from 'react';
import { useBudget } from '../../contexts/BudgetContext';
import { useAuth } from '../../contexts/AuthContext';
import { api } from '../../services/firebase';
import { ArrowRight, Wallet, CreditCard, PiggyBank, Calculator, Info, Landmark } from 'lucide-react';
import { totalBufferContributionPerParty } from '../../utils/bufferPlan';

export default function MyOverview() {
    const { activeBudget, budgets, transactions, accounts } = useBudget();
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

    // 0. Salary (Automated)
    const netSalary = useMemo(() => {
        if (!activeBudget || activeBudget.type !== 'personal') return 0;
        if (!Array.isArray(transactions)) return 0;
        return transactions
            .filter(t => {
                if (t.month !== selectedMonth) return false;
                const cat = t.category ? t.category.trim().toLowerCase() : '';
                return cat === 'lønn' && t.type === 'income';
            })
            .reduce((sum, t) => sum + t.amount, 0);
    }, [transactions, selectedMonth, activeBudget]);

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

                // Filter for Shared Budget + Previous Month
                // AND STRICT FILTER: Only included transactions (those with a budgetItemId)
                // AND exclude transactions marked as excludeFromSharedCalc
                const monthTransactions = allTransactions.filter(t =>
                    t.budgetId === sharedBudget.id &&
                    t.month === prevMonthStr &&
                    t.budgetItemId && // Only linked transactions, matching Budget.jsx
                    !t.excludeFromSharedCalc && // Exclude flagged transactions
                    !accounts.find(a => a.id === t.accountId)?.excludeFromSharedCalc // …and accounts flagged to stay out of the split
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
    }, [activeBudget, budgets, prevMonthStr, currentUser, accounts]);

    const creditCardUsage = useMemo(() => {
        if (!activeBudget || activeBudget.type !== 'personal') return 0;
        if (!Array.isArray(transactions)) return 0;
        return transactions
            .filter(t => {
                if (t.month !== prevMonthStr) return false;
                // Expenses count; credit notes/refunds count negatively. Other
                // income on the card (e.g. bill payments) is ignored.
                if (t.type !== 'expense' && !(t.type === 'income' && t.isRefund)) return false;
                // Held out of the transfer calc, or covered from another account
                if (t.excludeFromSharedCalc || t.coveredByAccountId) return false;
                // Must be linked to a Credit Card account
                const account = accounts.find(a => a.id === t.accountId);
                return account && account.type === 'Kredittkort';
            })
            .reduce((sum, t) => sum + (t.type === 'income' ? -t.amount : t.amount), 0);
    }, [transactions, prevMonthStr, accounts, activeBudget]);

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

    // 3. Savings — actual transactions marked «Sparing» this month. Only the
    // outgoing transfer leg (expense) counts; incoming legs on the savings
    // account are ignored so a pair never nets to zero or double-counts.
    const savingsAmount = useMemo(() => {
        if (!activeBudget || activeBudget.type !== 'personal') return 0;
        if (!Array.isArray(transactions)) return 0;
        return transactions
            .filter(t => t.month === selectedMonth && t.type === 'expense' &&
                (t.category || '').trim().toLowerCase() === 'sparing')
            .reduce((sum, t) => sum + t.amount, 0);
    }, [transactions, selectedMonth, activeBudget]);

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
                // «Hold kostnad utenfor» excludes it from the top-up transfer,
                // whether or not another covering account was specified
                if (t.excludeFromSharedCalc || t.coveredByAccountId) return false;
                if (isMoneyMovement(t)) return false;
                return true;
            })
            .reduce((sum, t) => sum + (t.type === 'income' ? -t.amount : t.amount), 0);
    }, [transactions, prevMonthStr, billAccounts, activeBudget]);

    // 5. Total Calculations
    const totalObligations = totalToJointAccount + billAccountUsage + savingsAmount;
    const leftToSpend = netSalary - totalObligations;

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

            {/* Salary Display (Automated) */}
            <div className="bg-white dark:bg-gray-800 p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700">
                <div className="flex items-center justify-between">
                    <div>
                        <div className="flex items-center gap-2">
                            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Din Lønn (Netto)</h2>
                            <Info
                                className="w-4 h-4 text-gray-400 cursor-help"
                                title="Lønn vises 0 inntil du har importert og avstemt transaksjoner for denne måneden."
                            />
                        </div>
                        <p className="text-sm text-gray-500 dark:text-gray-400">Basert på transaksjoner merket "Lønn" (oppdateres etter avstemming)</p>
                    </div>
                    <div className="text-right">
                        <span className="text-3xl font-bold text-gray-900 dark:text-white">{netSalary.toLocaleString('no-NO')} kr</span>
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
                                    <div className="h-px bg-gray-100 dark:bg-gray-700 my-2"></div>
                                </div>

                                <div className="flex justify-between items-end">
                                    <span className="text-sm font-medium text-amber-600 dark:text-amber-400">Totalt å overføre</span>
                                    <span className="text-3xl font-bold text-gray-900 dark:text-white">{billAccountUsage.toLocaleString('no-NO')} kr</span>
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
                                <div>
                                    <h3 className="text-lg font-bold text-gray-900 dark:text-white">Til Sparing</h3>
                                    <p className="text-sm text-gray-500 dark:text-gray-400">Transaksjoner merket «Sparing» i {formatMonth(selectedMonth)}</p>
                                </div>
                            </div>

                            <div className="flex justify-between items-end mt-8">
                                <span className="text-sm font-medium text-green-600 dark:text-green-400">Overført til sparing</span>
                                <span className="text-3xl font-bold text-gray-900 dark:text-white">{savingsAmount.toLocaleString('no-NO')} kr</span>
                            </div>
                        </div>
                    </div>

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
                                <span>- {billAccountUsage.toLocaleString('no-NO')} kr</span>
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
