import { useState, useEffect } from 'react';
import { ReceiptText, ChevronDown, ChevronUp, Link2, Recycle, TicketPercent } from 'lucide-react';
import { useBudget } from '../../contexts/BudgetContext';
import { CATEGORY_LABELS } from '../../utils/groceryCategories';
import clsx from 'clsx';

const DAY_MS = 24 * 60 * 60 * 1000;

function withinDays(dateA, dateB, days) {
    const a = new Date(dateA);
    const b = new Date(dateB);
    if (isNaN(a) || isNaN(b)) return false;
    return Math.abs(a - b) <= days * DAY_MS;
}

/**
 * Shows the receipt (with line items) linked to a transaction, or — when an
 * unmatched receipt has the same total and a nearby date — offers to link it.
 */
export default function TransactionReceipt({ transaction }) {
    const { receipts, getReceiptItems, linkReceiptToTransaction } = useBudget();
    const [expanded, setExpanded] = useState(false);
    const [items, setItems] = useState(null);
    const [linking, setLinking] = useState(false);

    const matched = receipts.find(r =>
        r.transactionId === transaction.id || r.id === transaction.receiptId
    );
    const suggestion = !matched ? receipts.find(r =>
        !r.transactionId &&
        Math.abs(r.total - Math.abs(transaction.amount)) < 0.01 &&
        withinDays(r.date, transaction.date, 3)
    ) : null;
    const receipt = matched || suggestion;

    // Collapse and drop loaded items when we switch receipt
    useEffect(() => {
        setExpanded(false);
        setItems(null);
    }, [receipt?.id]);

    useEffect(() => {
        if (!expanded || !receipt || items !== null) return;
        let cancelled = false;
        getReceiptItems(receipt.id)
            .then(result => { if (!cancelled) setItems(result); })
            .catch(error => console.error("Failed to load receipt items", error));
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [expanded, receipt?.id, items]);

    if (!receipt) return null;

    const handleLink = async () => {
        setLinking(true);
        try {
            await linkReceiptToTransaction(receipt.id, transaction);
        } catch {
            alert("Kunne ikke koble kvitteringen.");
        } finally {
            setLinking(false);
        }
    };

    const isSuggestion = !matched;

    return (
        <div className={clsx(
            "rounded-xl border mb-6 overflow-hidden",
            isSuggestion
                ? "bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800"
                : "bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800"
        )}>
            <button
                onClick={() => setExpanded(!expanded)}
                className="w-full px-4 py-3 flex items-center gap-3 text-left"
            >
                <ReceiptText className={clsx(
                    "w-5 h-5 flex-shrink-0",
                    isSuggestion ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400"
                )} />
                <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                        {isSuggestion ? 'Umatchet kvittering funnet' : 'Kvittering'} — {receipt.store}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                        {receipt.date} · {receipt.total.toLocaleString('no-NO', { minimumFractionDigits: 2 })} kr
                        {receipt.itemCount ? ` · ${receipt.itemCount} varer` : ''}
                    </p>
                </div>
                {expanded
                    ? <ChevronUp className="w-4 h-4 text-gray-400 flex-shrink-0" />
                    : <ChevronDown className="w-4 h-4 text-gray-400 flex-shrink-0" />}
            </button>

            {isSuggestion && (
                <div className="px-4 pb-3">
                    <button
                        onClick={handleLink}
                        disabled={linking}
                        className="w-full flex items-center justify-center gap-2 py-2 bg-amber-600 hover:bg-amber-700 disabled:bg-gray-300 disabled:dark:bg-gray-600 text-white text-sm font-medium rounded-lg transition-colors"
                    >
                        <Link2 className="w-4 h-4" />
                        {linking ? 'Kobler…' : 'Koble til denne transaksjonen'}
                    </button>
                    <p className="text-xs text-amber-700 dark:text-amber-300 mt-1.5 text-center">
                        Samme beløp, dato {receipt.date} — ikke koblet til noen transaksjon ennå.
                    </p>
                </div>
            )}

            {expanded && (
                <div className="px-4 pb-4 border-t border-black/5 dark:border-white/5">
                    {items === null ? (
                        <p className="text-sm text-gray-500 dark:text-gray-400 py-3">Laster varelinjer…</p>
                    ) : items.length === 0 ? (
                        <p className="text-sm text-gray-500 dark:text-gray-400 py-3">Ingen varelinjer funnet.</p>
                    ) : (
                        <ul className="divide-y divide-black/5 dark:divide-white/5 max-h-64 overflow-y-auto mt-1">
                            {items.map(item => (
                                <li key={item.id} className="py-1.5 flex items-center gap-2 text-sm">
                                    {item.isPant && <Recycle className="w-3.5 h-3.5 text-teal-600 flex-shrink-0" />}
                                    {item.isDiscount && <TicketPercent className="w-3.5 h-3.5 text-purple-600 flex-shrink-0" />}
                                    <div className="flex-1 min-w-0">
                                        <span className={clsx(
                                            "text-gray-800 dark:text-gray-200",
                                            item.isDiscount && "text-purple-700 dark:text-purple-300"
                                        )}>
                                            {item.name}
                                        </span>
                                        <span className="ml-2 text-xs text-gray-400">
                                            {CATEGORY_LABELS[item.category] || item.category}
                                            {item.unit !== 'stk' && ` · ${item.quantity} ${item.unit}`}
                                            {item.unit === 'stk' && item.quantity !== 1 && ` · ${item.quantity} stk`}
                                            {item.discount > 0 && (
                                                <span className="text-purple-500 dark:text-purple-400">
                                                    {` · rabatt −${item.discount.toLocaleString('no-NO', { minimumFractionDigits: 2 })}`}
                                                </span>
                                            )}
                                        </span>
                                    </div>
                                    <span className={clsx(
                                        "tabular-nums flex-shrink-0",
                                        item.totalPrice < 0
                                            ? "text-purple-700 dark:text-purple-300"
                                            : "text-gray-700 dark:text-gray-300"
                                    )}>
                                        {item.totalPrice.toLocaleString('no-NO', { minimumFractionDigits: 2 })}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            )}
        </div>
    );
}
