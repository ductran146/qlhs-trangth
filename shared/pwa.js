(() => {
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
  let deferredInstallPrompt = null;

  function isStandaloneMode() {
    return window.matchMedia('(display-mode: standalone)').matches ||
      window.navigator.standalone === true;
  }

  function applyPwaClass() {
    const isStandalone = isStandaloneMode();
    document.documentElement.classList.toggle('is-pwa', isStandalone);
    document.body?.classList.toggle('is-pwa', isStandalone);
  }

  applyPwaClass();

  function rootPath(fileName = '') {
    const inPages = location.pathname.includes('/pages/');
    return `${inPages ? '../' : './'}${fileName}`;
  }

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register(rootPath('sw.js')).catch((err) => {
        console.warn('[PWA] Service worker registration failed:', err);
      });
    });
  }

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    document.documentElement.classList.add('pwa-install-available');
  });

  function showIosInstallGuide() {
    alert('Để cài app trên iPhone:\n\n1. Bấm nút Chia sẻ của Safari.\n2. Chọn “Thêm vào Màn hình chính”.\n3. Bấm “Thêm”.');
  }

  async function handleInstallClick() {
    if (isStandaloneMode()) return;

    if (deferredInstallPrompt) {
      deferredInstallPrompt.prompt();
      try { await deferredInstallPrompt.userChoice; } catch (_) {}
      deferredInstallPrompt = null;
      return;
    }

    if (isIos) {
      showIosInstallGuide();
      return;
    }

    alert('Trình duyệt này chưa hỗ trợ cài trực tiếp. Hãy mở menu trình duyệt và chọn cài đặt / thêm vào màn hình chính.');
  }

  document.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-pwa-install]');
    if (!btn) return;
    event.preventDefault();
    handleInstallClick();
  });



  function setupPullToRefresh() {
    if (!isStandaloneMode()) return;
    if (!('ontouchstart' in window)) return;
    if (document.documentElement.dataset.pullRefreshReady === '1') return;
    document.documentElement.dataset.pullRefreshReady = '1';

    const indicator = document.createElement('div');
    indicator.className = 'pwa-pull-refresh';
    indicator.setAttribute('aria-hidden', 'true');
    indicator.innerHTML = '<span class="pwa-pull-refresh-spinner"></span><span class="pwa-pull-refresh-text">Kéo để làm mới</span>';
    document.body.appendChild(indicator);

    const textEl = indicator.querySelector('.pwa-pull-refresh-text');
    let startX = 0;
    let startY = 0;
    let pulling = false;
    let refreshing = false;
    let distance = 0;
    const threshold = 74;
    const maxDistance = 118;

    const getScrollTop = () => document.scrollingElement?.scrollTop || document.documentElement.scrollTop || document.body.scrollTop || 0;

    function setDistance(value) {
      distance = Math.max(0, Math.min(value, maxDistance));
      const progress = Math.min(distance / threshold, 1);
      indicator.style.setProperty('--pull-distance', `${distance}px`);
      indicator.style.setProperty('--pull-progress', String(progress));
      indicator.classList.toggle('is-ready', distance >= threshold);
      if (textEl) textEl.textContent = distance >= threshold ? 'Thả để làm mới' : 'Kéo để làm mới';
    }

    function resetPull() {
      pulling = false;
      distance = 0;
      indicator.style.setProperty('--pull-distance', '0px');
      indicator.style.setProperty('--pull-progress', '0');
      indicator.classList.remove('is-visible', 'is-ready');
      if (textEl) textEl.textContent = 'Kéo để làm mới';
    }

    window.addEventListener('touchstart', (event) => {
      if (refreshing || !isStandaloneMode()) return;
      if (getScrollTop() > 0) return;
      const touch = event.touches?.[0];
      if (!touch) return;
      startX = touch.clientX;
      startY = touch.clientY;
      pulling = true;
      distance = 0;
    }, { passive: true });

    window.addEventListener('touchmove', (event) => {
      if (!pulling || refreshing) return;
      if (getScrollTop() > 0) {
        resetPull();
        return;
      }

      const touch = event.touches?.[0];
      if (!touch) return;
      const deltaY = touch.clientY - startY;
      const deltaX = Math.abs(touch.clientX - startX);
      if (deltaY <= 0 || deltaX > deltaY) return;

      event.preventDefault();
      indicator.classList.add('is-visible');
      setDistance(deltaY * 0.55);
    }, { passive: false });

    window.addEventListener('touchend', () => {
      if (!pulling || refreshing) return;
      if (distance >= threshold) {
        refreshing = true;
        indicator.classList.add('is-visible', 'is-refreshing');
        indicator.classList.remove('is-ready');
        indicator.style.setProperty('--pull-distance', `${threshold}px`);
        if (textEl) textEl.textContent = 'Đang làm mới';
        window.setTimeout(() => window.location.reload(), 180);
        return;
      }
      resetPull();
    }, { passive: true });

    window.addEventListener('touchcancel', () => {
      if (!refreshing) resetPull();
    }, { passive: true });
  }

  document.addEventListener('DOMContentLoaded', () => {
    applyPwaClass();
    setupPullToRefresh();
  });
  window.addEventListener('pageshow', () => {
    applyPwaClass();
    setupPullToRefresh();
  });
  document.addEventListener('visibilitychange', () => {
    applyPwaClass();
    if (document.visibilityState === 'visible') setupPullToRefresh();
  });
})();
