
  const hasActiveOperation = () => refBusy || cartShortcutBusy || visitingWarehouse || partyMoveActive !== null;
  const isActiveWindow = () => hasActiveOperation() ||
    (!document.hidden && (document.hasFocus() || performance.now() - lastInteractionAt <= TIMING.recentInteraction));

  function trackRouterInteraction() {
    if (document.hidden) return;
    const now = performance.now();
    if (now - lastInteractionAt >= TIMING.pointerSample) lastInteractionAt = now;
  }

  for (const event of ['pointermove', 'keydown', 'pointerdown']) {
    document.addEventListener(event, trackRouterInteraction, { passive: true, capture: true });
  }

  function routerDelay() {
    if (isActiveWindow()) return TIMING.activeRouter;
    return document.hidden ? TIMING.hiddenRouter : TIMING.visibleRouter;
  }
  const logSnapshots = [];
  let logTimer = null;
  let lastAlertRender = -Infinity;
  let alertRenderTimer = null;
  function renderLogAlertChars() {
    if (alertRenderTimer !== null) return;
    const remaining = TIMING.alertRenderGap - (performance.now() - lastAlertRender);
    if (remaining > 0) {
      alertRenderTimer = setTimeout(() => {
        alertRenderTimer = null;
        lastAlertRender = performance.now();
        renderChars();
      }, remaining);
      return;
    }
    lastAlertRender = performance.now();
    renderChars();
  }
  function flushLogBatch(size) {
    for (const text of logSnapshots.splice(0, size)) parseLog(text);
  }
  function scheduleLogBatch() {
    if (logTimer !== null || !logSnapshots.length) return;
    logTimer = setTimeout(() => {
      logTimer = null;
      flushLogBatch(document.hidden ? 800 : 200);
      scheduleLogBatch();
    }, isActiveWindow() ? TIMING.activeLogFlush : TIMING.idleLogFlush);
  }
  function queueLogLine(line) {
    if (!line) return;
    const text = clean(line.textContent);
    if (!text || state.processedLines.get(line) === text) return;
    state.processedLines.set(line, text);
    if (rxRareDrop.test(text)) {
      state.rares.unshift(`[${new Date().toLocaleTimeString()}] ✨ ${text}`);
      if (state.rares.length > rareLimit) state.rares.pop();
      state.rareRev++;
      alertUser('✨ 稀有掉落', text, false);
    }
    if (rxDangerLog.test(text)) {
      recordCharAlert(state.activeCharId, text.includes('負重') ? '負重停止' : '戰鬥不能');
      renderLogAlertChars();
      alertUser('⚠️ 掛機異常', text, true);
    }
    if (state.paused) return;
    if (logSnapshots.length >= 2000) flushLogBatch(document.hidden ? 800 : 200);
    logSnapshots.push(text);
    scheduleLogBatch();
  }
  function clearQueuedCharacterLogs() {
    // 警報及稀有紀錄已在讀取舊角色文字時寫入；此處只清理待計統計。
    clearTimeout(logTimer);
    logTimer = null;
    logSnapshots.length = 0;
  }

  let lastRouterAt = 0;
  function runPageRouter() {
    lastRouterAt = Date.now();
    refreshRareHelper();
    const refreshAnnotations = !document.hidden || hasActiveOperation();
    if (refreshAnnotations && document.querySelector('table.xp-table')) alignAndColorizeNativeMarkets();
    if (document.querySelector('input[aria-label="搜尋物品"]') || refPanel) refreshRefinePanel();
    const legends = [...document.querySelectorAll('fieldset > legend')].map((l) => clean(l.textContent));
    if (
      document.querySelector(lootItemGroupSelector + ',' + lootOpenKoreSelector + ',select[aria-label="怪物控制：加入怪物"]') ||
      rareKnownRoots.size > 0 ||
      legends.some((t) => /^必撿稀有掉落/.test(t))
    ) mountSettingsTools();
    syncPartyMoveBar();
    if (legends.some((t) => /^倉庫/.test(t))) refreshWarehouse();
    if (legends.some((t) => /的攤位/.test(t)) || mktPanel.isConnected || townResultsTable) syncMktMount();
    if (refreshAnnotations) annotateAllRefinedEquipment();
    syncHudSettings();
    mvpRadar?.syncFromStats();
    hudYield?.();
  }

  let uiTimer = null;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    clearTimeout(uiTimer);
    uiTimer = null;
    runPageRouter();
    if (canShareCharPoll()) void pollChars();
  });
  const ROUTER_TEXT_SCOPE = 'fieldset,table,legend,.xp-sunken,[role="dialog"],select,label';
  const ROUTER_SLOW_DELAY = TIMING.textRouter;
  let slowTimer = null;
  new MutationObserver((records) => {
    let domChanged = false, slowChanged = false, sawLog = false;
    for (const r of records) {
      const el = r.target.nodeType === 1 ? r.target : r.target.parentElement;
      if (!el || !el.isConnected || el.closest('#ro-helper-hud,#roi-helper-mvp-panel,#roi-item-hover-tooltip,[data-roi-market-browser],[data-ro-wh-bar],[data-ro-rare-helper],[data-roi-settings-tools],[data-roi-refine-helper],[data-roi-price-search],[data-roi-upper-fold],[data-roi-party-move-bar],[data-roi-party-move-dialog]')) continue;
      if (r.type === 'attributes' && !el.matches('fieldset') && !el.querySelector('fieldset') &&
          !el.matches(hudSkillControls) && !el.querySelector(hudSkillControls)) continue;
      if (el.closest('.log-window')) {
        sawLog = true;
        if (r.type === 'characterData' || r.type === 'childList') queueLogLine(el.closest('.log-line'));
        r.addedNodes.forEach((n) => {
          if (n.nodeType !== 1) return;
          if (n.matches?.('.log-line')) queueLogLine(n);
          n.querySelectorAll?.('.log-line').forEach(queueLogLine);
        });
        continue;
      }
      if (r.type === 'childList') r.addedNodes.forEach((n) => {
        if (n.nodeType !== 1) return;
        n.querySelectorAll?.('.log-window .log-line').forEach(queueLogLine);
      });
      // 純文字變動且不在需處理的容器內：改走慢速通道，避免倒數計時、HP 等文字每 160ms 觸發整頁路由。
      if (!el.closest(ROUTER_TEXT_SCOPE) && (r.type === 'characterData' ||
          (r.type === 'childList' && [...r.addedNodes, ...r.removedNodes].every((n) => n.nodeType === 3)))) { slowChanged = true; continue; }
      domChanged = true;
    }
    // 全隊移動等待中：戰鬥日誌有新行代表伺服器狀態在推進，提醒等待器重抓隊伍資料（有最小間隔）。
    if (sawLog && partyMoveActive) pageNet.events.dispatchEvent(new Event('kick'));
    if (domChanged && !uiTimer) {
      clearTimeout(slowTimer); slowTimer = null;
      uiTimer = setTimeout(() => { uiTimer = null; runPageRouter(); }, routerDelay());
    } else if (slowChanged && !uiTimer && !slowTimer) {
      slowTimer = setTimeout(() => { slowTimer = null; if (!uiTimer) runPageRouter(); }, ROUTER_SLOW_DELAY);
    }
  }).observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes:true, attributeFilter:['hidden','aria-hidden','inert','class','style'] });
