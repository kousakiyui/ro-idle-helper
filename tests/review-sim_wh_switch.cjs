// 倉庫切角提交路徑模擬：以函式切片 + jsdom 假 DOM / 假 Fiber，比對 v3.5.0 與 3.5.1 候選。
// 用法：node tests/review-sim_wh_switch.cjs <userscript> [--stale]   （--stale：模擬未更新的舊測試替身，不提供 3.5.1 新增的 createFiberScanBudget）
const fs = require('fs'); const path = require('path');
const { JSDOM } = require(path.join(__dirname, 'node_modules/jsdom'));
const file = process.argv[2]; const stale = process.argv.includes('--stale'); const staleSet = process.argv.includes('--stale-weakset');
const src = fs.readFileSync(file, 'utf8');
function slice(name) {
  const m = new RegExp('(?:async )?function ' + name + '\\(').exec(src); if (!m) return null;
  let i = src.indexOf('{', m.index + src.slice(m.index).indexOf(')')), d = 0, j = i;
  for (; j < src.length; j++) { if (src[j] == '{') d++; else if (src[j] == '}') { d--; if (!d) break; } }
  return src.slice(m.index, j + 1);
}
const names = ['tryWithdrawFromWarehouse','assertRefineSession','assertRefineTarget','refineAwait','clickRefineControl','refineActor',
  'readBackpackContext','getCommittedProps','currentFiberRoot','getReactFiber','nativeStoreActor','findRefineNativeStore',
  'warehouseItemId','materialWithdrawalAmount','validMaterialBatch','waitForUi','waitForRefineUi','waitForRefineCommandSlot','clickRefineCommand'];
