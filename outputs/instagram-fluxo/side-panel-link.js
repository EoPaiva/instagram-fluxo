'use strict';

// Both endpoints are packaged extension pages. A stop targets the exact
// dashboard instance and operation that the side panel last displayed.
globalThis.instagramFluxoSideLink = (() => {
  const targetKey = windowId => 'instagramFluxoSideTarget:' + windowId;
  const queueChannel = tabId => new BroadcastChannel('instagram-fluxo-queue:' + tabId);
  const workspaceChannel = tabId => new BroadcastChannel('instagram-fluxo-workspace:' + tabId);
  const validTab = tabId => Number.isInteger(tabId) && tabId >= 0;
  const workspaceHashes = Object.freeze({ follow:'#seguir', unfollow:'#parar-de-seguir', whitelist:'#cleaner-protection' });
  const probeMs = 3000;
  const presenceMs = 10000;

  function createDashboard({ tabId, onStop }) {
    const dashboardId = crypto.randomUUID();
    const channel = validTab(tabId) ? queueChannel(tabId) : null;
    let windowId;
    let dashboardTabId;
    let attached = true;
    let snapshot = null;
    let lastSent = '';
    let stoppableSince = 0;
    let shortcutProbe;
    void chrome.tabs?.getCurrent?.().then(tab => {
      windowId = tab?.windowId;
      dashboardTabId = tab?.id;
      if (validTab(dashboardTabId)) {
        const navigation = workspaceChannel(dashboardTabId);
        navigation.addEventListener('message', ({ data: destination }) => {
          if (attached && Object.hasOwn(workspaceHashes, destination)) globalThis.instagramFluxoWorkspace?.open(destination, true);
        });
      }
      send();
    }).catch(() => {});
    chrome.tabs?.onAttached?.addListener((id, { newWindowId }) => {
      if (id === dashboardTabId) windowId = newWindowId;
    });

    function send() {
      if (attached) channel?.postMessage({ type: 'snapshot', dashboardId, dashboardTabId, snapshot });
    }

    channel?.addEventListener('message', ({ data }) => {
      if (!attached || !data || (data.dashboardId && data.dashboardId !== dashboardId) ||
          (data.dashboardTabId !== undefined && data.dashboardTabId !== dashboardTabId)) return;
      if (data.type === 'probe') send();
      if (data.type === 'shortcut-probe' && data.dashboardTabId === dashboardTabId && data.windowId === windowId &&
          typeof data.commandId === 'string' && Number.isSafeInteger(data.pressedAt) && snapshot?.canStop &&
          stoppableSince < data.pressedAt && data.pressedAt <= Date.now() && Date.now() < data.pressedAt + 1500) {
        shortcutProbe = { commandId: data.commandId, runId: snapshot.runId, pressedAt: data.pressedAt };
        channel.postMessage({ type: 'shortcut-candidate', dashboardId, dashboardTabId, ...shortcutProbe });
      }
      if (data.type === 'shortcut-stop' && data.dashboardId === dashboardId && data.windowId === windowId &&
          shortcutProbe && shortcutProbe.commandId === data.commandId && shortcutProbe.runId === data.runId &&
          snapshot?.canStop && snapshot.runId === data.runId && Date.now() < shortcutProbe.pressedAt + 1500) {
        shortcutProbe = undefined;
        onStop({ runId: data.runId });
        send();
      }
      if (data.type === 'stop' && data.dashboardId === dashboardId && snapshot?.canStop &&
          snapshot.runId === data.runId) {
        onStop({ runId: data.runId });
        send();
      }
    });

    globalThis.addEventListener('pagehide', () => {
      attached = false;
      shortcutProbe = undefined;
      channel?.postMessage({ type: 'detached', dashboardId, dashboardTabId });
    });
    globalThis.addEventListener('pageshow', () => { attached = true; send(); });

    return {
      publish(value) {
        if (!value?.canStop || !snapshot?.canStop || value.runId !== snapshot.runId) {
          shortcutProbe = undefined;
          stoppableSince = value?.canStop ? Date.now() : 0;
        }
        snapshot = value ? { ...value, tabId } : null;
        const next = JSON.stringify(snapshot);
        if (next === lastSent) return;
        lastSent = next;
        send();
      },
      open() {
        if (!chrome.sidePanel?.open || !Number.isInteger(windowId) || !validTab(dashboardTabId)) {
          return Promise.reject(new Error('Não foi possível abrir o painel lateral nesta janela do Chrome.'));
        }
        const opening = chrome.sidePanel.open({ windowId });
        const binding = chrome.storage.session.set({ [targetKey(windowId)]: { tabId, dashboardTabId } });
        return Promise.all([opening, binding]);
      },
    };
  }

  function createMonitor({ windowId, fallbackTabId, onUpdate }) {
    const key = targetKey(windowId);
    const peers = new Map();
    let channel;
    let binding;
    let displayed;
    let lastSnapshot;
    let closed = false;
    let lastView = '';
    let stopPending;

    function update() {
      const now = Date.now();
      for (const [id, peer] of peers) if (now - peer.at > presenceMs) peers.delete(id);
      const active = [...peers.values()].sort((a, b) => Number(b.snapshot.canStop) - Number(a.snapshot.canStop) || b.at - a.at);
      displayed = active[0];
      if (displayed) lastSnapshot = displayed.snapshot;
      if (stopPending && (stopPending.id !== displayed?.id || stopPending.runId !== displayed.snapshot.runId ||
          !displayed.snapshot.canStop || now >= stopPending.expiresAt)) stopPending = undefined;
      const view = lastSnapshot ? { ...lastSnapshot, canStop: Boolean(displayed?.snapshot.canStop && !stopPending), connected: Boolean(displayed) } : null;
      const next = JSON.stringify(view);
      if (next !== lastView) {
        lastView = next;
        onUpdate(view);
      }
    }

    function probe() {
      channel?.postMessage({ type: 'probe', dashboardTabId: binding?.dashboardTabId });
      update();
    }

    function bind(target) {
      const next = validTab(target?.dashboardTabId) ? target : { tabId: fallbackTabId };
      if (closed || (binding && binding.tabId === next.tabId && binding.dashboardTabId === next.dashboardTabId)) return;
      binding = next;
      channel?.close();
      channel = undefined;
      peers.clear();
      lastSnapshot = undefined;
      if (validTab(next.tabId)) {
        channel = queueChannel(next.tabId);
        const current = channel;
        current.addEventListener('message', ({ data }) => {
          if (closed || channel !== current || !data?.dashboardId ||
              (next.dashboardTabId !== undefined && data.dashboardTabId !== next.dashboardTabId)) return;
          if (data.type === 'snapshot' && data.snapshot?.tabId === next.tabId) {
            peers.set(data.dashboardId, { id: data.dashboardId, tabId: data.dashboardTabId, snapshot: data.snapshot, at: Date.now() });
          } else if (data.type === 'detached' || (data.type === 'snapshot' && !data.snapshot)) {
            peers.delete(data.dashboardId);
          }
          update();
        });
      }
      probe();
    }

    let changed = false;
    function bindingChanged(changes, area) {
      if (area !== 'session' || !Object.hasOwn(changes, key)) return;
      changed = true;
      bind(changes[key].newValue);
    }
    chrome.storage.onChanged?.addListener(bindingChanged);
    void chrome.storage.session.get(key).then(stored => { if (!changed) bind(stored[key]); }, () => { if (!changed) bind(); });
    const timer = setInterval(probe, probeMs);

    return {
      stop() {
        update();
        if (closed || !channel || !displayed?.snapshot.canStop || stopPending || !displayed.snapshot.runId) return false;
        const { id, snapshot } = displayed;
        stopPending = { id, runId: snapshot.runId, expiresAt: Date.now() + probeMs * 2 };
        channel.postMessage({ type: 'stop', dashboardId: id, runId: snapshot.runId });
        update();
        return true;
      },
      async openWorkspace(destination) {
        if (closed || !Object.hasOwn(workspaceHashes, destination)) return false;
        update();
        const mainUrl = new URL(chrome.runtime.getURL('dashboard.html'));
        const existingId = displayed?.tabId ?? binding?.dashboardTabId;
        const boundTab = validTab(existingId) ? await chrome.tabs.get(existingId).catch(() => null) : null;
        const existing = boundTab ?? (await chrome.tabs.query({ active:true, windowId }))[0];
        const currentUrl = existing?.url ? new URL(existing.url) : null;
        if (closed) return false;
        if (currentUrl?.protocol === mainUrl.protocol && currentUrl.host === mainUrl.host && currentUrl.pathname === mainUrl.pathname) {
          if (existing.windowId !== windowId) await chrome.windows.update(existing.windowId, { focused:true });
          if (existing.discarded || existing.status === 'loading') {
            currentUrl.hash = workspaceHashes[destination];
            await chrome.tabs.update(existing.id, { active:true, url:currentUrl.href });
          } else {
            await chrome.tabs.update(existing.id, { active:true });
            const navigation = workspaceChannel(existing.id);
            try { navigation.postMessage(destination); }
            finally { navigation.close(); }
          }
          return true;
        }
        const linkedId = binding?.tabId ?? fallbackTabId;
        if (validTab(linkedId)) {
          const linked = await chrome.tabs.get(linkedId).catch(() => null);
          const linkedUrl = linked?.url ? new URL(linked.url) : null;
          if (linked?.windowId === windowId && ['https://www.instagram.com', 'https://instagram.com'].includes(linkedUrl?.origin)) {
            mainUrl.searchParams.set('tab', String(linkedId));
          }
        }
        if (closed) return false;
        mainUrl.hash = workspaceHashes[destination];
        await chrome.tabs.create({ url:mainUrl.href, windowId });
        return true;
      },
      close() {
        closed = true;
        clearInterval(timer);
        chrome.storage.onChanged?.removeListener(bindingChanged);
        channel?.close();
      },
    };
  }

  return { createDashboard, createMonitor, workspaceHashes };
})();
