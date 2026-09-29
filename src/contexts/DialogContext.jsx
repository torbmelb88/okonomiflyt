import { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';
import clsx from 'clsx';

/**
 * App-styled replacement for window.confirm / alert.
 *
 *   const { confirm, notify } = useDialog();
 *   if (!(await confirm({ title, message, confirmText, variant: 'warning' }))) return;
 *   await notify({ title, message, variant: 'error' });
 *
 * `variant`: 'info' (default) | 'warning' | 'danger' | 'success' | 'error'.
 * Both resolve when the dialog closes; confirm resolves true only on the
 * confirm button. Escape / backdrop = cancel.
 */
const DialogContext = createContext(null);

// eslint-disable-next-line react-refresh/only-export-components
export function useDialog() {
    const ctx = useContext(DialogContext);
    if (!ctx) throw new Error('useDialog must be used inside DialogProvider');
    return ctx;
}

const VARIANT = {
    info: { Icon: Info, iconCls: 'bg-blue-100 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400', btnCls: 'bg-blue-600 hover:bg-blue-700' },
    warning: { Icon: AlertTriangle, iconCls: 'bg-amber-100 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400', btnCls: 'bg-amber-600 hover:bg-amber-700' },
    danger: { Icon: AlertTriangle, iconCls: 'bg-red-100 dark:bg-red-900/20 text-red-600 dark:text-red-400', btnCls: 'bg-red-600 hover:bg-red-700' },
    error: { Icon: AlertTriangle, iconCls: 'bg-red-100 dark:bg-red-900/20 text-red-600 dark:text-red-400', btnCls: 'bg-blue-600 hover:bg-blue-700' },
    success: { Icon: CheckCircle2, iconCls: 'bg-green-100 dark:bg-green-900/20 text-green-600 dark:text-green-400', btnCls: 'bg-green-600 hover:bg-green-700' },
};

export function DialogProvider({ children }) {
    const [dialog, setDialog] = useState(null); // { kind, title, message, confirmText, cancelText, variant, resolve }
    const confirmBtn = useRef(null);

    const open = useCallback((kind, opts) => new Promise((resolve) => {
        setDialog({ kind, ...opts, resolve });
    }), []);
    const confirm = useCallback((opts) => open('confirm', typeof opts === 'string' ? { message: opts } : opts), [open]);
    const notify = useCallback((opts) => open('notify', typeof opts === 'string' ? { message: opts } : opts), [open]);

    const close = (result) => {
        dialog?.resolve(result);
        setDialog(null);
    };

    useEffect(() => {
        if (!dialog) return;
        confirmBtn.current?.focus();
        const onKey = (e) => {
            if (e.key === 'Escape') { e.preventDefault(); close(false); }
            if (e.key === 'Enter') { e.preventDefault(); close(true); }
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [dialog]);

    const v = VARIANT[dialog?.variant] || VARIANT.info;
    const defaultTitle = dialog?.kind === 'confirm' ? 'Er du sikker?' : (dialog?.variant === 'error' ? 'Noe gikk galt' : dialog?.variant === 'success' ? 'Lagret' : 'Melding');

    return (
        <DialogContext.Provider value={{ confirm, notify }}>
            {children}
            {dialog && (
                <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={() => close(false)} role="dialog" aria-modal="true">
                    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in duration-200" onClick={(e) => e.stopPropagation()}>
                        <div className="p-5 sm:p-6">
                            <div className="flex items-start gap-4">
                                <div className={clsx('p-3 rounded-full flex-shrink-0', v.iconCls)}>
                                    <v.Icon className="w-6 h-6" />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-start justify-between gap-2">
                                        <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-2">{dialog.title || defaultTitle}</h3>
                                        <button onClick={() => close(false)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 -mt-1" title="Lukk"><X className="w-5 h-5" /></button>
                                    </div>
                                    <p className="text-gray-600 dark:text-gray-400 whitespace-pre-line break-words">{dialog.message}</p>
                                </div>
                            </div>
                            <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 sm:gap-3 mt-6">
                                {dialog.kind === 'confirm' && (
                                    <button onClick={() => close(false)} className="px-4 py-2 text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg font-medium transition-colors">
                                        {dialog.cancelText || 'Avbryt'}
                                    </button>
                                )}
                                <button ref={confirmBtn} onClick={() => close(true)} className={clsx('px-4 py-2 text-white rounded-lg font-medium shadow-sm transition-colors', v.btnCls)}>
                                    {dialog.confirmText || (dialog.kind === 'confirm' ? 'OK' : 'OK')}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </DialogContext.Provider>
    );
}
