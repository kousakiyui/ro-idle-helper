// 角色輪詢端到端模擬（切片 onApiData / pollChars 等實際函式）：A 舊快取基準、B 合理基準、C 原生名單被舊快取覆蓋、D 輪詢週期。
const fs = require('fs'); const src = fs.readFileSync(process.argv[2], 'utf8');
function slice(name) { // 以縮排配對結尾，避免字串中的大括號（如 '{'）干擾
  const m = new RegExp('^( *)(?:async )?function ' + name + '\\(', 'm').exec(src); if (!m) throw Error(name);
  const end = src.indexOf('\n' + m[1] + '}', m.index); return src.slice(m.index, end + m[1].length + 2); }
const names = ['onApiData','applyCharRoster','validateCharPoll','readSharedCharPoll','matchesCharAccount','applySharedCharPoll','applyPollZeny','fetchCharPoll','pollChars','recordCharAlert'];
const hasConst = /const charPollReuseMs/.test(src);
const prelude = `
  const charPollKey = 'roi-char-poll-v1';
  const canShareCharPoll = () => typeof navigator.locks?.request === 'function' && typeof GM_addValueChangeListener === 'function';
  let nativeRosterIds = null, lastSharedCharPollAt = 0, polledRoster = false, charPollBusy = false, foregroundMvpSnapshot = null, refineIdentityEpoch = 0;
  const localZenyAt = new Map();
  ${hasConst ? 'const charPollInterval = 45000; const charPollReuseMs = charPollInterval - 5000;' : ''}
`;
function make({ roster, refining = false }) {
  let nativeActor = 1;
  let aborts = 0;
  let now = 1_700_000_000_000; const store = {}; const alerts = []; let fetches = 0;
  const env = {
    state: { chars: [], charAlerts: {}, charZenyMap: {}, initZenyMap: {}, myCharIds: new Set(), activeCharId: 1, hudMin: false, charRosterLoaded: false },
    document: { hidden: false, getElementById: () => null, hasFocus: () => true }, renderChars() {}, updateHUD() {},
    alertUser: (t, m) => alerts.push(m), refSelected: new Set(), clearQueuedCharacterLogs() {}, location: { origin: '' },
    refBusy: refining, readFiberForUi: read => read(), readBackpackContext: () => ({}),
    refineActor: () => nativeActor, combatHitMeter: { reset() {} },
    pageNet: { events: { dispatchEvent() { aborts++; } } },
    positiveId: v => (Number.isSafeInteger(Number(v)) && Number(v) > 0 ? Number(v) : null),
    isPlainRecord: v => v && typeof v === 'object' && !Array.isArray(v),
    GM_getValue: (k, d) => (k in store ? structuredClone(store[k]) : d), GM_setValue: (k, v) => { store[k] = structuredClone(v); },
    GM_addValueChangeListener() {}, localStorage: { getItem: () => null, setItem() {} }, globalThis: {},
    navigator: { locks: { request: async (n, o, cb) => { now += Math.floor(Math.random() * 4); return cb({}); } } },
    Date: { now: () => now },
    pollFetch: async (url) => { fetches++; now += 1;
      if (url === '/api/characters') return { ok: true, json: async () => ({ characters: roster() }) };
      const id = Number(url.match(/\d+/)[0]); return { ok: true, json: async () => ({ characterId: id, snapshot: { character: { zeny: 100 } } }) }; },
    console
  };
  const api = new Function(...Object.keys(env), prelude + names.map(slice).join('\n') + '\nreturn { onApiData, pollChars };')(...Object.values(env));
  return { api, env, store, alerts, setActor: id => { nativeActor = id; }, get aborts() { return aborts; }, get fetches() { return fetches; }, advance: ms => { now += ms; }, set: v => { now = v; }, now: () => now };
}
let ok = true; const check = (l, c) => { console.log((c ? 'PASS ' : 'FAIL ') + l); ok &&= c; };
async function refineEvents() {
  const { JSDOM } = require('jsdom');
  const assert = require('node:assert/strict');
  const dom = new JSDOM('<body><main></main></body>', { pretendToBeVisual: true });
  const w = dom.window;
  const root = w.document.querySelector('main');
  const document = w.document;
  const pageNet = { events: new w.EventTarget(), settled: 0, inFlight: 1 };
  const equipment = { uid: 7, itemId: 1201, refine: 3 };
  const materials = { uid: 8, itemId: 984, qty: 2 };
  const b = { s: { inventory: [equipment, materials], character: { zeny: 100, sp: 20 } } };
  const materialCount = (inventory, id) => inventory.find(item => item.itemId === id)?.qty || 0;
  const names = ['waitForUi', 'waitForRefineUi', 'assertRefineRun', 'waitForRefineResult', 'refineNoUpgradeSettled'];
  const env = {
    pageNet, document, MutationObserver: w.MutationObserver, materialCount,
    setTimeout: (callback, delay) => setTimeout(callback, Math.min(delay, 100)),
    assertRefineSession() {}, assertRefineTarget: () => b,
    refineIdentityEpoch: 0, state: { activeCharId: 1 }, refStop: false
  };
  const waitForResult = new Function(...Object.keys(env), names.map(slice).join('\n') +
    '\nreturn waitForRefineResult;')(...Object.values(env));
  const begin = (useSkill = false, commandWatch) => {
    equipment.refine = 3; materials.qty = 2; b.s.character.zeny = 100;
    b.s.inventory = [equipment, materials]; pageNet.inFlight = 1;
    return waitForResult({ characterId: 1, epoch: 0 }, 7, {
      root, curPlus: 3, material: 984, beforeMatQty: 2, beforeZeny: 100,
      beforeSp: 20, useSkill, commandWatch, settleGate: { since: pageNet.settled, candidate: null }
    });
  };
  const spend = () => { materials.qty--; b.s.character.zeny--; };
  const settle = () => { pageNet.inFlight = 0; pageNet.settled++; pageNet.events.dispatchEvent(new w.Event('settled')); };
  const commit = () => root.append(document.createTextNode('更新'));
  try {
    let result = begin();
    equipment.refine++; commit();
    check('精煉成功由背包提交喚醒', (await result).kind === 'success');

    result = begin();
    spend(); b.s.inventory = [materials]; settle();
    check('精煉損壞由網路回應喚醒', (await result).kind === 'broken');

    result = begin();
    spend(); settle(); await Promise.resolve();
    let finished = false;
    result.then(() => { finished = true; });
    await Promise.resolve();
    check('扣款後首讀不能完成未升階判定', !finished);
    commit();
    check('精煉未升階須等下一次訊號再確認', (await result).kind === 'failed');

    result = begin();
    spend(); settle(); await Promise.resolve();
    equipment.refine++; commit();
    check('第二次確認收到晚到的升階', (await result).kind === 'success');

    result = begin(true);
    materials.qty--; b.s.inventory = [materials]; settle(); await Promise.resolve();
    commit();
    check('神工匠 SP 已回復，扣礦和 UID 消失兩次確認後辨識損壞', (await result).kind === 'broken');

    result = begin(true);
    materials.qty--; settle(); await Promise.resolve(); commit();
    check('神工匠 SP 已回復，扣礦且精煉值持平可辨識未升階', (await result).kind === 'failed');

    result = begin(true);
    materials.qty--; settle(); await Promise.resolve(); equipment.refine++; commit();
    check('神工匠第二次讀取收到晚到的成功', (await result).kind === 'success');

    result = begin(true);
    settle(); commit();
    check('請求結束但未扣礦，維持結果不明', await result === null);

    result = begin(true);
    materials.qty--; b.s.inventory = [materials]; commit();
    check('扣礦和 UID 消失但請求未結束，維持結果不明', await result === null);

    const commandWatch = { commandId: '精練命令', pending: 1, settled: 0, status: 0 };
    result = begin(true, commandWatch);
    materials.qty--; b.s.inventory = [materials];
    commit(); await Promise.resolve();
    commandWatch.pending = 0; commandWatch.settled = 1; commandWatch.status = 200;
    pageNet.events.dispatchEvent(new w.Event('settled'));
    check('神工匠 SP 已回復且其他請求仍在進行，已確認扣礦及武器消失', (await result)?.kind === 'broken');

    result = begin(true, { commandId: '拒絕的命令', pending: 0, settled: 1, status: 429 });
    await assert.rejects(result, /HTTP 429/);
    check('神工匠遭限流時回報 429 並停止', true);

    result = begin();
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    document.dispatchEvent(new w.Event('visibilitychange'));
    await assert.rejects(result, /遊戲分頁已切到背景/);
    check('精煉中途切背景即中止並指出原因', true);
    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
    result = begin();
    env.state.activeCharId = 2;
    pageNet.events.dispatchEvent(new w.Event('ui-abort'));
    await assert.rejects(result, /偵測到角色切換/);
    check('實際切角時仍立刻中止並指出原因', true);
  } finally { w.close(); }
}

