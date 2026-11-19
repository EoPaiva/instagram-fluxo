'use strict';

// Local pacing is an application preference, never an Instagram-approved rate.
// Attempts are committed before native dispatch; platform blocks require a user action to clear.
const actionPacing = (() => {
  const prefix = 'instagramFluxoActionPacing:v1:';
  const defaults = Object.freeze({ minDelaySeconds: 45, maxDelaySeconds: 90, batchSize: 10, batchPauseMinutes: 10 });
  const actions = new Set(['follow', 'unfollow']);
  const reasons = new Set(['unconfirmed-action', 'rate-limit', 'challenge']);
  const severity = { 'unconfirmed-action': 1, 'rate-limit': 2, challenge: 3 };
  const settingKeys = Object.keys(defaults);

  function integer(value, min, max, label) {
    if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(label + ' inválido.');
    return value;
  }

  function settings(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        Object.keys(value).some(key => !settingKeys.includes(key))) throw new Error('Configuração de ritmo inválida.');
    const result = {
      minDelaySeconds: integer(value.minDelaySeconds, 15, 3600, 'Intervalo mínimo'),
      maxDelaySeconds: integer(value.maxDelaySeconds, 15, 3600, 'Intervalo máximo'),
      batchSize: integer(value.batchSize, 1, 50, 'Tamanho do lote'),
      batchPauseMinutes: integer(value.batchPauseMinutes, 1, 240, 'Pausa entre lotes'),
    };
    if (result.maxDelaySeconds < result.minDelaySeconds) throw new Error('O intervalo máximo deve ser igual ou maior que o mínimo.');
    return result;
  }

  function time(value, label) {
    return integer(value, 0, Number.MAX_SAFE_INTEGER, label);
  }

  function empty(owner) {
    return { schemaVersion: 1, owner, settings: { ...defaults }, nextAt: 0, batchCount: 0,
      lastActionAt: null, lastAction: null, block: null, clearedAt: 0, updatedAt: Date.now() };
  }

  async function read(ownerValue) {
    const owner = requireUsername(ownerValue);
    const key = prefix + owner;
    const stored = (await chrome.storage.local.get(key))[key];
    if (stored === undefined) return empty(owner);
    if (!stored || stored.schemaVersion !== 1 || stored.owner !== owner) {
      throw new Error('Não foi possível verificar o ritmo salvo. Os dados foram preservados.');
    }
    const block = stored.block;
    if (block !== null && (!block || !reasons.has(block.reason))) throw new Error('O bloqueio local salvo é inválido.');
    if (stored.lastAction !== null && !actions.has(stored.lastAction)) throw new Error('A última ação salva é inválida.');
    return { schemaVersion: 1, owner, settings: settings(stored.settings),
      nextAt: time(stored.nextAt, 'Horário da próxima ação'),
      batchCount: integer(stored.batchCount, 0, 49, 'Contagem do lote'),
      lastActionAt: stored.lastActionAt === null ? null : time(stored.lastActionAt, 'Horário da última ação'),
      lastAction: stored.lastAction,
      block: block === null ? null : { reason: block.reason, at: time(block.at, 'Horário do bloqueio') },
      clearedAt: time(stored.clearedAt ?? 0, 'Horário da última liberação'),
      updatedAt: time(stored.updatedAt, 'Horário do salvamento') };
  }

  async function save(state) {
    state.updatedAt = Date.now();
    await chrome.storage.local.set({ [prefix + state.owner]: state });
  }

  function view(state) {
    return { settings: { ...state.settings }, nextAt: state.nextAt,
      waitMs: Math.max(0, state.nextAt - Date.now()), batchCount: state.batchCount,
      clearedAt: state.clearedAt,
      block: state.block ? { ...state.block } : null };
  }

  function rejectBlock(block) {
    if (!block) return;
    if (block.reason === 'unconfirmed-action') {
      const error = new Error('Uma ação anterior ficou sem resultado confirmado. Confira o perfil no Instagram e libere a fila pelo painel antes de tentar outra ação.');
      error.code = 'action-unconfirmed';
      throw error;
    }
    const challenge = block.reason === 'challenge';
    const error = new Error(challenge
      ? 'O Instagram pediu uma verificação. A fila está pausada até você resolver a solicitação no Instagram e retomar pelo painel.'
      : 'O Instagram limitou ações nesta conta. A fila está pausada. Retome pelo painel somente quando a função estiver disponível.');
    error.code = challenge ? 'platform-challenge' : 'platform-restricted';
    throw error;
  }

  function randomBetween(min, max) {
    const span = max - min + 1;
    const ceiling = 0x100000000 - (0x100000000 % span);
    const sample = new Uint32Array(1);
    do { crypto.getRandomValues(sample); } while (sample[0] >= ceiling);
    return min + sample[0] % span;
  }

  async function configure(message) {
    const state = await read(message.owner);
    const next = settings(message.settings);
    // Lowering settings cannot erase a previously scheduled delay or batch pause.
    const minimumNextAt = state.lastActionAt === null ? 0 : state.lastActionAt + next.minDelaySeconds * 1000;
    state.nextAt = Math.max(state.nextAt, minimumNextAt);
    state.settings = next;
    await save(state);
    return view(state);
  }

  async function commit(message) {
    if (!actions.has(message.action)) throw new Error('Tipo de ação inválido para o ritmo.');
    const state = await read(message.owner);
    rejectBlock(state.block);
    const now = Date.now();
    if (now < state.nextAt) {
      const error = new Error('Aguarde o intervalo salvo antes da próxima ação.');
      error.code = 'action-wait';
      error.notBefore = state.nextAt;
      throw error;
    }
    const delay = randomBetween(state.settings.minDelaySeconds * 1000, state.settings.maxDelaySeconds * 1000);
    let count = state.batchCount + 1;
    const batchPause = count >= state.settings.batchSize ? state.settings.batchPauseMinutes * 60000 : 0;
    if (batchPause) count = 0;
    state.batchCount = count;
    state.lastActionAt = now;
    state.lastAction = message.action;
    state.nextAt = now + delay + batchPause;
    await save(state);
    // A permit expires before another minimum-interval permit can become available.
    // Native dispatch treats clickBy as a strict deadline and never reuses the permit.
    return { ...view(state), clickBy: now + Math.min(30000, state.settings.minDelaySeconds * 1000) };
  }

  async function block(message) {
    if (!reasons.has(message.reason)) throw new Error('Motivo de pausa inválido.');
    const state = await read(message.owner);
    if (!state.block) state.block = { reason: message.reason, at: Date.now() };
    else if (severity[message.reason] > severity[state.block.reason]) state.block.reason = message.reason;
    await save(state);
    return view(state);
  }

  async function clear(message) {
    const state = await read(message.owner);
    state.block = null;
    state.clearedAt = Date.now();
    await save(state);
    return view(state);
  }

  async function handle(message) {
    switch (message.type) {
      case 'pacingRead': return view(await read(message.owner));
      case 'pacingConfigure': return configure(message);
      case 'pacingCommit': return commit(message);
      case 'pacingBlock': return block(message);
      case 'pacingClear': return clear(message);
      default: throw new Error('Ação de ritmo não reconhecida.');
    }
  }

  return { handle };
})();
