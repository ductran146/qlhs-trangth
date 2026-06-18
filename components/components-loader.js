/**
 * components/components-loader.js
 * Quét tất cả [data-component] trong trang, import và render từng component.
 */

import { Auth } from '../shared/auth.js';
import { Store } from '../shared/store.js';

document.addEventListener('DOMContentLoaded', async () => {
  if (!(await Auth.requireAuth())) return;
  await Store.init();

  const slots = document.querySelectorAll('[data-component]');

  for (const el of slots) {
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
});
