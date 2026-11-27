
  let sharedAudioCtx = null;
  const playTone = (freq, type, dur, delay = 0) => {
    if (!state.sound) return;
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      if (!sharedAudioCtx || sharedAudioCtx.state === 'closed') sharedAudioCtx = new AudioCtx();
      if (sharedAudioCtx.state === 'suspended') sharedAudioCtx.resume().catch(() => {});
      const ctx = sharedAudioCtx;
      const osc = ctx.createOscillator(), g = ctx.createGain();
      osc.type = type; osc.frequency.setValueAtTime(freq, ctx.currentTime + delay);
      g.gain.setValueAtTime(0.12, ctx.currentTime + delay);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + dur);
      osc.connect(g); g.connect(ctx.destination);
      osc.start(ctx.currentTime + delay); osc.stop(ctx.currentTime + delay + dur);
    } catch {}
  };
  const alertUser = (title, text, isDanger = false) => {
    if (isDanger) { playTone(220, 'sawtooth', 0.2, 0); playTone(165, 'sawtooth', 0.3, 0.2); }
    else { playTone(880, 'sine', 0.15, 0); playTone(1318, 'triangle', 0.25, 0.15); }
    if (state.notify && Date.now() - state.lastNotifyAt > TIMING.notifyCooldown && typeof GM_notification === 'function') {
      state.lastNotifyAt = Date.now();
      GM_notification({ title, text, timeout: TIMING.notifyDuration });
    }
  };

  let foregroundMvpSnapshot = null;

  function applyCharRoster(characters, notify, previous = state.chars) {
    const prevRun = new Set(previous.filter(c => c.running).map(c => Number(c.id)));
    if (previous.length > 0) {
      const stopped = characters.filter((c) => !c.running && prevRun.has(Number(c.id)));
      for (const c of stopped) recordCharAlert(c.id, '已停止掛機');
      if (notify && stopped.length) alertUser('🚨 分身停機警告', `${stopped.map((c) => c.name).join('、')} 已停止掛機`, true);
    }
    state.chars = characters;
    state.myCharIds = new Set(characters.map((c) => Number(c.id)));
    state.charRosterLoaded = true;
    for (const c of characters) {
      if (c.running && state.charAlerts[c.id]?.reason === '已停止掛機') delete state.charAlerts[c.id];
    }
    for (const cache of [state.charZenyMap, state.initZenyMap, state.charAlerts]) {
      for (const id of Object.keys(cache)) {
        if (!state.myCharIds.has(Number(id))) delete cache[id];
      }
    }
    if (!Object.keys(state.charAlerts).length) document.getElementById('ro-fab')?.classList.remove('roi-stop-alert');
    renderChars();
  }

  function onApiData(url, text, foreground = true) {
    try {
      if (!text || text[0] !== '{') return;
      const path = String(url).replace(location.origin, '').split('?')[0];
      if (path !== '/api/characters' && !/^\/api\/characters\/\d+$/.test(path)) return;
      const d = JSON.parse(text);
      if (path === '/api/characters' && Array.isArray(d.characters) && d.characters.length <= 12) {
        nativeRosterIds = new Set(d.characters.map(c => Number(c.id)));
        // 原生名單比既有共享快取新，之後只接受更晚寫入的共享資料。
        lastSharedCharPollAt = Math.max(lastSharedCharPollAt, Date.now());
        applyCharRoster(d.characters, !canShareCharPoll());
        if (canShareCharPoll()) applySharedCharPoll(readSharedCharPoll());
      } else if (d.characterId && d.snapshot?.character) {
        const cid = Number(d.characterId);
        if (state.charRosterLoaded && !state.myCharIds.has(cid)) return;
        const ch = d.snapshot.character;
        let refineActorId = null;
        if (foreground && refBusy && state.activeCharId !== cid) {
          // 背包 Fiber 讀不到（逾時或 store 領先一個提交）時，改問遊戲原生 store 目前的角色。
          const viaBackpack = readFiberForUi(() => refineActor(readBackpackContext(true)));
          refineActorId = viaBackpack ?? nativeStoreActor(refineNativeStore, null, false);
          refineDiag('api_detail', refineActorId === cid ? 'treated_as_switch' : 'other_char_ignored',
            { viaBackpack: viaBackpack != null, confirmed: refineActorId != null, sameActor: refineActorId === cid });
        }
        // 背包或原生 store 能確認目前角色時，其他角色的明細回應只更新該角色的餘額。
        foreground = foreground && (refineActorId == null || refineActorId === cid);
        if (foreground) {
          if (state.activeCharId !== cid) {
            combatHitMeter.reset();
            if (state.activeCharId != null) {
              clearQueuedCharacterLogs();
              state.dmgSum = state.hits = state.maxDmg = state.damageTaken = 0;
              state.damageStartMs = state.accMs + (state.paused ? 0 : Date.now() - state.lastResumed);
            }
            // 初始化助手角色時，精煉工作階段可能已從原生背包認出同一角色。
            if (state.activeCharId != null || refineActorId !== cid) {
              refineIdentityEpoch++;
              pageNet.events.dispatchEvent(new Event('ui-abort'));
              refSelected.clear();
            }
          }
          state.activeCharId = cid;
          state.activeCharName = ch.name || d.name;
          foregroundMvpSnapshot = Array.isArray(d.snapshot.mvpLastKill) ? d.snapshot : null;
        }
        if (typeof ch.zeny === 'number') {
          if (state.initZenyMap[cid] === undefined) state.initZenyMap[cid] = ch.zeny;
          if (foreground) {
            state.curZeny = ch.zeny;
            localZenyAt.set(cid, Date.now());
          }
          state.charZenyMap[cid] = ch.zeny;
        }
        if (foreground && canShareCharPoll()) applySharedCharPoll(readSharedCharPoll());
        updateHUD(); renderChars();
      }
    } catch {}
  }

  const pollFetch = page.fetch.bind(page);
  let detailRequest = 0;
  // 頁面（遊戲）發出的 fetch 進行中／已完成數；腳本自己的輪詢走 pollFetch，不計入。
  // events：每個遊戲請求完成時發 'settled'（detail: path/method/status），全隊移動等流程用來取代固定等待。
  const pageNet = { inFlight: 0, settled: 0, events: new EventTarget() };
  let refineCommandWatch = null;
  function matchRefineCommand(path, method, body, watch) {
    if (!watch || method !== 'POST' || path !== `/api/characters/${watch.characterId}/commands`
        || typeof body !== 'string') return false;
    try {
      const { commandId, command } = JSON.parse(body);
      if (typeof commandId !== 'string' || !commandId || (watch.type === 'equip' ? command?.type !== 'equip' : command?.type !== 'refine' || command.skill !== true) || command.uid !== watch.uid
          || (watch.commandId && watch.commandId !== commandId)) return false;
      watch.commandId = commandId;
      watch.pending++;
      return true;
    } catch { return false; }
  }

  try {
    const origFetch = page.fetch;
    if (origFetch) {
      page.fetch = async function (...args) {
        const u = typeof args[0] === 'string' ? args[0] : (args[0]?.url || '');
        const path = u.replace(location.origin, '').split('?')[0];
        const isDetail = /^\/api\/characters\/\d+$/.test(path);
        const request = isDetail ? ++detailRequest : 0;
        const method = String(args[1]?.method || args[0]?.method || 'GET').toUpperCase();
        const watch = refineCommandWatch;
        const watched = matchRefineCommand(path, method, args[1]?.body, watch);
        pageNet.inFlight++;
        let res;
        try { res = await origFetch.apply(this, args); }
        finally {
          pageNet.inFlight--; pageNet.settled++;
          if (watched) {
            watch.pending--;
            watch.status = res?.status ?? 0;
            watch.settled++;
          }
          try { pageNet.events.dispatchEvent(new CustomEvent('settled', { detail: { path, method, status: res?.status ?? 0 } })); } catch {}
        }
        if (path === '/api/characters' || isDetail) {
          try { res.clone().text().then((t) => { if (!isDetail || request === detailRequest) onApiData(u, t); }).catch(() => {}); } catch {}
        }
        return res;
      };
    }
  } catch {}

  const charPollKey = 'roi-char-poll-v1';
  const canShareCharPoll = () => typeof navigator.locks?.request === 'function' &&
    typeof GM_addValueChangeListener === 'function';
  let nativeRosterIds = null;
  let lastSharedCharPollAt = 0;
  let polledRoster = false;
  let charPollBusy = false;
  const charPollInterval = TIMING.charPollInterval;
  // 重用門檻須小於輪詢間隔，否則計時器準時觸發時會跳過自己上一輪的結果，實際週期變成 90 秒。
  const charPollReuseMs = charPollInterval - TIMING.charPollReuseMargin;
  const localZenyAt = new Map();

  function validateCharPoll(data) {
    if (!data || !Number.isSafeInteger(data.at) || data.at <= 0 || data.at > Date.now() ||
        !Array.isArray(data.characters) || data.characters.length > 12 ||
        !data.characters.every(c => c && positiveId(c.id) && typeof c.name === 'string' &&
          typeof c.running === 'boolean') || !isPlainRecord(data.zeny)) return null;
    return data;
  }

  function readSharedCharPoll() {
    try { return validateCharPoll(GM_getValue(charPollKey, null)); }
    catch { return null; }
  }

  function matchesCharAccount(characters) {
    if (nativeRosterIds) return characters.some(c => nativeRosterIds.has(Number(c.id)));
    return state.activeCharId != null && characters.some(c => Number(c.id) === state.activeCharId);
  }

  function applySharedCharPoll(data) {
    if (!data || data.at <= lastSharedCharPollAt || Date.now() - data.at >= 45000 ||
        !matchesCharAccount(data.characters)) return;
    lastSharedCharPollAt = data.at;
    applyCharRoster(data.characters, false);
    applyPollZeny(data);
  }

  function applyPollZeny({ at, characters, zeny }) {
    for (const { id } of characters) {
      const balance = zeny[id];
      if (!Number.isSafeInteger(balance) || balance < 0 || (localZenyAt.get(Number(id)) ?? 0) >= at) continue;
      // 本頁目前角色由前景 API／攤位快照維護 curZeny；輪詢值（deferCatchup）只寫清單會讓清單與儀表盤餘額互相跳動。
      if (Number(id) === state.activeCharId && localZenyAt.has(Number(id))) continue;
      state.charZenyMap[id] = balance;
      state.initZenyMap[id] ??= balance;
    }
    renderChars();
  }

  async function fetchCharPoll(allBalances = true) {
    const at = Date.now();
    const signal = globalThis.AbortSignal?.timeout?.(15000);
    const response = await pollFetch('/api/characters', { signal });
    if (!response.ok) return null;
    const { characters } = await response.json();
    const data = validateCharPoll({ at, characters, zeny: {} });
    if (!data) return null;
    const queue = characters.filter(c => allBalances || state.charZenyMap[c.id] === undefined);
    async function readBalances() {
      while (queue.length) {
        const id = Number(queue.shift().id);
        try {
          const response = await pollFetch(`/api/characters/${id}?deferCatchup=1`, { signal });
          if (!response.ok) continue;
          const detail = await response.json();
          const balance = detail.snapshot?.character?.zeny;
          if (Number(detail.characterId) === id && Number.isSafeInteger(balance) && balance >= 0) data.zeny[id] = balance;
        } catch {}
      }
    }
    await Promise.all(Array.from({ length: Math.min(3, queue.length) }, readBalances));
    return data;
  }

  async function pollChars() {
    if (document.hidden || charPollBusy) return;
    charPollBusy = true;
    try {
      if (canShareCharPoll()) {
        await navigator.locks.request('roi-leader', { ifAvailable: true }, async lock => {
          if (!lock || document.hidden) return;
          const previous = readSharedCharPoll();
          if (previous && Date.now() - previous.at < charPollReuseMs && matchesCharAccount(previous.characters)) {
            applySharedCharPoll(previous);
            return;
          }
          // 已驗證的名單和快取同帳號時才可跳過請求；未辨識角色讓原生 API 建立身分。
          if (previous && Date.now() - previous.at < charPollReuseMs && !nativeRosterIds && state.activeCharId == null) return;
          const data = await fetchCharPoll();
          if (!data) return;
          nativeRosterIds = new Set(data.characters.map(c => Number(c.id)));
          const sameAccount = previous?.characters.some(c => nativeRosterIds.has(Number(c.id)));
          // 只有最近兩輪內的共享名單可作為停機比較基準，避免重開頁面時把數小時前的狀態當成剛停機。
          const baseline = sameAccount && Date.now() - previous.at < charPollInterval * 2 ? previous.characters : state.chars;
          GM_setValue(charPollKey, data);
          lastSharedCharPollAt = data.at;
          applyCharRoster(data.characters, true, baseline);
          applyPollZeny(data);
        });
        return;
      }
      if (polledRoster && !document.hasFocus()) {
        let elapsed = Infinity;
        try { elapsed = Date.now() - Number(localStorage.getItem('roi-last-chars-poll-at')); } catch {}
        if (elapsed >= 0 && elapsed < 12000) return;
      }
      const data = await fetchCharPoll(false);
      if (!data) return;
      polledRoster = true;
      try { localStorage.setItem('roi-last-chars-poll-at', String(Date.now())); } catch {}
      applyCharRoster(data.characters, true);
      applyPollZeny(data);
    } catch {}
    finally { charPollBusy = false; }
  }
