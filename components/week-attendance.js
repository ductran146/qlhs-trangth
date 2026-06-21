/**
 * components/week-attendance.js
 * Weekly attendance grid with detailed slot tracking.
 * Each cell stores: plannedSlots, actualSlots, debtSlots, status, type, makeupFor.
 */
import {
  Store,
  uid,
  avatarColor,
  initials,
  fmtDateShort,
  getWeekRange,
  toLocalDateStr,
  todayStr,
  displayName } from '../shared/store.js';

const DAYS = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
const FULL_WEEK_LABEL = 'Thứ 2 đến Chủ nhật';
const SLOT_OPTIONS = [0, 0.5, 1, 1.5, 2];
const STATUS_META = {
  pending:  { label: 'Chưa chấm', short: 'Chưa',    tone: 'pending'  },
  upcoming: { label: 'Sắp tới',   short: 'Sắp tới',  tone: 'upcoming' },
  off:      { label: 'Không lịch',short: 'Không',    tone: 'off'      },
  prestart: { label: 'Chưa học',  short: 'Chưa học', tone: 'prestart' },
  taught:   { label: 'Đã học đủ', short: 'Đủ',       tone: 'taught'   },
  partial:  { label: 'Học thiếu', short: 'Thiếu',    tone: 'partial'  },
  absent:   { label: 'Nghỉ',      short: 'Nghỉ',     tone: 'absent'   },
  busy:     { label: 'Cô bận',    short: 'Bận',      tone: 'busy'     },
  makeup:   { label: 'Dạy bù',    short: 'Bù',       tone: 'makeup'   },
};

let weekOffset = 0;
const collapsedStudentIds = new Set();

export function render(el) {
  draw(el);

  if (!el._weekAttendanceSubscribed) {
    el._weekAttendanceSubscribed = true;
    Store.subscribe('sessions', () => draw(el));
    Store.subscribe('students', () => draw(el));
    Store.subscribe('debts', () => draw(el));
  }
}

function draw(el) {
  const week = getWeekRange(weekOffset);
  const dates = getWeekDates(week.start);
  const students = Store.get('students').filter(st => st.status !== 'inactive' && st.status !== 'stopped');
  const sessions = Store.get('sessions');
  const allDebts = typeof Store.reconcileDebts === 'function' ? Store.reconcileDebts() : Store.get('debts');
  const debts = allDebts.filter(d => !d.done);

  const cells = buildCells(students, dates, sessions);
  const scheduledCells = cells.filter(c => c.scheduled);
  const pendingCount = scheduledCells.filter(c => !c.session?.status && !isFutureDate(c.date.str)).length;
  const taughtCount = cells.filter(c => isAttended(c.session)).length;
  const actualSlots = cells.reduce((sum, c) => sum + getActualSlots(c.session), 0);
  const activeStudentCount = students.length;

  el.innerHTML = `
    <section class="week-attendance" aria-label="Chấm công tuần">
      <div class="week-attendance-sticky">
        <div class="week-attendance-head">
          <div>
            <div class="section-label">Chấm công tuần</div>
          </div>
          <button class="btn-sm" data-action="add-manual">+ Thêm buổi</button>
        </div>

        <div class="week-attendance-toolbar">
          <button class="icon-btn" data-action="prev-week" aria-label="Tuần trước"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M15 6C15 6 9.00001 10.4189 9 12C8.99999 13.5812 15 18 15 18" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
          <div class="week-attendance-summary">
            <strong>Tuần ${week.label}</strong>
          </div>
          <button class="icon-btn" data-action="next-week" aria-label="Tuần sau"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M9.00005 6C9.00005 6 15 10.4189 15 12C15 13.5812 9 18 9 18" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
        </div>
        <div class="week-attendance-meta">
          <span>${activeStudentCount} bé đang dạy</span>
          <span class="week-attendance-meta-dot" aria-hidden="true"></span>
          <span>${pendingCount} buổi chưa chấm</span>
          <span class="week-attendance-meta-dot" aria-hidden="true"></span>
          <span>${formatSlots(totalDebtSlots(debts))} ca còn nợ</span>
        </div>
      </div>

      ${students.length ? tableTemplate(students, dates, sessions) : emptyTemplate()}
      ${students.length ? mobileTemplate(students, dates, sessions) : ''}
      <div class="attendance-modal-slot" data-attendance-modal></div>
    </section>`;

  bindEvents(el, dates);
}

