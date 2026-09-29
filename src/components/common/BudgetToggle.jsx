import { Users, Wallet } from 'lucide-react';
import clsx from 'clsx';
import { useBudget } from '../../contexts/BudgetContext';

/**
 * Which budget a plan page shows. This is a filter on the page, not a
 * global mode — only Budsjett and Sparing care, and the choice is remembered
 * (BudgetContext.activeBudgetId).
 */
export default function BudgetToggle({ className }) {
    const { budgets, activeBudgetId, switchBudget } = useBudget();
    if (budgets.length < 2) return null;
    return (
        <div className={clsx('inline-flex rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-0.5', className)}>
            {budgets.map(b => (
                <button
                    key={b.id}
                    onClick={() => switchBudget(b.id)}
                    className={clsx(
                        'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors',
                        activeBudgetId === b.id
                            ? (b.type === 'shared' ? 'bg-purple-600 text-white' : 'bg-blue-600 text-white')
                            : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                    )}
                >
                    {b.type === 'shared' ? <Users className="w-3.5 h-3.5" /> : <Wallet className="w-3.5 h-3.5" />}
                    {b.name}
                </button>
            ))}
        </div>
    );
}
