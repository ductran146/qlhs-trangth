/**
 * shared/auth.js
 * Firebase Authentication gate.
 * UI keeps the default account: user trangth / pass 123456
 * Internally maps to Firebase Auth email: trangth.140688@gmail.com
 *
 * v2: logout() gọi Store.reset() để xóa listeners + cache.
 */

import {
  auth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut
} from './firebase.js';

const RETURN_KEY = 'nkct_auth_return_to';

const DEFAULT_ACCOUNT = Object.freeze({
  username: 'trangth',
  email: 'trangth.140688@gmail.com',
  displayName: 'Trang Th'
});

let _firebaseUser = null;
let _readyResolve;
let _readyReject;
const _readyPromise = new Promise((resolve, reject) => {
  _readyResolve = resolve;
  _readyReject  = reject;
});

onAuthStateChanged(
  auth,
  (user) => {
    _firebaseUser = user;
    _readyResolve(user);
  },
  (error) => {
    console.error('[auth] onAuthStateChanged error:', error);
    _readyReject(error);
  }
);

function _resolveEmail(username) {
  const value = String(username || '').trim();
  if (value === DEFAULT_ACCOUNT.username) return DEFAULT_ACCOUNT.email;
  return value.includes('@') ? value : value;
}

export const Auth = {
  defaultAccount: DEFAULT_ACCOUNT,

  async ready() {
    return _readyPromise;
  },

  async login(username, password) {
    const email = _resolveEmail(username);
    try {
      await signInWithEmailAndPassword(auth, email, String(password || ''));
      return true;
    } catch (error) {
      console.warn('[auth] Login failed:', error?.code || error);
      return false;
    }
  },

  /**
   * Đăng xuất: reset Store trước để dọn listeners + cache, sau đó sign out Firebase.
   */
  async logout() {
    localStorage.removeItem(RETURN_KEY);
    // Reset Store (xóa Firestore listeners, in-memory cache, localStorage cache)
    try {
      const { Store } = await import('./store.js');
      Store.reset();
    } catch (_) {}
    await signOut(auth);
  },

  currentUser() {
    if (!_firebaseUser) return null;
    return {
      uid:         _firebaseUser.uid,
      email:       _firebaseUser.email,
      username:    _firebaseUser.email === DEFAULT_ACCOUNT.email
                     ? DEFAULT_ACCOUNT.username
                     : _firebaseUser.email,
      displayName: DEFAULT_ACCOUNT.displayName,
      teacherId:   _firebaseUser.uid
    };
  },

  isLoggedIn() {
    return Boolean(_firebaseUser);
  },

  setReturnTo(path) {
    localStorage.setItem(RETURN_KEY, path);
  },

  consumeReturnTo() {
    const value = localStorage.getItem(RETURN_KEY);
    localStorage.removeItem(RETURN_KEY);
    return value;
  },

  async requireAuth() {
    await this.ready();
    if (this.isLoggedIn()) return true;
    const path = `${location.pathname}${location.search}${location.hash}`;
    this.setReturnTo(path);
    const isInPages = location.pathname.includes('/pages/');
    location.replace(isInPages ? 'login.html' : 'pages/login.html');
    return false;
  }
};
