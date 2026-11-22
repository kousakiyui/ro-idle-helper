  const page = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
  if (page.top !== page.self) return;

  const TIMING = Object.freeze({
    // Network reuse, expiry and notification cadence in milliseconds.
    charPollInterval: 45000, charPollReuseMargin: 5000,
    notifyCooldown: 5000, notifyDuration: 5000,
    // Background UI, battle log and temporary character alerts.
    hudRefresh: 1500, charAlertExpiry: 600000, recentInteraction: 5000, pointerSample: 100,
    activeRouter: 160, visibleRouter: 300, hiddenRouter: 700, textRouter: 1500,
    activeLogFlush: 120, idleLogFlush: 250, alertRenderGap: 250,
    // MVP background and render cadence.
    mvpCaptureGap: 1000, mvpBackground: 15000, mvpRender: 30000,
    // Market refresh and query spacing.
    marketRefresh: 15000, marketSnapshotWait: 800, marketCrossSearchGap: 2200
  });

  function debugEnabled() {
    try { return localStorage.getItem('roi-debug') === '1'; }
    catch { return false; }
  }

  function log(scope, ...details) {
    if (debugEnabled()) console.debug('[ROI ' + scope + ']', ...details);
  }

  function element(tag, content, style) {
    const node = document.createElement(tag);
    if (content != null) node.textContent = content;
    if (style) node.style.cssText = style;
    return node;
  }

  const rareLimit = 100;
  const nonAsciiRx = /[^\x20-\x7E]/;
  const clean = (s) => {
    const str = String(s || '');
    if (!str) return '';
    return (nonAsciiRx.test(str) ? str.normalize('NFKC') : str).replace(/\s+/g, ' ').trim();
  };
  const visible = (el) => Boolean(el && el.isConnected && !el.closest('[hidden],[inert],[aria-hidden="true"]') && el.getClientRects().length > 0);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const zhCollator = new Intl.Collator('zh-Hant');

  const DAY_COLORS = ['#006d65', '#7900b8', '#243cc9', '#a74700', '#b40092', '#172dcc', '#006d20', '#bc2222', '#785800', '#b00057'];
  const NIGHT_COLORS = ['#00e5d0', '#d48aff', '#90a8ff', '#ffae3d', '#ff63df', '#87bcff', '#5fea83', '#ff7070', '#ffe05a', '#ff78b6'];

  function applyMoneyColor(el, numOrStr) {
    const digits = Math.max(1, String(numOrStr).replace(/[^\d]/g, '').replace(/^0+(?=\d)/, '').length);
    const dStr = String(digits);
    if (el.dataset.roiDigit === dStr && el.classList.contains('roi-mc-text')) return;
    const idx = Math.min(digits, DAY_COLORS.length) - 1;
    el.dataset.roiDigit = dStr;
    el.classList.add('roi-mc-text');
    el.style.setProperty('--roi-mc', DAY_COLORS[idx]);
    el.style.setProperty('--roi-mn', NIGHT_COLORS[idx]);
  }
  const getMoneyColorVars = (numOrStr) => {
    const digits = Math.max(1, String(numOrStr).replace(/[^\d]/g, '').replace(/^0+(?=\d)/, '').length);
    const idx = Math.min(digits, DAY_COLORS.length) - 1;
    return `--roi-mc:${DAY_COLORS[idx]};--roi-mn:${NIGHT_COLORS[idx]};`;
  };

  function roiPriceText(el) {
    if (!el.querySelector('[data-roi-price-search],[data-roi-browse-switch],[data-roi-upper-fold]')) return el.textContent;
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let n, txt = '';
    while ((n = w.nextNode())) {
      if (!n.parentElement.closest('[data-roi-price-search],[data-roi-browse-switch],[data-roi-upper-fold]')) txt += n.textContent;
    }
    return txt;
  }
