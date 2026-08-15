import { useState, useEffect } from 'react';
import { X, CreditCard, Building, Wallet, Share2, PiggyBank } from 'lucide-react';
import clsx from 'clsx';
import { useBudget } from '../../contexts/BudgetContext';

export default function AddAccountModal({ isOpen, onClose, onSave, accountToEdit = null, defaultType = 'Bankkonto' }) {
    const { budgets, activeBudget } = useBudget();
    const [name, setName] = useState('');
    const [type, setType] = useState(defaultType);
    const [cardLastFour, setCardLastFour] = useState('');
    const [cardNickname, setCardNickname] = useState('');
    const [defaultBudgetId, setDefaultBudgetId] = useState('');
    const [excludeFromSharedCalc, setExcludeFromSharedCalc] = useState(false);
    const [isBillAccount, setIsBillAccount] = useState(false);
    const [bufferTarget, setBufferTarget] = useState('');
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (isOpen && accountToEdit) {
            setName(accountToEdit.name);
            setType(accountToEdit.type);
            setCardLastFour(accountToEdit.cardLastFour || '');
            setCardNickname(accountToEdit.cardNickname || '');
            setDefaultBudgetId(accountToEdit.defaultBudgetId || accountToEdit.budgetId || activeBudget?.id || '');
            setExcludeFromSharedCalc(!!accountToEdit.excludeFromSharedCalc);
            setIsBillAccount(!!accountToEdit.isBillAccount);
            setBufferTarget(accountToEdit.bufferTarget ? String(accountToEdit.bufferTarget) : '');
        } else if (isOpen && !accountToEdit) {
            // Reset if opening for new account
            setName('');
            setType(defaultType);
            setCardLastFour('');
            setCardNickname('');
            setDefaultBudgetId(activeBudget?.id || budgets[0]?.id || '');
            setExcludeFromSharedCalc(false);
            setIsBillAccount(false);
            setBufferTarget('');
        }
    }, [isOpen, accountToEdit, defaultType, activeBudget, budgets]);

    if (!isOpen) return null;

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!name.trim()) return;

        setLoading(true);
        try {
            await onSave({
                name,
                type,
                cardLastFour,
                cardNickname: cardNickname.trim(),
                defaultBudgetId,
                excludeFromSharedCalc,
                isBillAccount,
                // Buffer target only makes sense on a bill account
                bufferTarget: isBillAccount && parseFloat(bufferTarget) > 0 ? Math.round(parseFloat(bufferTarget)) : null,
            });
            onClose();
        } catch (error) {
            console.error("Failed to save account", error);
            alert("Kunne ikke lagre konto.");
        } finally {
            setLoading(false);
        }
    };

    const accountTypes = [
        { id: 'Bankkonto', icon: Building, color: 'text-blue-600', bg: 'bg-blue-50' },
        { id: 'Kredittkort', icon: CreditCard, color: 'text-purple-600', bg: 'bg-purple-50' },
        { id: 'Sparing', icon: Wallet, color: 'text-green-600', bg: 'bg-green-50' }
    ];

    const isEdit = !!accountToEdit;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in duration-200 flex flex-col max-h-[90vh]">
                <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between bg-gray-50 dark:bg-gray-800/50 flex-shrink-0">
                    <h2 className="text-lg font-bold text-gray-900 dark:text-white">{isEdit ? 'Rediger konto' : 'Legg til ny konto'}</h2>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="p-6 space-y-6 overflow-y-auto">
                    <div className="space-y-2">
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Kontonavn</label>
                        <input
                            type="text"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="F.eks. Brukskonto, Sparekonto"
                            className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none dark:bg-gray-700 dark:text-white dark:placeholder-gray-400"
                            required
                        />
                    </div>

                    <div className="space-y-2">
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Kontotype</label>
                        <div className="grid grid-cols-3 gap-3">
                            {accountTypes.map((t) => (
                                <button
                                    key={t.id}
                                    type="button"
                                    onClick={() => setType(t.id)}
                                    className={clsx(
                                        "flex flex-col items-center p-3 rounded-lg border transition-all",
                                        type === t.id
                                            ? `border-${t.color.split('-')[1]}-500 ${t.bg} dark:bg-${t.color.split('-')[1]}-900/20 ring-1 ring-${t.color.split('-')[1]}-500`
                                            : "border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700",
                                        "dark:text-white"
                                    )}
                                >
                                    <t.icon className={clsx("w-6 h-6 mb-2", t.color, "dark:opacity-80")} />
                                    <span className={clsx("text-xs font-medium", type === t.id ? "text-gray-900 dark:text-white" : "text-gray-700 dark:text-gray-400")}>{t.id}</span>
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="space-y-2">
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Tilknyttet Kort (valgfritt)</label>
                        <div className="relative">
                            <CreditCard className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
                            <input
                                type="text"
                                value={cardLastFour}
                                onChange={(e) => {
                                    // Only allow numbers and max 4 chars
                                    const val = e.target.value.replace(/\D/g, '').slice(0, 4);
                                    setCardLastFour(val);
                                }}
                                placeholder="4 siste siffer (f.eks. 1234)"
                                className="w-full pl-10 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none dark:bg-gray-700 dark:text-white dark:placeholder-gray-400"
                            />
                        </div>
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                            Brukes for å filtrere import fra mobilappen automatisk.
                        </p>
                        <div className="relative">
                            <CreditCard className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
                            <input
                                type="text"
                                value={cardNickname}
                                onChange={(e) => setCardNickname(e.target.value)}
                                placeholder="Kallenavn (f.eks. Felleskortet)"
                                className="w-full pl-10 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none dark:bg-gray-700 dark:text-white dark:placeholder-gray-400"
                            />
                        </div>
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                            Har kortet et kallenavn i Google Wallet, inneholder varselet kallenavnet i stedet for kortnummeret. Mobilappen matcher da kontoen på kallenavnet.
                        </p>
                    </div>

                    <div className="space-y-2">
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-2">
                            <Share2 className="w-4 h-4" />
                            Standard-budsjett
                        </label>
                        <select
                            value={defaultBudgetId}
                            onChange={(e) => setDefaultBudgetId(e.target.value)}
                            className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none bg-white dark:bg-gray-700 dark:text-white"
                        >
                            <option value="">Ingen standard</option>
                            {budgets.map(budget => (
                                <option key={budget.id} value={budget.id}>{budget.name} ({budget.type === 'shared' ? 'felles' : 'privat'})</option>
                            ))}
                        </select>
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                            Nye transaksjoner på denne kontoen havner i dette budsjettet som standard, men kan overstyres per transaksjon ved avstemming.
                        </p>
                    </div>

                    <label className="flex items-start gap-2 p-3 border border-gray-200 dark:border-gray-700 rounded-lg cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                        <input
                            type="checkbox"
                            checked={excludeFromSharedCalc}
                            onChange={(e) => setExcludeFromSharedCalc(e.target.checked)}
                            className="w-4 h-4 mt-0.5 text-blue-600 rounded border-gray-300 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600"
                        />
                        <span className="text-sm text-gray-700 dark:text-gray-300">
                            <span className="font-medium">Hold transaksjoner utenfor fordeling</span>
                            <span className="block text-xs text-gray-500 dark:text-gray-400">Transaksjoner herfra teller ikke i fordelingen av fellesutgifter, men logges fortsatt. Nyttig for f.eks. et felleskort som fylles opp med et fast beløp (da er det påfyllet, ikke kjøpene, som fordeles).</span>
                        </span>
                    </label>

                    <label className="flex items-start gap-2 p-3 border border-gray-200 dark:border-gray-700 rounded-lg cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                        <input
                            type="checkbox"
                            checked={isBillAccount}
                            onChange={(e) => setIsBillAccount(e.target.checked)}
                            className="w-4 h-4 mt-0.5 text-blue-600 rounded border-gray-300 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600"
                        />
                        <span className="text-sm text-gray-700 dark:text-gray-300">
                            <span className="font-medium">Regningskonto</span>
                            <span className="block text-xs text-gray-500 dark:text-gray-400">Fylles på med forrige måneds forbruk. Min Oversikt viser beløpet som skal overføres hit (kontoens standard-budsjett avgjør hvem sin oversikt).</span>
                        </span>
                    </label>

                    {isBillAccount && (
                        <div className="ml-6 -mt-2 space-y-1">
                            <label className="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-1.5">
                                <PiggyBank className="w-4 h-4 text-gray-400" /> Ønsket buffer (kr)
                            </label>
                            <input
                                type="number"
                                min="0"
                                step="100"
                                inputMode="numeric"
                                value={bufferTarget}
                                onChange={(e) => setBufferTarget(e.target.value)}
                                placeholder="f.eks. 20000"
                                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none dark:bg-gray-700 dark:text-white"
                            />
                            <p className="text-xs text-gray-500 dark:text-gray-400">
                                Så mye bør stå på kontoen ut over månedens påfyll, slik at regninger som forfaller før neste påfyll (f.eks. kortfaktura) alltid er dekket. Sammenlignes med saldoen fra banken på Oppgjør-siden, der du også kan lage en plan for å spare den opp.
                            </p>
                        </div>
                    )}

                    <div className="flex justify-end space-x-3 pt-4">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-4 py-2 text-gray-700 dark:text-gray-300 font-medium hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                        >
                            Avbryt
                        </button>
                        <button
                            type="submit"
                            disabled={loading}
                            className="px-6 py-2 bg-blue-600 text-white font-bold rounded-lg hover:bg-blue-700 transition-colors shadow-sm"
                        >
                            {loading ? 'Lagrer...' : (isEdit ? 'Oppdater' : 'Legg til konto')}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
