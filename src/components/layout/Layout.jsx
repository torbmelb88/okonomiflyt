import { Outlet } from 'react-router-dom';
import Header from './Header';

export default function Layout() {
    return (
        <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex flex-col">
            <Header />
            <main className="flex-1 container mx-auto px-4 py-8">
                <Outlet />
            </main>
        </div>
    );
}
