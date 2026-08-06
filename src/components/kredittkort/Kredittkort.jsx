import { useState, useMemo } from 'react';
import { CreditCard } from 'lucide-react';
import { useBudget } from '../../contexts/BudgetContext';
import AccountGrid from '../accounts/AccountGrid';
import AddAccountModal from '../accounts/AddAccountModal';
import ConfirmationModal from '../common/ConfirmationModal';
import TransactionsPanel from '../transactions/TransactionsPanel';

/**
 * Kredittkort = the manual source. Credit cards fall outside the SpareBank 1
 * API, so transactions are still imported by CSV. Own page to keep this source
 * cleanly separated from the bank flow on Forbruk/Kontoer.
 */
export default function Kredittkort() {
    const { activeBudget, accounts, loading, addAccount, updateAccount, deleteAccount } = useBudget();

    const [isAddModalOpen, setIsAddModalOpen] = useState(false);
    const [editingAccount, setEditingAccount] = useState(null);
    const [deleteConfirmation, setDeleteConfirmation] = useState({ isOpen: false, id: null });

    const [selectedMonth, setSelectedMonth] = useState(() => {
        const now = new Date();
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    });

    const creditCards = accounts.filter(a => a.type === 'Kredittkort');
    const creditCardIds = useMemo(() => new Set(creditCards.map(a => a.id)), [creditCards]);
    const creditTxFilter = (t) => creditCardIds.has(t.accountId);

    if (loading) return <div>Laster kredittkort...</div>;
    if (!activeBudget) return <div>Ingen budsjett valgt.</div>;

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
            <div className="flex items-center gap-3">
                <div className="p-2 bg-purple-50 dark:bg-purple-900/20 rounded-lg">
                    <CreditCard className="w-6 h-6 text-purple-600 dark:text-purple-400" />
                </div>
                <div>
                    <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Kredittkort</h1>
                    <p className="text-sm text-gray-500 dark:text-gray-400">Manuell import — faller utenfor bank-synkroniseringen.</p>
                </div>
            </div>

            <AccountGrid
                accounts={creditCards}
                onAdd={() => { setEditingAccount(null); setIsAddModalOpen(true); }}
                onEdit={(account) => { setEditingAccount(account); setIsAddModalOpen(true); }}
                onDelete={(id) => setDeleteConfirmation({ isOpen: true, id })}
                addLabel="Legg til kredittkort"
            />

            {creditCards.length > 0 ? (
                <TransactionsPanel
                    accounts={creditCards}
                    selectedMonth={selectedMonth}
                    setSelectedMonth={setSelectedMonth}
                    transactionFilter={creditTxFilter}
                    summaryMode="creditCard"
                />
            ) : (
                <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 px-6 py-10 text-center text-gray-500 dark:text-gray-400">
                    Legg til et kredittkort for å importere transaksjoner.
                </div>
            )}

            <AddAccountModal
                isOpen={isAddModalOpen}
                onClose={() => setIsAddModalOpen(false)}
                onSave={handleSaveAccount}
                accountToEdit={editingAccount}
                defaultType="Kredittkort"
            />
            <ConfirmationModal
                isOpen={deleteConfirmation.isOpen}
                onClose={() => setDeleteConfirmation({ isOpen: false, id: null })}
                onConfirm={confirmDelete}
                title="Slett kredittkort"
                message="Er du sikker på at du vil slette dette kredittkortet? Alle tilhørende transaksjoner vil også bli slettet."
                confirmText="Slett"
                isDangerous={true}
            />
        </div>
    );
}
