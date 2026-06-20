/**
 * components/components-loader.js
 * Component boot with Firestore-first data sync.
 *
 * Why:
 * - Render header/bottom navigation placeholders immediately.
 * - Authenticate and start Firestore before rendering data components.
 * - Avoid showing stale local/browser cache on Safari/Chrome.
 */

const FAST_COMPONENTS = new Set(['bottom-nav', 'sidebar']);
const DATA_COMPONENTS = new Set([
  'month-overview',
  'week-attendance',
  'checkin-card',
  'session-card',
  'student-modal'
]);

function isInPagesDir() {
  return location.pathname.includes('/pages/');
}

function getActivePage() {
  return location.pathname.split('/').pop().replace('.html', '') || 'checkin';
}

function safeText(value) {
  return String(value || '').replace(/[&<>"]/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;'
  }[ch]));
}

function renderTopbarSkeleton(el, dataset = {}) {
  // Keep the fast shell identical to the real topbar component.
  // Do not use dataset.title here; otherwise the header flashes the page title
  // before components/topbar.js hydrates it back to the fixed app brand.
  el.innerHTML = `
    <header class="topbar" data-fast-shell="true">
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
}

function renderBottomNavFallback(el, dataset = {}) {
  const tabs = [
    { key: 'checkin', href: 'checkin.html', icon: '✅', label: 'Điểm danh' },
    { key: 'notes', href: 'notes.html', icon: '📓', label: 'Nhật ký' },
    { key: 'students', href: 'students.html', icon: '👦', label: 'Học sinh' },
    { key: 'income', href: 'income.html', icon: '💰', label: 'Thu nhập' },
  ];
  const active = dataset.active || getActivePage();

  el.innerHTML = `
    <nav class="bottom-nav" data-fast-shell="true">
      ${tabs.map(t => `
        <a href="${t.href}" class="bottom-nav-item ${active === t.key ? 'active' : ''}">
          <span class="bottom-nav-icon nav-emoji" aria-hidden="true">${t.icon}</span>
          <span class="bottom-nav-label">${t.label}</span>
        </a>`).join('')}
    </nav>`;
}

async function renderComponent(el) {
  const name = el.dataset.component;
  try {
    const mod = await import(`./${name}.js`);
    if (typeof mod.render === 'function') {
      await mod.render(el, { ...el.dataset });
    } else {
      console.warn(`[loader] ${name}.js has no export render()`);
    }
  } catch (err) {
    console.error(`[loader] Failed to load component "${name}":`, err);
    el.innerHTML = `<div style="padding:8px;color:#f43f5e;font-size:12px">
      ⚠ Component "${name}" không tải được
    </div>`;
  }
}

async function requireFirebaseAuth() {
  const { Auth } = await import('../shared/auth.js');
  const ok = await Auth.requireAuth();
  return ok ? Auth : null;
}

async function startStoreRealtime() {
  const { Store } = await import('../shared/store.js');
  // Wait for Store.init(). The store itself only waits briefly for the first
  // Firestore snapshots, then components render and continue to update realtime.
  await Store.init();
  return Store;
}

document.addEventListener('DOMContentLoaded', async () => {
  const slots = Array.from(document.querySelectorAll('[data-component]'));

  // 1) Show mobile shell immediately. This removes the blank/missing topbar and
  // bottom menu while Firebase Auth / Firestore modules are loading on mobile.
  for (const el of slots) {
    const name = el.dataset.component;
    if (name === 'topbar') renderTopbarSkeleton(el, { ...el.dataset });
    if (name === 'bottom-nav') renderBottomNavFallback(el, { ...el.dataset });
  }

  // Sidebar and bottom-nav do not need Firebase data; hydrate them immediately.
  await Promise.all(slots
    .filter(el => FAST_COMPONENTS.has(el.dataset.component))
    .map(renderComponent));

  // 2) Auth gate + topbar + Firestore first sync.
  // Do this before rendering data components so Safari/Chrome do not show
  // different stale local-cache states.
  await requireFirebaseAuth().then(async (Auth) => {
    if (!Auth) return null;
    await Promise.all(slots
      .filter(el => el.dataset.component === 'topbar')
      .map(renderComponent));
    return startStoreRealtime();
  }).catch((err) => {
    console.error('[loader] Auth/Firestore boot failed:', err);
    return null;
  });

  // 3) Render data components after Store.init() has started Firestore and
  // waited briefly for first snapshots. Realtime subscriptions still update UI
  // immediately when later server data arrives.
  await Promise.all(slots
    .filter(el => DATA_COMPONENTS.has(el.dataset.component))
    .map(renderComponent));

  // 4) Render any remaining custom components.
  await Promise.all(slots
    .filter(el => {
      const name = el.dataset.component;
      return name !== 'topbar' && !FAST_COMPONENTS.has(name) && !DATA_COMPONENTS.has(name);
    })
    .map(renderComponent));
});

// iOS Safari can restore pages from bfcache. When it does, make sure the fast
// shell is still present instead of waiting for a manual refresh.
window.addEventListener('pageshow', (event) => {
  if (!event.persisted) return;
  document.querySelectorAll('[data-component="bottom-nav"]').forEach((el) => {
    if (!el.querySelector('.bottom-nav')) renderBottomNavFallback(el, { ...el.dataset });
  });
  document.querySelectorAll('[data-component="topbar"]').forEach((el) => {
    if (!el.querySelector('.topbar')) renderTopbarSkeleton(el, { ...el.dataset });
  });
});
