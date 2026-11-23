
  function readMonsterRules(draft) {
    const { monsterRules = [], targets, escape } = draft;
    const rules = monsterRules.map((rule) => ({ ...rule }));
    const ids = new Set(rules.map((rule) => rule.monsterId));
    for (const [list, action] of [[targets.blacklist, 'defend'], [escape.dangerMonsters, 'attack']]) {
      for (const monsterId of list) {
        if (ids.has(monsterId)) continue;
        ids.add(monsterId);
        rules.push(action === 'defend' ? { monsterId, action } : { monsterId, action, escape: 'sight' });
      }
    }
    return rules;
  }

  const itemIds = (list) => Array.isArray(list)
    ? [...new Set(list.map((item) => Number(item?.itemId ?? item?.id ?? item)).filter((id) => Number.isSafeInteger(id) && id > 0))]
    : [];
  const listItems = (rule) => itemIds(Array.isArray(rule) ? rule : rule?.items);
  const storageRule = (rule) => ({
    enabled: false, abovePercent: 70, ...(Array.isArray(rule) ? {} : rule), items: listItems(rule)
  });

  function lootSupplyIds(draft) {
    return new Set([
      ...itemIds(draft.restock), ...itemIds(draft.townBuy), ...itemIds(draft.cureItems),
      ...itemIds(draft.autoBuy?.potions), ...itemIds(draft.autoBuy?.gems), ...itemIds([draft.autoBuy?.arrows?.itemId]),
      ...[draft.hpPotion, draft.spPotion, draft.buffPotion].flatMap((rule) => [...listItems(rule), ...itemIds([rule?.itemId])])
    ]);
  }

  let lootPack;
  let PACK_ITEMS_MAP = null;
  function ensurePackItemsLoaded() {
    if (PACK_ITEMS_MAP) return;
    try { void loadLootPack().catch(() => log("loot", "無法預載掉落資料")); } catch { log("loot", "無法開始預載掉落資料"); }
  }
  function loadLootPack() {
    const link = document.querySelector('link[rel="modulepreload"][href^="/assets/pack-"]');
    if (!link) throw Error('找不到遊戲的地圖資料');
    lootPack ??= import(link.href).then((module) => {
      const pack = Object.values(module).find((value) => Array.isArray(value?.maps) && Array.isArray(value.monsters) && Array.isArray(value.items));
      if (!pack) throw Error('無法辨識遊戲的地圖資料');
      const itemsMap = new Map(pack.items.map((item) => [item.id, item]));
      PACK_ITEMS_MAP = itemsMap;
      for (const it of pack.items) {
        if (it?.id && it.name && !ITEM_NAME_CACHE.has(it.id)) ITEM_NAME_CACHE.set(it.id, clean(it.name));
      }
      return {
        maps: new Map(pack.maps.map((map) => [map.id, map])),
        monsters: new Map([...(pack.summons ?? []), ...pack.monsters].map((monster) => [monster.id, monster])),
        items: itemsMap,
        refine: pack.refine
      };
    }).catch((error) => { lootPack = null; throw error; });
    return lootPack;
  }

  function getMapLoot(pack, mapId) {
    const map = pack.maps.get(mapId);
    if (!map || !Array.isArray(map.spawns)) throw Error('找不到目前掛機地圖的掉落資料');
    const pending = [...map.spawns, ...(map.timed ?? [])].map((spawn) => spawn.monsterId);
    const seen = new Set(), loot = new Map();
    for (const id of pending) {
      if (seen.has(id)) continue;
      seen.add(id);
      const monster = pack.monsters.get(id);
      if (!monster) continue;
      for (const skill of monster.skills ?? []) {
        if (skill.skill === 'NPC_METAMORPHOSIS') pending.push(...(skill.vals ?? []));
      }
      // 道具設定的「本圖掉落」使用怪物的一般掉落清單。
      for (const drop of monster.drops ?? []) {
        const item = pack.items.get(drop?.itemId);
        if (item) loot.set(item.id, item.name);
      }
    }
    return loot;
  }

  const lootSyncPanels = new WeakMap();
  const lootItemGroupSelector = '[role="group"][aria-label="道具設定的複製與匯出匯入"]';
  const lootOpenKoreSelector = '[role="tablist"][aria-label="OpenKore 設定檔"]';
  const monsterSyncPanels = new WeakMap();
  const monsterSelectSelector = 'select[aria-label="怪物控制：加入怪物"]';
  const monsterSyncModes = {
    off: '關閉自動同步',
    add: '自動新增本地圖怪物',
    replace: '自動換成只有本地圖怪物'
  };
  const lootModes = ['off', 'store', 'valuable'];
  const lootOres = new Set([984, 985, 756, 757, 1010, 1011]);
  const isValuableLoot = (id, name = '') => classifyItem(id, name).cat === 'card' || lootOres.has(id)
    || state.whMarks[id] === 'lock' || state.customProtectWords.some((word) => word && name.includes(word));

  const lootCategoryLabels = { consumable: '消耗品', equipment: '裝備', card: '卡片', other: '其他' };
  const lootCategoryModes = {
    off: '保留原設定', store: '全部存倉', priority: '優先撿取＋存倉', valuable: '僅貴重物優先撿取＋存倉'
  };

  function lootCategory(id, name, pack) {
    const item = pack.items.get(id);
    if (item?.category === 'card') return 'card';
    if (item?.category === 'equipment') return 'equipment';
    if (item?.category === 'consumable') return 'consumable';
    const cat = classifyItem(id, name).cat;
    return cat === 'weapon' || cat === 'armor' ? 'equipment'
      : cat === 'card' || cat === 'consumable' ? cat : 'other';
  }

  function buildCategoryLootPatch(draft, loot, pack, modes) {
    const storage = storageRule(draft.autoStorage);
    const priority = listItems(draft.lootPriority);
    const configured = new Set([
      ...storage.items, ...priority, ...listItems(draft.autoSell), ...listItems(draft.lootFilter),
      ...lootSupplyIds(draft)
    ]);
    const stored = [], prioritized = [];
    const counts = Object.fromEntries(Object.keys(lootCategoryLabels).map((cat) => [cat, 0]));
    let preserved = 0;
    for (const [id, name] of loot) {
      const category = lootCategory(id, name, pack);
      const mode = modes[category];
      if (mode === 'off' || !Object.hasOwn(lootCategoryModes, mode)) continue;
      if (mode === 'valuable' && !isValuableLoot(id, name)) continue;
      if (configured.has(id)) {
        preserved++;
        continue;
      }
      counts[category]++;
      stored.push(id);
      if (mode === 'priority' || mode === 'valuable') prioritized.push(id);
    }
    if ((stored.length && storage.items.length + stored.length > 2000)
      || (prioritized.length && priority.length + prioritized.length > 500)) {
      throw Error('分類設定會超過存倉或優先撿取上限，請縮小範圍');
    }
    const patch = {};
    if (stored.length) {
      patch.autoStorage = { ...storage, items: [...storage.items, ...stored] };
    }
    if (prioritized.length) {
      const rule = draft.lootPriority;
      patch.lootPriority = { ...(Array.isArray(rule) ? {} : rule), items: [...priority, ...prioritized] };
    }
    return { patch, counts, added: stored.length, preserved };
  }

  function readOpenKoreSection(anchor, title, match) {
    if (!anchor) return null;
    const section = (props) => Array.isArray(props?.children) && props.children
      .find((child) => child?.props?.title === title)?.props.children?.props;
    return section(getCommittedProps(anchor, (props) => match(section(props))));
  }

  const isMonsterDraft = (props) => typeof props?.update === 'function' && props.draft?.targets && props.draft?.escape;

  function buildMonsterSyncPatch(draft, ids, mode) {
    if (!ids.length) return { message: '目前地圖沒有可同步的怪物，草稿未變更' };
    const rules = readMonsterRules(draft);
    const mapIds = new Set(ids);
    const retained = mode === 'replace' ? rules.filter((rule) => mapIds.has(Number(rule.monsterId))) : rules;
    const existing = new Set(retained.map((rule) => Number(rule.monsterId)));
    const missing = ids.filter((id) => !existing.has(id));
    const removed = rules.length - retained.length;
    if (!missing.length && !removed) return { message: '本圖怪物都已設定，草稿未變更' };
    if (retained.length + missing.length > 200) {
      return { message: '同步會超過 200 隻上限，草稿未變更' };
    }
    return {
      patch: {
        monsterRules: [...retained, ...missing.map((monsterId) => ({ monsterId, action: 'attack' }))],
        targets: { ...draft.targets, blacklist: [] },
        escape: { ...draft.escape, dangerMonsters: [] }
      },
      message: `新增 ${missing.length} 隻，保留 ${retained.length} 隻${removed ? `，移除 ${removed} 隻非本圖怪物` : ''}，請按「套用設定」`
    };
  }

  function createMonsterSyncPanel(anchor, openKore) {
    const select = element('select');
    select.className = 'xp-input';
    select.dataset.roiMonMode = '';
    select.disabled = true;
    for (const [value, text] of Object.entries(monsterSyncModes)) {
      const option = element('option', text);
      option.value = value;
      select.append(option);
    }
    const label = element('label', '同步本圖怪物 ');
    label.append(select);
    const status = element('span');
    status.dataset.roiMonStatus = '';
    status.setAttribute('role', 'status');
    const validateMode = (value) => {
      if (typeof value === 'boolean') return value ? 'add' : 'off';
      if (typeof value !== 'string' || !Object.hasOwn(monsterSyncModes, value)) throw Error('怪物同步模式格式不符');
      return value;
    };
    const settingKey = (id) => 'roi-monster-auto-map-v1:' + id;
    const target = () => openKore ?? anchor.querySelector(monsterSelectSelector);
    const readActor = (node) => {
      const context = node && getCommittedProps(node, (props) => props.snap?.character &&
        (positiveId(props.characterId) || snapshotCharacterId(props.snap)));
      return positiveId(context?.characterId) || snapshotCharacterId(context?.snap);
    };
    let boundId = null, mode = 'off', lastMap = null;
    const sync = (node) => {
      if (!node || mode === 'off' || document.hidden) return;
      const props = readOpenKoreSection(openKore, '怪物控制', isMonsterDraft) ||
        getCommittedProps(node, isMonsterDraft);
      const map = props?.draft.lockMap;
      if (!map || map === lastMap) return;
      const raw = props.mapMonsters;
      const ids = Array.isArray(raw) && raw.map((entry) => positiveId(entry?.id ?? entry?.monsterId ?? entry));
      if (!ids || ids.includes(null)) {
        if (status.textContent !== '無法確認本圖怪物清單，草稿未變更') status.textContent = '無法確認本圖怪物清單，草稿未變更';
        return;
      }
      const { message, patch } = buildMonsterSyncPatch(props.draft, [...new Set(ids)], mode);
      if (patch) props.update(patch);
      lastMap = map;
      status.textContent = message;
      return patch ? 'updated' : undefined;
    };
    const tick = (host) => {
      if (host && label.parentElement !== host) host.prepend(label, status);
      try {
        const node = target();
        const id = readActor(node);
        select.disabled = id === null;
        if (id !== boundId) {
          boundId = id;
          mode = id === null ? 'off' : readValidatedSetting(settingKey(id), validateMode, 'off');
          select.value = mode;
          lastMap = null;
          status.textContent = '';
        }
        if (id === null && host && !status.textContent) status.textContent = '尚未讀到正在編輯的角色';
        return sync(node);
      } catch (error) {
        if (!(error instanceof FiberTraversalTimeout)) log('monster', error);
      }
    };
    select.onchange = () => {
      try {
        const node = target();
        const id = readActor(node);
        if (id === null || id !== boundId) { tick(); return; }
        const next = validateMode(select.value);
        GM_setValue(settingKey(id), next);
        mode = next;
        lastMap = null;
        if (mode === 'off') status.textContent = '已關閉怪物自動同步';
        else sync(node);
      } catch (error) {
        select.value = mode;
        status.textContent = error.message;
      }
    };
    return tick;
  }

  function mountSettingsTools() {
    const itemGroup = document.querySelector(lootItemGroupSelector);
    const openKore = document.querySelector(lootOpenKoreSelector);
    const lootAnchor = openKore ?? itemGroup;
    if (lootAnchor && !lootSyncPanels.has(lootAnchor)) {
      const box = document.createElement('div');
      box.dataset.roiSettingsTools = '';
      box.style.cssText = 'flex-basis:100%;display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-top:6px;padding:6px 10px;background:linear-gradient(90deg,rgba(30,41,59,0.9),rgba(15,23,42,0.75));border-left:3px solid #38bdf8;border-radius:6px;font-size:11.5px;box-shadow:0 2px 8px rgba(0,0,0,0.3);';
      const status = document.createElement('span'); status.style.color = '#4ade80';
      box.style.display = 'grid';
      box.style.gridTemplateColumns = 'minmax(56px,auto) minmax(0,1fr) auto';
      box.style.width = '100%';
      box.style.boxSizing = 'border-box';
      const isDraft = (x) => typeof x?.update === 'function' && x.draft && x.snap?.character;
      const getProps = () => {
        // OpenKore 切離道具頁時會卸載面板，設定容器仍持有這一版草稿的道具區 props。
        const section = readOpenKoreSection(openKore, '道具設定', isDraft);
        const group = openKore ? document.querySelector(lootItemGroupSelector) : lootAnchor;
        const p = section || (group && getCommittedProps(group, isDraft));
        if (!p) throw Error('無法讀取設定草稿');
        return p;
      };
      const settingsKey = 'roi-loot-category-map-v1';
      const selects = new Map(), counters = new Map();
      const auto = element('input');
      auto.type = 'checkbox';
      auto.dataset.roiLootAuto = '';
      auto.disabled = true;
      const autoLabel = element('label', '隨地圖自動設定 ');
      autoLabel.style.gridColumn = '1 / -1';
      autoLabel.prepend(auto);
      box.append(autoLabel);
      let boundCharacter = null, preferences = null, lastAutoKey = null, request = 0;
      const characterKey = (p) => String(p.snap.character.id ?? p.snap.character.name);
      const getPreferences = (key) => {
        const all = readValidatedSetting(settingsKey, validateCategoryProfiles, {});
        const saved = plainObject(all) && plainObject(all[key]) ? all[key] : null;
        const legacy = GM_getValue('roi-loot-auto-map', 'off');
        const legacyMode = lootModes.includes(legacy) ? legacy : 'off';
        const modes = Object.fromEntries(Object.keys(lootCategoryLabels).map((cat) => [
          cat, saved && Object.hasOwn(lootCategoryModes, saved.modes?.[cat]) ? saved.modes[cat] : legacyMode
        ]));
        return { enabled: saved ? saved.enabled === true : legacyMode !== 'off', modes };
      };
      const bindCharacter = (p) => {
        const key = characterKey(p);
        auto.disabled = false;
        if (boundCharacter === key) return;
        boundCharacter = key;
        preferences = getPreferences(key);
        auto.checked = preferences.enabled;
        for (const [cat, select] of selects) select.value = preferences.modes[cat];
        for (const counter of counters.values()) counter.textContent = '—';
        lastAutoKey = null;
        request++;
      };
      const saveSettings = (prefs) => {
        const all = readValidatedSetting(settingsKey, salvageCategoryProfiles, {});
        const next = plainObject(all) ? { ...all } : {};
        next[boundCharacter] = prefs;
        GM_setValue(settingsKey, validateCategoryProfiles(next));
        preferences = prefs;
        lastAutoKey = null;
        request++;
      };
      const sync = async (before) => {
        let pendingKey = null, token = null;
        try {
          const id = boundCharacter, mapId = before.draft.lockMap;
          const modes = { ...preferences.modes };
          pendingKey = JSON.stringify([id, mapId, modes]);
          if (!preferences.enabled || !mapId || pendingKey === lastAutoKey) return;
          token = ++request;
          lastAutoKey = pendingKey;
          status.textContent = '讀取本圖掉落…';
          const pack = await loadLootPack();
          if (token !== request || !lootAnchor.isConnected) return;
          const current = getProps();
          if (characterKey(current) !== id || current.draft.lockMap !== mapId) {
            lastAutoKey = null;
            return;
          }
          const loot = getMapLoot(pack, mapId);
          const result = buildCategoryLootPatch(current.draft, loot, pack, modes);
          if (result.added) current.update(result.patch);
          for (const [cat, count] of Object.entries(result.counts)) counters.get(cat).textContent = count + ' 種';
          const summary = `新增 ${result.added} 種，保留既有設定 ${result.preserved} 種`;
          const storageNote = result.patch.autoStorage?.enabled === false ? '（回城存倉目前關閉）' : '';
          status.textContent = result.added ? summary + '，請按「套用設定」' + storageNote : summary;
        } catch (error) {
          if (token !== null && (token !== request || !lootAnchor.isConnected)) return;
          if (error instanceof FiberTraversalTimeout && pendingKey === lastAutoKey) lastAutoKey = null;
          status.textContent = '⚠️ ' + error.message;
        }
      };
      for (const [cat, label] of Object.entries(lootCategoryLabels)) {
        const select = element('select');
        select.className = 'xp-input';
        select.style.cssText = 'width:100%;min-width:0;max-width:100%';
        select.setAttribute('aria-label', label + '自動設定');
        for (const [value, text] of Object.entries(lootCategoryModes)) {
          const option = element('option', text); option.value = value; select.append(option);
        }
        const counter = element('span', '—', 'white-space:nowrap;color:var(--text-dim)');
        counters.set(cat, counter); selects.set(cat, select);
        const categoryLabel = element('label', label);
        select.id = 'roi-loot-category-' + cat;
        categoryLabel.htmlFor = select.id;
        box.append(categoryLabel, select, counter);
        select.onchange = () => {
          try {
            const p = getProps();
            if (characterKey(p) !== boundCharacter) { bindCharacter(p); return; }
            saveSettings({ ...preferences, modes: { ...preferences.modes, [cat]: select.value } });
            if (preferences.enabled) void sync(p);
          } catch (error) {
            select.value = preferences.modes[cat];
            status.textContent = '⚠️ ' + error.message;
          }
        };
      }
      auto.onchange = () => {
        try {
          const p = getProps();
          if (characterKey(p) !== boundCharacter) { bindCharacter(p); return; }
          saveSettings({ ...preferences, enabled: auto.checked });
          if (preferences.enabled) void sync(p);
          else status.textContent = '已關閉自動設定';
        } catch (error) {
          auto.checked = preferences?.enabled === true;
          status.textContent = '⚠️ ' + error.message;
        }
      };
      const note = element('span', '只設定本圖掉落中尚未設定的道具。', 'grid-column:1 / -1;color:var(--text-dim)');
      status.style.gridColumn = '1 / -1';
      box.append(note, status);
      const tick = (group) => {
        if (group && box.parentElement !== group) group.append(box);
        try {
          const p = getProps();
          bindCharacter(p);
          if (preferences.enabled) void sync(p);
        } catch (error) {
          if (!(error instanceof FiberTraversalTimeout)) auto.disabled = true;
        }
      };
      lootSyncPanels.set(lootAnchor, tick);
    }

    const monSel = document.querySelector(monsterSelectSelector);
    const monHost = monSel?.parentElement;
    const monAnchor = openKore ?? monHost;
    const monsterDraft = () => getCommittedProps(monHost?.querySelector(monsterSelectSelector), isMonsterDraft);
    if (monHost) {
      const addBtn = (txt, fn) => {
        let b = [...monHost.querySelectorAll('[data-roi-mon-btn]')].find((button) => button.textContent === txt);
        if (!b) {
          b = document.createElement('button'); b.type = 'button'; b.className = 'xp-btn small';
          b.dataset.roiMonBtn = ''; b.textContent = txt; monHost.append(b);
        }
        b.onclick = () => {
          try { fn(); }
          catch (error) {
            if (!(error instanceof FiberTraversalTimeout)) throw error;
            const status = monHost.querySelector('[data-roi-mon-status]') || element('span');
            status.dataset.roiMonStatus = '';
            status.textContent = error.message;
            if (!status.isConnected) monHost.append(status);
          }
        };
      };
      addBtn('不逃 ⇄ 看到就逃', () => {
        const p = monsterDraft();
        if (!p) { const status = monHost.querySelector('[data-roi-mon-status]'); if (status) status.textContent = '⚠️ 無法讀取怪物設定草稿'; return; }
        const { targets, escape } = p.draft;
        const rules = readMonsterRules(p.draft);
        if (!rules.length) return;
        const turnOff = rules.every((rule) => rule.escape === 'sight');
        for (const rule of rules) {
          if (turnOff) delete rule.escape;
          else rule.escape = 'sight';
        }
        p.update({ monsterRules: rules, targets: { ...targets, blacklist: [] }, escape: { ...escape, dangerMonsters: [] } });
      });
      addBtn('⚡ 引怪 ⇄ 主動打', () => {
        const p = monsterDraft();
        if (!p?.draft.monsterRules?.length) { const status = monHost.querySelector('[data-roi-mon-status]'); if (status) status.textContent = '⚠️ 請先加入怪物'; return; }
        const allLure = p.draft.monsterRules.every((r) => r.action === 'lure');
        p.update({ monsterRules: p.draft.monsterRules.map((r) => ({ ...r, action: allLure ? 'attack' : 'lure' })) });
      });
    }
    if (monAnchor && !monsterSyncPanels.has(monAnchor)) {
      monsterSyncPanels.set(monAnchor, createMonsterSyncPanel(monAnchor, openKore));
    }
    // 怪物自動同步也會更新同一份草稿，等原生提交這次變動後再補道具。
    if (monsterSyncPanels.get(monAnchor)?.(monHost) !== 'updated') lootSyncPanels.get(lootAnchor)?.(itemGroup);
  }

  const refSelected = new Set();
