/* Local thumbnail transport. Photo failure never changes relationship execution. */
(() => {
  'use strict';
  const origins = ['https://*.cdninstagram.com/*', 'https://*.fbcdn.net/*'];
  const memo = new Map();
  const memoLimit = 100;
  const button = document.getElementById('queue-enable-photos');
  const status = document.getElementById('queue-photo-status');
  const name = value => typeof value === 'string' && /^[a-z0-9._]{1,30}$/i.test(value) && /[a-z0-9_]/i.test(value) ? value.toLowerCase() : '';

  function avatarUrl(value) {
    if (typeof value !== 'string' || value.length > 2048 || /[\u0000-\u0020\u007f\\]/.test(value)) return '';
    try {
      const url = new URL(value);
      const allowed = ['cdninstagram.com', 'fbcdn.net'].some(host => url.hostname === host || url.hostname.endsWith('.' + host));
      return url.protocol === 'https:' && !url.username && !url.password && !url.port && allowed && url.href.length <= 2048 ? url.href : '';
    } catch { return ''; }
  }

  function localPhoto(value) {
    const prefix = 'data:image/jpeg;base64,';
    return typeof value === 'string' && value.length <= 32768 &&
      /^data:image\/jpeg;base64,\/9j\/[A-Za-z0-9+/]*={0,2}$/.test(value) &&
      (value.length - prefix.length) % 4 === 0 ? value : '';
  }

  function clearNegativeMemo() {
    for (const [key, entry] of memo) if (entry.status !== 'ready') memo.delete(key);
  }

  function report(message) {
    if (status && status.textContent !== message) status.textContent = message;
  }

  function load(rawOwner, rawUsername, rawAvatarUrl) {
    const owner = name(rawOwner), username = name(rawUsername), source = avatarUrl(rawAvatarUrl);
    if (!owner || !username || !source || !globalThis.chrome?.runtime?.sendMessage) return Promise.resolve({ status: 'unavailable' });
    const key = `${owner}|${username}|${source}`;
    const existing = memo.get(key);
    if (existing) {
      memo.delete(key);
      memo.set(key, existing);
      return existing.promise;
    }
    const entry = { status: 'loading', promise: null };
    entry.promise = Promise.resolve().then(() => chrome.runtime.sendMessage({ type: 'profilePhoto', owner, username, avatarUrl: source }))
      .then(response => {
        if (response?.error === 'Ação não reconhecida.') report('Recarregue o Instagram Fluxo em chrome://extensions e reabra o painel para ativar as fotos. Os dados locais são preservados.');
        const result = response?.ok === true ? response.data : null;
        const dataUrl = result?.status === 'ready' ? localPhoto(result.dataUrl) : '';
        const answer = dataUrl ? { status: 'ready', dataUrl } :
          { status: result?.status === 'permission-required' ? 'permission-required' : 'unavailable' };
        if (answer.status === 'permission-required') {
          if (button) button.hidden = false;
          report('Ative as fotos para guardar as miniaturas do Instagram neste Chrome.');
        }
        entry.status = answer.status;
        return answer;
      }).catch(() => {
        entry.status = 'unavailable';
        return { status: 'unavailable' };
      });
    memo.set(key, entry);
    if (memo.size > memoLimit) memo.delete(memo.keys().next().value);
    return entry.promise;
  }

  globalThis.instagramProfilePhotos = Object.freeze({ load });
  button?.addEventListener('click', event => {
    if (!event.isTrusted || button.disabled || !globalThis.chrome?.permissions?.request) return;
    let request;
    try {
      // Keep the optional permission request inside the trusted click's user activation.
      request = chrome.permissions.request({ origins });
    } catch {
      report('Não foi possível ativar as fotos. Você pode tentar novamente.');
      return;
    }
    button.disabled = true;
    Promise.resolve(request).then(granted => {
      if (!granted) {
        report('Fotos desativadas. As iniciais continuam aparecendo.');
        return;
      }
      clearNegativeMemo();
      button.hidden = true;
      report('Fotos ativadas neste Chrome.');
      document.dispatchEvent(new Event('instagram-fluxo-photos-ready'));
    }).catch(() => report('Não foi possível ativar as fotos. Você pode tentar novamente.'))
      .finally(() => { button.disabled = false; });
  });
  if (button && globalThis.chrome?.permissions?.contains) {
    chrome.permissions.contains({ origins }).then(granted => {
      if (granted) {
        button.hidden = true;
        report('Fotos ativadas neste Chrome.');
      }
    }).catch(() => undefined);
  }
  globalThis.chrome?.permissions?.onRemoved?.addListener(change => {
    if (!(change?.origins ?? []).some(origin => origins.includes(origin))) return;
    if (button) button.hidden = false;
    clearNegativeMemo();
    report('O acesso às fotos foi desativado. As miniaturas já salvas continuam disponíveis.');
  });
})();
