const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const source = fs.readFileSync(process.argv[2], 'utf8');
const hook = `
  page.roiTestRefineLayout = { readBackpackContext, refineActor, findNativeDetailBtn, runPageRouter, runHybridRefine,
    setPack(pack) { refinePack = pack; } };
`;
const script = source.replace(/\}\)\(\);\s*$/, hook + '\n})();');
assert.notEqual(script, source);

function fixture(mode) {
  const dom = new JSDOM('<!doctype html><main></main>', {
    url: 'https://ro-idle.app/', runScripts: 'outside-only', pretendToBeVisual: true
  });
  const w = dom.window, d = w.document;
  w.Element.prototype.getClientRects = function () { return this.closest('[hidden]') ? [] : [{}]; };
  const errors = [];
  w.addEventListener('error', (e) => errors.push(e.message));
  Object.assign(w, {
    unsafeWindow: w, GM_getValue: (_name, fallback) => fallback, GM_setValue() {},
    GM_addValueChangeListener() {}, GM_notification() {}, confirm: () => true,
    ResizeObserver: class { observe() {} disconnect() {} },
    fetch: async () => ({ ok: false, status: 503 })
  });
  w.eval(script);
  const api = w.roiTestRefineLayout;
  // Use the native view's semantics without involving a real account or spending Zeny.
  const main = d.querySelector('main');
  const isGrid = mode === 'grid';
  const row = (uid) => isGrid
    ? `<button id="item-${uid}" aria-selected="false">同名短劍</button>`
    : `<div id="item-${uid}" role="option" aria-selected="false">同名短劍</div>`;
  const modern = mode !== 'classic';
  main.innerHTML = modern
    ? `<section role="tabpanel" aria-label="道具"><input aria-label="搜尋物品">
        <div id="host"><div id="anchor"><div>
          <div id="items" role="${isGrid ? 'group' : 'listbox'}" aria-label="道具">${row(1)}${row(2)}</div>
          <div id="detail" role="region" aria-label="道具詳情"></div>
        </div></div></div>
      </section>`
    : '<div id="host"><input aria-label="搜尋物品"><div class="xp-sunken"><table class="xp-table" id="items"><thead><tr><th>回城賣 / 存倉</th></tr></thead><tbody></tbody></table></div></div>';
  const root = {};
  root.stateNode = { current: root };
  const attach = (parent, fields) => {
    const f = { return: parent, ...fields };
    if (f.stateNode?.nodeType === 1) f.stateNode.__reactFiber$test = f;
    if (!parent.child) parent.child = f;
    else {
      let tail = parent.child;
      while (tail.sibling) tail = tail.sibling;
      tail.sibling = f;
    }
    return f;
  };
  const item = { uid: 1, itemId: 1201, qty: 1, refine: 0 };
  const other = { ...item, uid: 2 };
  let snapshot = { character: { zeny: 100, sp: 10, skills: {} }, inventory: [item, other], mapId: 'prontera', equipment: {} };
  const store = { getState: () => ({ characterId: 9, snapshot }), subscribe() {}, getInitialState() {}, setState() {} };
  const snapshotHook = { memoizedState: snapshot, next: { memoizedState: [null, [store]] } };
  const owner = attach(root, { type: () => {}, memoizedState: snapshotHook });
  const items = d.querySelector('#items');
  const packing = () => snapshot.inventory.map(st => ({ st, def: { name: '同名短劍' } }));
  const list = attach(owner, {
    stateNode: items, memoizedProps: modern ? { label: '道具', items: packing() } : { s: { ...snapshot, characterId: 9 } }
  });
  const clicks = [];
  if (modern) {
    const detail = d.querySelector('#detail');
    const detailFiber = attach(owner, { stateNode: detail });
    for (const uid of [1, 2]) {
      const button = d.querySelector('#item-' + uid);
      attach(list, { stateNode: button, key: String(uid) });
      button.onclick = () => {
        clicks.push('select:' + uid);
        detail.innerHTML = '<div><button aria-label="關閉物品資訊">關閉 ×</button><button>一鍵精煉到安全值 +1</button></div>';
        detailFiber.child = null;
        const selected = attach(detailFiber, { type: () => {}, memoizedProps: { uid, onClose() {} } });
        for (const control of detail.querySelectorAll('button')) attach(selected, { stateNode: control });
        detail.querySelector('button:last-child').onclick = () => {
          clicks.push('refine:' + uid);
          snapshot = { ...snapshot, inventory: snapshot.inventory.map(st => st.uid === uid ? { ...st, refine: 1 } : st) };
          snapshotHook.memoizedState = snapshot;
          list.memoizedProps.items = packing();
        };
      };
    }
  }
  api.setPack({
    items: new w.Map([[1201, { category: 'equipment', refineable: true, slots: ['weapon'], weaponLevel: 1 }]]),
    refine: { weapon: { 1: [{ material: 984, rate: 100, price: 10 }] } }
  });
  api.runPageRouter();
  return { w, d, api, items, snapshotHook, clicks, errors };
}

async function run() {
  for (const mode of ['list', 'grid', 'classic']) {
    const { w, d, api, items, snapshotHook, clicks, errors } = fixture(mode);
    try {
      const panel = d.querySelector('[data-roi-refine-helper]');
      assert.ok(panel, mode);
      assert.equal(panel.nextElementSibling?.id, mode === 'classic' ? '' : 'anchor');
      assert.equal(panel.querySelector('[data-roi-ref-warehouse]').disabled, mode !== 'classic');
      assert.equal(api.refineActor(api.readBackpackContext()), 9);
      console.log('PASS 背包精煉正確掛載與辨識角色 ' + mode);
      if (mode === 'classic') continue;
      d.querySelector('#item-2').click();
      assert.equal(api.findNativeDetailBtn(items, 1, () => true), null);
      assert.ok(api.findNativeDetailBtn(items, 2, text => text.startsWith('一鍵')));
      d.querySelector('#ref-toggle').click();
      d.querySelector('[data-ref-list] input').click();
      await api.runHybridRefine('safe_only');
      assert.deepEqual(clicks, ['select:2', 'select:1', 'refine:1']);
      assert.equal(snapshotHook.memoizedState.inventory[0].refine, 1);
      assert.equal(snapshotHook.memoizedState.inventory[1].refine, 0);
      assert.match(panel.querySelector('[data-ref-status]').textContent, /成功升階 1 次/);
      console.log('PASS 同名裝備只送出指定 UID 的原生精煉 ' + mode);
      const multiSell = d.createElement('div');
      multiSell.setAttribute('role', 'region');
      multiSell.setAttribute('aria-label', '多選販售');
      panel.closest('[role="tabpanel"]').append(multiSell);
      api.runPageRouter();
      assert.equal(d.querySelector('[data-roi-refine-helper]'), null);
      multiSell.remove();
      api.runPageRouter();
      assert.equal(d.querySelectorAll('[data-roi-refine-helper]').length, 1);
      assert.deepEqual(errors, []);
      console.log('PASS 多選販售暫停掛載，退出後恢復唯一入口 ' + mode);
    } finally {
      await Promise.resolve();
      w.dispatchEvent(new w.Event('pagehide'));
      w.close();
    }
  }
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
