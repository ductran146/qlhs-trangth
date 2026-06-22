/**
 * shared/store.js  — v3
 *
 * Fix chính so với v2:
 *  - _writeDoc / _deleteDoc tự chờ Firebase ready (waitForFirebase),
 *    không phụ thuộc vào snapshot để flush pending.
 *  - _pendingWrites / _pendingDeletes vẫn giữ làm backup nếu Firebase
 *    chưa init xong khi page mới load.
 *  - memoryLocalCache → mỗi app load đều lấy thẳng từ Firestore server.
 *  - Server snapshot là source of truth duy nhất.
 *  - Store.reset() dọn sạch khi logout.
 */

const AVATAR_COLORS = ['#796EFF','#2ECC71','#FFB800','#FF2323','#02AAD8','#9D70F9','#08D1A0','#FF784E'];
const COLLECTION_KEYS = ['students', 'sessions', 'debts', 'reports'];
const BOOTSTRAP_KEY   = 'nkct_bootstrap_state';
const LS_PREFIX       = 'nkct_';

const DEFAULT = { students: [], sessions: [], debts: [], reports: [] };

// ── In-memory state ──────────────────────────────────────────────────────────
const _listeners    = {};
const _pendingWrites  = [];   // backup khi Store.init() chưa chạy
const _pendingDeletes = [];

const _syncStatus = {
  auth: 'idle', firestore: 'cache', error: null,
  lastRemoteAt: null, source: 'local-cache'
};

const _cache = Object.fromEntries(
  COLLECTION_KEYS.map(k => [k, _readBootstrap(k)])
);
const _remoteIds = Object.fromEntries(
  COLLECTION_KEYS.map(k => [k, new Set()])
);
const _serverSnapshotReceived = Object.fromEntries(
  COLLECTION_KEYS.map(k => [k, false])
);

let _initPromise    = null;
let _firebaseReady  = false;   // true khi _teacherId set + listeners đăng ký xong
let _teacherId      = null;
let _unsubscribers  = [];
let _firebaseApi    = null;
let _authApi        = null;

// Promise resolve khi Firebase ready — dùng để _writeDoc tự chờ
let _firebaseReadyResolve = null;
let _firebaseReadyPromise = new Promise(res => { _firebaseReadyResolve = res; });

// ── Bootstrap helpers ────────────────────────────────────────────────────────

function _readBootstrap(key) {
  try {
    const raw = localStorage.getItem(LS_PREFIX + key);
    if (raw) return JSON.parse(raw);
  } catch (_) {}
  try {
    const boot = localStorage.getItem(BOOTSTRAP_KEY);
    if (boot) {
      const p = JSON.parse(boot);
      if (Array.isArray(p?.[key])) return p[key];
    }
  } catch (_) {}
  return [];
}

function _persistBootstrap() {
  try {
    const payload = Object.fromEntries(COLLECTION_KEYS.map(k => [k, _cache[k] || []]));
    payload.updatedAt = new Date().toISOString();
    localStorage.setItem(BOOTSTRAP_KEY, JSON.stringify(payload));
  } catch (_) {}
}

function _setCache(key, value, source = 'local-cache', shouldEmit = true) {
  _cache[key] = Array.isArray(value) ? value : [];
  _syncStatus.source = source;
  try { localStorage.setItem(LS_PREFIX + key, JSON.stringify(_cache[key])); } catch (_) {}
  _persistBootstrap();
  if (shouldEmit) { Store.emit(key, _cache[key]); Store.emit('*'); }
}

// ── Firebase lazy loader ─────────────────────────────────────────────────────

async function _loadFirebase() {
  if (_firebaseApi && _authApi) return { ..._firebaseApi, Auth: _authApi.Auth };
  const [{ Auth }, firebase] = await Promise.all([
    import('./auth.js'),
    import('./firebase.js')
  ]);
  _authApi = { Auth };
  _firebaseApi = firebase;
  return { ...firebase, Auth };
}

// ── Firestore path helpers ───────────────────────────────────────────────────

