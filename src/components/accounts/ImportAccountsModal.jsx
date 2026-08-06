import { useState, useEffect } from 'react';
import { X, Landmark, Loader2, AlertTriangle, CheckCircle2, CreditCard } from 'lucide-react';
import { useBudget } from '../../contexts/BudgetContext';
import { api } from '../../services/firebase';

const ACCOUNT_TYPES = ['Bankkonto', 'Sparing'];

/**
 * Bank-import wizard. Reads the distinct accounts seen in the SB1 staging
 * collection (sb1Transactions) and lets the user place each in the right
 * budget, rename it, pick a type and add the linked card number (not available
 * from the API). Each created account stores sb1AccountKey so transaction
 * routing can later map staged transactions to it.
 */
export default function ImportAccountsModal({ isOpen, onClose }) {
    const { budgets, activeBudget, addAccount } = useBudget();
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [rows, setRows] = useState([]);
    const [importing, setImporting] = useState(false);
    const [doneCount, setDoneCount] = useState(null);

    useEffect(() => {
        if (!isOpen) return;
        let cancelled = false;
        const load = async () => {
            setLoading(true); setError(''); setDoneCount(null);
            try {
                const [sb1Accounts, accounts] = await Promise.all([
                    api.getCollection('sb1Accounts'),
                    api.getCollection('accounts'),
                ]);
                const importedKeys = new Set(accounts.map(a => a.sb1AccountKey).filter(Boolean));
                const fresh = sb1Accounts.filter(a => a.sb1AccountKey && !importedKeys.has(a.sb1AccountKey));
                const defaultBudgetId = activeBudget?.id || budgets[0]?.id || '';
                if (!cancelled) setRows(fresh.map(a => ({
                    accountKey: a.sb1AccountKey,
                    accountName: a.name || 'Konto',
                    accountNumber: a.accountNumber || '',
                    balance: typeof a.balance === 'number' ? a.balance : null,
                    currency: a.currency || 'kr',
                    include: true, name: a.name || 'Konto', type: 'Bankkonto', budgetId: defaultBudgetId, cardLastFour: '',
                })));
            } catch (e) {
                if (!cancelled) setError('Kunne ikke lese kontoene «sb1Accounts». Sjekk at Firestore-reglene tillater at innloggede brukere leser den. (' + e.message + ')');
            } finally {
                if (!cancelled) setLoading(false);
            }
        };
        load();
        return () => { cancelled = true; };
    }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

    if (!isOpen) return null;

    const update = (key, patch) => setRows(prev => prev.map(r => r.accountKey === key ? { ...r, ...patch } : r));
    const selectedCount = rows.filter(r => r.include && r.budgetId).length;

    const handleImport = async () => {
        const selected = rows.filter(r => r.include && r.budgetId);
        if (!selected.length) return;
        setImporting(true); setError('');
        try {
            for (const r of selected) {
                await addAccount({
                    name: (r.name || '').trim() || r.accountName,
                    type: r.type,
                    defaultBudgetId: r.budgetId,
                    cardLastFour: r.cardLastFour || '',
                    sb1AccountKey: r.accountKey,
                    sb1AccountNumber: r.accountNumber,
                    sourceType: 'sb1',
                });
            }
            setDoneCount(selected.length);
        } catch (e) {
            setError('Import feilet: ' + e.message);
        } finally {
            setImporting(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-3xl overflow-hidden flex flex-col max-h-[90vh]">
                <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between bg-gray-50 dark:bg-gray-800/50">
                    <div className="flex items-center gap-3">
                        <Landmark className="w-6 h-6 text-blue-600 dark:text-blue-400" />
                        <div>
                            <h2 className="text-lg font-bold text-gray-900 dark:text-white">Importer kontoer fra bank</h2>
                            <p className="text-sm text-gray-500 dark:text-gray-400">Plasser hver konto i riktig budsjett.</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"><X className="w-5 h-5" /></button>
                </div>

                <div className="p-6 overflow-y-auto">
                    {loading ? (
                        <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400 py-8 justify-center"><Loader2 className="w-5 h-5 animate-spin" /> Leser kontoer fra mellomlageret…</div>
                    ) : error ? (
                        <div className="flex items-start gap-2 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                            <AlertTriangle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                            <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
                        </div>
                    ) : doneCount !== null ? (
                        <div className="flex flex-col items-center text-center py-8 gap-3">
                            <CheckCircle2 className="w-10 h-10 text-green-600 dark:text-green-400" />
                            <h3 className="font-bold text-gray-900 dark:text-white">Importerte {doneCount} {doneCount === 1 ? 'konto' : 'kontoer'}</h3>
                            <p className="text-sm text-gray-500 dark:text-gray-400 max-w-sm">Bytt budsjett (eller last siden på nytt) for å se kontoer du la i et annet budsjett. Husk å sette tilknyttet kort der det trengs for kompanjong-appen.</p>
                        </div>
                    ) : rows.length === 0 ? (
                        <div className="text-center text-gray-500 dark:text-gray-400 py-8">Ingen nye kontoer å importere. Alle kontoene fra banken er allerede lagt inn.</div>
                    ) : (
                        <div className="space-y-3">
                            {rows.map(r => (
                                <div key={r.accountKey} className={`border rounded-lg p-4 transition-colors ${r.include ? 'border-blue-200 dark:border-blue-800 bg-blue-50/40 dark:bg-blue-900/10' : 'border-gray-200 dark:border-gray-700 opacity-60'}`}>
                                    <div className="flex items-start gap-3">
                                        <input type="checkbox" checked={r.include} onChange={(e) => update(r.accountKey, { include: e.target.checked })} className="w-4 h-4 mt-1 text-blue-600 rounded border-gray-300 focus:ring-blue-500" />
                                        <div className="flex-1 min-w-0">
                                            <div className="text-xs text-gray-500 dark:text-gray-400 mb-2">
                                                Bank: «{r.accountName}» · {r.accountNumber || 'ukjent nr'}{typeof r.balance === 'number' ? ` · ${r.balance.toLocaleString('no-NO')} ${r.currency}` : ''}
                                            </div>
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                                <div>
                                                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Navn i appen</label>
                                                    <input value={r.name} onChange={(e) => update(r.accountKey, { name: e.target.value })} disabled={!r.include}
                                                        className="w-full px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white disabled:opacity-50" />
                                                </div>
                                                <div>
                                                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Standard-budsjett</label>
                                                    <select value={r.budgetId} onChange={(e) => update(r.accountKey, { budgetId: e.target.value })} disabled={!r.include}
                                                        className="w-full px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 dark:text-white disabled:opacity-50">
                                                        {budgets.map(b => <option key={b.id} value={b.id}>{b.name} ({b.type === 'shared' ? 'felles' : 'privat'})</option>)}
                                                    </select>
                                                </div>
                                                <div>
                                                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Type</label>
                                                    <select value={r.type} onChange={(e) => update(r.accountKey, { type: e.target.value })} disabled={!r.include}
                                                        className="w-full px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 dark:text-white disabled:opacity-50">
                                                        {ACCOUNT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                                                    </select>
                                                </div>
                                                <div>
                                                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1 flex items-center gap-1"><CreditCard className="w-3 h-3" /> Tilknyttet kort (valgfritt)</label>
                                                    <input value={r.cardLastFour} onChange={(e) => update(r.accountKey, { cardLastFour: e.target.value.replace(/\D/g, '').slice(0, 4) })} disabled={!r.include} placeholder="4 siste siffer"
                                                        className="w-full px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white disabled:opacity-50" />
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {!loading && !error && doneCount === null && rows.length > 0 && (
                    <div className="px-6 py-4 border-t border-gray-100 dark:border-gray-700 flex items-center justify-between bg-gray-50 dark:bg-gray-800/50">
                        <span className="text-sm text-gray-500 dark:text-gray-400">{selectedCount} valgt</span>
                        <div className="flex gap-3">
                            <button onClick={onClose} className="px-4 py-2 text-gray-700 dark:text-gray-300 font-medium hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg">Avbryt</button>
                            <button onClick={handleImport} disabled={importing || selectedCount === 0} className="flex items-center gap-2 px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg shadow-sm disabled:bg-gray-300 disabled:cursor-not-allowed">
                                {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                                {importing ? 'Importerer…' : `Importer ${selectedCount}`}
                            </button>
                        </div>
                    </div>
                )}
                {doneCount !== null && (
                    <div className="px-6 py-4 border-t border-gray-100 dark:border-gray-700 flex justify-end bg-gray-50 dark:bg-gray-800/50">
                        <button onClick={onClose} className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg">Ferdig</button>
                    </div>
                )}
            </div>
        </div>
    );
}
