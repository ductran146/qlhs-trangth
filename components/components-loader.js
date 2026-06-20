/**
 * components/components-loader.js
 * Fast component boot for mobile.
 *
 * Why:
 * - Do not import Firestore/Store before the shell is visible.
 * - Render navigation/header placeholders first, then hydrate protected data.
 * - Start Firestore realtime in the background so tab switching does not wait for
 *   the first onSnapshot() of all collections.
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
  // Do not await here. The UI can draw from local cache immediately and will
  // update again when Firestore snapshots arrive.
  Store.init().catch((err) => console.error('[loader] Store.init failed:', err));
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

  // Start Auth + Firestore as early as possible, but do not await it.
  // This reduces the delay before remote data reaches Notes/Students/Income
  // while still letting every page render from local cache first.
  //
  // FIX: startStoreRealtime() được gọi độc lập với việc có topbar hay không.
  // Trước đây Store.init() chỉ chạy sau khi render topbar xong — các trang
  // không có data-component="topbar" (session-note, student-detail...) sẽ
  // không bao giờ đăng ký Firestore listener → data không sync về.
  const authAndStoreBoot = requireFirebaseAuth().then(async (Auth) => {
    if (!Auth) return null;

    // Render topbar (nếu trang có) và khởi động Store song song — không để
    // Store phụ thuộc vào việc topbar có tồn tại trên trang hay không.
    const topbarSlots = slots.filter(el => el.dataset.component === 'topbar');
    await Promise.all([
      topbarSlots.length > 0
        ? Promise.all(topbarSlots.map(renderComponent))
        : Promise.resolve(),
      startStoreRealtime(),
    ]);

    return true;
  }).catch((err) => {
    console.error('[loader] Auth/Firestore boot failed:', err);
    return null;
  });

  // Sidebar and bottom-nav do not need Firebase data; hydrate them immediately.
  await Promise.all(slots
    .filter(el => FAST_COMPONENTS.has(el.dataset.component))
    .map(renderComponent));

  // 2) Render data components immediately from local cache.
  // Important on mobile: do not wait for Firebase Auth/Firestore SDK imports or
  // first snapshots before showing Checkin content. Firestore realtime starts in
  // the background below and will refresh these components automatically.
  await Promise.all(slots
    .filter(el => DATA_COMPONENTS.has(el.dataset.component))
    .map(renderComponent));

  // 3) Auth gate + Firestore realtime already started in the background above.
  // Keep the promise referenced so browsers do not treat it as unused work.
  void authAndStoreBoot;

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
