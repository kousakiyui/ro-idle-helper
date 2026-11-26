
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
