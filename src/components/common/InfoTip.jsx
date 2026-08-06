import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Info } from 'lucide-react';
import clsx from 'clsx';

/**
 * Liten «i» med forklaringsboble — hover på PC, trykk på mobil. Rendres som
 * span slik at den trygt kan stå inne i <label> og <button> uten å utløse
 * deres klikk (toggle stopper propagering og preventDefault). Boblen måles
 * ved åpning og skyves horisontalt slik at den alltid holder seg innenfor
 * skjermkanten.
 */
export default function InfoTip({ text, className }) {
    const [open, setOpen] = useState(false);
    const rootRef = useRef(null);
    const bubbleRef = useRef(null);

    // Trykk utenfor lukker (mobil). Egne trykk når aldri hit — toggle
    // stopper propageringen.
    useEffect(() => {
        if (!open) return;
        const close = (e) => {
            if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
        };
        document.addEventListener('click', close);
        document.addEventListener('touchstart', close);
        return () => {
            document.removeEventListener('click', close);
            document.removeEventListener('touchstart', close);
        };
    }, [open]);

    // Sentrer boblen over ikonet, men klem den innenfor skjermbredden.
    // Rendres skjult, måles, og posisjoneres direkte på noden før paint.
    useLayoutEffect(() => {
        if (!open) return;
        const icon = rootRef.current?.getBoundingClientRect();
        const node = bubbleRef.current;
        if (!icon || !node) return;
        const width = node.getBoundingClientRect().width;
        const vw = document.documentElement.clientWidth;
        let left = icon.left + icon.width / 2 - width / 2;
        left = Math.min(left, vw - width - 8);
        left = Math.max(left, 8);
        node.style.left = `${left - icon.left}px`;
        node.style.visibility = 'visible';
    }, [open]);

    const toggle = (e) => {
        e.preventDefault();
        e.stopPropagation();
        setOpen(o => !o);
    };

    return (
        <span
            ref={rootRef}
            className={clsx('relative inline-flex items-center', className)}
            onMouseEnter={() => setOpen(true)}
            onMouseLeave={() => setOpen(false)}
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
            {open && (
                <span
                    ref={bubbleRef}
                    style={{ left: 0, visibility: 'hidden' }}
                    className="absolute bottom-full mb-2 z-30 w-64 max-w-[calc(100vw-16px)] rounded-lg bg-gray-900 dark:bg-gray-950 px-3 py-2 text-xs font-normal normal-case leading-relaxed text-left text-gray-100 shadow-lg pointer-events-none whitespace-normal"
                >
                    {text}
                </span>
            )}
        </span>
    );
}
