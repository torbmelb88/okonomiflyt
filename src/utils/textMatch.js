// Shared text matching helpers used by CSV duplicate detection and
// reconciliation suggestions.

const tokenize = (s) => s.toLowerCase()
    .replace(/æ/g, 'e').replace(/ø/g, 'o').replace(/å/g, 'a')
    .replace(/[^a-z0-9]/g, ' ').split(/\s+/).filter(t => t.length > 2);

export const stringsAreSimilar = (s1, s2) => {
    if (!s1 || !s2) return false;
    const tokens1 = new Set(tokenize(s1));
    const tokens2 = new Set(tokenize(s2));
    for (const t1 of tokens1) {
        for (const t2 of tokens2) {
            if (t1 === t2) return true;
            if (t1.length >= 4 && t2.length >= 4 && (t1.startsWith(t2) || t2.startsWith(t1))) return true;
        }
    }
    return false;
};

/**
 * Suggest a budget item for a transaction based on how similar transactions
 * were reconciled before.
 *
 * Returns { budgetItemId, matchType: 'exact' | 'similar', matchedName } or
 * null when there is no usable history.
 */
export function findBudgetItemSuggestion(transaction, historicalTransactions, expenses) {
    if (!transaction?.name || !Array.isArray(historicalTransactions) || historicalTransactions.length === 0) {
        return null;
    }

    // Only consider history that points to a budget item that still exists
    const validExpenseIds = new Set((expenses || []).map(e => e.id));
    const candidates = historicalTransactions.filter(t =>
        t.id !== transaction.id &&
        t.budgetItemId &&
        validExpenseIds.has(t.budgetItemId) &&
        t.name
    );
    if (candidates.length === 0) return null;

    // Pick the budget item with most "votes" among the matches,
    // tie-broken by the most recently dated transaction.
    const pickByVotes = (matches) => {
        const votes = {};
        for (const t of matches) {
            if (!votes[t.budgetItemId]) votes[t.budgetItemId] = { count: 0, latest: '', name: t.name };
            votes[t.budgetItemId].count++;
            if ((t.date || '') > votes[t.budgetItemId].latest) {
                votes[t.budgetItemId].latest = t.date || '';
                votes[t.budgetItemId].name = t.name;
            }
        }
        const [budgetItemId, info] = Object.entries(votes).sort((a, b) =>
            b[1].count - a[1].count || b[1].latest.localeCompare(a[1].latest)
        )[0];
        return { budgetItemId, matchedName: info.name };
    };

    const normalize = (s) => s.trim().toLowerCase();
    const target = normalize(transaction.name);

    const exactMatches = candidates.filter(t => normalize(t.name) === target);
    if (exactMatches.length > 0) {
        return { ...pickByVotes(exactMatches), matchType: 'exact' };
    }

    const similarMatches = candidates.filter(t => stringsAreSimilar(t.name, transaction.name));
    if (similarMatches.length > 0) {
        return { ...pickByVotes(similarMatches), matchType: 'similar' };
    }

    return null;
}
