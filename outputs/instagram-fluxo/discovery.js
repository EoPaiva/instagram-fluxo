(() => {
  'use strict';

  const origin = 'https://www.instagram.com';
  const handlePattern = /^(?!\.{1,2}$)[a-z0-9._]{1,30}$/;
  const samplePerReference = 30;
  const suggestionsPerReference = 60;
  const automaticSuggestionsPerReference = 200;
  const pollMs = 350;
  const timeoutMs = 45000;
  const hiddenTimeoutMs = 300000;
  const scrollIntervalMs = 1300;
  const settleMs = 3500;
  const suggestionProbeMs = 8000;
  const suggestionProbeScrolls = 3;
  const verifiedOwners = new Map();
  const activeTabs = new Set();

  function avatarUrl(value) {
    if (typeof value !== 'string' || value.length > 2048 || /[\u0000-\u0020\u007f\\]/.test(value)) return '';
    try {
      const url = new URL(value);
      const allowed = ['cdninstagram.com', 'fbcdn.net'].some(host => url.hostname === host || url.hostname.endsWith('.' + host));
      return url.protocol === 'https:' && !url.username && !url.password && !url.port && allowed && url.href.length <= 2048 ? url.href : '';
    } catch { return ''; }
  }

  function guardChallenge(url) {
    if (url?.origin === origin && /^\/(?:challenge|checkpoint|accounts\/(?:suspended|disabled))(?:\/|$)/i.test(url.pathname)) {
      const error = new Error('O Instagram exige uma verificação. Conclua a verificação no Instagram antes de retomar a fila.');
      error.code = 'platform-challenge';
      throw error;
    }
  }

  function username(value) {
    let text = typeof value === 'string' ? value.trim() : '';
    if (/^https?:\/\//i.test(text)) {
      const url = URL.canParse(text) ? new URL(text) : null;
      if (!url || !['instagram.com', 'www.instagram.com'].includes(url.hostname)) {
        throw new Error('Use um @nome ou link de perfil do Instagram.');
      }
      text = url.pathname.replace(/^\/|\/$/g, '');
    }
    text = text.replace(/^@/, '').toLowerCase();
    if (!handlePattern.test(text)) throw new Error('Informe um @nome válido em cada perfil de referência.');
    return text;
  }

  // This function is serialized by Chrome into the Instagram tab's isolated context.
  function inspectPage(action, owner, reference, target, clickBy, token) {
    // Keep this validator self-contained: Chrome serializes only this function.
    const avatarUrl = value => {
      if (typeof value !== 'string' || value.length > 2048 || /[\u0000-\u0020\u007f\\]/.test(value)) return '';
      try {
        const url = new URL(value);
        const allowed = ['cdninstagram.com', 'fbcdn.net'].some(host => url.hostname === host || url.hostname.endsWith('.' + host));
        return url.protocol === 'https:' && !url.username && !url.password && !url.port && allowed && url.href.length <= 2048 ? url.href : '';
      } catch { return ''; }
    };
    const clean = text => (text ?? '').normalize('NFKC').replace(/[\s\u200e\u200f]+/g, ' ').trim();
    const lower = text => clean(text).toLowerCase();
    const rendered = element => element.isConnected && element.getClientRects().length > 0 &&
      getComputedStyle(element).visibility === 'visible';
    const shown = element => rendered(element) && !element.closest('[hidden], [aria-hidden="true"]');
    const controls = 'button, [role="button"]';
    const modalSelector = '[role="dialog"], [role="alertdialog"], dialog[open]';
    const profilePath = /^\/([a-z0-9._]{1,30})\/?$/i;
    const followLabels = ['seguir', 'seguir de volta', 'follow', 'follow back'];
    const followingLabels = ['seguindo', 'a seguir', 'following'];
    const requestedLabels = ['solicitado', 'solicitação enviada', 'pedido enviado', 'requested'];
    const relationshipLabels = [...followLabels, ...followingLabels, ...requestedLabels];
    const caption = element => lower(element.innerText);
    const pathOf = anchor => {
      if (!URL.canParse(anchor.href)) return '';
      const url = new URL(anchor.href);
      return url.origin === location.origin ? url.pathname : '';
    };
    const expected = reference || owner;
    try {
      if (location.origin === 'https://www.instagram.com' &&
          /^\/(?:challenge|checkpoint|accounts\/(?:suspended|disabled))(?:\/|$)/i.test(location.pathname)) {
        const error = new Error('O Instagram exige uma verificação. Conclua a verificação no Instagram antes de retomar a fila.');
        error.code = 'platform-challenge';
        throw error;
      }
      if (location.origin !== 'https://www.instagram.com' || (action !== 'account' &&
          ![expected, expected + '/followers', ...(action === 'close' ? [expected + '/following'] : [])].includes(location.pathname.replace(/^\/|\/$/g, '').toLowerCase()))) {
        throw new Error('A aba saiu do perfil esperado. Inicie a busca novamente.');
      }
      const open = [...document.querySelectorAll(modalSelector)].filter(shown);
      const alerts = [...document.querySelectorAll('[role="alert"], [aria-live="assertive"]')].filter(shown);
      const challenge = /confirme sua identidade|confirm your identity|captcha/i;
      const restriction = /tente (?:novamente |de novo )?mais tarde|try again later|ação bloqueada|action blocked|limitamos|we limit|restringimos|we restrict/i;
      const challengeShown = alerts.concat(open).some(element => challenge.test(element.innerText));
      if (challengeShown || alerts.concat(open).some(element => restriction.test(element.innerText))) {
        const error = new Error('O Instagram exibiu uma restrição. A fila foi pausada; confira o aplicativo antes de retomar.');
        error.code = challengeShown ? 'platform-challenge' : 'platform-restricted';
        throw error;
      }
      if (alerts.concat(open).some(element => /algo deu errado|something went wrong/i.test(element.innerText))) {
        throw new Error('O Instagram exibiu um aviso durante a leitura. Aguarde antes de tentar novamente.');
      }
      if (action === 'account') {
        if (/^\/accounts\/(?:login|onetap)(?:\/|$)/i.test(location.pathname) ||
            [...document.querySelectorAll('input[name="username"], input[type="password"]')].some(shown)) {
          throw new Error('Entre na sua conta no Instagram antes de carregar a fila.');
        }
        const accounts = new Set();
        for (const anchor of document.querySelectorAll('a[href]')) {
          if (!rendered(anchor) || anchor.closest('main, [role="main"], ' + modalSelector + ', [role="menu"]')) continue;
          const name = pathOf(anchor).match(profilePath)?.[1]?.toLowerCase();
          if (!name || !/[a-z0-9_]/.test(name)) continue;
          const captions = ['foto do perfil de ' + name, 'foto de perfil de ' + name,
            'profile picture of ' + name, name + "'s profile picture", name + '’s profile picture'];
          if ([...anchor.querySelectorAll('img')].some(image => rendered(image) && captions.includes(lower(image.alt)))) accounts.add(name);
        }
        if (accounts.size > 1) throw new Error('Mais de uma conta conectada foi identificada. Abra seu próprio perfil para continuar.');
        const listNames = ['seguidores','followers','seguindo','following','a seguir'];
        const listOpen = open.length === 1 && [...open[0].querySelectorAll('h1,h2,h3,[role="heading"]')].some(element => shown(element) && listNames.includes(caption(element)));
        if (open.length && !listOpen) throw new Error('Feche a janela aberta no Instagram antes de carregar sua conta.');
        return {ok:true,data:{username:[...accounts][0] ?? null,listOpen}};
      }
      const main = document.querySelector('main, [role="main"]');
      if (!main) return { ok: true, data: null };
      if (action === 'profile') {
        const edit = [...main.querySelectorAll('a[href="/accounts/edit/"], a[href="/accounts/edit"]')].find(anchor =>
          shown(anchor) && ['editar perfil', 'edit profile'].includes(caption(anchor))
        );
        if (!edit) return { ok: true, data: null };
        const stats = /^(?:[\d.,]+\s*(?:mil|k|m)?\s+)(?:seguindo|seguidores|followers|following|a seguir)$/i;
        let header = edit.closest('header');
        for (let parent = edit.parentElement; !header && parent && parent !== main; parent = parent.parentElement) {
          if ([...parent.querySelectorAll('a[href]')].filter(anchor => stats.test(clean(anchor.innerText))).length >= 2) header = parent;
        }
        if (!header) return { ok: true, data: null };
        const lastCount = [...header.querySelectorAll('a[href]')].filter(anchor => stats.test(clean(anchor.innerText))).at(-1);
        if (!lastCount) return { ok: true, data: null };
        const interfaceText = /^(?:editar perfil|edit profile|configurações|settings|opções|options|mais|more|ver arquivo|view archive|itens arquivados|archived items|adicionar story|add story|nota(?:\.\.\.)?|note(?:\.\.\.)?)$/i;
        const parts = [...header.querySelectorAll('h1, h2, [role="heading"], button, [role="button"], [dir="auto"]')].filter(element =>
          shown(element) && !element.closest('a, nav, footer, article, [role="tabpanel"]') &&
          (lastCount.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING) &&
          (!element.querySelector('[dir="auto"]') || element.matches(controls))
        ).map(element => clean(element.innerText)).filter(text =>
          text.length > 1 && text.length <= 500 && lower(text) !== owner &&
          !interfaceText.test(text) && !stats.test(text) && !/^\d[\d.,\s]*(?: posts?| publicações?)?$/i.test(text)
        );
        const bio = [...new Set(parts)].filter(part => !parts.some(other => other.length > part.length && other.includes(part)))
          .slice(0, 6).join('\n').slice(0, 900);
        const topics = [...new Set((bio.match(/#[\p{L}\p{N}_]+/gu) ?? []).map(tag => tag.slice(1)))].slice(0, 12);
        return { ok: true, data: { username: owner, bio, topics } };
      }

      // A modal can hide the underlying navigation and profile from assistive technology.
      const sameAccount = [...document.querySelectorAll('a[href]')].some(anchor =>
        rendered(anchor) && !anchor.closest('main, [role="main"], ' + modalSelector) && anchor.querySelector('img') &&
        pathOf(anchor).replace(/\/$/, '').toLowerCase() === '/' + owner
      );
      if (!sameAccount) throw new Error('A conta conectada ao Instagram mudou. Volte ao seu perfil e inicie novamente.');
      const header = main.querySelector('header');
      if (!header || ![...header.querySelectorAll('h1, h2, h3, [role="heading"], a[href="#"]')].some(element =>
        rendered(element) && caption(element) === reference
      )) return { ok: true, data: null };
      if (action === 'open') {
        if (open.length) throw new Error('Feche a janela aberta do Instagram antes de iniciar outra busca.');
        const links = [...header.querySelectorAll('a[href]')].filter(anchor =>
          shown(anchor) && /^\d.*\s(?:seguidores?|followers?)$/i.test(caption(anchor)) &&
          (anchor.getAttribute('href') === '#' || pathOf(anchor).replace(/\/$/, '').toLowerCase() === '/' + reference + '/followers')
        );
        if (links.length === 0) return { ok: true, data: { unavailable: true } };
        if (links.length !== 1) throw new Error('Mais de um controle de seguidores foi encontrado em @' + reference + '.');
        const link = links[0];
        const zeroCount = /^0\s/.test(caption(link));
        if (zeroCount && link.getAttribute('aria-disabled') === 'true') return { ok: true, data: { empty: true } };
        link.click();
        return { ok: true, data: { opened: true, zeroCount } };
      }
      if (open.length === 0) return { ok: true, data: null };
      if (open.length !== 1) throw new Error('O Instagram abriu outra janela durante a leitura.');
      const dialog = open[0];
      if (![...dialog.querySelectorAll('h1, h2, h3, [role="heading"]')].some(element =>
        shown(element) && (action === 'close' ? ['seguidores','followers','seguindo','following','a seguir'] : ['seguidores','followers']).includes(caption(element))
      )) return { ok: true, data: null };
      if ([...dialog.querySelectorAll('input')].some(input => shown(input) && clean(input.value))) {
        throw new Error('A lista de @' + reference + ' foi filtrada manualmente. Inicie novamente.');
      }
      if (action === 'close') {
        const close = [...dialog.querySelectorAll(controls)].filter(element =>
          shown(element) && ['fechar', 'close'].includes(lower(element.getAttribute('aria-label')))
        );
        if (close.length !== 1) throw new Error('Não consegui fechar a lista de @' + reference + '.');
        close[0].click();
        return { ok: true, data: true };
      }
      const emptyNotice = /^(?:você verá todas as pessoas que seguem você aqui|you(?:'|’)ll see all (?:the )?people who follow you here)[.!]?$/i;
      const empty = dialog.innerText.split('\n').some(line => emptyNotice.test(clean(line)));
      const relationshipControls = new Set([...dialog.querySelectorAll(controls)].filter(element =>
        shown(element) && relationshipLabels.includes(caption(element))
      ));
      const rows = [];
      for (const marker of relationshipControls) {
        for (let row = marker.parentElement; row && row !== dialog; row = row.parentElement) {
          const names = new Set([...row.querySelectorAll('a[href]')].flatMap(anchor => {
            for (let note = anchor.parentElement; note && note !== row; note = note.parentElement) {
              if (/^(?:seguido\(a\) por|seguid[oa] por|followed by)\s/i.test(clean(note.innerText)) &&
                  !note.querySelector(controls)) return [];
            }
            const name = shown(anchor) && pathOf(anchor).match(profilePath)?.[1]?.toLowerCase();
            return name && name !== '.' && name !== '..' ? [name] : [];
          }));
          if (!names.size) continue;
          const another = [...row.querySelectorAll(controls)].some(control => control !== marker && relationshipControls.has(control));
          if (names.size === 1 && !another) {
            const [username] = names;
            const label = row.innerText.split('\n').map(clean).find(line =>
              lower(line) !== username && !relationshipLabels.includes(lower(line)) && line.length > 1
            ) ?? username;
            const dialogBounds = dialog.getBoundingClientRect();
            const photo = [...row.querySelectorAll('a[href]')].filter(anchor => shown(anchor) &&
              pathOf(anchor).replace(/\/$/, '').toLowerCase() === '/' + username).flatMap(anchor => [...anchor.querySelectorAll('img')])
              .filter(image => {
                if (!shown(image)) return false;
                const bounds = image.getBoundingClientRect();
                return bounds.bottom > Math.max(0, dialogBounds.top) && bounds.top < Math.min(innerHeight, dialogBounds.bottom) &&
                  bounds.right > Math.max(0, dialogBounds.left) && bounds.left < Math.min(innerWidth, dialogBounds.right);
              }).map(image => avatarUrl(image.currentSrc || image.src)).find(Boolean) || '';
            rows.push({ row, marker, candidate: { username, label: label.slice(0, 140), avatarUrl: photo } });
          }
          break;
        }
      }
      const isSuggestionTitle = element => shown(element) && !element.closest('a, ' + controls) &&
        /^(?:sugestões para você|sugestões para ti|sugeridos para você|suggested for you|suggestions)$/i.test(caption(element)) &&
        !rows.some(({ row }) => row.contains(element));
      const suggestion = [...dialog.querySelectorAll('h1, h2, h3, h4, h5, h6, [role="heading"]')].find(isSuggestionTitle) ??
        [...dialog.querySelectorAll('[dir="auto"]')].find(isSuggestionTitle);
      const afterSuggestion = element => suggestion &&
        Boolean(suggestion.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING);
      const followerAction = action === 'follow-follower' || action === 'confirm-follower';
      if (action === 'follow-suggestion' || action === 'confirm-suggestion' || followerAction) {
        const targets = rows.filter(({ marker, candidate }) =>
          candidate.username === target && (followerAction ? !suggestion : afterSuggestion(marker)));
        if (action === 'follow-suggestion' || action === 'follow-follower') {
          if (targets.length !== 1 || target === owner || target === reference ||
              !Number.isSafeInteger(clickBy) || Date.now() >= clickBy) return { ok: true, data: 'skipped' };
          const [{ marker }] = targets;
          if (!['seguir', 'follow'].includes(caption(marker)) || marker.matches(':disabled') ||
              marker.closest('[inert], [aria-disabled="true"]')) return { ok: true, data: 'skipped' };
          globalThis.instagramFluxoSuggestionClick = { token, target, dialog, followerAction };
          marker.click();
          return { ok: true, data: 'sent' };
        }
        const clicked = globalThis.instagramFluxoSuggestionClick;
        if (clicked?.token !== token || clicked.target !== target || clicked.dialog !== dialog ||
            clicked.followerAction !== followerAction || targets.length !== 1) {
          return { ok: true, data: null };
        }
        const [{ marker }] = targets;
        const label = caption(marker);
        if (followingLabels.includes(label)) return { ok: true, data: 'following' };
        if (requestedLabels.includes(label)) return { ok: true, data: 'requested' };
        const stillAvailable = ['seguir', 'follow'].includes(label) && !marker.matches(':disabled') &&
          !marker.closest('[inert], [aria-disabled="true"]');
        return { ok: true, data: stillAvailable ? 'still-available' : null };
      }
      const matches = new Map();
      const suggestions = new Map();
      for (const { row, marker, candidate } of rows) {
        if (!afterSuggestion(marker)) {
          matches.set(candidate.username, { ...candidate,
            alreadyFollows: ['seguir de volta', 'follow back'].includes(caption(marker)),
            followable: followLabels.includes(caption(marker)) && !marker.matches(':disabled') &&
              !marker.closest('[inert], [aria-disabled="true"]') });
        } else if (followLabels.includes(caption(marker)) && !marker.matches(':disabled') &&
            !marker.closest('[inert], [aria-disabled="true"]')) {
          const alreadyFollows = ['seguir de volta', 'follow back'].includes(caption(marker));
          const mutual = [...row.querySelectorAll('div, span')].some(element =>
            shown(element) && !element.closest('a, ' + controls) &&
            !element.querySelector(controls) &&
            /^(?:seguido\(a\) por|seguid[oa] por|followed by)\s+\S/i.test(clean(element.innerText))
          );
          suggestions.set(candidate.username, { ...candidate, alreadyFollows, mutual });
        }
      }
      const areas = [dialog, ...dialog.querySelectorAll('div, ul, section')].filter(element =>
        shown(element) && /^(auto|scroll|overlay)$/.test(getComputedStyle(element).overflowY) &&
        element.scrollHeight > element.clientHeight + 2
      );
      if (areas.length > 1) throw new Error('A rolagem da lista mudou. Inicie a busca novamente.');
      const area = areas[0];
      const viewport = (area ?? dialog).getBoundingClientRect();
      const loading = [...dialog.querySelectorAll('[role="progressbar"], [aria-busy="true"]')].some(element => {
        const bounds = element.getBoundingClientRect();
        return shown(element) && bounds.bottom > viewport.top && bounds.top < viewport.bottom;
      });
      if (action === 'scroll' && area) {
        area.scrollTop += Math.max(1, Math.floor(area.clientHeight * 0.6));
        area.dispatchEvent(new Event('scroll', { bubbles: true }));
      }
      return { ok: true, data: {
        matches: [...matches.values()], suggestions: [...suggestions.values()], loading,
        atBottom: !area || area.scrollTop + area.clientHeight >= area.scrollHeight - 2,
        hidden: document.hidden,
        empty,
        controlsFound: [...relationshipControls].filter(element => !afterSuggestion(element)).length,
        suggestionsShown: Boolean(suggestion),
      } };
    } catch (error) {
      return { ok: false, error: error.message, ...(error.code ? { code: error.code } : {}) };
    }
  }

  function wait(signal, ms = pollMs) {
    signal?.throwIfAborted();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, ms);
      function abort() { clearTimeout(timer); reject(signal.reason); }
      signal?.addEventListener('abort', abort, { once: true });
    });
  }

  async function runInTab(tabId, action, owner = null, reference, target = null, clickBy = null, token = null) {
    let results;
    try {
      results = await chrome.scripting.executeScript({
        target: { tabId }, func: inspectPage, args: [action, owner, reference ?? null, target, clickBy, token],
      });
    } catch {
      throw new Error('A aba perdeu a conexão com a extensão. Abra seu perfil e acione o ícone novamente.');
    }
    const output = results[0]?.result;
    if (!output?.ok) {
      const error = new Error(output?.error || 'O Instagram não respondeu à leitura.');
      error.code = output?.code;
      throw error;
    }
    return output.data;
  }

  async function navigate(tabId, name, signal) {
    const desired = '/' + name + '/';
    const current = await chrome.tabs.get(tabId);
    const url = URL.canParse(current.url) ? new URL(current.url) : null;
    guardChallenge(url);
    if (url?.origin !== origin) throw new Error('Abra uma aba conectada em www.instagram.com.');
    signal?.throwIfAborted();
    if (url.pathname !== desired) await chrome.tabs.update(tabId, { url: origin + desired });
    const began = performance.now();
    while (performance.now() - began < timeoutMs) {
      signal?.throwIfAborted();
      const tab = await chrome.tabs.get(tabId);
      guardChallenge(URL.canParse(tab.url) ? new URL(tab.url) : null);
      if (!tab.url?.startsWith(origin + desired)) {
        if (tab.status !== 'loading') throw new Error('O Instagram abriu outra página. Confira a conta conectada.');
      } else if (tab.status === 'complete') return;
      await wait(signal);
    }
    throw new Error('O perfil @' + name + ' demorou para abrir.');
  }

  async function readOwnProfile(tabId) {
    const tab = await chrome.tabs.get(tabId);
    const url = URL.canParse(tab.url) ? new URL(tab.url) : null;
    guardChallenge(url);
    const account = await runInTab(tabId, 'account');
    const pathOwner = url?.origin === origin ? url.pathname.match(/^\/([a-z0-9._]{1,30})(?:\/(?:followers|following))?\/?$/i)?.[1]?.toLowerCase() : null;
    const owner = account?.username ?? pathOwner;
    if (!owner) throw new Error('Abra seu próprio perfil do Instagram para analisar o nicho.');
    if (!account?.username) {
      const own = await runInTab(tabId,'profile',owner);
      if (!own) throw new Error('Não consegui identificar a conta conectada. Abra seu próprio perfil no Instagram.');
      verifiedOwners.set(tabId,owner);
      return own;
    }
    if (account.listOpen) {
      if (!pathOwner || !(await runInTab(tabId,'close',owner,pathOwner))) throw new Error('Feche a lista aberta no Instagram e carregue sua conta novamente.');
    }
    await navigate(tabId, owner);
    const started = performance.now();
    while (performance.now() - started < timeoutMs) {
      const profile = await runInTab(tabId, 'profile', owner);
      if (profile) {
        const current = await runInTab(tabId,'account');
        if (current?.username !== owner) throw new Error('A conta conectada mudou durante a leitura. Carregue o perfil novamente.');
        verifiedOwners.set(tabId, owner); return profile;
      }
      await wait();
    }
    throw new Error('Não consegui confirmar seu próprio perfil. Atualize a aba e tente novamente.');
  }

  async function clickSuggestion(tabId, owner, reference, target, clickBy, signal, fromFollowers = false) {
    signal?.throwIfAborted();
    const token = crypto.randomUUID();
    const source = fromFollowers ? 'follower' : 'suggestion';
    try {
      const sent = await runInTab(tabId, 'follow-' + source, owner, reference, target, clickBy, token);
      if (sent === 'skipped' || sent === null) return 'skipped';
      if (sent !== 'sent') throw new Error('Não foi possível verificar se o clique foi enviado.');
      const started = performance.now();
      while (performance.now() - started < 12000) {
        const result = await runInTab(tabId, 'confirm-' + source, owner, reference, target, null, token);
        if (result === 'following' || result === 'requested') return result;
        await wait();
      }
      const final = await runInTab(tabId, 'confirm-' + source, owner, reference, target, null, token);
      if (final === 'following' || final === 'requested') return final;
      const unconfirmed = new Error('O Instagram não confirmou o novo estado do botão.');
      // Only an acknowledged dispatch with an intact, revalidated target is
      // recoverable. A vanished row, changed dialog or ambiguous send is not.
      if (final === 'still-available') unconfirmed.code = 'follow-unconfirmed-profile';
      throw unconfirmed;
    } catch (cause) {
      const error = new Error('Confira @' + target + ' no Instagram. O clique em Seguir ficou sem confirmação. ' + cause.message, { cause });
      error.clickSent = true;
      error.code = cause?.code;
      throw error;
    }
  }

  async function sample(tabId, owner, reference, { signal, onUpdate, log, excluded, suggestionsOnly, followerFallback, onSuggestion, chooseSuggestions, onObserved }) {
    const suggestionLimit = suggestionsOnly ? automaticSuggestionsPerReference : suggestionsPerReference;
    const followerLimit = suggestionsOnly ? automaticSuggestionsPerReference : samplePerReference;
    log('Abrindo perfil.');
    await navigate(tabId, reference, signal);
    log('Perfil aberto. Procurando o botão Seguidores.');
    const openAt = performance.now();
    let opened;
    while (!opened && performance.now() - openAt < timeoutMs) {
      opened = await runInTab(tabId, 'open', owner, reference);
      if (!opened) await wait(signal);
    }
    if (!opened || opened.unavailable) {
      const message = 'Não consegui abrir os seguidores de @' + reference + '. Confira se o perfil está acessível para sua conta.';
      if (!suggestionsOnly) throw new Error(message);
      log('Lista de seguidores indisponível. Continuando pelas outras referências.');
      return [];
    }
    if (opened.empty) {
      log('O perfil informou zero seguidores. Referência pulada.');
      return [];
    }
    log('Botão Seguidores acionado. Aguardando a lista.');
    const found = new Map();
    const suggestions = new Map();
    let lastProgress = performance.now();
    const probeStartedAt = lastProgress;
    let probeScrolls = 0;
    let idleScrolls = 0;
    let sawSuggestions = false;
    let fromFollowers = false;
    const metadata = candidate => ({ ...candidate,
      suggestionProfiles: candidate.suggested === false ? [] : [reference],
      sourceProfiles: candidate.suggested === false ? [reference] : [] });
    let nextScrollAt = performance.now() + scrollIntervalMs;
    let settledAt;
    let emptySince;
    let lastViewLog;
    let sawDialog = false;
    let background = false;
    let retries = 0;
    let lastRetry = performance.now();
    async function finishSuggestions(stopped = false) {
      await runInTab(tabId, 'close', owner, reference);
      if (!suggestions.size) {
        log(suggestionsOnly ? 'Nenhuma sugestão foi encontrada nesta referência.' : 'O Instagram mostrou a lista vazia. Referência pulada.');
        return { candidates: [], stopped };
      }
      log(suggestionsOnly ? `O Instagram exibiu ${suggestions.size} perfis elegíveis na origem selecionada.` :
        `O Instagram mostrou a lista vazia e ${suggestions.size} sugestões disponíveis.`);
      return { candidates: [...suggestions.values()], stopped };
    }
    while (true) {
      signal?.throwIfAborted();
      const view = await runInTab(tabId, 'read', owner, reference);
      if (!view) {
        if (sawDialog) throw new Error('A lista de @' + reference + ' foi fechada durante a leitura.');
        if (opened.zeroCount && performance.now() - lastProgress >= settleMs) {
          log('O perfil informou zero seguidores e o Instagram não abriu a lista. Referência pulada.');
          return [];
        }
        if (performance.now() - lastProgress >= (document.hidden ? hiddenTimeoutMs : timeoutMs)) break;
        await wait(signal);
        continue;
      }
      if (!sawDialog) log('Janela Seguidores reconhecida.');
      sawDialog = true;
      const hidden = document.hidden || view.hidden;
      if (background && !hidden) lastProgress = performance.now();
      background = hidden;
      sawSuggestions ||= view.suggestionsShown;
      if (view.suggestionsShown) fromFollowers = false;
      const previousSize = found.size;
      for (const candidate of view.matches) {
        if (!found.has(candidate.username) && found.size < followerLimit) found.set(candidate.username, candidate);
        else if (found.has(candidate.username) && avatarUrl(candidate.avatarUrl)) found.get(candidate.username).avatarUrl = avatarUrl(candidate.avatarUrl);
      }
      const refreshed = [];
      for (const candidate of view.suggestions.concat(fromFollowers ? view.matches : [])) {
        const previous = suggestions.get(candidate.username);
        const photo = avatarUrl(candidate.avatarUrl);
        if (previous && photo && previous.avatarUrl !== photo) {
          previous.avatarUrl = photo;
          refreshed.push(metadata(previous));
        }
      }
      if (refreshed.length && onObserved) await onObserved(refreshed);
      const viewLog = `${found.size} seguidores lidos · ${view.controlsFound} controles de seguidores visíveis · ` +
        `carregando: ${view.loading ? 'sim' : 'não'} · sugestões: ${view.suggestionsShown ? 'sim' : 'não'} · ` +
        `aviso de lista vazia: ${view.empty ? 'sim' : 'não'}.`;
      if (viewLog !== lastViewLog) {
        log(viewLog);
        lastViewLog = viewLog;
      }
      if (found.size !== previousSize) {
        retries = 0;
        if (!suggestionsOnly) {
          lastProgress = performance.now();
          onUpdate({ message: '@' + reference + ': ' + found.size + ' seguidores lidos.', reference, loaded: found.size, limit: samplePerReference });
        }
      }
      if (suggestionsOnly && !sawSuggestions && !fromFollowers &&
          (performance.now() - probeStartedAt >= suggestionProbeMs || probeScrolls >= suggestionProbeScrolls ||
            found.size >= automaticSuggestionsPerReference || (!view.loading && view.atBottom && performance.now() - probeStartedAt >= settleMs))) {
        if (followerFallback === true && !view.loading && view.matches.length) {
          fromFollowers = true;
          lastProgress = performance.now();
          log('Sugestões não apareceram na busca curta. Usando seguidores da referência, conforme a opção selecionada.');
          onUpdate({ message: '@' + reference + ': usando seguidores da referência como alternativa.', reference, source: 'reference-followers' });
        } else {
          log('Sugestões não apareceram na busca curta. Continuando pela próxima referência.');
          return finishSuggestions();
        }
      }
      if (!suggestionsOnly && found.size >= samplePerReference) break;
      if (suggestionsOnly || (!found.size && (view.empty || opened.zeroCount))) {
        const now = performance.now();
        if (view.loading) {
          emptySince = undefined;
          settledAt = undefined;
        } else {
          emptySince ??= now;
          settledAt = view.atBottom ? (settledAt ?? now) : undefined;
          if (now - emptySince >= settleMs) {
            const previousSuggestions = suggestions.size;
            const offered = fromFollowers ? view.matches.filter(candidate => candidate.followable) : view.suggestions;
            const fresh = offered.filter(candidate => !excluded.has(candidate.username) && !suggestions.has(candidate.username))
              .slice(0, suggestionLimit - suggestions.size).map(candidate => ({ ...candidate, suggested: !fromFollowers }));
            if (fresh.some(candidate => !candidate.alreadyFollows)) idleScrolls = 0;
            if (fresh.length && onObserved) await onObserved(fresh.map(metadata));
            let chosen;
            let decision;
            if (chooseSuggestions && fresh.some(candidate => !candidate.alreadyFollows)) {
              decision = await chooseSuggestions(fresh.filter(candidate => !candidate.alreadyFollows).slice(0, 40),
                { reference, atBottom: view.atBottom, source: fromFollowers ? 'reference-followers' : 'suggestions' });
              signal?.throwIfAborted();
              if (decision.action === 'stop') return finishSuggestions(true);
              if (decision.action === 'next_reference') return finishSuggestions();
              chosen = new Set(decision.usernames ?? []);
            }
            const ordered = chosen ? [...decision.usernames.map(name => fresh.find(candidate => candidate.username === name)).filter(Boolean),
              ...fresh.filter(candidate => !chosen.has(candidate.username))] : fresh;
            for (const candidate of ordered) {
              if (suggestions.size >= suggestionLimit) break;
              if (!excluded.has(candidate.username) && !suggestions.has(candidate.username)) {
                suggestions.set(candidate.username, candidate);
                if (onSuggestion && !candidate.alreadyFollows && (!chosen || chosen.has(candidate.username))) {
                  signal?.throwIfAborted();
                  const proceed = await onSuggestion(candidate.username, clickBy =>
                    clickSuggestion(tabId, owner, reference, candidate.username, clickBy, signal, candidate.suggested === false),
                  metadata(candidate));
                  if (proceed === false) return finishSuggestions(true);
                  lastProgress = performance.now();
                }
              }
            }
            if (suggestions.size !== previousSuggestions) {
              if (fresh.some(candidate => !candidate.alreadyFollows)) lastProgress = performance.now();
              if (view.atBottom) settledAt = lastProgress;
              onUpdate({
                message: '@' + reference + ': ' + suggestions.size + ' perfis observados.',
                reference, loaded: suggestions.size, limit: suggestionLimit, source: fromFollowers ? 'reference-followers' : 'suggestions',
              });
            }
            if (idleScrolls >= 8) {
              log('Oito rolagens sem novos perfis elegíveis. Continuando pela próxima referência.');
              return finishSuggestions();
            }
            if (decision?.action === 'scroll' && !view.atBottom) {
              await runInTab(tabId, 'scroll', owner, reference);
              idleScrolls += 1;
              if (!sawSuggestions && !fromFollowers) probeScrolls += 1;
              nextScrollAt = performance.now() + scrollIntervalMs;
              await wait(signal);
              continue;
            }
            if (suggestions.size >= suggestionLimit || (settledAt !== undefined && now - settledAt >= settleMs)) {
              return finishSuggestions();
            }
            if (!view.atBottom && now >= nextScrollAt) {
              await runInTab(tabId, 'scroll', owner, reference);
              idleScrolls += 1;
              if (!sawSuggestions && !fromFollowers) probeScrolls += 1;
              nextScrollAt = now + scrollIntervalMs;
            }
          }
        }
        if (now - lastProgress >= (background ? hiddenTimeoutMs : timeoutMs)) {
          if (suggestions.size) return finishSuggestions();
          break;
        }
        await wait(signal);
        continue;
      }
      emptySince = undefined;
      if (performance.now() - lastProgress >= (background ? hiddenTimeoutMs : timeoutMs)) break;
      if (view.atBottom && !view.loading) {
        settledAt ??= performance.now();
        if (performance.now() - settledAt >= settleMs && found.size > 0) break;
      } else settledAt = undefined;
      if (!view.loading && !view.atBottom && performance.now() >= nextScrollAt) {
        await runInTab(tabId, 'scroll', owner, reference);
        nextScrollAt = performance.now() + scrollIntervalMs;
        settledAt = undefined;
      } else if (view.atBottom && performance.now() - lastProgress >= 8000 &&
          performance.now() - lastRetry >= 8000 && retries < 3) {
        await runInTab(tabId, 'scroll', owner, reference);
        lastRetry = performance.now();
        retries++;
      }
      await wait(signal);
    }
    if (!sawDialog) {
      log('Tempo esgotado sem reconhecer a janela Seguidores.');
      throw new Error('A janela Seguidores de @' + reference + ' não apareceu ou não foi reconhecida.');
    }
    if (suggestionsOnly) return finishSuggestions();
    if (!found.size) {
      log('Tempo esgotado com a janela aberta e zero seguidores reconhecidos.');
      throw new Error('O Instagram abriu Seguidores de @' + reference + ', mas nenhuma linha de seguidor foi reconhecida. Confira o log da busca.');
    }
    await runInTab(tabId, 'close', owner, reference);
    log(`Leitura concluída com ${found.size} seguidores.`);
    return [...found.values()];
  }

  async function discover(tabId, references, {
    owner: configuredOwner, signal, suggestionsOnly = false, onUpdate = () => {}, onDiagnostic = () => {},
    onSuggestion, chooseSuggestions, onObserved, excludedProfiles = [], followerFallback = false,
  } = {}) {
    if (activeTabs.has(tabId)) throw new Error('Já existe uma leitura nesta aba.');
    if (!Array.isArray(references) || references.length !== 3) throw new Error('Configure três perfis de referência.');
    const seeds = references.map(username);
    if (new Set(seeds).size !== 3) throw new Error('Use três perfis de referência diferentes.');
    const owner = username(configuredOwner ?? verifiedOwners.get(tabId));
    if (seeds.includes(owner)) throw new Error('Escolha três referências diferentes do seu próprio perfil.');
    const excluded = new Set([owner, ...seeds, ...excludedProfiles.map(username)]);
    activeTabs.add(tabId);
    try {
      await navigate(tabId, owner, signal);
      if ((await readOwnProfile(tabId)).username !== owner) throw new Error('A conta conectada mudou.');
      const found = new Map();
      for (const reference of seeds) {
        signal?.throwIfAborted();
        onUpdate(suggestionsOnly
          ? { message: 'Procurando sugestões do Instagram em @' + reference + '…', reference, loaded: 0, limit: automaticSuggestionsPerReference, source: 'suggestions' }
          : { message: 'Lendo seguidores de @' + reference + '…', reference, loaded: 0, limit: samplePerReference });
        const log = message => onDiagnostic('@' + reference + ' · ' + message);
        let candidates;
        try {
          candidates = await sample(tabId, owner, reference, { signal, onUpdate, log, excluded, suggestionsOnly, followerFallback, onSuggestion, chooseSuggestions, onObserved });
        } catch (error) {
          log(signal?.aborted ? 'Leitura interrompida.' : 'A leitura desta referência foi encerrada com erro.');
          if (!error?.clickSent && (signal?.aborted || error?.code === 'follow-limit')) {
            await runInTab(tabId, 'close', owner, reference).catch(() => {});
          }
          throw error;
        }
        for (const candidate of candidates.candidates ?? candidates) {
          if (excluded.has(candidate.username)) continue;
          const entry = found.get(candidate.username) ?? { username: candidate.username, label: candidate.label, sourceProfiles: [] };
          entry.avatarUrl = avatarUrl(candidate.avatarUrl) || avatarUrl(entry.avatarUrl);
          if (candidate.suggested) {
            (entry.suggestionProfiles ??= []).push(reference);
            if (suggestionsOnly) {
              entry.alreadyFollows ||= candidate.alreadyFollows;
              entry.mutual ||= candidate.mutual;
            }
          } else entry.sourceProfiles.push(reference);
          found.set(candidate.username, entry);
        }
        if (candidates.stopped) break;
      }
      await navigate(tabId, owner, signal);
      return [...found.values()];
    } finally {
      activeTabs.delete(tabId);
    }
  }

  globalThis.instagramDiscovery = { readOwnProfile, discover };
})();
