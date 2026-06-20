/**
 * components/month-overview.js
 * Monthly snapshot for the first screen: totals, income, student progress and missing/makeup debts.
 * Used by: pages/checkin.html
 */
import { Store, uid, avatarColor, initials, fmtMoney, todayStr, toLocalDateStr } from '../shared/store.js';

const STATUS_META = {
  ok:      { tag: 'green',  label: 'Đúng tiến độ' },
  warning: { tag: 'amber',  label: 'Chưa chấm' },
  debt:    { tag: 'red',    label: 'Còn nợ bù' },
  empty:   { tag: 'violet', label: 'Chưa có ca' },
};

let lastRows = [];

export function render(el) {
  const students = Store.get('students');
  const studentIds = new Set(students.map(s => String(s.id)));
  const sessions = Store.get('sessions').filter(s => studentIds.has(String(s.studentId)));
  const allDebts = typeof Store.reconcileDebts === 'function' ? Store.reconcileDebts() : Store.get('debts');
  const debts = allDebts.filter(d => studentIds.has(String(d.studentId)) && !d.done);

  const now = new Date();
  const today = todayStr();
  const year = now.getFullYear();
  const month = now.getMonth();
  const start = `${year}-${String(month + 1).padStart(2, '0')}-01`;
  const label = `Tháng ${month + 1}/${year}`;

  const monthSessions = sessions.filter(s => s.date >= start && s.date <= today);
  const taught = monthSessions.filter(isTaughtOrMakeup);
  const absentOrBusy = monthSessions.filter(s => s.status === 'absent' || s.status === 'busy');

  const totalSlots = taught.reduce((sum, s) => sum + actualSlots(s), 0);
  const totalIncome = taught.reduce((sum, sess) => {
    const st = students.find(s => s.id === sess.studentId);
    return sum + ((st?.feePerSlot || 0) * actualSlots(sess));
  }, 0);
  const debtSlots = debts.reduce((sum, d) => sum + Number(d.slots || 0), 0);
  const activeStudentCount = students.length;

  lastRows = students.map(st => buildStudentRow(st, sessions, debts, start, today, year, month));
  const priorityRows = [...lastRows]
    .sort((a, b) => {
      const score = row => (row.debtSlots * 100) + (row.pendingSlots * 10) - row.taughtCount;
      return score(b) - score(a);
    });

  el.innerHTML = `
    <section class="month-overview" aria-label="Tổng quan tháng này">
      <div class="month-overview-head">
        <div>
          <div class="section-label">Tổng quan tháng này</div>
          <h2>${label}</h2>
          <p>Tính đến hôm nay · ${formatToday(now)}</p>
        </div>
      </div>

      <div class="month-stat-grid">
        <div class="month-stat-card violet">
          <div class="month-stat-value">${activeStudentCount}</div>
          <div class="month-stat-label">Bé đang dạy</div>
        </div>
        <div class="month-stat-card blue">
          <div class="month-stat-value">${taught.length}</div>
          <div class="month-stat-label">Buổi đã dạy</div>
        </div>
        <div class="month-stat-card green">
          <div class="month-stat-value">${formatNumber(totalSlots)}</div>
          <div class="month-stat-label">Tổng số ca</div>
        </div>
        <div class="month-stat-card red">
          <div class="month-stat-value">${formatNumber(debtSlots)}</div>
          <div class="month-stat-label">Ca còn nợ</div>
        </div>
        <div class="month-stat-card amber">
          <div class="month-stat-value">${fmtMoney(totalIncome)}</div>
          <div class="month-stat-label">Thu nhập tạm tính</div>
        </div>
      </div>

      <div class="month-student-panel">
        <div class="month-student-title">
          <span>Tình trạng từng học sinh</span>
          <small>${absentOrBusy.length} buổi nghỉ/bận trong tháng</small>
        </div>
        ${priorityRows.length ? priorityRows.map(rowTemplate).join('') : `
          <div class="text-muted fs-13" style="padding:10px 0;text-align:center">Chưa có học sinh</div>
        `}
      </div>
    </section>
    <div class="pending-dialog-backdrop" hidden>
      <section class="pending-dialog" role="dialog" aria-modal="true" aria-labelledby="pendingDialogTitle">
        <div class="pending-dialog-head">
          <div>
            <h3 id="pendingDialogTitle">Các ngày chưa chấm</h3>
            <p data-pending-subtitle></p>
          </div>
          <button type="button" class="pending-dialog-close" aria-label="Đóng"><svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M15 5L5 15M5 5L15 15" stroke="#454B50" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
        </div>
        <div class="pending-dialog-toolbar">
          <button type="button" class="btn btn-secondary pending-mark-all" data-action="mark-all-taught">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
              <path d="M5 13.2591L7.58583 15.9567C8.2525 16.6522 8.58583 17 9.00004 17C9.41425 17 9.74759 16.6522 10.4143 15.9567L19 7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            <span>Tất cả đã học đủ</span>
          </button>
        </div>
        <div class="pending-dialog-body" data-pending-list></div>
      </section>
    </div>

    <div class="pending-attendance-backdrop" hidden>
      <section class="pending-attendance-modal" role="dialog" aria-modal="true" aria-labelledby="pendingAttendanceTitle">
        <div class="attendance-modal-head">
          <div>
            <strong id="pendingAttendanceTitle" data-attendance-name></strong>
            <span data-attendance-meta></span>
          </div>
          <button type="button" class="attendance-modal-close" data-action="close-attendance" aria-label="Đóng"><svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M15 5L5 15M5 5L15 15" stroke="#454B50" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
        </div>
        <div class="attendance-section">
          <div class="attendance-label">Trạng thái buổi học</div>
          <div class="attendance-status-grid">
            <button type="button" class="attendance-status-choice active" data-status="taught">Đã học đủ</button>
            <button type="button" class="attendance-status-choice" data-status="partial">Học thiếu</button>
            <button type="button" class="attendance-status-choice" data-status="absent">Nghỉ</button>
            <button type="button" class="attendance-status-choice" data-status="busy">Cô bận</button>
            <button type="button" class="attendance-status-choice" data-status="makeup">Dạy bù</button>
          </div>
        </div>
        <div class="attendance-section attendance-slot-section is-hidden" data-slot-section>
          <div class="attendance-label" data-slot-label>Số ca thực tế</div>
          <div class="attendance-slot-grid" data-slot-grid></div>
        </div>
        <div class="attendance-hint" data-attendance-hint></div>
        <div class="attendance-modal-actions">
          <button type="button" class="btn btn-secondary" data-action="clear-attendance">Xóa chấm công</button>
          <button type="button" class="btn btn-primary" data-action="save-attendance">Lưu chấm công</button>
        </div>
      </section>
    </div>`;

  bindPendingDialog(el);
}

