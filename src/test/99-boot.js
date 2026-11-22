
  let mvpRadar;
  if (!location.pathname.startsWith('/info')) {
    try {
      mvpRadar = createMvpSchedule();
    } catch (error) {
      console.warn('個人 MVP 時刻表初始化失敗', error);
    }
  }

  document.querySelectorAll('.log-window .log-line').forEach(queueLogLine);
  listenSharedSettings();
  if (canShareCharPoll()) listenRemote(charPollKey, validateCharPoll, applySharedCharPoll);
  window.addEventListener('focus', runPageRouter);
  // Remove the previous version's classes from nodes left in the live page.
  const oldRowClass = ['ro', 'wh', 'locked'].join('-');
  const oldBadgeClasses = ['lock', 'unlock'].map(kind => ['ro', 'badge', kind].join('-'));
  document.querySelectorAll(`li.${oldRowClass}`).forEach(row => row.classList.remove(oldRowClass));
  document.querySelectorAll('button[data-ro-lock]').forEach(button => button.classList.remove(...oldBadgeClasses));
  ensureHUD(); pollChars(); runPageRouter();
  setInterval(() => {
    clearTransientCharAlerts(null, Date.now() - 600000);
    if (document.hidden) return;
    ensureHUD(); updateHUD();
    if (Date.now() - lastRouterAt > 1200) refreshRareHelper();
    const itemGroup = document.querySelector('[role="group"][aria-label="道具設定的複製與匯出匯入"]');
    if (itemGroup) lootSyncPanels.get(itemGroup)?.();
  }, 1500);
  setInterval(pollChars, charPollInterval);
})();
