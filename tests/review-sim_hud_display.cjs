const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');

const source = fs.readFileSync(process.argv[2], 'utf8');
const hook = `page.roiTestDisplay = {
  state, updateHUD, renderChars, validatePrefs, formatHudNumber,
  setMaps(maps) { lootPack = Promise.resolve({ maps }); }
};`;
assert.match(source, /\}\)\(\);\s*$/);
const script = source.replace(/\}\)\(\);\s*$/, hook + '\n})();');
const key = 'ro_lean_prefs_v091';
const preferences = new Map([[key, { hudMetrics: ['zeny', 'bexp'] }]]);

function boot(layout) {
  const dom = new JSDOM('<!doctype html><head><link rel="modulepreload" href="/assets/pack-test.js"></head><body></body>', {
    url: 'https://ro-idle.app/', runScripts: 'outside-only', pretendToBeVisual: true
  });
  const w = dom.window;
  const errors = [];
  w.addEventListener('error', (event) => errors.push(event.message));
  if (layout) w.sessionStorage.setItem('roi-hud-layout-v1', JSON.stringify(layout));
  const listeners = new Map();
  Object.assign(w, {
    unsafeWindow: w,
    ResizeObserver: class { observe() {} disconnect() {} },
    IntersectionObserver: class { observe() {} disconnect() {} },
    fetch: async () => ({ ok: false, status: 503 }),
    GM_getValue: (name, fallback) => preferences.has(name) ? w.JSON.parse(JSON.stringify(preferences.get(name))) : fallback,
    GM_setValue: (name, value) => preferences.set(name, JSON.parse(JSON.stringify(value))),
    GM_addValueChangeListener(name, listener) { listeners.set(name, listener); },
    GM_notification() {}
  });
  w.eval(script);
  const d = w.document;
  const get = (selector) => d.querySelector(selector);
  const change = (selector, value) => {
    const control = get(selector);
    control.value = value;
    control.dispatchEvent(new w.Event('change'));
  };
  return {
    w, d, get, change, errors, ...w.roiTestDisplay,
    prefsFromOtherTab(value) { listeners.get(key)(key, undefined, w.JSON.parse(JSON.stringify(value)), true); },
    metrics: () => [...d.querySelectorAll('#roi-hud-metrics [data-roi-metric]:not([hidden])')].map((el) => el.dataset.roiMetric),
    names: () => [...d.querySelectorAll('#u-clist > div > div > b')].map((el) => el.textContent)
  };
}

const check = (label, assertion) => { assertion(); console.log('PASS ' + label); };

