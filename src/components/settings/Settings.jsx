import MigrationTool from './MigrationTool';
import CategoryBudgetManager from './CategoryBudgetManager';
import PartnerSettings from './PartnerSettings';
import ResetTool from './ResetTool';

/**
 * Innstillinger hub. Owner-level library + migration, plus the existing
 * shared-budget economic settings (PartnerSettings handles its own
 * shared-only gating).
 */
export default function Settings() {
    return (
        <div className="max-w-3xl mx-auto space-y-6">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Innstillinger</h1>
            <MigrationTool />
            <CategoryBudgetManager />
            <PartnerSettings />
            <ResetTool />
        </div>
    );
}
