'use strict';

const stopShortcut = (() => {
  const commandName = 'stop-active-queue';
  const dashboardUrl = chrome.runtime.getURL('dashboard.html');
  const instagramOrigins = new Set(['https://www.instagram.com', 'https://instagram.com']);
  const expiresAfter = 1500;
  const validId = id => Number.isSafeInteger(id) && id >= 0;

  function linkedTab(documentUrl) {
    if (typeof documentUrl !== 'string') return null;
    const url = new URL(documentUrl);
    if (url.href.split(/[?#]/, 1)[0] !== dashboardUrl) return null;
    const id = url.searchParams.get('tab');
    return /^\d+$/.test(id ?? '') && validId(Number(id)) ? Number(id) : null;
  }

  async function currentTarget(sourceTab) {
    const focused = await chrome.windows.getLastFocused();
    if (!focused.focused || focused.id !== sourceTab.windowId) return null;
    const [active] = await chrome.tabs.query({ active: true, windowId: focused.id });
    if (active?.id !== sourceTab.id) return null;

    const dashboards = (await chrome.runtime.getContexts({ contextTypes: ['TAB'], windowIds: [focused.id] }))
      .map(context => ({ ...context, link: linkedTab(context.documentUrl) }))
      .filter(context => context.link !== null && validId(context.tabId) && typeof context.documentId === 'string');
    const ownDashboard = dashboards.find(context => context.tabId === active.id);
    if (ownDashboard) return ownDashboard;

    if (typeof active.url !== 'string' || !instagramOrigins.has(new URL(active.url).origin)) return null;
    const bound = dashboards.filter(context => context.link === active.id);
    return bound.length === 1 ? bound[0] : null;
  }

  async function handle(command, sourceTab) {
    const pressedAt = Date.now();
    if (command !== commandName || !validId(sourceTab?.id) || !validId(sourceTab.windowId)) return false;
    const target = await currentTarget(sourceTab);
    if (!target || Date.now() >= pressedAt + expiresAfter) return false;

    // Use the existing channel for the linked Instagram tab. The message only
    // permits the exact visible dashboard to offer its live operation token.
    const channel = new BroadcastChannel('instagram-fluxo-queue:' + target.link);
    const commandId = crypto.randomUUID();
    const address = { commandId, windowId: sourceTab.windowId, dashboardTabId: target.tabId };
    let timeout;
    try {
      const candidate = await new Promise(resolve => {
        timeout = setTimeout(() => resolve(null), Math.max(0, pressedAt + expiresAfter - Date.now()));
        channel.addEventListener('message', ({ data }) => {
          if (data?.type === 'shortcut-candidate' && data.commandId === commandId && data.pressedAt === pressedAt &&
              data.dashboardTabId === target.tabId && typeof data.dashboardId === 'string' && typeof data.runId === 'string') resolve(data);
        });
        channel.postMessage({ type: 'shortcut-probe', ...address, pressedAt });
      });
      if (!candidate || Date.now() >= pressedAt + expiresAfter) return false;
      const stillTarget = await currentTarget(sourceTab);
      if (!stillTarget || stillTarget.documentId !== target.documentId || stillTarget.link !== target.link ||
          Date.now() >= pressedAt + expiresAfter) return false;

      channel.postMessage({ type: 'shortcut-stop', ...address, dashboardId: candidate.dashboardId, runId: candidate.runId });
      return true;
    } finally {
      clearTimeout(timeout);
      channel.close();
    }
  }

  chrome.commands?.onCommand.addListener((command, tab) => { void handle(command, tab).catch(() => {}); });
  return Object.freeze({ handle });
})();
