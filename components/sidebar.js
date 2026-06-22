/**
 * components/sidebar.js
 * Persistent left sidebar for tablet+ screens.
 * Highlights the active nav item based on current page filename.
 * dataset: data-active="checkin"  (optional override)
 */

const NAV_ITEMS = [
  { key: 'checkin',  href: 'checkin.html',  icon: '✅', label: 'Điểm danh',    group: 'Hôm nay' },
  { key: 'notes',    href: 'notes.html',    icon: '📓', label: 'Nhật ký tuần', group: 'Theo dõi' },
  { key: 'students', href: 'students.html', icon: '👦', label: 'Học sinh',      group: 'Theo dõi' },
  { key: 'income',   href: 'income.html',   icon: '💰', label: 'Thu nhập',      group: 'Tổng hợp' },
  { key: 'schedule', href: 'schedule.html', icon: '🗓️', label: 'Lịch dạy', group: 'Tổng hợp' },
];

export function render(el, dataset) {
  // Detect active page from URL filename or dataset override
  const filename = location.pathname.split('/').pop().replace('.html', '');
  const active   = dataset.active || filename || 'checkin';

  // Group nav items
  const groups = {};
  for (const item of NAV_ITEMS) {
    if (!groups[item.group]) groups[item.group] = [];
    groups[item.group].push(item);
  }

  let navHTML = '';
  for (const [groupName, items] of Object.entries(groups)) {
    navHTML += `<div class="sidebar-group-label">${groupName}</div>`;
    for (const item of items) {
      navHTML += `
        <a href="${item.href}" class="sidebar-nav-item ${active === item.key ? 'active' : ''}">
          <span class="sidebar-nav-icon nav-emoji" aria-hidden="true">${item.icon}</span>
          <span class="sidebar-nav-label">${item.label}</span>
        </a>`;
    }
  }

  el.innerHTML = `
    <aside class="sidebar">
      <div class="sidebar-brand">
        <div class="sidebar-brand-icon emoji" aria-hidden="true">🌱</div>
        <div class="sidebar-brand-text">
          <div class="sidebar-brand-name">Nhật ký can thiệp</div>
          <div class="sidebar-brand-sub">Giáo viên đặc biệt</div>
        </div>
      </div>
      <nav class="sidebar-nav">${navHTML}</nav>
      <div class="sidebar-footer">
        <button class="btn btn-primary btn-wide" id="sidebarExportBtn"><span class="emoji" aria-hidden="true">📄</span> Xuất báo cáo</button>
      </div>
    </aside>`;

  el.querySelector('#sidebarExportBtn').addEventListener('click', () => {
    if (typeof window.exportWeek === 'function') window.exportWeek();
  });
}
