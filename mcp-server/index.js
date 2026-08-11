import { onRequest } from 'firebase-functions/v2/https';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { timingSafeEqual } from 'crypto';

initializeApp();
const db = getFirestore();

// ---------- date helpers (Norwegian local time) ----------

function osloToday() {
    return new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Oslo' }); // YYYY-MM-DD
}

function parseMonth(month) {
    if (!/^\d{4}-\d{2}$/.test(month)) throw new Error(`Invalid month "${month}" — use YYYY-MM.`);
    return month;
}

function parseDate(dateStr) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr) || isNaN(new Date(`${dateStr}T12:00:00Z`))) {
        throw new Error(`Invalid date "${dateStr}" — use YYYY-MM-DD.`);
    }
    return dateStr;
}

// ---------- data helpers ----------

async function getCollection(name) {
    const snap = await db.collection(name).get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function queryEq(name, filters) {
    let q = db.collection(name);
    for (const [field, value] of Object.entries(filters)) {
        if (value !== undefined && value !== null) q = q.where(field, '==', value);
    }
    const snap = await q.get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// Mirrors isExcludedFromSummary in TransactionsPanel.jsx: money movement
// (card bill payments, transfers, savings) is not spending.
const EXCLUDED_CATEGORIES = ['kredittkortregning', 'sparing', 'overføring', 'intern overføring'];

function isMoneyMovement(t, expensesById) {
    const category = (t.category || '').trim().toLowerCase();
    if (EXCLUDED_CATEGORIES.includes(category)) return true;
    if (t.budgetItemId) {
        const linked = expensesById.get(t.budgetItemId);
        if (linked && (linked.category || '').trim().toLowerCase() === 'sparing') return true;
    }
    return false;
}

function txView(t, accountsById, expensesById, budgetsById) {
    const view = {
        id: t.id,
        date: t.date,
        name: t.name,
        amount: t.amount,
        type: t.type,
        budget: budgetsById.get(t.budgetId)?.name || t.budgetId || null,
        account: accountsById.get(t.accountId)?.name || t.accountId || null,
        budgetItem: t.budgetItemId ? (expensesById.get(t.budgetItemId)?.name || t.budgetItemId) : null,
        category: t.category || null,
        reconciled: !!t.reconciled,
    };
    if (t.paidPrivatelyBy) view.paidPrivatelyBy = t.paidPrivatelyBy;
    if (t.isRefund) view.isRefund = true;
    if (t.isUnnecessary) view.isUnnecessary = true;
    if (t.projectId) { view.projectId = t.projectId; view.projectSubcategory = t.projectSubcategory || null; }
    if (t.currency && t.currency !== 'NOK') view.currency = t.currency; // amount is still in this currency (awaiting bank confirmation)
    if (t.originalAmount) { view.originalAmount = t.originalAmount; view.originalCurrency = t.originalCurrency || null; }
    return view;
}

// ---------- tool helpers ----------

function ok(data) {
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

function fail(message) {
    return { content: [{ type: 'text', text: `Error: ${message}` }], isError: true };
}

// ---------- MCP server ----------

function buildServer() {
    const server = new McpServer({ name: 'okonomiflyt', version: '1.0.0' });

    server.registerTool('get_accounts', {
        title: 'Get accounts and balances',
        description: 'List all accounts (bank accounts, credit cards, savings) with live balances from the SpareBank 1 sync. Amounts are NOK. Use the returned account ids when adding transactions.',
        inputSchema: {},
    }, async () => {
        const [accounts, sb1Accounts, budgets] = await Promise.all([
            getCollection('accounts'),
            getCollection('sb1Accounts'),
            getCollection('budgets'),
        ]);
        const sb1ByKey = new Map(sb1Accounts.map(a => [a.sb1AccountKey, a]));
        const budgetsById = new Map(budgets.map(b => [b.id, b]));
        return ok(accounts.map(a => {
            const bank = a.sb1AccountKey ? sb1ByKey.get(a.sb1AccountKey) : null;
            return {
                id: a.id,
                name: a.name,
                type: a.type,
                isBillAccount: !!a.isBillAccount,
                cardLastFour: a.cardLastFour || null,
                defaultBudget: budgetsById.get(a.defaultBudgetId || a.budgetId)?.name || null,
                balance: bank?.balance ?? null,
                availableBalance: bank?.availableBalance ?? null,
            };
        }));
    });

    server.registerTool('list_budgets', {
        title: 'List budgets and budget lines',
        description: 'List the budgets (personal/shared) with members and their planned budget lines (budsjettposter) with standard monthly amounts. Virtual lines (e.g. "my share of the shared budget") are marked isVirtual.',
        inputSchema: {},
    }, async () => {
        const [budgets, expenses] = await Promise.all([
            getCollection('budgets'),
            getCollection('expenses'),
        ]);
        return ok(budgets.map(b => ({
            id: b.id,
            name: b.name,
            type: b.type,
            splitMethod: b.splitMethod || null,
            members: (b.members || []).map(m => ({ name: m.name, role: m.role, income: m.income ?? null })),
            lines: expenses.filter(e => e.budgetId === b.id).map(e => ({
                id: e.id,
                name: e.name,
                category: e.category || null,
                monthlyAmount: e.monthlyAmount ?? e.amount ?? null,
                frequency: e.frequency || null,
                isVirtual: !!e.isVirtual,
            })),
        })));
    });

    server.registerTool('get_month_summary', {
        title: 'Get month summary',
        description: 'Budget vs. actual for a month, per budget: income, spending (refunds deducted), each budget line with budgeted and actual amount, unbudgeted spending grouped by category, and reconciliation status. Money movement (savings transfers, credit card bill payments, internal transfers) is excluded from the income/spending totals but savings lines still appear in the line list. Note: numbers for a month are only authoritative once reconciled=true.',
        inputSchema: {
            month: z.string().optional().describe('YYYY-MM, defaults to the current month'),
            budgetId: z.string().optional().describe('Limit to one budget; omit for all budgets'),
        },
    }, async ({ month, budgetId }) => {
        const m = parseMonth(month || osloToday().slice(0, 7));
        const [budgets, expenses, monthlyBudgets, monthStatuses, transactions] = await Promise.all([
            getCollection('budgets'),
            getCollection('expenses'),
            queryEq('monthlyBudgets', { month: m }),
            queryEq('monthStatuses', { month: m }),
            queryEq('transactions', { month: m }),
        ]);
        const expensesById = new Map(expenses.map(e => [e.id, e]));
        const targetBudgets = budgetId ? budgets.filter(b => b.id === budgetId) : budgets;
        if (budgetId && targetBudgets.length === 0) return fail(`No budget with id "${budgetId}".`);

        const summary = targetBudgets.map(b => {
            const txs = transactions.filter(t => t.budgetId === b.id);
            const refunds = txs.filter(t => t.type === 'income' && t.isRefund && !isMoneyMovement(t, expensesById))
                .reduce((acc, t) => acc + t.amount, 0);
            const income = txs.filter(t => t.type === 'income' && !t.isRefund && !isMoneyMovement(t, expensesById))
                .reduce((acc, t) => acc + t.amount, 0);
            const spending = txs.filter(t => t.type === 'expense' && !isMoneyMovement(t, expensesById))
                .reduce((acc, t) => acc + t.amount, 0) - refunds;

            const lines = expenses.filter(e => e.budgetId === b.id).map(e => {
                const override = monthlyBudgets.find(mb => mb.budgetId === b.id && mb.expenseId === e.id);
                const budgeted = override?.amount ?? e.monthlyAmount ?? e.amount ?? 0;
                const actual = txs.filter(t => t.budgetItemId === e.id)
                    .reduce((acc, t) => acc + (t.type === 'income' ? -t.amount : t.amount), 0);
                return {
                    name: e.name,
                    category: e.category || null,
                    budgeted,
                    actual: e.isVirtual ? null : Math.round(actual * 100) / 100,
                    remaining: e.isVirtual ? null : Math.round((budgeted - actual) * 100) / 100,
                    isVirtual: !!e.isVirtual,
                };
            });

            const unbudgeted = {};
            for (const t of txs) {
                if (t.budgetItemId || isMoneyMovement(t, expensesById)) continue;
                if (t.type !== 'expense' && !(t.type === 'income' && t.isRefund)) continue;
                const cat = t.category || '(ukategorisert)';
                unbudgeted[cat] = (unbudgeted[cat] || 0) + (t.type === 'income' ? -t.amount : t.amount);
            }

            return {
                budgetId: b.id,
                budget: b.name,
                month: m,
                reconciled: !!monthStatuses.find(ms => ms.budgetId === b.id)?.reconciled,
                totals: {
                    income: Math.round(income * 100) / 100,
                    spending: Math.round(spending * 100) / 100,
                    refundsDeducted: Math.round(refunds * 100) / 100,
                    net: Math.round((income - spending) * 100) / 100,
                },
                unreconciledTransactions: txs.filter(t => !t.reconciled).length,
                lines,
                unbudgetedByCategory: Object.fromEntries(
                    Object.entries(unbudgeted).map(([k, v]) => [k, Math.round(v * 100) / 100])
                ),
            };
        });
        return ok(summary);
    });

    server.registerTool('list_transactions', {
        title: 'List transactions',
        description: 'List transactions, filterable by month, budget, account, text search and reconciliation state. Amounts are NOK and always positive; `type` says whether it is income or expense. `paidPrivatelyBy` marks utlegg (paid privately on behalf of the shared budget). Transactions with a `currency` field are foreign purchases still awaiting the bank\'s NOK amount. Sorted newest first.',
        inputSchema: {
            month: z.string().optional().describe('YYYY-MM. Strongly recommended to limit the result.'),
            budgetId: z.string().optional(),
            accountId: z.string().optional(),
            search: z.string().optional().describe('Case-insensitive substring match on the transaction name'),
            type: z.enum(['expense', 'income']).optional(),
            onlyUnreconciled: z.boolean().optional().describe('Only transactions not yet reconciled'),
            limit: z.number().optional().describe('Max rows returned, default 100'),
        },
    }, async ({ month, budgetId, accountId, search, type, onlyUnreconciled, limit }) => {
        if (month) parseMonth(month);
        const [transactions, accounts, expenses, budgets] = await Promise.all([
            queryEq('transactions', { month, budgetId, accountId, type }),
            getCollection('accounts'),
            getCollection('expenses'),
            getCollection('budgets'),
        ]);
        const accountsById = new Map(accounts.map(a => [a.id, a]));
        const expensesById = new Map(expenses.map(e => [e.id, e]));
        const budgetsById = new Map(budgets.map(b => [b.id, b]));

        let result = transactions;
        if (search) result = result.filter(t => (t.name || '').toLowerCase().includes(search.toLowerCase()));
        if (onlyUnreconciled) result = result.filter(t => !t.reconciled);
        result.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
        const capped = result.slice(0, limit || 100);
        return ok({
            totalMatching: result.length,
            returned: capped.length,
            transactions: capped.map(t => txView(t, accountsById, expensesById, budgetsById)),
        });
    });

    server.registerTool('add_transaction', {
        title: 'Add transaction',
        description: 'Register a manual transaction (e.g. a cash purchase or an utlegg the user mentions). It lands unreconciled — exactly like the companion app — and gets picked up in the normal reconciliation flow, so it is safe to add. Use get_accounts to find the accountId. Amount is positive NOK. Set paidPrivatelyBy="self" if the user paid privately for something belonging to the shared budget.',
        inputSchema: {
            name: z.string().describe('Merchant/description, e.g. "REMA 1000 SENTRUM"'),
            amount: z.number().positive().describe('Amount in NOK, always positive'),
            date: z.string().optional().describe('YYYY-MM-DD, defaults to today'),
            accountId: z.string().describe('Account id from get_accounts'),
            type: z.enum(['expense', 'income']).optional().describe('Defaults to expense'),
            budgetId: z.string().optional().describe('Omit to use the account\'s default budget'),
            category: z.string().optional(),
            paidPrivatelyBy: z.enum(['self']).optional().describe('Mark as utlegg for the shared budget'),
        },
    }, async ({ name, amount, date, accountId, type, budgetId, category, paidPrivatelyBy }) => {
        const txDate = parseDate(date || osloToday());
        const accountDoc = await db.collection('accounts').doc(accountId).get();
        if (!accountDoc.exists) return fail(`No account with id "${accountId}" — use get_accounts.`);
        const account = accountDoc.data();
        const resolvedBudgetId = budgetId || account.defaultBudgetId || account.budgetId;
        if (!resolvedBudgetId) return fail(`Account "${account.name}" has no default budget — pass budgetId explicitly.`);

        const newTransaction = {
            name,
            amount,
            date: txDate,
            month: txDate.slice(0, 7),
            accountId,
            budgetId: resolvedBudgetId,
            type: type || 'expense',
            reconciled: false,
            createdAt: new Date().toISOString(),
            ...(category && { category }),
            ...(paidPrivatelyBy && { paidPrivatelyBy }),
        };
        const docRef = await db.collection('transactions').add(newTransaction);
        return ok({ id: docRef.id, ...newTransaction });
    });

    server.registerTool('list_receipts', {
        title: 'List receipts',
        description: 'List parsed grocery receipts (from the companion app), filterable by month and match status. status "matched" means the receipt is linked to a card transaction; "unmatched" means no transaction matched yet.',
        inputSchema: {
            month: z.string().optional().describe('YYYY-MM'),
            status: z.enum(['matched', 'unmatched']).optional(),
        },
    }, async ({ month, status }) => {
        if (month) parseMonth(month);
        const receipts = await queryEq('receipts', { month, status });
        receipts.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
        return ok(receipts.map(r => ({
            id: r.id,
            store: r.store,
            chain: r.chain || null,
            date: r.date,
            total: r.total,
            itemCount: r.itemCount ?? null,
            status: r.status || null,
        })));
    });

    server.registerTool('get_receipt_items', {
        title: 'Get receipt line items',
        description: 'Get the individual line items of one receipt: product names, prices, quantities, discounts and grocery categories.',
        inputSchema: {
            receiptId: z.string().describe('Receipt id from list_receipts'),
        },
    }, async ({ receiptId }) => {
        const receiptDoc = await db.collection('receipts').doc(receiptId).get();
        if (!receiptDoc.exists) return fail(`No receipt with id "${receiptId}".`);
        const items = await queryEq('receiptItems', { receiptId });
        const r = receiptDoc.data();
        return ok({
            receipt: { id: receiptId, store: r.store, chain: r.chain || null, date: r.date, total: r.total },
            items: items.map(i => ({
                name: i.name,
                category: i.category || null,
                totalPrice: i.totalPrice,
                quantity: i.quantity ?? 1,
                unit: i.unit || null,
                discount: i.discount ?? null,
                isPant: !!i.isPant,
                isDiscount: !!i.isDiscount,
            })),
        });
    });

    server.registerTool('search_grocery_prices', {
        title: 'Search grocery price history',
        description: 'Search purchased grocery items across all receipts to answer questions like "what does milk cost" or "is cheese cheaper at Kiwi or Coop". Matches product names case-insensitively. Returns purchases sorted newest first with price, quantity, unit and chain.',
        inputSchema: {
            search: z.string().describe('Substring to match, e.g. "lettmelk" or "kyllingfilet"'),
            chain: z.string().optional().describe('Limit to one chain, e.g. "kiwi" or "coop_extra"'),
            limit: z.number().optional().describe('Max rows, default 50'),
        },
    }, async ({ search, chain, limit }) => {
        const items = await queryEq('receiptItems', { chain });
        const needle = search.toLowerCase();
        const matches = items.filter(i =>
            !i.isPant && !i.isDiscount &&
            ((i.normalizedName || '').includes(needle) || (i.name || '').toLowerCase().includes(needle))
        );
        matches.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
        return ok({
            totalMatching: matches.length,
            items: matches.slice(0, limit || 50).map(i => ({
                name: i.name,
                date: i.date,
                chain: i.chain || null,
                totalPrice: i.totalPrice,
                quantity: i.quantity ?? 1,
                unit: i.unit || null,
                discount: i.discount ?? null,
                category: i.category || null,
            })),
        });
    });

    server.registerTool('list_projects', {
        title: 'List projects',
        description: 'List earmarked spending projects (renovation, holiday, …) with target amount and actual spend so far, broken down by subcategory. Refunds are deducted.',
        inputSchema: {},
    }, async () => {
        const [projects, transactions] = await Promise.all([
            getCollection('projects'),
            getCollection('transactions'),
        ]);
        return ok(projects.map(p => {
            const txs = transactions.filter(t => t.projectId === p.id);
            const signed = (t) => (t.type === 'income' ? -t.amount : t.amount);
            const spent = txs.reduce((acc, t) => acc + signed(t), 0);
            const bySubcategory = {};
            for (const t of txs) {
                const sub = t.projectSubcategory || '(ingen underkategori)';
                bySubcategory[sub] = (bySubcategory[sub] || 0) + signed(t);
            }
            return {
                id: p.id,
                name: p.name,
                description: p.description || null,
                targetAmount: p.targetAmount ?? null,
                spent: Math.round(spent * 100) / 100,
                remaining: p.targetAmount != null ? Math.round((p.targetAmount - spent) * 100) / 100 : null,
                bySubcategory,
            };
        }));
    });

    return server;
}

// ---------- HTTP handler ----------

function timingSafeMatch(a, b) {
    const bufA = Buffer.from(String(a));
    const bufB = Buffer.from(String(b));
    return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

function isAuthorized(req) {
    const secret = process.env.MCP_SECRET;
    if (!secret || secret === 'change-me') return false;

    const bearer = (req.get('authorization') || '').replace(/^Bearer\s+/i, '');
    if (timingSafeMatch(bearer, secret)) return true;
    const headerKey = req.get('x-api-key') || req.get('x-auth-token') || '';
    if (timingSafeMatch(headerKey, secret)) return true;

    return (req.path || '').split('/').some(segment => timingSafeMatch(segment, secret));
}

export const mcp = onRequest({
    region: 'europe-west1',
    invoker: 'public',
    maxInstances: 3,
    memory: '256MiB',
}, async (req, res) => {
    // claude.ai's connector validation runs in the browser, so the preflight
    // and the actual responses must carry CORS headers.
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-api-key, x-auth-token, mcp-session-id, mcp-protocol-version, last-event-id');
    res.set('Access-Control-Expose-Headers', 'mcp-session-id, mcp-protocol-version');
    if (req.method === 'OPTIONS') {
        res.status(204).send('');
        return;
    }

    if (!isAuthorized(req)) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
    }

    if (req.method !== 'POST') {
        res.status(405).json({
            jsonrpc: '2.0',
            error: { code: -32000, message: 'Method not allowed. This server runs in stateless mode; use POST.' },
            id: null,
        });
        return;
    }

    try {
        const server = buildServer();
        const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: undefined,
            enableJsonResponse: true,
        });
        res.on('close', () => {
            transport.close();
            server.close();
        });
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
    } catch (err) {
        console.error('MCP request failed:', err);
        if (!res.headersSent) {
            res.status(500).json({
                jsonrpc: '2.0',
                error: { code: -32603, message: 'Internal server error' },
                id: null,
            });
        }
    }
});
