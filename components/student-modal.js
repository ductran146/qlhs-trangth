/**
 * components/student-modal.js
 * Full add/edit student modal.
 * Call open(studentId?) to open, close() to close.
 *
 * Used by: pages/students.html, pages/checkin.html
 */
import { Store, uid, todayStr } from '../shared/store.js';

const DIFFICULTIES = ['Tự kỷ','Tăng động','Chậm nói','Chậm phát triển','Hội chứng Down','Khiếm thính','Khiếm thị','Khác'];
const DAYS_SHORT   = ['CN','T2','T3','T4','T5','T6','T7'];

let _editingId = null;

export function render(el, dataset) {
  el.innerHTML = `
    <div class="overlay" id="studentModalOverlay">
      <div class="modal student-modal" role="dialog" aria-modal="true" aria-labelledby="studentModalTitle">
        <div class="modal-header">
          <div class="modal-title" id="studentModalTitle">Thêm học sinh</div>
          <button class="modal-close" id="smClose" type="button" aria-label="Đóng">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M15 5L5 15M5 5L15 15" stroke="#454B50" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
        </div>

        <div class="form-row">
          <div class="form-group" style="grid-column:1/-1">
            <label class="form-label">Họ và tên *</label>
            <div class="sm-field-wrap">
              <input class="form-input" id="smName" type="text" placeholder="Bé Nguyễn Văn An">
              <button type="button" class="sm-field-clear" aria-label="Xóa" tabindex="-1" hidden></button>
            </div>
          </div>
        </div>

        <div class="form-row sm-dob-gender-row sm-birth-gender-row">
          <div class="form-group">
            <label class="form-label">Năm sinh</label>
            <select class="form-input form-select ds-select" id="smBirthYear">
              ${_yearOptions()}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Giới tính</label>
            <select class="form-input form-select ds-select" id="smGender">
              <option value="Nam">Nam</option>
              <option value="Nữ">Nữ</option>
            </select>
          </div>
        </div>

        <div class="form-row sm-start-status-row">
          <div class="form-group sm-start-date-group">
            <label class="form-label">Ngày bắt đầu học *</label>
            <div class="sm-date-wrap">
              <button type="button" class="form-input sm-date-display" id="smDateDisplay" autocomplete="off" aria-haspopup="true">
                <span id="smDateText">Chọn ngày</span>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M8 2v3M16 2v3M3 8h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
              </button>
              <input type="hidden" id="smStartDate">
              <div class="sm-calendar" id="smCalendar" hidden></div>
            </div>
          </div>
          <div class="form-group sm-status-group is-edit-only" id="smStatusGroup" style="display:none">
            <label class="form-label">Trạng thái học sinh</label>
            <select class="form-input form-select" id="smStatus">
              <option value="active">Đang học</option>
              <option value="inactive">Đã nghỉ</option>
            </select>
          </div>
        </div>

        <div class="modal-section">Thông tin phụ huynh</div>

        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Tên bố</label>
            <div class="sm-field-wrap">
              <input class="form-input" id="smFatherName" type="text" placeholder="Anh/Chú...">
              <button type="button" class="sm-field-clear" aria-label="Xóa" tabindex="-1" hidden></button>
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">Tên mẹ</label>
            <div class="sm-field-wrap">
              <input class="form-input" id="smMotherName" type="text" placeholder="Chị/Cô...">
              <button type="button" class="sm-field-clear" aria-label="Xóa" tabindex="-1" hidden></button>
            </div>
          </div>
        </div>

        <div class="form-group">
          <label class="form-label">Đặc điểm / khó khăn chính</label>
          <div class="diff-picker" id="smDiffPicker"></div>
        </div>

        <div class="form-group">
          <label class="form-label">Mục tiêu can thiệp</label>
          <div class="sm-field-wrap sm-field-wrap--ta">
            <textarea class="form-input" id="smGoal" rows="2"
              placeholder="Phát triển ngôn ngữ, tăng tập trung..."></textarea>
            <button type="button" class="sm-field-clear" aria-label="Xóa" tabindex="-1" hidden></button>
          </div>
        </div>

        <div class="modal-section">Lịch học &amp; học phí</div>

        <div class="form-group">
          <label class="form-label">Ngày học trong tuần</label>
          <div class="day-picker" id="smDayPicker"></div>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Giờ bắt đầu</label>
            <input class="form-input" id="smTime" type="time" value="08:00">
          </div>
          <div class="form-group">
            <label class="form-label">Số ca mỗi lịch học</label>
            <select class="form-input form-select" id="smDuration">
              <option value="0.5">0.5 ca — 30 phút</option>
              <option value="1" selected>1 ca — 60 phút</option>
              <option value="1.5">1.5 ca — 90 phút</option>
              <option value="2">2 ca — 120 phút</option>
            </select>
          </div>
        </div>

        <div class="form-group">
          <label class="form-label">Học phí / ca (VND)</label>
          <div class="sm-field-wrap">
            <input class="form-input sm-fee-input" id="smFee" type="text" inputmode="numeric" placeholder="110.000" autocomplete="off">
            <button type="button" class="sm-field-clear" aria-label="Xóa" tabindex="-1" hidden></button>
          </div>
        </div>

        <div class="modal-footer">
          <button class="btn btn-outline" id="smCancel">Hủy</button>
          <button class="btn btn-primary" id="smSave">Lưu học sinh</button>
        </div>
      </div>
    </div>`;

  // Build pickers
  _buildDiffPicker(el, []);
  _buildDayPicker(el, []);

  // Events
  el.querySelector('#smClose')?.addEventListener('click', close);
  el.querySelector('#smCancel').addEventListener('click', close);
  // Không đóng khi click backdrop — chỉ đóng bằng nút X hoặc Hủy
  el.querySelector('#smSave').addEventListener('click', () => _save(el));
  _buildCalendar(el);
  _bindClearButtons(el);
  _bindFeeInput(el);
  _bindKeyboardAssist(el);

  // Expose open/close globally so pages can call them
  window.StudentModal = { open: (id) => _open(el, id), close };
}

