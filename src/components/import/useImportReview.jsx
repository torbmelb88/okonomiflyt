import { useState } from 'react';
import { useBudget } from '../../contexts/BudgetContext';
import DuplicateReviewModal from '../accounts/DuplicateReviewModal';
import ReconcileTransactionsModal from '../accounts/ReconcileTransactionsModal';

/**
 * The review tail shared by every manual import (CSV, invoice PDF): walk the
 * user through possible duplicates, save what survives, then open the
 * reconcile modal for the fresh rows. Sources only differ in how they parse
 * rows — everything after `matchRowsAgainstExisting` lives here.
 *
 * Usage:
 *   const { review, modals } = useImportReview();
 *   await review(matchResult, { skipped, skippedReport });
 *   return <>{...}{modals}</>;
 */
export function useImportReview() {
    const { addTransaction, updateTransaction } = useBudget();

    const [isReconcileModalOpen, setIsReconcileModalOpen] = useState(false);
    const [transactionsToReconcile, setTransactionsToReconcile] = useState([]);

    const [isDuplicateReviewOpen, setIsDuplicateReviewOpen] = useState(false);
    const [potentialDuplicates, setPotentialDuplicates] = useState([]);
    const [pendingImportTransactions, setPendingImportTransactions] = useState([]);
    const [importStats, setImportStats] = useState({ merged: 0, skipped: 0, skippedReport: [] });

    const finalizeImport = async (transactionsToSave, stats) => {
        let successCount = 0;
        const failureReasons = [];
        const finalNewTransactions = [];

        for (const t of transactionsToSave) {
            try {
                const transactionId = await addTransaction(t);
                finalNewTransactions.push({ ...t, id: transactionId });
                successCount++;
            } catch (err) {
                console.error('Error saving transaction:', t, err);
                failureReasons.push(`Feil ved lagring av ${t.name}: ${err.message}`);
            }
        }

        let msg = '';
        if (successCount > 0) msg += `Importerte ${successCount} nye transaksjoner. `;
        if (stats.merged > 0) msg += `Oppdaterte ${stats.merged} eksisterende med kommentarer. `;

        let skippedMsg = '';
        if (stats.skippedReport && stats.skippedReport.length > 0) {
            skippedMsg = '\n\nÅrsaker til at rader ble hoppet over:\n' +
                stats.skippedReport.slice(0, 5).join('\n') +
                (stats.skippedReport.length > 5 ? `\n...og ${stats.skippedReport.length - 5} til.` : '');
        }

        if (msg) {
            alert(msg + skippedMsg);
        } else if (failureReasons.length > 0) {
            alert('Noe gikk galt:\n' + failureReasons.join('\n'));
        } else {
            alert(`Ingen nye transaksjoner importert.${skippedMsg}`);
        }

        if (finalNewTransactions.length > 0) {
            setTransactionsToReconcile(finalNewTransactions);
            setIsReconcileModalOpen(true);
        }
    };

    const handleDuplicateReviewComplete = async (approvedActions) => {
        setIsDuplicateReviewOpen(false);
        setPotentialDuplicates([]);

        const imports = approvedActions.filter(a => a.action === 'import').map(a => a.new);
        const merges = approvedActions.filter(a => a.action === 'merge');

        let mergedCount = 0;
        for (const merge of merges) {
            try {
                // Merging onto a foreign-currency copy (companion app abroad):
                // the bank's NOK amount takes over, the foreign amount is kept
                // as originalAmount/-Currency and the currency flag cleared.
                const wasForeign = merge.existing.currency && merge.existing.currency !== 'NOK';
                await updateTransaction(merge.existing.id, {
                    date: merge.new.date,
                    amount: merge.new.amount,
                    name: merge.new.name,
                    // Bank match confirmed — avstemt if the row is also
                    // categorized; otherwise it still needs a budget item.
                    // The survivor takes over the bank row's identity, so it
                    // no longer counts as self-reported (companion app).
                    reconciled: !!(merge.existing.reconciled || merge.existing.budgetItemId),
                    source: null,
                    ...(wasForeign ? {
                        currency: null,
                        originalAmount: merge.existing.amount,
                        originalCurrency: merge.existing.currency,
                    } : {}),
                });
                mergedCount++;
            } catch (err) {
                console.error('Failed to merge transaction', err);
            }
        }

        await finalizeImport([...pendingImportTransactions, ...imports], {
            ...importStats,
            merged: importStats.merged + mergedCount,
        });
        setPendingImportTransactions([]);
    };

    /**
     * @param {{ newTransactions, potentialDuplicates, mergedCount }} matchResult
     *   — output of matchRowsAgainstExisting
     * @param {{ skipped?: number, skippedReport?: string[] }} stats
     */
    const review = async (matchResult, stats = {}) => {
        const baseStats = {
            merged: matchResult.mergedCount || 0,
            skipped: stats.skipped || 0,
            skippedReport: stats.skippedReport || [],
        };
        if (matchResult.potentialDuplicates.length > 0) {
            setImportStats(baseStats);
            setPendingImportTransactions(matchResult.newTransactions);
            setPotentialDuplicates(matchResult.potentialDuplicates);
            setIsDuplicateReviewOpen(true);
        } else {
            await finalizeImport(matchResult.newTransactions, baseStats);
        }
    };

    const modals = (
        <>
            <DuplicateReviewModal
                isOpen={isDuplicateReviewOpen}
                onClose={() => setIsDuplicateReviewOpen(false)}
                duplicates={potentialDuplicates}
                onComplete={handleDuplicateReviewComplete}
            />
            <ReconcileTransactionsModal
                isOpen={isReconcileModalOpen}
                onClose={() => setIsReconcileModalOpen(false)}
                transactions={transactionsToReconcile}
                onComplete={() => { setIsReconcileModalOpen(false); setTransactionsToReconcile([]); }}
            />
        </>
    );

    return { review, modals };
}
