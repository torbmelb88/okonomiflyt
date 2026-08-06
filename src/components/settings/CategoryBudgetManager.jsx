import { useState } from 'react';
import { Plus, Trash2, Edit2, Check, X, FolderTree, Tag, BarChart3 } from 'lucide-react';
import { useBudget } from '../../contexts/BudgetContext';
import ConfirmationModal from '../common/ConfirmationModal';
import { SCOPE_LABEL } from '../../utils/categoryMigration';

const SCOPES = ['both', 'shared', 'private'];
const scopeClass = (s) => s === 'both'
    ? 'text-purple-600 dark:text-purple-400'
    : s === 'shared' ? 'text-indigo-600 dark:text-indigo-400' : 'text-blue-600 dark:text-blue-400';

/**
 * Manage the owner-level library: categories (e.g. Bolig) and the budget-item
 * definitions under them (e.g. Boliglån, scope Felles). Budgets pull these in
 * by scope; amounts/transactions live per budget, not here.
 */
export default function CategoryBudgetManager() {
    const {
        categories, addCategory, updateCategory, deleteCategory,
        budgetItemDefs, addBudgetItemDef, updateBudgetItemDef, deleteBudgetItemDef,
    } = useBudget();

    const [newCategory, setNewCategory] = useState('');
    const [editingCatId, setEditingCatId] = useState(null);
    const [editCatName, setEditCatName] = useState('');
    const [confirm, setConfirm] = useState({ isOpen: false, kind: null, id: null, message: '' });

    // New-def drafts keyed by categoryId
    const [defDrafts, setDefDrafts] = useState({});
    const [editingDef, setEditingDef] = useState(null); // { id, name, scope }

    const sortedCategories = [...categories].sort((a, b) => a.name.localeCompare(b.name, 'no-NO'));

    const handleAddCategory = async (e) => {
        e.preventDefault();
        if (!newCategory.trim()) return;
        await addCategory(newCategory.trim());
        setNewCategory('');
    };

    const handleAddDef = async (categoryId) => {
        const draft = defDrafts[categoryId];
        if (!draft?.name?.trim()) return;
        await addBudgetItemDef({ name: draft.name.trim(), categoryId, scope: draft.scope || 'both' });
        setDefDrafts(prev => ({ ...prev, [categoryId]: { name: '', scope: 'both' } }));
    };

    const defsFor = (categoryId) => budgetItemDefs
        .filter(d => d.categoryId === categoryId)
        .sort((a, b) => a.name.localeCompare(b.name, 'no-NO'));

    const runConfirm = async () => {
        try {
            if (confirm.kind === 'category') await deleteCategory(confirm.id);
            else if (confirm.kind === 'def') await deleteBudgetItemDef(confirm.id);
        } catch (e) {
            alert('Kunne ikke slette: ' + e.message);
        }
    };

    return (
        <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700">
            <div className="flex items-center gap-3 mb-6">
                <div className="p-2 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                    <FolderTree className="w-6 h-6 text-blue-600 dark:text-blue-400" />
                </div>
                <div>
                    <h2 className="text-xl font-bold text-gray-900 dark:text-white">Kategorier &amp; budsjettposter</h2>
                    <p className="text-sm text-gray-500 dark:text-gray-400">Felles bibliotek. Budsjettene henter inn poster etter scope (Felles/Privat/Begge).</p>
                </div>
            </div>

            {/* Add category */}
            <form onSubmit={handleAddCategory} className="flex gap-2 mb-6">
                <div className="relative flex-1">
                    <Tag className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <input
                        value={newCategory}
                        onChange={(e) => setNewCategory(e.target.value)}
                        placeholder="Ny kategori (f.eks. Bolig)…"
                        className="w-full pl-9 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none dark:bg-gray-700 dark:text-white"
                    />
                </div>
                <button type="submit" disabled={!newCategory.trim()} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed">
                    <Plus className="w-5 h-5" />
                </button>
            </form>

            <div className="space-y-4">
                {sortedCategories.length === 0 && (
                    <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-6">Ingen kategorier ennå. Legg til én over, eller kjør migreringen.</p>
                )}
                {sortedCategories.map(cat => (
                    <div key={cat.id} className="border border-gray-100 dark:border-gray-700 rounded-lg overflow-hidden">
                        {/* Category header */}
                        <div className="flex items-center justify-between px-4 py-2.5 bg-gray-50 dark:bg-gray-700/40">
                            {editingCatId === cat.id ? (
                                <div className="flex items-center gap-2 flex-1">
                                    <input value={editCatName} onChange={(e) => setEditCatName(e.target.value)} autoFocus className="flex-1 px-2 py-1 border border-gray-300 dark:border-gray-600 rounded dark:bg-gray-600 dark:text-white" />
                                    <button onClick={async () => { if (editCatName.trim()) { await updateCategory(cat.id, editCatName.trim()); } setEditingCatId(null); }} className="p-1 text-green-600 hover:bg-green-100 dark:hover:bg-green-900/30 rounded"><Check className="w-4 h-4" /></button>
                                    <button onClick={() => setEditingCatId(null)} className="p-1 text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-600 rounded"><X className="w-4 h-4" /></button>
                                </div>
                            ) : (
                                <>
                                    <span className="font-bold text-gray-900 dark:text-gray-100">
                                        {cat.name}
                                        {cat.excludeFromStats && <span className="ml-2 text-xs font-medium text-orange-600 dark:text-orange-400">· utenfor statistikk</span>}
                                    </span>
                                    <div className="flex gap-1">
                                        <button onClick={() => updateCategory(cat.id, { excludeFromStats: !cat.excludeFromStats })} title={cat.excludeFromStats ? 'Telles ikke i statistikk — klikk for å inkludere' : 'Hold utenfor statistikk'} className={`p-1.5 rounded ${cat.excludeFromStats ? 'text-orange-600 bg-orange-50 dark:bg-orange-900/20' : 'text-gray-400 hover:text-orange-600 hover:bg-orange-50 dark:hover:bg-orange-900/20'}`}><BarChart3 className="w-4 h-4" /></button>
                                        <button onClick={() => { setEditingCatId(cat.id); setEditCatName(cat.name); }} className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded"><Edit2 className="w-4 h-4" /></button>
                                        <button onClick={() => setConfirm({ isOpen: true, kind: 'category', id: cat.id, message: `Slette kategorien «${cat.name}»? Budsjettpostene under den blir uten kategori.` })} className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded"><Trash2 className="w-4 h-4" /></button>
                                    </div>
                                </>
                            )}
                        </div>

                        {/* Defs under this category */}
                        <div className="divide-y divide-gray-100 dark:divide-gray-700">
                            {defsFor(cat.id).map(def => (
                                <div key={def.id} className="flex items-center justify-between px-4 py-2">
                                    {editingDef?.id === def.id ? (
                                        <div className="flex items-center gap-2 flex-1">
                                            <input value={editingDef.name} onChange={(e) => setEditingDef({ ...editingDef, name: e.target.value })} className="flex-1 px-2 py-1 border border-gray-300 dark:border-gray-600 rounded dark:bg-gray-700 dark:text-white" />
                                            <select value={editingDef.scope} onChange={(e) => setEditingDef({ ...editingDef, scope: e.target.value })} className="px-2 py-1 border border-gray-300 dark:border-gray-600 rounded dark:bg-gray-700 dark:text-white text-sm">
                                                {SCOPES.map(s => <option key={s} value={s}>{SCOPE_LABEL[s]}</option>)}
                                            </select>
                                            <button onClick={async () => { if (editingDef.name.trim()) await updateBudgetItemDef(def.id, { name: editingDef.name.trim(), scope: editingDef.scope }); setEditingDef(null); }} className="p-1 text-green-600 hover:bg-green-100 dark:hover:bg-green-900/30 rounded"><Check className="w-4 h-4" /></button>
                                            <button onClick={() => setEditingDef(null)} className="p-1 text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-600 rounded"><X className="w-4 h-4" /></button>
                                        </div>
                                    ) : (
                                        <>
                                            <span className="text-gray-800 dark:text-gray-200">
                                                {def.name}
                                                <span className={`ml-2 text-xs font-medium ${scopeClass(def.scope)}`}>· {SCOPE_LABEL[def.scope]}</span>
                                                {def.excludeFromStats && <span className="ml-2 text-xs font-medium text-orange-600 dark:text-orange-400">· utenfor statistikk</span>}
                                            </span>
                                            <div className="flex gap-1">
                                                <button onClick={() => updateBudgetItemDef(def.id, { excludeFromStats: !def.excludeFromStats })} title={def.excludeFromStats ? 'Telles ikke i statistikk — klikk for å inkludere' : 'Hold utenfor statistikk'} className={`p-1.5 rounded ${def.excludeFromStats ? 'text-orange-600 bg-orange-50 dark:bg-orange-900/20' : 'text-gray-400 hover:text-orange-600 hover:bg-orange-50 dark:hover:bg-orange-900/20'}`}><BarChart3 className="w-4 h-4" /></button>
                                                <button onClick={() => setEditingDef({ id: def.id, name: def.name, scope: def.scope })} className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded"><Edit2 className="w-4 h-4" /></button>
                                                <button onClick={() => setConfirm({ isOpen: true, kind: 'def', id: def.id, message: `Slette budsjettposten «${def.name}»? Eksisterende transaksjoner og beløp i budsjettene påvirkes ikke.` })} className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded"><Trash2 className="w-4 h-4" /></button>
                                            </div>
                                        </>
                                    )}
                                </div>
                            ))}

                            {/* Add def row */}
                            <div className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-gray-800">
                                <input
                                    value={defDrafts[cat.id]?.name || ''}
                                    onChange={(e) => setDefDrafts(prev => ({ ...prev, [cat.id]: { ...(prev[cat.id] || { scope: 'both' }), name: e.target.value } }))}
                                    onKeyDown={(e) => { if (e.key === 'Enter') handleAddDef(cat.id); }}
                                    placeholder="Ny budsjettpost (f.eks. Boliglån)…"
                                    className="flex-1 px-2 py-1 text-sm border border-gray-200 dark:border-gray-600 rounded dark:bg-gray-700 dark:text-white"
                                />
                                <select
                                    value={defDrafts[cat.id]?.scope || 'both'}
                                    onChange={(e) => setDefDrafts(prev => ({ ...prev, [cat.id]: { ...(prev[cat.id] || { name: '' }), scope: e.target.value } }))}
                                    className="px-2 py-1 text-sm border border-gray-200 dark:border-gray-600 rounded dark:bg-gray-700 dark:text-white"
                                >
                                    {SCOPES.map(s => <option key={s} value={s}>{SCOPE_LABEL[s]}</option>)}
                                </select>
                                <button onClick={() => handleAddDef(cat.id)} disabled={!defDrafts[cat.id]?.name?.trim()} className="p-1.5 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded disabled:opacity-40"><Plus className="w-4 h-4" /></button>
                            </div>
                        </div>
                    </div>
                ))}
            </div>

            <ConfirmationModal
                isOpen={confirm.isOpen}
                onClose={() => setConfirm({ ...confirm, isOpen: false })}
                onConfirm={runConfirm}
                title={confirm.kind === 'category' ? 'Slett kategori' : 'Slett budsjettpost'}
                message={confirm.message}
                confirmText="Slett"
                isDangerous={true}
            />
        </div>
    );
}
