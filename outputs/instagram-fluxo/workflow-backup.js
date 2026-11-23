'use strict';

const workflowBackup = (() => {
  const format = 'instagram-fluxo-workflow-v1';
  const historyKey = 'instagramFluxoReviewState';
  const databasePrefix = 'instagramFluxoDatabase:v1:';
  const indexedPrefix = 'instagramFluxoDatabase:v2:';
  const cleanerPrefix = 'instagramFluxoCleaner:v1:';
  const maxProfiles = 100000;
  const maxRuns = 10000;
  const maxBatch = 200;
  const historyStatuses = new Set(['following', 'requested']);
  const reviewStatuses = new Set(['pending', 'kept', 'gone', 'unfollowed']);
  const runStatuses = new Set(['running', 'paused', 'completed', 'interrupted', 'error']);
  const runKinds = new Set(['follow', 'unfollow-all', 'review']);
  const runModes = new Set(['automatic', 'manual']);
  const runPhases = new Set(['idle', 'waiting', 'dispatching']);
  const cleanerDone = new Set(['unfollowed', 'skipped', 'reconciled-skip']);
  const cleanerUncertain = new Set(['started', 'deferred']);

  function invalid() {
    throw new Error('O arquivo de backup contém dados inválidos ou incompatíveis.');
  }

  function object(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
    return value;
  }

  function array(value, max = maxProfiles) {
    if (!Array.isArray(value) || value.length > max) invalid();
    return value;
  }

  function name(value) {
    const normalized = typeof value === 'string' ? value.trim().replace(/^@/, '').toLowerCase() : '';
    if (!/^(?!\.{1,2}$)[a-z0-9._]{1,30}$/.test(normalized)) invalid();
    return normalized;
  }

  function names(value, owner, max) {
    const result = [...new Set(array(value, max).map(name))];
    if (result.includes(owner)) invalid();
    return result;
  }

  function integer(value, max = maxProfiles) {
    if (!Number.isSafeInteger(value) || value < 0 || value > max) invalid();
    return value;
  }

  function date(value, now) {
    if (!value) invalid();
    return integer(value, now + 60000);
  }

  function identifier(value) {
    if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(value)) invalid();
    return value;
  }

  function uniqueBy(items, key) {
    if (new Set(items.map(item => item[key])).size !== items.length) invalid();
    return items;
  }

  function parseHistory(value, owner, now) {
    const entry = object(value);
    if (name(entry.owner) !== owner || !historyStatuses.has(entry.status)) invalid();
    const username = name(entry.username);
    if (username === owner) invalid();
    return { owner, username, status: entry.status, followedAt: date(entry.followedAt, now),
      reviewState: reviewStatuses.has(entry.reviewState) ? entry.reviewState : 'pending',
      ...(entry.reviewedAt != null ? { reviewedAt: date(entry.reviewedAt, now) } : {}) };
  }

  function uncertaintyDates(profiles, rawTimes, fallback, now) {
    const times = object(rawTimes ?? {});
    return Object.fromEntries(profiles.map(profile => [profile, date(Object.hasOwn(times, profile) ? times[profile] : fallback, now)]));
  }

  function parseRun(value, owner, now) {
    const run = object(value);
    const mode = run.mode ?? 'automatic';
    const phase = run.phase ?? (run.current ? 'dispatching' : 'idle');
    const startedAt = date(run.startedAt, now);
    const dispatchAt = run.dispatchAt ? date(run.dispatchAt, now) : 0;
    const current = run.current == null ? null : name(run.current);
    if (!runStatuses.has(run.status) || !runKinds.has(run.kind) || !runModes.has(mode) || !runPhases.has(phase) ||
        current === owner || (run.aiMode !== undefined && typeof run.aiMode !== 'boolean') ||
        (run.followerFallback !== undefined && typeof run.followerFallback !== 'boolean')) invalid();
    const uncertain = names(run.uncertain ?? [], owner);
    const uncertainNames = new Set(uncertain);
    const continuedUncertain = names(run.continuedUncertain ?? [], owner);
    if (continuedUncertain.some(profile => !uncertainNames.has(profile)) ||
        (continuedUncertain.length && (run.kind !== 'follow' || mode !== 'automatic'))) invalid();
    return { id: identifier(run.id), kind: run.kind, mode, status: run.status, phase, current, startedAt, dispatchAt,
      updatedAt: date(run.updatedAt ?? startedAt, now),
      target: integer(run.target ?? 0), processed: integer(run.processed ?? 0), followed: integer(run.followed ?? 0),
      requested: integer(run.requested ?? 0), skipped: integer(run.skipped ?? 0), decisions: integer(run.decisions ?? 0, 80),
      aiMode: run.aiMode === true, followerFallback: run.followerFallback === true, queue: names(run.queue ?? [], owner),
      completed: names(run.completed ?? [], owner), uncertain, continuedUncertain,
      uncertainAt: uncertaintyDates(uncertain, run.uncertainAt, dispatchAt || startedAt, now),
      references: names(run.references ?? [], owner, 20) };
  }

  function parseCleanerJob(value, owner, now) {
    if (value == null) return null;
    const job = object(value);
    const selected = names(job.selected, owner, maxBatch);
    const done = names(job.done ?? [], owner, maxBatch);
    const uncertain = names(job.uncertain ?? [], owner, maxBatch);
    const selectedNames = new Set(selected);
    const doneNames = new Set(done);
    if (!selected.length || done.some(profile => !selectedNames.has(profile)) ||
        uncertain.some(profile => doneNames.has(profile) || !selectedNames.has(profile)) ||
        (done.length === selected.length ? job.status !== 'complete' : job.status !== 'pending')) invalid();
    const createdAt = date(job.createdAt, now);
    const source = object(job.outcomes ?? {});
    const outcomes = Object.fromEntries([
      ...done.map(profile => [profile, Object.hasOwn(source, profile) && cleanerDone.has(source[profile]) ? source[profile] : 'skipped']),
      ...uncertain.map(profile => [profile, Object.hasOwn(source, profile) && cleanerUncertain.has(source[profile]) ? source[profile] : 'deferred']),
    ]);
    return { id: identifier(job.id), selected, done, uncertain, outcomes, reasons: {}, status: job.status, createdAt,
      uncertainAt: uncertaintyDates(uncertain, job.uncertainAt, createdAt, now) };
  }

  function unpack(rawOwner, value, now = Date.now()) {
    const owner = name(rawOwner);
    const backup = object(value);
    if (name(backup.owner) !== owner) throw new Error('Este backup pertence a outra conta do Instagram.');
    const legacy = backup.format === 'instagram-fluxo-local-v1';
    if (!legacy && backup.format !== format) invalid();
    if (legacy && (name(backup.database?.owner) !== owner || (backup.cleaner && name(backup.cleaner.owner) !== owner))) {
      throw new Error('Este backup pertence a outra conta do Instagram.');
    }
    const exportedAt = date(backup.exportedAt, now);
    return { format, owner, exportedAt,
      history: uniqueBy(array(legacy ? backup.followHistory : backup.history).map(entry => parseHistory(entry, owner, now)), 'username'),
      whitelist: names(legacy ? backup.cleaner?.protectedNames ?? [] : backup.whitelist, owner),
      runs: uniqueBy(array(legacy ? backup.database?.runs : backup.runs, maxRuns).map(run => parseRun(run, owner, now)), 'id'),
      cleanerJob: parseCleanerJob(legacy ? backup.cleaner?.job : backup.cleanerJob, owner, now),
    };
  }

  function overview(data) {
    return { owner: data.owner, exportedAt: data.exportedAt, historyCount: data.history.length,
      whitelistCount: data.whitelist.length, runCount: data.runs.length, hasCleanerJob: Boolean(data.cleanerJob) };
  }

  async function local(owner, now) {
    const legacyKey = databasePrefix + owner;
    const indexKey = indexedPrefix + owner;
    const cleanerKey = cleanerPrefix + owner;
    const saved = await chrome.storage.local.get([historyKey, legacyKey, indexKey, cleanerKey]);
    const workflowKey = saved[indexKey] === undefined ? legacyKey : indexKey;
    const workflow = saved[workflowKey] ?? { schemaVersion: 1, owner, createdAt: now, updatedAt: now, candidates: [],
      snapshots: { followers: null, following: null }, lastComplete: { followers: null, following: null }, runs: [], events: [] };
    const cleaner = saved[cleanerKey] ?? { schemaVersion: 1, owner, protectedNames: [], rows: [], expectedCount: null,
      complete: false, source: null, updatedAt: null, reviewed: [], job: null };
    const history = saved[historyKey] ?? { entries: [], job: null };
    if (workflow.schemaVersion !== 1 || workflow.owner !== owner || !Array.isArray(workflow.runs) ||
        !Array.isArray(workflow.candidates) || !Array.isArray(workflow.events) || !workflow.snapshots || !workflow.lastComplete ||
        cleaner.schemaVersion !== 1 || cleaner.owner !== owner || !Array.isArray(cleaner.protectedNames) ||
        !Array.isArray(cleaner.rows) || !Array.isArray(cleaner.reviewed) || !Array.isArray(history.entries)) {
      throw new Error('A base local precisa de uma versão compatível para fazer ou restaurar este backup.');
    }
    return { workflowKey, cleanerKey, workflow, cleaner, history };
  }

  function pendingRun(run) {
    return [...new Set([...(run.uncertain ?? []), ...(run.phase === 'dispatching' && run.current ? [run.current] : [])])];
  }

  function mergeRun(current, incoming, now) {
    if (current && current.kind !== incoming.kind) throw new Error('O backup contém uma fila incompatível com o histórico local.');
    const base = current ?? incoming;
    const completed = [...new Set([...(base.completed ?? []), ...incoming.completed])];
    const terminal = new Set(completed);
    const confirmed = new Set(base.continuedUncertain ?? []);
    const previous = new Set(current ? pendingRun(current) : []);
    const confirmedInBackup = new Set(incoming.continuedUncertain);
    const incomingPending = pendingRun(incoming).filter(profile => !confirmedInBackup.has(profile));
    const uncertain = [...new Set([...previous, ...incoming.uncertain, ...incomingPending])].filter(profile => !terminal.has(profile));
    const uncertainNames = new Set(uncertain);
    const continuedUncertain = [...confirmed].filter(profile => uncertainNames.has(profile));
    const uncertainAt = Object.fromEntries(uncertain.map(profile => [profile,
      previous.has(profile) ? (current.uncertainAt?.[profile] || current.dispatchAt || current.startedAt) : now]));
    const needsReview = uncertain.some(profile => !confirmed.has(profile));
    array(completed);
    array(uncertain);
    const restored = { ...base, completed, uncertain, continuedUncertain, uncertainAt };
    if (!current || base.status === 'running') Object.assign(restored, { current: null, phase: 'idle', dispatchAt: 0 });
    if (base.status === 'running' || needsReview && base.status === 'completed') restored.status = 'interrupted';
    if (!current) restored.reason = restored.status === 'completed' ? '' : 'Fila restaurada. Confira o progresso antes de retomar.';
    return restored;
  }

  function mergeCleaner(current, incoming, now) {
    if (!incoming) return current;
    if (current && current.id !== incoming.id && current.status === 'pending') {
      if (incoming.status !== 'pending') return current;
      throw new Error('Já existe um lote pendente no Limpa Perfil. Conclua ou descarte o lote atual antes de restaurar outro.');
    }
    if (current && current.id !== incoming.id && incoming.status === 'complete') return current;
    if (!current || current.id !== incoming.id) return { ...incoming,
      uncertainAt: Object.fromEntries(incoming.uncertain.map(profile => [profile, now])) };
    if (current.selected.length !== incoming.selected.length || incoming.selected.some(profile => !current.selected.includes(profile))) {
      throw new Error('O lote do backup não corresponde ao lote local.');
    }
    const done = [...new Set([...current.done, ...incoming.done])];
    const finished = new Set(done);
    const uncertain = [...new Set([...current.uncertain, ...incoming.uncertain])].filter(profile => !finished.has(profile));
    const outcomes = Object.fromEntries([
      ...done.map(profile => [profile, current.done.includes(profile) ? current.outcomes[profile] : incoming.outcomes[profile]]),
      ...uncertain.map(profile => [profile, current.uncertain.includes(profile) ? current.outcomes[profile] : incoming.outcomes[profile]]),
    ]);
    return { ...current, done, uncertain, outcomes, status: done.length === current.selected.length ? 'complete' : 'pending',
      uncertainAt: Object.fromEntries(uncertain.map(profile => [profile, current.uncertain.includes(profile) ? current.uncertainAt[profile] : now])) };
  }

  function mergeQueues(current, imported) {
    const latestFollow = runs => runs.findLast(run => run.kind === 'follow');
    const canResume = run => run && run.mode !== 'manual' && run.status !== 'completed' &&
      run.followed + run.requested < run.target;
    const fromBackup = latestFollow(imported);
    // The reader considers the last follow run the candidate for Resume. A local
    // resumable run keeps priority. Otherwise expose a restorable backup run.
    return canResume(fromBackup) && !canResume(latestFollow(current))
      ? [...imported.filter(run => run !== fromBackup), ...current, fromBackup]
      : [...imported, ...current];
  }

  async function exportBackup(rawOwner) {
    const owner = name(rawOwner);
    const exportedAt = Date.now();
    const { workflow, cleaner, history } = await local(owner, exportedAt);
    return unpack(owner, { format, owner, exportedAt, history: history.entries.filter(entry => entry?.owner === owner),
      whitelist: cleaner.protectedNames, runs: workflow.runs, cleanerJob: cleaner.job }, exportedAt);
  }

  async function restore(rawOwner, value) {
    const now = Date.now();
    const incoming = unpack(rawOwner, value, now);
    const { owner } = incoming;
    const { workflowKey, cleanerKey, workflow, cleaner, history } = await local(owner, now);
    const job = mergeCleaner(cleaner.job, incoming.cleanerJob, now);
    const protectedNames = [...new Set([...cleaner.protectedNames, ...incoming.whitelist])];
    const reviewed = [...new Set([...cleaner.reviewed, ...(job?.selected ?? [])])];
    array(protectedNames);
    array(reviewed);
    const imports = new Map(incoming.runs.map(run => [run.id, run]));
    const runs = workflow.runs.map(run => {
      const backupRun = imports.get(run.id);
      imports.delete(run.id);
      return backupRun ? mergeRun(run, backupRun, now) : run;
    });
    const combined = mergeQueues(runs, Array.from(imports.values(), run => mergeRun(null, run, now)));
    array(combined, maxRuns);
    const existingNames = new Set(history.entries.filter(entry => entry?.owner === owner).map(entry => entry.username));
    const restoredHistory = incoming.history.filter(entry => !existingNames.has(entry.username));
    array([...existingNames, ...restoredHistory]);

    // One write, even for legacy owners. Writing a new indexed key here would skip
    // migration of their existing candidates; only the normal reader can do that.
    await chrome.storage.local.set({ [historyKey]: { ...history, entries: [...history.entries, ...restoredHistory] },
      [workflowKey]: { ...workflow, runs: combined, updatedAt: now },
      [cleanerKey]: { ...cleaner, protectedNames, reviewed, job } });
    return overview(incoming);
  }

  return { export: exportBackup, preview: (owner, value) => overview(unpack(owner, value)), restore };
})();
