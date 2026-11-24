
  const plainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

  const state = {
    paused: false, accMs: 0, lastResumed: Date.now(),
    activeCharId: null, activeCharName: '讀取中...',
    initZenyMap: {}, curZeny: 0, chars: [], charZenyMap: {}, myCharIds: new Set(),
    kills: 0, bexp: 0, jexp: 0, dmgSum: 0, hits: 0, maxDmg: 0, damageTaken: 0, damageStartMs: 0, pickupQty: 0, hudMetrics: [...defaultHudMetrics],
    loot: Object.create(null), lootRev: 0, renderedLootRev: -1,
    rares: [], rareRev: 0,
    missed: 0,
    sound: false, notify: false, moneyColor: true, itemHover: true, marketHover: true,
    whProtectPins: true, mvpMergeRoster: false, charAlerts: {}, whProtect: true, whSaleReview: true, whAutoEquipCard: true,
    whMarks: {}, whAutoLocks: {}, customProtectWords: [],
    hudMin: false, hudPos: null, mktUpperFold: false,
    processedLines: new WeakMap(), lastNotifyAt: 0
  };

  Object.assign(state, readValidatedSetting('ro_lean_prefs_v091', validatePrefs, {}));
  const loadedWh = readValidatedSetting('warehouse-helper-v1', validateWarehouse, { marks: {}, autoLocks: {} }, true);
  state.whMarks = loadedWh.marks;
  state.whAutoLocks = loadedWh.autoLocks;
  state.whPins = loadedWh.pins ?? {};
  state.customProtectWords = readValidatedSetting('ro_custom_protect_words_v091', validateWords, []);

  let applyingRemote = false;
  // 其他分頁寫入的值一律先通過與寫入前相同的驗證；無效即忽略，不改本頁狀態。
  function listenRemote(key, validate, apply, json = false) {
    if (typeof GM_addValueChangeListener !== 'function') return;
    GM_addValueChangeListener(key, (_key, _old, value, remote) => {
      if (remote !== true || value === undefined) return;
      let data;
      try { data = validateStoredValue(value, validate, json); }
      catch (error) { console.warn('便利助手忽略無效的跨分頁資料', key, error.message); return; }
      if (data == null) return;
      applyingRemote = true;
      try { apply(data); } catch (error) { console.warn('便利助手設定同步', key, error.message); }
      finally { applyingRemote = false; }
    });
  }
  function listenSharedSettings() {
    if (typeof GM_addValueChangeListener !== 'function') return;
    const listen = (key, apply, validate, json) => listenRemote(key, validate, apply, json);
    listen('warehouse-helper-v1', data => {
      applyWarehouseData(mergeWarehouseChanges(data));
      refreshWarehouse();
    }, validateWarehouse, true);
    listen('ro_custom_protect_words_v091', words => {
      state.customProtectWords = words;
      const input = document.querySelector('#i-words');
      if (input && document.activeElement !== input) input.value = state.customProtectWords.join(', ');
      refreshWarehouse(true);
    }, validateWords);
    listen('ro_lean_prefs_v091', value => {
      const { hudMin, hudPos, ...prefs } = value;
      Object.assign(state, prefs);
      for (const [key, v] of Object.entries(prefs)) prefsSynced.set(key, prefValueSig(v));
      document.documentElement.toggleAttribute('data-roi-money-off', !state.moneyColor);
      hideTooltip();
      refreshWarehouse();
      syncMktMount();
      mvpRadar?.refreshPreferences();
      syncHudSettings();
    }, validatePrefs);
    listen(priceOptionKey, (options) => {
      priceOptions = options;
      refreshWarehouse();
      syncHudSettings();
    }, validatePriceOptions);
    listen('roi-favorites-v1', (favs) => {
      mktFavs = new Set(favs);
      renderMkt();
    }, validateFavorites);
    listen('roi-refine-material-batch-v1', (batch) => {
      if (refBusy) return;
      refMaterialBatch = batch;
      syncRefineSettings(refPanel);
      syncRefineSettings(document.getElementById('pane-cfg'));
    }, validateMaterialBatch);
    listen('roi-rare-auto-map-v1', (enabled) => applyRareAutoMap(enabled), validateRareAutoMap);
  }

  const prefKeys = ['sound', 'notify', 'moneyColor', 'itemHover', 'marketHover', 'whProtectPins', 'mvpMergeRoster', 'whProtect',
    'whSaleReview', 'whAutoEquipCard', 'hudMin', 'hudPos', 'mktUpperFold', 'hudMetrics'];
  const prefValueSig = (value) => JSON.stringify(value ?? null);
  // 本頁最後一次與已存值同步時的各欄位；儲存時只寫入與此不同（本頁改過）的欄位。
  const prefsSynced = new Map(prefKeys.map((key) => [key, prefValueSig(state[key])]));
  function savePrefs() {
    const changed = {};
    for (const key of prefKeys) if (prefValueSig(state[key]) !== prefsSynced.get(key)) changed[key] = state[key];
    if (!Object.keys(changed).length) return;
    try {
      updateStoredValue('ro_lean_prefs_v091', validatePrefs, {}, (latest) => ({ ...latest, ...changed }));
      for (const [key, value] of Object.entries(changed)) prefsSynced.set(key, prefValueSig(value));
    } catch (error) { console.warn('便利助手偏好設定儲存失敗', error); }
  }

  function setWarehouseSaleReview(enabled) {
    state.whSaleReview = enabled;
    savePrefs();
    for (const input of document.querySelectorAll('[data-roi-wh-sale-review]')) input.checked = enabled;
    syncHudSettings();
  }
