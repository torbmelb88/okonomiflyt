import { useState } from 'react';
import { FolderOpen, Plus, Pencil, Trash2, ChevronDown, ChevronUp, X, Check, FolderKanban, Users, Wallet } from 'lucide-react';
import { useBudget } from '../../contexts/BudgetContext';
import { api } from '../../services/firebase';
import clsx from 'clsx';

const emptyForm = { name: '', description: '', targetAmount: '', budgetId: '', subcategories: [], subcatRenames: [] };

// Income (refunds) subtracts from what a set of transactions "cost"
const signedSum = (txns) => txns.reduce((sum, t) => sum + (t.type === 'income' ? -1 : 1) * (t.amount || 0), 0);

const formatMonthLabel = (month) => {
    if (!month || month === 'Ukjent') return 'Ukjent måned';
    const [year, m] = month.split('-');
    return new Date(year, parseInt(m) - 1).toLocaleDateString('no-NO', { month: 'long', year: 'numeric' });
};

// Groups date-desc sorted transactions into consecutive month buckets
const groupByMonth = (txns) => {
    const groups = [];
    for (const txn of txns) {
        const month = txn.month || (txn.date || '').slice(0, 7) || 'Ukjent';
        const last = groups[groups.length - 1];
        if (last && last.month === month) last.txns.push(txn);
        else groups.push({ month, txns: [txn] });
    }
    return groups;
};