function tableTemplate(students, dates, sessions) {
  return `
    <div class="week-table-wrap">
      <table class="week-table">
        <thead>
          <tr>
            <th class="student-col">Học sinh</th>
            ${dates.map(d => `
              <th>
                <span>${DAYS[d.date.getDay()]}</span>
                <small>${fmtDateShort(d.str)}</small>
              </th>`).join('')}
          </tr>
        </thead>
        <tbody>
          ${students.map(st => `
            <tr>
              <td class="student-col">
                <div class="week-student-cell">
                  <div class="avatar sm" style="background:${avatarColor(st.name)}">${initials(st.name)}</div>
                  <div>
                    <strong>${escapeHTML(st.name)}</strong>
                    <span>Bắt đầu ${st.schedTime || '--:--'}</span>
                  </div>
                </div>
              </td>
              ${dates.map(d => cellTemplate(st, d, sessions)).join('')}
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

function mobileTemplate(students, dates, sessions) {
  return `
    <div class="week-mobile-list compact-week">
      ${students.map(st => {
        const cells = dates.map(d => buildCell(st, d, sessions));
        const isCollapsed = collapsedStudentIds.has(st.id);
        return `
          <article class="week-mobile-card week-calendar-card ${isCollapsed ? 'is-collapsed' : 'is-open'}">
            <button class="week-mobile-student week-mobile-student-toggle" type="button" data-action="toggle-week-student" data-student-id="${st.id}" aria-expanded="${isCollapsed ? 'false' : 'true'}">
              <div class="avatar sm" style="background:${avatarColor(st.name)}">${initials(st.name)}</div>
              <div class="week-mobile-student-info">
                <strong>${escapeHTML(st.name)}</strong>
                <span>Bắt đầu ${st.schedTime || '--:--'}</span>
              </div>
              <span class="week-mobile-student-arrow" aria-hidden="true">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" style="transform:rotate(90deg)"><path d="M9.00005 6C9.00005 6 15 10.4189 15 12C15 13.5812 9 18 9 18" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
              </span>
            </button>
            <div class="week-calendar-grid" role="group" aria-label="Lịch chấm công tuần của ${escapeHTML(st.name)}" ${isCollapsed ? 'hidden' : ''}>
              ${cells.map(c => mobileCalendarCellTemplate(c)).join('')}
            </div>
          </article>`;
      }).join('')}
    </div>`;
}

function cellTemplate(st, d, sessions) {
  const cell = buildCell(st, d, sessions);
  const view = getCellView(cell);
  const future = isFutureDate(d.str);
  const preStart = cell.preStart;
  const disabled = future || preStart;
  const actionAttrs = disabled ? 'disabled aria-disabled="true"' : `data-action="open-attendance" data-student-id="${st.id}" data-date="${d.str}"`;
  return `
    <td class="week-cell status-${view.tone} ${future ? 'is-future' : ''} ${preStart ? 'is-prestart' : ''}">
      <button class="attendance-pill" ${actionAttrs} aria-label="${escapeHTML(st.name)} - ${DAYS[d.date.getDay()]} ${fmtDateShort(d.str)}">
        <span>${view.label}</span>
        ${view.meta ? `<small>${view.meta}</small>` : ''}
      </button>
      ${cell.session?.noteProgress || cell.session?.noteParent ? '<span class="week-note-dot" title="Có ghi chú"></span>' : ''}
    </td>`;
}

function mobileCalendarCellTemplate(cell) {
  const view = getCellView(cell);
  const dayLabel = DAYS[cell.date.date.getDay()];
  const dateLabel = fmtDateShort(cell.date.str);
  const future = isFutureDate(cell.date.str);
  const preStart = cell.preStart;
  const disabled = future || preStart;
  const actionAttrs = disabled ? 'disabled aria-disabled="true"' : `data-action="open-attendance" data-student-id="${cell.student.id}" data-date="${cell.date.str}"`;

  return `
    <div class="week-calendar-cell status-${view.tone} ${future ? 'is-future' : ''} ${preStart ? 'is-prestart' : ''}">
      <div class="week-calendar-date">
        <strong>${dayLabel}</strong>
        <span>${dateLabel}</span>
      </div>
      <button class="attendance-pill week-calendar-pill" ${actionAttrs} aria-label="${escapeHTML(cell.student.name)} - ${dayLabel} ${dateLabel}">
        <span>${view.short}</span>
        ${view.mobileMeta ? `<small>${view.mobileMeta}</small>` : ''}
      </button>
    </div>`;
}

function getCellView(cell) {
  if (cell.preStart) {
    return { ...STATUS_META.prestart, meta: '', mobileMeta: '' };
  }
  const future = isFutureDate(cell.date.str);
  if (future) {
    return cell.scheduled
      ? { ...STATUS_META.upcoming, meta: '', mobileMeta: '' }
      : { ...STATUS_META.off, meta: '', mobileMeta: '' };
  }
  const sess = cell.session;
  if (!sess?.status) {
    return cell.scheduled ? { ...STATUS_META.pending, meta: '', mobileMeta: '' } : { ...STATUS_META.off, meta: '', mobileMeta: '' };
  }

  const status = getVisualStatus(sess);
  const planned = getPlannedSlots(cell);
  const actual = getActualSlots(sess);
  const debt = getDebtSlots(sess, planned, actual);

  if (status === 'taught') {
    const extra = getMakeupSlots(sess, planned, actual);
    const meta = extra > 0 ? `${formatSlots(planned || actual)} ca · +${formatSlots(extra)} bù` : `${formatSlots(actual)} ca`;
    const mobileMeta = extra > 0 ? `+${formatSlots(extra)} bù` : formatSlots(actual);
    return { ...STATUS_META.taught, label: 'Đủ', meta, mobileMeta };
  }
  if (status === 'partial') {
    if (isSessionDebtPaid(sess)) {
      return { ...STATUS_META.taught, label: 'Đủ', meta: `${formatSlots(planned)} ca · đã bù`, mobileMeta: 'Đã bù' };
    }
    return { ...STATUS_META.partial, label: 'Thiếu', meta: `${formatSlots(actual)}/${formatSlots(planned)} ca`, mobileMeta: `${formatSlots(actual)}/${formatSlots(planned)}` };
  }
  if (status === 'makeup') {
    return { ...STATUS_META.makeup, label: 'Dạy bù', meta: `+${formatSlots(actual)} ca`, mobileMeta: `+${formatSlots(actual)}` };
  }
  if (status === 'absent') {
    if (isSessionDebtPaid(sess) || debt <= 0) {
      return { ...STATUS_META.taught, label: 'Đủ', meta: `${formatSlots(planned || sess.debtSlots || 0)} ca · đã bù`, mobileMeta: 'Đã bù' };
    }
    return { ...STATUS_META.absent, label: 'Nghỉ', meta: `Nợ ${formatSlots(debt)} ca`, mobileMeta: `Nợ ${formatSlots(debt)}` };
  }
  if (status === 'busy') {
    if (isSessionDebtPaid(sess) || debt <= 0) {
      return { ...STATUS_META.taught, label: 'Đủ', meta: `${formatSlots(planned || sess.debtSlots || 0)} ca · đã bù`, mobileMeta: 'Đã bù' };
    }
    return { ...STATUS_META.busy, label: 'Cô bận', meta: `Nợ ${formatSlots(debt)} ca`, mobileMeta: `Nợ ${formatSlots(debt)}` };
  }
  return { ...STATUS_META.pending, meta: '', mobileMeta: '' };
}

function buildCells(students, dates, sessions) {
  return students.flatMap(st => dates.map(d => buildCell(st, d, sessions)));
}

function buildCell(st, d, sessions) {
  const session = sessions.find(s => s.studentId === st.id && s.date === d.str);
  const scheduled = (st.schedDays || []).includes(d.date.getDay());
  const preStart = isBeforeStudentStart(st, d.str);
  return { student: st, date: d, session, scheduled, preStart };
}

function bindEvents(el, dates) {
  el.querySelector('[data-action="prev-week"]')?.addEventListener('click', () => {
    weekOffset -= 1;
    draw(el);
  });

  el.querySelector('[data-action="next-week"]')?.addEventListener('click', () => {
    weekOffset += 1;
    draw(el);
  });

  el.querySelector('[data-action="add-manual"]')?.addEventListener('click', () => {
    addManualSession(el, dates);
  });

  el.querySelectorAll('[data-action="toggle-week-student"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const studentId = btn.dataset.studentId;
      if (!studentId) return;
      if (collapsedStudentIds.has(studentId)) collapsedStudentIds.delete(studentId);
      else collapsedStudentIds.add(studentId);
      draw(el);
    });
  });

  el.querySelectorAll('[data-action="open-attendance"]').forEach(btn => {
    btn.addEventListener('click', () => openAttendanceModal(el, btn.dataset.studentId, btn.dataset.date));
  });
}

