// 兩個分頁共用 GM 儲存：本頁變更只合併自己改的欄位；遠端值先驗證，無效即忽略。
const fs = require('fs'); const path = require('path');
const { JSDOM } = require(path.join(__dirname, 'node_modules/jsdom'));
const src = fs.readFileSync(process.argv[2], 'utf8');
const store = new Map(); const tabs = []; const queue = [];
function boot(name) {
  const dom = new JSDOM('<!doctype html><html><head></head><body><div id="root"></div></body></html>', { url: 'https://ro-idle.app/', pretendToBeVisual: true, runScripts: 'outside-only' });
  const w = dom.window; const listeners = new Map(); const warns = [];
  w.ResizeObserver = class { observe() {} disconnect() {} }; w.IntersectionObserver = class { observe() {} disconnect() {} unobserve() {} };
  w.fetch = async () => ({ ok: false, status: 503, clone() { return this; }, text: async () => '', json: async () => ({}) });
  w.console = { ...console, warn: (...a) => warns.push(a.join(' ')), log() {} };
  w.alert = () => {};
  Object.assign(w, { unsafeWindow: w, GM_notification() {}, GM_registerMenuCommand() {},
    GM_getValue: (k, d) => store.has(k) ? w.JSON.parse(store.get(k)) : d, // 模擬 Tampermonkey 序列化：每次讀取都是本頁 realm 的新物件
    GM_setValue: (k, v) => { const old = store.get(k); store.set(k, JSON.stringify(v)); for (const t of tabs) if (t.w !== w) queue.push([t, k, old && t.w.JSON.parse(old), t.w.JSON.parse(JSON.stringify(v))]); },
    GM_addValueChangeListener: (k, fn) => { (listeners.get(k) || listeners.set(k, []).get(k)).push(fn); } });
  w.eval(src);
  const tab = { name, w, listeners, warns, deliver(k, v) { const x = typeof v === 'string' ? v : w.JSON.parse(JSON.stringify(v)); for (const fn of listeners.get(k) || []) fn(k, undefined, x, true); } };
  tabs.push(tab); return tab;
}
const val = (k) => store.has(k) ? JSON.parse(store.get(k)) : undefined;
const flush = () => { while (queue.length) { const [t, k, o, v] = queue.shift(); for (const fn of t.listeners.get(k) || []) fn(k, o, v, true); } };
const A = boot('A'), B = boot('B');
let ok = true; const check = (label, cond) => { console.log((cond ? 'PASS ' : 'FAIL ') + label); ok &&= cond; };
const $ = (t, sel) => t.w.document.querySelector(sel);
const change = (t, sel, set) => { const el = $(t, sel); set(el); el.dispatchEvent(new t.w.Event('change')); };
for (const t of [A, B]) $(t, '.ro-tab[data-t="cfg"]').click();

// 1. 偏好：A 開音效、B（尚未收到同步）開通知 → 兩者都保留
change(A, '[data-ro-pref="sound"]', el => el.checked = true);
change(B, '[data-ro-pref="notify"]', el => el.checked = true);
let prefs = val('ro_lean_prefs_v091') || {};
check(`偏好：兩分頁交錯修改不同欄位都保留（sound=${prefs.sound} notify=${prefs.notify}）`, prefs.sound === true && prefs.notify === true);
flush();
change(A, '[data-ro-pref="moneyColor"]', el => el.checked = false);
prefs = val('ro_lean_prefs_v091');
check('偏好：同步後 A 再改其他欄位，不會把 B 的 notify 改回', prefs.notify === true && prefs.moneyColor === false && prefs.sound === true);
check('偏好：遠端同步到 B 後設定頁勾選即時更新', (flush(), $(B, '[data-ro-pref="moneyColor"]').checked === false));

// 2. 掛牌價保護：A 改門檻、B 關開關（未同步）→ 兩欄都保留
change(A, '#c-price-threshold', el => el.value = '500000');
change(B, '#c-price-lock', el => el.checked = false);
let po = val('warehouse-auto-protect-v1');
check(`掛牌價：門檻與開關交錯修改都保留（${JSON.stringify(po)}）`, po.threshold === 500000 && po.enabled === false);
flush();
check('掛牌價：B 的門檻輸入框即時同步為 500000', $(B, '#c-price-threshold').value === '500000');
check('掛牌價：A 的開關即時同步為關', $(A, '#c-price-lock').checked === false);
change(A, '#c-price-threshold', el => el.value = '0');
check('掛牌價：無效門檻不寫入', val('warehouse-auto-protect-v1').threshold === 500000);

// 3. 遠端驗證：無效值被忽略，不改本頁
const before = $(B, '[data-ro-pref="sound"]').checked;
B.deliver('ro_lean_prefs_v091', { sound: 'yes' });
B.deliver('warehouse-helper-v1', '{"marks":{"__proto__":{}},"autoLocks":{}}');
B.deliver('warehouse-auto-protect-v1', { enabled: true, threshold: -5 });
B.deliver('roi-favorites-v1', [1, 'x']);
B.deliver('roi-refine-material-batch-v1', 99999);
B.deliver('roi-rare-auto-map-v1', 'on');
B.deliver('roi-mvp-record-change-v1', { key: 123 });
B.deliver('ro_custom_protect_words_v091', 'not-array');
check(`遠端驗證：8 種無效值都被記錄忽略（${B.warns.filter(x => /忽略無效/.test(x)).length} 筆）且不拋例外`, B.warns.filter(x => /忽略無效/.test(x)).length === 8);
check('遠端驗證：無效偏好未改變勾選', $(B, '[data-ro-pref="sound"]').checked === before);
check('遠端驗證：無效門檻未套用', $(B, '#c-price-threshold').value === '500000');
B.deliver('warehouse-auto-protect-v1', { enabled: true, threshold: 777 });
check('遠端驗證：有效值照常套用', $(B, '#c-price-threshold').value === '777' && $(B, '#c-price-lock').checked === true);
console.log(ok ? 'ALL PASS' : 'SOME FAIL');
process.exit(0);
