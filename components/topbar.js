/**
 * components/topbar.js
 * App header. Visible on all breakpoints.
 * Header title is fixed for the teacher workspace.
 */
import { Auth } from '../shared/auth.js';

export function render(el, dataset) {
  el.innerHTML = `
    <header class="topbar">
      <div class="topbar-inner">
        <div class="topbar-brand">
          <div class="topbar-icon emoji" aria-hidden="true">🌱</div>
          <span class="topbar-title" aria-label="Cô Trang can thiệp">
            <span class="topbar-title-main">Cô Trang</span>
            <span class="topbar-title-sub">Can thiệp</span>
          </span>
        </div>
        <div class="topbar-right">
          <button class="topbar-logout-btn" id="topbarLogoutBtn" type="button">Đăng xuất</button>
          <button class="topbar-install-btn" type="button" data-pwa-install aria-label="Cài app lên iPhone" title="Cài app">
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="M17.05 12.18c-.02-2.12 1.73-3.14 1.81-3.19-1-.46-2.03-.52-2.46-.53-1.04-.11-2.03.61-2.56.61-.54 0-1.36-.6-2.24-.58-1.15.02-2.22.67-2.81 1.7-1.2 2.08-.31 5.15.86 6.84.57.83 1.25 1.76 2.15 1.73.86-.03 1.18-.56 2.22-.56 1.03 0 1.33.56 2.24.54.93-.02 1.52-.84 2.09-1.67.66-.96.93-1.89.94-1.94-.02-.01-1.82-.7-1.84-2.95z"/>
              <path d="M15.72 7.36c.48-.58.8-1.38.71-2.18-.69.03-1.53.46-2.02 1.04-.44.51-.83 1.33-.72 2.11.77.06 1.55-.39 2.03-.97z"/>
            </svg>
          </button>
        </div>
      </div>
    </header>`;

  const logoutBtn = el.querySelector('#topbarLogoutBtn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      await Auth.logout();
      location.replace(location.pathname.includes('/pages/') ? 'login.html' : 'pages/login.html');
    });
  }
}