function openAttendanceModal(root, studentId, date) {
  if (isFutureDate(date)) {
    alert('Không thể chấm công cho ngày trong tương lai.');
    return;
  }
  const students = Store.get('students');
  const sessions = Store.get('sessions');
  const debts = Store.get('debts').filter(d => d.studentId === studentId && !d.done);
  const st = students.find(s => s.id === studentId);
  if (!st) return;
  if (isBeforeStudentStart(st, date)) {
    alert('Ngày này trước ngày bắt đầu học của học sinh.');
    return;
  }

  const dt = new Date(date + 'T00:00:00');
  const scheduled = (st.schedDays || []).includes(dt.getDay());
  const existing = sessions.find(s => s.studentId === studentId && s.date === date);
  const planned = Number(existing?.plannedSlots ?? (scheduled ? st.duration || 1 : 0));
  const visual = getVisualStatus(existing) || (scheduled ? '' : '');
  const defaultStatus = visual || (scheduled ? 'taught' : 'makeup');
  const defaultActual = getModalDefaultActual(existing, defaultStatus, planned, debts);
  const activeDebt = existing?.makeupFor ? debts.find(d => d.id === existing.makeupFor) : debts[0];

  const slot = root.querySelector('[data-attendance-modal]');
  slot.innerHTML = `
    <div class="attendance-modal-backdrop" data-action="close-attendance"></div>
    <div class="attendance-modal" role="dialog" aria-modal="true" aria-label="Chấm công chi tiết">
      <div class="attendance-modal-head">
        <div>
          <strong>${escapeHTML(st.name)}</strong>
          <span>${formatFullDate(date)} · ${st.schedTime || '--:--'}</span>
        </div>
        <button class="attendance-modal-close" data-action="close-attendance" aria-label="Đóng"><svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M15 5L5 15M5 5L15 15" stroke="#454B50" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
      </div>

      <div class="attendance-section">
        <label class="attendance-label">Trạng thái buổi học</label>
        <div class="attendance-status-grid" data-status-group>
          ${statusChoice('taught', 'Đã học đủ', defaultStatus)}
          ${statusChoice('partial', 'Học thiếu', defaultStatus)}
          ${statusChoice('absent', 'Nghỉ', defaultStatus)}
          ${statusChoice('busy', 'Cô bận', defaultStatus)}
          ${statusChoice('makeup', 'Dạy bù', defaultStatus)}
        </div>
      </div>

      <div class="attendance-section attendance-slot-section" data-slot-section>
        <label class="attendance-label" data-slot-label>Số ca thực tế</label>
        <div class="attendance-slot-grid" data-slot-group>
          ${SLOT_OPTIONS.map(v => `<button type="button" class="slot-chip ${Number(defaultActual) === v ? 'active' : ''}" data-slot="${v}">${formatSlots(v)} ca</button>`).join('')}
        </div>
      </div>
      <div class="attendance-hint" data-debt-preview>${previewText(defaultStatus, planned, defaultActual, activeDebt)}</div>

      ${debts.length ? `
        <div class="attendance-section" data-makeup-debt-wrap>
          <label class="attendance-label">Bù cho ca nợ</label>
          <select class="attendance-debt-select" data-debt-select>
            ${debts.map(d => `<option value="${d.id}" ${activeDebt?.id === d.id ? 'selected' : ''}>${formatFullDate(d.date)} · còn ${formatSlots(d.slots)} ca</option>`).join('')}
          </select>
        </div>` : `
        <div class="attendance-section muted" data-makeup-debt-wrap>
          <span>Chưa có ca nợ bù mở cho học sinh này.</span>
        </div>`}

      <div class="attendance-modal-actions">
        <button class="session-note-btn secondary" data-action="clear-attendance">Xóa chấm công</button>
        <button class="session-note-btn primary" data-action="save-attendance">Lưu chấm công</button>
      </div>
    </div>`;

  let selectedStatus = defaultStatus;
  let selectedSlot = Number(defaultActual);

  const updatePreview = () => {
    const debtId = slot.querySelector('[data-debt-select]')?.value;
    const selectedDebt = debts.find(d => d.id === debtId) || activeDebt;
    const showSlots = shouldShowSlotPicker(selectedStatus);
    const slotSection = slot.querySelector('[data-slot-section]');
    const slotLabel = slot.querySelector('[data-slot-label]');

    slotSection?.classList.toggle('is-hidden', !showSlots);
    if (slotLabel) slotLabel.textContent = selectedStatus === 'makeup' ? 'Số ca dạy bù' : 'Số ca thực tế';

    slot.querySelector('[data-debt-preview]').textContent = previewText(selectedStatus, planned, selectedSlot, selectedDebt);
    slot.querySelector('[data-makeup-debt-wrap]')?.classList.toggle('is-hidden', selectedStatus !== 'makeup');
  };

  slot.querySelectorAll('[data-status]').forEach(btn => {
    btn.addEventListener('click', () => {
      selectedStatus = btn.dataset.status;
      if (selectedStatus === 'taught') selectedSlot = planned || Number(st.duration || 1);
      if (selectedStatus === 'partial') selectedSlot = getPartialDefaultSlot(planned);
      if (selectedStatus === 'absent' || selectedStatus === 'busy') selectedSlot = 0;
      if (selectedStatus === 'makeup') selectedSlot = Number((debts[0]?.slots ?? 0.5));
      slot.querySelectorAll('[data-status]').forEach(b => b.classList.toggle('active', b === btn));
      slot.querySelectorAll('[data-slot]').forEach(b => b.classList.toggle('active', Number(b.dataset.slot) === selectedSlot));
      updatePreview();
    });
  });

  slot.querySelectorAll('[data-slot]').forEach(btn => {
    btn.addEventListener('click', () => {
      selectedSlot = Number(btn.dataset.slot);
      slot.querySelectorAll('[data-slot]').forEach(b => b.classList.toggle('active', b === btn));
      updatePreview();
    });
  });

  slot.querySelector('[data-debt-select]')?.addEventListener('change', updatePreview);

  slot.querySelectorAll('[data-action="close-attendance"]').forEach(btn => {
    btn.addEventListener('click', () => { slot.innerHTML = ''; });
  });

  slot.querySelector('[data-action="clear-attendance"]')?.addEventListener('click', () => {
    if (!existing) { slot.innerHTML = ''; return; }
    Store.upsertSession({ ...existing, status: '', type: 'normal', actualSlots: 0, debtSlots: 0, makeupFor: null, duration: 0 });
    slot.innerHTML = '';
  });

  slot.querySelector('[data-action="save-attendance"]')?.addEventListener('click', () => {
    const actualSlotsForSave = getActualForStatus(selectedStatus, selectedSlot, planned, st);
    saveDetailedSession({ student: st, date, scheduled, existing, status: selectedStatus, actualSlots: actualSlotsForSave, debtId: slot.querySelector('[data-debt-select]')?.value || null });
    slot.innerHTML = '';
  });

  updatePreview();
}