function buildStudentRow(st, sessions, debts, start, today, year, month) {
  const effectiveStart = maxDateStr(start, st.startDate || start);
  const monthSessions = sessions.filter(s =>
    s.studentId === st.id &&
    s.date >= effectiveStart &&
    s.date <= today
  );
  const taughtSessions = monthSessions.filter(isTaughtOrMakeup);
  const taughtSlots = taughtSessions.reduce((sum, s) => sum + actualSlots(s), 0);
  const expectedSlots = countScheduledSlots(st, year, month, effectiveStart, today);
  const pendingItems = getPendingItems(st, sessions, year, month, effectiveStart, today);
  const pendingSlots = pendingItems.reduce((sum, item) => sum + Number(item.slots || 0), 0);
  const studentDebts = debts.filter(d => d.studentId === st.id && (!st.startDate || d.date >= st.startDate));
  const debtSlots = studentDebts.reduce((sum, d) => sum + Number(d.slots || 0), 0);

  let state = 'ok';
  if (debtSlots > 0) state = 'debt';
  else if (pendingSlots > 0) state = 'warning';
  else if (expectedSlots === 0 && taughtSessions.length === 0) state = 'empty';

  return {
    student: st,
    expected: expectedSlots,
    taughtCount: taughtSessions.length,
    taughtSlots,
    pendingSlots,
    pendingItems,
    debtSlots,
    state,
  };
}

