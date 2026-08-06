import { useState, useEffect, useMemo } from 'react';
import {
    ShoppingBasket, ReceiptText, Trash2, ChevronDown, ChevronUp,
    Link2, TicketPercent, Recycle, TrendingUp, TrendingDown, Minus
} from 'lucide-react';
import {
    ResponsiveContainer, LineChart, Line,
    XAxis, YAxis, Tooltip, CartesianGrid
} from 'recharts';
import { useBudget } from '../../contexts/BudgetContext';
import { useTheme } from '../../contexts/ThemeContext';
import ConfirmationModal from '../common/ConfirmationModal';
import { CATEGORY_LABELS, CATEGORY_COLORS, formatKr, canonicalizeVareName, chainGroupOf, chainLabel } from '../../utils/groceryCategories';
import clsx from 'clsx';

const DAY_MS = 24 * 60 * 60 * 1000;

export default function Groceries() {
    const {
        receipts, allReceiptItems, getAllReceiptItems,
        deleteReceipt, linkReceiptToTransaction, transactions
    } = useBudget();

    const { theme } = useTheme();
    const [expandedId, setExpandedId] = useState(null);
    const [deleteTarget, setDeleteTarget] = useState(null);
    const [selectedVare, setSelectedVare] = useState(null);
    const [selectedMonth, setSelectedMonth] = useState(null);
    const [selectedChain, setSelectedChain] = useState('coop');

    // Trigger the one-time line item load; the page reads allReceiptItems reactively
    useEffect(() => {
        getAllReceiptItems().catch(error => console.error("Failed to load receipt items", error));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Chains name identical products differently on their receipts, so every
    // view on this page is fully separated per chain family via the tabs.
    const chainTabs = useMemo(() => {
        const present = new Set(receipts.map(chainGroupOf));
        return [...new Set(['coop', 'kiwi', ...present])];
    }, [receipts]);

    const switchChain = (chain) => {
        setSelectedChain(chain);
        setSelectedVare(null);
        setSelectedMonth(null);
        setExpandedId(null);
    };

    const chainReceipts = useMemo(() =>
        receipts.filter(r => chainGroupOf(r) === selectedChain),
        [receipts, selectedChain]
    );

    const items = useMemo(() => {
        const all = allReceiptItems || [];
        // Items carry their own chain field; fall back to the parent receipt
        // for line items stored before the field existed
        const receiptById = Object.fromEntries(receipts.map(r => [r.id, r]));
        return all.filter(item =>
            chainGroupOf(item.chain ? item : receiptById[item.receiptId]) === selectedChain
        );
    }, [allReceiptItems, receipts, selectedChain]);

    // --- Aggregations ---

    const totals = useMemo(() => {
        const thisMonth = new Date().toISOString().slice(0, 7);
        const monthSum = chainReceipts
            .filter(r => r.month === thisMonth)
            .reduce((sum, r) => sum + (r.total || 0), 0);
        const savedOnDiscounts = items.reduce((sum, item) =>
            sum + (item.discount || 0) + (item.isDiscount ? -item.totalPrice : 0), 0);
        return { monthSum, savedOnDiscounts, receiptCount: chainReceipts.length };
    }, [chainReceipts, items]);

    // Stacked category sums per month for the bar chart
    const monthlyByCategory = useMemo(() => {
        const byMonth = {};
        for (const item of items) {
            const month = (item.date || '').slice(0, 7);
            if (!month) continue;
            if (!byMonth[month]) byMonth[month] = { month };
            const cat = CATEGORY_LABELS[item.category] ? item.category : 'annet';
            byMonth[month][cat] = (byMonth[month][cat] || 0) + item.totalPrice;
        }
        return Object.values(byMonth).sort((a, b) => a.month.localeCompare(b.month));
    }, [items]);

    const months = useMemo(() => monthlyByCategory.map(row => row.month), [monthlyByCategory]);
    const activeMonth = selectedMonth && months.includes(selectedMonth)
        ? selectedMonth
        : months[months.length - 1] || null;

    // Price history per normalized item name (real products only)
    const vareStats = useMemo(() => {
        const byVare = {};
        for (const item of items) {
            if (item.isDiscount || item.isPant || !item.normalizedName) continue;
            const qty = item.quantity > 0 ? item.quantity : 1;
            const point = {
                date: item.date,
                price: (item.totalPrice + (item.discount || 0)) / qty, // ordinary price
                paid: item.totalPrice / qty,                            // actually paid
                name: item.name
            };
            // Canonicalized key merges naming variants from older receipts
            const key = canonicalizeVareName(item.normalizedName);
            (byVare[key] = byVare[key] || []).push(point);
        }
        return Object.entries(byVare)
            .map(([vare, points]) => {
                const sorted = points.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
                const first = sorted[0].price;
                const last = sorted[sorted.length - 1].price;
                return {
                    vare,
                    points: sorted,
                    count: sorted.length,
                    lastPaid: sorted[sorted.length - 1].paid,
                    changePct: first > 0 ? ((last - first) / first) * 100 : 0
                };
            })
            .sort((a, b) => b.count - a.count);
    }, [items]);

    const selectedStats = vareStats.find(v => v.vare === selectedVare) || null;

    // --- Receipt list helpers ---

    const sortedReceipts = useMemo(() =>
        [...chainReceipts].sort((a, b) => (b.date || '').localeCompare(a.date || '')),
        [chainReceipts]
    );

    const candidatesFor = (receipt) => transactions.filter(t =>
        !t.receiptId &&
        Math.abs(Math.abs(t.amount) - receipt.total) < 0.01 &&
        Math.abs(new Date(t.date) - new Date(receipt.date)) <= 3 * DAY_MS
    );

    const handleDelete = async () => {
        if (!deleteTarget) return;
        try {
            await deleteReceipt(deleteTarget);
        } catch {
            alert("Kunne ikke slette kvitteringen.");
        }
    };

    return (
        <div className="space-y-8">
            <div className="flex items-center gap-3">
                <ShoppingBasket className="w-7 h-7 text-emerald-600" />
                <div>
                    <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Dagligvarer</h1>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                        Varelinjer fra kvitteringer logget via kompanjong-appen
                    </p>
                </div>
            </div>

            {/* Chain tabs — everything below is fully separated per chain */}
            <div className="flex gap-1 border-b border-gray-200 dark:border-gray-700">
                {chainTabs.map(chain => (
                    <button
                        key={chain}
                        onClick={() => switchChain(chain)}
                        className={clsx(
                            "px-4 py-2 text-sm font-medium rounded-t-lg border-b-2 -mb-px transition-colors capitalize",
                            chain === selectedChain
                                ? "border-emerald-600 text-emerald-700 dark:text-emerald-300 bg-emerald-50/60 dark:bg-emerald-900/20"
                                : "border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800"
                        )}
                    >
                        {chainLabel(chain)}
                    </button>
                ))}
            </div>

            {/* Summary cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <SummaryCard label="Handlet denne måneden" value={formatKr(totals.monthSum)} />
                <SummaryCard label="Kvitteringer totalt" value={totals.receiptCount} />
                <SummaryCard label="Spart på tilbud" value={formatKr(totals.savedOnDiscounts)} accent />
            </div>

            {/* Category spend per month */}
            <section className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-5">
                <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                    <h2 className="font-bold text-gray-900 dark:text-white">Forbruk per kategori</h2>
                    {months.length > 1 && (
                        <div className="flex flex-wrap gap-1.5">
                            {months.map(month => (
                                <button
                                    key={month}
                                    onClick={() => setSelectedMonth(month)}
                                    className={clsx(
                                        "px-3 py-1 rounded-full text-xs font-medium transition-colors capitalize",
                                        month === activeMonth
                                            ? "bg-emerald-600 text-white"
                                            : "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
                                    )}
                                >
                                    {formatMonth(month)}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
                {!activeMonth ? (
                    <EmptyHint text="Ingen varelinjer ennå — del kvitteringer fra kompanjong-appen." />
                ) : (
                    <CategoryBreakdown
                        row={monthlyByCategory.find(r => r.month === activeMonth)}
                        prevRow={monthlyByCategory[months.indexOf(activeMonth) - 1] || null}
                        isCurrentMonth={activeMonth === new Date().toISOString().slice(0, 7)}
                    />
                )}
            </section>

            {/* Price history */}
            <section className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-5">
                <h2 className="font-bold text-gray-900 dark:text-white mb-1">Prisutvikling</h2>
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
                    Ordinær enhetspris (før rabatt) per vare. Velg en vare i tabellen for å se utviklingen.
                </p>
                {vareStats.length === 0 ? (
                    <EmptyHint text="Prisstatistikken bygger seg opp etter hvert som kvitteringer logges." />
                ) : (
                    <>
                        {selectedStats && selectedStats.points.length >= 2 && (
                            <div className="h-56 mb-5">
                                <ResponsiveContainer width="100%" height="100%">
                                    <LineChart data={selectedStats.points}>
                                        <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.2} />
                                        <XAxis dataKey="date" fontSize={12} />
                                        <YAxis fontSize={12} domain={['auto', 'auto']} />
                                        <Tooltip
                                            formatter={(value) => formatKr(value)}
                                            contentStyle={theme === 'dark'
                                                ? { backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: 8, color: '#f3f4f6' }
                                                : { borderRadius: 8 }}
                                            labelStyle={theme === 'dark' ? { color: '#f3f4f6' } : undefined}
                                        />
                                        <Line type="monotone" dataKey="price" name="Ordinær pris" stroke="#10b981" strokeWidth={2} dot />
                                    </LineChart>
                                </ResponsiveContainer>
                            </div>
                        )}
                        {selectedStats && selectedStats.points.length < 2 && (
                            <EmptyHint text="Bare ett kjøp av denne varen så langt — grafen kommer ved neste kjøp." />
                        )}
                        <div className="overflow-x-auto max-h-80 overflow-y-auto">
                            <table className="w-full text-sm">
                                <thead className="text-left text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide sticky top-0 bg-white dark:bg-gray-800">
                                    <tr>
                                        <th className="py-2 pr-3">Vare</th>
                                        <th className="py-2 pr-3 text-right">Kjøp</th>
                                        <th className="py-2 pr-3 text-right">Sist betalt</th>
                                        <th className="py-2 text-right">Utvikling</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                                    {vareStats.map(v => (
                                        <tr
                                            key={v.vare}
                                            onClick={() => setSelectedVare(v.vare === selectedVare ? null : v.vare)}
                                            className={clsx(
                                                "cursor-pointer transition-colors",
                                                v.vare === selectedVare
                                                    ? "bg-emerald-50 dark:bg-emerald-900/20"
                                                    : "hover:bg-gray-50 dark:hover:bg-gray-700/50"
                                            )}
                                        >
                                            <td className="py-2 pr-3 text-gray-800 dark:text-gray-200">{v.vare}</td>
                                            <td className="py-2 pr-3 text-right text-gray-500">{v.count}</td>
                                            <td className="py-2 pr-3 text-right tabular-nums">{formatKr(v.lastPaid)}</td>
                                            <td className="py-2 text-right">
                                                <PriceChange pct={v.changePct} singlePurchase={v.count < 2} />
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </>
                )}
            </section>

            {/* Receipts */}
            <section className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700">
                <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-700">
                    <h2 className="font-bold text-gray-900 dark:text-white">Kvitteringer</h2>
                </div>
                {sortedReceipts.length === 0 ? (
                    <div className="p-5">
                        <EmptyHint text="Ingen kvitteringer ennå." />
                    </div>
                ) : (
                    <div className="divide-y divide-gray-100 dark:divide-gray-700">
                        {sortedReceipts.map(receipt => (
                            <ReceiptRow
                                key={receipt.id}
                                receipt={receipt}
                                items={items.filter(i => i.receiptId === receipt.id)}
                                expanded={expandedId === receipt.id}
                                onToggle={() => setExpandedId(expandedId === receipt.id ? null : receipt.id)}
                                onDelete={() => setDeleteTarget(receipt)}
                                candidates={receipt.transactionId ? [] : candidatesFor(receipt)}
                                onLink={(transaction) => linkReceiptToTransaction(receipt.id, transaction)}
                            />
                        ))}
                    </div>
                )}
            </section>

            <ConfirmationModal
                isOpen={!!deleteTarget}
                onClose={() => setDeleteTarget(null)}
                onConfirm={handleDelete}
                title="Slett kvittering"
                message={deleteTarget
                    ? `Kvitteringen fra ${deleteTarget.store} (${deleteTarget.date}, ${formatKr(deleteTarget.total)}) og alle varelinjene slettes. Koblingen til transaksjonen fjernes også.`
                    : ''}
                isDangerous
            />
        </div>
    );
}

function formatMonth(month) {
    const date = new Date(`${month}-01T00:00:00`);
    if (isNaN(date)) return month;
    return date.toLocaleDateString('no-NO', { month: 'long', year: 'numeric' });
}

/**
 * Readable per-month category breakdown: sorted rows with amount, share bar
 * and change vs previous month. Replaces the stacked bar chart, which was
 * unreadable with twelve categories in one column.
 */
function CategoryBreakdown({ row, prevRow, isCurrentMonth }) {
    if (!row) return <EmptyHint text="Ingen data for denne måneden." />;

    const entries = Object.keys(CATEGORY_LABELS)
        .map(cat => ({ cat, value: row[cat] || 0, prev: prevRow ? (prevRow[cat] || 0) : null }))
        .filter(e => e.value !== 0)
        .sort((a, b) => b.value - a.value);

    const total = entries.reduce((sum, e) => sum + e.value, 0);
    const max = Math.max(...entries.map(e => e.value), 1);

    return (
        <div>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                Totalt <span className="font-bold text-gray-900 dark:text-white">{formatKr(total)}</span>
                {isCurrentMonth && <span className="ml-2 text-xs italic">(pågående måned)</span>}
            </p>
            <ul className="space-y-2.5">
                {entries.map(({ cat, value, prev }) => {
                    const sharePct = total > 0 ? (value / total) * 100 : 0;
                    const changePct = prev !== null && prev > 0 ? ((value - prev) / prev) * 100 : null;
                    return (
                        <li key={cat} className="flex items-center gap-3">
                            <span
                                className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                                style={{ backgroundColor: CATEGORY_COLORS[cat] }}
                            />
                            <span className="w-32 sm:w-40 text-sm text-gray-700 dark:text-gray-300 truncate flex-shrink-0">
                                {CATEGORY_LABELS[cat]}
                            </span>
                            <div className="flex-1 h-2.5 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                                <div
                                    className="h-full rounded-full transition-all"
                                    style={{
                                        width: `${(value / max) * 100}%`,
                                        backgroundColor: CATEGORY_COLORS[cat]
                                    }}
                                />
                            </div>
                            <span className="w-24 text-right text-sm tabular-nums font-medium text-gray-900 dark:text-gray-100 flex-shrink-0">
                                {formatKr(value)}
                            </span>
                            <span className="w-12 text-right text-xs tabular-nums text-gray-400 flex-shrink-0 hidden sm:inline">
                                {sharePct.toFixed(0)} %
                            </span>
                            <span className="w-16 text-right text-xs tabular-nums flex-shrink-0 hidden md:inline">
                                {changePct !== null ? (
                                    <span className={clsx(
                                        changePct > 5 && "text-red-600 dark:text-red-400",
                                        changePct < -5 && "text-green-600 dark:text-green-400",
                                        changePct >= -5 && changePct <= 5 && "text-gray-400"
                                    )}>
                                        {changePct > 0 ? '+' : ''}{changePct.toFixed(0)} %
                                    </span>
                                ) : (
                                    <span className="text-gray-300 dark:text-gray-600">—</span>
                                )}
                            </span>
                        </li>
                    );
                })}
            </ul>
            {prevRow && (
                <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-3 text-right">
                    Siste kolonne: endring fra {formatMonth(prevRow.month)}
                </p>
            )}
        </div>
    );
}

function SummaryCard({ label, value, accent }) {
    return (
        <div className={clsx(
            "rounded-xl p-4 border",
            accent
                ? "bg-emerald-50 dark:bg-emerald-900/20 border-emerald-100 dark:border-emerald-800"
                : "bg-white dark:bg-gray-800 border-gray-100 dark:border-gray-700"
        )}>
            <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">{label}</p>
            <p className={clsx(
                "text-xl font-bold mt-1",
                accent ? "text-emerald-700 dark:text-emerald-300" : "text-gray-900 dark:text-white"
            )}>{value}</p>
        </div>
    );
}

function PriceChange({ pct, singlePurchase }) {
    if (singlePurchase) return <Minus className="w-4 h-4 inline text-gray-300" />;
    const up = pct > 0.5;
    const down = pct < -0.5;
    return (
        <span className={clsx(
            "inline-flex items-center gap-1 tabular-nums",
            up && "text-red-600 dark:text-red-400",
            down && "text-green-600 dark:text-green-400",
            !up && !down && "text-gray-400"
        )}>
            {up ? <TrendingUp className="w-3.5 h-3.5" /> : down ? <TrendingDown className="w-3.5 h-3.5" /> : <Minus className="w-3.5 h-3.5" />}
            {pct > 0 ? '+' : ''}{pct.toFixed(1)} %
        </span>
    );
}

function EmptyHint({ text }) {
    return <p className="text-sm text-gray-400 dark:text-gray-500 italic">{text}</p>;
}

function ReceiptRow({ receipt, items, expanded, onToggle, onDelete, candidates, onLink }) {
    const [linking, setLinking] = useState(false);
    const isMatched = !!receipt.transactionId;

    const handleLink = async (transaction) => {
        setLinking(true);
        try {
            await onLink(transaction);
        } catch {
            alert("Kunne ikke koble kvitteringen.");
        } finally {
            setLinking(false);
        }
    };

    return (
        <div className="px-5 py-3">
            <div className="flex items-center gap-3">
                <button onClick={onToggle} className="flex-1 flex items-center gap-3 text-left min-w-0">
                    <ReceiptText className={clsx(
                        "w-5 h-5 flex-shrink-0",
                        isMatched ? "text-emerald-600 dark:text-emerald-400" : "text-amber-500"
                    )} />
                    <div className="flex-1 min-w-0">
                        <p className="font-medium text-gray-900 dark:text-gray-100 truncate">
                            {receipt.store}
                            <span className={clsx(
                                "ml-2 text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded",
                                isMatched
                                    ? "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300"
                                    : "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300"
                            )}>
                                {isMatched ? 'Koblet' : 'Umatchet'}
                            </span>
                        </p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                            {receipt.date} · {formatKr(receipt.total)}{receipt.itemCount ? ` · ${receipt.itemCount} varer` : ''}
                        </p>
                    </div>
                    {expanded
                        ? <ChevronUp className="w-4 h-4 text-gray-400 flex-shrink-0" />
                        : <ChevronDown className="w-4 h-4 text-gray-400 flex-shrink-0" />}
                </button>
                <button
                    onClick={onDelete}
                    className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors flex-shrink-0"
                    title="Slett kvittering"
                >
                    <Trash2 className="w-4 h-4" />
                </button>
            </div>

            {!isMatched && candidates.length > 0 && (
                <div className="mt-2 ml-8 space-y-1">
                    {candidates.map(t => (
                        <button
                            key={t.id}
                            onClick={() => handleLink(t)}
                            disabled={linking}
                            className="flex items-center gap-2 text-xs text-amber-700 dark:text-amber-300 hover:underline disabled:opacity-50"
                        >
                            <Link2 className="w-3.5 h-3.5" />
                            Koble til «{t.name}» ({t.date})
                        </button>
                    ))}
                </div>
            )}

            {expanded && (
                <ul className="mt-2 ml-8 divide-y divide-gray-100 dark:divide-gray-700">
                    {items.length === 0 && (
                        <li className="py-2 text-sm text-gray-400 italic">Laster varelinjer…</li>
                    )}
                    {items.map(item => (
                        <li key={item.id} className="py-1.5 flex items-center gap-2 text-sm">
                            {item.isPant && <Recycle className="w-3.5 h-3.5 text-teal-600 flex-shrink-0" />}
                            {item.isDiscount && <TicketPercent className="w-3.5 h-3.5 text-purple-600 flex-shrink-0" />}
                            <div className="flex-1 min-w-0">
                                <span className="text-gray-800 dark:text-gray-200">{item.name}</span>
                                <span className="ml-2 text-xs text-gray-400">
                                    {CATEGORY_LABELS[item.category] || item.category}
                                    {item.unit !== 'stk' && ` · ${item.quantity} ${item.unit}`}
                                    {item.unit === 'stk' && item.quantity !== 1 &&
                                        ` · ${item.quantity} stk à ${(item.totalPrice / item.quantity).toLocaleString('no-NO', { minimumFractionDigits: 2 })}`}
                                    {item.discount > 0 && (
                                        <span className="text-purple-500"> · rabatt −{item.discount.toLocaleString('no-NO', { minimumFractionDigits: 2 })}</span>
                                    )}
                                </span>
                            </div>
                            <span className="tabular-nums text-gray-700 dark:text-gray-300 flex-shrink-0">
                                {item.totalPrice.toLocaleString('no-NO', { minimumFractionDigits: 2 })}
                            </span>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
