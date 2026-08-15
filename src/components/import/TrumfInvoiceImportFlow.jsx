import { useBudget } from '../../contexts/BudgetContext';
import { api } from '../../services/firebase';
import { invoiceRowsToImportRows } from '../../utils/trumfInvoice';
import TrumfInvoiceImportModal from './TrumfInvoiceImportModal';
import { matchRowsAgainstExisting } from './importPipeline';
import { useImportReview } from './useImportReview';

/**
 * Credit-card invoice import: the Trumf Kredittkort PDF is the only
 * transaction export for that card (TrumfPay purchases never reach Google
 * Wallet, so the companion app does not see them either). The PDF is parsed
 * client-side (utils/trumfInvoice.js) and the rows go through the same
 * duplicate review + reconciliation as a CSV import.
 *
 * Unlike CSV there is no month filter: the invoice defines its own period
 * (often spanning two months) and every row lands on its purchase date —
 * the duplicate check guards against importing the same invoice twice.
 */
export default function TrumfInvoiceImportFlow({ isOpen, onClose, accounts }) {
    const { transactions, updateTransaction, updateAccount } = useBudget();
    const { review, modals } = useImportReview();

    const handleImport = async (parsed, accountId) => {
        // Complete duplicate check across budgets, like the CSV flow
        let existing = [];
        try {
            existing = await api.queryCollection('transactions', 'accountId', accountId);
        } catch (fetchErr) {
            console.error('Error fetching existing transactions for duplicate check:', fetchErr);
            alert('Advarsel: Kunne ikke hente alle eksisterende transaksjoner. Duplikatsjekk kan være ufullstendig.');
            existing = transactions.filter(t => t.accountId === accountId);
        }

        const rows = invoiceRowsToImportRows(parsed, accountId);
        const matchResult = await matchRowsAgainstExisting({ rows, existing, updateTransaction });

        // Remember the latest invoice on the card: due date + amount lets the
        // bank-side payment be recognised as "Betaling kredittkortregning".
        const h = parsed.header;
        if (h.invoiceNumber || h.dueDate) {
            try {
                await updateAccount(accountId, {
                    lastInvoice: {
                        invoiceNumber: h.invoiceNumber || null,
                        invoiceDate: h.invoiceDate || null,
                        dueDate: h.dueDate || null,
                        totalDue: h.totalDue ?? null,
                        minimumPayment: h.minimumPayment ?? null,
                        kid: h.kid || null,
                        importedAt: new Date().toISOString(),
                    },
                });
            } catch (err) {
                // Non-fatal — the transactions are what matter
                console.warn('Could not store invoice header on account', err);
            }
        }

        // Parser warnings were already shown in the preview
        await review(matchResult);
    };

    return (
        <>
            <TrumfInvoiceImportModal
                isOpen={isOpen}
                onClose={onClose}
                onImport={handleImport}
                accounts={accounts}
            />
            {modals}
        </>
    );
}
