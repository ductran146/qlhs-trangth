/**
 * components/bottom-nav.js
 * Bottom tab bar for mobile screens. Hidden on tablet+.
 * dataset: data-active="checkin"
 */

const TABS = [
  { key: 'checkin',  href: 'checkin.html',  icon: '✅', label: 'Điểm danh' },
  { key: 'notes',    href: 'notes.html',    icon: '📓', label: 'Nhật ký'   },
  { key: 'students', href: 'students.html', icon: '👦', label: 'Học sinh'  },
  { key: 'income',   href: 'income.html',   icon: '💰', label: 'Thu nhập'  },
  { key: 'schedule', href: 'schedule.html', icon: '🗓️', label: 'Lịch dạy' },
];

export function render(el, dataset) {
  const filename = location.pathname.split('/').pop().replace('.html', '');
  const active   = dataset.active || filename || 'checkin';

  el.innerHTML = `
    <nav class="bottom-nav">
      ${TABS.map(t => `
        <a href="${t.href}" class="bottom-nav-item ${active === t.key ? 'active' : ''}">
          <span class="bottom-nav-icon nav-emoji" aria-hidden="true">${t.icon}</span>
          <span class="bottom-nav-label">${t.label}</span>
        </a>`).join('')}
    </nav>`;
}