function shouldShowSlotPicker(status) {
  return status === 'partial' || status === 'makeup';
}

function getActualForStatus(status, selectedSlot, planned, student) {
  if (status === 'taught') return Number(planned || student.duration || 1);
  if (status === 'absent' || status === 'busy') return 0;
  return Number(selectedSlot || 0);
}

function getPartialDefaultSlot(planned) {
  const p = Number(planned || 0);
  if (p <= 0.5) return 0;
  return Math.max(0.5, p - 0.5);
}

function saveDetailedSession({ student, date, scheduled, existing, status, actualSlots, debtId }) {
  rollbackMakeupAllocations(existing);

  const plannedSlots = scheduled && status !== 'makeup' ? Number(student.duration || 1) : 0;
  const requestedActual = Number(actualSlots || 0);
  const effectiveStatus = resolveEffectiveStatus(status, requestedActual, plannedSlots);
  const actual = normalizeActual(effectiveStatus, requestedActual, plannedSlots);
  const debtSlots = calcDebtSlots(effectiveStatus, plannedSlots, actual);

  const sess = {
    ...(existing || {}),
    id: existing?.id || uid(),
    studentId: student.id,
    date,
    startTime: student.schedTime,
    plannedSlots,
    actualSlots: actual,
    debtSlots,
    duration: actual,
    type: effectiveStatus === 'makeup' ? 'makeup' : 'normal',
    status: effectiveStatus,
    makeupFor: null,
    makeupSlots: 0,
    makeupAllocations: [],
    noteSkill: existing?.noteSkill || '',
    noteBehavior: existing?.noteBehavior || '',
    noteProgress: existing?.noteProgress || '',
    noteParent: existing?.noteParent || '',
  };

  Store.upsertSession(sess);

  let allocationResult = { applied: 0, allocations: [] };

  if (effectiveStatus === 'makeup') {
    allocationResult = debtId
      ? applyMakeupToDebt(debtId, actual, sess.id)
      : applyMakeupFIFO(student.id, actual, sess.id, date);
  } else if (effectiveStatus === 'taught' && plannedSlots > 0 && actual > plannedSlots) {
    const extraSlots = actual - plannedSlots;
    allocationResult = applyMakeupFIFO(student.id, extraSlots, sess.id, date);
  }

  if (allocationResult.applied > 0 || (effectiveStatus === 'taught' && actual > plannedSlots)) {
    Store.upsertSession({
      ...sess,
      makeupSlots: allocationResult.applied,
      makeupAllocations: allocationResult.allocations,
      makeupFor: allocationResult.allocations[0]?.debtId || null,
    });
  }
}

