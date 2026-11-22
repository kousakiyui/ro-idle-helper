// 全隊移動：整支腳本在 jsdom 開機，假伺服器（停止延後生效）走完按鈕 → 確認 → 套用設定 → 停止 → 等待 → 換圖開始 → 驗證
const fs = require('fs'); const path = require('path');
const { JSDOM } = require(path.join(__dirname, 'node_modules/jsdom'));
const file = process.argv[2]; const src = fs.readFileSync(file, 'utf8');
if (!src.includes('data-roi-party-move') && !src.includes('roiPartyMove')) { console.log('SKIP 此版本沒有全隊移動功能'); process.exit(0); }
const dom = new JSDOM(`<!doctype html><html><head></head><body><div id="root"><main>
  <section><div role="group" aria-label="掛機地圖"><input aria-label="掛機地圖：搜尋"></div>
  <button type="button" id="apply">套用設定</button></section>
  <section><fieldset id="rare"><legend id="rare-h">必撿稀有掉落 (0 項)</legend><div id="rare-here"></div><div>不在這張地圖：</div><div id="rare-away"></div></fieldset></section><div class="log-window"></div></main></div></body></html>`, { url: 'https://ro-idle.app/', pretendToBeVisual: true, runScripts: 'outside-only' });
const w = dom.window; const doc = w.document;
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
setInterval(() => { for (const [id, at] of pending) if (Date.now() >= at) { chars.get(id).running = false; pending.delete(id); } }, 50);
w.fetch = async (url, init = {}) => {
  const u = new URL(String(url), 'https://ro-idle.app'); const p = u.pathname; const method = (init.method || 'GET').toUpperCase();
  await new Promise((r) => setTimeout(r, 3));
  if (p === '/api/characters') return res(200, { characters: [...chars].map(([id, c]) => ({ id, name: c.name, running: c.running })) });
  let m = p.match(/^\/api\/characters\/(\d+)$/);
  if (m) { const id = +m[1], c = chars.get(id); return res(200, { characterId: id, name: c.name, running: c.running, snapshot: { character: { name: c.name, zeny: 100 }, mapId: c.mapId, config: { ...(c.config || {}), lockMap: c.lockMap } } }); }
  if (/^\/api\/characters\/1\/party$/.test(p)) return res(200, { party: { id: 9, leaderId: 2, members: [...chars].map(([id, c]) => ({ id, name: c.name, mapId: c.mapId, running: c.running, baseLv: 10, job: 'novice' })) }, invites: [], own: [...chars].map(([id, c]) => ({ id, name: c.name, partyId: 9, running: c.running, vending: false, mapId: c.mapId })) });
  m = p.match(/^\/api\/characters\/(\d+)\/commands$/);
  if (m && method === 'POST') {
    const id = +m[1], c = chars.get(id); const body = JSON.parse(init.body); const cmd = body.command;
    posts.push({ id, cmd, headers: init.headers || {}, credentials: init.credentials, uuid: body.commandId });
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
  const cur = () => draft ?? snap.config;
  const sameSet = (a, b) => { const x = new Set(a ?? []), y = new Set(b ?? []); return x.size === y.size && [...x].every((v) => y.has(v)); };
  const pickMap = (id) => setDraft({ ...cur(), lockMap: id }); // 遊戲 y({lockMap}) = {...p, lockMap}
  const revert = async () => { setDraft(null); await wait(500); };
  const press = async (rx) => { status0.textContent = ''; btn.click(); return until(() => rx.test(status0.textContent) && status0.textContent, 3000); };
  const SYNC07 = [101, 201, 202];
  // (a) 乾淨面板
  await wait(300);
  let st = await press(/都在這張地圖/);
  check(!!st && posts.length === 0, `(a) 乾淨面板 → ${st}`);
  // (b) 選 07（同步改 rarePickup）＋ 改 autoResumeAfterDeath → 只因 autoResumeAfterDeath 拒絕
  pickMap('prt_fild07');
  const synced = await until(() => sameSet(cur().rarePickup, SYNC07), 3000);
  check(!!synced, `選地圖後「隨地圖同步」把 rarePickup 換成 07 的掉落（${JSON.stringify(cur().rarePickup)}）`);
  setDraft({ ...cur(), autoResumeAfterDeath: true });
  w.localStorage.setItem('roi-debug', '1'); debugs.length = 0;
  st = await press(/其他未套用的修改/);
  w.localStorage.removeItem('roi-debug');
  const dl = debugs.find((x) => /草稿差異/.test(x)) || '';
  check(/"key":"rarePickup","before":"array\(2\)","after":"array\(3\)"/.test(dl) && /"key":"autoResumeAfterDeath","before":"false","after":"true"/.test(dl) && /"added":2,"removed":1/.test(dl) && !/101|201|202/.test(dl.replace(/"(?:added|removed|syncNet)":\d+/g, '')), `debug 印出差異鍵的形狀（不含道具內容）：${dl.slice(0, 260)}`);
  check(/autoResumeAfterDeath/.test(st) && !/rarePickup/.test(st) && posts.length === 0, `(b) 真的手動修改仍拒絕，只列手動的鍵（${st}）`);
  // 手動取消一個同步沒動過的道具（101 兩張圖都有）→ rarePickup 拒絕
  await revert(); pickMap('prt_fild07'); await until(() => sameSet(cur().rarePickup, SYNC07), 3000);
  rareLabels.get(101).firstChild.click(); await wait(50);
  st = await press(/其他未套用的修改/);
  check(/rarePickup/.test(st) && posts.length === 0, `同步之後再手動取消勾選 → 拒絕（${st}）`);
  // 不是我們同步造成的 rarePickup 變動（例如遊戲或其他腳本直接改草稿）→ 無法分辨，拒絕
  await revert(); setDraft({ ...cur(), lockMap: 'prt_fild07', rarePickup: SYNC07 }); await wait(400);
  st = await press(/其他未套用的修改/);
  check(/rarePickup/.test(st) && posts.length === 0, `來源不明的 rarePickup 變動（非同步記錄）→ 拒絕（${st}）`);
  // 正規化：鍵順序不同、陣列順序不同、多出 undefined 欄位 → 不算修改
  await revert();
  const c0 = snap.config; const shuffled = Object.fromEntries(Object.keys(c0).reverse().map((k) => [k, c0[k]]));
  setDraft({ ...shuffled, rarePickup: [...c0.rarePickup].reverse(), autoLoot: { ...c0.autoLoot }, extraField: undefined }); await wait(300);
  st = await press(/都在這張地圖|其他未套用/);
  check(/都在這張地圖/.test(st), `正規化後沒有差異（${st}）`);
  // (c) 還原後只選 07 → 允許，確認視窗說明必撿稀有掉落會一起更新
  await revert(); pickMap('prt_fild07');
  check(!!await until(() => sameSet(cur().rarePickup, SYNC07), 3000), '(c) 只選 07，同步完成');
  btn.click();
  const dlg = await until(() => doc.querySelector('[data-roi-party-move-dialog]'), 3000);
  check(!!dlg && /Tofu2/.test(dlg.textContent) && /普隆德拉原野 08（prt_fild08） → 普隆德拉原野 07（prt_fild07）/.test(dlg.textContent) && /套用設定/.test(dlg.textContent) && /必撿稀有掉落已隨地圖同步更新（新增 2、取消 1 項）/.test(dlg.textContent), `(c) 確認視窗列出隊員地圖 → 目標，提示會先套用，且說明必撿稀有掉落一起更新｜${dlg?.textContent.slice(0, 300)}`);
  check(posts.length === 0, '確認前沒有送出任何指令');
  if (!dlg) { console.log(`狀態列：${doc.querySelector('[data-roi-party-move-status]')?.textContent}`); console.log('SOME FAIL'); process.exit(0); }
  [...dlg.querySelectorAll('button')].find((b) => b.textContent === '確定移動').click();
  const status = doc.querySelector('[data-roi-party-move-status]');
  const sawWait = await until(() => /打完這場/.test(status.textContent) && status.textContent, 4000);
  check(!!sawWait, `等待期間狀態列顯示（${sawWait}）`);
  check(!doc.querySelector('[data-roi-party-move-cancel]').hidden, '進行中顯示取消按鈕');
  const done = await until(() => /全隊移動/.test(status.textContent) && status.textContent, 15000);
  clearInterval(traffic);
  check(done === '🎉 全隊移動完成', `完成（${done}）｜${doc.querySelector('[data-roi-party-move-result]').textContent}`);
  check(log.join(' ') === '1:updateConfig>undefined 1:stop 2:stop 3:stop 1:start 2:selectMap>prt_fild07 2:start 3:selectMap>prt_fild07 3:start'.replace('>undefined', ''), `指令順序：${log.join(' ')}`);
  const own = posts.filter((p) => p.uuid !== 'native');
  check(own.every((p) => p.headers['x-ro-client'] === '1' && p.headers['content-type'] === 'application/json' && p.credentials === 'same-origin' && /^[0-9a-f-]{36}$/.test(p.uuid)), '腳本送出的指令與遊戲相同：同源 cookie、x-ro-client、UUID commandId');
  check(new Set(own.map((p) => p.uuid)).size === own.length, '每個指令的 commandId 都不同');
  check([...chars.values()].every((c) => c.running && c.mapId === 'prt_fild07'), '三隻都在 prt_fild07 掛機');
  const upd = posts.find((p) => p.cmd.type === 'updateConfig');
  check(upd && upd.cmd.config.lockMap === 'prt_fild07' && sameSet(upd.cmd.config.rarePickup, SYNC07) && upd.cmd.config.autoResumeAfterDeath === false, '套用設定送出的草稿：地圖 + 同步後的必撿稀有掉落，其他不變');
  check(errors.length === 0, `沒有未捕捉的錯誤（${errors[0] || '無'}）`);
  // 草稿還有其他修改 → 拒絕，不送任何指令
  check(draft === null && applyBtn.disabled && snap.config.lockMap === 'prt_fild07', '原生套用後面板回到乾淨狀態（草稿 null、套用鈕停用）');
  const reset = () => { status.textContent = ''; };
  // 草稿還有其他修改 → 拒絕，不送任何指令
  setDraft({ ...snap.config, autoLoot: { on: false }, lockMap: 'prt_fild08' }); let before = posts.length; reset();
  btn.click(); await until(() => /其他未套用的修改/.test(status.textContent), 3000);
  check(/autoLoot/.test(status.textContent) && posts.length === before && !doc.querySelector('[data-roi-party-move-dialog]'), `草稿有其他修改時拒絕（${status.textContent}）`);
  // 後備：讀不到分頁容器的 draft（只剩地圖選單 value）
  const savedTabs = tabs.memoizedProps; const stripDraft = () => { tabs.memoizedProps = { on: true, advanced: false }; rf.memoizedProps = { snap }; };
  setDraft({ ...snap.config, lockMap: 'prt_fild08' }); stripDraft(); before = posts.length; reset(); warns.length = 0;
  btn.click(); await until(() => /讀不到完整草稿/.test(status.textContent), 3000);
  check(posts.length === before && !doc.querySelector('[data-roi-party-move-dialog]') && warns.some((x) => x.startsWith('[ROI party-move]')), `後備：有未套用修改又讀不到草稿 → 拒絕並留一筆 [ROI party-move] 警告（${status.textContent}）`);
  // 後備：面板乾淨（套用鈕停用）→ 選單 value 就是已套用的地圖，可以繼續（不需套用）
  setDraft(null); stripDraft(); reset(); Object.assign(chars.get(3), { mapId: 'prt_fild08', lockMap: 'prt_fild08' });
  btn.click(); const dlg2 = await until(() => doc.querySelector('[data-roi-party-move-dialog]'), 3000);
  check(!!dlg2 && /prt_fild07/.test(dlg2.textContent), `後備：乾淨面板只靠選單 value 也能開確認視窗（${dlg2 ? 'dialog' : status.textContent}）`);
  if (dlg2) [...dlg2.querySelectorAll('button')].find((b) => /取消/.test(b.textContent))?.click();
  await wait(50); tabs.memoizedProps = savedTabs;
  // 完全讀不到地圖 → 一筆 [ROI party-move] 警告，內容是診斷資訊
  const savedAc = ac.memoizedProps; ac.memoizedProps = { label: '別的' }; stripDraft(); for (const b of group.querySelectorAll('button')) b.setAttribute('aria-pressed', 'false');
  reset(); warns.length = 0; before = posts.length;
  btn.click(); await until(() => /讀不到/.test(status.textContent), 3000);
  const w1 = warns.filter((x) => x.startsWith('[ROI party-move]'));
  check(w1.length === 1 && /applyButtons/.test(w1[0]) && posts.length === before, `讀不到地圖時只留一筆診斷警告：${(w1[0] || '').slice(0, 160)}`);
  ac.memoizedProps = savedAc;
  console.log(fail ? 'SOME FAIL' : 'ALL PASS'); process.exit(0);
})();