function _open(el, id = null) {
  _editingId = id;
  const st = id ? Store.get('students').find(s => s.id === id) : null;

  const isEdit = Boolean(id);
  el.querySelector('#studentModalTitle').textContent = isEdit ? 'Sửa thông tin' : 'Thêm học sinh';

  const startStatusRow = el.querySelector('.sm-start-status-row');
  const statusGroup = el.querySelector('#smStatusGroup');
  startStatusRow?.classList.toggle('is-add-mode', !isEdit);
  startStatusRow?.classList.toggle('is-edit-mode', isEdit);
  if (statusGroup) {
    // Khi thêm mới học sinh: không hiển thị trạng thái.
    // Trạng thái chỉ dùng ở chế độ sửa để chuyển Đang học / Đã nghỉ.
    statusGroup.hidden = !isEdit;
    statusGroup.style.display = isEdit ? '' : 'none';
    statusGroup.setAttribute('aria-hidden', isEdit ? 'false' : 'true');
    statusGroup.querySelector('select')?.toggleAttribute('disabled', !isEdit);
  }

  el.querySelector('#smName').value    = st?.name    || '';
  el.querySelector('#smBirthYear').value = _yearFromDob(st?.dob || '');
  el.querySelector('#smGender').value  = st?.gender  || 'Nam';
  _setCalendarDate(el, st?.startDate || todayStr());
  el.querySelector('#smStatus').value = st?.status || 'active';
  el.querySelector('#smGoal').value    = st?.goal    || '';
  el.querySelector('#smFatherName').value = st?.fatherName || '';
  el.querySelector('#smMotherName').value = st?.motherName || '';
  el.querySelector('#smTime').value    = _formatTimeForInput(st?.schedTime || '08:00');
  el.querySelector('#smDuration').value = String(st?.duration || 1);
  el.querySelector('#smFee').value     = st?.feePerSlot ? _formatFee(st.feePerSlot) : '';

  _buildDiffPicker(el, st?.difficulties || []);
  _buildDayPicker(el, st?.schedDays ?? [1,2,3,4,5,6]);

  document.body.classList.add('modal-open');
  el.querySelector('#studentModalOverlay').classList.add('open');

  requestAnimationFrame(() => {
    el.querySelector('.modal')?.scrollTo({ top: 0, behavior: 'auto' });
  });
}

function close() {
  document.querySelector('#studentModalOverlay')?.classList.remove('open');
  document.body.classList.remove('modal-open');
  document.querySelector('.modal.is-keyboard-open')?.classList.remove('is-keyboard-open');
}

