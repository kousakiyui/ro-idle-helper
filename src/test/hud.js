
  function currentLootAutoControl() {
    const controls = [...document.querySelectorAll('[data-roi-loot-auto]')].filter(visible);
    return controls.length === 1 && !controls[0].disabled ? controls[0] : null;
  }

  function syncHudSettings() {
    const pane = document.querySelector('#pane-cfg.active');
    if (!pane) return;
    for (const input of pane.querySelectorAll('[data-ro-pref]')) input.checked = state[input.dataset.roPref];
    pane.querySelector('#c-price-lock').checked = priceOptions.enabled;
    const priceThreshold = pane.querySelector('#c-price-threshold');
    if (priceThreshold && priceThreshold !== document.activeElement && priceThreshold.value !== String(priceOptions.threshold)) {
      priceThreshold.value = priceOptions.threshold;
    }
    pane.querySelector('#c-rare-sync').checked = rareAutoMap;
    const loot = currentLootAutoControl();
    const lootSwitch = pane.querySelector('#c-loot-sync');
    lootSwitch.checked = Boolean(loot?.checked);
    lootSwitch.disabled = !loot;
    const auto = pane.querySelector('#c-market-auto');
    auto.checked = mktAuto15s;
    auto.disabled = !mktAuto15s && (!mktPanel.isConnected || mktPanel.hidden);
    pane.querySelector('#c-market-min').checked = mktPanel.querySelector('#roi-mkt-min').checked;
    syncRefineSettings(pane);
  }

  const hudSkillControls = 'button[aria-label$=" +1"], [role="region"][aria-label="技能點預覽"], [role="region"][aria-label="屬性點預覽"]';
  let hudFit = null, hudYield = null, hudSizeObserver = null, browserMenuObserver = null;
  function resizeHud() { hudFit?.(); }
  window.addEventListener('resize', resizeHud);
  window.addEventListener('pagehide', function releaseHud(event) {
    if (event.persisted) return;
    window.removeEventListener('pagehide', releaseHud);
    window.removeEventListener('resize', resizeHud);
    hudSizeObserver?.disconnect();
    browserMenuObserver?.disconnect();
    hudFit = hudYield = null;
  });
  function ensureHUD() {
    if (!document.body || document.getElementById('ro-helper-hud')) return;
    // 浮窗被移除後重建時，沿用同一份樣式並釋放舊的觀察器，避免重複 CSS 與監聽器累積。
    hudSizeObserver?.disconnect();
    browserMenuObserver?.disconnect();
    browserMenuObserver = null;
    const st = document.querySelector('style[data-roi-style]') || document.createElement('style');
    st.dataset.roiStyle = '';
    st.textContent = `
      [data-roi-browse-hidden], [data-roi-native-fold] { display: none !important; }
      table[data-roi-town-results] { display: block; overflow: auto; }
      table[data-roi-town-results] > :is(thead, tbody) > tr > :first-child:not([colspan]) { width: 100%; }
      nav.xp-menubar[aria-label="主選單"],
      nav.xp-menubar[aria-label="主選單"] > .xp-menu-group { flex-wrap:wrap !important; min-width:0; max-width:100%; }
      nav.xp-menubar[aria-label="主選單"] .xp-menu-item { flex-shrink:0; white-space:nowrap; }
      [data-roi-wh-custom-view] > ul > li:not([data-roi-wh-pinned]),
      [data-roi-wh-custom-view] [data-roi-wh-native-bulk],
      [data-roi-wh-custom-tabs] > input { display:none !important; }
      [data-roi-wh-custom-tabs] > button:not([data-roi-wh-custom-tab])[aria-selected="true"] { background:var(--face-2) !important; font-weight:normal !important; }
      [data-roi-wh-custom-tab][aria-selected="true"] { background:var(--tab-on,#d4d0c8); font-weight:bold; }
      @keyframes roi-stop-pulse { to { outline-offset:4px; outline-color:transparent; } }
      #ro-fab.roi-stop-alert { outline:3px solid #ef4444; animation:roi-stop-pulse 1.2s ease-out infinite; }
      @media (prefers-reduced-motion:reduce) { #ro-fab.roi-stop-alert { animation:none; } }
      [data-roi-wh-pin], [data-roi-wh-pin-search] { flex:none; inline-size:16px; padding:0; border:0; background:transparent; color:inherit; line-height:1; cursor:pointer; }
      [data-roi-wh-pin][aria-pressed="true"] { color:#b45309; }
      html.night [data-roi-wh-pin][aria-pressed="true"] { color:#fbbf24; }
      html:not([data-roi-money-off]) .roi-mc-text { color: var(--roi-mc) !important; font-weight: bold !important; font-variant-numeric: tabular-nums; }
      html:not([data-roi-money-off]):is(.night,[data-info-night]) .roi-mc-text,
      html:not([data-roi-money-off]) #roi-mkt-rows .roi-mc-text { color: var(--roi-mn) !important; -webkit-text-fill-color: currentColor !important; }
      .roi-mkt-row:hover { background:rgba(56,189,248,0.12) !important; }
      table.roi-market-table { width:100% !important; table-layout:fixed !important; }
      table.roi-market-table tr > [data-roi-market-col] { box-sizing:border-box !important; }
      table.roi-market-table tr > [data-roi-market-col="item"] { width:auto !important; }
      table.roi-market-table tr > [data-roi-market-col="price"] { position:relative !important; width:180px !important; padding-right:48px !important; text-align:right !important; white-space:nowrap !important; }
      table.roi-market-table tr > [data-roi-market-col="stock"] { width:65px !important; text-align:right !important; white-space:nowrap !important; }
      table.roi-market-table tr > [data-roi-market-col="input"] { width:85px !important; text-align:right !important; white-space:nowrap !important; }
      table.roi-market-table tr > [data-roi-market-col="input-stock"] { width:150px !important; text-align:right !important; white-space:nowrap !important; }
      table.roi-market-table tr > [data-roi-market-col^="input"] input[type="number"] { width:64px !important; max-width:100% !important; box-sizing:border-box !important; }
      table.roi-market-table td[data-roi-market-col="price"] > button[data-roi-price-search] { position:absolute; right:22px; top:50%; transform:translateY(-50%); width:21px; height:21px; padding:0; border:0; background:transparent; color:#38bdf8 !important; font:14px sans-serif; cursor:pointer; }
      @media(max-width:600px) {
        table.roi-market-table tr > [data-roi-market-col="price"] { width:135px !important; }
        table.roi-market-table tr > [data-roi-market-col="stock"] { width:45px !important; }
        table.roi-market-table tr > [data-roi-market-col="input"] { width:65px !important; }
        table.roi-market-table tr > [data-roi-market-col="input-stock"] { width:110px !important; }
        table.roi-market-table tr > [data-roi-market-col^="input"] input[type="number"] { width:52px !important; }
      }
      li[data-roi-wh-locked] { background:linear-gradient(90deg,rgba(245,158,11,0.22),transparent 85%)!important; border-left:3px solid #f59e0b!important; padding-left:4px!important; }
      button[data-roi-wh-badge="lock"] { background:linear-gradient(135deg,#78350f,#92400e)!important; color:#fde047!important; border:1px solid #f59e0b!important; border-radius:4px!important; padding:0 5px!important; margin:0 4px!important; font-size:11px!important; font-weight:bold!important; cursor:pointer!important; }
      button[data-roi-wh-badge="unlock"] { background:transparent!important; color:#64748b!important; border:1px dashed #475569!important; border-radius:4px!important; padding:0 4px!important; margin:0 4px!important; font-size:11px!important; opacity:0.6; cursor:pointer!important; }
      [data-ro-ref-tier="4"]  { color: #60a5fa !important; font-weight: 600 !important; }
      [data-ro-ref-tier="5"]  { color: #34d399 !important; font-weight: 600 !important; }
      [data-ro-ref-tier="6"]  { color: #a3e635 !important; font-weight: 700 !important; }
      [data-ro-ref-tier="7"]  { color: #facc15 !important; font-weight: 700 !important; text-shadow: 0 0 5px rgba(250,204,21,0.45) !important; }
      [data-ro-ref-tier="8"]  { color: #fb923c !important; font-weight: 800 !important; text-shadow: 0 0 7px rgba(251,146,60,0.55) !important; }
      [data-ro-ref-tier="9"]  { color: #f87171 !important; font-weight: 800 !important; text-shadow: 0 0 9px rgba(248,113,113,0.7) !important; }
      [data-ro-ref-tier="10"] { color: #ff2d55 !important; font-weight: 900 !important; text-shadow: 0 0 8px #ff2d55, 0 0 3px #ffd700 !important; background: linear-gradient(90deg, rgba(255,45,85,0.22), rgba(250,204,21,0.18)) !important; border-radius: 4px !important; padding: 0 5px !important; border: 1px solid rgba(255,215,0,0.65) !important; }
      #ro-helper-hud { position:fixed; top:48px; right:14px; z-index:2147483646; font-family:system-ui,-apple-system,"Microsoft JhengHei",sans-serif; user-select:none; touch-action:none; }
      #ro-helper-hud[data-roi-hud-yield] { pointer-events:none; }
      #ro-helper-hud[data-roi-hud-yield] > #ro-hud-card { visibility:hidden; pointer-events:none; }
      #ro-helper-hud[data-roi-hud-yield] > #ro-fab { display:flex !important; position:fixed; left:var(--roi-hud-yield-x); top:var(--roi-hud-yield-y); pointer-events:auto; cursor:pointer !important; }
      #ro-hud-card { background:linear-gradient(165deg,rgba(15,23,42,0.96),rgba(9,13,22,0.98)); backdrop-filter:blur(12px); color:#f8fafc; border:1.5px solid rgba(56,189,248,0.75); border-radius:12px; box-sizing:border-box; width:min(365px,calc(100vw - 8px)); max-height:calc(100vh - 8px); max-height:calc(100dvh - 8px); box-shadow:0 16px 40px rgba(0,0,0,0.88), 0 0 15px rgba(56,189,248,0.15); font-size:12px; overflow:auto; }
      #ro-drag { position:sticky; top:0; z-index:1; }
      .ro-tab { flex:1; text-align:center; padding:8px 2px; cursor:pointer; color:#94a3b8; font-weight:bold; font-size:11px; border-bottom:2px solid transparent; transition:all 0.15s; }
      .ro-tab:hover { color:#e2e8f0; background:rgba(30,41,59,0.5); }
      .ro-tab.active { color:#fbbf24; border-bottom-color:#fbbf24; background:rgba(30,41,59,0.9); }
      .ro-pane { display:none; padding:10px 12px; max-height:410px; overflow-y:auto; touch-action:pan-y; }
      .ro-pane.active { display:block; }
      .ro-box { background:rgba(30,41,59,0.75); border:1px solid rgba(71,85,105,0.65); border-radius:8px; padding:7px 9px; box-shadow:inset 0 1px 0 rgba(255,255,255,0.04); }
      #pane-cfg fieldset { min-inline-size:0; margin:0 0 8px; display:grid; gap:6px; }
      #pane-cfg legend { color:#fbbf24; font-weight:bold; }
      #pane-cfg label { display:flex; align-items:center; flex-wrap:wrap; gap:4px; }
      #pane-cfg label > input { margin:0 4px 0 0; }
      #pane-cfg input[type="number"] { width:7em; color:#f8fafc; background:#0f172a; border:1px solid #475569; border-radius:4px; }
    `;
    if (!st.isConnected) document.head.appendChild(st);
    document.documentElement.toggleAttribute('data-roi-money-off', !state.moneyColor);

    const hud = document.createElement('div'); hud.id = 'ro-helper-hud';
    hud.innerHTML = `
      <div id="ro-fab" style="display:${state.hudMin ? 'flex' : 'none'};width:46px;height:46px;border-radius:50%;background:linear-gradient(135deg,#0f172a,#1e293b);border:2px solid #38bdf8;color:#38bdf8;align-items:center;justify-content:center;font-size:21px;cursor:move;box-shadow:0 8px 24px rgba(0,0,0,0.85);" title="可拖曳移動｜點擊展開">⚡</div>
      <div id="ro-hud-card" style="display:${state.hudMin ? 'none' : 'block'};">
        <div id="ro-drag" style="display:flex;justify-content:space-between;align-items:center;gap:6px;padding:8px 10px;background:linear-gradient(90deg,#1e293b,#0f172a);border-bottom:1px solid #334155;font-weight:bold;color:#38bdf8;cursor:move;" title="按住可拖曳移動視窗">
          <span style="white-space:nowrap;">⚡ RO Idle v3.5.2.6 測試版</span>
          <button id="ro-min-btn" style="background:#334155;color:#fff;border:none;border-radius:5px;padding:2px 8px;cursor:pointer;font-weight:bold;">━</button>
        </div>
        <div style="display:flex;background:#090d16;border-bottom:1px solid #1e293b;">
          <div class="ro-tab active" data-t="tel">📊 效率</div>
          <span data-roi-mvp-slot></span>
          <div class="ro-tab" data-t="chr">👥 分身</div>
          <div class="ro-tab" data-t="lot">🎒 掉寶</div>
          <div class="ro-tab" data-t="cfg">⚙️ 設定</div>
        </div>
        <div class="ro-pane active" id="pane-tel">
          <div style="display:flex;justify-content:space-between;margin-bottom:7px;font-size:11.5px;">
            <span>角色：<b id="u-name" style="color:#38bdf8;">讀取中</b></span>
            <span id="u-time" style="color:#4ade80;font-weight:bold;font-variant-numeric:tabular-nums;">⏱️ 00:00</span>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:7px;">
            <div class="ro-box"><small style="color:#94a3b8;">Base EXP/h</small><div id="u-bexp" style="font-size:13.5px;font-weight:bold;color:#facc15;margin-top:2px;">0</div></div>
            <div class="ro-box"><small style="color:#94a3b8;">Job EXP/h</small><div id="u-jexp" style="font-size:13.5px;font-weight:bold;color:#38bdf8;margin-top:2px;">0</div></div>
            <div class="ro-box"><small style="color:#94a3b8;">擊殺 (累計)</small><div id="u-kph" style="font-size:13.5px;font-weight:bold;color:#4ade80;margin-top:2px;">0/h (0)</div></div>
            <div class="ro-box"><small style="color:#94a3b8;">均傷 / 最高</small><div id="u-dmg" style="font-size:13.5px;font-weight:bold;color:#f472b6;margin-top:2px;">0 / 0</div></div>
          </div>
          <div class="ro-box" style="margin-bottom:7px;display:flex;justify-content:space-between;align-items:center;">
            <div><small style="color:#94a3b8;">隨身 Zeny (本角淨變動)</small><div id="u-zeny" style="font-weight:bold;color:#facc15;font-size:13px;margin-top:2px;">0 Z (+0)</div></div>
            <div style="text-align:right;"><small style="color:#94a3b8;">漏撿</small><div id="u-miss" style="font-weight:bold;color:#f87171;font-size:13px;margin-top:2px;">0</div></div>
          </div>
          <div style="display:flex;gap:6px;">
            <button id="b-pause" style="flex:1;background:linear-gradient(135deg,#d97706,#b45309);color:#fff;border:none;padding:6px;border-radius:6px;cursor:pointer;font-weight:bold;">⏸️ 暫停監測</button>
            <button id="b-reset" style="flex:1;background:#334155;color:#fff;border:none;padding:6px;border-radius:6px;cursor:pointer;font-weight:bold;">🔄 歸零</button>
          </div>
        </div>
        <div class="ro-pane" id="pane-chr">
          <div style="display:flex;justify-content:space-between;margin-bottom:7px;background:#090d16;padding:7px 10px;border-radius:6px;border:1px solid #1e293b;">
            <span>💰 帳號總 Zeny：</span><b id="u-tzeny" style="color:#facc15;">計算中...</b>
          </div>
          <div id="u-clist">同步中...</div>
        </div>
        <div class="ro-pane" id="pane-lot">
          <div id="u-rlist" style="background:#090d16;padding:7px;border-radius:6px;border:1px solid #1e293b;margin-bottom:7px;max-height:75px;overflow:auto;color:#fde047;font-size:11px;">尚無稀有掉落...</div>
          <div id="u-llist" style="background:#090d16;padding:7px;border-radius:6px;border:1px solid #1e293b;max-height:190px;overflow:auto;font-size:11px;">尚無撿取紀錄...</div>
        </div>
        <div class="ro-pane" id="pane-cfg">
          <div data-roi-browser-menu hidden style="margin-bottom:8px;"></div>
          <fieldset class="ro-box"><legend>顯示與通知</legend>
            <label><input type="checkbox" data-ro-pref="itemHover"> 背包與倉庫物品懸浮提示</label>
            <label><input type="checkbox" data-ro-pref="marketHover"> 攤位商品懸浮提示</label>
            <label><input type="checkbox" data-ro-pref="moneyColor"> 金額分色</label>
            <label><input type="checkbox" data-ro-pref="sound"> 音效</label>
            <label><input type="checkbox" data-ro-pref="notify"> 桌面通知</label>
          </fieldset>
          <fieldset class="ro-box"><legend>倉庫</legend>
            <label><input type="checkbox" data-ro-pref="whProtectPins"> 清倉排除自選（★）</label>
            <label><input type="checkbox" data-ro-pref="whSaleReview"> 出售前清單核對</label>
            <label><input type="checkbox" data-ro-pref="whAutoEquipCard"> 自動保護卡片、精煉或有洞裝備</label>
            <label><input type="checkbox" id="c-price-lock"> 掛牌價自動保護</label>
            <label>保護門檻 <input type="number" id="c-price-threshold" min="1" max="1000000000000" step="1" value="${priceOptions.threshold}"> Zeny</label>
          </fieldset>
          <fieldset class="ro-box"><legend>精煉</legend>
            <label><input type="checkbox" id="ref-skip-cfm" data-roi-ref-confirm> 精煉時略過確認窗</label>
            <label><input type="checkbox" id="ref-auto-wh" data-roi-ref-warehouse> 自動領料及存倉</label>
            <label>每次領料 <input type="number" id="ref-material-batch" data-roi-ref-batch min="1" max="1000" step="1"> 個</label>
          </fieldset>
          <fieldset class="ro-box"><legend>攤位</legend>
            <label><input type="checkbox" data-ro-pref="mktUpperFold"> 收折手推車、開攤及紀錄</label>
            <label><input type="checkbox" id="c-market-min"> 只顯示同規格最低價</label>
            <label title="請先開啟商品分類"><input type="checkbox" id="c-market-auto"> 每 15 秒自動整理（商品分類開啟時）</label>
          </fieldset>
          <fieldset class="ro-box"><legend>掛機設定</legend>
            <label><input type="checkbox" id="c-rare-sync"> 隨地圖同步必撿稀有掉落</label>
            <label title="請先開啟該角色的道具與補給"><input type="checkbox" id="c-loot-sync"> 本角隨地圖自動設定戰利品（道具與補給開啟時）</label>
          </fieldset>
          <div id="c-settings-status" role="status" style="color:#fde047;"></div>
          <div style="font-weight:bold;color:#fbbf24;margin-bottom:4px;">🔒 自訂倉庫貴重保護詞 (由你決定)</div>
          <textarea id="i-words" rows="2" placeholder="例：布里刊, 亡者遺物, 神之金屬, 鋁" style="width:100%;box-sizing:border-box;background:#090d16;color:#fde047;border:1px solid #475569;border-radius:6px;padding:6px;font-size:11.5px;user-select:text;"></textarea>
          <button id="b-save-words" style="width:100%;margin:6px 0 8px;background:linear-gradient(135deg,#16a34a,#15803d);color:#fff;border:none;padding:6px;border-radius:6px;cursor:pointer;font-weight:bold;">💾 儲存自訂貴重詞並套用至倉庫</button>
          <div style="display:flex;gap:6px;">
            <button id="b-exp-json" style="flex:1;background:linear-gradient(135deg,#0284c7,#0369a1);color:#fff;border:none;padding:6px;border-radius:6px;cursor:pointer;font-weight:bold;">📤 匯出備份</button>
            <button id="b-imp-json" style="flex:1;background:#334155;color:#fff;border:none;padding:6px;border-radius:6px;cursor:pointer;font-weight:bold;">📥 匯入還原</button>
            <input type="file" id="i-imp-file" accept=".json" style="display:none;">
          </div>
        </div>
      </div>
    `;
    hud.querySelector('#i-words').value = state.customProtectWords.join(', ');
    state.renderedLootRev = -1;
    document.body.appendChild(hud);
    const mvpSlot = hud.querySelector('[data-roi-mvp-slot]');
    if (mvpRadar) mvpSlot.replaceWith(mvpRadar.button);
    else mvpSlot.remove();

    function attachBrowserMenu() {
      const menu = document.getElementById('mgm-userscript-menu');
      const slot = hud.querySelector('[data-roi-browser-menu]');
      if (!menu || menu.parentElement === slot) return Boolean(menu);
      menu.style.cssText = 'position:relative;top:auto;right:auto;z-index:2;font:12px system-ui;color:#eee;';
      slot.append(menu);
      slot.hidden = false;
      return true;
    }
    if (!attachBrowserMenu()) {
      const observer = browserMenuObserver = new MutationObserver(() => {
        if (attachBrowserMenu()) { observer.disconnect(); if (browserMenuObserver === observer) browserMenuObserver = null; }
      });
      observer.observe(document.body, { childList: true });
    }

    let yieldDismissed = false;
    const intersects = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    function syncHudYield(hudRect) {
      if (document.hidden || !hud.isConnected) return;
      const controls = [...document.querySelectorAll(hudSkillControls)]
        .filter(el => visible(el) && getComputedStyle(el).visibility === 'visible');
      const rects = controls.map(el => el.getBoundingClientRect())
        .filter(rect => rect.right > 0 && rect.bottom > 0 && rect.left < innerWidth && rect.top < innerHeight &&
          rect.right > rect.left && rect.bottom > rect.top);
      if (!controls.length) yieldDismissed = false;
      if (state.hudMin || yieldDismissed || !rects.length ||
          !rects.some(rect => intersects(rect, hudRect ??= hud.getBoundingClientRect()))) {
        hud.removeAttribute('data-roi-hud-yield');
        return;
      }

      // Keep the card in layout so the original footprint remains measurable while yielded.
      const size = 50, edge = 4; // The floating button is 46px plus two 2px borders.
      const maxX = Math.max(0, innerWidth - size - edge);
      const maxY = Math.max(0, innerHeight - size - edge);
      const xs = [maxX, edge, ...rects.map(rect => rect.left - size)];
      const ys = [edge, maxY, ...rects.map(rect => rect.bottom)];
      let spot;
      for (const y of ys) {
        if (y < 0 || y > maxY) continue;
        const x = xs.find(x => x >= 0 && x <= maxX &&
          !rects.some(rect => intersects(rect, { left: x, top: y, right: x + size, bottom: y + size })));
        if (x !== undefined) { spot = { x, y }; break; }
      }
      const left = (spot?.x ?? maxX) + 'px', top = (spot?.y ?? 0) + 'px';
      if (hud.style.getPropertyValue('--roi-hud-yield-x') !== left) hud.style.setProperty('--roi-hud-yield-x', left);
      if (hud.style.getPropertyValue('--roi-hud-yield-y') !== top) hud.style.setProperty('--roi-hud-yield-y', top);
      hud.toggleAttribute('data-roi-hud-yield', true);
    }

    function clampHud(left, top, { width, height }) {
      const edge = 4;
      const maxLeft = innerWidth - width - edge;
      const maxTop = innerHeight - height - edge;
      return {
        left: Math.min(Math.max(0, maxLeft), Math.max(edge, left)),
        top: Math.min(Math.max(0, maxTop), Math.max(edge, top))
      };
    }

    function writeHudPosition({ left, top }) {
      hud.style.right = 'auto';
      hud.style.left = left + 'px';
      hud.style.top = top + 'px';
    }

    function fitHud() {
      if (!hud.isConnected || document.hidden) return;
      const rect = hud.getBoundingClientRect();
      const { left, top } = state.hudPos || {};
      const position = clampHud(Number.isFinite(left) ? left : innerWidth - rect.width - 14,
        Number.isFinite(top) ? top : 48, rect);
      syncHudYield({ ...position, right: position.left + rect.width, bottom: position.top + rect.height });
      writeHudPosition(position);
    }

    fitHud();
    hudFit = fitHud;
    hudYield = () => syncHudYield();
    hudSizeObserver = new ResizeObserver(fitHud);
    hudSizeObserver.observe(hud);

    const bindDrag = (handle, onClick) => {
      let dragging = false, moved = false, sx = 0, sy = 0, ox = 0, oy = 0;
      handle.addEventListener('pointerdown', (e) => {
        if (e.target.closest('button')) return;
        dragging = true; moved = false;
        const rect = hud.getBoundingClientRect();
        sx = e.clientX; sy = e.clientY; ox = rect.left; oy = rect.top;
        handle.setPointerCapture(e.pointerId);
      });
      handle.addEventListener('pointermove', (e) => {
        if (!dragging) return;
        const dx = e.clientX - sx, dy = e.clientY - sy;
        if (Math.abs(dx) > 4 || Math.abs(dy) > 4) moved = true;
        if (!moved || hud.hasAttribute('data-roi-hud-yield')) return;
        state.hudPos = clampHud(ox + dx, oy + dy, hud.getBoundingClientRect());
        writeHudPosition(state.hudPos);
      });
      handle.addEventListener('pointerup', (e) => {
        if (!dragging) return;
        dragging = false;
        handle.releasePointerCapture(e.pointerId);
        if (moved) {
          if (!hud.hasAttribute('data-roi-hud-yield')) { savePrefs(); syncHudYield(); }
        } else if (onClick) onClick();
      });
    };

    const setMin = (m) => {
      if (!m && hud.hasAttribute('data-roi-hud-yield')) {
        yieldDismissed = true;
        syncHudYield();
        return;
      }
      if (!m) {
        clearTransientCharAlerts();
        document.getElementById('ro-fab').classList.remove('roi-stop-alert');
      }
      state.hudMin = m; savePrefs();
      document.getElementById('ro-hud-card').style.display = m ? 'none' : 'block';
      document.getElementById('ro-fab').style.display = m ? 'flex' : 'none';
      fitHud();
    };
    bindDrag(document.getElementById('ro-drag'), null);
    bindDrag(document.getElementById('ro-fab'), () => setMin(false));
    document.getElementById('ro-min-btn').onclick = () => setMin(true);

    hud.querySelectorAll('.ro-tab[data-t]').forEach((t) => t.onclick = () => {
      hud.querySelectorAll('.ro-tab,.ro-pane').forEach((x) => x.classList.remove('active'));
      t.classList.add('active'); document.getElementById('pane-' + t.dataset.t).classList.add('active');
      if (t.dataset.t === 'cfg') syncHudSettings();
    });

    const settings = hud.querySelector('#pane-cfg');
    const settingsStatus = settings.querySelector('#c-settings-status');
    for (const input of settings.querySelectorAll('[data-ro-pref]')) {
      input.onchange = () => {
        const key = input.dataset.roPref;
        if (key === 'whSaleReview') {
          setWarehouseSaleReview(input.checked);
          return;
        }
        state[key] = input.checked;
        savePrefs();
        if (key === 'itemHover' || key === 'marketHover') hideTooltip();
        if (key === 'moneyColor') {
          document.documentElement.toggleAttribute('data-roi-money-off', !state.moneyColor);
          if (state.moneyColor) alignAndColorizeNativeMarkets();
        }
        if (key === 'whProtectPins') refreshWarehouse();
        if (key === 'whAutoEquipCard') refreshWarehouse(true);
        if (key === 'mktUpperFold') syncMktMount();
      };
    }
    const bindSetting = (id, apply) => {
      settings.querySelector('#' + id).onchange = (event) => {
        settingsStatus.textContent = '';
        try { apply(event.target); }
        catch (error) { settingsStatus.textContent = error.message; }
        syncHudSettings();
      };
    };
    bindSetting('c-price-lock', (input) => savePriceOptions({ enabled: input.checked }));
    bindSetting('c-price-threshold', (input) => {
      const threshold = Number(input.value);
      if (!validThreshold(threshold)) {
        input.value = priceOptions.threshold;
        throw Error('保護門檻請輸入 1 至 1 兆之間的整數');
      }
      try { savePriceOptions({ threshold }); }
      finally { input.value = priceOptions.threshold; }
    });
    bindSetting('c-rare-sync', (input) => setRareAutoMap(input.checked));
    bindSetting('c-loot-sync', (input) => {
      const control = currentLootAutoControl();
      if (control && control.checked !== input.checked) control.click();
    });
    bindSetting('c-market-min', (input) => {
      mktPanel.querySelector('#roi-mkt-min').checked = input.checked;
      renderMkt();
    });
    bindSetting('c-market-auto', (input) => {
      if (mktAuto15s && !input.checked) stopMktAuto('已手動停止 15s 自動整理');
      else if (!mktAuto15s && input.checked && mktPanel.isConnected && !mktPanel.hidden) startMktAuto();
    });
    bindRefineSettings(settings, settingsStatus);

    document.getElementById('b-save-words').onclick = () => {
      let words;
      try { words = validateWords(document.getElementById('i-words').value.split(/[,，、\n]/).map((s) => s.trim()).filter(Boolean)); }
      catch (error) { alert('⚠️ ' + error.message); return; }
      state.customProtectWords = words;
      try { GM_setValue('ro_custom_protect_words_v091', words); } catch { log("hud", "自訂貴重詞儲存失敗"); }
      refreshWarehouse(true);
      alert(`✅ 已更新自訂貴重詞 (${state.customProtectWords.length} 項)！`);
    };

    document.getElementById('b-exp-json').onclick = () => {
      const payload = {
        format: 'ro-idle-lean-backup', version: 1,
        prefs: readValidatedSetting('ro_lean_prefs_v091', validatePrefs, {}),
        words: state.customProtectWords,
        wh: { marks: state.whMarks, autoLocks: state.whAutoLocks, pins: state.whPins },
        priceOptions,
        refineMaterialBatch: refMaterialBatch,
        favs: [...mktFavs]
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `ROIdle-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
    };
    const fileInp = document.getElementById('i-imp-file');
    document.getElementById('b-imp-json').onclick = () => fileInp.click();
    fileInp.onchange = async () => {
      try {
        const f = fileInp.files[0]; if (!f) return;
        if (!Number.isSafeInteger(f.size) || f.size < 1 || f.size > MAX_BACKUP_BYTES) throw Error('備份大小上限為 2 MB');
        const text = await f.text();
        if (fileInp.files[0] !== f) return;
        if (new TextEncoder().encode(text).length > MAX_BACKUP_BYTES) throw Error('備份大小上限為 2 MB');
        const writes = prepareBackupWrites(JSON.parse(text));
        commitBackupWrites(writes);
        alert('✅ 備份匯入成功，即將重新載入頁面！');
        location.reload();
      } catch (e) { alert('⚠️ 匯入失敗：' + e.message); }
    };

    const bPause = document.getElementById('b-pause');
    bPause.onclick = () => {
      if (!state.paused) { state.accMs += Date.now() - state.lastResumed; state.paused = true; bPause.textContent = '▶️ 繼續監測'; bPause.style.background = 'linear-gradient(135deg,#16a34a,#15803d)'; }
      else { state.lastResumed = Date.now(); state.paused = false; bPause.textContent = '⏸️ 暫停監測'; bPause.style.background = 'linear-gradient(135deg,#d97706,#b45309)'; }
      updateHUD();
    };
    document.getElementById('b-reset').onclick = () => {
      state.accMs = 0; state.lastResumed = Date.now(); state.kills = 0; state.bexp = 0; state.jexp = 0; state.dmgSum = 0; state.hits = 0; state.maxDmg = 0; state.missed = 0;
      state.loot = {}; state.lootRev++; state.renderedLootRev = -1;
      if (state.activeCharId) state.initZenyMap[state.activeCharId] = state.curZeny;
      document.getElementById('u-llist').innerHTML = '尚無撿取紀錄...';
      updateHUD();
    };
  }

  let hudRefs = null;
  function getHudRefs() {
    if (hudRefs && hudRefs.bexp?.isConnected) return hudRefs;
    const bexp = document.getElementById('u-bexp');
    if (!bexp) return null;
    hudRefs = {
      name: document.getElementById('u-name'),
      time: document.getElementById('u-time'),
      bexp,
      jexp: document.getElementById('u-jexp'),
      kph: document.getElementById('u-kph'),
      dmg: document.getElementById('u-dmg'),
      zeny: document.getElementById('u-zeny'),
      miss: document.getElementById('u-miss'),
      llist: document.getElementById('u-llist'),
      rlist: document.getElementById('u-rlist')
    };
    return hudRefs;
  }

  const fmt = (n) => n >= 1e8 ? (n / 1e8).toFixed(2) + '億' : n >= 1e4 ? (n / 1e4).toFixed(1) + '萬' : Math.round(n).toLocaleString();
  function updateHUD() {
    if (document.hidden || state.hudMin) return;
    syncHudSettings();
    const refs = getHudRefs();
    if (!refs) return;
    const sec = Math.max(1, Math.floor((state.accMs + (state.paused ? 0 : Date.now() - state.lastResumed)) / 1000)), hrs = sec / 3600;
    refs.name.textContent = state.activeCharName;
    refs.time.textContent = `${state.paused ? '⏸️ ' : '⏱️ '}${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
    refs.bexp.textContent = fmt(state.bexp / hrs);
    refs.jexp.textContent = fmt(state.jexp / hrs);
    refs.kph.textContent = `${Math.round(state.kills / hrs)}/h (${state.kills})`;
    refs.dmg.textContent = `${fmt(state.hits ? state.dmgSum / state.hits : 0)} / ${fmt(state.maxDmg)}`;
    const initZ = state.initZenyMap[state.activeCharId] ?? state.curZeny, diff = state.curZeny - initZ;
    refs.zeny.textContent = `${state.curZeny.toLocaleString()} Z (${diff >= 0 ? '+' : ''}${diff.toLocaleString()})`;
    refs.miss.textContent = `${state.missed} 次`;

    if (state.lootRev !== state.renderedLootRev) {
      state.renderedLootRev = state.lootRev;
      const lEntries = Object.entries(state.loot).sort((a, b) => b[1] - a[1]);
      if (lEntries.length) refs.llist.replaceChildren(...lEntries.map(([name, qty]) => {
        const row = element('div', null, 'display:flex;justify-content:space-between;border-bottom:1px dashed #334155;padding:3px 0;');
        row.append(element('span', name), element('b', `×${qty}`, 'color:#4ade80'));
        return row;
      }));
    }
    const list = refs.rlist;
    const pending = Math.min(state.rares.length, state.rareRev - Number(list.dataset.rev || 0));
    if (pending > 0) {
      if (!list.children.length) list.textContent = '';
      const rows = state.rares.slice(0, pending).map((line) => element('div', line));
      list.prepend(...rows);
      while (list.children.length > rareLimit) list.lastElementChild.remove();
      list.dataset.rev = state.rareRev;
    }
  }

  function recordCharAlert(id, reason) {
    if (!id) return;
    if (state.charAlerts[id]?.reason !== '已停止掛機') state.charAlerts[id] = { reason, at: Date.now() };
    if (state.hudMin) document.getElementById('ro-fab')?.classList.add('roi-stop-alert');
  }
  function clearTransientCharAlerts(id, before = Infinity) {
    let changed = false;
    for (const [key, alert] of Object.entries(state.charAlerts)) {
      if ((id != null && String(id) !== key) || alert.reason === '已停止掛機' || alert.at > before) continue;
      delete state.charAlerts[key];
      changed = true;
    }
    if (changed) {
      if (!Object.keys(state.charAlerts).length) document.getElementById('ro-fab')?.classList.remove('roi-stop-alert');
      renderChars();
    }
  }
  function renderChars() {
    const box = document.getElementById('u-clist'); if (!box) return;
    const sum = [...state.myCharIds].reduce((total, id) => total + (state.charZenyMap[id] || 0), 0);
    document.getElementById('u-tzeny').textContent = sum.toLocaleString() + ' Z';
    box.replaceChildren(...state.chars.map((c) => {
      const row = element('div', null, `display:flex;justify-content:space-between;align-items:center;background:rgba(30,41,59,0.8);padding:6px 10px;border-radius:6px;margin-bottom:5px;border-left:3px solid ${c.running ? '#22c55e' : '#ef4444'}`);
      const detail = element('div');
      detail.append(element('b', c.name), element('small', ` (Lv.${c.baseLv}/${c.jobLv})`, 'color:#94a3b8'),
        element('div', `📍 ${c.mapId} ｜ 💰 ${(state.charZenyMap[c.id] || 0).toLocaleString()} Z`, 'font-size:11px;color:#93c5fd;margin-top:2px'));
      const alert = state.charAlerts[c.id];
      if (alert) {
        detail.append(element('small', '⚠ ' + alert.reason, 'color:#f87171'));
        if (alert.reason !== '已停止掛機') row.onclick = () => clearTransientCharAlerts(c.id);
      }
      row.append(detail, element('b', c.running ? '🟢掛機' : '🔴停止', `color:${c.running ? '#4ade80' : '#f87171'}`));
      return row;
    }));
  }
