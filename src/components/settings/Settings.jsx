import { useState } from 'react';
import { Users, Wallet, Plus } from 'lucide-react';
import { useBudget } from '../../contexts/BudgetContext';
import MigrationTool from './MigrationTool';
import CategoryBudgetManager from './CategoryBudgetManager';
import PartnerSettings from './PartnerSettings';
import SalarySettings from './SalarySettings';
import ResetTool from './ResetTool';
import CreateBudgetModal from '../budget/CreateBudgetModal';

const SectionHeading = ({ shared, children, hint }) => (
    <div className="flex items-center gap-2 pt-2">
        {shared ? <Users className="w-4 h-4 text-purple-400" /> : <Wallet className="w-4 h-4 text-gray-400" />}
        <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">{children}</h2>
        {hint && <span className="text-xs text-gray-400">· {hint}</span>}
    </div>
);

/**
 * Innstillinger hub. Every section is always shown, under a heading that
 * says which budget it belongs to — nothing here follows a global budget
 * switch. Budgets themselves are listed and created at the top.
 */
export default function Settings() {
    const { budgets, personalBudget, sharedBudget, createBudget } = useBudget();
    const [isCreateOpen, setIsCreateOpen] = useState(false);

    return (
        <div className="max-w-3xl mx-auto space-y-6">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Innstillinger</h1>

            {/* Budsjetter */}
            <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700">
                <div className="flex items-center justify-between mb-3">
                    <h2 className="text-lg font-bold text-gray-900 dark:text-white">Budsjetter</h2>
                    <button onClick={() => setIsCreateOpen(true)} className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg">
                        <Plus className="w-4 h-4" />Opprett nytt budsjett
                    </button>
                </div>
                <div className="divide-y divide-gray-100 dark:divide-gray-700">
                    {budgets.map(b => (
                        <div key={b.id} className="py-2.5 flex items-center gap-3 text-sm">
                            {b.type === 'shared' ? <Users className="w-4 h-4 text-purple-500" /> : <Wallet className="w-4 h-4 text-blue-500" />}
                            <span className="font-medium text-gray-900 dark:text-gray-100">{b.name}</span>
                            <span className="text-gray-500 dark:text-gray-400">{b.type === 'shared' ? 'Fellesøkonomi' : 'Privatøkonomi'}</span>
                        </div>
                    ))}
                    {budgets.length === 0 && <p className="py-2 text-sm text-gray-500">Ingen budsjetter ennå.</p>}
                </div>
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-3">Min Oversikt bruker alltid ditt private budsjett, Oppgjør alltid fellesbudsjettet. Budsjett- og Sparing-sidene har sin egen velger.</p>
            </div>

            <SectionHeading hint="hele husholdningen">Kategorier og budsjettposter</SectionHeading>
            <MigrationTool />
            <CategoryBudgetManager />

            <SectionHeading hint={personalBudget?.name}>Mitt budsjett</SectionHeading>
            {personalBudget
                ? <SalarySettings budget={personalBudget} />
                : <p className="text-sm text-gray-500 dark:text-gray-400">Ingen privat budsjett ennå.</p>}

            <SectionHeading shared hint={sharedBudget?.name}>Fellesbudsjett</SectionHeading>
            <PartnerSettings budget={sharedBudget} />

            <SectionHeading>Faresone</SectionHeading>
            <ResetTool />

            <CreateBudgetModal isOpen={isCreateOpen} onClose={() => setIsCreateOpen(false)} onCreate={createBudget} />
        </div>
    );
}
