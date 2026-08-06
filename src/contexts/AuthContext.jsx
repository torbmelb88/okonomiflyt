import { createContext, useContext, useState, useEffect } from 'react';
import { auth, googleProvider, api, useMock } from '../services/firebase';
import { signInWithPopup, signOut, onAuthStateChanged } from 'firebase/auth';

const AuthContext = createContext();

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
    return useContext(AuthContext);
}

export function AuthProvider({ children }) {
    const [currentUser, setCurrentUser] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (useMock) {
            // Simulate auth check
            api.login().then(user => {
                setCurrentUser(user);
                setLoading(false);
            });
            return;
        }

        const unsubscribe = onAuthStateChanged(auth, (user) => {
            setCurrentUser(user);
            setLoading(false);
        });

        return unsubscribe;
    }, []);

    const login = async () => {
        if (useMock) {
            const user = await api.login();
            setCurrentUser(user);
            return user;
        }
        return signInWithPopup(auth, googleProvider);
    };

    const logout = async () => {
        if (useMock) {
            await api.logout();
            setCurrentUser(null);
            return;
        }
        return signOut(auth);
    };

    const value = {
        currentUser,
        login,
        logout,
        loading
    };

    return (
        <AuthContext.Provider value={value}>
            {!loading && children}
        </AuthContext.Provider>
    );
}
