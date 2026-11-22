
  const isEligibleEquip = (r) => canRefine(r.st);

  const refineRowsForPage = (rows) => rows.filter((row) =>
    isEligibleEquip(row) && (refCategory === 'all' || refineCategory(refinePack.items.get(row.st.itemId)) === refCategory));

  function findNativeDetailBtn(table, uid, matcher) {
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
        if (inDetail && el?.tagName === 'BUTTON' && visible(el) && matcher(clean(el.textContent))) return el;
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

  function nativeStoreActor(store, snapshot) {
    if (!store || typeof store.getState !== 'function' || typeof store.subscribe !== 'function' ||
        typeof store.getInitialState !== 'function' || typeof store.setState !== 'function') return null;
    try {
      const state = store.getState();
      if (!state?.snapshot?.character || !Array.isArray(state.snapshot.inventory) ||
          (snapshot && state.snapshot !== snapshot)) return null;
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
    const cached = nativeStoreActor(refineNativeStore, context?.s);
    if (cached) return cached;
    const host = context?.table || [...document.querySelectorAll('fieldset')].find((field) =>
      visible(field) && /^倉庫(?:\s*[（(]|$)/.test(clean(field.querySelector('legend')?.textContent)));
    const props = host && getCommittedProps(host, (p) => Boolean((p?.s ?? p?.snap)?.character));
    const snapshot = context?.s ?? props?.s ?? props?.snap;
    const actor = snapshotCharacterId(snapshot) || positiveId(props?.characterId ?? props?.charId);
    if (actor) return actor;
    refineNativeStore = host && findRefineNativeStore(host, snapshot);
    return nativeStoreActor(refineNativeStore, snapshot);
  }

  const refineItemSignature = (item) => JSON.stringify([item.itemId, item.cards ?? [], item.forged ?? null]);
  function assertRefineSession(session, allowStopped = false) {
    if (!session || session.epoch !== refineIdentityEpoch || document.hidden || (!allowStopped && refStop)) {
      throw Error('角色已變更或流程已停止');
    }
    const actor = refineActor(readBackpackContext(true));
    if (actor !== session.characterId || (state.activeCharId != null && Number(state.activeCharId) !== actor)) {
      throw Error('無法確認仍是起始角色，已停止');
    }
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

  function stopRefine() {
    refStop = true;
    pageNet.events.dispatchEvent(new Event('ui-abort'));
  }

  function waitForRefineUi(session, check, options = {}) {
    const { root, timeout, allowStopped = false } = options;
    return waitForUi(expired => {
      assertRefineSession(session, allowStopped || session.restoring === true);
      return check(expired);
    }, {
      root, timeout,
      shouldAbort: () => session.epoch !== refineIdentityEpoch ||
        (state.activeCharId != null && Number(state.activeCharId) !== session.characterId) ||
        (refStop && !allowStopped && !session.restoring)
    });
  }

  async function selectBagItemRow(uid, session) {
    assertRefineTarget(session, uid);
    const b = readBackpackContext(true);
    const row = b?.rows.find((r) => r.uid === uid);
    const btn = row && [...row.row.querySelectorAll('td button')].find((x) => !x.disabled && !x.closest('[data-roi-refine-helper]'));
    if (!btn) throw Error('找不到該裝備列');
    if (!findNativeDetailBtn(b.table, uid, () => true)) clickRefineControl(session, btn, uid);
    const detail = await waitForRefineUi(session, () => {
      const live = assertRefineTarget(session, uid);
      return live && findNativeDetailBtn(live.table, uid, () => true) && live;
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
    clickRefineControl(session, eqBtn, uid);
    const equipped = await waitForRefineUi(session, () => {
      const live = assertRefineTarget(session, uid);
      return live && Object.values(live.s.equipment || {}).includes(uid) && live;
    }, { root: b.host?.parentElement, timeout: 4000 });
    if (!equipped) throw Error('穿戴裝備逾時');
    return equipped;
  }

  async function tryWithdrawFromWarehouse(wantedItemIds, targetPlusLimit, setStatus, limitsById, maxItems = 15, session, materialQuantity = null) {
    assertRefineSession(session);
    const findWhField = () => [...document.querySelectorAll('fieldset')].find((f) => /^倉庫(?:\s*[（(]|$)/.test(clean([...f.children].find((c) => c.tagName === 'LEGEND')?.textContent)) && visible(f));
    let switchedTab = null;
    let field = null;
    const selected = new Map();
    let submitted = false;
    visitingWarehouse = true;
    try {
      field = findWhField();
      if (!field) {
        const tabs = [...document.querySelectorAll('.xp-menu-item, button, a')].filter(visible);
        const whTab = tabs.find((el) => clean(el.textContent) === '倉庫');
        switchedTab = tabs.find((el) => clean(el.textContent) === '背包');
        if (!whTab || !switchedTab) return [];
        clickRefineControl(session, whTab);
        field = await waitForRefineUi(session, findWhField, { timeout: 2500 });
        if (!field) throw Error('開啟倉庫逾時');
      }
      const checked = () => [...field.querySelectorAll(':scope > ul > li input[type="checkbox"]:checked')];
      if (checked().length || [...field.querySelectorAll('button')].some((b) => clean(b.textContent) === '結束賣出')) {
        throw Error('倉庫已有勾選或正在賣出，請先完成原本的操作');
      }
      for (const li of field.querySelectorAll('li')) {
        const cb = li.querySelector('input[type="checkbox"]');
        const id = Number(li.querySelector('img[src*="/client/item/"]')?.getAttribute('src')?.match(/\/(\d+)\.png/)?.[1]);
        if (!wantedItemIds.has(id) || !cb || cb.disabled || cb.checked || !/^(取出|領出)/.test(clean(cb.getAttribute('aria-label')))) continue;
        const name = clean(li.querySelector('button[aria-label$="的物品資訊"]')?.textContent || '');
        const refine = Number(name.match(/^\+\s*(\d+)/)?.[1] || 0);
        if (!name || refine >= (limitsById ? limitsById.get(id) || 0 : targetPlusLimit)) continue;
        if (refStop || document.hidden) throw Error('已中止領倉');
        clickRefineControl(session, cb);
        selected.set(cb, { id, refine, name });
        const confirmed = await waitForRefineUi(session, () => {
          if (!field.contains(cb) || !cb.checked) return false;
          return [...field.querySelectorAll('button')].some(b =>
            !b.disabled && Number(clean(b.textContent).match(/^(?:領出|取出)\s*(\d+)\s*項/)?.[1]) === selected.size);
        }, { root: field });
        if (!confirmed) throw Error('倉庫勾選已變動或無法領取，已中止領倉');
        if (materialQuantity !== null) {
          const amount = li.querySelector('input[type="number"]');
          const stackText = clean(li.textContent).match(/×\s*([\d,]+)/)?.[1];
          const stack = stackText ? Number(stackText.replace(/,/g, '')) : amount ? NaN : 1;
          const quantity = materialWithdrawalAmount(materialQuantity, stack, amount?.max ?? '');
          if (amount && Number(amount.value) !== quantity) {
            assertRefineSession(session);
            if (!li.contains(amount) || Number(warehouseItemId(li)) !== id) throw Error('領料項目已變動');
            const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
            if (!setter) throw Error('無法設定領料數量，已停止');
            setter.call(amount, String(quantity));
            amount.dispatchEvent(new Event('input', { bubbles: true }));
            amount.dispatchEvent(new Event('change', { bubbles: true }));
            const accepted = await waitForRefineUi(session, () => {
              const current = cb.closest('li')?.querySelector('input[type="number"]');
              if (!current?.isConnected || Number(current.value) !== quantity) return false;
              // The manual setter changes the DOM immediately; React must also accept the controlled value.
              return Boolean(getCommittedProps(current, props => props.value != null && Number(props.value) === quantity));
            }, { root: li });
            if (!accepted) throw Error('遊戲未接受領料數量，已停止');
          } else if (!amount && (stack !== 1 || quantity !== 1)) {
            throw Error('無法確認領料數量，已停止以避免取出整疊');
          }
          selected.get(cb).quantity = quantity;
        }
        if (selected.size >= maxItems) break;
      }
      if (!selected.size) return [];
      const boxes = checked();
      for (const [cb, expected] of selected) {
        const row = cb.closest('li');
        if (!field.contains(cb) || Number(warehouseItemId(row)) !== expected.id ||
            clean(row?.querySelector('button[aria-label$="的物品資訊"]')?.textContent) !== expected.name) {
          throw Error('領取物品已變動，已停止');
        }
        if (expected.quantity !== undefined) {
          const amount = row.querySelector('input[type="number"]');
          if (amount ? Number(amount.value) !== expected.quantity : expected.quantity !== 1) throw Error('領料數量已變動，已停止');
        }
      }
      const btn = [...field.querySelectorAll('button')].find((b) => Number(clean(b.textContent).match(/^(?:領出|取出)\s*(\d+)\s*項/)?.[1]) === selected.size);
      if (refStop || document.hidden || !field.isConnected || boxes.length !== selected.size || boxes.some((cb) => !selected.has(cb)) || !btn || btn.disabled) {
        throw Error('倉庫勾選已變動或無法領取，已中止領倉');
      }
      setStatus(`📦 領取 ${selected.size} 項` + (materialQuantity !== null ? `（${[...selected.values()].reduce((sum, item) => sum + item.quantity, 0)} 個材料）` : ''));
      // The batch above is verified against the native selection, including rows hidden by the custom tab.
      refineWarehouseSubmitButton = btn;
      try { clickRefineControl(session, btn); }
      finally { refineWarehouseSubmitButton = null; }
      submitted = true;
      const acknowledged = await waitForRefineUi(session, () =>
        [...selected.keys()].every(cb => !cb.isConnected || !cb.checked),
      { root: field.parentElement, timeout: 4000 });
      if (!acknowledged) throw Error('已送出領倉，但未確認提交結果。請確認背包與倉庫。');
      return [...selected.values()];
    } finally {
      try {
        const canClean = () => session.epoch === refineIdentityEpoch && !document.hidden &&
          (state.activeCharId == null || Number(state.activeCharId) === session.characterId) &&
          refineActor(null) === session.characterId && field?.isConnected && findWhField() === field;
        if (!submitted) {
          for (const cb of selected.keys()) {
            if (canClean() && field.contains(cb) && cb.isConnected && cb.checked && !cb.disabled) cb.click();
          }
        }
        if (canClean() && switchedTab?.isConnected && !switchedTab.disabled) {
          switchedTab.click();
          await waitForRefineUi(session, () => readBackpackContext(true), { timeout: 2500, allowStopped: true });
        }
      } catch {
        // 清理中斷時，保留原始領倉錯誤，不再點擊。
      } finally { visitingWarehouse = false; }
    }
  }

  const isWeaponRefineButton = (text) => /^武器精[練煉]\s*\(\s*技能(?:[,\s)]|$)/.test(text);
  const isNpcRefineButton = (text) => /^請.+精[煉練]$/.test(text);
  const weaponRefineLevel = (snapshot) => snapshot.character.skills?.WS_WEAPONREFINE ?? 0;
  const materialCount = (inventory, id) => inventory.reduce((sum, item) =>
    item.itemId === id && Number.isSafeInteger(item.qty) && item.qty > 0 ? sum + item.qty : sum, 0);

  // 已付費、材料已扣、等級未升，且點擊後遊戲送出的請求都已回應（且之後沒有新的回應）時，
  // 不同事件喚醒的連續兩讀一致才提前判定；8 秒上限會再做一次最終確認。
  function refineNoUpgradeSettled(gate, confirmed, net) {
    if (!confirmed || net.inFlight > 0 || net.settled <= gate.since) { gate.candidate = null; return false; }
    if (gate.candidate === net.settled) return true;
    gate.candidate = net.settled;
    return false;
  }

  async function waitForRefineMaterial(session, id, beforeQty) {
    let backpackReady = false;
    try {
      const received = await waitForRefineUi(session, () => {
        const b = readBackpackContext(true);
        backpackReady = Boolean(b);
        return b && materialCount(b.s.inventory, id) > beforeQty;
      }, { timeout: 4000 });
      if (received) return;
    } catch (error) {
      throw Error(`已送出領倉，確認入帳時停止（${error.message}）。請確認背包與倉庫。`);
    }
    throw Error(backpackReady
      ? '已送出領倉，但材料入帳逾時。請確認背包與倉庫。'
      : '已送出領倉，但等待入帳逾時時背包介面仍未就緒。請確認背包與倉庫。');
  }

  function waitForRefineResult(session, uid, options) {
    const { root, curPlus, material, beforeMatQty, beforeZeny, beforeSp, useSkill, settleGate } = options;
    let previouslyConfirmed = false;
    return waitForRefineUi(session, expired => {
      const b = assertRefineTarget(session, uid, true);
      const nowSt = b?.s.inventory.find(x => x.uid === uid);
      if (!b) {
        previouslyConfirmed = false;
        settleGate.candidate = null;
        return null;
      }
      const paid = useSkill ? b.s.character.sp <= beforeSp - 5 : b.s.character.zeny < beforeZeny;
      if (nowSt && (nowSt.refine || 0) === curPlus + 1) return { kind: 'success', b, nowSt };
      if (!nowSt && paid) return { kind: 'broken', b };
      const confirmedNoUpgrade = Boolean(nowSt && paid && (nowSt.refine || 0) <= curPlus &&
        (!material || materialCount(b.s.inventory, material) < beforeMatQty));
      if (refineNoUpgradeSettled(settleGate, confirmedNoUpgrade, pageNet) ||
          (expired && previouslyConfirmed && confirmedNoUpgrade && pageNet.inFlight === 0)) return { kind: 'failed', b };
      previouslyConfirmed = confirmedNoUpgrade;
      return null;
    }, { root, timeout: 8000 });
  }

  async function runHybridRefine(modeType) {
    if (refBusy) return;
    refStop = false;
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
      characterId, epoch: refineIdentityEpoch, targetUid: null,
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
    let changedEquip = false, successCnt = 0, brokenCnt = 0, failedCnt = 0;
    refBusy = true; refStop = false; refreshRefinePanel();

    try {
      while (!refStop) {
        assertRefineSession(session);
        b = readBackpackContext(true);
        if (!b || document.hidden) throw Error('已離開背包頁面');

        let pool = b.rows.filter((r) => isEligibleEquip(r) && runUids.has(r.uid) && refSelected.has(r.uid));
        pool = pool.filter((r) => !skipped.has(r.uid) && (r.st.refine || 0) < limitPlus);

        if (!pool.length && refAutoWh) {
          session.targetUid = null;
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
        b = await refineAwait(session, selectBagItemRow(uid, session));
        if (!b || refStop || document.hidden) throw Error('已離開背包或中止精煉');

        const safeBtn = !skillOnly && await readRefineDetail(b.table, uid, (t) => /^一鍵精煉到安全值\s*\+\d+/.test(t), session);
        const nativeLimit = Number(clean(safeBtn?.textContent).match(/\+(\d+)/)?.[1]);
        if (modeType === 'safe_only' && nativeLimit > 0) safeLimits.set(target.st.itemId, nativeLimit);
        if (safeBtn && !safeBtn.disabled) {
          const safeTarget = Number(safeBtn.textContent.match(/\+(\d+)/)?.[1]) || 4;
          if (curPlus < safeTarget && (modeType === 'safe_only' || safeTarget <= refTargetPlus)) {
            setStatus(`⚡ 一鍵安全值：【${target.name}】+${curPlus} ➔ +${safeTarget}...`);
            if (refStop || document.hidden) throw Error('已中止精煉');
            const originalConfirm = page.confirm;
            let accepted = true;
            try {
              page.confirm = (message) => {
                if (refSkipConfirm) return true;
                accepted = originalConfirm.call(page, message);
                return accepted;
              };
              if ((assertRefineTarget(session, uid).s.inventory.find((item) => item.uid === uid).refine || 0) !== curPlus) throw Error('精煉值已變動');
              clickRefineControl(session, safeBtn, uid);
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
        const recipeItem = refinePack?.items?.get(target.st.itemId);
        const weaponLevel = Math.min(4, Math.max(1, recipeItem?.weaponLevel ?? 1));
        const steps = recipeItem?.slots?.includes('weapon') ? refinePack?.refine?.weapon?.[weaponLevel] : refinePack?.refine?.armor;
        const material = steps?.[curPlus]?.material;
        if ((!activeBtn || activeBtn.disabled) && refAutoWh && (!skillOnly || (skillBtn && b.s.character.sp >= 5))) {
          if (!material) throw Error(`【${target.name}】找不到精煉材料資料`);
          const beforeOreQty = materialCount(b.s.inventory, material);
          session.targetUid = null;
          const pulledOres = material ? await tryWithdrawFromWarehouse(new Set([material]), limitPlus, setStatus, null, 1, session, refMaterialBatch) : [];
          if (pulledOres.length) {
            await waitForRefineMaterial(session, material, beforeOreQty);
            session.targetUid = uid;
            b = await refineAwait(session, selectBagItemRow(uid, session));
            if (!b || refStop || document.hidden) throw Error('已離開背包或中止精煉');
            skillBtn = await readRefineDetail(b.table, uid, isWeaponRefineButton, session);
            npcBtn = skillOnly ? null : await readRefineDetail(b.table, uid, isNpcRefineButton, session);
            activeBtn = skillBtn && !skillBtn.disabled ? skillBtn : npcBtn;
          } else {
            assertRefineSession(session);
          }
        }
        if (!activeBtn || activeBtn.disabled) throw Error(skillOnly
          ? `【${target.name}】武器精練不可用，請確認技能等級、材料與 SP（至少 5）`
          : `【${target.name}】精煉按鈕不可用（礦石已用盡、Zeny/SP不足或不在主城）`);

        if (refStop || document.hidden) throw Error('已中止精煉');
        const beforeMatQty = material ? materialCount(b.s.inventory, material) : 0;
        const beforeZeny = b.s.character.zeny, beforeSp = b.s.character.sp;
        setStatus(`🔨 衝裝中：【${target.name}】+${curPlus} ➔ +${curPlus + 1} (成功:${successCnt} 爆:${brokenCnt})`);

        const origConfirm = page.confirm;
        let userAccepted = true, settleGate = { since: pageNet.settled, candidate: null };
        try {
          page.confirm = (msg) => {
            if (refSkipConfirm || /成功率 100%|一定成功/.test(String(msg))) return true;
            userAccepted = origConfirm.call(page, msg);
            return userAccepted;
          };
          if ((assertRefineTarget(session, uid).s.inventory.find((item) => item.uid === uid).refine || 0) !== curPlus) throw Error('精煉值已變動');
          settleGate = { since: pageNet.settled, candidate: null };
          clickRefineControl(session, activeBtn, uid);
        } finally {
          page.confirm = origConfirm;
        }
        if (!userAccepted) throw Error('玩家手動取消精煉');

        const result = await waitForRefineResult(session, uid, {
          root: b.host?.parentElement, curPlus, material, beforeMatQty, beforeZeny, beforeSp,
          useSkill: activeBtn === skillBtn, settleGate
        });
        if (!result) throw Error('精煉結果不明，請核對裝備與消耗');
        b = result.b;
        if (result.kind === 'success') {
          successCnt++;
          if (result.nowSt.refine >= limitPlus) {
            refSelected.delete(uid);
            if (refAutoWh && result.nowSt.refine >= refTargetPlus && !refStop && !document.hidden) {
              const stBtn = await readRefineDetail(b.table, uid, (t) => /^存入倉庫|^存倉$/.test(t), session);
              if (stBtn && !stBtn.disabled) {
                clickRefineControl(session, stBtn, uid);
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
      setStatus(`🛑 已停止：${e.message} (成功:${successCnt} 爆:${brokenCnt})`);
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
        if (failed.length) setStatus('⚠️ 有裝備未能穿回，請檢查人物裝備欄');
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
    warehouse.checked = refAutoWh;
    if (batch !== document.activeElement) batch.value = refMaterialBatch;
    for (const control of [confirm, warehouse, batch]) control.disabled = refBusy;
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
      if (refBusy && !visitingWarehouse) stopRefine();
      refPanel?.remove(); refPanel = null; return;
    }
    if (!refPanel?.isConnected) {
      refPanel = document.createElement('div');
      refPanel.dataset.roiRefineHelper = '';
      refPanel.className = 'xp-sunken p-2';
      refPanel.style.cssText = 'display:grid;gap:6px;margin-bottom:8px;border-left:3px solid #f59e0b;background:linear-gradient(90deg,rgba(15,23,42,0.94),rgba(30,41,59,0.85));border-radius:6px;font-size:12px;box-shadow:0 4px 12px rgba(0,0,0,0.35);';
      refPanel.innerHTML = `
        <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">
          <button type="button" class="xp-btn small" id="ref-toggle" style="font-weight:bold;color:#fbbf24;">🔨 展開精煉清單</button>
          <button type="button" class="xp-btn small" id="ref-sel-all">全選本頁裝備</button>
          <button type="button" class="xp-btn small" id="ref-sel-clr">取消全選</button>
          <label style="color:#93c5fd;">模式：<select id="ref-mode" class="xp-input">
            <option value="round_robin">🔄 輪流齊頭衝 (+1輪流)</option>
            <option value="single_focus">🎯 單件直衝到底</option>
          </select></label>
          <label style="color:#fbbf24;font-weight:bold;">目標 +<input type="number" id="ref-target" class="xp-input" value="${refTargetPlus}" min="1" max="10" style="width:48px;"></label>
          <button type="button" class="xp-btn small" id="ref-run-safe" style="background:linear-gradient(135deg,#0284c7,#0369a1);color:#fff;border:none;">🛡️ 所選衝到安全值</button>
          <button type="button" class="xp-btn small" id="ref-run-target" style="background:linear-gradient(135deg,#d97706,#b45309);color:#fff;font-weight:bold;border:none;">🚀 啟動衝到目標 +N</button>
          <button type="button" class="xp-btn small" id="ref-run-skill" hidden>神工匠武器精練</button>
          <button type="button" class="xp-btn small" id="ref-stop" style="background:#dc2626;color:#fff;display:none;border:none;">⏹ 停止</button>
        </div>
        <div style="display:flex;gap:12px;flex-wrap:wrap;">
          <label><input type="checkbox" data-roi-ref-confirm> 精煉時略過確認窗</label>
          <label><input type="checkbox" data-roi-ref-warehouse> 自動領料及存倉</label>
          <label>每次領料 <input type="number" data-roi-ref-batch class="xp-input" min="1" max="1000" step="1" style="width:64px;"> 個</label>
        </div>
        <span data-roi-ref-settings-status role="status" style="color:#fde047;"></span>
        <div data-ref-categories role="group" aria-label="精煉裝備分類" style="display:none;gap:6px;flex-wrap:wrap;"></div>
        <div data-ref-list style="display:none;max-height:210px;overflow:auto;gap:4px;padding:6px;background:#090d16;border-radius:6px;border:1px solid #1e293b;"></div>
        <div data-ref-status style="font-size:11.5px;color:#4ade80;">💡 支援 Ctrl / ⌘ 點擊勾選全部同名裝備；安全值後神工匠用技能，一般職業自動穿戴找忽克連並在結束後穿回原裝。</div>
      `;
      b.host.insertBefore(refPanel, b.table.closest('.xp-sunken') || b.table);
      bindRefineSettings(refPanel, refPanel.querySelector('[data-roi-ref-settings-status]'));

      const loadRefineData = async () => {
        if (refinePack) return;
        const status = refPanel.querySelector('[data-ref-status]');
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
      refPanel.querySelector('#ref-stop').onclick = stopRefine;
    }

    if (refinePack && refSelected.size) {
      const eligible = new Set(b.s.inventory.filter(canRefine).map((stack) => stack.uid));
      for (const uid of refSelected) if (!eligible.has(uid)) refSelected.delete(uid);
    }
    refPanel.querySelector('#ref-toggle').textContent =
      `${refOpen ? '🔼 收合精煉清單' : '🔨 展開精煉清單'} (共選 ${refSelected.size} 件)`;
    for (const el of refPanel.querySelectorAll('#ref-mode,#ref-target')) el.disabled = refBusy;
    syncRefineSettings(refPanel);
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
      button.style.color = active ? '#fbbf24' : '';
      button.style.borderColor = active ? '#fbbf24' : '';
    }
    const eqRows = refineRowsForPage(b.rows);
    const sig = JSON.stringify([!!refinePack, refCategory, refBusy, [...refSelected], eqRows.map((r) => [r.uid, r.st.refine])]);
    if (listEl.dataset.sig === sig) return;
    listEl.dataset.sig = sig;
    listEl.replaceChildren();
    if (refinePack && !eqRows.length) listEl.append(element('span', '沒有可精煉的裝備', 'color:#94a3b8'));
    eqRows.forEach((r) => {
      const lbl = document.createElement('label');
      lbl.style.cssText = 'display:flex;align-items:center;gap:6px;padding:3px 6px;cursor:pointer;border-bottom:1px dashed #1e293b;';
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
      const name = element('span', `+${r.st.refine || 0} ${r.name}${slots ? ` [${slots}]` : ''} `, `color:${r.st.refine ? '#38bdf8' : '#e2e8f0'}`);
      applyRefineLevelColor(name, r.st.refine || 0);
      name.append(element('small', `(${SUB_LABELS[r.sub] || r.cat})`, 'color:#64748b'));
      lbl.append(img, name);
      lbl.prepend(cb);
      listEl.appendChild(lbl);
    });
  }