function _col(key) {
  if (!_teacherId || !_firebaseApi) throw new Error('Firestore chưa sẵn sàng.');
  return _firebaseApi.collection(_firebaseApi.db, 'teachers', _teacherId, key);
}
function _docRef(key, id) {
  if (!_teacherId || !_firebaseApi) throw new Error('Firestore chưa sẵn sàng.');
  return _firebaseApi.doc(_firebaseApi.db, 'teachers', _teacherId, key, String(id));
}
function _cleanForFirestore(value) {
  return JSON.parse(JSON.stringify(value, (_k, v) => v === undefined ? null : v));
}

// ── Write helpers — tự chờ Firebase ready ───────────────────────────────────

/**
 * Chờ Firebase Auth + Firestore listeners đã sẵn sàng.
 * Timeout 15s để không chờ mãi mãi nếu mạng mất.
 */
function _waitForFirebase(timeoutMs = 15000) {
  if (_firebaseReady) return Promise.resolve(true);
  return Promise.race([
    _firebaseReadyPromise,
    new Promise(res => setTimeout(() => res(false), timeoutMs))
  ]);
}

async function _writeDoc(key, item) {
  if (!item?.id) return;
  const clean = _cleanForFirestore(item);

  // Nếu Firebase chưa ready → đưa vào pending, sau đó chờ
  if (!_firebaseReady) {
    _pendingWrites.push({ key, item: clean });
    // Chờ Firebase ready rồi flush (không block caller)
    _waitForFirebase().then(ready => {
      if (ready) _flushPending();
    });
    return;
  }

  await _firebaseApi.setDoc(_docRef(key, item.id), clean, { merge: false })
    .catch(err => _setSyncError(`Write ${key}/${item.id} thất bại`, err));
}

async function _deleteDoc(key, id) {
  if (!id) return;
  if (!_firebaseReady) {
    _pendingDeletes.push({ key, id: String(id) });
    _waitForFirebase().then(ready => {
      if (ready) _flushPending();
    });
    return;
  }
  await _firebaseApi.deleteDoc(_docRef(key, id))
    .catch(err => _setSyncError(`Delete ${key}/${id} thất bại`, err));
}

async function _flushPending() {
  if (!_firebaseReady || !_teacherId || !_firebaseApi) return;
  const writes  = _pendingWrites.splice(0);
  const deletes = _pendingDeletes.splice(0);
  await Promise.all([
    ...writes.map(({ key, item }) =>
      _firebaseApi.setDoc(_docRef(key, item.id), _cleanForFirestore(item), { merge: false })
        .catch(err => _setSyncError(`Flush write ${key}/${item.id} thất bại`, err))
    ),
    ...deletes.map(({ key, id }) =>
      _firebaseApi.deleteDoc(_docRef(key, id))
        .catch(err => _setSyncError(`Flush delete ${key}/${id} thất bại`, err))
    )
  ]);
}

// ── Collection replace ───────────────────────────────────────────────────────

async function _syncCollection(key, value, allowDeletes = false) {
  if (!_firebaseReady || !_teacherId || !_firebaseApi) return;
  const safeDelete = allowDeletes && _serverSnapshotReceived[key] === true;
  const list    = Array.isArray(value) ? value : [];
  const nextIds = new Set(list.map(item => String(item.id)).filter(Boolean));
  const prevIds = _remoteIds[key] || new Set();

  const promises = [];
  for (const item of list) {
    if (!item?.id) continue;
    promises.push(
      _firebaseApi.setDoc(_docRef(key, item.id), _cleanForFirestore(item), { merge: false })
        .catch(err => _setSyncError(`Sync write ${key}/${item.id} thất bại`, err))
    );
  }
  if (safeDelete) {
    for (const id of prevIds) {
      if (!nextIds.has(id)) {
        promises.push(
          _firebaseApi.deleteDoc(_docRef(key, id))
            .catch(err => _setSyncError(`Sync delete ${key}/${id} thất bại`, err))
        );
      }
    }
  }
  await Promise.all(promises);
}

// ── Sync status ──────────────────────────────────────────────────────────────

function _allServerSnapshotsReceived() {
  return COLLECTION_KEYS.every(k => _serverSnapshotReceived[k] === true);
}
function _setSyncError(message, err) {
  console.error(message, err);
  _syncStatus.error    = err?.message || String(err || message);
  _syncStatus.firestore = 'error';
  Store.emit('sync', Store.getSyncStatus());
}

// ── Realtime listeners ───────────────────────────────────────────────────────

