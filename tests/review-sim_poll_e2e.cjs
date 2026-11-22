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
function make({ roster }) {
  let now = 1_700_000_000_000; const store = {}; const alerts = []; let fetches = 0;
  const env = {
    state: { chars: [], charAlerts: {}, charZenyMap: {}, initZenyMap: {}, myCharIds: new Set(), activeCharId: 1, hudMin: false, charRosterLoaded: false },
    document: { hidden: false, getElementById: () => null, hasFocus: () => true }, renderChars() {}, updateHUD() {},
    alertUser: (t, m) => alerts.push(m), refSelected: new Set(), clearQueuedCharacterLogs() {}, location: { origin: '' },
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
  return { api, env, store, alerts, get fetches() { return fetches; }, advance: ms => { now += ms; }, set: v => { now = v; }, now: () => now };
}
let ok = true; const check = (l, c) => { console.log((c ? 'PASS ' : 'FAIL ') + l); ok &&= c; };
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
  console.log(ok ? 'ALL PASS' : 'SOME FAIL');
})();
