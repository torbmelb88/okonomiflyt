// Synthetic demo dataset for demo mode (VITE_DEMO_MODE=true, or when no
// Firebase config is present). All names, accounts and amounts are fictional.
//
// Dates are generated relative to "today" so the demo always shows a living
// household: last month is fully reconciled (drives Min Oversikt's card bill
// and the Oppgjør settlement), the current month is mid-flight with
// unreconciled transactions.

export const demoUser = {
    uid: 'demo-user',
    email: 'demo@example.com',
    displayName: 'Demo Bruker'
};

const PARTNER_UID = 'passive_partner';

// 'YYYY-MM' for the month `offset` months from now (0 = current, -1 = previous)
function monthStr(offset) {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() + offset);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// ISO date on a fixed day (1–28) in the given month offset
function dateIn(offset, day) {
    return `${monthStr(offset)}-${String(Math.min(day, 28)).padStart(2, '0')}`;
}

let txSeq = 0;
function tx(offset, day, data) {
    const date = dateIn(offset, day);
    return {
        id: `tx-${++txSeq}`,
        date,
        month: date.slice(0, 7),
        reconciled: true,
        createdAt: `${date}T12:00:00.000Z`,
        ...data
    };
}

export function createDemoDb() {
    txSeq = 0;
    const m0 = monthStr(0);
    const m1 = monthStr(-1);
    const m2 = monthStr(-2);

    const budgets = [
        {
            id: 'budget-personal',
            name: 'Min Privatøkonomi',
            type: 'personal',
            ownerId: demoUser.uid,
            members: [{ uid: demoUser.uid, role: 'owner', name: 'Demo', income: 35000 }]
        },
        {
            id: 'budget-shared',
            name: 'Felles',
            type: 'shared',
            ownerId: demoUser.uid,
            splitMethod: 'income',
            members: [
                { uid: demoUser.uid, role: 'owner', name: 'Demo', income: 35000 },
                { uid: PARTNER_UID, role: 'member', name: 'Partner', income: 30000, isPassive: true }
            ]
        }
    ];

    const accounts = [
        { id: 'acc-bruks', name: 'Brukskonto', type: 'Bankkonto', defaultBudgetId: 'budget-personal', sb1AccountKey: 'demo-key-bruks', ownerId: demoUser.uid },
        { id: 'acc-regning', name: 'Regningskonto', type: 'Bankkonto', defaultBudgetId: 'budget-personal', isBillAccount: true, sb1AccountKey: 'demo-key-regning', ownerId: demoUser.uid },
        { id: 'acc-felles', name: 'Felleskonto', type: 'Bankkonto', defaultBudgetId: 'budget-shared', sb1AccountKey: 'demo-key-felles', ownerId: demoUser.uid },
        { id: 'acc-kort', name: 'Kredittkort', type: 'Kredittkort', defaultBudgetId: 'budget-personal', cardLastFour: '1234', sb1AccountKey: 'demo-key-kort', ownerId: demoUser.uid },
        { id: 'acc-sparing', name: 'Bufferkonto', type: 'Sparing', defaultBudgetId: 'budget-personal', sb1AccountKey: 'demo-key-sparing', ownerId: demoUser.uid }
    ];

    const sb1Accounts = [
        { id: 'sb1-bruks', sb1AccountKey: 'demo-key-bruks', name: 'Brukskonto', accountNumber: '12345678903', balance: 18452.33 },
        { id: 'sb1-regning', sb1AccountKey: 'demo-key-regning', name: 'Regningskonto', accountNumber: '12345678911', balance: 9310.00 },
        { id: 'sb1-felles', sb1AccountKey: 'demo-key-felles', name: 'Felleskonto', accountNumber: '12345678929', balance: 7210.50 },
        { id: 'sb1-kort', sb1AccountKey: 'demo-key-kort', name: 'Kredittkort', balance: -4380.20, availableBalance: 45619.80 },
        { id: 'sb1-sparing', sb1AccountKey: 'demo-key-sparing', name: 'Bufferkonto', accountNumber: '12345678937', balance: 65200.00 }
    ];

    const categories = [
        { id: 'cat-bolig', name: 'Bolig', userId: demoUser.uid },
        { id: 'cat-mat', name: 'Mat og drikke', userId: demoUser.uid },
        { id: 'cat-transport', name: 'Transport', userId: demoUser.uid },
        { id: 'cat-abo', name: 'Abonnementer', userId: demoUser.uid },
        { id: 'cat-sparing', name: 'Sparing', userId: demoUser.uid },
        { id: 'cat-annet', name: 'Annet', userId: demoUser.uid }
    ];

    const budgetItemDefs = [
        { id: 'def-husleie', name: 'Husleie', categoryId: 'cat-bolig', scope: 'shared', ownerId: demoUser.uid },
        { id: 'def-strom', name: 'Strøm', categoryId: 'cat-bolig', scope: 'shared', ownerId: demoUser.uid },
        { id: 'def-mat', name: 'Dagligvarer', categoryId: 'cat-mat', scope: 'shared', ownerId: demoUser.uid },
        { id: 'def-internett', name: 'Internett', categoryId: 'cat-abo', scope: 'shared', ownerId: demoUser.uid },
        { id: 'def-streaming', name: 'Streaming', categoryId: 'cat-abo', scope: 'private', ownerId: demoUser.uid },
        { id: 'def-mobil', name: 'Mobilabonnement', categoryId: 'cat-abo', scope: 'private', ownerId: demoUser.uid },
        { id: 'def-trening', name: 'Trening', categoryId: 'cat-annet', scope: 'private', ownerId: demoUser.uid },
        { id: 'def-drivstoff', name: 'Drivstoff', categoryId: 'cat-transport', scope: 'both', ownerId: demoUser.uid },
        { id: 'def-forsikring', name: 'Forsikring bil', categoryId: 'cat-transport', scope: 'private', ownerId: demoUser.uid },
        { id: 'def-sparing', name: 'Fast sparing', categoryId: 'cat-sparing', scope: 'private', ownerId: demoUser.uid }
    ];

    const expenses = [
        // Shared budget
        { id: 'exp-husleie', budgetId: 'budget-shared', defId: 'def-husleie', name: 'Husleie', category: 'Bolig', amount: 12000, monthlyAmount: 12000, frequency: 'monthly' },
        { id: 'exp-strom', budgetId: 'budget-shared', defId: 'def-strom', name: 'Strøm', category: 'Bolig', amount: 1100, monthlyAmount: 1100, frequency: 'monthly' },
        { id: 'exp-mat', budgetId: 'budget-shared', defId: 'def-mat', name: 'Dagligvarer', category: 'Mat og drikke', amount: 6500, monthlyAmount: 6500, frequency: 'monthly' },
        { id: 'exp-internett', budgetId: 'budget-shared', defId: 'def-internett', name: 'Internett', category: 'Abonnementer', amount: 599, monthlyAmount: 599, frequency: 'monthly' },
        // Personal budget
        { id: 'exp-streaming', budgetId: 'budget-personal', defId: 'def-streaming', name: 'Streaming', category: 'Abonnementer', amount: 328, monthlyAmount: 328, frequency: 'monthly' },
        { id: 'exp-mobil', budgetId: 'budget-personal', defId: 'def-mobil', name: 'Mobilabonnement', category: 'Abonnementer', amount: 329, monthlyAmount: 329, frequency: 'monthly' },
        { id: 'exp-trening', budgetId: 'budget-personal', defId: 'def-trening', name: 'Trening', category: 'Annet', amount: 449, monthlyAmount: 449, frequency: 'monthly' },
        { id: 'exp-drivstoff', budgetId: 'budget-personal', defId: 'def-drivstoff', name: 'Drivstoff', category: 'Transport', amount: 1500, monthlyAmount: 1500, frequency: 'monthly' },
        { id: 'exp-forsikring', budgetId: 'budget-personal', defId: 'def-forsikring', name: 'Forsikring bil', category: 'Transport', amount: 1150, monthlyAmount: 1150, frequency: 'monthly' },
        { id: 'exp-sparing', budgetId: 'budget-personal', defId: 'def-sparing', name: 'Fast sparing', category: 'Sparing', amount: 3000, monthlyAmount: 3000, frequency: 'monthly' },
        // Virtual line: the personal budget's share of the shared budget
        { id: 'exp-virtual', budgetId: 'budget-personal', name: 'Min andel felles', category: 'Felles', amount: 10900, monthlyAmount: 10900, frequency: 'monthly', isVirtual: true }
    ];

    const monthlyBudgets = [
        // Example of a per-month override: cheaper electricity last month
        { id: 'mb-1', budgetId: 'budget-shared', expenseId: 'exp-strom', month: m1, amount: 950 }
    ];

    const monthStatuses = [
        { id: 'ms-1', budgetId: 'budget-shared', month: m2, reconciled: true, reconciledAt: `${dateIn(-1, 3)}T18:00:00.000Z` },
        { id: 'ms-2', budgetId: 'budget-shared', month: m1, reconciled: true, reconciledAt: `${dateIn(0, 3)}T18:00:00.000Z` },
        { id: 'ms-3', budgetId: 'budget-personal', month: m2, reconciled: true, reconciledAt: `${dateIn(-1, 3)}T18:00:00.000Z` },
        { id: 'ms-4', budgetId: 'budget-personal', month: m1, reconciled: true, reconciledAt: `${dateIn(0, 3)}T18:00:00.000Z` }
    ];

    const transactions = [
        // ===== Two months ago (history) =====
        tx(-2, 1, { budgetId: 'budget-personal', accountId: 'acc-bruks', name: 'Lønn Eksempel AS', amount: 35000, type: 'income', category: 'Lønn' }),
        tx(-2, 1, { budgetId: 'budget-shared', accountId: 'acc-felles', name: 'Husleie', amount: 12000, type: 'expense', budgetItemId: 'exp-husleie' }),
        tx(-2, 7, { budgetId: 'budget-shared', accountId: 'acc-felles', name: 'Kraftleverandøren AS', amount: 820, type: 'expense', budgetItemId: 'exp-strom' }),
        tx(-2, 9, { budgetId: 'budget-shared', accountId: 'acc-felles', name: 'Bredbånd AS', amount: 599, type: 'expense', budgetItemId: 'exp-internett' }),
        tx(-2, 5, { budgetId: 'budget-shared', accountId: 'acc-felles', name: 'MENY STORSENTERET', amount: 2110.40, type: 'expense', budgetItemId: 'exp-mat' }),
        tx(-2, 14, { budgetId: 'budget-shared', accountId: 'acc-felles', name: 'REMA 1000 SENTRUM', amount: 1980.35, type: 'expense', budgetItemId: 'exp-mat' }),
        tx(-2, 23, { budgetId: 'budget-shared', accountId: 'acc-felles', name: 'KIWI STORGATA', amount: 2010.80, type: 'expense', budgetItemId: 'exp-mat' }),
        tx(-2, 10, { budgetId: 'budget-personal', accountId: 'acc-bruks', name: 'Kredittkortregning', amount: 3712.60, type: 'expense', category: 'Kredittkortregning' }),
        tx(-2, 10, { budgetId: 'budget-personal', accountId: 'acc-kort', name: 'Innbetaling kredittkort', amount: 3712.60, type: 'income', category: 'Kredittkortregning' }),
        tx(-2, 15, { budgetId: 'budget-personal', accountId: 'acc-bruks', name: 'Overføring sparekonto', amount: 3000, type: 'expense', category: 'Sparing', budgetItemId: 'exp-sparing' }),
        tx(-2, 15, { budgetId: 'budget-personal', accountId: 'acc-sparing', name: 'Overføring fra brukskonto', amount: 3000, type: 'income', category: 'Intern Overføring' }),

        // ===== Last month (fully reconciled — drives card bill + Oppgjør) =====
        tx(-1, 1, { budgetId: 'budget-personal', accountId: 'acc-bruks', name: 'Lønn Eksempel AS', amount: 35000, type: 'income', category: 'Lønn' }),

        // Shared fixed costs from the joint account
        tx(-1, 1, { budgetId: 'budget-shared', accountId: 'acc-felles', name: 'Husleie', amount: 12000, type: 'expense', budgetItemId: 'exp-husleie' }),
        tx(-1, 7, { budgetId: 'budget-shared', accountId: 'acc-felles', name: 'Kraftleverandøren AS', amount: 890, type: 'expense', budgetItemId: 'exp-strom' }),
        tx(-1, 9, { budgetId: 'budget-shared', accountId: 'acc-felles', name: 'Bredbånd AS', amount: 599, type: 'expense', budgetItemId: 'exp-internett' }),

        // Groceries from the joint account
        tx(-1, 4, { budgetId: 'budget-shared', accountId: 'acc-felles', name: 'MENY STORSENTERET', amount: 1450.30, type: 'expense', budgetItemId: 'exp-mat' }),
        tx(-1, 19, { budgetId: 'budget-shared', accountId: 'acc-felles', name: 'REMA 1000 SENTRUM', amount: 980.75, type: 'expense', budgetItemId: 'exp-mat' }),
        // Paid privately (utlegg) — deducted from the transfer in Oppgjør
        tx(-1, 24, { budgetId: 'budget-shared', accountId: 'acc-bruks', name: 'REMA 1000 SENTRUM', amount: 350.40, type: 'expense', budgetItemId: 'exp-mat', paidPrivatelyBy: 'self' }),

        // Groceries bought on the personal credit card, routed to the shared
        // budget as utlegg (card bill is paid personally)
        tx(-1, 2, { budgetId: 'budget-shared', accountId: 'acc-kort', name: 'KIWI STORGATA', amount: 486.50, type: 'expense', budgetItemId: 'exp-mat', paidPrivatelyBy: 'self', receiptId: null }),
        tx(-1, 5, { budgetId: 'budget-shared', accountId: 'acc-kort', name: 'REMA 1000 SENTRUM', amount: 812.30, type: 'expense', budgetItemId: 'exp-mat', paidPrivatelyBy: 'self' }),
        tx(-1, 13, { budgetId: 'budget-shared', accountId: 'acc-kort', name: 'COOP EXTRA TORGET', amount: 534.20, type: 'expense', budgetItemId: 'exp-mat', paidPrivatelyBy: 'self', receiptId: 'receipt-1' }),
        tx(-1, 17, { budgetId: 'budget-shared', accountId: 'acc-kort', name: 'KIWI STORGATA', amount: 322.90, type: 'expense', budgetItemId: 'exp-mat', paidPrivatelyBy: 'self', receiptId: 'receipt-2' }),
        tx(-1, 21, { budgetId: 'budget-shared', accountId: 'acc-kort', name: 'REMA 1000 SENTRUM', amount: 758.40, type: 'expense', budgetItemId: 'exp-mat', paidPrivatelyBy: 'self' }),
        tx(-1, 26, { budgetId: 'budget-shared', accountId: 'acc-kort', name: 'COOP EXTRA TORGET', amount: 289.50, type: 'expense', budgetItemId: 'exp-mat', paidPrivatelyBy: 'self' }),
        tx(-1, 27, { budgetId: 'budget-shared', accountId: 'acc-kort', name: 'KIWI STORGATA', amount: 412.80, type: 'expense', budgetItemId: 'exp-mat', paidPrivatelyBy: 'self' }),

        // Personal spending on the credit card
        tx(-1, 3, { budgetId: 'budget-personal', accountId: 'acc-kort', name: 'NETFLIX.COM', amount: 169, type: 'expense', budgetItemId: 'exp-streaming' }),
        tx(-1, 3, { budgetId: 'budget-personal', accountId: 'acc-kort', name: 'SPOTIFY', amount: 159, type: 'expense', budgetItemId: 'exp-streaming' }),
        tx(-1, 25, { budgetId: 'budget-personal', accountId: 'acc-kort', name: 'Vipps*Treningssenteret', amount: 449, type: 'expense', budgetItemId: 'exp-trening' }),
        tx(-1, 7, { budgetId: 'budget-personal', accountId: 'acc-kort', name: 'CIRCLE K HOVEDVEIEN', amount: 645, type: 'expense', budgetItemId: 'exp-drivstoff' }),
        tx(-1, 10, { budgetId: 'budget-personal', accountId: 'acc-kort', name: 'Vipps*Kafé Eksempel', amount: 145, type: 'expense', category: 'Annet', isUnnecessary: true }),

        // Purchase + refund pair (nets out of the card bill)
        tx(-1, 11, { budgetId: 'budget-personal', accountId: 'acc-kort', name: 'ELKJØP NETTBUTIKK', amount: 1249, type: 'expense', category: 'Annet' }),

        // Bills from the dedicated bill account
        tx(-1, 20, { budgetId: 'budget-personal', accountId: 'acc-regning', name: 'Teleselskapet AS', amount: 329, type: 'expense', budgetItemId: 'exp-mobil' }),
        tx(-1, 28, { budgetId: 'budget-personal', accountId: 'acc-regning', name: 'Forsikringsselskapet AS', amount: 1150, type: 'expense', budgetItemId: 'exp-forsikring' }),

        // Savings transfer pair (recognized as a contribution on the Sparing page)
        tx(-1, 15, { budgetId: 'budget-personal', accountId: 'acc-bruks', name: 'Overføring sparekonto', amount: 3000, type: 'expense', category: 'Sparing', budgetItemId: 'exp-sparing' }),
        tx(-1, 15, { budgetId: 'budget-personal', accountId: 'acc-sparing', name: 'Overføring fra brukskonto', amount: 3000, type: 'income', category: 'Intern Overføring' }),

        // Payment of the previous card bill
        tx(-1, 10, { budgetId: 'budget-personal', accountId: 'acc-bruks', name: 'Kredittkortregning', amount: 3712.60, type: 'expense', category: 'Kredittkortregning' }),
        tx(-1, 10, { budgetId: 'budget-personal', accountId: 'acc-kort', name: 'Innbetaling kredittkort', amount: 3712.60, type: 'income', category: 'Kredittkortregning' }),

        // Project purchases
        tx(-1, 8, { budgetId: 'budget-shared', accountId: 'acc-felles', name: 'BYGGMAKKER', amount: 12450, type: 'expense', category: 'Annet', projectId: 'proj-bad', projectSubcategory: 'Materialer' }),
        tx(-1, 22, { budgetId: 'budget-shared', accountId: 'acc-felles', name: 'Rørlegger AS', amount: 18500, type: 'expense', category: 'Annet', projectId: 'proj-bad', projectSubcategory: 'Fagfolk' }),
        tx(-2, 18, { budgetId: 'budget-personal', accountId: 'acc-kort', name: 'Flyselskapet', amount: 6400, type: 'expense', category: 'Annet', projectId: 'proj-ferie' }),

        // ===== Current month (mid-flight: some rows not yet reconciled) =====
        tx(0, 1, { budgetId: 'budget-personal', accountId: 'acc-bruks', name: 'Lønn Eksempel AS', amount: 35000, type: 'income', category: 'Lønn' }),
        tx(0, 1, { budgetId: 'budget-shared', accountId: 'acc-felles', name: 'Husleie', amount: 12000, type: 'expense', budgetItemId: 'exp-husleie' }),
        tx(0, 3, { budgetId: 'budget-personal', accountId: 'acc-bruks', name: 'Overføring sparekonto', amount: 3000, type: 'expense', category: 'Sparing', budgetItemId: 'exp-sparing' }),
        tx(0, 3, { budgetId: 'budget-personal', accountId: 'acc-sparing', name: 'Overføring fra brukskonto', amount: 3000, type: 'income', category: 'Intern Overføring' }),
        tx(0, 2, { budgetId: 'budget-shared', accountId: 'acc-kort', name: 'KIWI STORGATA', amount: 423.50, type: 'expense', reconciled: false }),
        tx(0, 4, { budgetId: 'budget-shared', accountId: 'acc-felles', name: 'REMA 1000 SENTRUM', amount: 512.30, type: 'expense', reconciled: false }),
        tx(0, 3, { budgetId: 'budget-personal', accountId: 'acc-kort', name: 'CIRCLE K HOVEDVEIEN', amount: 689, type: 'expense', reconciled: false }),
        tx(0, 5, { budgetId: 'budget-personal', accountId: 'acc-kort', name: 'NETFLIX.COM', amount: 169, type: 'expense', reconciled: false }),
        // Logged with the companion app: booked (categorized) but awaiting the
        // bank's copy — shows the "Bokført" state
        tx(0, 6, { budgetId: 'budget-shared', accountId: 'acc-kort', name: 'MENY STORSENTERET', amount: 356.80, type: 'expense', budgetItemId: 'exp-mat', paidPrivatelyBy: 'self', reconciled: false, source: 'companion_app' })
    ];

    // The refund needs a reference to the purchase above
    const elkjopPurchase = transactions.find(t => t.name === 'ELKJØP NETTBUTIKK');
    transactions.push(tx(-1, 16, {
        budgetId: 'budget-personal', accountId: 'acc-kort',
        name: 'Retur ELKJØP NETTBUTIKK', amount: 1249, type: 'income',
        category: 'Annet', isRefund: true, refundOfTransactionId: elkjopPurchase.id
    }));

    // Link the receipts to their card transactions
    const coopTx = transactions.find(t => t.receiptId === 'receipt-1');
    const kiwiTx = transactions.find(t => t.receiptId === 'receipt-2');

    const projects = [
        { id: 'proj-bad', name: 'Oppussing bad', description: 'Nytt bad i kjelleren', targetAmount: 80000, budgetId: 'budget-shared', subcategories: ['Materialer', 'Fagfolk'], ownerId: demoUser.uid },
        { id: 'proj-ferie', name: 'Sommerferie', description: 'Ferietur med familien', targetAmount: 25000, budgetId: null, subcategories: [], ownerId: demoUser.uid }
    ];

    const receipts = [
        { id: 'receipt-1', store: 'Coop Extra Torget', chain: 'coop_extra', date: coopTx.date, month: coopTx.month, total: 534.20, itemCount: 9, transactionId: coopTx.id, budgetId: 'budget-shared', status: 'matched' },
        { id: 'receipt-2', store: 'KIWI Storgata', chain: 'kiwi', date: kiwiTx.date, month: kiwiTx.month, total: 322.90, itemCount: 6, transactionId: kiwiTx.id, budgetId: 'budget-shared', status: 'matched' },
        { id: 'receipt-3', store: 'KIWI Storgata', chain: 'kiwi', date: dateIn(0, 2), month: m0, total: 389.40, itemCount: 7, transactionId: null, status: 'unmatched' }
    ];

    const receiptItems = [
        // Coop Extra Torget (receipt-1) — sums to 534.20
        { id: 'ri-1', receiptId: 'receipt-1', name: 'TINE LETTMELK 1,75L', normalizedName: 'lettmelk 1.75l', category: 'meieri', totalPrice: 49.80, quantity: 2, unit: 'stk', date: receiptDate('receipt-1'), chain: 'coop_extra' },
        { id: 'ri-2', receiptId: 'receipt-1', name: 'NORVEGIA 26% 500G', normalizedName: 'norvegia 500g', category: 'meieri', totalPrice: 89.90, quantity: 1, unit: 'stk', discount: 10.00, date: receiptDate('receipt-1'), chain: 'coop_extra' },
        { id: 'ri-3', receiptId: 'receipt-1', name: 'EPLER ROYAL GALA', normalizedName: 'epler royal gala', category: 'frukt_gront', totalPrice: 32.50, quantity: 0.8, unit: 'kg', date: receiptDate('receipt-1'), chain: 'coop_extra' },
        { id: 'ri-4', receiptId: 'receipt-1', name: 'KYLLINGFILET 550G', normalizedName: 'kyllingfilet 550g', category: 'kjott_fisk', totalPrice: 129.90, quantity: 1, unit: 'stk', date: receiptDate('receipt-1'), chain: 'coop_extra' },
        { id: 'ri-5', receiptId: 'receipt-1', name: 'GROVBRØD', normalizedName: 'grovbrød', category: 'brod_bakevarer', totalPrice: 42.90, quantity: 1, unit: 'stk', date: receiptDate('receipt-1'), chain: 'coop_extra' },
        { id: 'ri-6', receiptId: 'receipt-1', name: 'PEPSI MAX 1,5L', normalizedName: 'pepsi max 1.5l', category: 'drikke', totalPrice: 54.80, quantity: 2, unit: 'stk', date: receiptDate('receipt-1'), chain: 'coop_extra' },
        { id: 'ri-7', receiptId: 'receipt-1', name: 'MEDLEMSRABATT', category: 'annet', totalPrice: -15.00, quantity: 1, unit: 'stk', isDiscount: true, date: receiptDate('receipt-1'), chain: 'coop_extra' },
        { id: 'ri-8', receiptId: 'receipt-1', name: 'TOALETTPAPIR 8PK', normalizedName: 'toalettpapir 8pk', category: 'husholdning', totalPrice: 89.90, quantity: 1, unit: 'stk', date: receiptDate('receipt-1'), chain: 'coop_extra' },
        { id: 'ri-9', receiptId: 'receipt-1', name: 'MELKESJOKOLADE 200G', normalizedName: 'melkesjokolade 200g', category: 'snacks_godteri', totalPrice: 44.50, quantity: 1, unit: 'stk', date: receiptDate('receipt-1'), chain: 'coop_extra' },
        { id: 'ri-10', receiptId: 'receipt-1', name: 'PANT', category: 'pant', totalPrice: 15.00, quantity: 1, unit: 'stk', isPant: true, date: receiptDate('receipt-1'), chain: 'coop_extra' },
        // KIWI Storgata (receipt-2) — sums to 322.90
        { id: 'ri-11', receiptId: 'receipt-2', name: 'LETTMELK 1,75L', normalizedName: 'lettmelk 1.75l', category: 'meieri', totalPrice: 24.90, quantity: 1, unit: 'stk', date: receiptDate('receipt-2'), chain: 'kiwi' },
        { id: 'ri-12', receiptId: 'receipt-2', name: 'BANANER', normalizedName: 'bananer', category: 'frukt_gront', totalPrice: 24.60, quantity: 1.2, unit: 'kg', date: receiptDate('receipt-2'), chain: 'kiwi' },
        { id: 'ri-13', receiptId: 'receipt-2', name: 'JARLSBERG 27% 700G', normalizedName: 'jarlsberg 700g', category: 'meieri', totalPrice: 119.00, quantity: 1, unit: 'stk', discount: 20.00, date: receiptDate('receipt-2'), chain: 'kiwi' },
        { id: 'ri-14', receiptId: 'receipt-2', name: 'KJØTTDEIG 400G', normalizedName: 'kjøttdeig 400g', category: 'kjott_fisk', totalPrice: 62.90, quantity: 1, unit: 'stk', date: receiptDate('receipt-2'), chain: 'kiwi' },
        { id: 'ri-15', receiptId: 'receipt-2', name: 'KNEKKEBRØD', normalizedName: 'knekkebrød', category: 'brod_bakevarer', totalPrice: 35.90, quantity: 1, unit: 'stk', date: receiptDate('receipt-2'), chain: 'kiwi' },
        { id: 'ri-16', receiptId: 'receipt-2', name: 'VASKEMIDDEL', normalizedName: 'vaskemiddel', category: 'husholdning', totalPrice: 55.60, quantity: 1, unit: 'stk', date: receiptDate('receipt-2'), chain: 'kiwi' },
        // Unmatched KIWI receipt (receipt-3) — sums to 389.40
        { id: 'ri-17', receiptId: 'receipt-3', name: 'LETTMELK 1,75L', normalizedName: 'lettmelk 1.75l', category: 'meieri', totalPrice: 24.90, quantity: 1, unit: 'stk', date: dateIn(0, 2), chain: 'kiwi' },
        { id: 'ri-18', receiptId: 'receipt-3', name: 'KAFFE FILTERMALT 500G', normalizedName: 'kaffe filtermalt 500g', category: 'torrvarer', totalPrice: 89.90, quantity: 1, unit: 'stk', date: dateIn(0, 2), chain: 'kiwi' },
        { id: 'ri-19', receiptId: 'receipt-3', name: 'FROSSENPIZZA 3PK', normalizedName: 'frossenpizza 3pk', category: 'frys', totalPrice: 109.00, quantity: 1, unit: 'stk', date: dateIn(0, 2), chain: 'kiwi' },
        { id: 'ri-20', receiptId: 'receipt-3', name: 'KYLLINGFILET 400G', normalizedName: 'kyllingfilet 400g', category: 'kjott_fisk', totalPrice: 89.90, quantity: 1, unit: 'stk', date: dateIn(0, 2), chain: 'kiwi' },
        { id: 'ri-21', receiptId: 'receipt-3', name: 'BROKKOLI', normalizedName: 'brokkoli', category: 'frukt_gront', totalPrice: 25.90, quantity: 1, unit: 'stk', date: dateIn(0, 2), chain: 'kiwi' },
        { id: 'ri-22', receiptId: 'receipt-3', name: 'MELKESJOKOLADE 200G', normalizedName: 'melkesjokolade 200g', category: 'snacks_godteri', totalPrice: 44.50, quantity: 1, unit: 'stk', date: dateIn(0, 2), chain: 'kiwi' },
        { id: 'ri-23', receiptId: 'receipt-3', name: 'PANT', category: 'pant', totalPrice: 5.30, quantity: 1, unit: 'stk', isPant: true, date: dateIn(0, 2), chain: 'kiwi' }
    ];

    // Staging rows from the (simulated) SpareBank 1 sync — one importable,
    // one still waiting to be booked by the bank
    const sb1Transactions = [
        { id: 'sb1tx-1', accountKey: 'demo-key-bruks', date: dateIn(0, 5), name: 'Vipps*Kafé Eksempel', amount: 145, type: 'expense', externalId: 'demo-ext-1:123456789', syncedAt: `${dateIn(0, 6)}T06:00:00.000Z`, bookingStatus: 'BOOKED' },
        { id: 'sb1tx-2', accountKey: 'demo-key-bruks', date: dateIn(0, 6), name: 'Nettgiro', amount: 512.30, type: 'expense', externalId: 'demo-ext-2:000000000000000000', syncedAt: `${dateIn(0, 6)}T06:00:00.000Z`, bookingStatus: 'PENDING' }
    ];

    function receiptDate(receiptId) {
        return receipts.find(r => r.id === receiptId).date;
    }

    return {
        users: [demoUser],
        budgets,
        accounts,
        expenses,
        transactions,
        monthlyBudgets,
        monthStatuses,
        categories,
        budgetItemDefs,
        projects,
        receipts,
        receiptItems,
        sb1Accounts,
        sb1Transactions
    };
}
