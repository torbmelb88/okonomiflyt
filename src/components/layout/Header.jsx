import { useBudget } from '../../contexts/BudgetContext';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import { ChevronDown, Wallet, Users, LogOut, Menu, X, Moon, Sun } from 'lucide-react';
import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import clsx from 'clsx';
import CreateBudgetModal from '../budget/CreateBudgetModal';

export default function Header() {
    const { activeBudget, budgets, switchBudget, createBudget } = useBudget();
    const { logout, currentUser } = useAuth();
    const { theme, toggleTheme } = useTheme();
    const [isMenuOpen, setIsMenuOpen] = useState(false);
    const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
    const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
    const location = useLocation();

    const isActive = (path) => location.pathname === path;

    const isShared = activeBudget?.type === 'shared';

    // Dynamic theme based on budget type
    const themeColor = isShared ? 'bg-purple-600' : 'bg-blue-600';

    return (
        <>
            <header className={clsx("text-white shadow-md transition-colors duration-300", themeColor)}>
                <div className="container mx-auto px-4 h-16 flex items-center justify-between gap-2">

                    {/* Logo / Brand */}
                    <div className="flex items-center space-x-2 font-bold text-xl flex-shrink-0">
                        <Wallet className="w-6 h-6" />
                        <span className="hidden sm:inline">ØkonomiFlyt</span>
                        <span className="sm:hidden">ØF</span>
                    </div>

                    {/* Budget Selector (Central Dropdown) */}
                    <div className="relative flex-1 flex justify-center max-w-xs">
                        <button
                            onClick={() => setIsMenuOpen(!isMenuOpen)}
                            className={clsx(
                                "flex items-center space-x-2 px-3 md:px-4 py-2 rounded-lg transition-colors font-medium",
                                "bg-white/10 hover:bg-white/20 text-sm md:text-base"
                            )}
                        >
                            {activeBudget?.type === 'shared' ? <Users className="w-4 h-4" /> : <Wallet className="w-4 h-4" />}
                            <span className="truncate max-w-[120px] md:max-w-none">{activeBudget?.name || 'Velg Budsjett'}</span>
                            <ChevronDown className="w-4 h-4 flex-shrink-0" />
                        </button>

                        {isMenuOpen && (
                            <div
                                className="fixed inset-0 z-40"
                                onClick={() => setIsMenuOpen(false)}
                            />
                        )}
                        {isMenuOpen && (
                            <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 w-64 bg-white rounded-lg shadow-xl py-2 text-gray-800 z-50">
                                <div className="px-4 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wider">
                                    Dine Budsjett
                                </div>

                                {budgets.map(budget => (
                                    <button
                                        key={budget.id}
                                        onClick={() => {
                                            switchBudget(budget.id);
                                            setIsMenuOpen(false);
                                        }}
                                        className={clsx(
                                            "w-full text-left px-4 py-3 flex items-center space-x-3 hover:bg-gray-50 transition-colors",
                                            activeBudget?.id === budget.id && "bg-blue-50 text-blue-600"
                                        )}
                                    >
                                        {budget.type === 'shared' ?
                                            <Users className="w-5 h-5 text-purple-500" /> :
                                            <Wallet className="w-5 h-5 text-blue-500" />
                                        }
                                        <div>
                                            <div className="font-medium">{budget.name}</div>
                                            <div className="text-xs text-gray-500 capitalize">{budget.type === 'shared' ? 'Fellesøkonomi' : 'Privatøkonomi'}</div>
                                        </div>
                                    </button>
                                ))}

                                <div className="border-t my-2"></div>
                                <button
                                    onClick={() => {
                                        setIsMenuOpen(false);
                                        setIsCreateModalOpen(true);
                                    }}
                                    className="w-full text-left px-4 py-2 text-sm text-blue-600 hover:bg-gray-50 font-medium"
                                >
                                    + Opprett nytt budsjett
                                </button>
                            </div>
                        )}
                    </div>

                    {/* Navigation Links - Desktop */}
                    <nav className="hidden md:flex items-center space-x-6 text-sm font-medium">
                        {activeBudget?.type === 'personal' && (
                            <Link to="/oversikt" className={`hover:text-white/80 transition-colors ${isActive('/oversikt') ? 'font-bold' : ''}`}>Min Oversikt</Link>
                        )}
                        <Link to="/budget" className={`hover:text-white/80 transition-colors ${isActive('/budget') ? 'font-bold' : ''}`}>Budsjett</Link>
                        <Link to="/forbruk" className={`hover:text-white/80 transition-colors ${isActive('/forbruk') ? 'font-bold' : ''}`}>Forbruk</Link>
                        <Link to="/sparing" className={`hover:text-white/80 transition-colors ${isActive('/sparing') ? 'font-bold' : ''}`}>Sparing</Link>
                        <Link to="/oppgjor" className={`hover:text-white/80 transition-colors ${isActive('/oppgjor') ? 'font-bold' : ''}`}>Oppgjør</Link>
                        <Link to="/projects" className={`hover:text-white/80 transition-colors ${isActive('/projects') ? 'font-bold' : ''}`}>Prosjekter</Link>
                        <Link to="/dagligvarer" className={`hover:text-white/80 transition-colors ${isActive('/dagligvarer') ? 'font-bold' : ''}`}>Dagligvarer</Link>
                        <Link to="/import" className={`hover:text-white/80 transition-colors ${isActive('/import') ? 'font-bold' : ''}`}>Import</Link>
                        <Link to="/accounts" className={`hover:text-white/80 transition-colors ${isActive('/accounts') ? 'font-bold' : ''}`}>Kontoer</Link>
                        <Link to="/settings" className={`hover:text-white/80 transition-colors ${isActive('/settings') ? 'font-bold' : ''}`}>Innstillinger</Link>
                    </nav>
                    {/* User Actions */}
                    <div className="flex items-center space-x-2 flex-shrink-0">
                        <div className="hidden md:block text-sm opacity-90">
                            {currentUser?.displayName}
                        </div>
                        <button
                            onClick={logout}
                            className="p-2 hover:bg-white/10 rounded-full transition-colors"
                            title="Logg ut"
                        >
                            <LogOut className="w-5 h-5" />
                        </button>

                        <button
                            onClick={toggleTheme}
                            className="p-2 hover:bg-white/10 rounded-full transition-colors"
                            title={theme === 'dark' ? 'Bytt til lyst modus' : 'Bytt til mørkt modus'}
                        >
                            {theme === 'dark' ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
                        </button>

                        {/* Mobile Menu Toggle */}
                        <button
                            onClick={() => setIsMobileNavOpen(!isMobileNavOpen)}
                            className="md:hidden p-2 hover:bg-white/10 rounded-full transition-colors"
                            title="Meny"
                        >
                            {isMobileNavOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
                        </button>
                    </div>
                </div>

                {/* Mobile Navigation */}
                {isMobileNavOpen && (
                    <div className="md:hidden border-t border-white/10">
                        <nav className="flex flex-col py-2">

                            {/* Only show Min Oversikt for Personal Budgets */}
                            {activeBudget?.type === 'personal' && (
                                <Link
                                    to="/oversikt"
                                    onClick={() => setIsMobileNavOpen(false)}
                                    className={clsx(
                                        "block px-4 py-3 rounded-lg text-base font-medium transition-colors",
                                        isActive('/oversikt')
                                            ? "bg-white/10"
                                            : "hover:bg-white/10"
                                    )}
                                >
                                    Min Oversikt
                                </Link>
                            )}

                            <Link
                                to="/budget"
                                onClick={() => setIsMobileNavOpen(false)}
                                className={clsx(
                                    "block px-4 py-3 rounded-lg text-base font-medium transition-colors",
                                    isActive('/budget')
                                        ? "bg-white/10"
                                        : "hover:bg-white/10"
                                )}
                            >
                                Budsjett
                            </Link>

                            <Link
                                to="/forbruk"
                                onClick={() => setIsMobileNavOpen(false)}
                                className={clsx(
                                    "block px-4 py-3 rounded-lg text-base font-medium transition-colors",
                                    isActive('/forbruk') ? "bg-white/10" : "hover:bg-white/10"
                                )}
                            >
                                Forbruk
                            </Link>

                            <Link
                                to="/sparing"
                                onClick={() => setIsMobileNavOpen(false)}
                                className={clsx(
                                    "block px-4 py-3 rounded-lg text-base font-medium transition-colors",
                                    isActive('/sparing') ? "bg-white/10" : "hover:bg-white/10"
                                )}
                            >
                                Sparing
                            </Link>

                            <Link
                                to="/oppgjor"
                                onClick={() => setIsMobileNavOpen(false)}
                                className={clsx(
                                    "block px-4 py-3 rounded-lg text-base font-medium transition-colors",
                                    isActive('/oppgjor') ? "bg-white/10" : "hover:bg-white/10"
                                )}
                            >
                                Oppgjør
                            </Link>
                            <Link
                                to="/projects"
                                onClick={() => setIsMobileNavOpen(false)}
                                className={clsx(
                                    "block px-4 py-3 rounded-lg text-base font-medium transition-colors",
                                    isActive('/projects')
                                        ? "bg-white/10"
                                        : "hover:bg-white/10"
                                )}
                            >
                                Prosjekter
                            </Link>
                            <Link
                                to="/dagligvarer"
                                onClick={() => setIsMobileNavOpen(false)}
                                className={clsx(
                                    "block px-4 py-3 rounded-lg text-base font-medium transition-colors",
                                    isActive('/dagligvarer')
                                        ? "bg-white/10"
                                        : "hover:bg-white/10"
                                )}
                            >
                                Dagligvarer
                            </Link>
                            <Link
                                to="/import"
                                onClick={() => setIsMobileNavOpen(false)}
                                className={clsx(
                                    "block px-4 py-3 rounded-lg text-base font-medium transition-colors",
                                    isActive('/import') ? "bg-white/10" : "hover:bg-white/10"
                                )}
                            >
                                Import
                            </Link>
                            <Link
                                to="/accounts"
                                onClick={() => setIsMobileNavOpen(false)}
                                className={clsx(
                                    "block px-4 py-3 rounded-lg text-base font-medium transition-colors",
                                    isActive('/accounts')
                                        ? "bg-white/10"
                                        : "hover:bg-white/10"
                                )}
                            >
                                Kontoer
                            </Link>
                            <Link
                                to="/settings"
                                className="px-4 py-3 hover:bg-white/10 transition-colors"
                                onClick={() => setIsMobileNavOpen(false)}
                            >
                                Innstillinger
                            </Link>
                        </nav>
                    </div>
                )}
            </header>

            <CreateBudgetModal
                isOpen={isCreateModalOpen}
                onClose={() => setIsCreateModalOpen(false)}
                onCreate={createBudget}
            />
        </>
    );
}