function resolveEffectiveStatus(status, actual, planned) {
  if (status === 'taught' && planned > 0 && Number(actual || 0) < planned) return 'partial';
  if (status === 'partial' && planned > 0 && Number(actual || 0) >= planned) return 'taught';
  return status;
}

function normalizeActual(status, actual, planned) {
  const value = Number(actual || 0);
  if (status === 'taught') return value > 0 ? value : (planned || 1);
  if (status === 'partial') return Math.max(0, Math.min(value, planned || value));
  if (status === 'makeup') return Math.max(0.5, value || 0.5);
  if (status === 'absent' || status === 'busy') return 0;
  return value;
}

function calcDebtSlots(status, planned, actual) {
  if (status === 'partial') return Math.max(Number(planned || 0) - Number(actual || 0), 0);
  if (status === 'absent' || status === 'busy') return Number(planned || 0);
  return 0;
}

function applyMakeupToDebt(debtId, paidSlots, sourceSessionId = null) {
  const debts = Store.get('debts');
  let applied = 0;
  let allocation = null;
  const next = debts.map(d => {
    if (d.id !== debtId || d.done) return d;
    const use = Math.min(Number(d.slots || 0), Number(paidSlots || 0));
    const remain = Math.max(Number(d.slots || 0) - use, 0);
    applied = use;
    allocation = { debtId: d.id, sessionId: d.sessionId, slots: use, date: d.date };
    return { ...d, slots: remain, done: remain <= 0, lastMakeupSessionId: sourceSessionId || d.lastMakeupSessionId || null };
  });
  Store.set('debts', next);
  return { applied, allocations: allocation ? [allocation] : [] };
}

