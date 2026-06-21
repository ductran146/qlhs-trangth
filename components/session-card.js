/**
 * components/session-card.js
 * Collapsible card showing and editing one plain session note.
 * dataset: data-session-id="i123"
 *
 * Used by: pages/notes.html
 */
import { Store, fmtDate, statusLabel } from '../shared/store.js';

export function render(el, dataset) {
  const sessionId = dataset.sessionId;
  _render(el, sessionId);
}

function _render(el, sessionId) {
  const sess = Store.get('sessions').find(s => s.id === sessionId);
  if (!sess) { el.innerHTML = ''; return; }

  const st      = Store.get('students').find(s => s.id === sess.studentId);
  const noteText = getPlainNote(sess);
  const hasNote = Boolean(noteText);
  const canEdit = sess.status === 'taught' || sess.status === 'makeup';
  const dotColor = {
    taught: 'var(--green)', absent: 'var(--red)',
    makeup: 'var(--violet)', busy: 'var(--amber)'
  }[sess.status] || 'var(--ink-3)';

  el.innerHTML = `
    <div class="session-card">
      <div class="sc-head" data-action="toggle">
        <div class="sc-dot" style="background:${dotColor}"></div>
        <div class="sc-info">
          <div class="sc-name">
            ${st ? st.name : '—'}
          </div>
          <div class="sc-date">
            ${fmtDate(sess.date)} · ${sess.startTime || '--:--'}
          </div>
        </div>
        <div class="sc-right">
          <span class="tag ${sess.status === 'taught' ? 'green' : 'red'}">
            ${statusLabel(sess.status) || 'Chưa điểm danh'}
          </span>
          <span class="sc-chevron">${hasNote ? '▾' : '▸'}</span>
        </div>
      </div>

      <div class="sc-body ${hasNote ? 'open' : ''}">
        ${canEdit ? `
          <div class="session-note-view ${hasNote ? '' : 'empty'}">
            ${hasNote ? `
              <div class="note-block note-block-plain">
                <div class="note-block-text">${escapeHtml(noteText)}</div>
              </div>
            ` : '<p class="text-muted fs-13">Chưa có nhận xét cho buổi học này</p>'}
          </div>

          <div class="session-note-form" ${hasNote ? 'hidden' : ''}>
            <div class="note-grid note-grid-plain">
              ${noteField('noteText', 'Nhận xét buổi học', noteText)}
            </div>
          </div>

          <div class="session-note-actions">
            <button type="button" class="session-note-btn secondary" data-action="edit-notes">
              ${hasNote ? 'Sửa nhận xét' : '+ Thêm nhận xét'}
            </button>
            <button type="button" class="session-note-btn primary" data-action="save-notes" ${hasNote ? 'hidden' : ''}>
              Lưu nhận xét
            </button>
          </div>
        ` : `
          <p class="text-muted fs-13">Ca ${statusLabel(sess.status)} — không có nhận xét buổi học</p>
        `}
      </div>
    </div>`;

  const body = el.querySelector('.sc-body');
  const chevron = el.querySelector('.sc-chevron');

  el.querySelector('[data-action="toggle"]').addEventListener('click', () => {
    body.classList.toggle('open');
    chevron.textContent = body.classList.contains('open') ? '▾' : '▸';
  });

  el.querySelector('[data-action="edit-notes"]')?.addEventListener('click', (event) => {
    event.stopPropagation();
    body.classList.add('open');
    el.querySelector('.session-note-form')?.removeAttribute('hidden');
    el.querySelector('[data-action="save-notes"]')?.removeAttribute('hidden');
    chevron.textContent = '▾';
  });

  el.querySelector('[data-action="save-notes"]')?.addEventListener('click', (event) => {
    event.stopPropagation();
    const newNote = valueOf(el, 'noteText');
    Store.upsertSession({
      ...sess,
      noteText: newNote,
      noteSkill: '',
      noteBehavior: '',
      noteProgress: '',
      noteParent: '',
    });
  });
}

function valueOf(root, name) {
  return root.querySelector(`[name="${name}"]`)?.value.trim() || '';
}

function noteField(name, label, value = '') {
  return `
    <label>
      <div class="note-field-label">${label}</div>
      <textarea class="note-ta" name="${name}" rows="4" placeholder="Nhập nhận xét chung cho buổi học...">${escapeHtml(value || '')}</textarea>
    </label>`;
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