function rowTemplate(row) {
  const { student: st } = row;
  const meta = STATUS_META[row.state];
  const pct = row.expected ? Math.min(100, Math.round(row.taughtSlots / row.expected * 100)) : (row.taughtSlots ? 100 : 0);
  const progressText = row.expected ? `${formatNumber(row.taughtSlots)}/${formatNumber(row.expected)} ca` : `${formatNumber(row.taughtSlots)} ca`;
  const statusControl = buildStatusControl(row);

  return `
    <article class="month-student-row ${row.state}">
      <div class="avatar sm" style="background:${avatarColor(st.name)}">${initials(st.name)}</div>
      <div class="month-student-info">
        <div class="month-student-main">
          <strong>${escapeHTML(st.name)}</strong>
          <span class="tag ${meta.tag === 'violet' ? '' : meta.tag}">${meta.label}</span>
        </div>
        <div class="month-student-meta">
          <span>${progressText}</span>
          <span>· </span>
          ${statusControl}
        </div>
        <div class="mini-progress" aria-hidden="true">
          <div style="width:${pct}%"></div>
        </div>
      </div>
    </article>`;
}

function buildStatusControl(row) {
  if (row.debtSlots > 0) {
    return `<span>Nợ ${formatNumber(row.debtSlots)} ca bù</span>`;
  }
  if (row.pendingSlots > 0) {
    return `<button type="button" class="month-pending-link" data-student-id="${escapeAttr(row.student.id)}">Chưa chấm ${formatNumber(row.pendingSlots)} ca</button>`;
  }
  return `<span>Không nợ ca bù</span>`;
}

