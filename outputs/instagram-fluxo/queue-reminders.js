'use strict';

const queueReminders = (() => {
  const alarmName = 'instagram-fluxo-queue-reminder';
  const databasePrefixes = ['instagramFluxoDatabase:v2:', 'instagramFluxoDatabase:v1:'];
  const pacingPrefix = 'instagramFluxoActionPacing:v1:';
  const sessionKey = 'instagramFluxoDatabaseBrowserSession';
  const historyKey = 'instagramFluxoReviewState';
  const staleAfter = 5 * 60 * 1000;
  const minimumDelay = 30 * 1000;
  const kinds = new Set(['follow', 'unfollow-all']);
  const savedStatuses = new Set(['paused', 'interrupted', 'error']);
  let serial = Promise.resolve();

  function serialize(task) {
    const operation = serial.then(task);
    serial = operation.catch(() => {});
    return operation;
  }

  function latestRuns(database) {
    const latest = new Map();
    const runs = Array.isArray(database?.runs) ? database.runs : [];
    for (let index = runs.length - 1; index >= 0 && latest.size < kinds.size; index--) {
      const run = runs[index];
      if (kinds.has(run?.kind) && !latest.has(run.kind)) latest.set(run.kind, run);
    }
    return [...latest.values()];
  }

  function databaseOwner(key) {
    const prefix = databasePrefixes.find(candidate => key.startsWith(candidate));
    return prefix ? key.slice(prefix.length) : '';
  }

  function relevantChange(key, { oldValue, newValue }) {
    if (key.startsWith(pacingPrefix)) return oldValue?.clearedAt !== newValue?.clearedAt;
    if (!databaseOwner(key)) return false;
    const signature = database => latestRuns(database).map(run => [run.kind, run.id, run.status, run.phase,
      run.current, run.dispatchAt, run.uncertain, run.continuedUncertain, run.completed?.length]);
    return JSON.stringify(signature(oldValue)) !== JSON.stringify(signature(newValue));
  }

  function requiresCheck(run, clearedAt, confirmedFollows) {
    const isUnconfirmed = username => run.kind !== 'follow' || (confirmedFollows.get(username) ?? 0) < run.startedAt;
    if (run.phase === 'dispatching' && run.current && (run.dispatchAt || run.startedAt) > clearedAt &&
        !run.completed?.includes(run.current) && isUnconfirmed(run.current)) return true;
    const continued = new Set(run.continuedUncertain ?? []);
    return (run.uncertain ?? []).some(username => !continued.has(username) &&
      (run.uncertainAt?.[username] || run.dispatchAt || run.startedAt) > clearedAt && isUnconfirmed(username));
  }

  async function schedule(when) {
    if (!chrome.alarms?.get) return;
    const alarm = await chrome.alarms.get(alarmName);
    if (!Number.isFinite(when)) {
      if (alarm) await chrome.alarms.clear(alarmName);
      return;
    }
    const scheduled = Math.max(when, Date.now() + minimumDelay);
    if (!alarm || alarm.scheduledTime > scheduled) await chrome.alarms.create(alarmName, { when: scheduled });
  }

  function refresh() {
    return serialize(async () => {
      if (!chrome.storage.local.getKeys || !chrome.action?.setBadgeText) return;
      const keys = new Set(await chrome.storage.local.getKeys());
      const owners = new Set([...keys].map(databaseOwner).filter(Boolean));
      const databases = [...owners].map(owner => databasePrefixes.map(prefix => prefix + owner).find(key => keys.has(key)));
      const lookups = [historyKey, ...databases, ...[...owners].map(owner => pacingPrefix + owner).filter(key => keys.has(key))];
      const [data, session] = await Promise.all([chrome.storage.local.get(lookups), chrome.storage.session.get(sessionKey)]);
      const confirmedFollows = new Map();
      for (const entry of data[historyKey]?.entries ?? []) {
        if (!['following', 'requested'].includes(entry.status)) continue;
        if (!confirmedFollows.has(entry.owner)) confirmedFollows.set(entry.owner, new Map());
        confirmedFollows.get(entry.owner).set(entry.username, entry.followedAt);
      }
      const now = Date.now();
      let nextCheck = Infinity;
      let badge = '';
      const notifications = [];
      for (const key of databases) {
        const owner = databaseOwner(key);
        const clearedAt = data[pacingPrefix + owner]?.clearedAt ?? 0;
        for (const run of latestRuns(data[key])) {
          if (run.status === 'running' && typeof run.workerSession === 'string' && run.workerSession === session[sessionKey]) {
            const staleAt = run.updatedAt + staleAfter;
            if (staleAt > now) {
              nextCheck = Math.min(nextCheck, staleAt);
              continue;
            }
          }
          if (run.status !== 'running' && !savedStatuses.has(run.status)) continue;
          if (requiresCheck(run, clearedAt, confirmedFollows.get(owner) ?? new Map())) {
            badge = '!';
            notifications.push(queueNotifications.notify({ runId: run.id, status: 'attention' }).catch(() => {}));
          }
          else if (!badge && run.kind === 'follow' && run.mode !== 'manual' && run.followed + run.requested < run.target) badge = '1+';
        }
      }
      const title = badge === '!' ? 'Instagram Fluxo · Há uma ação para conferir' : badge ? 'Instagram Fluxo · Há fila salva' : 'Abrir Instagram Fluxo';
      await Promise.all([chrome.action.setBadgeText({ text: badge }), chrome.action.setTitle({ title }), schedule(nextCheck), ...notifications]);
    });
  }

  chrome.storage.onChanged?.addListener((changes, area) => {
    if (area === 'local' && Object.entries(changes).some(([key, change]) => relevantChange(key, change))) {
      void serialize(() => schedule(Date.now())).catch(() => {});
    }
  });
  chrome.alarms?.onAlarm?.addListener(alarm => {
    if (alarm.name === alarmName) void refresh().catch(() => {});
  });

  return { refresh };
})();
