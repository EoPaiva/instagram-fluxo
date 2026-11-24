(() => {
  'use strict';

  const providers = {
    openai: { name: 'OpenAI', origin: 'https://api.openai.com/*' },
    gemini: { name: 'Google Gemini', origin: 'https://generativelanguage.googleapis.com/*' },
    openrouter: { name: 'OpenRouter', origin: 'https://openrouter.ai/*' },
    claude: { name: 'Claude', origin: 'https://api.anthropic.com/*' },
  };
  const instagramOrigin = 'https://www.instagram.com/*';
  const referencesKey = 'instagramFluxoAudienceReferences';
  const suggestionCheckPrefix = 'instagramFluxoSuggestionCheck:';
  const discoveryLogPrefix = 'instagramFluxoDiscoveryLog:';
  const discoveryLogLines = 60;
  const discoveryLogLineLength = 240;
  const tabParam = new URLSearchParams(location.search).get('tab');
  const tabId = tabParam && /^\d+$/.test(tabParam) && Number.isSafeInteger(Number(tabParam))
    ? Number(tabParam)
    : null;
  const $ = id => document.getElementById(id);
  const ui = {
    provider: $('provider'), model: $('model'), key: $('key'),
    configStatus: $('config-status'), providerOrder: $('provider-order'),
    providerSummary: $('provider-summary'), vaultForm: $('vault-form'), vaultHint: $('vault-hint'),
    vaultPassword: $('vault-password'), vaultConfirm: $('vault-confirm'), vaultConfirmLabel: $('vault-confirm-label'),
    vaultSubmit: $('vault-submit'), lockVault: $('lock-vault'),
    configForm: $('config-form'), profilePrompt: $('profile-prompt'), profileAnalysisStatus: $('profile-analysis-status'),
    profileResult: $('profile-result'), profileName: $('profile-name'), niche: $('niche'),
    loadProfile: $('load-profile'), analyze: $('analyze'), discover: $('discover'), follow: $('follow'), stop: $('stop'),
    refreshSuggestions: $('refresh-suggestions'), suggestionsStatus: $('suggestions-status'),
    automaticFollowForm: $('automatic-follow-form'), automaticFollowAmount: $('automatic-follow-amount'),
    automaticFollowSource: $('automatic-follow-source'),
    startAutomaticFollow: $('start-automatic-follow'), automaticFollowQuota: $('automatic-follow-quota'),
    referenceInputs: [$('reference-1'), $('reference-2'), $('reference-3')],
    saveReferences: $('save-references'), referenceStatus: $('reference-status'),
    searchBlock: $('search-block'), selectionCount: $('selection-count'), selectSuggestionBatch: $('select-suggestion-batch'),
    progress: $('progress-bar'), progressMeter: $('flow-progress-meter'), flowStatus: $('flow-status'),
    discoveryLog: $('discovery-log'), discoveryLogText: $('discovery-log-text'),
    discoveryLogStatus: $('discovery-log-status'), copyDiscoveryLog: $('copy-discovery-log'),
    recommendationSection: $('recommendation-section'), recommendations: $('recommendations'),
    history: $('history'), historyStatus: $('history-status'), refreshHistory: $('refresh-history'),
    historyDisclosure: $('history-disclosure'), historyViewport: $('history-viewport'),
    historyMeasure: $('history-row-measure'), historyCount: $('history-count'), historyKeys: $('history-keys'),
    unfollowAll: $('unfollow-all'), unfollowProfileRecovery: $('unfollow-profile-recovery'),
    localSummary: $('local-summary'), localUpdated: $('local-updated'), localStatus: $('local-data-status'),
    exportData: $('export-data'), refreshLocal: $('refresh-local-data'),
    resumeFollow: $('resume-follow'),
    openSidePanel: $('open-side-panel'), sidePanelError: $('side-panel-error'),
    aiMode: $('ai-mode'), aiModeStatus: $('ai-mode-status'),
    pacingMin: $('pacing-min-delay'), pacingMax: $('pacing-max-delay'),
    pacingBatch: $('pacing-batch-size'), pacingPause: $('pacing-batch-pause'),
    savePacing: $('save-pacing'), pacingStatus: $('pacing-status'),
    reportBlock: $('report-platform-block'), pacingBlock: $('pacing-block'),
    pacingBlockMessage: $('pacing-block-message'), resumeAfterBlock: $('resume-after-block'),
  };
  const dateFormat = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  const profilePattern = /^[a-z\d._]{1,30}$/i;
  const state = {
    providers: new Map(),
    vault: null,
    settingsGeneration: 0,
    profile: null,
    recommendations: [],
    selected: new Set(),
    operation: null,
    saving: false,
    quotaGeneration: 0,
    historyGeneration: 0,
    savingReferences: false,
    database: null,
    pendingRun: null,
    followedOnce: new Set(),
    pacing: null,
    pacingGeneration: 0,
    savingPacing: false,
    queueRun: null,
    queueCandidates: new Map(),
    queueResults: new Map(),
    followHistory: new Map(),
    queueNextAt: null,
    queueMessage: '',
    queueExecuting: false,
  };
  let cleanerPanel;
  let backupPanel;
  let lastSideResult;
  const sideLink = chrome.sidePanel?.open && globalThis.instagramFluxoSideLink?.createDashboard({ tabId,
    onStop: ({ runId }) => stopOperation(runId),
  });

  function sideUpcoming(run) {
    const candidates = run?.upcoming ?? run?.queue;
    if (!candidates?.length) return [];
    const seen = new Set([run.current, ...(run.completed ?? []), ...(run.uncertain ?? []), ...(run.references ?? []),
      state.profile?.username]);
    const followers = run.kind === 'follow' ? new Set(state.database?.snapshots?.followers?.usernames ?? []) : null;
    const upcoming = [];
    for (const value of candidates) {
      const name = cleanUsername(value);
      if (!name || seen.has(name) || (followers && (followers.has(name) || state.followedOnce.has(name) || state.queueCandidates.get(name)?.alreadyFollows))) continue;
      seen.add(name);
      upcoming.push(name);
      if (upcoming.length === 4) break;
    }
    return upcoming;
  }

  function sideFields(run) {
    return { current: run?.current ?? null, target: run?.target ?? 0, processed: run?.processed ?? 0,
      followed: run?.followed ?? 0, requested: run?.requested ?? 0, upcoming: sideUpcoming(run) };
  }

  function activeSideSnapshot() {
    const operation = state.operation;
    if (!operation?.stoppable) return null;
    if (operation.sideFinished) return operation.sideFinished;
    const run = operation.sideProgress ?? (state.queueRun?.id === operation.runId ? state.queueRun : null);
    const stopping = operation.signal.aborted;
    const phase = ['waiting', 'dispatching'].includes(run?.phase) ? run.phase : 'running';
    const status = stopping ? 'stopping' : run?.status && run.status !== 'running' ? run.status : phase;
    const canStop = !stopping && !['paused', 'completed', 'error'].includes(status);
    return { ...sideFields(run), runId: operation.stopToken, owner: cleanUsername(state.profile?.username), kind: operation.sideKind,
      status, message: ui.flowStatus.textContent, canStop };
  }

  function publishSideQueue() {
    if (!sideLink) return;
    const owner = cleanUsername(state.profile?.username);
    const active = activeSideSnapshot();
    if (active) { sideLink.publish(active); return; }
    if (lastSideResult?.owner === owner) { sideLink.publish(lastSideResult); return; }
    const run = owner ? state.queueRun : null;
    sideLink.publish({ ...sideFields(run), runId: run?.id ?? null, owner, kind: run?.kind ?? null,
      status: run?.status === 'running' ? 'interrupted' : run?.status ?? 'idle',
      message: run?.reason ? automaticFollowOutcomes[run.reason] || run.reason : '', canStop: false });
  }

  function updateSideProgress(progress) {
    if (!sideLink || !state.operation?.stoppable) return;
    state.operation.sideProgress = { ...sideFields(progress), phase: progress.phase, status: progress.status };
    publishSideQueue();
  }

  function avatarUrl(value) {
    if (typeof value !== 'string' || value.length > 2048 || /[\u0000-\u0020\u007f\\]/.test(value)) return '';
    try {
      const url = new URL(value);
      const allowed = ['cdninstagram.com', 'fbcdn.net'].some(host => url.hostname === host || url.hostname.endsWith('.' + host));
      return url.protocol === 'https:' && !url.username && !url.password && !url.port && allowed && url.href.length <= 2048 ? url.href : '';
    } catch { return ''; }
  }

  function rememberQueueCandidate(candidate) {
    const name = cleanUsername(candidate?.username);
    if (!name) return null;
    const previous = state.queueCandidates.get(name);
    const observed = { ...candidate, username: name, avatarUrl: avatarUrl(candidate.avatarUrl) || avatarUrl(previous?.avatarUrl) };
    state.queueCandidates.set(name, observed);
    return observed;
  }

  function renderQueue() {
    publishSideQueue();
    if (!globalThis.instagramQueueView) return;
    const owner = cleanUsername(state.profile?.username);
    const run = owner ? state.queueRun : null;
    const completed = new Set(run?.completed ?? []);
    const uncertain = new Set(run?.uncertain ?? []);
    const references = new Set(run?.references ?? []);
    const names = [...new Set([...(run?.queue ?? state.recommendations.map(row => row.username)), ...(run?.current ? [run.current] : [])])];
    const items = names.map(cleanUsername).filter(name => name && name !== owner && !references.has(name)).map(name => {
      const candidate = state.queueCandidates.get(name);
      const prior = state.followHistory.get(name);
      const recorded = run && prior?.followedAt >= run.startedAt ? prior.status : null;
      const result = state.queueResults.get(name) ?? recorded;
      let status = ['following', 'requested'].includes(result) ? result :
        uncertain.has(name) || (name === run?.current && run?.phase === 'dispatching' && run?.status !== 'running') ? 'uncertain' :
        completed.has(name) || state.followedOnce.has(name) || candidate?.alreadyFollows ? 'skipped' :
        name === run?.current ? (run.phase === 'dispatching' ? 'dispatching' : 'waiting') : 'pending';
      // A restored browser checkpoint cannot prove a dispatched action's outcome.
      if (!state.queueExecuting && ['waiting','dispatching'].includes(status)) status = status === 'dispatching' ? 'uncertain' : 'pending';
      return { username: name, label: candidate?.label || '', avatarUrl: avatarUrl(candidate?.avatarUrl), status,
        fromFollowers: !candidate?.suggestionProfiles?.length && Boolean(candidate?.sourceProfiles?.length),
        reference: candidate?.suggestionProfiles?.[0] || candidate?.sourceProfiles?.[0] || '' };
    });
    const active = Boolean(run && state.queueExecuting && state.operation);
    let status = run?.status ?? 'idle';
    if (state.pacing?.block) status = state.pacing.block.reason === 'unconfirmed-action' ? 'paused' : 'blocked';
    else if (status === 'running') status = !active ? 'interrupted' : run.phase === 'waiting' ? 'waiting' :
      run.phase === 'dispatching' ? 'dispatching' : run.current ? 'running' : 'discovering';
    const model = { owner, runId: run?.id ?? null, status, phase: run?.phase ?? 'idle',
      currentUsername: run?.current ?? null, target: run?.target ?? 0,
      followed: Math.max(run?.followed ?? 0, items.filter(item => item.status === 'following').length),
      requested: Math.max(run?.requested ?? 0, items.filter(item => item.status === 'requested').length),
      items, nextAt: active && run.phase === 'waiting' ? state.queueNextAt ?? state.pacing?.nextAt ?? null : null,
      message: state.queueMessage || (run?.reason ? automaticFollowOutcomes[run.reason] || run.reason : ''),
      aiMode: run?.aiMode === true, followerFallback: run?.followerFallback === true };
    try { globalThis.instagramQueueView.render(model); }
    catch (error) { console.error('Não foi possível atualizar a visualização da fila.', error); }
  }

  function observeQueue(candidates, run) {
    for (const candidate of candidates) {
      const name = cleanUsername(candidate.username);
      if (!name || name === state.profile?.username || candidate.alreadyFollows ||
          state.followedOnce.has(name) || run?.references?.includes(name)) continue;
      rememberQueueCandidate(candidate);
      if (run && !run.queue.includes(name) && run.queue.length < 2000) run.queue.push(name);
    }
    renderQueue();
  }

  function queueUpdate(update, run) {
    const name = cleanUsername(update?.username);
    if (typeof update?.message === 'string') state.queueMessage = update.message;
    if (Number.isSafeInteger(update?.nextAt)) state.queueNextAt = update.nextAt;
    if (['waiting', 'dispatching'].includes(update?.phase) && run) {
      run.phase = update.phase;
      if (name) run.current = name;
    }
    if (name && ['following','requested'].includes(update?.status)) {
      state.queueResults.set(name, update.status);
      state.followedOnce.add(name);
    }
    renderQueue();
  }

  function report(element, message, isError = false) {
    element.textContent = message;
    element.classList.toggle('error', isError);
  }

  function showProgress(message, isError = false, completion) {
    ui.progress.hidden = !message;
    ui.progressMeter.hidden = !message || completion === undefined;
    if (typeof completion === 'number') ui.progressMeter.value = completion;
    else ui.progressMeter.removeAttribute('value');
    report(ui.flowStatus, message, isError);
    if (state.operation?.stoppable) publishSideQueue();
  }

  function showDiscoveryLog(log) {
    ui.discoveryLogText.value = log;
    ui.discoveryLog.hidden = !log;
  }

  async function loadDiscoveryLog(owner) {
    if (!owner) return;
    const key = discoveryLogPrefix + owner;
    try {
      const log = (await chrome.storage.local.get(key))[key];
      if (typeof log === 'string') {
        showDiscoveryLog(log.slice(0, discoveryLogLines * (discoveryLogLineLength + 1)));
      }
    } catch {
      // The saved log is optional and should never block profile analysis.
    }
  }

  const diagnostic = entry => globalThis.instagramFluxoDiagnostics?.emit(entry);

  function startOperationLog(action, append = false) {
    const version = chrome.runtime.getManifest?.()?.version;
    const title = version ? 'Instagram Fluxo ' + version : 'Instagram Fluxo';
    const earlier = append ? ui.discoveryLogText.value.split('\n').filter(Boolean) : [];
    const lines = [title + ' · ' + action + ' em ' + new Date().toISOString()];
    const render = () => {
      const first = Math.max(0, earlier.length + lines.length - discoveryLogLines);
      showDiscoveryLog([...earlier.slice(first), ...lines].join('\n'));
    };
    report(ui.discoveryLogStatus, '');
    if (!append) ui.discoveryLog.open = false;
    render();
    return message => {
      if (typeof message !== 'string') return;
      const line = message.replace(/\s+/g, ' ').trim().slice(0, discoveryLogLineLength);
      if (!line || lines.at(-1) === line) return;
      lines.push(line);
      if (lines.length > discoveryLogLines) lines.splice(1, 1);
      render();
      if (!line.startsWith('IA ·')) void diagnostic({ event:'workflow.detail', message:line,
        owner:state.profile?.username,runId:state.operation?.runId,action:state.operation?.kind });
    };
  }

  async function saveDiscoveryLog(owner) {
    if (!owner) return;
    try {
      await chrome.storage.local.set({ [discoveryLogPrefix + owner]: ui.discoveryLogText.value });
    } catch {
      report(ui.discoveryLogStatus, 'Não foi possível salvar o log neste navegador. Você pode copiá-lo.', true);
    }
  }

  async function copyDiscoveryLog() {
    const log = ui.discoveryLogText.value;
    if (!log) return;
    try {
      await navigator.clipboard.writeText(log);
      report(ui.discoveryLogStatus, 'Log copiado.');
    } catch {
      ui.discoveryLogText.focus();
      ui.discoveryLogText.select();
      report(ui.discoveryLogStatus, 'Log selecionado. Use Ctrl+C para copiar.');
    }
  }

  function errorText(error) {
    return typeof error?.message === 'string' ? error.message : 'A ação foi interrompida.';
  }

  function providerUsed(result) {
    const used = providers[result?.provider]?.name;
    if (!used) return '';
    const skipped = (result.fallbackFrom ?? []).map(id => providers[id]?.name).filter(Boolean);
    return skipped.length
      ? 'Resultado gerado com ' + used + '. Houve falha em ' + skipped.join(', ') + '.'
      : 'Resultado gerado com ' + used + '.';
  }

  async function rpc(type, payload = {}) {
    const response = await chrome.runtime.sendMessage({ type, ...payload });
    if (!response?.ok) {
      if (response?.error === 'Ação não reconhecida.') {
        throw new Error('O serviço da extensão está desatualizado. Recarregue o Instagram Fluxo em chrome://extensions e reabra o painel. Os dados locais foram preservados.');
      }
      const error = new Error(response?.error || 'A extensão não conseguiu concluir a solicitação.');
      error.code = response?.code;
      throw error;
    }
    return response.data;
  }

  function platformRestricted(error) {
    return ['restricted', 'platform-restricted', 'platform-challenge', 'action-unconfirmed'].includes(error?.code);
  }

  function make(tag, props = {}) {
    return Object.assign(document.createElement(tag), props);
  }

  function cleanUsername(value) {
    return typeof value === 'string' && profilePattern.test(value) && !/^\.+$/.test(value)
      ? value.toLowerCase()
      : '';
  }

  function profileLink(username) {
    return make('a', {
      href: 'https://www.instagram.com/' + encodeURIComponent(username) + '/',
      textContent: '@' + username,
      target: '_blank',
      rel: 'noopener noreferrer',
    });
  }

  function flow() {
    if (!globalThis.instagramFlow) throw new Error('O painel não conseguiu carregar a conexão com o Instagram.');
    return globalThis.instagramFlow;
  }

  function refreshControls() {
    const busy = Boolean(state.operation) || state.savingPacing;
    const hasProfile = Boolean(state.profile);
    const blocked = Boolean(state.pacing?.block);
    const unlocked = state.vault === 'unlocked';
    const configured = unlocked && [...state.providers.values()].some(provider => provider.hasKey);
    const configBusy = busy || state.saving;
    for (const control of [ui.pacingMin, ui.pacingMax, ui.pacingBatch, ui.pacingPause, ui.savePacing]) {
      control.disabled = busy || state.savingPacing || !hasProfile;
    }
    ui.reportBlock.disabled = state.savingPacing || !hasProfile;
    ui.resumeAfterBlock.disabled = busy || state.savingPacing || !hasProfile;
    ui.loadProfile.disabled = busy || state.savingReferences || tabId === null;
    ui.analyze.disabled = busy || state.saving || state.savingReferences || tabId === null || !configured;
    ui.discover.disabled = busy || state.savingReferences || !hasProfile;
    if (ui.refreshSuggestions) ui.refreshSuggestions.disabled = ui.discover.disabled || tabId === null;
    ui.follow.disabled = busy || blocked || !hasProfile || !state.selected.size;
    ui.saveReferences.disabled = busy || state.savingReferences || !hasProfile;
    ui.automaticFollowAmount.disabled = busy || state.savingReferences || !hasProfile;
    if (ui.automaticFollowSource) ui.automaticFollowSource.disabled = busy || state.savingReferences || !hasProfile;
    ui.startAutomaticFollow.disabled = busy || blocked || state.savingReferences || !hasProfile;
    for (const input of ui.referenceInputs) input.disabled = busy || state.savingReferences;
    ui.stop.hidden = !state.operation?.stoppable;
    ui.stop.disabled = Boolean(state.operation?.signal.aborted || state.operation?.finishing);
    ui.configForm.querySelector('button').disabled = configBusy || !unlocked;
    ui.provider.disabled = configBusy || !unlocked;
    ui.model.disabled = configBusy || !unlocked;
    ui.key.disabled = configBusy || !unlocked;
    ui.vaultSubmit.disabled = configBusy;
    ui.vaultPassword.disabled = configBusy;
    ui.vaultConfirm.disabled = configBusy || state.vault !== 'missing';
    ui.lockVault.disabled = configBusy || !unlocked;
    ui.unfollowAll.disabled = busy || blocked || !hasProfile;
    ui.unfollowProfileRecovery.disabled = busy;
    for (const control of [ui.exportData, ui.refreshLocal]) if (control) control.disabled = busy || !hasProfile;
    backupPanel?.sync();
    if (ui.resumeFollow) {
      ui.resumeFollow.hidden = !state.pendingRun;
      ui.resumeFollow.disabled = busy || blocked || !hasProfile;
    }
    if (ui.aiMode) ui.aiMode.disabled = busy;
    const batchLimit = globalThis.instagramFlow?.followBatchLimit;
    const atBatchLimit = state.selected.size >= batchLimit;
    if (ui.selectSuggestionBatch) {
      const available = state.recommendations.length - state.selected.size;
      ui.selectSuggestionBatch.disabled = busy || available <= 0 || atBatchLimit;
      ui.selectSuggestionBatch.textContent = `Selecionar até ${batchLimit ?? 15} perfis`;
    }
    for (const input of ui.recommendations.querySelectorAll('input')) {
      input.disabled = busy || (atBatchLimit && !input.checked);
    }
    if (!state.profile) {
      ui.profilePrompt.textContent = tabId === null
        ? 'Abra o painel pelo ícone da extensão enquanto estiver no seu perfil do Instagram.'
        : 'Carregue seu perfil para abrir os controles do fluxo escolhido.';
    }
    ui.selectionCount.textContent = state.recommendations.length
      ? `${state.selected.size} de ${state.recommendations.length} selecionados · até ${batchLimit} por lote`
      : '';
    cleanerPanel?.sync();
  }

  function updateProvider(selected) {
    const entry = state.providers.get(selected);
    ui.key.value = '';
    ui.model.value = entry?.model || '';
    ui.key.placeholder = entry?.hasKey ? 'Chave salva no cofre' : 'Cole sua chave';
  }

  function referenceUsername(value) {
    let text = value.trim();
    if (/^(?:https?:\/\/|(?:www\.)?instagram\.com\/)/i.test(text)) {
      try {
        if (!/^https?:\/\//i.test(text)) text = 'https://' + text;
        const url = new URL(text);
        if (url.protocol !== 'https:' || !['www.instagram.com', 'instagram.com'].includes(url.hostname)) return '';
        text = url.pathname.match(/^\/(?:_u\/)?([a-z0-9._]{1,30})\/?$/i)?.[1] ?? '';
      } catch {
        return '';
      }
    }
    return cleanUsername(text.replace(/^@/, ''));
  }

  function readReferences(focus = true) {
    const references = ui.referenceInputs.map(input => referenceUsername(input.value));
    const invalid = references.findIndex(value => !value);
    if (invalid !== -1) {
      if (focus) ui.referenceInputs[invalid].focus();
      throw new Error('Informe um @nome ou link válido em cada um dos três perfis de referência.');
    }
    if (new Set(references).size !== 3) {
      throw new Error('Escolha três perfis de referência diferentes.');
    }
    if (references.includes(cleanUsername(state.profile?.username))) {
      throw new Error('Escolha três referências diferentes do seu próprio perfil.');
    }
    return references;
  }

  async function loadReferences(owner) {
    ui.referenceInputs.forEach(input => { input.value = ''; });
    report(ui.referenceStatus, '');
    try {
      const stored = (await chrome.storage.local.get(referencesKey))[referencesKey];
      const references = stored && Object.hasOwn(stored, owner) ? stored[owner] : null;
      if (Array.isArray(references) && references.length === 3 && references.every(value => referenceUsername(value))) {
        references.forEach((value, index) => { ui.referenceInputs[index].value = '@' + referenceUsername(value); });
        report(ui.referenceStatus, 'Perfis salvos para @' + owner + '.');
      }
    } catch {
      report(ui.referenceStatus, 'Não consegui carregar os perfis salvos. Você pode preencher as referências novamente.', true);
    }
  }

  async function persistReferences(references) {
    const owner = cleanUsername(state.profile?.username);
    if (!owner) throw new Error('Carregue seu perfil antes de salvar as referências.');
    await navigator.locks.request('instagram-fluxo-audience-references', async () => {
      const stored = (await chrome.storage.local.get(referencesKey))[referencesKey];
      const current = stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {};
      await chrome.storage.local.set({ [referencesKey]: { ...current, [owner]: references } });
    });
    references.forEach((value, index) => { ui.referenceInputs[index].value = '@' + value; });
    report(ui.referenceStatus, 'Perfis salvos para @' + owner + '.');
  }

  async function saveReferences() {
    if (state.operation || state.savingReferences || !state.profile) return;
    state.savingReferences = true;
    try {
      const references = readReferences();
      refreshControls();
      await persistReferences(references);
      await showSavedSuggestions(references);
    } catch (error) {
      report(ui.referenceStatus, errorText(error), true);
    } finally {
      state.savingReferences = false;
      refreshControls();
    }
  }

  function renderProviderOrder() {
    const entries = Object.entries(providers).map(([id, provider]) => {
      const configured = Boolean(state.providers.get(id)?.hasKey);
      return make('li', {
        className: configured ? 'configured' : '',
        textContent: provider.name + (configured ? ' · configurado' : ' · sem chave'),
      });
    });
    ui.providerOrder.replaceChildren(...entries);
  }

  function setSettings(settings, useLastProvider = false) {
    state.vault = settings.vault;
    const creating = state.vault === 'missing';
    const unlocked = state.vault === 'unlocked';
    ui.vaultForm.hidden = unlocked;
    ui.vaultHint.textContent = creating
      ? 'Crie uma senha com pelo menos 12 caracteres. Você vai usá-la para abrir as chaves depois de reiniciar o Chrome.'
      : 'Digite sua senha para usar as chaves salvas neste Chrome.';
    ui.vaultConfirm.hidden = !creating;
    ui.vaultConfirmLabel.hidden = !creating;
    ui.vaultConfirm.required = creating;
    ui.vaultSubmit.textContent = creating ? 'Criar cofre local' : 'Desbloquear cofre';
    ui.configForm.hidden = !unlocked;
    ui.lockVault.hidden = !unlocked;
    ui.providerSummary.hidden = !unlocked;
    state.providers = new Map((settings?.providers ?? []).map(entry => [entry.provider, entry]));
    if (useLastProvider && Object.hasOwn(providers, settings?.provider)) ui.provider.value = settings.provider;
    updateProvider(ui.provider.value);
    renderProviderOrder();
    refreshControls();
  }

  async function refreshSettings() {
    const editing = () => ui.key.value || ui.vaultPassword.value || ui.vaultConfirm.value || document.activeElement === ui.model;
    if (state.saving || state.operation || editing()) return;
    const generation = ++state.settingsGeneration;
    try {
      const settings = await rpc('settings');
      if (generation === state.settingsGeneration && !state.saving && !state.operation && !editing()) {
        setSettings(settings, state.vault !== settings.vault);
      }
    } catch (error) {
      if (generation === state.settingsGeneration) report(ui.configStatus, errorText(error), true);
    }
  }

  async function openVault(event) {
    event.preventDefault();
    if (!event.isTrusted || state.saving || state.operation || !['missing', 'locked'].includes(state.vault)) return;
    const create = state.vault === 'missing';
    const password = ui.vaultPassword.value;
    if (create && password.trim().length < 12) {
      report(ui.configStatus, 'Use pelo menos 12 caracteres na senha do cofre.', true);
      ui.vaultPassword.focus();
      return;
    }
    if (create && password !== ui.vaultConfirm.value) {
      report(ui.configStatus, 'As senhas precisam ser iguais.', true);
      ui.vaultConfirm.focus();
      return;
    }
    state.saving = true;
    state.settingsGeneration += 1;
    ui.vaultPassword.value = '';
    ui.vaultConfirm.value = '';
    refreshControls();
    try {
      setSettings(await rpc('unlockVault', { password, create }), true);
      report(ui.configStatus, create ? 'Cofre criado. Salve as chaves dos seus provedores.' : 'Cofre desbloqueado.');
    } catch (error) {
      report(ui.configStatus, errorText(error), true);
    } finally {
      state.saving = false;
      refreshControls();
      (state.vault === 'unlocked' ? ui.provider : ui.vaultPassword).focus();
    }
  }

  async function lockVault(event) {
    if (!event.isTrusted || state.saving || state.operation || state.vault !== 'unlocked') return;
    state.saving = true;
    state.settingsGeneration += 1;
    ui.key.value = '';
    refreshControls();
    try {
      setSettings(await rpc('lockVault'));
      report(ui.configStatus, 'Cofre bloqueado.');
    } catch (error) {
      report(ui.configStatus, errorText(error), true);
    } finally {
      state.saving = false;
      refreshControls();
      if (state.vault === 'locked') ui.vaultPassword.focus();
    }
  }

  async function saveConfiguration(event) {
    event.preventDefault();
    if (!event.isTrusted || state.saving || state.operation || state.vault !== 'unlocked') return;
    const provider = ui.provider.value;
    const key = ui.key.value.trim();
    const model = ui.model.value.trim();
    if (!key && !state.providers.get(provider)?.hasKey) {
      report(ui.configStatus, 'Informe a chave de ' + providers[provider].name + '.', true);
      ui.key.focus();
      return;
    }
    state.saving = true;
    state.settingsGeneration += 1;
    ui.key.value = '';
    refreshControls();
    try {
      const granted = await chrome.permissions.request({ origins: [providers[provider].origin] });
      if (!granted) throw new Error('O Chrome precisa da permissão para acessar este provedor.');
      setSettings(await rpc('configure', { provider, key, model }));
      report(ui.configStatus, 'Configuração de ' + providers[provider].name + ' salva.');
    } catch (error) {
      report(ui.configStatus, errorText(error), true);
    } finally {
      state.saving = false;
      refreshControls();
    }
  }

  async function run(action, { message, kind = 'profile', sideKind = kind, runId = crypto.randomUUID(), stoppable = false, showMeter = false }) {
    if (state.operation) return;
    const machine = globalThis.instagramFluxoQueueMachine;
    if (!machine) {
      showProgress('Reabra o painel para carregar o executor da fila.', true);
      return;
    }
    const operation = machine.createOperation(signal => action(signal, operation.checkpointDispatch));
    const { signal } = operation;
    const began=Date.now();
    const owner=state.profile?.username;
    let status='finished';
    let outcome;
    state.operation = { ...operation, stoppable, runId, kind, sideKind, stopToken: stoppable ? crypto.randomUUID() : null };
    globalThis.instagramFluxoDiagnostics?.context({owner,runId});
    void diagnostic({event:'workflow.start',action:kind});
    showProgress(message, false, showMeter ? null : undefined);
    refreshControls();
    if (stoppable) ui.progress.scrollIntoView({ block: 'nearest' });
    try {
      outcome = await operation.start();
      if (['completed','paused','stopped','error'].includes(outcome?.workflowStatus)) status = outcome.workflowStatus;
    } catch (error) {
      const interrupted = !error?.persistenceFailure && (signal.aborted || error?.name === 'AbortError');
      status = interrupted ? 'stopped' : error?.workflowStatus === 'paused' ? 'paused' : 'error';
      outcome = { reason:error?.reason || error?.code || (error?.clickSent ? 'confirmation-pending' : interrupted ? 'interrupted' : 'operation-failed'),
        phase:error?.phase, username:error?.username };
      void diagnostic({event:'workflow.error',level:'warn',action:kind,status,...outcome,interrupted});
      if (error?.workflowMessage) showProgress(error.workflowMessage, !interrupted || Boolean(error?.clickSent));
      else if (error?.clickSent) showProgress(errorText(error), true);
      else if (signal.aborted || error?.name === 'AbortError') showProgress('Fluxo interrompido.');
      else showProgress(errorText(error), true);
    } finally {
      const finalStatus = signal.aborted && status === 'finished' ? 'stopped' : status;
      const lastSnapshot = stoppable && sideLink ? activeSideSnapshot() : null;
      state.operation.finishing = true;
      if (lastSnapshot) {
        const displayStatus = finalStatus === 'finished' ?
          (['paused', 'completed', 'error'].includes(lastSnapshot.status) ? lastSnapshot.status : 'completed') : finalStatus;
        lastSideResult = { ...lastSnapshot, status: displayStatus, canStop: false };
        state.operation.sideFinished = lastSideResult;
        publishSideQueue();
      }
      void diagnostic({event:'workflow.end',action:kind,status:finalStatus,
        reason:outcome?.reason,phase:outcome?.phase,elapsedMs:Date.now()-began});
      globalThis.instagramFluxoDiagnostics?.context({owner:state.profile?.username});
      void globalThis.instagramFluxoDiagnostics?.refresh();
      await refreshPacing();
      state.operation = null;
      renderQueue();
      refreshControls();
    }
  }

  function stopOperation(stopToken) {
    const operation = state.operation;
    if (!operation?.stoppable || operation.stopToken !== stopToken || operation.finishing || !operation.requestStop()) return false;
    showProgress('Interrompendo…');
    refreshControls();
    return true;
  }

  function renderPacing(value, populate = false) {
    state.pacing = value;
    if (populate) {
      ui.pacingMin.value = value.settings.minDelaySeconds;
      ui.pacingMax.value = value.settings.maxDelaySeconds;
      ui.pacingBatch.value = value.settings.batchSize;
      ui.pacingPause.value = value.settings.batchPauseMinutes;
    }
    ui.pacingBlock.hidden = !value.block;
    const unconfirmed = value.block?.reason === 'unconfirmed-action';
    ui.resumeAfterBlock.textContent = unconfirmed ? 'Liberar após conferir' : 'Retomar após desbloqueio';
    ui.pacingBlockMessage.textContent = unconfirmed
      ? 'Uma ação anterior precisa ser conferida. A extensão manteve a fila pausada para evitar outra tentativa sem confirmação. Confira os resultados pendentes no Instagram antes de liberar.' : value.block
      ? (value.block.reason === 'challenge' ? 'O Instagram pediu uma verificação.' : 'Há uma restrição de ações registrada para esta conta.') +
        ' A fila permanece pausada. Resolva o aviso no Instagram antes de liberar a retomada.'
      : '';
    const settings = value.settings;
    const unfollow = value.unfollowInterval;
    report(ui.pacingStatus, value.block ? unconfirmed ? 'Pausa de conferência salva neste navegador.' : 'Pausa por restrição ativa e salva neste navegador.' :
      `Seguir: ${settings.minDelaySeconds}–${settings.maxDelaySeconds} s.` +
      (unfollow ? ` Remover: ${unfollow.minDelaySeconds}–${unfollow.maxDelaySeconds} s.` : '') +
      ` Pausa de ${settings.batchPauseMinutes} min a cada ${settings.batchSize} tentativas.` +
      (value.waitMs > 0 ? ' Próxima ação a partir de ' + dateFormat.format(value.nextAt) + '.' : ''));
    refreshControls();
    renderQueue();
  }

  async function refreshPacing(populate = false) {
    const owner = cleanUsername(state.profile?.username);
    if (!owner) return;
    const generation = ++state.pacingGeneration;
    try {
      const value = await flow().readPacing(owner);
      if (generation !== state.pacingGeneration || state.profile?.username !== owner) return;
      renderPacing(value, populate);
    } catch (error) {
      if (generation === state.pacingGeneration && state.profile?.username === owner) report(ui.pacingStatus, errorText(error), true);
    }
  }

  async function savePacing(event) {
    if (!event.isTrusted || state.operation || state.savingPacing || !state.profile) return;
    const owner = state.profile.username;
    const controls = [ui.pacingMin, ui.pacingMax, ui.pacingBatch, ui.pacingPause];
    if (controls.some(control => !control.reportValidity())) return;
    state.savingPacing = true;
    state.pacingGeneration += 1;
    refreshControls();
    try {
      const settings = { minDelaySeconds: ui.pacingMin.valueAsNumber, maxDelaySeconds: ui.pacingMax.valueAsNumber,
        batchSize: ui.pacingBatch.valueAsNumber, batchPauseMinutes: ui.pacingPause.valueAsNumber };
      const value = await rpc('pacingConfigure', { owner, settings });
      if (state.profile?.username === owner) renderPacing(value, true);
    } catch (error) { report(ui.pacingStatus, errorText(error), true); }
    finally { state.savingPacing = false; refreshControls(); }
  }

  async function setPlatformBlock(event, clear = false) {
    if (!event.isTrusted || !state.profile || state.savingPacing || (clear && state.operation)) return;
    const owner = state.profile.username;
    state.savingPacing = true;
    state.pacingGeneration += 1;
    // Stop immediately, including a pending wait, before saving a reported phone restriction.
    if (!clear) state.operation?.requestStop();
    refreshControls();
    try {
      const value = await rpc(clear ? 'pacingClear' : 'pacingBlock', { owner, ...(clear ? {} : { reason: 'rate-limit' }) });
      if (state.profile?.username === owner) renderPacing(value);
    } catch (error) { report(ui.pacingStatus, errorText(error), true); }
    finally { state.savingPacing = false; refreshControls(); }
  }

  function clearSuggestions() {
    state.recommendations = [];
    state.selected.clear();
    renderSuggestions();
  }

  async function saveLocal(kind, payload) {
    const owner = cleanUsername(state.profile?.username);
    if (!owner) throw new Error('Conecte seu perfil antes de salvar os dados.');
    return rpc('databaseSave', { owner, kind, ...payload });
  }

  function showAIMode() {
    if (ui.aiModeStatus) report(ui.aiModeStatus, ui.aiMode?.checked
      ? 'Ligado · a IA decide quem seguir, quando rolar e quando trocar de referência.'
      : 'Desligado · segue as sugestões diretamente.');
  }

  async function refreshLocalData(restore = false) {
    const owner = cleanUsername(state.profile?.username);
    if (!owner) return;
    try {
      const result = await rpc('databaseRead', { owner });
      if (state.profile?.username !== owner) return;
      state.database = result.database;
      state.followedOnce = new Set(result.followHistory.map(entry => entry.username));
      state.followHistory = new Map(result.followHistory.map(entry => [entry.username, entry]));
      if (!state.queueRun || !state.operation) {
        const restored = [...result.database.runs].reverse().find(run => run.kind === 'follow') ?? null;
        if (restored?.id !== state.queueRun?.id) {
          state.queueResults.clear(); state.queueNextAt = null; state.queueMessage = '';
        }
        state.queueRun = restored;
        state.queueCandidates = new Map();
        for (const candidate of result.database.candidates) rememberQueueCandidate(candidate);
      }
      const pending = result.summary?.pendingRun;
      state.pendingRun = pending?.kind === 'follow' && pending.followed + pending.requested < pending.target ? pending : null;
      if (ui.localSummary) ui.localSummary.textContent = [
        `${result.summary.candidates} sugestões salvas`, `${state.followedOnce.size} perfis na memória de já seguidos`,
        `${result.database.runs.length} filas salvas`,
      ].join(' · ');
      if (ui.localUpdated) ui.localUpdated.textContent = 'Último salvamento: ' + dateFormat.format(result.summary.updatedAt);
      if (ui.localStatus && state.pendingRun) report(ui.localStatus,
        `Fila salva: ${state.pendingRun.followed + state.pendingRun.requested} de ${state.pendingRun.target}. Você pode retomá-la.`);
      if (restore) await restoreSuggestions();
      return result.database;
    } catch (error) {
      if (ui.localStatus) report(ui.localStatus, errorText(error), true);
      return null;
    } finally {
      refreshControls();
      renderQueue();
    }
  }

  async function exportLocalData(event) {
    if (!event.isTrusted || !state.profile || state.operation) return;
    try {
      const owner = state.profile.username;
      const data = await rpc('databaseExport', { owner });
      const references = (await chrome.storage.local.get(referencesKey))[referencesKey]?.[owner] ?? [];
      data.references = references;
      data.profile = state.profile;
      data.lastLog = ui.discoveryLogText.value;
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      const link = make('a', { href: url, download: `instagram-fluxo-${owner}-${new Date().toISOString().slice(0, 10)}.json` });
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      if (ui.localStatus) report(ui.localStatus, 'Dados exportados. O cofre de chaves permanece protegido no navegador.');
    } catch (error) {
      if (ui.localStatus) report(ui.localStatus, errorText(error), true);
    }
  }

  function selectSuggestionBatch(event) {
    if (!event.isTrusted || state.operation) return;
    const available = flow().followBatchLimit - state.selected.size;
    const candidates = state.recommendations.filter(({ username }) => !state.selected.has(username)).slice(0, available);
    for (const { username } of candidates) state.selected.add(username);
    renderSuggestions();
  }

  async function refreshFollowQuota() {
    const generation = ++state.quotaGeneration;
    const owner = cleanUsername(state.profile?.username);
    if (!owner) {
      report(ui.automaticFollowQuota, 'Limite local: até 200 ações automáticas em 24 horas. Não é um limite garantido pelo Instagram.');
      return;
    }
    try {
      const quota = await flow().followQuota(owner);
      if (generation !== state.quotaGeneration) return;
      report(ui.automaticFollowQuota, `${quota.remaining} de ${quota.limit} ações disponíveis no limite local de 24 horas. Isso não garante ausência de restrições.`);
    } catch {
      if (generation === state.quotaGeneration) {
        report(ui.automaticFollowQuota, 'Não foi possível consultar o limite do modo automático.', true);
      }
    }
  }

  async function loadProfile(analyze) {
    await run(async () => {
      state.profile = null;
      state.database = null;
      state.queueRun = null;
      state.queueExecuting = false;
      state.queueCandidates.clear(); state.queueResults.clear(); state.followHistory.clear();
      state.queueNextAt = null; state.queueMessage = '';
      renderQueue();
      state.followedOnce.clear();
      state.pacing = null;
      state.pacingGeneration += 1;
      ui.pacingBlock.hidden = true;
      ui.profileResult.hidden = true;
      ui.niche.hidden = true;
      ui.profileAnalysisStatus.textContent = '';
      ui.searchBlock.hidden = true;
      ui.discoveryLog.open = false;
      showDiscoveryLog('');
      report(ui.discoveryLogStatus, '');
      suggestionsStatus('');
      clearSuggestions();
      const profile = await flow().readOwnProfile(tabId);
      const username = cleanUsername(profile.username);
      if (!username) throw new Error('Não consegui confirmar o perfil conectado.');
      state.profile = profile;
      globalThis.instagramFluxoDiagnostics?.context({owner:username,runId:state.operation?.runId});
      void diagnostic({event:'profile.loaded',owner:username});
      if (ui.aiMode) {
        const aiKey = 'instagramFluxoAIMode:' + username;
        ui.aiMode.checked = (await chrome.storage.local.get(aiKey))[aiKey] === true;
        showAIMode();
      }
      if (ui.automaticFollowSource) {
        const sourceKey = 'instagramFluxoFollowSourceV2:' + username;
        ui.automaticFollowSource.value = (await chrome.storage.local.get(sourceKey))[sourceKey] === 'suggestions' ? 'suggestions' : 'fallback';
      }
      ui.profileName.textContent = '@' + username;
      ui.profilePrompt.textContent = 'Conta conectada.';
      await loadDiscoveryLog(username);
      await loadReferences(username);
      await refreshLocalData(true);
      await refreshPacing(true);
      cleanerPanel?.requestReload();
      ui.profileResult.hidden = false;
      ui.searchBlock.hidden = false;
      void refreshFollowQuota();
      void refreshHistory();
      if (analyze) {
        showProgress('A IA está identificando o nicho do seu perfil…', false, null);
        const result = await rpc('analyze', { profile });
        ui.niche.textContent = result.niche || 'Nicho não identificado';
        ui.niche.hidden = false;
        ui.profileAnalysisStatus.textContent = providerUsed(result);
      }
      showProgress('');
    }, { message: 'Lendo seu perfil do Instagram…', kind:analyze?'ai':'profile', showMeter: true });
  }

  function renderSuggestions() {
    const rows = state.recommendations.map(({ username, reason, sourceProfiles, suggestionProfiles }) => {
      const row = make('li');
      const content = make('div', { className: 'row-contents' });
      content.append(profileLink(username));
      if (reason) content.append(make('p', { textContent: reason }));
      if (sourceProfiles?.length) {
        content.append(make('p', {
          className: 'reference-source',
          textContent: 'Encontrado entre seguidores de ' + sourceProfiles.map(name => '@' + name).join(', '),
        }));
      }
      if (suggestionProfiles?.length) {
        content.append(make('p', {
          className: 'reference-source',
          textContent: 'Sugestão do Instagram ao abrir ' + suggestionProfiles.map(name => '@' + name).join(', '),
        }));
      }
      const toggle = make('input', { type: 'checkbox', checked: state.selected.has(username) });
      toggle.setAttribute('aria-label', 'Incluir @' + username);
      toggle.addEventListener('change', () => {
        if (toggle.checked) {
          if (state.selected.size >= flow().followBatchLimit) toggle.checked = false;
          else state.selected.add(username);
        } else state.selected.delete(username);
        refreshControls();
      });
      row.append(content, toggle);
      return row;
    });
    ui.recommendations.replaceChildren(...rows);
    ui.recommendationSection.hidden = rows.length === 0;
    refreshControls();
    renderQueue();
  }

  function onUpdate(update) {
    if (typeof update?.message === 'string' && !state.operation?.signal.aborted) {
      showProgress(update.message);
    }
  }

  function suggestionsStatus(message, isError = false) {
    if (ui.suggestionsStatus) report(ui.suggestionsStatus, message, isError);
  }

  function suggestionScope(owner, references, followerFallback) {
    return suggestionCheckPrefix + [owner, followerFallback ? 'fallback' : 'suggestions', ...[...references].sort()].join(':');
  }

  function cachedRecommendations(references, followerFallback) {
    const owner = cleanUsername(state.profile?.username);
    if (state.database?.owner !== owner) return [];
    const followersSeen = new Set(state.database.snapshots?.followers?.usernames ?? []);
    const unknown = new Set();
    for (const run of state.database.runs) {
      if (run.kind !== 'follow') continue;
      for (const username of run.uncertain ?? []) unknown.add(username);
      if (run.phase === 'dispatching' && run.current) unknown.add(run.current);
    }
    const suggestions = [], followers = [];
    for (const candidate of state.database?.candidates ?? []) {
      const username = cleanUsername(candidate.username);
      if (!username || username === owner || references.includes(username) ||
          candidate.alreadyFollows || followersSeen.has(username) || unknown.has(username) || state.followedOnce.has(username)) continue;
      const suggestionProfiles = candidateReferences(candidate.suggestionProfiles, references);
      const sourceProfiles = followerFallback ? candidateReferences(candidate.sourceProfiles, references) : [];
      const entry = { ...candidate, username, suggestionProfiles, sourceProfiles };
      if (suggestionProfiles.length) suggestions.push(entry);
      else if (sourceProfiles.length) followers.push(entry);
    }
    return [...suggestions, ...followers];
  }

  function renderSavedSuggestions(references, followerFallback) {
    state.recommendations = cachedRecommendations(references, followerFallback);
    const eligible = new Set(state.recommendations.map(row => row.username));
    state.selected = new Set([...state.selected].filter(username => eligible.has(username)));
    renderSuggestions();
    return state.recommendations.length;
  }

  async function showSavedSuggestions(references, open = false) {
    const owner = cleanUsername(state.profile?.username);
    const fallback = ui.automaticFollowSource?.value === 'fallback';
    const count = renderSavedSuggestions(references, fallback);
    const key = suggestionScope(owner, references, fallback);
    const checkpoint = (await chrome.storage.local.get(key).catch(() => ({})))[key];
    const current = suggestionScope(cleanUsername(state.profile?.username), ui.referenceInputs.map(input => referenceUsername(input.value)),
      ui.automaticFollowSource?.value === 'fallback');
    if (current !== key) return;
    const saved = count ? `${count} perfis elegíveis salvos no painel.` : 'Nenhum perfil elegível salvo para estas referências.';
    suggestionsStatus(checkpoint?.status === 'partial' || checkpoint?.status === 'collecting'
      ? `A última coleta ficou incompleta. ${saved}`
      : saved);
    if (open && count) {
      const disclosure = ui.recommendationSection.querySelector('details');
      if (disclosure) disclosure.open = true;
      ui.recommendationSection.scrollIntoView({ block: 'nearest' });
    }
  }

  async function restoreSuggestions() {
    let references;
    try {
      references = readReferences(false);
    } catch {
      clearSuggestions();
      suggestionsStatus('Configure três referências para consultar os perfis salvos.');
      return;
    }
    await showSavedSuggestions(references);
  }

  async function viewSavedSuggestions() {
    if (state.operation || state.savingReferences || !state.profile) return;
    try {
      const references = readReferences();
      const saved = await refreshLocalData();
      if (state.operation) return;
      if (saved) await showSavedSuggestions(references, true);
      else suggestionsStatus('Os perfis salvos não puderam ser lidos agora.', true);
    } catch (error) { report(ui.referenceStatus, errorText(error), true); }
  }

  async function discoverProfiles() {
    if (state.operation || state.savingReferences || !state.profile) return;
    let references;
    try { references = readReferences(); }
    catch (error) { report(ui.referenceStatus, errorText(error), true); return; }
    const owner = cleanUsername(state.profile.username);
    const followerFallback = ui.automaticFollowSource?.value === 'fallback';
    const key = suggestionScope(owner, references, followerFallback);
    await run(async signal => {
      const log = startOperationLog('Coleta para revisão iniciada');
      const runId = state.operation.runId;
      let completed = false;
      try {
        await persistReferences(references);
        await chrome.storage.local.set({ [key]: { runId, status: 'collecting' } });
        await saveLocal('event', { event: { action: 'discovery', status: 'started', reasonCode: 'reference-collection' } });
        signal.throwIfAborted();
        const candidates = await flow().discover(tabId, references, {
          signal, owner, suggestionsOnly: true, followerFallback,
          onObserved: candidates => saveLocal('candidates', { candidates }),
          onDiagnostic: log,
          onUpdate({ reference, loaded, limit, source }) {
            if (signal.aborted) return;
            const index = references.indexOf(reference);
            const label = source === 'suggestions' ? 'sugestões lidas' : 'seguidores lidos';
            const progress = `Referência ${index + 1} de ${references.length} · @${reference} · ${loaded} de ${limit} ${label}`;
            showProgress(progress, false, limit > 0 ? (index + Math.min(loaded / limit, 1)) / references.length : null);
            updateSideProgress({ current: reference, processed: loaded, target: limit });
            suggestionsStatus(progress);
          },
        });
        await saveLocal('candidates', { candidates });
        signal.throwIfAborted();
        completed = true;
        log(`Coleta concluída. Perfis retornados: ${candidates.length}.`);
      } catch (error) {
        log(signal.aborted || error?.name === 'AbortError' ? 'Coleta interrompida.' : 'A coleta terminou com erro.');
        throw error;
      } finally {
        const checkpoint = (await chrome.storage.local.get(key).catch(() => ({})))[key];
        if (checkpoint?.runId === runId) {
          await chrome.storage.local.set({ [key]: { runId, status: completed ? 'complete' : 'partial' } })
            .catch(() => log('Não foi possível atualizar o estado da coleta no painel.'));
        }
        await saveLocal('event', { event: { action: 'discovery', status: completed ? 'completed' : signal.aborted ? 'interrupted' : 'error', reasonCode: 'reference-collection' } })
          .catch(() => log('Não foi possível salvar o evento de encerramento da coleta.'));
        if (await refreshLocalData()) {
          const count = renderSavedSuggestions(references, followerFallback);
          const saved = count ? `${count} perfis elegíveis disponíveis no painel.` : 'Nenhum perfil elegível salvo para estas referências.';
          suggestionsStatus(completed ? `Coleta concluída. ${saved}` : `Coleta incompleta. ${saved}`);
          if (completed) showProgress(`Coleta concluída. ${saved}`, false, 1);
        } else suggestionsStatus('Os perfis salvos não puderam ser lidos agora.', true);
        await saveDiscoveryLog(owner);
      }
    }, { message: 'Coletando perfis para revisão…', kind:'discovery', stoppable: true, showMeter: true });
  }

  function candidateReferences(values, references) {
    if (!Array.isArray(values)) return [];
    return [...new Set(values.map(cleanUsername).filter(name => references.includes(name)))];
  }

  const automaticFollowOutcomes = {
    target: 'Quantidade solicitada atingida.',
    quota: 'Limite do modo automático atingido.',
    exhausted: 'A busca esgotou os perfis elegíveis da origem selecionada.',
    'incomplete-followers': 'O Instagram carregou apenas parte dos seus seguidores. As sugestões sem confirmação ficaram pendentes.',
    'followers-changed': 'A contagem de seguidores mudou durante o lote. Inicie o modo automático novamente.',
    stopped: 'Modo automático interrompido.',
    'agent-stopped': 'O agente encerrou a fila. Confira a última decisão no log.',
  };

  function automaticFollowSummary(result) {
    const following = result.following === 1 ? '1 perfil seguido' : `${result.following} perfis seguidos`;
    const requested = result.requested === 1 ? '1 solicitação enviada' : `${result.requested} solicitações enviadas`;
    const checked = result.checked === 1 ? '1 perfil conferido' : `${result.checked} perfis conferidos`;
    const outcome = automaticFollowOutcomes[result.reason] ?? 'Modo automático encerrado.';
    const already = result.alreadyFollowers > 0 ? ` Já seguem você: ${result.alreadyFollowers}.` : '';
    const inconclusive = result.inconclusive > 0 ? ` Verificações inconclusivas: ${result.inconclusive}.` : '';
    const unconfirmed = result.unconfirmed > 0 ? ` Sem confirmação: ${result.unconfirmed}.` : '';
    return `${outcome} ${following} e ${requested}. ${checked}.${already}${inconclusive}${unconfirmed}`;
  }

  async function startAutomaticFollow(event, resume = false) {
    event.preventDefault();
    const owner = cleanUsername(state.profile?.username);
    if (!event.isTrusted || !owner || state.savingReferences) return;
    const saved = resume ? state.pendingRun : null;
    const aiMode = saved ? saved.aiMode === true : ui.aiMode?.checked === true;
    const followerFallback = saved ? saved.followerFallback === true : ui.automaticFollowSource?.value === 'fallback';
    if (aiMode && (state.vault !== 'unlocked' || ![...state.providers.values()].some(provider => provider.hasKey))) {
      report(ui.referenceStatus, 'Para usar o agente, desbloqueie o cofre e configure uma chave de IA nos ajustes.', true);
      $('settings')?.setAttribute('open', '');
      return;
    }
    const target = saved?.target ?? ui.automaticFollowAmount.valueAsNumber;
    if (!Number.isInteger(target) || target < 1 || target > 200) {
      report(ui.referenceStatus, 'Escolha uma quantidade de 1 a 200 perfis.', true);
      ui.automaticFollowAmount.focus();
      return;
    }
    let references;
    try {
      references = saved?.references?.length === 3 ? saved.references : readReferences();
    } catch (error) {
      report(ui.referenceStatus, errorText(error), true);
      return;
    }
    await run(async (signal, checkpointDispatch) => {
      const log = startOperationLog('Modo automático iniciado', true);
      const durable = saved ? structuredClone(saved) : { id: state.operation.runId, kind: 'follow', target,
        processed: 0, followed: 0, requested: 0, skipped: 0, current: null, queue: [], completed: [],
        references, phase: 'idle', startedAt: Date.now() };
      durable.status = 'running';
      durable.mode = 'automatic';
      state.queueExecuting = true;
      state.queueRun = durable; state.queueResults.clear(); state.queueNextAt = null;
      state.queueMessage = 'Buscando sugestões nas referências…';
      renderQueue();
      durable.aiMode = aiMode;
      durable.followerFallback = followerFallback;
      durable.decisions ??= 0;
      const completed = new Set(durable.completed);
      const uncertain = new Set(durable.uncertain ?? []);
      const counts = { following: durable.followed, requested: durable.requested };
      let writes = Promise.resolve();
      let heartbeat;
      let persistenceError;
      const persist = () => {
        const snapshot = structuredClone(durable);
        renderQueue();
        writes = writes.then(() => saveLocal('run', { run: snapshot }));
        return writes;
      };
      log(`Quantidade solicitada no modo automático · ${target}.`);
      try {
        await persistReferences(references);
        if (!saved) await chrome.storage.local.set({ ['instagramFluxoFollowSourceV2:' + owner]: followerFallback ? 'fallback' : 'suggestions' });
        log(followerFallback ? 'Origem: sugestões, com seguidores da referência como alternativa.' : 'Origem: somente sugestões.');
        if (saved?.current && !completed.has(saved.current)) {
          const local = await rpc('databaseRead', { owner });
          const previous = local.followHistory.find(entry => entry.username === saved.current && entry.followedAt >= durable.startedAt);
          if (previous && ['following', 'requested'].includes(previous.status)) {
            completed.add(saved.current);
            counts[previous.status] += 1;
          } else if (saved.phase !== 'waiting') {
            uncertain.add(saved.current);
            await saveLocal('event', { event: { action: 'follow', username: saved.current, status: 'uncertain', reasonCode: 'resume-no-confirmation' } });
            log('@' + saved.current + ' ficou sem confirmação e não será repetido nesta fila.');
          }
        }
        durable.current = null;
        durable.phase = 'idle';
        durable.completed = [...completed];
        durable.uncertain = [...uncertain];
        durable.followed = counts.following;
        durable.requested = counts.requested;
        await persist();
        heartbeat = setInterval(() => {
          void persist().catch(error => {
            persistenceError = error;
            state.operation?.requestStop();
          });
        }, 10000);
        signal.throwIfAborted();
        const remaining = Math.max(0, target - counts.following - counts.requested);
        const result = remaining ? await flow().followAutomatically(tabId, references, {
          owner,
          target: remaining,
          signal,
          onDiagnostic: log,
          skipUsernames: [...completed, ...uncertain],
          aiMode,
          followerFallback,
          profile: state.profile,
          decisions: durable.decisions,
          async onObserved(candidates) {
            await saveLocal('candidates', { candidates });
            observeQueue(candidates, durable);
            await persist();
          },
          async onDecision(decision) {
            durable.decisions = decision.step;
            durable.reason = `IA: ${decision.action}. ${decision.reason || ''}`;
            await persist();
            await saveLocal('event', { event: { action: 'run', status: 'started', reasonCode: 'agent-' + decision.action } });
            log(`IA · ${decision.action}: ${decision.reason || ''}`);
          },
          async onCandidate(candidate) {
            await saveLocal('candidates', { candidates: [candidate] });
            durable.current = candidate.username;
            durable.phase = 'waiting';
            durable.processed += 1;
            if (!durable.queue.includes(candidate.username)) durable.queue.push(candidate.username);
            rememberQueueCandidate(candidate);
            state.queueMessage = 'Preparando @' + candidate.username + '…';
            state.queueNextAt = null;
            await persist();
          },
          async onDispatch(username) {
            if (completed.has(username) || uncertain.has(username)) throw new Error('O perfil já foi conferido nesta fila.');
            await checkpointDispatch(username, () => {
              durable.current = username;
              durable.phase = 'dispatching';
              durable.dispatchAt = Date.now();
              state.queueMessage = 'Enviando ação para @' + username + '…';
              return persist();
            });
          },
          async onUncertain(username) {
            uncertain.add(username);
            durable.uncertain = [...uncertain];
            durable.uncertainAt = { ...durable.uncertainAt, [username]:durable.dispatchAt || Date.now() };
            durable.current = null;
            durable.phase = 'idle';
            await saveLocal('event', {event:{action:'follow',username,status:'uncertain',reasonCode:'confirmation-pending'}});
            await persist();
          },
          async onUpdate(update) {
            queueUpdate(update, durable);
            const username = cleanUsername(update?.username);
            if (username && ['already', 'following', 'requested', 'remembered', 'skipped'].includes(update.status) && !completed.has(username)) {
              completed.add(username);
              if (Object.hasOwn(counts, update.status)) counts[update.status] += 1;
              else durable.skipped += 1;
              durable.completed = [...completed];
              durable.followed = counts.following;
              durable.requested = counts.requested;
              durable.current = null;
              durable.phase = 'idle';
              await persist();
            }
            if (!signal.aborted && typeof update?.message === 'string') {
              const confirmed = counts.following + counts.requested;
              showProgress(`${confirmed} de ${target} · ${update.message}`, false, Math.min(confirmed / target, 1));
            }
          },
        }) : { reason: 'target' };
        if (persistenceError) throw persistenceError;
        durable.status = ['stopped', 'quota', 'agent-stopped'].includes(result.reason) ? 'paused' : 'completed';
        durable.reason = result.reason;
        const message = automaticFollowSummary({ ...result, ...counts, checked: durable.processed });
        state.queueMessage = message;
        showProgress(message);
        log(message);
      } catch (error) {
        durable.status = platformRestricted(error) || (signal.aborted && !error?.clickSent) ? 'paused' : 'error';
        if (!error?.clickSent) { durable.current = null; durable.phase = 'idle'; }
        durable.reason = error?.clickSent ? 'Confirmação pendente. O perfil atual ficará sem repetição nesta fila.' :
          persistenceError ? 'Falha ao salvar. Progresso anterior preservado.' : signal.aborted ? 'Interrompido pelo usuário.' : errorText(error);
        state.queueMessage = durable.reason;
        if (error?.clickSent && durable.current) { uncertain.add(durable.current); durable.uncertain = [...uncertain]; }
        if (error?.clickSent) {
          log('Um clique foi enviado, mas o resultado não pôde ser confirmado.');
          throw error;
        }
        if (signal.aborted || error?.name === 'AbortError') {
          const message = automaticFollowSummary({ ...counts, checked: durable.processed, reason: 'stopped' });
          showProgress(message);
          log(message);
        } else {
          log('O modo automático terminou com erro.');
          throw error;
        }
      } finally {
        clearInterval(heartbeat);
        state.queueExecuting = false;
        try {
          await writes;
          await persist();
        } catch (error) {
          if (ui.localStatus) report(ui.localStatus, 'Não consegui salvar a atualização da fila. O último salvamento foi preservado.', true);
          throw error;
        }
        removeCompletedSuggestions(completed);
        await Promise.all([saveDiscoveryLog(owner), refreshHistory(), refreshFollowQuota(), refreshLocalData()]);
      }
    }, { message: 'Buscando sugestões do Instagram…', kind:'follow', runId:saved?.id, stoppable: true, showMeter: true });
  }

  function removeCompletedSuggestions(completed) {
    if (!completed.size) return;
    state.recommendations = state.recommendations.filter(entry => !completed.has(entry.username));
    for (const username of completed.keys()) state.selected.delete(username);
    renderSuggestions();
  }

  async function followSelected() {
    if (state.operation || !state.profile || !state.selected.size) return;
    let references;
    try { references = readReferences(); }
    catch (error) { report(ui.referenceStatus, errorText(error), true); return; }
    const followerFallback = ui.automaticFollowSource?.value === 'fallback';
    const rows = cachedRecommendations(references, followerFallback).filter(row => state.selected.has(row.username));
    if (rows.length !== state.selected.size) {
      await showSavedSuggestions(references);
      suggestionsStatus('A seleção mudou. Confira os perfis salvos antes de iniciar o lote.');
      return;
    }
    const usernames = rows.map(row => row.username);
    await run(async (signal, checkpointDispatch) => {
      const owner = cleanUsername(state.profile.username);
      const log = startOperationLog('Lote iniciado', true);
      const completed = new Map();
      const durable = { id: state.operation.runId, kind: 'follow', mode: 'manual', status: 'running', phase: 'idle',
        target: usernames.length, queue: [...usernames], current: null, completed: [], uncertain: [], references, followerFallback,
        followed: 0, requested: 0, processed: 0, skipped: 0, startedAt: Date.now() };
      state.queueRun = durable; state.queueExecuting = true; state.queueResults.clear(); state.queueNextAt = null;
      state.queueMessage = 'Preparando o lote selecionado…';
      for (const candidate of state.recommendations) rememberQueueCandidate(candidate);
      let writes = Promise.resolve(), heartbeat, persistenceError;
      const persist = () => {
        renderQueue();
        const snapshot = structuredClone(durable);
        writes = writes.then(() => saveLocal('run', { run: snapshot }));
        return writes;
      };
      const saveProgress = () => void persist().catch(error => { persistenceError = error; state.operation?.requestStop(); });
      const rememberResult = result => {
        const username = cleanUsername(result?.username);
        if (usernames.includes(username) && ['following', 'requested', 'skipped', 'remembered'].includes(result.status)) {
          completed.set(username, result.status);
          durable.completed = [...completed.keys()];
          durable.followed = [...completed.values()].filter(status => status === 'following').length;
          durable.requested = [...completed.values()].filter(status => status === 'requested').length;
          durable.processed = completed.size;
          durable.skipped = completed.size - durable.followed - durable.requested;
          if (durable.current === username) {
            durable.current = null; durable.phase = 'idle'; durable.dispatchAt = 0;
          }
        }
      };
      const rememberUncertain = async username => {
        if (durable.current !== username || durable.phase !== 'dispatching' || durable.uncertain.includes(username)) return;
        durable.uncertain = [username];
        durable.status = 'paused';
        await persist();
      };
      let outcome = 'Lote incompleto.';
      let finished = false;
      log(`Perfis selecionados para o lote: ${usernames.length}.`);
      try {
        await persist();
        heartbeat = setInterval(saveProgress, 10000);
        const results = await flow().followSelectedFromLists(tabId, references, rows, {
          signal,
          owner,
          onDiagnostic: log,
          async onCandidate(candidate) {
            const username = cleanUsername(candidate?.username);
            if (!usernames.includes(username)) return;
            durable.current = username;
            durable.phase = 'waiting';
            rememberQueueCandidate(candidate);
            await persist();
          },
          async onDispatch(username) {
            if (!usernames.includes(username) || completed.has(username)) throw new Error('O perfil não está na seleção atual.');
            await checkpointDispatch(username, () => {
              durable.current = username;
              durable.phase = 'dispatching';
              durable.dispatchAt = Date.now();
              state.queueMessage = `Seguindo pela lista de origem · @${username}`;
              return persist();
            });
          },
          onUncertain: rememberUncertain,
          async onUpdate(result) {
            rememberResult(result);
            queueUpdate(result, durable);
            await persist();
            onUpdate(result);
          },
        });
        results.forEach(rememberResult);
        if (persistenceError) throw persistenceError;
        signal.throwIfAborted();
        finished = completed.size === usernames.length;
        if (finished) outcome = 'Lote concluído.';
        durable.status = finished ? 'completed' : 'paused';
        state.queueMessage = outcome;
        const statuses = [...completed.values()];
        const following = statuses.filter(status => status === 'following').length;
        const requested = statuses.filter(status => status === 'requested').length;
        const remaining = usernames.length - completed.size;
        const result = `${following} perfis seguidos · ${requested} solicitações · ${durable.skipped} perfis pulados`;
        showProgress(`${result}${remaining ? ` · ${remaining} pendentes` : ''}.`);
      } catch (error) {
        if (error?.clickSent) outcome = 'O lote terminou com um clique sem confirmação.';
        else outcome = signal.aborted || error?.name === 'AbortError' ? 'Lote interrompido.' : 'O lote terminou com erro.';
        if (error?.clickSent && durable.current) {
          try { await rememberUncertain(durable.current); }
          catch { log('Não foi possível registrar a pendência. O estado anterior ao clique foi preservado.'); }
        }
        if (!durable.uncertain.length) {
          durable.current = null; durable.phase = 'idle'; durable.dispatchAt = 0;
        }
        durable.status = durable.uncertain.length || platformRestricted(error) || signal.aborted ? 'paused' : 'error';
        state.queueMessage = outcome;
        throw error;
      } finally {
        clearInterval(heartbeat);
        state.queueExecuting = false;
        durable.reason = outcome;
        try { await writes; await persist(); }
        catch { report(ui.localStatus, 'Não consegui salvar a atualização visual da fila. O histórico confirmado foi preservado.', true); }
        log(`${outcome} Perfis conferidos no lote: ${completed.size} de ${usernames.length}.`);
        removeCompletedSuggestions(new Set([...completed.keys(), ...durable.uncertain]));
        await saveDiscoveryLog(owner);
        await refreshHistory();
        await refreshLocalData();
      }
    }, { message: 'Preparando a sequência pelas listas de referência…', kind:'follow', stoppable: true });
  }

  function historyLabel(entry) {
    if (entry.reviewState === 'unfollowed') return 'Deixou de seguir';
    if (entry.reviewState === 'kept') return 'Mantido';
    if (entry.reviewState === 'gone') return 'Relação encerrada';
    const time = new Date(entry.followedAt);
    const date = Number.isNaN(time.getTime()) ? '' : ' · ' + dateFormat.format(time);
    const status = entry.status === 'requested' ? 'Solicitação enviada' : 'Seguindo';
    return status + date;
  }

  const historyView = { owner: null, entries: [], rows: new Map(), frame: 0 };
  const historyOverscan = 5;
  const historyObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(scheduleHistoryWindow) : null;

  function historyIndex(element) {
    const row = element?.closest('.history-row');
    return row?.parentElement === ui.history ? Number(row.dataset.index) : -1;
  }

  function historyRow(index) {
    const { entry, username } = historyView.entries[index];
    const row = make('li', { className: 'history-row' });
    row.dataset.index = String(index);
    row.setAttribute('aria-posinset', String(index + 1));
    row.setAttribute('aria-setsize', String(historyView.entries.length));
    const link = profileLink(username);
    const content = make('div', { className: 'row-contents' });
    content.append(link, make('p', { textContent: historyLabel(entry) }));
    row.append(content);
    return { row, link };
  }

  function paintHistoryWindow() {
    const total = historyView.entries.length;
    if (!ui.historyDisclosure?.open || !total) return;
    const rowHeight = ui.historyMeasure.getBoundingClientRect().height;
    if (!rowHeight) return;
    ui.history.style.blockSize = `${total * rowHeight}px`;
    const { scrollTop, clientHeight } = ui.historyViewport;
    const first = Math.min(total - 1, Math.floor(scrollTop / rowHeight));
    const start = Math.max(0, first - historyOverscan);
    const end = Math.min(total, Math.ceil((scrollTop + clientHeight) / rowHeight) + historyOverscan);
    const focused = historyIndex(document.activeElement);
    const wanted = Array.from({ length: end - start }, (_, offset) => start + offset);
    // Keep the focused link mounted while the user scrolls with the pointer.
    if (focused >= 0 && focused < start) wanted.unshift(focused);
    if (focused >= end && focused < total) wanted.push(focused);
    const wantedIndices = new Set(wanted);
    for (const [index, { row }] of historyView.rows) {
      if (wantedIndices.has(index)) continue;
      row.remove();
      historyView.rows.delete(index);
    }
    let next = ui.history.firstElementChild;
    for (const index of wanted) {
      const current = historyView.rows.get(index) ?? historyRow(index);
      historyView.rows.set(index, current);
      current.row.style.setProperty('--history-row-offset', `${index * rowHeight}px`);
      current.link.tabIndex = index === (focused >= 0 ? focused : first) ? 0 : -1;
      if (current.row === next) next = next.nextElementSibling;
      else ui.history.insertBefore(current.row, next);
    }
  }

  function scheduleHistoryWindow() {
    if (!ui.historyDisclosure?.open || historyView.frame) return;
    historyView.frame = requestAnimationFrame(() => {
      historyView.frame = 0;
      paintHistoryWindow();
    });
  }

  function resetHistoryRows() {
    if (historyView.frame) cancelAnimationFrame(historyView.frame);
    historyView.frame = 0;
    historyView.rows.clear();
    ui.history.replaceChildren();
  }

  function focusHistoryRow(index) {
    const rowHeight = ui.historyMeasure.getBoundingClientRect().height;
    const viewport = ui.historyViewport;
    if (!rowHeight) return;
    const top = index * rowHeight;
    if (top < viewport.scrollTop) viewport.scrollTop = top;
    else if (top + rowHeight > viewport.scrollTop + viewport.clientHeight) {
      viewport.scrollTop = top + rowHeight - viewport.clientHeight;
    }
    paintHistoryWindow();
    historyView.rows.get(index)?.link.focus({ preventScroll: true });
    paintHistoryWindow();
  }

  function renderHistory(entries) {
    const owner = state.profile?.username ?? null;
    const sameOwner = owner === historyView.owner;
    const focused = sameOwner ? historyView.entries[historyIndex(document.activeElement)] : null;
    historyView.owner = owner;
    historyView.entries = entries.flatMap(entry => {
      const username = cleanUsername(entry?.username);
      return username ? [{ entry, username }] : [];
    });
    resetHistoryRows();
    if (!sameOwner) ui.historyViewport.scrollTop = 0;
    const total = historyView.entries.length;
    ui.historyViewport.hidden = ui.historyCount.hidden = ui.historyKeys.hidden = !total;
    ui.historyCount.textContent = total === 1 ? '1 registro' : `${total.toLocaleString('pt-BR')} registros`;
    report(ui.historyStatus, total ? '' : 'Nenhuma conta registrada neste fluxo.');
    paintHistoryWindow();
    if (focused) {
      const index = historyView.entries.findIndex(row => row.username === focused.username && row.entry.owner === focused.entry.owner);
      if (index >= 0) focusHistoryRow(index);
    }
  }

  ui.historyDisclosure.addEventListener('toggle', () => {
    if (ui.historyDisclosure.open) {
      historyObserver?.observe(ui.historyViewport);
      historyObserver?.observe(ui.historyMeasure);
      scheduleHistoryWindow();
    } else {
      historyObserver?.disconnect();
      resetHistoryRows();
    }
  });
  ui.historyViewport.addEventListener('scroll', scheduleHistoryWindow, { passive: true });
  ui.historyViewport.addEventListener('focusout', scheduleHistoryWindow);
  ui.historyViewport.addEventListener('keydown', event => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || !historyView.entries.length) return;
    if (!['ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) return;
    const rowHeight = ui.historyMeasure.getBoundingClientRect().height;
    if (!rowHeight) return;
    const current = historyIndex(event.target);
    const position = current < 0 ? Math.floor(ui.historyViewport.scrollTop / rowHeight) : current;
    const page = Math.max(1, Math.floor(ui.historyViewport.clientHeight / rowHeight) - 1);
    const last = historyView.entries.length - 1;
    const target = { ArrowUp: position - 1, ArrowDown: position + (current < 0 ? 0 : 1),
      Home: 0, End: last, PageUp: position - page, PageDown: position + page }[event.key];
    event.preventDefault();
    focusHistoryRow(Math.min(last, Math.max(0, target)));
  });

  async function refreshHistory() {
    const generation = ++state.historyGeneration;
    ui.refreshHistory.disabled = true;
    try {
      const result = await rpc('history', { owner: state.profile?.username });
      if (generation === state.historyGeneration) renderHistory(result?.entries ?? []);
    } catch (error) {
      if (generation === state.historyGeneration) report(ui.historyStatus, errorText(error), true);
    } finally {
      if (generation === state.historyGeneration) ui.refreshHistory.disabled = false;
    }
  }

  function unfollowAllSummary(progress) {
    if (!Number.isSafeInteger(progress?.unfollowed) || !Number.isSafeInteger(progress?.total)) return '';
    const deferred = Array.isArray(progress.deferred) ? progress.deferred.length : progress.deferred;
    return `Perfis removidos: ${progress.unfollowed} de ${progress.total}.` +
      (progress.protectedCount > 0 ? ` Protegidos: ${progress.protectedCount}.` : '') +
      (Number.isSafeInteger(deferred) && deferred > 0 ? ` Pendentes para nova conferência: ${deferred}.` : '');
  }

  async function unfollowAll(event) {
    const owner = cleanUsername(state.profile?.username);
    if (!event.isTrusted || !owner || state.savingReferences) return;
    if (cleanerPanel?.hasPendingProtection()) {
      showProgress('A lista branca tem alterações pendentes. Salve a proteção no Limpa Perfil antes de iniciar a remoção.', true);
      return;
    }
    await run(async (signal, checkpointDispatch) => {
      const engine = globalThis.instagramFlowUnfollowAll;
      if (!engine?.run) throw new Error('Não consegui iniciar a remoção. Reabra o painel da extensão.');
      const log = startOperationLog('Remoção de todos os perfis iniciada', true);
      let progress;
      let finalCheckpointSaved = false;
      const deferred = new Map();
      const skipped = new Set();
      const durable = { id: state.operation.runId, kind: 'unfollow-all', status: 'running', startedAt: Date.now(),
        target: 0, processed: 0, skipped: 0, queue: [], completed: [], current: null, phase: 'idle' };
      const summaryOf = value => unfollowAllSummary({ ...value, deferred: value?.deferred ?? deferred.size });
      const persist = async task => {
        try {
          const saved = await task();
          updateSideProgress({ ...durable, uncertain: [...skipped, ...deferred.keys()] });
          return saved;
        }
        catch (cause) {
          const error = new Error(errorText(cause), { cause });
          error.code = 'unfollow-checkpoint-storage-failed';
          error.phase = durable.phase;
          error.username = durable.current;
          error.persistenceFailure = true;
          error.workflowMessage = `${error.message} ${summaryOf(progress)}`.trim();
          throw error;
        }
      };
      try {
        await persist(() => saveLocal('run', { run: durable }));
        const result = await engine.run(tabId, owner, {
          signal, allowProfileRecovery: ui.unfollowProfileRecovery.checked,
          async onQueue(usernames, total) {
            durable.queue = usernames;
            durable.target = Number.isSafeInteger(total) ? total : usernames.length;
            await persist(() => saveLocal('run', { run: durable }));
          },
          async onCheckpoint(update) {
            if (update.status === 'unfollowed') {
              if (!durable.completed.includes(update.username)) durable.completed.push(update.username);
              durable.processed = durable.completed.length;
              deferred.delete(update.username);
              skipped.delete(update.username);
              await persist(() => rpc('recordUnfollow', { owner, username: update.username }));
              await persist(() => saveLocal('event', { event: { action: 'unfollow', username: update.username, status: 'unfollowed',
                reasonCode: update.reconciled ? 'native-timeout-profile-confirmed' : 'remove-all-confirmed' } }));
              durable.current = null;
              durable.phase = 'idle';
              log('Deixou de seguir @' + update.username + (update.reconciled ? ' · confirmado ao conferir o perfil após a espera.' : '.'));
            } else if (update.status === 'deferred') {
              deferred.set(update.username, { reason:update.reason, phase:update.phase });
              await persist(() => saveLocal('event', { event: { action:'unfollow', username:update.username, status:'skipped',
                reasonCode:update.reason || 'native-confirmation-timeout-still-following' } }));
              durable.current = null;
              durable.phase = 'idle';
              log('@' + update.username + ' continua em Seguindo após a conferência. Perfil adiado; a lista continuará.');
            } else if (update.status === 'skipped') {
              skipped.add(update.username);
              const protectedProfile = update.reason === 'protected';
              await persist(() => saveLocal('event', { event: { action:'unfollow', username:update.username, status:'skipped',
                reasonCode:protectedProfile ? 'protected' : 'not-currently-following' } }));
              durable.current = null;
              durable.phase = 'idle';
              log(protectedProfile ? `@${update.username} preservado pela lista branca.`
                : `@${update.username} não estava mais em Seguindo. Nenhuma nova ação foi enviada.`);
            } else {
              durable.current = update.username;
              durable.phase = update.status === 'waiting' ? 'waiting' : 'dispatching';
              if (durable.phase === 'dispatching') durable.dispatchAt = Date.now();
            }
            durable.skipped = new Set([...skipped, ...deferred.keys()]).size;
            const save = () => persist(() => saveLocal('run', { run: durable }));
            if (update.status === 'started') await checkpointDispatch(update.username, save);
            else await save();
          },
          onUpdate(update) {
            if (Number.isSafeInteger(update?.total)) progress = { ...progress, ...update };
            if (signal.aborted || typeof update?.message !== 'string') return;
            if (update.diagnostic) log(update.message);
            if (update.reason === 'native-following-unavailable') void diagnostic({event:'native-list.pending',level:'warn',reason:update.reason,
              expected:update.diagnostics?.followingCount,observed:update.diagnostics?.followingControls,count:update.diagnostics?.followControls});
            const loaded = update.loaded ?? update.unfollowed;
            const expected = update.expected ?? update.total;
            const completion = Number.isFinite(loaded) && expected > 0 ? Math.min(loaded / expected, 1) : null;
            showProgress(update.message, false, completion);
          },
        });
        progress = { ...progress, ...result };
        if (signal.aborted) throw Object.assign(new Error('Remoção interrompida.'), { name:'AbortError', progress });
        if (result.error || result.completed !== true || result.remaining !== (result.protectedCount ?? 0)) {
          throw Object.assign(new Error(result.message || 'A remoção terminou com perfis pendentes.'), {
            code:result.code || 'unfollow-pending', reason:result.reason || result.code || 'unfollow-pending',
            phase:result.phase || 'reconciling', progress, workflowStatus:'paused' });
        }
        const message = `Remoção concluída. ${summaryOf(result)}`.trim();
        durable.status = 'completed';
        durable.current = null;
        durable.phase = 'idle';
        durable.reason = message;
        await persist(() => saveLocal('run', { run: durable }));
        finalCheckpointSaved = true;
        showProgress(message);
        log(message);
        return { workflowStatus:'completed' };
      } catch (error) {
        const summary = summaryOf(error?.progress ?? progress);
        const interrupted = !error?.persistenceFailure && (signal.aborted || error?.name === 'AbortError');
        const message = interrupted && !error?.clickSent ? 'Remoção interrompida.' : errorText(error);
        error.workflowMessage = `${message} ${summary}`.trim();
        error.phase ||= durable.phase;
        error.username ||= durable.current;
        showProgress(error.workflowMessage, !interrupted || Boolean(error?.clickSent));
        log(error.workflowMessage);
        durable.status = interrupted && !error?.clickSent || error?.workflowStatus === 'paused' ? 'paused' : 'error';
        if (!error?.clickSent && !error?.persistenceFailure) { durable.current = null; durable.phase = 'idle'; }
        durable.reason = message;
        throw error;
      } finally {
        try { if (!finalCheckpointSaved) await persist(() => saveLocal('run', { run: durable })); }
        finally { await Promise.all([saveDiscoveryLog(owner), refreshHistory(), refreshLocalData()]); }
      }
    }, { message: 'Abrindo Seguindo para iniciar a remoção…', kind:'unfollow', stoppable: true, showMeter: true });
  }

  cleanerPanel = globalThis.instagramFluxoCleanerPanel?.create({
    getProfileRecovery: () => ui.unfollowProfileRecovery.checked,
    getOwner: () => cleanUsername(state.profile?.username),
    getBusy: () => Boolean(state.operation || state.savingPacing || state.savingReferences),
    getBlocked: () => Boolean(state.pacing?.block),
    tabId, run, rpc, showProgress, report, make, profileLink, cleanUsername, errorText, refreshHistory, refreshLocalData, updateSideProgress,
  });
  backupPanel = globalThis.instagramFluxoBackupPanel?.create({
    getOwner: () => cleanUsername(state.profile?.username),
    isBusy: () => Boolean(state.operation || state.savingPacing || state.savingReferences),
    onApplied: () => Promise.all([refreshLocalData(true), refreshHistory(), refreshPacing(), cleanerPanel?.reload()]),
  });
  ui.configForm.addEventListener('submit', saveConfiguration);
  ui.vaultForm.addEventListener('submit', openVault);
  ui.lockVault.addEventListener('click', lockVault);
  ui.provider.addEventListener('change', () => {
    updateProvider(ui.provider.value);
    report(ui.configStatus, '');
  });
  ui.loadProfile.addEventListener('click', () => loadProfile(false));
  ui.analyze.addEventListener('click', () => loadProfile(true));
  ui.discover.addEventListener('click', viewSavedSuggestions);
  ui.refreshSuggestions?.addEventListener('click', discoverProfiles);
  ui.selectSuggestionBatch?.addEventListener('click', selectSuggestionBatch);
  ui.automaticFollowForm.addEventListener('submit', startAutomaticFollow);
  ui.copyDiscoveryLog.addEventListener('click', copyDiscoveryLog);
  ui.saveReferences.addEventListener('click', saveReferences);
  ui.savePacing.addEventListener('click', savePacing);
  ui.reportBlock.addEventListener('click', event => void setPlatformBlock(event));
  ui.resumeAfterBlock.addEventListener('click', event => void setPlatformBlock(event, true));
  ui.follow.addEventListener('click', event => {
    if (event.isTrusted) void followSelected();
  });
  ui.stop.addEventListener('click', () => stopOperation(state.operation?.stopToken));
  if (ui.openSidePanel) ui.openSidePanel.hidden = !sideLink;
  ui.openSidePanel?.addEventListener('click', event => {
    if (!event.isTrusted || !sideLink) return;
    void sideLink.open().then(() => report(ui.sidePanelError, ''), error => report(ui.sidePanelError, errorText(error), true));
  });
  ui.refreshHistory.addEventListener('click', refreshHistory);
  ui.unfollowAll.addEventListener('click', unfollowAll);
  ui.resumeFollow?.addEventListener('click', event => void startAutomaticFollow(event, true));
  ui.exportData?.addEventListener('click', exportLocalData);
  ui.refreshLocal?.addEventListener('click', () => void refreshLocalData());
  ui.aiMode?.addEventListener('change', async () => {
    showAIMode();
    const owner = state.profile?.username;
    if (owner) {
      try { await chrome.storage.local.set({ ['instagramFluxoAIMode:' + owner]: ui.aiMode.checked }); }
      catch (error) { if (ui.localStatus) report(ui.localStatus, 'Não foi possível salvar o modo de IA.', true); }
    }
  });
  ui.automaticFollowSource?.addEventListener('change', async () => {
    const owner = state.profile?.username;
    if (!owner || state.operation) return;
    try { await chrome.storage.local.set({ ['instagramFluxoFollowSourceV2:' + owner]: ui.automaticFollowSource.value === 'fallback' ? 'fallback' : 'suggestions' }); }
    catch { if (ui.localStatus) report(ui.localStatus, 'Não foi possível salvar a origem dos perfis.', true); }
    await restoreSuggestions();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      void refreshHistory();
      void refreshSettings();
      void refreshFollowQuota();
      if (!state.operation) { void refreshLocalData(); void refreshPacing(); }
      if (!state.operation) void cleanerPanel?.reload();
    }
  });

  refreshControls();
  renderQueue();
  renderProviderOrder();
  void refreshSettings();
  void refreshHistory();
})();