function _bindKeyboardAssist(el) {
  const overlay = el.querySelector('#studentModalOverlay');
  const modal = el.querySelector('.modal');
  if (!overlay || !modal || overlay.dataset.keyboardAssist === '1') return;

  overlay.dataset.keyboardAssist = '1';

  const scrollActiveFieldIntoView = (target) => {
    if (!target?.matches?.('input, textarea, select')) return;
    modal.classList.add('is-keyboard-open');

    const run = () => {
      target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
    };

    requestAnimationFrame(run);
    setTimeout(run, 260);
    setTimeout(run, 520);
  };

  overlay.addEventListener('focusin', (event) => scrollActiveFieldIntoView(event.target));
  overlay.addEventListener('focusout', () => {
    setTimeout(() => {
      const active = document.activeElement;
      if (!overlay.contains(active) || !active?.matches?.('input, textarea, select')) {
        modal.classList.remove('is-keyboard-open');
      }
    }, 120);
  });

  window.visualViewport?.addEventListener('resize', () => {
    if (!overlay.classList.contains('open')) return;
    const active = document.activeElement;
    if (overlay.contains(active) && active?.matches?.('input, textarea, select')) {
      const keyboardInset = Math.max(0, window.innerHeight - window.visualViewport.height - window.visualViewport.offsetTop);
      modal.style.setProperty('--keyboard-inset', `${keyboardInset}px`);
      scrollActiveFieldIntoView(active);
    }
  });
}

function _save(el) {
  const name = el.querySelector('#smName').value.trim();
  if (!name) { alert('Vui lòng nhập tên học sinh'); return; }

  const schedDays    = [...el.querySelectorAll('.day-chip.selected')].map(c => +c.dataset.day);
  const difficulties = [...el.querySelectorAll('.diff-chip.selected')].map(c => c.dataset.d);

  const startDate = el.querySelector('#smStartDate').value || todayStr();

  Store.upsertStudent({
    id: _editingId || uid(),
    name,
    dob:        _dobFromYear(el.querySelector('#smBirthYear').value),
    gender:     el.querySelector('#smGender').value,
    status:     _editingId ? (el.querySelector('#smStatus')?.value || 'active') : 'active',
    startDate,
    difficulties,
    goal:       el.querySelector('#smGoal').value.trim(),
    fatherName: el.querySelector('#smFatherName').value.trim(),
    motherName: el.querySelector('#smMotherName').value.trim(),
    schedDays,
    schedTime:  el.querySelector('#smTime').value || '08:00',
    duration:   +el.querySelector('#smDuration').value,
    feePerSlot: _parseFee(el.querySelector('#smFee').value),
  });

  close();
}



// ── Calendar picker ──────────────────────────────────────────────────────────

function _setCalendarDate(el, isoDate) {
  const hidden = el.querySelector('#smStartDate');
  const display = el.querySelector('#smDateText');
  if (!hidden || !display) return;
  hidden.value = isoDate || '';
  if (isoDate) {
    const [y, m, d] = isoDate.split('-');
    display.textContent = `${Number(d)}/${Number(m)}/${y}`;
  } else {
    display.textContent = 'Chọn ngày';
  }
}

