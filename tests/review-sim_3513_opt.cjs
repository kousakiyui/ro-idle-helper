// P1–P5 回歸：文字跳動慢速通道、fiber 路徑回推、單次 textContent、分類設定逐角色救援、稀有閘門排除自家 HUD
const fs = require('fs'); const path = require('path');
const { JSDOM } = require(path.join(__dirname, 'node_modules/jsdom'));
const file = process.argv[2]; const src = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const slice = (name) => { const i = src.indexOf(`  function ${name}(`); if (i < 0) throw Error('找不到 ' + name); const j = src.indexOf('\n  }\n', i); return src.slice(i, j + 4); };
let fail = 0; const check = (ok, m) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${m}`); if (!ok) fail++; };
const isPlainRecord = (v) => v !== null && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;

// P2：與 3.5.1 原始演算法（每節點複製路徑）比對結果與快取路徑
const reference = (root, el, matcher) => { const stack = [{ f: root, found: null, route: [] }];
  while (stack.length) { const { f, found, route } = stack.pop(); const p = f.memoizedProps; const next = p && matcher(p) ? p : found;
    if (f.stateNode === el) return { next, route: next ? route : null };
    if (f.sibling) stack.push({ f: f.sibling, found, route: [...route, 's'] }); if (f.child) stack.push({ f: f.child, found: next, route: [...route, 'c'] }); } return null; };
const G = new Function(`class FiberTraversalTimeout extends Error {} let fiberRetryScheduled = false; const requestAnimationFrame = () => {}; const runPageRouter = () => {};
  let ROOT = null; const currentFiberRoot = () => ROOT; const fiberRouteMap = new WeakMap(); const propsScanRetries = new WeakMap();
  ${slice('createFiberScanBudget')}${slice('getCommittedProps')} return { set: (r) => { ROOT = r; }, getCommittedProps, fiberRouteMap };`)();
let seed = 42; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
let same = 0, total = 0;
for (let t = 0; t < 20; t++) {
  const nodes = [{ memoizedProps: {}, child: null, sibling: null, return: null, stateNode: null }];
  for (let i = 1; i < 1500; i++) { const parent = nodes[Math.floor(rnd() * nodes.length)]; const f = { memoizedProps: rnd() < 0.05 ? { s: i } : { i }, child: null, sibling: null, return: parent, stateNode: { i } };
    if (!parent.child) parent.child = f; else { let c = parent.child; while (c.sibling) c = c.sibling; c.sibling = f; } nodes.push(f); }
  G.set(nodes[0]);
  for (let k = 0; k < 20; k++) { const el = nodes[1 + Math.floor(rnd() * 1499)].stateNode; const m = (p) => p.s !== undefined; const ref = reference(nodes[0], el, m);
    const a = G.getCommittedProps(el, m), b = G.getCommittedProps(el, m); total++;
    if (a === ref.next && b === ref.next && (G.fiberRouteMap.get(el) || null)?.join('') === ref.route?.join('')) same++; }
}
check(same === total, `P2 getCommittedProps 與原始演算法一致（${same}/${total}，含快取路徑）`);
{ // 長兄弟串效能
  let cnt = 0; const mk = (ret) => ({ memoizedProps: { k: cnt++ }, child: null, sibling: null, return: ret, stateNode: null });
  const root = mk(null); let cur = root;
  for (let d = 0; d < 20; d++) { const c = mk(cur); cur.child = c; let prev = c; for (let k = 0; k < 600; k++) { const s = mk(cur); prev.sibling = s; prev = s; } cur = prev; }
  const leaf = mk(cur); leaf.stateNode = {}; cur.child = leaf; root.memoizedProps = { s: 1 };
  G.set(root); const t0 = performance.now(); let v = null; try { v = G.getCommittedProps(leaf.stateNode, (p) => p.s); } catch (e) { v = e.constructor.name; } const ms = performance.now() - t0;
  check(v === root.memoizedProps && ms < 8, `P2 ${cnt} 節點、路徑長 1.2 萬：${ms.toFixed(2)}ms（< 8ms 預算）${typeof v === 'string' ? '，' + v : ''}`);
}
// P3
check(/const tableText = table\?\.textContent \|\| '';/.test(src) && !/table\.textContent\.includes\('回城賣'\) \|\| !table\.textContent/.test(src), 'P3 readBackpackContext 只讀一次 textContent');
// P4
{ if (!src.includes('function salvageCategoryProfiles(')) check(false, 'P4 沒有 salvageCategoryProfiles（單一角色損壞會清空全部）'); else {
  const v = new Function('isPlainRecord', `${slice('validateCategoryProfiles')}${slice('salvageCategoryProfiles')} return { validateCategoryProfiles, salvageCategoryProfiles };`)(isPlainRecord);
  const good = { enabled: true, modes: { consumable: 'store', equipment: 'off', card: 'valuable', other: 'priority' } };
  const out = v.salvageCategoryProfiles({ A: good, B: { enabled: 'x' }, C: { ...good, enabled: false } });
  check(Object.keys(out).join() === 'A,C' && JSON.stringify(v.validateCategoryProfiles(out)) === JSON.stringify(out), 'P4 一個角色損壞只略過它，其他角色保留且可通過寫入驗證');
  check(/const all = readValidatedSetting\(settingsKey, salvageCategoryProfiles, \{\}\);\n        const next/.test(src), 'P4 saveSettings 讀取改用逐角色救援'); } }
// P5
{ const dom = new JSDOM('<body><div id="root">其他頁面</div><div id="ro-helper-hud"><label>隨地圖同步必撿稀有掉落</label></div></body>'); const w = dom.window; let scans = 0;
  const env = { document: w.document, XPathResult: w.XPathResult, findRareRoots: () => { scans++; return []; }, rarePanels: new WeakMap(), rareAutoMap: false, rareLastMap: new WeakMap(), isRareHeading: () => false, getRareContext: () => null, fastSelectRare: () => false };
  const pre = src.split('\n').find((l) => l.includes('const rareHeadingXPath')) || '';
  const refresh = new Function(...Object.keys(env), pre + slice('refreshRareHelper') + 'return refreshRareHelper;')(...Object.values(env));
  refresh(); const a = scans; w.document.getElementById('root').insertAdjacentHTML('beforeend', '<fieldset><legend>必撿稀有掉落 (3 項)</legend></fieldset>'); refresh();
  check(a === 0 && scans === 1, `P5 只有 HUD 文字時不掃描（${a}），遊戲出現標題後掃描（${scans - a}）`); }
// P1：開機後每 50ms 改一段文字 2 秒，路由次數
{ const dom = new JSDOM('<!doctype html><html><head></head><body><div id="root"><main><span id="tick">0</span><div class="log-window"></div></main></div></body></html>', { url: 'https://ro-idle.app/', pretendToBeVisual: true, runScripts: 'outside-only' });
  const w = dom.window; w.ResizeObserver = class { observe() {} disconnect() {} }; w.IntersectionObserver = class { observe() {} disconnect() {} unobserve() {} };
  w.fetch = async () => ({ ok: false, status: 503, clone() { return this; }, text: async () => '', json: async () => ({}) }); w.document.hasFocus = () => true;
  const store = new Map(); Object.assign(w, { unsafeWindow: w, GM_notification() {}, GM_addValueChangeListener() {}, GM_getValue: (k, d) => store.has(k) ? store.get(k) : d, GM_setValue: (k, v) => store.set(k, v) });
  w.console = { ...console, log() {}, warn() {} };
  let routes = 0; const qsa = w.Document.prototype.querySelectorAll; w.Document.prototype.querySelectorAll = function (s) { if (s === 'fieldset > legend') routes++; return qsa.call(this, s); };
  w.eval(src);
  setTimeout(() => {
    const tick = w.document.getElementById('tick'); let n = 0; routes = 0;
    const iv = setInterval(() => { tick.firstChild.nodeValue = String(++n); }, 50);
    setTimeout(() => {
      clearInterval(iv); const textRuns = routes; routes = 0;
      w.document.querySelector('main').append(w.document.createElement('fieldset'));
      setTimeout(() => {
        check(textRuns <= 2, `P1 2 秒內每 50ms 改文字：路由 ${textRuns} 次（3.5.1.2 實測 9 次）`);
        check(routes >= 1, `P1 結構變動仍即時觸發路由（${routes} 次）`);
        console.log(fail ? 'SOME FAIL' : 'ALL PASS'); process.exit(0);
      }, 400);
    }, 2000);
  }, 500);
}
