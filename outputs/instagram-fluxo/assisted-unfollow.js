(() => {
  'use strict';

  // Native row/confirmation engine adapted from the working local Unfollow assistido.
  // A dashboard-issued pacing permit is required for every row; injection never starts it.
  if (globalThis.instagramFlowAssistedUnfollow) return;

  const dialogSelector = '[role="dialog"], [role="alertdialog"], dialog[open]';
  const controlSelector = 'button, [role="button"]';
  const followingLabels = new Set(['seguindo', 'a seguir', 'following']);
  const followLabels = new Set(['seguir', 'seguir de volta', 'follow', 'follow back']);
  const cancelLabels = new Set(['cancelar', 'cancel']);
  const unfollowLabels = new Set(['deixar de seguir', 'unfollow']);
  const editLabels = new Set(['editar perfil', 'edit profile']);
  const emptyLabels = /^(?:you (?:aren.t|are not) following (?:anyone|any accounts)(?: yet)?|(?:você|tu) (?:ainda )?não seg(?:ue|ues) (?:ninguém|nenhuma conta)|nenhuma conta seguida)[.!]?$/i;
  const errorLabels = /try again later|tente (?:novamente |de novo )?mais tarde|tenta novamente mais tarde|action blocked|ação bloqueada|we restrict|restringimos|we limit how often|limitamos a frequência|something went wrong|algo deu errado|couldn.t (?:unfollow|load)|não foi possível (?:deixar de seguir|carregar)|confirm (?:it.s you|your identity)|confirme (?:sua identidade|que é você)|security code|código de segurança|\bcaptcha\b/i;
  const usernamePattern = '[a-z0-9._]{1,30}';
  const profilePath = new RegExp('^/(' + usernamePattern + ')/?$', 'i');
  const accountPath = new RegExp('^/(' + usernamePattern + ')(?:/following)?/?$', 'i');
  const followingCount = /^(\d(?:[\d., ]*\d)?) (?:seguindo|a seguir|following)$/i;
  const pollInterval = 200;
  const changeSettleTime = 1500;
  const responseTimeout = 8500;
  let running = false;

  const normal = text => (text ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
  const textOf = element => normal(element.innerText);

  function visible(element) {
    return element.isConnected && element.getClientRects().length > 0 &&
      getComputedStyle(element).visibility === 'visible';
  }

  function controls(root) {
    return [...root.querySelectorAll(controlSelector)].filter(visible);
  }

  function dialogs() {
    return [...document.querySelectorAll(dialogSelector)].filter(visible);
  }

  function instagram() {
    return location.origin === 'https://www.instagram.com' || location.origin === 'https://instagram.com';
  }

  function linkedPath(anchor) {
    try {
      const url = new URL(anchor.href);
      if (url.origin === location.origin) return url.pathname;
    } catch {
      // An invalid or external link cannot identify a profile here.
    }
    return '';
  }

  function ownProfile(path) {
    const name = path.match(accountPath)?.[1]?.toLowerCase();
    const profile = document.querySelector('main, [role="main"]');
    if (!name || !profile) return null;
    const ownHeader = [...profile.querySelectorAll('a[href]')].some(anchor =>
      visible(anchor) && !anchor.closest(dialogSelector) &&
      /^\/accounts\/edit\/?$/.test(anchor.getAttribute('href')) && editLabels.has(textOf(anchor))
    );
    if (!ownHeader) return null;
    const counter = [...profile.querySelectorAll('a[href]')].find(anchor => {
      if (!visible(anchor) || anchor.closest(dialogSelector)) return false;
      const link = linkedPath(anchor).replace(/\/$/, '').toLowerCase();
      return link === '/' + name + '/following' ||
        (anchor.getAttribute('href') === '#' && followingCount.test(textOf(anchor)));
    });
    if (!counter && !/\/following\/?$/.test(path)) return null;
    return { counter };
  }

  function countOf(counter) {
    if (!counter || !visible(counter)) return undefined;
    const digits = textOf(counter).match(followingCount)?.[1];
    return digits === undefined ? undefined : Number(digits.replace(/[., ]/g, ''));
  }

  function followingDialog(visibleDialogs) {
    return visibleDialogs.find(dialog =>
      [...dialog.querySelectorAll('h1, h2, h3, [role="heading"], [dir="auto"]')].some(element =>
        element.closest(dialogSelector) === dialog && !element.closest('a, ' + controlSelector) &&
        visible(element) && followingLabels.has(textOf(element)) &&
        element.getBoundingClientRect().top < dialog.getBoundingClientRect().top + 90
      )
    );
  }

  function ensureUnfiltered(list) {
    if ([...list.querySelectorAll('input, [role="searchbox"], [contenteditable="true"]')].some(input =>
      visible(input) && normal(input.value ?? input.innerText)
    )) throw new Error('Limpe a busca da lista Seguindo e inicie de novo.');
  }

  function rows(list) {
    const profiles = new Map();
    for (const button of controls(list)) {
      if (button.closest(dialogSelector) !== list) continue;
      const label = textOf(button);
      if (!followingLabels.has(label) && !followLabels.has(label)) continue;
      for (let parent = button.parentElement; parent && parent !== list; parent = parent.parentElement) {
        const names = new Set();
        const labels = new Set();
        for (const link of parent.querySelectorAll('a[href]')) {
          const name = linkedPath(link).match(profilePath)?.[1]?.toLowerCase();
          if (!name) continue;
          names.add(name);
          if (visible(link) && textOf(link).replace(/^@/, '') === name) labels.add(name);
        }
        if (names.size === 0) continue;
        const anotherAction = controls(parent).some(other => other !== button &&
          (followingLabels.has(textOf(other)) || followLabels.has(textOf(other)))
        );
        if (names.size !== 1 || anotherAction) break;
        const [name] = names;
        if (!labels.has(name)) continue;
        if (profiles.has(name)) throw new Error('A lista mostra @' + name + ' mais de uma vez. Execução interrompida.');
        profiles.set(name, { name, button, row: parent, following: followingLabels.has(label) });
        break;
      }
    }
    return profiles;
  }

  function loading(list) {
    return [...list.querySelectorAll('[role="progressbar"], [aria-busy="true"]')].some(indicator => {
      if (!visible(indicator)) return false;
      const bounds = indicator.getBoundingClientRect();
      if (bounds.bottom <= 0 || bounds.top >= innerHeight) return false;
      for (let parent = indicator.parentElement; parent && list.contains(parent); parent = parent.parentElement) {
        if (getComputedStyle(parent).overflowY === 'visible') continue;
        const top = parent.getBoundingClientRect().top + parent.clientTop;
        if (bounds.bottom <= top || bounds.top >= top + parent.clientHeight) return false;
      }
      return true;
    });
  }

  function relationshipControls(list) {
    return controls(list).filter(button => button.closest(dialogSelector) === list && followingLabels.has(textOf(button)));
  }

  function hasProfileLink(list, username) {
    return [...list.querySelectorAll('a[href]')].some(anchor => {
      const name = linkedPath(anchor).match(profilePath)?.[1]?.toLowerCase();
      return (username === undefined ? name !== undefined : name === username) && visible(anchor);
    });
  }

  function empty(list, counter) {
    if (loading(list) || relationshipControls(list).length) return false;
    if (countOf(counter) === 0) return true;
    return !hasProfileLink(list) && list.innerText.split('\n').some(line => emptyLabels.test(normal(line)));
  }

  function clickable(control) {
    if (!visible(control) || control.disabled || control.closest('[inert], [aria-disabled="true"]')) return false;
    const bounds = control.getBoundingClientRect();
    return control.contains(document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2));
  }

  function identifiesConfirmation(dialog, name, required = true) {
    const mentions = [...dialog.innerText.matchAll(new RegExp('@(' + usernamePattern + ')(?![a-z0-9._])', 'gi'))]
      .map(match => match[1].toLowerCase());
    const profileLinks = [...dialog.querySelectorAll('a[href]')].filter(visible).flatMap(anchor => {
      const match = linkedPath(anchor).match(profilePath);
      return match ? [match[1].toLowerCase()] : [];
    });
    const namedHeadings = [...dialog.querySelectorAll('h1,h2,h3,[role="heading"]')].filter(visible).flatMap(element => {
      const heading = textOf(element);
      if (heading === name) return [name];
      const match = heading.match(new RegExp('^(?:unfollow|deixar de seguir) (' + usernamePattern + ')\\??$', 'i'));
      return match ? [match[1].toLowerCase()] : [];
    });
    const identities = [...mentions, ...profileLinks, ...namedHeadings];
    return (!required || identities.length > 0) && identities.every(identity => identity === name);
  }

  function knownConfirmation(dialog, name, required = true) {
    const buttons = controls(dialog);
    const confirm = buttons.filter(button => unfollowLabels.has(textOf(button)));
    const cancel = buttons.filter(button => cancelLabels.has(textOf(button)));
    if (confirm.length !== 1 || cancel.length !== 1) return null;
    if (!identifiesConfirmation(dialog, name, required)) return null;
    return confirm[0];
  }

  function checkAlerts(visibleDialogs) {
    const alerts = [...document.querySelectorAll('[role="alert"], [role="status"], [aria-live="assertive"]')]
      .filter(element => !element.closest('#instagram-unfollow-assistido') && visible(element));
    if ([...visibleDialogs, ...alerts].some(element => errorLabels.test(element.innerText)) ||
        [...document.querySelectorAll('iframe[src]')].some(frame => visible(frame) && /captcha/i.test(frame.src))) {
      const error = new Error('O Instagram mostrou um erro, limite ou verificação. Execução interrompida.');
      error.code = /captcha|confirme|confirm|security code|código de segurança/i.test([...visibleDialogs,...alerts].map(element=>element.innerText).join(' ')) ? 'platform-challenge' : 'platform-restricted';
      throw error;
    }
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

  function scrollContainers(list) {
    return [list, ...list.querySelectorAll('div, ul, section')].filter(element => visible(element) &&
      /^(auto|scroll|overlay)$/.test(getComputedStyle(element).overflowY) &&
      element.scrollHeight > element.clientHeight + 2
    );
  }

  async function open(owner, signal, { allowUnknownTotal = false } = {}) {
    signal?.throwIfAborted();
    const expected = '/' + owner;
    if (!profilePath.test(expected)) throw new Error('Perfil inválido.');
    const path = location.pathname.replace(/\/$/,'').toLowerCase();
    if (!instagram() || ![expected,expected+'/following'].includes(path)) throw new Error('A conta conectada mudou.');
    const account = ownProfile(location.pathname);
    if (!account) throw new Error('Abra o seu próprio perfil para parar de seguir.');
    const current = dialogs(); checkAlerts(current);
    if (current.length && (current.length !== 1 || !followingDialog(current))) throw new Error('Feche a janela aberta no Instagram antes de iniciar.');
    const total = countOf(account.counter) ?? null;
    if (total === null && !allowUnknownTotal) throw new Error('O Instagram não mostrou a contagem de Seguindo.');
    if (total === 0) return { total };
    if (!current.length) {
      if (!account.counter) throw new Error('Não consegui localizar a lista Seguindo.');
      account.counter.click();
    }
    const started = performance.now();
    while (performance.now()-started < responseTimeout) {
      signal?.throwIfAborted();const visibleDialogs=dialogs();checkAlerts(visibleDialogs);
      const list=followingDialog(visibleDialogs);
      if (list && visibleDialogs.length===1) {ensureUnfiltered(list);return {total};}
      await wait(pollInterval,signal);
    }
    throw new Error('A lista Seguindo demorou para abrir.');
  }

  function inventoryPage(owner, { reset = false, advance = false } = {}) {
    const path = location.pathname;
    if (!instagram() || path.match(accountPath)?.[1]?.toLowerCase() !== owner) throw new Error('A conta conectada mudou.');
    const account = ownProfile(path);
    if (!account) throw new Error('Abra seu próprio perfil para ler a lista Seguindo.');
    const expectedCount = countOf(account.counter) ?? null;
    const visibleDialogs = dialogs();
    checkAlerts(visibleDialogs);
    if (expectedCount === 0 && !visibleDialogs.length) {
      return { rows: [], expectedCount: 0, atBottom: true, loading: false, unidentified: false };
    }
    const list = followingDialog(visibleDialogs);
    if (!list || visibleDialogs.length !== 1) throw new Error('A lista Seguindo foi fechada ou mudou.');
    ensureUnfiltered(list);
    const scrollers = scrollContainers(list);
    if (scrollers.length > 1) throw new Error('Há mais de uma área de rolagem na lista Seguindo.');
    const scroller = scrollers[0];
    if (scroller && (reset || advance)) {
      scroller.scrollTop = reset ? 0 : scroller.scrollTop + Math.max(1, Math.floor(scroller.clientHeight * 0.75));
      scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
    }
    const text = value => (typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '').slice(0, 160);
    const observed = [...rows(list).values()].filter(entry => entry.following);
    const knownControls = new Set(observed.map(entry => entry.button));
    const found = observed.map(entry => {
      const nameLink = [...entry.row.querySelectorAll('a[href]')].find(link =>
        linkedPath(link).match(profilePath)?.[1]?.toLowerCase() === entry.name && text(link.innerText));
      const explicit = [...entry.row.querySelectorAll('[data-profile-category], [data-category]')].find(node =>
        visible(node) && !node.closest(controlSelector));
      const category = text(entry.row.getAttribute('data-profile-category') || explicit?.getAttribute('data-profile-category') ||
        explicit?.getAttribute('data-category') || explicit?.innerText);
      const displayName = [...entry.row.querySelectorAll('span, [dir="auto"]')].find(node =>
        node.childElementCount === 0 && visible(node) && !node.closest('a, ' + controlSelector + ', [data-profile-category], [data-category]') &&
        text(node.innerText) && normal(node.innerText).replace(/^@/, '') !== entry.name);
      const label = text(entry.row.getAttribute('data-display-name') || displayName?.innerText || nameLink?.innerText);
      return { username: entry.name, ...(label && { label }), ...(category && { category }) };
    });
    return { rows: found, expectedCount, atBottom: !scroller || scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2,
      loading: loading(list), unidentified: relationshipControls(list).some(control => !knownControls.has(control)) };
  }

  async function guardRemoval(owner, name, dispatchId) {
    const reply = await chrome.runtime.sendMessage({ type: 'cleanerDispatchCheck', owner, username: name, dispatchId });
    return reply?.ok ? reply.data?.state ?? 'unfollow-not-authorized' : reply?.code ?? 'unfollow-not-authorized';
  }

  async function close(owner, signal, target) {
    const path = location.pathname.replace(/\/$/,'').toLowerCase();
    if (!instagram() || !['/'+owner,'/'+owner+'/following'].includes(path) || !ownProfile(location.pathname)) throw new Error('A conta conectada mudou.');
    signal?.throwIfAborted();
    let current = dialogs(); checkAlerts(current);
    if (!current.length) return;
    const list = followingDialog(current);
    const others = current.filter(dialog => dialog !== list);
    if (list && others.length === 1 && target && knownConfirmation(others[0], target, false)) {
      const cancel = controls(others[0]).filter(button => cancelLabels.has(textOf(button)));
      if (cancel.length !== 1 || !clickable(cancel[0])) throw new Error('A confirmação aberta não pode ser fechada com segurança.');
      signal?.throwIfAborted();cancel[0].click();
      await wait(pollInterval, signal);
      current = dialogs();checkAlerts(current);
    }
    if (current.length !== 1 || !list) throw new Error('A janela aberta não é a lista Seguindo.');
    const buttons = controls(list).filter(button => /^(?:fechar|close)$/i.test(normal(button.getAttribute('aria-label') || button.innerText)) ||
      [...button.querySelectorAll('svg[aria-label]')].some(icon=>/^(?:fechar|close)$/i.test(normal(icon.getAttribute('aria-label')))));
    if (buttons.length !== 1 || !clickable(buttons[0])) throw new Error('Não consegui fechar a lista Seguindo para conferir os perfis conhecidos.');
    buttons[0].click();
    const started = performance.now();
    while (performance.now()-started < responseTimeout) {
      signal?.throwIfAborted();const opened=dialogs();checkAlerts(opened);
      if (!opened.length) return;
      await wait(pollInterval,signal);
    }
    throw new Error('A lista Seguindo não fechou.');
  }

  async function run({ owner, signal: stop, excluded = [], selected = null, protectedNames = [],
    onUpdate = () => {}, beforeAction, onConfirmed, onProtected = async () => {} }) {
    if (running) throw new Error('Já existe uma execução nesta aba.');
    running = true;
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, stop]);
    const path = location.pathname;
    if (path.match(accountPath)?.[1]?.toLowerCase() !== owner || typeof beforeAction !== 'function' || typeof onConfirmed !== 'function') {
      running = false;throw new Error('A fila precisa da conta e da autorização do painel.');
    }
    const delayMs = 0;
    let clickSent = false;
    let current = '';
    let lastActionAt = Number.NEGATIVE_INFINITY;
    const processed = new Set();
    const excludedNames = new Set(excluded);
    const selection = selected === null ? null : new Set(selected);
    const protectedSet = new Set(protectedNames);
    const protectedFollowing = new Set();
    const result = message => ({ count: processed.size, message, current, remaining: countOf(account?.counter) ?? null });
    const report = message => onUpdate(result(message));
    const cancel = message => controller.abort(new Error(message));
    const onVisibility = () => {};
    const onBlur = () => {};
    const onPageHide = () => cancel('A página mudou. A execução foi interrompida.');
    const onSiteInput = event => {
      if (event.isTrusted && !event.composedPath().some(element => element.id === 'instagram-unfollow-assistido')) {
        cancel('Interação com o Instagram detectada. A execução foi interrompida.');
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('blur', onBlur);
    window.addEventListener('pagehide', onPageHide);
    document.addEventListener('pointerdown', onSiteInput, true);
    document.addEventListener('keydown', onSiteInput, true);
    document.addEventListener('wheel', onSiteInput, { capture: true, passive: true });

    let list;
    let account;
    function scope(allowConfirmation = false) {
      signal.throwIfAborted();
      const currentAccount = ownProfile(path);
      if (!instagram() || location.pathname !== path || !currentAccount) {
        throw new Error('A aba ou a página mudou. Execução interrompida.');
      }
      account = currentAccount;
      const visibleDialogs = dialogs();
      checkAlerts(visibleDialogs);
      if (!visible(list) || followingDialog(visibleDialogs) !== list) {
        throw new Error('A lista Seguindo foi fechada ou mudou. Execução interrompida.');
      }
      ensureUnfiltered(list);
      const others = visibleDialogs.filter(dialog => dialog !== list);
      if (others.length > (allowConfirmation ? 1 : 0)) {
        throw new Error('O Instagram abriu outra janela. Confira a tela antes de iniciar de novo.');
      }
      return others[0];
    }

    function readRows() {
      const available = rows(list);
      const reverted = [];
      for (const row of available.values()) {
        if (protectedSet.has(row.name)) {
          if (row.following) protectedFollowing.add(row.name);
          else protectedFollowing.delete(row.name);
        }
        if (row.following && processed.delete(row.name)) reverted.push('@' + row.name);
      }
      if (reverted.length) {
        throw new Error('O Instagram voltou a exibir como seguindo: ' + reverted.join(', ') + '. Execução interrompida.');
      }
      return available;
    }

    const nextRow = available => [...available.values()].find(row => row.following && !excludedNames.has(row.name) &&
      !protectedSet.has(row.name) && (!selection || selection.has(row.name)));
    const selectionComplete = () => selection && [...selection].every(name => processed.has(name) || protectedSet.has(name));
    const unidentified = available => relationshipControls(list).some(button =>
      ![...available.values()].some(row => row.button === button));
    let scanMoves = 0;

    async function scanMore() {
      report('Conferindo se ainda há perfis na lista…');
      const scrollers = scrollContainers(list);
      if (scrollers.length > 1) throw new Error('Há mais de uma área de rolagem na lista. Execução interrompida.');
      const scroller = scrollers[0];
      const previousTop = scroller?.scrollTop;
      if (scroller) {
        scroller.scrollTop += Math.max(1, Math.floor(scroller.clientHeight * 0.75));
        // Chrome may defer scroll events in an inactive Instagram tab. Notify
        // its list listeners after moving, as the discovery reader already does.
        scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
      }

      const deadline = performance.now() + 30000;
      let settledSince;
      scanMoves++;
      while (performance.now() < deadline) {
        await wait(pollInterval, signal);
        scope();
        const target = nextRow(readRows());
        if (target) return { target };
        if (unidentified(readRows())) throw new Error('Há um botão Seguindo sem perfil identificável.');
        if (loading(list)) {
          settledSince = undefined;
          continue;
        }
        settledSince ??= performance.now();
        if (performance.now() - settledSince < changeSettleTime) continue;
        const atEmptyList = empty(list, account.counter);
        if (!atEmptyList && scanMoves < 40 && scroller?.isConnected && scroller.scrollTop > previousTop) return {};
        if (performance.now() - lastActionAt < responseTimeout) continue;
        if (atEmptyList && countOf(account.counter) === 0) return { message: 'O Instagram indica que você não segue nenhuma conta.' };
        const remaining = countOf(account.counter);
        if (selection) return { message: 'Conferindo os perfis restantes da seleção.', reason: 'native-selected-pending' };
        if (remaining > 0 && remaining === protectedFollowing.size) return {
          message: 'Restam apenas os perfis protegidos na lista Seguindo.', reason: 'native-protected-only',
        };
        const followControls = controls(list).filter(button=>button.closest(dialogSelector)===list && followLabels.has(textOf(button))).length;
        const excludedFollowing = [...readRows().values()].filter(row => row.following && excludedNames.has(row.name)).length;
        return { message: excludedFollowing > 0
          ? excludedFollowing + ' perfil(is) ainda mostram Seguindo e ficaram pendentes. Os outros perfis disponíveis foram processados.'
          : Number.isSafeInteger(remaining) && remaining > 0
          ? `O perfil mostra ${remaining} seguindo, mas a lista não carregou contas com o botão Seguindo. Há ${followControls} botões Seguir; nenhuma sugestão será acionada.`
          : 'Nenhum outro botão Seguindo identificado. Confira a contagem no seu perfil.',
          reason: excludedFollowing > 0 ? 'native-exclusions-pending' :
            Number.isSafeInteger(remaining) && remaining > 0 ? 'native-following-unavailable' : 'native-list-pending',
          diagnostics: { followingCount: remaining ?? null, followingControls: relationshipControls(list).length, excludedFollowing, followControls } };
      }
      return { message: 'O Instagram demorou para carregar mais perfis da lista Seguindo.',
        reason: selection ? 'native-selected-pending' : 'native-following-unavailable' };
    }

    async function pauseBetweenProfiles() {
      const end = performance.now() + delayMs;
      while (performance.now() < end) {
        await wait(Math.min(pollInterval, Math.max(0, end - performance.now())), signal);
        scope();
      }
    }

    async function clickAndVerify(target, permit) {
      const authorize = () => {
        if (!Number.isSafeInteger(permit?.clickBy) || Date.now() >= permit.clickBy) throw new Error('O intervalo de autorização expirou. Inicie novamente.');
      };
      target.button.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
      await wait(100, signal);
      if (!await canClick(target.name, permit.dispatchId)) return false;
      scope();
      const before = readRows();
      const row = before.get(target.name);
      if (!row?.following || !clickable(row.button)) {
        throw new Error('O botão Seguindo para @' + target.name + ' mudou ou está encoberto.');
      }
      const positions = scrollContainers(list).map(element => [element, element.scrollTop]);
      const positiveCountBefore = countOf(account.counter) > 0;
      current = target.name;
      report('Conferindo @' + current + '…');
      lastActionAt = performance.now();
      authorize();clickSent = true;
      row.button.click();

      let confirmed = false;
      let changedSince;
      let deadline = performance.now() + responseTimeout;
      while (performance.now() < deadline) {
        await wait(pollInterval, signal);
        const modal = scope(true);
        if (modal) {
          changedSince = undefined;
          if (confirmed) continue;
          const confirm = knownConfirmation(modal, current);
          if (!confirm) throw new Error('O Instagram não identificou @' + current + ' na confirmação. A remoção não foi confirmada.');
          if (!clickable(confirm)) continue;
          if (!await canClick(target.name, permit.dispatchId)) return false;
          if (scope(true) !== modal || knownConfirmation(modal, current) !== confirm || !clickable(confirm)) {
            throw new Error('A janela de confirmação do Instagram mudou.');
          }
          lastActionAt = performance.now();
          authorize();
          confirm.click();
          confirmed = true;
          deadline = performance.now() + responseTimeout;
          continue;
        }
        const after = readRows();
        const entry = after.get(current);
        const samePosition = positions.every(([element, position]) =>
          element.isConnected && Math.abs(element.scrollTop - position) < 2
        );
        const neighborRemains = [...before.keys()].some(name => name !== current && after.has(name));
        const changed = entry?.following === false || (!entry && !hasProfileLink(list, current) &&
          !loading(list) && (empty(list, positiveCountBefore ? account.counter : null) ||
            (samePosition && neighborRemains)));
        changedSince = changed ? (changedSince ?? performance.now()) : undefined;
        if (changedSince !== undefined && performance.now() - changedSince >= changeSettleTime) return true;
      }
      const error = new Error('O Instagram não confirmou a mudança.');
      error.code = 'native-confirmation-timeout';error.phase = 'verifying-native';
      throw error;
    }

    async function canClick(name, dispatchId) {
      const decision = await guardRemoval(owner, name, dispatchId);
      if (decision === 'allowed') return true;
      if (decision === 'unfollow-protected' && !clickSent) {
        protectedSet.add(name);
        protectedFollowing.add(name);
        await onProtected(name);
        return false;
      }
      const error = new Error(decision === 'unfollow-protected'
        ? 'O perfil foi protegido durante uma ação. Confira o Instagram antes de retomar.'
        : 'A autorização para remover este perfil foi suspensa.');
      error.code = decision;
      throw error;
    }

    try {
      account = instagram() ? ownProfile(path) : null;
      if (!account) {
        throw new Error('Abra o seu próprio perfil no Instagram e clique em Seguindo.');
      }
      list = followingDialog(dialogs());
      if (!list) throw new Error('Abra a lista Seguindo do seu perfil e inicie de novo.');
      scope();
      const initialScrollers = scrollContainers(list);
      if (initialScrollers.length > 1) throw new Error('Há mais de uma área de rolagem na lista. Execução interrompida.');
      if (initialScrollers[0]?.scrollTop > 0) {
        initialScrollers[0].scrollTop = 0;
        initialScrollers[0].dispatchEvent(new Event('scroll', { bubbles: true }));
        await wait(400, signal);
      }

      while (true) {
        scope();
        if (selectionComplete()) return { ...result('Seleção conferida.'), reason: 'native-selected-complete', protectedFollowing: [...protectedFollowing] };
        let target = nextRow(readRows());
        if (!target) {
          if (unidentified(readRows())) {
            throw new Error('A lista mudou. Há um botão Seguindo sem perfil identificável.');
          }
          const scanned = await scanMore();
          if (scanned.message) return { ...result(scanned.message), reason:scanned.reason, diagnostics:scanned.diagnostics,
            protectedFollowing: [...protectedFollowing] };
          target = scanned.target;
          if (!target) continue;
        }
        report('Próximo perfil: @' + target.name + '.');
        const permit = await beforeAction(target.name);
        signal.throwIfAborted();
        if (permit?.skip) {
          if (permit.skip === 'protected') { protectedSet.add(target.name); protectedFollowing.add(target.name); }
          else excludedNames.add(target.name);
          continue;
        }
        await pauseBetweenProfiles();
        scope();
        const fresh = readRows().get(target.name);
        if (!fresh?.following) throw new Error('A linha de @' + target.name + ' mudou durante a espera.');
        if (!await clickAndVerify(fresh, permit)) continue;
        scanMoves = 0;
        await onConfirmed(target.name);
        clickSent = false;
        processed.add(target.name);
        current = '';
        report('@' + target.name + ' aparece como removido.');
      }
    } catch (error) {
      const message = error?.name === 'AbortError' ? 'Execução parada.' : (error?.message || 'Execução interrompida.');
      return { ...result(current ? message + ' Confira a última ação em @' + current + '.' : message), error: true,
        code: error?.code, phase: error?.phase, clickSent, interrupted: signal.aborted };
    } finally {
      running = false;
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('pagehide', onPageHide);
      document.removeEventListener('pointerdown', onSiteInput, true);
      document.removeEventListener('keydown', onSiteInput, true);
      document.removeEventListener('wheel', onSiteInput, true);
    }
  }

  globalThis.instagramFlowAssistedUnfollow = { open, close, run, inventoryPage, guardRemoval, identifiesConfirmation };
})();