function applyMakeupFIFO(studentId, availableSlots, sourceSessionId, sourceDate) {
  let remainMakeup = Number(availableSlots || 0);
  if (remainMakeup <= 0) return { applied: 0, allocations: [] };

  const debts = Store.get('debts');
  const sortedDebtIds = debts
    .filter(d =>
      d.studentId === studentId &&
      !d.done &&
      Number(d.slots || 0) > 0 &&
      d.sessionId !== sourceSessionId
      // Cho phép dạy bù trước: không giới hạn ca nợ phải cũ hơn ngày dạy bù.
    )
    .sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.id).localeCompare(String(b.id)))
    .map(d => d.id);

  const allocations = [];
  const next = debts.map(d => {
    if (!sortedDebtIds.includes(d.id) || remainMakeup <= 0) return d;
    const current = Number(d.slots || 0);
    const use = Math.min(current, remainMakeup);
    remainMakeup = Math.max(remainMakeup - use, 0);
    const nextSlots = Math.max(current - use, 0);
    allocations.push({ debtId: d.id, sessionId: d.sessionId, slots: use, date: d.date });
    return {
      ...d,
      slots: nextSlots,
      done: nextSlots <= 0,
      lastMakeupSessionId: sourceSessionId,
      lastMakeupDate: sourceDate,
    };
  });

  if (allocations.length) Store.set('debts', next);
  return {
    applied: allocations.reduce((sum, item) => sum + Number(item.slots || 0), 0),
    allocations,
  };
}