function _attachListeners({ onSnapshot }) {
  _unsubscribers.forEach(fn => { try { fn(); } catch (_) {} });
  _unsubscribers = [];

  for (const key of COLLECTION_KEYS) {
    const unsub = onSnapshot(
      _col(key),
      { includeMetadataChanges: true },
      (snapshot) => {
        const fromCache = snapshot.metadata.fromCache;
        const list = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        _remoteIds[key] = new Set(list.map(item => String(item.id)));

        if (!fromCache) {
          // Server snapshot → source of truth
          _serverSnapshotReceived[key] = true;
          _syncStatus.lastRemoteAt = new Date().toISOString();
          _setCache(key, list, 'firestore-server');
        } else if (!_serverSnapshotReceived[key]) {
          // Cache snapshot → chỉ hiển thị nếu chưa có server data
          _setCache(key, list, 'firestore-cache');
        }

        _syncStatus.firestore = _allServerSnapshotsReceived() ? 'synced' : (fromCache ? 'cache' : 'syncing');
        _syncStatus.error = null;
        Store.emit('sync', Store.getSyncStatus());
      },
      (error) => { _setSyncError(`Firestore listener lỗi cho ${key}`, error); }
    );
    _unsubscribers.push(unsub);
  }
}

// ── Store public API ─────────────────────────────────────────────────────────

