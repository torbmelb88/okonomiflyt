import { useEffect, useState } from 'react';
import { AlertTriangle, Download, Trash2, Loader2, CheckCircle2 } from 'lucide-react';
import { useBudget } from '../../contexts/BudgetContext';
import { api } from '../../services/firebase';

// Collections wiped by the "forbruk + budsjettbeløp" reset. The library
// (categories, budgetItemDefs), accounts and budgets are kept.
const BUDGET_SCOPED = ['transactions', 'expenses', 'monthlyBudgets', 'monthStatuses'];
const GLOBAL_SCOPED = ['receipts', 'receiptItems'];

const chunk = (arr, n) => arr.reduce((acc, _, i) => (i % n ? acc : [...acc, arr.slice(i, i + n)]), []);

/**
 * Danger zone: wipe transactions + budget amounts/instances for a fresh start,
 * keeping the cleaned library and structure. Backup-first, explicit confirm,
 * irreversible.
 */
export default function ResetTool() {
    const { budgets } = useBudget();
    const [data, setData] = useState(null); // { collectionName: docs[] }
    const [backedUp, setBackedUp] = useState(false);
    const [confirmChecked, setConfirmChecked] = useState(false);
    const [running, setRunning] = useState(false);
    const [done, setDone] = useState(false);
    const [error, setError] = useState('');
    const [progress, setProgress] = useState('');

    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            try {
                const budgetIds = new Set(budgets.map(b => b.id));
                const out = {};
                for (const col of BUDGET_SCOPED) {
                    const all = await api.getCollection(col);
                    out[col] = all.filter(d => budgetIds.has(d.budgetId));
                }
                for (const col of GLOBAL_SCOPED) {
                    out[col] = await api.getCollection(col);
                }
                if (!cancelled) setData(out);
            } catch (e) {
                if (!cancelled) setError('Kunne ikke laste data: ' + e.message);
            }
        };
        if (budgets.length) load();
        return () => { cancelled = true; };
    }, [budgets]);

    const total = data ? Object.values(data).reduce((s, arr) => s + arr.length, 0) : 0;

    const downloadBackup = () => {
        const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), ...data }, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `okonomiflyt-backup-foer-nullstilling-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
        setBackedUp(true);
    };

    const applyReset = async () => {
        setRunning(true);
        setError('');
        try {
            for (const col of [...BUDGET_SCOPED, ...GLOBAL_SCOPED]) {
                const docs = data[col] || [];
                if (!docs.length) continue;
                let deleted = 0;
                for (const batch of chunk(docs, 50)) {
                    await Promise.all(batch.map(d => api.deleteDocument(col, d.id)));
                    deleted += batch.length;
                    setProgress(`Sletter ${col}: ${deleted}/${docs.length}…`);
                }
            }
            setDone(true);
        } catch (e) {
            console.error('Reset failed', e);
            setError('Nullstillingen feilet: ' + e.message + ' (noe kan være delvis slettet — last siden på nytt og kjør igjen for å fullføre).');
        } finally {
            setRunning(false);
            setProgress('');
        }
    };

    if (done) {
        return (
            <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 flex items-center gap-3">
                <CheckCircle2 className="w-6 h-6 text-green-600 dark:text-green-400" />
                <div>
                    <h3 className="font-bold text-gray-900 dark:text-white">Nullstilt</h3>
                    <p className="text-sm text-gray-500 dark:text-gray-400">Forbruk og budsjettbeløp er fjernet. Last siden på nytt for å se de blanke arkene.</p>
                </div>
            </div>
        );
    }

    return (
        <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-sm border border-red-200 dark:border-red-800">
            <div className="flex items-center gap-3 mb-4">
                <div className="p-2 bg-red-50 dark:bg-red-900/20 rounded-lg">
                    <AlertTriangle className="w-6 h-6 text-red-600 dark:text-red-400" />
                </div>
                <div>
                    <h3 className="font-bold text-gray-900 dark:text-white">Faresone: nullstill forbruk &amp; budsjettbeløp</h3>
                    <p className="text-sm text-gray-500 dark:text-gray-400">Beholder bibliotek, kontoer og budsjett. Kan ikke angres.</p>
                </div>
            </div>

            {data === null && !error ? (
                <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400"><Loader2 className="w-5 h-5 animate-spin" /> Teller opp…</div>
            ) : (
                <>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mb-4 text-sm">
                        {data && Object.entries(data).map(([col, arr]) => (
                            <div key={col} className="flex justify-between bg-gray-50 dark:bg-gray-700/30 rounded-lg px-3 py-2">
                                <span className="text-gray-600 dark:text-gray-400">{col}</span>
                                <span className="font-bold text-gray-900 dark:text-gray-100">{arr.length}</span>
                            </div>
                        ))}
                    </div>
                    <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">Totalt <span className="font-bold">{total}</span> dokumenter slettes.</p>

                    {error && (
                        <div className="flex items-start gap-2 p-3 mb-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                            <AlertTriangle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                            <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
                        </div>
                    )}

                    <div className="space-y-3">
                        <button onClick={downloadBackup} disabled={running || total === 0} className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 font-medium text-sm disabled:opacity-50">
                            <Download className="w-4 h-4" /> {backedUp ? 'Backup lastet ned ✓' : '1. Last ned backup (påkrevd)'}
                        </button>

                        <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                            <input type="checkbox" checked={confirmChecked} onChange={(e) => setConfirmChecked(e.target.checked)} className="w-4 h-4 text-red-600 rounded border-gray-300 focus:ring-red-500" />
                            Jeg har lastet ned backup og forstår at dette ikke kan angres.
                        </label>

                        <button
                            onClick={applyReset}
                            disabled={running || total === 0 || !backedUp || !confirmChecked}
                            className="flex items-center gap-2 px-5 py-2 bg-red-600 hover:bg-red-700 text-white font-medium rounded-lg shadow-sm text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                            {running ? 'Sletter…' : '2. Slett for godt'}
                            {progress && <span className="font-normal ml-1">— {progress}</span>}
                        </button>
                    </div>
                </>
            )}
        </div>
    );
}
