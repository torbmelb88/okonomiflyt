import { useState } from 'react';
import { X, Upload, AlertCircle } from 'lucide-react';
import { useBudget } from '../../contexts/BudgetContext';

export default function ImportCSVModal({ isOpen, onClose, onImport, accounts: accountsProp }) {
    const { accounts: allAccounts } = useBudget();
    // When a page passes a filtered account subset (e.g. only credit cards),
    // import targets are limited to those; otherwise fall back to all accounts.
    const accounts = accountsProp ?? allAccounts;
    const [file, setFile] = useState(null);
    const [selectedAccountId, setSelectedAccountId] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    if (!isOpen) return null;

    const handleFileChange = (e) => {
        const selectedFile = e.target.files[0];
        if (selectedFile && selectedFile.type === 'text/csv') {
            setFile(selectedFile);
            setError('');
        } else {
            setFile(null);
            setError('Vennligst velg en CSV-fil');
        }
    };

    const detectEncoding = (file) => {
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                const buffer = new Uint8Array(e.target.result);
                let isUtf8 = true;
                let i = 0;
                while (i < buffer.length) {
                    if (buffer[i] < 0x80) {
                        i++; // ASCII
                        continue;
                    } else if ((buffer[i] & 0xE0) === 0xC0) {
                        if (i + 1 >= buffer.length || (buffer[i + 1] & 0xC0) !== 0x80) { isUtf8 = false; break; }
                        i += 2;
                    } else if ((buffer[i] & 0xF0) === 0xE0) {
                        if (i + 2 >= buffer.length || (buffer[i + 1] & 0xC0) !== 0x80 || (buffer[i + 2] & 0xC0) !== 0x80) { isUtf8 = false; break; }
                        i += 3;
                    } else if ((buffer[i] & 0xF8) === 0xF0) {
                        if (i + 3 >= buffer.length || (buffer[i + 1] & 0xC0) !== 0x80 || (buffer[i + 2] & 0xC0) !== 0x80 || (buffer[i + 3] & 0xC0) !== 0x80) { isUtf8 = false; break; }
                        i += 4;
                    } else {
                        isUtf8 = false;
                        break;
                    }
                }
                resolve(isUtf8 ? 'UTF-8' : 'ISO-8859-1');
            };
            reader.readAsArrayBuffer(file.slice(0, 4096)); // Check first 4KB
        });
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!file) {
            setError('Vennligst velg en fil');
            return;
        }

        if (!selectedAccountId) {
            setError('Vennligst velg en konto');
            return;
        }

        setLoading(true);
        try {
            const encoding = await detectEncoding(file);
            console.log(`Detected encoding: ${encoding}`);

            const reader = new FileReader();
            reader.onload = async (e) => {
                const text = e.target.result;
                try {
                    await onImport(text, selectedAccountId);
                    onClose();
                    setFile(null);
                    setSelectedAccountId('');
                } catch (importError) {
                    console.error("Import failed:", importError);
                    setError('Kunne ikke importere CSV-fil. ' + importError.message);
                } finally {
                    setLoading(false);
                }
            };
            reader.onerror = () => {
                setError('Kunne ikke lese filen.');
                setLoading(false);
            };

            reader.readAsText(file, encoding);
        } catch (error) {
            console.error("Failed to setup file reader", error);
            setError('Kunne ikke starte lesing av fil.');
            setLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in duration-200">
                <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between bg-gray-50 dark:bg-gray-800/50">
                    <h2 className="text-lg font-bold text-gray-900 dark:text-white">Importer CSV</h2>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="p-6 space-y-6">
                    <div className="space-y-2">
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Velg konto</label>
                        <select
                            value={selectedAccountId}
                            onChange={(e) => setSelectedAccountId(e.target.value)}
                            className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none dark:bg-gray-700 dark:text-white"
                            required
                        >
                            <option value="">-- Velg konto --</option>
                            {accounts.map(account => (
                                <option key={account.id} value={account.id}>
                                    {account.name} ({account.type})
                                </option>
                            ))}
                        </select>
                    </div>

                    <div className="space-y-2">
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Velg CSV-fil</label>
                        <div className="relative">
                            <input
                                type="file"
                                accept=".csv"
                                onChange={handleFileChange}
                                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none dark:bg-gray-700 dark:text-white dark:file:bg-gray-600 dark:file:text-white"
                                required
                            />
                        </div>
                        {file && (
                            <p className="text-sm text-gray-600 mt-2">
                                Valgt fil: <span className="font-medium">{file.name}</span>
                            </p>
                        )}
                    </div>

                    {error && (
                        <div className="flex items-start space-x-2 p-3 bg-red-50 border border-red-200 rounded-lg">
                            <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                            <p className="text-sm text-red-700">{error}</p>
                        </div>
                    )}

                    <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
                        <h3 className="text-sm font-medium text-blue-900 dark:text-blue-300 mb-2">Forventet format</h3>
                        <p className="text-xs text-blue-700 dark:text-blue-400">
                            CSV-filen skal ha følgende kolonner:<br />
                            <code className="bg-blue-100 dark:bg-blue-900 px-1 rounded">Dato, Beskrivelse, Beløp, Kategori</code>
                        </p>
                    </div>

                    <div className="flex justify-end space-x-3 pt-4">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-4 py-2 text-gray-700 dark:text-gray-300 font-medium hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                        >
                            Avbryt
                        </button>
                        <button
                            type="submit"
                            disabled={loading || !file}
                            className="px-6 py-2 bg-blue-600 text-white font-bold rounded-lg hover:bg-blue-700 transition-colors shadow-sm disabled:bg-gray-300 disabled:cursor-not-allowed flex items-center space-x-2"
                        >
                            <Upload className="w-4 h-4" />
                            <span>{loading ? 'Importerer...' : 'Importer'}</span>
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
