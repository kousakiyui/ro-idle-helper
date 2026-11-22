// 全隊移動核心：假伺服器重現「停止要等那場打完」、selectMap 對掛機中角色無效、限流與錯誤
const fs = require('fs');
const file = process.argv[2]; const src = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
if (!src.includes('function createPartyMoveRunner(')) { console.log('SKIP 此版本沒有全隊移動功能'); process.exit(0); }
const slice = (head) => { const i = src.indexOf(head); if (i < 0) throw Error('找不到 ' + head); const j = src.indexOf('\n  }\n', i); return src.slice(i, j + 4); };
const constLine = (name) => src.split('\n').find((l) => l.includes(`const ${name} =`));
const isPlainRecord = (v) => v !== null && typeof v === 'object' && !Array.isArray(v) && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);
const api = new Function('isPlainRecord', [constLine('partyMapIdRx'), slice('  class PartyMoveError'), slice('  function validatePartyView('), slice('  function planPartyMove('), slice('  function createPartyMoveRunner('),
  'return { PartyMoveError, validatePartyView, planPartyMove, createPartyMoveRunner };'].join('\n'))(isPlainRecord);
const { PartyMoveError, validatePartyView, planPartyMove, createPartyMoveRunner } = api;
let fail = 0; const check = (ok, m) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${m}`); if (!ok) fail++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function makeServer(opt = {}) {
  const chars = new Map([
    [1, { name: 'Tofu6', mapId: 'prt_fild08', lockMap: 'prt_fild08', running: true, fight: 3 }],
    [2, { name: 'Tofu2', mapId: 'prt_fild08', lockMap: 'prt_fild08', running: true, fight: 6 }],
    [3, { name: 'Tofu3', mapId: 'pay_fild01', lockMap: 'pay_fild01', running: false, fight: 0 }],
    [4, { name: '商人', mapId: 'prontera', lockMap: 'prontera', running: true, fight: 0, vending: true }],
    [7, { name: '別人', mapId: 'prt_fild08', lockMap: 'prt_fild08', running: true, fight: 0 }],
  ]);
  const s = { chars, log: [], partyCalls: 0, inflight: 0, maxInflight: 0, kicks: new EventTarget(), startedBeforeStopped: false, ...opt };
  s.tick = () => {
    for (const c of chars.values()) if (c.pendingStop && --c.fightLeft <= 0) { c.running = false; c.pendingStop = false; }
    if (!s.noKicks) s.kicks.dispatchEvent(new Event('settled'));
  };
  s.listeners = 0; const add = s.kicks.addEventListener.bind(s.kicks), rem = s.kicks.removeEventListener.bind(s.kicks);
  s.kicks.addEventListener = (...a) => { s.listeners++; add(...a); }; s.kicks.removeEventListener = (...a) => { s.listeners--; rem(...a); };
  s.timer = setInterval(s.tick, 20);
  s.getParty = async () => {
    s.partyCalls++; await sleep(2);
    if (s.partyFail) throw new PartyMoveError(s.partyFail.msg, s.partyFail.status, s.partyFail.code);
    return validatePartyView(JSON.parse(JSON.stringify({
      party: { id: 9, leaderId: 2, members: [...chars].map(([id, c]) => ({ id, name: c.name, mapId: c.mapId, running: c.running, baseLv: 10, job: 'novice' })) },
      own: [...chars].filter(([id]) => id !== 7).map(([id, c]) => ({ id, partyId: 9, running: c.running, vending: !!c.vending, mapId: c.mapId })),
    })));
  };
  s.command = async (id, cmd) => {
    s.inflight++; s.maxInflight = Math.max(s.maxInflight, s.inflight);
    try {
      await sleep(5);
      s.log.push(`${id}:${cmd.type}${cmd.mapId ? '>' + cmd.mapId : ''}`);
      const err = s.failOn?.(id, cmd); if (err) throw new PartyMoveError(err.msg, err.status, err.code);
      const c = chars.get(id);
      if (cmd.type === 'stop') { if (c.running) { c.pendingStop = true; c.fightLeft = c.fight; if (c.fight === 0) c.running = false; } }
      if (cmd.type === 'selectMap') { if (!c.running) { c.mapId = cmd.mapId; c.lockMap = cmd.mapId; } }
      if (cmd.type === 'start') {
        if ([...chars.values()].some((x) => x.pendingStop && x !== c && s.log.some((l) => l.endsWith(':stop')))) s.startedBeforeStopped = true;
        c.pendingStop = false; c.running = true; c.mapId = c.lockMap;
      }
      return { ok: true, view: { running: c.running } };
    } finally { s.inflight--; }
  };
  s.applyOwnMap = async (target) => { if (s.applyFail) throw new PartyMoveError(s.applyFail); chars.get(1).lockMap = target; s.log.push(`1:apply>${target}`); };
  s.close = () => clearInterval(s.timer);
  return s;
}
const limits = { stopWaitMs: 1500, verifyMs: 600, minGapMs: 30, heartbeatMs: 80 };
const runner = (s, extra = {}) => { const statuses = []; const r = createPartyMoveRunner({ getParty: s.getParty, command: s.command, applyOwnMap: s.applyOwnMap, kicks: s.kicks, onStatus: (t) => statuses.push(t), limits: { ...limits, ...extra } }); r.statuses = statuses; return r; };
const roster = new Set([1, 2, 3, 4]);

(async () => {
  // 1. 規劃
  { const s = makeServer(); const plan = planPartyMove(await s.getParty(), 1, 'pay_fild01', roster); s.close();
    check(plan.stopIds.join() === '1,2', `只停同隊、在掛機、非擺攤的自己角色（${plan.stopIds}）`);
    check(plan.movers.map((r) => r.id).join() === '1,2,3', `移動對象：自己＋Tofu2＋Tofu3（${plan.movers.map((r) => r.id)}）`);
    check(plan.rows.find((r) => r.id === 4).move === false && plan.rows.find((r) => r.id === 7).move === false, '擺攤中（4）與非本帳號（7）只列出、不動');
    let t = ''; try { planPartyMove(await makeServer().getParty(), 1, '../x', roster); } catch (e) { t = e.message; } check(/有效的地圖/.test(t), '地圖編號不合法 → 拒絕');
    t = ''; try { planPartyMove(await makeServer().getParty(), 1, 'pay_fild01', new Set([2, 3])); } catch (e) { t = e.message; } check(/本帳號/.test(t), '目前角色不在本帳號名單 → 拒絕'); }
  // 2. 正常流程：停止要等那場打完，等到全部停了才換圖與開始
  { const s = makeServer(); const r = runner(s); const plan = planPartyMove(await s.getParty(), 1, 'pay_fild01', roster);
    const res = await r.run(plan); s.close();
    check(res.ok, `正常完成（${res.lines.join(' / ')}）`);
    check(s.log.join(' ') === '1:apply>pay_fild01 1:stop 2:stop 1:start 2:selectMap>pay_fild01 2:start 3:start', `指令順序：${s.log.join(' ')}`);
    check(!s.startedBeforeStopped, '在任何角色還沒真正停下前，不送開始／換圖');
    check(s.maxInflight === 1, `指令逐一送出，同時最多 ${s.maxInflight} 個`);
    check(r.statuses.some((t) => /等待 .*Tofu2.* 打完這場/.test(t)), `等待期間顯示還在等誰（例：${r.statuses.find((t) => t.startsWith('等待'))}）`);
    check([1, 2, 3].every((id) => s.chars.get(id).mapId === 'pay_fild01' && s.chars.get(id).running), '三隻都在目標地圖掛機');
    check(s.chars.get(4).mapId === 'prontera' && s.chars.get(7).mapId === 'prt_fild08', '擺攤與非本帳號角色沒被動到');
    check(s.listeners === 0, `結束後事件監聽全部移除（剩 ${s.listeners}）`); }
  // 3. 沒有任何遊戲事件時，靠心跳補抓仍會完成；重抓有最小間隔
  { const s = makeServer({ noKicks: true }); const r = runner(s); const res = await r.run(planPartyMove(await s.getParty(), 1, 'pay_fild01', roster)); s.close();
    check(res.ok, `沒有事件也能靠心跳完成（隊伍讀取 ${s.partyCalls} 次）`); }
  { const s = makeServer(); const r = runner(s, { minGapMs: 200 }); const t0 = Date.now(); await r.run(planPartyMove(await s.getParty(), 1, 'pay_fild01', roster)); s.close();
    const secs = (Date.now() - t0) / 1000;
    check(s.partyCalls <= Math.ceil(secs / 0.2) + 6, `每 20ms 一個事件，但隊伍資料只抓 ${s.partyCalls} 次（${secs.toFixed(1)} 秒，最小間隔 200ms）`); }
  // 4. 停止一直沒生效 → 逾時，原本在掛機的恢復開始
  { const s = makeServer(); s.chars.get(2).fight = 1e9; const r = runner(s, { stopWaitMs: 400 }); const res = await r.run(planPartyMove(await s.getParty(), 1, 'pay_fild01', roster)); s.close();
    check(!res.ok && /逾時/.test(res.lines[0]) && /Tofu2/.test(res.lines[0]), `逾時訊息列出還在打的角色（${res.lines[0]}）`);
    check(s.log.slice(-2).join() === '1:start,2:start' && !s.log.some((l) => l.includes('selectMap')), `逾時後不換圖，只恢復 1、2 掛機（${s.log.join(' ')}）`); }
  // 5. 限流 → 立刻停止，不再送任何指令
  { const s = makeServer({ failOn: (id, c) => c.type === 'selectMap' ? { msg: '操作太頻繁，請稍等一下再試。', status: 429, code: 'RATE_LIMITED' } : null });
    const r = runner(s); const res = await r.run(planPartyMove(await s.getParty(), 1, 'pay_fild01', roster)); s.close();
    const after = s.log.slice(s.log.indexOf('2:selectMap>pay_fild01') + 1);
    check(!res.ok && after.length === 0, `RATE_LIMITED 後不再送指令（之後送出 ${after.length} 個）`);
    check(res.lines.some((l) => /Tofu2.*請稍後手動開始/.test(l)), `明細提示 Tofu2 需手動開始`); }
  // 6. 停止時伺服器回 500 → 中止並恢復已停的角色
  { const s = makeServer({ failOn: (id, c) => id === 2 && c.type === 'stop' ? { msg: '請求失敗（HTTP 500）', status: 500, code: 'HTTP_500' } : null });
    const r = runner(s); const res = await r.run(planPartyMove(await s.getParty(), 1, 'pay_fild01', roster)); s.close();
    check(!res.ok && /Tofu2：請求失敗/.test(res.lines[0]) && s.log.at(-1) === '1:start', `非 2xx → 停止並恢復已停的自己（${s.log.join(' ')}）`); }
  // 7. 套用自己地圖失敗 → 什麼指令都不送
  { const s = makeServer({ applyFail: '套用設定逾時' }); const r = runner(s); const res = await r.run(planPartyMove(await s.getParty(), 1, 'pay_fild01', roster)); s.close();
    check(!res.ok && s.log.length === 0, '套用地圖失敗 → 沒有停止任何角色'); }
  // 8. 等待中取消 → 恢復掛機
  { const s = makeServer(); s.chars.get(2).fight = 1e9; const r = runner(s); const p = r.run(planPartyMove(await s.getParty(), 1, 'pay_fild01', roster));
    await sleep(150); r.cancel(); const res = await p; s.close();
    check(!res.ok && res.lines[0].includes('已取消') && s.log.slice(-2).join() === '1:start,2:start', `取消後恢復 1、2（${s.log.join(' ')}）`);
    const calls = s.partyCalls; await sleep(300);
    check(s.listeners === 0 && s.partyCalls === calls, `取消後監聽與心跳計時器都已清除（剩 ${s.listeners} 個監聽，之後又讀取 ${s.partyCalls - calls} 次）`); }
  // 9. 驗證：伺服器把一隻留在舊圖 → 明細標示 ⚠️
  { const s = makeServer(); const orig = s.command; s.command = async (id, c) => { const r = await orig(id, c); if (id === 3 && c.type === 'start') s.chars.get(3).mapId = 'pay_fild02'; return r; };
    const r = runner(s); const res = await r.run(planPartyMove(await s.getParty(), 1, 'pay_fild01', roster)); s.close();
    check(!res.ok && res.lines.some((l) => l.startsWith('⚠️ Tofu3：pay_fild02')), `驗證不符時列出（${res.lines.find((l) => l.includes('Tofu3'))}）`); }
  // 10. 資料驗證
  { let bad = 0; for (const v of [null, [], { party: { id: 1, members: [{ id: 1, name: 'x', running: 'yes', mapId: 'a' }] } }, { party: { id: 1, members: [{ id: 1, name: 'x', running: true, mapId: '../a' }] } }]) { try { validatePartyView(v); } catch { bad++; } }
    check(bad === 4, `格式不符的隊伍資料全部拒絕（${bad}/4）`);
    check(validatePartyView({ party: null }).party === null, '沒有隊伍 → party 為 null'); }
  console.log(fail ? 'SOME FAIL' : 'ALL PASS'); process.exit(0);
})();
