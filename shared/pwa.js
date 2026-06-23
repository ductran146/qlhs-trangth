(() => {
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  let deferredInstallPrompt = null;

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
    if (isStandalone) return;

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

  document.addEventListener('DOMContentLoaded', () => {
    if (isStandalone) {
      document.querySelectorAll('[data-pwa-install]').forEach((btn) => {
        btn.style.display = 'none';
      });
    }
  });
})();
