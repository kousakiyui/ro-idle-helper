const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');

const source = fs.readFileSync(process.argv[2], 'utf8');
const runner = 'applyOwnMap: (target, send) => partyApplyMvpMap(me, target, send)';
assert.ok(source.includes(runner), '找不到 MVP 使用的移動流程');
const script = source.replace(runner, runner + ', limits: { stopWaitMs: 280, verifyMs: 180, minGapMs: 5, heartbeatMs: 12, retryMs: 15, catchupMs: 80 }')
  .replace(/\}\)\(\);\s*$/, 'page.roiTestTravel = { state, setActor(id) { state.activeCharId = id; } };\n})();');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const target = 'moc_pryd04';

function fixture(options) {
  const dom = new JSDOM('<!doctype html><body><div id="root"></div></body>', {
    url: 'https://ro-idle.app/', pretendToBeVisual: true, runScripts: 'outside-only'
  });
  const w = dom.window, d = w.document;
  const observers = new Set();
  w.MutationObserver = class extends w.MutationObserver {
    constructor(callback) { super(callback); observers.add(this); }
  };
  const errors = [];
  w.addEventListener('error', (event) => errors.push(event.message));
  w.Element.prototype.getClientRects = function () { return this.closest('[hidden]') ? [] : [{ width: 1, height: 1 }]; };
  const players = [
    { id: 1, name: '隊長', mapId: 'prt_fild01', running: true },
    { id: 2, name: '隊員甲', mapId: 'prt_fild01', running: true },
    { id: 3, name: '隊員乙', mapId: 'pay_fild01', running: false }
  ];
  if (options.arrived) for (const player of players) { player.mapId = target; player.running = true; }
  const own = () => players.filter(p => p.id !== (options.foreign ? 3 : 1))
    .map(p => ({ id: p.id, partyId: 19, vending: options.vending && p.id === 3 }));
  const sent = [], ids = new Set(), pending = new Map();
  let inFlight = 0, cutoff;
  const res = (status, body) => ({ ok: status < 400, status, text: async () => JSON.stringify(body), json: async () => body });
  Object.assign(w, {
    unsafeWindow: w, GM_getValue: (_, val) => val, GM_setValue() {}, GM_addValueChangeListener() {}, GM_notification() {},
    ResizeObserver: class { observe() {} disconnect() {} },
    IntersectionObserver: class { observe() {} unobserve() {} disconnect() {} }
  });
  const checks = [];
  let commandRevision = 4;
  let config = { lockMap: players[0].mapId, rarePickup: [9], autoStorage: { enabled: true, items: [2] } };
  let catchup = options.catchup ?? 0;
  w.fetch = async (url, init = {}) => {
    const path = new URL(String(url), w.location.href).pathname;
    if (path === '/api/characters') return res(200, { characters: players.filter(p => !options.foreign || p.id !== 3) });
    if (path === '/api/characters/1/party') {
      for (const [id, deadline] of pending) {
        if (Date.now() >= deadline) {
          players.find(p => p.id === id).running = false;
          pending.delete(id);
        }
      }
      const members = players.filter(p => !options.leftParty || sent.length === 0 || p.id !== 3);
      return res(200, { party: { id: 19, members }, own: own() });
    }
    const match = path.match(/^\/api\/characters\/(\d+)(\/commands)?$/);
    if (!match) return res(404, {});
    const player = players.find(p => p.id === Number(match[1]));
    if (!match[2]) return res(200, { characterId: player.id, running: player.running, commandRevision, snapshot: { character: { name: player.name, zeny: 10 }, mapId: player.mapId, vend: false, config } });
    const { command, commandId, expectedCommandRevision } = JSON.parse(init.body);
    checks.push(init.method === 'POST' && init.credentials === 'same-origin' && !ids.has(commandId));
    ids.add(commandId);
    inFlight++;
    checks.push(inFlight === 1);
    try {
      sent.push([player.id, command.type, command.mapId]);
      await pause(1);
      if (options.switchActor && sent.length === 1) w.roiTestTravel.setActor(2);
      if (command.type === 'stop') {
        pending.set(player.id, Date.now() + (player.id === 1 ? 16 : 35));
      }
      if (command.type === 'updateConfig') {
        checks.push(players.every(p => !p.running) && player.id === 1 && expectedCommandRevision === commandRevision);
        checks.push(JSON.stringify(command.config) === JSON.stringify({ ...config, lockMap: target }));
        if (options.applyIgnored) return res(200, { ok: true });
        config = command.config;
        commandRevision++;
      }
      if (command.type === 'selectMap') {
        checks.push(!player.running && config.lockMap === target && command.mapId === target);
        if (options.rateLimit && player.id === 2) {
          cutoff = sent.length;
          return res(429, { error: { code: 'RATE_LIMITED', message: '請求太頻繁' } });
        }
        if (!(options.ignored && player.id === 3)) player.mapId = command.mapId;
      }
      if (command.type === 'start') {
        checks.push(config.lockMap === target && (player.id === 1 || player.mapId === target));
        if (player.id === 2 && catchup-- > 0) {
          return res(409, { error: { code: 'BUSY_CATCHING_UP', message: '等待補算' } });
        }
        if (player.id === 1) player.mapId = config.lockMap;
        player.running = true;
        if (options.wrongAfterStart && player.id === 3) player.mapId = 'prt_fild01';
      }
      return res(200, { ok: true });
    } finally { inFlight--; }
  };
  w.eval(script);
  const state = w.roiTestTravel.state;
  state.activeCharId = 1;
  state.myCharIds = new w.Set(options.foreign ? [1, 2] : [1, 2, 3]);
  d.querySelector('#roi-helper-mvp-open').click();
  const panel = d.querySelector('#roi-helper-mvp-panel');
  const button = panel.querySelector('button[title="全隊前往 moc_pryd04"]');
  assert.ok(button, 'MVP 地圖按鈕不存在');
  const travel = panel.querySelector('section:has(button[hidden]) [role="status"]')?.parentElement;
  assert.ok(travel, 'MVP 移動狀態列不存在');
  return {
    async clickAndWait() {
      button.click();
      button.click();
      if (options.cancel) {
        for (let i = 0; i < 60 && !sent.some(([, type]) => type === 'updateConfig'); i++) await pause(2);
        travel.querySelector('button').click();
      }
      const status = travel.querySelector('[role="status"]');
      for (let i = 0; i < 140 && !/^(全隊已抵達|全隊移動未完成|無法全隊移動)/.test(status.textContent); i++) await pause(5);
      assert.match(status.textContent, /^(全隊已抵達|全隊移動未完成|無法全隊移動)/);
      assert.ok(travel.querySelector('button').hidden, '流程結束後已收起取消按鈕');
      assert.deepEqual(errors, []);
      assert.ok(checks.every(Boolean), '請求順序、節流或目標不符');
      return { text: travel.textContent, sent, players, cutoff };
    },
    async close() {
      await pause(10);
      w.dispatchEvent(new w.Event('pagehide'));
      for (const observer of observers) observer.disconnect();
      w.close();
    }
  };
}

