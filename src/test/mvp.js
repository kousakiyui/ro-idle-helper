
  // MVP 雷達（個人 MVP 時刻表）：融入儀表盤頂部與分頁，點選視窗外畫面自動關閉（儀表盤保留）
  function createMvpSchedule() {
    const schedules = {"俄塞里斯":[["夢羅克金字塔 4樓","moc_pryd04",3600000,600000]],"巴風特":[["普隆德拉迷宮森林 3樓","prt_maze03",7200000,600000]],"死靈":[["吉芬地下密穴 3樓","gef_dun02",7200000,600000]],"蜂后":[["妙勒妙勒尼山脈北區 04","mjolnir_04",7200000,600000]],"黃金蟲":[["普隆德拉地下水道 4樓","prt_sewb4",3600000,600000]],"獸人英雄":[["吉芬原野 02","gef_fild02",86400000,600000],["西邊 獸人村","gef_fild14",3600000,600000]],"海盜之王":[["艾爾貝塔沈船 2樓","treasure02",7200000,600000]],"虎王":[["斐揚森林 11","pay_fild11",7200000,600000]],"蟻后":[["夢羅克螞蟻地獄密穴 2樓","anthell02",7200000,600000]],"月夜貓":[["斐揚洞穴 5樓(廢村)","pay_dun04",3600000,600000]],"法老王":[["夢羅克人面獅身像 地下 5樓","in_sphinx5",3600000,600000]],"皮里恩":[["蘇克拉特沙漠 17","moc_fild17",7200000,600000]],"獸人酋長":[["獸人村","gef_fild10",7200000,600000]],"冰暴騎士":[["薑餅城玩具分類場","xmas_dun02",3600000,600000]],"卡崙":[["薑餅城原野","xmas_fild01",7200000,600000]],"黑暗之王":[["克雷斯特漢姆古城 地下公墓","gl_chyard",3600000,600000]],"烏龜將軍":[["舊良宮","tur_dun04",3600000,600000]],"死靈騎士":[["尼芙菲姆 鬼峽谷","nif_fild02",7980000,0]],"德古拉男爵":[["吉芬地下密穴 2樓","gef_dun01",3600000,600000]],"墨蛇君":[["崑崙武陵道院","gon_dun03",5650000,600000]],"元靈武士":[["天津町 地下神舍","ama_dun03",5460000,600000]],"古埃及王":[["夢羅克金字塔 地下 2樓","moc_pryd06",3600000,600000]],"塔奧群卡":[["克魔島西邊洞穴加露","beach_dun",18000000,600000]],"RSX-0806":[["艾音貝赫礦山 2樓","ein_dun02",7500000,600000]],"白素貞":[["龍之城審良宮","lou_dun03",7000000,600000]],"騎士領主 賽依連":[["活體實驗研究所 地下 3樓","lhz_dun03",6000000,1800000]],"十字刺客 艾勒梅斯":[["活體實驗研究所 地下 3樓","lhz_dun03",6000000,1800000]],"神工匠 哈沃得":[["活體實驗研究所 地下 3樓","lhz_dun03",6000000,1800000]],"神官 瑪嘉雷特":[["活體實驗研究所 地下 3樓","lhz_dun03",6000000,1800000]],"神射手 迪文":[["活體實驗研究所 地下 3樓","lhz_dun03",6000000,1800000]],"超魔導師 凱特莉娜":[["活體實驗研究所 地下 3樓","lhz_dun03",6000000,1800000]],"闇●劍士 賽尼亞":[["活體實驗研究所 地下 2樓","lhz_dun02",7200000,600000]],"貝思波":[["優配擂斯中心部","jupe_core",7200000,600000]],"嗒妮小姐":[["哎喲泰雅 古神殿內部","ayo_dun02",25200000,600000]],"迪塔勒泰晤勒斯":[["毀葛深淵湖水 地下洞穴 3樓","abyss_03",10800000,600000]],"齊爾-D-01":[["機械娃娃工廠 2樓","kh_dun02",7200000,3600000]],"蘭特克力斯":[["毀葛奧丁神殿北區","odin_tem03",28800000,600000]],"幽暗夢魘":[["拉赫神殿聖域二樓中區","ra_san05",18000000,600000]],"阿特羅斯":[["拉赫歐茲峽谷 02","ra_fild02",14400000,600000],["拉赫 伊達平原 03","ra_fild03",10800000,600000],["拉赫 阿巫敦拉草原 04","ra_fild04",18000000,600000]],"伊夫利特":[["菲音斯 托爾火山洞穴 3樓","thor_v03",39600000,600000]],"墮落大神官 悉潘":[["無名島修道院 地下1樓","abbey02",7200000,600000]],"詛咒蠅王":[["無名島修道院 地下2樓","abbey03",43200000,600000]],"青冠龍":[["莫斯科森林最深處","mosk_dun03",7200000,600000]]};
    const format = new Intl.DateTimeFormat('zh-TW', {
      timeZone: 'Asia/Taipei', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    });
    const formatTimeOnly = new Intl.DateTimeFormat('zh-TW', {
      timeZone: 'Asia/Taipei', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    });

    function readMinute(text, now) {
      const line = text.normalize('NFKC').trim();
      const match = line.match(/最後一次擊殺:\s*(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})$/)
        || line.match(/打倒過\s*\(\s*(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})\s*\)\s*,\s*隊伍現在遇不到/);
      if (!match) return null;
      const [, month, day, hour, minute] = match.map(Number);
      if (hour > 23 || minute > 59) return null;
      const taipeiNow = new Date(now + 8 * 3600000);
      const year = taipeiNow.getUTCFullYear();
      let nearest = null;
      for (const y of [year, year - 1, year + 1]) {
        const local = new Date(Date.UTC(y, month - 1, day, hour, minute));
        const time = local.getTime() - 8 * 3600000;
        if (local.getUTCMonth() !== month - 1 || local.getUTCDate() !== day || time > now + 300000) continue;
        if (nearest === null || Math.abs(time - now) < Math.abs(nearest - now)) nearest = time;
      }
      return nearest;
    }

    function node(tag, text, className) {
      const el = document.createElement(tag);
      if (text != null) el.textContent = text;
      if (className) el.className = className;
      return el;
    }

    function formatDuration(ms) {
      const totalMin = Math.max(1, Math.ceil(ms / 60000));
      if (totalMin < 60) return totalMin + ' 分';
      const h = Math.floor(totalMin / 60);
      const m = totalMin % 60;
      return m ? `${h} 小時 ${m} 分` : `${h} 小時`;
    }

    function formatRange(start, end) {
      const s = format.format(start);
      const eFull = format.format(end);
      return s.slice(0, 5) === eFull.slice(0, 5)
        ? `${s} ～ ${formatTimeOnly.format(end)}`
        : `${s} ～ ${eFull}`;
    }

    const monsterIds = {"俄塞里斯":1038,"巴風特":1039,"死靈":1046,"蜂后":1059,"黃金蟲":1086,"獸人英雄":1087,"海盜之王":1112,"虎王":1115,"蟻后":1147,"月夜貓":1150,"法老王":1157,"皮里恩":1159,"獸人酋長":1190,"冰暴騎士":1251,"卡崙":1252,"黑暗之王":1272,"烏龜將軍":1312,"死靈騎士":1373,"德古拉男爵":1389,"墨蛇君":1418,"元靈武士":1492,"古埃及王":1511,"塔奧群卡":1583,"RSX-0806":1623,"白素貞":1630,"騎士領主 賽依連":1646,"十字刺客 艾勒梅斯":1647,"神工匠 哈沃得":1648,"神官 瑪嘉雷特":1649,"神射手 迪文":1650,"超魔導師 凱特莉娜":1651,"闇●劍士 賽尼亞":1658,"貝思波":1685,"嗒妮小姐":1688,"迪塔勒泰晤勒斯":1719,"齊爾-D-01":1734,"蘭特克力斯":1751,"幽暗夢魘":1768,"阿特羅斯":1785,"伊夫利特":1832,"墮落大神官 悉潘":1871,"詛咒蠅王":1874,"青冠龍":1885};
    const frames = new Map();
    async function drawPortrait(canvas) {
      const id = canvas.dataset.monster;
      try {
        if (!frames.has(id)) frames.set(id, fetch('/client/mob/'+id+'.json')
          .then(async response => {
            if (!response.ok) throw Error();
            const frame = (await response.json()).stand.frames[0];
            if (!Array.isArray(frame) || frame.length < 4 || !frame.slice(0,4).every(Number.isFinite) || frame[2] <= 0 || frame[3] <= 0) throw Error();
            return frame;
          }).catch(error => { frames.delete(id); throw error; }));
        const [x,y,w,h] = await frames.get(id);
        if (!canvas.isConnected || !isRadarOpen()) { if (canvas.isConnected) portraits.observe(canvas); return; }
        const image = new Image();
        image.src = '/client/mob/'+id+'.png';
        await image.decode();
        const ctx = canvas.getContext('2d');
        const scale = Math.min(2, (canvas.width-8)/w, (canvas.height-8)/h);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(image,x,y,w,h,(canvas.width-w*scale)/2,(canvas.height-h*scale)/2,w*scale,h*scale);
      } catch {
        if (canvas.isConnected) canvas.parentElement?.replaceChildren(node('small','圖片暫缺','no-portrait'));
      }
    }

    const style = node('style', `
      #roi-helper-mvp-open {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 4px;
        border: 0;
        border-bottom: 2px solid transparent;
        background: transparent;
      }
      #roi-helper-mvp-open:hover,
      #roi-helper-mvp-open[aria-expanded="true"] {
        border-bottom-color: #fbbf24;
        color: #fbbf24;
        background: rgba(30, 41, 59, 0.9);
      }
      #roi-helper-mvp-open .badge {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 16px;
        height: 16px;
        padding: 0 4px;
        border-radius: 999px;
        background: #f59e0b;
        color: #16120a;
        font-size: 10.5px;
        font-weight: 800;
        font-variant-numeric: tabular-nums;
      }
      #roi-helper-mvp-open .badge:empty { display: none; }

      #roi-helper-mvp-panel {
        position: fixed;
        inset: 0;
        margin: auto;
        z-index: 2147483647;
        box-sizing: border-box;
        width: min(920px, calc(100vw - 24px));
        height: fit-content;
        max-height: 84vh;
        max-height: 84dvh;
        padding: 0;
        background: linear-gradient(165deg, rgba(15, 23, 42, 0.97), rgba(9, 13, 22, 0.99));
        backdrop-filter: blur(12px);
        color: #edf1f7;
        border: 1.5px solid rgba(56, 189, 248, 0.72);
        border-radius: 12px;
        box-shadow: 0 20px 64px rgba(0, 0, 0, 0.9), 0 0 18px rgba(56, 189, 248, 0.14);
        font: 13.5px/1.45 system-ui, -apple-system, "Microsoft JhengHei", sans-serif;
        color-scheme: dark;
        overflow: hidden;
      }
      #roi-helper-mvp-panel:not([open]) { display: none; }
      #roi-helper-mvp-panel[open] { display: flex; flex-direction: column; }

      #roi-helper-mvp-panel button {
        border: 1px solid #485b73;
        background: #223146;
        color: #eef3fa;
        border-radius: 7px;
        padding: 6px 12px;
        font: inherit;
        cursor: pointer;
        transition: background .15s ease, border-color .15s ease, color .15s ease;
      }
      #roi-helper-mvp-panel button:hover {
        background: #2b3e57;
        border-color: #6b84a3;
      }
      #roi-helper-mvp-panel button:focus-visible,
      #roi-helper-mvp-open:focus-visible,
      #roi-helper-mvp-panel input:focus-visible {
        outline: 2px solid #ffcf80;
        outline-offset: 2px;
      }

      #roi-helper-mvp-panel header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 11px 16px;
        background: linear-gradient(90deg, #1e293b, #0f172a);
        border-top: 2px solid #fbbf24;
        border-bottom: 1px solid #334155;
      }
      #roi-helper-mvp-panel .title-wrap {
        display: flex;
        flex-direction: column;
        gap: 2px;
        min-width: 0;
      }
      #roi-helper-mvp-panel .title-row {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      #roi-helper-mvp-panel h2 {
        margin: 0;
        color: #38bdf8;
        font-size: 16.5px;
        font-weight: 750;
        letter-spacing: .02em;
      }
      #roi-helper-mvp-panel .header-actions {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-shrink: 0;
      }
      #roi-helper-mvp-panel .btn-ghost {
        background: transparent;
        border-color: #3d4f66;
        color: #c2d0e2;
      }
      #roi-helper-mvp-panel .btn-ghost:hover {
        background: #223146;
        color: #fff;
      }

      #roi-helper-mvp-panel .toolbar {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        padding: 9px 16px;
        background: rgba(15, 23, 42, 0.85);
        border-bottom: 1px solid #263549;
      }
      #roi-helper-mvp-panel .filters {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
      }
      #roi-helper-mvp-panel .filter-chip {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 4px 10px;
        border-radius: 999px;
        border: 1px solid #384960;
        background: #1b283b;
        color: #b7c6da;
        font-size: 12.5px;
        font-weight: 500;
      }
      #roi-helper-mvp-panel .filter-chip:hover {
        border-color: #5a7291;
        color: #fff;
      }
      #roi-helper-mvp-panel .filter-chip[aria-pressed="true"] {
        background: #2b415e;
        border-color: #82a6d1;
        color: #fff;
        font-weight: 650;
      }
      #roi-helper-mvp-panel .filter-chip .count {
        padding: 0 5px;
        border-radius: 999px;
        background: #0f1724;
        color: #9fb3cc;
        font-size: 11px;
        font-variant-numeric: tabular-nums;
      }
      #roi-helper-mvp-panel .filter-chip[aria-pressed="true"] .count {
        background: #17263a;
        color: #ffd894;
      }

      #roi-helper-mvp-panel .search-wrap {
        position: relative;
        flex: 1 1 200px;
        max-width: 260px;
      }
      #roi-helper-mvp-panel .search-input {
        width: 100%;
        box-sizing: border-box;
        padding: 5px 28px 5px 10px;
        border: 1px solid #3c4e66;
        border-radius: 7px;
        background: #090d16;
        color: #eef3fa;
        font: inherit;
        font-size: 13px;
      }
      #roi-helper-mvp-panel .search-input::placeholder { color: #7588a3; }
      #roi-helper-mvp-panel .search-clear {
        position: absolute;
        right: 4px;
        top: 50%;
        transform: translateY(-50%);
        padding: 1px 6px;
        border: none;
        background: transparent;
        color: #8ca0bc;
        font-size: 14px;
        line-height: 1;
      }
      #roi-helper-mvp-panel .search-clear:hover {
        background: transparent;
        color: #fff;
      }

      #roi-helper-mvp-panel small { color: #a9b9ce; font-size: 12px; }

      #roi-helper-mvp-panel main {
        padding: 14px 16px;
        overflow: auto;
        overscroll-behavior: contain;
        display: flex;
        flex-direction: column;
        gap: 16px;
      }
      #roi-helper-mvp-panel .notice-bar {
        margin: 0;
        padding: 8px 12px;
        border-radius: 8px;
        background: rgba(30, 41, 59, 0.75);
        border: 1px solid #344761;
        color: #c8d7ea;
        font-size: 12.5px;
      }
      #roi-helper-mvp-panel .notice-bar.warn {
        background: #2d2118;
        border-color: #7c5330;
        color: #fbd3a8;
      }

      #roi-helper-mvp-panel .group-section {
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      #roi-helper-mvp-panel .group-header {
        display: flex;
        align-items: center;
        gap: 8px;
        padding-bottom: 4px;
        border-bottom: 1px solid #263549;
        color: #cddbf0;
        font-size: 13px;
        font-weight: 700;
        letter-spacing: .03em;
      }
      #roi-helper-mvp-panel .group-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        flex-shrink: 0;
      }
      #roi-helper-mvp-panel .group-dot.window { background: #f59e0b; box-shadow: 0 0 8px #f59e0b99; }
      #roi-helper-mvp-panel .group-dot.upcoming { background: #60a5fa; }
      #roi-helper-mvp-panel .group-dot.passed { background: #34d399; }
      #roi-helper-mvp-panel .group-dot.unknown { background: #64748b; }
      #roi-helper-mvp-panel .group-count {
        color: #889cb8;
        font-size: 12px;
        font-weight: 500;
      }

      #roi-helper-mvp-panel .cards-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(min(100%, 380px), 1fr));
        gap: 10px;
        align-items: stretch;
      }

      #roi-helper-mvp-panel article.mvp-card {
        position: relative;
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        gap: 10px;
        padding: 11px 12px 11px 14px;
        background: rgba(30, 41, 59, 0.72);
        border: 1px solid rgba(71, 85, 105, 0.65);
        border-left-width: 4px;
        border-radius: 10px;
        transition: border-color .15s ease, transform .15s ease;
      }
      #roi-helper-mvp-panel article.mvp-card:hover {
        border-color: #64748b;
      }
      #roi-helper-mvp-panel article.mvp-card[data-state="window"] {
        border-left-color: #f59e0b;
        background: linear-gradient(145deg, rgba(66, 44, 16, 0.55), rgba(30, 41, 59, 0.78));
      }
      #roi-helper-mvp-panel article.mvp-card[data-state="upcoming"] {
        border-left-color: #60a5fa;
      }
      #roi-helper-mvp-panel article.mvp-card[data-state="passed"] {
        border-left-color: #34d399;
      }
      #roi-helper-mvp-panel article.mvp-card[data-state="unknown"] {
        border-left-color: #4b5d75;
        opacity: .92;
      }

      #roi-helper-mvp-panel .boss-head {
        display: flex;
        align-items: center;
        gap: 11px;
      }
      #roi-helper-mvp-panel .portrait {
        flex: 0 0 64px;
        height: 64px;
        display: grid;
        place-items: center;
        border: 1px solid #3c4f66;
        border-radius: 8px;
        background: radial-gradient(circle at 50% 45%, #37485d, #090d16 82%);
        overflow: hidden;
      }
      #roi-helper-mvp-panel canvas {
        width: 64px;
        height: 64px;
        image-rendering: pixelated;
      }
      #roi-helper-mvp-panel .no-portrait {
        color: #7d90aa;
        font-size: 11px;
      }
      #roi-helper-mvp-panel .boss-info {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      #roi-helper-mvp-panel .boss-title-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
      }
      #roi-helper-mvp-panel h3 {
        margin: 0;
        color: #fff;
        font-size: 16px;
        font-weight: 700;
        letter-spacing: .02em;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      #roi-helper-mvp-panel .status-pill {
        flex-shrink: 0;
        padding: 2px 8px;
        border-radius: 999px;
        font-size: 11.5px;
        font-weight: 650;
        font-variant-numeric: tabular-nums;
        background: #243347;
        color: #b7c8de;
        border: 1px solid #394d68;
      }
      #roi-helper-mvp-panel .status-pill[data-state="window"] {
        background: #422c10;
        border-color: #b46914;
        color: #ffd584;
      }
      #roi-helper-mvp-panel .status-pill[data-state="upcoming"] {
        background: #172e4c;
        border-color: #2f629e;
        color: #9ecbff;
      }
      #roi-helper-mvp-panel .status-pill[data-state="passed"] {
        background: #13352c;
        border-color: #256e59;
        color: #8ce9c3;
      }

      #roi-helper-mvp-panel .kill-meta {
        display: flex;
        align-items: center;
        gap: 6px;
        color: #9eb0c7;
        font-size: 12px;
        font-variant-numeric: tabular-nums;
      }
      #roi-helper-mvp-panel .source-tag {
        padding: 0 5px;
        border-radius: 4px;
        background: #233348;
        color: #9ec3e6;
        font-size: 11px;
      }

      #roi-helper-mvp-panel .maps-list {
        display: flex;
        flex-direction: column;
        gap: 7px;
        padding-top: 8px;
        border-top: 1px solid #29384d;
      }
      #roi-helper-mvp-panel .multi-map-hint {
        color: #9fb2ca;
        font-size: 11.5px;
      }
      #roi-helper-mvp-panel .map-row {
        display: flex;
        flex-direction: column;
        gap: 5px;
        padding: 7px 9px;
        border-radius: 7px;
        background: rgba(9, 13, 22, 0.72);
        border: 1px solid #263549;
      }
      #roi-helper-mvp-panel .map-top {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
      }
      #roi-helper-mvp-panel .map-btn {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        padding: 4px 9px;
        background: #21364c;
        border-color: #395878;
        color: #dceeff;
        font-size: 12.5px;
        font-weight: 600;
        text-align: left;
      }
      #roi-helper-mvp-panel .map-btn:hover {
        background: #2a4663;
        border-color: #5b87b5;
        color: #fff;
      }
      #roi-helper-mvp-panel .map-btn::after {
        content: '前往 ›';
        color: #8cc5ea;
        font-size: 11.5px;
        font-weight: 500;
      }
      #roi-helper-mvp-panel .interval-tag {
        color: #8da1bc;
        font-size: 11.5px;
        white-space: nowrap;
        font-variant-numeric: tabular-nums;
      }
      #roi-helper-mvp-panel .window-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        font-size: 12.5px;
      }
      #roi-helper-mvp-panel .window-label {
        color: #93a7c2;
        font-size: 11.5px;
      }
      #roi-helper-mvp-panel .time {
        color: #ffdc9c;
        font-weight: 650;
        font-variant-numeric: tabular-nums;
      }
      #roi-helper-mvp-panel .progress-track {
        height: 3px;
        border-radius: 999px;
        background: #223044;
        overflow: hidden;
      }
      #roi-helper-mvp-panel .progress-fill {
        height: 100%;
        border-radius: 999px;
        background: #60a5fa;
      }
      #roi-helper-mvp-panel .progress-fill[data-state="window"] { background: #f59e0b; }
      #roi-helper-mvp-panel .progress-fill[data-state="passed"] { background: #34d399; }

      #roi-helper-mvp-panel .empty-state {
        padding: 28px 16px;
        text-align: center;
        color: #92a5bf;
        background: #162131;
        border: 1px dashed #32445c;
        border-radius: 10px;
      }

      #roi-helper-mvp-panel footer {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 9px 16px;
        background: rgba(15, 23, 42, 0.9);
        border-top: 1px solid #2b3a4f;
      }

      @media (max-width: 560px) {
        #roi-helper-mvp-panel .toolbar { flex-direction: column; align-items: stretch; }
        #roi-helper-mvp-panel .search-wrap { max-width: none; }
        #roi-helper-mvp-panel .map-top { flex-wrap: wrap; }
      }
    `);
    document.head.append(style);

    const open = document.createElement('button');
    open.id = 'roi-helper-mvp-open';
    open.type = 'button';
    open.className = 'ro-tab';
    open.setAttribute('aria-expanded', 'false');
    open.setAttribute('aria-controls', 'roi-helper-mvp-panel');
    open.title = '開啟／收合 MVP 雷達（開啟時點視窗外畫面可自動關閉）';
    const openLabel = node('span', '🧭 MVP');
    const openBadge = node('span', '', 'badge');
    openBadge.title = '目前處於預估重生時段的 MVP 數量';
    open.append(openLabel, openBadge);

    const panel = document.createElement('div');
    panel.id = 'roi-helper-mvp-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'false');
    panel.setAttribute('aria-labelledby', 'roi-helper-mvp-title');
    panel.hidden = true;

    const isRadarOpen = () => !panel.hidden && panel.hasAttribute('open');

    const title = node('h2', '🧭 個人 MVP 雷達');
    title.id = 'roi-helper-mvp-title';
    const meta = node('small', '');
    const titleRow = node('div', null, 'title-row');
    titleRow.append(title);
    const titleWrap = node('div', null, 'title-wrap');
    titleWrap.append(titleRow, meta);

    const refresh = node('button', '重新整理');
    refresh.type = 'button';
    const close = node('button', '關閉', 'btn-ghost');
    close.type = 'button';

    let refreshTimer;
    function closeRadar() {
      if (!isRadarOpen()) return;
      panel.removeAttribute('open');
      panel.hidden = true;
      open.setAttribute('aria-expanded', 'false');
      clearInterval(refreshTimer);
      portraits.disconnect();
    }

    close.onclick = closeRadar;

    const headerActions = node('div', null, 'header-actions');
    headerActions.append(refresh, close);
    const header = document.createElement('header');
    header.append(titleWrap, headerActions);

    let activeFilter = 'all';
    let searchQuery = '';
    const filterDefs = [
      ['all', '全部'],
      ['ready', '可挑戰'],
      ['upcoming', '即將重生'],
      ['recorded', '有紀錄']
    ];
    const filterBar = node('div', null, 'filters');
    const filterButtons = new Map();
    for (const [key, label] of filterDefs) {
      const btn = node('button', null, 'filter-chip');
      btn.type = 'button';
      btn.setAttribute('aria-pressed', key === activeFilter ? 'true' : 'false');
      const txt = node('span', label);
      const cnt = node('span', '0', 'count');
      btn.append(txt, cnt);
      btn.onclick = () => {
        activeFilter = key;
        for (const [k, b] of filterButtons) {
          b.setAttribute('aria-pressed', k === activeFilter ? 'true' : 'false');
        }
        render(latestData || capture());
      };
      filterButtons.set(key, btn);
      filterBar.append(btn);
    }

    const searchWrap = node('div', null, 'search-wrap');
    const searchInput = document.createElement('input');
    searchInput.type = 'search';
    searchInput.className = 'search-input';
    searchInput.placeholder = '搜尋 MVP 或地圖名稱 / ID…';
    searchInput.setAttribute('aria-label', '搜尋 MVP 或地圖');
    const searchClear = node('button', '×', 'search-clear');
    searchClear.type = 'button';
    searchClear.title = '清除搜尋';
    searchClear.hidden = true;
    searchInput.addEventListener('input', () => {
      searchQuery = searchInput.value.trim().toLowerCase();
      searchClear.hidden = !searchQuery;
      render(latestData || capture());
    });
    searchClear.onclick = () => {
      searchInput.value = '';
      searchQuery = '';
      searchClear.hidden = true;
      searchInput.focus();
      render(latestData || capture());
    };
    searchWrap.append(searchInput, searchClear);

    const toolbar = node('div', null, 'toolbar');
    const mergeLabel = document.createElement('label');
    const mergeSwitch = document.createElement('input');
    mergeSwitch.type = 'checkbox';
    mergeSwitch.checked = state.mvpMergeRoster;
    mergeSwitch.onchange = () => {
      state.mvpMergeRoster = mergeSwitch.checked;
      savePrefs();
      refreshPreferences();
    };
    mergeLabel.append(mergeSwitch, ' 合併同帳號分身紀錄');
    toolbar.append(filterBar, mergeLabel, searchWrap);

    const results = document.createElement('main');
    const footer = document.createElement('footer');
    footer.append(
      node('small', '台北時間 (UTC+8) · 點選視窗外畫面自動關閉'),
      node('small', '點擊地圖名稱可自動帶入掛機設定')
    );

    const portraits = new IntersectionObserver(entries => {
      for (const entry of entries) if (entry.isIntersecting && isRadarOpen()) {
        portraits.unobserve(entry.target);
        drawPortrait(entry.target);
      }
    }, { root: results });

    panel.append(header, toolbar, results, footer);
    document.body.append(panel);

    function nativeProfileName() {
      const menu = document.querySelector('nav.xp-menubar[aria-label="主選單"]');
      return menu?.parentElement?.querySelector(':scope > .xp-title .caption')
        ?.textContent.match(/-\s*\[([^\]]+)\]/)?.[1].trim() || '';
    }

    function currentSnapshot(expectedName) {
      const root = document.getElementById('root');
      if (!root) return null;
      const key = Object.keys(root).find(k => k.startsWith('__reactContainer$'));
      const stack = [root[key]?.stateNode?.current];
      let identity = null;
      for (let steps = 0; stack.length && steps < 4000; steps++) {
        const fiber = stack.pop();
        if (!fiber) continue;
        const props = fiber.memoizedProps;
        for (const snap of [props?.data?.s, props?.snap, props?.s]) {
          const name = typeof snap?.character?.name === 'string' ? snap.character.name.trim() : '';
          if (!name || (expectedName && name !== expectedName)) continue;
          if (Array.isArray(snap.mvpLastKill)) return snap;
          if (snap.mapId != null) identity ??= snap;
        }
        if (fiber.sibling) stack.push(fiber.sibling);
        if (fiber.child) stack.push(fiber.child);
      }
      return identity;
    }

    function timestamp(value) {
      if (typeof value !== 'number' && typeof value !== 'string') return null;
      const at = typeof value === 'number' ? value : Date.parse(value);
      return Number.isFinite(at) && at > 0 && Number.isFinite(new Date(at).getTime()) ? at : null;
    }

    const visibleIgnoringAria = el => el && el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden';
    function namedButton(label) {
      return [...document.querySelectorAll('button,[role="tab"]')].find(el =>
        visibleIgnoringAria(el) && !el.disabled && [el.textContent.trim(),el.getAttribute('aria-label'),el.title].includes(label));
    }
    function setSearch(input, value) {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,value);
      input.dispatchEvent(new InputEvent('input', {bubbles:true, composed:true, inputType:'insertReplacementText', data:value}));
      input.dispatchEvent(new Event('change', {bubbles:true}));
    }
    function until(read, shouldAbort, root) {
      return waitForUi(read, { root, timeout: 8000, shouldAbort });
    }
    const mapGroup = () => [...document.querySelectorAll('[role="group"][aria-label="掛機地圖"]')].find(visibleIgnoringAria);
    function reactFiber(el) {
      const key = Object.keys(el).find(name => name.startsWith('__reactFiber$'));
      return key && el[key];
    }
    function pickerMaps(group) {
      for (let fiber = reactFiber(group); fiber; fiber = fiber.return) {
        const props = fiber.memoizedProps;
        if (props?.label === '掛機地圖' && Array.isArray(props.maps)) return props.maps;
      }
      return [];
    }
    let navigating = false;
    async function chooseMap(map, id) {
      if (navigating) return;
      navigating = true;
      const actor = state.activeCharId, epoch = refineIdentityEpoch;
      const shouldAbort = () => state.activeCharId !== actor || refineIdentityEpoch !== epoch;
      closeRadar();
      try {
        if (!mapGroup()) {
          let tab = namedButton('掛機設定');
          if (!tab) {
            namedButton('冒險')?.click();
            tab = await until(() => namedButton('掛機設定'), shouldAbort);
          }
          if (!tab && !mapGroup()) throw Error('找不到掛機設定入口。請先開啟掛機設定再點地圖。');
          tab?.click();
        }
        const findFilter = () => [...document.querySelectorAll('input[type="search"]')].find(el =>
          visibleIgnoringAria(el) && el.closest('label')?.textContent.includes('搜尋設定'));
        await until(() => mapGroup() || findFilter(), shouldAbort);
        if (!mapGroup() && findFilter()) setSearch(findFilter(),'掛機地圖');
        const field = await until(() => mapGroup()?.querySelector('input[aria-label="掛機地圖：搜尋"]'), shouldAbort);
        if (!field) throw Error('找不到原生掛機地圖選單。');
        const options = pickerMaps(field.closest('[role="group"]'));
        const label = options.find(option => option.id === id)?.name || map;
        const uniqueLabel = options.filter(option => option.name === label).length === 1;
        const query = uniqueLabel ? label : id;
        setSearch(field, query);
        const choice = () => {
          const group = mapGroup();
          if (group?.querySelector('input[aria-label="掛機地圖：搜尋"]')?.value !== query) return null;
          const buttons = [...group.querySelectorAll('button[aria-pressed]')].filter(visibleIgnoringAria);
          const exact = buttons.filter(button => reactFiber(button)?.key === id);
          if (exact.length > 1) return null;
          let button = exact[0];
          if (!button) {
            const byName = buttons.filter(candidate => candidate.firstElementChild?.textContent.trim() === label);
            if (byName.length !== 1 || reactFiber(byName[0])?.key != null) return null;
            button = byName[0];
          }
          return !button.disabled || button.getAttribute('aria-pressed') === 'true' ? button : null;
        };
        const button = await until(choice, shouldAbort, field.closest('[role="group"]')?.parentElement);
        if (!button) throw Error('原生選單無法確認這張地圖：'+map+'（'+id+'）。');
        let selected = button;
        if (button.getAttribute('aria-pressed') !== 'true') {
          button.click();
          selected = await until(() => {
            const target = choice();
            return target?.getAttribute('aria-pressed') === 'true' && target;
          }, shouldAbort, field.closest('[role="group"]')?.parentElement);
        }
        if (!selected) throw Error('尚未確認選取成功，請在掛機設定檢查地圖。');
        selected.scrollIntoView({block:'nearest'});
        selected.focus({preventScroll:true});
      } catch (error) {
        alert(error.message);
      } finally { navigating = false; }
    }

    const cacheRoot = 'ro-idle.mvp.v1/';
    const profileKey = cacheRoot + 'last-profile';
    const memory = new Map();
    const savedKillsCache = new Map();
    const mvpChangeKey = 'roi-mvp-record-change-v1';
    let lastProfile = '';
    let storageFailed = false;
    try { lastProfile = sessionStorage.getItem(profileKey) || ''; } catch { log("mvp", "無法取得或同步本機 MVP 設定"); }

    function prefixFor(profile) {
      return cacheRoot + encodeURIComponent(profile) + '/';
    }

    function mvpBossName(name) {
      const trimmed = name.trim();
      return /^詛咒蠅王?(?:\s*[/／]\s*詛咒蠅王?)?$/.test(trimmed) ? '詛咒蠅王' : trimmed;
    }

    function remember(profile, name, at) {
      const key = prefixFor(profile) + name;
      const previous = memory.get(key) || 0;
      if (at <= previous) return;
      let newest = at;
      try {
        const stored = timestamp(Number(localStorage.getItem(key))) || 0;
        newest = Math.max(stored, at);
        if (at > stored) {
          localStorage.setItem(key, String(at));
          if (typeof GM_addValueChangeListener === 'function') {
            try { GM_setValue(mvpChangeKey, validateMvpChange({ key, at })); } catch { log("mvp", "無法取得或同步本機 MVP 設定"); }
          }
        }
      } catch { storageFailed = true; }
      memory.set(key, newest);
      savedKillsCache.delete(profile);
    }
    function savedKills(profile) {
      if (savedKillsCache.has(profile)) return savedKillsCache.get(profile);
      const prefix = prefixFor(profile);
      const kills = new Map();
      function merge(key, at) {
        if (!key?.startsWith(prefix) || !at) return;
        const name = mvpBossName(key.slice(prefix.length));
        kills.set(name, Math.max(kills.get(name) || 0, at));
      }
      for (const [key, at] of memory) merge(key, at);
      try {
        for (let n = 0; n < localStorage.length; n++) {
          const key = localStorage.key(n);
          if (key?.startsWith(prefix)) merge(key, timestamp(Number(localStorage.getItem(key))));
        }
      } catch { storageFailed = true; }
      if (savedKillsCache.size >= 32) savedKillsCache.delete(savedKillsCache.keys().next().value);
      savedKillsCache.set(profile, kills);
      return kills;
    }

    function validateMvpChange(value) {
      if (!isPlainRecord(value) || typeof value.key !== 'string' || value.key.length > 512 ||
          !value.key.startsWith(cacheRoot) || value.key === profileKey || !timestamp(value.at)) throw Error('MVP 變更訊號格式不符');
      return { key: value.key, at: value.at };
    }
    function invalidateSavedKills(key) {
      if (typeof key !== 'string' || !key.startsWith(cacheRoot) || key === profileKey) return;
      memory.delete(key);
      for (const profile of savedKillsCache.keys()) {
        if (key.startsWith(prefixFor(profile))) savedKillsCache.delete(profile);
      }
    }
    window.addEventListener('storage', event => {
      if (event.storageArea !== localStorage) return;
      if (event.key === null) { memory.clear(); savedKillsCache.clear(); }
      else invalidateSavedKills(event.key);
    });
    listenRemote(mvpChangeKey, validateMvpChange, (change) => invalidateSavedKills(change.key));

    let lastBackgroundAt = -Infinity;
    let latestData;
    const findStatsList = () => [...document.querySelectorAll('ul[aria-label="MVP 最後一次擊殺"]')]
      .find((list) => visibleIgnoringAria(list) && !list.closest('[hidden],[inert],[aria-hidden="true"]'));
    function capture(list = findStatsList()) {
      const nativeName = nativeProfileName();
      const snap = currentSnapshot(nativeName);
      const profile = nativeName || snap?.character.name.trim() || '';
      const api = profile && foregroundMvpSnapshot?.character.name?.trim() === profile ? foregroundMvpSnapshot : null;
      if (profile && profile !== lastProfile) {
        lastProfile = profile;
        try { sessionStorage.setItem(profileKey, profile); } catch { log("mvp", "無法取得或同步本機 MVP 設定"); }
      }
      const live = new Map();
      function record(name, at) {
        if (typeof name !== 'string' || !name || !at) return;
        const boss = mvpBossName(name);
        if (!boss) return;
        live.set(boss, Math.max(live.get(boss) || 0, at));
        if (profile) remember(profile, boss, at);
      }
      if (list) {
        const now = Date.now();
        for (const row of list.children) {
          const name = row.children[0]?.textContent.trim();
          if (name && !/未變身[，,]\s*沒有 MVP/.test(name)) {
            record(name, readMinute(row.children[1]?.textContent || '', now));
          }
        }
      }
      for (const records of [api?.mvpLastKill, snap?.mvpLastKill]) {
        if (!Array.isArray(records)) continue;
        for (const entry of records) {
          if (!entry?.noMvp) record(entry?.name, timestamp(entry?.at));
        }
      }
      latestData = {profile, live, hasList:Boolean(list) || Array.isArray(snap?.mvpLastKill) || Boolean(api)};
      updateFloatingBadge(latestData);
      return latestData;
    }

    function evaluateBoss(name, at, maps, now) {
      const known = Number.isFinite(at);
      if (!known || !maps?.length) {
        return { state: 'unknown', sortTime: Infinity, badgeText: '時間未知' };
      }
      let hasWindow = false;
      let earliestUpcoming = Infinity;
      let latestPassed = -Infinity;
      for (const [, , base, variance] of maps) {
        if (base == null) continue;
        const start = at + base;
        const end = start + (variance || 0);
        if (now >= start && now <= end) hasWindow = true;
        else if (now < start) earliestUpcoming = Math.min(earliestUpcoming, start);
        else latestPassed = Math.max(latestPassed, end);
      }
      if (hasWindow) {
        return { state: 'window', sortTime: 0, badgeText: '重生時段中' };
      }
      if (Number.isFinite(earliestUpcoming)) {
        return {
          state: 'upcoming',
          sortTime: earliestUpcoming,
          badgeText: '約 ' + formatDuration(earliestUpcoming - now) + '後'
        };
      }
      if (latestPassed > -Infinity) {
        return { state: 'passed', sortTime: -latestPassed, badgeText: '已過預估時段' };
      }
      return { state: 'unknown', sortTime: Infinity, badgeText: '時間未知' };
    }

    function displayKills(owner, live) {
      const kills = new Map(owner ? savedKills(owner) : undefined);
      for (const [name, at] of live) kills.set(name, Math.max(kills.get(name) || 0, at));
      const sources = new Map();
      if (state.mvpMergeRoster && owner && state.chars.some(c => c.name === owner)) {
        for (const c of state.chars) {
          if (!c.name || c.name === owner) continue;
          for (const [name, at] of savedKills(c.name)) {
            if (at <= (kills.get(name) || 0)) continue;
            kills.set(name, at);
            sources.set(name, c.name);
          }
        }
      }
      return { kills, sources };
    }
    function refreshPreferences() {
      mergeSwitch.checked = state.mvpMergeRoster;
      if (isRadarOpen()) render();
      else if (latestData) updateFloatingBadge(latestData);
    }
    function updateFloatingBadge(data) {
      if (!data) return;
      const now = Date.now();
      const { profile, live, hasList } = data;
      const historical = !profile && !hasList && lastProfile;
      const owner = profile || historical;
      const { kills } = displayKills(owner, live);
      let windowCount = 0;
      for (const [name, maps] of Object.entries(schedules)) {
        const info = evaluateBoss(name, kills.get(name), maps, now);
        if (info.state === 'window') windowCount++;
      }
      const text = windowCount > 0 ? String(windowCount) : '';
      if (openBadge.textContent !== text) openBadge.textContent = text;
    }

    function captureBackground() {
      const now = performance.now();
      if (now - lastBackgroundAt >= TIMING.mvpCaptureGap) {
        capture();
        lastBackgroundAt = now;
      }
      return latestData;
    }

    let lastStatsList, lastStatsText = '', lastStatsProfile = '';
    function syncFromStats() {
      const list = findStatsList();
      const text = list?.textContent || '';
      const profile = nativeProfileName();
      if (list === lastStatsList && text === lastStatsText && profile === lastStatsProfile) return;
      lastStatsList = list;
      lastStatsText = text;
      lastStatsProfile = profile;
      const data = capture(list);
      if (isRadarOpen()) render(data);
    }

    function render(data = capture()) {
      const scrollTop = isRadarOpen() ? results.scrollTop : 0;
      const focused = document.activeElement;
      const focusedBoss = focused?.closest?.('article')?.querySelector('h3')?.textContent;
      const focusedMap = focused?.title;
      portraits.disconnect();
      results.replaceChildren();

      const now = Date.now();
      const { profile, live, hasList } = data;
      const historical = !profile && !hasList && lastProfile;
      const owner = profile || historical;
      const { kills, sources } = displayKills(owner, live);

      meta.textContent = historical
        ? `角色：${owner}（本機離線紀錄）`
        : `${profile || '未辨識角色'} · 更新於 ${format.format(now)}`;

      if (historical) {
        results.append(node('p', `目前畫面未載入角色快照，以下顯示「${owner}」在本機保存的擊殺時間。`, 'notice-bar'));
      } else if (!profile && hasList) {
        results.append(node('p', '目前無法辨識角色名稱；開啟一次「統計」分頁即可依角色自動保存紀錄。', 'notice-bar'));
      } else if (!hasList && !kills.size) {
        results.append(node('p', '尚未讀取到擊殺紀錄，請先切換至「統計」分頁一次再按「重新整理」。', 'notice-bar'));
      }
      if (storageFailed) {
        results.append(node('p', '瀏覽器目前無法寫入 localStorage，重新整理網頁後紀錄可能不會保留。', 'notice-bar warn'));
      }

      const allNames = [...new Set([...kills.keys(), ...Object.keys(schedules)])];
      const items = allNames.map(name => {
        const at = kills.get(name);
        const maps = Object.hasOwn(schedules, name) ? schedules[name] : [];
        const evalInfo = evaluateBoss(name, at, maps, now);
        return { name, at, maps, ...evalInfo };
      });

      const counts = {
        all: items.length,
        ready: items.filter(i => i.state === 'window' || i.state === 'passed').length,
        upcoming: items.filter(i => i.state === 'upcoming').length,
        recorded: items.filter(i => Number.isFinite(i.at)).length
      };
      for (const [key, btn] of filterButtons) {
        btn.querySelector('.count').textContent = String(counts[key] ?? 0);
      }

      const filtered = items.filter(item => {
        if (activeFilter === 'ready' && item.state !== 'window' && item.state !== 'passed') return false;
        if (activeFilter === 'upcoming' && item.state !== 'upcoming') return false;
        if (activeFilter === 'recorded' && !Number.isFinite(item.at)) return false;
        if (searchQuery) {
          const hitName = item.name.toLowerCase().includes(mvpBossName(searchQuery));
          const hitMap = item.maps.some(([m, id]) => m.toLowerCase().includes(searchQuery) || id.toLowerCase().includes(searchQuery));
          if (!hitName && !hitMap) return false;
        }
        return true;
      });

      if (!filtered.length) {
        results.append(node('div', '沒有符合目前篩選或搜尋條件的 MVP。', 'empty-state'));
        results.scrollTop = 0;
        return;
      }

      const groups = [
        { key: 'window', label: '預估重生時段中（建議立即前往）', list: [] },
        { key: 'upcoming', label: '即將進入重生時段', list: [] },
        { key: 'passed', label: '已過預估時段（可能已重生或未被擊殺）', list: [] },
        { key: 'unknown', label: '尚無擊殺紀錄', list: [] }
      ];
      const groupMap = Object.fromEntries(groups.map(g => [g.key, g]));
      for (const item of filtered) {
        groupMap[item.state].list.push(item);
      }
      for (const g of groups) {
        g.list.sort((a, b) => a.sortTime - b.sortTime || a.name.localeCompare(b.name, 'zh-Hant'));
      }

      for (const g of groups) {
        if (!g.list.length) continue;
        const section = node('section', null, 'group-section');
        const gHeader = node('div', null, 'group-header');
        gHeader.append(
          node('span', null, `group-dot ${g.key}`),
          node('span', g.label),
          node('span', `(${g.list.length})`, 'group-count')
        );
        const grid = node('div', null, 'cards-grid');

        for (const { name, at, maps, state, badgeText } of g.list) {
          const known = Number.isFinite(at);
          const missing = !kills.has(name) && hasList;
          const card = document.createElement('article');
          card.className = 'mvp-card';
          card.dataset.state = state;

          const head = node('div', null, 'boss-head');
          if (Object.hasOwn(monsterIds, name)) {
            const portrait = node('div', null, 'portrait');
            const canvas = document.createElement('canvas');
            canvas.setAttribute('aria-hidden', 'true');
            canvas.width = canvas.height = 128;
            canvas.dataset.monster = monsterIds[name];
            portrait.append(canvas);
            head.append(portrait);
            portraits.observe(canvas);
          }

          const info = node('div', null, 'boss-info');
          const titleLine = node('div', null, 'boss-title-row');
          const pill = node('span', known ? badgeText : (missing ? '清單無紀錄' : '時間未知'), 'status-pill');
          pill.dataset.state = state;
          titleLine.append(node('h3', name), pill);

          const killMeta = node('div', null, 'kill-meta');
          if (known) {
            const isLive = live.get(name) === at;
            killMeta.append(
              node('span', (isLive ? '最後擊殺 ' : '上次紀錄 ') + format.format(at)),
              node('span', sources.has(name) ? '快取 · ' + sources.get(name) : isLive ? '即時' : '快取', 'source-tag')
            );
          } else {
            killMeta.append(node('span', missing ? '目前清單無擊殺紀錄' : '尚未讀取到擊殺時間'));
          }
          info.append(titleLine, killMeta);
          head.append(info);
          card.append(head);

          if (!maps?.length) {
            card.append(node('small', '官方地圖表未列出沒地圖與重生間隔。'));
            grid.append(card);
            continue;
          }

          const mapsList = node('div', null, 'maps-list');
          if (maps.length > 1 && known) {
            mapsList.append(node('div', '多張候選地圖（請對照實際擊殺地點）', 'multi-map-hint'));
          }

          for (const [map, id, base, variance] of maps) {
            const row = node('div', null, 'map-row');
            const top = node('div', null, 'map-top');
            const place = node('button', map, 'map-btn');
            place.type = 'button';
            place.title = '在掛機設定選擇 ' + id;
            place.onclick = () => chooseMap(map, id);

            const intervalText = base == null
              ? '間隔未知'
              : `${Math.round(base / 60000)}${variance ? '～' + Math.round((base + variance) / 60000) : ''} 分`;
            top.append(place, node('span', intervalText, 'interval-tag'));
            row.append(top);

            if (focusedBoss === name && focusedMap === place.title) {
              place.focus({ preventScroll: true });
            }

            if (known && base != null) {
              const start = at + base;
              const end = start + (variance || 0);
              const mapState = now < start ? 'upcoming' : (now <= end ? 'window' : 'passed');

              const winRow = node('div', null, 'window-row');
              const labelText = mapState === 'upcoming'
                ? `約 ${formatDuration(start - now)}後進入`
                : (mapState === 'window' ? '重生時段中' : '已過預估時段');
              const timeEl = node('span', formatRange(start, end), 'time');
              timeEl.setAttribute('aria-label', '預估重生 ' + timeEl.textContent);
              winRow.append(node('span', labelText, 'window-label'), timeEl);
              row.append(winRow);

              const track = node('div', null, 'progress-track');
              const fill = node('div', null, 'progress-fill');
              fill.dataset.state = mapState;
              const ratio = end > at ? Math.max(0, Math.min(1, (now - at) / (end - at))) : 1;
              fill.style.width = Math.round(ratio * 100) + '%';
              track.append(fill);
              row.append(track);
            }

            mapsList.append(row);
          }

          card.append(mapsList);
          grid.append(card);
        }

        section.append(gHeader, grid);
        results.append(section);
      }

      results.scrollTop = scrollTop;
    }

    function draggable(el, handle) {
      const key = el.id + '-position-v1';
      let saved, drag, suppress = false;
      try { saved = JSON.parse(localStorage.getItem(key)); } catch { log("mvp", "無法取得或同步本機 MVP 設定"); }
      function place(x,y) {
        const rect = el.getBoundingClientRect();
        Object.assign(el.style, {margin:'0',right:'auto',bottom:'auto',
          left:Math.max(0, Math.min(x,innerWidth-rect.width))+'px',
          top:Math.max(0, Math.min(y,innerHeight-rect.height))+'px'});
      }
      function restore() {
        if (el.getClientRects().length && saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) place(saved.x,saved.y);
      }
      Object.assign(handle.style,{touchAction:'none',cursor:'grab',userSelect:'none'});
      handle.title='拖曳調整位置';
      handle.addEventListener('pointerdown',e=>{
        if (!e.isPrimary || e.button!==0 || (handle!==el && e.target.closest('button,input'))) return;
        const r=el.getBoundingClientRect();
        drag={id:e.pointerId,x:e.clientX,y:e.clientY,left:r.left,top:r.top};
        suppress=false;
        handle.setPointerCapture(e.pointerId);
      });
      handle.addEventListener('pointermove',e=>{
        if (drag?.id!==e.pointerId) return;
        const dx=e.clientX-drag.x, dy=e.clientY-drag.y;
        if (!suppress && Math.hypot(dx,dy)<5) return;
        suppress=true;
        place(drag.left+dx,drag.top+dy);
      });
      handle.addEventListener('lostpointercapture',()=>{
        if (drag && suppress) {
          const r=el.getBoundingClientRect(); saved={x:r.left,y:r.top};
          try {localStorage.setItem(key,JSON.stringify(saved));} catch { log("mvp", "無法取得或同步本機 MVP 設定"); }
        }
        drag=null;
      });
      handle.addEventListener('click',e=>{
        if (suppress && e.detail) { e.preventDefault();e.stopImmediatePropagation(); }
        suppress=false;
      },true);
      window.addEventListener('resize',restore);
      restore();return restore;
    }

    const positionPanel = draggable(panel, header);
    function openRadar() {
      if (isRadarOpen()) return;
      panel.hidden = false;
      panel.setAttribute('open', '');
      open.setAttribute('aria-expanded', 'true');
      render();
      positionPanel();
      clearInterval(refreshTimer);
      refreshTimer = window.setInterval(() => {
        if (isRadarOpen() && !document.hidden) render(captureBackground());
      }, TIMING.mvpRender);
    }
    function toggleRadar() {
      if (isRadarOpen()) closeRadar();
      else openRadar();
    }

    open.onclick = (e) => {
      e.stopPropagation();
      toggleRadar();
    };
    refresh.onclick = () => render();

    document.addEventListener('pointerdown', (e) => {
      if (!isRadarOpen()) return;
      const target = e.target;
      if (!(target instanceof Element)) return;
      if (panel.contains(target) || open.contains(target)) return;
      closeRadar();
    }, true);

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && isRadarOpen()) closeRadar();
    });

    captureBackground();
    window.setInterval(() => { if (!document.hidden) captureBackground(); }, TIMING.mvpBackground);
    document.addEventListener('visibilitychange', captureBackground);
    window.addEventListener('pagehide', captureBackground);
    document.addEventListener('click', event => {
      const control = event.target.closest?.('button, [role="tab"], a');
      if (control && !control.closest('#ro-helper-hud') && !panel.contains(control) && /掛機設定|尋找怪物|切換角色|回城|地圖/.test(control.textContent)) captureBackground();
    }, true);
    return { button: open, syncFromStats, refreshPreferences };
  }
