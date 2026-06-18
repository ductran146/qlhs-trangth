/**
 * shared/firebase.js
 * Firebase app, Auth and Firestore setup for the static ES module app.
 * Uses CDN modules so the project can run on GitHub Pages without npm/bundler.
 *
 * Firestore is configured with its own IndexedDB local cache so the app can
 * open quickly on mobile while still using Firestore as the source of truth.
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
  getFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  collection,
  doc,
  getDocs,
  setDoc,
  deleteDoc,
  onSnapshot,
  writeBatch
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

const firebaseConfig = {
  apiKey: 'AIzaSyB9TmyC68UE5Mr85yr3tZN1F5ZUGF1y_LU',
  authDomain: 'qlhs-trangth-tre-dac-biet.firebaseapp.com',
  projectId: 'qlhs-trangth-tre-dac-biet',
  storageBucket: 'qlhs-trangth-tre-dac-biet.firebasestorage.app',
  messagingSenderId: '1016064161628',
  appId: '1:1016064161628:web:6b8571e6fba3540f2fb399',
  measurementId: 'G-FTDVHCPCFS'
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

let firestoreDb;
try {
  firestoreDb = initializeFirestore(app, {
    localCache: persistentLocalCache({
      tabManager: persistentMultipleTabManager()
    })
  });
} catch (err) {
  console.warn('[firebase] Firestore persistent cache không bật được, fallback về cache mặc định:', err);
  firestoreDb = getFirestore(app);
}

export const db = firestoreDb;

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
