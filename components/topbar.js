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
