
  let whSaleApproval = null;

  const priceOptionKey = 'warehouse-auto-protect-v1';
  const savedPriceOptions = readValidatedSetting(priceOptionKey, validatePriceOptions, {});
  const validThreshold = (n) => Number.isSafeInteger(n) && n > 0 && n <= 1e12;
  let priceOptions = { enabled: savedPriceOptions?.enabled !== false,
    threshold: validThreshold(savedPriceOptions?.threshold) ? savedPriceOptions.threshold : 100000 };
  const priceEvidence = new Map();
  let evidenceExpires = Infinity;
  const stable = (v) =>
    Array.isArray(v)
      ? v.map(stable)
      : v && typeof v === 'object'
        ? Object.fromEntries(
            Object.keys(v)
              .sort()
              .map((k) => [k, stable(v[k])]),
          )
        : v;
  const protectionSpec = (i) =>
    JSON.stringify(
      stable(
        Object.fromEntries(
          Object.entries(i).filter(([k]) => !['itemId', 'name', 'price', 'qty', 'cartUid'].includes(k)),
        ),
      ),
    );

  function rebuildPriceEvidence() {
    priceEvidence.clear();
    evidenceExpires = Infinity;
    const rows = new Map(mktListings.map((r) => [r.key, r]));
    for (const [key, row] of mktCrossMap) {
      if (!rows.has(key) || rows.get(key).seen < row.seen) rows.set(key, row);
    }
    const now = Date.now();
    for (const r of rows.values()) {
      if (r.seen + 90000 <= now || !r.protectionSpec || r.vendorId == null || !Number.isSafeInteger(r.price) || r.price <= 0) continue;
      evidenceExpires = Math.min(evidenceExpires, r.seen + 90000);
      const id = String(r.id);
      if (!priceEvidence.has(id)) priceEvidence.set(id, { minimum: Infinity, groups: new Map(), sellers: 0 });
      const stats = priceEvidence.get(id);
      stats.minimum = Math.min(stats.minimum, r.price);
      if (!stats.groups.has(r.protectionSpec)) stats.groups.set(r.protectionSpec, new Set());
      const sellers = stats.groups.get(r.protectionSpec);
      sellers.add(String(r.vendorId));
      stats.sellers = Math.max(stats.sellers, sellers.size);
    }
  }
  // 只合併本次變更的欄位（enabled 或 threshold），不以本頁舊值覆寫其他分頁剛改的另一欄。
  // 原 Tampermonkey 選單的兩個指令已由儀表盤「設定」分頁的同一組控制項取代（同鍵、同驗證、即時生效）。
  function savePriceOptions(patch) {
    priceOptions = updateStoredValue(priceOptionKey, validatePriceOptions, priceOptions, (latest) => ({ ...latest, ...patch }));
    refreshWarehouse();
    syncHudSettings();
  }
  const instanceLockReasons = new Set(['自動保護：精煉裝備', '自動保護：有洞裝備', '自動保護：特殊/插卡']);
  const isStarProtected = (id) => Boolean(state.whProtectPins && Object.hasOwn(state.whPins, id));
  function getLockReason(id, name, text) {
    if (state.whMarks[id] === 'lock') return '手動上鎖';
    // ★ 優先於手動解除（neutral）：開啟「清倉排除自選」時，有 ★ 一律保護。
    if (isStarProtected(id)) return '自選保護（★）';
    if (state.whMarks[id] === 'neutral') return '';
    if (state.whAutoLocks[id] && !instanceLockReasons.has(state.whAutoLocks[id])) return state.whAutoLocks[id];
    if (state.whAutoEquipCard) {
      if (/卡片$/.test(name)) return '自動保護：卡片';
      if (Number(name.match(/^\+\s*(\d+)/)?.[1]) > 0) return '自動保護：精煉裝備';
      if (/\[[1-9]\d*\]/.test(name)) return '自動保護：有洞裝備';
      if (/(?:已插卡|鍛造|寵物蛋|神秘紫箱|老舊收集冊)/.test(text)) return '自動保護：特殊/插卡';
    }
    const kw = state.customProtectWords.find((w) => w && name.includes(w));
    if (kw) return `自訂貴重詞：「${kw}」`;
    if (!priceOptions.enabled) return '';
    if (Date.now() >= evidenceExpires) rebuildPriceEvidence();
    const stats = priceEvidence.get(String(id));
    return stats?.sellers >= 3 && stats.minimum >= priceOptions.threshold
      ? `已載入攤位普通同規格掛牌：${stats.sellers} 位賣家，最低 ${stats.minimum.toLocaleString('zh-TW')} Zeny；不代表成交價` : '';
  }

  let whSaveTimer = null;
  let whRetryUsed = false;
  const warehouseFields = { marks: 'whMarks', autoLocks: 'whAutoLocks', pins: 'whPins' };
  const pendingWhChanges = Object.fromEntries(Object.keys(warehouseFields).map(key => [key, new Map()]));

  function setWarehouseEntry(field, id, value) {
    const entries = state[warehouseFields[field]];
    if (value === null ? !Object.hasOwn(entries, id) : entries[id] === value) return;
    if (value === null) delete entries[id];
    else entries[id] = value;
    // 遠端刷新衍生的 autoLocks 只影響這次畫面。儲存時只合併本地差異。
    if (!applyingRemote) {
      whRetryUsed = false;
      pendingWhChanges[field].set(id, value);
      saveWarehouseSoon();
    }
  }

  function mergeWarehouseChanges(data) {
    for (const [field, changes] of Object.entries(pendingWhChanges)) {
      const entries = data[field] ??= {};
      for (const [id, value] of changes) {
        if (value === null) delete entries[id];
        else entries[id] = value;
      }
    }
    return data;
  }

  function applyWarehouseData(data) {
    for (const [field, key] of Object.entries(warehouseFields)) state[key] = data[field] || {};
  }

  function flushWarehouseSave({ sync = false } = {}) {
    if (whSaveTimer) { clearTimeout(whSaveTimer); whSaveTimer = null; }
    if (!Object.values(pendingWhChanges).some(changes => changes.size)) return;
    function persist() {
      // 等候鎖期間，卸載事件可能已經同步寫入。
      if (!Object.values(pendingWhChanges).some(changes => changes.size)) return;
      const raw = GM_getValue('warehouse-helper-v1', { marks: {}, autoLocks: {} });
      let latest;
      try { latest = validateWarehouse(typeof raw === 'string' ? JSON.parse(raw) : raw); }
      catch (error) {
        // 已存資料損毀時改以本頁已驗證的狀態為基底，避免待寫差異永遠無法落盤。
        console.warn('便利助手倉庫已存資料無效，改以本頁狀態覆寫', error);
        latest = { marks: { ...state.whMarks }, autoLocks: { ...state.whAutoLocks }, pins: { ...state.whPins } };
      }
      const merged = validateWarehouse(mergeWarehouseChanges(latest));
      GM_setValue('warehouse-helper-v1', JSON.stringify(merged));
      for (const changes of Object.values(pendingWhChanges)) changes.clear();
      applyWarehouseData(merged);
    }
    function failed(error) {
      console.warn('便利助手倉庫設定儲存失敗', error);
      if (whRetryUsed || whSaveTimer || !Object.values(pendingWhChanges).some(changes => changes.size)) return;
      whRetryUsed = true;
      whSaveTimer = setTimeout(flushWarehouseSave, 2000);
    }
    try {
      if (!sync && typeof navigator.locks?.request === 'function') {
        return navigator.locks.request('roi-wh-save-lock', persist).catch(failed);
      }
      persist();
    } catch (error) {
      failed(error);
    }
  }
  function saveWarehouseSoon() {
    if (!applyingRemote && !whSaveTimer) whSaveTimer = setTimeout(flushWarehouseSave, 400);
  }
  window.addEventListener('pagehide', () => flushWarehouseSave({ sync: true }));
  document.addEventListener('visibilitychange', () => { if (document.hidden) flushWarehouseSave({ sync: true }); });

  function warehouseItemId(li) {
    const iconId = li?.querySelector('img[src*="/client/item/"]')?.getAttribute('src')?.match(/\/client\/item\/(\d+)\.png(?:[?#]|$)/)?.[1];
    if (iconId || !li) return iconId;

    // 舊版介面不渲染物品圖示。從已提交的倉庫列取得道具 ID。
    let row = getReactFiber(li);
    if (!row) return undefined;
    let root = row;
    while (root.return) root = root.return;
    if (!root.stateNode?.current) return undefined;
    if (root.stateNode.current !== root) row = row.alternate;
    const item = row?.child?.memoizedProps?.it;
    if (row?.stateNode !== li || row.key == null || item?.sid == null ||
        String(item.sid) !== row.key || !Number.isSafeInteger(item.itemId) || item.itemId < 1) return undefined;
    return String(item.itemId);
  }

  const warehouseCustomViews = new WeakMap();
  const warehouseBulkLabel = /^(?:全選(?:目前顯示的)?|勾選這頁可以賣的\s*\(整疊\))$/;

  function setWarehouseQuery(input, value) {
    if (!input?.isConnected || input.value === value) return;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function syncWarehouseCustomView(field, list) {
    // The category bar and the two inventory columns share the same native panel.
    const tabs = field.parentElement?.parentElement?.querySelector(':scope > [role="tablist"][aria-label="物品分類"]');
    if (!tabs || !list) return;
    let view = warehouseCustomViews.get(tabs);
    if (!view) {
      const tab = document.createElement('button');
      tab.type = 'button';
      tab.className = 'xp-btn small';
      tab.dataset.roiWhCustomTab = '';
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-selected', 'false');
      tab.textContent = '★ 自選';
      view = { tab, active: false, selectingAll: false, query: '' };
      warehouseCustomViews.set(tabs, view);
      tabs.append(tab);

      const search = () => tabs.querySelector('input[aria-label="搜尋背包與倉庫的物品"]');
      tab.onclick = () => {
        if (view.active) return;
        const all = [...tabs.querySelectorAll('button[role="tab"]')].find((button) => clean(button.textContent) === '全部');
        const input = search();
        if (!all || all.disabled || !input) return;
        view.query = input.value;
        view.active = true;
        view.selectingAll = true;
        try { if (all.getAttribute('aria-selected') !== 'true') all.click(); }
        finally { view.selectingAll = false; }
        setWarehouseQuery(search(), '');
        refreshWarehouse();
      };
      tabs.addEventListener('click', (event) => {
        const target = event.target.closest('button[role="tab"]');
        if (!target || target === tab || !view.active || view.selectingAll) return;
        view.active = false;
        setWarehouseQuery(search(), view.query);
        refreshWarehouse();
      });
    }

    tabs.toggleAttribute('data-roi-wh-custom-tabs', view.active);
    if (field.hasAttribute('data-roi-wh-custom-view') !== view.active) {
      field.toggleAttribute('data-roi-wh-custom-view', view.active);
      list.scrollTop = 0;
    }
    view.tab.setAttribute('aria-selected', String(view.active));
    for (const button of field.querySelectorAll('button')) {
      if (warehouseBulkLabel.test(clean(button.textContent))) button.toggleAttribute('data-roi-wh-native-bulk', view.active);
    }
    let empty = field.querySelector('[data-roi-wh-custom-empty]');
    if (view.active && !empty) {
      empty = element('p', '目前沒有自選物品。可回到其他分類，點物品旁的 ☆ 加入。');
      empty.dataset.roiWhCustomEmpty = '';
      list.after(empty);
    }
    if (empty) empty.hidden = !view.active || Boolean(list.querySelector(':scope > [data-roi-wh-pinned]'));
  }

  function warehouseTotal(field, action) {
    const buttons = [...field.querySelectorAll('button')].filter(b => b.closest('fieldset') === field);
    const counts = buttons.map(b => clean(b.textContent).match(/^(直接賣掉|取出|領出|存入)\s*(\d+)\s*項/))
      .filter(m => m && m[1] === action);
    return counts.length === 1 ? Number(counts[0][2]) : null;
  }

  function readSaleItems(field, btn) {
    const items = [];
    for (const cb of field.querySelectorAll('li input[type="checkbox"]:checked')) {
      const li = cb.closest('li'), id = warehouseItemId(li);
      const name = clean(li.querySelector('button[aria-label$="的物品資訊"]')?.textContent);
      const num = li.querySelector('input[type="number"]');
      const qty = num ? Number(num.value) : Number(clean(li.textContent).match(/×\s*([\d,]+)/)?.[1]?.replace(/,/g,''));
      if (!id || !name || !visible(li) || cb.disabled || !Number.isSafeInteger(qty) || qty < 1) throw Error('待售物品或數量無法核對。');
      if (getLockReason(id, name, clean(li.textContent))) throw Error(name + ' 已上鎖，請先取消勾選。');
      items.push({id, name, qty});
    }
    if (!items.length || items.length !== warehouseTotal(field, '直接賣掉')) throw Error('待售清單與遊戲總項數不同，請清除其他分類的勾選，再分批出售。');
    return {items, sig:JSON.stringify([clean(btn.textContent),items])};
  }

  function showWarehouseSaleReview(f, saleBtn, items, sig) {
    const dlg = document.createElement('dialog');
    dlg.style.cssText = 'width:min(540px,calc(100vw - 24px));max-height:80vh;padding:16px 18px;background:var(--roi-surface);color:var(--roi-text);border:1.5px solid #f59e0b;border-radius:12px;box-shadow:0 16px 48px var(--roi-shadow);font-size:13px;backdrop-filter:blur(10px);';
    dlg.innerHTML = `
      <div style="font-weight:bold;font-size:15px;color:var(--roi-warning);border-bottom:1px solid var(--roi-edge);padding-bottom:8px;margin-bottom:8px;">🛡️ 倉庫待售清單核對（共 ${items.length} 項）</div>
      <div style="max-height:48vh;overflow:auto;margin-bottom:10px;border:1px solid var(--roi-edge);border-radius:6px;padding:6px 10px;background:var(--roi-inset);"></div>
      <div style="font-size:12px;color:var(--roi-text);margin-bottom:10px;"><span data-sale-caption></span>｜核對無誤後按「確認出售」，遊戲仍會顯示原生販售確認。</div>
      <div style="display:flex;justify-content:flex-end;gap:8px;">
        <button type="button" class="xp-btn small" id="wh-rev-cancel">取消</button>
        <button type="button" class="xp-btn small" id="wh-rev-ok" style="background:linear-gradient(135deg,#16763a,#136039);color:#fff;font-weight:bold;border:none;">確認出售</button>
      </div>
    `;
    const itemsBox = dlg.children[1];
    for (const item of items) {
      const row = element('div', null, 'display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px dashed var(--roi-edge)');
      row.append(element('span', item.name), element('b', '×' + item.qty.toLocaleString(), 'color:var(--roi-success)'));
      itemsBox.append(row);
    }
    dlg.querySelector('[data-sale-caption]').textContent = clean(saleBtn.textContent);
    document.body.appendChild(dlg);
    // Esc 關閉時也要移除對話框，避免殘留節點與重複 id。
    dlg.addEventListener('close', () => dlg.remove());
    dlg.querySelector('#wh-rev-cancel').onclick = () => { whSaleApproval = null; dlg.close(); dlg.remove(); };
    dlg.querySelector('#wh-rev-ok').onclick = () => {
      whSaleApproval = { sig, field: f, saleBtn, until: Date.now() + 15000 };
      saleBtn.click();
      dlg.close(); dlg.remove();
      const st = f.querySelector('[data-ro-wh-status]');
      if (st) st.textContent = '已送出遊戲原生販售確認';
    };
    dlg.showModal();
  }

  let whSearchBusy = false;
  const warehouseRowSignatures = new WeakMap();
  function refreshWarehouse(rescanCustom = false) {
    if (!state.whProtect) return;
    const fields = [...document.querySelectorAll('fieldset')].filter((f) => {
      const leg = [...f.children].find((c) => c.tagName === 'LEGEND');
      return leg && /^倉庫(?:\s*[（(]|$)/.test(clean(leg.textContent)) && visible(f);
    });
    for (const f of fields) {
      let bar = f.querySelector('[data-ro-wh-bar]');
      if (!bar) {
        bar = document.createElement('div');
        bar.dataset.roWhBar = '';
        bar.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin:4px 0 6px;padding:6px 10px;background:var(--roi-panel);border-left:3px solid #f59e0b;border-radius:6px;font-size:11.5px;box-shadow:0 2px 8px rgba(0,0,0,0.3);';
        const mkBtn = (txt, fn, bg = '') => {
          const b = document.createElement('button');
          b.type = 'button'; b.className = 'xp-btn small'; b.textContent = txt;
          if (bg) b.style.cssText = `background:${bg};color:#fff;font-weight:bold;border:none;`;
          b.onclick = (e) => { e.preventDefault(); e.stopPropagation(); fn(); };
          return b;
        };
        const stSpan = document.createElement('span');
        stSpan.dataset.roWhStatus = ''; stSpan.style.color = 'var(--roi-warning)';
        const review = document.createElement('input');
        review.type = 'checkbox';
        review.dataset.roiWhSaleReview = '';
        review.checked = state.whSaleReview;
        review.onchange = () => setWarehouseSaleReview(review.checked);
        const reviewLabel = document.createElement('label');
        reviewLabel.append(review, ' 出售前清單核對');
        const pinsLabel = document.createElement('label');
        const pinsSwitch = document.createElement('input');
        pinsSwitch.type = 'checkbox';
        pinsSwitch.dataset.roiProtectPins = '';
        pinsSwitch.onchange = () => {
          state.whProtectPins = pinsSwitch.checked;
          savePrefs();
          refreshWarehouse();
          syncHudSettings();
        };
        pinsLabel.append(pinsSwitch, ' 清倉排除自選（★）');
        bar.append(
          mkBtn('💰 勾選本頁未鎖定項目 (上限100)', async () => {
            const lis = [...f.querySelectorAll('li')].filter(visible);
            const verb = clean(lis[0]?.querySelector('input[type="checkbox"]')?.getAttribute('aria-label')).split(' ')[0];
            let cnt = warehouseTotal(f, verb === '賣掉' ? '直接賣掉' : verb);
            if (cnt == null) return;
            for (const li of lis) {
              const cb = li.querySelector('input[type="checkbox"]');
              if (!cb || cb.disabled) continue;
              if (li.dataset.roiWhLocked !== undefined) { if (cb.checked) { cb.click(); cnt--; } continue; }
              if (!cb.checked && cnt < 100) { cb.click(); if (++cnt % 15 === 0) await sleep(10); }
            }
          }, 'linear-gradient(135deg,#a34f05,#854009)'),
          mkBtn('🔒 本頁全鎖', () => bulkWhLock(f, true)),
          mkBtn('🔓 本頁全解', () => bulkWhLock(f, false)),
          pinsLabel, reviewLabel,
          stSpan
        );
        f.insertBefore(bar, [...f.children].find((c) => c.tagName === 'UL') || null);
      }

      bar.querySelector('[data-roi-protect-pins]').checked = state.whProtectPins;
      bar.querySelector('[data-roi-wh-sale-review]').checked = state.whSaleReview;
      const list = f.querySelector(':scope > ul');
      if (!list) continue;
      for (const li of list.children) {
        const cb = li.querySelector('input[type="checkbox"]'), nameBtn = li.querySelector('button[aria-label$="的物品資訊"]');
        if (!cb || !nameBtn) continue;
        const id = warehouseItemId(li);
        if (!id) continue;
        const name = clean(nameBtn.textContent), txt = clean(li.textContent);
        const pinned = Object.hasOwn(state.whPins, id);
        if (rescanCustom && !String(state.whAutoLocks[id] || '').startsWith('已載入攤位普通同規格掛牌') && state.whMarks[id] !== 'lock') setWarehouseEntry('autoLocks', id, null);
        if (instanceLockReasons.has(state.whAutoLocks[id])) { setWarehouseEntry('autoLocks', id, null); }
        const reason = getLockReason(id, name, txt);
        if (reason && reason !== '自選保護（★）' && !instanceLockReasons.has(reason) && !state.whMarks[id] && !state.whAutoLocks[id]) { setWarehouseEntry('autoLocks', id, reason); }
        const saleChecked = reason && cb.checked && clean(cb.getAttribute('aria-label')).startsWith('賣掉 ');
        const signature = text => JSON.stringify([id, name, text, reason, pinned]);
        if (!saleChecked && warehouseRowSignatures.get(li) === signature(txt) &&
            li.hasAttribute('data-roi-wh-pinned') === pinned &&
            (li.dataset.roiWhLocked !== undefined) === Boolean(reason) &&
            li.querySelector('[data-roi-wh-pin]') && li.querySelector('[data-roi-wh-pin-search]') &&
            li.querySelector('[data-ro-lock]')) continue;
        li.toggleAttribute('data-roi-wh-pinned', pinned);
        let pin = li.querySelector('[data-roi-wh-pin]');
        if (!pin) {
          pin = document.createElement('button');
          pin.type = 'button';
          pin.dataset.roiWhPin = '';
          pin.onclick = (event) => {
            event.preventDefault();
            event.stopPropagation();
            const itemId = warehouseItemId(li);
            if (!itemId) return;
            // 加入或移除 ★ 都清除該物品的 neutral：★ 與手動解除不並存；移除 ★ 後回到一般自動保護規則。
            if (state.whMarks[itemId] === 'neutral') setWarehouseEntry('marks', itemId, null);
            if (Object.hasOwn(state.whPins, itemId)) setWarehouseEntry('pins', itemId, null);
            else if (Object.keys(state.whPins).length < 5000) {
              const label = clean(li.querySelector('button[aria-label$="的物品資訊"]')?.textContent)
                .replace(/^\+\s*\d+\s*/, '').replace(/\s*\[\d+\].*$/, '').trim();
              if (!label || label.length > 160) return;
              setWarehouseEntry('pins', itemId, label);
            }
            refreshWarehouse();
          };
          li.insertBefore(pin, cb.nextSibling);
        }
        if (!li.querySelector('[data-roi-wh-pin-search]')) {
          const search = document.createElement('button');
          search.type = 'button';
          search.textContent = '🔍';
          search.title = '跨城查價';
          search.dataset.roiWhPinSearch = '';
          search.onclick = async event => {
            event.preventDefault();
            event.stopPropagation();
            if (whSearchBusy) return;
            whSearchBusy = true;
            try {
              const baseName = clean(li.querySelector('button[aria-label$="的物品資訊"]')?.textContent);
              if (!findTownSearchUI(true)) {
                const tab = [...document.querySelectorAll('nav[aria-label="主選單"] button')].find(b => clean(b.textContent) === '攤位');
                if (!tab) return;
                tab.click();
                for (let i = 0; i < 30 && !findTownSearchUI(true); i++) await sleep(50);
              }
              if (findTownSearchUI(true)) {
                syncMktMount();
                await triggerNativeTownSearch(baseName, true);
              }
            } finally { whSearchBusy = false; }
          };
          pin.after(search);
        }
        const icon = pinned ? '★' : '☆';
        if (pin.textContent !== icon) pin.textContent = icon;
        pin.title = pinned ? '移出自選' : '加入自選';
        pin.setAttribute('aria-label', pin.title + '：' + name);
        pin.setAttribute('aria-pressed', String(pinned));
        ITEM_NAME_CACHE.set(Number(id), name.replace(/^\+\d+\s*/, ''));
        const locked = Boolean(reason);
        if (saleChecked) cb.click();
        li.toggleAttribute('data-roi-wh-locked', locked);

        let lBtn = li.querySelector('[data-ro-lock]');
        if (!lBtn) {
          lBtn = document.createElement('button');
          lBtn.type = 'button'; lBtn.dataset.roLock = id;
          lBtn.onclick = (e) => {
            e.preventDefault(); e.stopPropagation();
            const id = warehouseItemId(li);
            if (!id) return;
            const nowLocked = Boolean(getLockReason(id, clean(li.querySelector('button[aria-label$="的物品資訊"]')?.textContent), clean(li.textContent)));
            if (nowLocked && state.whMarks[id] !== 'lock' && isStarProtected(id)) {
              const status = li.closest('fieldset')?.querySelector('[data-ro-wh-status]');
              if (status) status.textContent = '★ 自選物品一律保護，請先取消 ★ 再解鎖';
              return;
            }
            setWarehouseEntry('marks', id, nowLocked ? (isStarProtected(id) ? null : 'neutral') : 'lock');
            if (nowLocked) setWarehouseEntry('autoLocks', id, null);
            refreshWarehouse();
          };
          li.insertBefore(lBtn, cb.nextSibling);
        }
        lBtn.dataset.roLock = id;
        lBtn.dataset.roiWhBadge = locked ? 'lock' : 'unlock';
        const lbl = locked ? '🔒 已鎖' : '🔓';
        if (lBtn.textContent !== lbl) lBtn.textContent = lbl;
        lBtn.title = locked ? `${name} (#${id})｜${reason}\n${reason === '自選保護（★）' ? '請先取消 ★ 再解鎖' : '點擊解鎖'}` : `點擊鎖定 ${name}`;
        warehouseRowSignatures.set(li, signature(clean(li.textContent)));
      }
      syncWarehouseCustomView(f, list);
    }
  }

  function bulkWhLock(f, lock) {
    const visibleIds = [...new Set([...f.querySelectorAll('li')].filter(visible).map((li) => warehouseItemId(li)).filter(Boolean))];
    // 本頁全解略過 ★ 自選物品（★ 一律保護）；全鎖照常包含。
    const ids = lock ? visibleIds : visibleIds.filter((id) => !isStarProtected(id));
    const skippedStars = visibleIds.length - ids.length;
    const status = f.querySelector('[data-ro-wh-status]');
    if (!ids.length) { if (status && skippedStars) status.textContent = `本頁只有 ★ 自選物品，已略過 ${skippedStars} 種`; return; }
    if (!confirm(`確定將目前可見的 ${ids.length} 種物品全部${lock ? '上鎖' : '解鎖'}？${skippedStars ? `（略過 ${skippedStars} 種 ★ 自選物品）` : ''}`)) return;
    ids.forEach((id) => { setWarehouseEntry('marks', id, lock ? 'lock' : 'neutral'); if (!lock) setWarehouseEntry('autoLocks', id, null); });
    if (status && skippedStars) status.textContent = `已略過 ${skippedStars} 種 ★ 自選物品`;
    refreshWarehouse();
  }

  window.addEventListener('click', (e) => {
    if (!(e.target instanceof Element)) return;
    const caption = clean(e.target.closest('button,a')?.textContent);
    if (/^(?:換角色|切換角色|登出|登入)$/.test(caption)) {
      refineIdentityEpoch++;
      pageNet.events.dispatchEvent(new Event('ui-abort'));
      refSelected.clear();
    }
    const f = e.target.closest('fieldset');
    if (!f) return;
    const btn = e.target.closest('button');
    if (btn) {
      const cap = clean(btn.textContent);
      if (f.hasAttribute('data-roi-wh-custom-view')) {
        const action = cap.match(/^(直接賣掉|取出|領出)\s*\d+\s*項/)?.[1];
        const selected = [...f.querySelectorAll(':scope > ul > li input[type="checkbox"]:checked')];
        const hiddenSelection = action && (selected.length !== warehouseTotal(f, action) ||
          selected.some((input) => !input.closest('li')?.hasAttribute('data-roi-wh-pinned')));
        if (warehouseBulkLabel.test(cap) || hiddenSelection) {
          e.preventDefault();
          e.stopImmediatePropagation();
          const status = f.querySelector('[data-ro-wh-status]');
          if (status) status.textContent = hiddenSelection
            ? '還有自選以外的物品已勾選。請先全部取消，或切回原分類確認。'
            : '請用上方按鈕勾選自選分頁顯示的物品。';
          return;
        }
      }
      if (/^勾選這頁可以賣的/.test(cap)) {
        refreshWarehouse();
        requestAnimationFrame(() => requestAnimationFrame(() => refreshWarehouse()));
        return;
      }
      if (/^直接賣掉\s*\d+\s*項/.test(cap) && state.whProtect) {
        refreshWarehouse();
        let review;
        try { review = readSaleItems(f, btn); }
        catch (err) {
          e.preventDefault(); e.stopImmediatePropagation(); whSaleApproval = null;
          const status = f.querySelector('[data-ro-wh-status]');
          if (status) status.textContent = err.message;
          return;
        }
        const approval = whSaleApproval;
        whSaleApproval = null;
        if (approval?.field === f && approval.saleBtn === btn && Date.now() <= approval.until && approval.sig === review.sig) return;
        if (!state.whSaleReview) return;
        e.preventDefault(); e.stopImmediatePropagation();
        showWarehouseSaleReview(f, btn, review.items, review.sig);
        return;
      }
    }
    if (e.target instanceof HTMLInputElement && e.target.type === 'checkbox') {
      const li = e.target.closest('li');
      const itemId = warehouseItemId(li);
      const itemName = clean(li?.querySelector('button[aria-label$="的物品資訊"]')?.textContent);
      if (e.target.checked && itemId && state.whProtect && clean(e.target.getAttribute('aria-label')).startsWith('賣掉 ') &&
          getLockReason(itemId, itemName, clean(li.textContent))) {
        e.preventDefault(); e.stopImmediatePropagation(); return;
      }
      if (!(e.ctrlKey || e.metaKey)) return;
      const verb = clean(e.target.getAttribute('aria-label')).match(/^(賣掉|存入|取出|領出)\s/)?.[1];
      if (!verb) return;
      const action = verb === '賣掉' ? '直接賣掉' : verb;
      const initialTotal = warehouseTotal(f, action);
      if (initialTotal == null) return;
      if (e.target.checked && initialTotal >= 100) { e.preventDefault(); e.stopImmediatePropagation(); return; }
      const src = li?.querySelector('img[src*="/client/item/"]')?.getAttribute('src');
      if (!src) return;
      const source = e.target;
      const next = source.checked;
      setTimeout(() => {
        if (e.defaultPrevented || !f.isConnected || !f.contains(source) || source.checked !== next) return;
        if (source.closest('li')?.querySelector('img[src*="/client/item/"]')?.getAttribute('src') !== src) return;
        const rows = [...f.querySelectorAll('li')];
        const total = warehouseTotal(f, action);
        if (total == null) return;
        let count = Math.max(total, initialTotal + (next ? 1 : -1));
        for (const row of rows) {
          if (next && count >= 100) break;
          const cb = row.querySelector('input[type="checkbox"]');
          if (!cb || !f.contains(cb) || cb === source || cb.disabled || cb.checked === next) continue;
          if (row.querySelector('img[src*="/client/item/"]')?.getAttribute('src') !== src) continue;
          if (next && row.dataset.roiWhLocked !== undefined && clean(cb.getAttribute('aria-label')).startsWith('賣掉 ')) continue;
          cb.click();
          if (cb.checked === next) count += next ? 1 : -1;
        }
      }, 0);
    }
  }, true);

  const WAREHOUSE_OPEN_BOXES = new Map([
    [603, '神秘箱子'],
    [617, '神秘紫箱'],
    [616, '老舊收集冊'],
  ]);
  const WH_BOX_COMMAND_GAP_MS = 380;
  let whBoxOpenBusy = false;

  function diffBoxInventoryGains(beforeInv, afterInv) {
    const beforeMap = new Map();
    for (const st of beforeInv || []) {
      if (st && Number.isSafeInteger(st.uid)) beforeMap.set(st.uid, st.qty || 0);
    }
    const gains = [];
    for (const st of afterInv || []) {
      if (!st || !Number.isSafeInteger(st.uid)) continue;
      const prev = beforeMap.get(st.uid) ?? 0;
      const next = st.qty || 0;
      if (next > prev) {
        gains.push({
          uid: st.uid,
          itemId: st.itemId,
          qty: next - prev,
          refine: st.refine || 0,
          cards: Array.isArray(st.cards) ? st.cards : [],
          unidentified: Boolean(st.unidentified),
        });
      }
    }
    return gains;
  }

  function buildBoxDepositItems(pendingDeposit, inventory, equipment) {
    const equipped = new Set(Object.values(equipment || {}).filter(Boolean));
    const invMap = new Map((inventory || []).map((st) => [st.uid, st]));
    const items = [];
    for (const [uid, qty] of pendingDeposit) {
      if (equipped.has(uid)) continue;
      const live = invMap.get(uid);
      if (!live || !Number.isSafeInteger(live.qty) || live.qty <= 0) continue;
      const sendQty = Math.min(qty, live.qty);
      if (sendQty > 0) items.push({ uid, qty: sendQty });
    }
    return items;
  }

  function planBoxWithdrawBatch(storage, snapshot, itemId, wantedQty, pack, autoDeposit) {
    if (!Array.isArray(storage?.items) || !isPlainRecord(storage.fees)) throw Error('無法確認倉庫庫存');
    const stacks = storage.items
      .filter((it) => it && it.itemId === itemId && Number.isSafeInteger(it.sid) && it.sid > 0 && Number.isSafeInteger(it.qty) && it.qty > 0)
      .sort((a, b) => Number(Boolean(a.locked)) - Number(Boolean(b.locked)) || Number(Boolean(a.bound)) - Number(Boolean(b.bound)) || a.sid - b.sid);
    if (!stacks.length) return { items: [], totalQty: 0, fee: 0 };

    const fee = Object.hasOwn(storage.fees, snapshot.mapId) ? storage.fees[snapshot.mapId] : null;
    if (!Number.isSafeInteger(fee) || fee < 0 || snapshot.activity === 'dead') throw Error('目前不在可使用倉庫的城鎮或角色已死亡');
    if (!(snapshot.character?.zeny >= fee)) throw Error('Zeny 不足以支付倉庫費');

    const maxWeight = snapshot.derived?.weightMax;
    if (!Number.isFinite(snapshot.weight) || snapshot.weight < 0 ||
        !Number.isFinite(maxWeight) || maxWeight <= 0 || !Array.isArray(snapshot.inventory)) {
      throw Error('無法確認背包剩餘容量');
    }
    const freeSlots = 100 - snapshot.inventory.length;
    const rawWeight = pack?.items?.get(itemId)?.weight;
    const itemWeight = Number.isFinite(rawWeight) && rawWeight >= 0 ? rawWeight : 20;
    const itemUnits = Math.round(itemWeight * 10);
    // 預留 200 負重給開出來的物品，避免領完箱子就超重。
    const reserveUnits = 2000;
    let freeUnits = Math.round(maxWeight * 10) - Math.round(snapshot.weight * 10);
    const usableUnits = Math.max(freeUnits - reserveUnits, itemUnits);

    const canMergeStack = (it) => snapshot.inventory.some((st) =>
      st.itemId === it.itemId &&
      Boolean(st.locked) === Boolean(it.locked) &&
      Boolean(st.bound) === Boolean(it.bound) &&
      (st.expiresWallMs ?? 0) === (it.expiresWallMs ?? 0));

    // 若啟用自動存倉，每批最多領 20 個且預留至少 2 格（除非只剩 1 格且箱子可合併堆疊）。
    const batchCap = autoDeposit ? Math.min(wantedQty, 20) : wantedQty;
    let remaining = batchCap;
    let slotsLeft = freeSlots;
    const picked = [];
    for (const st of stacks) {
      if (remaining <= 0) break;
      const merge = canMergeStack(st);
      // 至少需留 1 格給開出的物品（若箱子本身佔新格，至少需要 2 格；若只開 1 個且開完該格會釋出，1 格亦可）。
      const minSlotsNeeded = merge ? 1 : (remaining === 1 ? 1 : 2);
      if (slotsLeft < minSlotsNeeded) continue;
      if (freeUnits < itemUnits) break;
      const byWeight = itemUnits > 0 ? Math.max(1, Math.floor(usableUnits / itemUnits)) : st.qty;
      const byActualWeight = itemUnits > 0 ? Math.floor(freeUnits / itemUnits) : st.qty;
      const take = Math.min(remaining, st.qty, byWeight, byActualWeight);
      if (take < 1) continue;
      picked.push({ sid: st.sid, qty: take });
      remaining -= take;
      freeUnits -= take * itemUnits;
      if (!merge) slotsLeft--;
    }
    const totalQty = picked.reduce((sum, x) => sum + x.qty, 0);
    if (!totalQty) throw Error('背包格數或負重不足，請先整理背包後再試');
    return { items: picked, totalQty, fee };
  }

  function resolveBoxItemName(itemId, pack) {
    return pack?.items?.get(itemId)?.name || ITEM_NAME_CACHE.get(itemId) || WAREHOUSE_OPEN_BOXES.get(itemId) || `道具 #${itemId}`;
  }

  function resolveWarehouseActor(field) {
    if (positiveId(state.activeCharId)) return Number(state.activeCharId);
    if (typeof refineActor === 'function') {
      const id = readFiberForUi(() => refineActor({ table: field }));
      if (positiveId(id)) return Number(id);
    }
    return null;
  }

  async function runWarehouseBoxOpener(options) {
    const {
      characterId, itemId, targetCount, autoDeposit = true, pack = null,
      isStopped = () => false, onProgress = () => {},
      apiJson = partyApiJson, sendCommand = partyCommand, wait = sleep,
      getEpoch = () => refineIdentityEpoch, getActiveCharId = () => state.activeCharId,
    } = options;

    if (!positiveId(characterId)) throw Error('無法確認目前角色 ID，請稍候或重新切換角色');
    if (!Number.isSafeInteger(targetCount) || targetCount < 1) throw Error('開箱數量必須大於 0');

    const startEpoch = getEpoch();
    const assertActor = () => {
      if (getEpoch() !== startEpoch || (getActiveCharId() != null && Number(getActiveCharId()) !== characterId)) {
        throw Error('偵測到角色切換，已停止開箱');
      }
    };

    const lootTotals = new Map();
    const pendingDeposit = new Map();
    let opened = 0;
    let deposited = 0;
    let lastCommandAt = -Infinity;

    const pace = async () => {
      const gap = WH_BOX_COMMAND_GAP_MS - (performance.now() - lastCommandAt);
      if (gap > 0) await wait(gap);
      assertActor();
    };

    const runCmd = async (command, rev) => {
      await pace();
      lastCommandAt = performance.now();
      const res = await sendCommand(characterId, command, rev);
      if (!res?.view?.snapshot || !Number.isSafeInteger(res.view.commandRevision)) {
        throw Error('伺服器未回傳最新角色狀態，已停止以確保安全');
      }
      return { snap: res.view.snapshot, rev: res.view.commandRevision };
    };

    const recordGains = (gains) => {
      for (const g of gains) {
        pendingDeposit.set(g.uid, (pendingDeposit.get(g.uid) || 0) + g.qty);
        const key = `${g.itemId}:${g.refine}:${g.unidentified ? 1 : 0}`;
        const prev = lootTotals.get(key) || {
          itemId: g.itemId,
          name: resolveBoxItemName(g.itemId, pack),
          qty: 0,
          refine: g.refine,
          unidentified: g.unidentified,
        };
        prev.qty += g.qty;
        lootTotals.set(key, prev);
      }
    };

    const flushDeposit = async (snap, rev) => {
      const items = buildBoxDepositItems(pendingDeposit, snap.inventory, snap.equipment);
      if (!items.length) {
        pendingDeposit.clear();
        return { snap, rev };
      }
      onProgress({ phase: 'deposit', opened, targetCount, deposited, lootTotals });
      const next = await runCmd({ type: 'storageDeposit', items }, rev);
      const count = items.reduce((sum, x) => sum + x.qty, 0);
      deposited += count;
      pendingDeposit.clear();
      onProgress({ phase: 'deposited', opened, targetCount, deposited, lootTotals });
      return next;
    };

    assertActor();
    let { storage } = await apiJson('/api/storage');
    assertActor();
    let server = await apiJson(`/api/characters/${characterId}?deferCatchup=1`);
    assertActor();
    if (Number(server?.characterId) !== characterId || !server?.snapshot?.character || !Number.isSafeInteger(server.commandRevision)) {
      throw Error('無法讀取角色狀態，已停止開箱');
    }
    let snap = server.snapshot;
    let rev = server.commandRevision;
    let stopNote = '';

    try {
      while (opened < targetCount && !isStopped()) {
        assertActor();
        const remaining = targetCount - opened;
        const plan = planBoxWithdrawBatch(storage, snap, itemId, remaining, pack, autoDeposit);
        if (!plan.totalQty) {
          stopNote = '倉庫箱子已全部領完';
          break;
        }

        const beforeWithdrawInv = snap.inventory;
        onProgress({ phase: 'withdraw', opened, targetCount, deposited, batchQty: plan.totalQty, lootTotals });
        ({ snap, rev } = await runCmd({ type: 'storageWithdraw', items: plan.items }, rev));

        const withdrawnGains = diffBoxInventoryGains(beforeWithdrawInv, snap.inventory).filter((g) => g.itemId === itemId);
        let boxesLeftInBatch = withdrawnGains.reduce((sum, g) => sum + g.qty, 0);
        if (boxesLeftInBatch <= 0) {
          throw Error('領倉後未在背包找到對應箱子，已停止');
        }
        // 紀錄每個被領出的箱子堆疊 uid 與數量，確保只開本批領出的箱子。
        const batchQueue = withdrawnGains.map((g) => ({ uid: g.uid, qty: g.qty }));

        for (const entry of batchQueue) {
          while (entry.qty > 0 && opened < targetCount && !isStopped()) {
            assertActor();
            const liveBox = snap.inventory.find((st) => st.uid === entry.uid && st.itemId === itemId && st.qty > 0);
            if (!liveBox) break;

            const prevInv = snap.inventory;
            onProgress({ phase: 'open', opened, targetCount, deposited, lootTotals });
            ({ snap, rev } = await runCmd({ type: 'useItem', uid: entry.uid }, rev));
            opened++;
            entry.qty--;
            boxesLeftInBatch--;

            const gains = diffBoxInventoryGains(prevInv, snap.inventory);
            recordGains(gains);
            onProgress({ phase: 'opened', opened, targetCount, deposited, lastGains: gains, lootTotals });

            const freeSlots = 100 - snap.inventory.length;
            const freeWeight = (snap.derived?.weightMax ?? 0) - (snap.weight ?? 0);
            if (freeSlots <= 1 || freeWeight <= 200) {
              if (autoDeposit && pendingDeposit.size > 0) {
                ({ snap, rev } = await flushDeposit(snap, rev));
              } else if (!autoDeposit && freeSlots <= 0) {
                stopNote = '背包已滿';
                break;
              }
            }
          }
          if (stopNote || isStopped()) break;
        }

        if (autoDeposit && pendingDeposit.size > 0 && !stopNote) {
          ({ snap, rev } = await flushDeposit(snap, rev));
        }
        if (stopNote || isStopped() || opened >= targetCount) break;

        // 下一批前重新抓取倉庫庫存。
        assertActor();
        ({ storage } = await apiJson('/api/storage'));
      }
    } finally {
      if (autoDeposit && pendingDeposit.size > 0) {
        try {
          assertActor();
          ({ snap, rev } = await flushDeposit(snap, rev));
        } catch {}
      }
    }

    return { opened, deposited, stopped: isStopped(), stopNote, lootTotals };
  }

  function openWarehouseBoxDialog(field, itemId, fallbackName, fallbackStock) {
    if (whBoxOpenBusy) return;
    document.querySelector('[data-roi-wh-box-dialog]')?.remove();

    const dlg = document.createElement('dialog');
    dlg.dataset.roiWhBoxDialog = '';
    dlg.style.cssText = 'width:min(540px,calc(100vw - 24px));max-height:84vh;padding:16px 18px;background:var(--roi-surface);color:var(--roi-text);border:1.5px solid #f59e0b;border-radius:12px;box-shadow:0 16px 48px var(--roi-shadow);font-size:13px;backdrop-filter:blur(10px);';
    const boxName = fallbackName || WAREHOUSE_OPEN_BOXES.get(itemId) || `箱子 #${itemId}`;
    const stock = Number.isSafeInteger(fallbackStock) && fallbackStock > 0 ? fallbackStock : 1;

    dlg.innerHTML = `
      <div data-box-title style="font-weight:bold;font-size:15px;color:var(--roi-warning);border-bottom:1px solid var(--roi-edge);padding-bottom:8px;margin-bottom:10px;"></div>
      <div style="display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-bottom:8px;">
        <span>倉庫現有 <b data-box-stock>${stock.toLocaleString('zh-TW')}</b> 個｜開啟數量：</span>
        <input type="number" data-box-qty class="xp-input" min="1" max="${stock}" value="${Math.min(stock, 10)}" style="width:72px;">
        <button type="button" class="xp-btn small" data-box-preset="1">1</button>
        <button type="button" class="xp-btn small" data-box-preset="5">5</button>
        <button type="button" class="xp-btn small" data-box-preset="10">10</button>
        <button type="button" class="xp-btn small" data-box-preset="50">50</button>
        <button type="button" class="xp-btn small" data-box-preset="all">全部</button>
      </div>
      <label style="display:flex;align-items:center;gap:6px;margin-bottom:10px;cursor:pointer;">
        <input type="checkbox" data-box-autodeposit checked> 開完自動將獲得物品存回倉庫（不影響背包原有物品）
      </label>
      <div data-box-status role="status" style="padding:6px 8px;margin-bottom:10px;background:var(--roi-panel);border:1px solid var(--roi-edge);border-radius:6px;font-size:12px;color:var(--roi-info);">
        準備就緒：按下「開始開箱」會自動背景領箱、開箱並將開出的物品存回倉庫。
      </div>
      <div data-box-loot style="max-height:38vh;overflow:auto;margin-bottom:12px;border:1px solid var(--roi-edge);border-radius:6px;padding:6px 10px;background:var(--roi-inset);font-size:12px;">
        <span style="color:var(--roi-muted);">尚無開箱紀錄</span>
      </div>
      <div style="display:flex;justify-content:flex-end;gap:8px;">
        <button type="button" class="xp-btn small" data-box-close>關閉</button>
        <button type="button" class="xp-btn small" data-box-stop style="background:#dc2626;color:#fff;border:none;display:none;">⏹ 停止</button>
        <button type="button" class="xp-btn small" data-box-start style="background:linear-gradient(135deg,#a34f05,#854009);color:#fff;font-weight:bold;border:none;">🚀 開始開箱</button>
      </div>
    `;
    document.body.appendChild(dlg);
    dlg.querySelector('[data-box-title]').textContent = `📦 倉庫直接開箱：${boxName}`;

    const qtyInput = dlg.querySelector('[data-box-qty]');
    const stockEl = dlg.querySelector('[data-box-stock]');
    const autoDepBox = dlg.querySelector('[data-box-autodeposit]');
    const statusEl = dlg.querySelector('[data-box-status]');
    const lootEl = dlg.querySelector('[data-box-loot]');
    const closeBtn = dlg.querySelector('[data-box-close]');
    const stopBtn = dlg.querySelector('[data-box-stop]');
    const startBtn = dlg.querySelector('[data-box-start]');
    let currentStock = stock;
    let stopRequested = false;

    const renderLoot = (lootTotals) => {
      if (!lootTotals || !lootTotals.size) {
        lootEl.innerHTML = '<span style="color:var(--roi-muted);">尚無開箱紀錄</span>';
        return;
      }
      const rows = [...lootTotals.values()].sort((a, b) => {
        const aCard = /卡片$/.test(a.name) ? 1 : 0;
        const bCard = /卡片$/.test(b.name) ? 1 : 0;
        return bCard - aCard || b.qty - a.qty || a.itemId - b.itemId;
      });
      lootEl.replaceChildren();
      for (const item of rows) {
        const row = element('div', null, 'display:flex;justify-content:space-between;align-items:center;padding:3px 0;border-bottom:1px dashed var(--roi-edge);');
        const isCard = /卡片$/.test(item.name);
        const label = `${item.refine ? '+' + item.refine + ' ' : ''}${item.name}${item.unidentified ? ' (未鑑定)' : ''}`;
        const nameSpan = element('span', isCard ? `✨ ${label}` : label, isCard ? 'color:var(--roi-warning);font-weight:bold;' : '');
        const qtySpan = element('b', `×${item.qty.toLocaleString('zh-TW')}`, 'color:var(--roi-success);');
        row.append(nameSpan, qtySpan);
        lootEl.append(row);
      }
    };

    for (const btn of dlg.querySelectorAll('[data-box-preset]')) {
      btn.onclick = () => {
        if (whBoxOpenBusy) return;
        const val = btn.dataset.boxPreset === 'all' ? currentStock : Math.min(currentStock, Number(btn.dataset.boxPreset));
        qtyInput.value = String(Math.max(1, val));
      };
    }

    const setRunning = (running) => {
      whBoxOpenBusy = running;
      qtyInput.disabled = running;
      autoDepBox.disabled = running;
      for (const btn of dlg.querySelectorAll('[data-box-preset]')) btn.disabled = running;
      startBtn.style.display = running ? 'none' : 'inline-block';
      stopBtn.style.display = running ? 'inline-block' : 'none';
      closeBtn.disabled = running;
    };

    stopBtn.onclick = () => {
      stopRequested = true;
      statusEl.textContent = '⏹ 正在停止開箱並收尾…';
    };
    closeBtn.onclick = () => {
      if (whBoxOpenBusy) return;
      dlg.close();
    };
    dlg.addEventListener('cancel', (e) => {
      if (whBoxOpenBusy) e.preventDefault();
    });
    dlg.addEventListener('close', () => dlg.remove());

    startBtn.onclick = async () => {
      if (whBoxOpenBusy) return;
      const targetCount = Math.floor(Number(qtyInput.value));
      if (!Number.isSafeInteger(targetCount) || targetCount < 1) {
        statusEl.textContent = '⚠️ 請輸入有效的開箱數量';
        return;
      }
      const characterId = resolveWarehouseActor(field);
      if (!characterId) {
        statusEl.textContent = '⚠️ 無法確認目前角色 ID，請稍候再試';
        return;
      }

      stopRequested = false;
      setRunning(true);
      statusEl.style.color = 'var(--roi-info)';
      statusEl.textContent = '⏳ 正在載入道具資料並準備領箱…';

      let pack = refinePack || null;
      if (!pack && typeof loadLootPack === 'function') {
        try {
          pack = await loadLootPack();
          if (pack && !refinePack) refinePack = pack;
        } catch {}
      }

      try {
        const result = await runWarehouseBoxOpener({
          characterId,
          itemId,
          targetCount,
          autoDeposit: autoDepBox.checked,
          pack,
          isStopped: () => stopRequested,
          onProgress: (p) => {
            const label = p.phase === 'withdraw' ? `領取 ${p.batchQty} 個箱子中…`
              : p.phase === 'deposit' ? '將開出的物品存回倉庫中…'
              : `開箱中（${p.opened} / ${p.targetCount}）`;
            statusEl.textContent = `📦 ${label}${p.deposited ? `｜已自動存倉 ${p.deposited} 件` : ''}`;
            renderLoot(p.lootTotals);
          },
        });
        currentStock = Math.max(0, currentStock - result.opened);
        stockEl.textContent = currentStock.toLocaleString('zh-TW');
        qtyInput.max = String(Math.max(1, currentStock));
        if (Number(qtyInput.value) > currentStock && currentStock > 0) qtyInput.value = String(currentStock);
        renderLoot(result.lootTotals);
        statusEl.style.color = result.stopped || result.stopNote ? 'var(--roi-warning)' : 'var(--roi-success)';
        const suffix = result.stopNote ? `（${result.stopNote}）` : result.stopped ? '（已手動停止）' : '';
        statusEl.textContent = `🎉 完成！共開啟 ${result.opened} 個【${boxName}】${result.deposited ? `，已自動存倉 ${result.deposited} 件` : ''}${suffix}`;
        if (!result.stopped && result.opened > 0) {
          alertUser('📦 倉庫開箱完成', `共開啟 ${result.opened} 個 ${boxName}${result.deposited ? `，已自動存倉 ${result.deposited} 件` : ''}`, false);
        }
      } catch (error) {
        statusEl.style.color = '#ef4444';
        statusEl.textContent = `🛑 已停止：${error.message}`;
      } finally {
        setRunning(false);
      }
    };

    dlg.showModal();
  }

  function refreshWarehouseBoxOpener() {
    const fields = [...document.querySelectorAll('fieldset')].filter((f) => {
      const leg = [...f.children].find((c) => c.tagName === 'LEGEND');
      return leg && /^倉庫(?:\s*[（(]|$)/.test(clean(leg.textContent)) && visible(f);
    });
    for (const f of fields) {
      const list = f.querySelector(':scope > ul');
      if (!list) continue;
      for (const li of list.children) {
        const rawId = warehouseItemId(li);
        const itemId = rawId ? Number(rawId) : 0;
        const existing = li.querySelector('[data-roi-wh-open-box]');
        if (!WAREHOUSE_OPEN_BOXES.has(itemId)) {
          if (existing) existing.remove();
          continue;
        }
        let btn = existing;
        if (!btn) {
          btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'xp-btn small';
          btn.dataset.roiWhOpenBox = String(itemId);
          btn.textContent = '📦 開箱';
          btn.title = '直接在倉庫領出、開箱並自動存回倉庫';
          btn.style.cssText = 'margin-left:4px;padding:1px 6px;font-size:11px;background:linear-gradient(135deg,#a34f05,#854009);color:#fff;border:none;border-radius:4px;cursor:pointer;';
          btn.onclick = (event) => {
            event.preventDefault();
            event.stopPropagation();
            const currentId = Number(warehouseItemId(li)) || itemId;
            const nameBtn = li.querySelector('button[aria-label$="的物品資訊"]');
            const name = clean(nameBtn?.textContent) || WAREHOUSE_OPEN_BOXES.get(currentId);
            const qtyMatch = clean(li.textContent).match(/×\s*([\d,]+)/);
            const stock = qtyMatch ? Number(qtyMatch[1].replace(/,/g, '')) : 1;
            openWarehouseBoxDialog(f, currentId, name, stock);
          };
          const anchor = li.querySelector('button[aria-label$="的物品資訊"]');
          if (anchor) anchor.after(btn);
          else li.append(btn);
        }
        btn.disabled = whBoxOpenBusy;
      }
    }
  }
