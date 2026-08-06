import { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { useBudget } from '../../contexts/BudgetContext';
import { SCOPE_LABEL } from '../../utils/categoryMigration';

const SCOPES = ['both', 'shared', 'private'];

/**
 * Create a new budget item. A budget item is a library definition
 * (name + category + scope) plus a per-budget instance carrying the amount.
 * Auto-inclusion then shows it in every budget its scope covers.
 */
export default function AddBudgetItemModal({ isOpen, onClose, onCreate, defaultScope = 'both' }) {
    const { categories } = useBudget();
    const [name, setName] = useState('');
    const [amount, setAmount] = useState('');
    const [categoryId, setCategoryId] = useState('');
    const [newCategoryName, setNewCategoryName] = useState('');
    const [scope, setScope] = useState(defaultScope);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (isOpen) {
            setName('');
            setAmount('');
            setCategoryId(categories[0]?.id || '__new__');
            setNewCategoryName('');
            setScope(defaultScope);
        }
    }, [isOpen, categories, defaultScope]);

    if (!isOpen) return null;

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!name.trim()) return;
        const usingNew = categoryId === '__new__';
        if (usingNew && !newCategoryName.trim()) return;

        setLoading(true);
        try {
            await onCreate({
                name: name.trim(),
                categoryId: usingNew ? null : categoryId,
                newCategoryName: usingNew ? newCategoryName.trim() : null,
                scope,
                amount: parseFloat(amount) || 0,
            });
            onClose();
        } catch (error) {
            console.error('Failed to create budget item', error);
            alert('Kunne ikke opprette budsjettpost.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in duration-200" onClick={(e) => e.stopPropagation()}>
                <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between bg-gray-50 dark:bg-gray-800/50">
                    <h2 className="text-lg font-bold text-gray-900 dark:text-white">Ny budsjettpost</h2>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"><X className="w-5 h-5" /></button>
                </div>

                <form onSubmit={handleSubmit} className="p-6 space-y-5">
                    <div className="space-y-2">
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Navn</label>
                        <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="F.eks. Boliglån" autoFocus required
                            className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none dark:bg-gray-700 dark:text-white dark:placeholder-gray-400" />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Kategori</label>
                            <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}
                                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none bg-white dark:bg-gray-700 dark:text-white">
                                {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                <option value="__new__">+ Ny kategori…</option>
                            </select>
                            {categoryId === '__new__' && (
                                <input type="text" value={newCategoryName} onChange={(e) => setNewCategoryName(e.target.value)} placeholder="Kategorinavn" required
                                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none dark:bg-gray-700 dark:text-white dark:placeholder-gray-400" />
                            )}
                        </div>
                        <div className="space-y-2">
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Gjelder</label>
                            <select value={scope} onChange={(e) => setScope(e.target.value)}
                                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none bg-white dark:bg-gray-700 dark:text-white">
                                {SCOPES.map(s => <option key={s} value={s}>{SCOPE_LABEL[s]}</option>)}
                            </select>
                        </div>
                    </div>

                    <div className="space-y-2">
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Planlagt beløp (dette budsjettet)</label>
                        <div className="relative">
                            <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0"
                                className="w-full px-4 py-2 pl-8 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none dark:bg-gray-700 dark:text-white dark:placeholder-gray-400" />
                            <span className="absolute left-3 top-2.5 text-gray-400 dark:text-gray-500 font-medium">kr</span>
                        </div>
                        <p className="text-xs text-gray-500 dark:text-gray-400">Beløpet gjelder kun dette budsjettet. Scope «Begge» viser posten i begge budsjett, men beløpene settes hver for seg.</p>
                    </div>

                    <div className="flex justify-end space-x-3 pt-2">
                        <button type="button" onClick={onClose} className="px-4 py-2 text-gray-700 dark:text-gray-300 font-medium hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors">Avbryt</button>
                        <button type="submit" disabled={loading} className="px-6 py-2 bg-blue-600 text-white font-bold rounded-lg hover:bg-blue-700 transition-colors shadow-sm disabled:bg-gray-300">{loading ? 'Lagrer…' : 'Legg til'}</button>
                    </div>
                </form>
            </div>
        </div>
    );
}
