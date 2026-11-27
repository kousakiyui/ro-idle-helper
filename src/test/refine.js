
  const isEligibleEquip = (r) => canRefine(r.st);

  const refineRowsForPage = (rows) => rows.filter((row) =>
    isEligibleEquip(row) && (refCategory === 'all' || refineCategory(refinePack.items.get(row.st.itemId)) === refCategory));

  function findNativeDetailBtn(table, uid, matcher) {
    if (table.matches('[aria-label="道具"]')) {
      const detail = table.parentElement?.querySelector(':scope > [role="region"][aria-label="道具詳情"]');
      const close = detail && uniqueVisible(detail, 'button[aria-label="關閉物品資訊"]');
      const props = close && getCommittedProps(close, (p) => p.uid === uid && typeof p.onClose === 'function');
      if (!props) return null;
      if (!matcher) return close;
      const buttons = [...detail.querySelectorAll('button')].filter((el) => visible(el) && matcher(clean(el.textContent)));
      return buttons.length === 1 ? buttons[0] : null;
    }
    const tree = currentFiberRoot(table);
    if (!tree) return null;
    const budget = createFiberScanBudget(table, detailScanRetries);
    const search = (root, limit) => {
      const stack = [{ fiber: root, matching: false }];
      while (stack.length && limit-- > 0) {
        budget.step();
        const { fiber, matching } = stack.pop();
        const props = fiber.memoizedProps;
        const inDetail = matching || (props?.uid === uid &&
          (props.s?.inventory || typeof props.onClose === 'function'));
        const el = fiber.stateNode;
        if (inDetail && el?.tagName === 'BUTTON' && visible(el) && (!matcher || matcher(clean(el.textContent)))) return el;
        if (fiber.child) stack.push({ fiber: fiber.child, matching: inDetail });
        if (fiber !== root && fiber.sibling) stack.push({ fiber: fiber.sibling, matching });
      }
      return null;
    };
    const host = bagMemo?.table === table ? bagMemo.val.host : table;
    let local = getReactFiber(host);
    if (local) {
      let root = local;
      while (root.return) root = root.return;
      if (root !== tree) local = local.alternate;
    }
    const result = (local && search(local, 10000)) || search(tree, 80000);
    budget.complete();
    return result;
  }

  let refineIdentityEpoch = 0;
  async function readRefineDetail(table, uid, matcher, session) {
    for (let attempt = 0; ; attempt++) {
      try { return findNativeDetailBtn(table, uid, matcher); }
      catch (error) {
        if (!(error instanceof FiberTraversalTimeout) || attempt >= 3) throw error;
      }
      await new Promise(resolve => {
        const frame = requestAnimationFrame(() => { clearTimeout(timer); resolve(); });
        const timer = setTimeout(() => { cancelAnimationFrame(frame); resolve(); }, 100);
      });
      assertRefineTarget(session, uid);
      if (!table.isConnected) throw Error('原生操作按鈕已變動，已停止');
    }
  }

  const positiveId = (value) => (typeof value === 'number' || (typeof value === 'string' && /^[1-9]\d*$/.test(value))) &&
    Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : null;
  const snapshotCharacterId = (s) => positiveId(s?.character?.id ?? s?.characterId ?? s?.character?.characterId);
  let refineNativeStore = null;

  // requireExactSnapshot=false：遊戲先寫入 store、React 尚未提交時，背包 Fiber 仍是上一份 snapshot；
  // 只要兩份 snapshot 沒有身分矛盾（角色 ID／名稱不同），就以 store 的 characterId 為準。
  function nativeStoreActor(store, snapshot, requireExactSnapshot = true) {
    if (!store || typeof store.getState !== 'function' || typeof store.subscribe !== 'function' ||
        typeof store.getInitialState !== 'function' || typeof store.setState !== 'function') return null;
    try {
      const state = store.getState();
      if (!state?.snapshot?.character || !Array.isArray(state.snapshot.inventory)) return null;
      if (snapshot && state.snapshot !== snapshot) {
        if (requireExactSnapshot) return null;
        const knownId = snapshotCharacterId(snapshot), liveId = snapshotCharacterId(state.snapshot);
        const knownName = snapshot.character?.name, liveName = state.snapshot.character?.name;
        if ((knownId && liveId && knownId !== liveId) || (knownName && liveName && knownName !== liveName)) return null;
      }
      return positiveId(state.characterId);
    } catch { return null; }
  }

  function findRefineNativeStore(host, snapshot) {
    const root = currentFiberRoot(host);
    if (!root) return null;
    let route = fiberRouteMap.get(host);
    let fiber = root;
    for (const step of route ?? []) fiber = step === 'c' ? fiber?.child : fiber?.sibling;
    if (fiber?.stateNode !== host) {
      // 背包的 snapshot 可來自 Hook，未必存在符合條件的祖先 props，
      // 因此不能假設 readBackpackContext 已建立這條 DOM 路徑快取。
      getCommittedProps(host, () => true);
      route = fiberRouteMap.get(host);
      if (!route) return null;
      fiber = root;
      for (const step of route) fiber = step === 'c' ? fiber?.child : fiber?.sibling;
    }
    if (fiber?.stateNode !== host) return null;
    // 遊戲以 Zustand 分開保存 characterId 與 snapshot。
    // 只讀目前背包／倉庫祖先的 Hook 依賴，並核對同一份 snapshot。
    for (let depth = 0; fiber && depth < 80; depth++, fiber = fiber.return) {
      if (typeof fiber.type !== 'function') continue;
      let hook = fiber.memoizedState;
      for (let count = 0; hook && count < 200; count++, hook = hook.next) {
        const memo = hook.memoizedState;
        const deps = Array.isArray(memo) && Array.isArray(memo[1]) ? memo[1] : [];
        for (const candidate of deps) {
          if (nativeStoreActor(candidate, snapshot)) return candidate;
        }
      }
    }
    return null;
  }

  function refineActor(context) {
    const direct = snapshotCharacterId(context?.s);
    if (direct) return direct;
    const cached = nativeStoreActor(refineNativeStore, context?.s, false);
    if (cached) return cached;
    const host = context?.table || [...document.querySelectorAll('fieldset')].find((field) =>
      visible(field) && /^倉庫(?:\s*[（(]|$)/.test(clean(field.querySelector('legend')?.textContent)));
    const props = host && getCommittedProps(host, (p) => Boolean((p?.s ?? p?.snap)?.character));
    const snapshot = context?.s ?? props?.s ?? props?.snap;
    const actor = snapshotCharacterId(snapshot) || positiveId(props?.characterId ?? props?.charId);
    if (actor) return actor;
    // 找不到新的 store 時保留原本已驗證的快取，避免一次落差就清掉身分來源。
    const found = host && findRefineNativeStore(host, snapshot);
    if (found) refineNativeStore = found;
    return nativeStoreActor(found || refineNativeStore, snapshot, false);
  }

  // 測試版診斷：預設關閉（localStorage roi-refine-diag=1 或面板開關）。只留最近 30 筆，
  // 只存布林、數字與固定階段名稱，不含玩家名稱、角色識別碼、憑證或 API 回應內容。
  const refineBuild = '3.5.8.11-test';
  const refineDiagLimit = 30;
  const refineDiagLog = [];
  let refineDiagStart = 0;
  const refineDiagEnabled = () => { try { return localStorage.getItem('roi-refine-diag') === '1'; } catch { return false; } };
  function refineDiagReset() { refineDiagLog.length = 0; refineDiagStart = performance.now(); }
  function refineDiag(stage, event, detail = {}) {
    if (!refineDiagEnabled()) return;
    const entry = { t: Math.round(performance.now() - refineDiagStart), stage, event };
    for (const [key, value] of Object.entries(detail)) {
      if (typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) entry[key] = value;
      else if (key === 'reason' && typeof value === 'string') entry.reason = value.replace(/【[^】]*】/g, '【…】').slice(0, 48);
    }
    refineDiagLog.push(entry);
    if (refineDiagLog.length > refineDiagLimit) refineDiagLog.shift();
  }
  const refineDiagSummary = () => {
    const stop = [...refineDiagLog].reverse().find((entry) => entry.stage === 'stop');
    return JSON.stringify({ build: refineBuild, stopStage: stop?.event ?? null, stopReason: stop?.reason ?? null, events: refineDiagLog }, null, 1);
  };

  const refineItemSignature = (item) => JSON.stringify([item.itemId, item.cards ?? [], item.forged ?? null]);
  function assertRefineRun(session, allowStopped) {
    if (!allowStopped && refStop) throw Error(refStopReason === 'left_backpack' ? '已離開背包頁面' : '已手動停止精煉');
    if (document.hidden) throw Error('遊戲分頁已切到背景');
    if (!session || session.epoch !== refineIdentityEpoch ||
        (state.activeCharId != null && Number(state.activeCharId) !== session.characterId)) {
      throw Error('偵測到角色切換，已停止精煉');
    }
  }

  function assertRefineSession(session, allowStopped = false) {
    assertRefineRun(session, allowStopped);
    const context = readBackpackContext(true);
    if ((session.modern && !context) || (context && session.modern !== undefined && Boolean(context.modern) !== session.modern)) {
      refineDiag('session', 'ui_switched', { hasContext: Boolean(context) });
      throw Error('背包介面已切換，已停止');
    }
    const actor = refineActor(context);
    if (actor !== session.characterId) {
      refineDiag('session', 'actor_unconfirmed', { actorKnown: actor != null, hasStore: refineNativeStore != null, hasContext: Boolean(context), hidden: document.hidden });
      throw Error('無法確認仍是起始角色，已停止');
    }
    return context;
  }

  function assertRefineTarget(session, uid, allowMissing = false) {
    assertRefineSession(session, session.restoring === true);
    const b = readBackpackContext(true);
    const item = b?.s.inventory.find((stack) => stack.uid === uid);
    if (!item && allowMissing) return b;
    if (!item || session.items.get(uid) !== refineItemSignature(item)) throw Error('目標裝備已變動，已停止');
    return b;
  }

  async function refineAwait(session, promise, allowStopped = false) {
    const value = await promise;
    assertRefineSession(session, allowStopped || session.restoring === true);
    if (session.targetUid != null) assertRefineTarget(session, session.targetUid, true);
    return value;
  }

  function clickRefineControl(session, button, uid) {
    assertRefineSession(session, session.restoring === true);
    if (uid != null) assertRefineTarget(session, uid);
    if (!button?.isConnected || button.disabled) throw Error('原生操作按鈕已變動，已停止');
    button.click();
  }

  let lastRefineCommandAt = -Infinity;
  async function waitForRefineCommandSlot(session) {
    let remaining = TIMING.refineCommandGap - (performance.now() - lastRefineCommandAt);
    while (remaining > 0) {
      await refineAwait(session, sleep(remaining));
      remaining = TIMING.refineCommandGap - (performance.now() - lastRefineCommandAt);
    }
    assertRefineSession(session, session.restoring === true);
  }

  function clickRefineCommand(session, button, uid) {
    // Reserve the slot before dispatching the native click, including synchronous responses.
    lastRefineCommandAt = performance.now();
    clickRefineControl(session, button, uid);
  }

  function stopRefine(reason = 'manual') {
    refStop = true;
    refStopReason = reason;
    pageNet.events.dispatchEvent(new Event('ui-abort'));
  }

  function waitForRefineUi(session, check, options = {}) {
    const { root, timeout, allowStopped = false } = options;
    return waitForUi(expired => {
      assertRefineSession(session, allowStopped || session.restoring === true);
      return check(expired);
    }, {
      root, timeout,
      shouldAbort: () => assertRefineRun(session, allowStopped || session.restoring === true)
    });
  }

  async function selectBagItemRow(uid, session) {
    assertRefineTarget(session, uid);
    const b = readBackpackContext(true);
    const row = b?.rows.find((r) => r.uid === uid);
    const btn = row?.button || (row && [...row.row.querySelectorAll('td button')].find((x) => !x.disabled && !x.closest('[data-roi-refine-helper]')));
    if (!btn) throw Error('找不到該裝備列');
    if (!findNativeDetailBtn(b.table, uid)) clickRefineControl(session, btn, uid);
    const detail = await waitForRefineUi(session, () => {
      const live = assertRefineTarget(session, uid);
      return live && findNativeDetailBtn(live.table, uid) && live;
    }, { timeout: 2400 });
    if (!detail) throw Error('找不到該裝備明細');
    return detail;
  }

  async function equipItemByUid(uid, session) {
    let b = await refineAwait(session, selectBagItemRow(uid, session));
    b = assertRefineTarget(session, uid);
    if (Object.values(b.s.equipment || {}).includes(uid)) return b;
    const eqBtn = await readRefineDetail(b.table, uid, (t) => t === '裝備', session);
    if (!eqBtn || eqBtn.disabled) throw Error('此職業無法穿戴該裝備進行忽克連精煉');
    await waitForRefineCommandSlot(session);
    b = assertRefineTarget(session, uid);
    if (Object.values(b.s.equipment || {}).includes(uid)) return b;
    const watch = { type: 'equip', characterId: session.characterId, uid, pending: 0, settled: 0, status: 0 };
    refineCommandWatch = watch;
    try {
      clickRefineCommand(session, findNativeDetailBtn(b.table, uid, t => t === '裝備'), uid);
      const equipped = await waitForRefineUi(session, () => {
        const live = assertRefineTarget(session, uid);
        if (watch.settled && !watch.pending && watch.status >= 400 && watch.status < 500)
          throw Error('穿戴請求被拒絕（HTTP ' + watch.status + '），請查看遊戲提示');
        return live && Object.values(live.s.equipment || {}).includes(uid) && live;
      }, { root: b.host?.parentElement, timeout: 10000 });
      if (!equipped) throw Error(!watch.commandId ? '未觀察到穿戴請求，請查看遊戲提示'
        : watch.status >= 200 && watch.status < 300 ? '穿戴已回應，背包尚未確認指定裝備'
        : '穿戴請求結果不明，請核對裝備欄');
      return equipped;
    } finally {
      refineDiag('equip', 'end', { sent: Boolean(watch.commandId), status: watch.status });
      refineCommandWatch = null;
    }
  }

  function planRefineWithdrawal(storage, snapshot, wantedItemIds, targetPlusLimit, limitsById, maxItems, materialQuantity) {
    if (!Array.isArray(storage?.items) || !isPlainRecord(storage.fees)) throw Error('無法確認倉庫庫存');
    if (materialQuantity !== null && !validMaterialBatch(materialQuantity)) throw Error('領料數量不正確');
    const sids = new Set();
    const candidates = storage.items.filter((item) => {
      if (!item || !wantedItemIds.has(item.itemId)) return false;
      if (!Number.isSafeInteger(item.sid) || item.sid <= 0 || sids.has(item.sid) ||
          !Number.isSafeInteger(item.qty) || item.qty <= 0) throw Error('無法確認倉庫物品或數量');
      sids.add(item.sid);
      if (materialQuantity !== null) return refinePack.items.get(item.itemId)?.category === 'material';
      return item.qty === 1 && canRefine(item) && (item.refine ?? 0) < (limitsById ? limitsById.get(item.itemId) ?? 0 : targetPlusLimit);
    }).sort((a, b) => a.itemId - b.itemId || (a.refine ?? 0) - (b.refine ?? 0) || a.sid - b.sid);
    if (!candidates.length) return [];

    const fee = Object.hasOwn(storage.fees, snapshot.mapId) ? storage.fees[snapshot.mapId] : null;
    if (!Number.isSafeInteger(fee) || fee < 0 || snapshot.activity === 'dead') throw Error('目前無法使用城鎮倉庫');
    if (!(snapshot.character.zeny >= fee)) throw Error('Zeny 不足以支付倉庫費');
    const maxWeight = snapshot.derived?.weightMax;
    if (!Number.isFinite(snapshot.weight) || snapshot.weight < 0 ||
        !Number.isFinite(maxWeight) || maxWeight <= 0 || !Array.isArray(snapshot.inventory)) throw Error('無法確認背包剩餘容量');
    let freeUnits = Math.round(maxWeight * 10) - Math.round(snapshot.weight * 10);
    let freeSlots = 100 - snapshot.inventory.length;
    const picked = [];
    for (const item of candidates) {
      const weight = refinePack.items.get(item.itemId)?.weight;
      if (!Number.isFinite(weight) || weight < 0) throw Error('無法確認物品重量');
      const units = Math.round(weight * 10);
      const merge = materialQuantity !== null && snapshot.inventory.some(stack => stack.itemId === item.itemId &&
        Boolean(stack.locked) === Boolean(item.locked) && Boolean(stack.bound) === Boolean(item.bound) &&
        (stack.expiresWallMs ?? 0) === (item.expiresWallMs ?? 0));
      if (freeSlots <= 0 && !merge) continue;
      if (freeUnits < 0) break;
      const capacity = units ? Math.floor(freeUnits / units) : item.qty;
      const quantity = Math.min(materialQuantity ?? 1, item.qty, capacity);
      if (quantity < 1) continue;
      picked.push({ sid: item.sid, id: item.itemId, refine: item.refine ?? 0, quantity });
      freeUnits -= quantity * units;
      if (!merge) freeSlots--;
      if (picked.length >= maxItems || materialQuantity !== null) break;
    }
    if (!picked.length) throw Error('背包空間或負重不足，無法領倉');
    return picked;
  }

  async function tryWithdrawFromWarehouse(wantedItemIds, targetPlusLimit, setStatus, limitsById, maxItems = 15, session, materialQuantity = null) {
    const readBackpack = () => {
      const b = session.targetUid != null ? assertRefineTarget(session, session.targetUid) : assertRefineSession(session);
      if (!b) throw Error('請保持原角色的背包頁開啟');
      return b;
    };
    const start = readBackpack();
    const uid = session.targetUid;
    const targetRefine = uid == null ? null : start.s.inventory.find(item => item.uid === uid).refine ?? 0;
    await waitForRefineCommandSlot(session);
    const { storage } = await partyApiJson('/api/storage');
    readBackpack();
    const id = session.characterId;
    const server = await partyApiJson(`/api/characters/${id}?deferCatchup=1`);
    const live = readBackpack();
    const snapshot = server?.snapshot;
    if (Number(server?.characterId) !== id || !snapshot?.character || !Number.isSafeInteger(server.commandRevision) ||
        live.s.mapId !== snapshot.mapId || (uid != null &&
          (live.s.inventory.find(item => item.uid === uid)?.refine ?? 0) !== targetRefine)) {
      throw Error('角色狀態或目標已變動，已停止領倉');
    }
    if (uid != null) {
      const item = snapshot.inventory?.find?.(stack => stack.uid === uid);
      if (!item || refineItemSignature(item) !== session.items.get(uid) || (item.refine ?? 0) !== targetRefine) {
        throw Error('伺服器上的精煉目標已變動，已停止領倉');
      }
    }
    const picked = planRefineWithdrawal(storage, snapshot, wantedItemIds, targetPlusLimit, limitsById, maxItems, materialQuantity);
    if (!picked.length) return [];
    const quantity = picked.reduce((total, item) => total + item.quantity, 0);
    setStatus(materialQuantity === null ? `📦 背景領取 ${picked.length} 件裝備` : `📦 背景領取 ${quantity} 個材料`);
    const items = picked.map(({ sid, quantity: qty }) => ({ sid, qty }));
    readBackpack();
    lastRefineCommandAt = performance.now();
    try {
      await partyCommand(id, { type: 'storageWithdraw', items }, server.commandRevision);
    } catch (error) {
      if (error.status >= 400 && error.status < 500 && error.status !== 408 && error.code !== 'INVALID_RESPONSE') throw error;
      throw Error('領倉結果不明，請確認背包與倉庫。此批不會重送。');
    }
    // 送出後的入帳驗證由呼叫端依材料數量或新增裝備 UID 進行。
    return picked;
  }

  const isWeaponRefineButton = (text) => /^武器精[練煉]\s*\(\s*技能(?:[,\s)]|$)/.test(text);
  const isNpcRefineButton = (text) => /^請.+精[煉練]$/.test(text);
  const weaponRefineLevel = (snapshot) => snapshot.character.skills?.WS_WEAPONREFINE ?? 0;
  const materialCount = (inventory, id) => inventory.reduce((sum, item) =>
    item.itemId === id && Number.isSafeInteger(item.qty) && item.qty > 0 ? sum + item.qty : sum, 0);

  function safeRefineCost(steps, from, to) {
    if (!steps || !Number.isSafeInteger(to) || to <= from || to > steps.length) return null;
    const materials = new Map();
    let zeny = 0;
    for (const step of steps.slice(from, to)) {
      if (!step || step.rate !== 100 || !positiveId(step.material) || !Number.isSafeInteger(step.price) || step.price < 0) return null;
      zeny += step.price;
      materials.set(step.material, (materials.get(step.material) ?? 0) + 1);
    }
    return { materials, zeny };
  }

  // 已付費、材料已扣、等級未升，且點擊後遊戲送出的請求都已回應（且之後沒有新的回應）時，
  // 不同事件喚醒的連續兩讀一致才提前判定；8 秒上限會再做一次最終確認。
  function refineNoUpgradeSettled(gate, confirmed, net) {
    if (!confirmed || net.inFlight > 0 || net.settled <= gate.since) { gate.candidate = null; return false; }
    if (gate.candidate === net.settled) return true;
    gate.candidate = net.settled;
    return false;
  }

  async function waitForRefineMaterial(session, id, expectedQty) {
    let backpackReady = false;
    try {
      const received = await waitForRefineUi(session, () => {
        const b = readBackpackContext(true);
        backpackReady = Boolean(b);
        return b && materialCount(b.s.inventory, id) >= expectedQty;
      }, { timeout: 4000 });
      if (received) return;
    } catch (error) {
      throw Error(`已送出領倉，確認入帳時停止（${error.message}）。請確認背包與倉庫。`);
    }
    throw Error(backpackReady
      ? '已送出領倉，但材料入帳逾時。請確認背包與倉庫。'
      : '已送出領倉，但等待入帳逾時時背包介面仍未就緒。請確認背包與倉庫。');
  }

  async function replenishRefineMaterials(session, uid, refine, materials, setStatus) {
    const readInventory = () => {
      const { inventory } = assertRefineTarget(session, uid).s;
      if ((inventory.find((item) => item.uid === uid).refine ?? 0) !== refine) throw Error('補料期間裝備精煉值已變動');
      return inventory;
    };
    for (const [id, required] of materials) {
      let quantity = materialCount(readInventory(), id);
      while (quantity < required) {
        const picked = await tryWithdrawFromWarehouse(new Set([id]), 10, setStatus, null, 1, session, refMaterialBatch);
        const expected = quantity + (picked[0]?.quantity ?? 0);
        if (picked.length) await waitForRefineMaterial(session, id, expected);
        const received = materialCount(readInventory(), id);
        if (!picked.length) return id;
        if (expected <= quantity || received < expected) throw Error('補料後無法確認背包材料增加，已停止');
        quantity = received;
      }
    }
    return null;
  }

  function waitForRefineResult(session, uid, options) {
    const { root, curPlus, material, beforeMatQty, beforeZeny, beforeSp, useSkill, settleGate, commandWatch } = options;
    let previouslyConfirmed = false;
    const skillMaterialGate = { since: settleGate.since, candidate: null };
    let previousMaterialOutcome = null;
    return waitForRefineUi(session, expired => {
      const b = assertRefineTarget(session, uid, true);
      const nowSt = b?.s.inventory.find(x => x.uid === uid);
      if (!b) {
        previouslyConfirmed = false;
        settleGate.candidate = skillMaterialGate.candidate = null;
        previousMaterialOutcome = null;
        return null;
      }
      const tracked = Boolean(commandWatch?.commandId);
      const net = tracked
        ? { inFlight: commandWatch.pending, settled: settleGate.since + commandWatch.settled }
        : pageNet;
      const acknowledged = !tracked || (commandWatch.status >= 200 && commandWatch.status < 300 && net.inFlight === 0);
      if (tracked && (commandWatch.status === 429 || (expired && commandWatch.status >= 400 && commandWatch.status < 500))
          && net.inFlight === 0) {
        throw Error(`神工匠精練請求被拒絕（HTTP ${commandWatch.status}），請查看遊戲提示`);
      }
      const paid = useSkill ? b.s.character.sp <= beforeSp - 5 : b.s.character.zeny < beforeZeny;
      if (nowSt && (nowSt.refine || 0) === curPlus + 1) return { kind: 'success', b, nowSt };
      if (!nowSt && paid && acknowledged) return { kind: 'broken', b };
      const materialUsed = Boolean(material && materialCount(b.s.inventory, material) < beforeMatQty);
      const atOrBelow = nowSt && (nowSt.refine || 0) <= curPlus;
      // A recovered SP value can hide the skill cost. Confirm the same equipment
      // outcome twice against the depleted ore and a settled request.
      const materialOutcome = useSkill && acknowledged && materialUsed ?
        (!nowSt ? 'broken' : atOrBelow ? 'failed' : null) : null;
      if (materialOutcome !== previousMaterialOutcome) skillMaterialGate.candidate = null;
      previousMaterialOutcome = materialOutcome;
      if (refineNoUpgradeSettled(skillMaterialGate, Boolean(materialOutcome), net)
          || (expired && tracked && materialOutcome && acknowledged)) return { kind: materialOutcome, b };
      const confirmedNoUpgrade = Boolean(acknowledged && atOrBelow && paid && (!material || materialUsed));
      if (refineNoUpgradeSettled(settleGate, confirmedNoUpgrade, net) ||
          (expired && previouslyConfirmed && confirmedNoUpgrade && net.inFlight === 0)) return { kind: 'failed', b };
      previouslyConfirmed = confirmedNoUpgrade;
      return null;
    }, { root, timeout: 8000 });
  }

  async function runHybridRefine(modeType) {
    if (refBusy) return;
    refStop = false; refStopReason = null;
    const setStatus = (msg) => { if (!refPanel?.isConnected) refreshRefinePanel(); const el = refPanel?.querySelector('[data-ref-status]'); if (el) el.textContent = msg; };
    let b, characterId;
    try {
      b = readBackpackContext(true);
      if (!b) return;
      characterId = refineActor(b);
    } catch (error) {
      if (!(error instanceof FiberTraversalTimeout)) throw error;
      return setStatus('⚠️ ' + error.message);
    }
    if (!characterId) return setStatus('⚠️ 無法確認目前角色 ID，已停止');
    const session = {
      characterId, epoch: refineIdentityEpoch, targetUid: null, modern: Boolean(b.modern),
      items: new Map(b.s.inventory.map((item) => [item.uid, refineItemSignature(item)]))
    };
    try { assertRefineSession(session); }
    catch (error) { setStatus('⚠️ ' + error.message); return; }

    if (!refinePack) {
      refBusy = true;
      try { refinePack = await refineAwait(session, loadLootPack()); }
      catch (e) { setStatus('⚠️ 無法載入精煉資料：' + e.message); return; }
      finally { refBusy = false; }
    }
    b = readFiberForUi(() => readBackpackContext(true));
    if (b === undefined) return setStatus('⚠️ 介面讀取逾時，請稍後再試');
    if (!b) return setStatus('⚠️ 背包已關閉');

    const autoWarehouse = refAutoWh && !b.modern;
    const skillOnly = modeType === 'skill_only';
    const limitPlus = modeType === 'safe_only' ? 10
      : skillOnly ? Math.min(refTargetPlus, weaponRefineLevel(b.s)) : refTargetPlus;
    const canUseSkill = (row) => {
      const item = refinePack?.items.get(row.st.itemId);
      return item?.weaponType !== undefined && (row.st.refine ?? 0) < limitPlus;
    };
    const initJobs = b.rows.filter((r) => isEligibleEquip(r) && refSelected.has(r.uid) && (!skillOnly || canUseSkill(r)));
    if (!initJobs.length) return setStatus(skillOnly
      ? '⚠️ 請勾選低於目標與武器精練技能上限的武器'
      : '⚠️ 請先在下方清單勾選要精煉的裝備！');
    const runUids = new Set(initJobs.map((r) => r.uid));
    const trackedItemIds = new Set(initJobs.map((r) => r.st.itemId));

    const origEquip = { ...(b.s.equipment || {}) };
    const safeLimits = new Map(), skipped = new Set();
    let stopReason = null;
    let changedEquip = false, successCnt = 0, brokenCnt = 0, failedCnt = 0;
    refBusy = true; refStop = false; refStopReason = null; refreshRefinePanel();
    refineDiagReset();
    let stage = 'prepare';
    refineDiag('run', 'start', { skipConfirm: refSkipConfirm, autoWarehouse });

    try {
      while (!refStop) {
        assertRefineSession(session);
        b = readBackpackContext(true);
        if (!b) throw Error('已離開背包頁面');

        let pool = b.rows.filter((r) => isEligibleEquip(r) && runUids.has(r.uid) && refSelected.has(r.uid));
        pool = pool.filter((r) => !skipped.has(r.uid) && (r.st.refine || 0) < limitPlus);

        if (!pool.length && autoWarehouse) {
          session.targetUid = null;
          stage = 'withdraw_equipment';
          const before = new Set(b.s.inventory.map((x) => x.uid));
          const picked = await tryWithdrawFromWarehouse(trackedItemIds, limitPlus, setStatus, modeType === 'safe_only' ? safeLimits : null, 15, session);
          assertRefineSession(session);
          if (picked.length) {
            const expected = picked.map((x) => `${x.id}:${x.refine}`).sort().join(',');
            const received = await waitForRefineUi(session, () => {
              b = readBackpackContext(true);
              const added = b?.s.inventory.filter(x => !before.has(x.uid) && trackedItemIds.has(x.itemId)) || [];
              return added.map(x => `${x.itemId}:${x.refine || 0}`).sort().join(',') === expected ? added : null;
            }, { timeout: 4000 });
            if (!received) throw Error('領取後背包新增的裝備與本批不符，請確認背包');
            for (const x of received.filter(item => canRefine(item) && (item.refine || 0) < limitPlus)) {
              session.items.set(x.uid, refineItemSignature(x));
              runUids.add(x.uid); refSelected.add(x.uid);
            }
            if (!b.rows.some((r) => runUids.has(r.uid) && refSelected.has(r.uid) && isEligibleEquip(r) && (r.st.refine || 0) < limitPlus)) {
              throw Error('領出的裝備未出現在可精煉清單');
            }
            continue;
          }
        }
        if (!pool.length) break;

        if (refMode === 'single_focus') pool.sort((a, b) => (b.st.refine || 0) - (a.st.refine || 0));
        else pool.sort((a, b) => (a.st.refine || 0) - (b.st.refine || 0));

        const target = pool[0], uid = target.uid, curPlus = target.st.refine || 0;
        session.targetUid = uid;
        stage = 'select';
        b = await refineAwait(session, selectBagItemRow(uid, session));
        if (!b) throw Error('已離開背包頁面');

        const recipeItem = refinePack?.items?.get(target.st.itemId);
        const weaponLevel = Math.min(4, Math.max(1, recipeItem?.weaponLevel ?? 1));
        const steps = recipeItem?.slots?.includes('weapon') ? refinePack?.refine?.weapon?.[weaponLevel] : refinePack?.refine?.armor;
        const step = steps?.[curPlus];
        const material = step?.material;
        const isSafeButton = (t) => /^一鍵精煉到安全值\s*\+\d+/.test(t);
        let safeBtn = !skillOnly && await readRefineDetail(b.table, uid, isSafeButton, session);
        const nativeLimit = Number(clean(safeBtn?.textContent).match(/\+(\d+)/)?.[1]);
        if (modeType === 'safe_only' && nativeLimit > 0) safeLimits.set(target.st.itemId, nativeLimit);
        let unavailableMaterial = null;
        if (autoWarehouse && safeBtn?.disabled && curPlus < nativeLimit && (modeType === 'safe_only' || nativeLimit <= limitPlus)) {
          const cost = safeRefineCost(steps, curPlus, nativeLimit);
          if (cost && b.s.character.zeny >= cost.zeny &&
              [...cost.materials].some(([id, count]) => materialCount(b.s.inventory, id) < count)) {
            unavailableMaterial = await replenishRefineMaterials(session, uid, curPlus, cost.materials, setStatus);
            b = await refineAwait(session, selectBagItemRow(uid, session));
            safeBtn = await readRefineDetail(b.table, uid, isSafeButton, session);
          }
        }
        if (safeBtn && !safeBtn.disabled) {
          const safeTarget = Number(safeBtn.textContent.match(/\+(\d+)/)?.[1]) || 4;
          if (curPlus < safeTarget && (modeType === 'safe_only' || safeTarget <= refTargetPlus)) {
            stage = 'safe_refine';
            setStatus(`⚡ 一鍵安全值：【${target.name}】+${curPlus} ➔ +${safeTarget}...`);
            assertRefineRun(session, false);
            await waitForRefineCommandSlot(session);
            const originalConfirm = page.confirm;
            let accepted = true;
            try {
              page.confirm = (message) => {
                if (refSkipConfirm) return true;
                accepted = originalConfirm.call(page, message);
                return accepted;
              };
              if ((assertRefineTarget(session, uid).s.inventory.find((item) => item.uid === uid).refine || 0) !== curPlus) throw Error('精煉值已變動');
              const liveSafeBtn = findNativeDetailBtn(b.table, uid, t => Number(t.match(/^一鍵精煉到安全值\s*\+(\d+)/)?.[1]) === safeTarget);
              clickRefineCommand(session, liveSafeBtn, uid);
            } finally {
              page.confirm = originalConfirm;
            }
            if (!accepted) throw Error('已取消原生安全精煉');
            const confirmed = await waitForRefineUi(session, () => {
              const live = assertRefineTarget(session, uid, true);
              const nowSt = live?.s.inventory.find(x => x.uid === uid);
              return nowSt && (nowSt.refine || 0) >= safeTarget;
            }, { root: b.host?.parentElement, timeout: 6000 });
            if (!confirmed) throw Error(`【${target.name}】安全精煉結果逾時，請確認裝備`);
            successCnt++;
            if (modeType === 'safe_only' || safeTarget === refTargetPlus) refSelected.delete(uid);
            continue;
          }
        }
        if (modeType === 'safe_only') {
          skipped.add(uid);
          if (!safeBtn || (safeBtn.disabled && curPlus < nativeLimit)) safeLimits.delete(target.st.itemId);
          continue;
        }

        let skillBtn = await readRefineDetail(b.table, uid, isWeaponRefineButton, session);
        let npcBtn = skillOnly ? null : await readRefineDetail(b.table, uid, isNpcRefineButton, session);

        if (skillOnly && !skillBtn) {
          changedEquip = true;
          b = await refineAwait(session, equipItemByUid(uid, session));
          skillBtn = await readRefineDetail(b.table, uid, isWeaponRefineButton, session);
        }
        if (!skillOnly && !skillBtn && !npcBtn) {
          changedEquip = true;
          b = await refineAwait(session, equipItemByUid(uid, session));
          npcBtn = await readRefineDetail(b.table, uid, isNpcRefineButton, session);
        }

        let activeBtn = skillBtn && !skillBtn.disabled ? skillBtn : npcBtn;
        if ((!activeBtn || activeBtn.disabled) && autoWarehouse && material && material !== unavailableMaterial &&
            materialCount(b.s.inventory, material) === 0 &&
            ((skillBtn && b.s.character.sp >= 5) || (npcBtn && b.s.character.zeny >= step.price))) {
          stage = 'withdraw_material';
          unavailableMaterial = await replenishRefineMaterials(session, uid, curPlus, new Map([[material, 1]]), setStatus);
          b = await refineAwait(session, selectBagItemRow(uid, session));
          skillBtn = await readRefineDetail(b.table, uid, isWeaponRefineButton, session);
          npcBtn = skillOnly ? null : await readRefineDetail(b.table, uid, isNpcRefineButton, session);
          activeBtn = skillBtn && !skillBtn.disabled ? skillBtn : npcBtn;
        }
        if (!activeBtn || activeBtn.disabled) throw Error(unavailableMaterial && unavailableMaterial === material
          ? `【${target.name}】倉庫沒有可領取的精煉材料` : skillOnly
          ? `【${target.name}】武器精練不可用，請確認技能等級、材料與 SP（至少 5）`
          : `【${target.name}】精煉按鈕不可用（礦石已用盡、Zeny/SP不足或不在主城）`);

        assertRefineRun(session, false);
        const useSkill = activeBtn === skillBtn;
        await waitForRefineCommandSlot(session);
        b = assertRefineTarget(session, uid);
        activeBtn = findNativeDetailBtn(b.table, uid, useSkill ? isWeaponRefineButton : isNpcRefineButton);
        const beforeMatQty = material ? materialCount(b.s.inventory, material) : 0;
        const beforeZeny = b.s.character.zeny, beforeSp = b.s.character.sp;
        stage = 'refine_await';
        setStatus(`🔨 衝裝中：【${target.name}】+${curPlus} ➔ +${curPlus + 1} (成功:${successCnt} 爆:${brokenCnt})`);

        const commandWatch = useSkill ? { characterId: session.characterId, uid, pending: 0, settled: 0, status: 0 } : null;
        let result;
        refineCommandWatch = commandWatch;
        try {
          const origConfirm = page.confirm;
          let userAccepted = true;
          const settleGate = { since: pageNet.settled, candidate: null };
          try {
            page.confirm = (msg) => {
              if (refSkipConfirm || /成功率 100%|一定成功/.test(String(msg))) return true;
              userAccepted = origConfirm.call(page, msg);
              return userAccepted;
            };
            if ((assertRefineTarget(session, uid).s.inventory.find((item) => item.uid === uid).refine || 0) !== curPlus) throw Error('精煉值已變動');
            clickRefineCommand(session, activeBtn, uid);
          } finally {
            page.confirm = origConfirm;
          }
          if (!userAccepted) throw Error('玩家手動取消精煉');

          result = await waitForRefineResult(session, uid, {
            root: b.host?.parentElement, curPlus, material, beforeMatQty, beforeZeny, beforeSp,
            useSkill, settleGate, commandWatch
          });
        } finally {
          refineCommandWatch = null;
        }
        if (!result) throw Error('精煉結果不明，請核對裝備與消耗');
        b = result.b;
        if (result.kind === 'success') {
          successCnt++;
          if (result.nowSt.refine >= limitPlus) {
            refSelected.delete(uid);
            if (autoWarehouse && result.nowSt.refine >= refTargetPlus && !refStop && !document.hidden) {
              stage = 'store';
                const stBtn = await readRefineDetail(b.table, uid, (t) => /^存入倉庫|^存倉$/.test(t), session);
              if (stBtn && !stBtn.disabled) {
                await waitForRefineCommandSlot(session);
                clickRefineCommand(session, findNativeDetailBtn(b.table, uid, t => /^存入倉庫|^存倉$/.test(t)), uid);
                const stored = await waitForRefineUi(session, () => {
                  const live = assertRefineTarget(session, uid, true);
                  return live && !live.s.inventory.some(x => x.uid === uid);
                }, { root: b.host?.parentElement, timeout: 4000 });
                if (!stored) throw Error('存倉結果不明，請核對裝備');
              }
            }
          }
        } else {
          refSelected.delete(uid);
          if (result.kind === 'broken') brokenCnt++;
          else {
            failedCnt++;
            skipped.add(uid);
            setStatus(`⚠️ 【${target.name}】已確認消耗，精煉未升階，繼續下一件`);
          }
        }
        // A committed result (or the settled failure confirmation) is the boundary before the next item.

      }
      if (refStop) throw Error('已中止精煉');
      setStatus(`🎉 精煉完成！累計成功升階 ${successCnt} 次，損壞 ${brokenCnt} 件，未升階 ${failedCnt} 件，略過 ${skipped.size - failedCnt} 件。`);
      alertUser('🎉 背包精煉完成', `成功 ${successCnt} 次 / 損壞 ${brokenCnt} 件 / 未升階 ${failedCnt} 件`, false);
    } catch (e) {
      refineDiag('stop', stage, { hidden: document.hidden, manual: refStop, reason: e?.status ? `HTTP ${e.status}` : String(e?.message) });
      stopReason = `🛑 已停止：${e.message} (成功:${successCnt} 爆:${brokenCnt})`;
      setStatus(stopReason);
    } finally {
      if (changedEquip) {
        session.targetUid = null;
        session.restoring = true;
        const restoreOrder = [origEquip.weapon, ...Object.values(origEquip)];
        const failed = [];
        for (const uid of new Set(restoreOrder.filter(Boolean))) {
          try {
            assertRefineSession(session, true);
            b = readBackpackContext(true);
            if (b?.s.inventory.some((x) => x.uid === uid) && !Object.values(b.s.equipment || {}).includes(uid)) {
              await refineAwait(session, equipItemByUid(uid, session));
            }
          } catch {
            failed.push(uid);
            if (session.epoch !== refineIdentityEpoch ||
                readFiberForUi(() => refineActor(readBackpackContext(true))) !== session.characterId) break;
          }
        }
        if (failed.length) setStatus([stopReason, '⚠️ 有裝備未能穿回，請檢查人物裝備欄'].filter(Boolean).join('｜'));
      }
      refBusy = false;
      refreshRefinePanel();
    }
  }

  function syncRefineSettings(container) {
    if (!container) return;
    const confirm = container.querySelector('[data-roi-ref-confirm]');
    const warehouse = container.querySelector('[data-roi-ref-warehouse]');
    const batch = container.querySelector('[data-roi-ref-batch]');
    confirm.checked = refSkipConfirm;
    const manualWarehouse = Boolean(refPanel?.hasAttribute('data-roi-ref-modern'));
    warehouse.checked = refAutoWh && !manualWarehouse;
    const warehouseHint = manualWarehouse ? '遊戲測試版介面請手動領料與存倉' : '';
    warehouse.title = batch.title = warehouseHint;
    if (batch !== document.activeElement) batch.value = refMaterialBatch;
    confirm.disabled = refBusy;
    warehouse.disabled = batch.disabled = refBusy || manualWarehouse;
  }

  function bindRefineSettings(container, status) {
    const confirm = container.querySelector('[data-roi-ref-confirm]');
    const warehouse = container.querySelector('[data-roi-ref-warehouse]');
    const batch = container.querySelector('[data-roi-ref-batch]');
    confirm.onchange = () => {
      if (!refBusy) refSkipConfirm = confirm.checked;
      syncRefineSettings(refPanel);
      syncRefineSettings(document.getElementById('pane-cfg'));
    };
    warehouse.onchange = () => {
      if (!refBusy) refAutoWh = warehouse.checked;
      syncRefineSettings(refPanel);
      syncRefineSettings(document.getElementById('pane-cfg'));
    };
    batch.onchange = () => {
      status.textContent = '';
      try {
        if (!refBusy) {
          const value = validateMaterialBatch(Number(batch.value));
          GM_setValue('roi-refine-material-batch-v1', value);
          refMaterialBatch = value;
        }
      } catch (error) {
        status.textContent = error.message;
      } finally {
        batch.value = refMaterialBatch;
        syncRefineSettings(refPanel);
        syncRefineSettings(document.getElementById('pane-cfg'));
      }
    };
  }

  function refreshRefinePanel() {
    syncRefineSettings(document.getElementById('pane-cfg'));
    const b = readFiberForUi(() => readBackpackContext());
    if (b === undefined) return;
    if (!b) {
      if (refBusy) stopRefine('left_backpack');
      refPanel?.remove(); refPanel = null; return;
    }
    if (refPanel?.isConnected && refPanel.parentElement !== b.host) refPanel.remove();
    if (!refPanel?.isConnected) {
      refPanel = document.createElement('div');
      refPanel.dataset.roiRefineHelper = '';
      refPanel.toggleAttribute('data-roi-ref-modern', Boolean(b.modern));
      refPanel.className = 'xp-sunken p-2';
      refPanel.style.cssText = 'display:grid;gap:6px;margin-bottom:8px;border-left:3px solid #f59e0b;background:var(--roi-panel);border-radius:6px;font-size:12px;box-shadow:0 4px 12px rgba(0,0,0,0.35);';
      refPanel.innerHTML = `
        <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">
          <button type="button" class="xp-btn small" id="ref-toggle" style="font-weight:bold;color:var(--roi-warning);">🔨 展開精煉清單</button>
          <button type="button" class="xp-btn small" id="ref-sel-all">全選本頁裝備</button>
          <button type="button" class="xp-btn small" id="ref-sel-clr">取消全選</button>
          <label style="color:var(--roi-info);">模式：<select id="ref-mode" class="xp-input">
            <option value="round_robin">🔄 輪流齊頭衝 (+1輪流)</option>
            <option value="single_focus">🎯 單件直衝到底</option>
          </select></label>
          <label style="color:var(--roi-warning);font-weight:bold;">目標 +<input type="number" id="ref-target" class="xp-input" value="${refTargetPlus}" min="1" max="10" style="width:48px;"></label>
          <button type="button" class="xp-btn small" id="ref-run-safe" style="background:linear-gradient(135deg,#0369a1,#075581);color:#fff;border:none;">🛡️ 所選衝到安全值</button>
          <button type="button" class="xp-btn small" id="ref-run-target" style="background:linear-gradient(135deg,#a34f05,#854009);color:#fff;font-weight:bold;border:none;">🚀 啟動衝到目標 +N</button>
          <button type="button" class="xp-btn small" id="ref-run-skill" hidden>神工匠武器精練</button>
          <button type="button" class="xp-btn small" id="ref-stop" style="background:#dc2626;color:#fff;display:none;border:none;">⏹ 停止</button>
        </div>
        <div style="display:flex;gap:12px;flex-wrap:wrap;">
          <label><input type="checkbox" data-roi-ref-confirm> 精煉時略過確認窗</label>
          <label><input type="checkbox" data-roi-ref-warehouse> 自動領料及存倉</label>
          <label>每次領料 <input type="number" data-roi-ref-batch class="xp-input" min="1" max="1000" step="1" style="width:64px;"> 個</label>
          <label title="測試版：只記錄最近 30 筆去識別化事件"><input type="checkbox" data-roi-ref-diag> 記錄精煉診斷</label>
          <button type="button" class="xp-btn small" data-roi-ref-diag-copy hidden>複製診斷紀錄</button>
        </div>
        <span data-roi-ref-settings-status role="status" style="color:var(--roi-warning);"></span>
        <div data-ref-categories role="group" aria-label="精煉裝備分類" style="display:none;gap:6px;flex-wrap:wrap;"></div>
        <div data-ref-list style="display:none;max-height:210px;overflow:auto;gap:4px;padding:6px;background:var(--roi-inset);border-radius:6px;border:1px solid var(--roi-edge);"></div>
        <div data-ref-status style="font-size:11.5px;color:var(--roi-success);">💡 支援 Ctrl / ⌘ 點擊勾選全部同名裝備；安全值後神工匠用技能，一般職業自動穿戴找忽克連並在結束後穿回原裝。</div>
      `;
      b.host.insertBefore(refPanel, b.anchor ?? b.table.closest('.xp-sunken') ?? b.table);
      if (b.modern) refPanel.insertBefore(element('small', '遊戲測試版介面請先手動領料，完成後也可手動存倉。', 'color:var(--roi-muted)'), refPanel.querySelector('[data-ref-list]'));
      bindRefineSettings(refPanel, refPanel.querySelector('[data-roi-ref-settings-status]'));

      const panel = refPanel;
      const loadRefineData = async () => {
        if (refinePack) return;
        const status = panel.querySelector('[data-ref-status]');
        status.textContent = '正在讀取遊戲精煉資料…';
        try {
          const pack = await loadLootPack();
          if (!pack.refine) throw Error('找不到精煉規則');
          refinePack = pack;
          status.textContent = '支援 Ctrl / ⌘ 點擊勾選全部同名裝備。';
          refreshRefinePanel();
        } catch {
          status.textContent = '無法讀取遊戲精煉資料，請重新展開清單重試。';
        }
      };
      void loadRefineData();
      refPanel.querySelector('#ref-toggle').onclick = () => {
        refOpen = !refOpen;
        if (refOpen) void loadRefineData();
        refreshRefinePanel();
      };
      const categories = refPanel.querySelector('[data-ref-categories]');
      for (const [category, label] of Object.entries(refineCategories)) {
        const button = element('button', label, '');
        button.type = 'button';
        button.className = 'xp-btn small';
        button.dataset.refCategory = category;
        button.onclick = () => { refCategory = category; refreshRefinePanel(); };
        categories.append(button);
      }
      refPanel.querySelector('#ref-sel-all').onclick = () => {
        if (refBusy) return;
        const backpack = readFiberForUi(() => readBackpackContext(true));
        if (backpack === undefined) return;
        if (backpack) refineRowsForPage(backpack.rows).forEach((r) => refSelected.add(r.uid));
        refOpen = true;
        refreshRefinePanel();
      };
      refPanel.querySelector('#ref-sel-clr').onclick = () => { if (!refBusy) { refSelected.clear(); refreshRefinePanel(); } };
      refPanel.querySelector('#ref-mode').value = refMode;
      refPanel.querySelector('#ref-mode').onchange = (e) => { refMode = e.target.value; };
      refPanel.querySelector('#ref-target').onchange = (e) => { refTargetPlus = Math.min(10, Math.max(1, parseInt(e.target.value, 10) || 6)); e.target.value = refTargetPlus; };
      refPanel.querySelector('#ref-run-safe').onclick = () => runHybridRefine('safe_only');
      refPanel.querySelector('#ref-run-target').onclick = () => runHybridRefine('to_target');
      refPanel.querySelector('#ref-run-skill').onclick = () => runHybridRefine('skill_only');
      refPanel.querySelector('#ref-stop').onclick = () => stopRefine('manual');
      const diagBox = refPanel.querySelector('[data-roi-ref-diag]'), diagCopy = refPanel.querySelector('[data-roi-ref-diag-copy]');
      diagBox.onchange = () => {
        try { if (diagBox.checked) localStorage.setItem('roi-refine-diag', '1'); else localStorage.removeItem('roi-refine-diag'); } catch {}
        refreshRefinePanel();
      };
      diagCopy.onclick = async () => {
        const text = refineDiagSummary();
        const status = refPanel.querySelector('[data-ref-status]');
        try { await navigator.clipboard.writeText(text); status.textContent = '已複製精煉診斷紀錄（不含玩家名稱與角色識別碼）。'; }
        catch { page.prompt('請複製診斷紀錄', text); }
      };
    }

    if (refinePack && refSelected.size) {
      const eligible = new Set(b.s.inventory.filter(canRefine).map((stack) => stack.uid));
      for (const uid of refSelected) if (!eligible.has(uid)) refSelected.delete(uid);
    }
    refPanel.querySelector('#ref-toggle').textContent =
      `${refOpen ? '🔼 收合精煉清單' : '🔨 展開精煉清單'} (共選 ${refSelected.size} 件)`;
    for (const el of refPanel.querySelectorAll('#ref-mode,#ref-target')) el.disabled = refBusy;
    syncRefineSettings(refPanel);
    const diagOn = refineDiagEnabled();
    refPanel.querySelector('[data-roi-ref-diag]').checked = diagOn;
    refPanel.querySelector('[data-roi-ref-diag-copy]').hidden = !diagOn || !refineDiagLog.length;
    const skillButton = refPanel.querySelector('#ref-run-skill');
    const skillLevel = weaponRefineLevel(b.s);
    skillButton.hidden = skillLevel <= 0;
    skillButton.disabled = refBusy || !refinePack;
    skillButton.title = `使用武器精練技能，至多 +${skillLevel}`;
    refPanel.querySelector('#ref-stop').style.display = refBusy ? 'inline-block' : 'none';
    const listEl = refPanel.querySelector('[data-ref-list]');
    listEl.style.display = refOpen ? 'grid' : 'none';
    refPanel.querySelector('[data-ref-categories]').style.display = refOpen ? 'flex' : 'none';
    if (!refOpen) return;

    const available = new Set(b.rows.filter(isEligibleEquip).map((row) => refineCategory(refinePack.items.get(row.st.itemId))));
    if (!available.has(refCategory)) refCategory = 'all';
    for (const button of refPanel.querySelectorAll('[data-ref-category]')) {
      button.hidden = button.dataset.refCategory !== 'all' && !available.has(button.dataset.refCategory);
      const active = button.dataset.refCategory === refCategory;
      button.setAttribute('aria-pressed', String(active));
      button.style.color = active ? 'var(--roi-warning)' : '';
      button.style.borderColor = active ? 'var(--roi-warning)' : '';
    }
    const eqRows = refineRowsForPage(b.rows);
    const sig = JSON.stringify([!!refinePack, refCategory, refBusy, [...refSelected], eqRows.map((r) => [r.uid, r.st.refine])]);
    if (listEl.dataset.sig === sig) return;
    listEl.dataset.sig = sig;
    listEl.replaceChildren();
    if (refinePack && !eqRows.length) listEl.append(element('span', '沒有可精煉的裝備', 'color:var(--roi-muted)'));
    eqRows.forEach((r) => {
      const lbl = document.createElement('label');
      lbl.style.cssText = 'display:flex;align-items:center;gap:6px;padding:3px 6px;cursor:pointer;border-bottom:1px dashed var(--roi-edge);';
      const cb = document.createElement('input');
      cb.type = 'checkbox'; cb.disabled = refBusy; cb.checked = refSelected.has(r.uid);
      cb.onclick = (e) => {
        const next = cb.checked;
        const targets = (e.ctrlKey || e.metaKey) ? eqRows.filter((x) => x.st.itemId === r.st.itemId) : [r];
        targets.forEach((x) => (next ? refSelected.add(x.uid) : refSelected.delete(x.uid)));
        refreshRefinePanel();
      };
      const slots = SLOTS_MAP.get(r.st.itemId) || 0;
      const img = element('img');
      img.src = `/client/item/${r.st.itemId}.png`; img.width = img.height = 20;
      const name = element('span', `+${r.st.refine || 0} ${r.name}${slots ? ` [${slots}]` : ''} `, `color:${r.st.refine ? 'var(--roi-info)' : 'var(--roi-text)'}`);
      applyRefineLevelColor(name, r.st.refine || 0);
      name.append(element('small', `(${SUB_LABELS[r.sub] || r.cat})`, 'color:var(--roi-muted)'));
      lbl.append(img, name);
      lbl.prepend(cb);
      listEl.appendChild(lbl);
    });
  }
