
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
      for (const drop of [...(monster.drops ?? []), monster.card, ...(monster.mvpDrops ?? [])]) {
        const item = pack.items.get(drop?.itemId);
        if (item) loot.set(item.id, item.name);
      }
    }
    return loot;
  }

  const lootSyncPanels = new WeakMap();
  const lootModes = ['off', 'store', 'valuable'];
  const lootOres = new Set([984, 985, 756, 757, 1010, 1011]);
  const isValuableLoot = (id, name = '') => classifyItem(id, name).cat === 'card' || lootOres.has(id)
    || state.whMarks[id] === 'lock' || state.customProtectWords.some((word) => word && name.includes(word));

  const lootCategoryLabels = { consumable: '消耗品', equipment: '裝備', card: '卡片', other: '其他' };
  const lootCategoryModes = {
    off: '保留原設定', store: '全部存倉', priority: '優先撿取＋存倉', valuable: '僅貴重物優先撿取＋存倉'
  };
  const categorySyncByCharacter = new Map();

  function lootCategory(id, name, pack) {
    const item = pack.items.get(id);
    if (item?.category === 'card') return 'card';
    if (item?.category === 'equipment') return 'equipment';
    if (item?.category === 'consumable') return 'consumable';
    const cat = classifyItem(id, name).cat;
    return cat === 'weapon' || cat === 'armor' ? 'equipment'
      : cat === 'card' || cat === 'consumable' ? cat : 'other';
  }

  function buildCategoryLootPatch(draft, loot, pack, modes, previous) {
    const storage = storageRule(draft.autoStorage);
    const priority = listItems(draft.lootPriority);
    const storageBase = storage.items.filter((id) => !previous?.storage.has(id));
    const priorityBase = priority.filter((id) => !previous?.priority.has(id));
    const stored = new Set(), prioritized = new Set();
    const supplies = lootSupplyIds(draft);
    const counts = Object.fromEntries(Object.keys(lootCategoryLabels).map((cat) => [cat, 0]));
    for (const [id, name] of loot) {
      const category = lootCategory(id, name, pack);
      const mode = modes[category];
      if (mode === 'off' || !Object.hasOwn(lootCategoryModes, mode)) continue;
      if (mode === 'valuable' && !isValuableLoot(id, name)) continue;
      // 沿用既有補品、補給排除規則。
      if (supplies.has(id)) continue;
      counts[category]++;
      stored.add(id);
      if (mode === 'priority' || mode === 'valuable') prioritized.add(id);
    }
    const storageItems = [...new Set([...storageBase, ...stored])];
    const priorityItems = [...new Set([...priorityBase, ...prioritized])];
    if (storageItems.length > 2000 || priorityItems.length > 500) {
      throw Error('分類設定會超過存倉或優先撿取上限，請縮小範圍');
    }
    const patch = {};
    if (stored.size || JSON.stringify(storageItems) !== JSON.stringify(storage.items)) {
      patch.autoStorage = { ...storage, ...(stored.size ? { enabled: true } : {}), items: storageItems };
    }
    if (prioritized.size || JSON.stringify(priorityItems) !== JSON.stringify(priority)) {
      patch.lootPriority = { ...(draft.lootPriority?.rare ? { rare: true } : {}), items: priorityItems };
    }
    if (stored.size) {
      patch.autoLoot = true;
      patch.autoSell = itemIds(draft.autoSell).filter((id) => !stored.has(id));
    }
    return {
      patch, counts,
      tracked: {
        storage: new Set([...stored].filter((id) => !storageBase.includes(id))),
        priority: new Set([...prioritized].filter((id) => !priorityBase.includes(id)))
      }
    };
  }

  function mountSettingsTools() {
    const itemGroup = document.querySelector('[role="group"][aria-label="道具設定的複製與匯出匯入"]');
    if (itemGroup && !itemGroup.querySelector('[data-roi-settings-tools]')) {
      const box = document.createElement('div');
      box.dataset.roiSettingsTools = '';
      box.style.cssText = 'flex-basis:100%;display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-top:6px;padding:6px 10px;background:linear-gradient(90deg,rgba(30,41,59,0.9),rgba(15,23,42,0.75));border-left:3px solid #38bdf8;border-radius:6px;font-size:11.5px;box-shadow:0 2px 8px rgba(0,0,0,0.3);';
      const status = document.createElement('span'); status.style.color = '#4ade80';
      box.style.display = 'grid';
      box.style.gridTemplateColumns = 'minmax(56px,auto) minmax(0,1fr) auto';
      box.style.width = '100%';
      box.style.boxSizing = 'border-box';
      const getProps = () => {
        const p = getCommittedProps(itemGroup, (x) => typeof x.update === 'function' && x.draft && x.snap?.character);
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
      const saveSettings = () => {
        const all = readValidatedSetting(settingsKey, salvageCategoryProfiles, {});
        const next = plainObject(all) ? { ...all } : {};
        next[boundCharacter] = preferences;
        GM_setValue(settingsKey, validateCategoryProfiles(next));
      };
      const sync = async (automatic = false) => {
        let pendingKey = null;
        try {
          const before = getProps();
          bindCharacter(before);
          const id = boundCharacter, mapId = before.draft.lockMap;
          const modes = { ...preferences.modes };
          pendingKey = JSON.stringify([id, mapId, modes, preferences.enabled]);
          if (automatic && (!preferences.enabled || pendingKey === lastAutoKey)) return;
          const token = ++request;
          lastAutoKey = pendingKey;
          status.textContent = '讀取本圖掉落…';
          const pack = await loadLootPack();
          if (token !== request || !itemGroup.isConnected) return;
          const current = getProps();
          if (characterKey(current) !== id || current.draft.lockMap !== mapId) {
            lastAutoKey = null;
            return;
          }
          const loot = getMapLoot(pack, mapId);
          const result = buildCategoryLootPatch(current.draft, loot, pack, modes, categorySyncByCharacter.get(id));
          if (Object.keys(result.patch).length) current.update(result.patch);
          categorySyncByCharacter.set(id, result.tracked);
          for (const [cat, count] of Object.entries(result.counts)) counters.get(cat).textContent = count + ' 種';
          status.textContent = Object.keys(result.patch).length ? '已更新草稿，請按「套用設定」' : '分類設定已同步';
        } catch (error) {
          if (pendingKey === lastAutoKey) lastAutoKey = null;
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
            preferences.modes[cat] = select.value;
            saveSettings(); lastAutoKey = null; request++;
            if (preferences.enabled) void sync(true);
            else status.textContent = '設定已記住，按「設定本圖」寫入草稿';
          } catch (error) { status.textContent = '⚠️ ' + error.message; }
        };
      }
      const syncNow = element('button', '設定本圖');
      syncNow.type = 'button'; syncNow.className = 'xp-btn small';
      syncNow.onclick = () => { void sync(); };
      auto.onchange = () => {
        try {
          const p = getProps();
          if (characterKey(p) !== boundCharacter) { bindCharacter(p); return; }
          preferences.enabled = auto.checked;
          saveSettings(); lastAutoKey = null; request++;
          if (preferences.enabled) void sync(true);
          else status.textContent = '已關閉自動設定';
        } catch (error) { status.textContent = '⚠️ ' + error.message; }
      };
      const note = element('span', '依本圖掉落設定；已指定的補品與補給會排除。', 'grid-column:1 / -1;color:var(--text-dim)');
      status.style.gridColumn = '2 / -1';
      box.append(note, syncNow, status);
      const tick = () => {
        try {
          bindCharacter(getProps());
          if (preferences.enabled) void sync(true);
        } catch (error) { if (!(error instanceof FiberTraversalTimeout)) auto.disabled = true; }
      };
      lootSyncPanels.set(itemGroup, tick);
      itemGroup.append(box);
    }
    lootSyncPanels.get(itemGroup)?.();

    const monSel = document.querySelector('select[aria-label="怪物控制：加入怪物"]');
    const monHost = monSel?.parentElement;
    const liveMonsterSelect = () => monHost?.querySelector('select[aria-label="怪物控制：加入怪物"]');
    const monsterDraft = () => getCommittedProps(liveMonsterSelect(), (x) => typeof x.update === 'function' && x.draft?.targets && x.draft?.escape);
    const mapMonsterIds = () => {
      const fromProps = getCommittedProps(liveMonsterSelect(), (x) => Array.isArray(x.mapMonsters) || Array.isArray(x.monsterIds));
      const raw = fromProps?.mapMonsters || fromProps?.monsterIds
        || findRareRoots().map((root) => getRareContext(root)?.p.monsterIds).find(Array.isArray);
      return raw && [...new Set(raw.map((m) => Number(typeof m === 'object' ? m.id ?? m.monsterId : m)))]
        .filter((id) => Number.isSafeInteger(id) && id > 0);
    };
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
      addBtn('🔄 同步本圖怪物', () => {
        const status = monHost.querySelector('[data-roi-mon-status]') || document.createElement('span');
        status.dataset.roiMonStatus = '';
        if (!status.isConnected) monHost.append(status);
        const p = monsterDraft(), ids = mapMonsterIds();
        if (!p || !ids) { status.textContent = '無法讀取本圖怪物清單或設定草稿，請重新開啟掛機設定'; return; }
        if (!ids.length) { status.textContent = '目前地圖沒有可同步的怪物'; return; }
        const current = readMonsterRules(p.draft);
        const oldById = new Map(current.map((rule) => [Number(rule.monsterId), rule]));
        const rules = ids.map((id) => oldById.get(id) || { monsterId: id, action: 'attack' });
        if (rules.length > 200) { status.textContent = '本圖怪物超過 200 隻，無法同步'; return; }
        p.update({
          monsterRules: rules,
          targets: { ...p.draft.targets, blacklist: [] },
          escape: { ...p.draft.escape, dangerMonsters: [] }
        });
        status.textContent = '已同步本圖 ' + rules.length + ' 隻怪物，請按套用設定';
      });
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
  }

  const refSelected = new Set();