async function scenario(options, label, verify) {
  const sim = fixture(options);
  try { verify(await sim.clickAndWait()); console.log('PASS ' + label); }
  finally { await sim.close(); }
}
(async () => {
  await scenario({}, '點 MVP 地圖一次，三名隊員都停止、換圖並在指定地圖開始掛機', r => {
    assert.match(r.text, /全隊已抵達/);
    assert.deepEqual(r.sent.map(([id, type]) => id + ':' + type), [
      '1:stop', '2:stop', '1:updateConfig', '1:start', '2:selectMap', '2:start', '3:selectMap', '3:start'
    ]);
    assert.ok(r.players.every(p => p.mapId === target && p.running));
  });
  await scenario({ arrived: true }, '全隊已在指定圖掛機時只確認狀態，不重送任何指令', r => {
    assert.match(r.text, /全隊已抵達/);
    assert.equal(r.sent.length, 0);
  });
  await scenario({ cancel: true }, '送出套用後取消，停止後續指令', r => {
    assert.match(r.text, /全隊移動未完成.*已取消/);
    assert.equal(r.sent.some(([, type]) => type === 'start'), false);
  });
  for (const [key, label] of [['foreign', '隊伍有其他帳號角色'], ['vending', '有隊員擺攤']]) {
    await scenario({ [key]: true }, label + '時全隊不動', r => {
      assert.match(r.text, /無法全隊移動/);
      assert.equal(r.sent.length, 0);
    });
  }
  await scenario({ ignored: true }, '換圖回成功但有隊員未抵達，該隊員不會開始掛機', r => {
    assert.match(r.text, /全隊移動未完成.*等待確認抵達：隊員乙/);
    assert.equal(r.sent.some(([id, type]) => id === 3 && type === 'start'), false);
  });
  await scenario({ applyIgnored: true }, '套用掛機地圖未入帳，不送出任何啟動', r => {
    assert.match(r.text, /伺服器尚未確認套用掛機地圖/);
    assert.ok(r.sent.every(([, type]) => type === 'stop' || type === 'updateConfig'));
  });
  await scenario({ catchup: 2 }, '補算明確拒絕兩次後重試，最後三名都到目標圖掛機', r => {
    assert.match(r.text, /全隊已抵達/);
    assert.equal(r.sent.filter(([id, type]) => id === 2 && type === 'start').length, 3);
    assert.ok(r.players.every(p => p.mapId === target && p.running));
  });
  await scenario({ catchup: 100 }, '補算長時間未完成會停止並顯示卡住的隊員', r => {
    assert.match(r.text, /隊員甲：等待補算逾時/);
    assert.equal(r.sent.some(([id, type]) => id === 3 && type === 'start'), false);
  });
  await scenario({ wrongAfterStart: true }, '有隊員開始後回舊圖，逐人驗證不會報全隊完成', r => {
    assert.match(r.text, /全隊移動未完成.*⚠️ 隊員乙：prt_fild01/);
  });
  await scenario({ rateLimit: true }, '換圖遭限流後不再送指令', r => {
    assert.match(r.text, /全隊移動未完成.*請求太頻繁/);
    assert.equal(r.sent.length, r.cutoff);
  });
  await scenario({ switchActor: true }, '換角停止後續操作', r => {
    assert.match(r.text, /全隊移動未完成.*角色已切換/);
    assert.equal(r.sent.length, 1);
  });
  await scenario({ leftParty: true }, '隊員離隊後不再換圖或重新開始', r => {
    assert.match(r.text, /全隊移動未完成.*隊伍名單/);
    assert.ok(r.sent.every(([, type]) => type === 'stop'));
  });
})().catch(e => { console.error(e); process.exitCode = 1; });