function rollbackMakeupAllocations(existing) {
  const allocations = existing?.makeupAllocations || [];
  if (!allocations.length) return;

  const debts = Store.get('debts');
  const next = debts.map(d => {
    const related = allocations.filter(a => a.debtId === d.id);
    if (!related.length) return d;
    const restored = related.reduce((sum, a) => sum + Number(a.slots || 0), 0);
    const slots = Number(d.slots || 0) + restored;
    return { ...d, slots, done: false };
  });
  Store.set('debts', next);
}

function addManualSession(root, dates) {
  const students = Store.get('students');
  const list = students.map(s => `${s.id}: ${displayName(s)}`).join('\n');
  const sel = prompt('Nhập ID hoặc tên học sinh:\n' + list);
  if (!sel) return;

  const keyword = sel.trim().toLowerCase();
  const st = students.find(s =>
    s.id.toLowerCase() === keyword || s.name.toLowerCase().includes(keyword)
  );
  if (!st) return alert('Không tìm thấy học sinh');

  const defaultDate = dates.find(d => (st.schedDays || []).includes(d.date.getDay()))?.str || dates[0]?.str;
  const inputDate = prompt('Nhập ngày cần thêm trong tuần, định dạng YYYY-MM-DD:', defaultDate);
  if (!inputDate) return;

  const isInWeek = dates.some(d => d.str === inputDate.trim());
  if (!isInWeek) return alert('Ngày này không nằm trong tuần đang xem');
  if (isFutureDate(inputDate.trim())) return alert('Không thể thêm/chấm công cho ngày trong tương lai');
  if (isBeforeStudentStart(st, inputDate.trim())) return alert('Ngày này trước ngày bắt đầu học của học sinh');

  openAttendanceModal(root, st.id, inputDate.trim());
}

function getWeekDates(start) {
  const startDate = new Date(start + 'T00:00:00');
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(startDate);
    d.setDate(startDate.getDate() + i);
    return { date: d, str: toLocalDateStr(d) };
  });
}

function statusChoice(value, label, active) {
  return `<button type="button" class="attendance-status-choice ${active === value ? 'active' : ''}" data-status="${value}">${label}</button>`;
}

function getVisualStatus(session) {
  if (!session?.status) return '';
  if (session.type === 'makeup' || session.status === 'makeup') return 'makeup';
  if (session.status === 'partial') return 'partial';
  return session.status;
}

