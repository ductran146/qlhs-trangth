/**
 * shared/firebase.js  — v2
 *
 * Thay đổi quan trọng so với v1:
 *  - Bỏ persistentLocalCache + persistentMultipleTabManager.
 *    Lý do: IndexedDB cache là per-browser, dẫn đến mỗi trình duyệt thấy
 *    dữ liệu khác nhau khi offline/cache stale. store.js v2 tự quản lý
 *    localStorage bootstrap cache — không cần Firestore IndexedDB.
 *  - Dùng memoryLocalCache để Firestore luôn lấy dữ liệu từ server trước,
 *    không bị ảnh hưởng bởi IndexedDB cũ.
 *  - Auth persistence vẫn dùng browserLocalPersistence (giữ login qua reload).
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
  apiKey:            'AIzaSyB9TmyC68UE5Mr85yr3tZN1F5ZUGF1y_LU',
  authDomain:        'qlhs-trangth-tre-dac-biet.firebaseapp.com',
  projectId:         'qlhs-trangth-tre-dac-biet',
  storageBucket:     'qlhs-trangth-tre-dac-biet.firebasestorage.app',
  messagingSenderId: '1016064161628',
  appId:             '1:1016064161628:web:6b8571e6fba3540f2fb399',
  measurementId:     'G-FTDVHCPCFS'
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

// memoryLocalCache: không dùng IndexedDB, mỗi lần load app lấy thẳng từ server.
// store.js bootstrap cache (localStorage) đã đảm nhiệm vai trò hiển thị nhanh.
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