const Store = {

  async init() {
    if (_initPromise) return _initPromise;

    _initPromise = (async () => {
      _syncStatus.auth      = 'checking';
      _syncStatus.firestore = 'cache';
      Store.emit('sync', Store.getSyncStatus());

      let firebase;
      try { firebase = await _loadFirebase(); }
      catch (err) {
        _setSyncError('Không load được Firebase SDK', err);
        _initPromise = null; return false;
      }

      const { Auth, onSnapshot } = firebase;

      let authUser;
      try { authUser = await Auth.ready(); }
      catch (err) {
        _setSyncError('Firebase Auth lỗi', err);
        _initPromise = null; return false;
      }

      if (!authUser) {
        _syncStatus.auth = 'signed_out';
        Store.emit('sync', Store.getSyncStatus());
        _initPromise = null; return false;
      }

      const user = Auth.currentUser();
      if (!user?.uid) {
        _syncStatus.auth = 'signed_out';
        Store.emit('sync', Store.getSyncStatus());
        _initPromise = null; return false;
      }

      _teacherId     = user.uid;
      _firebaseReady = true;
      _syncStatus.auth      = 'signed_in';
      _syncStatus.firestore = 'syncing';
      _syncStatus.error     = null;
      Store.emit('sync', Store.getSyncStatus());

      // Resolve promise để các _writeDoc đang chờ được tiếp tục
      _firebaseReadyResolve(true);

      // Đăng ký listeners + flush pending (không await)
      _attachListeners({ onSnapshot });
      _flushPending();

      return true;
    })();

    return _initPromise;
  },

  reset() {
    _unsubscribers.forEach(fn => { try { fn(); } catch (_) {} });
    _unsubscribers  = [];
    _initPromise    = null;
    _teacherId      = null;
    _firebaseReady  = false;
    _firebaseApi    = null;
    _authApi        = null;
    _pendingWrites.length  = 0;
    _pendingDeletes.length = 0;

    // Reset ready promise
    _firebaseReadyPromise = new Promise(res => { _firebaseReadyResolve = res; });

    for (const key of COLLECTION_KEYS) {
      _serverSnapshotReceived[key] = false;
      _remoteIds[key] = new Set();
      _cache[key] = [];
      try { localStorage.removeItem(LS_PREFIX + key); } catch (_) {}
    }
    try { localStorage.removeItem(BOOTSTRAP_KEY); } catch (_) {}

    _syncStatus.auth = 'idle'; _syncStatus.firestore = 'cache';
    _syncStatus.error = null; _syncStatus.lastRemoteAt = null;
    _syncStatus.source = 'local-cache';
    Store.emit('sync', Store.getSyncStatus());
  },

  get(key) {
    const data = _cache[key];
    return Array.isArray(data) ? data : (DEFAULT[key] ? [...DEFAULT[key]] : null);
  },

  getAll() {
    return Object.fromEntries(COLLECTION_KEYS.map(k => [k, this.get(k)]));
  },

  set(key, value, options = {}) {
    _setCache(key, value, 'optimistic-local');
    if (_firebaseReady) {
      _syncCollection(key, value, options.allowDeletes === true);
    } else {
      // Firebase chưa ready → đưa từng item vào pending
      const list = Array.isArray(value) ? value : [];
      for (const item of list) {
        if (item?.id) _pendingWrites.push({ key, item: _cleanForFirestore(item) });
      }
      _waitForFirebase().then(ready => { if (ready) _flushPending(); });
    }
  },

  getSyncStatus() {
    return {
      ..._syncStatus,
      teacherId:     _teacherId,
      firebaseReady: _firebaseReady,
      serverSynced:  _allServerSnapshotsReceived()
    };
  },

  // ── Domain helpers ───────────────────────────────────────────────────────

  upsertStudent(obj) {
    const list = [...this.get('students')];
    const idx  = list.findIndex(s => s.id === obj.id);
    const normalized = { ...obj, startDate: obj.startDate || toLocalDateStr(new Date()) };
    if (idx > -1) list[idx] = { ...list[idx], ...normalized };
    else list.push(normalized);
    _setCache('students', list, 'optimistic-local');
    _writeDoc('students', normalized);
  },

  upsertSession(obj) {
    const list = [...this.get('sessions')];
    const idx  = list.findIndex(s => s.id === obj.id);
    const next = idx > -1 ? { ...list[idx], ...obj } : obj;
    if (idx > -1) list[idx] = next; else list.push(next);
    _setCache('sessions', list, 'optimistic-local');
    _writeDoc('sessions', next);
    this.syncDebts(next);
    this.reconcileDebts();
  },

  // Ghi note vào Firestore + cache cục bộ mà KHÔNG emit sự kiện
  // Dùng cho inline note editor để tránh render() rebuild DOM
  _writeNoteOnly(sessionId, noteText) {
    const list = [...this.get('sessions')];
    const idx  = list.findIndex(s => s.id === sessionId);
    if (idx === -1) return;
    // Dùng noteText (field chuẩn), xóa các field note cũ để nhất quán với session-card.js
    const next = { ...list[idx], noteText };
    delete next.note;
    delete next.noteContent;
    delete next.noteSkill;
    delete next.noteBehavior;
    delete next.noteProgress;
    delete next.noteParent;
    list[idx] = next;
    // Cập nhật cache trực tiếp — không qua _setCache nên không emit, không trigger render()
    _cache['sessions'] = list;
    try { localStorage.setItem(LS_PREFIX + 'sessions', JSON.stringify(list)); } catch (_) {}
    _writeDoc('sessions', next);
  },

  syncDebts(sess) {
    let debts = [...this.get('debts')];
    const planned   = Number(sess.plannedSlots ?? sess.duration ?? 0);
    const actual    = Number(sess.actualSlots ?? ((sess.status === 'taught' || sess.status === 'makeup') ? sess.duration : 0) ?? 0);
    const debtSlots = Number(sess.debtSlots ?? calcDebtSlots(sess.status, planned, actual));
    const needsDebt = ['absent', 'busy', 'partial'].includes(sess.status) && debtSlots > 0;
    const existIdx  = debts.findIndex(d => d.sessionId === sess.id && !d.done);
    const existing  = existIdx > -1 ? debts[existIdx] : null;

    if (needsDebt && !existing) {
      debts.push({ id: uid(), studentId: sess.studentId, sessionId: sess.id,
        date: sess.date, slots: debtSlots, originalSlots: debtSlots, reason: sess.status, done: false });
      this.set('debts', debts, { allowDeletes: true }); return;
    }
    if (needsDebt && existing) {
      debts[existIdx] = { ...existing, studentId: sess.studentId, date: sess.date,
        slots: debtSlots, originalSlots: debtSlots, reason: sess.status, done: debtSlots <= 0 };
      this.set('debts', debts, { allowDeletes: true }); return;
    }
    if (!needsDebt && existing) {
      debts = debts.filter(d => d.sessionId !== sess.id);
      this.set('debts', debts, { allowDeletes: true });
    }
  },

  upsertReport(obj) {
    const list = [...(this.get('reports') || [])];
    const idx  = list.findIndex(r => r.id === obj.id || (
      r.studentId === obj.studentId && r.type === obj.type &&
      r.periodStart === obj.periodStart && r.periodEnd === obj.periodEnd
    ));
    const now  = new Date().toISOString();
    const next = {
      ...obj,
      id:        obj.id || (idx > -1 ? list[idx].id : uid()),
      updatedAt: now,
      createdAt: obj.createdAt || (idx > -1 ? list[idx].createdAt : now),
    };
    if (idx > -1) list[idx] = { ...list[idx], ...next }; else list.push(next);
    _setCache('reports', list, 'optimistic-local');
    _writeDoc('reports', next);
    return next;
  },

  getReport({ studentId, type, periodStart, periodEnd }) {
    return (this.get('reports') || []).find(r =>
      r.studentId === studentId && r.type === type &&
      r.periodStart === periodStart && r.periodEnd === periodEnd
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

    const base = sessions
      .filter(s => ['absent', 'busy', 'partial'].includes(s.status))
      .map(s => {
        const planned = Number(s.plannedSlots ?? s.duration ?? 0);
        const actual  = Number(s.actualSlots ?? 0);
        const need    = calcDebtSlots(s.status, planned, actual);
        const old     = debtBySession.get(s.id);
        return { ...(old || {}), id: old?.id || uid(), studentId: s.studentId,
          sessionId: s.id, date: s.date, slots: need, originalSlots: need,
          reason: s.status, done: need <= 0 };
      })
      .filter(d => Number(d.originalSlots || 0) > 0)
      .sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.id).localeCompare(String(b.id)));

    const working = base.map(d => ({ ...d }));
    const ordered = [...sessions].sort((a, b) =>
      String(a.date).localeCompare(String(b.date)) || String(a.id).localeCompare(String(b.id))
    );

    for (const sess of ordered) {
      const planned     = Number(sess.plannedSlots ?? 0);
      const actual      = Number(sess.actualSlots ?? sess.duration ?? 0);
      const makeupSlots = (sess.type === 'makeup' || sess.status === 'makeup')
        ? actual : Math.max(actual - planned, 0);
      let remain = Number(makeupSlots || 0);
      if (remain <= 0) continue;

      for (const debt of working) {
        if (remain <= 0) break;
        if (debt.studentId !== sess.studentId || debt.sessionId === sess.id) continue;
        if (Number(debt.slots || 0) <= 0 || debt.done) continue;
        const use = Math.min(Number(debt.slots || 0), remain);
        debt.slots = Math.max(Number(debt.slots || 0) - use, 0);
        debt.done  = debt.slots <= 0;
        debt.lastMakeupSessionId = sess.id;
        debt.lastMakeupDate      = sess.date;
        remain = Math.max(remain - use, 0);
      }
    }

    if (JSON.stringify(oldDebts) !== JSON.stringify(working)) {
      this.set('debts', working, { allowDeletes: true });
    }
    return working;
  },

  subscribe(event, cb) {
    if (!_listeners[event]) _listeners[event] = [];
    _listeners[event].push(cb);
    return () => { _listeners[event] = (_listeners[event] || []).filter(f => f !== cb); };
  },

  emit(event, data) {
    (_listeners[event] || []).forEach(cb => { try { cb(data); } catch (_) {} });
  }
};

// ── Shared utils ─────────────────────────────────────────────────────────────


// Tên hiển thị cho giáo viên: "Họ tên (tên thường gọi)" nếu có nickname
function displayName(st) {
  if (!st) return '';
  return st.nickname ? `${st.name} (${st.nickname})` : st.name;
}
function uid() { return 'i' + Date.now() + Math.random().toString(36).slice(2, 5); }
function avatarColor(name) {
  let h = 0;
  for (const c of (name || '')) h = (h * 31 + c.charCodeAt(0)) % AVATAR_COLORS.length;
  return AVATAR_COLORS[h];
}
function initials(name) {
  const p = (name || '').trim().split(' ');
  return p[p.length - 1].charAt(0).toUpperCase();
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
function fmtMoney(n) { return (n || 0).toLocaleString('vi-VN') + ' đ'; }
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
  if (status === 'partial') return Math.max(Number(planned||0) - Number(actual||0), 0);
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

export { Store, uid, displayName, avatarColor, initials, fmtDate, fmtDateShort, fmtMoney, todayStr, toLocalDateStr, age, statusLabel, getWeekRange };
