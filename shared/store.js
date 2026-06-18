/**
 * shared/store.js
 * Single source of truth. Components keep using the same Store API,
 * while data is synced with Cloud Firestore in realtime.
 */

import { Auth } from './auth.js';
import {
  db,
  collection,
  doc,
  setDoc,
  deleteDoc,
  onSnapshot
} from './firebase.js';

const AVATAR_COLORS = ['#796EFF','#2ECC71','#FFB800','#FF2323','#02AAD8','#9D70F9','#08D1A0','#FF784E'];
const COLLECTION_KEYS = ['students', 'sessions', 'debts', 'reports'];

const DEFAULT = {
  students: [
    { id:'s1', name:'Bé Minh Khôi', dob:'2019-03-15', gender:'Nam', startDate:'2026-06-01',
      difficulties:['Tự kỷ','Chậm nói'], goal:'Phát triển ngôn ngữ, giao tiếp mắt',
      schedDays:[1,3,5], schedTime:'08:00', duration:1, feePerSlot:200000, fatherName:'Anh Minh', motherName:'Chị Hương' },
    { id:'s2', name:'Bé Hà Linh', dob:'2020-07-22', gender:'Nữ', startDate:'2026-06-03',
      difficulties:['Tăng động'], goal:'Tăng tập trung, kiểm soát cảm xúc',
      schedDays:[2,4], schedTime:'09:30', duration:1, feePerSlot:180000, fatherName:'Anh Nam', motherName:'Chị Linh' },
    { id:'s3', name:'Bé Tuấn Kiệt', dob:'2018-11-08', gender:'Nam', startDate:'2026-06-02',
      difficulties:['Chậm phát triển'], goal:'Phát triển vận động tinh, nhận thức',
      schedDays:[1,4,6], schedTime:'15:00', duration:1.5, feePerSlot:220000, fatherName:'Anh Kiên', motherName:'Chị Mai' },
  ],
  sessions: [],
  debts: [],
  reports: []
};

const _listeners = {};
const _cache = Object.fromEntries(COLLECTION_KEYS.map(key => [key, readLocalOrDefault(key)]));
const _remoteIds = Object.fromEntries(COLLECTION_KEYS.map(key => [key, new Set()]));
const _firstSnapshot = Object.fromEntries(COLLECTION_KEYS.map(key => [key, false]));
let _initPromise = null;
let _teacherId = null;
let _unsubscribers = [];
let _firebaseReady = false;

function readLocalOrDefault(key) {
  try {
    const raw = localStorage.getItem('nkct_' + key);
    if (raw) return JSON.parse(raw);
  } catch (_err) {}
  return DEFAULT[key] ? structuredCloneSafe(DEFAULT[key]) : [];
}

function structuredCloneSafe(value) {
  return JSON.parse(JSON.stringify(value));
}

function teacherCollection(key) {
  if (!_teacherId) throw new Error('Firestore teacherId is not ready.');
  return collection(db, 'teachers', _teacherId, key);
}

function teacherDoc(key, id) {
  if (!_teacherId) throw new Error('Firestore teacherId is not ready.');
  return doc(db, 'teachers', _teacherId, key, String(id));
}

function setLocalCache(key, value, shouldEmit = true) {
  _cache[key] = Array.isArray(value) ? value : [];
  try { localStorage.setItem('nkct_' + key, JSON.stringify(_cache[key])); } catch (_err) {}
  if (shouldEmit) {
    Store.emit(key, _cache[key]);
    Store.emit('*');
  }
}

async function syncCollectionToFirestore(key, value) {
  if (!_firebaseReady || !_teacherId) return;
  const list = Array.isArray(value) ? value : [];
  const nextIds = new Set(list.map(item => String(item.id)).filter(Boolean));
  const previousIds = _remoteIds[key] || new Set();

  const writes = [];
  for (const item of list) {
    if (!item?.id) continue;
    writes.push(setDoc(teacherDoc(key, item.id), cleanForFirestore(item), { merge: false }));
  }
  for (const id of previousIds) {
    if (!nextIds.has(id)) writes.push(deleteDoc(teacherDoc(key, id)));
  }

  _remoteIds[key] = nextIds;
  await Promise.all(writes).catch((err) => console.error(`[store] Sync ${key} failed:`, err));
}

function cleanForFirestore(value) {
  return JSON.parse(JSON.stringify(value, (_key, val) => val === undefined ? null : val));
}

async function maybeMigrateLocalData() {
  if (!_firebaseReady || !_teacherId) return;
  for (const key of COLLECTION_KEYS) {
    if ((_remoteIds[key] || new Set()).size > 0) continue;
    let localList = [];
    try {
      const raw = localStorage.getItem('nkct_' + key);
      localList = raw ? JSON.parse(raw) : [];
    } catch (_err) {}
    if (Array.isArray(localList) && localList.length) {
      await syncCollectionToFirestore(key, localList);
    }
  }
}

const Store = {
  async init() {
    if (_initPromise) return _initPromise;

    _initPromise = (async () => {
      const authUser = await Auth.ready();
      if (!authUser) return false;
      const user = Auth.currentUser();
      if (!user?.uid) return false;
      _teacherId = user.uid;

      _unsubscribers.forEach(unsub => { try { unsub(); } catch (_err) {} });
      _unsubscribers = [];

      const firstPromises = COLLECTION_KEYS.map(key => new Promise((resolve) => {
        const unsubscribe = onSnapshot(teacherCollection(key), (snapshot) => {
          const list = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
          _remoteIds[key] = new Set(list.map(item => String(item.id)));
          _firstSnapshot[key] = true;
          setLocalCache(key, list, true);
          resolve(true);
        }, (error) => {
          console.error(`[store] Firestore listener failed for ${key}:`, error);
          resolve(false);
        });
        _unsubscribers.push(unsubscribe);
      }));

      await Promise.all(firstPromises);
      _firebaseReady = true;
      await maybeMigrateLocalData();
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

  set(key, value) {
    setLocalCache(key, value, true);
    syncCollectionToFirestore(key, value);
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
    this.set('students', list);
  },

  upsertSession(obj) {
    const list = [...this.get('sessions')];
    const idx  = list.findIndex(s => s.id === obj.id);
    if (idx > -1) list[idx] = { ...list[idx], ...obj };
    else list.push(obj);
    this.set('sessions', list);
    this.syncDebts(obj);
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
      this.set('debts', debts);
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
      this.set('debts', debts);
      return;
    }

    if (!needsDebt && hasDebt) {
      debts = debts.filter(d => d.sessionId !== sess.id);
      this.set('debts', debts);
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
    this.set('reports', list);
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
    this.set('debts', debts);
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
        if (String(debt.date) > String(sess.date)) continue;
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
    if (!same) this.set('debts', workingDebts);
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