export default function Projects() {
    const { projects, addProject, updateProject, deleteProject, budgets, activeBudget } = useBudget();

    const [expandedId, setExpandedId] = useState(null);
    const [loadedTxns, setLoadedTxns] = useState({});
    const [loadingTxns, setLoadingTxns] = useState({});
    // null = show all, '' = without subcategory, string = that subcategory
    const [subcatFilter, setSubcatFilter] = useState(null);

    const [isCreating, setIsCreating] = useState(false);
    const [editingId, setEditingId] = useState(null);
    const [form, setForm] = useState(emptyForm);
    const [saving, setSaving] = useState(false);

    const fetchTransactions = async (projectId) => {
        if (loadedTxns[projectId]) return;
        setLoadingTxns(prev => ({ ...prev, [projectId]: true }));
        try {
            const txns = await api.queryCollection('transactions', 'projectId', projectId);
            txns.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
            setLoadedTxns(prev => ({ ...prev, [projectId]: txns }));
        } catch (err) {
            console.error('Failed to fetch project transactions', err);
        } finally {
            setLoadingTxns(prev => ({ ...prev, [projectId]: false }));
        }
    };

    const handleToggle = (id) => {
        setSubcatFilter(null);
        if (expandedId === id) {
            setExpandedId(null);
        } else {
            setExpandedId(id);
            fetchTransactions(id);
        }
    };

    // Re-tag a transaction from the project page ("sort afterwards") — writes
    // directly since project transactions are fetched cross-budget here.
    const setTxnSubcategory = async (projectId, txnId, value) => {
        try {
            await api.updateDocument('transactions', txnId, { projectSubcategory: value || null });
            setLoadedTxns(prev => ({
                ...prev,
                [projectId]: prev[projectId].map(t => t.id === txnId ? { ...t, projectSubcategory: value || null } : t),
            }));
        } catch (err) {
            console.error('Failed to set subcategory', err);
            alert('Kunne ikke oppdatere underkategori.');
        }
    };

    const handleCreate = async () => {
        if (!form.name.trim()) return;
        setSaving(true);
        try {
            await addProject({
                name: form.name.trim(),
                description: form.description.trim(),
                targetAmount: parseFloat(form.targetAmount) || 0,
                budgetId: form.budgetId || null,
                subcategories: form.subcategories
            });
            setForm(emptyForm);
            setIsCreating(false);
        } finally {
            setSaving(false);
        }
    };

    const startEdit = (project) => {
        setEditingId(project.id);
        setForm({
            name: project.name,
            description: project.description || '',
            targetAmount: project.targetAmount ? String(project.targetAmount) : '',
            budgetId: project.budgetId || '',
            subcategories: project.subcategories || [],
            subcatRenames: []
        });
        setIsCreating(false);
    };

    // Saving subcategory changes also migrates the transactions: renamed names
    // follow along, deleted names are cleared. Otherwise old values linger on
    // transactions and reappear as orphan filter chips.
    const applySubcatChanges = async (projectId, renames, originalSubcats, finalSubcats) => {
        const renameMap = Object.fromEntries(renames.map(r => [r.from, r.to]));
        const resolve = (name) => {
            let n = name;
            const seen = new Set();
            while (renameMap[n] && !seen.has(n)) { seen.add(n); n = renameMap[n]; }
            return n;
        };
        const removed = new Set(originalSubcats.map(resolve).filter(n => !finalSubcats.includes(n)));
        if (renames.length === 0 && removed.size === 0) return;

        const txns = await api.queryCollection('transactions', 'projectId', projectId);
        const updates = [];
        for (const d of txns) {
            const current = d.projectSubcategory;
            if (!current) continue;
            let next = resolve(current);
            if (removed.has(next)) next = null;
            if (next !== current) updates.push({ id: d.id, value: next });
        }
        await Promise.all(updates.map(u => api.updateDocument('transactions', u.id, { projectSubcategory: u.value })));
        setLoadedTxns(prev => {
            if (!prev[projectId] || updates.length === 0) return prev;
            const map = new Map(updates.map(u => [u.id, u.value]));
            return { ...prev, [projectId]: prev[projectId].map(t => map.has(t.id) ? { ...t, projectSubcategory: map.get(t.id) } : t) };
        });
    };

    const handleUpdate = async () => {
        if (!form.name.trim()) return;
        setSaving(true);
        try {
            const originalSubcats = projects.find(p => p.id === editingId)?.subcategories || [];
            await updateProject(editingId, {
                name: form.name.trim(),
                description: form.description.trim(),
                targetAmount: parseFloat(form.targetAmount) || 0,
                budgetId: form.budgetId || null,
                subcategories: form.subcategories
            });
            await applySubcatChanges(editingId, form.subcatRenames, originalSubcats, form.subcategories);
            setEditingId(null);
            setForm(emptyForm);
        } catch (err) {
            console.error('Failed to update project', err);
            alert('Kunne ikke lagre prosjektet: ' + err.message);
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (id) => {
        if (!window.confirm('Slette prosjektet? Transaksjoner tilknyttet prosjektet beholdes, men mister prosjekttilknytningen.')) return;
        await deleteProject(id);
        if (expandedId === id) setExpandedId(null);
    };

    const cancelForm = () => {
        setIsCreating(false);
        setEditingId(null);
        setForm(emptyForm);
    };

    const projectTotal = (project) => {
        const txns = loadedTxns[project.id];
        if (!txns) return null;
        return signedSum(txns);
    };

    return (
        <div className="max-w-3xl mx-auto space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <FolderKanban className="w-7 h-7 text-blue-600 dark:text-blue-400" />
                    <div>
                        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Prosjekter</h1>
                        {activeBudget && (
                            <p className="text-sm text-gray-500 dark:text-gray-400">{activeBudget.name}</p>
                        )}
                    </div>
                </div>
                {!isCreating && !editingId && (
                    <button
                        onClick={() => {
                            setForm({ ...emptyForm, budgetId: activeBudget?.id || '' });
                            setIsCreating(true);
                        }}
                        className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
                    >
                        <Plus className="w-4 h-4" />
                        Nytt prosjekt
                    </button>
                )}
            </div>

            {/* Create form */}
            {isCreating && (
                <ProjectForm
                    form={form}
                    setForm={setForm}
                    onSave={handleCreate}
                    onCancel={cancelForm}
                    saving={saving}
                    title="Nytt prosjekt"
                    budgets={budgets}
                />
            )}

            {/* Empty state */}
            {projects.length === 0 && !isCreating && (
                <div className="text-center py-16 text-gray-400 dark:text-gray-500">
                    <FolderOpen className="w-12 h-12 mx-auto mb-3 opacity-40" />
                    <p className="text-lg font-medium">Ingen prosjekter i dette budsjettet</p>
                    <p className="text-sm mt-1">Opprett et prosjekt for å samle relaterte transaksjoner, f.eks. en oppussing eller ferie.</p>
                </div>
            )}

            {/* Project cards */}
            {projects.map(project => {
                const isExpanded = expandedId === project.id;
                const isEditing = editingId === project.id;
                const txns = loadedTxns[project.id] || [];
                // Defined subcategories plus any values still on transactions
                // (e.g. after a rename) so nothing becomes unreachable
                const subcats = [...new Set([...(project.subcategories || []), ...txns.map(t => t.projectSubcategory).filter(Boolean)])];
                const filteredTxns = subcatFilter === null ? txns : txns.filter(t => (t.projectSubcategory || '') === subcatFilter);
                const hasUntagged = txns.some(t => !t.projectSubcategory);
                const spent = projectTotal(project);
                const target = project.targetAmount || 0;
                const progress = (target > 0 && spent !== null) ? Math.min((spent / target) * 100, 100) : null;
                const projectBudget = project.budgetId ? budgets.find(b => b.id === project.budgetId) : null;

                return (
                    <div
                        key={project.id}
                        className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden"
                    >
                        {isEditing ? (
                            <div className="p-5">
                                <ProjectForm
                                    form={form}
                                    setForm={setForm}
                                    onSave={handleUpdate}
                                    onCancel={cancelForm}
                                    saving={saving}
                                    title="Rediger prosjekt"
                                    budgets={budgets}
                                />
                            </div>
                        ) : (
                            <>
                                {/* Card header */}
                                <div
                                    className="p-5 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
                                    onClick={() => handleToggle(project.id)}
                                >
                                    <div className="flex items-start justify-between gap-4">
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2 mb-1 flex-wrap">
                                                <h2 className="text-lg font-semibold text-gray-900 dark:text-white truncate">
                                                    {project.name}
                                                </h2>
                                                {projectBudget ? (
                                                    <span className={clsx(
                                                        "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium",
                                                        projectBudget.type === 'shared'
                                                            ? "bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300"
                                                            : "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300"
                                                    )}>
                                                        {projectBudget.type === 'shared' ? <Users className="w-3 h-3" /> : <Wallet className="w-3 h-3" />}
                                                        {projectBudget.name}
                                                    </span>
                                                ) : (
                                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400">
                                                        Alle budsjetter
                                                    </span>
                                                )}
                                            </div>
                                            {project.description && (
                                                <p className="text-sm text-gray-500 dark:text-gray-400 mb-3 line-clamp-2">
                                                    {project.description}
                                                </p>
                                            )}

                                            {/* Stats row */}
                                            <div className="flex flex-wrap gap-4 text-sm">
                                                {spent !== null && (
                                                    <span className="text-gray-700 dark:text-gray-300 font-medium">
                                                        {spent.toLocaleString('no-NO')} kr brukt
                                                    </span>
                                                )}
                                                {target > 0 && (
                                                    <span className="text-gray-500 dark:text-gray-400">
                                                        av {target.toLocaleString('no-NO')} kr ramme
                                                    </span>
                                                )}
                                                {isExpanded && (
                                                    <span className="text-gray-400 dark:text-gray-500">
                                                        {txns.length} transaksjon{txns.length !== 1 ? 'er' : ''}
                                                    </span>
                                                )}
                                            </div>

                                            {/* Progress bar */}
                                            {progress !== null && (
                                                <div className="mt-3">
                                                    <div className="w-full bg-gray-100 dark:bg-gray-700 rounded-full h-2">
                                                        <div
                                                            className={clsx(
                                                                "h-2 rounded-full transition-all",
                                                                progress >= 100 ? "bg-red-500" : progress >= 80 ? "bg-amber-500" : "bg-blue-500"
                                                            )}
                                                            style={{ width: `${progress}%` }}
                                                        />
                                                    </div>
                                                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                                                        {Math.round(progress)}% av budsjett brukt
                                                        {progress >= 100 && (
                                                            <span className="text-red-500 dark:text-red-400 ml-2 font-medium">
                                                                Oversteget med {(spent - target).toLocaleString('no-NO')} kr
                                                            </span>
                                                        )}
                                                    </p>
                                                </div>
                                            )}
                                        </div>

                                        <div className="flex items-center gap-1 flex-shrink-0">
                                            <button
                                                onClick={e => { e.stopPropagation(); startEdit(project); }}
                                                className="p-2 text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors"
                                                title="Rediger"
                                            >
                                                <Pencil className="w-4 h-4" />
                                            </button>
                                            <button
                                                onClick={e => { e.stopPropagation(); handleDelete(project.id); }}
                                                className="p-2 text-gray-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                                                title="Slett"
                                            >
                                                <Trash2 className="w-4 h-4" />
                                            </button>
                                            {isExpanded
                                                ? <ChevronUp className="w-5 h-5 text-gray-400 ml-1" />
                                                : <ChevronDown className="w-5 h-5 text-gray-400 ml-1" />
                                            }
                                        </div>
                                    </div>
                                </div>

                                {/* Expanded transaction list */}
                                {isExpanded && (
                                    <div className="border-t border-gray-100 dark:border-gray-700">
                                        {loadingTxns[project.id] ? (
                                            <div className="px-5 py-6 text-center text-gray-400 dark:text-gray-500 text-sm">
                                                Laster transaksjoner...
                                            </div>
                                        ) : txns.length === 0 ? (
                                            <div className="px-5 py-6 text-center text-gray-400 dark:text-gray-500 text-sm">
                                                Ingen transaksjoner tilknyttet dette prosjektet ennå.
                                                <br />
                                                Knytt transaksjoner via avstemmingsprosessen.
                                            </div>
                                        ) : (
                                            <>
                                            {subcats.length > 0 && (
                                                <div className="px-5 py-3 flex flex-wrap gap-2 border-b border-gray-100 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800/50">
                                                    <FilterChip label="Alle" amount={signedSum(txns)} active={subcatFilter === null} onClick={() => setSubcatFilter(null)} />
                                                    {subcats.map(s => (
                                                        <FilterChip
                                                            key={s}
                                                            label={s}
                                                            amount={signedSum(txns.filter(t => t.projectSubcategory === s))}
                                                            active={subcatFilter === s}
                                                            onClick={() => setSubcatFilter(subcatFilter === s ? null : s)}
                                                        />
                                                    ))}
                                                    {hasUntagged && (
                                                        <FilterChip
                                                            label="Uten underkategori"
                                                            amount={signedSum(txns.filter(t => !t.projectSubcategory))}
                                                            active={subcatFilter === ''}
                                                            onClick={() => setSubcatFilter(subcatFilter === '' ? null : '')}
                                                        />
                                                    )}
                                                </div>
                                            )}
                                            {filteredTxns.length === 0 && (
                                                <div className="px-5 py-6 text-center text-gray-400 dark:text-gray-500 text-sm">
                                                    Ingen transaksjoner i denne underkategorien.
                                                </div>
                                            )}
                                            {groupByMonth(filteredTxns).map(group => (
                                                <div key={group.month}>
                                                    <div className="px-5 py-2 bg-gray-50 dark:bg-gray-700/40 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
                                                        <span className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 capitalize">
                                                            {formatMonthLabel(group.month)}
                                                        </span>
                                                        <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">
                                                            {Math.round(signedSum(group.txns)).toLocaleString('no-NO')} kr
                                                        </span>
                                                    </div>
                                                    <ul className="divide-y divide-gray-50 dark:divide-gray-700">
                                                        {group.txns.map(txn => (
                                                            <li key={txn.id} className="flex items-center justify-between px-5 py-3 hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors gap-3">
                                                                <div className="min-w-0">
                                                                    <p className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">
                                                                        {txn.name || 'Ukjent'}
                                                                    </p>
                                                                    <p className="text-xs text-gray-400 dark:text-gray-500">
                                                                        {txn.date}
                                                                        {txn.category && ` · ${txn.category}`}
                                                                    </p>
                                                                </div>
                                                                <div className="flex items-center gap-3 flex-shrink-0">
                                                                    {subcats.length > 0 && (
                                                                        <select
                                                                            value={txn.projectSubcategory || ''}
                                                                            onChange={e => setTxnSubcategory(project.id, txn.id, e.target.value)}
                                                                            className="text-xs px-1.5 py-1 border border-gray-200 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-600 dark:text-gray-300 outline-none focus:ring-1 focus:ring-blue-400 max-w-[130px]"
                                                                        >
                                                                            <option value="">— ingen —</option>
                                                                            {subcats.map(s => <option key={s} value={s}>{s}</option>)}
                                                                        </select>
                                                                    )}
                                                                    <span className={clsx(
                                                                        "text-sm font-semibold",
                                                                        txn.type === 'income' ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"
                                                                    )}>
                                                                        {txn.type === 'income' ? '+' : '-'}{(txn.amount || 0).toLocaleString('no-NO')} kr
                                                                    </span>
                                                                </div>
                                                            </li>
                                                        ))}
                                                    </ul>
                                                </div>
                                            ))}
                                            </>
                                        )}
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                );
            })}
        </div>
    );
}

function FilterChip({ label, amount, active, onClick }) {
    return (
        <button
            onClick={onClick}
            className={clsx(
                "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-colors",
                active
                    ? "bg-blue-600 text-white"
                    : "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-blue-100 dark:hover:bg-blue-900/40"
            )}
        >
            {label}
            <span className={clsx("font-semibold", active ? "text-blue-100" : "text-gray-500 dark:text-gray-400")}>
                {Math.round(amount).toLocaleString('no-NO')}
            </span>
        </button>
    );
}

function ProjectForm({ form, setForm, onSave, onCancel, saving, title, budgets }) {
    const [newSubcat, setNewSubcat] = useState('');
    const [editingSubcat, setEditingSubcat] = useState(null);
    const [editValue, setEditValue] = useState('');

    const addSubcat = () => {
        const value = newSubcat.trim();
        if (!value || form.subcategories.some(s => s.toLowerCase() === value.toLowerCase())) return;
        setForm(f => ({ ...f, subcategories: [...f.subcategories, value] }));
        setNewSubcat('');
    };
    const removeSubcat = (value) => {
        setForm(f => ({ ...f, subcategories: f.subcategories.filter(s => s !== value) }));
    };
    const confirmRename = () => {
        const value = editValue.trim();
        if (!value || value === editingSubcat) { setEditingSubcat(null); return; }
        if (form.subcategories.some(s => s !== editingSubcat && s.toLowerCase() === value.toLowerCase())) return;
        // The rename is recorded so saving can migrate transactions to the new name
        setForm(f => ({
            ...f,
            subcategories: f.subcategories.map(s => s === editingSubcat ? value : s),
            subcatRenames: [...(f.subcatRenames || []), { from: editingSubcat, to: value }],
        }));
        setEditingSubcat(null);
    };

    return (
        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl p-5 space-y-4">
            <h3 className="font-semibold text-gray-900 dark:text-white">{title}</h3>
            <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Navn *</label>
                <input
                    type="text"
                    placeholder="f.eks. Terrasse 2026"
                    value={form.name}
                    onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm dark:bg-gray-700 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none"
                    autoFocus
                />
            </div>
            <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Beskrivelse (valgfritt)</label>
                <input
                    type="text"
                    placeholder="Kort beskrivelse av prosjektet"
                    value={form.description}
                    onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm dark:bg-gray-700 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none"
                />
            </div>
            <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Kostnadsramme kr (valgfritt)</label>
                <input
                    type="number"
                    placeholder="f.eks. 50000"
                    value={form.targetAmount}
                    onChange={e => setForm(f => ({ ...f, targetAmount: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm dark:bg-gray-700 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none"
                    min="0"
                />
            </div>
            <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Tilhører budsjett</label>
                <select
                    value={form.budgetId}
                    onChange={e => setForm(f => ({ ...f, budgetId: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none"
                >
                    <option value="">Alle budsjetter</option>
                    {budgets.map(b => (
                        <option key={b.id} value={b.id}>
                            {b.name} ({b.type === 'shared' ? 'felles' : 'personlig'})
                        </option>
                    ))}
                </select>
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                    Prosjektet vises kun i valgt budsjett.
                </p>
            </div>
            <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Underkategorier (valgfritt)</label>
                {form.subcategories.length > 0 && (
                    <div className="flex flex-wrap gap-2 mb-2">
                        {form.subcategories.map(s => editingSubcat === s ? (
                            <span key={s} className="inline-flex items-center gap-1">
                                <input
                                    type="text"
                                    value={editValue}
                                    onChange={e => setEditValue(e.target.value)}
                                    onKeyDown={e => {
                                        if (e.key === 'Enter') { e.preventDefault(); confirmRename(); }
                                        if (e.key === 'Escape') setEditingSubcat(null);
                                    }}
                                    autoFocus
                                    className="w-32 px-2 py-1 text-xs border border-blue-300 dark:border-blue-700 rounded-full dark:bg-gray-700 dark:text-white outline-none focus:ring-2 focus:ring-blue-400"
                                />
                                <button type="button" onClick={confirmRename} className="p-0.5 text-green-600 hover:bg-green-100 dark:hover:bg-green-900/30 rounded-full"><Check className="w-3.5 h-3.5" /></button>
                                <button type="button" onClick={() => setEditingSubcat(null)} className="p-0.5 text-red-600 hover:bg-red-100 dark:hover:bg-red-900/30 rounded-full"><X className="w-3.5 h-3.5" /></button>
                            </span>
                        ) : (
                            <span key={s} className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 text-xs font-medium">
                                {s}
                                <button type="button" onClick={() => { setEditingSubcat(s); setEditValue(s); }} className="hover:text-blue-900 dark:hover:text-blue-100" title="Endre navn">
                                    <Pencil className="w-3 h-3" />
                                </button>
                                <button type="button" onClick={() => removeSubcat(s)} className="hover:text-blue-900 dark:hover:text-blue-100" title="Slett">
                                    <X className="w-3 h-3" />
                                </button>
                            </span>
                        ))}
                    </div>
                )}
                <div className="flex gap-2">
                    <input
                        type="text"
                        placeholder="f.eks. Materialer, Fagfolk"
                        value={newSubcat}
                        onChange={e => setNewSubcat(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addSubcat(); } }}
                        className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm dark:bg-gray-700 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none"
                    />
                    <button
                        type="button"
                        onClick={addSubcat}
                        disabled={!newSubcat.trim()}
                        className="px-3 py-2 text-sm bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 rounded-lg hover:bg-blue-200 dark:hover:bg-blue-900/60 disabled:opacity-50 font-medium"
                    >
                        <Plus className="w-4 h-4" />
                    </button>
                </div>
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                    Kan velges ved avstemming og brukes til å filtrere transaksjonene i prosjektet.
                </p>
            </div>
            <div className="flex gap-3 justify-end">
                <button
                    onClick={onCancel}
                    className="flex items-center gap-1 px-4 py-2 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                >
                    <X className="w-4 h-4" />
                    Avbryt
                </button>
                <button
                    onClick={onSave}
                    disabled={!form.name.trim() || saving}
                    className="flex items-center gap-1 px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-300 dark:disabled:bg-gray-600 disabled:cursor-not-allowed transition-colors font-medium"
                >
                    <Check className="w-4 h-4" />
                    {saving ? 'Lagrer...' : 'Lagre'}
                </button>
            </div>
        </div>
    );
}
