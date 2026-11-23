
(() => {
  'use strict';
  const MAX_BACKUP_BYTES = 2 * 1024 * 1024;
  const validMaterialBatch = (value) => Number.isSafeInteger(value) && value >= 1 && value <= 1000;
  function validateMaterialBatch(value) {
    if (!validMaterialBatch(value)) throw Error('每次領料數量須為 1～1000 的整數');
    return value;
  }
  function isPlainRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value) &&
      (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
  }
  function checkDataTree(value, depth = 0, budget = { keys: 0 }) {
    if (depth > 12 || (typeof value === 'string' && value.length > 16384)) throw Error('資料結構超過上限');
    if (value === null || typeof value !== 'object') return;
    if (!Array.isArray(value) && !isPlainRecord(value)) throw Error('資料物件格式不符');
    for (const key of Object.keys(value)) {
      if (++budget.keys > 30000 || ['__proto__', 'prototype', 'constructor'].includes(key)) throw Error('資料包含不安全欄位或超過上限');
      checkDataTree(value[key], depth + 1, budget);
    }
  }
  function validatePrefs(value) {
    if (!isPlainRecord(value)) throw Error('偏好設定格式不符');
    const result = {};
    for (const key of ['sound', 'notify', 'moneyColor', 'itemHover', 'marketHover', 'whProtectPins', 'mvpMergeRoster', 'whProtect', 'whSaleReview', 'whAutoEquipCard', 'hudMin', 'mktUpperFold']) {
      if (!Object.hasOwn(value, key)) continue;
      if (typeof value[key] !== 'boolean') throw Error('偏好設定的 ' + key + ' 必須是開關');
      result[key] = value[key];
    }
    if (Object.hasOwn(value, 'hudPos')) {
      if (value.hudPos === null) result.hudPos = null;
      else {
        const pos = value.hudPos;
        if (!isPlainRecord(pos) || !['left', 'top'].every((key) => Number.isFinite(pos[key]) && Math.abs(pos[key]) <= 1e6)) {
          throw Error('浮窗位置格式不符');
        }
        result.hudPos = { left: pos.left, top: pos.top };
      }
    }
    return result;
  }
  function validateWords(value) {
    if (!Array.isArray(value) || value.length > 500 || value.some((word) => typeof word !== 'string' || word.length > 80)) {
      throw Error('貴重詞清單格式或長度不符');
    }
    return [...new Set(value.map((word) => word.trim()).filter(Boolean))];
  }
  function validateFavorites(value) {
    if (!Array.isArray(value) || value.length > 5000 || value.some((id) => !Number.isSafeInteger(id) || id <= 0 || id > 1e9)) {
      throw Error('收藏清單格式或長度不符');
    }
    return [...new Set(value)];
  }
  function validateWarehouse(value) {
    if (!isPlainRecord(value) || !isPlainRecord(value.marks) || !isPlainRecord(value.autoLocks)) throw Error('倉庫鎖定資料格式不符');
    const result = { marks: {}, autoLocks: {} };
    for (const field of ['marks', 'autoLocks']) {
      const entries = Object.entries(value[field]);
      if (entries.length > 5000) throw Error('倉庫鎖定資料超過上限');
      for (const [id, reason] of entries) {
        if (!/^[1-9]\d*$/.test(id) || Number(id) > 1e9) throw Error('倉庫道具 ID 格式不符');
        if (field === 'marks' ? !['lock', 'neutral'].includes(reason) : typeof reason !== 'string' || reason.length > 256) {
          throw Error('倉庫鎖定原因格式不符');
        }
        result[field][id] = reason;
      }
    }
    if (Object.hasOwn(value, 'pins')) {
      if (!isPlainRecord(value.pins)) throw Error('倉庫自選資料格式不符');
      const entries = Object.entries(value.pins);
      if (entries.length > 5000 || entries.some(([id, name]) =>
        !/^[1-9]\d*$/.test(id) || Number(id) > 1e9 || typeof name !== 'string' || !name.trim() || name.length > 160)) {
        throw Error('倉庫自選物品格式或數量不符');
      }
      result.pins = Object.fromEntries(entries);
    }
    return result;
  }
  function validatePriceOptions(value) {
    if (!isPlainRecord(value) || typeof value.enabled !== 'boolean' ||
        !Number.isSafeInteger(value.threshold) || value.threshold <= 0 || value.threshold > 1e12) throw Error('掛牌保護設定格式不符');
    return { enabled: value.enabled, threshold: value.threshold };
  }
  function readValidatedSetting(key, validate, fallback, json = false) {
    try {
      let value = GM_getValue(key, undefined);
      if (value === undefined) return fallback;
      if (json && typeof value === 'string') {
        if (value.length > MAX_BACKUP_BYTES) return fallback;
        value = JSON.parse(value);
      }
      checkDataTree(value);
      return validate(value);
    } catch { return fallback; }
  }
  // 遠端（其他分頁）送來的值與寫入前使用同一組驗證；JSON 字串先檢查大小再解析。
  function validateStoredValue(value, validate, json = false) {
    if (json && typeof value === 'string') {
      if (value.length > MAX_BACKUP_BYTES) throw Error('資料超過大小上限');
      value = JSON.parse(value);
    }
    checkDataTree(value);
    return validate(value);
  }
  // 讀取最新已存值（無效時改用 fallback）→ 只套用本頁的變更 → 驗證 → 寫入，避免整包覆寫其他分頁剛寫入的欄位。
  function updateStoredValue(key, validate, fallback, mutate, json = false) {
    const latest = readValidatedSetting(key, validate, fallback, json);
    const next = validate(mutate(latest));
    checkDataTree(next);
    GM_setValue(key, json ? JSON.stringify(next) : next);
    return next;
  }
  function validateLearnedItems(value) {
    if (!isPlainRecord(value) || Object.keys(value).length > 3500) throw Error('道具快取超過上限');
    const result = {};
    for (const [id, info] of Object.entries(value)) {
      if (!/^[1-9]\d*$/.test(id) || Number(id) > 1e9 || !isPlainRecord(info)) continue;
      const item = {};
      for (const key of ['name', 'desc']) {
        if (typeof info[key] === 'string' && info[key].length <= (key === 'name' ? 160 : 1200)) item[key] = info[key];
      }
      for (const key of ['atk', 'matk', 'def', 'weight', 'wLv']) {
        if (Number.isFinite(info[key]) && info[key] >= 0 && info[key] <= 1e6) item[key] = info[key];
      }
      result[id] = item;
    }
    return result;
  }
  function validateCategoryProfiles(value) {
    if (!isPlainRecord(value) || Object.keys(value).length > 128) throw Error('分類設定超過上限');
    const result = {};
    for (const [id, profile] of Object.entries(value)) {
      if (id.length > 80 || !isPlainRecord(profile) || typeof profile.enabled !== 'boolean' || !isPlainRecord(profile.modes)) throw Error('角色分類設定格式不符');
      const modes = {};
      for (const cat of ['consumable', 'equipment', 'card', 'other']) {
        if (!['off', 'store', 'priority', 'valuable'].includes(profile.modes[cat])) throw Error('道具分類處理方式不符');
        modes[cat] = profile.modes[cat];
      }
      const usedMapToggle = typeof profile.currentMap === 'string' && /^[\w-]{1,80}$/.test(profile.currentMap);
      result[id] = { enabled: profile.enabled || usedMapToggle, modes };
    }
    return result;
  }
  // 讀取用：略過格式不符的角色項目，保留其他角色；寫入前仍以嚴格版驗證。
  function salvageCategoryProfiles(value) {
    if (!isPlainRecord(value)) throw Error('分類設定格式不符');
    const result = {};
    for (const [id, profile] of Object.entries(value).slice(0, 128)) {
      try { Object.assign(result, validateCategoryProfiles({ [id]: profile })); } catch { /* Preserve other valid profiles. */ }
    }
    return result;
  }
  function prepareBackupWrites(data) {
    checkDataTree(data);
    if (!isPlainRecord(data) || !['ro-idle-lean-backup', 'ro-idle-helper-backup'].includes(data.format)) throw Error('備份格式不符');
    if (data.version !== undefined && data.version !== 1) throw Error('不支援此備份版本');
    if (data.settings !== undefined && !isPlainRecord(data.settings)) throw Error('舊版設定格式不符');
    const settings = data.settings ?? {}, writes = [];
    const add = (key, value, validate, json = false) => {
      if (value === undefined) return;
      const validatedValue = validate(value);
      writes.push([key, json ? JSON.stringify(validatedValue) : validatedValue]);
    };
    // 相同資料若同時出現在新舊欄位，兩份都須有效，寫入順序沿用舊版優先規則。
    for (const value of [data.prefs, settings.ro_lean_prefs_v091]) add('ro_lean_prefs_v091', value, validatePrefs);
    for (const value of [data.words, settings.ro_custom_protect_words_v091]) add('ro_custom_protect_words_v091', value, validateWords);
    for (let value of [data.wh, settings['warehouse-helper-v1']]) {
      if (typeof value === 'string') value = JSON.parse(value);
      add('warehouse-helper-v1', value, validateWarehouse, true);
    }
    for (const value of [data.favs, settings['roi-favorites-v1']]) add('roi-favorites-v1', value, validateFavorites);
    for (const value of [data.priceOptions, settings['warehouse-auto-protect-v1']]) add('warehouse-auto-protect-v1', value, validatePriceOptions);
    for (const batch of [data.refineMaterialBatch, settings['roi-refine-material-batch-v1']]) {
      add('roi-refine-material-batch-v1', batch, validateMaterialBatch);
    }
    return [...new Map(writes)];
  }
  function commitBackupWrites(writes) {
    const originals = new Map(writes.map(([key]) => [key, GM_getValue(key, undefined)]));
    const changed = [];
    try {
      for (const [key, value] of writes) { changed.push(key); GM_setValue(key, value); }
    } catch (error) {
      const failed = [];
      for (const key of changed.reverse()) {
        try { GM_setValue(key, originals.get(key)); } catch { failed.push(key); }
      }
      throw Error(failed.length ? '寫入失敗且部分設定無法還原，請檢查儲存權限' : '寫入失敗，已還原原設定');
    }
  }
