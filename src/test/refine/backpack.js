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
  let refPanel = null, refOpen = false, refBusy = false, refStop = false, refStopReason = null, refTargetPlus = 6, refMode = 'round_robin', refSkipConfirm = true, refAutoWh = true;
  let refMaterialBatch = readValidatedSetting('roi-refine-material-batch-v1', validateMaterialBatch, 20);

  let bagMemo = null;
  const bagFastMiss = new WeakMap();

  function findModernBackpack(input) {
    const panel = input.closest('[role="tabpanel"][aria-label="道具"]');
    if (!panel || panel.querySelector('[role="region"][aria-label="多選販售"]')) return null;
    const list = uniqueVisible(panel, '[role="listbox"][aria-label="道具"], [role="group"][aria-label="道具"]');
    const detail = uniqueVisible(panel, '[role="region"][aria-label="道具詳情"]');
    const anchor = list?.parentElement?.parentElement;
    const host = anchor?.parentElement;
    return list && detail && host && list.parentElement === detail.parentElement ? { list, detail, anchor, host } : null;
  }

  function readModernBackpack(view) {
    const { list, detail, anchor, host } = view;
    const tree = currentFiberRoot(list);
    const props = tree && getCommittedProps(list, (p) => p.label === '道具' && Array.isArray(p.items));
    if (!props || !props.items.every((item) => Number.isSafeInteger(item?.st?.uid))) return null;
    let fiber = getReactFiber(list);
    let top = fiber;
    while (top?.return) top = top.return;
    if (top !== tree) fiber = fiber?.alternate;

    // 道具列來自同一份原生背包快照。只讀取清單祖先的已提交 Hook，
    // 避免從其他浮動面板或未提交的 React 更新取得另一個角色。
    let s;
    for (let depth = 0; !s && fiber && depth < 40; depth++, fiber = fiber.return) {
      if (typeof fiber.type !== 'function') continue;
      for (let hook = fiber.memoizedState, count = 0; hook && count < 100; hook = hook.next, count++) {
        const snap = hook.memoizedState;
        if (!snap?.character || !Array.isArray(snap.inventory) || typeof snap.mapId !== 'string') continue;
        const inventory = new Set(snap.inventory);
        if (props.items.every(({ st }) => inventory.has(st))) { s = snap; break; }
      }
    }
    if (!s) return null;
    const entries = new Map(props.items.map(({ st, def }) => [st.uid, { st, def }]));
    const rows = [];
    for (const row of list.querySelectorAll(':scope > [role="option"], :scope > button[aria-selected]')) {
      const rowFiber = getReactFiber(row);
      if (!/^\d+$/.test(rowFiber?.key || '')) continue;
      const uid = Number(rowFiber.key);
      const entry = entries.get(uid);
      if (!entry || !visible(row)) continue;
      const name = clean(entry.def?.name || row.textContent).replace(/^\+\d+\s*/, '');
      rows.push({ uid, row, button: row, st: entry.st, name, ...classifyItem(entry.st.itemId, name) });
    }
    const val = { host, anchor, table: list, detail, modern: true, s, rows };
    bagMemo = { tree, table: list, val };
    return val;
  }

  function readBackpackContext(force = false) {
    const inputs = [...document.querySelectorAll('input[aria-label="搜尋物品"]')].filter(visible);
    if (inputs.length !== 1) return null;
    const modern = findModernBackpack(inputs[0]);
    if (modern) return readModernBackpack(modern);
    if (inputs[0].closest('[role="tabpanel"][aria-label="道具"]')) return null;
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
