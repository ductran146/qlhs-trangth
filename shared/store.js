/**
 * shared/store.js
 * Single source of truth. Components keep using the same Store API,
 * while data is synced with Cloud Firestore in realtime.
 */

// Firebase/Auth are imported lazily in Store.init().
// This keeps normal page rendering fast on mobile tab switches because
// week-attendance/month-overview can draw from local cache before the
// Firebase CDN SDK and Firestore snapshots finish loading.

const AVATAR_COLORS = ['#796EFF','#2ECC71','#FFB800','#FF2323','#02AAD8','#9D70F9','#08D1A0','#FF784E'];
const COLLECTION_KEYS = ['students', 'sessions', 'debts', 'reports'];
const BOOTSTRAP_KEY = 'nkct_bootstrap_state';

const DEFAULT = {
  students: [],
  sessions: [],
  debts: [],
  reports: []
};

const _listeners = {};
const _syncStatus = { auth: 'idle', firestore: 'cache', error: null, lastRemoteAt: null, source: 'local-cache' };
const _pendingDocWrites = [];
const _pendingDeletes = [];
const _cache = Object.fromEntries(COLLECTION_KEYS.map(key => [key, readLocalOrDefault(key)]));
const _remoteIds = Object.fromEntries(COLLECTION_KEYS.map(key => [key, new Set()]));
const _firstSnapshot = Object.fromEntries(COLLECTION_KEYS.map(key => [key, false]));
let _initPromise = null;
let _teacherId = null;
let _unsubscribers = [];
let _firebaseReady = false;
let _firebaseApi = null;
let _authApi = null;

async function loadFirebaseRuntime() {
  if (_firebaseApi && _authApi) return { ..._firebaseApi, Auth: _authApi.Auth };
  const [{ Auth }, firebase] = await Promise.all([
    import('./auth.js'),
    import('./firebase.js')
  ]);
  _authApi = { Auth };
  _firebaseApi = firebase;
  return { ...firebase, Auth };
}


function readLocalOrDefault(key) {
  try {
    const raw = localStorage.getItem('nkct_' + key);
    if (raw) return JSON.parse(raw);
  } catch (_err) {}

  // Fallback aggregate cache. This makes every page draw the last known data
  // immediately after mobile tab/page navigation, even before Firebase Auth
  // restores the session or Firestore returns the first snapshot.
  try {
    const boot = localStorage.getItem(BOOTSTRAP_KEY);
    if (boot) {
      const parsed = JSON.parse(boot);
      if (Array.isArray(parsed?.[key])) return parsed[key];
    }
  } catch (_err) {}

  return DEFAULT[key] ? structuredCloneSafe(DEFAULT[key]) : [];
}

function structuredCloneSafe(value) {
  return JSON.parse(JSON.stringify(value));
}

function teacherCollection(key) {
  if (!_teacherId || !_firebaseApi) throw new Error('Firestore teacherId is not ready.');
  return _firebaseApi.collection(_firebaseApi.db, 'teachers', _teacherId, key);
}

function teacherDoc(key, id) {
  if (!_teacherId || !_firebaseApi) throw new Error('Firestore teacherId is not ready.');
  return _firebaseApi.doc(_firebaseApi.db, 'teachers', _teacherId, key, String(id));
}

function persistBootstrapCache() {
  try {
    const payload = Object.fromEntries(COLLECTION_KEYS.map(key => [key, _cache[key] || []]));
    payload.updatedAt = new Date().toISOString();
    localStorage.setItem(BOOTSTRAP_KEY, JSON.stringify(payload));
  } catch (_err) {}
}

function setLocalCache(key, value, shouldEmit = true, source = 'local-cache') {
  _cache[key] = Array.isArray(value) ? value : [];
  _syncStatus.source = source;
  try { localStorage.setItem('nkct_' + key, JSON.stringify(_cache[key])); } catch (_err) {}
  persistBootstrapCache();
  if (shouldEmit) {
    Store.emit(key, _cache[key]);
    Store.emit('*');
  }
}