function _buildCalendar(el) {
  const btn = el.querySelector('#smDateDisplay');
  const cal = el.querySelector('#smCalendar');
  if (!btn || !cal) return;

  // State
  const now = new Date();
  let viewYear  = now.getFullYear();
  let viewMonth = now.getMonth(); // 0-based

  const MONTHS_VN = ['Tháng 1','Tháng 2','Tháng 3','Tháng 4','Tháng 5','Tháng 6',
                     'Tháng 7','Tháng 8','Tháng 9','Tháng 10','Tháng 11','Tháng 12'];
  const DAYS_VN   = ['CN','T2','T3','T4','T5','T6','T7'];

  function getSelected() {
    return el.querySelector('#smStartDate').value || '';
  }

  function renderCal() {
    const selected = getSelected();
    const firstDay = new Date(viewYear, viewMonth, 1).getDay(); // 0=CN
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();

    let cells = '';
    // Ô trống đầu tháng
    for (let i = 0; i < firstDay; i++) cells += '<div class="sm-cal-day empty"></div>';
    for (let d = 1; d <= daysInMonth; d++) {
      const iso = `${viewYear}-${String(viewMonth+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      const isSelected = iso === selected;
      const isToday = iso === todayStr();
      cells += `<button type="button" class="sm-cal-day${isSelected?' selected':''}${isToday?' today':''}" data-date="${iso}">${d}</button>`;
    }

    cal.innerHTML = `
      <div class="sm-cal-head">
        <button type="button" class="sm-cal-nav" id="smCalPrev" aria-label="Tháng trước">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M15 6C15 6 9.00001 10.4189 9 12C8.99999 13.5812 15 18 15 18" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
        <span class="sm-cal-title">${MONTHS_VN[viewMonth]} ${viewYear}</span>
        <button type="button" class="sm-cal-nav" id="smCalNext" aria-label="Tháng sau">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M9.00005 6C9.00005 6 15 10.4189 15 12C15 13.5812 9 18 9 18" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
      </div>
      <div class="sm-cal-weekdays">${DAYS_VN.map(d=>`<div>${d}</div>`).join('')}</div>
      <div class="sm-cal-grid">${cells}</div>`;

    cal.querySelector('#smCalPrev')?.addEventListener('click', () => {
      viewMonth--; if (viewMonth < 0) { viewMonth = 11; viewYear--; } renderCal();
    });
    cal.querySelector('#smCalNext')?.addEventListener('click', () => {
      viewMonth++; if (viewMonth > 11) { viewMonth = 0; viewYear++; } renderCal();
    });
    cal.querySelectorAll('.sm-cal-day[data-date]').forEach(dayBtn => {
      dayBtn.addEventListener('click', () => {
        _setCalendarDate(el, dayBtn.dataset.date);
        cal.hidden = true;
        btn.setAttribute('aria-expanded', 'false');
        renderCal();
      });
    });
  }

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const isHidden = cal.hidden;
    cal.hidden = !isHidden;
    btn.setAttribute('aria-expanded', String(isHidden));
    if (isHidden) {
      // Reset view về tháng của ngày đang chọn hoặc tháng hiện tại
      const sel = getSelected();
      if (sel) {
        const [y, m] = sel.split('-');
        viewYear = Number(y); viewMonth = Number(m) - 1;
      } else {
        viewYear = now.getFullYear(); viewMonth = now.getMonth();
      }
      renderCal();
    }
  });

  // Đóng calendar khi click ra ngoài
  document.addEventListener('click', (e) => {
    if (!cal.hidden && !cal.contains(e.target) && e.target !== btn) {
      cal.hidden = true;
      btn.setAttribute('aria-expanded', 'false');
    }
  }, { capture: true });
}


// ── Clear button & fee format helpers ────────────────────────────────────────

const CLEAR_SVG = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 4L4 12M4 4l8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';

function _bindClearButtons(el) {
  el.querySelectorAll('.sm-field-wrap').forEach(wrap => {
    const field = wrap.querySelector('input, textarea');
    const btn   = wrap.querySelector('.sm-field-clear');
    if (!field || !btn) return;

    btn.innerHTML = CLEAR_SVG;

    const update = () => {
      btn.hidden = field.value.trim() === '';
    };

    field.addEventListener('input', update);
    field.addEventListener('focus', update);
    field.addEventListener('blur', () => {
      // Delay để click clear không bị blur trước
      setTimeout(update, 150);
    });

    btn.addEventListener('mousedown', e => e.preventDefault()); // giữ focus
    btn.addEventListener('click', () => {
      field.value = '';
      field.focus();
      btn.hidden = true;
      field.dispatchEvent(new Event('input'));
    });
  });
}

function _formatFee(value) {
  const num = parseInt(String(value).replace(/\D/g, ''), 10);
  if (!num) return '';
  return num.toLocaleString('vi-VN');
}

function _parseFee(value) {
  return parseInt(String(value || '').replace(/\D/g, ''), 10) || 0;
}

function _bindFeeInput(el) {
  const fee = el.querySelector('#smFee');
  if (!fee) return;
  fee.addEventListener('input', () => {
    const raw   = fee.value.replace(/\D/g, '');
    const num   = parseInt(raw, 10);
    const cursor = fee.selectionStart;
    const prevLen = fee.value.length;
    fee.value = raw ? num.toLocaleString('vi-VN') : '';
    // Giữ vị trí cursor tương đối
    const diff = fee.value.length - prevLen;
    try { fee.setSelectionRange(cursor + diff, cursor + diff); } catch(_) {}
    // Cập nhật clear button
    const btn = fee.closest('.sm-field-wrap')?.querySelector('.sm-field-clear');
    if (btn) btn.hidden = fee.value.trim() === '';
  });
}

function _yearOptions() {
  const currentYear = new Date().getFullYear();
  const startYear = currentYear - 30;
  const years = [];
  years.push('<option value="">Chọn năm sinh</option>');
  for (let y = currentYear; y >= startYear; y -= 1) {
    years.push(`<option value="${y}">${y}</option>`);
  }
  return years.join('');
}

function _yearFromDob(value) {
  if (!value) return '';
  const raw = String(value).trim();
  const yearMatch = raw.match(/^(\d{4})/);
  if (yearMatch) return yearMatch[1];
  const parsed = _parseDateInput(raw);
  return parsed ? parsed.slice(0, 4) : '';
}

function _dobFromYear(value) {
  const year = Number(String(value || '').trim());
  if (!year) return '';
  const currentYear = new Date().getFullYear();
  if (year < currentYear - 40 || year > currentYear) return '';
  return `${year}-01-01`;
}

function _formatDateForInput(value) {
  if (!value) return '';
  const m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return value;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

function _parseDateInput(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const normalized = raw.replace(/[.\-\s]+/g, '/');
  let m = normalized.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) {
    const compact = raw.replace(/\D/g, '');
    if (compact.length === 8) {
      m = compact.match(/^(\d{2})(\d{2})(\d{4})$/);
    }
  }
  if (!m) return '';
  const d = Number(m[1]);
  const mo = Number(m[2]);
  const y = Number(m[3]);
  if (!y || mo < 1 || mo > 12 || d < 1 || d > 31) return '';
  const date = new Date(y, mo - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) return '';
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function _formatTimeForInput(value) {
  const parsed = _parseTimeInput(value);
  return parsed || '08:00';
}

function _parseTimeInput(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  let m = raw.match(/^(\d{1,2}):(\d{1,2})$/);
  if (!m) {
    const compact = raw.replace(/\D/g, '');
    if (compact.length === 3) m = compact.match(/^(\d{1})(\d{2})$/);
    if (compact.length === 4) m = compact.match(/^(\d{2})(\d{2})$/);
  }
  if (!m) return '';
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return '';
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

function _bindDateTimeFields(el) {
  const formatDateField = (field) => {
    const parsed = _parseDateInput(field.value);
    if (parsed) field.value = _formatDateForInput(parsed);
  };
  const formatTimeField = (field) => {
    const parsed = _parseTimeInput(field.value);
    if (parsed) field.value = parsed;
  };
  el.querySelectorAll('.ds-date-input').forEach(field => {
    field.addEventListener('input', () => {
      const digits = field.value.replace(/\D/g, '').slice(0, 8);
      if (digits.length <= 2) field.value = digits;
      else if (digits.length <= 4) field.value = `${digits.slice(0,2)}/${digits.slice(2)}`;
      else field.value = `${digits.slice(0,2)}/${digits.slice(2,4)}/${digits.slice(4)}`;
    });
    field.addEventListener('blur', () => formatDateField(field));
  });
  el.querySelectorAll('.ds-time-input').forEach(field => {
    field.addEventListener('input', () => {
      const digits = field.value.replace(/\D/g, '').slice(0, 4);
      if (digits.length <= 2) field.value = digits;
      else field.value = `${digits.slice(0,2)}:${digits.slice(2)}`;
    });
    field.addEventListener('blur', () => formatTimeField(field));
  });
}

function _buildDiffPicker(el, selected) {
  el.querySelector('#smDiffPicker').innerHTML = DIFFICULTIES.map(d => `
    <div class="diff-chip ${selected.includes(d) ? 'selected' : ''}"
         data-d="${d}">${d}</div>`).join('');
  el.querySelectorAll('.diff-chip').forEach(c =>
    c.addEventListener('click', () => c.classList.toggle('selected')));
}

function _buildDayPicker(el, selected) {
  el.querySelector('#smDayPicker').innerHTML = DAYS_SHORT.map((d, i) => `
    <div class="day-chip ${selected.includes(i) ? 'selected' : ''}"
         data-day="${i}">${d}</div>`).join('');
  el.querySelectorAll('.day-chip').forEach(c =>
    c.addEventListener('click', () => c.classList.toggle('selected')));
}
