  const refineCategories = {
    all: '全部', weapon: '武器', armor: '鎧甲', shield: '盾牌',
    head: '頭飾', garment: '披肩', shoes: '鞋子'
  };
  let refCategory = 'all';
  let refinePack;

  function refineCategory(item) {
    const slots = item?.slots ?? [];
    return ['weapon', 'armor', 'shield', 'head', 'garment', 'shoes'].find((category) =>
      category === 'head' ? slots.some((slot) => slot.startsWith('head')) : slots.includes(category));
  }

  function canRefine(stack) {
    if (!stack || stack.locked || stack.broken || stack.unidentified) return false;
    const item = refinePack?.items.get(stack.itemId);
    if (item?.category !== 'equipment' || !item.refineable) return false;
    const category = refineCategory(item);
    const level = Math.min(4, Math.max(1, item.weaponLevel ?? 1));
    const steps = category === 'weapon' ? refinePack.refine?.weapon?.[level] : refinePack.refine?.armor;
    const plus = stack.refine ?? 0;
    return Boolean(category && plus < 10 && steps?.[plus]);
  }
  let refPanel = null, refOpen = false, refBusy = false, refStop = false, refTargetPlus = 6, refMode = 'round_robin', refSkipConfirm = true, refAutoWh = true;
  let refMaterialBatch = readValidatedSetting('roi-refine-material-batch-v1', validateMaterialBatch, 20);

  function materialWithdrawalAmount(requested, stock, nativeMax = '') {
    if (!validMaterialBatch(requested) || !Number.isSafeInteger(stock) || stock < 1) throw Error('無法確認材料庫存或領取數量');
    let count = Math.min(requested, stock);
    if (nativeMax !== '') {
      const max = Number(nativeMax);
      if (!Number.isSafeInteger(max) || max < 1) throw Error('原生領料數量上限不可用');
      count = Math.min(count, max);
    }
    return count;
  }
  let bagMemo = null;
  const bagFastMiss = new WeakMap();
  let visitingWarehouse = false;

  function readBackpackContext(force = false) {
    const inputs = [...document.querySelectorAll('input[aria-label="搜尋物品"]')].filter(visible);
    if (inputs.length !== 1) return null;
    let host = inputs[0].parentElement;
    while (host && host !== document.body && !host.querySelector('table.xp-table')) host = host.parentElement;
    const table = host?.querySelector('table.xp-table');
    const tableText = table?.textContent || '';
    if (!tableText.includes('回城賣') || !tableText.includes('存倉')) return null;
    const tree = currentFiberRoot(table);
    if (!tree) return null;
    if (!force && bagMemo?.tree === tree && bagMemo.table === table && bagMemo.val.host.isConnected) return bagMemo.val;

    const rowNodes = new Set(table.querySelectorAll('tbody > tr')), rows = [], snaps = [];
    const validSnap = (s) => s?.character && Array.isArray(s.inventory) && typeof s.mapId === 'string';
    const props = bagFastMiss.get(table) === tree ? null : getCommittedProps(table, (p) => validSnap(p?.s) || validSnap(p?.snap));
    const localSnap = props?.s || props?.snap;
    if (validSnap(localSnap)) {
      const localRows = [...rowNodes].map((row) => {
        const fiber = getReactFiber(row);
        return /^\d+$/.test(fiber?.key || '') ? { uid: Number(fiber.key), row } : null;
      });
      if (localRows.every(Boolean)) { snaps.push(localSnap); rows.push(...localRows); }
    }
    if (!snaps.length) {
      const stack = [tree];
      let guard = 0;
      const budget = createFiberScanBudget(table, backpackScanRetries);
      while (stack.length && ++guard < 80000) {
        budget.step();
        const f = stack.pop(); if (!f) continue;
        if (rowNodes.has(f.stateNode) && /^\d+$/.test(f.key || '')) rows.push({ uid: Number(f.key), row: f.stateNode });
        const p = f.memoizedProps;
        for (const s of [p?.s, p?.snap]) if (validSnap(s) && !snaps.includes(s)) snaps.push(s);
        if (typeof f.type === 'function') {
          for (let h = f.memoizedState; h && typeof h === 'object'; h = h.next) {
            if (validSnap(h.memoizedState) && !snaps.includes(h.memoizedState)) snaps.push(h.memoizedState);
          }
        }
        if (f.sibling) stack.push(f.sibling);
        if (f.child) stack.push(f.child);
      }
      budget.complete();
      if (!stack.length && snaps.length) bagFastMiss.set(table, tree);
    }
    const s = snaps[0];
    if (!s) return null;
    rows.sort((a, b) => a.row.rowIndex - b.row.rowIndex);
    const invMap = new Map(s.inventory.map((st) => [st.uid, st]));
    const val = {
      host, table, s,
      rows: rows.map((r) => {
        const st = invMap.get(r.uid);
        const nameBtn = r.row.querySelector('td button');
        const cleanName = clean(nameBtn?.textContent || '').replace(/^\+\d+\s*/, '');
        const cInfo = st ? classifyItem(st.itemId, cleanName) : { cat: 'other', sub: 'other' };
        return { ...r, st, name: cleanName || `裝備#${st?.itemId}`, cat: cInfo.cat, sub: cInfo.sub };
      })
    };
    bagMemo = { tree, table, val };
    return val;
  }

  const uniqueVisible = (root, selector, match = () => true) => {
    const candidates = [...root.querySelectorAll(selector)].filter((el) => visible(el) && match(el));
    return candidates.length === 1 ? candidates[0] : null;
  };
