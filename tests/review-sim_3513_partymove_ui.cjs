// 全隊移動：整支腳本在 jsdom 開機，假伺服器（停止延後生效）走完按鈕 → 確認 → 停止 → 等待 → 套用設定 → 換圖開始 → 驗證
const fs = require('fs'); const path = require('path');
const { JSDOM } = require(path.join(__dirname, 'node_modules/jsdom'));
const file = process.argv[2]; const src = fs.readFileSync(file, 'utf8');
if (!src.includes('data-roi-party-move') && !src.includes('roiPartyMove')) { console.log('SKIP 此版本沒有全隊移動功能'); process.exit(0); }
const dom = new JSDOM(`<!doctype html><html><head></head><body><div id="root"><main>
  <section><div role="group" aria-label="掛機地圖"><input aria-label="掛機地圖：搜尋"></div>
  <button type="button" id="apply">套用設定</button></section>
  <section><fieldset id="rare"><legend id="rare-h">必撿稀有掉落 (0 項)</legend><div id="rare-here"></div><div>不在這張地圖：</div><div id="rare-away"></div></fieldset></section><div class="log-window"></div></main></div></body></html>`, { url: 'https://ro-idle.app/', pretendToBeVisual: true, runScripts: 'outside-only' });
const w = dom.window; const doc = w.document;
const observers = new Set();
w.MutationObserver = class extends w.MutationObserver {
  constructor(callback) { super(callback); observers.add(this); }
};
w.Element.prototype.getClientRects = function () { return [{ width: 1, height: 1 }]; };
w.ResizeObserver = class { observe() {} disconnect() {} }; w.IntersectionObserver = class { observe() {} disconnect() {} unobserve() {} };
w.document.hasFocus = () => true;
const store = new Map(); const warns = []; const debugs = [];
Object.assign(w, { unsafeWindow: w, GM_notification() {}, GM_addValueChangeListener() {}, GM_getValue: (k, d) => store.has(k) ? w.JSON.parse(store.get(k)) : d, GM_setValue: (k, v) => store.set(k, JSON.stringify(v)) });
w.console = { ...console, log() {}, debug: (...a) => debugs.push(a.map((x) => typeof x === 'string' ? x : JSON.stringify(x)).join(' ')), warn: (...a) => warns.push(a.map((x) => typeof x === 'string' ? x : JSON.stringify(x)).join(' ')) };
// ---- 假伺服器
const baseConfig = { lockMap: 'prt_fild08', autoLoot: { on: true }, autoResumeAfterDeath: false, rarePickup: [101, 102] };
const chars = new Map([
  [1, { name: 'Tofu6', mapId: 'prt_fild08', lockMap: 'prt_fild08', running: true, config: { ...baseConfig } }],
  [2, { name: 'Tofu2', mapId: 'prt_fild08', lockMap: 'prt_fild08', running: true }],
  [3, { name: 'Tofu3', mapId: 'prt_fild08', lockMap: 'prt_fild08', running: true }],
]);
const log = []; const posts = [];
const res = (status, body) => ({ ok: status >= 200 && status < 300, status, headers: { get: () => null }, clone() { return res(status, body); }, text: async () => JSON.stringify(body), json: async () => body });
const pending = new Map();
const battle = setInterval(() => { for (const [id, at] of pending) if (Date.now() >= at) { chars.get(id).running = false; pending.delete(id); } }, 50);
w.fetch = async (url, init = {}) => {
  const u = new URL(String(url), 'https://ro-idle.app'); const p = u.pathname; const method = (init.method || 'GET').toUpperCase();
  await new Promise((r) => setTimeout(r, 3));
  if (p === '/api/characters') return res(200, { characters: [...chars].map(([id, c]) => ({ id, name: c.name, running: c.running })) });
  let m = p.match(/^\/api\/characters\/(\d+)$/);
  if (m) { const id = +m[1], c = chars.get(id); return res(200, { characterId: id, name: c.name, running: c.running, commandRevision: 12, snapshot: { character: { name: c.name, zeny: 100 }, mapId: c.mapId, config: { ...(c.config || {}), lockMap: c.lockMap } } }); }
  if (/^\/api\/characters\/1\/party$/.test(p)) return res(200, { party: { id: 9, leaderId: 2, members: [...chars].map(([id, c]) => ({ id, name: c.name, mapId: c.mapId, running: c.running, baseLv: 10, job: 'novice' })) }, invites: [], own: [...chars].filter(([id]) => id !== 3).map(([id, c]) => ({ id, name: c.name, partyId: 9, running: c.running, vending: false, mapId: c.mapId })) });
  m = p.match(/^\/api\/characters\/(\d+)\/commands$/);
  if (m && method === 'POST') {
    const id = +m[1], c = chars.get(id); const body = JSON.parse(init.body); const cmd = body.command;
    posts.push({ id, cmd, headers: init.headers || {}, credentials: init.credentials, uuid: body.commandId, revision: body.expectedCommandRevision, running: c.running });
    log.push(`${id}:${cmd.type}${cmd.mapId ? '>' + cmd.mapId : ''}`);
    if (cmd.type === 'stop' && c.running) pending.set(id, Date.now() + 700);
    if (cmd.type === 'selectMap' && !c.running) { c.mapId = cmd.mapId; c.lockMap = cmd.mapId; }
    if (cmd.type === 'start') { pending.delete(id); c.running = true; c.mapId = c.lockMap; }
    if (cmd.type === 'updateConfig') { c.lockMap = cmd.config.lockMap; c.config = { ...cmd.config }; }
    return res(200, { ok: true, view: { characterId: id, running: c.running } });
  }
  return res(200, {});
};
// ---- 假 React fiber：照遊戲前端 index-Dxm6ToCt.js 的真實結構
//   設定元件 $d {snap, save, characterId}（草稿在 useState，未修改時 null）
//   └ 分頁容器 ks {on, draft, advanced}（沒有 update）
//     ├ Ts「掛機地圖」{tab, title, keys, words} └ I {title} └ Ac {label:'掛機地圖', maps, value: draft.lockMap, onChange} └ 群組 DOM
//     └ Ts「藥水與補給」└ rf {draft, update, snap}（兄弟區塊，不是地圖選單的祖先）
const group = doc.querySelector('[role="group"]');
const applyBtn = doc.getElementById('apply');
const F = (props, ret, stateNode = null) => { const f = { memoizedProps: props, memoizedState: null, child: null, sibling: null, return: ret, stateNode, key: null }; if (ret && !ret.child) ret.child = f; return f; };
const root = F(null, null, {}); root.stateNode.current = root;
const snap = { config: { ...baseConfig }, character: { name: 'Tofu6' } };
const panel = F({ snap, save() {}, characterId: 1 }, root);
panel.memoizedState = { memoizedState: null, next: { memoizedState: null, next: null } }; // useState(null) 草稿
const tabs = F({ on: true, draft: snap.config, advanced: false }, panel);
const tsMap = F({ tab: 'config', title: '掛機地圖', keys: ['lockMap'], words: '地圖' }, tabs);
const tsItems = F({ tab: 'items_control', title: '藥水與補給', keys: ['useSelf_item'], words: '喝水' }, tabs); tsMap.sibling = tsItems;
const rf = F({ draft: snap.config, update() {}, snap }, tsItems);
// 「必撿稀有掉落」eu {draft, update, monsterIds}（遊戲：本圖可掉的稀有道具全列出，草稿裡其他的放在「不在這張地圖」）
const tsLoot = F({ tab: 'items', title: '撿取', keys: ['rarePickup'], words: '必撿' }, tabs); tsItems.sibling = tsLoot;
const DROPS = { prt_fild08: [101, 102], prt_fild07: [201, 202, 101] };
const rareRoot = doc.getElementById('rare');
const eu = F({ draft: snap.config, update: (patch) => setDraft({ ...(draft ?? snap.config), ...patch }), monsterIds: [] }, tsLoot);
const rareHost = F({}, eu, rareRoot); rareRoot.__reactFiber$sim = rareHost;
const rareLabels = new Map(); // React 依 key 重用 <label>
function renderRare(p) {
  const here = DROPS[p.lockMap] || [], r = p.rarePickup ?? [];
  const away = r.filter((x) => !here.includes(x));
  eu.memoizedProps = { ...eu.memoizedProps, draft: p, monsterIds: [p.lockMap] };
  const fiberKids = [];
  const put = (id, box) => {
    let lab = rareLabels.get(id);
    if (!lab) {
      lab = doc.createElement('label'); const inp = doc.createElement('input'); inp.type = 'checkbox'; inp.setAttribute('aria-label', `必撿 道具${id}`);
      inp.addEventListener('change', () => { const cur = (draft ?? snap.config).rarePickup ?? []; const n = inp.checked ? [...new Set([...cur, id])] : cur.filter((x) => x !== id); eu.memoizedProps.update({ rarePickup: n.length ? n : undefined }); });
      lab.append(inp, doc.createTextNode(`道具${id}`)); rareLabels.set(id, lab);
    }
    lab.firstChild.checked = r.includes(id); box.appendChild(lab);
    const lf = { type: 'label', key: String(id), memoizedProps: {}, child: null, sibling: null, return: rareHost, stateNode: lab };
    lf.child = { type: 'input', key: null, memoizedProps: {}, child: null, sibling: null, return: lf, stateNode: lab.firstChild };
    fiberKids.push(lf);
  };
  const hereBox = doc.getElementById('rare-here'), awayBox = doc.getElementById('rare-away');
  hereBox.replaceChildren(); awayBox.replaceChildren();
  here.forEach((id) => put(id, hereBox)); away.forEach((id) => put(id, awayBox));
  fiberKids.forEach((f, i) => { f.sibling = fiberKids[i + 1] || null; }); rareHost.child = fiberKids[0] || null;
  doc.getElementById('rare-h').textContent = `必撿稀有掉落 (${r.length} 項)`;
}
const sec = F({ title: '掛機地圖' }, tsMap);
const maps = [{ id: 'prt_fild07', name: '普隆德拉原野 07' }, { id: 'prt_fild08', name: '普隆德拉原野 08' }];
const ac = F({ label: '掛機地圖', maps, value: 'prt_fild08', onChange() {} }, sec);
const host = F({ role: 'group' }, ac, group); group.__reactFiber$sim = host;
for (const m of maps) { const b = doc.createElement('button'); b.type = 'button'; b.textContent = m.name; b.setAttribute('aria-pressed', 'false'); b.__reactFiber$sim = { key: m.id, memoizedProps: {}, return: host, stateNode: b }; group.appendChild(b); }
let draft = null;
function setDraft(d) { // 模擬 React 重新 render：s(d) → p = d ?? snap.config
  draft = d; panel.memoizedState.memoizedState = d; const p = d ?? snap.config;
  tabs.memoizedProps = { ...tabs.memoizedProps, draft: p }; rf.memoizedProps = { ...rf.memoizedProps, draft: p };
  ac.memoizedProps = { ...ac.memoizedProps, value: p.lockMap };
  for (const b of group.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.__reactFiber$sim.key === p.lockMap));
  applyBtn.disabled = !d;
  renderRare(p);
}
setDraft(null); // 乾淨的面板
// 原生「套用設定」：用頁面 fetch（會經過腳本包裝）送整份草稿，成功後 onApplied → s(null)
applyBtn.onclick = async () => { const d = draft; const r = await w.fetch('/api/characters/1/commands', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json', 'x-ro-client': '1' }, body: JSON.stringify({ commandId: 'native', command: { type: 'updateConfig', config: d } }) }); if (r.ok) { snap.config = { ...d }; setDraft(null); } };
const errors = []; w.addEventListener('error', (e) => errors.push(e.message));
w.eval(src);
let fail = 0; const check = (ok, m) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${m}`); if (!ok) fail++; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms) => { const t = Date.now(); while (Date.now() - t < ms) { const v = fn(); if (v) return v; await wait(30); } return null; };
(async () => {
  await w.fetch('/api/characters/1'); // 前景角色
  const traffic = setInterval(() => { void w.fetch('/api/kill-event'); }, 120); // 遊戲平常的請求 → 喚醒等待器
  await wait(400); w.dispatchEvent(new w.Event('focus'));
  const btn = await until(() => doc.querySelector('[data-roi-party-move]'), 2000);
  check(!!btn && doc.querySelectorAll('[data-roi-party-move-bar]').length === 1 && group.nextElementSibling?.hasAttribute('data-roi-party-move-bar'), '掛機地圖旁出現唯一一個 🚩 按鈕列');
  w.dispatchEvent(new w.Event('focus')); await wait(50);
  check(doc.querySelectorAll('[data-roi-party-move-bar]').length === 1, '路由重跑後不重複建立');
  const status0 = doc.querySelector('[data-roi-party-move-status]');
  try {
    setDraft({ ...snap.config, lockMap: 'prt_fild07', autoResumeAfterDeath: true });
    btn.click();
    const confirmDialog = () => until(() => doc.querySelector('[data-roi-party-move-dialog]'), 3000);
    const cancelled = await confirmDialog();
    check(!!cancelled, '從掛機地圖選單取得自選目標並顯示確認視窗');
    [...cancelled.querySelectorAll('button')].find((b) => b.textContent === '取消').click();
    check(await until(() => !btn.disabled, 3000) && posts.length === 0 && status0.textContent === '已取消', '確認視窗取消不送出指令');

    btn.click();
    const dlg = await confirmDialog();
    check(!!dlg && /普隆德拉原野 07/.test(dlg.textContent) && /Tofu3.*非本帳號/.test(dlg.textContent), '確認視窗指出自選地圖與外帳號隊員');
    check(posts.length === 0, '確認前不送出指令');
    [...dlg.querySelectorAll('button')].find((b) => b.textContent === '確定移動').click();
    check(!!await until(() => /打完這場/.test(status0.textContent), 4000), '等待原生戰鬥打完');
    check(!doc.querySelector('[data-roi-party-move-cancel]').hidden, '進行中可取消');
    check(!!await until(() => !btn.disabled, 15000) && /全隊移動完成/.test(status0.textContent), '自選地圖使用共用流程完成');
    check(log.join(' ') === '1:stop 2:stop 1:updateConfig 1:start 2:selectMap>prt_fild07 2:start', `同帳號指令順序：${log.join(' ')}`);
    const update = posts.find((p) => p.cmd.type === 'updateConfig');
    check(update?.revision === 12 && !update.running && JSON.stringify(update.cmd.config) ===
      JSON.stringify({ ...baseConfig, lockMap: 'prt_fild07' }), '等角色確實停止後，用已儲存設定只改掛機地圖');
    check(chars.get(3).running && chars.get(3).mapId === 'prt_fild08', '外帳號隊員未被移動');
    check(errors.length === 0, `沒有未捕捉錯誤：${errors.join('、')}`);
  } finally {
    clearInterval(traffic);
    clearInterval(battle);
    for (const observer of observers) observer.disconnect();
    w.close();
    process.exitCode = fail ? 1 : 0;
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
