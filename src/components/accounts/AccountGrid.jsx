import { CreditCard, Plus, Edit2, Trash2, Wallet } from 'lucide-react';
import { useBudget } from '../../contexts/BudgetContext';

/**
 * Grid of account cards with add/edit/delete. Accounts are global; each shows
 * its default budget (where new transactions land unless overridden). Shared by
 * the Kontoer (bank) and Kredittkort pages — each passes its filtered list.
 */
export default function AccountGrid({ accounts, onAdd, onEdit, onDelete, addLabel = 'Legg til konto' }) {
    const { budgets, bankBalances } = useBudget();
    const budgetName = (id) => budgets.find(b => b.id === id)?.name;
    const balanceFor = (account) => account.sb1AccountKey
        ? bankBalances.find(b => b.sb1AccountKey === account.sb1AccountKey)
        : null;

    return (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {accounts.map(account => {
                const defBudget = budgetName(account.defaultBudgetId || account.budgetId);
                return (
                    <div key={account.id} className="p-4 rounded-xl border bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 relative group">
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-sm font-medium text-gray-500 dark:text-gray-400">{account.type}</span>
                            <CreditCard className="w-4 h-4 text-gray-400" />
                        </div>
                        <div className="text-lg font-bold text-gray-900 dark:text-gray-100">{account.name}</div>

                        {(() => {
                            const bal = balanceFor(account);
                            return bal && typeof bal.balance === 'number' ? (
                                <div className="mt-1 text-xl font-bold text-gray-900 dark:text-gray-100">
                                    {bal.balance.toLocaleString('no-NO')} {bal.currency || 'kr'}
                                    {typeof bal.availableBalance === 'number' && bal.availableBalance !== bal.balance && (
                                        <span className="block text-xs font-normal text-gray-500 dark:text-gray-400">Disponibelt: {bal.availableBalance.toLocaleString('no-NO')}</span>
                                    )}
                                </div>
                            ) : null;
                        })()}

                        {account.cardLastFour && (
                            <div className="mt-1 flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
                                <CreditCard className="w-3 h-3" />
                                <span>••• {account.cardLastFour}</span>
                            </div>
                        )}

                        {defBudget && (
                            <div className="mt-2 flex items-center gap-1.5 text-xs font-medium text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-700/40 px-2 py-1 rounded w-fit">
                                <Wallet className="w-3 h-3" />
                                <span>Standard: {defBudget}</span>
                            </div>
                        )}

                        <div className="absolute top-2 right-2 flex space-x-1 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
                            <button onClick={(e) => { e.stopPropagation(); onEdit(account); }} className="p-1.5 bg-white dark:bg-gray-700 text-gray-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded-lg transition-colors shadow-sm">
                                <Edit2 className="w-3.5 h-3.5" />
                            </button>
                            <button onClick={(e) => { e.stopPropagation(); onDelete(account.id); }} className="p-1.5 bg-white dark:bg-gray-700 text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-lg transition-colors shadow-sm">
                                <Trash2 className="w-3.5 h-3.5" />
                            </button>
                        </div>
                    </div>
                );
            })}

            <button onClick={onAdd} className="p-4 rounded-xl border border-dashed border-gray-300 dark:border-gray-600 flex flex-col items-center justify-center text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 hover:border-gray-400 dark:hover:border-gray-500 transition-colors min-h-[120px]">
                <Plus className="w-6 h-6 mb-2" />
                <span className="text-sm font-medium">{addLabel}</span>
            </button>
        </div>
    );
}
