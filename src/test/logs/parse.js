
  const rxRareDrop = /(?:卡片|稀有)!/;
  const rxDangerLog = /戰鬥不能|已經死亡|超過負重.*停止/;
  const rxDmgLog = /對\s+(.+?)\s+造成(?:\s+\d+\s*段)?\s+([\d,]+)\s*點傷害/;
  const rxTakenLog = /對你造成\s*([\d,]+)\s*點傷害/;
  const logBody = (text) => text.replace(/^\[\d{1,2}:\d{2}(?::\d{2})?\]\s*/, '');
  const logNumber = (value) => {
    const number = Number(value?.replace(/,/g, ''));
    return Number.isSafeInteger(number) && number > 0 ? number : 0;
  };

  function readOutgoingDamage(body) {
    const hit = body.match(rxDmgLog);
    const target = hit?.[1].trim().replace(/^(?:\[反擊\]|\[範圍\])+/, '');
    if (!target || /^(?:生命體|寵物)/.test(body) || /^(?:你|生命體)$/.test(target)) return null;
    const damage = logNumber(hit[2]);
    return damage ? { target, damage } : null;
  }

  function createCombatHitMeter(startedAt = Date.now()) {
    const encounterStart = /^(?:發現\s+.+\s+Lv\.\d+|.+\s+Lv\.\d+\s+主動朝你衝過來)/;
    const encounterEnd = /^成功擊敗\s+/;
    const interrupted = /^(?:正在搜尋附近的怪物|已搜尋\s+\d+\s*秒仍找不到怪物|引怪中|略過\s+.+繼續尋找目標|瞬間移動|返回存檔點|前往|抵達|移動到|掛機開始|掛機停止)|已經死亡|戰鬥不能/;
    let active = null, lastId = -1, elapsed = 0, hits = 0;
    function interrupt(at) {
      active = null;
      startedAt = at;
    }
    return {
      record(body, event, dealtDamage) {
        if (!Number.isSafeInteger(event?.id) || event.id <= lastId ||
            !Number.isFinite(event.wall) || event.wall < startedAt) return;
        if (encounterStart.test(body)) {
          if (!active || body.startsWith('發現')) active = { at: event.wall, hits: 0 };
        } else if (interrupted.test(body)) {
          active = null;
        } else if (active && encounterEnd.test(body)) {
          const duration = event.wall - active.at;
          if (active.hits > 0 && duration > 0) {
            elapsed += duration;
            hits += active.hits;
          }
          active = null;
        } else if (active && dealtDamage && event.wall >= active.at) {
          active.hits++;
        } else return;
        lastId = event.id;
      },
      interrupt,
      reset(at = Date.now()) {
        interrupt(at);
        lastId = -1;
        elapsed = hits = 0;
      },
      get rate() { return elapsed ? hits * 1000 / elapsed : null; }
    };
  }
  const combatHitMeter = createCombatHitMeter();

  const mvpBattleHistory = new Map();
  const mvpHistoryLimit = 150;

  function classifyMvpLog(text, isKnownBoss) {
    const body = logBody(text);
    let match;
    if ((match = body.match(/^★\s*MVP!打倒了\s+(.+?):\s*MVP 經驗/))) {
      return { boss: clean(match[1]), kind: 'battle', hasLoot: body.includes('MVP 獎勵') };
    }
    if ((match = body.match(/^★?\s*(?:【MVP】|\[MVP\])你的隊伍在 .+? 搶到了 (.+?)!/))) {
      return { boss: clean(match[1]), kind: 'battle', hasLoot: /[,，]\s*獲得 /.test(body) };
    }
    if ((match = body.match(/^(?:【MVP】|\[MVP\]).+? 的 (.+?) 被別的隊伍搶走了/))) {
      return { boss: clean(match[1]), kind: 'battle', hasLoot: /[,，]\s*獲得 /.test(body) };
    }
    match = body.match(/^成功擊敗 (.+?)!$/);
    if (match && isKnownBoss(clean(match[1]))) return { boss: clean(match[1]), kind: 'battle', hasLoot: false };
    match = body.match(/^(?:\[隊伍分配\]\s*(?:.+? 擊敗的 )?)?(.+?) 掉落了(?:卡片[:：]|\s)/)
      || body.match(/^(?:◆◆ 撿到卡片:|◆ 稀有掉落!撿到).+?\(([^()]+)\)(?:\(必撿.*?\))?[。.!]*$/);
    if (match && isKnownBoss(clean(match[1]))) return { boss: clean(match[1]), kind: 'loot', hasLoot: true };
    return null;
  }

  function recordMvpLog(text, characterId, eventId) {
    if (!Number.isSafeInteger(characterId) || characterId <= 0) return;
    const known = name => mvpRadar?.isKnownBoss(name) ?? false;
    const body = logBody(text);
    const entry = classifyMvpLog(text, known);
    const hit = entry ? null : readOutgoingDamage(body);
    const taken = entry || hit ? null : body.match(/^(.+?)(?: 使用[^,，]+[,，])?\s*對你造成\s*([\d,]+)\s*點傷害/);
    const boss = entry?.boss ?? hit?.target ?? taken?.[1];
    if (!boss || boss.length > 80 || (!entry && !known(boss))) return;
    let history = mvpBattleHistory.get(characterId);
    if (!history) {
      if (mvpBattleHistory.size >= 12) mvpBattleHistory.delete(mvpBattleHistory.keys().next().value);
      history = { entries: [], seen: new Set(), combat: new Map(), rev: 0 };
      mvpBattleHistory.set(characterId, history);
    }
    if (eventId && history.seen.has(eventId)) return;
    if (eventId) {
      history.seen.add(eventId);
      if (history.seen.size > 600) history.seen.delete(history.seen.values().next().value);
    }
    if (entry) {
      history.entries.unshift({ ...entry, text: text.slice(0, 600) });
      if (history.entries.length > mvpHistoryLimit) history.entries.pop();
    } else {
      const summary = history.combat.get(boss) ?? { damage: 0, hits: 0, taken: 0 };
      if (hit) {
        summary.damage += hit.damage;
        summary.hits++;
      } else {
        summary.taken += logNumber(taken[2]);
      }
      history.combat.set(boss, summary);
    }
    history.rev++;
  }
  const rxExpLog = /獲得\s*Base EXP\s*([\d,]+)(?:\s*\(\s*\d+(?:\.\d+)?\s*%\s*\))?\s*\/\s*Job EXP\s*([\d,]+)/;
  const rxLootLog = /撿取物品\s*[:：]\s*(.+?)\s*[×xX*]\s*(\d+)/;
  function parseLog(t, historical = false, combatEvent = null) {
    if (state.paused) return;
    if (!historical) {
      const body = logBody(t);
      const damage = readOutgoingDamage(body)?.damage ?? 0;
      combatHitMeter.record(body, combatEvent, damage > 0);
      if (damage) {
        state.dmgSum += damage;
        state.hits++;
        state.maxDmg = Math.max(state.maxDmg, damage);
      }
      state.damageTaken += logNumber(body.match(rxTakenLog)?.[1]);
    }
    if (t.includes('成功擊敗')) state.kills++;
    const em = t.match(rxExpLog);
    if (em) { state.bexp += parseInt(em[1].replace(/,/g, ''), 10) || 0; state.jexp += parseInt(em[2].replace(/,/g, ''), 10) || 0; }
    const lm = t.match(rxLootLog);
    if (lm) {
      const name = lm[1].trim(), q = parseInt(lm[2], 10) || 1;
      state.pickupQty += q;
      state.loot[name] = (state.loot[name] || 0) + q;
      state.lootRev++;
    }
    if (t.includes('沒有撿起的物品消失了')) state.missed++;
  }