async function run() {
  const first = boot(), second = boot({ view: 'full', columns: 'two' });
  try {
    first.get('.ro-tab[data-t="cfg"]').click();
    first.updateHUD();
    check('完整模式保留舊欄位設定和順序，預設使用響應式欄數', () => {
      assert.deepEqual(first.metrics(), ['zeny', 'bexp']);
      assert.equal(first.get('#roi-hud-metrics').dataset.columns, 'auto');
      assert.match(first.get('style[data-roi-style]').textContent, /@media \(max-width:420px\)\s*\{\s*#roi-hud-metrics\[data-columns="auto"\] \{ grid-template-columns:minmax\(0,1fr\)/);
    });
    first.change('#c-hud-view', 'compact');
    first.change('#c-hud-columns', 'one');
    check('各分頁可單獨選完整、精簡與欄數，精簡模式另有欄位清單', () => {
      assert.deepEqual(first.metrics(), ['dmg', 'kph', 'zeny']);
      assert.equal(first.get('#roi-hud-metrics').dataset.columns, 'one');
      assert.deepEqual(JSON.parse(first.w.sessionStorage.getItem('roi-hud-layout-v1')), { view: 'compact', columns: 'one' });
      assert.equal(second.get('#roi-hud-metrics').dataset.view, 'full');
      assert.equal(second.get('#roi-hud-metrics').dataset.columns, 'two');
    });
    first.get('[data-ro-metric-setting="zeny"] button[data-ro-metric-move="-1"]').click();
    check('移動與勾選精簡欄位會更新畫面與偏好，完整模式保留原排序', () => {
      assert.deepEqual(first.metrics(), ['dmg', 'zeny', 'kph']);
      assert.deepEqual(preferences.get(key).hudCompactMetrics, ['dmg', 'zeny', 'kph']);
      first.get('[data-ro-metric-pref="kph"]').click();
      assert.deepEqual(first.metrics(), ['dmg', 'zeny']);
      first.change('#c-hud-view', 'full');
      assert.deepEqual(first.metrics(), ['zeny', 'bexp']);
    });
    first.state.curZeny = 250000000;
    first.state.activeCharId = 1;
    first.state.initZenyMap[1] = 260000000;
    check('數字格式可切換萬、億或完整數字，負數與小數量正常顯示', () => {
      first.change('#c-hud-number', 'wan');
      assert.equal(first.get('#u-zeny').textContent, '25000.0萬 Z (-1000.0萬)');
      first.change('#c-hud-number', 'yi');
      assert.equal(first.get('#u-zeny').textContent, '2.50億 Z (-10,000,000)');
      first.change('#c-hud-number', 'full');
      assert.equal(first.get('#u-zeny').textContent, '250,000,000 Z (-10,000,000)');
      assert.equal(first.formatHudNumber(0, 'auto'), '0');
      assert.throws(() => first.validatePrefs(first.w.JSON.parse('{"hudNumberFormat":"bad"}')), /格式不符/);
    });
    Object.assign(first.state, {
      charRosterLoaded: true,
      chars: [
        { id: 1, name: '甲', running: true, mapId: 'prontera' },
        { id: 2, name: '乙', running: false, mapId: 'gef_fild01' },
        { id: 3, name: '丙', running: true, mapId: 'map_unknown' }
      ],
      charAlerts: { 3: { reason: '戰鬥不能', at: Date.now() } },
      charZenyMap: { 1: 0, 3: 4000 }
    });
    first.setMaps(new Map([['gef_fild01', { name: '吉芬原野 01' }]]));
    first.get('.ro-tab[data-t="chr"]').click();
    await new Promise(setImmediate);
    check('分身顯示地圖中文名與 ID 提示，未知餘額可與真實 0 區分', () => {
      assert.match(first.get('#u-clist').textContent, /吉芬原野 01 ｜ 💰 待同步/);
      assert.match(first.get('#u-clist').textContent, /💰 0 Z/);
      assert.match(first.get('#u-clist').textContent, /map_unknown/);
      assert.equal(first.get('[title="gef_fild01"]').title, 'gef_fild01');
      assert.equal(first.get('#u-tzeny').textContent, '4,000 Z（1 角待同步）');
    });
    check('分身支援停止及異常置頂與獨立篩選，總額仍涵蓋全帳號', () => {
      first.get('[data-ro-char-filter="charAttentionFirst"]').click();
      assert.deepEqual(first.names(), ['乙', '丙', '甲']);
      first.get('[data-ro-char-filter="charAttentionOnly"]').click();
      assert.deepEqual(first.names(), ['乙', '丙']);
      assert.equal(first.get('#u-tzeny').textContent, '4,000 Z（1 角待同步）');
      first.prefsFromOtherTab({ charAttentionOnly: false, charAttentionFirst: false });
      assert.deepEqual(first.names(), ['甲', '乙', '丙']);
      assert.equal(first.get('[data-ro-char-filter="charAttentionOnly"]').checked, false);
    });
  } finally {
    for (const { w, errors } of [first, second]) {
      w.dispatchEvent(new w.Event('pagehide'));
      assert.deepEqual(errors, []);
      w.close();
    }
  }
}

run().catch((error) => { console.error(error); process.exitCode = 1; });
