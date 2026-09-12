import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Info } from 'lucide-react';
import clsx from 'clsx';

/**
 * Liten «i» med forklaringsboble — hover på PC, trykk på mobil. Rendres som
 * span slik at den trygt kan stå inne i <label> og <button> uten å utløse
 * deres klikk (toggle stopper propagering og preventDefault).
 *
 * Boblen rendres i en portal på document.body med fast posisjon, slik at
 * kort med overflow-hidden ikke klipper den. Den legges over ikonet når det
 * er plass, ellers under, og klemmes alltid innenfor skjermbredden.
 */
export default function InfoTip({ text, className }) {
    const [open, setOpen] = useState(false);
    const rootRef = useRef(null);
    const bubbleRef = useRef(null);

    // Trykk utenfor lukker (mobil). Egne trykk når aldri hit — toggle
    // stopper propageringen. Scroll lukker også, så boblen ikke henger igjen.
    useEffect(() => {
        if (!open) return;
        const close = (e) => {
            if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
        };
        const closeNow = () => setOpen(false);
        document.addEventListener('click', close);
        document.addEventListener('touchstart', close);
        window.addEventListener('scroll', closeNow, true);
        window.addEventListener('resize', closeNow);
        return () => {
            document.removeEventListener('click', close);
            document.removeEventListener('touchstart', close);
            window.removeEventListener('scroll', closeNow, true);
            window.removeEventListener('resize', closeNow);
        };
    }, [open]);

    // Måles etter at boblen er rendret skjult, og plasseres direkte på noden
    // i viewport-koordinater før paint.
    useLayoutEffect(() => {
        if (!open) return;
        const icon = rootRef.current?.getBoundingClientRect();
        const node = bubbleRef.current;
        if (!icon || !node) return;
        const { width, height } = node.getBoundingClientRect();
        const vw = document.documentElement.clientWidth;
        let left = icon.left + icon.width / 2 - width / 2;
        left = Math.min(left, vw - width - 8);
        left = Math.max(left, 8);
        const below = icon.top - height - 8 < 8;
        node.style.left = `${left}px`;
        node.style.top = `${below ? icon.bottom + 8 : icon.top - height - 8}px`;
        node.style.visibility = 'visible';
    }, [open]);

    const toggle = (e) => {
        e.preventDefault();
        e.stopPropagation();
        setOpen(o => !o);
    };
    // Touch devices fire emulated mouseenter right before click — without this
    // guard a tap would open (enter) and immediately close (click) the bubble.
    const touchedRef = useRef(false);

    return (
        <span
            ref={rootRef}
            className={clsx('relative inline-flex items-center', className)}
            onTouchStart={() => { touchedRef.current = true; }}
            onMouseEnter={() => { if (!touchedRef.current) setOpen(true); }}
            onMouseLeave={() => { if (!touchedRef.current) setOpen(false); }}
        >
            <span
                role="button"
                tabIndex={0}
                aria-label="Forklaring"
                onClick={toggle}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') toggle(e); }}
                className="cursor-help text-gray-400 hover:text-blue-500 dark:text-gray-500 dark:hover:text-blue-400 transition-colors"
            >
                <Info className="w-3.5 h-3.5" />
            </span>
            {open && createPortal(
                <span
                    ref={bubbleRef}
                    style={{ left: 0, top: 0, visibility: 'hidden' }}
                    className="fixed z-[100] w-64 max-w-[calc(100vw-16px)] rounded-lg bg-gray-900 dark:bg-gray-950 px-3 py-2 text-xs font-normal normal-case leading-relaxed text-left text-gray-100 shadow-lg pointer-events-none whitespace-normal"
                >
                    {text}
                </span>,
                document.body
            )}
        </span>
    );
}
