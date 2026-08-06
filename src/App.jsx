import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { BudgetProvider } from './contexts/BudgetContext';
import { ThemeProvider } from './contexts/ThemeContext';
import Layout from './components/layout/Layout';

// import Dashboard from './components/dashboard/Dashboard'; // Removed
import Settings from './components/settings/Settings';
import Accounts from './components/accounts/Accounts';
import Budget from './components/budget/Budget';
import Forbruk from './components/forbruk/Forbruk';
import Kredittkort from './components/kredittkort/Kredittkort';
import Sparing from './components/sparing/Sparing';
import Oppgjor from './components/oppgjor/Oppgjor';
import MyOverview from './components/overview/MyOverview';
import Projects from './components/projects/Projects';
import Groceries from './components/groceries/Groceries';

// Placeholder components
const Login = () => {
  const { login, currentUser } = useAuth();

  if (currentUser) {
    return <Navigate to="/" />;
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100">
      <div className="text-center space-y-4">
        <h1 className="text-3xl font-bold text-blue-600">ØkonomiFlyt</h1>
        <p className="text-gray-600">Logg inn for å starte</p>
        <button onClick={login} className="bg-blue-600 text-white px-6 py-3 rounded-lg shadow hover:bg-blue-700 transition">
          Logg inn med Google
        </button>
      </div>
    </div>
  );
};

function PrivateRoute({ children }) {
  const { currentUser, loading } = useAuth();
  if (loading) return <div>Laster...</div>;
  return currentUser ? children : <Navigate to="/login" />;
}

function App() {
  return (
    <AuthProvider>
      <ThemeProvider>
        <BudgetProvider>
          <BrowserRouter>
            <Routes>
              <Route path="/login" element={<Login />} />

              <Route path="/" element={
                <PrivateRoute>
                  <Layout />
                </PrivateRoute>
              }>
                <Route index element={<Navigate to="/budget" replace />} />
                <Route path="settings" element={<Settings />} />
                <Route path="accounts" element={<Accounts />} />
                <Route path="budget" element={<Budget />} />
                <Route path="forbruk" element={<Forbruk />} />
                <Route path="kredittkort" element={<Kredittkort />} />
                <Route path="sparing" element={<Sparing />} />
                <Route path="oppgjor" element={<Oppgjor />} />
                <Route path="oversikt" element={<MyOverview />} />
                <Route path="projects" element={<Projects />} />
                <Route path="dagligvarer" element={<Groceries />} />
                {/* Add more routes here */}
              </Route>
            </Routes>
          </BrowserRouter>
        </BudgetProvider>
      </ThemeProvider>
    </AuthProvider>
  );
}

export default App;