function bindPendingDialog(root) {
  const backdrop = root.querySelector('.pending-dialog-backdrop');
  const listEl = root.querySelector('[data-pending-list]');
  const subtitleEl = root.querySelector('[data-pending-subtitle]');
  const markAllBtn = root.querySelector('[data-action="mark-all-taught"]');
  const attendanceBackdrop = root.querySelector('.pending-attendance-backdrop');
  if (!backdrop || !listEl || !subtitleEl || !attendanceBackdrop) return;

  let activeRow = null;
  let activeItem = null;
  let currentStatus = 'taught';
  let currentSlots = 0;

  const closePending = () => {
    backdrop.hidden = true;
    document.body.classList.remove('modal-open');
  };

  const closeAttendance = () => {
    attendanceBackdrop.hidden = true;
  };

  const refreshPendingList = () => {
    if (!activeRow) return;
    const freshStudents = Store.get('students');
    const freshSessions = Store.get('sessions');
    const st = freshStudents.find(s => s.id === activeRow.student.id) || activeRow.student;
    const now = new Date();
    const today = todayStr();
    const year = now.getFullYear();
    const month = now.getMonth();
    const start = `${year}-${String(month + 1).padStart(2, '0')}-01`;
    const effectiveStart = maxDateStr(start, st.startDate || start);
    activeRow = {
      ...activeRow,
      student: st,
      pendingItems: getPendingItems(st, freshSessions, year, month, effectiveStart, today),
    };
    activeRow.pendingSlots = activeRow.pendingItems.reduce((sum, item) => sum + Number(item.slots || 0), 0);
    renderPendingList();
  };

  const renderPendingList = () => {
    if (!activeRow) return;
    subtitleEl.textContent = `${activeRow.student.name} · ${formatNumber(activeRow.pendingSlots)} ca chưa chấm`;
    markAllBtn.hidden = activeRow.pendingItems.length === 0;
    listEl.innerHTML = activeRow.pendingItems.length ? activeRow.pendingItems.map(item => `
      <div class="pending-dialog-item" data-date="${escapeAttr(item.date)}">
        <div>
          <strong>${formatWeekday(item.date)}, ${formatDateVN(item.date)}</strong>
          <span>${escapeHTML(activeRow.student.schedTime || '')}</span>
        </div>
        <em>${formatNumber(item.slots)} ca</em>
        <button type="button" class="btn btn-secondary pending-item-action" data-action="open-pending-attendance" data-date="${escapeAttr(item.date)}">Chấm công</button>
      </div>
    `).join('') : `<div class="pending-dialog-empty">Không còn ngày chưa chấm.</div>`;
  };

  const openPendingForRow = row => {
    activeRow = row;
    renderPendingList();
    backdrop.hidden = false;
    document.body.classList.add('modal-open');
  };

  const openAttendance = item => {
    if (!activeRow || !item) return;
    activeItem = item;
    currentStatus = 'taught';
    currentSlots = Number(item.slots || activeRow.student.duration || 1);

    attendanceBackdrop.querySelector('[data-attendance-name]').textContent = activeRow.student.name;
    attendanceBackdrop.querySelector('[data-attendance-meta]').textContent = `${formatWeekday(item.date)}, ${formatDateVN(item.date)} · ${activeRow.student.schedTime || ''}`;
    attendanceBackdrop.querySelectorAll('.attendance-status-choice').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.status === currentStatus);
    });
    renderSlotChoices();
    updateAttendanceVisibility();
    attendanceBackdrop.hidden = false;
  };

  const renderSlotChoices = () => {
    const grid = attendanceBackdrop.querySelector('[data-slot-grid]');
    const options = [0, 0.5, 1, 1.5, 2];
    grid.innerHTML = options.map(value => `
      <button type="button" class="slot-chip ${Number(value) === Number(currentSlots) ? 'active' : ''}" data-slots="${value}">${formatNumber(value)} ca</button>
    `).join('');
  };

  const updateAttendanceVisibility = () => {
    const planned = Number(activeItem?.slots || activeRow?.student?.duration || 1);
    const slotSection = attendanceBackdrop.querySelector('[data-slot-section]');
    const slotLabel = attendanceBackdrop.querySelector('[data-slot-label]');
    const hint = attendanceBackdrop.querySelector('[data-attendance-hint]');
    const needSlots = currentStatus === 'partial' || currentStatus === 'makeup';
    slotSection.classList.toggle('is-hidden', !needSlots);

    if (currentStatus === 'taught') {
      currentSlots = planned;
      hint.textContent = `Đã học đủ ${formatNumber(planned)} ca. Không cần nhập số ca thực tế.`;
    } else if (currentStatus === 'partial') {
      if (currentSlots >= planned) currentSlots = Math.max(planned - 0.5, 0);
      slotLabel.textContent = 'Số ca thực tế';
      hint.textContent = `Học thiếu ${formatNumber(Math.max(planned - currentSlots, 0))} ca. App sẽ tạo nợ bù cho phần còn thiếu.`;
    } else if (currentStatus === 'makeup') {
      if (currentSlots <= 0) currentSlots = planned;
      slotLabel.textContent = 'Số ca dạy bù';
      hint.textContent = 'Ca bù sẽ được trừ vào các buổi thiếu cũ nhất trước.';
    } else if (currentStatus === 'absent') {
      currentSlots = 0;
      hint.textContent = `Buổi này nghỉ, app tạo nợ ${formatNumber(planned)} ca.`;
    } else if (currentStatus === 'busy') {
      currentSlots = 0;
      hint.textContent = `Cô bận, app tạo nợ ${formatNumber(planned)} ca.`;
    }
    renderSlotChoices();
  };

  const saveAttendance = () => {
    if (!activeRow || !activeItem) return;
    const st = activeRow.student;
    const planned = Number(activeItem.slots || st.duration || 1);
    let status = currentStatus;
    let actual = Number(currentSlots || 0);
    let type = 'normal';

    if (status === 'taught') actual = planned;
    if (status === 'partial') actual = Math.min(actual, Math.max(planned - 0.5, 0));
    if (status === 'makeup') {
      type = 'makeup';
      status = 'makeup';
    }
    if (status === 'absent' || status === 'busy') actual = 0;

    Store.upsertSession({
      id: uid(),
      studentId: st.id,
      date: activeItem.date,
      startTime: st.schedTime || '',
      duration: planned,
      plannedSlots: status === 'makeup' ? 0 : planned,
      actualSlots: actual,
      debtSlots: status === 'partial' ? Math.max(planned - actual, 0) : ((status === 'absent' || status === 'busy') ? planned : 0),
      type,
      status,
      makeupFor: null,
      noteSkill: '',
      noteBehavior: '',
      noteProgress: '',
      noteParent: '',
    });

    closeAttendance();
    refreshPendingList();
    render(root);
  };

  const markAllTaught = () => {
    if (!activeRow || !activeRow.pendingItems.length) return;
    const st = activeRow.student;
    activeRow.pendingItems.forEach(item => {
      const planned = Number(item.slots || st.duration || 1);
      Store.upsertSession({
        id: uid(),
        studentId: st.id,
        date: item.date,
        startTime: st.schedTime || '',
        duration: planned,
        plannedSlots: planned,
        actualSlots: planned,
        debtSlots: 0,
        type: 'normal',
        status: 'taught',
        makeupFor: null,
        noteSkill: '',
        noteBehavior: '',
        noteProgress: '',
        noteParent: '',
      });
    });
    closePending();
    render(root);
  };

  root.querySelectorAll('.month-pending-link').forEach(btn => {
    btn.addEventListener('click', () => {
      const row = lastRows.find(item => item.student.id === btn.dataset.studentId);
      if (row) openPendingForRow(row);
    });
  });

  listEl.addEventListener('click', event => {
    const btn = event.target.closest('[data-action="open-pending-attendance"]');
    if (!btn || !activeRow) return;
    const item = activeRow.pendingItems.find(x => x.date === btn.dataset.date);
    openAttendance(item);
  });

  attendanceBackdrop.querySelectorAll('.attendance-status-choice').forEach(btn => {
    btn.addEventListener('click', () => {
      currentStatus = btn.dataset.status;
      attendanceBackdrop.querySelectorAll('.attendance-status-choice').forEach(b => b.classList.toggle('active', b === btn));
      updateAttendanceVisibility();
    });
  });

  attendanceBackdrop.addEventListener('click', event => {
    const slotBtn = event.target.closest('.slot-chip');
    if (slotBtn) {
      currentSlots = Number(slotBtn.dataset.slots || 0);
      renderSlotChoices();
      updateAttendanceVisibility();
      return;
    }
    if (event.target === attendanceBackdrop || event.target.closest('[data-action="close-attendance"]')) closeAttendance();
    if (event.target.closest('[data-action="save-attendance"]')) saveAttendance();
    if (event.target.closest('[data-action="clear-attendance"]')) closeAttendance();
  });

  markAllBtn?.addEventListener('click', markAllTaught);
  root.querySelector('.pending-dialog-close')?.addEventListener('click', closePending);
  backdrop.addEventListener('click', event => {
    if (event.target === backdrop) closePending();
  });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    if (!attendanceBackdrop.hidden) closeAttendance();
    else if (!backdrop.hidden) closePending();
  });
}

