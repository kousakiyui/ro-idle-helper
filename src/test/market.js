
  let mktView = false, mktAuto15s = false, mktAutoTimer = null;
  let mktListings = [], mktCrossMap = new Map(), mktPrevPrices = new Map(), mktKeyMap = new Map(), mktFilter = 'all', mktSub = 'all';
  let mktFavs = new Set(readValidatedSetting('roi-favorites-v1', validateFavorites, []));
  const mktPanel = document.createElement('fieldset');
  mktPanel.className = 'xp-group'; mktPanel.dataset.roiMarketBrowser = ''; mktPanel.style.cssText = 'grid-column:1/-1;min-width:0;'; mktPanel.hidden = true;

  const upperFoldBtn = document.createElement('button');
  upperFoldBtn.type = 'button'; upperFoldBtn.className = 'xp-btn small'; upperFoldBtn.dataset.roiUpperFold = ''; upperFoldBtn.style.marginLeft = '8px';
  upperFoldBtn.onclick = () => { state.mktUpperFold = !state.mktUpperFold; savePrefs(); syncMktMount(); };

  const tooltip = document.createElement('div');
  tooltip.id = 'roi-item-hover-tooltip';
  tooltip.style.cssText = 'position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;display:none;width:320px;box-sizing:border-box;max-width:calc(100vw - 12px);max-height:calc(100vh - 12px);overflow:auto;overscroll-behavior:contain;overflow-wrap:anywhere;background:var(--roi-surface);color:var(--roi-text);border:1.5px solid #38bdf8;border-radius:10px;padding:11px 13px;box-shadow:0 12px 28px var(--roi-shadow);font-size:12px;line-height:1.45;contain:layout style;will-change:transform;';
  document.body.appendChild(tooltip);
  let hoverPoint = null;
  let tooltipVisible = false;
  let tooltipSize = null;
  let tooltipScrollable = false;
  let isScrollingPage = false;
  let scrollIdleTimer = null;
  let hoverRafId = 0;
  let pendingHoverEvent = null;

  function hideTooltip() {
    if (!tooltipVisible) return;
    tooltipVisible = false;
    tooltip.style.display = 'none';
    lastHoveredTarget = null;
  }

  function positionTooltip(recalcSize = false) {
    if (!hoverPoint || !tooltipVisible) return;
    if (recalcSize || !tooltipSize) {
      const rect = tooltip.getBoundingClientRect();
      tooltipSize = { width: rect.width, height: rect.height };
      tooltipScrollable = tooltip.scrollHeight > tooltip.clientHeight + 1;
      tooltip.style.pointerEvents = tooltipScrollable ? 'auto' : 'none';
    }
    const { x, y } = hoverPoint;
    const { width, height } = tooltipSize;
    const edge = 6;
    const place = (point, size, space) => {
      const after = point + 12;
      const preferred = after + size <= space - edge ? after : point - 12 - size;
      return Math.max(edge, Math.min(space - edge - size, preferred));
    };
    const left = Math.round(place(x, width, innerWidth));
    const top = Math.round(place(y, height, innerHeight));
    tooltip.style.transform = `translate3d(${left}px,${top}px,0)`;
  }

  function showTooltip(e) {
    hoverPoint = { x: e.clientX, y: e.clientY };
    if (!tooltipVisible) {
      tooltipVisible = true;
      tooltip.style.display = 'block';
    }
    if (tooltipScrollable) tooltip.scrollTop = 0;
    positionTooltip(true);
  }

  window.addEventListener('resize', () => {
    tooltipSize = null;
    positionTooltip(true);
  }, { passive: true });
  window.addEventListener('scroll', (e) => {
    if (tooltip.contains(e.target instanceof Node ? e.target : null)) return;
    isScrollingPage = true;
    clearTimeout(scrollIdleTimer);
    scrollIdleTimer = setTimeout(() => { isScrollingPage = false; }, 110);
    if (hoverRafId) { cancelAnimationFrame(hoverRafId); hoverRafId = 0; pendingHoverEvent = null; }
    hideTooltip();
  }, { capture: true, passive: true });

  const CAT_TABS = { all: '全部', favorites: '★ 收藏', card: '🃏 卡片', weapon: '🗡️ 武器', armor: '🛡️ 防具/飾品', consumable: '🧪 消耗品', material: '🪨 材料' };

  const descLinesCache = new Map();
  function formatItemDescLines(rawDesc, currentRefine = 0) {
    if (!rawDesc) return [];
    const cacheKey = `${currentRefine}|${Array.isArray(rawDesc) ? rawDesc.join('\n') : rawDesc}`;
    const cached = descLinesCache.get(cacheKey);
    if (cached) return cached;
    const chunks = Array.isArray(rawDesc)
      ? rawDesc.map((x) => clean(x))
      : String(rawDesc).split(/\r?\n|\s*｜\s*/).map((x) => clean(x));
    const lines = [];
    for (const chunk of chunks) {
      if (!chunk) continue;
      const parts = chunk.split(/(?=精煉\s*\+\s*\d+\s*[:：])/).map((s) => s.trim()).filter(Boolean);
      for (const part of parts) {
        const metaMatch = part.match(/^([^:：]+?,(?:武器等級|防禦力?|攻擊力?)[^:：]*?)(?:\s+((?:STR|AGI|VIT|INT|DEX|LUK|ATK|MATK|DEF|MDEF|HIT|FLEE|CRI|ASPD|HP|SP|MaxHP|MaxSP|精煉|對|受到|物理|魔法|技能|攻擊|施法|詠唱|移動|無視|不會|可使用|裝備).*))?$/i);
        if (metaMatch && !/^精煉\s*\+/.test(part)) {
          const baseSpec = metaMatch[1].split(',').map((s) => s.trim()).filter(Boolean).join(' ｜ ');
          if (baseSpec) lines.push({ text: baseSpec, type: 'meta' });
          if (metaMatch[2]) {
            const subEffects = metaMatch[2].split(/(?=(?:STR|AGI|VIT|INT|DEX|LUK|MaxHP|MaxSP|ATK|MATK|DEF|MDEF|HIT|FLEE|CRI|ASPD)\s*[+-]\s*\d+%?)/g).map((s) => s.trim()).filter(Boolean);
            for (const eff of subEffects) lines.push({ text: eff, type: 'effect' });
          }
          continue;
        }
        const refMatch = part.match(/^精煉\s*\+\s*(\d+)\s*[:：]\s*(.+)$/);
        if (refMatch) {
          const lvl = Number(refMatch[1]);
          const body = refMatch[2].trim();
          lines.push({
            text: `精煉 +${lvl}：${body}`,
            type: 'refine',
            refineLv: lvl,
            active: currentRefine > 0 && currentRefine >= lvl
          });
          continue;
        }
        lines.push({ text: part, type: 'effect' });
      }
    }
    if (descLinesCache.size > 600) descLinesCache.clear();
    descLinesCache.set(cacheKey, lines);
    return lines;
  }

  function renderDescBlock(container, rawDesc, currentRefine = 0, baseColor = 'var(--roi-text)', fontSize = '11px') {
    const items = formatItemDescLines(rawDesc, currentRefine);
    if (!items.length) return;
    const list = element('div', null, `display:flex;flex-direction:column;gap:3px;font-size:${fontSize};line-height:1.45;`);
    for (const item of items) {
      if (item.type === 'meta') {
        const metaEl = element('div', `📋 ${item.text}`, 'color:var(--roi-info);font-size:10.5px;padding-bottom:3px;margin-bottom:1px;border-bottom:1px dashed rgba(148,163,184,0.2);');
        list.append(metaEl);
      } else if (item.type === 'refine') {
        const isCur = currentRefine > 0 && currentRefine === item.refineLv;
        const row = element(
          'div',
          `${isCur ? '▶ ' : '• '}${item.text}`,
          isCur
            ? 'color:var(--roi-warning);font-weight:bold;background:rgba(250,204,21,0.14);padding:2px 6px;border-radius:4px;border-left:2px solid #facc15;'
            : item.active
              ? 'color:var(--roi-success);padding-left:4px;'
              : 'color:var(--roi-muted);padding-left:4px;'
        );
        list.append(row);
      } else {
        list.append(element('div', `• ${item.text}`, `color:${baseColor};padding-left:2px;`));
      }
    }
    container.append(list);
  }

  function resolveItemMeta(numId) {
    const dbInfo = ITEM_DETAIL_DB.get(numId) || {};
    const packItem = PACK_ITEMS_MAP?.get(numId);
    if (!packItem) return dbInfo;
    const rawDesc = packItem.description ?? packItem.effect ?? packItem.desc ?? '';
    const descText = Array.isArray(rawDesc) ? rawDesc.map(clean).filter(Boolean).join('\n') : clean(rawDesc);
    const slotCount = Array.isArray(packItem.slots)
      ? (typeof packItem.cardSlots === 'number' ? packItem.cardSlots : undefined)
      : (typeof packItem.slots === 'number' ? packItem.slots : packItem.cardSlots);
    return {
      name: dbInfo.name || (packItem.name ? clean(packItem.name) : undefined),
      atk: dbInfo.atk ?? (packItem.atk != null ? Number(packItem.atk) : undefined),
      matk: dbInfo.matk ?? (packItem.matk != null ? Number(packItem.matk) : undefined),
      def: dbInfo.def ?? (packItem.def != null ? Number(packItem.def) : undefined),
      mdef: dbInfo.mdef ?? (packItem.mdef != null ? Number(packItem.mdef) : undefined),
      wLv: dbInfo.wLv ?? (packItem.weaponLevel != null ? Number(packItem.weaponLevel) : undefined),
      weight: dbInfo.weight ?? (packItem.weight != null ? Number(packItem.weight) : undefined),
      reqLv: dbInfo.reqLv ?? (packItem.equipLevel ?? packItem.requiredLevel),
      cardSlots: slotCount,
      desc: descText || (!isPollutedDesc(dbInfo.desc) ? dbInfo.desc : undefined)
    };
  }

  function populateRichTooltip(data) {
    ensurePackItemsLoaded();
    const numId = Number(data.id);
    const { cat, sub } = classifyItem(numId, data.base || '');
    const dbInfo = resolveItemMeta(numId);
    const slots = data.slots ?? dbInfo.cardSlots ?? SLOTS_MAP.get(numId) ?? 0;
    const cards = (data.cards || []).filter(Boolean);
    const nodes = [];

    const hasCards = cards.length > 0;
    const isRefined = (data.refine || 0) > 0;
    tooltip.style.borderColor = hasCards ? 'var(--roi-warning)' : isRefined ? 'var(--roi-info)' : 'rgba(56,189,248,0.75)';
    const header = element('div', null, 'display:flex;align-items:center;gap:9px;border-bottom:1px solid rgba(148,163,184,0.28);padding-bottom:8px;margin-bottom:8px;');
    const iconWrap = element('div', null, `position:relative;width:34px;height:34px;display:flex;align-items:center;justify-content:center;background:var(--roi-panel);border-radius:8px;border:1px solid ${hasCards ? 'var(--roi-warning)' : isRefined ? 'var(--roi-info)' : '#334155'};flex-shrink:0;`);
    const icon = element('img', null, 'width:26px;height:26px;object-fit:contain;');
    icon.src = `/client/item/${numId}.png`;
    iconWrap.append(icon);
    const titleBox = element('div', null, 'min-width:0;flex:1;');
    const titleLine = element('div', data.name || data.base || dbInfo.name || `道具 #${numId}`, `font-weight:bold;font-size:13.5px;color:${hasCards ? 'var(--roi-warning)' : isRefined ? 'var(--roi-info)' : 'var(--roi-text)'};line-height:1.3;`);
    titleLine.append(element('small', ` #${numId}`, 'color:var(--roi-muted);font-weight:normal;'));
    const subLine = element('div', null, 'display:flex;flex-wrap:wrap;align-items:center;gap:4px;font-size:11px;color:var(--roi-muted);margin-top:2px;');
    const typePill = element('span', SUB_LABELS[sub] || CAT_TABS[cat] || cat, 'background:rgba(245,158,11,0.16);color:var(--roi-warning);border:1px solid rgba(245,158,11,0.35);padding:0 5px;border-radius:4px;font-weight:bold;');
    subLine.append(typePill);
    const wLv = dbInfo.wLv || (cat === 'weapon' ? WLV_MAP.get(numId) : null);
    if (wLv) subLine.append(element('span', `Lv.${wLv}武器`, 'color:var(--roi-text);'));
    if (dbInfo.reqLv) subLine.append(element('span', `需求Lv.${dbInfo.reqLv}`, 'color:var(--roi-muted);'));
    if (dbInfo.weight != null) subLine.append(element('span', `重量 ${dbInfo.weight}`, 'color:var(--roi-muted);'));
    titleBox.append(titleLine, subLine);
    header.append(iconWrap, titleBox);
    nodes.push(header);

    if (dbInfo.atk || dbInfo.matk || dbInfo.def || dbInfo.mdef || dbInfo.desc || data.rawSpecText) {
      const statBox = element('div', null, 'background:var(--roi-panel);padding:7px 9px;border-radius:7px;margin-bottom:7px;border:1px solid var(--roi-edge);font-size:11.5px;');
      const statParts = [
        dbInfo.atk ? `⚔️ ATK ${dbInfo.atk}` : '',
        dbInfo.matk ? `🔮 MATK ${dbInfo.matk}` : '',
        dbInfo.def ? `🛡️ DEF ${dbInfo.def}` : '',
        dbInfo.mdef ? `✨ MDEF ${dbInfo.mdef}` : ''
      ].filter(Boolean);
      if (statParts.length) statBox.append(element('div', statParts.join(' ｜ '), 'color:var(--roi-text);font-weight:bold;margin-bottom:5px;'));
      if (dbInfo.desc) renderDescBlock(statBox, dbInfo.desc, Number(data.refine) || 0, 'var(--roi-text)', '11px');
      if (data.rawSpecText) statBox.append(element('div', `✨ ${data.rawSpecText}`, 'color:var(--roi-success);font-size:11px;margin-top:4px;padding-top:3px;border-top:1px dashed rgba(148,163,184,0.2);'));
      nodes.push(statBox);
    }

    const maxSlots = Math.max(slots, cards.length);
    if (maxSlots > 0 && data.cardsKnown === false) {
      nodes.push(element('div', `💎 插槽 ${maxSlots} 洞（目前清單未提供插卡明細）`, 'font-size:11px;color:var(--roi-info);margin-bottom:6px;'));
    }
    if (maxSlots > 0 && data.cardsKnown !== false) {
      const cardBox = element('div', null, 'background:var(--roi-panel);padding:7px 9px;border-radius:7px;border:1px solid rgba(250,204,21,0.35);margin-bottom:7px;');
      const cardHeader = element('div', null, 'display:flex;justify-content:space-between;align-items:center;font-size:11px;color:var(--roi-warning);margin-bottom:5px;font-weight:bold;');
      cardHeader.append(
        element('span', `💎 卡片插槽 (${cards.length} / ${maxSlots})`),
        element('span', cards.length ? '已插卡強化' : '尚未插卡', `font-size:10px;padding:1px 5px;border-radius:4px;background:${cards.length ? 'rgba(250,204,21,0.18)' : 'rgba(100,116,139,0.2)'};color:${cards.length ? 'var(--roi-warning)' : 'var(--roi-muted)'};`)
      );
      cardBox.append(cardHeader);
      for (let idx = 0; idx < maxSlots; idx++) {
        const cid = cards[idx];
        if (cid) {
          const cInfo = resolveItemMeta(cid);
          const cName = cInfo.name || ITEM_NAME_CACHE.get(cid) || `卡片 #${cid}`;
          const cRow = element('div', null, `display:flex;align-items:flex-start;gap:6px;padding:4px 0;${idx ? 'border-top:1px dashed #334155;' : ''}`);
          const cIcon = element('img', null, 'width:18px;height:18px;object-fit:contain;margin-top:1px;flex-shrink:0;');
          cIcon.src = `/client/item/${cid}.png`;
          const cDetail = element('div', null, 'flex:1;min-width:0;');
          const cTitle = element('div', cName, 'font-weight:bold;color:var(--roi-warning);font-size:11.5px;');
          cDetail.append(cTitle);
          if (cInfo.desc) {
            const cDescWrap = element('div', null, 'margin-top:2px;');
            renderDescBlock(cDescWrap, cInfo.desc, 0, 'var(--roi-success)', '10.5px');
            cDetail.append(cDescWrap);
          } else {
            cDetail.append(element('div', '（卡片效果說明尚未載入）', 'color:var(--roi-muted);font-size:10px;margin-top:1px;'));
          }
          cRow.append(cIcon, cDetail);
          cardBox.append(cRow);
        } else {
          const emptyRow = element('div', null, `display:flex;align-items:center;gap:6px;padding:3px 0;color:var(--roi-muted);font-size:11px;${idx ? 'border-top:1px dashed var(--roi-edge);' : ''}`);
          emptyRow.append(element('span', '◇', 'color:var(--roi-muted);'), element('span', `空插槽 [${idx + 1}]（未插卡）`));
          cardBox.append(emptyRow);
        }
      }
      nodes.push(cardBox);
    }

    if (data.price) {
      const foot = element('div', null, 'display:flex;justify-content:space-between;align-items:center;gap:8px;padding-top:6px;border-top:1px solid rgba(148,163,184,0.22);font-size:11px;color:var(--roi-muted);');
      const sellerText = `🏪 ${data.seller || '露天攤位'}${data.city ? ` (${TOWN_NAMES[data.city] || data.city})` : ''}`;
      const priceText = data.qty && data.qty > 1
        ? `單價 ${data.price.toLocaleString()} Z × ${data.qty} = ${(data.price * data.qty).toLocaleString()} Z`
        : `售價 ${data.price.toLocaleString()} Z`;
      foot.append(
        element('span', sellerText, 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;'),
        element('b', priceText, 'color:var(--roi-success);white-space:nowrap;')
      );
      nodes.push(foot);
    }

    tooltip.replaceChildren(...nodes);
  }

  mktPanel.innerHTML = `
    <legend class="legend" id="roi-mkt-leg">🏪 攤位分類檢視 </legend>
    <div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-bottom:6px;">
      <button type="button" id="roi-mkt-auto" class="xp-btn small" style="background:linear-gradient(135deg,#16763a,#136039);color:#fff;font-weight:bold;border:none;">▶️ 啟動 15s 自動整理</button>
      <input type="text" id="roi-mkt-q" class="xp-input" placeholder="篩選商品/插卡 (或跨城補查字)..." style="min-width:175px;">
      <select id="roi-mkt-sort" class="xp-input"><option value="asc">價低➔高</option><option value="desc">價高➔低</option><option value="name">名稱</option></select>
      <label><input type="checkbox" id="roi-mkt-min" checked> 同規格最低</label>
      <button type="button" id="roi-mkt-cross" class="xp-btn small" style="background:linear-gradient(135deg,#0369a1,#075581);color:#fff;font-weight:bold;border:none;">🛰️ 立即跨城補查</button>
    </div>
    <div style="display:flex;flex-wrap:wrap;gap:5px;align-items:center;margin-bottom:6px;">
      <div id="roi-mkt-tabs" style="display:flex;flex-wrap:wrap;gap:4px;"></div>
      <label id="roi-mkt-sub-wrap" style="display:none;color:var(--roi-warning);font-weight:bold;">細分類：<select id="roi-mkt-sub" class="xp-input"></select></label>
    </div>
    <div id="roi-mkt-status" style="font-size:11px;color:var(--roi-info);margin-bottom:5px;">目前城鎮攤位快照｜指到裝備可看精煉加成與插卡詳情，點 🔍 可切回原生購買</div>
    <div id="roi-mkt-rows" style="max-height:60vh;overflow:auto;border:1px solid var(--roi-edge);border-radius:6px;background:var(--roi-surface);color:var(--roi-text);"></div>
  `;

  const mktTabsBox = mktPanel.querySelector('#roi-mkt-tabs'), mktSubWrap = mktPanel.querySelector('#roi-mkt-sub-wrap'), mktSubSel = mktPanel.querySelector('#roi-mkt-sub'), mktRowsBox = mktPanel.querySelector('#roi-mkt-rows'), mktAutoBtn = mktPanel.querySelector('#roi-mkt-auto');
  for (const [cid, cname] of Object.entries(CAT_TABS)) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'xp-btn small'; b.dataset.cid = cid; b.textContent = cname;
    b.onclick = () => { mktFilter = cid; mktSub = 'all'; renderMkt(); };
    mktTabsBox.appendChild(b);
  }
  mktSubSel.onchange = () => { mktSub = mktSubSel.value; renderMkt(); };
  mktPanel.querySelector('#roi-mkt-q').oninput = () => renderMkt();
  mktPanel.querySelector('#roi-mkt-sort').onchange = () => renderMkt();
  mktPanel.querySelector('#roi-mkt-min').onchange = () => renderMkt();

  const DEFAULT_429_COOLDOWN_MS = 30000;
  let crossRequest = 0;
  let crossBusy = false;
  let crossAbortCtrl = null;
  let crossCooldownUntil = 0;
  let mktAutoGeneration = 0;

  function parseRetryAfterMs(headerVal, now = Date.now()) {
    if (!headerVal) return DEFAULT_429_COOLDOWN_MS;
    const raw = String(headerVal).trim();
    if (!raw) return DEFAULT_429_COOLDOWN_MS;
    if (/^\d+(?:\.\d+)?$/.test(raw)) {
      const sec = Number(raw);
      if (Number.isFinite(sec) && sec > 0) return Math.min(3600000, Math.max(1000, Math.round(sec * 1000)));
    }
    const parsedDate = Date.parse(raw);
    if (Number.isFinite(parsedDate) && parsedDate > now) {
      return Math.min(3600000, Math.max(1000, parsedDate - now));
    }
    return DEFAULT_429_COOLDOWN_MS;
  }

  function isCrossRequestCurrent(request, controller) {
    return request === crossRequest && crossAbortCtrl === controller && !controller.signal.aborted && mktPanel.isConnected && !mktPanel.hidden;
  }

  async function doCrossSearch(kw, automatic = false) {
    const st = mktPanel.querySelector('#roi-mkt-status');
    if (!kw || (automatic && crossBusy)) return false;
    const nowBefore = Date.now();
    if (nowBefore < crossCooldownUntil) {
      const remSec = Math.max(1, Math.ceil((crossCooldownUntil - nowBefore) / 1000));
      if (!automatic && st) st.textContent = `⏳ 跨城查價冷卻中（剩餘約 ${remSec} 秒），請稍後再試`;
      return false;
    }
    crossAbortCtrl?.abort();
    const controller = new AbortController();
    crossAbortCtrl = controller;
    const request = ++crossRequest;
    crossBusy = true;
    if (st) st.textContent = `🛰️ 正在跨城補查「${kw}」...`;
    try {
      const r = await fetch('/api/vending?q=' + encodeURIComponent(kw), { credentials: 'same-origin', cache: 'no-store', signal: controller.signal });
      if (!isCrossRequestCurrent(request, controller)) return false;
      if (r.status === 429) {
        const retryMs = parseRetryAfterMs(r.headers?.get?.('Retry-After'));
        crossCooldownUntil = Date.now() + retryMs;
        const sec = Math.max(1, Math.round(retryMs / 1000));
        stopMktAuto(`HTTP 429：冷卻 ${sec} 秒，自動整理已停止`);
        if (st) st.textContent = `🔴 HTTP 429：冷卻 ${sec} 秒，自動整理已停止`;
        return false;
      }
      if (!r.ok) throw Error(`HTTP ${r.status}`);
      const d = await r.json();
      if (!isCrossRequestCurrent(request, controller)) return false;
      const now = Date.now();
      for (const item of parseShopData(d.shops || [], '', null, now, 'cross')) mktCrossMap.set(item.key, item);
      rebuildPriceEvidence();
      refreshWarehouse();
      if (st) st.textContent = `🟢 [${new Date().toLocaleTimeString()}] 跨城補查「${kw}」完成！累計跨城快照 ${mktCrossMap.size} 筆`;
      renderMkt();
      return true;
    } catch (e) {
      if (e?.name !== 'AbortError' && isCrossRequestCurrent(request, controller) && st) {
        st.textContent = '⚠️ 補查失敗：' + e.message;
      }
      return false;
    } finally {
      if (crossAbortCtrl === controller) {
        crossAbortCtrl = null;
        crossBusy = false;
      }
    }
  }

  mktPanel.querySelector('#roi-mkt-cross').onclick = () => {
    const kw = mktPanel.querySelector('#roi-mkt-q').value.trim() || (mktFilter === 'card' ? '卡片' : mktSub !== 'all' ? SUB_LABELS[mktSub] : '');
    if (!kw) return alert('請在搜尋框輸入關鍵字（或先選擇卡片總類或武器／防具細分類）再點跨城補查！');
    void doCrossSearch(kw);
  };

  async function mktAutoTick() {
    const generation = mktAutoGeneration;
    const isCurrent = () => generation === mktAutoGeneration && mktAuto15s && mktView
      && !document.hidden && mktPanel.isConnected && !mktPanel.hidden;
    if (!isCurrent() || Date.now() < crossCooldownUntil) return;
    const runTask = async () => {
      if (!isCurrent() || Date.now() < crossCooldownUntil) return;
      const cf = findCityVendingFieldset();
      if (!cf) {
        stopMktAuto('已離開攤位頁');
        return;
      }
      const refBtn = [...cf.querySelectorAll('button')].find((b) => clean(b.textContent) === '重新整理' && !b.disabled);
      const st = mktPanel.querySelector('#roi-mkt-status');
      if (refBtn) {
        refBtn.click();
        if (st) st.textContent = `🟢 [${new Date().toLocaleTimeString()}] 已觸發 15 秒原生重新整理...`;
        await sleep(TIMING.marketSnapshotWait);
        if (!isCurrent() || findCityVendingFieldset() !== cf) return;
        const p = readFiberForUi(() => getCommittedProps(cf, (x) => Array.isArray(x.shops) && x.snap?.mapId));
        if (p === undefined) return;
        if (updateLocalListings(p)) renderMkt();
      }
      const kw = mktPanel.querySelector('#roi-mkt-q').value.trim() || (mktFilter === 'card' ? '卡片' : mktSub !== 'all' ? SUB_LABELS[mktSub] : '');
      if (kw && mktAuto15s && Date.now() >= crossCooldownUntil) {
        await sleep(TIMING.marketCrossSearchGap);
        if (isCurrent() && findCityVendingFieldset() === cf && Date.now() >= crossCooldownUntil) {
          await doCrossSearch(kw, true);
        }
      }
    };
    if (navigator.locks?.request) {
      await navigator.locks.request('roi-lean-market-lock', { ifAvailable: true }, async (lock) => {
        if (!isCurrent()) return;
        if (!lock) {
          const st = mktPanel.querySelector('#roi-mkt-status');
          if (st) st.textContent = '⏸️ 另一分頁正在整理攤位，本分頁自動禮讓防 429';
          return;
        }
        await runTask();
      });
    } else {
      await runTask();
    }
  }

  function startMktAuto() {
    if (Date.now() < crossCooldownUntil) {
      const remSec = Math.max(1, Math.ceil((crossCooldownUntil - Date.now()) / 1000));
      const st = mktPanel.querySelector('#roi-mkt-status');
      if (st) st.textContent = `⏳ 跨城查價冷卻中（剩餘約 ${remSec} 秒），請稍後再啟動`;
      return;
    }
    ++mktAutoGeneration;
    mktAuto15s = true;
    mktAutoBtn.textContent = '⏹ 停止 15s 自動整理';
    mktAutoBtn.style.background = '#dc2626';
    clearInterval(mktAutoTimer);
    void mktAutoTick();
    mktAutoTimer = setInterval(() => { void mktAutoTick(); }, TIMING.marketRefresh);
  }

  function stopMktAuto(reason = '') {
    ++mktAutoGeneration;
    mktAuto15s = false;
    clearInterval(mktAutoTimer);
    mktAutoTimer = null;
    if (crossAbortCtrl) {
      try { crossAbortCtrl.abort(); } catch { log("market", "無法取消補查"); }
      crossAbortCtrl = null;
    }
    crossBusy = false;
    ++crossRequest;
    mktAutoBtn.textContent = '▶️ 啟動 15s 自動整理';
    mktAutoBtn.style.background = 'linear-gradient(135deg,#16763a,#136039)';
    if (reason && mktPanel.querySelector('#roi-mkt-status')) mktPanel.querySelector('#roi-mkt-status').textContent = `🔴 ${reason}`;
  }
  mktAutoBtn.onclick = () => (mktAuto15s ? stopMktAuto('已手動停止 15s 自動整理') : startMktAuto());

  function parseShopData(shops, defaultCity, selfId, seenTime = Date.now(), srcType = 'local') {
    const out = [];
    for (const s of shops) {
      if (!s?.items || (selfId != null && String(s.vendorId) === String(selfId))) continue;
      for (const i of s.items) {
        if (!i.qty || !i.price) continue;
        const base = clean(i.name) || `道具 #${i.itemId}`;
        const { cat, sub } = classifyItem(i.itemId, base);
        const slots = i.slots ?? SLOTS_MAP.get(i.itemId) ?? 0;
        const cards = (i.cards || []).filter(Boolean);
        if (i.atk || i.def || i.matk || i.weaponLevel || i.description) {
          recordItemDetail(i.itemId, {
            ...(i.atk ? { atk: Number(i.atk) } : {}),
            ...(i.matk ? { matk: Number(i.matk) } : {}),
            ...(i.def ? { def: Number(i.def) } : {}),
            ...(i.weaponLevel ? { wLv: Number(i.weaponLevel) } : {}),
            ...(i.description ? { desc: clean(i.description) } : {})
          });
        }
        const extraTags = [
          i.forged ? '鍛造武器' : '',
          i.element ? `屬性:${i.element}` : '',
          i.starCrumbs ? `星星角×${i.starCrumbs}` : '',
          i.options ? (Array.isArray(i.options) ? i.options.join('、') : String(i.options)) : ''
        ].filter(Boolean).join(' ｜ ');

        const cNames = cards.map((c) => ITEM_NAME_CACHE.get(c) || `卡片#${c}`);
        const full = `${i.refine ? '+' + i.refine + ' ' : ''}${base}${slots ? ` [${slots}]` : ''}${cNames.length ? ` (${cNames.join('、')})` : ''}`;
        const spec = `${i.refine || 0}|${slots}|${cards.join(',')}`;
        const key = `${s.vendorId}|${i.cartUid}|${i.itemId}|${spec}`;
        const oldPrice = mktPrevPrices.get(key);
        const changeTag = oldPrice === undefined ? '' : oldPrice !== i.price ? ` (原 ${oldPrice.toLocaleString()})` : '';
        mktPrevPrices.delete(key);
        mktPrevPrices.set(key, i.price);
        if (mktPrevPrices.size > 20000) mktPrevPrices.delete(mktPrevPrices.keys().next().value);
        out.push({
          id: i.itemId, refine: i.refine || 0, slots, cards, cNames, base, name: full, lower: full.toLowerCase(),
          cat, sub, price: i.price, qty: i.qty, seller: clean(s.vendorName) || `#${s.vendorId}`,
          city: s.mapId || defaultCity, seen: seenTime, source: srcType, changeTag, rawSpecText: extraTags,
          vendorId: s.vendorId, protectionSpec: i.refine || cards.length || i.forged || i.unidentified || i.broken ? null : protectionSpec(i),
          specKey: `${i.itemId}|${spec}`, key
        });
      }
    }
    return out;
  }

  let marketExpiryTimer = null;
  let localSnapshot = null;
  function updateLocalListings(p) {
    if (!p) return false;
    const city = p.snap.mapId;
    if (localSnapshot?.shops === p.shops && localSnapshot.city === city && localSnapshot.selfId === p.selfId) return false;
    mktListings = parseShopData(p.shops, city, p.selfId, Date.now(), 'local');
    rebuildPriceEvidence();
    localSnapshot = { shops: p.shops, city, selfId: p.selfId };
    return true;
  }

  function renderMkt() {
    if (mktPanel.hidden) return;
    const allMap = new Map();
    clearTimeout(marketExpiryTimer);
    let expires = Infinity;
    mktListings.forEach((x) => allMap.set(x.key, x));
    mktCrossMap.forEach((x, k) => { if (Date.now() - x.seen >= 1800000) mktCrossMap.delete(k);
      else {
        expires = Math.min(expires, x.seen + 1800000);
        if (!allMap.has(k) || allMap.get(k).seen < x.seen) allMap.set(k, x);
      }
    });
    if (Number.isFinite(expires)) marketExpiryTimer = setTimeout(renderMkt, Math.max(1, expires - Date.now()));
    mktKeyMap = allMap;
    let pool = [...allMap.values()];
    if (mktPanel.querySelector('#roi-mkt-min').checked) {
      const best = new Map();
      pool.forEach((r) => { if (!best.has(r.specKey) || r.price < best.get(r.specKey).price) best.set(r.specKey, r); });
      pool = [...best.values()];
    }
    const counts = { all: pool.length, favorites: pool.filter((r) => mktFavs.has(r.id)).length }, subCounts = {};
    pool.forEach((r) => { counts[r.cat] = (counts[r.cat] || 0) + 1; if (r.cat === mktFilter) subCounts[r.sub] = (subCounts[r.sub] || 0) + 1; });
    [...mktTabsBox.children].forEach((b) => {
      const cid = b.dataset.cid; b.textContent = `${CAT_TABS[cid]} (${counts[cid] || 0})`;
      b.style.outline = mktFilter === cid ? '2px solid #38bdf8' : '';
    });
    const opts = CAT_SUBS[mktFilter];
    const isDetail = Boolean(opts);
    mktSubWrap.style.display = isDetail ? 'inline-flex' : 'none';
    if (isDetail) {
      if (mktSub !== 'all' && !opts.includes(mktSub)) mktSub = 'all';
      mktSubSel.innerHTML = [`<option value="all">全部 (${counts[mktFilter] || 0})</option>`, ...opts.map((k) => `<option value="${k}">${SUB_LABELS[k]} (${subCounts[k] || 0})</option>`)].join('');
      mktSubSel.value = mktSub;
    }
    const q = mktPanel.querySelector('#roi-mkt-q').value.trim().toLowerCase(), sm = mktPanel.querySelector('#roi-mkt-sort').value;
    const shown = pool.filter((r) => (mktFilter === 'all' || (mktFilter === 'favorites' ? mktFavs.has(r.id) : r.cat === mktFilter)) && (!isDetail || mktSub === 'all' || r.sub === mktSub) && (!q || r.lower.includes(q)))
      .sort((a, b) => Number(mktFavs.has(b.id)) - Number(mktFavs.has(a.id)) || (sm === 'asc' ? a.price - b.price : sm === 'desc' ? b.price - a.price : zhCollator.compare(a.name, b.name)));

    const rows = shown.slice(0, 120).map((r) => {
      const age = Math.floor((Date.now() - r.seen) / 60000);
      const src = r.source === 'cross' ? `·補查${age < 1 ? '剛剛' : age + '分前'}` : '';
      const row = element('div', null, 'display:grid;grid-template-columns:minmax(240px,1fr) 165px 55px 140px;gap:6px;padding:6px 10px;border-bottom:1px solid var(--roi-edge)55;align-items:center;font-size:12px');
      row.className = 'roi-mkt-row';
      row.dataset.rkey = r.key;
      const item = element('span', null, 'display:flex;align-items:center;gap:5px;min-width:0;flex-wrap:wrap');
      const fav = element('button', mktFavs.has(r.id) ? '★' : '☆', mktFavs.has(r.id) ? 'color:var(--roi-warning)' : '');
      fav.type = 'button'; fav.className = 'xp-btn small'; fav.dataset.act = 'fav';
      const img = element('img', null, 'width:21px;height:21px;object-fit:contain');
      img.src = `/client/item/${r.id}.png`; img.loading = 'lazy';
      const clip = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
      const name = element('span', r.name, `${clip};font-weight:${r.refine || r.cards.length ? 'bold' : 'normal'};color:${r.cards.length ? 'var(--roi-warning)' : r.refine ? 'var(--roi-info)' : 'inherit'}`);
      item.append(fav, img, name);
      if (r.changeTag) item.append(element('small', r.changeTag, 'color:var(--roi-warning)'));
      const price = element('span', null, 'text-align:right;white-space:nowrap');
      const money = element('span', r.price.toLocaleString() + ' Z', getMoneyColorVars(r.price));
      money.className = 'roi-mc-text';
      const find = element('button', '🔍', 'margin-left:4px');
      find.type = 'button'; find.className = 'xp-btn small'; find.dataset.act = 'find'; find.title = '切回原生攤位定位購買 / 跨城搜尋';
      price.append(money, find);
      const seller = element('span', r.seller, clip);
      seller.append(element('small', ` (${TOWN_NAMES[r.city] || r.city}${src})`, 'color:var(--roi-info)'));
      row.append(item, price, element('span', '剩 ' + r.qty, 'text-align:right'), seller);
      return row;
    });
    mktRowsBox.replaceChildren(...(rows.length ? rows : [element('div', '無符合商品', 'padding:16px;text-align:center;color:var(--roi-muted)')]));
  }

  let lastHoveredTarget = null;
  let marketLookupCache = null;
  let marketLookupRef = null;
  function getMarketLookup() {
    if (marketLookupCache && marketLookupRef?.listings === mktListings && marketLookupRef?.crossSize === mktCrossMap.size) {
      return marketLookupCache;
    }
    const map = new Map();
    const pushItem = (item) => {
      const k = `${item.id}|${item.refine}|${Number(item.price)}`;
      let arr = map.get(k);
      if (!arr) { arr = []; map.set(k, arr); }
      arr.push(item);
    };
    for (const item of mktListings) pushItem(item);
    for (const item of mktCrossMap.values()) pushItem(item);
    marketLookupCache = map;
    marketLookupRef = { listings: mktListings, crossSize: mktCrossMap.size };
    return map;
  }

  function processHoverEvent(e) {
    if (isScrollingPage) return;
    const target = e.target;
    if (!(target instanceof Element)) return;
    if (tooltip.contains(target)) return;

    const mktRow = target.closest('[data-rkey]');
    if (mktRow) {
      if (!state.marketHover) return hideTooltip();
      if (lastHoveredTarget === mktRow && tooltipVisible) {
        hoverPoint = { x: e.clientX, y: e.clientY };
        positionTooltip(false);
        return;
      }
      const r = mktKeyMap.get(mktRow.dataset.rkey);
      if (r) {
        lastHoveredTarget = mktRow;
        populateRichTooltip(r);
        showTooltip(e);
        return;
      }
    }

    const natRow = target.closest('[data-ro-hover-id]');
    if (natRow && (target.closest('img, button[aria-label$="的物品資訊"], a, td') || natRow.closest('table.roi-market-table'))) {
      if ((!state.itemHover || !state.marketHover) && !(isStallContext(natRow) ? state.marketHover : state.itemHover)) return hideTooltip();
      if (lastHoveredTarget === natRow && tooltipVisible) {
        hoverPoint = { x: e.clientX, y: e.clientY };
        positionTooltip(false);
        return;
      }
      lastHoveredTarget = natRow;
      const id = Number(natRow.dataset.roHoverId);
      const refine = Number(natRow.dataset.roHoverRefine) || 0;
      const cards = natRow.dataset.roHoverCards ? natRow.dataset.roHoverCards.split(',').map(Number).filter(Boolean) : [];
      const rawName = natRow.dataset.roHoverName || ITEM_NAME_CACHE.get(id) || `道具 #${id}`;
      const priceCell = natRow.querySelector('[data-roi-market-col="price"]');
      const priceText = priceCell ? clean(roiPriceText(priceCell)) : '';
      const priceMatch = priceText.match(amtRx);
      const price = priceMatch ? Number(priceMatch[1].replace(/,/g, '')) : undefined;
      const cardsKnown = natRow.dataset.roHoverCards !== undefined;

      const stack = readNearbyItemStack(natRow, id, refine);
      const stackCards = Array.isArray(stack?.cards) ? stack.cards.filter(Boolean) : null;

      let matches = [];
      if (price !== undefined && (natRow.closest('table.roi-market-table') || isStallContext(natRow))) {
        const candidates = getMarketLookup().get(`${id}|${refine}|${price}`) || [];
        if (candidates.length > 1) {
          const stripped = rawName.replace(/^\+\s*\d+\s*/, '').replace(/\s*\[\d+\].*$/, '').trim();
          const names = candidates.filter((item) => clean(item.name) === rawName || clean(item.base) === stripped);
          matches = names.length ? names : candidates;
        } else {
          matches = candidates;
        }
      }
      const listing = matches[0];
      const consistent = Boolean(listing && (matches.length === 1 || matches.every((item) => item.specKey === listing.specKey)));

      const finalCards = stackCards ?? (cardsKnown ? cards : consistent ? listing.cards : []);
      const finalCardsKnown = stackCards !== null || cardsKnown || consistent;
      const finalSlots = stack?.slots ?? (matches.length && (matches.length === 1 || matches.every((item) => item.slots === listing.slots)) ? listing.slots : undefined);
      const extraTags = stack ? [
        stack.forged ? '鍛造武器' : '',
        stack.element ? `屬性:${stack.element}` : '',
        stack.starCrumbs ? `星星角×${stack.starCrumbs}` : '',
        stack.options ? (Array.isArray(stack.options) ? stack.options.join('、') : String(stack.options)) : ''
      ].filter(Boolean).join(' ｜ ') : (consistent ? listing?.rawSpecText : '');

      populateRichTooltip({
        id,
        refine,
        price,
        qty: consistent ? listing?.qty : undefined,
        seller: consistent ? listing?.seller : undefined,
        city: consistent ? listing?.city : undefined,
        name: rawName,
        base: rawName.replace(/^\+\s*\d+\s*/, ''),
        slots: finalSlots,
        cards: finalCards,
        cardsKnown: finalCardsKnown,
        rawSpecText: extraTags
      });
      showTooltip(e);
      return;
    }
    hideTooltip();
  }

  document.addEventListener('mouseover', (e) => {
    if (isScrollingPage) return;
    pendingHoverEvent = e;
    if (hoverRafId) return;
    hoverRafId = requestAnimationFrame(() => {
      hoverRafId = 0;
      const ev = pendingHoverEvent;
      pendingHoverEvent = null;
      if (ev) processHoverEvent(ev);
    });
  }, { passive: true });

  mktRowsBox.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]'); if (!btn) return;
    const r = mktKeyMap.get(btn.closest('[data-rkey]')?.dataset.rkey); if (!r) return;
    if (btn.dataset.act === 'fav') {
      const adding = !mktFavs.has(r.id);
      try {
        mktFavs = new Set(updateStoredValue('roi-favorites-v1', validateFavorites, [...mktFavs], (latest) => {
          const next = new Set(latest);
          if (adding) next.add(r.id); else next.delete(r.id);
          return [...next];
        }));
      } catch (error) { log('market', '收藏儲存失敗', error.name); }
      renderMkt();
    } else if (btn.dataset.act === 'find') {
      triggerNativeTownSearch(r.base);
    }
  });

  const mktSwitch = document.createElement('span'); mktSwitch.dataset.roiBrowseSwitch = ''; mktSwitch.style.cssText = 'display:inline-flex;gap:4px;margin-left:8px;';
  const bNat = document.createElement('button'); bNat.className = 'xp-btn small'; bNat.textContent = '原生攤位'; bNat.onclick = () => { mktView = false; stopMktAuto(); syncMktMount(); };
  const bCat = document.createElement('button'); bCat.className = 'xp-btn small'; bCat.textContent = '📊 商品分類'; bCat.onclick = () => { mktView = true; syncMktMount(); };
  mktSwitch.append(bNat, bCat);

  function findCityVendingFieldset() {
    return [...document.querySelectorAll('fieldset')].find((f) => {
      if (f === mktPanel || f.closest('[hidden],[inert],[aria-hidden="true"]') || !visible(f.parentElement)) return false;
      if (!visible(f) && !f.hasAttribute('data-roi-browse-hidden')) return false;
      const legTxt = clean(roiPriceText([...f.children].find((e) => e.tagName === 'LEGEND') || document.createElement('span')));
      return /的攤位/.test(legTxt) && !/^(?:搜尋|我的攤位)/.test(legTxt);
    });
  }

  // 攤位元件的 props.snap 可能是較早 render 留下的舊快照（元件未重繪時同一物件會一直被讀到）。
  // 每個快照物件只在第一次被看到時套用一次，舊快照不會在每次路由時把較新的 API 餘額改回去。
  const seenBalanceSnapshots = new WeakSet();
  function syncMarketBalance(snapshot, actorId) {
    if (!snapshot || typeof snapshot !== 'object' || seenBalanceSnapshots.has(snapshot)) return;
    seenBalanceSnapshots.add(snapshot);
    const character = snapshot?.character;
    const id = snapshotCharacterId(snapshot) ?? positiveId(actorId);
    const ownerMatches = id ? id === state.activeCharId :
      Boolean(character?.name && character.name === state.activeCharName &&
        state.chars.filter(c => c.name === character.name).length === 1 &&
        state.chars.some(c => Number(c.id) === state.activeCharId && c.name === character.name));
    const balance = character?.zeny;
    if (!state.activeCharId || !ownerMatches || !Number.isSafeInteger(balance) || balance < 0) return;
    if (state.curZeny === balance && state.charZenyMap[state.activeCharId] === balance) return;
    state.initZenyMap[state.activeCharId] ??= balance;
    state.curZeny = balance;
    localZenyAt.set(state.activeCharId, Date.now());
    state.charZenyMap[state.activeCharId] = balance;
    updateHUD();
    renderChars();
  }

  function syncMktMount() {
    ensurePackItemsLoaded();
    refreshTownSearchResults(findTownSearchUI());
    const allFields = [...document.querySelectorAll('fieldset')].filter((f) => f !== mktPanel);
    const searchField = allFields.find((f) => clean(roiPriceText([...f.children].find((e) => e.tagName === 'LEGEND') || document.createElement('span'))).startsWith('搜尋所有城鎮的攤位'));
    if (searchField) {
      const upperFields = allFields.filter((f) => f.parentElement === searchField.parentElement && /^(?:手推車|開攤|我的攤位|賣出紀錄)/.test(clean([...f.children].find((e) => e.tagName === 'LEGEND')?.textContent)));
      upperFields.forEach((f) => { if (state.mktUpperFold) f.setAttribute('data-roi-native-fold', ''); else f.removeAttribute('data-roi-native-fold'); });
      const sLeg = [...searchField.children].find((e) => e.tagName === 'LEGEND');
      if (upperFields.length && sLeg) {
        if (upperFoldBtn.parentElement !== sLeg) sLeg.appendChild(upperFoldBtn);
        const label = state.mktUpperFold ? '展開手推車／開攤／紀錄' : '收折手推車／開攤／紀錄';
        if (upperFoldBtn.textContent !== label) upperFoldBtn.textContent = label;
      }
    } else {
      document.querySelectorAll('[data-roi-native-fold]').forEach((el) => el.removeAttribute('data-roi-native-fold'));
    }

    const cf = findCityVendingFieldset();
    if (!cf) {
      mktPanel.remove();
      if (mktAuto15s || crossAbortCtrl) stopMktAuto('已離開攤位頁');
      document.querySelectorAll('[data-roi-browse-hidden]').forEach((el) => el.removeAttribute('data-roi-browse-hidden'));
      return;
    }
    for (const previous of document.querySelectorAll('[data-roi-browse-hidden]')) if (previous !== cf) previous.removeAttribute('data-roi-browse-hidden');
    if (mktPanel.previousElementSibling !== cf) cf.after(mktPanel);
    const opening = mktView && mktPanel.hidden;
    mktPanel.hidden = !mktView;
    if (mktView) cf.setAttribute('data-roi-browse-hidden', '');
    else cf.removeAttribute('data-roi-browse-hidden');
    const leg = mktView ? mktPanel.querySelector('#roi-mkt-leg') : [...cf.children].find((e) => e.tagName === 'LEGEND');
    if (leg && mktSwitch.parentElement !== leg) leg.appendChild(mktSwitch);
    const p = readFiberForUi(() => getCommittedProps(cf, (x) => Array.isArray(x.shops) && x.snap?.mapId));
    if (p === undefined) { if (opening) renderMkt(); return; }
    syncMarketBalance(p?.snap, p?.characterId);
    if ((updateLocalListings(p) || opening) && mktView) renderMkt();
  }
