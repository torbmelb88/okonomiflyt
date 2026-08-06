import { useState } from 'react';
import { X, Plus, Trash2, Edit2, Check } from 'lucide-react';
import { useBudget } from '../../contexts/BudgetContext';
import ConfirmationModal from '../common/ConfirmationModal';

export default function CategoryManagerModal({ isOpen, onClose }) {
    const { categories, addCategory, updateCategory, deleteCategory } = useBudget();
    const [newCategory, setNewCategory] = useState('');
    const [editingId, setEditingId] = useState(null);
    const [editName, setEditName] = useState('');
    const [deleteConfirmation, setDeleteConfirmation] = useState({ isOpen: false, id: null });

    if (!isOpen) return null;

    const handleAdd = async (e) => {
        e.preventDefault();
        if (!newCategory.trim()) return;
        try {
            await addCategory(newCategory.trim());
            setNewCategory('');
        } catch {
            alert("Kunne ikke legge til kategori.");
        }
    };

    const handleUpdate = async () => {
        if (!editName.trim()) return;
        try {
            await updateCategory(editingId, editName.trim());
            setEditingId(null);
            setEditName('');
        } catch {
            alert("Kunne ikke oppdatere kategori.");
        }
    };

    const handleDelete = async () => {
        if (!deleteConfirmation.id) return;
        try {
            await deleteCategory(deleteConfirmation.id);
            setDeleteConfirmation({ isOpen: false, id: null });
        } catch {
            alert("Kunne ikke slette kategori.");
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <div
                className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in duration-200"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between bg-gray-50 dark:bg-gray-800/50">
                    <h2 className="text-lg font-bold text-gray-900 dark:text-white">Administrer Kategorier</h2>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="p-6 space-y-6">
                    {/* Add New Category */}
                    <form onSubmit={handleAdd} className="flex space-x-2">
                        <input
                            type="text"
                            value={newCategory}
                            onChange={(e) => setNewCategory(e.target.value)}
                            placeholder="Ny kategori..."
                            className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none dark:bg-gray-700 dark:text-white dark:placeholder-gray-400"
                        />
                        <button
                            type="submit"
                            disabled={!newCategory.trim()}
                            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
                        >
                            <Plus className="w-5 h-5" />
                        </button>
                    </form>

                    {/* Category List */}
                    <div className="space-y-2 max-h-[400px] overflow-y-auto">
                        {categories.map(cat => (
                            <div key={cat.id} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700/30 rounded-lg group hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
                                {editingId === cat.id ? (
                                    <div className="flex-1 flex items-center space-x-2">
                                        <input
                                            type="text"
                                            value={editName}
                                            onChange={(e) => setEditName(e.target.value)}
                                            className="flex-1 px-2 py-1 border border-gray-300 dark:border-gray-600 rounded focus:ring-2 focus:ring-blue-500 outline-none dark:bg-gray-600 dark:text-white"
                                            autoFocus
                                        />
                                        <button onClick={handleUpdate} className="p-1 text-green-600 dark:text-green-400 hover:bg-green-100 dark:hover:bg-green-900/30 rounded">
                                            <Check className="w-4 h-4" />
                                        </button>
                                        <button onClick={() => setEditingId(null)} className="p-1 text-gray-500 hover:bg-gray-200 rounded">
                                            <X className="w-4 h-4" />
                                        </button>
                                    </div>
                                ) : (
                                    <>
                                        <span className="font-medium text-gray-700 dark:text-gray-300">{cat.name}</span>
                                        <div className="flex space-x-1 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
                                            <button
                                                onClick={() => {
                                                    setEditingId(cat.id);
                                                    setEditName(cat.name);
                                                }}
                                                className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors"
                                            >
                                                <Edit2 className="w-4 h-4" />
                                            </button>
                                            <button
                                                onClick={() => setDeleteConfirmation({ isOpen: true, id: cat.id })}
                                                className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                                            >
                                                <Trash2 className="w-4 h-4" />
                                            </button>
                                        </div>
                                    </>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            <ConfirmationModal
                isOpen={deleteConfirmation.isOpen}
                onClose={() => setDeleteConfirmation({ isOpen: false, id: null })}
                onConfirm={handleDelete}
                title="Slett kategori"
                message="Er du sikker på at du vil slette denne kategorien? Dette vil ikke slette eksisterende utgifter, men kategorien vil ikke lenger være tilgjengelig for nye utgifter."
                confirmText="Slett"
                isDangerous={true}
            />
        </div>
    );
}
