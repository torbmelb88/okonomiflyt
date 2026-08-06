import { useEffect, useMemo, useState } from 'react';
import { Database, Download, CheckCircle2, AlertTriangle, Loader2 } from 'lucide-react';
import { useBudget } from '../../contexts/BudgetContext';
import { api } from '../../services/firebase';
import { buildMigrationPlan, SCOPE_LABEL } from '../../utils/categoryMigration';

const norm = (s) => (s || '').trim().toLowerCase();

/**
 * One-time migration: free-text categories on expenses -> owner-level
 * categories + budget-item definitions, with each expense linked to a def via
 * defId. Preview-then-confirm, with a JSON backup taken first.
 *
 * Reads ALL of the user's expenses (across every budget) — the context only
 * holds the active budget's, which is too narrow to detect shared+private
 * overlaps (scope 'both').
 */
export default function MigrationTool() {
    const {
        budgets, categories, budgetItemDefs,
        addCategory, addBudgetItemDef, updateBudgetItemDef, reloadLibrary,
    } = useBudget();

    const [allExpenses, setAllExpenses] = useState(null);
    const [running, setRunning] = useState(false);
    const [done, setDone] = useState(false);
    const [error, setError] = useState('');
    const [progress, setProgress] = useState('');

    // Load every expense belonging to the user's budgets
    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            try {
                const all = await api.getCollection('expenses');
                const budgetIds = new Set(budgets.map(b => b.id));
                if (!cancelled) setAllExpenses(all.filter(e => budgetIds.has(e.budgetId)));
            } catch (e) {
                if (!cancelled) setError('Kunne ikke laste poster: ' + e.message);
            }
        };
        if (budgets.length) load();
        return () => { cancelled = true; };
    }, [budgets]);

    const plan = useMemo(
        () => allExpenses ? buildMigrationPlan({ expenses: allExpenses, budgets, categories, budgetItemDefs }) : null,
        [allExpenses, budgets, categories, budgetItemDefs]
    );

    const downloadBackup = () => {
        const backup = { exportedAt: new Date().toISOString(), expenses: allExpenses, categories, budgetItemDefs };
        const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `okonomiflyt-backup-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
    };

    const applyMigration = async () => {
        setRunning(true);
        setError('');
        try {
            const catIdByNorm = new Map(categories.map(c => [norm(c.name), c.id]));
            for (const name of plan.newCategoryNames) {
                setProgress(`Oppretter kategori «${name}»…`);
                const created = await addCategory(name);
                catIdByNorm.set(norm(name), created.id);
            }

            let i = 0;
            for (const def of plan.newDefs) {
                i++;
                setProgress(`Ny budsjettpost ${i}/${plan.newDefs.length}: «${def.name}»…`);
                const categoryId = catIdByNorm.get(norm(def.categoryName)) || null;
                const createdDef = await addBudgetItemDef({ name: def.name, categoryId, scope: def.scope });
                await Promise.all(def.expenseIds.map(id => api.updateDocument('expenses', id, { defId: createdDef.id })));
            }

            for (const link of plan.linkExisting) {
                setProgress(`Kobler «${link.name}» til eksisterende mal…`);
                await Promise.all(link.expenseIds.map(id => api.updateDocument('expenses', id, { defId: link.defId })));
                if (link.toScope) await updateBudgetItemDef(link.defId, { scope: link.toScope });
            }

            setProgress('Oppdaterer…');
            await reloadLibrary();
            setDone(true);
        } catch (e) {
            console.error('Migration failed', e);
            setError('Migreringen feilet: ' + e.message + ' (ingenting er delvis ødelagt — last siden på nytt og prøv igjen).');
        } finally {
            setRunning(false);
            setProgress('');
        }
    };

    const newDefsByCategory = useMemo(() => {
        const map = {};
        if (plan) for (const d of plan.newDefs) (map[d.categoryName] = map[d.categoryName] || []).push(d);
        return map;
    }, [plan]);

    if (allExpenses === null && !error) {
        return (
            <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 flex items-center gap-3 text-gray-500 dark:text-gray-400">
                <Loader2 className="w-5 h-5 animate-spin" /> Laster poster…
            </div>
        );
    }

    if (done) {
        return (
            <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700">
                <div className="flex items-center gap-3">
                    <CheckCircle2 className="w-6 h-6 text-green-600 dark:text-green-400" />
                    <div>
                        <h3 className="font-bold text-gray-900 dark:text-white">Migrering fullført</h3>
                        <p className="text-sm text-gray-500 dark:text-gray-400">Budsjettpostene er koblet til biblioteket. Last siden på nytt om du ikke ser endringene ennå.</p>
                    </div>
                </div>
            </div>
        );
    }

    if (!plan || plan.pendingExpenseCount === 0) {
        if (plan && plan.alreadyMigratedCount > 0) {
            return (
                <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 flex items-center gap-3">
                    <CheckCircle2 className="w-6 h-6 text-green-600 dark:text-green-400" />
                    <div>
                        <h3 className="font-bold text-gray-900 dark:text-white">Alt er migrert</h3>
                        <p className="text-sm text-gray-500 dark:text-gray-400">Alle budsjettposter er koblet til biblioteket.</p>
                    </div>
                </div>
            );
        }
        return null;
    }

    return (
        <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-sm border border-amber-200 dark:border-amber-800">
            <div className="flex items-center gap-3 mb-4">
                <div className="p-2 bg-amber-50 dark:bg-amber-900/20 rounded-lg">
                    <Database className="w-6 h-6 text-amber-600 dark:text-amber-400" />
                </div>
                <div>
                    <h3 className="font-bold text-gray-900 dark:text-white">Migrer til kategorier &amp; budsjettposter</h3>
                    <p className="text-sm text-gray-500 dark:text-gray-400">Engangsoppsett (alle budsjetter). Ta backup, se forhåndsvisningen, og bekreft.</p>
                </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                <Stat label="Poster som kobles" value={plan.pendingExpenseCount} />
                <Stat label="Nye maler" value={plan.newDefs.length} />
                <Stat label="Kobles til eksisterende" value={plan.linkExisting.length} />
                <Stat label="Utvides til Begge" value={plan.widenCount} />
            </div>

            {plan.newDefs.length > 0 && (
                <div className="max-h-64 overflow-y-auto border border-gray-100 dark:border-gray-700 rounded-lg divide-y divide-gray-100 dark:divide-gray-700 mb-4">
                    {Object.keys(newDefsByCategory).sort((a, b) => a.localeCompare(b, 'no-NO')).map(cat => (
                        <div key={cat} className="p-3">
                            <div className="text-sm font-bold text-gray-900 dark:text-gray-100 mb-1">
                                {cat}
                                {plan.newCategoryNames.some(n => norm(n) === norm(cat)) && <span className="ml-2 text-xs font-medium text-green-600 dark:text-green-400">ny</span>}
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                                {newDefsByCategory[cat].map(d => (
                                    <span key={d.key} className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-xs text-gray-700 dark:text-gray-300">
                                        {d.name}<span className="text-gray-500 dark:text-gray-400">· {SCOPE_LABEL[d.scope]}</span>
                                    </span>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {plan.linkExisting.length > 0 && (
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                    {plan.linkExisting.length} poster kobles til maler du allerede har{plan.widenCount > 0 ? `, og ${plan.widenCount} av dem utvides til «Begge» fordi de nå finnes i både felles og privat.` : '.'}
                </p>
            )}

            {error && (
                <div className="flex items-start gap-2 p-3 mb-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                    <AlertTriangle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                    <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
                </div>
            )}

            <div className="flex flex-wrap items-center gap-3">
                <button onClick={downloadBackup} disabled={running} className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 font-medium text-sm disabled:opacity-50">
                    <Download className="w-4 h-4" /> Last ned backup
                </button>
                <button onClick={applyMigration} disabled={running} className="flex items-center gap-2 px-5 py-2 bg-amber-600 hover:bg-amber-700 text-white font-medium rounded-lg shadow-sm text-sm disabled:opacity-60">
                    {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                    {running ? 'Migrerer…' : 'Bekreft migrering'}
                </button>
                {progress && <span className="text-sm text-gray-500 dark:text-gray-400">{progress}</span>}
            </div>
        </div>
    );
}

function Stat({ label, value }) {
    return (
        <div className="bg-gray-50 dark:bg-gray-700/30 rounded-lg p-3 text-center">
            <div className="text-2xl font-bold text-gray-900 dark:text-gray-100">{value}</div>
            <div className="text-xs text-gray-500 dark:text-gray-400">{label}</div>
        </div>
    );
}
