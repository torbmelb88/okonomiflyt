import { X, ExternalLink, Unlink, Ban } from 'lucide-react';
import { useBudget } from '../../contexts/BudgetContext';
import clsx from 'clsx';

export default function BudgetItemDetailsModal({ isOpen, onClose, budgetItem, selectedMonth }) {
    const { transactions, updateTransaction } = useBudget();

    if (!isOpen || !budgetItem) return null;

    // Filter transactions linked to this budget item
    const linkedTransactions = transactions.filter(t => t.budgetItemId === budgetItem.id && t.month === selectedMonth);

    const handleUnlink = async (transactionId) => {
        if (window.confirm('Er du sikker på at du vil fjerne koblingen til denne transaksjonen?')) {
            try {
                await updateTransaction(transactionId, {
                    budgetItemId: null,
                    reconciled: false
                });
            } catch (error) {
                console.error("Failed to unlink transaction:", error);
                alert("Kunne ikke fjerne kobling.");
            }
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-2xl overflow-hidden animate-in fade-in zoom-in duration-200">
                <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between bg-gray-50 dark:bg-gray-800/50">
                    <div>
                        <h2 className="text-lg font-bold text-gray-900 dark:text-white">{budgetItem.name}</h2>
                        <p className="text-sm text-gray-500 dark:text-gray-400">{budgetItem.category}</p>
                    </div>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="p-6">
                    <div className="grid grid-cols-2 gap-4 mb-8">
                        <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-xl border border-blue-100 dark:border-blue-800">
                            <p className="text-sm text-blue-600 dark:text-blue-400 font-medium mb-1">Budsjettert</p>
                            {/* budgetedAmount is month-override-aware (set by Forbruk); amount is the base */}
                            <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">{(budgetItem.budgetedAmount ?? budgetItem.amount ?? 0).toLocaleString('no-NO')} kr</p>
                        </div>
                        <div className="p-4 bg-green-50 dark:bg-green-900/20 rounded-xl border border-green-100 dark:border-green-800">
                            <p className="text-sm text-green-600 dark:text-green-400 font-medium mb-1">Faktisk forbruk</p>
                            <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                                {linkedTransactions.reduce((sum, t) => {
                                    if (t.type === 'income') return sum - t.amount;
                                    return sum + t.amount;
                                }, 0).toLocaleString('no-NO')} kr
                            </p>
                        </div>
                    </div>

                    <h3 className="font-bold text-gray-900 dark:text-white mb-4 flex items-center">
                        <ExternalLink className="w-4 h-4 mr-2" />
                        Tilknyttede Transaksjoner ({linkedTransactions.length})
                    </h3>

                    <div className="space-y-3 max-h-[300px] overflow-y-auto">
                        {linkedTransactions.length > 0 ? (
                            linkedTransactions.map(trans => (
                                <div key={trans.id} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700/30 rounded-lg border border-gray-100 dark:border-gray-700 hover:border-blue-200 dark:hover:border-blue-700 transition-colors group">
                                    <div>
                                        <p className="font-medium text-gray-900 dark:text-gray-100">
                                            {trans.name}
                                        </p>
                                        <div className="flex items-center gap-2">
                                            <p className="text-xs text-gray-500 dark:text-gray-400">{trans.date}</p>
                                            {trans.excludeFromSharedCalc && (
                                                <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-orange-100 dark:bg-orange-900/30 text-[10px] font-bold text-orange-600 dark:text-orange-400 uppercase tracking-wider border border-orange-200 dark:border-orange-800">
                                                    Ekskludert
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                    <div className="flex items-center space-x-3">
                                        <select
                                            value={trans.payer || 'shared'}
                                            onChange={(e) => updateTransaction(trans.id, { payer: e.target.value })}
                                            className="text-xs border border-gray-200 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded p-1 mr-2"
                                        >
                                            <option value="shared">Felles</option>
                                            <option value="self">Meg</option>
                                            <option value="partner">Partner</option>
                                        </select>
                                        <span className={clsx(
                                            "font-bold",
                                            trans.type === 'income' ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"
                                        )}>
                                            {trans.type === 'income' ? '+' : '-'}{trans.amount.toLocaleString('no-NO')} kr
                                        </span>
                                        <button
                                            onClick={() => updateTransaction(trans.id, { excludeFromSharedCalc: !trans.excludeFromSharedCalc })}
                                            className={clsx(
                                                "p-1.5 rounded-lg transition-all",
                                                trans.excludeFromSharedCalc 
                                                    ? "text-orange-600 bg-orange-100 dark:bg-orange-900/30" 
                                                    : "text-gray-400 hover:text-orange-600 hover:bg-orange-50 dark:hover:bg-orange-900/20"
                                            )}
                                            title={trans.excludeFromSharedCalc ? "Ta med i fordeling" : "Hold utenfor fordeling"}
                                        >
                                            <Ban className="w-4 h-4" />
                                        </button>
                                        <button
                                            onClick={() => handleUnlink(trans.id)}
                                            className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-all"
                                            title="Fjern kobling"
                                        >
                                            <Unlink className="w-4 h-4" />
                                        </button>
                                    </div>
                                </div>
                            ))
                        ) : (
                            <div className="text-center py-8 text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-800/50 rounded-lg border border-dashed border-gray-200 dark:border-gray-700">
                                Ingen transaksjoner er knyttet til denne budsjettposten ennå.
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
