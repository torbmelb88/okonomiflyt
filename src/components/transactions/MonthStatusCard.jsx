import { AlertTriangle, CheckCircle2, Circle, Clock, Loader2, Hourglass } from 'lucide-react';
import clsx from 'clsx';

/**
 * Where the month stands, as a checklist of what has to be true before it can
 * be marked as reconciled. The colour follows what is LEFT, not what is done:
 *
 *   amber  «Trenger oppfølging»          — something you can do now
 *   blue   «Alt du kan gjøre nå er gjort» — only waiting left (bank copy, month end)
 *   green  «Klar til å markeres»          — every point met, the button appears
 *   green  «<Måned> er avstemt»           — marked, with «Angre»
 *
 * The button never shows for the current or a future month. For a month that
 * is over but still waiting on the bank, a muted «likevel» link remains.
 */
export default function MonthStatusCard({
    monthLabel, isOver, endsLabel,
    unreconciledCount, coverProblemCount, bookedCount,
    monthReconciled, reconciledAt, saving,
    onReconcileNow, onFixCover, onToggleReconciled,
}) {
    const items = [
        {
            key: 'categorized', done: unreconciledCount === 0,
            label: 'Alle transaksjoner er kategorisert',
            detail: unreconciledCount > 0 ? `${unreconciledCount} ${unreconciledCount === 1 ? 'uavstemt' : 'uavstemte'}` : null,
            action: unreconciledCount > 0 ? { label: 'Avstem nå', onClick: onReconcileNow, cls: 'bg-amber-600 hover:bg-amber-700' } : null,
            tone: 'action',
        },
        {
            key: 'cover', done: coverProblemCount === 0,
            label: 'Gjennomreise: innbetalinger koblet',
            detail: coverProblemCount > 0 ? `${coverProblemCount} ${coverProblemCount === 1 ? 'overføring mangler' : 'overføringer mangler'} innbetaling` : null,
            action: coverProblemCount > 0 ? { label: 'Koble innbetaling', onClick: onFixCover, cls: 'bg-red-600 hover:bg-red-700' } : null,
            tone: 'danger',
        },
        {
            key: 'bank', done: bookedCount === 0,
            label: 'Bekreftet av bank eller kortfaktura',
            detail: bookedCount > 0 ? `${bookedCount} ${bookedCount === 1 ? 'bokført transaksjon venter' : 'bokførte transaksjoner venter'} på bankimport, kortfaktura eller CSV` : null,
            tone: 'wait',
        },
        {
            key: 'over', done: isOver,
            label: 'Måneden er over',
            detail: isOver ? null : `avsluttes ${endsLabel}`,
            tone: 'wait',
        },
    ];
    const needsAction = unreconciledCount > 0 || coverProblemCount > 0;
    const waiting = !needsAction && (bookedCount > 0 || !isOver);
    const ready = !needsAction && !waiting;

    const state = monthReconciled ? 'marked' : needsAction ? 'action' : waiting ? 'waiting' : 'ready';
    const palette = {
        action: { card: 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800', title: 'text-amber-800 dark:text-amber-200', text: 'text-amber-700 dark:text-amber-300', Icon: AlertTriangle, icon: 'text-amber-600 dark:text-amber-400' },
        waiting: { card: 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800', title: 'text-blue-800 dark:text-blue-200', text: 'text-blue-700 dark:text-blue-300', Icon: Hourglass, icon: 'text-blue-600 dark:text-blue-400' },
        ready: { card: 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800', title: 'text-green-800 dark:text-green-200', text: 'text-green-700 dark:text-green-300', Icon: CheckCircle2, icon: 'text-green-600 dark:text-green-400' },
        marked: { card: 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800', title: 'text-green-800 dark:text-green-200', text: 'text-green-700 dark:text-green-300', Icon: CheckCircle2, icon: 'text-green-600 dark:text-green-400' },
    }[state];
    const title = {
        action: 'Trenger oppfølging',
        waiting: 'Alt du kan gjøre nå er gjort',
        ready: 'Klar til å markeres som avstemt',
        marked: `${monthLabel} er avstemt`,
    }[state];
    const subtitle = {
        action: `Gjør punktene under, så blir ${monthLabel} riktig i alle oversikter.`,
        waiting: 'Resten er venting. Kortet oppdaterer seg selv når det skjer noe.',
        ready: 'Alle punktene er oppfylt. Marker måneden, så vises Likviditet på Min Oversikt som endelig. Ingenting låses.',
        marked: `Markert${reconciledAt ? ` ${new Date(reconciledAt).toLocaleDateString('no-NO', { day: 'numeric', month: 'long' })}` : ''}. Transaksjonene kan fortsatt endres.`,
    }[state];

    const itemIcon = (it) => {
        if (it.done) return <CheckCircle2 className="w-4 h-4 text-green-600 dark:text-green-400 flex-shrink-0" />;
        if (it.tone === 'danger') return <AlertTriangle className="w-4 h-4 text-red-600 dark:text-red-400 flex-shrink-0" />;
        if (it.tone === 'action') return <Circle className="w-4 h-4 text-amber-600 dark:text-amber-400 flex-shrink-0" />;
        return <Clock className="w-4 h-4 text-blue-500 dark:text-blue-400 flex-shrink-0" />;
    };
    const itemText = (it) => it.done
        ? 'text-gray-500 dark:text-gray-400'
        : it.tone === 'danger' ? 'text-red-700 dark:text-red-300 font-medium'
            : it.tone === 'action' ? 'text-amber-800 dark:text-amber-200 font-medium'
                : 'text-gray-700 dark:text-gray-300';

    return (
        <div className={clsx('rounded-xl border p-4 space-y-3', palette.card)}>
            <div className="flex items-start gap-3">
                <palette.Icon className={clsx('w-6 h-6 flex-shrink-0', palette.icon)} />
                <div className="min-w-0">
                    <div className={clsx('font-semibold first-letter:uppercase', palette.title)}>{title}</div>
                    <div className={clsx('text-sm', palette.text)}>{subtitle}</div>
                </div>
            </div>

            {!monthReconciled && (
                <ul className="bg-white/70 dark:bg-gray-800/60 rounded-lg divide-y divide-gray-100 dark:divide-gray-700">
                    {items.map(it => (
                        <li key={it.key} className="px-3 py-2 flex flex-col sm:flex-row sm:items-center gap-2">
                            <div className="flex items-start gap-2 flex-1 min-w-0">
                                <span className="mt-0.5">{itemIcon(it)}</span>
                                <span className={clsx('text-sm', itemText(it))}>
                                    {it.label}
                                    {it.detail && <span className="font-normal"> · {it.detail}</span>}
                                </span>
                            </div>
                            {it.action && (
                                <button onClick={it.action.onClick} className={clsx('w-full sm:w-auto px-3 py-1.5 text-white text-sm font-medium rounded-lg shadow-sm whitespace-nowrap sm:ml-6', it.action.cls)}>
                                    {it.action.label}
                                </button>
                            )}
                        </li>
                    ))}
                </ul>
            )}

            {/* Marking: only once the month is over */}
            {monthReconciled ? (
                <button onClick={onToggleReconciled} disabled={saving} className={clsx('text-sm underline hover:no-underline disabled:opacity-50', palette.text)}>Angre markeringen</button>
            ) : ready ? (
                <button onClick={onToggleReconciled} disabled={saving} className="flex items-center justify-center gap-2 w-full sm:w-auto px-4 py-2 bg-green-600 hover:bg-green-700 text-white font-medium rounded-lg shadow-sm disabled:opacity-50">
                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                    Marker {monthLabel} som avstemt
                </button>
            ) : isOver ? (
                <button onClick={onToggleReconciled} disabled={saving} className={clsx('text-xs underline hover:no-underline disabled:opacity-50 opacity-80', palette.text)} title="Bruk denne hvis noe aldri kommer til å bli bekreftet, f.eks. en kortfaktura som mangler én rad">
                    Marker som avstemt likevel
                </button>
            ) : (
                <p className={clsx('text-xs opacity-80', palette.text)}>Måneden kan markeres som avstemt når den er over.</p>
            )}
        </div>
    );
}
