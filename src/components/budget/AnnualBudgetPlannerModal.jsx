import { useState, useEffect } from 'react';
import { X, Calendar, Save, Check } from 'lucide-react';
import { useBudget } from '../../contexts/BudgetContext';

export default function AnnualBudgetPlannerModal({ isOpen, onClose }) {
    const { expenses, getMonthlyBudget, setMonthlyBudget } = useBudget();
    const [selectedExpenseId, setSelectedExpenseId] = useState('');
    const [year] = useState(new Date().getFullYear());
    const [monthlyValues, setMonthlyValues] = useState({});
    const [saving, setSaving] = useState(false);
    const [loading, setLoading] = useState(false);

    // Group expenses by category for easier selection
    const groupedExpenses = expenses.reduce((acc, expense) => {
        const cat = expense.category || 'Annet';
        if (!acc[cat]) acc[cat] = [];
        acc[cat].push(expense);
        return acc;
    }, {});

    const sortedCategories = Object.keys(groupedExpenses).sort();

    useEffect(() => {
        if (isOpen && expenses.length > 0 && !selectedExpenseId) {
            // Select first expense by default if none selected
            if (expenses[0]) setSelectedExpenseId(expenses[0].id);
        }
    }, [isOpen, expenses, selectedExpenseId]);

    // Load data when expense or year changes
    useEffect(() => {
        if (selectedExpenseId) {
            setLoading(true);
            const newValues = {};
            for (let i = 0; i < 12; i++) {
                const monthStr = `${year}-${String(i + 1).padStart(2, '0')}`;
                const budgetInfo = getMonthlyBudget(selectedExpenseId, monthStr);
                newValues[i] = {
                    amount: budgetInfo.amount,
                    isOverride: budgetInfo.isOverride,
                    originalAmount: budgetInfo.amount // To detect changes
                };
            }
            setMonthlyValues(newValues);
            setLoading(false);
        }
    }, [selectedExpenseId, year, getMonthlyBudget]);

    const handleAmountChange = (monthIndex, value) => {
        setMonthlyValues(prev => ({
            ...prev,
            [monthIndex]: {
                ...prev[monthIndex],
                amount: value === '' ? '' : parseFloat(value)
            }
        }));
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            const promises = [];
            for (let i = 0; i < 12; i++) {
                const monthData = monthlyValues[i];
                // Only save if changed (simple check, could be more robust)
                // Note: We always convert to monthly override here if user saves in this view?
                // Or only if the value differs from base? 
                // Plan said: "Edit: Changing a value updates the monthly budget override immediately (or on save)."
                // User wants "fields for all months... to see and edit".
                // If I edit Jan, I expect Jan to be overridden. 
                // If I don't edit Feb, it stays as is (Global or existing override).

                // NOTE: `monthlyValues` is initialized with the *effective* amount.
                // If user changes it, we simply set that value as the override.
                // If user touches nothing, we do nothing?
                // Better: Check against `originalAmount`.

                if (monthData.amount !== monthData.originalAmount && monthData.amount !== '') {
                    const monthStr = `${year}-${String(i + 1).padStart(2, '0')}`;
                    promises.push(setMonthlyBudget(selectedExpenseId, monthStr, monthData.amount));
                }
            }
            await Promise.all(promises);

            // Refresh local state to show "saved" status (update originals)
            const newValues = { ...monthlyValues };
            for (let i = 0; i < 12; i++) {
                if (newValues[i].amount !== '') {
                    newValues[i].originalAmount = newValues[i].amount;
                    newValues[i].isOverride = true; // It's strictly an override now if we saved it
                }
            }
            setMonthlyValues(newValues);
            // alert('Lagret!'); // Maybe too intrusive?
        } catch (error) {
            console.error("Failed to save annual plan", error);
            alert("Feil ved lagring.");
        } finally {
            setSaving(false);
        }
    };

    if (!isOpen) return null;

    const months = [
        'Januar', 'Februar', 'Mars', 'April', 'Mai', 'Juni',
        'Juli', 'August', 'September', 'Oktober', 'November', 'Desember'
    ];

    const selectedExpense = expenses.find(e => e.id === selectedExpenseId);
    const globalAmount = selectedExpense?.amount || 0;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <div
                className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in duration-200"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between bg-gray-50 dark:bg-gray-800/50 flex-shrink-0">
                    <div className="flex items-center space-x-3">
                        <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-lg text-blue-600 dark:text-blue-400">
                            <Calendar className="w-5 h-5" />
                        </div>
                        <div>
                            <h2 className="text-lg font-bold text-gray-900 dark:text-white">Årsplanlegger</h2>
                            <p className="text-xs text-gray-500 dark:text-gray-400">Budsjett for {year}</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Toolbar */}
                <div className="p-4 border-b border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4 flex-shrink-0">
                    <div className="flex-1 max-w-md">
                        <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 uppercase tracking-wider">Velg Budsjettpost</label>
                        <select
                            value={selectedExpenseId}
                            onChange={(e) => setSelectedExpenseId(e.target.value)}
                            className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none bg-white dark:bg-gray-700 dark:text-white font-medium shadow-sm transition-all hover:border-gray-400 dark:hover:border-gray-500"
                        >
                            {sortedCategories.map(cat => (
                                <optgroup key={cat} label={cat}>
                                    {groupedExpenses[cat].map(expense => (
                                        <option key={expense.id} value={expense.id}>{expense.name}</option>
                                    ))}
                                </optgroup>
                            ))}
                        </select>
                    </div>

                    <div className="flex items-end">
                        <div className="px-4 py-2 bg-gray-50 dark:bg-gray-700/50 rounded-lg border border-gray-200 dark:border-gray-600">
                            <span className="text-xs text-gray-500 dark:text-gray-400 block">Standardbeløp</span>
                            <span className="font-bold text-gray-900 dark:text-white">{globalAmount.toLocaleString()} kr</span>
                        </div>
                    </div>
                </div>

                {/* Main Content - Scrollable */}
                <div className="flex-1 overflow-y-auto p-6 bg-gray-50/50 dark:bg-gray-900/50">
                    {loading ? (
                        <div className="flex justify-center items-center h-full">Laster...</div>
                    ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                            {months.map((monthName, index) => {
                                const data = monthlyValues[index] || { amount: 0, isOverride: false };
                                const isChanged = data.amount !== data.originalAmount;

                                return (
                                    <div
                                        key={index}
                                        className={`p-4 rounded-xl border transition-all duration-200 ${data.isOverride
                                                ? 'bg-blue-50/50 dark:bg-blue-900/10 border-blue-200 dark:border-blue-800/30'
                                                : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700'
                                            } hover:shadow-md`}
                                    >
                                        <div className="flex justify-between items-center mb-2">
                                            <label className="font-bold text-gray-700 dark:text-gray-200">{monthName}</label>
                                            {data.isOverride && (
                                                <span className="text-[10px] uppercase font-bold text-blue-600 dark:text-blue-400 bg-blue-100 dark:bg-blue-900/50 px-2 py-0.5 rounded-full">
                                                    Egendefinert
                                                </span>
                                            )}
                                        </div>
                                        <div className="relative">
                                            <input
                                                type="number"
                                                value={data.amount}
                                                onChange={(e) => handleAmountChange(index, e.target.value)}
                                                className={`w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none pl-8 dark:bg-gray-700 dark:text-white transition-colors ${isChanged ? 'border-amber-400 ring-1 ring-amber-400/50' : 'border-gray-300 dark:border-gray-600'
                                                    }`}
                                            />
                                            <span className="absolute left-3 top-2.5 text-gray-400 dark:text-gray-500 font-medium">kr</span>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="p-4 border-t border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-800 flex justify-end space-x-3 flex-shrink-0">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-gray-700 dark:text-gray-300 font-medium hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                    >
                        Lukk
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={saving}
                        className="px-6 py-2 bg-blue-600 text-white font-bold rounded-lg hover:bg-blue-700 transition-colors shadow-sm flex items-center"
                    >
                        {saving ? (
                            <>Lagrer...</>
                        ) : (
                            <>
                                <Save className="w-4 h-4 mr-2" />
                                Lagre endringer
                            </>
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
}
