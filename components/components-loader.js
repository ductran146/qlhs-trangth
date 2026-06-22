/**
 * components/components-loader.js  — v2
 *
 * Thay đổi so với v1:
 *  - Bỏ hoàn toàn static data.json fallback (data.json rỗng không còn nguy hiểm
 *    vì store.js v2 không dùng nó nữa).
 *  - Store.init() chạy ngay sau khi auth xong, không có fallback timer.
 *  - Skeleton topbar/bottom-nav vẫn render ngay để tránh blank.
 */

const FAST_COMPONENTS = new Set(['bottom-nav', 'sidebar']);
const DATA_COMPONENTS = new Set([
  'month-overview',
  'week-attendance',
  'checkin-card',
  'session-card',
  'student-modal'
]);

function getActivePage() {
  return location.pathname.split('/').pop().replace('.html', '') || 'checkin';
}

function safeText(value) {
  return String(value || '').replace(/[&<>"]/g, (ch) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch])
  );
}

function renderTopbarSkeleton(el) {
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
    { key: 'checkin',  href: 'checkin.html',  icon: '✅', label: 'Điểm danh' },
    { key: 'notes',    href: 'notes.html',    icon: '📓', label: 'Nhật ký'   },
    { key: 'students', href: 'students.html', icon: '👦', label: 'Học sinh'  },
    { key: 'income',   href: 'income.html',   icon: '💰', label: 'Thu nhập'  },
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
      console.warn(`[loader] ${name}.js không có export render()`);
    }
  } catch (err) {
    console.error(`[loader] Không load được component "${name}":`, err);
    el.innerHTML = `<div style="padding:8px;color:#f43f5e;font-size:12px">
      ⚠ Component "${name}" không tải được
    </div>`;
  }
}

async function requireAuth() {
  const { Auth } = await import('../shared/auth.js');
  const ok = await Auth.requireAuth();
  return ok ? Auth : null;
}

async function startStore() {
  const { Store } = await import('../shared/store.js');
  // Không await — UI draw từ localStorage bootstrap cache ngay lập tức.
  // Store.init() kết nối Firestore và emit update khi snapshot về.
  Store.init().catch(err => console.error('[loader] Store.init lỗi:', err));
  return Store;
}

document.addEventListener('DOMContentLoaded', async () => {
  const slots = Array.from(document.querySelectorAll('[data-component]'));

  // 1) Render skeleton ngay (tránh blank trên mobile)
  for (const el of slots) {
    if (el.dataset.component === 'topbar')     renderTopbarSkeleton(el);
    if (el.dataset.component === 'bottom-nav') renderBottomNavFallback(el, { ...el.dataset });
  }

  // 2) Khởi động Auth + Store song song (không await)
  const bootPromise = requireAuth().then(async (Auth) => {
    if (!Auth) return null;
    // Hydrate topbar thật (tên user, nút logout)
    await Promise.all(
      slots.filter(el => el.dataset.component === 'topbar').map(renderComponent)
    );
    return startStore();
  }).catch(err => {
    console.error('[loader] Auth/Store boot lỗi:', err);
    return null;
  });

  // 3) Render nav ngay (không cần Firebase)
  await Promise.all(
    slots.filter(el => FAST_COMPONENTS.has(el.dataset.component)).map(renderComponent)
  );

  // 4) Render data components từ localStorage cache (hiển thị ngay)
  await Promise.all(
    slots.filter(el => DATA_COMPONENTS.has(el.dataset.component)).map(renderComponent)
  );

  // 5) Giữ reference để browser không garbage-collect
  void bootPromise;

  // 6) Render các component còn lại
  await Promise.all(
    slots.filter(el => {
      const name = el.dataset.component;
      return name !== 'topbar' && !FAST_COMPONENTS.has(name) && !DATA_COMPONENTS.has(name);
    }).map(renderComponent)
  );
});

// iOS Safari bfcache restore
window.addEventListener('pageshow', (event) => {
  if (!event.persisted) return;
  document.querySelectorAll('[data-component="bottom-nav"]').forEach(el => {
    if (!el.querySelector('.bottom-nav')) renderBottomNavFallback(el, { ...el.dataset });
  });
  document.querySelectorAll('[data-component="topbar"]').forEach(el => {
    if (!el.querySelector('.topbar')) renderTopbarSkeleton(el);
  });
});

/* ── Search clear button — tự động bind cho mọi .student-search-wrap ───────
   Gọi 1 lần sau khi trang render xong, dùng MutationObserver để catch
   các wrap được thêm vào DOM sau (week-attendance, month-overview, notes) */
function bindSearchClear(wrap) {
  const input = wrap.querySelector('.student-search');
  if (!input || wrap._clearBound) return;
  wrap._clearBound = true;

  // Tạo button nếu chưa có
  let btn = wrap.querySelector('.student-search-clear');
  if (!btn) {
    btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'student-search-clear';
    btn.hidden = true;
    btn.setAttribute('aria-label', 'Xóa tìm kiếm');
    btn.innerHTML = '<svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M1 1l8 8M9 1L1 9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
    wrap.appendChild(btn);
  }

  let isFocused = false;
  const update = () => { btn.hidden = !(isFocused && input.value.length > 0); };

  input.addEventListener('focus',  () => { isFocused = true;  update(); });
  input.addEventListener('blur',   () => { setTimeout(() => { isFocused = false; update(); }, 150); });
  input.addEventListener('input',  update);
  btn.addEventListener('mousedown', e => e.preventDefault());
  btn.addEventListener('click', () => {
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    update();
    input.focus();
  });
}

// Bind các wrap hiện tại + lắng nghe wrap mới thêm vào DOM
function initSearchClears() {
  document.querySelectorAll('.student-search-wrap').forEach(bindSearchClear);
}

const _searchObserver = new MutationObserver(() => {
  document.querySelectorAll('.student-search-wrap').forEach(bindSearchClear);
});
_searchObserver.observe(document.body, { childList: true, subtree: true });

document.addEventListener('DOMContentLoaded', initSearchClears);
