import { useState } from 'react';
import { Download, Upload, CreditCard, Landmark, Calendar, FileText } from 'lucide-react';
import { useBudget } from '../../contexts/BudgetContext';
import ImportTransactionsModal from './ImportTransactionsModal';
import CsvImportFlow from './CsvImportFlow';
import TrumfInvoiceImportFlow from './TrumfInvoiceImportFlow';

/**
 * Import = the single entry point for getting transactions into the app:
 * automatic fetch from SpareBank 1 (staged by the home-server sync), and for
 * the credit cards that fall outside the bank API either the monthly invoice
 * PDF (Trumf Kredittkort) or a manual CSV. Viewing and reconciling everything
 * lives on Transaksjoner; spending statistics on Forbruk.
 */
export default function ImportPage() {
    const { activeBudget, accounts, loading } = useBudget();

    const [isBankImportOpen, setIsBankImportOpen] = useState(false);
    const [isCsvOpen, setIsCsvOpen] = useState(false);
    const [isInvoiceOpen, setIsInvoiceOpen] = useState(false);
    const [selectedMonth, setSelectedMonth] = useState(() => {
        const now = new Date();
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    });

    if (loading) return <div>Laster import...</div>;
    if (!activeBudget) return <div>Ingen budsjett valgt.</div>;

    const creditCards = accounts.filter(a => a.type === 'Kredittkort');
    // Credit cards first: they are the accounts that actually need CSV import.
    const csvAccounts = [...creditCards, ...accounts.filter(a => a.type !== 'Kredittkort')];

    return (
        <div className="space-y-6">
            <div className="flex items-center gap-3">
                <div className="p-2 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                    <Download className="w-6 h-6 text-blue-600 dark:text-blue-400" />
                </div>
                <div>
                    <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Import</h1>
                    <p className="text-sm text-gray-500 dark:text-gray-400">Hent transaksjoner inn i appen. Avstemming og transaksjonslisten finner du under Transaksjoner.</p>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Bank (SB1) */}
                <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-6 flex flex-col gap-4">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                            <Landmark className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                        </div>
                        <h2 className="font-bold text-gray-900 dark:text-gray-100">Bank (SpareBank 1)</h2>
                    </div>
                    <p className="text-sm text-gray-500 dark:text-gray-400 flex-1">
                        Henter inn transaksjonene bank-synkroniseringen har lagt klare, med automatisk
                        duplikatsjekk mot det som allerede er registrert. Nye rader legges som uavstemt.
                    </p>
                    <button
                        onClick={() => setIsBankImportOpen(true)}
                        className="flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 shadow-sm text-sm"
                    >
                        <Download className="w-4 h-4" />
                        <span>Hent fra bank</span>
                    </button>
                </div>

                {/* Credit cards: invoice PDF (Trumf) or manual CSV */}
                <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-6 flex flex-col gap-4">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-purple-50 dark:bg-purple-900/20 rounded-lg">
                            <CreditCard className="w-5 h-5 text-purple-600 dark:text-purple-400" />
                        </div>
                        <h2 className="font-bold text-gray-900 dark:text-gray-100">Kredittkort</h2>
                    </div>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                        Kredittkortene faller utenfor bank-synkroniseringen. Trumf Kredittkort har ingen
                        eksport, men månedsfakturaen (PDF) inneholder alle kjøpene — importer den direkte.
                        Alle rader hentes inn på kjøpsdato, uavhengig av måned.
                    </p>
                    <button
                        onClick={() => setIsInvoiceOpen(true)}
                        disabled={creditCards.length === 0}
                        className="flex items-center justify-center gap-2 px-4 py-2 bg-purple-600 text-white font-medium rounded-lg hover:bg-purple-700 shadow-sm text-sm disabled:bg-gray-300 disabled:cursor-not-allowed"
                    >
                        <FileText className="w-4 h-4" />
                        <span>Importer kortfaktura (PDF)</span>
                    </button>
                    {creditCards.length === 0 && (
                        <p className="text-xs text-gray-400">Legg til et kredittkort under Kontoer for å importere faktura.</p>
                    )}

                    <div className="border-t border-gray-100 dark:border-gray-700 pt-4 mt-1 flex-1">
                        <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">
                            Har kortet en CSV-eksport, kan den importeres her i stedet. Kun rader i valgt måned hentes inn.
                        </p>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1 flex items-center gap-1.5">
                                <Calendar className="w-4 h-4" /> Måned
                            </label>
                            <input
                                type="month"
                                value={selectedMonth}
                                onChange={(e) => setSelectedMonth(e.target.value)}
                                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-purple-500 outline-none dark:bg-gray-700 dark:text-white"
                            />
                        </div>
                        <button
                            onClick={() => setIsCsvOpen(true)}
                            className="mt-3 w-full flex items-center justify-center gap-2 px-4 py-2 border border-purple-300 dark:border-purple-700 text-purple-700 dark:text-purple-300 font-medium rounded-lg hover:bg-purple-50 dark:hover:bg-purple-900/20 text-sm"
                        >
                            <Upload className="w-4 h-4" />
                            <span>Importer CSV</span>
                        </button>
                    </div>
                </div>
            </div>

            <ImportTransactionsModal isOpen={isBankImportOpen} onClose={() => setIsBankImportOpen(false)} />
            <CsvImportFlow
                isOpen={isCsvOpen}
                onClose={() => setIsCsvOpen(false)}
                accounts={csvAccounts}
                selectedMonth={selectedMonth}
            />
            <TrumfInvoiceImportFlow
                isOpen={isInvoiceOpen}
                onClose={() => setIsInvoiceOpen(false)}
                accounts={creditCards}
            />
        </div>
    );
}
