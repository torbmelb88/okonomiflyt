import { useState } from 'react';
import { X, Wallet, Users } from 'lucide-react';
import clsx from 'clsx';

export default function CreateBudgetModal({ isOpen, onClose, onCreate }) {
    const [name, setName] = useState('');
    const [type, setType] = useState('personal');
    const [loading, setLoading] = useState(false);

    if (!isOpen) return null;

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!name.trim()) return;

        setLoading(true);
        try {
            await onCreate(name, type);
            onClose();
            setName('');
            setType('personal');
        } catch (error) {
            console.error("Failed to create budget", error);
            alert("Kunne ikke opprette budsjett. Prøv igjen.");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in duration-200">

                {/* Header */}
                <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-gray-50">
                    <h2 className="text-lg font-bold text-gray-900">Opprett nytt budsjett</h2>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Form */}
                <form onSubmit={handleSubmit} className="p-6 space-y-6">

                    {/* Name Input */}
                    <div className="space-y-2">
                        <label htmlFor="budgetName" className="block text-sm font-medium text-gray-700">
                            Navn på budsjett
                        </label>
                        <input
                            id="budgetName"
                            type="text"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="Eks. Min Økonomi, Hyttebudsjett..."
                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                            autoFocus
                            required
                        />
                    </div>

                    {/* Type Selection */}
                    <div className="space-y-2">
                        <label className="block text-sm font-medium text-gray-700">
                            Type budsjett
                        </label>
                        <div className="grid grid-cols-2 gap-4">
                            <button
                                type="button"
                                onClick={() => setType('personal')}
                                className={clsx(
                                    "flex flex-col items-center justify-center p-4 rounded-xl border-2 transition-all",
                                    type === 'personal'
                                        ? "border-blue-500 bg-blue-50 text-blue-700"
                                        : "border-gray-200 hover:border-gray-300 text-gray-600"
                                )}
                            >
                                <Wallet className={clsx("w-6 h-6 mb-2", type === 'personal' ? "text-blue-600" : "text-gray-400")} />
                                <span className="font-bold text-sm">Privat</span>
                            </button>

                            <button
                                type="button"
                                onClick={() => setType('shared')}
                                className={clsx(
                                    "flex flex-col items-center justify-center p-4 rounded-xl border-2 transition-all",
                                    type === 'shared'
                                        ? "border-purple-500 bg-purple-50 text-purple-700"
                                        : "border-gray-200 hover:border-gray-300 text-gray-600"
                                )}
                            >
                                <Users className={clsx("w-6 h-6 mb-2", type === 'shared' ? "text-purple-600" : "text-gray-400")} />
                                <span className="font-bold text-sm">Felles</span>
                            </button>
                        </div>
                        <p className="text-xs text-gray-500 mt-2">
                            {type === 'personal'
                                ? "For din egen personlige økonomi."
                                : "For deling med partner eller andre. Du kan invitere medlemmer senere."}
                        </p>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center justify-end space-x-3 pt-4">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-4 py-2 text-gray-700 font-medium hover:bg-gray-100 rounded-lg transition-colors"
                        >
                            Avbryt
                        </button>
                        <button
                            type="submit"
                            disabled={loading || !name.trim()}
                            className={clsx(
                                "px-6 py-2 text-white font-bold rounded-lg shadow-sm transition-all",
                                loading ? "opacity-50 cursor-not-allowed" : "hover:shadow-md",
                                type === 'shared' ? "bg-purple-600 hover:bg-purple-700" : "bg-blue-600 hover:bg-blue-700"
                            )}
                        >
                            {loading ? 'Oppretter...' : 'Opprett Budsjett'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