(async () => {
  console.log('==', require('path').basename(process.argv[2]));
  { // A
    const t = make({ roster: () => [{ id: 1, name: '甲', running: false }] });
    t.store['roi-char-poll-v1'] = { at: t.now() - 3 * 3600e3, characters: [{ id: 1, name: '甲', running: true }], zeny: {} };
    await t.api.pollChars();
    check(`A 重開頁面、共享快取為 3 小時前 → 不應發出停機通知（實得 ${t.alerts.length}）`, t.alerts.length === 0);
  }
  { // B
    const t = make({ roster: () => [{ id: 1, name: '甲', running: false }] });
    t.store['roi-char-poll-v1'] = { at: t.now() - 50e3, characters: [{ id: 1, name: '甲', running: true }], zeny: {} };
    await t.api.pollChars();
    check(`B 共享快取 50 秒前（接任）→ 應發出 1 次停機通知（實得 ${t.alerts.length}）`, t.alerts.length === 1);
  }
  { // C
    const t = make({ roster: () => [] });
    t.env.state.chars = [{ id: 1, name: '甲', running: true }]; t.env.state.myCharIds = new Set([1]); t.env.state.charRosterLoaded = true;
    t.store['roi-char-poll-v1'] = { at: t.now() - 20e3, characters: [{ id: 1, name: '甲', running: true }], zeny: {} };
    t.api.onApiData('/api/characters', JSON.stringify({ characters: [{ id: 1, name: '甲', running: false }] }));
    const ch = t.env.state.chars[0];
    check(`C 原生名單顯示停止後，不得被 20 秒前的共享快取改回掛機（running=${ch.running}，警示=${JSON.stringify(t.env.state.charAlerts[1]?.reason)}）`,
      ch.running === false && t.env.state.charAlerts[1]?.reason === '已停止掛機');
  }
  { // D
    const t = make({ roster: () => [{ id: 1, name: '甲', running: true }] });
    let tick = t.now(); await t.api.pollChars();
    let polls = 0;
    // setInterval 只會晚不會早（0–2ms），鎖授予延遲 0–3ms（見 navigator.locks 假件）
    for (let n = 0; n < 40; n++) { tick += 45000 + Math.floor(Math.random() * 3); t.set(tick); const before = t.fetches; await t.api.pollChars(); if (t.fetches > before) polls++; }
    check(`D 單頁 45 秒計時器 40 輪 → 實際發出名單請求 ${polls} 輪（應接近 40）`, polls >= 38);
  }
  {
    const t = make({ roster: () => [], refining: true });
    const detail = id => t.api.onApiData('/api/characters/' + id,
      JSON.stringify({ characterId: id, snapshot: { character: { zeny: 100 + id } } }));
    t.env.state.activeCharId = null;
    t.env.refSelected.add(41);
    detail(1);
    check('精煉途中首次收到同角色明細不取消工作階段', t.env.state.activeCharId === 1 && t.aborts === 0 && t.env.refSelected.has(41));
    detail(2);
    check('精煉途中收到其他角色明細只更新該角色餘額', t.env.state.activeCharId === 1 && t.env.state.charZenyMap[2] === 102 && t.aborts === 0 && t.env.refSelected.has(41));
    t.setActor(2);
    detail(2);
    check('原生背包確認切角時取消精煉工作階段', t.env.state.activeCharId === 2 && t.aborts === 1 && t.env.refSelected.size === 0);
  }
  await refineEvents();
  console.log(ok ? 'ALL PASS' : 'SOME FAIL');
  if (!ok) process.exitCode = 1;
})();
