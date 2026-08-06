import { useState, useEffect } from 'react';
import { X, Settings } from 'lucide-react';
import { useBudget } from '../../contexts/BudgetContext';
import CategoryManagerModal from '../settings/CategoryManagerModal';

export default function AddExpenseModal({ isOpen, onClose, onSave, expenseToEdit = null, hideAccount = false, selectedMonth }) {
    const { accounts, categories, addCategory } = useBudget();
    const [name, setName] = useState('');
    const [amount, setAmount] = useState('');
    const [category, setCategory] = useState('Annet');
    const [customCategory, setCustomCategory] = useState('');
    const [isCustomCategory, setIsCustomCategory] = useState(false);
    const [accountId, setAccountId] = useState('');
    const [isUnnecessary, setIsUnnecessary] = useState(false);
    const [loading, setLoading] = useState(false);
    const [isCategoryManagerOpen, setIsCategoryManagerOpen] = useState(false);

    useEffect(() => {
        if (isOpen) {
            if (expenseToEdit) {
                setName(expenseToEdit.name);

                // If we have an effective budgetedAmount (from Budget view), use that.
                // Otherwise fallback to global amount.
                // Note: expenseToEdit.budgetedAmount comes from Budget.jsx and accounts for overrides.
                const effectiveAmount = expenseToEdit.budgetedAmount !== undefined
                    ? expenseToEdit.budgetedAmount
                    : expenseToEdit.amount;

                setAmount(effectiveAmount);

                const categoryExists = categories.some(c => c.name === expenseToEdit.category);
                if (categoryExists) {
                    setCategory(expenseToEdit.category);
                    setIsCustomCategory(false);
                    setCustomCategory('');
                } else {
                    setCategory('custom');
                    setIsCustomCategory(true);
                    setCustomCategory(expenseToEdit.category);
                }

                setAccountId(expenseToEdit.accountId || '');
                setIsUnnecessary(!!expenseToEdit.isUnnecessary);
            } else {
                // New Expense
                setName('');
                setAmount('');

                if (categories.length > 0) {
                    setCategory(categories[0].name);
                    setIsCustomCategory(false);
                } else {
                    setCategory('custom');
                    setIsCustomCategory(true);
                }

                setCustomCategory('');
                setAccountId('');
                setIsUnnecessary(false);
            }
        }
    }, [isOpen, expenseToEdit, categories, selectedMonth]);

    if (!isOpen) return null;

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!name.trim() || !amount) return;

        let finalCategory = isCustomCategory ? customCategory : category;
        if (!finalCategory.trim()) return;

        setLoading(true);
        try {
            // Auto-save custom category
            if (isCustomCategory) {
                const existing = categories.find(c => c.name.toLowerCase() === finalCategory.toLowerCase());
                if (!existing) {
                    await addCategory(finalCategory);
                } else {
                    finalCategory = existing.name;
                }
            }

            // Logic:
            // 1. If Edit Mode + Selected Month:
            //    - Global Update: Name/Category only. Keep Global Amount UNCHANGED.
            //    - Override Update: Set Override for this month to Input Amount.
            // 2. If New + Selected Month:
            //    - Global Create: Name/Category/Amount = Input.
            //    - Override: None (Global matches).

            const isEdit = !!expenseToEdit;
            const inputAmount = parseFloat(amount);

            let expenseData = {
                name,
                // When editing, the global default amount is preserved — the
                // input amount only affects the monthly override below.
                amount: isEdit ? expenseToEdit.amount : inputAmount,
                category: finalCategory,
                frequency: 'monthly',
                accountId: hideAccount ? (expenseToEdit?.accountId || null) : (accountId || null),
                date: expenseToEdit?.date || new Date().toISOString().split('T')[0],
                isUnnecessary,
            };

            let overrideData = null;

            if (isEdit && selectedMonth) {
                // Always create/update override for this month
                overrideData = {
                    active: true,
                    amount: inputAmount,
                    month: selectedMonth
                };
            }

            // Pass both to onSave
            await onSave(expenseData, overrideData);

            onClose();
        } catch (error) {
            console.error("Failed to save expense", error);
            alert("Kunne ikke lagre utgift.");
        } finally {
            setLoading(false);
        }
    };

    const isEdit = !!expenseToEdit;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <div
                className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in duration-200"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between bg-gray-50 dark:bg-gray-800/50">
                    <h2 className="text-lg font-bold text-gray-900 dark:text-white">{isEdit ? 'Rediger budsjettpost' : 'Ny budsjettpost'}</h2>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="p-6 space-y-6">
                    <div className="space-y-2">
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Navn</label>
                        <input
                            type="text"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="F.eks. Matvarer"
                            className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none dark:bg-gray-700 dark:text-white dark:placeholder-gray-400"
                            required
                            autoFocus
                        />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Beløp</label>
                            <div className="relative">
                                <input
                                    type="number"
                                    value={amount}
                                    onChange={(e) => setAmount(e.target.value)}
                                    placeholder="0"
                                    className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none pl-8 dark:bg-gray-700 dark:text-white dark:placeholder-gray-400"
                                    required
                                />
                                <span className="absolute left-3 top-2.5 text-gray-400 dark:text-gray-500 font-medium">kr</span>
                            </div>
                        </div>

                        <div className="space-y-2">
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 flex justify-between items-center">
                                <span>Kategori</span>
                                <button
                                    type="button"
                                    onClick={() => setIsCategoryManagerOpen(true)}
                                    className="text-xs text-blue-600 hover:text-blue-800 flex items-center"
                                >
                                    <Settings className="w-3 h-3 mr-1" />
                                    Admin
                                </button>
                            </label>
                            {isCustomCategory ? (
                                <div className="flex space-x-2">
                                    <input
                                        type="text"
                                        value={customCategory}
                                        onChange={(e) => setCustomCategory(e.target.value)}
                                        placeholder="Kategori..."
                                        className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none dark:bg-gray-700 dark:text-white dark:placeholder-gray-400"
                                        required
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setIsCustomCategory(false)}
                                        className="p-2 text-gray-500 hover:text-gray-700"
                                    >
                                        <X className="w-4 h-4" />
                                    </button>
                                </div>
                            ) : (
                                <select
                                    value={category}
                                    onChange={(e) => {
                                        if (e.target.value === 'custom') {
                                            setIsCustomCategory(true);
                                            setCustomCategory('');
                                        } else {
                                            setCategory(e.target.value);
                                        }
                                    }}
                                    className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none bg-white dark:bg-gray-700 dark:text-white"
                                >
                                    {categories.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                                    <option value="custom">+ Ny kategori...</option>
                                </select>
                            )}
                        </div>
                    </div>

                    {!hideAccount && (
                        <div className="space-y-2">
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Konto (Valgfritt)</label>
                            <select
                                value={accountId}
                                onChange={(e) => setAccountId(e.target.value)}
                                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none bg-white dark:bg-gray-700 dark:text-white"
                            >
                                <option value="">Ingen konto</option>
                                {accounts.map(acc => (
                                    <option key={acc.id} value={acc.id}>{acc.name} ({acc.type})</option>
                                ))}
                            </select>
                        </div>
                    )}

                    <div className="flex justify-end space-x-3 pt-4">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-4 py-2 text-gray-700 dark:text-gray-300 font-medium hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                        >
                            Avbryt
                        </button>
                        <button
                            type="submit"
                            disabled={loading}
                            className="px-6 py-2 bg-blue-600 text-white font-bold rounded-lg hover:bg-blue-700 transition-colors shadow-sm"
                        >
                            {loading ? 'Lagrer...' : (isEdit ? 'Oppdater' : 'Legg til utgift')}
                        </button>
                    </div>
                </form>

                <CategoryManagerModal
                    isOpen={isCategoryManagerOpen}
                    onClose={() => setIsCategoryManagerOpen(false)}
                />
            </div>
        </div>
    );
}
