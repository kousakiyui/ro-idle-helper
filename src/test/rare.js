
  const rarePanels = new WeakMap(), rareKnownRoots = new Set(), rareLastMap = new WeakMap();
  function validateRareAutoMap(value) {
    if (typeof value !== 'boolean') throw Error('稀有掉落開關格式不符');
    return value;
  }
  let rareAutoMap = readValidatedSetting('roi-rare-auto-map-v1', validateRareAutoMap, true);
  function setRareAutoMap(enabled) {
    try { GM_setValue('roi-rare-auto-map-v1', validateRareAutoMap(enabled)); } catch { log("rare", "無法保存或讀取稀有掉落設定"); }
    applyRareAutoMap(enabled);
  }
  function applyRareAutoMap(enabled) {
    rareAutoMap = enabled;
    for (const root of rareKnownRoots) {
      rareLastMap.delete(root);
      if (!enabled) {
        const status = rarePanels.get(root)?.querySelector('[data-ro-rare-status]');
        if (status) status.textContent = '稀有掉落自動同步已關閉';
      }
    }
    refreshRareHelper();
    syncHudSettings();
  }
  const isRareHeading = (s) => /^必撿稀有掉落\s*\(\s*\d+\s*項\s*\)$/.test(clean(s));
  const isRareBoundary = (s) => /^不在這張地圖(?:的)?\s*[:：]?$/.test(clean(s));

  function findRareBoundary(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let n; const matches = [];
    while ((n = walker.nextNode())) {
      if (isRareBoundary(n.textContent) && !n.parentElement?.closest('[data-ro-rare-helper]')) matches.push(n);
    }
    return matches.length === 1 ? matches[0] : null;
  }

  function findRareRoots() {
    const found = new Set();
    for (const h of document.querySelectorAll('legend,h2,h3,h4,strong,b,div,p,span')) {
      if (h.childElementCount > 3 || !visible(h) || h.closest('[data-ro-rare-helper]') || !isRareHeading(h.textContent) || h.querySelector('input')) continue;
      const field = h.closest('fieldset');
      let matched = false, parent = h.parentElement;
      for (let i = 0; parent && parent !== document.body && i < 6; i++, parent = parent.parentElement) {
        if (parent.querySelector('input[type="checkbox"]') && (findRareBoundary(parent) || parent.querySelectorAll('input[type="checkbox"]').length >= 2)) {
          found.add(parent); matched = true; break;
        }
      }
      if (!matched && field && field.querySelector('input[type="checkbox"]')) found.add(field);
    }
    for (const r of rareKnownRoots) {
      if (!r.isConnected) { rareKnownRoots.delete(r); continue; }
      if (visible(r) && [...r.querySelectorAll('legend,h2,h3,h4,strong,b,div,p,span')].some((h) => h.childElementCount <= 3 && isRareHeading(h.textContent))) found.add(r);
    }
    const res = [...found].filter((r) => ![...found].some((o) => o !== r && r.contains(o)));
    res.forEach((r) => rareKnownRoots.add(r));
    return res;
  }

  function scanRareItems(root) {
    const marker = findRareBoundary(root), items = [];
    if (!marker && clean(root.textContent).includes('不在這張地圖')) return null;
    for (const box of root.querySelectorAll('input[type="checkbox"]')) {
      if (box.closest('[data-ro-rare-helper]')) continue;
      const nativeLabel = box.closest('label') || [...(box.labels || [])][0];
      const name = clean(box.getAttribute('aria-label') || nativeLabel?.textContent || '');
      if (!name || name.length > 240 || /^(?:全選|全取消|必撿稀有掉落|自動撿取|優先撿取|沒有怪物攻擊)/.test(name)) continue;
      const pos = marker ? marker.compareDocumentPosition(box) : Node.DOCUMENT_POSITION_PRECEDING;
      const group = pos & Node.DOCUMENT_POSITION_FOLLOWING ? 'away' : pos & Node.DOCUMENT_POSITION_PRECEDING ? 'here' : null;
      if (!group) return null;
      items.push({ box, group });
    }
    return items;
  }

  function getRareContext(root) {
    const tree = currentFiberRoot(root);
    if (!tree) return null;
    const stack = [{ f: tree, p: null }];
    let guard = 0;
    while (stack.length && ++guard < 80000) {
      const { f: node, p } = stack.pop();
      if (!node) continue;
      const props = node.memoizedProps;
      const context = props?.draft && typeof props.update === 'function' && Array.isArray(props.monsterIds) ? props : p;
      if (node.stateNode === root) {
        if (!context) return null;
        const entries = [], todo = [{ f: node, id: null }];
        while (todo.length) {
          const x = todo.pop();
          const id = x.f.type === 'label' && /^\d+$/.test(x.f.key || '') ? Number(x.f.key) : x.id;
          if (x.f.stateNode?.matches?.('input[type="checkbox"]')) entries.push({ box: x.f.stateNode, id });
          for (let c = x.f.child; c; c = c.sibling) todo.push({ f: c, id });
        }
        return { p: context, entries };
      }
      if (node.sibling) stack.push({ f: node.sibling, p });
      if (node.child) stack.push({ f: node.child, p: context });
    }
    return null;
  }

  function fastSelectRare(root, group, next) {
    const rs = scanRareItems(root);
    const statusSpan = rarePanels.get(root)?.querySelector('[data-ro-rare-status]');
    if (!rs) { if (statusSpan) statusSpan.textContent = '⚠️ 無法辨識本圖與其他地圖的掉落'; return false; }
    let changed = 0;
    let rows = rs;
    while (rows) {
      const current = group === 'sync'
        ? rows.find((r) => r.group !== 'here' && r.box.checked) ?? rows.find((r) => r.group === 'here' && !r.box.checked)
        : rows.find((r) => r.group === group && r.box.checked !== next);
      if (!current) break;
      const desired = group === 'sync' ? current.group === 'here' : next;
      if (changed >= rs.length + 5 || !current.box.isConnected) {
        if (statusSpan) statusSpan.textContent = '⚠️ 遊戲清單已變動，請重試';
        return false;
      }
      if (current.box.disabled) {
        if (statusSpan) statusSpan.textContent = '⚠️ 有無法勾選的道具，請檢查清單';
        return false;
      }
      current.box.click();
      if (current.box.isConnected && current.box.checked !== desired) {
        if (statusSpan) statusSpan.textContent = '⚠️ 遊戲未接受勾選，請檢查清單';
        return false;
      }
      changed++;
      rows = scanRareItems(root);
    }
    if (!rows) {
      if (statusSpan) statusSpan.textContent = '⚠️ 無法辨識更新後的掉落清單';
      return false;
    }
    const selected = rows.filter((r) => r.box.checked).length;
    if (statusSpan) statusSpan.textContent = `✅ 已調整 ${changed} 項，目前勾選 ${selected} 項；請按「套用設定」`;
    return true;
  }

  const rareHeadingXPath = '//text()[starts-with(normalize-space(.), "必撿稀有掉落") and not(ancestor::*[@id="ro-helper-hud"])]';
  function refreshRareHelper() {
    // 頁面沒有「必撿稀有掉落」文字時，略過整頁 div/span 掃描（原生 XPath 單次比對）。
    try {
      if (![...document.body.children].some((c) => !c.matches('#ro-helper-hud,#roi-helper-mvp-panel,#roi-item-hover-tooltip,script,style') && c.textContent.includes('必撿稀有掉落'))) return;
    } catch { log("rare", "無法保存或讀取稀有掉落設定"); }
    for (const root of findRareRoots()) {
      let panel = rarePanels.get(root);
      if (!panel?.isConnected || !root.contains(panel)) {
        panel = document.createElement('div');
        panel.dataset.roRareHelper = '';
        panel.style.cssText = 'display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin:6px 0;padding:6px 10px;background:var(--roi-panel);border-left:3px solid #38bdf8;border-radius:6px;font-size:11.5px;box-shadow:0 2px 8px rgba(0,0,0,0.3);';
        const statusSpan = document.createElement('span');
        statusSpan.dataset.roRareStatus = ''; statusSpan.style.color = 'var(--roi-success)';
        statusSpan.textContent = rareAutoMap ? '稀有掉落自動同步已開啟' : '稀有掉落自動同步已關閉';
        panel.append(statusSpan);
        const h = [...root.querySelectorAll('legend,h2,h3,h4,strong,b,div,p,span')].find((e) => e.childElementCount <= 3 && isRareHeading(e.textContent));
        if (h?.parentElement === root) h.after(panel);
        else root.prepend(panel);
        rarePanels.set(root, panel);
      }
      if (rareAutoMap) {
        const context = getRareContext(root);
        if (context) {
          const mapSig = JSON.stringify([context.p.draft.lockMap, context.p.monsterIds]);
          if (rareLastMap.get(root) !== mapSig) {
            if (fastSelectRare(root, 'sync', true)) rareLastMap.set(root, mapSig);
          }
        }
      }
    }
  }