function allCollectionsHaveSnapshot() {
  return COLLECTION_KEYS.every(key => _firstSnapshot[key] === true);
}

function updateFirestoreStatusFromSnapshot(snapshot) {
  _syncStatus.firestore = allCollectionsHaveSnapshot() ? 'synced' : 'syncing';
  _syncStatus.source = snapshot?.metadata?.fromCache ? 'firestore-cache' : 'firestore-server';
  if (!snapshot?.metadata?.fromCache) {
    _syncStatus.lastRemoteAt = new Date().toISOString();
  }
}

async function writeItemToFirestore(key, item) {
  if (!item?.id) return;
  if (!_firebaseReady || !_teacherId || !_firebaseApi) {
    _pendingDocWrites.push({ key, item: cleanForFirestore(item) });
    return;
  }
  await _firebaseApi.setDoc(teacherDoc(key, item.id), cleanForFirestore(item), { merge: false })
    .catch((err) => setSyncError(`[store] Write ${key}/${item.id} failed`, err));
}

async function deleteItemFromFirestore(key, id) {
  if (!id) return;
  if (!_firebaseReady || !_teacherId || !_firebaseApi) {
    _pendingDeletes.push({ key, id: String(id) });
    return;
  }
  await _firebaseApi.deleteDoc(teacherDoc(key, id))
    .catch((err) => setSyncError(`[store] Delete ${key}/${id} failed`, err));
}

async function syncCollectionToFirestore(key, value, options = {}) {
  // Firestore is the source of truth. Collection replacement is only allowed
  // after the first remote snapshot for that collection has been received.
  // This prevents stale browser localStorage from overwriting/deleting newer
  // Firestore data when Safari/Chrome open the app with different caches.
  if (!_firebaseReady || !_teacherId || !_firebaseApi) return;
  const allowDeletes = options.allowDeletes === true && _firstSnapshot[key] === true;
  const list = Array.isArray(value) ? value : [];
  const nextIds = new Set(list.map(item => String(item.id)).filter(Boolean));
  const previousIds = _remoteIds[key] || new Set();

  const writes = [];
  for (const item of list) {
    if (!item?.id) continue;
    writes.push(_firebaseApi.setDoc(teacherDoc(key, item.id), cleanForFirestore(item), { merge: false }));
  }
  if (allowDeletes) {
    for (const id of previousIds) {
      if (!nextIds.has(id)) writes.push(_firebaseApi.deleteDoc(teacherDoc(key, id)));
    }
  }

  await Promise.all(writes).catch((err) => setSyncError(`[store] Sync ${key} failed`, err));
}

function setSyncError(message, err) {
  console.error(message + ':', err);
  _syncStatus.error = err?.message || String(err || message);
  _syncStatus.firestore = 'error';
  Store.emit('sync', Store.getSyncStatus());
}

async function flushPendingWrites() {
  if (!_firebaseReady || !_teacherId || !_firebaseApi) return;
  const docWrites = _pendingDocWrites.splice(0);
  const deletes = _pendingDeletes.splice(0);
  for (const item of docWrites) {
    await writeItemToFirestore(item.key, item.item);
  }
  for (const item of deletes) {
    await deleteItemFromFirestore(item.key, item.id);
  }
}

function cleanForFirestore(value) {
  return JSON.parse(JSON.stringify(value, (_key, val) => val === undefined ? null : val));
}

// Deprecated on purpose: never auto-migrate localStorage to Firestore.
// Old browser cache must not overwrite the realtime database.
async function maybeMigrateLocalData() { return false; }

