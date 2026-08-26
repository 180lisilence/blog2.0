/* ===================================================================
 * utils.js - 通用工具函数
 * 包含：Toast消息、DOM操作、表单验证、格式化、复制、懒加载、防抖节流
 * =================================================================== */
window.App = window.App || {};

App.Utils = {
  /* ===== Toast 消息提示 ===== */
  toast(msg, type = 'info', duration = 2500) {
    const icons = { success: 'fa-circle-check', error: 'fa-circle-xmark', info: 'fa-circle-info', warning: 'fa-triangle-exclamation' };
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.innerHTML = `<i class="fa-solid ${icons[type] || icons.info}"></i><span>${msg}</span>`;
    document.getElementById('toastContainer').appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; el.style.transform = 'translateX(120%)'; setTimeout(() => el.remove(), 300); }, duration);
  },

  /* ===== 通用模态弹窗 ===== */
  modal({ title, content, onConfirm, confirmText = '确定', cancelText = '取消', showCancel = true }) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal-box" onclick="event.stopPropagation()">
        <div class="flex justify-between items-center mb-4">
          <h3 class="font-bold text-lg">${title || '提示'}</h3>
          <button class="icon-btn" onclick="this.closest('.modal-overlay').remove()"><i class="fa-solid fa-xmark"></i></button>
        </div>
        <div class="mb-5 text-slate-600 dark:text-slate-300">${content}</div>
        <div class="flex justify-end gap-2">
          ${showCancel ? `<button class="btn-ghost" onclick="this.closest('.modal-overlay').remove()">${cancelText}</button>` : ''}
          <button class="btn-primary" id="modalConfirmBtn">${confirmText}</button>
        </div>
      </div>`;
    document.getElementById('modalContainer').appendChild(overlay);
    overlay.addEventListener('click', () => overlay.remove());
    if (onConfirm) document.getElementById('modalConfirmBtn').onclick = () => { onConfirm(() => overlay.remove()); };
    else document.getElementById('modalConfirmBtn').onclick = () => overlay.remove();
    return overlay;
  },

  /* ===== 确认弹窗（Promise 风格） ===== */
  confirm(msg, title = '确认操作') {
    return new Promise(resolve => {
      App.Utils.modal({
        title, content: msg, confirmText: '确定', cancelText: '取消',
        onConfirm: (close) => { close(); resolve(true); }
      });
      // 取消时 resolve(false)
      document.getElementById('modalContainer').lastChild.addEventListener('click', e => {
        if (e.target === e.currentTarget) resolve(false);
      });
    });
  },

  /* ===== 表单验证 ===== */
  validate: {
    required(val, name) { return (!val || !val.trim()) ? `${name}不能为空` : ''; },
    email(val) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val) ? '' : '邮箱格式不正确'; },
    phone(val) { return /^1[3-9]\d{9}$/.test(val) ? '' : '手机号格式不正确'; },
    password(val) { return val.length >= 6 ? '' : '密码至少6位'; },
    minLen(val, n, name) { return val.length >= n ? '' : `${name}至少${n}个字符`; }
  },

  /* ===== 格式化 ===== */
  formatDate(str) {
    if (!str) return '';
    return str.replace('T', ' ').substring(0, 16);
  },
  formatMoney(num) {
    return '¥' + Number(num || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  },
  /* 数字滚动动画 */
  animateNumber(el, target, duration = 1500) {
    const start = 0, startTime = performance.now();
    function update(now) {
      const progress = Math.min((now - startTime) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      el.textContent = Math.floor(start + (target - start) * eased).toLocaleString();
      if (progress < 1) requestAnimationFrame(update);
    }
    requestAnimationFrame(update);
  },

  /* ===== 复制文本 ===== */
  copyText(text) {
    if (navigator.clipboard) navigator.clipboard.writeText(text);
    else { const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); }
    App.Utils.toast('已复制到剪贴板', 'success');
  },

  /* ===== 图片懒加载 ===== */
  lazyLoadImages(container = document) {
    const imgs = container.querySelectorAll('img.lazy[data-src]');
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const img = entry.target;
          img.src = img.dataset.src;
          img.onload = () => img.classList.add('loaded');
          observer.unobserve(img);
        }
      });
    });
    imgs.forEach(img => observer.observe(img));
  },

  /* ===== 防抖 / 节流 ===== */
  debounce(fn, delay = 300) {
    let timer;
    return function (...args) { clearTimeout(timer); timer = setTimeout(() => fn.apply(this, args), delay); };
  },
  throttle(fn, delay = 200) {
    let last = 0;
    return function (...args) { const now = Date.now(); if (now - last >= delay) { last = now; fn.apply(this, args); } };
  },

  /* ===== 转义 HTML（防 XSS） ===== */
  escape(str) {
    return String(str || '').replace(/[&<>"']/g, m => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));
  },

  /* ===== 生成唯一 ID ===== */
  uid(prefix = 'id') {
    return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  },

  /* ===== 加载状态骨架屏 ===== */
  skeleton(count = 3) {
    let html = '';
    for (let i = 0; i < count; i++) {
      html += `<div class="glass-card p-5 animate-pulse">
        <div class="h-40 bg-slate-200 dark:bg-slate-700 rounded-lg mb-4"></div>
        <div class="h-4 bg-slate-200 dark:bg-slate-700 rounded mb-2 w-3/4"></div>
        <div class="h-4 bg-slate-200 dark:bg-slate-700 rounded w-1/2"></div>
      </div>`;
    }
    return html;
  }
};
