import { useState, useEffect } from 'react';
import { X, Upload, AlertCircle, AlertTriangle, FileText, Loader2, CreditCard, Calendar } from 'lucide-react';
import { extractPdfLines } from '../../utils/pdfText';
import { parseTrumfInvoice } from '../../utils/trumfInvoice';

const fmtKr = (n) => (n == null ? '–' : `${n.toLocaleString('no-NO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kr`);
const fmtDate = (iso) => (iso ? iso.split('-').reverse().join('.') : '–');

const KIND_LABEL = {
    purchase: null,
    refund: { text: 'Refusjon', cls: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300' },
    payment: { text: 'Innbetaling', cls: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' },
};

/**
 * Picker + preview for a Trumf Kredittkort invoice PDF. The PDF is parsed as
 * soon as it is chosen so the user sees exactly which rows will be imported
 * (and the invoice header) before committing. `onImport(parsed, accountId)`
 * does the actual matching/saving.
 */
export default function TrumfInvoiceImportModal({ isOpen, onClose, onImport, accounts }) {
    const [file, setFile] = useState(null);
    const [parsed, setParsed] = useState(null);
    const [selectedAccountId, setSelectedAccountId] = useState('');
    const [parsing, setParsing] = useState(false);
    const [importing, setImporting] = useState(false);
    const [error, setError] = useState('');

    // Preselect when there is exactly one credit card — the common case.
    useEffect(() => {
        if (isOpen && !selectedAccountId && accounts.length === 1) {
            setSelectedAccountId(accounts[0].id);
        }
    }, [isOpen, accounts, selectedAccountId]);

    if (!isOpen) return null;

    const reset = () => {
        setFile(null);
        setParsed(null);
        setError('');
        setParsing(false);
        setImporting(false);
    };

    const handleClose = () => { reset(); onClose(); };

    const handleFileChange = async (e) => {
        const selected = e.target.files[0];
        setParsed(null);
        setError('');
        if (!selected) { setFile(null); return; }
        const isPdf = selected.type === 'application/pdf' || /\.pdf$/i.test(selected.name);
        if (!isPdf) {
            setFile(null);
            setError('Vennligst velg en PDF-fil (fakturaen fra Trumf Kredittkort).');
            return;
        }
        setFile(selected);
        setParsing(true);
        try {
            const lines = await extractPdfLines(await selected.arrayBuffer());
            setParsed(parseTrumfInvoice(lines));
        } catch (err) {
            console.error('Invoice parse failed:', err);
            setError(err.message || 'Kunne ikke lese fakturaen.');
        } finally {
            setParsing(false);
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!parsed || !selectedAccountId) {
            setError(!selectedAccountId ? 'Vennligst velg kredittkort' : 'Vennligst velg en faktura');
            return;
        }
        setImporting(true);
        try {
            await onImport(parsed, selectedAccountId);
            handleClose();
        } catch (err) {
            console.error('Invoice import failed:', err);
            setError('Kunne ikke importere fakturaen. ' + err.message);
            setImporting(false);
        }
    };

    const months = parsed ? [...new Set(parsed.rows.map(r => r.date.substring(0, 7)))].sort() : [];
    const purchases = parsed ? parsed.rows.filter(r => r.kind === 'purchase') : [];
    const purchaseSum = purchases.reduce((s, r) => s + Math.abs(r.amountNok), 0);

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in duration-200">
                <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between bg-gray-50 dark:bg-gray-800/50">
                    <div className="flex items-center gap-2">
                        <FileText className="w-5 h-5 text-purple-600 dark:text-purple-400" />
                        <h2 className="text-lg font-bold text-gray-900 dark:text-white">Importer kortfaktura (PDF)</h2>
                    </div>
                    <button onClick={handleClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="p-6 space-y-5 overflow-y-auto">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Kredittkort</label>
                            <select
                                value={selectedAccountId}
                                onChange={(e) => setSelectedAccountId(e.target.value)}
                                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-purple-500 outline-none dark:bg-gray-700 dark:text-white"
                                required
                            >
                                <option value="">-- Velg kort --</option>
                                {accounts.map(account => (
                                    <option key={account.id} value={account.id}>{account.name}</option>
                                ))}
                            </select>
                        </div>
                        <div className="space-y-2">
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Faktura (PDF)</label>
                            <input
                                type="file"
                                accept="application/pdf,.pdf"
                                onChange={handleFileChange}
                                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-purple-500 outline-none dark:bg-gray-700 dark:text-white dark:file:bg-gray-600 dark:file:text-white"
                                required
                            />
                        </div>
                    </div>

                    {parsing && (
                        <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
                            <Loader2 className="w-4 h-4 animate-spin" /> Leser {file?.name}…
                        </div>
                    )}

                    {error && (
                        <div className="flex items-start space-x-2 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                            <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                            <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
                        </div>
                    )}

                    {parsed && (
                        <>
                            {/* Invoice header */}
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm bg-purple-50 dark:bg-purple-900/20 border border-purple-100 dark:border-purple-800 rounded-lg p-4">
                                <div>
                                    <div className="text-xs text-gray-500 dark:text-gray-400">Fakturadato</div>
                                    <div className="font-medium text-gray-900 dark:text-white">{fmtDate(parsed.header.invoiceDate)}</div>
                                </div>
                                <div>
                                    <div className="text-xs text-gray-500 dark:text-gray-400">Forfall</div>
                                    <div className="font-medium text-gray-900 dark:text-white">{fmtDate(parsed.header.dueDate)}</div>
                                </div>
                                <div>
                                    <div className="text-xs text-gray-500 dark:text-gray-400">Å betale</div>
                                    <div className="font-medium text-gray-900 dark:text-white">{fmtKr(parsed.header.totalDue)}</div>
                                </div>
                                <div>
                                    <div className="text-xs text-gray-500 dark:text-gray-400">Kjøp på fakturaen</div>
                                    <div className="font-medium text-gray-900 dark:text-white">{purchases.length} stk · {fmtKr(purchaseSum)}</div>
                                </div>
                            </div>

                            {parsed.warnings.map((w, i) => (
                                <div key={i} className="flex items-start gap-2 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg text-sm text-amber-800 dark:text-amber-200">
                                    <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />{w}
                                </div>
                            ))}

                            {months.length > 1 && (
                                <div className="flex items-start gap-2 text-xs text-gray-500 dark:text-gray-400">
                                    <Calendar className="w-4 h-4 flex-shrink-0" />
                                    Fakturaen dekker {months.map(m => m.split('-').reverse().join('/')).join(' og ')} — alle radene importeres på sin egen kjøpsdato.
                                </div>
                            )}

                            {/* Rows */}
                            <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
                                <div className="max-h-64 overflow-y-auto">
                                    <table className="w-full text-sm">
                                        <thead className="bg-gray-50 dark:bg-gray-700/50 text-xs text-gray-500 dark:text-gray-400 sticky top-0">
                                            <tr>
                                                <th className="text-left px-3 py-2 font-medium">Dato</th>
                                                <th className="text-left px-3 py-2 font-medium">Butikk</th>
                                                <th className="text-right px-3 py-2 font-medium">Beløp</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                                            {parsed.rows.map((r, i) => {
                                                const badge = KIND_LABEL[r.kind];
                                                return (
                                                    <tr key={i} className="text-gray-800 dark:text-gray-200">
                                                        <td className="px-3 py-1.5 whitespace-nowrap">
                                                            {fmtDate(r.date)}
                                                            {r.purchaseTime && <span className="text-gray-400 ml-1 text-xs">{r.purchaseTime.slice(0, 5)}</span>}
                                                        </td>
                                                        <td className="px-3 py-1.5">
                                                            {r.name}
                                                            {badge && <span className={`ml-2 px-1.5 py-0.5 rounded text-[10px] font-medium ${badge.cls}`}>{badge.text}</span>}
                                                            {r.currency !== 'NOK' && (
                                                                <span className="ml-2 text-xs text-gray-400">{Math.abs(r.amountOriginal).toLocaleString('no-NO')} {r.currency}</span>
                                                            )}
                                                        </td>
                                                        <td className={`px-3 py-1.5 text-right whitespace-nowrap tabular-nums ${r.amountNok > 0 ? 'text-green-600 dark:text-green-400' : ''}`}>
                                                            {fmtKr(Math.abs(r.amountNok))}
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </>
                    )}

                    {!parsed && !parsing && !error && (
                        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4 flex gap-3">
                            <CreditCard className="w-5 h-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
                            <p className="text-xs text-blue-700 dark:text-blue-400">
                                Last ned månedsfakturaen fra Trumf Kredittkort-appen eller e-posten og velg den her.
                                Transaksjonene hentes fra «Transaksjonsoversikt» og legges på kjøpsdato — også når
                                fakturaen går over to måneder. Rader som allerede finnes fanges av duplikatsjekken.
                            </p>
                        </div>
                    )}

                    <div className="flex justify-end space-x-3 pt-2">
                        <button
                            type="button"
                            onClick={handleClose}
                            className="px-4 py-2 text-gray-700 dark:text-gray-300 font-medium hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                        >
                            Avbryt
                        </button>
                        <button
                            type="submit"
                            disabled={importing || parsing || !parsed || parsed.rows.length === 0 || !selectedAccountId}
                            className="px-6 py-2 bg-purple-600 text-white font-bold rounded-lg hover:bg-purple-700 transition-colors shadow-sm disabled:bg-gray-300 disabled:cursor-not-allowed flex items-center space-x-2"
                        >
                            {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                            <span>{importing ? 'Importerer…' : `Importer ${parsed ? parsed.rows.length + ' rader' : ''}`.trim()}</span>
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