function isAttended(session) {
  const status = getVisualStatus(session);
  return ['taught', 'partial', 'makeup'].includes(status) && getActualSlots(session) > 0;
}

function getActualSlots(session) {
  if (!session) return 0;
  return Number(session.actualSlots ?? session.duration ?? 0);
}

function getPlannedSlots(cell) {
  return Number(cell.session?.plannedSlots ?? (cell.scheduled ? cell.student.duration || 1 : 0));
}

function getMakeupSlots(session, planned = 0, actual = 0) {
  if (!session) return 0;
  if (Number(session.makeupSlots || 0) > 0) return Number(session.makeupSlots || 0);
  if (session.type === 'makeup' || session.status === 'makeup') return Number(actual || 0);
  return Math.max(Number(actual || 0) - Number(planned || 0), 0);
}

function isSessionDebtPaid(session) {
  if (!session?.id) return false;
  const sessionDebts = Store.get('debts').filter(d => d.sessionId === session.id);
  return sessionDebts.length > 0 && sessionDebts.every(d => d.done || Number(d.slots || 0) <= 0);
}

function getDebtSlots(session, planned = 0, actual = 0) {
  if (!session) return 0;
  const debt = Store.get('debts').find(d => d.sessionId === session.id);
  if (debt) return Number(debt.slots || 0);
  return Number(session.debtSlots ?? calcDebtSlots(session.status, planned, actual));
}

function getModalDefaultActual(existing, status, planned, debts) {
  if (existing) return getActualSlots(existing);
  if (status === 'taught') return planned || 1;
  if (status === 'partial') return getPartialDefaultSlot(planned);
  if (status === 'makeup') return Number(debts[0]?.slots || 0.5);
  return 0;
}

function previewText(status, planned, actual, debt) {
  const a = Number(actual || 0);
  if (status === 'partial') return `Kế hoạch ${formatSlots(planned)} ca · thực học ${formatSlots(a)} ca · còn thiếu ${formatSlots(Math.max(planned - a, 0))} ca.`;
  if (status === 'absent') return `Nghỉ buổi này · tự tạo nợ ${formatSlots(planned)} ca cần bù.`;
  if (status === 'busy') return `Cô bận · tự tạo nợ ${formatSlots(planned)} ca cần bù.`;
  if (status === 'makeup') return debt ? `Dạy bù ${formatSlots(a)} ca. App sẽ trừ vào ca thiếu cũ nhất trước.` : `Dạy bù ${formatSlots(a)} ca. Nếu chưa có ca nợ, app sẽ ghi nhận như ca bù trước và tự trừ khi phát sinh nghỉ/cô bận sau này.`;
  if (status === 'taught') return `Đã học đủ ${formatSlots(planned || a)} ca. Không cần nhập số ca thực tế.`;
  return '';
}

function isBeforeStudentStart(student, dateStr) {
  return Boolean(student?.startDate) && String(dateStr) < String(student.startDate);
}

function isFutureDate(value) {
  return value > todayStr();
}

function totalDebtSlots(debts) {
  return debts.reduce((sum, d) => sum + Number(d.slots || 0), 0);
}

function formatSlots(value) {
  return Number(value || 0).toLocaleString('vi-VN', { maximumFractionDigits: 1 });
}

function formatFullDate(value) {
  const d = new Date(value + 'T00:00:00');
  const label = ['Chủ nhật','Thứ 2','Thứ 3','Thứ 4','Thứ 5','Thứ 6','Thứ 7'][d.getDay()];
  return `${label}, ${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
}

function emptyTemplate() {
  return `
    <div class="empty-state">
      <div class="icon"><span class="empty-emoji emoji" aria-hidden="true">📅</span></div>
      <div class="title">Chưa có học sinh</div>
      <div class="sub">Thêm học sinh trước khi chấm công tuần</div>
    </div>`;
}

function escapeHTML(value) {
  return String(value || '').replace(/[&<>"]/g, ch => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;'
  }[ch]));
}
