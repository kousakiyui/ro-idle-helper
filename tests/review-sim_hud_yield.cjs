const fs = require('node:fs');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');

const source = fs.readFileSync(process.argv[2], 'utf8');
const dom = new JSDOM('<!doctype html><body><main></main></body>', {
  url: 'https://ro-idle.app/', runScripts: 'outside-only', pretendToBeVisual: true
});
const w = dom.window, d = w.document;
const storedPosition = { left: 860, top: 48 };
const writes = [], resizeListeners = new Set();
const add = w.addEventListener.bind(w), remove = w.removeEventListener.bind(w);
w.addEventListener = (name, fn, options) => {
  if (name === 'resize') resizeListeners.add(fn);
  add(name, fn, options);
};
w.removeEventListener = (name, fn, options) => {
  if (name === 'resize') resizeListeners.delete(fn);
  remove(name, fn, options);
};
w.ResizeObserver = class { observe() {} disconnect() {} };
w.IntersectionObserver = class { observe() {} disconnect() {} };
w.fetch = async () => ({ ok: false, status: 503 });
w.Element.prototype.setPointerCapture = w.Element.prototype.releasePointerCapture = () => {};
Object.assign(w, {
  innerWidth: 1280, innerHeight: 800, unsafeWindow: w,
  GM_getValue(key, fallback) {
    return key === 'ro_lean_prefs_v091' ? w.JSON.parse(JSON.stringify({ hudMin: false, hudPos: storedPosition })) : fallback;
  },
  GM_setValue: (...args) => writes.push(args),
  GM_addValueChangeListener() {}, GM_notification() {}
});
let overlap = true;
function rect(left, top, width, height) {
  return { left, top, width, height, right: left + width, bottom: top + height };
}
w.Element.prototype.getBoundingClientRect = function () {
  if (this.id === 'ro-helper-hud') return rect(parseFloat(this.style.left) || 860, parseFloat(this.style.top) || 48, 365, 340);
  if (this.hasAttribute('aria-label')) return rect(overlap ? 1110 : 50, 130, 25, 22);
  return rect(20, 20, 100, 20);
};
w.Element.prototype.getClientRects = function () { return this.closest('[hidden]') ? [] : [this.getBoundingClientRect()]; };
const errors = [];
d.defaultView.addEventListener('error', e => errors.push(e.message));
const check = (result, message) => { assert.ok(result, message); console.log('PASS ' + message); };

async function run() {
  w.eval(source);
  const hud = d.querySelector('#ro-helper-hud');
  const fab = hud.querySelector('#ro-fab');
  const card = hud.querySelector('#ro-hud-card');
  const main = d.querySelector('main');
  const yielded = () => hud.hasAttribute('data-roi-hud-yield');
  const resize = () => w.dispatchEvent(new w.Event('resize'));
  const initialListeners = resizeListeners.size;
  function nextYield(expected, mutate) {
    return new Promise((resolve, reject) => {
      const observer = new w.MutationObserver(checkState);
      const timeout = setTimeout(() => { observer.disconnect(); reject(Error('HUD yield state did not update')); }, 3000);
      function checkState() {
        if (yielded() !== expected) return;
        clearTimeout(timeout);
        observer.disconnect();
        resolve();
      }
      observer.observe(hud, { attributes: true, attributeFilter: ['data-roi-hud-yield'] });
      mutate();
      checkState();
    });
  }

  const skill = d.createElement('button');
  skill.className = 'xp-btn small';
  skill.setAttribute('aria-label', '火箭術 +1');
  skill.textContent = '＋';
  Object.defineProperty(d, 'hidden', { configurable: true, value: true });
  main.append(skill);
  resize();
  check(!yielded(), '隱藏分頁不自動收合');
  Object.defineProperty(d, 'hidden', { configurable: true, value: false });
  d.dispatchEvent(new w.Event('visibilitychange'));
  check(yielded(), '回到可見時偵測技能＋重疊');
  check(w.getComputedStyle(card).visibility === 'hidden' &&
    w.getComputedStyle(hud).pointerEvents === 'none' && w.getComputedStyle(fab).pointerEvents === 'auto',
    '收合後技能區可接收點擊，浮動球仍可操作');
  await nextYield(false, () => skill.remove());
  check(!yielded(), '原生路由偵測技能移除並恢復');
  await nextYield(true, () => main.append(skill));
  check(yielded(), '原生路由偵測技能插入並收合');

  fab.dispatchEvent(new w.MouseEvent('pointerdown', { bubbles: true }));
  fab.dispatchEvent(new w.MouseEvent('pointerup', { bubbles: true }));
  resize();
  check(!yielded(), '手動展開後仍保留展開');
  overlap = false; resize(); overlap = true; resize();
  check(!yielded(), '同一面板移開再相交仍尊重手動展開');
  skill.hidden = true;
  resize();
  skill.hidden = false;
  resize();
  check(yielded(), '面板關閉再開可再次收合');
  overlap = false; resize();
  check(!yielded(), '調整視窗後不再重疊即恢復');
  skill.remove();
  const preview = d.createElement('div');
  preview.setAttribute('role', 'region');
  preview.setAttribute('aria-label', '屬性點預覽');
  overlap = true;
  main.append(preview);
  resize();
  check(yielded(), '屬性點預覽也納入讓位');
  d.querySelector('#ro-min-btn').click();
  resize();
  check(!yielded() && card.style.display === 'none', '使用者縮小時維持縮小狀態');
  preview.remove(); resize();
  check(card.style.display === 'none', '面板關閉後仍尊重手動縮小');
  const preferenceWrites = writes.filter(([key]) => key === 'ro_lean_prefs_v091');
  check(preferenceWrites.length === 1 && preferenceWrites[0][1].hudMin === true &&
    JSON.stringify(preferenceWrites[0][1].hudPos) === JSON.stringify(storedPosition) &&
    hud.style.left === '860px' && hud.style.top === '48px',
    '自動讓位不儲存位置或縮小偏好');
  for (let i = 0; i < 20; i++) resize();
  check(resizeListeners.size === initialListeners, '反覆調整不累積 resize 監聽器');
  w.dispatchEvent(new w.PageTransitionEvent('pagehide'));
  check(resizeListeners.size === initialListeners - 1, '離頁移除 HUD resize 監聽器');
  check(errors.length === 0, '整支腳本無瀏覽器例外');
  console.log('ALL PASS');
}
run().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { w.dispatchEvent(new w.PageTransitionEvent('pagehide')); w.close(); });
