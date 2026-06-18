/**
 * components/topbar.js
 * App header. Visible on all breakpoints.
 * dataset: data-title="Điểm danh"
 */
import { todayStr } from '../shared/store.js';
import { Auth } from '../shared/auth.js';

export function render(el, dataset) {
  const title = dataset.title || 'Nhật ký can thiệp';

  el.innerHTML = `
    <header class="topbar">
      <div class="topbar-inner">
        <div class="topbar-brand">
          <div class="topbar-icon emoji" aria-hidden="true">🌱</div>
          <span class="topbar-title">${title}</span>
        </div>
        <div class="topbar-right">
          <span class="topbar-date" id="topbarDate"></span>
          <span class="topbar-user" title="Tài khoản đang đăng nhập">${Auth.currentUser()?.username || ''}</span>
          <button class="topbar-export-btn" id="topbarExportBtn" title="Xuất báo cáo"><span class="emoji" aria-hidden="true">📄</span></button>
          <button class="topbar-logout-btn" id="topbarLogoutBtn" type="button">Đăng xuất</button>
        </div>
      </div>
    </header>`;

  // Date
  const dt = new Date();
  el.querySelector('#topbarDate').textContent =
    dt.toLocaleDateString('vi-VN', { weekday: 'short', day: 'numeric', month: 'numeric' });

  // Export button wires up to whatever exportWeek() the page defines
  el.querySelector('#topbarExportBtn').addEventListener('click', () => {
    if (typeof window.exportWeek === 'function') window.exportWeek();
  });

  const logoutBtn = el.querySelector('#topbarLogoutBtn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      await Auth.logout();
      location.replace(location.pathname.includes('/pages/') ? 'login.html' : 'pages/login.html');
    });
  }
}

