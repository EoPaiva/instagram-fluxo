'use strict';

(() => {
  const toggle = document.getElementById('queue-notifications-toggle');
  const status = document.getElementById('queue-notifications-status');
  if (!toggle || !status) return;

  const permission = { permissions: ['notifications'] };

  async function rpc(type, payload) {
    const result = await chrome.runtime.sendMessage({ type, ...payload });
    if (!result?.ok) throw new Error('Não foi possível alterar as notificações.');
    return result.data;
  }

  function render({ enabled, permission: allowed }) {
    const active = enabled && allowed;
    toggle.setAttribute('aria-pressed', String(active));
    status.textContent = active ? 'Ativas neste navegador.' : enabled
      ? 'Desativadas. A permissão do Chrome foi removida.' : 'Desativadas.';
  }

  async function refresh() {
    if (toggle.disabled) return;
    toggle.disabled = true;
    try { render(await rpc('notificationSettingsRead')); }
    catch { status.textContent = 'Não foi possível consultar as notificações.'; }
    finally { toggle.disabled = false; }
  }

  toggle.addEventListener('click', async event => {
    if (!event.isTrusted || toggle.disabled) return;
    toggle.disabled = true;
    const enabled = toggle.getAttribute('aria-pressed') !== 'true';
    try {
      if (enabled && !await chrome.permissions.request(permission)) {
        status.textContent = 'Desativadas. Permissão não concedida.';
        return;
      }
      render(await rpc('notificationSettingsSave', { enabled }));
    } catch {
      status.textContent = 'Não foi possível alterar as notificações.';
    } finally {
      toggle.disabled = false;
    }
  });

  chrome.permissions.onRemoved?.addListener(event => {
    if (event.permissions?.includes('notifications')) void refresh();
  });

  toggle.disabled = false;
  void refresh();
})();
