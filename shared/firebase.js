/**
 * shared/firebase.js  — v3 (new project: qlhs-trangth-canthiep)
 */

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  setPersistence,
  browserLocalPersistence
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {
  initializeFirestore,
  memoryLocalCache,
  collection,
  doc,
  getDocs,
  setDoc,
  deleteDoc,
  onSnapshot,
  writeBatch
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

const firebaseConfig = {
  apiKey:            'AIzaSyCZBDBqqv4oXfiVI8HrN5gXzAGfGxWVPLs',
  authDomain:        'qlhs-trangth-canthiep.firebaseapp.com',
  projectId:         'qlhs-trangth-canthiep',
  storageBucket:     'qlhs-trangth-canthiep.firebasestorage.app',
  messagingSenderId: '799840668287',
  appId:             '1:799840668287:web:f8d4598042d8ab36094d4a'
};

export const app  = initializeApp(firebaseConfig);
export const auth = getAuth(app);

export const db = initializeFirestore(app, {
  localCache: memoryLocalCache()
});

setPersistence(auth, browserLocalPersistence).catch((err) => {
  console.warn('[firebase] Không set được auth persistence:', err);
});

export {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  collection,
  doc,
  getDocs,
  setDoc,
  deleteDoc,
  onSnapshot,
  writeBatch
};
