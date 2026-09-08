import { createContext, useContext, useState, useEffect, useMemo } from 'react';
import { api } from '../services/firebase';
import { useAuth } from './AuthContext';
import { isSelfReported, reconcilesOnLink } from '../utils/reconciliation';
import { coverLinkIds, isCoveredExpense } from '../utils/coverage';

const BudgetContext = createContext();

// eslint-disable-next-line react-refresh/only-export-components
export function useBudget() {
    return useContext(BudgetContext);
}

export function BudgetProvider({ children }) {
    const { currentUser } = useAuth();
    const [budgets, setBudgets] = useState([]);
    const [activeBudgetId, setActiveBudgetId] = useState(null);
    const [activeBudget, setActiveBudget] = useState(null);

    // Data associated with active budget
    const [accounts, setAccounts] = useState([]);
    const [expenses, setExpenses] = useState([]);
    const [transactions, setTransactions] = useState([]); // Moved to top
    const [monthlyBudgets, setMonthlyBudgets] = useState([]);
    const [monthStatuses, setMonthStatuses] = useState([]);
    const [loading, setLoading] = useState(true);

    // Global projects (cross-budget)
    const [projects, setProjects] = useState([]);

    // Receipts logged by the companion app. Loaded for all budgets since
    // unmatched receipts have no budgetId yet. Line items load lazily.
    const [receipts, setReceipts] = useState([]);
    const [receiptItemsCache, setReceiptItemsCache] = useState(null);

    // Load budgets on mount/user change
    useEffect(() => {
        if (!currentUser) {
            setBudgets([]);
            setActiveBudgetId(null);
            setLoading(false);
            return;
        }

        const loadBudgets = async () => {
            try {
                const allBudgets = await api.getCollection('budgets');
                setBudgets(allBudgets);

                if (allBudgets.length > 0) {
                    setActiveBudgetId(prev => prev || allBudgets[0].id);
                }
            } catch (error) {
                console.error("Failed to load budgets", error);
            } finally {
                setLoading(false);
            }
        };

        loadBudgets();
    }, [currentUser]);

    // Load budget-specific data when activeBudgetId changes
    useEffect(() => {
        if (!activeBudgetId) {
            setActiveBudget(null);
            setAccounts([]);
            setExpenses([]);
            setTransactions([]); // Reset transactions
            setMonthlyBudgets([]);
            setMonthStatuses([]);
            return;
        }

        const loadBudgetData = async () => {
            setLoading(true);
            try {
                const budget = budgets.find(b => b.id === activeBudgetId);
                setActiveBudget(budget || null);

                // Fetch all budget-scoped collections in parallel
                const [allAccounts, allExpenses, allMonthlyBudgets, allMonthStatuses] = await Promise.all([
                    api.getCollection('accounts'),
                    api.getCollection('expenses'),
                    api.getCollection('monthlyBudgets'),
                    api.getCollection('monthStatuses')
                ]);

                // Accounts are global (not tied to a budget). Each transaction
                // carries its own budgetId, defaulting to the account's
                // defaultBudgetId and overridable at reconciliation.
                setAccounts(allAccounts);

                const budgetExpenses = allExpenses.filter(e => e.budgetId === activeBudgetId);
                setExpenses(budgetExpenses);

                setMonthlyBudgets(allMonthlyBudgets.filter(mb => mb.budgetId === activeBudgetId));
                setMonthStatuses(allMonthStatuses.filter(ms => ms.budgetId === activeBudgetId));

            } catch (error) {
                console.error("Failed to load budget data", error);
            } finally {
                setLoading(false);
            }
        };

        loadBudgetData();
    }, [activeBudgetId, budgets, currentUser]);

    const switchBudget = (budgetId) => {
        setActiveBudgetId(budgetId);
    };

    const createBudget = async (name, type) => {
        if (!currentUser) return;

        try {
            const newBudget = {
                name,
                type,
                ownerId: currentUser.uid,
                members: [
                    {
                        uid: currentUser.uid,
                        role: 'owner',
                        name: currentUser.displayName || 'Meg',
                        income: 0
                    }
                ],
                createdAt: new Date().toISOString()
            };

            const docRef = await api.addDocument('budgets', newBudget);
            const createdBudget = { id: docRef.id, ...newBudget };

            setBudgets(prev => [...prev, createdBudget]);
            setActiveBudgetId(createdBudget.id);

            return createdBudget;
        } catch (error) {
            console.error("Error creating budget:", error);
            throw error;
        }
    };

    const updateBudget = async (id, data) => {
        if (!activeBudgetId) return;
        try {
            await api.updateDocument('budgets', id, data);
            setBudgets(prev => prev.map(b =>
                b.id === id ? { ...b, ...data } : b
            ));
            if (activeBudget && activeBudget.id === id) {
                setActiveBudget(prev => ({ ...prev, ...data }));
            }
        } catch (error) {
            console.error("Error updating budget:", error);
            throw error;
        }
    };

    // Accounts are global (owner-scoped). The chosen budget is stored as
    // defaultBudgetId on the account, not as membership.
    const addAccount = async (accountData) => {
        if (!currentUser) return;
        try {
            const newAccount = {
                ...accountData,
                ownerId: currentUser.uid,
                createdAt: new Date().toISOString()
            };
            const docRef = await api.addDocument('accounts', newAccount);
            const created = { id: docRef.id, ...newAccount };
            setAccounts(prev => [...prev, created]);
            return created;
        } catch (error) {
            console.error("Error adding account:", error);
            throw error;
        }
    };

    const updateAccount = async (id, accountData) => {
        if (!activeBudgetId) return;
        try {
            await api.updateDocument('accounts', id, accountData);
            setAccounts(prev => prev.map(acc =>
                acc.id === id ? { ...acc, ...accountData } : acc
            ));
        } catch (error) {
            console.error("Error updating account:", error);
            throw error;
        }
    };

    const deleteAccount = async (id) => {
        if (!activeBudgetId) return;
        try {
            await api.deleteDocument('accounts', id);
            setAccounts(prev => prev.filter(acc => acc.id !== id));
        } catch (error) {
            console.error("Error deleting account:", error);
            throw error;
        }
    };

    const addExpense = async (expenseData) => {
        if (!activeBudgetId) return;
        try {
            let monthlyAmount = expenseData.amount;
            if (expenseData.frequency === 'yearly') {
                monthlyAmount = expenseData.amount / 12;
            }

            const newExpense = {
                ...expenseData,
                budgetId: activeBudgetId,
                monthlyAmount: monthlyAmount,
                createdAt: new Date().toISOString()
            };

            const docRef = await api.addDocument('expenses', newExpense);
            setExpenses(prev => [...prev, { id: docRef.id, ...newExpense }]);
            return docRef;
        } catch (error) {
            console.error("Error adding expense:", error);
            throw error;
        }
    };

    const updateExpense = async (id, expenseData) => {
        if (!activeBudgetId) return;
        try {
            let monthlyAmount = expenseData.amount;
            if (expenseData.frequency === 'yearly') {
                monthlyAmount = expenseData.amount / 12;
            }

            const updatedExpense = {
                ...expenseData,
                monthlyAmount: monthlyAmount
            };

            await api.updateDocument('expenses', id, updatedExpense);

            setExpenses(prev => prev.map(exp =>
                exp.id === id ? { ...exp, ...updatedExpense } : exp
            ));
        } catch (error) {
            console.error("Error updating expense:", error);
            throw error;
        }
    };

    const deleteExpense = async (id) => {
        if (!activeBudgetId) return;
        try {
            await api.deleteDocument('expenses', id);
            setExpenses(prev => prev.filter(exp => exp.id !== id));
        } catch (error) {
            console.error("Error deleting expense:", error);
            throw error;
        }
    };

    // --- Transactions Logic ---

    // Load transactions when active budget changes
    useEffect(() => {
        if (!activeBudgetId) {
            setTransactions([]);
            return;
        }

        const loadTransactions = async () => {
            try {
                const allTransactions = await api.getCollection('transactions');
                const budgetTransactions = allTransactions.filter(t => t.budgetId === activeBudgetId);
                setTransactions(budgetTransactions);
            } catch (error) {
                console.error("Failed to load transactions", error);
            }
        };

        loadTransactions();
    }, [activeBudgetId]);

    const addTransaction = async (transactionData) => {
        if (!activeBudgetId) return;
        try {
            // Land the transaction in its account's default budget (overridable
            // at reconciliation), falling back to the active budget. Mirrors the
            // SB1 routing so CSV imports behave the same way.
            const account = transactionData.accountId ? accounts.find(a => a.id === transactionData.accountId) : null;
            const budgetId = transactionData.budgetId || account?.defaultBudgetId || account?.budgetId || activeBudgetId;
            const newTransaction = {
                ...transactionData,
                budgetId,
                reconciled: false,
                createdAt: new Date().toISOString()
            };
            const docRef = await api.addDocument('transactions', newTransaction);
            if (budgetId === activeBudgetId) {
                setTransactions(prev => [...prev, { id: docRef.id, ...newTransaction }]);
            }
            return docRef.id;
        } catch (error) {
            console.error("Error adding transaction:", error);
            throw error;
        }
    };

    const updateTransaction = async (id, transactionData) => {
        if (!activeBudgetId) return;
        try {
            await api.updateDocument('transactions', id, transactionData);
            setTransactions(prev => prev.map(t =>
                t.id === id ? { ...t, ...transactionData } : t
            ));
        } catch (error) {
            console.error("Error updating transaction:", error);
            throw error;
        }
    };

    const deleteTransaction = async (id) => {
        if (!activeBudgetId) return;
        try {
            // A split refund's children only exist because of the parent.
            const children = transactions.filter(t => t.refundParentId === id);
            await Promise.all(children.map(c => api.deleteDocument('transactions', c.id)));
            // Expenses this income covered lose the link — and so show
            // «dekning mangler» until a replacement payment is linked.
            const covered = transactions.filter(t => coverLinkIds(t).includes(id));
            const strip = (t) => ({ coveredByTransactionIds: coverLinkIds(t).filter(x => x !== id) });
            await Promise.all(covered.map(t => api.updateDocument('transactions', t.id, strip(t))));
            await api.deleteDocument('transactions', id);
            setTransactions(prev => prev
                .filter(t => t.id !== id && t.refundParentId !== id)
                .map(t => coverLinkIds(t).includes(id) ? { ...t, ...strip(t) } : t));
        } catch (error) {
            console.error("Error deleting transaction:", error);
            throw error;
        }
    };

    const deleteTransactions = async (ids) => {
        if (!activeBudgetId || !ids || ids.length === 0) return;
        try {
            await Promise.all(ids.map(id => api.deleteDocument('transactions', id)));
            setTransactions(prev => prev.filter(t => !ids.includes(t.id)));
        } catch (error) {
            console.error("Error deleting transactions:", error);
            throw error;
        }
    };

    // Merges a manually found duplicate pair. `keep` survives with its own
    // name/date/amount untouched (so the next import still recognizes it) and
    // fills gaps in its reconciliation metadata from `remove`, which is deleted
    // after references (receipt, credit notes) are re-pointed at the survivor.
    const mergeTransactions = async (keepId, removeId) => {
        const keep = transactions.find(t => t.id === keepId);
        const remove = transactions.find(t => t.id === removeId);
        if (!keep || !remove) throw new Error('Fant ikke begge transaksjonene');
        const prefer = (field) => keep[field] ?? remove[field] ?? null;
        const patch = {
            budgetItemId: prefer('budgetItemId'),
            category: keep.category || remove.category || null,
            comment: keep.comment || remove.comment || null,
            projectId: prefer('projectId'),
            projectSubcategory: prefer('projectSubcategory'),
            receiptId: prefer('receiptId'),
            isUnnecessary: !!(keep.isUnnecessary || remove.isUnnecessary),
            excludeFromSharedCalc: !!(keep.excludeFromSharedCalc || remove.excludeFromSharedCalc),
            coveredByAccountId: prefer('coveredByAccountId'),
            paidPrivatelyBy: prefer('paidPrivatelyBy'),
            payer: prefer('payer'),
            isRefund: !!(keep.isRefund || remove.isRefund),
            refundOfTransactionId: prefer('refundOfTransactionId'),
            // A purchase logged as «refunderes» must keep waiting after the
            // bank copy merges into it.
            awaitingRefund: !!(keep.awaitingRefund || remove.awaitingRefund),
            expectedRefundAmount: prefer('expectedRefundAmount'),
            // Pass-through links survive the merge from either side
            coveredByIncoming: !!(keep.coveredByIncoming || remove.coveredByIncoming),
            coveredByTransactionIds: [...new Set([...coverLinkIds(keep), ...coverLinkIds(remove)])],
            reconciledByCover: !!(keep.reconciledByCover || remove.reconciledByCover),
            // The pair was matched against the bank, so the survivor carries
            // the bank-side identity (externalId/source) even when the kept
            // copy is the self-reported one — the next import then recognizes
            // it, and the row no longer counts as awaiting a bank match.
            externalId: prefer('externalId'),
            source: (isSelfReported(keep) && !isSelfReported(remove) ? remove.source : keep.source) ?? null,
            // Merging a self-reported copy (companion app/MCP) with the bank's
            // copy IS the bank match — that is what makes the pair avstemt,
            // provided the purchase is also categorized.
            reconciled: !!(keep.reconciled || remove.reconciled ||
                (isSelfReported(keep) !== isSelfReported(remove) && (keep.budgetItemId || remove.budgetItemId))),
            // Foreign purchase merged into the bank's converted NOK copy: the
            // survivor keeps the NOK amount, but remember what was paid abroad.
            // Deliberately NOT copying `currency` itself — that would mislabel
            // the survivor's NOK amount as foreign.
            originalAmount: keep.originalAmount ?? (remove.currency && remove.currency !== 'NOK' ? remove.amount : null),
            originalCurrency: keep.originalCurrency ?? (remove.currency && remove.currency !== 'NOK' ? remove.currency : null),
        };
        await api.updateDocument('transactions', keepId, patch);
        if (remove.receiptId) {
            // Point the receipt at the survivor instead of the doomed copy
            const receiptPatch = keep.receiptId && keep.receiptId !== remove.receiptId
                ? { transactionId: null, status: 'unmatched' }
                : { transactionId: keepId };
            try {
                await api.updateDocument('receipts', remove.receiptId, receiptPatch);
                setReceipts(prev => prev.map(r => r.id === remove.receiptId ? { ...r, ...receiptPatch } : r));
            } catch (error) {
                console.warn('Could not re-point receipt during merge', error);
            }
        }
        const refundsAtRemoved = transactions.filter(t => t.refundOfTransactionId === removeId);
        await Promise.all(refundsAtRemoved.map(r => api.updateDocument('transactions', r.id, { refundOfTransactionId: keepId })));
        // Expenses covered by the doomed income now point at the survivor
        const repoint = (ids) => [...new Set(ids.map(id => id === removeId ? keepId : id))];
        const coveredByRemoved = transactions.filter(t => t.id !== keepId && coverLinkIds(t).includes(removeId));
        await Promise.all(coveredByRemoved.map(t => api.updateDocument('transactions', t.id, { coveredByTransactionIds: repoint(coverLinkIds(t)) })));
        await api.deleteDocument('transactions', removeId);
        setTransactions(prev => prev
            .filter(t => t.id !== removeId)
            .map(t => {
                if (t.id === keepId) return { ...t, ...patch };
                if (t.refundOfTransactionId === removeId) t = { ...t, refundOfTransactionId: keepId };
                if (coverLinkIds(t).includes(removeId)) t = { ...t, coveredByTransactionIds: repoint(coverLinkIds(t)) };
                return t;
            }));
    };

    // Registers `incomeId` as a refund of `originalId` (see utils/refunds.js).
    // The refund inherits the original's budget placement and split flags so
    // the two net out everywhere the original counted. `complete` clears the
    // original's awaitingRefund flag — always the user's explicit call, never
    // inferred from amounts: a partner may pay back less (or more) than
    // expected, and several people may refund one purchase.
    const linkRefund = async (incomeId, originalId, { complete = false, comment } = {}) => {
        const income = transactions.find(t => t.id === incomeId);
        const original = transactions.find(t => t.id === originalId);
        if (!income || !original) throw new Error('Fant ikke begge transaksjonene');
        const patch = {
            reconciled: reconcilesOnLink(income),
            isRefund: true,
            refundOfTransactionId: original.id,
            budgetId: original.budgetId || income.budgetId,
            budgetItemId: original.budgetItemId || null,
            category: original.category || 'Retur',
            projectId: original.projectId || null,
            projectSubcategory: original.projectSubcategory || null,
            payer: original.payer || null,
            paidPrivatelyBy: original.paidPrivatelyBy || null,
            excludeFromSharedCalc: !!original.excludeFromSharedCalc,
            coveredByAccountId: original.coveredByAccountId || null,
            ...(comment !== undefined && { comment }),
        };
        await api.updateDocument('transactions', incomeId, patch);
        const closeOriginal = complete && !!original.awaitingRefund;
        if (closeOriginal) await api.updateDocument('transactions', originalId, { awaitingRefund: false });
        setTransactions(prev => prev.map(t => t.id === incomeId
            ? { ...t, ...patch }
            : (closeOriginal && t.id === originalId ? { ...t, awaitingRefund: false } : t)));
    };

    // One payment covering several purchases (see utils/refunds.js): the bank
    // row becomes a «fordelt» parent kept out of every sum, plus one child
    // refund row per purchase carrying the allocated amount and the purchase's
    // budget placement. Allocations must add up to the payment.
    const linkRefundSplit = async (incomeId, allocs) => {
        const income = transactions.find(t => t.id === incomeId);
        if (!income) throw new Error('Fant ikke innbetalingen');
        const total = allocs.reduce((s, a) => s + (a.amount || 0), 0);
        if (Math.abs(total - income.amount) > 0.01) throw new Error('Fordelingen må summere til innbetalingen');
        const children = [];
        const closed = new Set();
        for (const a of allocs) {
            const original = transactions.find(t => t.id === a.transactionId);
            if (!original) throw new Error('Fant ikke kjøpet');
            const child = {
                date: income.date,
                month: income.month,
                name: income.name,
                amount: Math.round(a.amount * 100) / 100,
                type: 'income',
                accountId: income.accountId,
                budgetId: original.budgetId || income.budgetId,
                budgetItemId: original.budgetItemId || null,
                category: original.category || 'Retur',
                projectId: original.projectId || null,
                projectSubcategory: original.projectSubcategory || null,
                payer: original.payer || null,
                paidPrivatelyBy: original.paidPrivatelyBy || null,
                excludeFromSharedCalc: !!original.excludeFromSharedCalc,
                coveredByAccountId: original.coveredByAccountId || null,
                isRefund: true,
                refundOfTransactionId: original.id,
                refundParentId: income.id,
                source: 'refund-split',
                reconciled: true,
                createdAt: new Date().toISOString(),
            };
            const ref = await api.addDocument('transactions', child);
            children.push({ id: ref.id, ...child });
            if (a.complete && original.awaitingRefund) {
                await api.updateDocument('transactions', original.id, { awaitingRefund: false });
                closed.add(original.id);
            }
        }
        const parentPatch = {
            isRefund: true, refundSplit: true, refundOfTransactionId: null, budgetItemId: null,
            category: 'Retur (fordelt)', reconciled: reconcilesOnLink(income),
        };
        await api.updateDocument('transactions', incomeId, parentPatch);
        setTransactions(prev => [
            ...prev.map(t => t.id === incomeId ? { ...t, ...parentPatch } : (closed.has(t.id) ? { ...t, awaitingRefund: false } : t)),
            ...children.filter(c => c.budgetId === activeBudgetId),
        ]);
    };

    // Undoes a refund link. Given a child of a split, the whole split is undone
    // (children deleted). The income row goes back to «uavstemt» so it gets
    // categorized properly; the purchases' awaitingRefund flags are left as-is.
    const unlinkRefund = async (id) => {
        const row = transactions.find(t => t.id === id);
        const parent = row?.refundParentId ? transactions.find(t => t.id === row.refundParentId) : row;
        if (!parent) throw new Error('Fant ikke innbetalingen');
        const children = transactions.filter(t => t.refundParentId === parent.id);
        await Promise.all(children.map(c => api.deleteDocument('transactions', c.id)));
        const patch = { isRefund: false, refundSplit: false, refundOfTransactionId: null, budgetItemId: null, reconciled: false };
        await api.updateDocument('transactions', parent.id, patch);
        setTransactions(prev => prev
            .filter(t => t.refundParentId !== parent.id)
            .map(t => t.id === parent.id ? { ...t, ...patch } : t));
    };

    // --- Pass-through money («dekkes av innbetaling», see utils/coverage.js) ---

    // Applies one patch per id and mirrors it into local state.
    const applyPatches = async (patches) => {
        const entries = Object.entries(patches).filter(([, p]) => p && Object.keys(p).length > 0);
        await Promise.all(entries.map(([id, p]) => api.updateDocument('transactions', id, p)));
        setTransactions(prev => prev.map(t => patches[t.id] ? { ...t, ...patches[t.id] } : t));
    };

    // An income that stops covering anything goes back to «uavstemt» — but
    // only if it was this link that reconciled it in the first place.
    const releaseIncomePatch = (income, expensesAfter) => {
        if (!income?.reconciledByCover) return null;
        const stillCovering = expensesAfter.some(e => isCoveredExpense(e) && coverLinkIds(e).includes(income.id));
        return stillCovering ? null : { reconciled: false, reconciledByCover: null };
    };

    // Flags an outgoing transfer as funded by incoming money. Turning it off
    // drops every link, so the flag and the links never disagree.
    const setCoveredByIncoming = async (expenseId, flag) => {
        const expense = transactions.find(t => t.id === expenseId);
        if (!expense) throw new Error('Fant ikke transaksjonen');
        const patches = { [expenseId]: { coveredByIncoming: !!flag, coveredByTransactionIds: flag ? coverLinkIds(expense) : [] } };
        if (!flag) {
            const after = transactions.map(t => t.id === expenseId ? { ...t, ...patches[expenseId] } : t);
            for (const id of coverLinkIds(expense)) {
                const release = releaseIncomePatch(transactions.find(t => t.id === id), after);
                if (release) patches[id] = release;
            }
        }
        await applyPatches(patches);
    };

    // Links an income as (part of) the cover for an expense. The income
    // counts as handled by the link — a bank row needs nothing more.
    const linkCover = async (expenseId, incomeId) => {
        const expense = transactions.find(t => t.id === expenseId);
        const income = transactions.find(t => t.id === incomeId);
        if (!expense || !income) throw new Error('Fant ikke begge transaksjonene');
        if (income.type !== 'income' || expense.type === 'income') throw new Error('Dekning går fra en innbetaling til en utbetaling');
        const ids = coverLinkIds(expense);
        const patches = {
            [expenseId]: { coveredByIncoming: true, coveredByTransactionIds: ids.includes(incomeId) ? ids : [...ids, incomeId] },
        };
        if (!income.reconciled && reconcilesOnLink(income)) patches[incomeId] = { reconciled: true, reconciledByCover: true };
        await applyPatches(patches);
    };

    // Removes one link; the expense stays flagged (and so shows «dekning
    // mangler» until another income is linked or the flag is cleared).
    const unlinkCover = async (expenseId, incomeId) => {
        const expense = transactions.find(t => t.id === expenseId);
        if (!expense) throw new Error('Fant ikke transaksjonen');
        const patches = { [expenseId]: { coveredByTransactionIds: coverLinkIds(expense).filter(id => id !== incomeId) } };
        const after = transactions.map(t => t.id === expenseId ? { ...t, ...patches[expenseId] } : t);
        const release = releaseIncomePatch(transactions.find(t => t.id === incomeId), after);
        if (release) patches[incomeId] = release;
        await applyPatches(patches);
    };

    // --- Receipts (grocery line items from the companion app) ---

    // Load receipts on login (cheap collection — one doc per receipt)
    useEffect(() => {
        if (!currentUser) {
            setReceipts([]);
            setReceiptItemsCache(null);
            return;
        }
        const loadReceipts = async () => {
            try {
                setReceipts(await api.getCollection('receipts'));
            } catch (error) {
                console.error("Failed to load receipts", error);
            }
        };
        loadReceipts();
    }, [currentUser]);

    // Line items are fetched once on first use and cached for the session
    const ensureReceiptItems = async () => {
        if (receiptItemsCache !== null) return receiptItemsCache;
        const cache = await api.getCollection('receiptItems');
        setReceiptItemsCache(cache);
        return cache;
    };

    const getReceiptItems = async (receiptId) => {
        const cache = await ensureReceiptItems();
        return cache.filter(item => item.receiptId === receiptId);
    };

    // All line items across receipts — used by the groceries insights page
    const getAllReceiptItems = () => ensureReceiptItems();

    // Deletes a receipt with its line items and clears the back-reference on
    // a linked transaction
    const deleteReceipt = async (receipt) => {
        try {
            const cache = await ensureReceiptItems();
            const itemsToDelete = cache.filter(item => item.receiptId === receipt.id);
            await Promise.all([
                api.deleteDocument('receipts', receipt.id),
                ...itemsToDelete.map(item => api.deleteDocument('receiptItems', item.id))
            ]);
            if (receipt.transactionId) {
                try {
                    await api.updateDocument('transactions', receipt.transactionId, { receiptId: null });
                    setTransactions(prev => prev.map(t => t.id === receipt.transactionId
                        ? { ...t, receiptId: null }
                        : t
                    ));
                } catch (error) {
                    // The transaction may have been deleted — the receipt removal still succeeded
                    console.warn("Could not clear receiptId on transaction", error);
                }
            }
            setReceipts(prev => prev.filter(r => r.id !== receipt.id));
            setReceiptItemsCache(prev => prev === null ? prev : prev.filter(item => item.receiptId !== receipt.id));
        } catch (error) {
            console.error("Error deleting receipt:", error);
            throw error;
        }
    };

    // Links an unmatched receipt to a transaction (both directions, like the
    // companion app does on auto-match)
    const linkReceiptToTransaction = async (receiptId, transaction) => {
        try {
            await api.updateDocument('receipts', receiptId, {
                transactionId: transaction.id,
                budgetId: transaction.budgetId || activeBudgetId,
                status: 'matched'
            });
            await api.updateDocument('transactions', transaction.id, { receiptId });
            setReceipts(prev => prev.map(r => r.id === receiptId
                ? { ...r, transactionId: transaction.id, budgetId: transaction.budgetId || activeBudgetId, status: 'matched' }
                : r
            ));
            setTransactions(prev => prev.map(t => t.id === transaction.id
                ? { ...t, receiptId }
                : t
            ));
        } catch (error) {
            console.error("Error linking receipt to transaction:", error);
            throw error;
        }
    };

    const linkTransactionToBudgetItem = async (transactionId, budgetItemId) => {
        try {
            const transaction = transactions.find(t => t.id === transactionId);
            await updateTransaction(transactionId, {
                budgetItemId,
                // Bank rows are reconciled by categorizing them; self-reported
                // and foreign-currency rows stay "bokført" until the bank copy
                // arrives via import.
                reconciled: !!transaction && reconcilesOnLink(transaction)
            });
        } catch (error) {
            console.error("Error linking transaction:", error);
            throw error;
        }
    };

    const createBudgetItemFromTransaction = async (transaction, budgetItemData, projectId = null) => {
        try {
            // 1. Create the budget item (expense)
            const expenseData = {
                ...budgetItemData,
                amount: 0, // Default to 0 as requested (manual first)
                date: transaction.date,
                month: transaction.month // Ensure month is passed
            };

            let monthlyAmount = expenseData.amount;
            if (expenseData.frequency === 'yearly') {
                monthlyAmount = expenseData.amount / 12;
            }

            const newExpense = {
                ...expenseData,
                budgetId: activeBudgetId,
                monthlyAmount: monthlyAmount,
                createdAt: new Date().toISOString()
            };

            const docRef = await api.addDocument('expenses', newExpense);
            const newExpenseWithId = { id: docRef.id, ...newExpense };
            setExpenses(prev => [...prev, newExpenseWithId]);

            // 2. Link transaction to new budget item
            await updateTransaction(transaction.id, {
                budgetItemId: docRef.id,
                reconciled: reconcilesOnLink(transaction),
                isUnnecessary: !!budgetItemData.isUnnecessary,
                projectId: projectId || null
            });

            return newExpenseWithId;
        } catch (error) {
            console.error("Error creating budget item from transaction:", error);
            throw error;
        }
    };
    // Categories State
    const [categories, setCategories] = useState([]);

    // Fetch categories
    useEffect(() => {
        if (!currentUser) {
            setCategories([]);
            return;
        }

        const fetchCategories = async () => {
            try {
                const allCats = await api.getCollection('categories');
                // Filter categories for current user
                const userCats = allCats.filter(c => c.userId === currentUser.uid);

                setCategories(userCats);
            } catch (error) {
                console.error("Error fetching categories:", error);
            }
        };

        fetchCategories();
    }, [currentUser]);

    const addCategory = async (name) => {
        if (!currentUser) return;
        try {
            const docRef = await api.addDocument('categories', { name, userId: currentUser.uid });
            const newCat = { id: docRef.id, name, userId: currentUser.uid };
            setCategories(prev => [...prev, newCat]);
            return newCat;
        } catch (error) {
            console.error("Error adding category:", error);
            throw error;
        }
    };

    const updateCategory = async (id, data) => {
        // Accept a plain string (legacy rename) or a partial-object patch.
        const patch = typeof data === 'string' ? { name: data } : data;
        try {
            await api.updateDocument('categories', id, patch);
            setCategories(prev => prev.map(c => c.id === id ? { ...c, ...patch } : c));
        } catch (error) {
            console.error("Error updating category:", error);
            throw error;
        }
    };

    const deleteCategory = async (id) => {
        try {
            await api.deleteDocument('categories', id);
            setCategories(prev => prev.filter(c => c.id !== id));
        } catch (error) {
            console.error("Error deleting category:", error);
            throw error;
        }
    };

    // --- Budget item definitions (the shared library: name + category + scope) ---
    // Owner-scoped templates. Budgets pull these in by scope; the actual amounts
    // and transactions live on the per-budget `expenses` instances that point
    // back to a def via `defId`. The def itself carries no money.
    const [budgetItemDefs, setBudgetItemDefs] = useState([]);

    useEffect(() => {
        if (!currentUser) { setBudgetItemDefs([]); return; }
        const load = async () => {
            try {
                const all = await api.getCollection('budgetItemDefs');
                setBudgetItemDefs(all.filter(d => d.ownerId === currentUser.uid));
            } catch (error) {
                console.error("Failed to load budget item defs", error);
            }
        };
        load();
    }, [currentUser]);

    const addBudgetItemDef = async (data) => {
        if (!currentUser) return;
        const def = { ...data, ownerId: currentUser.uid, createdAt: new Date().toISOString() };
        const docRef = await api.addDocument('budgetItemDefs', def);
        const created = { id: docRef.id, ...def };
        setBudgetItemDefs(prev => [...prev, created]);
        return created;
    };

    const updateBudgetItemDef = async (id, data) => {
        await api.updateDocument('budgetItemDefs', id, data);
        setBudgetItemDefs(prev => prev.map(d => d.id === id ? { ...d, ...data } : d));
    };

    const deleteBudgetItemDef = async (id) => {
        await api.deleteDocument('budgetItemDefs', id);
        setBudgetItemDefs(prev => prev.filter(d => d.id !== id));
    };

    // Reload defs + categories after a bulk operation (e.g. the migration tool)
    const reloadLibrary = async () => {
        if (!currentUser) return;
        const [allDefs, allCats] = await Promise.all([
            api.getCollection('budgetItemDefs'),
            api.getCollection('categories'),
        ]);
        setBudgetItemDefs(allDefs.filter(d => d.ownerId === currentUser.uid));
        setCategories(allCats.filter(c => c.userId === currentUser.uid));
    };

    // Find-or-create the per-budget instance (expense) for a def in a given
    // budget (defaults to the active one). Used when reconciling a transaction
    // to an auto-included def that has no amount set yet — the instance is
    // materialized lazily. Returns its id. Works cross-budget (the reconcile
    // budget selector can target another budget than the active one).
    const ensureInstanceForDef = async (def, budgetId = activeBudgetId, amount = 0) => {
        const catName = categories.find(c => c.id === def.categoryId)?.name || 'Annet';
        if (budgetId === activeBudgetId) {
            const existing = expenses.find(e => e.defId === def.id);
            if (existing) return existing.id;
            const ref = await addExpense({ defId: def.id, name: def.name, category: catName, amount, frequency: 'monthly' });
            return ref?.id;
        }
        const all = await api.getCollection('expenses');
        const existing = all.find(e => e.budgetId === budgetId && e.defId === def.id);
        if (existing) return existing.id;
        const data = { budgetId, defId: def.id, name: def.name, category: catName, amount, monthlyAmount: amount, frequency: 'monthly', createdAt: new Date().toISOString() };
        const ref = await api.addDocument('expenses', data);
        return ref.id;
    };

    // --- Bank balances (from the sb1Accounts staging collection) ---
    // Snapshot per SB1 account, refreshed by the server sync. Matched to app
    // accounts via sb1AccountKey.
    const [bankBalances, setBankBalances] = useState([]);

    useEffect(() => {
        if (!currentUser) { setBankBalances([]); return; }
        const load = async () => {
            try {
                setBankBalances(await api.getCollection('sb1Accounts'));
            } catch (error) {
                console.error("Failed to load bank balances", error);
            }
        };
        load();
    }, [currentUser]);

    const reloadTransactions = async () => {
        if (!activeBudgetId) return;
        const all = await api.getCollection('transactions');
        setTransactions(all.filter(t => t.budgetId === activeBudgetId));
    };

    // --- Projects (global, cross-budget) ---

    useEffect(() => {
        if (!currentUser) {
            setProjects([]);
            return;
        }
        const loadProjects = async () => {
            try {
                const all = await api.getCollection('projects');
                setProjects(all.filter(p => p.ownerId === currentUser.uid));
            } catch (error) {
                console.error("Failed to load projects", error);
            }
        };
        loadProjects();
    }, [currentUser]);

    const addProject = async (projectData) => {
        if (!currentUser) return;
        try {
            const newProject = {
                budgetId: activeBudgetId || null,
                ...projectData,
                ownerId: currentUser.uid,
                createdAt: new Date().toISOString()
            };
            const docRef = await api.addDocument('projects', newProject);
            const created = { id: docRef.id, ...newProject };
            setProjects(prev => [...prev, created]);
            return created;
        } catch (error) {
            console.error("Error adding project:", error);
            throw error;
        }
    };

    const updateProject = async (id, projectData) => {
        try {
            await api.updateDocument('projects', id, projectData);
            setProjects(prev => prev.map(p => p.id === id ? { ...p, ...projectData } : p));
        } catch (error) {
            console.error("Error updating project:", error);
            throw error;
        }
    };

    const deleteProject = async (id) => {
        try {
            await api.deleteDocument('projects', id);
            setProjects(prev => prev.filter(p => p.id !== id));
        } catch (error) {
            console.error("Error deleting project:", error);
            throw error;
        }
    };

    // Monthly Budget Helpers
    const getMonthlyBudget = (expenseId, month) => {
        const override = monthlyBudgets.find(mb => mb.expenseId === expenseId && mb.month === month);
        if (override) {
            return { amount: override.amount, isOverride: true, overrideId: override.id };
        }
        const expense = expenses.find(e => e.id === expenseId);
        return { amount: expense?.monthlyAmount || expense?.amount || 0, isOverride: false, overrideId: null };
    };

    const setMonthlyBudget = async (expenseId, month, amount) => {
        if (!activeBudgetId) return;

        try {
            // Check if override already exists
            const existing = monthlyBudgets.find(mb => mb.expenseId === expenseId && mb.month === month);

            if (existing) {
                // Update existing override
                await api.updateDocument('monthlyBudgets', existing.id, { amount });
                setMonthlyBudgets(prev => prev.map(mb =>
                    mb.id === existing.id ? { ...mb, amount } : mb
                ));
            } else {
                // Create new override
                const newOverride = {
                    budgetId: activeBudgetId,
                    expenseId,
                    month,
                    amount,
                    createdAt: new Date().toISOString()
                };
                const docRef = await api.addDocument('monthlyBudgets', newOverride);
                setMonthlyBudgets(prev => [...prev, { id: docRef.id, ...newOverride }]);
            }
        } catch (error) {
            console.error("Error setting monthly budget:", error);
            throw error;
        }
    };

    const deleteMonthlyBudget = async (expenseId, month) => {
        if (!activeBudgetId) return;

        try {
            const override = monthlyBudgets.find(mb => mb.expenseId === expenseId && mb.month === month);
            if (override) {
                await api.deleteDocument('monthlyBudgets', override.id);
                setMonthlyBudgets(prev => prev.filter(mb => mb.id !== override.id));
            }
        } catch (error) {
            console.error("Error deleting monthly budget:", error);
            throw error;
        }
    };

    // Month Status Helpers
    const isMonthReconciled = (month) => {
        const status = monthStatuses.find(ms => ms.month === month);
        return status?.reconciled || false;
    };

    // Household-global: one monthStatuses doc per month, independent of the
    // active budget. Legacy docs carry a budgetId; lookups ignore it.
    const setMonthReconciled = async (month, reconciled) => {
        try {
            const existing = monthStatuses.find(ms => ms.month === month);

            if (existing) {
                // Update existing status
                await api.updateDocument('monthStatuses', existing.id, {
                    reconciled,
                    reconciledAt: reconciled ? new Date().toISOString() : null
                });
                setMonthStatuses(prev => prev.map(ms =>
                    ms.id === existing.id ? { ...ms, reconciled, reconciledAt: reconciled ? new Date().toISOString() : null } : ms
                ));
            } else {
                // Create new status
                const newStatus = {
                    month,
                    reconciled,
                    reconciledAt: reconciled ? new Date().toISOString() : null,
                    createdAt: new Date().toISOString()
                };
                const docRef = await api.addDocument('monthStatuses', newStatus);
                setMonthStatuses(prev => [...prev, { id: docRef.id, ...newStatus }]);
            }
        } catch (error) {
            console.error("Error setting month reconciled status:", error);
            throw error;
        }
    };

    const getPreviousReconciledMonth = (currentMonth) => {
        const [year, month] = currentMonth.split('-').map(Number);
        let checkDate = new Date(year, month - 2); // Start with previous month

        // Check up to 12 months back
        for (let i = 0; i < 12; i++) {
            const checkMonthStr = `${checkDate.getFullYear()}-${String(checkDate.getMonth() + 1).padStart(2, '0')}`;
            if (isMonthReconciled(checkMonthStr)) {
                return checkMonthStr;
            }
            checkDate.setMonth(checkDate.getMonth() - 1);
        }

        return null; // No reconciled month found
    };

    // Projects scoped to the active budget. Legacy projects without a
    // budgetId are shown in every budget until the user assigns them one.
    const visibleProjects = projects.filter(p => !p.budgetId || p.budgetId === activeBudgetId);

    const value = useMemo(() => ({
        currentUser,
        budgets,
        activeBudget,
        switchBudget,
        createBudget,
        updateBudget,
        expenses,
        transactions,
        accounts,
        loading,
        setActiveBudget,
        addExpense,
        updateExpense,
        deleteExpense,
        addTransaction,
        updateTransaction,
        deleteTransaction,
        deleteTransactions,
        mergeTransactions,
        linkRefund,
        linkRefundSplit,
        unlinkRefund,
        setCoveredByIncoming,
        linkCover,
        unlinkCover,
        reloadTransactions,
        bankBalances,
        linkTransactionToBudgetItem,
        createBudgetItemFromTransaction,
        addAccount,
        updateAccount,
        deleteAccount,
        categories,
        addCategory,
        updateCategory,
        deleteCategory,
        budgetItemDefs,
        addBudgetItemDef,
        updateBudgetItemDef,
        deleteBudgetItemDef,
        reloadLibrary,
        ensureInstanceForDef,
        getMonthlyBudget,
        setMonthlyBudget,
        deleteMonthlyBudget,
        monthStatuses,
        isMonthReconciled,
        setMonthReconciled,
        getPreviousReconciledMonth,
        projects: visibleProjects,
        allProjects: projects,
        addProject,
        updateProject,
        deleteProject,
        receipts,
        allReceiptItems: receiptItemsCache,
        getReceiptItems,
        getAllReceiptItems,
        deleteReceipt,
        linkReceiptToTransaction
        // The action functions are intentionally left out of the deps: they are
        // recreated each render, but all state they close over is listed below,
        // so the memoized value always exposes up-to-date functions.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }), [
        currentUser, budgets, activeBudget, activeBudgetId,
        expenses, transactions, accounts, loading,
        categories, budgetItemDefs, monthlyBudgets, monthStatuses, projects,
        receipts, receiptItemsCache, bankBalances
    ]);

    return (
        <BudgetContext.Provider value={value}>
            {children}
        </BudgetContext.Provider>
    );
}
