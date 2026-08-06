// Pure planning for the category -> budget-item-definition migration.
//
// Today each `expense` (budsjettpost) is a per-budget row with a free-text
// `category` string. The new model has owner-level categories and budget-item
// definitions (name + category + scope), with the existing expenses becoming
// per-budget instances pointing at a def via `defId`.
//
// This builds the plan only — no writes. The same (name, category) appearing in
// both a shared and a personal budget collapses into ONE def with scope 'both';
// the two existing expenses stay as separate instances under it (so they keep
// their own amounts and transactions — separation invariant preserved).
//
// Idempotent: a pending expense that matches an EXISTING def (by name+category)
// links to it instead of creating a duplicate, widening the def's scope to
// 'both' when it now spans both budget types. So running it once per budget, or
// re-running after adding a budget, converges correctly.

const norm = (s) => (s || '').trim().toLowerCase();

export function isVirtualExpense(e) {
    return e.isVirtual || (typeof e.id === 'string' && e.id.startsWith('virtual'));
}

const scopeFromTypes = (set) => (set.has('shared') && set.has('private'))
    ? 'both' : (set.has('shared') ? 'shared' : 'private');
const typesOfScope = (scope) => scope === 'both' ? new Set(['shared', 'private']) : new Set([scope]);
const widenScope = (scope, addTypes) => scopeFromTypes(new Set([...typesOfScope(scope), ...addTypes]));

/**
 * @returns {{
 *   newDefs: Array<{ key, name, categoryName, scope, expenseIds: string[] }>,
 *   linkExisting: Array<{ defId, name, categoryName, expenseIds, fromScope, toScope: string|null }>,
 *   newCategoryNames: string[],
 *   pendingExpenseCount: number,
 *   alreadyMigratedCount: number,
 *   defCount: number,
 *   widenCount: number,
 * }}
 */
export function buildMigrationPlan({ expenses, budgets, categories, budgetItemDefs = [] }) {
    const budgetTypeById = new Map(budgets.map(b => [b.id, b.type]));
    const existingCatById = new Map(categories.map(c => [c.id, c]));
    const existingCatByNorm = new Map(categories.map(c => [norm(c.name), c]));

    const real = expenses.filter(e => !isVirtualExpense(e));
    const pending = real.filter(e => !e.defId);
    const alreadyMigratedCount = real.length - pending.length;

    // Index existing defs by (name|category)
    const existingDefByKey = new Map();
    for (const d of budgetItemDefs) {
        const catName = existingCatById.get(d.categoryId)?.name || '';
        existingDefByKey.set(`${norm(d.name)}|${norm(catName)}`, d);
    }

    // Group pending expenses by (name, category)
    const groups = new Map();
    for (const e of pending) {
        const name = (e.name || 'Uten navn').trim();
        const categoryName = (e.category || 'Annet').trim();
        const key = `${norm(name)}|${norm(categoryName)}`;
        if (!groups.has(key)) groups.set(key, { key, name, categoryName, budgetTypes: new Set(), expenseIds: [] });
        const g = groups.get(key);
        g.expenseIds.push(e.id);
        g.budgetTypes.add(budgetTypeById.get(e.budgetId) === 'shared' ? 'shared' : 'private');
    }

    const newDefs = [];
    const linkExisting = [];
    for (const g of groups.values()) {
        const existing = existingDefByKey.get(g.key);
        if (existing) {
            const toScope = widenScope(existing.scope, g.budgetTypes);
            linkExisting.push({
                defId: existing.id, name: g.name, categoryName: g.categoryName,
                expenseIds: g.expenseIds, fromScope: existing.scope,
                toScope: toScope !== existing.scope ? toScope : null,
            });
        } else {
            newDefs.push({ key: g.key, name: g.name, categoryName: g.categoryName, scope: scopeFromTypes(g.budgetTypes), expenseIds: g.expenseIds });
        }
    }

    newDefs.sort((a, b) => a.categoryName.localeCompare(b.categoryName, 'no-NO') || a.name.localeCompare(b.name, 'no-NO'));

    const newCategoryNames = [...new Set(newDefs.map(d => d.categoryName))]
        .filter(n => !existingCatByNorm.has(norm(n)))
        .sort((a, b) => a.localeCompare(b, 'no-NO'));

    return {
        newDefs,
        linkExisting,
        newCategoryNames,
        pendingExpenseCount: pending.length,
        alreadyMigratedCount,
        defCount: newDefs.length + linkExisting.length,
        widenCount: linkExisting.filter(l => l.toScope).length,
    };
}

export const SCOPE_LABEL = { shared: 'Felles', private: 'Privat', both: 'Begge' };
