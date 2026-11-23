'use strict';

const queueNotifications = (() => {
  const key = 'instagramFluxoQueueNotifications:v1';
  const permission = { permissions: ['notifications'] };
  const maxDeliveries = 256;
  const text = {
    completed: 'Fila concluída. Veja os resultados no painel da extensão.',
    attention: 'Há uma ação para conferir. Consulte o painel da extensão.',
  };
  let serial = Promise.resolve();

  function serialize(task) {
    const operation = serial.then(task);
    serial = operation.catch(() => {});
    return operation;
  }

  async function read() {
    const stored = (await chrome.storage.local.get(key))[key];
    return { enabled: stored?.enabled === true, delivered: Array.isArray(stored?.delivered) ? stored.delivered : [] };
  }

  function save(state) {
    return chrome.storage.local.set({ [key]: state });
  }

  async function hasPermission() {
    return Boolean(await chrome.permissions?.contains?.(permission));
  }

  function handle(message) {
    return serialize(async () => {
      const state = await read();
      let allowed = await hasPermission();
      if (message.type === 'notificationSettingsSave') {
        if (typeof message.enabled !== 'boolean') throw new Error('Configuração de notificações inválida.');
        if (message.enabled && !allowed) throw new Error('Autorize as notificações no Chrome para ativar os avisos.');
        state.enabled = message.enabled;
        await save(state);
        if (!state.enabled && allowed && chrome.permissions?.remove) {
          const removed = await chrome.permissions.remove(permission).catch(() => false);
          if (removed) allowed = false;
        }
      } else if (message.type !== 'notificationSettingsRead') {
        throw new Error('Ação de notificações desconhecida.');
      }
      return { enabled: state.enabled, permission: allowed };
    });
  }

  async function notify({ runId, status } = {}) {
    if (typeof runId !== 'string' || !/^[a-zA-Z0-9_-]{1,120}$/.test(runId) ||
        typeof status !== 'string' || !Object.hasOwn(text, status)) return false;
    if (!chrome.notifications?.create) return false;
    return serialize(async () => {
      const state = await read();
      const deliveryId = `${status}-${runId}`;
      if (!state.enabled || state.delivered.includes(deliveryId) || !await hasPermission()) return false;
      if (await chrome.notifications.getPermissionLevel?.() === 'denied') return false;

      // Reserve delivery before calling the native API so a worker restart
      // cannot show a second notification for the same saved result.
      await save({ ...state, delivered: [...state.delivered.slice(-(maxDeliveries - 1)), deliveryId] });
      try {
        await chrome.notifications.create(`instagram-fluxo-queue-${deliveryId}`, {
          type: 'basic',
          iconUrl: chrome.runtime.getURL('icons/upaiva-192.png'),
          title: 'Instagram Fluxo',
          message: text[status],
        });
        return true;
      } catch {
        await save(state);
        return false;
      }
    });
  }

  return { handle, notify };
})();
