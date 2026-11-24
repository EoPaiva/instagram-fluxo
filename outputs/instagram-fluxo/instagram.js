(() => {
  'use strict';

  const origin = 'https://www.instagram.com';
  const handle = /^[a-z0-9._]{1,30}$/;
  const ownerByTab = new Map();
  const batchLimit = 15;

  function username(value) {
    const name = typeof value === 'string' ? value.trim().replace(/^@/, '').toLowerCase() : '';
    if (!handle.test(name) || name === '.' || name === '..') throw new Error('O nome de perfil é inválido.');
    return name;
  }

  function wait(ms, signal) {
    signal?.throwIfAborted();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', abort);
        resolve();
      }, ms);
      function abort() {
        clearTimeout(timer);
        reject(signal.reason);
      }
      signal?.addEventListener('abort', abort, { once: true });
    });
  }

  async function tabAt(tabId) {
    const tab = await chrome.tabs.get(tabId);
    const url = URL.canParse(tab.url) ? new URL(tab.url) : null;
    if (url?.origin !== origin) throw new Error('A aba conectada saiu do Instagram ou perdeu a permissão. Reabra o painel pelo ícone da extensão.');
    if (/^\/(?:challenge|checkpoint|accounts\/(?:suspended|disabled))(?:\/|$)/i.test(url.pathname)) {
      const error = new Error('O Instagram abriu uma verificação ou restrição de acesso. Resolva a solicitação no Instagram antes de retomar.');
      error.code = 'platform-challenge';
      throw error;
    }
    return { tab, url };
  }

  async function navigate(tabId, name, signal, previousPath) {
    const path = '/' + username(name) + '/';
    const start = await tabAt(tabId);
    signal?.throwIfAborted();
    if (previousPath && start.url.pathname !== previousPath) {
      throw new Error('O perfil aberto na aba mudou. Fluxo interrompido.');
    }
    if (start.url.pathname !== path) await chrome.tabs.update(tabId, { url: origin + path });
    const began = Date.now();
    while (Date.now() - began < 90000) {
      signal?.throwIfAborted();
      const { tab, url } = await tabAt(tabId);
      if (url.pathname === path && tab.status === 'complete') return path;
      if (url.pathname !== start.url.pathname && url.pathname !== path) {
        throw new Error('O Instagram abriu uma página diferente do perfil esperado.');
      }
      await wait(300, signal);
    }
    throw new Error('O Instagram demorou para abrir @' + name + '.');
  }

  async function inject(tabId, func, ...args) {
    const [injected] = await chrome.scripting.executeScript({ target: { tabId }, func, args });
    if (!injected || injected.error) throw new Error('Não consegui ler a aba do Instagram.');
    return injected.result;
  }

  async function inspectProfile(expected, operation, token, owner, clickBy, dispatchId) {
    if (operation === 'open-unfollow' || operation === 'commit-unfollow') {
      const guard = await globalThis.instagramFlowAssistedUnfollow.guardRemoval(owner, expected, dispatchId);
      if (guard !== 'allowed') return { state: guard };
    }
    if (location.origin === 'https://www.instagram.com' && /^\/(?:challenge|checkpoint|accounts\/(?:suspended|disabled))(?:\/|$)/i.test(location.pathname)) {
      return { state: 'platform-challenge' };
    }
    const clean = value => (value ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
    const shown = element => element?.isConnected && element.getClientRects().length > 0 &&
      getComputedStyle(element).visibility === 'visible';
    const caption = element => clean(element.innerText);
    const controlSelector = 'button, [role="button"], [role="menuitem"]';
    const modalSelector = '[role="dialog"], [role="alertdialog"], [role="menu"], dialog[open]';
    const main = document.querySelector('main, [role="main"]');
    const header = main?.querySelector('header');
    const surfaces = [...document.querySelectorAll(modalSelector)].filter(shown);
    const alerts = [...document.querySelectorAll('[role="alert"], [aria-live="assertive"]')].filter(shown);
    const challenge = /confirme sua identidade|confirm your identity|captcha/i;
    if (alerts.concat(surfaces).some(element => challenge.test(element.innerText))) return { state: 'platform-challenge' };
    const restriction = /tente (?:novamente |de novo )?mais tarde|try again later|ação bloqueada|action blocked|limitamos|we limit|restringimos|we restrict/i;
    if (alerts.concat(surfaces).some(element => restriction.test(element.innerText))) return { state: 'restricted' };
    if (alerts.concat(surfaces).some(element => /something went wrong|algo deu errado/i.test(element.innerText))) return { state: 'site-error' };
    if (location.origin !== 'https://www.instagram.com' || clean(location.pathname) !== '/' + expected + '/') {
      return { state: 'wrong-profile' };
    }
    const isHighlightsStrip = element => element.matches('div[role="menu"]') &&
      element.parentElement?.matches('section') && element.parentElement.parentElement === header &&
      !element.closest('[role="dialog"], [role="alertdialog"], [aria-modal="true"], dialog[open]') &&
      [...element.querySelectorAll('a[href]')].some(link => shown(link) && link.origin === location.origin &&
        /^\/stories\/highlights\/\d+\/?$/.test(link.pathname));
    const dialogs = surfaces.filter(element => !isHighlightsStrip(element));
    if (operation !== 'owner') {
      const sameAccount = [...document.querySelectorAll('a[href]')].some(anchor =>
        !anchor.closest('main, [role="main"], [role="dialog"], [role="alertdialog"], dialog[open], [role="menu"]') && shown(anchor) && anchor.querySelector('img') &&
        anchor.origin === location.origin && anchor.pathname.replace(/\/$/, '').toLowerCase() === '/' + owner
      );
      if (!sameAccount) return { state: 'wrong-owner' };
    }
    if (!header || ![...header.querySelectorAll('h1, h2, h3, [role="heading"], a[href="#"]')].some(element =>
      shown(element) && caption(element) === expected
    )) return { state: 'waiting' };

    const own = [...header.querySelectorAll('a[href="/accounts/edit/"], a[href="/accounts/edit"]')].some(anchor =>
      shown(anchor) && ['editar perfil', 'edit profile'].includes(caption(anchor))
    );
    if (operation === 'owner') {
      if (!own) return { state: 'wrong-owner' };
      const count = [...header.querySelectorAll('a[href]')].filter(shown)
        .map(anchor=>caption(anchor).match(/^(\d[\d.,\s]*)\s+(?:seguindo|following|a seguir)$/i)).find(Boolean);
      return { state: dialogs.length ? 'open-overlay' : 'owner', followingCount:count ? Number(count[1].replace(/[.,\s]/g,'')) : null };
    }
    if (own) return { state: 'wrong-profile' };

    const followLabels = ['seguir', 'seguir de volta', 'follow', 'follow back'];
    const followingLabels = ['seguindo', 'a seguir', 'following'];
    const requestedLabels = ['solicitado', 'solicitação enviada', 'pedido enviado', 'requested'];
    const unfollowLabels = ['deixar de seguir', 'unfollow'];
    const cancelLabels = ['cancelar', 'cancel'];
    const profileButtons = [...header.querySelectorAll(controlSelector)].filter(control =>
      shown(control) && !control.closest(modalSelector) &&
      [...followLabels, ...followingLabels, ...requestedLabels].includes(caption(control))
    );
    if (profileButtons.length !== 1) return { state: 'waiting' };
    const button = profileButtons[0];
    const buttonText = caption(button);
    const state = followLabels.includes(buttonText) ? 'available' :
      (followingLabels.includes(buttonText) ? 'following' : 'requested');
    if (operation === 'read') return { state, modal: dialogs.length > 0 };

    const usable = control => !control.disabled && !control.closest('[inert], [aria-disabled="true"]');
    const clickable = control => {
      const box = control.getBoundingClientRect();
      return usable(control) && box.width > 0 && box.height > 0 &&
        control.contains(document.elementFromPoint(box.x+box.width/2,box.y+box.height/2));
    };
    if (operation === 'follow' || operation === 'open-unfollow') {
      if (dialogs.length) return { state: 'open-overlay' };
      if (!usable(button)) return { state: 'unexpected' };
      if (operation === 'follow' && state === 'available') {
        if (!['seguir', 'follow'].includes(buttonText)) return { state: 'already-follower' };
        if (!Number.isSafeInteger(clickBy) || Date.now() >= clickBy) return { state: 'permit-expired' };
        button.click();
        return { state: 'sent' };
      }
      if (operation === 'open-unfollow' && state === 'following' && clickable(button) &&
          [...button.querySelectorAll('svg[aria-label]')].some(svg =>
            /seta para baixo|down chevron|down arrow|chevron down/i.test(svg.getAttribute('aria-label')))) {
        if (!Number.isSafeInteger(clickBy) || Date.now() >= clickBy) return { state: 'permit-expired' };
        globalThis.instagramFluxoProfileUnfollow = { token, expected, used: [] };
        button.click();
        return { state: 'menu-opened' };
      }
      return { state: 'unexpected' };
    }

    const pending = globalThis.instagramFluxoProfileUnfollow;
    if (!pending || pending.token !== token || pending.expected !== expected || state !== 'following') {
      return { state: 'unexpected' };
    }
    const options = [...new Set(dialogs.flatMap(dialog => [...dialog.querySelectorAll(controlSelector)]))].filter(control =>
      shown(control) && usable(control) && unfollowLabels.includes(caption(control)) && !pending.used.includes(control)
    );
    if (options.length !== 1) return { state: options.length === 0 ? 'waiting' : 'unexpected' };
    const action = options[0];
    const modal = action.closest(modalSelector);
    if (dialogs.length !== 1) return { state: 'unexpected' };
    const hasCancel = [...modal.querySelectorAll(controlSelector)].some(control =>
      shown(control) && cancelLabels.includes(caption(control)));
    if (!globalThis.instagramFlowAssistedUnfollow.identifiesConfirmation(modal, expected, hasCancel || pending.used.length > 0)) {
      return { state: 'unexpected' };
    }
    if (pending.used.length > 0) {
      if (!hasCancel || pending.used.length > 1) return { state: 'unexpected' };
    }
    if (operation === 'locate-unfollow') return { state: 'ready' };
    if (operation !== 'commit-unfollow') return { state: 'unexpected' };
    if (!clickable(action)) return { state: 'unexpected' };
    if (!Number.isSafeInteger(clickBy) || Date.now() >= clickBy) return { state: 'permit-expired' };
    pending.used.push(action);
    action.click();
    return { state: 'sent' };
  }

  const profileStateErrors = {
    restricted: 'O Instagram exibiu um limite ou verificação. Fluxo interrompido.',
    'platform-challenge': 'O Instagram pediu uma verificação. Resolva a solicitação no aplicativo antes de retomar.',
    'site-error': 'O Instagram exibiu um erro. A fila foi interrompida.',
    'permit-expired': 'A autorização de ritmo expirou antes do clique. A fila foi interrompida.',
    'already-follower': 'Este perfil já segue você. Nenhum clique foi enviado.',
    'platform-restricted': 'O Instagram limitou ações nesta conta. A fila foi pausada.',
    'action-unconfirmed': 'Uma ação anterior precisa ser conferida antes de retomar.',
    'unfollow-protected': 'O perfil foi protegido. Nenhuma nova ação será enviada.',
    'unfollow-not-authorized': 'A seleção salva mudou. A fila foi pausada.',
    'wrong-profile': 'A página aberta não corresponde ao perfil esperado. Fluxo interrompido.',
    'wrong-owner': 'A extensão não conseguiu confirmar a conta conectada. Abra seu próprio perfil no Instagram.',
    'open-overlay': 'Feche o menu ou a janela aberta no Instagram e tente novamente.',
    unexpected: 'O controle esperado mudou ou está desativado. Fluxo interrompido.',
    'state-timeout': 'O Instagram não confirmou o estado esperado.',
  };

  function rejectProfileState(state) {
    if (Object.hasOwn(profileStateErrors, state)) {
      const error = new Error(profileStateErrors[state]);
      error.code = state;
      throw error;
    }
  }

  async function poll(operation, predicate, signal, limit = 90000) {
    const started = Date.now();
    do {
      signal?.throwIfAborted();
      const result = await operation();
      rejectProfileState(result?.state);
      if (predicate(result)) return result;
      await wait(300, signal);
    } while (Date.now() - started < limit);
    rejectProfileState('state-timeout');
  }

  async function ownerOnTab(tabId, owner, signal) {
    const path = await navigate(tabId, owner, signal);
    await poll(() => inject(tabId, inspectProfile, owner, 'owner', '', owner), result => result?.state === 'owner', signal);
    return path;
  }

  async function exclusive(owner, callback, action = 'follow') {
    const accountLock = () => navigator.locks.request('instagram-fluxo:' + username(owner), { ifAvailable: true }, async lock => {
      if (!lock) throw new Error('Já existe um fluxo em andamento para esta conta.');
      try {
        const gate = await rpc({type:'recoverActionHold',owner:username(owner)});
        if (gate?.block) throw pacingBlockError(gate.block);
        return await callback();
      }
      catch (error) {
        const reason = error?.code === 'platform-challenge' ? 'challenge' :
          ['restricted', 'platform-restricted'].includes(error?.code) ? 'rate-limit' :
          error?.clickSent ? 'unconfirmed-action' : null;
        if (reason) {
          try { await rpc({ type: 'pacingBlock', owner: username(owner), reason }); }
          catch (cause) {
            const failure = new Error('A operação foi interrompida, mas a pausa local não pôde ser salva. Pare a fila e confira o Instagram.', { cause });
            failure.code = error.code;
            failure.clickSent = error.clickSent;
            throw failure;
          }
        }
        throw error;
      }
    });
    if (action !== 'unfollow') return accountLock();
    return navigator.locks.request('instagram-fluxo:whitelist', { mode:'shared', ifAvailable:true }, lock => {
      if (!lock) throw new Error('A lista branca está sendo alterada. Aguarde antes de remover perfis.');
      return accountLock();
    });
  }

  async function readPacing(rawOwner) {
    const owner = username(rawOwner);
    return navigator.locks.request('instagram-fluxo:' + owner, { ifAvailable: true }, lock =>
      rpc({ type: lock ? 'recoverActionHold' : 'pacingRead', owner }));
  }

  async function rpc(message) {
    const response = await chrome.runtime.sendMessage(message);
    if (!response?.ok) {
      if (response?.error === 'Ação não reconhecida.') {
        const error = new Error('O serviço da extensão está desatualizado. Em chrome://extensions, clique em Recarregar no Instagram Fluxo e reabra o painel. A fila, o histórico e as chaves salvas são preservados.');
        error.code = 'extension-outdated';
        throw error;
      }
      const error = new Error(response?.error || 'O serviço local da extensão não respondeu.');
      error.code = response?.code;
      error.notBefore = response?.notBefore;
      throw error;
    }
    return response.data;
  }

  async function paceAction(owner, action, signal, onUpdate = () => {}, target = {}) {
    while (true) {
      signal?.throwIfAborted();
      const gate = await rpc({ type: 'pacingRead', owner });
      if (gate?.block) throw pacingBlockError(gate.block);
      if (!Number.isFinite(gate?.waitMs) || gate.waitMs < 0) throw new Error('Não foi possível verificar o intervalo entre ações.');
      if (gate.waitMs > 0) {
        await onUpdate({ phase: 'waiting', nextAt: Number.isSafeInteger(gate.nextAt) ? gate.nextAt : Date.now() + gate.waitMs,
          message: 'Pausa de ritmo: aguardando ' + Math.ceil(gate.waitMs / 1000) + ' s antes da próxima ação.' });
        await wait(gate.waitMs, signal);
        continue;
      }
      try {
        signal?.throwIfAborted();
        const permit = await rpc({ type: 'pacingCommit', owner, action, ...target });
        if (!Number.isSafeInteger(permit?.clickBy) || permit.clickBy <= Date.now()) throw new Error('A autorização de ritmo não pôde ser confirmada.');
        if (action === 'unfollow' && typeof permit.dispatchId !== 'string') {
          throw new Error('A autorização para remoção não pôde ser confirmada. Reabra o painel da extensão.');
        }
        return permit;
      } catch (error) {
        if (error?.code !== 'action-wait') throw error;
        await wait(Math.max(100, (error.notBefore ?? Date.now() + 1000) - Date.now()), signal);
      }
    }
  }

  function pacingBlockError(block) {
    const unconfirmed = block.reason === 'unconfirmed-action';
    const error = new Error(unconfirmed ? 'Uma ação anterior precisa ser conferida. Confira o perfil no Instagram e libere a fila pelo painel.' :
      'As ações estão pausadas por um aviso do Instagram. Confira o aplicativo e retome após o desbloqueio.');
    error.code = unconfirmed ? 'action-unconfirmed' : block.reason === 'challenge' ? 'platform-challenge' : 'platform-restricted';
    return error;
  }

  function readRelationship(tabId, name, account, signal) {
    return poll(async () => {
      const observed = await inject(tabId, inspectProfile, name, 'read', '', account);
      return observed?.modal ? { state: 'open-overlay' } : observed;
    }, value => ['available', 'following', 'requested'].includes(value?.state), signal);
  }

  async function executeFollow(tabId, account, names, { signal, onUpdate, onDiagnostic }) {
    let target;
    let step = 'preparar o lote';
    try {
      const remembered = await historicalFollows(account);
      step = 'confirmar seu próprio perfil';
      onDiagnostic('Confirmando o próprio perfil na aba do Instagram.');
      let previousPath = await ownerOnTab(tabId, account, signal);
      onDiagnostic('Conta conectada confirmada.');
      const results = [];
      async function skipRemembered(name, reason) {
        const result = { username: name, status: 'remembered' };
        results.push(result);
        await onUpdate({ ...result, message: '@' + name + (reason === 'previously-uncertain'
          ? ' tem uma tentativa anterior sem confirmação. Perfil pulado.' : ' já foi seguido antes. Perfil pulado.') });
      }
      for (const [index, name] of names.entries()) {
        signal?.throwIfAborted();
        target = name;
        if (remembered.has(name)) {
          await skipRemembered(name, remembered.get(name));
          continue;
        }
        step = 'abrir o perfil';
        await onUpdate({ username: name, message: 'Conferindo @' + name + '…' });
        previousPath = await navigate(tabId, name, signal, previousPath);
        step = 'conferir o botão Seguir';
        const current = await readRelationship(tabId, name, account, signal);
        if (current.state !== 'available') {
          const result = { username: name, status: 'already' };
          results.push(result);
          await onUpdate({ ...result, message: '@' + name + ' já está seguido ou solicitado.' });
          continue;
        }
        signal?.throwIfAborted();
        step = 'acionar o botão Seguir';
        await onUpdate({ username: name, phase: 'waiting', message: 'Preparando @' + name + '…' });
        const permit = await paceAction(account, 'follow', signal, onUpdate);
        // Recheck the durable memory after any long wait, before native dispatch.
        const currentMemory = (await historicalFollows(account)).get(name);
        if (currentMemory) {
          await skipRemembered(name, currentMemory);
          continue;
        }
        signal?.throwIfAborted();
        await onUpdate({ username: name, phase: 'dispatching', message: 'Enviando ação para @' + name + '…' });
        signal?.throwIfAborted();
        let action;
        try {
          action = await inject(tabId, inspectProfile, name, 'follow', '', account, permit.clickBy);
        } catch (error) {
          const uncertain = new Error('Confira @' + name + ' no Instagram. Não foi possível confirmar se o clique foi enviado.');
          uncertain.clickSent = true;
          throw uncertain;
        }
        if (action.state !== 'sent') {
          rejectProfileState(action.state);
          throw new Error('O botão Seguir de @' + name + ' mudou.');
        }
        // A click already sent can finish after Stop; record its observed outcome before stopping the batch.
        let confirmed;
        try {
          step = 'confirmar o resultado do clique';
          confirmed = await poll(() => inject(tabId, inspectProfile, name, 'read', '', account), value =>
            ['following', 'requested'].includes(value?.state) && !value.modal, undefined, 20000);
          await wait(450);
          const next = await inject(tabId, inspectProfile, name, 'read', '', account);
          if (next.state !== confirmed.state || next.modal) throw new Error('O estado do perfil mudou.');
          step = 'registrar a confirmação';
          await rpc({ type: 'record', owner: account, username: name, status: confirmed.state });
        } catch (error) {
          const uncertain = new Error('Confira @' + name + ' no Instagram. O clique foi enviado, mas não consegui confirmar e registrar a ação. ' + error.message);
          uncertain.code = error.code;
          uncertain.clickSent = true;
          throw uncertain;
        }
        const result = { username: name, status: confirmed.state };
        results.push(result);
        try {
          await onUpdate({ ...result, message: confirmed.state === 'following' ?
            'Seguindo @' + name + '.' : 'Solicitação enviada a @' + name + '.' });
        } catch (cause) {
          const error = new Error('O resultado de @' + name + ' foi registrado, mas a fila não pôde ser atualizada.', { cause });
          error.clickSent = true;
          throw error;
        }
        if (signal?.aborted || index === names.length - 1) return results;
      }
      return results;
    } catch (error) {
      if (signal?.aborted && !error?.clickSent) throw error;
      const reason = profileStateErrors[error?.code];
      const label = target ? '@' + target + ' · ' : '';
      onDiagnostic(label + 'Falha ao ' + step + '.' + (reason ? ' ' + reason : ''));
      if (target && !error?.clickSent && reason) {
        const detailed = new Error('@' + target + ': ' + reason, { cause: error });
        detailed.code = error.code;
        throw detailed;
      }
      throw error;
    }
  }

  async function follow(tabId, usernames, { owner, signal, onUpdate = () => {}, onDiagnostic = () => {} } = {}) {
    const account = username(owner ?? ownerByTab.get(tabId));
    const names = [...new Set(usernames.map(username))].filter(name => name !== account);
    if (names.length === 0 || names.length > batchLimit) {
      throw new Error('Selecione de 1 a ' + batchLimit + ' perfis para seguir.');
    }
    return exclusive(account, () => executeFollow(tabId, account, names, { signal, onUpdate, onDiagnostic }));
  }

  function followQuota(owner) {
    return rpc({ type: 'followQuota', owner: username(owner) });
  }

  async function historicalFollows(account) {
    const history = await rpc({ type: 'history', owner: account });
    if (!Array.isArray(history?.entries)) throw new Error('Não foi possível conferir a memória de perfis já seguidos.');
    const remembered = new Map();
    for (const entry of history.entries) {
      if (entry.owner !== account || !['following', 'requested'].includes(entry.status) ||
          !Number.isSafeInteger(entry.followedAt) || entry.followedAt <= 0) {
        throw new Error('A memória de perfis já seguidos não pôde ser validada.');
      }
      remembered.set(username(entry.username), 'previously-followed');
    }
    const continued = history.continuedUncertain ?? [];
    if (!Array.isArray(continued)) throw new Error('Não foi possível conferir os perfis com confirmação pendente.');
    for (const entry of continued) {
      const name = username(entry);
      if (!remembered.has(name)) remembered.set(name, 'previously-uncertain');
    }
    return remembered;
  }

  async function discover(tabId, references, options) {
    return globalThis.instagramDiscovery.discover(tabId, references, options);
  }

  async function cachedFollowers(account) {
    const local = await rpc({ type: 'databaseRead', owner: account });
    if (local?.database?.owner !== account || !local.database.snapshots) {
      throw new Error('Não foi possível conferir os seguidores salvos desta conta.');
    }
    const snapshot = local.database.snapshots.followers;
    if (snapshot == null) return new Set();
    if (!Array.isArray(snapshot.usernames) || snapshot.usernames.length > 100000) {
      throw new Error('A lista local de seguidores não pôde ser validada.');
    }
    // Presence in a partial list is positive evidence. Absence is never inferred.
    return new Set(snapshot.usernames.map(username));
  }

  async function followAutomatically(tabId, references, { owner, target, signal, onUpdate = () => {}, onDiagnostic = () => {},
    onCandidate = async () => {}, onDispatch = async () => {}, onUncertain, onObserved, skipUsernames = [], aiMode = false,
    followerFallback = true, profile, decisions = 0, onDecision = async () => {}, selectedByReference, selectedNames } = {}) {
    const account = username(owner);
    if (!Number.isInteger(target) || target < 1 || target > 200) throw new Error('Escolha uma quantidade de 1 a 200 perfis.');
    return exclusive(account, async () => {
      const seen = new Set(skipUsernames.map(username));
      const result = { following: 0, requested: 0, checked: 0, alreadyFollowers: 0, inconclusive: 0, unconfirmed: 0, reason: 'exhausted' };
      const completed = () => result.following + result.requested;
      const finish = reason => ({ ...result, reason });
      let agentStopped = false;
      let step = decisions;
      async function chooseSuggestions(candidates, context) {
        signal?.throwIfAborted();
        if (++step > 80) throw new Error('O agente atingiu o limite de decisões desta fila. O progresso está salvo.');
        await onUpdate({ message: 'A IA está decidindo a próxima ação na lista de @' + context.reference + '…' });
        const plan = await rpc({ type: 'agentPlan', profile: { username: account, bio: profile?.bio ?? '', topics: (profile?.topics ?? []).slice(0, 8) }, reference: context.reference,
          remaining: target - completed(), candidates, atBottom: context.atBottom, step });
        signal?.throwIfAborted();
        const allowed = new Set(candidates.filter(candidate => !candidate.alreadyFollows).map(candidate => candidate.username));
        if (!['follow', 'scroll', 'next_reference', 'stop'].includes(plan?.action) || !Array.isArray(plan.usernames) ||
            plan.usernames.length > target - completed() || new Set(plan.usernames).size !== plan.usernames.length ||
            plan.usernames.some(name => !allowed.has(name)) ||
            (plan.action === 'follow' ? !plan.usernames.length : plan.usernames.length !== 0) ||
            (plan.action === 'scroll' && context.atBottom)) throw new Error('A IA não retornou uma ação válida para esta lista.');
        await onDecision({ ...plan, step, reference: context.reference });
        onDiagnostic('Agente · decisão ' + step + ': ' + plan.action + ' · ' + plan.usernames.length + ' perfis.');
        if (plan.action === 'stop') agentStopped = true;
        return plan;
      }
      try {
        signal?.throwIfAborted();
        for (const [name, reason] of await historicalFollows(account)) {
          seen.add(name);
          if (!selectedNames?.has(name)) continue;
          const remembered = reason === 'previously-followed';
          await onUpdate({ username: name, status: remembered ? 'remembered' : 'skipped', message: '@' + name +
            (remembered ? ' já foi seguido antes. Perfil pulado.' : ' tem uma tentativa anterior sem confirmação. Perfil pulado.') });
        }
        if (!(await followQuota(account)).remaining) return finish('quota');
        await ownerOnTab(tabId, account, signal);
        const candidates = [];
        const roundLimit = selectedByReference ? 1 : 10;
        const reportFollower = name => onUpdate({ username: name, status: 'skipped', message: '@' + name + ' já segue você. Perfil pulado.' });
        for (let round = 0; round < roundLimit && completed() < target; round += 1) {
          for (const name of await cachedFollowers(account)) {
            if (!seen.has(name) && selectedNames?.has(name)) await reportFollower(name);
            seen.add(name);
          }
          const before = result.checked;
          if (round) onDiagnostic('Reabrindo as referências para procurar novas sugestões. Rodada ' + (round + 1) + '.');
          const sampled = await discover(tabId, references, {
          owner: account, signal, suggestionsOnly: true, followerFallback: followerFallback === true, onUpdate, onDiagnostic,
          excludedProfiles: [...seen],
          selectedByReference,
          onObserved: selectedByReference ? async rows => {
            for (const row of rows) {
              if (row.alreadyFollows && selectedNames.has(row.username) && !seen.has(row.username)) {
                seen.add(row.username);
                await reportFollower(row.username);
              }
            }
            await onObserved?.(rows);
          } : onObserved,
          chooseSuggestions: aiMode ? chooseSuggestions : undefined,
          async onSuggestion(name, click, candidate) {
            if (seen.has(name)) return;
            if (selectedByReference && (
              candidate?.username !== name || candidate.alreadyFollows ||
              (!candidate.suggestionProfiles?.some(reference => selectedByReference.get(reference)?.get(name)?.suggestion) &&
               !candidate.sourceProfiles?.some(reference => selectedByReference.get(reference)?.get(name)?.follower))
            )) return;
            seen.add(name);
            result.checked += 1;
            signal?.throwIfAborted();
            await onCandidate(candidate ?? { username: name, sourceProfiles: [], suggestionProfiles: references });
            const permit = await paceAction(account, 'follow', signal, onUpdate);
            let reservation;
            try { reservation = await rpc({ type: 'reserveFollow', owner: account, username: name }); }
            catch (error) {
              if (!['previously-followed', 'already-follower', 'previously-uncertain'].includes(error.code)) throw error;
              const explanation = {
                'previously-followed': ' já foi seguido antes. Perfil pulado.',
                'already-follower': ' já segue você. Perfil pulado.',
                'previously-uncertain': ' tem uma tentativa anterior sem confirmação. Perfil pulado.',
              }[error.code];
              await onUpdate({ username: name, status: error.code === 'previously-followed' ? 'remembered' : 'skipped',
                message: '@' + name + explanation });
              return;
            }
            if (!reservation?.reservationId || !Number.isSafeInteger(reservation.clickBy)) {
              throw new Error('O limite automático não pôde ser confirmado.');
            }
            const release = () => rpc({ type: 'releaseFollow', owner: account, reservationId: reservation.reservationId });
            if (signal?.aborted) {
              await release();
              signal.throwIfAborted();
            }
            try { await onDispatch(name); }
            catch (error) { await release(); throw error; }
            if (signal?.aborted) { await release(); signal.throwIfAborted(); }
            let status;
            try {
              status = await click(Math.min(reservation.clickBy, permit.clickBy));
            } catch (error) {
              if (!error?.clickSent || typeof onUncertain !== 'function' ||
                  (!selectedByReference && error.code !== 'follow-unconfirmed-profile')) throw error;
              // Keep the quota reservation for a click that was sent. Persist
              // the excluded target before authorizing another attempt.
              try {
                await onUncertain(name, error);
                const message = '@' + name + ' ficou sem confirmação. A fila foi pausada para conferência.';
                await onUpdate({ username: name, status: 'uncertain', message });
                onDiagnostic(message);
              } catch (cause) {
                const failure = new Error('O clique em @' + name + ' ficou sem confirmação e o progresso não pôde ser salvo.', { cause });
                failure.clickSent = true;
                throw failure;
              }
              result.unconfirmed += 1;
              if (['restricted', 'platform-restricted', 'platform-challenge'].includes(error.code)) throw error;
              const failure = new Error('Confira @' + name + ' no Instagram. O primeiro clique sem confirmação pausou a fila.', { cause: error });
              failure.code = 'action-unconfirmed';
              failure.clickSent = true;
              throw failure;
            }
            if (status === 'skipped') {
              await release();
              result.inconclusive += 1;
              await onUpdate({ username: name, status: 'skipped', message: 'O botão de @' + name + ' mudou. Perfil pulado.' });
              onDiagnostic('O botão de @' + name + ' mudou. Perfil pulado.');
              return;
            }
            if (!['following', 'requested'].includes(status)) {
              const error = new Error('Confira @' + name + ' no Instagram. O clique não teve uma confirmação reconhecida.');
              error.clickSent = true;
              throw error;
            }
            try {
              await rpc({ type: 'record', owner: account, username: name, status });
            } catch (cause) {
              const error = new Error('Confira @' + name + ' no Instagram. O botão mudou, mas o histórico não foi salvo.', { cause });
              error.clickSent = true;
              throw error;
            }
            result[status] += 1;
            const message = status === 'following' ? 'Seguindo @' + name + '.' : 'Solicitação enviada a @' + name + '.';
            try {
              await onUpdate({ username: name, status, message });
            } catch (cause) {
              const error = new Error('O resultado de @' + name + ' foi registrado, mas a fila não pôde ser atualizada.', { cause });
              error.clickSent = true;
              throw error;
            }
            onDiagnostic(message);
            if (completed() >= target) return false;
          },
          });
          candidates.push(...sampled);
          if (agentStopped || result.checked === before) break;
        }
        result.alreadyFollowers = new Set(candidates.filter(candidate => candidate.alreadyFollows).map(candidate => candidate.username)).size;
        return finish(signal?.aborted ? 'stopped' : completed() >= target ? 'target' : agentStopped ? 'agent-stopped' : 'exhausted');
      } catch (error) {
        if (error?.clickSent || ['restricted','platform-restricted','platform-challenge','action-unconfirmed'].includes(error?.code)) throw error;
        if (signal?.aborted) return finish('stopped');
        if (error?.code === 'follow-limit') return finish('quota');
        throw error;
      }
    });
  }

  async function followSelectedFromLists(tabId, references, candidates, { owner, signal, onUpdate = () => {},
    onDiagnostic = () => {}, onCandidate, onDispatch, onUncertain } = {}) {
    if (!Array.isArray(candidates) || candidates.length === 0 || candidates.length > batchLimit) {
      throw new Error('Selecione de 1 a ' + batchLimit + ' perfis para seguir.');
    }
    if (!Array.isArray(references) || references.length !== 3) throw new Error('Configure três perfis de referência.');
    const account = username(owner ?? ownerByTab.get(tabId));
    const seeds = references.map(username);
    const selectedByReference = new Map(seeds.map(reference => [reference, new Map()]));
    if (selectedByReference.size !== 3 || selectedByReference.has(account)) {
      throw new Error('Use três perfis de referência diferentes entre si e da sua conta.');
    }

    const selectedNames = new Set();
    for (const candidate of candidates) {
      const name = username(candidate?.username);
      selectedNames.add(name);
      if (name === account || selectedByReference.has(name)) continue;
      for (const [sources, kind] of [[candidate.suggestionProfiles, 'suggestion'], [candidate.sourceProfiles, 'follower']]) {
        if (!Array.isArray(sources)) continue;
        for (const source of sources) {
          const targets = selectedByReference.get(source);
          if (!targets) continue;
          const selectedSource = targets.get(name) ?? {};
          selectedSource[kind] = true;
          targets.set(name, selectedSource);
        }
      }
    }

    const outcomes = new Map();
    function report(update) {
      if (update.status && selectedNames.has(update.username)) {
        outcomes.set(update.username, { username: update.username, status: update.status });
      }
      return onUpdate(update);
    }
    const hasTargets = [...selectedByReference.values()].some(targets => targets.size);
    const run = hasTargets ? await followAutomatically(tabId, seeds, { owner: account, target: selectedNames.size, signal,
      onUpdate: report, onDiagnostic, onCandidate, onDispatch, onUncertain, selectedByReference, selectedNames }) : null;
    if (!signal?.aborted && run?.reason !== 'quota') {
      for (const name of selectedNames) {
        if (outcomes.has(name)) continue;
        const message = '@' + name + ' não apareceu com um botão Seguir na sua lista de origem. Perfil pulado.';
        await report({ username: name, status: 'skipped', message });
        onDiagnostic(message);
      }
    }
    return [...selectedNames].map(name => outcomes.get(name)).filter(Boolean);
  }

  async function readOwnProfile(tabId) {
    const profile = await globalThis.instagramDiscovery.readOwnProfile(tabId);
    ownerByTab.set(tabId, username(profile.username));
    return profile;
  }

  async function unfollowKnownProfile(tabId, owner, name, { signal, previousPath, cleanerJobId, onUpdate, onWaiting, onDispatch, onConfirmed }) {
    const token = crypto.randomUUID();
    let mutationSent = false;
    const unknown = cause => {
      const error = new Error('Confira @'+name+' no Instagram. A remoção não teve um resultado confirmado.',{cause});
      error.clickSent = mutationSent; error.code = cause?.code; return error;
    };
    try {
      await onUpdate({message:'Conferindo o perfil conhecido @'+name+'…'});
      await navigate(tabId,name,signal,previousPath);
      const observed = await readRelationship(tabId,name,owner,signal);
      if (observed.state !== 'following') {
        await onUpdate({diagnostic:true,message:'@'+name+' não mostra Seguindo no perfil. Nenhum clique enviado.'});
        return 'already-not-following';
      }
      await onWaiting(name);
      const permit = await paceAction(owner, 'unfollow', signal, onUpdate, {
        username: name, tabId, ...(cleanerJobId && { cleanerJobId }),
      });
      // A profile can change during a long pacing wait. Never act from the cache.
      const current = await readRelationship(tabId,name,owner,signal);
      if (current.state !== 'following') {
        await onUpdate({diagnostic:true,message:'O estado de @'+name+' mudou durante a espera. Perfil pulado.'});
        return 'already-not-following';
      }
      signal?.throwIfAborted();
      await chrome.scripting.executeScript({ target: { tabId }, files: ['assisted-unfollow.js'] });
      await onDispatch(name);
      signal?.throwIfAborted();
      const opened = await inject(tabId,inspectProfile,name,'open-unfollow',token,owner,permit.clickBy,permit.dispatchId);
      rejectProfileState(opened?.state);
      if (opened?.state !== 'menu-opened') throw new Error('O menu Seguindo de @'+name+' não foi reconhecido.');
      await poll(()=>inject(tabId,inspectProfile,name,'locate-unfollow',token,owner),value=>value?.state==='ready',signal,8500);
      async function commit() {
        signal?.throwIfAborted();
        // A missing script response after this point is also an uncertain action.
        const previouslySent = mutationSent;
        mutationSent = true;
        const sent = await inject(tabId,inspectProfile,name,'commit-unfollow',token,owner,permit.clickBy,permit.dispatchId);
        if (sent?.state === 'unfollow-protected') mutationSent = previouslySent;
        rejectProfileState(sent?.state);
        if (sent?.state !== 'sent') throw new Error('A confirmação de @'+name+' mudou.');
      }
      await commit();
      const outcome = await poll(async()=>{
        const state = await inject(tabId,inspectProfile,name,'read','',owner);
        rejectProfileState(state?.state);
        if (state?.state==='available' && !state.modal) return {state:'complete'};
        if (state?.state==='following' && state.modal) {
          const action = await inject(tabId,inspectProfile,name,'locate-unfollow',token,owner);
          rejectProfileState(action?.state);
          if (action?.state==='ready') return {state:'confirm'};
        }
        return {state:'waiting'};
      },value=>['complete','confirm'].includes(value?.state),undefined,8500);
      if (outcome.state==='confirm') await commit();
      // Finish verifying an already-sent request even when Stop was just pressed.
      await poll(()=>inject(tabId,inspectProfile,name,'read','',owner),value=>value?.state==='available'&&!value.modal,undefined,8500);
      await wait(1500);
      const settled = await inject(tabId,inspectProfile,name,'read','',owner);
      rejectProfileState(settled?.state);
      if (settled?.state!=='available'||settled.modal) throw new Error('O Instagram voltou a mostrar a relação anterior.');
      await onConfirmed(name);
      return 'unfollowed';
    } catch(error) {
      if (mutationSent) throw unknown(error);
      if (error?.code === 'unfollow-protected') return 'protected';
      throw error;
    }
  }

  async function knownUnfollowTargets(owner, confirmed, inventory) {
    const {database,followHistory} = await rpc({type:'databaseRead',owner});
    const removed = new Set(followHistory.filter(entry=>['unfollowed','gone'].includes(entry.reviewState)).map(entry=>username(entry.username)));
    for (const run of database.runs) if (run.kind==='unfollow-all') for (const name of run.completed) removed.add(username(name));
    for (const [name, outcome] of Object.entries(inventory.job?.outcomes ?? {})) if (outcome === 'unfollowed') removed.add(username(name));
    const requested = new Set(followHistory.filter(entry=>entry.status==='requested').map(entry=>username(entry.username)));
    const pending = new Set(inventory.job?.uncertain ?? []);
    const names = [...followHistory.filter(entry=>entry.status==='following').map(entry=>entry.username),
      ...(database.snapshots.following?.usernames ?? []), ...(inventory.rows ?? []).map(row => row.username),
      ...(inventory.priorRows ?? []).map(row => row.username)];
    return [...new Set(names.map(username))].filter(name=>name!==owner&&!removed.has(name)&&!requested.has(name)&&!confirmed.has(name)&&!pending.has(name));
  }

  async function unfollowAll(tabId, rawOwner, { signal, selected, cleanerJobId, allowProfileRecovery = false,
    onUpdate = () => {}, onQueue = async () => {}, onCheckpoint = async () => {} } = {}) {
    const owner = username(rawOwner);
    if (selected !== undefined && (!Array.isArray(selected) || selected.length > 200)) {
      throw new Error('Selecione um lote de até 200 perfis.');
    }
    const selection = selected === undefined ? null : new Set(selected.map(username));
    if (selection && (selection.has(owner) || selection.size !== selected.length)) {
      throw new Error('A seleção contém nomes repetidos ou a própria conta.');
    }
    if (selection?.size && (typeof cleanerJobId !== 'string' || !cleanerJobId)) {
      throw new Error('Confirme o lote no Limpa Perfil antes de iniciar a remoção.');
    }
    return exclusive(owner, async () => {
      const confirmed = new Set();
      const queue = new Set(selection ?? []);
      const deferred = new Map();
      const skipped = new Set();
      const protectedStillFollowing = new Set();
      const protectedInHistory = new Set();
      const protectedNames = new Set();
      let total = selection?.size ?? null;
      let remaining = null;
      let dispatched = false;
      let activeName;
      let token;
      const outstanding = () => selection && [...selection].filter(name =>
        !confirmed.has(name) && !skipped.has(name) && !protectedStillFollowing.has(name));
      const progress = () => ({
        total, unfollowed: confirmed.size, confirmedCount: confirmed.size,
        remaining: selection ? outstanding().length : remaining,
        protectedCount: new Set([...protectedStillFollowing, ...protectedInHistory]).size,
        deferred: [...deferred.values()], skipped: skipped.size + deferred.size,
      });
      const pending = message => ({
        ...progress(), completed: false, error: true, code: 'unfollow-pending',
        reason: 'unfollow-pending', phase: 'reconciling', message,
      });
      const cancel = () => {
        if (!token) return;
        return inject(tabId, id => {
          const scan = globalThis.instagramFluxoUnfollow;
          if (scan?.id === id) scan.controller.abort();
        }, token).catch(() => {});
      };

      async function skip(name, reason) {
        await onCheckpoint({ username: name, status: 'skipped', reason });
        if (reason === 'protected') { protectedNames.add(name); protectedStillFollowing.add(name); }
        else skipped.add(name);
        dispatched = false;
        activeName = undefined;
      }

      if (selection && !selection.size) return { ...progress(), completed: true };
      const protection = await rpc({ type: 'cleanerProtectionRead', owner });
      if (!Array.isArray(protection?.protectedNames)) throw new Error('Não foi possível conferir a lista branca.');
      for (const name of protection.protectedNames.map(username)) protectedNames.add(name);
      if (selection) {
        await onQueue([...queue], total);
        for (const name of selection) if (protectedNames.has(name)) await skip(name, 'protected');
        if (!outstanding().length) return { ...progress(), completed: true };
      }

      async function startNative() {
        signal?.throwIfAborted();
        token = crypto.randomUUID();
        await chrome.scripting.executeScript({ target: { tabId }, files: ['assisted-unfollow.js'] });
        await inject(tabId, async (id, account, excluded, selectedNames, initialProtection) => {
          const previous = globalThis.instagramFluxoUnfollow;
          previous?.controller.abort();
          if (previous?.done) await previous.done;
          const controller = new AbortController();
          const scan = { id, controller, sequence: 0 };
          globalThis.instagramFluxoUnfollow = scan;
          let ready;
          try {
            ready = await globalThis.instagramFlowAssistedUnfollow.open(account, controller.signal, { allowUnknownTotal: selectedNames !== null });
          } catch (error) {
            scan.result = { error: true, message: error.message, code: error.code, clickSent: false };
            return;
          }
          scan.total = ready.total;
          if (ready.total === 0) {
            scan.result = { count: 0, remaining: 0, message: 'Você não segue nenhuma conta.' };
            return;
          }
          const pause = () => new Promise(resolve => setTimeout(resolve, 100));
          const result = globalThis.instagramFlowAssistedUnfollow.run({
            owner: account, signal: controller.signal, excluded,
            selected: selectedNames, protectedNames: initialProtection,
            onUpdate: update => { scan.update = update; },
            async beforeAction(name) {
              const request = { username: name, sequence: ++scan.sequence };
              scan.pending = request;
              while (!controller.signal.aborted) {
                if (scan.permit?.sequence === request.sequence) {
                  const permit = scan.permit;
                  scan.permit = null;
                  scan.pending = null;
                  return permit;
                }
                await pause();
              }
              controller.signal.throwIfAborted();
            },
            async onConfirmed(name) {
              scan.confirmed = { username: name, sequence: scan.sequence };
              while (!controller.signal.aborted) {
                if (scan.acknowledged === scan.sequence) {
                  scan.confirmed = null;
                  return;
                }
                await pause();
              }
              controller.signal.throwIfAborted();
            },
            async onProtected(name) {
              scan.protected = { username: name, sequence: scan.sequence };
              while (!controller.signal.aborted) {
                if (scan.acknowledged === scan.sequence) {
                  scan.protected = null;
                  return;
                }
                await pause();
              }
              controller.signal.throwIfAborted();
            },
          });
          scan.done = result.then(value => {
            scan.result = value;
          }, error => {
            scan.result = {
              error: true, message: error.message, code: error.code,
              phase: error.phase, clickSent: error.clickSent === true,
            };
          });
        }, token, owner, [...confirmed, ...skipped, ...deferred.keys(), ...(protection.job?.uncertain ?? [])], outstanding(), [...protectedNames]);
        if (signal?.aborted) cancel();
      }

      async function closeNative(target) {
        signal?.throwIfAborted();
        await inject(tabId, async (account, name) => {
          const scan = globalThis.instagramFluxoUnfollow;
          await scan?.done;
          await globalThis.instagramFlowAssistedUnfollow.close(account, new AbortController().signal, name);
        }, owner, target ?? null);
        signal?.throwIfAborted();
      }

      async function reconcileNative(result) {
        // Only a completed native verification timeout is recoverable. Do not
        // turn a missing bridge response or a changed modal into a queued skip.
        if (result.interrupted || result.clickSent !== true || result.current !== activeName) return false;
        const name = username(result.current);
        await onUpdate({
          ...progress(), username: name, phase: 'reconciling', reason: result.code,
          diagnostic: true, message: 'Conferindo o resultado de @' + name + ' no perfil antes de continuar…',
        });
        await closeNative(name);
        await navigate(tabId, name, signal, '/' + owner + '/');
        // Independent DOM reads, separated by the native settle window. Profile
        // parser validates the connected owner, exact target, overlays and alerts.
        await wait(1800, signal);
        const first = await readRelationship(tabId, name, owner, signal);
        await wait(1500, signal);
        const second = await readRelationship(tabId, name, owner, signal);
        if (first.state !== second.state || !['available', 'following'].includes(second.state)) {
          const error = new Error('O estado de @' + name + ' ainda não ficou estável. Confira o perfil antes de retomar.');
          error.code = 'native-reconciliation-uncertain';
          error.phase = 'reconciling';
          throw error;
        }
        signal?.throwIfAborted();
        if (second.state === 'available') {
          await onCheckpoint({
            username: name, status: 'unfollowed', reconciled: true,
            reason: 'native-timeout-profile-confirmed', method: 'profile-state',
          });
          confirmed.add(name);
          await onUpdate({
            ...progress(), username: name, status: 'unfollowed', phase: 'reconciling', reconciled: true,
            message: 'A remoção de @' + name + ' foi confirmada no perfil. Continuando a fila.',
          });
        } else {
          const entry = { username: name, reason: 'native-confirmation-timeout-still-following', phase: 'reconciling' };
          await onCheckpoint({ ...entry, status: 'deferred', clickSent: true });
          deferred.set(name, entry);
          await onUpdate({
            ...progress(), username: name, status: 'deferred', phase: 'reconciling', reason: entry.reason,
            message: '@' + name + ' ainda mostra Seguindo. Ficou pendente; continuando os outros perfis.',
          });
        }
        // Clear dispatch uncertainty only after its authoritative result was
        // durably checkpointed; rejected writes keep the inspection hold.
        dispatched = false;
        activeName = undefined;
        await navigate(tabId, owner, signal, '/' + name + '/');
        await ownerOnTab(tabId, owner, signal);
        return true;
      }
      try {
        await navigate(tabId,owner,signal);
        signal?.addEventListener('abort',cancel,{once:true});
        await startNative();
        let handled=0,acknowledged=0,lastMessage;
        while(true){
          signal?.throwIfAborted();
          const state=await inject(tabId,id=>{
            const scan=globalThis.instagramFluxoUnfollow;
            return scan?.id===id?{total:scan.total,pending:scan.pending,confirmed:scan.confirmed,protected:scan.protected,result:scan.result,update:scan.update}:null;
          },token);
          if(!state)throw new Error('A aba de remoção mudou ou foi fechada.');
          if(total===null&&Number.isSafeInteger(state.total))total=state.total;
          if(Number.isSafeInteger(state.update?.remaining))remaining=state.update.remaining;
          if(state.pending&&state.pending.sequence!==handled){
            const name=username(state.pending.username);
            if(name===owner||confirmed.has(name)||skipped.has(name)||deferred.has(name)||selection&&!selection.has(name))throw new Error('A linha da remoção mudou ou foi repetida.');
            handled=state.pending.sequence;
            activeName=name;
            queue.add(name);
            await onQueue([...queue],total);
            let permit;
            try {
              await onCheckpoint({username:name,status:'waiting'});
              permit=await paceAction(owner, 'unfollow', signal, onUpdate, {
                username: name, tabId, ...(cleanerJobId && { cleanerJobId }),
              });
              signal?.throwIfAborted();
              await onCheckpoint({username:name,status:'started'});
              dispatched=true;
            } catch (error) {
              if (error?.code !== 'unfollow-protected') throw error;
              await skip(name, 'protected');
              permit = { skip: 'protected' };
            }
            signal?.throwIfAborted();
            const sent=await inject(tabId,(id,sequence,value)=>{
              const scan=globalThis.instagramFluxoUnfollow;
              if(scan?.id!==id||scan.controller.signal.aborted||scan.pending?.sequence!==sequence)return false;
              scan.permit={sequence,...value};return true;
            },token,handled,permit.skip ? { skip: permit.skip } : { clickBy: permit.clickBy, dispatchId: permit.dispatchId });
            if(!sent)throw new Error('A autorização da remoção não pôde ser entregue.');
          }
          if (state.protected && state.protected.sequence !== acknowledged) {
            const name = username(state.protected.username);
            if (name !== activeName || state.protected.sequence !== handled) throw new Error('O perfil protegido mudou durante a remoção.');
            await skip(name, 'protected');
            acknowledged = state.protected.sequence;
            await inject(tabId,(id,sequence)=>{const scan=globalThis.instagramFluxoUnfollow;if(scan?.id===id)scan.acknowledged=sequence;},token,acknowledged);
          }
          if(state.confirmed&&state.confirmed.sequence!==acknowledged){
            const name=username(state.confirmed.username);
            if(name!==activeName||state.confirmed.sequence!==handled)throw new Error('O Instagram confirmou um perfil inesperado.');
            await onCheckpoint({username:name,status:'unfollowed'});confirmed.add(name);acknowledged=state.confirmed.sequence;dispatched=false;
            if(Number.isSafeInteger(remaining))remaining=Math.max(0,remaining-1);
            await inject(tabId,(id,sequence)=>{const scan=globalThis.instagramFluxoUnfollow;if(scan?.id===id)scan.acknowledged=sequence;},token,acknowledged);
            await onUpdate({...progress(),username:name,status:'unfollowed',message:'Deixou de seguir @'+name+'.'});
          }
          if(state.result){
            if(state.result.error){
              if(allowProfileRecovery&&state.result.code==='native-confirmation-timeout'&&await reconcileNative(state.result)){
                await startNative();handled=0;acknowledged=0;lastMessage=undefined;continue;
              }
              const error=new Error(state.result.message||'A remoção foi interrompida.');
              error.code=state.result.code;error.phase=state.result.phase;error.rawClickSent=state.result.clickSent;
              error.clickSent=state.result.clickSent===true||dispatched;throw error;
            }
            remaining=state.result.remaining;
            for (const name of state.result.protectedFollowing ?? []) protectedStillFollowing.add(username(name));
            const native={reason:state.result.reason,message:state.result.message,diagnostics:state.result.diagnostics};
            if (selection && remaining === 0 && deferred.size === 0) {
              for (const name of outstanding()) await skip(name, 'already-not-following');
            }
            if (deferred.size === 0 && (selection ? !outstanding().length : remaining === 0 ||
                native.reason === 'native-protected-only' && remaining === protectedStillFollowing.size)) {
              return { ...progress(), ...native, completed: true };
            }
            if (!['native-following-unavailable', 'native-selected-pending'].includes(native.reason)) {
              return pending(native.message||'Ainda há perfis pendentes na lista Seguindo.');
            }
            await onUpdate({...progress(),...native,diagnostic:true});
            if (!allowProfileRecovery) return pending(selection
              ? 'A lista Seguindo não mostrou todos os perfis do lote. A fila ficou salva para retomar.'
              : 'A lista Seguindo não carregou os perfis restantes. O progresso foi salvo.');
            const names=(selection ? outstanding() : await knownUnfollowTargets(owner,confirmed,protection)).filter(name=>!deferred.has(name));
            if(!names.length)return pending(native.message+' Não há outros perfis conhecidos pendentes na base local para conferir.');
            await onUpdate({...progress(),diagnostic:true,message:`A lista Seguindo parou de carregar. Conferindo ${names.length} ${selection ? 'perfis do lote salvo' : 'perfis conhecidos na base local'}.`});
            await closeNative();
            let previousPath=await ownerOnTab(tabId,owner,signal);
            for(const name of names){
              signal?.throwIfAborted();
              const check = await rpc({type:'cleanerCheck',owner,username:name});
              if (check?.protected !== false && check?.protected !== true) throw new Error('Não consegui confirmar a lista branca.');
              if (check.protected) {
                if (selection) await skip(name, 'protected');
                else protectedInHistory.add(name);
                continue;
              }
              const outcome=await unfollowKnownProfile(tabId,owner,name,{signal,previousPath,cleanerJobId,onUpdate:update=>onUpdate({...progress(),...update}),
                async onWaiting(target){queue.add(target);await onQueue([...queue],total);await onCheckpoint({username:target,status:'waiting'});},
                async onDispatch(target){await onCheckpoint({username:target,status:'started'});dispatched=true;},
                async onConfirmed(target){
                  await onCheckpoint({username:target,status:'unfollowed'});confirmed.add(target);dispatched=false;
                  if(Number.isSafeInteger(remaining))remaining=Math.max(0,remaining-1);
                  await onUpdate({...progress(),username:target,status:'unfollowed',message:'Deixou de seguir @'+target+'.'});
                }});
              if (outcome !== 'unfollowed') await skip(name, outcome);
              previousPath='/'+name+'/';
            }
            await navigate(tabId,owner,signal,previousPath);await ownerOnTab(tabId,owner,signal);
            const finalOwner=await inject(tabId,inspectProfile,owner,'owner','',owner);rejectProfileState(finalOwner?.state);
            remaining=Number.isSafeInteger(finalOwner?.followingCount)?finalOwner.followingCount:null;
            if (deferred.size === 0) {
              if (selection && !outstanding().length) return { ...progress(), completed: true, reason: 'selected-complete', message: 'Os perfis da seleção foram conferidos.' };
              if (!selection && remaining === 0) return { ...progress(), completed: true, reason: 'native-count-zero', message: 'O perfil informa zero contas seguidas.' };
              if (!selection && remaining > 0 && remaining === protectedStillFollowing.size) {
                return { ...progress(), completed: true, reason: 'native-protected-only', message: 'Restam apenas os perfis protegidos na lista Seguindo.' };
              }
            }
            return pending('Os perfis conhecidos foram conferidos. A lista nativa ainda precisa carregar os perfis restantes.');
          }
          if(state.update?.message&&state.update.message!==lastMessage){lastMessage=state.update.message;await onUpdate({...progress(),message:lastMessage});}
          await wait(200,signal);
        }
      }catch(error){
        if(dispatched)error.clickSent=true;
        error.progress=progress();throw error;
      }finally{signal?.removeEventListener('abort',cancel);await cancel();}
    }, 'unfollow');
  }

  globalThis.instagramFlow = {
    readOwnProfile,
    discover,
    follow,
    followAutomatically,
    followSelectedFromLists,
    followQuota,
    followBatchLimit: batchLimit,
    readPacing,
    unfollowAll,
    exclusive,
  };
})();
