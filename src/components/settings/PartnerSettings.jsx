import { useBudget } from '../../contexts/BudgetContext';
import { useState, useEffect } from 'react';
import { Users, Save, DollarSign, Calculator, Percent, Coins } from 'lucide-react';

export default function PartnerSettings() {
    const { activeBudget, updateBudget, currentUser, loading } = useBudget();

    // State
    const [myIncome, setMyIncome] = useState('');
    const [partnerName, setPartnerName] = useState('');
    const [partnerIncome, setPartnerIncome] = useState('');
    const [isPassive, setIsPassive] = useState(true);
    const [splitMethod, setSplitMethod] = useState('income'); // 'income', '5050', 'custom'
    const [customUserShare, setCustomUserShare] = useState(50);
    const [roundingMode, setRoundingMode] = useState(() => parseInt(localStorage.getItem('roundingMode') || '1'));
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (activeBudget && activeBudget.type === 'shared') {
            // My details
            const myMember = activeBudget.members.find(m => m.uid === currentUser?.uid);
            if (myMember) {
                setMyIncome(myMember.income || '');
            }

            // Partner details
            const partner = activeBudget.members.find(m => m.uid !== currentUser?.uid);
            if (partner) {
                setPartnerName(partner.name || '');
                setPartnerIncome(partner.income || '');
                setIsPassive(partner.isPassive || false); // Note: isPassive logic might need to be on the partner member object
            }

            // Budget settings
            setSplitMethod(activeBudget.splitMethod || 'income');
            setCustomUserShare(activeBudget.customUserShare || 50);
        }
    }, [activeBudget, currentUser]);

    if (loading) return <div>Laster...</div>;
    if (!activeBudget || activeBudget.type !== 'shared') {
        return (
            <div className="p-8 text-center text-gray-500 dark:text-gray-400">
                Disse innstillingene gjelder kun for fellesbudsjett.
            </div>
        );
    }

    const handleSave = async (e) => {
        e.preventDefault();
        setSaving(true);
        try {
            // 1. Construct updated members array
            const updatedMembers = activeBudget.members.map(m => {
                if (m.uid === currentUser.uid) {
                    return { ...m, income: Number(myIncome) };
                } else {
                    return {
                        ...m,
                        name: partnerName,
                        income: Number(partnerIncome),
                        isPassive: isPassive
                    };
                }
            });

            // Ensure partner exists if not present (for single-user shared budgets)
            const hasPartner = updatedMembers.some(m => m.uid !== currentUser.uid);
            if (!hasPartner) {
                updatedMembers.push({
                    uid: 'passive_partner', // Placeholder ID
                    role: 'member',
                    name: partnerName,
                    income: Number(partnerIncome),
                    isPassive: isPassive
                });
            }

            // 2. Prepare budget updata data
            const updateData = {
                members: updatedMembers,
                splitMethod,
                customUserShare: Number(customUserShare)
            };

            localStorage.setItem('roundingMode', String(roundingMode));

            await updateBudget(activeBudget.id, updateData);
            alert('Innstillinger lagret!');
        } catch (error) {
            console.error("Failed to save settings:", error);
            alert('Kunne ikke lagre innstillinger.');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="max-w-3xl mx-auto space-y-6">
            <div className="bg-white dark:bg-gray-800 p-8 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700">
                <div className="flex items-center space-x-3 mb-6">
                    <div className="p-3 bg-purple-100 dark:bg-purple-900/20 rounded-full">
                        <Users className="w-6 h-6 text-purple-600 dark:text-purple-400" />
                    </div>
                    <div>
                        <h2 className="text-xl font-bold text-gray-900 dark:text-white">Økonomiske Innstillinger</h2>
                        <p className="text-sm text-gray-500 dark:text-gray-400">Administrer inntekter og fordeling</p>
                    </div>
                </div>

                <form onSubmit={handleSave} className="space-y-8">

                    {/* Incomes Section */}
                    <div>
                        <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-4 flex items-center">
                            <DollarSign className="w-5 h-5 mr-2 text-gray-500" />
                            Inntekter (Netto Månedlig)
                        </h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                    Min Inntekt
                                </label>
                                <input
                                    type="number"
                                    value={myIncome}
                                    onChange={(e) => setMyIncome(e.target.value)}
                                    className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent dark:bg-gray-700 dark:text-white outline-none"
                                    placeholder="0"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                    Partner Inntekt ({partnerName || 'Partner'})
                                </label>
                                <input
                                    type="number"
                                    value={partnerIncome}
                                    onChange={(e) => setPartnerIncome(e.target.value)}
                                    className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent dark:bg-gray-700 dark:text-white outline-none"
                                    placeholder="0"
                                />
                            </div>
                        </div>
                    </div>

                    <div className="border-t border-gray-100 dark:border-gray-700 my-6"></div>

                    {/* Split Method Section */}
                    <div>
                        <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-4 flex items-center">
                            <Calculator className="w-5 h-5 mr-2 text-gray-500" />
                            Fordeling av Fellesutgifter
                        </h3>

                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                            <label className={`cursor-pointer border dark:border-gray-600 rounded-xl p-4 flex flex-col items-center justify-center space-y-2 transition-all ${splitMethod === 'income' ? 'bg-purple-50 dark:bg-purple-900/20 border-purple-200 dark:border-purple-500/50 ring-2 ring-purple-500 ring-offset-2 dark:ring-offset-gray-800' : 'hover:bg-gray-50 dark:hover:bg-gray-700/50'}`}>
                                <input
                                    type="radio"
                                    name="splitMethod"
                                    value="income"
                                    checked={splitMethod === 'income'}
                                    onChange={(e) => setSplitMethod(e.target.value)}
                                    className="sr-only"
                                />
                                <span className={`font-medium ${splitMethod === 'income' ? 'text-purple-700 dark:text-purple-300' : 'text-gray-700 dark:text-gray-300'}`}>Etter Inntekt</span>
                            </label>

                            <label className={`cursor-pointer border dark:border-gray-600 rounded-xl p-4 flex flex-col items-center justify-center space-y-2 transition-all ${splitMethod === '5050' ? 'bg-purple-50 dark:bg-purple-900/20 border-purple-200 dark:border-purple-500/50 ring-2 ring-purple-500 ring-offset-2 dark:ring-offset-gray-800' : 'hover:bg-gray-50 dark:hover:bg-gray-700/50'}`}>
                                <input
                                    type="radio"
                                    name="splitMethod"
                                    value="5050"
                                    checked={splitMethod === '5050'}
                                    onChange={(e) => setSplitMethod(e.target.value)}
                                    className="sr-only"
                                />
                                <span className={`font-medium ${splitMethod === '5050' ? 'text-purple-700 dark:text-purple-300' : 'text-gray-700 dark:text-gray-300'}`}>50 / 50</span>
                            </label>

                            <label className={`cursor-pointer border dark:border-gray-600 rounded-xl p-4 flex flex-col items-center justify-center space-y-2 transition-all ${splitMethod === 'custom' ? 'bg-purple-50 dark:bg-purple-900/20 border-purple-200 dark:border-purple-500/50 ring-2 ring-purple-500 ring-offset-2 dark:ring-offset-gray-800' : 'hover:bg-gray-50 dark:hover:bg-gray-700/50'}`}>
                                <input
                                    type="radio"
                                    name="splitMethod"
                                    value="custom"
                                    checked={splitMethod === 'custom'}
                                    onChange={(e) => setSplitMethod(e.target.value)}
                                    className="sr-only"
                                />
                                <span className={`font-medium ${splitMethod === 'custom' ? 'text-purple-700 dark:text-purple-300' : 'text-gray-700 dark:text-gray-300'}`}>Egendefinert</span>
                            </label>
                        </div>

                        {splitMethod === 'custom' && (
                            <div className="mt-6 p-4 bg-gray-50 dark:bg-gray-700/30 rounded-lg animate-in fade-in slide-in-from-top-2">
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                    Din andel av fellesutgifter (%)
                                </label>
                                <div className="flex items-center space-x-4">
                                    <input
                                        type="range"
                                        min="0"
                                        max="100"
                                        value={customUserShare}
                                        onChange={(e) => setCustomUserShare(e.target.value)}
                                        className="w-full h-2 bg-gray-200 dark:bg-gray-600 rounded-lg appearance-none cursor-pointer accent-purple-600"
                                    />
                                    <div className="w-20 relative">
                                        <input
                                            type="number"
                                            min="0"
                                            max="100"
                                            value={customUserShare}
                                            onChange={(e) => setCustomUserShare(e.target.value)}
                                            className="w-full px-3 py-1 border border-gray-300 dark:border-gray-600 rounded-lg text-center dark:bg-gray-700 dark:text-white outline-none focus:ring-2 focus:ring-purple-500"
                                        />
                                        <Percent className="w-3 h-3 text-gray-400 absolute right-2 top-2" />
                                    </div>
                                </div>
                                <p className="text-sm text-gray-500 dark:text-gray-400 mt-2 text-center">
                                    Du betaler <span className="font-bold text-gray-900 dark:text-gray-100">{customUserShare}%</span>, partner betaler <span className="font-bold text-gray-900 dark:text-gray-100">{100 - customUserShare}%</span>
                                </p>
                            </div>
                        )}
                    </div>

                    <div className="border-t border-gray-100 dark:border-gray-700 my-6"></div>

                    {/* Rounding Section */}
                    <div>
                        <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-4 flex items-center">
                            <Coins className="w-5 h-5 mr-2 text-gray-500" />
                            Avrunding av Overføringer
                        </h3>
                        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                            Rund opp beløpene hver av dere skal overføre til nærmeste valgte beløp.
                        </p>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                            {[
                                { value: 1, label: 'Ingen' },
                                { value: 10, label: '10 kr' },
                                { value: 50, label: '50 kr' },
                                { value: 100, label: '100 kr' },
                            ].map((opt) => (
                                <label key={opt.value} className={`cursor-pointer border dark:border-gray-600 rounded-xl p-4 flex flex-col items-center justify-center space-y-2 transition-all ${roundingMode === opt.value ? 'bg-purple-50 dark:bg-purple-900/20 border-purple-200 dark:border-purple-500/50 ring-2 ring-purple-500 ring-offset-2 dark:ring-offset-gray-800' : 'hover:bg-gray-50 dark:hover:bg-gray-700/50'}`}>
                                    <input
                                        type="radio"
                                        name="roundingMode"
                                        value={opt.value}
                                        checked={roundingMode === opt.value}
                                        onChange={() => setRoundingMode(opt.value)}
                                        className="sr-only"
                                    />
                                    <span className={`font-medium ${roundingMode === opt.value ? 'text-purple-700 dark:text-purple-300' : 'text-gray-700 dark:text-gray-300'}`}>{opt.label}</span>
                                </label>
                            ))}
                        </div>
                    </div>

                    <div className="border-t border-gray-100 dark:border-gray-700 my-6"></div>

                    {/* Partner role */}
                    <div className="space-y-4">
                        <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-4">Partner Profil</h3>
                        <label className="flex items-center space-x-3 p-4 border border-gray-200 dark:border-gray-700 rounded-lg cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                            <input
                                type="checkbox"
                                checked={isPassive}
                                onChange={(e) => setIsPassive(e.target.checked)}
                                className="w-5 h-5 text-purple-600 rounded focus:ring-purple-500 dark:bg-gray-700 dark:border-gray-600"
                            />
                            <div>
                                <span className="font-medium text-gray-900 dark:text-white">Passiv Partner</span>
                                <p className="text-xs text-gray-500 dark:text-gray-400">Partneren bruker ikke appen selv. Du legger inn tallene.</p>
                            </div>
                        </label>

                        <div className="mt-4">
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Partnerens Navn</label>
                            <input
                                type="text"
                                value={partnerName}
                                onChange={(e) => setPartnerName(e.target.value)}
                                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent dark:bg-gray-700 dark:text-white outline-none"
                                placeholder="F.eks. Ola"
                            />
                        </div>
                    </div>

                    <div className="pt-4 border-t border-gray-100 dark:border-gray-700">
                        <button
                            type="submit"
                            disabled={saving}
                            className="flex items-center justify-center space-x-2 w-full md:w-auto px-6 py-3 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors font-medium disabled:bg-gray-400 disabled:cursor-not-allowed shadow-sm"
                        >
                            <Save className="w-4 h-4" />
                            <span>{saving ? 'Lagrer...' : 'Lagre Endringer'}</span>
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
