
  function annotateAllRefinedEquipment() {
    tryLearnFromReactTree(document.querySelector('main, #root, table.xp-table, fieldset'));

    const bagRowMap = bagMemo?.val ? new Map(bagMemo.val.rows.map((x) => [x.row, x])) : null;
    for (const img of document.querySelectorAll('li img[src*="/client/item/"], table.xp-table tr img[src*="/client/item/"]')) {
      const row = img.closest('li, table.xp-table tr');
      if (!row || row.closest('#ro-helper-hud,#roi-helper-mvp-panel,[data-roi-market-browser],[data-roi-refine-helper]')) continue;
      const itemId = Number(img.getAttribute('src')?.match(/\/(\d+)\.png/)?.[1]);
      if (!itemId) continue;

      const nameEl = row.querySelector('button[aria-label$="的物品資訊"], a') || row.querySelector('td:first-child, span');
      if (!nameEl) continue;
      const rawTxt = clean(roiPriceText(nameEl));
      const refM = rawTxt.match(/^\+\s*(\d+)\s+(.+)/);
      const baseName = (refM ? refM[2] : rawTxt).replace(/\s*\[\d+\].*$/, '').trim();
      if (baseName && !/^\d+$/.test(baseName)) ITEM_NAME_CACHE.set(itemId, baseName);

      let plus = refM ? Number(refM[1]) : 0;
      let cards = [];
      let cardsKnown = false;
      let extraStats = null;
      if (row.tagName === 'TR' && bagRowMap) {
        const bRow = bagRowMap.get(row);
        if (bRow?.st) {
          plus = bRow.st.refine || plus;
          cards = (bRow.st.cards || []).filter(Boolean);
          cardsKnown = true;
          extraStats = bRow.st;
        }
      }
      const inStall = isStallContext(row);
      if (!cardsKnown && (inStall || row.tagName === 'LI' || row.tagName === 'TR')) {
        const { cat } = classifyItem(itemId);
        if (cat === 'weapon' || cat === 'armor') {
          const stack = readNearbyItemStack(row, itemId, plus);
          if (stack) {
            cards = stack.cards.filter(Boolean);
            cardsKnown = true;
            if (!extraStats) extraStats = stack;
          }
        }
      }
      if (extraStats && (extraStats.atk || extraStats.def || extraStats.matk || extraStats.weaponLevel || extraStats.description)) {
        recordItemDetail(itemId, {
          ...(extraStats.atk ? { atk: Number(extraStats.atk) } : {}),
          ...(extraStats.matk ? { matk: Number(extraStats.matk) } : {}),
          ...(extraStats.def ? { def: Number(extraStats.def) } : {}),
          ...(extraStats.weaponLevel ? { wLv: Number(extraStats.weaponLevel) } : {}),
          ...(extraStats.description ? { desc: clean(extraStats.description) } : {})
        });
      }

      row.dataset.roHoverId = String(itemId);
      row.dataset.roHoverRefine = String(plus);
      row.dataset.roHoverName = rawTxt;
      if (cardsKnown) row.dataset.roHoverCards = cards.join(',');
      else delete row.dataset.roHoverCards;

      row.querySelector('[data-ro-ref-annotated]')?.remove();
      applyRefineLevelColor(nameEl, inStall ? 0 : plus);
    }

    for (const box of document.querySelectorAll('.xp-sunken')) {
      if (box.closest('#ro-helper-hud,#roi-helper-mvp-panel,[data-roi-market-browser],[data-roi-refine-helper]')) continue;
      box.querySelector(':scope > [data-ro-detail-ref-badge]')?.remove();
      if (box.querySelector('table, ul, ol, input[type="number"], [data-roi-price-search]')) continue;
      const imgs = box.querySelectorAll('img[src*="/client/item/"]');
      const img = imgs[0];
      if (!img || imgs.length > 5 || img.closest('.xp-sunken') !== box) {
        applyRefineLevelColor(box.querySelector('[data-ro-ref-tier]'), 0);
        continue;
      }
      const itemId = Number(img.getAttribute('src')?.match(/\/(\d+)\.png/)?.[1]);
      if (!itemId) {
        applyRefineLevelColor(box.querySelector('[data-ro-ref-tier]'), 0);
        continue;
      }
      const rawBoxText = box.textContent || '';
      const boxSig = `${itemId}|${rawBoxText.length}|${rawBoxText.slice(0, 48)}`;
      let lines;
      if (box.dataset.roBoxSig !== boxSig) {
        box.dataset.roBoxSig = boxSig;
        lines = (box.innerText || '').split('\n').map((l) => l.trim()).filter((l) => l && !/^(?:裝備|卸下|鎖定|解鎖|存入倉庫|存倉|回城賣|請忽克連|一鍵精煉|武器精練|關閉|⚡|🔍|剩\s*\d+|購買)/.test(l) && !/\bZeny\b/i.test(l));
        const txt = clean(lines.join(' '));
        const atkM = txt.match(/(?:攻擊力?|ATK)\s*[:：]?\s*(\d+)/i);
        const matkM = txt.match(/(?:魔攻|MATK)\s*[:：]?\s*(\d+)/i);
        const defM = txt.match(/(?:防禦力?|DEF)\s*[:：]?\s*(\d+)/i);
        const wLvM = txt.match(/武器等級\s*[:：]?\s*(\d)/);
        const wtM = txt.match(/重量\s*[:：]?\s*(\d+(?:\.\d+)?)/);
        const desc = lines.slice(1, 14).join('\n').slice(0, 600);
        recordItemDetail(itemId, {
          ...(atkM ? { atk: Number(atkM[1]) } : {}),
          ...(matkM ? { matk: Number(matkM[1]) } : {}),
          ...(defM ? { def: Number(defM[1]) } : {}),
          ...(wLvM ? { wLv: Number(wLvM[1]) } : {}),
          ...(wtM ? { weight: Number(wtM[1]) } : {}),
          ...(desc && !/(?:Zeny|🔍|剩\s*\d+)/i.test(desc) ? { desc } : {})
        });
      } else {
        lines = rawBoxText.split('\n').map((l) => l.trim()).filter(Boolean);
      }

      const titleM = (lines[0] || '').match(/^\+\s*(\d+)/);
      const plus = titleM ? Number(titleM[1]) : 0;
      const inStall = isStallContext(box);
      const titleEl = !/[+＋]\s*[0-9０-９]/.test(rawBoxText) ? null : [...box.querySelectorAll('button, span, div, b, strong, p')].find(
        (el) => !el.children.length && !el.closest('button[data-ro-lock]') && /^\+\s*\d+/.test(clean(el.textContent))
      ) || [...box.querySelectorAll('button, span, div, b, strong, p')].find((el) =>
        !el.closest('button[data-ro-lock]') && [...el.childNodes].some((node) =>
          node.nodeType === Node.TEXT_NODE && /^\+\s*\d+/.test(clean(node.textContent))));
      applyRefineLevelColor(box, 0);
      applyRefineLevelColor(titleEl, inStall ? 0 : plus);
    }
  }
