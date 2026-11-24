(() => {
  'use strict';

  const pageSize = 200;
  const storagePrefix = 'instagramFluxoCleaner:v1:';
  const categories = { business: 'Página ou empresa', company: 'Página ou empresa', person: 'Perfil pessoal', unknown: 'Tipo incerto' };
  const isBusiness = row => row.kind === 'business' || row.kind === 'company';

  function create({ getOwner, getBusy, getBlocked, tabId, run, rpc, showProgress, report, make, profileLink, cleanUsername,
    errorText, refreshHistory, refreshLocalData, getProfileRecovery = () => false, updateSideProgress = () => {} }) {
    const el = suffix => document.getElementById('cleaner-' + suffix);
    if (!el('scan')) return null;

    let owner = '';
    let snapshot = null;
    let pending = false;
    let page = 0;
    let revision = 0;
    let confirmation = null;
    let reloadRequested = false;
    let reloadTimer;
    const manual = new Set();
    const unsavedProtection = new Set();

    const pageRows = () => {
      const reviewed = new Set(snapshot?.reviewed ?? []);
      return (snapshot?.rows ?? []).filter(row => !reviewed.has(row.username));
    };
    const currentPage = () => pageRows().slice(page * pageSize, (page + 1) * pageSize);
    const reviewedJob = () => snapshot?.job?.status === 'pending' ? snapshot.job : null;
    const jobCounts = job => {
      const removed = job.selected.filter(name => job.outcomes?.[name] === 'unfollowed').length;
      const protectedCount = job.selected.filter(name => job.reasons?.[name] === 'protected').length;
      const skipped = job.done.length - removed - protectedCount;
      const remaining = job.selected.length - job.done.length;
      return `${job.done.length} de ${job.selected.length} resolvidos · ${removed} removidos · ${protectedCount} protegidos · ${skipped} pulados · ${remaining} pendentes`;
    };

    function writeStatus(message, error = false) {
      el('status').hidden = !message;
      report(el('status'), message, error);
    }

    function bind(button, listener) {
      button.addEventListener('click', event => {
        if (event.isTrusted) listener(event);
      });
    }

    function renderControls() {
      const busy = getBusy() || pending;
      const ready = Boolean(owner && snapshot);
      const job = reviewedJob();
      const blocked = getBlocked();
      const importDisabled = busy || !ready || Boolean(job);
      el('scan').disabled = importDisabled || blocked || tabId === null;
      el('import').disabled = importDisabled;
      el('protect-name').disabled = busy || !ready;
      el('protect-submit').disabled = busy || !ready;
      el('confirm').disabled = busy || !ready || !currentPage().length || Boolean(job) || Boolean(unsavedProtection.size);
      el('resume').disabled = busy || !job || blocked || tabId === null || (job.uncertain?.length ?? 0) >= job.selected.length - job.done.length;
      el('discard').disabled = busy || !job || Boolean(job.uncertain?.length);
      el('execute').disabled = busy || Boolean(confirmation?.selected.length && (blocked || tabId === null));
      el('prev').disabled = busy || Boolean(unsavedProtection.size) || page === 0;
      el('next').disabled = busy || Boolean(unsavedProtection.size) || (page + 1) * pageSize >= pageRows().length;
      for (const control of el('list').querySelectorAll('input, button')) {
        control.disabled = busy || Boolean(job) || control.dataset.protected === 'true';
      }
      for (const control of el('protected').querySelectorAll('button')) control.disabled = busy;
      for (const control of el('uncertain').querySelectorAll('button')) control.disabled = busy;
      scheduleReload();
    }

    function render() {
      const rows = pageRows();
      const total = snapshot?.rows.length ?? 0;
      const expected = snapshot?.expectedCount;
      const reviewed = total - rows.length;
      const protectedNames = new Set(snapshot?.protectedNames ?? []);
      const mode = snapshot?.complete ? 'Lista completa' : snapshot?.source === 'scan' ? 'Lista parcial' : '';
      const coverage = Number.isSafeInteger(expected) && expected >= total
        ? `${total} de ${expected} perfis` : expected < total && Number.isSafeInteger(expected)
          ? `${total} perfis na lista · contagem do Instagram: ${expected}` : `${total} perfis disponíveis`;
      el('summary').textContent = !owner ? 'Carregue sua conta para começar.' : !snapshot ? `Carregando dados de @${owner}…`
        : [mode, coverage, `${reviewed} revisados`, `${protectedNames.size} protegidos`].filter(Boolean).join(' · ');
      el('protected-count').textContent = protectedNames.size ? String(protectedNames.size) : '';

      const protectedNodes = [];
      for (const username of protectedNames) {
        const item = make('li');
        const button = make('button', { type: 'button', className: 'text-button', textContent: 'Retirar proteção' });
        button.setAttribute('aria-label', 'Retirar proteção de @' + username);
        bind(button, () => void protect(username, false));
        item.append(profileLink(username), button);
        protectedNodes.push(item);
      }
      el('protected').replaceChildren(...protectedNodes);

      const job = snapshot?.job;
      el('job').hidden = !job;
      el('resume').hidden = el('discard').hidden = !reviewedJob();
      if (job) el('job-status').textContent = (job.status === 'complete' ? 'Último lote · ' : 'Lote salvo · ') + jobCounts(job);
      const uncertainNodes = [];
      for (const username of job?.uncertain ?? []) {
        const item = make('li');
        const button = make('button', { type: 'button', className: 'text-button', textContent: 'Pular após conferir' });
        button.setAttribute('aria-label', 'Pular @' + username + ' após conferir no Instagram');
        bind(button, () => void change('cleanerOutcome', { id: job.id, username, status: 'reconciled-skip' },
          `@${username} foi pulado neste lote.`));
        item.append(profileLink(username), button);
        uncertainNodes.push(item);
      }
      el('uncertain').replaceChildren(...uncertainNodes);

      const pages = Math.ceil(rows.length / pageSize);
      page = Math.max(0, Math.min(page, pages - 1));
      const visible = currentPage();
      const nodes = [];
      let selectedCount = 0;
      for (const row of visible) {
        const { username } = row;
        const item = make('li');
        const content = make('div', { className: 'row-contents' });
        const category = categories[row.kind] ?? categories.unknown;
        const details = [category, row.reason].filter(Boolean).join(' · ');
        content.append(profileLink(username));
        if (row.label && row.label !== username) content.append(make('p', { textContent: row.label }));
        content.append(make('p', { className: 'muted', textContent: details }));

        const retry = unsavedProtection.has(username) && !protectedNames.has(username);
        const allowed = !retry && !protectedNames.has(username);
        const label = make('label', { className: 'cleaner-choice' });
        const input = make('input', { type: 'checkbox', checked: allowed && (isBusiness(row) || manual.has(username)) });
        input.dataset.username = username;
        input.dataset.protected = !allowed;
        input.setAttribute('aria-label', allowed ? 'Selecionar @' + username : '@' + username + (retry ? ' com proteção pendente' : ' protegido'));
        if (input.checked) selectedCount += 1;
        input.addEventListener('change', event => {
          if (!event.isTrusted) return;
          if (input.checked) {
            manual.add(username);
            render();
            focusChoice(username);
          } else {
            void protect(username, true, true).then(() => focusChoice(username));
          }
        });
        label.append(input, make('span', { textContent: allowed ? 'Selecionar' : retry ? 'Proteção pendente' : 'Protegido' }));
        if (retry || (allowed && !input.checked)) {
          const button = make('button', { type: 'button', className: 'text-button', textContent: retry ? 'Salvar proteção' : 'Proteger' });
          button.setAttribute('aria-label', 'Proteger @' + username);
          bind(button, () => void protect(username, true, true));
          content.append(button);
        }
        item.append(content, label);
        nodes.push(item);
      }
      el('review').hidden = !visible.length;
      el('list').replaceChildren(...nodes);
      el('page').textContent = pages ? `${page + 1} de ${pages}` : '';
      el('selection').textContent = `${selectedCount} de ${visible.length} selecionados`;
      renderControls();
    }

    function focusChoice(username) {
      const rows = el('list').querySelectorAll('input');
      const input = [...rows].find(choice => choice.dataset.username === username);
      (input && !input.disabled ? input : el('list-heading')).focus({ preventScroll: true });
    }

    function acceptResponse(response, account) {
      if (owner !== account || getOwner() !== account) return false;
      revision += 1;
      snapshot = response;
      for (const username of response.protectedNames) unsavedProtection.delete(username);
      return true;
    }

    async function reload() {
      const account = owner;
      if (!account || pending) return;
      const started = ++revision;
      try {
        const response = await rpc('cleanerRead', { owner: account });
        if (started !== revision || !acceptResponse(response, account)) return;
        render();
      } catch (error) {
        if (started === revision && owner === account) writeStatus(errorText(error), true);
      }
    }

    function scheduleReload() {
      if (!reloadRequested || reloadTimer || !owner || pending || getBusy()) return;
      reloadTimer = setTimeout(() => {
        reloadTimer = null;
        if (!reloadRequested || !owner || pending || getBusy()) return;
        reloadRequested = false;
        void reload();
      }, 100);
    }

    function requestReload() {
      reloadRequested = true;
      scheduleReload();
    }

    function sync() {
      const account = getOwner();
      if (owner === account) { renderControls(); return; }
      owner = account;
      snapshot = null;
      page = 0;
      revision += 1;
      reloadRequested = false;
      manual.clear();
      unsavedProtection.clear();
      confirmation = null;
      el('confirm-dialog').close();
      writeStatus('');
      render();
      void reload();
    }

    async function change(type, payload, message) {
      const account = owner;
      if (!account || !snapshot || getBusy() || pending) return false;
      pending = true;
      revision += 1;
      renderControls();
      let saved = false;
      try {
        const response = await rpc(type, { owner: account, ...payload });
        if (!acceptResponse(response, account)) return false;
        if (message) writeStatus(message);
        saved = true;
        return saved;
      } catch (error) {
        if (owner === account) writeStatus(errorText(error), true);
        return false;
      } finally {
        pending = false;
        render();
        if (!saved) void reload();
      }
    }

    function protect(username, add, fromReview = false) {
      if (fromReview) unsavedProtection.add(username);
      manual.delete(username);
      return change('cleanerProtect', { username, protected: add }, add
        ? `@${username} foi incluído na lista branca.` : `A proteção de @${username} foi retirada.`);
    }

    async function scan() {
      const account = owner;
      if (!account || !snapshot || getBusy() || pending || getBlocked() || reviewedJob()) return;
      const inventory = globalThis.instagramFluxoInventory;
      if (!inventory) { writeStatus('A leitura da lista ainda não está disponível. Recarregue a extensão.', true); return; }
      await run(async signal => {
        const save = async inventoryPage => {
          const response = await rpc('cleanerInventory', { ...inventoryPage, owner: account, source: 'scan' });
          if (!acceptResponse(response, account)) return;
          if (inventoryPage.begin) { page = 0; manual.clear(); render(); }
          const { observed, expectedCount } = inventoryPage;
          el('summary').textContent = Number.isSafeInteger(expectedCount)
            ? observed <= expectedCount ? `${observed} de ${expectedCount} perfis nesta leitura.`
              : `${observed} perfis na lista. O Instagram indica ${expectedCount}.`
            : `${observed} perfis nesta leitura.`;
          showProgress('Lendo quem você segue… ' + el('summary').textContent, false,
            expectedCount > 0 && observed <= expectedCount ? observed / expectedCount : null);
          updateSideProgress({ target: observed <= expectedCount ? expectedCount : null, processed: observed });
        };
        try {
          const inventoryResult = await inventory.scan(tabId, account, { signal, onPage: save });
          const message = inventoryResult.complete ? 'Leitura concluída. Revise a seleção antes de confirmar.'
            : 'A leitura ficou parcial. A revisão mostra somente os perfis encontrados nesta leitura.';
          writeStatus(message);
          showProgress(message);
          return { workflowStatus: inventoryResult.complete ? 'completed' : 'paused' };
        } catch (error) {
          writeStatus(signal.aborted ? 'Leitura interrompida. O progresso já salvo foi mantido.' : errorText(error), !signal.aborted);
          throw error;
        } finally { render(); }
      }, { message: 'Abrindo a lista Seguindo…', kind: 'profile', sideKind: 'cleaner', stoppable: true, showMeter: true });
    }

    async function importFile(file) {
      const account = owner;
      if (!file || !account || !snapshot || pending || getBusy() || reviewedJob()) return;
      pending = true;
      renderControls();
      try {
        const inventory = globalThis.instagramFluxoInventory;
        if (!inventory) throw new Error('Recarregue a extensão para acessar a importação.');
        const result = await inventory.importFile(file);
        const response = await rpc('cleanerInventory', { ...result, owner: account, source: 'archive', replace: true });
        if (acceptResponse(response, account)) writeStatus(`${result.rows.length} perfis importados. Confira se a lista corresponde à sua conta.`);
      } catch (error) {
        if (owner === account) writeStatus(errorText(error), true);
      } finally {
        pending = false;
        el('import').value = '';
        render();
        if (owner !== account) void reload();
      }
    }

    async function execute() {
      const account = owner;
      if (!account || pending || getBusy() || getBlocked()) return;
      const job = reviewedJob();
      if (!job) return;
      const terminal = new Set([...job.done, ...(job.uncertain ?? [])]);
      const selected = job.selected.filter(name => !terminal.has(name));
      if (!selected.length) return;
      const showSideBatch = (batch, phase = 'idle', current = null) => {
        const excluded = new Set([...batch.done, ...(batch.uncertain ?? []), current]);
        updateSideProgress({ target: batch.selected.length, processed: batch.done.length, phase, current,
          upcoming: batch.selected.filter(name => !excluded.has(name)).slice(0, 4) });
      };
      await run(async (signal, checkpointDispatch) => {
        const engine = globalThis.instagramFlowUnfollowAll;
        if (!engine?.run) throw new Error('Reabra o painel para carregar a fila de remoção.');
        showSideBatch(job);
        try {
          const outcome = await engine.run(tabId, account, {
            selected, signal, cleanerJobId: job.id, allowProfileRecovery: getProfileRecovery(),
            async onCheckpoint(update) {
              if (update.status === 'unfollowed') await rpc('recordUnfollow', { owner: account, username: update.username });
              const save = async () => {
                const response = await rpc('cleanerOutcome', { owner: account, id: job.id, username: update.username,
                  status: update.status, reason: update.reason });
                if (acceptResponse(response, account)) {
                  el('job-status').textContent = 'Lote salvo · ' + jobCounts(response.job);
                  const phase = update.status === 'waiting' ? 'waiting' : update.status === 'started' ? 'dispatching' : 'idle';
                  showSideBatch(response.job, phase, phase === 'idle' ? null : update.username);
                }
              };
              if (update.status === 'started') await checkpointDispatch(update.username, save);
              else await save();
            },
            onUpdate(update) {
              if (signal.aborted || !update?.message) return;
              const current = snapshot?.job;
              showProgress(update.message, false, current ? current.done.length / current.selected.length : null);
            },
          });
          const complete = outcome.completed && snapshot?.job?.status === 'complete';
          const message = `${complete ? 'Lote concluído.' : (outcome.message || 'Há perfis pendentes neste lote.')} ${jobCounts(snapshot.job)}.`;
          writeStatus(message);
          showProgress(message);
          return { workflowStatus: complete ? 'completed' : 'paused' };
        } catch (error) {
          writeStatus(signal.aborted && !error?.clickSent ? 'Lote pausado. Você pode retomar pelo painel.' : errorText(error),
            !signal.aborted || Boolean(error?.clickSent));
          throw error;
        } finally {
          await Promise.all([reload(), refreshHistory(), refreshLocalData()]);
        }
      }, { message: 'Abrindo os perfis confirmados…', kind: 'unfollow', sideKind: 'cleaner', runId: job.id, stoppable: true, showMeter: true });
    }

    el('protect-form').addEventListener('submit', event => {
      event.preventDefault();
      if (!event.isTrusted) return;
      const username = cleanUsername(el('protect-name').value.trim().replace(/^@/, ''));
      if (!username || username === owner) { writeStatus('Informe um @ válido diferente da sua conta.', true); return; }
      void protect(username, true).then(saved => { if (saved) el('protect-name').value = ''; });
    });
    el('import').addEventListener('change', event => { if (event.isTrusted) void importFile(el('import').files[0]); });
    bind(el('scan'), () => void scan());
    function movePage(step) {
      page += step;
      render();
      el('list').scrollTop = 0;
      el('list-heading').focus();
    }
    bind(el('prev'), () => movePage(-1));
    bind(el('next'), () => movePage(1));
    bind(el('resume'), () => void execute());
    bind(el('discard'), () => {
      const job = reviewedJob();
      if (job && window.confirm('Descartar o restante do lote salvo? As remoções já confirmadas permanecem no histórico.')) {
        void change('cleanerDiscard', { id: job.id }, 'Lote descartado.');
      }
    });
    bind(el('confirm'), () => {
      const reviewed = currentPage().map(row => row.username);
      const selected = [...el('list').querySelectorAll('input:checked')].map(input => input.dataset.username);
      confirmation = { reviewed, selected, owner };
      el('confirm-summary').textContent = selected.length
        ? `${selected.length} de ${reviewed.length} perfis serão enviados à fila de remoção. Os demais ficam fora deste lote.`
        : `${reviewed.length} perfis serão marcados como revisados. Este lote está sem remoções.`;
      el('execute').textContent = selected.length ? 'Confirmar e iniciar' : 'Concluir revisão';
      el('confirm-dialog').showModal();
      renderControls();
    });
    bind(el('cancel'), () => el('confirm-dialog').close());
    el('confirm-dialog').addEventListener('close', () => { confirmation = null; });
    bind(el('execute'), () => {
      const batch = confirmation;
      if (!batch || batch.owner !== owner || pending || getBusy()) return;
      el('confirm-dialog').close();
      void change('cleanerConfirm', { usernames: batch.selected, reviewed: batch.reviewed },
        batch.selected.length ? 'Lote confirmado.' : 'Revisão concluída.').then(saved => { if (saved && batch.selected.length) void execute(); });
    });
    chrome.storage.onChanged?.addListener((changes, area) => {
      if (area !== 'local' || !owner || !Object.hasOwn(changes, storagePrefix + owner)) return;
      if (el('confirm-dialog').open) {
        el('confirm-dialog').close();
        writeStatus('A revisão mudou em outra aba. Confira a seleção antes de confirmar.');
      }
      requestReload();
    });
    return { sync, reload, requestReload, hasPendingProtection: () => pending || unsavedProtection.size > 0 };
  }

  globalThis.instagramFluxoCleanerPanel = { create };
})();
