import { useMemo, useState } from 'react';
import { Store, Trash2, Plus } from 'lucide-react';
import { useBudget } from '../../contexts/BudgetContext';
import { useDialog } from '../../contexts/DialogContext';
import { cleanMerchantName, aliasKey } from '../../utils/merchantName';

const inputCls = 'text-sm px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 focus:ring-2 focus:ring-blue-400 outline-none';

/**
 * Butikknavn: the user's «X vises som Y» rules (utils/merchantName.js). Only
 * the displayed name changes — stored names stay as the bank / companion app
 * wrote them. Suggestions are the most frequent tidied names of the last
 * 90 days that no alias covers yet.
 */
export default function MerchantAliasSettings() {
    const { merchantAliases, saveMerchantAlias, deleteMerchantAlias, allTransactions, accounts } = useBudget();
    const { notify } = useDialog();
    const [pattern, setPattern] = useState('');
    const [shown, setShown] = useState('');
    const [accountId, setAccountId] = useState('');
    const [saving, setSaving] = useState(false);

    const accountName = (id) => accounts.find(a => a.id === id)?.name || 'ukjent konto';

    const suggestions = useMemo(() => {
        const since = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
        const covered = new Set(merchantAliases.map(a => aliasKey(a.pattern)));
        const counts = new Map();
        for (const t of allTransactions) {
            if (t.type !== 'expense' || !t.date || t.date < since) continue;
            for (const raw of new Set([t.name, t.bankName].filter(Boolean))) {
                const key = aliasKey(raw);
                if (!key || covered.has(key)) continue;
                const entry = counts.get(key) || { name: cleanMerchantName(raw), n: 0 };
                entry.n++;
                counts.set(key, entry);
            }
        }
        return [...counts.values()].filter(e => e.n >= 2).sort((a, b) => b.n - a.n).slice(0, 40);
    }, [allTransactions, merchantAliases]);

    const sorted = [...merchantAliases].sort((a, b) =>
        a.displayName.localeCompare(b.displayName, 'no-NO') || a.pattern.localeCompare(b.pattern, 'no-NO'));

    const add = async () => {
        if (!pattern.trim() || !shown.trim()) return;
        setSaving(true);
        try {
            await saveMerchantAlias({ pattern, displayName: shown, accountId: accountId || null });
            setPattern('');
        } catch (error) {
            console.error('Failed to save alias', error);
            notify({ message: 'Kunne ikke lagre visningsnavnet.', variant: 'error' });
        } finally {
            setSaving(false);
        }
    };

    const remove = async (id) => {
        try { await deleteMerchantAlias(id); }
        catch (error) {
            console.error('Failed to delete alias', error);
            notify({ message: 'Kunne ikke slette.', variant: 'error' });
        }
    };

    return (
        <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 space-y-4">
            <div>
                <h2 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2"><Store className="w-5 h-5 text-gray-400" />Butikknavn</h2>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                    Samme butikk kan komme inn med ulike navn fra banken og companion-appen. Navnene ryddes automatisk (tallprefiks, «, LENA, NOR», store bokstaver),
                    og her kan du i tillegg bestemme at et navn skal vises som et annet. Bare visningen endres — det lagrede navnet står urørt.
                </p>
            </div>

            {sorted.length > 0 && (
                <div className="divide-y divide-gray-100 dark:divide-gray-700">
                    {sorted.map(a => (
                        <div key={a.id} className="py-2 flex items-center gap-3 text-sm">
                            <div className="min-w-0 flex-1">
                                <span className="text-gray-500 dark:text-gray-400">«{a.pattern}»</span>
                                <span className="text-gray-400 mx-1.5">→</span>
                                <span className="font-medium text-gray-900 dark:text-gray-100">{a.displayName}</span>
                                {a.accountId && <span className="text-xs text-gray-500 dark:text-gray-400"> · bare {accountName(a.accountId)}</span>}
                            </div>
                            <button onClick={() => remove(a.id)} className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg" title="Slett">
                                <Trash2 className="w-4 h-4" />
                            </button>
                        </div>
                    ))}
                </div>
            )}

            <div className="space-y-2">
                <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-2">
                    <input value={pattern} onChange={(e) => setPattern(e.target.value)} placeholder="Navn slik det kommer inn" className={inputCls} list="merchant-alias-suggestions" />
                    <input value={shown} onChange={(e) => setShown(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} placeholder="Vises som" className={inputCls} />
                    <button onClick={add} disabled={saving || !pattern.trim() || !shown.trim()} className="flex items-center justify-center gap-1 px-3 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-40">
                        <Plus className="w-4 h-4" />Legg til
                    </button>
                </div>
                <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className={inputCls}>
                    <option value="">Alle kontoer</option>
                    {accounts.map(a => <option key={a.id} value={a.id}>Bare {a.name}</option>)}
                </select>
                <datalist id="merchant-alias-suggestions">
                    {suggestions.map(s => <option key={s.name} value={s.name} />)}
                </datalist>
                {pattern.trim() && <p className="text-xs text-gray-500 dark:text-gray-400">Treffer navn som ryddet blir «{cleanMerchantName(pattern)}», uansett store/små bokstaver.</p>}
            </div>

            {suggestions.length > 0 && (
                <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1.5">Hyppige navn uten regel (siste 90 dager)</p>
                    <div className="flex flex-wrap gap-1.5">
                        {suggestions.map(s => (
                            <button key={s.name} onClick={() => { setPattern(s.name); if (!shown) setShown(s.name); }} className="text-xs px-2 py-1 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-blue-100 dark:hover:bg-blue-900/30" title={`${s.n} kjøp`}>
                                {s.name} <span className="text-gray-400">{s.n}</span>
                            </button>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
