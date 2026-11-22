
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
  function planPartyMove(view, me, target, rosterIds) {
    if (!partyMapIdRx.test(target || '')) throw Error('沒有選擇有效的地圖');
    if (!view.party) throw Error('目前角色沒有隊伍');
    const mine = new Set([...rosterIds].map(Number));
    if (!mine.has(me)) throw Error('目前角色不在本帳號名單內');
    const own = new Map(view.own.filter((o) => o.partyId === view.party.id).map((o) => [o.id, o]));
    const meMember = view.party.members.find((m) => m.id === me);
    if (!meMember) throw Error('隊伍資料裡找不到目前角色');
    const rows = view.party.members.map((m) => {
      const self = m.id === me;
      const ours = self || (own.has(m.id) && mine.has(m.id));
      const vending = ours && own.get(m.id)?.vending === true;
      return { ...m, self, ours, vending, move: ours && !vending };
    });
    const movers = rows.filter((r) => r.move);
    if (movers.length < 2) throw Error('隊伍裡沒有其他可移動的同帳號角色');
    if (movers.every((r) => r.running && r.mapId === target)) throw Error('大家已經都在這張地圖掛機');
    return { me, target, rows, movers, stopIds: movers.filter((r) => r.running).map((r) => r.id) };
  }
  // deps：getParty()、command(id, cmd)、applyOwnMap(target)、kicks（EventTarget，遊戲有請求完成或戰鬥日誌時發 'settled'／'kick'）
  //       onStatus(text)、limits {stopWaitMs, verifyMs, minGapMs, heartbeatMs}
  function createPartyMoveRunner(deps) {
    const L = { stopWaitMs: 180000, verifyMs: 30000, minGapMs: 2500, heartbeatMs: 10000, ...deps.limits };
    let cancelled = false;
    const names = new Map();
    const label = (id) => names.get(id) || `#${id}`;
    const isRateLimit = (e) => e?.status === 429 || e?.code === 'RATE_LIMITED';
    let inFlight = 0, maxInFlight = 0;
    async function send(id, command) {
      if (cancelled) throw new PartyMoveError('已取消');
      inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
      try { return await deps.command(id, command); }
      catch (e) { throw e instanceof PartyMoveError ? new PartyMoveError(`${label(id)}：${e.message}`, e.status, e.code) : new PartyMoveError(`${label(id)}：${e?.message || e}`); }
      finally { inFlight--; }
    }
    // 事件驅動等待：遊戲請求完成、戰鬥日誌、指令回應都會「踢」一下，重抓隊伍資料（至少間隔 minGapMs）；
    // 完全沒有事件時每 heartbeatMs 補抓一次；超過 timeoutMs 失敗。所有計時器與監聽在結束時清除。
    function waitParty(check, timeoutMs, describe) {
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
            last = await deps.getParty();
            if (done) return;
            const r = check(last);
            if (r) return finish(resolve, last);
            deps.onStatus?.(describe(last, Math.round((Date.now() - started) / 1000)));
          } catch (e) {
            if (isRateLimit(e)) return finish(reject, new PartyMoveError('讀取隊伍資料被限流：' + e.message, e.status, e.code));
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
    async function run(plan, { startAfter = true } = {}) {
      for (const r of plan.rows) names.set(r.id, r.self ? `${r.name}（你）` : r.name);
      const stopped = [], started = [], lines = [];
      const byId = (view, id) => view?.party?.members.find((m) => m.id === id);
      let phase = 'apply';
      try {
        deps.onStatus?.('套用你的掛機地圖…');
        await deps.applyOwnMap(plan.target);
        phase = 'stop';
        for (const id of plan.stopIds) {
          deps.onStatus?.(`停止 ${label(id)}（${stopped.length + 1}/${plan.stopIds.length}）`);
          await send(id, { type: 'stop' });
          stopped.push(id);
        }
        if (plan.stopIds.length) {
          await waitParty((v) => plan.stopIds.every((id) => byId(v, id) && !byId(v, id).running), L.stopWaitMs, (v, s) => {
            const left = plan.stopIds.filter((id) => byId(v, id)?.running !== false).map(label);
            return `等待 ${left.join('、') || '隊員'} 打完這場（已等 ${s} 秒，可按取消）`;
          });
        }
        if (!startAfter) return { ok: true, lines: plan.movers.map((r) => `⏸️ ${label(r.id)}：已停止`), maxInFlight };
        phase = 'start';
        const fresh = await deps.getParty();
        const ordered = [...plan.movers].sort((a, b) => Number(b.self) - Number(a.self));
        for (const r of ordered) {
          const now = byId(fresh, r.id);
          if (!r.self && now?.mapId !== plan.target) {
            deps.onStatus?.(`${label(r.id)} 前往 ${plan.target}`);
            await send(r.id, { type: 'selectMap', mapId: plan.target });
          }
          deps.onStatus?.(`開始 ${label(r.id)}（${started.length + 1}/${ordered.length}）`);
          await send(r.id, { type: 'start' });
          started.push(r.id);
        }
        phase = 'verify';
        let final = null;
        try {
          final = await waitParty((v) => started.every((id) => byId(v, id)?.running && byId(v, id)?.mapId === plan.target), L.verifyMs,
            (v, s) => `確認大家都在 ${plan.target} 掛機（${s} 秒）`);
        } catch (e) {
          if (e.message === '已取消') throw e;
          final = await deps.getParty().catch(() => null);
        }
        for (const id of started) {
          const m = byId(final, id);
          const okRow = m?.running && m.mapId === plan.target;
          lines.push(`${okRow ? '✅' : '⚠️'} ${label(id)}：${m ? `${m.mapId}${m.running ? ' 掛機中' : ' 停止'}` : '讀不到狀態'}`);
        }
        for (const r of plan.rows.filter((x) => !x.move)) lines.push(`➖ ${label(r.id)}：${r.vending ? '擺攤中，未變動' : '非本帳號角色，未變動'}`);
        return { ok: lines.every((l) => !l.startsWith('⚠️')), lines, maxInFlight };
      } catch (e) {
        lines.push(`🛑 ${e.message}`);
        // 回復：被我們停掉、還沒重新開始的角色照原設定重新開始；被限流時不再送任何指令。
        const restore = stopped.filter((id) => !started.includes(id));
        if (restore.length && !isRateLimit(e) && phase !== 'apply') {
          const wasCancelled = cancelled; cancelled = false;
          for (const id of restore) {
            try { await send(id, { type: 'start' }); lines.push(`↩️ ${label(id)}：已恢復掛機（原地圖設定）`); }
            catch (err) { lines.push(`⚠️ ${label(id)}：恢復失敗（${err.message}），請手動開始`); if (isRateLimit(err)) break; }
          }
          cancelled = wasCancelled;
        } else if (restore.length) {
          for (const id of restore) lines.push(`⚠️ ${label(id)}：已停止，請稍後手動開始`);
        }
        for (const id of started) lines.push(`ℹ️ ${label(id)}：已送出開始`);
        return { ok: false, error: e, lines, maxInFlight };
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
  async function partyCommand(id, command) {
    if (!Number.isSafeInteger(id) || id <= 0) throw new PartyMoveError('角色編號不正確');
    const body = await partyApiJson(`/api/characters/${id}/commands`, { method: 'POST',
      headers: { 'content-type': 'application/json', 'x-ro-client': '1' },
      body: JSON.stringify({ commandId: partyCommandId(), command }) });
    if (body?.ok !== true) throw new PartyMoveError('伺服器沒有確認這個指令', 200, 'NOT_OK');
    pageNet.events.dispatchEvent(new Event('kick'));
    return body;
  }
  async function partyReadConfig(me) {
    const d = await partyApiJson(`/api/characters/${me}?deferCatchup=1`);
    const config = d?.snapshot?.config;
    if (Number(d?.characterId) !== me || !isPlainRecord(config) || typeof config.lockMap !== 'string') throw new PartyMoveError('讀不到你目前的掛機設定');
    return config;
  }
  // 掛機設定面板的實際結構（遊戲前端 index-Dxm6ToCt.js）：
  //   設定元件 props {snap, save, characterId}，草稿在它的 useState（未修改時為 null，畫面用 draft ?? snap.config）
  //   └ 分頁容器 props {on, draft, advanced}（draft = 目前草稿，沒有 update）
  //     └ … └ 地圖選單 props {label:'掛機地圖', maps, value: draft.lockMap, onChange} → role=group 的 DOM
  //   有 {draft, update} 的元件是「藥水與補給」等兄弟區塊，不是地圖選單的祖先，所以不能用它來找。
  const roiDebug = () => { try { return localStorage.getItem('roi-debug') === '1'; } catch { return false; } };
  const partyLog = (...args) => { if (roiDebug()) console.debug('[ROI party-move]', ...args); };
  function partyReadSettings(group) {
    const read = (matcher) => readFiberForUi(() => getCommittedProps(group, matcher)) || null;
    const picker = read((x) => x?.label === '掛機地圖' && Object.hasOwn(x, 'value'));
    const holder = read((x) => x?.draft && typeof x.draft === 'object' && typeof x.draft.lockMap === 'string');
    const panel = read((x) => x?.snap?.config && typeof x.snap.config === 'object' && typeof x.save === 'function');
    const pressed = [...group.querySelectorAll('button[aria-pressed="true"]')].filter(visible);
    const domTarget = pressed.length === 1 ? String(getReactFiber(pressed[0])?.key ?? '') : '';
    const applyBtns = [...document.querySelectorAll('button')].filter((b) => visible(b) && clean(b.textContent) === '套用設定');
    const applyEnabled = applyBtns.length ? applyBtns.some((b) => !b.disabled) : null;
    const candidates = [picker?.value, holder?.draft?.lockMap, domTarget].filter((v) => typeof v === 'string' && partyMapIdRx.test(v));
    const target = candidates[0] || '';
    const info = {
      target, draft: holder?.draft || null, applied: panel?.snap?.config || null, applyEnabled,
      diag: {
        picker: picker ? { value: typeof picker.value === 'string' ? picker.value : typeof picker.value, maps: Array.isArray(picker.maps) ? picker.maps.length : null } : null,
        draftHolder: holder ? Object.keys(holder).slice(0, 8) : null,
        panel: panel ? Object.keys(panel).slice(0, 8) : null,
        domTarget: domTarget || null, pressedButtons: pressed.length,
        applyButtons: applyBtns.length, applyEnabled,
        fiber: Boolean(getReactFiber(group)), candidatesAgree: new Set(candidates).size <= 1,
      },
    };
    if (applyEnabled === false) resetRareSyncDelta();
    partyLog('讀取掛機設定', info.diag);
    return info;
  }
  // 比較用的正規化：物件鍵排序、undefined 當作沒有；必撿稀有掉落當集合比（順序無關，空陣列 = 未設定）。
  const partyNorm = (v) => v === null || typeof v !== 'object' ? v
    : Array.isArray(v) ? v.map(partyNorm)
      : Object.fromEntries(Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => [k, partyNorm(v[k])]));
  const partyIdSet = (v) => new Set(Array.isArray(v) ? v.map(Number).filter(Number.isSafeInteger) : []);
  function partyDraftDiffKeys(draft, config) {
    const keys = new Set([...Object.keys(draft), ...Object.keys(config)]);
    keys.delete('lockMap');
    return [...keys].filter((k) => {
      if (k === 'rarePickup') {
        const a = partyIdSet(draft[k]), b = partyIdSet(config[k]);
        return a.size !== b.size || [...a].some((x) => !b.has(x));
      }
      return JSON.stringify(partyNorm(draft[k])) !== JSON.stringify(partyNorm(config[k]));
    }).sort();
  }
  // 只回報形狀（型別、長度、鍵數），不印內容。
  const partyShape = (v) => v === undefined ? 'undefined' : v === null ? 'null' : Array.isArray(v) ? `array(${v.length})`
    : typeof v === 'object' ? `object(${Object.keys(v).length} keys)` : typeof v === 'boolean' ? String(v) : typeof v;
  // 地圖連動的必撿稀有掉落：差異必須完全是「隨地圖同步」這次自己勾／取消的道具，且同步對象就是目標地圖。
  function partyRareCoupling(draft, config, me, target) {
    const a = partyIdSet(draft.rarePickup), b = partyIdSet(config.rarePickup);
    const added = [...a].filter((x) => !b.has(x)), removed = [...b].filter((x) => !a.has(x));
    const d = rareSyncDelta;
    const reasons = [];
    if (!rareAutoMap) reasons.push('sync-off');
    if (d.tainted) reasons.push('sync-unknown-id');
    if (d.charId !== me) reasons.push('sync-other-char');
    if (d.lockMap !== target) reasons.push('sync-other-map');
    const manualAdded = added.filter((x) => d.net.get(x) !== true).length;
    const manualRemoved = removed.filter((x) => d.net.get(x) !== false).length;
    if (manualAdded || manualRemoved) reasons.push('not-from-sync');
    return { ok: reasons.length === 0, added: added.length, removed: removed.length, manualAdded, manualRemoved, syncNet: d.net.size, reasons };
  }
  // extra：[] 代表除了地圖（與地圖連動的必撿稀有掉落）沒有其他修改；null 代表無法確認。
  function partyExtraChanges(info, config, me, target) {
    if (!info.draft) return { extra: info.applyEnabled === false ? [] : null, rare: null };
    let extra = partyDraftDiffKeys(info.draft, config), rare = null;
    if (extra.includes('rarePickup')) {
      rare = partyRareCoupling(info.draft, config, me, target);
      if (rare.ok) extra = extra.filter((k) => k !== 'rarePickup');
    }
    if (extra.length || rare || roiDebug()) {
      const diff = partyDraftDiffKeys(info.draft, config).map((k) => ({ key: k, before: partyShape(config[k]), after: partyShape(info.draft[k]) }));
      partyLog('草稿差異', { target, applied: config.lockMap, diff, rare, blocking: extra });
    }
    return { extra, rare };
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
  async function partyApplyOwnMap(me, target, group) {
    const config = await partyReadConfig(me);
    if (config.lockMap === target) return;
    const info = partyReadSettings(group);
    if (info.target !== target) throw new PartyMoveError('掛機設定的地圖已變更，請重新操作');
    const { extra } = partyExtraChanges(info, config, me, target);
    if (extra === null) throw new PartyMoveError('讀不到完整草稿，無法確認有沒有其他未套用的修改；請先手動按「套用設定」再按 🚩');
    if (extra.length) throw new PartyMoveError(`掛機設定還有其他未套用的修改（${extra.slice(0, 5).join('、')}），請先套用或還原`);
    const btn = [...document.querySelectorAll('button')].find((b) => visible(b) && !b.disabled && clean(b.textContent) === '套用設定');
    if (!btn) throw new PartyMoveError('找不到「套用設定」按鈕，請保持掛機設定開著');
    const path = `/api/characters/${me}/commands`;
    const settled = new Promise((resolve, reject) => {
      const on = (e) => { if (e.detail?.method === 'POST' && e.detail.path === path) { off(); resolve(e.detail.status); } };
      const timer = setTimeout(() => { off(); reject(new PartyMoveError('套用設定逾時（20 秒），請檢查掛機設定')); }, 20000);
      const off = () => { clearTimeout(timer); pageNet.events.removeEventListener('settled', on); };
      pageNet.events.addEventListener('settled', on);
    });
    btn.click();
    const status = await settled;
    const after = await partyReadConfig(me);
    if (after.lockMap !== target) throw new PartyMoveError(`套用後掛機地圖仍是 ${after.lockMap}（HTTP ${status}）`);
  }
  function showPartyMoveDialog(plan, mapNames, needApply, rare = null) {
    const mapLabel = (id) => mapNames.get(id) ? `${mapNames.get(id)}（${id}）` : id;
    return new Promise((resolve) => {
      const dlg = document.createElement('dialog');
      dlg.dataset.roiPartyMoveDialog = '';
      dlg.style.cssText = 'width:min(560px,calc(100vw - 24px));max-height:80vh;padding:16px 18px;background:rgba(15,23,42,0.98);color:#f8fafc;border:1.5px solid #38bdf8;border-radius:12px;box-shadow:0 16px 48px rgba(0,0,0,0.92);font-size:13px;';
      dlg.append(element('div', `🚩 全隊移到 ${mapLabel(plan.target)}`, 'font-weight:bold;font-size:15px;color:#7dd3fc;border-bottom:1px solid #334155;padding-bottom:8px;margin-bottom:8px;'));
      const list = element('div', null, 'max-height:46vh;overflow:auto;margin-bottom:10px;border:1px solid #334155;border-radius:6px;padding:6px 10px;background:#090d16;');
      for (const r of plan.rows) {
        const row = element('div', null, 'display:flex;justify-content:space-between;gap:8px;padding:4px 0;border-bottom:1px dashed #1e293b');
        const who = `${r.name}${r.self ? '（你）' : ''}${r.baseLv ? ` Lv${r.baseLv}` : ''}`;
        const st = !r.ours ? '非本帳號，不動' : r.vending ? '擺攤中，不動' : r.running ? '掛機中 → 停止後移動' : '停止 → 移動';
        row.append(element('span', who), element('span', `${mapLabel(r.mapId)} → ${r.move ? mapLabel(plan.target) : '—'}`, 'color:#cbd5e1'), element('b', st, `color:${r.move ? '#4ade80' : '#94a3b8'};white-space:nowrap`));
        list.append(row);
      }
      dlg.append(list);
      const notes = [
        needApply ? `會先替你按「套用設定」，把你的掛機地圖改成 ${mapLabel(plan.target)}。` : '',
        needApply && rare && (rare.added || rare.removed) ? `必撿稀有掉落已隨地圖同步更新（新增 ${rare.added}、取消 ${rare.removed} 項），會和地圖一起套用。` : '',
        plan.stopIds.length ? '「停止」要等那一場打完才生效，可能要等幾十秒到幾分鐘，過程中可以取消。' : '',
      ].filter(Boolean).join(' ');
      if (notes) dlg.append(element('div', notes, 'font-size:12px;color:#cbd5e1;margin-bottom:8px;'));
      const startLabel = element('label', ' 完成後全部開始掛機', 'display:flex;gap:4px;align-items:center;font-size:12px;margin-bottom:10px;');
      const startBox = element('input'); startBox.type = 'checkbox'; startBox.checked = true; startLabel.prepend(startBox);
      dlg.append(startLabel);
      const btns = element('div', null, 'display:flex;justify-content:flex-end;gap:8px;');
      const cancel = element('button', '取消'); cancel.type = 'button'; cancel.className = 'xp-btn small';
      const ok = element('button', '確定移動'); ok.type = 'button'; ok.className = 'xp-btn small primary';
      btns.append(cancel, ok); dlg.append(btns);
      let result = null, done = false;
      // Esc 會觸發 close；按鈕直接收尾。任何路徑都只移除一次、只回覆一次。
      const finish = () => { if (done) return; done = true; if (dlg.open && typeof dlg.close === 'function') dlg.close(); dlg.remove(); resolve(result); };
      dlg.addEventListener('close', finish);
      cancel.onclick = finish;
      ok.onclick = () => { result = { startAfter: startBox.checked }; finish(); };
      document.body.appendChild(dlg);
      if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
    });
  }
  async function startPartyMove(bar) {
    const status = bar.querySelector('[data-roi-party-move-status]');
    const btn = bar.querySelector('[data-roi-party-move]');
    const stopBtn = bar.querySelector('[data-roi-party-move-cancel]');
    const out = bar.querySelector('[data-roi-party-move-result]');
    if (partyMoveActive || document.hidden) return;
    if (hasActiveOperation()) { status.textContent = '⚠️ 精煉／領倉進行中，請稍後再試'; return; }
    const group = partyMapGroup();
    const me = Number(state.activeCharId);
    btn.disabled = true; out.replaceChildren();
    try {
      if (!group) throw Error('請先開啟掛機設定的地圖選單');
      if (!Number.isSafeInteger(me) || me <= 0) throw Error('還不知道目前角色，請稍候再試');
      status.textContent = '讀取隊伍與設定…';
      const info = partyReadSettings(group);
      if (!info.target) {
        console.warn('[ROI party-move] 讀不到掛機設定選的地圖', info.diag);
        throw Error('讀不到掛機設定選的地圖，請在地圖選單點選一張地圖後再試');
      }
      if (!info.diag.candidatesAgree) console.warn('[ROI party-move] 地圖來源不一致，以選單 value 為準', info.diag);
      const target = info.target;
      const config = await partyReadConfig(me);
      const { extra, rare } = partyExtraChanges(info, config, me, target);
      if (extra === null) {
        console.warn('[ROI party-move] 讀不到完整草稿且有未套用的修改', info.diag);
        throw Error('讀不到完整草稿，無法確認有沒有其他未套用的修改；請先手動按「套用設定」再按 🚩');
      }
      if (extra.length) throw Error(`掛機設定還有其他未套用的修改（${extra.slice(0, 5).join('、')}），請先套用或還原，再使用全隊移動`);
      const view = validatePartyView(await partyApiJson(`/api/characters/${me}/party`));
      const plan = planPartyMove(view, me, target, nativeRosterIds?.size ? nativeRosterIds : state.myCharIds);
      status.textContent = '請在視窗中確認';
      const choice = await showPartyMoveDialog(plan, partyMapNames(group), config.lockMap !== target, rare?.ok ? rare : null);
      if (!choice) { status.textContent = '已取消'; return; }
      if (Number(state.activeCharId) !== me) throw Error('角色已切換，請重新操作');
      const runner = createPartyMoveRunner({
        getParty: async () => validatePartyView(await partyApiJson(`/api/characters/${me}/party`)),
        command: partyCommand,
        applyOwnMap: (t) => partyApplyOwnMap(me, t, group),
        kicks: pageNet.events,
        onStatus: (text) => { status.textContent = text; },
      });
      partyMoveActive = runner;
      stopBtn.hidden = false;
      const result = await runner.run(plan, choice);
      status.textContent = result.ok ? '🎉 全隊移動完成' : '⚠️ 全隊移動沒有全部完成，請看下方明細';
      for (const line of result.lines) out.append(element('div', line));
      alertUser(result.ok ? '🚩 全隊移動完成' : '⚠️ 全隊移動未完成', result.lines.slice(0, 6).join('\n'), !result.ok);
    } catch (e) {
      status.textContent = '⚠️ ' + (e?.message || e);
    } finally {
      partyMoveActive = null;
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
      const status = element('span', null, 'color:#38bdf8'); status.dataset.roiPartyMoveStatus = '';
      const out = element('div', null, 'flex-basis:100%;font-size:11.5px;line-height:1.5'); out.dataset.roiPartyMoveResult = '';
      btn.onclick = () => { void startPartyMove(bar); };
      stop.onclick = () => { partyMoveActive?.cancel(); };
      bar.append(btn, stop, status, out);
    }
    if (group.nextElementSibling !== bar) group.after(bar);
  }
