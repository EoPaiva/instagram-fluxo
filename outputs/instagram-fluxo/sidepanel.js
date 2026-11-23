'use strict';

(() => {
  const byId = id => document.getElementById('side-' + id);
  const queue = document.querySelector('.queue');
  const kind = byId('kind');
  const owner = byId('owner');
  const current = byId('current');
  const currentName = byId('current-name');
  const progress = byId('progress');
  const progressBar = byId('progress-bar');
  const progressCopy = byId('progress-count');
  const progressLabel = byId('progress-label');
  const results = byId('results');
  const upcoming = byId('upcoming');
  const upcomingList = byId('upcoming-list');
  const state = byId('state');
  const message = byId('message');
  const stopButton = byId('stop');
  const destinations = new Map([
    ['follow', byId('open-follow')],
    ['unfollow', byId('open-unfollow')],
    ['whitelist', byId('open-whitelist')],
  ]);
  const shortcutStatus = byId('shortcut-status');
  const copyButton = byId('copy-summary');
  const copyStatus = byId('copy-status');

  const kinds = {
    follow: 'Seguir perfis',
    unfollow: 'Deixar de seguir',
    'unfollow-all': 'Deixar de seguir',
    cleanup: 'Limpar perfil',
    cleaner: 'Limpar perfil',
    discovery: 'Coletar perfis',
  };
  const states = {
    active: 'Em andamento',
    running: 'Em andamento',
    waiting: 'Aguardando',
    dispatching: 'Enviando ação',
    stopping: 'Parando fila…',
    paused: 'Fila pausada',
    stopped: 'Fila parada',
    completed: 'Fila concluída',
    interrupted: 'Fila interrompida',
    error: 'Fila interrompida',
  };
  const attentions = new Set(['paused', 'stopped', 'interrupted', 'error']);
  const handle = value => typeof value === 'string' && /^@?[a-z0-9._]{1,30}$/i.test(value) ? '@' + value.replace(/^@/, '') : '';
  const count = value => Number.isSafeInteger(value) && value >= 0 ? value : 0;
  const formatted = new Intl.NumberFormat('pt-BR');
  const tabFromQuery = new URLSearchParams(location.search).get('tab');
  const chosenTab = /^\d+$/.test(tabFromQuery ?? '') && Number.isSafeInteger(Number(tabFromQuery)) ? Number(tabFromQuery) : null;

  let monitor;
  let snapshot = null;
  let pendingRun = null;
  let pendingTimer;
  let unacknowledged = false;
  let closed = false;
  let opening = false;
  let copying = false;

  function setText(element, text) {
    if (element.textContent !== text) element.textContent = text;
  }

  function clearPending() {
    clearTimeout(pendingTimer);
    pendingRun = null;
  }

  function canStop() {
    return Boolean(snapshot?.connected && snapshot.canStop && !pendingRun);
  }

  function renderUpcoming(values, activeHandle) {
    const entries = [];
    const seen = new Set([activeHandle.toLowerCase()]);
    for (const value of Array.isArray(values) ? values : []) {
      const name = handle(value);
      if (!name || seen.has(name.toLowerCase())) continue;
      seen.add(name.toLowerCase());
      entries.push(name);
      if (entries.length === 4) break;
    }
    upcoming.hidden = entries.length === 0;
    if (entries.join('\n') === Array.from(upcomingList.children, item => item.textContent).join('\n')) return;
    upcomingList.replaceChildren(...entries.map(name => {
      const item = document.createElement('li');
      item.textContent = name;
      return item;
    }));
  }

  function render() {
    const next = snapshot;
    queue.hidden = !next?.runId;
    stopButton.disabled = !canStop();
    copyButton.hidden = queue.hidden;
    copyButton.disabled = queue.hidden || copying;
    if (queue.hidden) {
      state.dataset.tone = '';
      setText(state, next?.connected ? 'Nenhuma fila em andamento' : 'Nenhuma fila vinculada');
      setText(message, next?.connected ? 'Uma nova fila aparecerá aqui.' : 'Abra o Instagram Fluxo para acompanhar uma fila nesta janela.');
      return;
    }

    const isFollow = next.kind === 'follow';
    const followed = count(next.followed);
    const requested = count(next.requested);
    const done = isFollow ? followed + requested : count(next.processed);
    const target = count(next.target);
    const name = handle(next.current);
    const account = handle(next.owner);
    const label = Object.hasOwn(kinds, next.kind) ? kinds[next.kind] : 'Fila do Instagram';

    setText(kind, label);
    owner.hidden = !account;
    setText(owner, account);
    current.hidden = !name;
    setText(currentName, name);
    progress.hidden = target === 0;
    progressBar.max = Math.max(1, target);
    progressBar.value = Math.min(done, target);
    setText(progressLabel, isFollow ? 'Ações confirmadas' : 'Perfis processados');
    setText(progressCopy, `${formatted.format(done)} de ${formatted.format(target)}`);
    results.hidden = !isFollow;
    setText(results, `Seguidos ${formatted.format(followed)} · Solicitações ${formatted.format(requested)}`);
    renderUpcoming(next.upcoming, name);

    const liveLabel = Object.hasOwn(states, next.status) ? states[next.status] : 'Fila disponível';
    const statusLabel = !next.connected ? 'Último progresso recebido' : pendingRun ? 'Solicitando parada…' : liveLabel;
    const copy = !next.connected ? 'Abra o painel principal para voltar a acompanhar a fila.'
      : unacknowledged ? 'A parada ainda precisa ser confirmada. Confira a fila no painel principal.'
      : pendingRun ? 'Aguarde a confirmação do painel principal.' : next.message || '';
    state.dataset.tone = attentions.has(next.status) || unacknowledged ? 'attention' : '';
    setText(state, statusLabel);
    setText(message, copy);
  }

  function receive(next) {
    const sameRun = next?.connected && next.runId === snapshot?.runId && next.tabId === snapshot?.tabId;
    const acknowledged = sameRun && (next.status === 'stopping' || attentions.has(next.status) || next.status === 'completed');
    if (next?.runId !== snapshot?.runId || next?.tabId !== snapshot?.tabId) setText(copyStatus, '');
    if (!sameRun || acknowledged) {
      clearPending();
      unacknowledged = false;
    } else if (pendingRun && next.canStop && !snapshot.canStop) {
      clearPending();
      unacknowledged = true;
    }
    snapshot = next;
    render();
  }

  stopButton.addEventListener('click', event => {
    if (!event.isTrusted || !monitor || !canStop()) return;
    unacknowledged = false;
    pendingRun = snapshot.runId;
    const sent = monitor.stop();
    if (sent && pendingRun) {
      pendingTimer = setTimeout(() => {
        clearPending();
        unacknowledged = true;
        render();
      }, 8000);
    } else if (!sent) {
      clearPending();
      unacknowledged = true;
    }
    render();
  });

  for (const [destination, button] of destinations) {
    button.addEventListener('click', async event => {
      if (!event.isTrusted || opening || !monitor?.openWorkspace) return;
      opening = true;
      setText(shortcutStatus, 'Abrindo o painel principal…');
      try {
        const opened = await monitor.openWorkspace(destination);
        setText(shortcutStatus, opened ? '' : 'Abra o painel principal pelo ícone da extensão.');
      } catch {
        setText(shortcutStatus, 'Não foi possível abrir o painel principal.');
      } finally { opening = false; }
    });
  }

  copyButton.addEventListener('click', async event => {
    if (!event.isTrusted || queue.hidden || copyButton.disabled || copying) return;
    const nextNames = Array.from(upcomingList.children, item => item.textContent);
    const lines = [kind.textContent, state.textContent];
    if (!owner.hidden) lines.push(`Conta ${owner.textContent}`);
    if (!current.hidden) lines.push(`Perfil atual ${currentName.textContent}`);
    if (!progress.hidden) lines.push(`${progressLabel.textContent} ${progressCopy.textContent}`);
    if (!progress.hidden && !results.hidden) lines.push(results.textContent);
    if (!upcoming.hidden) lines.push(`Na fila ${nextNames.join(', ')}`);
    copying = true;
    render();
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      setText(copyStatus, 'Resumo copiado.');
    } catch {
      setText(copyStatus, 'Não foi possível copiar o resumo.');
    } finally {
      copying = false;
      render();
    }
  });

  addEventListener('pagehide', () => {
    closed = true;
    clearPending();
    monitor?.close();
  }, { once: true });

  async function connect() {
    try {
      const windowContext = await chrome.windows.getCurrent();
      const [activeTab] = chosenTab === null ? await chrome.tabs.query({ active: true, windowId: windowContext.id }) : [];
      if (closed) return;
      monitor = globalThis.instagramFluxoSideLink.createMonitor({
        windowId: windowContext.id,
        fallbackTabId: chosenTab ?? activeTab?.id,
        onUpdate: receive,
      });
      for (const button of destinations.values()) button.disabled = typeof monitor.openWorkspace !== 'function';
    } catch {
      setText(state, 'Painel lateral indisponível');
      setText(message, 'Reabra o painel lateral pelo Instagram Fluxo.');
    }
  }

  void connect();
})();
