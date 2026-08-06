import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, addDoc, doc, updateDoc, deleteDoc, query, where } from 'firebase/firestore';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { createDemoDb, demoUser } from './demoData';

// Demo mode runs the entire app against an in-memory database — no Firebase
// project or login required. It is enabled explicitly with VITE_DEMO_MODE=true,
// and implicitly when no Firebase config is present (e.g. a fresh clone
// without a .env file), so the repo works out of the box.
export const useMock = import.meta.env.VITE_DEMO_MODE === 'true'
    || !import.meta.env.VITE_FIREBASE_API_KEY;

const firebaseConfig = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID,
    measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID
};

const app = useMock ? null : initializeApp(firebaseConfig);
export const db = useMock ? null : getFirestore(app);
export const auth = useMock ? null : getAuth(app);
export const googleProvider = useMock ? null : new GoogleAuthProvider();

// --- MOCK SERVICE ---
// Mimics the Firestore wrappers below against the in-memory demo dataset.

const MOCK_DELAY = 150;
const mockDb = useMock ? createDemoDb() : null;

export const MockService = {
    getCollection: async (collectionName) => {
        await new Promise(resolve => setTimeout(resolve, MOCK_DELAY));
        // Filtering happens in the contexts, so we just return the full collection
        return mockDb[collectionName] || [];
    },

    // Equivalent of query(collection, where(field, '==', value))
    queryCollection: async (collectionName, field, value) => {
        await new Promise(resolve => setTimeout(resolve, MOCK_DELAY));
        return (mockDb[collectionName] || []).filter(item => item[field] === value);
    },

    addDocument: async (collectionName, data) => {
        await new Promise(resolve => setTimeout(resolve, MOCK_DELAY));
        const newDoc = { id: Math.random().toString(36).substr(2, 9), ...data };
        if (!mockDb[collectionName]) mockDb[collectionName] = [];
        mockDb[collectionName].push(newDoc);
        return newDoc;
    },

    updateDocument: async (collectionName, id, data) => {
        await new Promise(resolve => setTimeout(resolve, MOCK_DELAY));
        const list = mockDb[collectionName];
        const index = list.findIndex(item => item.id === id);
        if (index !== -1) {
            mockDb[collectionName][index] = { ...list[index], ...data };
            return mockDb[collectionName][index];
        }
        throw new Error('Document not found');
    },

    deleteDocument: async (collectionName, id) => {
        await new Promise(resolve => setTimeout(resolve, MOCK_DELAY));
        const list = mockDb[collectionName];
        const index = list.findIndex(item => item.id === id);
        if (index !== -1) {
            mockDb[collectionName].splice(index, 1);
            return true;
        }
        throw new Error('Document not found');
    },

    login: async () => {
        await new Promise(resolve => setTimeout(resolve, MOCK_DELAY));
        return demoUser;
    },

    logout: async () => {
        await new Promise(resolve => setTimeout(resolve, MOCK_DELAY));
        return true;
    }
};

export const api = useMock ? MockService : {
    // Real Firebase wrappers
    getCollection: async (colName) => {
        const querySnapshot = await getDocs(collection(db, colName));
        return querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    },
    queryCollection: async (colName, field, value) => {
        const q = query(collection(db, colName), where(field, '==', value));
        const querySnapshot = await getDocs(q);
        return querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    },
    addDocument: async (colName, data) => addDoc(collection(db, colName), data),
    updateDocument: async (colName, id, data) => updateDoc(doc(db, colName, id), data),
    deleteDocument: async (colName, id) => deleteDoc(doc(db, colName, id)),
    // Helper for login/logout is handled directly in AuthContext via auth object,
    // but for consistency we could wrap them here if needed.
    // AuthContext uses `auth` directly for real firebase.
};
