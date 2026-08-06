import { useState } from 'react';
import { Landmark, Download } from 'lucide-react';
import { useBudget } from '../../contexts/BudgetContext';
import AccountGrid from './AccountGrid';
import AddAccountModal from './AddAccountModal';
import ImportAccountsModal from './ImportAccountsModal';
import ConfirmationModal from '../common/ConfirmationModal';

/**
 * Kontoer = bank account management (balances, sharing). Credit cards live on
 * their own page; transactions + import + reconcile live on Forbruk. This page
 * is the home for the upcoming SpareBank 1 sync status.
 */
export default function Accounts() {
    const { activeBudget, accounts, loading, addAccount, updateAccount, deleteAccount } = useBudget();

    const [isAddModalOpen, setIsAddModalOpen] = useState(false);
    const [isImportOpen, setIsImportOpen] = useState(false);
    const [editingAccount, setEditingAccount] = useState(null);
    const [deleteConfirmation, setDeleteConfirmation] = useState({ isOpen: false, id: null });

    if (loading) return <div>Laster kontoer...</div>;
    if (!activeBudget) return <div>Ingen budsjett valgt.</div>;

    const bankAccounts = accounts.filter(a => a.type !== 'Kredittkort');

    const handleSaveAccount = async (data) => {
        if (editingAccount) await updateAccount(editingAccount.id, data);
        else await addAccount(data);
    };

    const confirmDelete = async () => {
        if (!deleteConfirmation.id) return;
        try {
            await deleteAccount(deleteConfirmation.id);
        } catch (err) {
            console.error('Delete failed:', err);
            alert('Kunne ikke slette: ' + err.message);
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                        <Landmark className="w-6 h-6 text-blue-600 dark:text-blue-400" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Kontoer</h1>
                        <p className="text-sm text-gray-500 dark:text-gray-400">Bankkontoer og sparing. Transaksjoner finner du under Forbruk.</p>
                    </div>
                </div>
                <button onClick={() => setIsImportOpen(true)} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 shadow-sm text-sm self-start md:self-auto">
                    <Download className="w-4 h-4" />
                    <span>Importer fra bank</span>
                </button>
            </div>

            <AccountGrid
                accounts={bankAccounts}
                onAdd={() => { setEditingAccount(null); setIsAddModalOpen(true); }}
                onEdit={(account) => { setEditingAccount(account); setIsAddModalOpen(true); }}
                onDelete={(id) => setDeleteConfirmation({ isOpen: true, id })}
                addLabel="Legg til konto"
            />

            <AddAccountModal
                isOpen={isAddModalOpen}
                onClose={() => setIsAddModalOpen(false)}
                onSave={handleSaveAccount}
                accountToEdit={editingAccount}
            />
            <ImportAccountsModal isOpen={isImportOpen} onClose={() => setIsImportOpen(false)} />
            <ConfirmationModal
                isOpen={deleteConfirmation.isOpen}
                onClose={() => setDeleteConfirmation({ isOpen: false, id: null })}
                onConfirm={confirmDelete}
                title="Slett konto"
                message="Er du sikker på at du vil slette denne kontoen? Alle tilhørende transaksjoner vil også bli slettet."
                confirmText="Slett"
                isDangerous={true}
            />
        </div>
    );
}
