import { useState } from 'react';
import { X, Check, SkipForward, ArrowRight, AlertCircle } from 'lucide-react';

export default function DuplicateReviewModal({ isOpen, onClose, duplicates, onComplete }) {
    const [currentIndex, setCurrentIndex] = useState(0);
    const [decisions, setDecisions] = useState({}); // { index: 'import' | 'skip' }

    if (!isOpen || duplicates.length === 0) return null;

    const currentItem = duplicates[currentIndex];
    const isLast = currentIndex === duplicates.length - 1;
    // Currency pair: the existing copy was logged abroad in foreign currency,
    // the imported row (CSV/faktura) is the bank's converted NOK amount — different numbers by design.
    const existingCurrency = currentItem.existing.currency && currentItem.existing.currency !== 'NOK'
        ? currentItem.existing.currency : null;

    const handleDecision = (decision) => {
        setDecisions(prev => ({
            ...prev,
            [currentIndex]: decision
        }));

        if (isLast) {
            finalizeDecisions({ ...decisions, [currentIndex]: decision });
        } else {
            setCurrentIndex(prev => prev + 1);
        }
    };

    const finalizeDecisions = (finalDecisions) => {
        // Return structured actions
        const approvedActions = duplicates.map((dup, index) => {
            return {
                action: finalDecisions[index],
                ...dup
            };
        }).filter(item => item.action && item.action !== 'skip');
        onComplete(approvedActions);
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-2xl overflow-hidden animate-in fade-in zoom-in duration-200">
                <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between bg-orange-50 dark:bg-orange-900/20">
                    <div className="flex items-center space-x-2">
                        <AlertCircle className="w-5 h-5 text-orange-600 dark:text-orange-400" />
                        <div>
                            <h2 className="text-lg font-bold text-gray-900 dark:text-white">Se gjennom mulige duplikater</h2>
                            <p className="text-sm text-gray-500 dark:text-gray-400">
                                {currentIndex + 1} av {duplicates.length}
                            </p>
                        </div>
                    </div>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="p-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-stretch">

                        {/* New Transaction */}
                        <div className="bg-green-50 dark:bg-green-900/20 border border-green-100 dark:border-green-800 rounded-xl p-4 flex flex-col">
                            <div className="text-xs font-bold text-green-700 dark:text-green-400 uppercase tracking-wider mb-2">Ny transaksjon (import)</div>
                            <div className="flex-1">
                                <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-1">{currentItem.new.name}</h3>
                                <div className="text-sm text-gray-500 dark:text-gray-400 mb-3">{currentItem.new.date}</div>
                                <div className="text-2xl font-bold text-green-600 dark:text-green-400">
                                    {currentItem.new.amount.toLocaleString('no-NO')} kr
                                </div>
                            </div>
                        </div>

                        {/* Existing Transaction */}
                        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800 rounded-xl p-4 flex flex-col relative">
                            <div className="absolute -left-3 top-1/2 transform -translate-y-1/2 bg-white dark:bg-gray-700 rounded-full p-1 border border-gray-200 dark:border-gray-600 shadow-sm hidden md:block">
                                <ArrowRight className="w-4 h-4 text-gray-400" />
                            </div>
                            <div className="text-xs font-bold text-blue-700 dark:text-blue-400 uppercase tracking-wider mb-2">Eksisterende (Database)</div>
                            <div className="flex-1">
                                <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-1">{currentItem.existing.name}</h3>
                                <div className="text-sm text-gray-500 dark:text-gray-400 mb-3">{currentItem.existing.date}</div>
                                <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                                    {currentItem.existing.amount.toLocaleString('no-NO')} {existingCurrency || 'kr'}
                                </div>
                                {currentItem.existing.comment && (
                                    <div className="mt-2 text-sm text-blue-700 dark:text-blue-300 italic">
                                        💬 {currentItem.existing.comment}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    {existingCurrency && (
                        <p className="mt-4 text-sm text-sky-700 dark:text-sky-300 bg-sky-50 dark:bg-sky-900/20 border border-sky-200 dark:border-sky-800 rounded-lg px-3 py-2">
                            Valutatreff: beløpene er ulike fordi kjøpet ble logget i {existingCurrency} og banken har vekslet til NOK.
                            «Knytt sammen» lar bankbeløpet ta over og beholder {existingCurrency}-beløpet som referanse.
                        </p>
                    )}
                    <div className="mt-8 flex justify-center space-x-4 flex-wrap gap-y-4">
                        <button
                            onClick={() => handleDecision('skip')}
                            className="px-6 py-3 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 font-medium rounded-xl hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors flex items-center"
                        >
                            <SkipForward className="w-5 h-5 mr-2" />
                            Hopp over
                        </button>
                        <button
                            onClick={() => handleDecision('merge')}
                            className="px-6 py-3 bg-purple-600 text-white font-medium rounded-xl hover:bg-purple-700 shadow-lg shadow-purple-500/30 transition-all flex items-center"
                        >
                            <ArrowRight className="w-5 h-5 mr-2" />
                            Knytt sammen (Avstem)
                        </button>
                        <button
                            onClick={() => handleDecision('import')}
                            className="px-6 py-3 bg-blue-600 text-white font-medium rounded-xl hover:bg-blue-700 shadow-lg shadow-blue-500/30 transition-all flex items-center"
                        >
                            <Check className="w-5 h-5 mr-2" />
                            Importer som ny
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
