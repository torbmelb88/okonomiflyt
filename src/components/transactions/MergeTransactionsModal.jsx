import { useState } from 'react';
import { X, Check, Merge, CreditCard, Sparkles } from 'lucide-react';
import clsx from 'clsx';
import { useBudget } from '../../contexts/BudgetContext';
import { stringsAreSimilar } from '../../utils/textMatch';

/**
 * Manual duplicate merge: pick the duplicate of `transaction`, then choose
 * which copy survives. The survivor keeps its own name/date/amount so the next
 * import still recognizes it — that's why the copy that came from the bank
 * (CSV/SB1) is recommended over a companion-app entry. Reconciliation metadata
 * from both copies is combined either way.
 */
export default function MergeTransactionsModal({ isOpen, onClose, transaction }) {
    const { transactions, accounts, mergeTransactions } = useBudget();
    const [search, setSearch] = useState('');
    const [otherId, setOtherId] = useState('');
    const [keepId, setKeepId] = useState('');
    const [saving, setSaving] = useState(false);

    const [prevId, setPrevId] = useState(null);
    if ((transaction?.id || null) !== prevId) {
        setPrevId(transaction?.id || null);
        setSearch('');
        setOtherId('');
        setKeepId('');
    }

    if (!isOpen || !transaction) return null;

    const accountName = (id) => accounts.find(a => a.id === id)?.name || '';
    const sourceLabel = (t) => t.source === 'companion_app' ? 'Companion-app' : t.source === 'sb1' ? 'Bank (SB1)' : 'Manuell/CSV';
    const daysBetween = (d1, d2) => Math.abs(new Date(d2) - new Date(d1)) / 86400000;

    // Likely duplicates first: same amount, close date, similar name
    const rank = (t) =>
        (Math.abs(t.amount - transaction.amount) < 0.01 ? 0 : 4) +
        (daysBetween(t.date, transaction.date) <= 4 ? 0 : 2) +
        (stringsAreSimilar(t.name, transaction.name) ? 0 : 1);
    const candidates = transactions
        .filter(t => t.id !== transaction.id && t.type === transaction.type)
        .filter(t => !search || t.name.toLowerCase().includes(search.toLowerCase()))
        .sort((a, b) => rank(a) - rank(b) || daysBetween(a.date, transaction.date) - daysBetween(b.date, transaction.date))
        .slice(0, 30);

    const other = transactions.find(t => t.id === otherId) || null;

    // Recommend keeping the copy whose identity matches the next bank import
    const recommendedKeepId = (a, b) => {
        const fromApp = (t) => t.source === 'companion_app';
        if (fromApp(a) !== fromApp(b)) return fromApp(a) ? b.id : a.id;
        return a.id;
    };

    const selectOther = (t) => {
        setOtherId(t.id);
        setKeepId(recommendedKeepId(transaction, t));
    };

    const handleMerge = async () => {
        if (!other || !keepId) return;
        const removeId = keepId === transaction.id ? other.id : transaction.id;
        setSaving(true);
        try {
            await mergeTransactions(keepId, removeId);
            onClose();
        } catch (error) {
            console.error('Merge failed', error);
            alert('Kunne ikke slå sammen: ' + error.message);
        } finally {
            setSaving(false);
        }
    };

    const TxCard = ({ t, selectable }) => (
        <button
            disabled={!selectable}
            onClick={() => selectable && setKeepId(t.id)}
            className={clsx(
                'w-full text-left rounded-xl border p-4 transition-colors',
                selectable && keepId === t.id
                    ? 'border-purple-500 bg-purple-50 dark:bg-purple-900/20 ring-2 ring-purple-300 dark:ring-purple-700'
                    : 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50',
                selectable && keepId !== t.id && 'hover:border-purple-300'
            )}
        >
            <div className="flex items-center justify-between gap-2 mb-1">
                <span className="font-bold text-gray-900 dark:text-gray-100 break-words">{t.name}</span>
                {selectable && keepId === t.id && (
                    <span className="flex-shrink-0 text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-purple-600 text-white">Beholdes</span>
                )}
            </div>
            <div className="text-sm text-gray-500 dark:text-gray-400">{t.date} • {sourceLabel(t)}{t.reconciled ? ' • ✓ Avstemt' : ''}</div>
            <div className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1 mt-0.5"><CreditCard className="w-3 h-3" />{accountName(t.accountId)}</div>
            <div className={clsx('text-lg font-bold mt-1', t.type === 'income' ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400')}>
                {t.type === 'income' ? '+' : '-'}{t.amount.toLocaleString('no-NO')} kr
            </div>
        </button>
    );

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/50 backdrop-blur-sm">
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-lg md:max-w-2xl overflow-hidden animate-in fade-in zoom-in duration-200 flex flex-col max-h-[90vh]">
                <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between bg-purple-50 dark:bg-purple-900/20">
                    <div className="flex items-center space-x-2">
                        <Merge className="w-5 h-5 text-purple-600 dark:text-purple-400" />
                        <h2 className="text-lg font-bold text-gray-900 dark:text-white">Slå sammen duplikater</h2>
                    </div>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"><X className="w-5 h-5" /></button>
                </div>

                <div className="p-4 md:p-6 overflow-y-auto space-y-4">
                    {!other && (
                        <>
                            <TxCard t={transaction} selectable={false} />
                            <p className="text-sm text-gray-600 dark:text-gray-400">Velg transaksjonen som er en duplikat av denne. Sannsynlige treff (likt beløp, nær dato) ligger øverst.</p>
                            <input
                                type="text"
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                placeholder="Søk i transaksjoner..."
                                className="w-full text-sm px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white outline-none focus:ring-2 focus:ring-purple-400"
                            />
                            <div className="max-h-72 overflow-y-auto divide-y divide-gray-100 dark:divide-gray-700 border border-gray-200 dark:border-gray-700 rounded-lg">
                                {candidates.length === 0 && (
                                    <p className="p-3 text-sm text-gray-500 dark:text-gray-400">Ingen kandidater funnet.</p>
                                )}
                                {candidates.map(t => (
                                    <button key={t.id} onClick={() => selectOther(t)} className="w-full text-left px-3 py-2 flex items-center justify-between gap-2 text-sm hover:bg-purple-50 dark:hover:bg-purple-900/20 transition-colors">
                                        <span className="min-w-0">
                                            <span className="block font-medium text-gray-900 dark:text-gray-100 truncate">{t.name}</span>
                                            <span className="block text-xs text-gray-500 dark:text-gray-400">{t.date} • {accountName(t.accountId)} • {sourceLabel(t)}</span>
                                        </span>
                                        <span className={clsx('font-semibold whitespace-nowrap', t.type === 'income' ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400')}>
                                            {t.type === 'income' ? '+' : '-'}{t.amount.toLocaleString('no-NO')} kr
                                        </span>
                                    </button>
                                ))}
                            </div>
                        </>
                    )}

                    {other && (
                        <>
                            <p className="text-sm text-gray-600 dark:text-gray-400">
                                Velg hvilken versjon som skal beholdes. Den beholder sitt navn, dato og beløp — den andre slettes.
                                Avstemmingsinfo (budsjettpost, kommentar, kvittering, flagg) kombineres fra begge uansett.
                            </p>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                <TxCard t={transaction} selectable />
                                <TxCard t={other} selectable />
                            </div>
                            {keepId === recommendedKeepId(transaction, other) && transaction.source !== other.source && (
                                <p className="text-xs text-purple-600 dark:text-purple-400 flex items-center gap-1.5">
                                    <Sparkles className="w-3.5 h-3.5 flex-shrink-0" />
                                    Anbefalt: denne kom fra bankimporten, så neste import gjenkjenner den og lager ikke duplikaten på nytt.
                                </p>
                            )}
                            <div className="flex gap-2">
                                <button onClick={() => { setOtherId(''); setKeepId(''); }} className="px-4 py-2.5 border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 font-medium rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors text-sm">
                                    Velg en annen
                                </button>
                                <button onClick={handleMerge} disabled={!keepId || saving} className="flex-1 py-2.5 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-300 text-white font-medium rounded-lg transition-colors flex items-center justify-center gap-2 text-sm">
                                    <Check className="w-4 h-4" />{saving ? 'Slår sammen...' : 'Slå sammen'}
                                </button>
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
