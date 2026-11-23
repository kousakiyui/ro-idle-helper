
  function findTownSearchUI(visibleOnly = false) {
    for (const f of document.querySelectorAll('fieldset')) {
      const leg = [...f.children].find((c) => c.tagName === 'LEGEND');
      if (!leg || clean(roiPriceText(leg)) !== '搜尋所有城鎮的攤位') continue;
      for (const form of f.querySelectorAll('form')) {
        const inp = form.querySelector('input[type="text"],input[type="search"],input:not([type])');
        const btn = [...form.querySelectorAll('button')].find((b) => clean(b.textContent) === '搜尋');
        if (inp && btn && (!visibleOnly || visible(inp))) return { form, input: inp, button: btn };
      }
    }
    return null;
  }

  let townResultsTable = null;
  let townResultsRows = [];
  function sizeTownSearchResults() {
    const table = townResultsTable;
    const last = townResultsRows.at(-1);
    if (!table?.isConnected || !table.contains(last)) return;
    const height = last.getBoundingClientRect().bottom - table.getBoundingClientRect().top + table.scrollTop;
    const maxHeight = height > 0 ? `${Math.ceil(height)}px` : '';
    if (table.style.maxHeight !== maxHeight) table.style.maxHeight = maxHeight;
  }
  const townResultsObserver = new ResizeObserver(sizeTownSearchResults);

  function refreshTownSearchResults(ui) {
    const table = ui?.form.closest('fieldset')?.querySelector(':scope > table.xp-table');
    const rows = table?.tBodies[0]?.rows;
    const visibleRows = [];
    let offers = 0;
    for (const row of rows || []) {
      // The game inserts a full-width equipment details row beneath an expanded offer.
      if (row.cells.length > 1 && ++offers === 6) break;
      visibleRows.push(row);
    }
    const next = offers === 6 && visible(table) ? table : null;
    if (next === townResultsTable && (!next || (visibleRows.length === townResultsRows.length &&
        visibleRows.every((row, i) => row === townResultsRows[i])))) return;

    townResultsObserver.disconnect();
    if (townResultsTable && townResultsTable !== next) {
      townResultsTable.removeAttribute('data-roi-town-results');
      townResultsTable.removeAttribute('tabindex');
      townResultsTable.removeAttribute('role');
      townResultsTable.removeAttribute('aria-label');
      townResultsTable.style.maxHeight = '';
    }
    if (next && (next !== townResultsTable || visibleRows[0] !== townResultsRows[0])) next.scrollTop = 0;
    townResultsTable = next;
    townResultsRows = next ? visibleRows : [];
    if (!next) return;
    next.setAttribute('data-roi-town-results', '');
    next.setAttribute('tabindex', '0');
    next.setAttribute('role', 'table');
    next.setAttribute('aria-label', '跨城搜尋結果');
    sizeTownSearchResults();
    if (next.tHead) townResultsObserver.observe(next.tHead);
    for (const row of visibleRows) townResultsObserver.observe(row);
  }

  document.addEventListener('submit', (event) => {
    if (townResultsTable?.isConnected && event.target === findTownSearchUI()?.form) {
      // React can reuse the first row when successive searches share a result.
      townResultsTable.scrollTop = 0;
    }
  }, true);

  async function triggerNativeTownSearch(rawName, visibleOnly = false) {
    const baseName = clean(rawName).replace(/（.*?）|\(.*?\)/g, '').replace(/^\+\s*\d+\s*/, '').replace(/\s*\[\d+\]\s*$/, '').trim();
    if (!baseName) return;
    if (mktView) { mktView = false; syncMktMount(); await sleep(50); }

    const target = findTownSearchUI(visibleOnly);
    if (target && !target.input.disabled) {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(target.input, baseName);
      target.input.dispatchEvent(new Event('input', { bubbles: true }));
      target.input.dispatchEvent(new Event('change', { bubbles: true }));
      for (let i = 0; i < 15; i++) {
        await sleep(40);
        if (!target.button.disabled) {
          target.input.scrollIntoView({ block: 'nearest' });
          target.button.click();
          return;
        }
      }
    }
    const rows = [...document.querySelectorAll('table.xp-table tr')];
    const matchRow = rows.find((tr) => clean(tr.textContent).includes(baseName) && tr.querySelector('input[type="number"], button'));
    if (matchRow) {
      matchRow.scrollIntoView({ block: 'center', behavior: 'smooth' });
      matchRow.style.outline = '2px solid #facc15';
      setTimeout(() => { matchRow.style.outline = ''; }, 3000);
    }
  }

  const amtRx = /^(\d+|\d{1,3}(?:,\d{3})+)(?:\s*(Zeny|Z|澤尼))?$/i;
  const headRx = /^(?:單價|價格|售價|賣價|收購價|總價|總額|金額|實收|稅|稅金)(?:\s*[（(]\s*(?:Zeny|Z|澤尼)\s*[）)])?$|^(?:Zeny|澤尼)$/i;

  function alignAndColorizeNativeMarkets() {
    for (const table of document.querySelectorAll('table.xp-table')) {
      let scope = table.parentElement, hasPurchase = false;
      for (let d = 0; scope && d < 3 && scope !== document.body; d++, scope = scope.parentElement) {
        if ([...scope.querySelectorAll('button')].some((b) => /^購買(?:$|\s*[（(])/.test(clean(b.textContent)))) { hasPurchase = true; break; }
      }
      if (!hasPurchase) continue;
      const rs = [...table.rows].filter((r) => r.closest('table') === table && [...r.cells].some((c) => c.tagName === 'TD'));
      if (!rs.length) continue;
      let shape = null;
      const layout = [];
      for (const r of rs) {
        const cells = [...r.cells];
        if (cells.length < 3 || cells.length > 4 || cells.some((c) => c.colSpan !== 1 || c.rowSpan !== 1)) { shape = null; break; }
        const item = cells.findIndex((c) => c.querySelector('img[src*="/client/item/"],button[aria-label$="的物品資訊"]'));
        const input = cells.findIndex((c) => c.querySelector('input[type="number"]'));
        const prices = cells.flatMap((c, i) => {
          const m = clean(roiPriceText(c)).match(amtRx);
          return m?.[2] && !c.querySelector('input,button:not([data-roi-price-search]),a') ? [i] : [];
        });
        if (item < 0 || input < 0 || prices.length !== 1 || new Set([item, input, prices[0]]).size !== 3) { shape = null; break; }
        const roles = cells.map((c, i) => i === item ? 'item' : i === input ? (cells.length === 3 ? 'input-stock' : 'input') : i === prices[0] ? 'price' : 'stock');
        const sig = roles.join(',');
        if (shape && sig !== shape) { shape = null; break; }
        shape = sig;
        cells.forEach((cell, i) => layout.push([cell, roles[i]]));
      }
      if (!shape) continue;
      const headings = [...table.rows].filter((r) => r.closest('table') === table && [...r.cells].every((c) => c.tagName === 'TH'));
      const roles = shape.split(',');
      if (!headings.some((r) => r.cells.length !== roles.length)) {
        headings.forEach((r) => [...r.cells].forEach((cell, i) => layout.push([cell, roles[i]])));
      }
      if (!table.classList.contains('roi-market-table')) table.classList.add('roi-market-table');
      for (const [cell, role] of layout) {
        if (cell.dataset.roiMarketCol !== role) cell.dataset.roiMarketCol = role;
      }
    }

    const tables = [...document.querySelectorAll('table.xp-table')];
    const hasTownSearch = tables.length ? Boolean(findTownSearchUI()) : false;
    for (const tbl of tables) {
      const hdr = [...tbl.rows].find((r) => r.cells.length && [...r.cells].every((c) => c.tagName === 'TH'));
      const pCols = new Set(hdr ? [...hdr.cells].flatMap((c, i) => (headRx.test(clean(c.textContent)) ? [i] : [])) : []);

      for (const td of tbl.querySelectorAll('td')) {
        if (td.closest('table') !== tbl) continue;
        const plain = [...td.querySelectorAll('*')].every((el) => el.closest('[data-roi-price-search]') || el.tagName === 'SPAN');
        const val = plain ? clean(roiPriceText(td)).match(amtRx) : null;
        if (state.moneyColor && val && (val[2] || pCols.has(td.cellIndex))) {
          applyMoneyColor(td, val[1]);
        }
        if (hasTownSearch && td.dataset.roiMarketCol === 'price') {
          const row = td.closest('tr');
          const itemCell = [...row.cells].find((c) => c.dataset.roiMarketCol === 'item');
          const nameBtn = itemCell?.querySelector('button,a');
          const iName = clean(nameBtn?.textContent || '');
          if (iName) {
            let qBtn = td.querySelector('[data-roi-price-search]');
            if (!qBtn) {
              qBtn = document.createElement('button');
              qBtn.type = 'button'; qBtn.dataset.roiPriceSearch = ''; qBtn.textContent = '🔍';
              // React 重用同一列顯示其他商品時，點擊須搜尋目前的品名而非建立按鈕時的品名。
              qBtn.onclick = (e) => { e.preventDefault(); e.stopPropagation(); if (qBtn.dataset.roiPriceSearch) triggerNativeTownSearch(qBtn.dataset.roiPriceSearch); };
              td.appendChild(qBtn);
            }
            if (qBtn.dataset.roiPriceSearch !== iName) qBtn.dataset.roiPriceSearch = iName;
            if (qBtn.title !== `跨城搜尋：${iName}`) qBtn.title = `跨城搜尋：${iName}`;
          }
        }
      }
    }
    if (state.moneyColor) {
      for (const leg of document.querySelectorAll('fieldset > legend')) {
        if (clean(roiPriceText(leg)) !== '搜尋所有城鎮的攤位') continue;
        for (const el of leg.parentElement.querySelectorAll('table.xp-table td :is(div,span,p,b,strong,small)')) {
          if (el.children.length || el.closest('button,a,input,select,[data-roi-price-search]')) continue;
          const v = clean(el.textContent).match(amtRx);
          if (v?.[2]) applyMoneyColor(el, v[1]);
        }
      }
    }
  }
