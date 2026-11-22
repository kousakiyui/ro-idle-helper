// 整支腳本在 jsdom 開機：記錄 GM_registerMenuCommand 註冊、<style> 數量、HUD 重建後是否重複。
const fs = require('fs'); const path = require('path');
const { JSDOM } = require(path.join(__dirname, 'node_modules/jsdom'));
const file = process.argv[2]; const src = fs.readFileSync(file, 'utf8');
const dom = new JSDOM('<!doctype html><html><head></head><body><div id="root"></div></body></html>', { url: 'https://ro-idle.app/', pretendToBeVisual: true, runScripts: 'outside-only' });
const w = dom.window; const store = new Map(); const menus = []; const listeners = new Map();
w.ResizeObserver = class { observe() {} disconnect() {} }; w.IntersectionObserver = class { observe() {} disconnect() {} unobserve() {} };
w.fetch = async () => ({ ok: false, status: 503, clone() { return this; }, text: async () => '', json: async () => ({}) });
Object.assign(w, {
  GM_getValue: (k, d) => store.has(k) ? store.get(k) : d, GM_setValue: (k, v) => store.set(k, v),
  GM_addValueChangeListener: (k, fn) => { (listeners.get(k) || listeners.set(k, []).get(k)).push(fn); return listeners.size; },
  GM_registerMenuCommand: (name) => menus.push(name), GM_notification() {}, unsafeWindow: w,
});
const legacyRow = ['ro', 'wh', 'locked'].join('-');
const legacyBadge = ['ro', 'badge', 'lock'].join('-');
w.document.getElementById('root').innerHTML = '<ul><li class="native-row ' + legacyRow +
  '"><button data-ro-lock="1" class="native-button ' + legacyBadge + '"></button></li></ul>';
const errors = []; w.addEventListener('error', e => errors.push(e.message));
try { w.eval(src); } catch (e) { errors.push('boot: ' + e.message); }
let ok = true; const check = (label, cond) => { console.log((cond ? 'PASS ' : 'FAIL ') + label); ok &&= cond; };
check('開機移除舊倉庫樣式並保留原生 class', w.document.querySelector('li').className === 'native-row' &&
  w.document.querySelector('[data-ro-lock]').className === 'native-button');
check('開機無例外（' + (errors[0] || '無') + '）', errors.length === 0);
check(`不註冊掛牌價選單指令（實得 ${JSON.stringify(menus)}）`, !menus.some(n => /掛牌價/.test(n)));
check('@grant 不含 GM_registerMenuCommand', !/@grant\s+GM_registerMenuCommand/.test(src) || menus.length > 0);
const styles = () => w.document.querySelectorAll('head style').length;
const before = styles();
w.document.getElementById('ro-helper-hud')?.remove();
// 觸發 1.5 秒例行檢查中的 ensureHUD
return_promise = new Promise(r => setTimeout(r, 1700));
return_promise.then(() => {
  check(`HUD 重建後 <style> 數量不變（前 ${before}，後 ${styles()}）`, styles() === before && !!w.document.getElementById('ro-helper-hud'));
  check('跨分頁監聽已註冊：價格保護、收藏、精煉批量、稀有開關', ['warehouse-auto-protect-v1', 'roi-favorites-v1', 'roi-refine-material-batch-v1', 'roi-rare-auto-map-v1'].every(k => listeners.has(k)));
  console.log(ok ? 'ALL PASS' : 'SOME FAIL'); process.exit(ok ? 0 : 1);
});
