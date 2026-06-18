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
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="studentModalTitle">
        <div class="modal-handle"></div>
        <button class="modal-close" id="smClose" type="button" aria-label="Đóng">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M15 5L5 15M5 5L15 15" stroke="#454B50" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
        <div class="modal-title" id="studentModalTitle">Thêm học sinh</div>

        <div class="form-row">
          <div class="form-group" style="grid-column:1/-1">
            <label class="form-label">Họ và tên *</label>
            <input class="form-input" id="smName" type="text" placeholder="Bé Nguyễn Văn An">
          </div>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Ngày sinh</label>
            <input class="form-input" id="smDob" type="date">
          </div>
          <div class="form-group">
            <label class="form-label">Giới tính</label>
            <select class="form-input form-select" id="smGender">
              <option value="Nam">Nam</option>
              <option value="Nữ">Nữ</option>
            </select>
          </div>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Ngày bắt đầu học *</label>
            <input class="form-input" id="smStartDate" type="date">
          </div>
          <div class="form-group">
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
            <input class="form-input" id="smFatherName" type="text" placeholder="Anh/Chú...">
          </div>
          <div class="form-group">
            <label class="form-label">Tên mẹ</label>
            <input class="form-input" id="smMotherName" type="text" placeholder="Chị/Cô...">
          </div>
        </div>

        <div class="form-group">
          <label class="form-label">Đặc điểm / khó khăn chính</label>
          <div class="diff-picker" id="smDiffPicker"></div>
        </div>

        <div class="form-group">
          <label class="form-label">Mục tiêu can thiệp</label>
          <textarea class="form-input" id="smGoal" rows="2"
            placeholder="Phát triển ngôn ngữ, tăng tập trung..."></textarea>
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
          <input class="form-input" id="smFee" type="number" placeholder="200000" min="0">
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
  el.querySelector('#studentModalOverlay').addEventListener('click', e => {
    if (e.target === el.querySelector('#studentModalOverlay')) close();
  });
  el.querySelector('#smSave').addEventListener('click', () => _save(el));
  _bindKeyboardAssist(el);

  // Expose open/close globally so pages can call them
  window.StudentModal = { open: (id) => _open(el, id), close };
}

function _open(el, id = null) {
  _editingId = id;
  const st = id ? Store.get('students').find(s => s.id === id) : null;

  el.querySelector('#studentModalTitle').textContent = id ? 'Sửa thông tin' : 'Thêm học sinh';
  el.querySelector('#smName').value    = st?.name    || '';
  el.querySelector('#smDob').value     = st?.dob     || '';
  el.querySelector('#smGender').value  = st?.gender  || 'Nam';
  el.querySelector('#smStartDate').value = st?.startDate || todayStr();
  el.querySelector('#smStatus').value = st?.status || 'active';
  el.querySelector('#smGoal').value    = st?.goal    || '';
  el.querySelector('#smFatherName').value = st?.fatherName || '';
  el.querySelector('#smMotherName').value = st?.motherName || '';
  el.querySelector('#smTime').value    = st?.schedTime || '08:00';
  el.querySelector('#smDuration').value = String(st?.duration || 1);
  el.querySelector('#smFee').value     = st?.feePerSlot || '';

  _buildDiffPicker(el, st?.difficulties || []);
  _buildDayPicker(el, st?.schedDays || []);

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
    dob:        el.querySelector('#smDob').value,
    gender:     el.querySelector('#smGender').value,
    status:     el.querySelector('#smStatus').value || 'active',
    startDate,
    difficulties,
    goal:       el.querySelector('#smGoal').value.trim(),
    fatherName: el.querySelector('#smFatherName').value.trim(),
    motherName: el.querySelector('#smMotherName').value.trim(),
    schedDays,
    schedTime:  el.querySelector('#smTime').value,
    duration:   +el.querySelector('#smDuration').value,
    feePerSlot: +el.querySelector('#smFee').value || 0,
  });

  close();
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
