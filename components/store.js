/**
 * shared/store.js
 * Single source of truth. Components keep using the same Store API,
 * while data is synced with Cloud Firestore in realtime.
 */

// Firebase/Auth are imported lazily in Store.init().
// Firestore server is treated as the source of truth for the first paint.
// Browser localStorage/IndexedDB is not used as initial data because Safari/Chrome
// can keep stale cache per browser and make different devices show different data.

const AVATAR_COLORS = ['#796EFF','#2ECC71','#FFB800','#FF2323','#02AAD8','#9D70F9','#08D1A0','#FF784E'];
const COLLECTION_KEYS = ['students', 'sessions', 'debts', 'reports'];
const BOOTSTRAP_KEY = 'nkct_bootstrap_state';
const PENDING_WRITES_KEY = 'nkct_pending_doc_writes';
const PENDING_DELETES_KEY = 'nkct_pending_doc_deletes';
const STATIC_DATA_FILE = 'data.json';
const FIRESTORE_FALLBACK_TIMEOUT_MS = 5000;
const REMOTE_FIRST_PAINT_TIMEOUT_MS = 3500;

const DEFAULT = {
  students: [],
  sessions: [],
  debts: [],
  reports: []
};

const _listeners = {};
const _syncStatus = { auth: 'idle', firestore: 'idle', error: null, lastRemoteAt: null, source: 'empty-start' };
const _pendingDocWrites = readPendingQueue(PENDING_WRITES_KEY);
const _pendingDeletes = readPendingQueue(PENDING_DELETES_KEY);
// Start from empty data and wait for Firestore.
// This avoids showing stale browser cache before the server snapshot arrives.
const _cache = Object.fromEntries(COLLECTION_KEYS.map(key => [key, structuredCloneSafe(DEFAULT[key] || [])]));
const _remoteIds = Object.fromEntries(COLLECTION_KEYS.map(key => [key, new Set()]));
const _firstSnapshot = Object.fromEntries(COLLECTION_KEYS.map(key => [key, false]));
const _optimisticDocs = buildOptimisticDocMaps(_pendingDocWrites);
const _optimisticDeletes = buildOptimisticDeleteMaps(_pendingDeletes);
let _initPromise = null;
let _teacherId = null;
let _unsubscribers = [];
let _firebaseReady = false;
let _firebaseApi = null;
let _authApi = null;
let _staticFallbackPromise = null;
let _fallbackTimer = null;
let _firstSnapshotWaiters = [];
let _isFlushingPendingWrites = false;

// Keep pending write queues durable even if the teacher changes tab/page or presses F5
// immediately after saving a student/session. The actual Firestore request may be
// cancelled by the browser during navigation, but the queued operation will be
// replayed on the next app boot.
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', persistPendingQueues);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') persistPendingQueues();
  });
}

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