const Store = {
  async init() {
    if (_initPromise) return _initPromise;

    _initPromise = (async () => {
      _syncStatus.auth = 'checking';
      _syncStatus.firestore = 'cache';
      Store.emit('sync', Store.getSyncStatus());
      const { Auth, onSnapshot } = await loadFirebaseRuntime();
      const authUser = await Auth.ready();
      if (!authUser) {
        _syncStatus.auth = 'signed_out';
        Store.emit('sync', Store.getSyncStatus());
        return false;
      }
      const user = Auth.currentUser();
      if (!user?.uid) {
        _syncStatus.auth = 'signed_out';
        Store.emit('sync', Store.getSyncStatus());
        return false;
      }
      _teacherId = user.uid;

      _unsubscribers.forEach(unsub => { try { unsub(); } catch (_err) {} });
      _unsubscribers = [];
      _firebaseReady = true;
      _syncStatus.auth = 'signed_in';
      _syncStatus.firestore = 'syncing';
      _syncStatus.error = null;
      Store.emit('sync', Store.getSyncStatus());

      // Attach realtime listeners, but do NOT await the first snapshots.
      // On iPhone/Safari page navigation can re-download Firebase SDK + wait for
      // Firestore. Waiting here made the Checkin tab appear blank for 5–30s.
      COLLECTION_KEYS.forEach(key => {
        const unsubscribe = onSnapshot(teacherCollection(key), { includeMetadataChanges: true }, (snapshot) => {
          const remoteList = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
          const remoteIds = new Set(remoteList.map(item => String(item.id)));
          _remoteIds[key] = remoteIds;

          // Firestore is the source of truth. Even when the remote list is
          // empty, overwrite browser cache instead of uploading localStorage.
          // Snapshot may arrive from Firestore's IndexedDB cache first, then
          // from server. Both are safer than legacy app localStorage because
          // they belong to Firestore sync, not old JSON/import data.
          _firstSnapshot[key] = true;
          updateFirestoreStatusFromSnapshot(snapshot);
          setLocalCache(key, remoteList, true, snapshot.metadata.fromCache ? 'firestore-cache' : 'firestore-server');
          Store.emit('sync', Store.getSyncStatus());

          // Flush pending writes only after the first server-backed snapshot.
          // This avoids stale browser cache being written back before the
          // current Firestore state has had a chance to arrive.
          if (!snapshot.metadata.fromCache) flushPendingWrites();
        }, (error) => {
          setSyncError(`[store] Firestore listener failed for ${key}`, error);
        });
        _unsubscribers.push(unsubscribe);
      });

      return true;
    })();

    return _initPromise;
  },

  get(key) {
    return _cache[key] ?? (DEFAULT[key] ? structuredCloneSafe(DEFAULT[key]) : null);
  },

  getAll() {
    return {
      students: this.get('students'),
      sessions: this.get('sessions'),
      debts:    this.get('debts'),
      reports:  this.get('reports'),
    };
  },

  set(key, value, options = {}) {
    setLocalCache(key, value, true, 'optimistic-local');
    syncCollectionToFirestore(key, value, { allowDeletes: options.allowDeletes === true || _firstSnapshot[key] === true });
  },

  getSyncStatus() {
    return { ..._syncStatus, teacherId: _teacherId, firebaseReady: _firebaseReady };
  },

  upsertStudent(obj) {
    const list = [...this.get('students')];
    const idx  = list.findIndex(s => s.id === obj.id);
    const normalized = {
      ...obj,
      startDate: obj.startDate || toLocalDateStr(new Date())
    };
    if (idx > -1) list[idx] = { ...list[idx], ...normalized };
    else list.push(normalized);
    setLocalCache('students', list, true, 'optimistic-local');
    writeItemToFirestore('students', normalized);
  },

  upsertSession(obj) {
    const list = [...this.get('sessions')];
    const idx  = list.findIndex(s => s.id === obj.id);
    const nextSession = idx > -1 ? { ...list[idx], ...obj } : obj;
    if (idx > -1) list[idx] = nextSession;
    else list.push(nextSession);
    setLocalCache('sessions', list, true, 'optimistic-local');
    writeItemToFirestore('sessions', nextSession);
    this.syncDebts(nextSession);
    this.reconcileDebts();
  },

  syncDebts(sess) {
    let debts = [...this.get('debts')];
    const planned = Number(sess.plannedSlots ?? sess.duration ?? 0);
    const actual = Number(sess.actualSlots ?? (sess.status === 'taught' || sess.status === 'makeup' ? sess.duration : 0) ?? 0);
    const debtSlots = Number(sess.debtSlots ?? calcDebtSlots(sess.status, planned, actual));
    const needsDebt = ['absent', 'busy', 'partial'].includes(sess.status) && debtSlots > 0;
    const hasDebtIndex = debts.findIndex(d => d.sessionId === sess.id && !d.done);
    const hasDebt = hasDebtIndex > -1 ? debts[hasDebtIndex] : null;

    if (needsDebt && !hasDebt) {
      debts.push({
        id: uid(),
        studentId: sess.studentId,
        sessionId: sess.id,
        date: sess.date,
        slots: debtSlots,
        originalSlots: debtSlots,
        reason: sess.status,
        done: false
      });
      this.set('debts', debts, { allowDeletes: true });
      return;
    }

    if (needsDebt && hasDebt) {
      debts[hasDebtIndex] = {
        ...hasDebt,
        studentId: sess.studentId,
        date: sess.date,
        slots: debtSlots,
        originalSlots: debtSlots,
        reason: sess.status,
        done: debtSlots <= 0,
      };
      this.set('debts', debts, { allowDeletes: true });
      return;
    }

    if (!needsDebt && hasDebt) {
      debts = debts.filter(d => d.sessionId !== sess.id);
      this.set('debts', debts, { allowDeletes: true });
    }
  },

  upsertReport(obj) {
    const list = [...(this.get('reports') || [])];
    const idx  = list.findIndex(r => r.id === obj.id || (
      r.studentId === obj.studentId &&
      r.type === obj.type &&
      r.periodStart === obj.periodStart &&
      r.periodEnd === obj.periodEnd
    ));
    const now = new Date().toISOString();
    const next = {
      ...obj,
      id: obj.id || (idx > -1 ? list[idx].id : uid()),
      updatedAt: now,
      createdAt: obj.createdAt || (idx > -1 ? list[idx].createdAt : now),
    };
    if (idx > -1) list[idx] = { ...list[idx], ...next };
    else list.push(next);
    setLocalCache('reports', list, true, 'optimistic-local');
    writeItemToFirestore('reports', next);
    return next;
  },

  getReport({ studentId, type, periodStart, periodEnd }) {
    return (this.get('reports') || []).find(r =>
      r.studentId === studentId &&
      r.type === type &&
      r.periodStart === periodStart &&
      r.periodEnd === periodEnd
    ) || null;
  },

  markDebtDone(debtId) {
    const debts = this.get('debts').map(d => d.id === debtId ? { ...d, done: true } : d);
    this.set('debts', debts, { allowDeletes: true });
  },

  reconcileDebts() {
    const sessions = this.get('sessions') || [];
    const oldDebts = this.get('debts') || [];
    const debtBySession = new Map(oldDebts.map(d => [d.sessionId, d]));

    const baseDebts = sessions
      .filter(sess => ['absent', 'busy', 'partial'].includes(sess.status))
      .map(sess => {
        const planned = Number(sess.plannedSlots ?? sess.duration ?? 0);
        const actual = Number(sess.actualSlots ?? 0);
        const need = calcDebtSlots(sess.status, planned, actual);
        const old = debtBySession.get(sess.id);
        return {
          ...(old || {}),
          id: old?.id || uid(),
          studentId: sess.studentId,
          sessionId: sess.id,
          date: sess.date,
          slots: need,
          originalSlots: need,
          reason: sess.status,
          done: need <= 0,
        };
      })
      .filter(d => Number(d.originalSlots || 0) > 0)
      .sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.id).localeCompare(String(b.id)));

    const workingDebts = baseDebts.map(d => ({ ...d }));
    const orderedSessions = [...sessions].sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.id).localeCompare(String(b.id)));

    for (const sess of orderedSessions) {
      const planned = Number(sess.plannedSlots ?? 0);
      const actual = Number(sess.actualSlots ?? sess.duration ?? 0);
      const makeupSlots = (sess.type === 'makeup' || sess.status === 'makeup')
        ? actual
        : Math.max(actual - planned, 0);
      let remain = Number(makeupSlots || 0);
      if (remain <= 0) continue;

      for (const debt of workingDebts) {
        if (remain <= 0) break;
        if (debt.studentId !== sess.studentId) continue;
        if (debt.sessionId === sess.id) continue;
        // Cho phép dạy bù trước: ca bù ở ngày sớm hơn vẫn được dùng để trừ
        // cho khoản nợ phát sinh sau đó. Không chặn bằng điều kiện debt.date <= sess.date.
        if (Number(debt.slots || 0) <= 0 || debt.done) continue;

        const use = Math.min(Number(debt.slots || 0), remain);
        debt.slots = Math.max(Number(debt.slots || 0) - use, 0);
        debt.done = debt.slots <= 0;
        debt.lastMakeupSessionId = sess.id;
        debt.lastMakeupDate = sess.date;
        remain = Math.max(remain - use, 0);
      }
    }

    const same = JSON.stringify(oldDebts) === JSON.stringify(workingDebts);
    if (!same) this.set('debts', workingDebts, { allowDeletes: true });
    return workingDebts;
  },

  subscribe(event, cb) {
    if (!_listeners[event]) _listeners[event] = [];
    _listeners[event].push(cb);
    return () => { _listeners[event] = _listeners[event].filter(f => f !== cb); };
  },

  emit(event, data) {
    (_listeners[event] || []).forEach(cb => cb(data));
  }
};
// ── Shared utils ────────────────────────────────────────
function uid() { return 'i' + Date.now() + Math.random().toString(36).slice(2,5); }