function getPendingItems(student, sessions, year, month, startDate, today) {
  const days = student.schedDays || [];
  if (!days.length) return [];
  const duration = Number(student.duration || 1);
  const endDt = new Date(today + 'T00:00:00');
  const items = [];
  for (let d = new Date(year, month, 1); d <= endDt; d.setDate(d.getDate() + 1)) {
    const dateStr = toLocalDateStr(d);
    if (dateStr < startDate) continue;
    if (!days.includes(d.getDay())) continue;
    const hasSession = sessions.some(s => s.studentId === student.id && s.date === dateStr);
    if (!hasSession) items.push({ date: dateStr, slots: duration });
  }
  return items;
}

function isTaughtOrMakeup(session) {
  return session?.status === 'taught' || session?.status === 'partial' || session?.status === 'makeup' || session?.type === 'makeup';
}

function actualSlots(session) {
  return Number(session?.actualSlots ?? session?.duration ?? 0);
}

function countScheduledSlots(student, year, month, startDate, today) {
  const days = student.schedDays || [];
  if (!days.length) return 0;
  const duration = Number(student.duration || 1);
  const endDt = new Date(today + 'T00:00:00');
  let count = 0;
  for (let d = new Date(year, month, 1); d <= endDt; d.setDate(d.getDate() + 1)) {
    const dateStr = toLocalDateStr(d);
    if (dateStr < startDate) continue;
    if (days.includes(d.getDay())) count += duration;
  }
  return count;
}

function maxDateStr(a, b) {
  return String(a || '') > String(b || '') ? a : b;
}

function formatToday(date) {
  return `${date.getDate()}/${date.getMonth() + 1}/${date.getFullYear()}`;
}

function formatDateVN(dateStr) {
  const [y, m, d] = String(dateStr).split('-');
  return `${Number(d)}/${Number(m)}/${y}`;
}

function formatWeekday(dateStr) {
  const date = new Date(String(dateStr) + 'T00:00:00');
  const day = date.getDay();
  return day === 0 ? 'Chủ nhật' : `Thứ ${day + 1}`;
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString('vi-VN', { maximumFractionDigits: 1 });
}

function escapeHTML(value) {
  return String(value || '').replace(/[&<>"']/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch]));
}

function escapeAttr(value) {
  return escapeHTML(value).replace(/`/g, '&#96;');
}