if (!stale) names.push('createFiberScanBudget');
const parts = names.map(slice).filter(Boolean);
const v351 = /createFiberScanBudget/.test(src);
const prelude = `
  let refineIdentityEpoch = 0, refineNativeStore = null, cachedFiberKey = null, bagMemo = null, fiberRetryScheduled = false;
  const TIMING = { refineCommandGap: 1000 }; let lastRefineCommandAt = -Infinity;
  let refineWarehouseSubmitButton = null, visitingWarehouse = false, refStop = false;
  const fiberRouteMap = new WeakMap(), bagFastMiss = ${v351 && !staleSet ? 'new WeakMap()' : 'new WeakSet()'};
  const propsScanRetries = new WeakMap(), backpackScanRetries = new WeakMap(), detailScanRetries = new WeakMap();
  class FiberTraversalTimeout extends Error {}
  const positiveId = (value) => (typeof value === 'number' || (typeof value === 'string' && /^[1-9]\\d*$/.test(value))) &&
    Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : null;
  const snapshotCharacterId = (s) => positiveId(s?.character?.id ?? s?.characterId ?? s?.character?.characterId);
  const refineItemSignature = (item) => JSON.stringify([item.itemId, item.cards ?? [], item.forged ?? null]);
`;
function build(withBag = false) {
  const dom = new JSDOM(`<body><nav><button class="xp-menu-item">背包</button><button class="xp-menu-item">倉庫</button></nav>
    <fieldset id="wh"><legend>倉庫 (2/300)</legend><ul>
      <li><img src="/client/item/984.png"><input type="checkbox" aria-label="取出 神之金屬"><button aria-label="神之金屬的物品資訊">神之金屬</button> ×5</li>
      <li><img src="/client/item/1201.png"><input type="checkbox" aria-label="取出 短劍"><button aria-label="短劍的物品資訊">+3 短劍</button></li>
    </ul><button id="submit" disabled>取出 0 項</button></fieldset>
    ${withBag ? '<div id="bag"><input aria-label="搜尋物品"><table class="xp-table"><thead><tr><th>回城賣 / 存倉</th></tr></thead><tbody></tbody></table></div>' : ''}</body>`, { pretendToBeVisual: true });
  const { document } = dom.window;
  const field = document.getElementById('wh'), submit = document.getElementById('submit');
  const counters = { submit: 0, tabClicks: 0 };
  const hooks = { onCheck: null, onSubmit: null };
  const sync = () => { const n = field.querySelectorAll('ul input:checked').length; submit.textContent = `取出 ${n} 項`; submit.disabled = n === 0; };
  for (const cb of field.querySelectorAll('ul input')) cb.addEventListener('click', () => { sync(); hooks.onCheck?.(); });
  submit.addEventListener('click', () => { counters.submit++; hooks.onSubmit?.(); for (const cb of field.querySelectorAll("ul input")) cb.checked = false; sync(); });
  for (const b of document.querySelectorAll('nav button')) b.addEventListener('click', () => counters.tabClicks++);
  // 假 React：HostRoot -> fieldset（props.snap 帶角色）
  const snap = { character: { id: 1, name: '甲', zeny: 100 }, inventory: [], mapId: 'prontera' };
  const root = { return: null, memoizedProps: null }; root.stateNode = { current: root };
  const fsFiber = { return: root, stateNode: field, memoizedProps: { snap }, child: null, sibling: null };
  root.child = fsFiber; field.__reactFiber$test = fsFiber;
  let tableFiber = null;
  if (withBag) {
    const table = document.querySelector('table.xp-table');
    tableFiber = { return: root, stateNode: table, memoizedProps: { s: snap }, child: null, sibling: null };
    fsFiber.sibling = tableFiber; table.__reactFiber$test = tableFiber;
  }
  const env = {
    document, MutationObserver: dom.window.MutationObserver, pageNet: { events: new dom.window.EventTarget() }, state: { activeCharId: 1 }, performance, requestAnimationFrame: f => setTimeout(f, 16), runPageRouter() {},
    clean: s => String(s || '').normalize('NFKC').replace(/\s+/g, ' ').trim(),
    visible: el => Boolean(el && el.isConnected && !el.closest('[hidden]')),
    sleep: ms => new Promise(r => setTimeout(r, Math.min(ms, 5))), console
  };
  const api = new Function(...Object.keys(env), prelude + parts.join('\n') +
    '\nreturn { tryWithdrawFromWarehouse, bumpEpoch(){ refineIdentityEpoch++; }, epoch(){ return refineIdentityEpoch; } };')(...Object.values(env));
  const switchRole = (id) => { const next = { ...snap, character: { ...snap.character, id } }; fsFiber.memoizedProps = { snap: next }; if (tableFiber) tableFiber.memoizedProps = { s: next }; env.state.activeCharId = id; api.bumpEpoch(); };
  return { api, counters, hooks, switchRole, env };
}
async function scenario(label, setup, expectSubmit, withBag = false) {
  const t = build(withBag); const s = setup(t);
  let err = null, res;
  try { res = await t.api.tryWithdrawFromWarehouse(new Set([984]), 10, () => {}, null, 15, s.session ?? { characterId: 1, epoch: t.api.epoch(), targetUid: null, items: new Map() }); }
  catch (e) { err = e.message; }
  const ok = t.counters.submit === expectSubmit;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}: submit=${t.counters.submit} (期望 ${expectSubmit}) tab點擊=${t.counters.tabClicks} 回傳=${res ? res.length : '-'} 錯誤=${err ?? '無'}`);
  return ok;
}
(async () => {
  console.log('==', path.basename(file), stale ? '(舊測試替身：缺 createFiberScanBudget)' : '', staleSet ? '(舊測試替身：bagFastMiss 仍為 WeakSet)' : '');
  const r = [];
  r.push(await scenario('S0 同角色領倉', () => ({}), 1));
  r.push(await scenario('S1 勾選後提交前切角 → 不得提交', t => { t.hooks.onCheck = () => t.switchRole(2); return {}; }, 0));
  r.push(await scenario('S2 提交後立即切角 → 已提交 1 次、不再清理', t => { t.hooks.onSubmit = () => t.switchRole(2); return {}; }, 1));
  r.push(await scenario('S3 切到角色2後以新 session 領倉', t => { t.switchRole(2); return { session: { characterId: 2, epoch: t.api.epoch(), targetUid: null, items: new Map() } }; }, 1));
  r.push(await scenario('S4 舊 session（epoch 過期）→ 不得提交', t => { const session = { characterId: 1, epoch: t.api.epoch(), targetUid: null, items: new Map() }; t.switchRole(2); t.switchRole(1); return { session }; }, 0));
  r.push(await scenario('S5 背包同時可見（refineActor 走背包快照）同角色領倉', () => ({}), 1, true));
  r.push(await scenario('S6 背包可見、提交後切角', t => { t.hooks.onSubmit = () => t.switchRole(2); return {}; }, 1, true));
  r.push(await scenario('S7 背包可見、切到角色2後新 session', t => { t.switchRole(2); return { session: { characterId: 2, epoch: t.api.epoch(), targetUid: null, items: new Map() } }; }, 1, true));
  console.log(r.every(Boolean) ? 'ALL PASS' : 'SOME FAIL'); if (!r.every(Boolean)) process.exitCode = 1;
})();
