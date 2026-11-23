'use strict';

// This database contains account workflow data only. The provider vault uses its own storage.
const localDatabase = (() => {
  const prefix = 'instagramFluxoDatabase:v1:';
  const indexedPrefix = 'instagramFluxoDatabase:v2:';
  const sessionKey = 'instagramFluxoDatabaseBrowserSession';
  const useIndex = typeof globalThis.indexedDB !== 'undefined';
  let candidateIndex;
  let sessionPromise;
  const limit = { names: 100000, candidates: 50000, runs: 10000, events: 100000 };
  const relations = new Set(['followers', 'following']);
  const runKinds = new Set(['follow', 'unfollow-all', 'review']);
  const runStatuses = new Set(['running', 'paused', 'completed', 'interrupted', 'error']);
  const eventActions = new Set(['follow', 'unfollow', 'review', 'discovery', 'snapshot', 'run']);
  const eventStatuses = new Set(['following', 'requested', 'unfollowed', 'kept', 'gone', 'pending',
    'started', 'completed', 'paused', 'interrupted', 'error', 'skipped', 'uncertain']);

  function name(value) {
    if (typeof value !== 'string') throw new Error('Perfil inválido na base local.');
    const normalized = value.trim().replace(/^@/, '').toLowerCase();
    if (!/^(?!\.{1,2}$)[a-z0-9._]{1,30}$/.test(normalized)) throw new Error('Perfil inválido na base local.');
    return normalized;
  }

  function text(value, max = 240) {
    return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max)
      .replace(/\b(?:sk-(?:proj-|ant-)?[a-z0-9_-]{12,}|AIza[a-z0-9_-]{20,})\b/gi, '[chave removida]')
      .replace(/\bBearer\s+\S+/gi, 'Bearer [removido]') : '';
  }

  function integer(value, fallback = 0, max = Number.MAX_SAFE_INTEGER) {
    if (value === undefined) return fallback;
    if (!Number.isSafeInteger(value) || value < 0 || value > max) throw new Error('Contagem inválida na base local.');
    return value;
  }

  function avatarUrl(value) {
    if (typeof value !== 'string' || value.length > 2048 || /[\u0000-\u0020\u007f\\]/.test(value)) return '';
    try {
      const url = new URL(value);
      const allowed = ['cdninstagram.com', 'fbcdn.net'].some(host => url.hostname === host || url.hostname.endsWith('.' + host));
      return url.protocol === 'https:' && !url.username && !url.password && !url.port && allowed && url.href.length <= 2048 ? url.href : '';
    } catch { return ''; }
  }

  function timestamp(value, fallback) {
    const time = integer(value, fallback);
    if (time <= 0 || time > Date.now() + 60000) throw new Error('Data inválida na base local.');
    return time;
  }

  function names(value, max = limit.names) {
    if (!Array.isArray(value) || value.length > max) throw new Error('Lista inválida ou grande demais para salvar.');
    return [...new Set(value.map(name))];
  }

  function empty(owner) {
    const now = Date.now();
    return { schemaVersion: 1, owner, createdAt: now, updatedAt: now, candidates: [],
      snapshots: { followers: null, following: null }, lastComplete: { followers: null, following: null },
      runs: [], events: [] };
  }

  function browserSession() {
    sessionPromise ??= (async () => {
      const existing = (await chrome.storage.session.get(sessionKey))[sessionKey];
      if (typeof existing === 'string') return existing;
      const marker = crypto.randomUUID();
      await chrome.storage.session.set({ [sessionKey]: marker });
      return marker;
    })();
    return sessionPromise;
  }

  async function save(database) {
    database.updatedAt = Date.now();
    const key = (useIndex ? indexedPrefix : prefix) + database.owner;
    const stored = useIndex ? { ...database, candidates: [] } : database;
    await chrome.storage.local.set({ [key]: stored });
  }

  function index() {
    if (!candidateIndex) {
      if (typeof globalThis.Dexie !== 'function') throw new Error('O índice de perfis não está disponível. A base antiga foi preservada.');
      candidateIndex = new globalThis.Dexie('instagramFluxoCandidates');
      candidateIndex.version(1).stores({ candidates: '[owner+username], owner', migrations: 'owner' });
    }
    return candidateIndex;
  }

  async function migrateCandidates(database) {
    const db = index();
    const { owner } = database;
    await db.transaction('rw', db.candidates, db.migrations, async () => {
      if (await db.migrations.get(owner)) return;
      const rows = database.candidates.map((item, order) => ({ owner, username: item.username, order, item }));
      if (rows.length) await db.candidates.bulkAdd(rows);
      await db.migrations.add({ owner });
    });
    // Keep the legacy owner document intact for rollback. Only switch keys once the index is committed.
    await save(database);
  }

  async function read(ownerValue, includeCandidates = false) {
    const owner = name(ownerValue);
    const indexedKey = indexedPrefix + owner;
    const active = useIndex ? (await chrome.storage.local.get(indexedKey))[indexedKey] : null;
    const legacyKey = prefix + owner;
    const stored = active ?? (await chrome.storage.local.get(legacyKey))[legacyKey] ?? empty(owner);
    if (stored.schemaVersion !== 1 || stored.owner !== owner || !Array.isArray(stored.runs) ||
      !Array.isArray(stored.events) || !Array.isArray(stored.candidates) || !stored.snapshots || !stored.lastComplete) {
      throw new Error('A base local precisa de uma versão compatível da extensão. Os dados foram preservados.');
    }
    if (useIndex && !active) await migrateCandidates(stored);
    const session = await browserSession();
    let changed = false;
    for (const run of stored.runs) {
      if (run.status === 'running' && (run.workerSession !== session || Date.now() - run.updatedAt > 5 * 60000)) {
        run.status = 'interrupted';
        run.reason = 'A sessão foi interrompida. Retome a fila pelo painel.';
        run.updatedAt = Date.now();
        changed = true;
      }
    }
    if (changed) await save(stored);
    if (useIndex && includeCandidates) {
      const rows = await index().candidates.where('owner').equals(owner).sortBy('order');
      return { ...stored, candidates: rows.map(row => row.item) };
    }
    return stored;
  }

  function candidate(value, owner, now) {
    const username = name(value?.username);
    if (username === owner) return null;
    return { username, sourceProfiles: names(value.sourceProfiles ?? [], 20),
      suggestionProfiles: names(value.suggestionProfiles ?? [], 20),
      reason: text(value.reason), label: text(value.label, 120), avatarUrl: avatarUrl(value.avatarUrl),
      alreadyFollows: value.alreadyFollows === true, firstSeenAt: now, lastSeenAt: now };
  }

  function incomingCandidates(database, message) {
    if (!Array.isArray(message.candidates) || message.candidates.length > limit.candidates) {
      throw new Error('Lista de sugestões inválida ou grande demais para salvar.');
    }
    const now = Date.now();
    return message.candidates.map(value => candidate(value, database.owner, now)).filter(Boolean);
  }

  function mergeCandidate(previous, item) {
    if (!previous) return item;
    item.firstSeenAt = previous.firstSeenAt;
    item.sourceProfiles = [...new Set([...previous.sourceProfiles, ...item.sourceProfiles])];
    item.suggestionProfiles = [...new Set([...previous.suggestionProfiles, ...item.suggestionProfiles])];
    item.alreadyFollows ||= previous.alreadyFollows;
    item.reason ||= previous.reason;
    item.label ||= previous.label;
    item.avatarUrl ||= avatarUrl(previous.avatarUrl);
    if (previous.lastAction) {
      item.lastAction = previous.lastAction;
      item.lastActionAt = previous.lastActionAt;
      item.reviewAt = previous.reviewAt;
    }
    return item;
  }

  function checkCandidateCount(count) {
    if (count > limit.candidates) throw new Error('A biblioteca local atingiu 50 mil perfis. Exporte os dados antes de continuar.');
  }

  async function putCandidates(database, message) {
    // Retain previously discovered profiles; an empty search never erases the account library.
    const candidates = incomingCandidates(database, message);
    const { owner } = database;
    if (useIndex) {
      const db = index();
      await db.transaction('rw', db.candidates, async () => {
        const existing = await db.candidates.bulkGet(candidates.map(item => [owner, item.username]));
        const updates = new Map(existing.filter(Boolean).map(row => [row.username, row]));
        let count = await db.candidates.where('owner').equals(owner).count();
        for (const item of candidates) {
          const previous = updates.get(item.username);
          updates.set(item.username, { owner, username: item.username, order: previous?.order ?? count++,
            item: mergeCandidate(previous?.item, item) });
        }
        checkCandidateCount(count);
        if (updates.size) await db.candidates.bulkPut([...updates.values()]);
      });
      return;
    }
    const byName = new Map(database.candidates.map(item => [item.username, item]));
    for (const item of candidates) byName.set(item.username, mergeCandidate(byName.get(item.username), item));
    checkCandidateCount(byName.size);
    database.candidates = [...byName.values()];
  }

  function putSnapshot(database, message) {
    if (!relations.has(message.relation) || typeof message.complete !== 'boolean') {
      throw new Error('Tipo de lista ou conclusão inválido.');
    }
    const usernames = names(message.usernames);
    const expected = integer(message.expected);
    if (usernames.length > expected || (message.complete && usernames.length !== expected)) {
      throw new Error('Uma lista completa deve conter todos os perfis da contagem informada.');
    }
    const snapshot = { usernames, complete: message.complete, expected,
      collectedAt: timestamp(message.collectedAt, Date.now()), savedAt: Date.now() };
    const previous = database.snapshots[message.relation];
    if (previous && snapshot.collectedAt < previous.collectedAt) throw new Error('Uma coleta mais recente já está salva.');
    database.snapshots[message.relation] = snapshot;
    // An older complete list is retained as historical evidence, never promoted to the new partial list.
    if (snapshot.complete) database.lastComplete[message.relation] = snapshot;
  }

  async function putRun(database, message) {
    const value = message.run;
    if (!value || !runKinds.has(value.kind) || !runStatuses.has(value.status) ||
      typeof value.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(value.id)) {
      throw new Error('Fila inválida na base local.');
    }
    const previous = database.runs.find(run => run.id === value.id);
    if (previous && previous.kind !== value.kind) throw new Error('O tipo de uma fila salva não pode mudar.');
    const now = Date.now();
    const phase = value.phase ?? previous?.phase ?? (value.current ? 'dispatching' : 'idle');
    if (!['idle', 'waiting', 'dispatching'].includes(phase)) throw new Error('Etapa de fila inválida.');
    const mode = value.mode ?? previous?.mode ?? 'automatic';
    if (!['automatic', 'manual'].includes(mode)) throw new Error('Modo de fila inválido.');
    const uncertain = names(value.uncertain ?? previous?.uncertain ?? []);
    const continuedUncertain = names([...(previous?.continuedUncertain ?? []), ...names(value.continuedUncertain ?? [])]);
    const uncertainNames = new Set(uncertain);
    if (continuedUncertain.some(username => !uncertainNames.has(username)) ||
        (continuedUncertain.length && (value.kind !== 'follow' || mode !== 'automatic'))) {
      throw new Error('Pendência de confirmação inválida na fila.');
    }
    const uncertaintyTimes = value.uncertainAt ?? previous?.uncertainAt ?? {};
    if (!uncertaintyTimes || typeof uncertaintyTimes !== 'object' || Array.isArray(uncertaintyTimes)) throw new Error('Datas de conferência inválidas.');
    const previousTimes = new Map(Object.entries(previous?.uncertainAt ?? {}));
    const suppliedTimes = new Map(Object.entries(uncertaintyTimes));
    const uncertainAt = Object.fromEntries(uncertain.map(username => [username,
      timestamp(previousTimes.get(username) ?? suppliedTimes.get(username) ?? (value.dispatchAt || previous?.dispatchAt || value.startedAt || previous?.startedAt), now)]));
    const run = { id: value.id, kind: value.kind, status: value.status, phase, mode,
      target: integer(value.target, previous?.target ?? 0, limit.names),
      processed: integer(value.processed, previous?.processed ?? 0, limit.names),
      followed: integer(value.followed, previous?.followed ?? 0, limit.names),
      requested: integer(value.requested, previous?.requested ?? 0, limit.names),
      skipped: integer(value.skipped, previous?.skipped ?? 0, limit.names),
      decisions: integer(value.decisions, previous?.decisions ?? 0, 80),
      aiMode: value.aiMode === undefined ? previous?.aiMode ?? false : value.aiMode,
      followerFallback: value.followerFallback === undefined ? previous?.followerFallback ?? false : value.followerFallback,
      current: value.current ? name(value.current) : null,
      dispatchAt: value.dispatchAt === undefined ? previous?.dispatchAt ?? 0 :
        value.dispatchAt === 0 ? 0 : timestamp(value.dispatchAt, now),
      queue: names(value.queue ?? previous?.queue ?? []),
      completed: names(value.completed ?? previous?.completed ?? []),
      uncertain, uncertainAt, continuedUncertain,
      references: names(value.references ?? previous?.references ?? [], 20),
      startedAt: timestamp(value.startedAt, previous?.startedAt ?? now),
      updatedAt: now, reason: text(value.reason), workerSession: await browserSession() };
    if (typeof run.aiMode !== 'boolean') throw new Error('O modo de IA da fila é inválido.');
    if (typeof run.followerFallback !== 'boolean') throw new Error('A origem dos perfis da fila é inválida.');
    if (previous) database.runs[database.runs.indexOf(previous)] = run;
    else {
      if (database.runs.length >= limit.runs) throw new Error('A base atingiu o limite de filas. Exporte os dados antes de continuar.');
      database.runs.push(run);
    }
  }

  function putEvent(database, message) {
    const value = message.event;
    if (!value || !eventActions.has(value.action) || !eventStatuses.has(value.status)) {
      throw new Error('Evento inválido na base local.');
    }
    if (database.events.length >= limit.events) throw new Error('A base atingiu o limite de eventos. Exporte os dados antes de continuar.');
    const reasonCode = value.reasonCode ?? '';
    if (typeof reasonCode !== 'string' || !/^[a-z0-9_-]{0,60}$/.test(reasonCode)) throw new Error('Código de evento inválido.');
    database.events.push({ id: crypto.randomUUID(), at: Date.now(), action: value.action,
      status: value.status, username: value.username ? name(value.username) : null, reasonCode });
  }

  function summary(database, followed = 0, candidateCount = database.candidates.length) {
    const latestFollow = [...database.runs].reverse().find(run => run.kind === 'follow');
    const relation = key => {
      const snapshot = database.snapshots[key];
      return { count: snapshot?.usernames.length ?? 0, complete: snapshot?.complete ?? false,
        expected: snapshot?.expected ?? null, collectedAt: snapshot?.collectedAt ?? null,
        lastCompleteAt: database.lastComplete[key]?.collectedAt ?? null };
    };
    return { owner: database.owner, updatedAt: database.updatedAt, candidates: candidateCount,
      followers: relation('followers'), following: relation('following'),
      runs: database.runs.length, events: database.events.length, followed,
      pendingRun: latestFollow && latestFollow.mode !== 'manual' && ['paused', 'interrupted', 'error', 'running'].includes(latestFollow.status) ? latestFollow : null };
  }

  async function update(message) {
    const database = await read(message.owner);
    if (message.kind === 'candidates') await putCandidates(database, message);
    else if (message.kind === 'snapshot') putSnapshot(database, message);
    else if (message.kind === 'run') await putRun(database, message);
    else if (message.kind === 'event') putEvent(database, message);
    else throw new Error('Dados não reconhecidos pela base local.');
    await save(database);
    const count = useIndex ? await index().candidates.where('owner').equals(database.owner).count() : database.candidates.length;
    return { summary: summary(database, 0, count) };
  }

  function historyRows(entries, owner) {
    return entries.filter(row => row.owner === owner).map(row => ({ owner, username: name(row.username),
      status: text(row.status, 24), followedAt: row.followedAt, reviewAt: row.reviewAt,
      reviewState: text(row.reviewState, 24), reviewedAt: row.reviewedAt ?? null,
      nextAttemptAt: row.nextAttemptAt ?? null, notifiedAt: row.notifiedAt ?? null }));
  }

  async function comparisonRows(owner) {
    const result = [];
    for (const host of ['www.instagram.com', 'instagram.com']) {
      const key = 'instagramComparison:' + host + ':' + owner;
      const value = (await chrome.storage.local.get(key))[key];
      if (!value || !Array.isArray(value.following) || !Array.isArray(value.checks)) continue;
      result.push({ host, counts: { followers: integer(value.counts?.followers), following: integer(value.counts?.following) },
        following: names(value.following), checks: value.checks.filter(row => Array.isArray(row) && row.length === 2)
          .map(([username, followsBack]) => [name(username), typeof followsBack === 'boolean' ? followsBack : null]),
        complete: value.complete === true, followersComplete: value.followersComplete === true,
        readFollowers: integer(value.readFollowers), startedAt: value.startedAt, savedAt: value.savedAt });
    }
    return result;
  }

  async function handle(message, entries = []) {
    if (message.type === 'databaseSave') return update(message);
    const database = await read(message.owner, true);
    const followHistory = historyRows(entries, database.owner);
    if (message.type === 'databaseRead') return { database, summary: summary(database, followHistory.length), followHistory };
    if (message.type === 'databaseExport') {
      // Deliberate allowlist: never export the storage container, vault, derived unlock key, or provider settings.
      return { format: 'instagram-fluxo-local-v1', exportedAt: Date.now(), owner: database.owner,
        database, followHistory, comparison: await comparisonRows(database.owner) };
    }
    throw new Error('Ação não reconhecida pela base local.');
  }

  async function recordFollow(entry) {
    const database = await read(entry.owner);
    const action = { lastAction: entry.status, lastActionAt: entry.followedAt, reviewAt: entry.reviewAt };
    if (useIndex) {
      const fields = Object.fromEntries(Object.entries(action).map(([key, value]) => ['item.' + key, value]));
      await index().candidates.update([database.owner, entry.username], fields);
    } else {
      const item = database.candidates.find(candidate => candidate.username === entry.username);
      if (item) Object.assign(item, action);
    }
    putEvent(database, { event: { action: 'follow', username: entry.username, status: entry.status, reasonCode: 'confirmed' } });
    await save(database);
  }

  async function getCandidate(owner, username) {
    const database = await read(owner);
    const normalized = name(username);
    if (useIndex) return (await index().candidates.get([database.owner, normalized]))?.item ?? null;
    return database.candidates.find(candidate => candidate.username === normalized) ?? null;
  }

  return { handle, readWorkflow: read, recordFollow, getCandidate };
})();
