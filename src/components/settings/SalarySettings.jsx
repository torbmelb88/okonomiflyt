import { useState, useEffect } from 'react';
import { Banknote, Save } from 'lucide-react';
import { useBudget } from '../../contexts/BudgetContext';
import { parseAmount2 } from '../../utils/provisional';

const inputCls = 'w-48 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent dark:bg-gray-700 dark:text-white outline-none';

/**
 * «Ca. netto lønn» and «Fast sparing» per month for the personal budget
 * (utils/provisional.js): the fallbacks Min Oversikt shows for the current
 * and future months until a provisional amount is typed in for a month, or
 * the real transactions arrive. Renders nothing for shared budgets.
 */
export default function SalarySettings() {
    const { activeBudget, updateBudget } = useBudget();
    const [salary, setSalary] = useState('');
    const [savings, setSavings] = useState('');
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);

    useEffect(() => {
        setSalary(activeBudget?.expectedSalary > 0 ? String(activeBudget.expectedSalary) : '');
        setSavings(activeBudget?.expectedSavings > 0 ? String(activeBudget.expectedSavings) : '');
        setSaved(false);
    }, [activeBudget]);

    if (!activeBudget || activeBudget.type !== 'personal') return null;

    const handleSave = async (e) => {
        e.preventDefault();
        setSaving(true);
        try {
            const sal = parseAmount2(salary);
            const sav = parseAmount2(savings);
            await updateBudget(activeBudget.id, {
                expectedSalary: sal > 0 ? sal : null,
                expectedSavings: sav > 0 ? sav : null,
            });
            setSaved(true);
        } catch (err) {
            console.error('Could not save expected amounts', err);
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
                    <h2 className="text-xl font-bold text-gray-900 dark:text-white">Lønn og fast sparing</h2>
                    <p className="text-sm text-gray-500 dark:text-gray-400">Anslag for Min Oversikt til banktransaksjonene kommer</p>
                </div>
            </div>
            <form onSubmit={handleSave} className="space-y-6">
                <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Ca. netto lønn per måned</label>
                    <div className="flex items-center gap-3">
                        <input type="number" inputMode="decimal" min="0" step="0.01" value={salary}
                            onChange={(e) => { setSalary(e.target.value); setSaved(false); }}
                            placeholder="f.eks. 42000" className={inputCls} />
                        <span className="text-sm text-gray-500 dark:text-gray-400">kr</span>
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                        Vises som lønn for inneværende og fremtidige måneder som ennå ikke har en transaksjon merket «Lønn».
                    </p>
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Fast sparing per måned</label>
                    <div className="flex items-center gap-3">
                        <input type="number" inputMode="decimal" min="0" step="0.01" value={savings}
                            onChange={(e) => { setSavings(e.target.value); setSaved(false); }}
                            placeholder="f.eks. 3000" className={inputCls} />
                        <span className="text-sm text-gray-500 dark:text-gray-400">kr</span>
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                        Det faste trekket fra brukskontoen. Regnes som overført til sparing til transaksjonen merket «Sparing» kommer, slik at likviditeten ikke ser bedre ut enn den er tidlig i måneden.
                    </p>
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                    Et beløp du legger inn for én bestemt måned på Min Oversikt går foran disse, og de faktiske transaksjonene går alltid foran alt. Tomt = ingen anslag.
                </p>
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
