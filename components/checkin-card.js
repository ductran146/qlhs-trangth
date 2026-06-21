/**
 * components/checkin-card.js
 * Renders a single student checkin block: status buttons + expandable note fields.
 * dataset: data-student-id="s1"
 *
 * Used by: pages/checkin.html
 */
import { Store, avatarColor, initials, age, fmtMoney, todayStr, uid } from '../shared/store.js?v=20260621-sync3';

export function render(el, dataset) {
  const studentId = dataset.studentId;
  _render(el, studentId);
}

function _render(el, studentId) {
  const st   = Store.get('students').find(s => s.id === studentId);
  if (!st) { el.innerHTML = ''; return; }

  const d    = todayStr();
  const sess = Store.get('sessions').find(s => s.studentId === studentId && s.date === d && s.type === 'normal');
  const status   = sess?.status || '';
  const hasNote  = sess?.noteSkill || sess?.noteBehavior || sess?.noteProgress || sess?.noteParent;

  el.innerHTML = `
    <div class="checkin-card" data-sid="${studentId}">
      <div class="checkin-head">
        <div class="avatar" style="background:${avatarColor(st.name)}">${initials(st.name)}</div>
        <div class="checkin-info">
          <div class="checkin-name">${st.name}</div>
          <div class="checkin-meta">
            ${age(st.dob)}
            · ${st.schedTime}
            · ${st.duration} ca
            ${st.difficulties?.[0] ? '· ' + st.difficulties[0] : ''}
          </div>
        </div>
        ${status === 'taught'
          ? `<span class="tag green">${fmtMoney(st.feePerSlot * st.duration)}</span>`
          : ''}
      </div>

      <div class="checkin-status-row">
        ${['taught','absent','makeup','busy'].map(s => `
          <button class="status-btn ${status === s ? 'active-' + s : ''}"
                  data-action="set-status" data-status="${s}">
            <span class="status-emoji emoji" aria-hidden="true">${{ taught:'✅', absent:'❌', makeup:'↩️', busy:'⚠️' }[s]}</span>
            <span>${{ taught:'Đã học', absent:'Nghỉ', makeup:'Học bù', busy:'Cô bận' }[s]}</span>
          </button>`).join('')}
      </div>

      ${status === 'taught' ? `
        <button class="note-toggle-btn" data-action="toggle-note">
          ${hasNote ? '<span class="emoji" aria-hidden="true">📝</span> Xem / sửa nhận xét' : '+ Thêm nhận xét buổi học'}
        </button>
        <div class="note-panel" style="display:${hasNote ? 'block' : 'none'}">
          <div class="note-grid">
            ${noteField('noteSkill',    '🎯', 'var(--violet)', 'Kỹ năng tập trung hôm nay', 'Ngồi yên 15 phút, làm theo chỉ dẫn...', sess?.noteSkill)}
            ${noteField('noteBehavior', '⚡', 'var(--amber)',  'Hành vi nổi bật',           'Tự chủ động chào cô, ít la hét...', sess?.noteBehavior)}
            ${noteField('noteProgress', '🌱', 'var(--green)',  'Tiến bộ ghi nhận',          'Nói được từ đơn "ba", "mẹ"...', sess?.noteProgress)}
            ${noteField('noteParent',   '💌', 'var(--blue)',   'Ghi chú cho phụ huynh',     'Hôm nay bé rất hợp tác...', sess?.noteParent)}
          </div>
        </div>` : ''}
    </div>`;

  // ── Bind events ─────────────────────────
  el.querySelectorAll('[data-action="set-status"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const newStatus = btn.dataset.status;
      let s = Store.get('sessions').find(s => s.studentId === studentId && s.date === d && s.type === 'normal');
      if (!s) {
        s = { id: uid(), studentId, date: d, startTime: st.schedTime,
              duration: st.duration, type: 'normal', status: '',
              noteSkill:'', noteBehavior:'', noteProgress:'', noteParent:'' };
      }
      s.status = newStatus;
      s.type = 'normal';
      s.makeupFor = null;
      Store.upsertSession(s);
    });
  });

  el.querySelector('[data-action="toggle-note"]')?.addEventListener('click', function() {
    const panel = el.querySelector('.note-panel');
    if (panel) panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
  });

  el.querySelectorAll('textarea[data-field]').forEach(ta => {
    ta.addEventListener('change', () => {
      const s = Store.get('sessions').find(s => s.studentId === studentId && s.date === d && s.type === 'normal');
      if (s) { s[ta.dataset.field] = ta.value; Store.upsertSession(s); }
    });
  });
}

function noteField(field, emoji, color, label, placeholder, value) {
  return `
    <div class="note-field">
      <label class="note-field-label">
        <span class="note-dot" style="background:${color}"></span>
        <span class="note-emoji emoji" aria-hidden="true">${emoji}</span>${label}
      </label>
      <textarea class="form-input note-ta" rows="3"
                placeholder="${placeholder}"
                data-field="${field}">${value || ''}</textarea>
    </div>`;
}
