import { useState } from 'react';
import { Landmark, CreditCard, Download } from 'lucide-react';
import { useBudget } from '../../contexts/BudgetContext';
import AccountGrid from './AccountGrid';
import AddAccountModal from './AddAccountModal';
import ImportAccountsModal from './ImportAccountsModal';
import ConfirmationModal from '../common/ConfirmationModal';

/**
 * Kontoer = account management (balances, sharing) for everything: bank
 * accounts on top, credit cards in their own section below since they fall
 * outside the SpareBank 1 sync. Transactions live on Transaksjoner, import on the
 * Import page.
 */
export default function Accounts() {
    const { activeBudget, accounts, loading, addAccount, updateAccount, deleteAccount } = useBudget();

    const [isAddModalOpen, setIsAddModalOpen] = useState(false);
    const [isImportOpen, setIsImportOpen] = useState(false);
    const [editingAccount, setEditingAccount] = useState(null);
    const [addDefaultType, setAddDefaultType] = useState(undefined);
    const [deleteConfirmation, setDeleteConfirmation] = useState({ isOpen: false, id: null });

    if (loading) return <div>Laster kontoer...</div>;
    if (!activeBudget) return <div>Ingen budsjett valgt.</div>;

    const bankAccounts = accounts.filter(a => a.type !== 'Kredittkort');
    const creditCards = accounts.filter(a => a.type === 'Kredittkort');

    const openAdd = (defaultType) => {
        setEditingAccount(null);
        setAddDefaultType(defaultType);
        setIsAddModalOpen(true);
    };

    const openEdit = (account) => {
        setEditingAccount(account);
        setAddDefaultType(undefined);
        setIsAddModalOpen(true);
    };

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
                        <p className="text-sm text-gray-500 dark:text-gray-400">Bankkontoer, sparing og kredittkort. Transaksjoner finner du under Transaksjoner.</p>
                    </div>
                </div>
                <button onClick={() => setIsImportOpen(true)} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 shadow-sm text-sm self-start md:self-auto">
                    <Download className="w-4 h-4" />
                    <span>Importer fra bank</span>
                </button>
            </div>

            <AccountGrid
                accounts={bankAccounts}
                onAdd={() => openAdd(undefined)}
                onEdit={openEdit}
                onDelete={(id) => setDeleteConfirmation({ isOpen: true, id })}
                addLabel="Legg til konto"
            />

            {/* Credit cards — kept visually apart: they are outside the bank sync */}
            <div className="pt-2 border-t border-gray-200 dark:border-gray-700 space-y-4">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-purple-50 dark:bg-purple-900/20 rounded-lg">
                        <CreditCard className="w-5 h-5 text-purple-600 dark:text-purple-400" />
                    </div>
                    <div>
                        <h2 className="text-lg font-bold text-gray-900 dark:text-white">Kredittkort</h2>
                        <p className="text-sm text-gray-500 dark:text-gray-400">Utenfor bank-synkroniseringen — transaksjoner importeres manuelt på Import-siden.</p>
                    </div>
                </div>
                <AccountGrid
                    accounts={creditCards}
                    onAdd={() => openAdd('Kredittkort')}
                    onEdit={openEdit}
                    onDelete={(id) => setDeleteConfirmation({ isOpen: true, id })}
                    addLabel="Legg til kredittkort"
                />
            </div>

            <AddAccountModal
                isOpen={isAddModalOpen}
                onClose={() => setIsAddModalOpen(false)}
                onSave={handleSaveAccount}
                accountToEdit={editingAccount}
                defaultType={addDefaultType}
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
