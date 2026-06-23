/**
 * components/session-card.js
 * Collapsible card showing and editing one plain session note.
 * Pattern: giống student-detail.html — textarea trực tiếp, Hủy/Lưu
 */
import { Store, fmtDate, statusLabel } from '../shared/store.js';

export function render(el, dataset) {
  const sessionId = dataset.sessionId;
  const hideName  = dataset.hideName === 'true';
  _render(el, sessionId, hideName);
}

function _render(el, sessionId, hideName = false) {
  const sess = Store.get('sessions').find(s => s.id === sessionId);
  if (!sess) { el.innerHTML = ''; return; }

  const st       = Store.get('students').find(s => s.id === sess.studentId);
  const noteText = getPlainNote(sess);
  const dotColor = {
    taught: 'var(--green)', absent: 'var(--red)',
    makeup: 'var(--violet)', busy: 'var(--amber)'
  }[sess.status] || 'var(--ink-3)';

  const hideNote = sess.status === 'absent' || sess.status === 'busy';

  el.innerHTML = `
    <div class="session-card">
      <div class="sc-head" data-action="toggle">
        <div class="sc-dot" style="background:${dotColor}"></div>
        <div class="sc-info">
          <div class="sc-name">
            ${hideName ? fmtDate(sess.date) : (st ? st.name : '—')}
          </div>
          <div class="sc-date" ${hideName ? 'hidden' : ''}>
            ${fmtDate(sess.date)} · ${sess.startTime || '--:--'}
          </div>
        </div>
        <div class="sc-right">
          <span class="tag ${sess.status === 'taught' ? 'green' : 'red'}">
            ${statusLabel(sess.status) || 'Chưa điểm danh'}
          </span>
          <span class="sc-chevron"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M9.00005 6C9.00005 6 15 10.4189 15 12C15 13.5812 9 18 9 18" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
        </div>
      </div>

      <div class="sc-body ${noteText ? 'open' : ''}">
        ${!hideNote ? `
          <div class="session-note-content">
            <textarea class="note-ta" name="noteText" rows="1"
              placeholder="Nhận xét buổi học..."
              data-original="${escapeHtml(noteText)}">${escapeHtml(noteText)}</textarea>
            <div class="session-note-editor-actions">
              <button type="button" class="btn btn-sm btn-outline" data-action="note-cancel">Hủy</button>
              <button type="button" class="btn btn-sm btn-primary" data-action="save-notes">Lưu</button>
            </div>
          </div>
        ` : ''}
      </div>
    </div>`;

  const body    = el.querySelector('.sc-body');
  const chevron = el.querySelector('.sc-chevron');
  const ta      = el.querySelector('.note-ta');

  // Resize textarea khi visible
  if (ta && noteText) autoResize(ta);

  el.querySelector('[data-action="toggle"]').addEventListener('click', () => {
    body.classList.toggle('open');
    chevron.classList.toggle('open', body.classList.contains('open'));
    if (body.classList.contains('open') && ta) autoResize(ta);
  });

  if (ta) {
    ta.addEventListener('input', () => autoResize(ta));
  }

  el.querySelector('[data-action="note-cancel"]')?.addEventListener('click', e => {
    e.stopPropagation();
    if (ta) { ta.value = ta.dataset.original || ''; autoResize(ta); }
  });

  el.querySelector('[data-action="save-notes"]')?.addEventListener('click', e => {
    e.stopPropagation();
    const newNote = ta?.value.trim() || '';
    const existing = Store.get('sessions').find(s => s.id === sessionId);
    if (!existing) return;
    Store._writeNoteOnly(sessionId, newNote);
    if (ta) ta.dataset.original = newNote;
  });
}

function autoResize(ta) {
  ta.style.height = 'auto';
  ta.style.height = ta.scrollHeight + 'px';
}

function getPlainNote(sess) {
  const direct = String(sess.noteText || sess.note || sess.noteContent || '').trim();
  if (direct) return direct;
  return [sess.noteSkill, sess.noteBehavior, sess.noteProgress, sess.noteParent]
    .map(v => String(v || '').trim())
    .filter(Boolean)
    .join('\n');
}

function escapeHtml(str) {
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
