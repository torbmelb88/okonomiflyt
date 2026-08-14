import { useEffect, useMemo, useState } from 'react';
import { X, Download, CheckCircle2, AlertTriangle, Loader2, Calendar } from 'lucide-react';
import { useBudget } from '../../contexts/BudgetContext';
import { api } from '../../services/firebase';
import { fxPlausible } from '../../utils/currency';

const datesClose = (d1, d2, tol = 4) => {
    const diff = Math.abs(new Date(d2) - new Date(d1));
    return Math.ceil(diff / 86400000) <= tol;
};

// Unbooked bill payments have no counterparty yet — SB1 names them by type
// only. These labels mark a transaction as a placeholder awaiting booking.
const looksLikePlaceholder = (name) => {
    const n = (name || '').trim().toLowerCase();
    return n === 'nettgiro' || n === 'straksbetaling' || n.startsWith('nettgiro ');
};

// SB1 gives every unbooked payment the same all-zero nonUniqueId — that is the
// reliable placeholder signal (verified 2026-07-10: bookingStatus says BOOKED
// even before booking, so it can't be trusted). The status/name checks stay as
// a fallback for row types we haven't seen yet.
const PLACEHOLDER_ID_SUFFIX = ':000000000000000000';
const isUnbooked = (s) =>
    (typeof s.externalId === 'string' && s.externalId.endsWith(PLACEHOLDER_ID_SUFFIX)) ||
    (s.bookingStatus ? s.bookingStatus !== 'BOOKED' : looksLikePlaceholder(s.name));

