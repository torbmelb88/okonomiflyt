import { useState, useEffect } from 'react';
import { Banknote, Save } from 'lucide-react';
import { useBudget } from '../../contexts/BudgetContext';

/**
 * «Ca. netto lønn per måned» for the personal budget (utils/salary.js): the
 * fallback Min Oversikt shows for the current and future months until a
 * provisional amount is typed in for a month, or the real salary row
 * arrives. Renders nothing for shared budgets.
 */
export default function SalarySettings() {
    const { activeBudget, updateBudget } = useBudget();
    const [value, setValue] = useState('');
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);

    useEffect(() => {
        setValue(activeBudget?.expectedSalary > 0 ? String(activeBudget.expectedSalary) : '');
        setSaved(false);
    }, [activeBudget]);

    if (!activeBudget || activeBudget.type !== 'personal') return null;

    const handleSave = async (e) => {
        e.preventDefault();
        setSaving(true);
        try {
            const n = Math.round((parseFloat(String(value).replace(',', '.')) || 0) * 100) / 100;
            await updateBudget(activeBudget.id, { expectedSalary: n > 0 ? n : null });
            setSaved(true);
        } catch (err) {
            console.error('Could not save expected salary', err);
            alert('Kunne ikke lagre: ' + err.message);
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="bg-white dark:bg-gray-800 p-8 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700">
            <div className="flex items-center space-x-3 mb-6">
                <div className="p-3 bg-green-100 dark:bg-green-900/20 rounded-full">
                    <Banknote className="w-6 h-6 text-green-600 dark:text-green-400" />
                </div>
                <div>
                    <h2 className="text-xl font-bold text-gray-900 dark:text-white">Lønn</h2>
                    <p className="text-sm text-gray-500 dark:text-gray-400">Anslag for Min Oversikt til lønnstransaksjonen kommer</p>
                </div>
            </div>
            <form onSubmit={handleSave} className="space-y-4">
                <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Ca. netto lønn per måned</label>
                    <div className="flex items-center gap-3">
                        <input
                            type="number" inputMode="decimal" min="0" step="0.01"
                            value={value}
                            onChange={(e) => { setValue(e.target.value); setSaved(false); }}
                            placeholder="f.eks. 42000"
                            className="w-48 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent dark:bg-gray-700 dark:text-white outline-none"
                        />
                        <span className="text-sm text-gray-500 dark:text-gray-400">kr</span>
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                        Vises som lønn for inneværende og fremtidige måneder som ennå ikke har en transaksjon merket «Lønn». Et beløp du legger inn for én bestemt måned på Min Oversikt (fra lønnsslippen) går foran, og den faktiske transaksjonen går alltid foran begge. Tomt = ingen anslag.
                    </p>
                </div>
                <div className="flex items-center gap-3">
                    <button type="submit" disabled={saving} className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-lg disabled:opacity-50">
                        <Save className="w-4 h-4" />{saving ? 'Lagrer…' : 'Lagre'}
                    </button>
                    {saved && <span className="text-sm text-green-700 dark:text-green-300">Lagret.</span>}
                </div>
            </form>
        </div>
    );
}
