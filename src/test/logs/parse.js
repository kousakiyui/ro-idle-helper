
  const rxRareDrop = /(?:卡片|稀有)!/;
  const rxDangerLog = /戰鬥不能|已經死亡|超過負重.*停止/;
  const rxDmgLog = /造成\s*([\d,]+)\s*點傷害/;
  const rxExpLog = /獲得\s*Base EXP\s*([\d,]+)(?:\s*\(\s*\d+(?:\.\d+)?\s*%\s*\))?\s*\/\s*Job EXP\s*([\d,]+)/;
  const rxLootLog = /撿取物品\s*[:：]\s*(.+?)\s*[×xX*]\s*(\d+)/;
  function parseLog(t) {
    if (state.paused) return;
    const dm = t.match(rxDmgLog);
    if (dm) { const v = parseInt(dm[1].replace(/,/g, ''), 10); if (v) { state.dmgSum += v; state.hits++; if (v > state.maxDmg) state.maxDmg = v; } }
    if (t.includes('成功擊敗')) state.kills++;
    const em = t.match(rxExpLog);
    if (em) { state.bexp += parseInt(em[1].replace(/,/g, ''), 10) || 0; state.jexp += parseInt(em[2].replace(/,/g, ''), 10) || 0; }
    const lm = t.match(rxLootLog);
    if (lm) {
      const name = lm[1].trim(), q = parseInt(lm[2], 10) || 1;
      state.loot[name] = (state.loot[name] || 0) + q;
      state.lootRev++;
    }
    if (t.includes('沒有撿起的物品消失了')) state.missed++;
  }