function avatarColor(name) {
  let h = 0;
  for (const c of (name||'')) h = (h*31 + c.charCodeAt(0)) % AVATAR_COLORS.length;
  return AVATAR_COLORS[h];
}

function initials(name) {
  const p = (name||'').trim().split(' ');
  return p[p.length-1].charAt(0).toUpperCase();
}

function fmtDate(d) {
  const DAYS = ['Chủ nhật','Thứ 2','Thứ 3','Thứ 4','Thứ 5','Thứ 6','Thứ 7'];
  const dt = new Date(d + 'T00:00:00');
  return `${DAYS[dt.getDay()]}, ${dt.getDate()}/${dt.getMonth()+1}/${dt.getFullYear()}`;
}

function fmtDateShort(d) {
  const dt = new Date(d + 'T00:00:00');
  return `${dt.getDate()}/${dt.getMonth()+1}`;
}

function fmtMoney(n) { return (n||0).toLocaleString('vi-VN') + ' đ'; }

function toLocalDateStr(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function todayStr() { return toLocalDateStr(new Date()); }

function age(dob) {
  if (!dob) return '';
  return new Date().getFullYear() - new Date(dob).getFullYear() + ' tuổi';
}

function statusLabel(s) {
  return { taught:'Đã học', partial:'Học thiếu', absent:'Nghỉ', makeup:'Học bù', busy:'Cô bận' }[s] || '';
}

function calcDebtSlots(status, planned = 0, actual = 0) {
  if (status === 'partial') return Math.max(Number(planned || 0) - Number(actual || 0), 0);
  if (status === 'absent' || status === 'busy') return Number(planned || 0);
  return 0;
}

function getWeekRange(offset = 0) {
  const now = new Date();
  const dow = now.getDay();
  const mon = new Date(now);
  mon.setDate(now.getDate() - (dow === 0 ? 6 : dow - 1) + offset * 7);
  const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
  return {
    start: toLocalDateStr(mon), end: toLocalDateStr(sun),
    label: `${mon.getDate()}/${mon.getMonth()+1} – ${sun.getDate()}/${sun.getMonth()+1}`
  };
}

export { Store, uid, avatarColor, initials, fmtDate, fmtDateShort, fmtMoney, todayStr, toLocalDateStr, age, statusLabel, getWeekRange };