function readPendingQueue(storageKey) {
  try {
    const raw = localStorage.getItem(storageKey);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (_err) {
    return [];
  }
}

function persistPendingQueues() {
  try { localStorage.setItem(PENDING_WRITES_KEY, JSON.stringify(_pendingDocWrites)); } catch (_err) {}
  try { localStorage.setItem(PENDING_DELETES_KEY, JSON.stringify(_pendingDeletes)); } catch (_err) {}
}

function buildOptimisticDocMaps(queue) {
  const maps = Object.fromEntries(COLLECTION_KEYS.map(key => [key, new Map()]));
  for (const entry of queue || []) {
    if (!entry?.key || !entry?.item?.id || !maps[entry.key]) continue;
    maps[entry.key].set(String(entry.item.id), entry.item);
  }
  return maps;
}

function buildOptimisticDeleteMaps(queue) {
  const maps = Object.fromEntries(COLLECTION_KEYS.map(key => [key, new Set()]));
  for (const entry of queue || []) {
    if (!entry?.key || !entry?.id || !maps[entry.key]) continue;
    maps[entry.key].add(String(entry.id));
  }
  return maps;
}

function sameJson(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function remoteMatchesExpected(remote, expected) {
  if (!remote || !expected) return false;
  const cleanExpected = cleanForFirestore(expected);
  for (const [field, value] of Object.entries(cleanExpected)) {
    if (!sameJson(remote[field], value)) return false;
  }
  return true;
}

function removeAckedPendingOps(key, remoteList, isServerSnapshot) {
  if (!isServerSnapshot) return;
  const remoteById = new Map((remoteList || []).map(item => [String(item.id), item]));
  let changed = false;

  for (let i = _pendingDocWrites.length - 1; i >= 0; i--) {
    const entry = _pendingDocWrites[i];
    if (entry?.key !== key || !entry?.item?.id) continue;
    const id = String(entry.item.id);
    const remote = remoteById.get(id);
    if (remote && remoteMatchesExpected(remote, entry.item)) {
      _pendingDocWrites.splice(i, 1);
      _optimisticDocs[key]?.delete(id);
      changed = true;
    }
  }

  for (let i = _pendingDeletes.length - 1; i >= 0; i--) {
    const entry = _pendingDeletes[i];
    if (entry?.key !== key || !entry?.id) continue;
    const id = String(entry.id);
    if (!remoteById.has(id)) {
      _pendingDeletes.splice(i, 1);
      _optimisticDeletes[key]?.delete(id);
      changed = true;
    }
  }

  if (changed) persistPendingQueues();
}

function applyOptimisticOverlay(key, remoteList) {
  const byId = new Map((remoteList || []).map(item => [String(item.id), item]));

  const deleted = _optimisticDeletes[key];
  if (deleted?.size) {
    for (const id of deleted) byId.delete(String(id));
  }

  const docs = _optimisticDocs[key];
  if (docs?.size) {
    for (const [id, item] of docs.entries()) {
      if (deleted?.has(id)) continue;
      byId.set(String(id), item);
    }
  }

  return Array.from(byId.values());
}

function queuePendingDocWrite(key, item) {
  if (!item?.id) return;
  const cleaned = cleanForFirestore(item);
  const id = String(cleaned.id);

  for (let i = _pendingDocWrites.length - 1; i >= 0; i--) {
    const entry = _pendingDocWrites[i];
    if (entry?.key === key && String(entry?.item?.id) === id) _pendingDocWrites.splice(i, 1);
  }
  for (let i = _pendingDeletes.length - 1; i >= 0; i--) {
    const entry = _pendingDeletes[i];
    if (entry?.key === key && String(entry?.id) === id) _pendingDeletes.splice(i, 1);
  }

  _pendingDocWrites.push({ key, item: cleaned, queuedAt: new Date().toISOString() });
  _optimisticDocs[key]?.set(id, cleaned);
  _optimisticDeletes[key]?.delete(id);
  persistPendingQueues();
}

function queuePendingDelete(key, id) {
  if (!id) return;
  id = String(id);

  for (let i = _pendingDocWrites.length - 1; i >= 0; i--) {
    const entry = _pendingDocWrites[i];
    if (entry?.key === key && String(entry?.item?.id) === id) _pendingDocWrites.splice(i, 1);
  }
  for (let i = _pendingDeletes.length - 1; i >= 0; i--) {
    const entry = _pendingDeletes[i];
    if (entry?.key === key && String(entry?.id) === id) _pendingDeletes.splice(i, 1);
  }

  _pendingDeletes.push({ key, id, queuedAt: new Date().toISOString() });
  _optimisticDocs[key]?.delete(id);
  _optimisticDeletes[key]?.add(id);
  persistPendingQueues();
}


function readLocalOrDefault(key) {
  // Kept only for manual/debug fallback. The normal app boot no longer reads
  // localStorage before Firestore because old local cache caused data mismatch
  // between Safari, Chrome, local and GitHub Pages.
  try {
    const raw = localStorage.getItem('nkct_' + key);
    if (raw) return JSON.parse(raw);
  } catch (_err) {}

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

function hasAnyCachedData() {
  return COLLECTION_KEYS.some(key => Array.isArray(_cache[key]) && _cache[key].length > 0);
}

function normalizeDataPayload(payload) {
  const source = payload && typeof payload === 'object' && payload.data && typeof payload.data === 'object'
    ? payload.data
    : payload;
  const next = {};
  for (const key of COLLECTION_KEYS) {
    next[key] = Array.isArray(source?.[key]) ? source[key] : [];
  }
  return next;
}

function staticDataUrl() {
  const inPagesDir = location.pathname.includes('/pages/');
  const base = inPagesDir ? '../' : './';
  return `${base}${STATIC_DATA_FILE}?t=${Date.now()}`;
}

async function fetchStaticDataJson() {
  const response = await fetch(staticDataUrl(), { cache: 'no-store' });
  if (!response.ok) throw new Error(`Không đọc được ${STATIC_DATA_FILE}: HTTP ${response.status}`);
  return normalizeDataPayload(await response.json());
}

async function loadStaticFallback(reason = 'firestore-fallback') {
  if (_staticFallbackPromise) return _staticFallbackPromise;
  _staticFallbackPromise = (async () => {
    try {
      const payload = await fetchStaticDataJson();
      for (const key of COLLECTION_KEYS) {
        setLocalCache(key, payload[key], true, 'static-json');
      }
      _syncStatus.firestore = 'static';
      _syncStatus.source = 'static-json';
      _syncStatus.error = reason;
      Store.emit('sync', Store.getSyncStatus());
      return true;
    } catch (err) {
      console.warn('[store] Static data fallback failed:', err);
      _syncStatus.firestore = hasAnyCachedData() ? 'local-cache' : 'error';
      _syncStatus.source = hasAnyCachedData() ? 'local-cache' : 'empty-default';
      _syncStatus.error = err?.message || String(err);
      Store.emit('sync', Store.getSyncStatus());
      return false;
    }
  })();
  return _staticFallbackPromise;
}

function startFirestoreFallbackTimer() {
  if (_fallbackTimer) clearTimeout(_fallbackTimer);
  _fallbackTimer = setTimeout(() => {
    const hasSnapshot = COLLECTION_KEYS.some(key => _firstSnapshot[key] === true);
    if (!_firebaseReady || hasSnapshot) return;
    loadStaticFallback('firestore-timeout');
  }, FIRESTORE_FALLBACK_TIMEOUT_MS);
}

function stopFirestoreFallbackTimerIfReady() {
  if (!allCollectionsHaveSnapshot() || !_fallbackTimer) return;
  clearTimeout(_fallbackTimer);
  _fallbackTimer = null;
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

function resolveFirstSnapshotWaiters() {
  if (!allCollectionsHaveSnapshot()) return;
  const waiters = _firstSnapshotWaiters.splice(0);
  waiters.forEach(resolve => resolve(true));
}

function waitForFirstSnapshots(timeoutMs = REMOTE_FIRST_PAINT_TIMEOUT_MS) {
  if (allCollectionsHaveSnapshot()) return Promise.resolve(true);
  return new Promise(resolve => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    _firstSnapshotWaiters.push((value) => {
      clearTimeout(timer);
      resolve(value);
    });
  });
}

function updateFirestoreStatusFromSnapshot(snapshot) {
  stopFirestoreFallbackTimerIfReady();
  _syncStatus.firestore = allCollectionsHaveSnapshot() ? 'synced' : 'syncing';
  _syncStatus.source = snapshot?.metadata?.fromCache ? 'firestore-cache' : 'firestore-server';
  if (!snapshot?.metadata?.fromCache) {
    _syncStatus.lastRemoteAt = new Date().toISOString();
  }
}

async function writeItemToFirestore(key, item) {
  if (!item?.id) return;
  queuePendingDocWrite(key, item);
  await flushPendingWrites();
}

async function deleteItemFromFirestore(key, id) {
  if (!id) return;
  queuePendingDelete(key, id);
  await flushPendingWrites();
}

async function syncCollectionToFirestore(key, value, options = {}) {
  // Queue every collection-level write before attempting Firestore.
  // Some UI flows call Store.set('students', nextList) instead of upsertStudent().
  // If the teacher switches page/F5 immediately, direct setDoc() can be cancelled;
  // a persisted pending queue makes the write replay on next boot.
  const list = Array.isArray(value) ? value : [];
  const allowDeletes = options.allowDeletes === true && _firstSnapshot[key] === true;
  const nextIds = new Set(list.map(item => String(item?.id || '')).filter(Boolean));
  const previousIds = _remoteIds[key] || new Set();

  for (const item of list) {
    if (!item?.id) continue;
    queuePendingDocWrite(key, item);
  }

  if (allowDeletes) {
    for (const id of previousIds) {
      if (!nextIds.has(id)) queuePendingDelete(key, id);
    }
  }

  await flushPendingWrites();
}

function setSyncError(message, err, options = {}) {
  console.error(message + ':', err);
  _syncStatus.error = err?.message || String(err || message);
  _syncStatus.firestore = 'error';
  Store.emit('sync', Store.getSyncStatus());
  if (options.staticFallback === true) loadStaticFallback(_syncStatus.error);
}

async function flushPendingWrites() {
  if (!_firebaseReady || !_teacherId || !_firebaseApi || _isFlushingPendingWrites) return;
  _isFlushingPendingWrites = true;
  try {
    // Snapshot copy để tránh mutate trong khi đang iterate
    for (const entry of [..._pendingDocWrites]) {
      if (!entry?.item?.id) continue;
      try {
        await _firebaseApi.setDoc(teacherDoc(entry.key, entry.item.id), cleanForFirestore(entry.item), { merge: false });
        // FIX: xóa khỏi queue ngay sau khi setDoc thành công
        // Không chờ onSnapshot confirm — tránh trường hợp người dùng F5 ngay sau khi
        // setDoc xong nhưng snapshot chưa về, entry vẫn còn trong queue và bị replay sai.
        const idx = _pendingDocWrites.findIndex(e => e?.key === entry.key && String(e?.item?.id) === String(entry.item.id));
        if (idx > -1) _pendingDocWrites.splice(idx, 1);
        _optimisticDocs[entry.key]?.delete(String(entry.item.id));
      } catch (err) {
        setSyncError(`[store] Write ${entry.key}/${entry.item.id} failed`, err);
      }
    }
    for (const entry of [..._pendingDeletes]) {
      if (!entry?.id) continue;
      try {
        await _firebaseApi.deleteDoc(teacherDoc(entry.key, entry.id));
        // FIX: xóa khỏi queue ngay sau khi deleteDoc thành công
        const idx = _pendingDeletes.findIndex(e => e?.key === entry.key && String(e?.id) === String(entry.id));
        if (idx > -1) _pendingDeletes.splice(idx, 1);
        _optimisticDeletes[entry.key]?.delete(String(entry.id));
      } catch (err) {
        setSyncError(`[store] Delete ${entry.key}/${entry.id} failed`, err);
      }
    }
    // Persist queue sau mỗi lần flush để beforeunload lưu trạng thái mới nhất
    persistPendingQueues();
  } finally {
    _isFlushingPendingWrites = false;
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
      _syncStatus.firestore = 'connecting';
      _syncStatus.source = 'empty-start';
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
      COLLECTION_KEYS.forEach(key => {
        _firstSnapshot[key] = false;
        _remoteIds[key] = new Set();
      });
      _firstSnapshotWaiters = [];
      _firebaseReady = true;
      _syncStatus.auth = 'signed_in';
      _syncStatus.firestore = 'syncing';
      _syncStatus.error = null;
      Store.emit('sync', Store.getSyncStatus());
      startFirestoreFallbackTimer();

      // Attach realtime listeners and wait briefly for the first Firestore result.
      // This prioritizes correct sync across Safari/Chrome over showing stale
      // local cache immediately. If the network is slow, components still render
      // after REMOTE_FIRST_PAINT_TIMEOUT_MS and will update when snapshots arrive.
      COLLECTION_KEYS.forEach(key => {
        const unsubscribe = onSnapshot(teacherCollection(key), { includeMetadataChanges: true }, (snapshot) => {
          const rawRemoteList = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
          const isServerSnapshot = !snapshot.metadata.fromCache;
          removeAckedPendingOps(key, rawRemoteList, isServerSnapshot);
          const remoteList = applyOptimisticOverlay(key, rawRemoteList);
          const remoteIds = new Set(rawRemoteList.map(item => String(item.id)));
          _remoteIds[key] = remoteIds;

          // Firestore is the source of truth. Even when the list is empty,
          // overwrite browser cache instead of merging localStorage/static data.
          // Pending local writes are overlaid until a server snapshot confirms them,
          // so a quick refresh after adding a student will retry and not lose data.
          _firstSnapshot[key] = true;
          updateFirestoreStatusFromSnapshot(snapshot);
          setLocalCache(key, remoteList, true, snapshot.metadata.fromCache ? 'firestore-cache' : 'firestore-server');
          Store.emit('sync', Store.getSyncStatus());
          resolveFirstSnapshotWaiters();

          if (typeof window !== 'undefined' && window.__QLHS_DEBUG_SYNC__) {
            console.log('[QLHS sync]', key, {
              teacherId: _teacherId,
              source: snapshot.metadata.fromCache ? 'firestore-cache' : 'firestore-server',
              size: remoteList.length,
              names: remoteList.map(item => item.name || item.studentName || item.id)
            });
          }

          // Flush pending writes only after the first server-backed snapshot.
          // This avoids stale browser cache being written back before the
          // current Firestore state has had a chance to arrive.
          if (!snapshot.metadata.fromCache) flushPendingWrites();
        }, (error) => {
          setSyncError(`[store] Firestore listener failed for ${key}`, error, { staticFallback: true });
        });
        _unsubscribers.push(unsubscribe);
      });

      flushPendingWrites();
      await waitForFirstSnapshots();
      Store.emit('sync', Store.getSyncStatus());
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
    // Persist the intended write immediately. This covers add/edit flows that
    // replace a whole collection and then navigate away before Firestore returns.
    syncCollectionToFirestore(key, value, { allowDeletes: options.allowDeletes === true || _firstSnapshot[key] === true });
  },

  getSyncStatus() {
    return {
      ..._syncStatus,
      teacherId: _teacherId,
      firebaseReady: _firebaseReady,
      firstSnapshot: { ..._firstSnapshot },
      pendingWrites: _pendingDocWrites.length,
      pendingDeletes: _pendingDeletes.length
    };
  },

  async loadStaticFallback() {
    return loadStaticFallback('manual-static-fallback');
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