const firstOfThisMonth = () => {
    const n = new Date();
    return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-01`;
};

/**
 * Routes staged SB1 transactions (sb1Transactions) into the app's transactions.
 * Maps each by sb1AccountKey to an imported account, sets budgetId from the
 * account's default budget, and dedups against existing transactions (incl. the
 * companion app's). A "from date" limits how far back to pull. Preview, confirm.
 */
export default function ImportTransactionsModal({ isOpen, onClose }) {
    const { reloadTransactions } = useBudget();
    const [raw, setRaw] = useState(null); // { staged, accByKey, existing }
    const [fromDate, setFromDate] = useState(firstOfThisMonth);
    const [running, setRunning] = useState(false);
    const [done, setDone] = useState(null);
    const [error, setError] = useState('');
    // Currency-pair suggestions the user has un-ticked (keyed by pair key)
    const [fxOff, setFxOff] = useState(() => new Set());

    useEffect(() => {
        if (!isOpen) return;
        let cancelled = false;
        const load = async () => {
            setRaw(null); setError(''); setDone(null); setFxOff(new Set());
            try {
                const [staged, accounts, existing] = await Promise.all([
                    api.getCollection('sb1Transactions'),
                    api.getCollection('accounts'),
                    api.getCollection('transactions'),
                ]);
                const accByKey = new Map(accounts.filter(a => a.sb1AccountKey).map(a => [a.sb1AccountKey, a]));
                if (!cancelled) setRaw({ staged, accByKey, existing });
            } catch (e) {
                if (!cancelled) setError('Kunne ikke lese mellomlageret «sb1Transactions» (sjekk Firestore-reglene). ' + e.message);
            }
        };
        load();
        return () => { cancelled = true; };
    }, [isOpen]);

    const plan = useMemo(() => {
        if (!raw) return null;
        const { staged, accByKey, existing } = raw;
        const existingByExternalId = new Map(existing.filter(t => t.externalId).map(t => [t.externalId, t]));
        // Newest sync stamp = what the bank reported on the last run. Rows with
        // an older stamp are no longer reported by SB1.
        const latestSync = staged.reduce((max, s) => (s.syncedAt > max ? s.syncedAt : max), '');
        const toCreate = [];
        const toMerge = [];
        const toUpdate = [];
        const toRebook = [];
        const toFx = [];
        const rebookedIds = new Set();
        const fxClaimedIds = new Set();
        const pendingRows = [];
        let alreadyImported = 0, noAccount = 0, noBudget = 0, beforeFrom = 0;

        for (const s of staged) {
            if (s.date && s.date < fromDate) { beforeFrom++; continue; }
            // Skip unbooked rows: SB1 gives them a placeholder name ("Nettgiro")
            // and a DIFFERENT externalId once booked, so importing them now
            // guarantees a duplicate later. They arrive on booking instead.
            // A placeholder the bank stopped reporting HAS been booked (under
            // its real id) — that is an orphan, not something still waiting, so
            // it is skipped silently rather than counted as pending.
            if (isUnbooked(s)) {
                if (!latestSync || s.syncedAt === latestSync) pendingRows.push(s);
                continue;
            }
            const acc = accByKey.get(s.accountKey);
            if (!acc) { noAccount++; continue; }
            if (s.externalId && existingByExternalId.has(s.externalId)) {
                // Already imported — refresh the name if it improved and the
                // transaction is still unhandled (don't touch reconciled ones).
                const ex = existingByExternalId.get(s.externalId);
                if (!ex.reconciled && !ex.budgetItemId && s.name && ex.name !== s.name) {
                    toUpdate.push({ id: ex.id, name: s.name });
                } else {
                    alreadyImported++;
                }
                continue;
            }
            const budgetId = acc.defaultBudgetId || acc.budgetId;
            if (!budgetId) { noBudget++; continue; }

            // Foreign-currency copies (companion app abroad, amount in SEK/EUR/…)
            // never equal the bank's converted NOK amount — an exact-amount hit
            // would be coincidence, so they are only linked manually via merge.
            const match = existing.find(t =>
                t.accountId === acc.id && !t.externalId &&
                (!t.currency || t.currency === 'NOK') &&
                Math.abs((t.amount || 0) - (s.amount || 0)) < 0.01 &&
                t.date && datesClose(t.date, s.date)
            );
            // A previously imported placeholder ("Nettgiro") that has now been
            // booked under a new externalId and real name: fold the booked row
            // into it instead of creating a twin. Reconciled ones qualify too —
            // the placeholder name carries no information worth preserving.
            const rebook = !match && existing.find(t =>
                t.accountId === acc.id && t.externalId && t.externalId !== s.externalId &&
                !rebookedIds.has(t.id) &&
                (looksLikePlaceholder(t.name) || String(t.externalId).endsWith(PLACEHOLDER_ID_SUFFIX)) &&
                t.type === s.type &&
                Math.abs((t.amount || 0) - (s.amount || 0)) < 0.01 &&
                t.date && datesClose(t.date, s.date, 7)
            );
            // Foreign purchase logged by the companion app: same account, close
            // date, and a NOK/foreign ratio inside a plausible exchange-rate
            // band. Suggested for confirmation, never linked automatically —
            // the bank row replaces the foreign amount only when accepted.
            const fx = !match && !rebook && existing.find(t =>
                t.accountId === acc.id && !t.externalId &&
                t.currency && t.currency !== 'NOK' &&
                !fxClaimedIds.has(t.id) &&
                t.type === s.type &&
                t.date && datesClose(t.date, s.date, 5) &&
                fxPlausible(t.currency, t.amount, s.amount)
            );
            if (match) {
                // The bank confirming an existing (typically companion-app) row
                // is the actual reconciliation — avstemt if also categorized.
                toMerge.push({
                    existingId: match.id,
                    externalId: s.externalId,
                    reconciled: !!(match.reconciled || match.budgetItemId),
                });
            } else if (fx) {
                fxClaimedIds.add(fx.id);
                toFx.push({
                    key: `${fx.id}|${s.externalId}`,
                    existing: { id: fx.id, name: fx.name, date: fx.date, amount: fx.amount, currency: fx.currency },
                    staged: { name: s.name || 'Ukjent transaksjon', date: s.date, amount: s.amount },
                    // Accepted: the companion doc takes over the bank row's
                    // identity (recognized via externalId on later imports) and
                    // keeps the foreign amount as originalAmount/-Currency.
                    patch: {
                        name: s.name || fx.name,
                        date: s.date,
                        month: (s.date || '').slice(0, 7),
                        amount: s.amount,
                        externalId: s.externalId,
                        source: 'sb1',
                        currency: null,
                        originalAmount: fx.amount,
                        originalCurrency: fx.currency,
                        // Bank match confirmed — avstemt if also categorized
                        reconciled: !!(fx.reconciled || fx.budgetItemId),
                    },
                    // Declined: the bank row comes in as its own transaction.
                    create: {
                        budgetId, accountId: acc.id, date: s.date, month: (s.date || '').slice(0, 7),
                        name: s.name || 'Ukjent transaksjon', amount: s.amount, type: s.type,
                        externalId: s.externalId,
                    },
                });
            } else if (rebook) {
                rebookedIds.add(rebook.id);
                toRebook.push({
                    id: rebook.id,
                    name: s.name || rebook.name,
                    date: s.date,
                    month: (s.date || '').slice(0, 7),
                    externalId: s.externalId,
                });
            } else {
                toCreate.push({
                    budgetId, accountId: acc.id, accountName: acc.name,
                    date: s.date, month: (s.date || '').slice(0, 7),
                    name: s.name || 'Ukjent transaksjon', amount: s.amount, type: s.type,
                    externalId: s.externalId,
                });
            }
        }
        return { toCreate, toMerge, toUpdate, toRebook, toFx, alreadyImported, noAccount, noBudget, beforeFrom, pendingRows };
    }, [raw, fromDate]);

    const byAccount = useMemo(() => {
        const map = {};
        if (plan) for (const c of plan.toCreate) map[c.accountName] = (map[c.accountName] || 0) + 1;
        return map;
    }, [plan]);

    const apply = async () => {
        setRunning(true); setError('');
        try {
            for (const c of plan.toCreate) {
                await api.addDocument('transactions', {
                    budgetId: c.budgetId, accountId: c.accountId, date: c.date, month: c.month,
                    name: c.name, amount: c.amount, type: c.type,
                    reconciled: false, source: 'sb1', externalId: c.externalId,
                    createdAt: new Date().toISOString(),
                });
            }
            for (const m of plan.toMerge) {
                await api.updateDocument('transactions', m.existingId, { externalId: m.externalId, source: 'sb1', reconciled: m.reconciled });
            }
            for (const u of plan.toUpdate) {
                await api.updateDocument('transactions', u.id, { name: u.name });
            }
            for (const r of plan.toRebook) {
                const { id, ...patch } = r;
                await api.updateDocument('transactions', id, patch);
            }
            let fxLinked = 0, fxCreated = 0;
            for (const f of plan.toFx) {
                if (fxOff.has(f.key)) {
                    await api.addDocument('transactions', {
                        ...f.create, reconciled: false, source: 'sb1',
                        createdAt: new Date().toISOString(),
                    });
                    fxCreated++;
                } else {
                    await api.updateDocument('transactions', f.existing.id, f.patch);
                    fxLinked++;
                }
            }
            await reloadTransactions();
            setDone({ created: plan.toCreate.length + fxCreated, merged: plan.toMerge.length, updated: plan.toUpdate.length + plan.toRebook.length, fxLinked });
        } catch (e) {
            setError('Import feilet: ' + e.message);
        } finally {
            setRunning(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]">
                <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between bg-gray-50 dark:bg-gray-800/50">
                    <div className="flex items-center gap-3">
                        <Download className="w-6 h-6 text-blue-600 dark:text-blue-400" />
                        <h2 className="text-lg font-bold text-gray-900 dark:text-white">Hent transaksjoner fra bank</h2>
                    </div>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"><X className="w-5 h-5" /></button>
                </div>

                <div className="p-6 overflow-y-auto">
                    {error ? (
                        <div className="flex items-start gap-2 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                            <AlertTriangle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                            <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
                        </div>
                    ) : done ? (
                        <div className="flex flex-col items-center text-center py-6 gap-3">
                            <CheckCircle2 className="w-10 h-10 text-green-600 dark:text-green-400" />
                            <h3 className="font-bold text-gray-900 dark:text-white">Ferdig</h3>
                            <p className="text-sm text-gray-500 dark:text-gray-400">
                                Hentet inn {done.created} nye transaksjoner{done.merged > 0 ? `, slo sammen ${done.merged} med eksisterende` : ''}{done.fxLinked > 0 ? `, koblet ${done.fxLinked} valutakjøp til bankbeløpet` : ''}{done.updated > 0 ? `, og oppdaterte navn på ${done.updated}` : ''}. De nye ligger som uavstemt.
                            </p>
                        </div>
                    ) : (
                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1 flex items-center gap-1.5"><Calendar className="w-4 h-4" /> Hent fra og med dato</label>
                                <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)}
                                    className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none dark:bg-gray-700 dark:text-white" />
                                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Bare transaksjoner fra og med denne datoen hentes inn.</p>
                            </div>

                            {plan === null ? (
                                <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400 py-6 justify-center"><Loader2 className="w-5 h-5 animate-spin" /> Leser og sammenligner…</div>
                            ) : (
                                <>
                                    <div className="grid grid-cols-2 gap-3">
                                        <Stat label="Nye som hentes" value={plan.toCreate.length} highlight />
                                        <Stat label="Slås sammen (dedup)" value={plan.toMerge.length} />
                                        <Stat label="Allerede importert" value={plan.alreadyImported} />
                                        <Stat label="Eldre enn datoen" value={plan.beforeFrom} />
                                        {plan.toUpdate.length > 0 && <Stat label="Navn oppdateres" value={plan.toUpdate.length} />}
                                        {plan.toRebook.length > 0 && <Stat label="Bokført (oppdateres)" value={plan.toRebook.length} />}
                                        {plan.toFx.length > 0 && <Stat label="Valutatreff" value={plan.toFx.length} highlight />}
                                        {plan.pendingRows.length > 0 && <Stat label="Venter bokføring" value={plan.pendingRows.length} />}
                                    </div>
                                    {plan.toFx.length > 0 && (
                                        <div className="space-y-1">
                                            <p className="text-xs text-gray-500 dark:text-gray-400">Sannsynlige valutatreff: bankens NOK-beløp erstatter det utenlandske beløpet, og kategori/kommentar beholdes. Fjern haken hvis paret ikke hører sammen — da hentes bankraden inn som egen transaksjon.</p>
                                            <div className="border border-sky-200 dark:border-sky-800 rounded-lg divide-y divide-gray-100 dark:divide-gray-700 text-xs max-h-40 overflow-y-auto">
                                                {plan.toFx.map(f => (
                                                    <label key={f.key} className="flex items-center gap-2.5 px-3 py-2 cursor-pointer hover:bg-sky-50 dark:hover:bg-sky-900/20">
                                                        <input
                                                            type="checkbox"
                                                            checked={!fxOff.has(f.key)}
                                                            onChange={() => setFxOff(prev => {
                                                                const next = new Set(prev);
                                                                if (next.has(f.key)) next.delete(f.key); else next.add(f.key);
                                                                return next;
                                                            })}
                                                            className="rounded text-sky-600 focus:ring-sky-500"
                                                        />
                                                        <span className="flex-1 min-w-0">
                                                            <span className="block font-medium text-gray-900 dark:text-gray-100 truncate">{f.staged.name}</span>
                                                            <span className="block text-gray-500 dark:text-gray-400 truncate">{f.existing.name} • {f.existing.date}</span>
                                                        </span>
                                                        <span className="whitespace-nowrap text-gray-700 dark:text-gray-300">
                                                            {(f.existing.amount || 0).toLocaleString('no-NO')} {f.existing.currency} → {(f.staged.amount || 0).toLocaleString('no-NO')} kr
                                                        </span>
                                                    </label>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                    {plan.pendingRows.length > 0 && (
                                        <div className="space-y-1">
                                            <p className="text-xs text-gray-500 dark:text-gray-400">Ubokførte betalinger og reservasjoner hoppes over — de hentes automatisk når banken har bokført dem:</p>
                                            <div className="border border-gray-100 dark:border-gray-700 rounded-lg divide-y divide-gray-100 dark:divide-gray-700 text-xs max-h-32 overflow-y-auto">
                                                {plan.pendingRows.slice(0, 8).map((s, i) => (
                                                    <div key={s.externalId || i} className="flex justify-between px-3 py-1.5 text-gray-600 dark:text-gray-400">
                                                        <span className="truncate">{s.date} • {s.name}</span>
                                                        <span className="whitespace-nowrap ml-2">{(s.amount || 0).toLocaleString('no-NO')} kr</span>
                                                    </div>
                                                ))}
                                                {plan.pendingRows.length > 8 && (
                                                    <div className="px-3 py-1.5 text-gray-400">…og {plan.pendingRows.length - 8} til</div>
                                                )}
                                            </div>
                                        </div>
                                    )}
                                    {plan.noAccount > 0 && (
                                        <p className="text-xs text-amber-600 dark:text-amber-400">{plan.noAccount} transaksjoner hører til kontoer du ikke har importert ennå (kjør konto-veilederen på Kontoer).</p>
                                    )}
                                    {Object.keys(byAccount).length > 0 && (
                                        <div className="border border-gray-100 dark:border-gray-700 rounded-lg divide-y divide-gray-100 dark:divide-gray-700 text-sm max-h-48 overflow-y-auto">
                                            {Object.entries(byAccount).sort((a, b) => b[1] - a[1]).map(([name, n]) => (
                                                <div key={name} className="flex justify-between px-3 py-2">
                                                    <span className="text-gray-700 dark:text-gray-300">{name}</span>
                                                    <span className="font-medium text-gray-900 dark:text-gray-100">{n}</span>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </>
                            )}
                        </div>
                    )}
                </div>

                <div className="px-6 py-4 border-t border-gray-100 dark:border-gray-700 flex justify-end gap-3 bg-gray-50 dark:bg-gray-800/50">
                    {done || error ? (
                        <button onClick={onClose} className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg">Lukk</button>
                    ) : (
                        <>
                            <button onClick={onClose} className="px-4 py-2 text-gray-700 dark:text-gray-300 font-medium hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg">Avbryt</button>
                            <button onClick={apply} disabled={!plan || running || (plan.toCreate.length === 0 && plan.toMerge.length === 0 && plan.toUpdate.length === 0 && plan.toRebook.length === 0 && plan.toFx.length === 0)}
                                className="flex items-center gap-2 px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg shadow-sm disabled:bg-gray-300 disabled:cursor-not-allowed">
                                {running ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                                {running ? 'Henter…' : 'Hent inn'}
                            </button>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}

function Stat({ label, value, highlight }) {
    return (
        <div className={`rounded-lg p-3 text-center ${highlight ? 'bg-blue-50 dark:bg-blue-900/20' : 'bg-gray-50 dark:bg-gray-700/30'}`}>
            <div className="text-2xl font-bold text-gray-900 dark:text-gray-100">{value}</div>
            <div className="text-xs text-gray-500 dark:text-gray-400">{label}</div>
        </div>
    );
}
