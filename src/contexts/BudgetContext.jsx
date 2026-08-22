import { createContext, useContext, useState, useEffect, useMemo } from 'react';
import { api } from '../services/firebase';
import { useAuth } from './AuthContext';
import { isSelfReported, reconcilesOnLink } from '../utils/reconciliation';

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
            await api.deleteDocument('transactions', id);
            setTransactions(prev => prev.filter(t => t.id !== id));
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
        await api.deleteDocument('transactions', removeId);
        setTransactions(prev => prev
            .filter(t => t.id !== removeId)
            .map(t => t.id === keepId
                ? { ...t, ...patch }
                : (t.refundOfTransactionId === removeId ? { ...t, refundOfTransactionId: keepId } : t)));
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
