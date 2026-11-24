'use strict';

const profileCleaner = (() => {
  const prefix = 'instagramFluxoCleaner:v1:';
  const limit = 100000;
  const pageSize = 200;
  const sources = new Set(['scan', 'archive', 'local']);
  const outcomes = new Set(['waiting', 'started', 'unfollowed', 'skipped', 'deferred', 'reconciled-skip']);
  const reasons = /^[a-z][a-z0-9-]{0,63}$/;
  let protectionSnapshot;

  function name(value) {
    const handle = typeof value === 'string' ? value.trim().replace(/^@/, '').toLowerCase() : '';
    if (!/^(?!\.{1,2}$)[a-z0-9._]{1,30}$/.test(handle)) throw new Error('Identificador de perfil inválido.');
    return handle;
  }

  function names(values, owner, max = limit) {
    if (!Array.isArray(values) || values.length > max) throw new Error('A lista excede o tamanho permitido.');
    const unique = [...new Set(values.map(name))];
    if (unique.includes(owner)) throw new Error('A conta conectada não pode fazer parte da lista.');
    return unique;
  }

  function text(value, max) {
    return instagramFluxoDiagnosticSchema.scrubText(value).slice(0, max);
  }

  function row(value, owner) {
    const username = name(value?.username);
    if (username === owner) throw new Error('A conta conectada não pode fazer parte do inventário.');
    const kind = value.kind === 'person' ? 'person' : ['business','company'].includes(value.kind) ? 'business' : 'unknown';
    return { username, label: text(value.label, 120), kind, reason: text(value.reason, 180) };
  }

  function mergeRow(previous, incoming) {
    if (!previous) return incoming;
    const classification = incoming.kind === 'person' || (incoming.kind !== 'unknown' && previous.kind !== 'person') ? incoming : previous;
    return { ...classification, label: incoming.label || previous.label };
  }

  function empty(owner) {
    return { schemaVersion: 1, owner, protectedNames: [], rows: [], expectedCount: null, complete: false,
      source: null, updatedAt: null, reviewed: [], job: null };
  }

  function archiveRows(state) {
    const known = new Map((state.priorRows ?? []).map(item => [item.username, item]));
    for (const entry of state.rows) known.set(entry.username, entry);
    return [...known.values()].slice(-limit);
  }

  async function read(rawOwner) {
    const owner = name(rawOwner);
    const key = prefix + owner;
    const stored = (await chrome.storage.local.get(key))[key];
    if (stored === undefined) return empty(owner);
    if (stored?.schemaVersion !== 1 || stored.owner !== owner || !Array.isArray(stored.rows) ||
      !Array.isArray(stored.protectedNames) || !Array.isArray(stored.reviewed) ||
      stored.protectedNames.length > limit || stored.protectedNames.some(handle => handle !== name(handle))) {
      throw new Error('Não foi possível validar a base da lista branca. As remoções estão pausadas.');
    }
    if (stored.source === 'scan' && !stored.scanId && Number.isSafeInteger(stored.expectedCount) &&
        stored.rows.length > stored.expectedCount) {
      // Older partial reads mixed rows from different sessions. Keep them for
      // recovery, but require a new read before offering them for review.
      return { ...stored, rows: [], priorRows: archiveRows(stored), complete: false };
    }
    return stored;
  }

  async function save(state) {
    await chrome.storage.local.set({ [prefix + state.owner]: state });
    return state;
  }

  function invalidateProtection() { protectionSnapshot = undefined; }

  function protectedForRemoval() {
    if (protectionSnapshot) return protectionSnapshot;
    const snapshot = (async () => {
      const keys = (await chrome.storage.local.getKeys()).filter(key => key.startsWith(prefix));
      const accounts = await chrome.storage.local.get(keys);
      const combined = new Set();
      for (const key of keys) {
        const state = accounts[key];
        if (state?.schemaVersion !== 1 || key !== prefix + state.owner || !Array.isArray(state.protectedNames) ||
            state.protectedNames.length > limit || state.protectedNames.some(handle => handle !== name(handle))) {
          throw new Error('Não foi possível validar todas as proteções. As remoções estão pausadas.');
        }
        for (const handle of state.protectedNames) combined.add(handle);
      }
      return combined;
    })();
    protectionSnapshot = snapshot;
    void snapshot.catch(() => { if (protectionSnapshot === snapshot) invalidateProtection(); });
    return snapshot;
  }

  chrome.storage.onChanged?.addListener((changes, area) => {
    if (area !== 'local') return;
    const changed = Object.entries(changes).some(([key, { oldValue, newValue }]) => {
      if (!key.startsWith(prefix)) return false;
      const before = oldValue?.protectedNames;
      const after = newValue?.protectedNames;
      return !Array.isArray(before) || !Array.isArray(after) || before.length !== after.length ||
        before.some((name, index) => name !== after[index]);
    });
    if (changed) invalidateProtection();
  });

  function seed(state, legacy) {
    if (state.updatedAt !== null || !legacy) return;
    const latest = legacy.database?.snapshots?.following;
    const lastComplete = legacy.database?.lastComplete?.following;
    const snapshot = latest ?? lastComplete;
    const rows = new Map();
    for (const username of snapshot?.usernames ?? []) {
      if (username !== state.owner) rows.set(username, row({ username }, state.owner));
    }
    if (!snapshot?.complete) {
      for (const entry of legacy.followHistory ?? []) {
        if (entry.status === 'following' && !['unfollowed','gone'].includes(entry.reviewState) && !rows.has(entry.username)) {
          rows.set(entry.username, row({ username: entry.username }, state.owner));
        }
      }
    }
    if (!snapshot && !rows.size) return;
    state.rows = [...rows.values()];
    state.expectedCount = snapshot?.expected ?? null;
    state.complete = snapshot?.complete === true && rows.size === state.expectedCount;
    state.source = 'local';
    state.updatedAt = snapshot?.collectedAt ?? Date.now();
  }

  function inventory(state, message) {
    const expected = message.expectedCount ?? null;
    if (expected !== null && (!Number.isSafeInteger(expected) || expected < 0 || expected > limit)) {
      throw new Error('A contagem de perfis é inválida.');
    }
    if (!Array.isArray(message.rows) || message.rows.length > limit) throw new Error('O inventário está inválido ou excede o limite.');
    const scoped = message.scanId !== undefined;
    if (scoped) {
      if (message.source !== 'scan' || typeof message.scanId !== 'string' || !/^[a-f0-9-]{36}$/i.test(message.scanId)) {
        throw new Error('A sessão de leitura é inválida.');
      }
      if (message.begin === true) {
        if (state.job?.status === 'pending') throw new Error('Finalize o lote salvo antes de ler a lista novamente.');
        state.priorRows = archiveRows(state);
        state.rows = [];
        state.scanId = message.scanId;
      } else if (state.scanId !== message.scanId) {
        throw new Error('Outra leitura substituiu esta sessão. Abra a lista atualizada.');
      }
    } else delete state.scanId;
    const older = new Map(state.rows.map(item => [item.username, item]));
    const incoming = new Map();
    for (const item of message.rows) {
      const entry = row(item, state.owner);
      incoming.set(entry.username, mergeRow(incoming.get(entry.username) ?? older.get(entry.username), entry));
    }
    const exact = message.complete === true && incoming.size === expected;
    if (message.replace === true && !exact) throw new Error('Uma leitura parcial não pode substituir o inventário salvo.');
    const merged = message.replace === true ? incoming : new Map([...older, ...incoming]);
    if (merged.size > limit) throw new Error('O inventário excede o limite de perfis.');
    state.rows = [...merged.values()];
    state.expectedCount = scoped ? expected : expected ?? state.expectedCount;
    state.complete = exact && merged.size === expected;
    state.source = sources.has(message.source) ? message.source : 'scan';
    state.updatedAt = Date.now();
  }

  function protect(state, message) {
    const username = name(message.username);
    if (username === state.owner || typeof message.protected !== 'boolean') throw new Error('A proteção solicitada é inválida.');
    if (message.protected) {
      if (state.protectedNames.length >= limit && !state.protectedNames.includes(username)) throw new Error('A lista branca atingiu o limite.');
      state.protectedNames = [...new Set([...state.protectedNames, username])];
    } else {
      state.protectedNames = state.protectedNames.filter(handle => handle !== username);
    }
  }

  function confirm(state, message) {
    if (state.job?.status === 'pending') throw new Error('Finalize ou descarte o lote salvo antes de confirmar outro.');
    const selected = names(message.usernames, state.owner, pageSize);
    const reviewed = names(message.reviewed ?? selected, state.owner, pageSize);
    const known = new Set(state.rows.map(item => item.username));
    const alreadyReviewed = new Set(state.reviewed);
    const allowed = new Set(reviewed);
    if (!reviewed.length || reviewed.some(handle => !known.has(handle) || alreadyReviewed.has(handle)) ||
      selected.some(handle => !allowed.has(handle))) {
      throw new Error('O lote mudou. Atualize a revisão e confirme os perfis da página atual.');
    }
    if (selected.some(handle => state.protectedNames.includes(handle))) {
      throw new Error('O lote inclui um perfil protegido. Atualize a revisão e confirme novamente.');
    }
    state.reviewed.push(...reviewed);
    state.job = selected.length ? {
      id: crypto.randomUUID(), selected, done: [], uncertain: [], uncertainAt: {}, outcomes: {}, reasons: {},
      status: 'pending', createdAt: Date.now(),
    } : null;
  }

  function liveJob(state, id) {
    if (!id || state.job?.id !== id || state.job.status !== 'pending') {
      const error = new Error('O lote salvo mudou. Abra a revisão novamente.');
      error.code = 'cleaner-job-changed';
      throw error;
    }
    return state.job;
  }

  function outcome(state, message) {
    const username = name(message.username);
    const status = message.status;
    if (!outcomes.has(status) || !state.job?.selected.includes(username) || state.job.id !== message.id) {
      throw new Error('O resultado não pertence ao lote salvo.');
    }
    const job = state.job;
    const done = job.done.includes(username);
    const uncertain = job.uncertain.includes(username);
    if (done && job.outcomes[username] === status) return;
    if (done || job.status !== 'pending' ||
      (['waiting','started'].includes(status) && uncertain) ||
      (status === 'reconciled-skip' && !uncertain)) {
      throw new Error('O perfil já foi processado ou aguarda conferência.');
    }
    const reason = typeof message.reason === 'string' && reasons.test(message.reason) ? message.reason : '';
    if (status === 'started' && state.protectedNames.includes(username)) denyProtected();
    job.outcomes = { ...job.outcomes, [username]: status };
    job.reasons = { ...job.reasons, [username]: reason };
    if (status === 'started' || status === 'deferred') {
      if (!uncertain) job.uncertain.push(username);
      job.uncertainAt = { ...job.uncertainAt, [username]: Date.now() };
    } else if (['unfollowed','skipped','reconciled-skip'].includes(status)) {
      job.uncertain = job.uncertain.filter(handle => handle !== username);
      delete job.uncertainAt[username];
      job.done.push(username);
      if (job.done.length === job.selected.length) job.status = 'complete';
    }
  }

  function discard(state, message) {
    const job = liveJob(state, message.id);
    if (job.uncertain.length) throw new Error('Confira os resultados pendentes antes de descartar o lote.');
    const unprocessed = new Set(job.selected.filter(handle => !job.done.includes(handle)));
    state.reviewed = state.reviewed.filter(handle => !unprocessed.has(handle));
    state.job = null;
  }

  function denyRemoval(code, message) {
    const error = new Error(message);
    error.code = code;
    throw error;
  }

  function denyProtected() {
    denyRemoval('unfollow-protected', 'Este perfil está protegido pela lista branca.');
  }

  async function check(message, phase = 'inspect') {
    const state = await read(message.owner);
    const username = name(message.username);
    if (username === state.owner) throw new Error('A conta conectada não pode ser removida.');
    const protectedProfile = state.protectedNames.includes(username) || (await protectedForRemoval()).has(username);
    if (phase !== 'inspect') {
      if (protectedProfile) denyProtected();
      if (message.cleanerJobId !== undefined) {
        const job = liveJob(state, message.cleanerJobId);
        const wrongState = phase === 'dispatch' ? job.outcomes[username] !== 'started' : job.uncertain.includes(username);
        if (!job.selected.includes(username) || job.done.includes(username) || wrongState) {
          denyRemoval('cleaner-job-changed', 'O perfil não está autorizado para remoção neste lote.');
        }
      }
    }
    return { protected: protectedProfile };
  }

  async function pendingAfter(owner, clearedAt) {
    const { job } = await read(owner);
    return job?.uncertain.some(username => job.uncertainAt[username] > clearedAt) === true;
  }

  async function handle(message, loadLegacy) {
    if (message.type === 'cleanerCheck') return check(message);
    const state = await read(message.owner);
    if (state.updatedAt === null && loadLegacy) seed(state, await loadLegacy());
    switch (message.type) {
      case 'cleanerRead': return state;
      case 'cleanerInventory': inventory(state, message); break;
      case 'cleanerProtect': protect(state, message); break;
      case 'cleanerConfirm': confirm(state, message); break;
      case 'cleanerOutcome': outcome(state, message); break;
      case 'cleanerDiscard': discard(state, message); break;
      default: throw new Error('Ação do Limpa Perfil não reconhecida.');
    }
    const saved = await save(state);
    if (message.type === 'cleanerProtect') invalidateProtection();
    return saved;
  }

  return { handle, check, pendingAfter, protectedForRemoval, invalidateProtection };
})();
