
  let lastInteractionAt = -Infinity;
  // ===== 全隊（同帳號）移到此地圖 =====
  // 指令與遊戲相同：POST /api/characters/{id}/commands {commandId, command}，同源 cookie + x-ro-client 標頭。
  // 「停止」要等那一場打完才生效（10 秒～數分鐘），所以等待改由隊伍資料判定，不用固定時間。
  const partyMapIdRx = /^[a-z0-9_]{1,40}$/i;
  class PartyMoveError extends Error {
    constructor(message, status = 0, code = '') { super(message); this.status = status; this.code = code; }
  }
  function validatePartyView(value) {
    const id = (v) => Number.isSafeInteger(v) && v > 0;
    if (!isPlainRecord(value)) throw Error('隊伍資料格式不符');
    const party = value.party;
    if (party === null || party === undefined) return { party: null, own: [] };
    if (!isPlainRecord(party) || !id(party.id) || !Array.isArray(party.members) || party.members.length > 12) throw Error('隊伍資料格式不符');
    const members = party.members.map((m) => {
      if (!isPlainRecord(m) || !id(m.id) || typeof m.name !== 'string' || m.name.length > 40 || typeof m.running !== 'boolean' ||
          typeof m.mapId !== 'string' || !partyMapIdRx.test(m.mapId)) throw Error('隊員資料格式不符');
      return { id: m.id, name: m.name, mapId: m.mapId, running: m.running, baseLv: Number.isSafeInteger(m.baseLv) ? m.baseLv : null, job: typeof m.job === 'string' ? m.job.slice(0, 40) : '' };
    });
    const own = (Array.isArray(value.own) ? value.own : []).slice(0, 12).flatMap((o) => (
      isPlainRecord(o) && id(o.id) && (o.partyId === null || id(o.partyId)) ? [{ id: o.id, partyId: o.partyId, vending: o.vending === true }] : []));
    return { party: { id: party.id, leaderId: id(party.leaderId) ? party.leaderId : null, members }, own };
  }
  function planPartyMove(view, me, target) {
    if (!partyMapIdRx.test(target || '')) throw Error('沒有選擇有效的地圖');
    if (!view.party) throw Error('目前角色沒有隊伍');
    const own = new Map(view.own.filter((o) => o.partyId === view.party.id).map((o) => [o.id, o]));
    const meMember = view.party.members.find((m) => m.id === me);
    if (!meMember) throw Error('隊伍資料裡找不到目前角色');
    const rows = view.party.members.map((m) => {
      const self = m.id === me;
      const ours = self || own.has(m.id);
      const vending = ours && own.get(m.id)?.vending === true;
      return { ...m, self, ours, vending, move: ours && !vending };
    });
    const movers = rows.filter((r) => r.move);
    if (!movers.some((r) => r.self)) throw Error('目前角色擺攤中，無法移動');
    if (new Set(movers.map((r) => r.id)).size !== movers.length) throw Error('本帳號隊員名單有重複角色');
    return { me, target, rows, movers, partyId: view.party.id };
  }
  // deps：getParty()、command(id, cmd)、applyOwnMap(target)、kicks（EventTarget，遊戲有請求完成或戰鬥日誌時發 'settled'／'kick'）
  //       onStatus(text)、limits {stopWaitMs, verifyMs, minGapMs, heartbeatMs}
  function createPartyMoveRunner(deps) {
    const L = { stopWaitMs: 180000, verifyMs: 30000, minGapMs: 2500, heartbeatMs: 10000, catchupMs: 180000, retryMs: 5000, ...deps.limits };
    let cancelled = false;
    const names = new Map();
    let allowedIds = null;
    const label = (id) => names.get(id) || `#${id}`;
    const isRateLimit = (e) => e?.status === 429 || e?.code === 'RATE_LIMITED';
    let inFlight = 0, maxInFlight = 0;
    async function send(id, command, revision) {
      if (cancelled) throw new PartyMoveError('已取消');
      if (allowedIds && !allowedIds.has(id)) throw new PartyMoveError('角色不在本帳號的移動名單');
      deps.checkActor?.();
      inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
      try { return await deps.command(id, command, revision); }
      catch (e) { throw e instanceof PartyMoveError ? new PartyMoveError(`${label(id)}：${e.message}`, e.status, e.code) : new PartyMoveError(`${label(id)}：${e?.message || e}`); }
      finally { inFlight--; }
    }
    // 事件驅動等待：遊戲請求完成、戰鬥日誌、指令回應都會「踢」一下，重抓隊伍資料（至少間隔 minGapMs）；
    // 完全沒有事件時每 heartbeatMs 補抓一次；超過 timeoutMs 失敗。所有計時器與監聽在結束時清除。
    function waitParty(check, timeoutMs, describe, read = deps.getParty) {
      return new Promise((resolve, reject) => {
        const started = Date.now();
        let done = false, fetching = false, lastFetch = 0, gapTimer = 0, beatTimer = 0, limitTimer = 0, last = null;
        const finish = (fn, v) => {
          if (done) return; done = true;
          clearTimeout(gapTimer); clearTimeout(beatTimer); clearTimeout(limitTimer);
          deps.kicks?.removeEventListener('settled', kick); deps.kicks?.removeEventListener('kick', kick);
          cancelHook = null; fn(v);
        };
        const fetchNow = async () => {
          if (done || fetching) return;
          fetching = true; lastFetch = Date.now();
          clearTimeout(beatTimer);
          try {
            last = await read();
            if (done) return;
            const r = check(last);
            if (r) return finish(resolve, last);
            deps.onStatus?.(describe(last, Math.round((Date.now() - started) / 1000)));
          } catch (e) {
            if (isRateLimit(e)) return finish(reject, new PartyMoveError('讀取隊伍資料被限流：' + e.message, e.status, e.code));
            if (e?.code === 'PARTY_CHANGED' || e?.code === 'ACTOR_CHANGED' || cancelled) return finish(reject, e);
          } finally {
            fetching = false;
            if (!done) beatTimer = setTimeout(fetchNow, L.heartbeatMs);
          }
        };
        function kick() {
          if (done || fetching || gapTimer) return;
          const wait = lastFetch + L.minGapMs - Date.now();
          if (wait <= 0) void fetchNow();
          else gapTimer = setTimeout(() => { gapTimer = 0; void fetchNow(); }, wait);
        }
        cancelHook = () => finish(reject, new PartyMoveError('已取消'));
        deps.kicks?.addEventListener('settled', kick); deps.kicks?.addEventListener('kick', kick);
        limitTimer = setTimeout(() => finish(reject, new PartyMoveError(`等候逾時（${Math.round(timeoutMs / 1000)} 秒）：` + describe(last || { party: null }, Math.round(timeoutMs / 1000)))), timeoutMs);
        void fetchNow();
      });
    }
    let cancelHook = null;
    async function run(plan) {
      for (const r of plan.rows) names.set(r.id, r.self ? `${r.name}（你）` : r.name);
      const ids = plan.movers.map((r) => r.id);
      const expected = new Set(ids);
      allowedIds = expected;
      const stopped = [];
      let moved = false, last = null;
      const byId = (view, id) => view?.party?.members.find((r) => r.id === id);
      const describe = (view, check) => ids.filter((id) => !check(byId(view, id))).map(label).join('、');
      const atTarget = (row) => row?.mapId === plan.target;
      const arrived = (row) => atTarget(row) && row.running;
      const isStopped = (row) => row?.running === false;
      const read = async (allowCancelled = false) => {
        if (cancelled && !allowCancelled) throw new PartyMoveError('已取消');
        deps.checkActor?.();
        const view = await deps.getParty();
        deps.checkActor?.();
        if (cancelled && !allowCancelled) throw new PartyMoveError('已取消');
        // 外帳號隊員可以自由進出，驗證範圍始終是原生 own 名單裡可移動的同隊角色。
        const owns = new Map(view.own.filter((r) => r.partyId === plan.partyId).map((r) => [r.id, r]));
        const members = view.party?.members.filter((r) =>
          (r.id === plan.me || owns.has(r.id)) && !owns.get(r.id)?.vending) ?? [];
        if (view.party?.id !== plan.partyId || members.length !== ids.length ||
            new Set(members.map((r) => r.id)).size !== ids.length || members.some((r) => !expected.has(r.id))) {
          throw new PartyMoveError('本帳號的隊伍名單或擺攤狀態已變更', 0, 'PARTY_CHANGED');
        }
        last = view;
        return view;
      };
      const waitAll = (check, timeout, message) => waitParty(
        (v) => ids.every((id) => check(byId(v, id))), timeout,
        (v) => message + describe(v, check), read
      );
      const retryCatchup = async (id, attempt, alreadyDone = () => false) => {
        const deadline = Date.now() + L.catchupMs;
        for (;;) {
          deps.checkActor?.();
          if (cancelled) throw new PartyMoveError('已取消');
          try { return await attempt(); }
          catch (error) {
            if (error.status === 429 || error.code !== 'BUSY_CATCHING_UP') throw error;
            if (Date.now() + L.retryMs > deadline) throw new PartyMoveError(label(id) + '：等待補算逾時');
            deps.onStatus?.('等待補算：' + label(id));
            // 只有伺服器明確拒絕的請求才會重試，並保留補算時間。
            await new Promise((resolve, reject) => {
              const timer = setTimeout(() => { cancelHook = null; resolve(); }, L.retryMs);
              cancelHook = () => {
                clearTimeout(timer);
                cancelHook = null;
                reject(new PartyMoveError('已取消'));
              };
            });
            await read();
            const row = byId(last, id);
            if (alreadyDone(row)) return;
          }
        }
      };
      const details = (view) => ids.map((id) => {
        const row = byId(view, id);
        return `${arrived(row) ? '✅' : '⚠️'} ${label(id)}：${row ? row.mapId + (row.running ? ' 掛機中' : '（已停止）') : '狀態尚未確認'}`;
      });
      try {
        const current = await read();
        if (ids.every((id) => arrived(byId(current, id)))) {
          return { ok: true, lines: details(current), maxInFlight };
        }
        for (const id of ids.filter((id) => byId(current, id).running)) {
          deps.onStatus?.('停止掛機：' + label(id));
          await retryCatchup(id, () => send(id, { type: 'stop' }), isStopped);
          stopped.push(id);
        }
        await waitAll(isStopped, L.stopWaitMs, '等待打完這場：');
        moved = true; // 套用即使回應逾時也可能已生效，不能自動使用原設定重啟。
        deps.onStatus?.('套用掛機地圖…');
        await retryCatchup(plan.me, () => deps.applyOwnMap(plan.target, send));
        // 跟隨原生「全隊開始」：當前角色用已套用的地圖，其他分身先前往該圖。
        for (const id of [plan.me, ...ids.filter((id) => id !== plan.me)]) {
          const row = byId(await read(), id);
          if (arrived(row)) continue;
          if (!isStopped(row)) throw new PartyMoveError(label(id) + '：已在其他地圖掛機');
          if (id !== plan.me && !atTarget(row)) {
            deps.onStatus?.('切換地圖：' + label(id));
            await retryCatchup(id, () => send(id, { type: 'selectMap', mapId: plan.target }), atTarget);
            await waitParty((view) => atTarget(byId(view, id)), L.verifyMs, () => '等待確認抵達：' + label(id), read);
          }
          deps.onStatus?.('開始掛機：' + label(id));
          await retryCatchup(id, () => send(id, { type: 'start' }), arrived);
        }
        const final = await waitAll(arrived, L.verifyMs, '等待確認目標地圖掛機：');
        return { ok: true, lines: details(final), maxInFlight };
      } catch (error) {
        const lines = ['🛑 ' + error.message];
        const mayRead = !isRateLimit(error) && !['PARTY_CHANGED', 'ACTOR_CHANGED'].includes(error.code);
        if (!moved && stopped.length && mayRead) {
          // 取消只撤回尚未換圖的停機。成員變動或限流時不再送出指令。
          try {
            const latest = await read(true);
            const wasCancelled = cancelled;
            cancelled = false;
            try {
              for (const id of stopped.filter((id) => isStopped(byId(latest, id)))) await send(id, { type: 'start' });
            } finally { cancelled = wasCancelled; }
          } catch (e) { lines.push('⚠️ 無法確認已停角色都恢復掛機：' + e.message); }
        }
        if (mayRead) {
          try { await read(true); } catch { last = null; }
        }
        if (!moved && stopped.length && mayRead && last) {
          for (const id of stopped) {
            if (byId(last, id)?.running) lines.push('ℹ️ ' + label(id) + '：已送出停止，請確認打完這場後的狀態');
          }
        }
        if (moved || stopped.length) lines.push(...details(mayRead ? last : null));
        return { ok: false, error, lines, maxInFlight };
      }
    }

    return { run, cancel() { cancelled = true; cancelHook?.(); }, get maxInFlight() { return maxInFlight; } };
  }

  let partyMoveActive = null;
  const partyMapGroup = () => [...document.querySelectorAll('[role="group"][aria-label="掛機地圖"]')].find(visible) || null;
  function partyCommandId() {
    if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    const b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
    const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }
  // 與遊戲相同的請求方式：同源 cookie；POST 帶 content-type 與 x-ro-client。走 pollFetch，不計入 pageNet。
  async function partyApiJson(path, init = {}) {
    const res = await pollFetch(path, { credentials: 'same-origin', cache: 'no-store', ...init,
      signal: globalThis.AbortSignal?.timeout?.(init.method === 'POST' ? 30000 : 15000) });
    const text = await res.text();
    let body = {};
    try { body = text ? JSON.parse(text) : {}; } catch { throw new PartyMoveError(`伺服器回應格式不正確（HTTP ${res.status}）`, res.status, 'INVALID_RESPONSE'); }
    if (!res.ok) throw new PartyMoveError(String(body?.error?.message || `請求失敗（HTTP ${res.status}）`).slice(0, 200), res.status, String(body?.error?.code || 'HTTP_' + res.status));
    return body;
  }
  async function partyCommand(id, command, expectedCommandRevision) {
    if (!Number.isSafeInteger(id) || id <= 0) throw new PartyMoveError('角色編號不正確');
    const body = await partyApiJson(`/api/characters/${id}/commands`, { method: 'POST',
      headers: { 'content-type': 'application/json', 'x-ro-client': '1' },
      body: JSON.stringify({ commandId: partyCommandId(), command, expectedCommandRevision }) });
    if (body?.ok !== true) throw new PartyMoveError('伺服器沒有確認這個指令', 200, 'NOT_OK');
    pageNet.events.dispatchEvent(new Event('kick'));
    return body;
  }
  function partySelectedMap(group) {
    const picker = readFiberForUi(() => getCommittedProps(group, (p) =>
      p.label === '掛機地圖' && typeof p.value === 'string'));
    if (picker && partyMapIdRx.test(picker.value)) return picker.value;
    const pressed = [...group.querySelectorAll('button[aria-pressed="true"]')].filter(visible);
    const id = pressed.length === 1 ? getReactFiber(pressed[0])?.key : null;
    return typeof id === 'string' && partyMapIdRx.test(id) ? id : '';
  }
  function partyMapNames(group) {
    for (let f = getReactFiber(group); f; f = f.return) {
      const p = f.memoizedProps;
      if (p?.label === '掛機地圖' && Array.isArray(p.maps)) {
        return new Map(p.maps.filter((m) => typeof m?.id === 'string' && typeof m.name === 'string').map((m) => [m.id, m.name]));
      }
    }
    return new Map();
  }
  function showPartyMoveDialog(plan, mapNames, signal) {
    const mapLabel = (id) => mapNames.get(id) ? `${mapNames.get(id)}（${id}）` : id;
    return new Promise((resolve) => {
      const dlg = document.createElement('dialog');
      dlg.dataset.roiPartyMoveDialog = '';
      dlg.style.cssText = 'width:min(560px,calc(100vw - 24px));max-height:80vh;padding:16px 18px;background:var(--roi-surface);color:var(--roi-text);border:1.5px solid #38bdf8;border-radius:12px;box-shadow:0 16px 48px var(--roi-shadow);font-size:13px;';
      dlg.append(element('div', `🚩 全隊移到 ${mapLabel(plan.target)}`, 'font-weight:bold;font-size:15px;color:var(--roi-info);border-bottom:1px solid var(--roi-edge);padding-bottom:8px;margin-bottom:8px;'));
      const list = element('div', null, 'max-height:46vh;overflow:auto;margin-bottom:10px;border:1px solid var(--roi-edge);border-radius:6px;padding:6px 10px;background:var(--roi-inset);');
      for (const r of plan.rows) {
        const row = element('div', null, 'display:flex;justify-content:space-between;gap:8px;padding:4px 0;border-bottom:1px dashed var(--roi-edge)');
        const who = `${r.name}${r.self ? '（你）' : ''}${r.baseLv ? ` Lv${r.baseLv}` : ''}`;
        const st = !r.ours ? '非本帳號，不動' : r.vending ? '擺攤中，不動' : r.running ? '掛機中 → 停止後移動' : '停止 → 移動';
        row.append(element('span', who), element('span', `${mapLabel(r.mapId)} → ${r.move ? mapLabel(plan.target) : '—'}`, 'color:var(--roi-text)'), element('b', st, `color:${r.move ? 'var(--roi-success)' : 'var(--roi-muted)'};white-space:nowrap`));
        list.append(row);
      }
      dlg.append(list);
      dlg.append(element('div', '等待本帳號隊員停止掛機後，會切換到目標地圖並重新開始掛機。', 'font-size:12px;margin-bottom:10px;'));
      const btns = element('div', null, 'display:flex;justify-content:flex-end;gap:8px;');
      const cancel = element('button', '取消'); cancel.type = 'button'; cancel.className = 'xp-btn small';
      const ok = element('button', '確定移動'); ok.type = 'button'; ok.className = 'xp-btn small primary';
      btns.append(cancel, ok); dlg.append(btns);
      let confirmed = false, done = false;
      // Esc 會觸發 close；按鈕直接收尾。任何路徑都只移除一次、只回覆一次。
      const finish = () => {
        if (done) return;
        done = true;
        signal.removeEventListener('abort', finish);
        if (dlg.open && typeof dlg.close === 'function') dlg.close();
        dlg.remove();
        resolve(confirmed);
      };
      if (signal.aborted) return finish();
      signal.addEventListener('abort', finish, { once: true });
      dlg.addEventListener('close', finish);
      cancel.onclick = finish;
      ok.onclick = () => { confirmed = true; finish(); };
      document.body.appendChild(dlg);
      if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
    });
  }
  async function partyApplyTravelMap(me, target, send) {
    const path = `/api/characters/${me}?deferCatchup=1`;
    const read = async () => {
      const view = await partyApiJson(path);
      if (Number(view?.characterId) !== me || !isPlainRecord(view.snapshot?.config) ||
          typeof view.snapshot.config.lockMap !== 'string') throw Error('讀不到目前角色的掛機設定');
      return view;
    };
    const view = await read();
    if (view.snapshot.config.lockMap === target) return;
    if (view.running !== false || !Number.isSafeInteger(view.commandRevision)) throw Error('無法確認角色已停止或設定版本，已中止套用');
    await send(me, { type: 'updateConfig', config: { ...view.snapshot.config, lockMap: target } }, view.commandRevision);
    if ((await read()).snapshot.config.lockMap !== target) throw Error('伺服器尚未確認套用掛機地圖');
  }

  async function startSharedPartyMove(target, onStatus, onActive, confirmMove) {
    if (hasActiveOperation() || document.hidden) throw Error('有其他助手操作進行中，請稍後再試');
    if (!partyMapIdRx.test(target)) throw Error('地圖編號無效');
    const me = Number(state.activeCharId), epoch = refineIdentityEpoch;
    if (!Number.isSafeInteger(me) || me <= 0) throw Error('還不知道目前角色，請稍候再試');
    let cancelled = false, pageLeft = false, runner;
    const confirmation = confirmMove && new AbortController();
    const cancel = () => { cancelled = true; confirmation?.abort(); runner?.cancel(); };
    const onLeave = () => { pageLeft = true; cancel(); };
    const checkActor = () => {
      if (pageLeft || Number(state.activeCharId) !== me || refineIdentityEpoch !== epoch || refBusy || cartShortcutBusy) {
        throw new PartyMoveError('角色已切換或頁面已離開，已停止移動', 0, 'ACTOR_CHANGED');
      }
    };
    partyMoveActive = { cancel };
    try {
      window.addEventListener('pagehide', onLeave);
      onActive(cancel);
      const run = async () => {
        const snapshot = await partyApiJson(`/api/characters/${me}?deferCatchup=1`);
        checkActor();
        if (Number(snapshot?.characterId) !== me || !snapshot?.snapshot?.character) throw Error('無法確認目前角色狀態');
        if (snapshot.snapshot.vend) throw Error('目前角色擺攤中，無法全隊移動');
        const getParty = async () => validatePartyView(await partyApiJson(`/api/characters/${me}/party`));
        const view = await getParty();
        checkActor();
        if (cancelled) throw Error('已取消');
        const plan = planPartyMove(view, me, target);
        if (confirmMove && !await confirmMove(plan, confirmation.signal)) {
          return { ok: false, cancelled: true, lines: [] };
        }
        checkActor();
        if (cancelled) throw Error('已取消');
        runner = createPartyMoveRunner({
          getParty, command: partyCommand, kicks: pageNet.events, onStatus, checkActor,
          applyOwnMap: (target, send) => partyApplyTravelMap(me, target, send)
        });
        return runner.run(plan);
      };
      onStatus('正在核對隊伍…');
      if (typeof navigator.locks?.request !== 'function') return await run();
      return await navigator.locks.request('roi-mvp-party-travel', { ifAvailable: true }, (lock) => {
        if (!lock) throw Error('另一個分頁正在移動隊伍');
        if (cancelled) throw Error('已取消');
        return run();
      });
    } finally {
      window.removeEventListener('pagehide', onLeave);
      partyMoveActive = null;
      onActive(null);
    }
  }

  async function startPartyMove(bar) {
    const status = bar.querySelector('[data-roi-party-move-status]');
    const btn = bar.querySelector('[data-roi-party-move]');
    const stopBtn = bar.querySelector('[data-roi-party-move-cancel]');
    const out = bar.querySelector('[data-roi-party-move-result]');
    if (btn.disabled || partyMoveActive || document.hidden) return;
    btn.disabled = true;
    out.replaceChildren();
    try {
      const group = partyMapGroup();
      if (!group) throw Error('請先開啟掛機設定的地圖選單');
      const target = partySelectedMap(group);
      if (!target) throw Error('讀不到掛機設定選的地圖，請在地圖選單點選一張地圖後再試');
      const mapNames = partyMapNames(group);
      const result = await startSharedPartyMove(target,
        (text) => { status.textContent = text; },
        (cancel) => {
          stopBtn.hidden = !cancel;
          stopBtn.onclick = cancel;
        },
        (plan, signal) => {
          status.textContent = '請在視窗中確認';
          return showPartyMoveDialog(plan, mapNames, signal);
        });
      if (result.cancelled) { status.textContent = '已取消'; return; }
      status.textContent = result.ok ? '🎉 全隊移動完成' : '⚠️ 全隊移動沒有全部完成，請看下方明細';
      for (const line of result.lines) out.append(element('div', line));
      alertUser(result.ok ? '🚩 全隊移動完成' : '⚠️ 全隊移動未完成', result.lines.slice(0, 6).join('\n'), !result.ok);
    } catch (e) {
      status.textContent = '⚠️ ' + (e?.message || e);
    } finally {
      btn.disabled = false; stopBtn.hidden = true;
    }
  }
  function syncPartyMoveBar() {
    const bars = [...document.querySelectorAll('[data-roi-party-move-bar]')];
    const group = partyMapGroup();
    if (!group) { if (!partyMoveActive) bars.forEach((b) => b.remove()); return; }
    let bar = bars.shift();
    bars.forEach((b) => b.remove());
    if (!bar) {
      bar = element('div', null, 'display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin:4px 0;font-size:12px;');
      bar.dataset.roiPartyMoveBar = '';
      const btn = element('button', '🚩 全隊移到此地圖'); btn.type = 'button'; btn.className = 'xp-btn small'; btn.dataset.roiPartyMove = '';
      btn.title = '把同隊的自己角色停止、換到這張地圖，再一起開始掛機';
      const stop = element('button', '取消'); stop.type = 'button'; stop.className = 'xp-btn small'; stop.dataset.roiPartyMoveCancel = ''; stop.hidden = true;
      const status = element('span', null, 'color:var(--roi-info)'); status.dataset.roiPartyMoveStatus = '';
      const out = element('div', null, 'flex-basis:100%;font-size:11.5px;line-height:1.5'); out.dataset.roiPartyMoveResult = '';
      btn.onclick = () => { void startPartyMove(bar); };
      bar.append(btn, stop, status, out);
    }
    if (group.nextElementSibling !== bar) group.after(bar);
  }
