import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import { Wallet, LogOut, Menu, X, Moon, Sun } from 'lucide-react';
import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import clsx from 'clsx';

/**
 * Three groups, in the order you use them: Arbeid (where the work happens,
 * household-wide), Resultat (the numbers, presented different ways) and
 * Oppsett. No budget switcher here — the pages that need one (Budsjett,
 * Sparing) carry their own, everything else is household-wide or picks its
 * budget itself.
 */
const NAV_GROUPS = [
    { label: 'Arbeid', items: [
        { to: '/transaksjoner', label: 'Transaksjoner' },
        { to: '/import', label: 'Import' },
    ] },
    { label: 'Resultat', items: [
        { to: '/oversikt', label: 'Min Oversikt' },
        { to: '/oppgjor', label: 'Oppgjør' },
        { to: '/budget', label: 'Budsjett' },
        { to: '/sparing', label: 'Sparing' },
        { to: '/projects', label: 'Prosjekter' },
        { to: '/dagligvarer', label: 'Dagligvarer' },
    ] },
    { label: 'Oppsett', items: [
        { to: '/accounts', label: 'Kontoer' },
        { to: '/settings', label: 'Innstillinger' },
    ] },
];

export default function Header() {
    const { logout, currentUser } = useAuth();
    const { theme, toggleTheme } = useTheme();
    const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
    const location = useLocation();
    const isActive = (path) => location.pathname === path;

    return (
        <header className="bg-blue-600 text-white shadow-md">
            <div className="container mx-auto px-4 h-16 flex items-center justify-between gap-3">
                <Link to="/transaksjoner" className="flex items-center space-x-2 font-bold text-xl flex-shrink-0">
                    <Wallet className="w-6 h-6" />
                    <span className="hidden 2xl:inline">ØkonomiFlyt</span>
                    <span className="2xl:hidden">ØF</span>
                </Link>

                {/* Desktop: three groups separated by a thin line */}
                <nav className="hidden md:flex items-center text-xs lg:text-sm font-medium min-w-0">
                    {NAV_GROUPS.map((g, i) => (
                        <div key={g.label} className={clsx('flex items-center gap-2.5 lg:gap-4', i > 0 && 'ml-2.5 pl-2.5 lg:ml-4 lg:pl-4 border-l border-white/25')}>
                            <span className="text-[10px] uppercase tracking-wider text-white/60 hidden 2xl:inline">{g.label}</span>
                            {g.items.map(item => (
                                <Link key={item.to} to={item.to} className={clsx('hover:text-white/80 transition-colors whitespace-nowrap', isActive(item.to) && 'font-bold underline underline-offset-4')}>
                                    {item.label}
                                </Link>
                            ))}
                        </div>
                    ))}
                </nav>

                <div className="flex items-center space-x-1 lg:space-x-2 flex-shrink-0 ml-2">
                    <div className="hidden 2xl:block text-sm opacity-90">{currentUser?.displayName}</div>
                    <button onClick={logout} className="p-2 hover:bg-white/10 rounded-full transition-colors" title="Logg ut">
                        <LogOut className="w-5 h-5" />
                    </button>
                    <button onClick={toggleTheme} className="p-2 hover:bg-white/10 rounded-full transition-colors" title={theme === 'dark' ? 'Bytt til lyst modus' : 'Bytt til mørkt modus'}>
                        {theme === 'dark' ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
                    </button>
                    <button onClick={() => setIsMobileNavOpen(!isMobileNavOpen)} className="md:hidden p-2 hover:bg-white/10 rounded-full transition-colors" title="Meny">
                        {isMobileNavOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
                    </button>
                </div>
            </div>

            {/* Mobile: three sections with headings */}
            {isMobileNavOpen && (
                <div className="md:hidden border-t border-white/10">
                    <nav className="flex flex-col py-2">
                        {NAV_GROUPS.map(g => (
                            <div key={g.label} className="py-1">
                                <div className="px-4 pt-2 pb-1 text-[11px] uppercase tracking-wider text-white/60 font-semibold">{g.label}</div>
                                {g.items.map(item => (
                                    <Link
                                        key={item.to}
                                        to={item.to}
                                        onClick={() => setIsMobileNavOpen(false)}
                                        className={clsx('block px-4 py-3 text-base font-medium transition-colors', isActive(item.to) ? 'bg-white/10' : 'hover:bg-white/10')}
                                    >
                                        {item.label}
                                    </Link>
                                ))}
                            </div>
                        ))}
                    </nav>
                </div>
            )}
        </header>
    );
}
