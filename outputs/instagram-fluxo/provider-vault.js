'use strict';

const providerVault = (() => {
  const vaultKey = 'instagramFluxoProviderVault';
  const sessionKey = 'instagramFluxoProviderVaultUnlock';
  const legacyKey = 'instagramFluxoSettings';
  const version = 1;
  const iterations = 600000;
  const encoder = new TextEncoder();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const purpose = encoder.encode('Instagram Fluxo: provider vault v1');
  const encode = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes)));
  const decode = value => Uint8Array.from(atob(value), char => char.charCodeAt(0));
  const emptySettings = () => ({ provider: 'openai', keys: {} });

  async function getEnvelope() {
    const { [vaultKey]: envelope } = await chrome.storage.local.get(vaultKey);
    if (envelope === undefined) return null;
    if (envelope?.version !== version || typeof envelope.salt !== 'string' || envelope.salt.length !== 24 ||
        typeof envelope.iv !== 'string' || envelope.iv.length !== 16 ||
        typeof envelope.ciphertext !== 'string' || envelope.ciphertext.length > 16384) {
      throw new Error('O cofre local está em um formato inválido ou incompatível.');
    }
    return envelope;
  }

  async function derive(password, salt) {
    const material = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: decode(salt), iterations, hash: 'SHA-256' }, material, 256);
    return encode(bits);
  }

  function importKey(rawKey, operation) {
    return crypto.subtle.importKey('raw', decode(rawKey), 'AES-GCM', false, [operation]);
  }

  async function decrypt(envelope, rawKey) {
    const key = await importKey(rawKey, 'decrypt');
    const bytes = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decode(envelope.iv), additionalData: purpose },
      key, decode(envelope.ciphertext));
    return validateVaultSettings(JSON.parse(decoder.decode(bytes)));
  }

  async function write(salt, rawKey, settings) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await importKey(rawKey, 'encrypt');
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: purpose },
      key, encoder.encode(JSON.stringify(settings)));
    await chrome.storage.local.set({ [vaultKey]: { version, salt, iv: encode(iv), ciphertext: encode(ciphertext) } });
  }

  async function read() {
    const envelope = await getEnvelope();
    if (!envelope) return { vault: 'missing', settings: emptySettings() };
    const { [sessionKey]: unlock } = await chrome.storage.session.get(sessionKey);
    if (unlock?.salt !== envelope.salt || typeof unlock?.rawKey !== 'string') {
      return { vault: 'locked', settings: emptySettings() };
    }
    try {
      return { vault: 'unlocked', settings: await decrypt(envelope, unlock.rawKey), unlock };
    } catch {
      throw new Error('Não foi possível ler o cofre. Bloqueie e tente desbloquear novamente.');
    }
  }

  async function open(password, create) {
    if (typeof create !== 'boolean' || typeof password !== 'string' || !password.length || password.length > 256) {
      throw new Error('Informe uma senha válida para o cofre.');
    }
    const envelope = await getEnvelope();
    if (create && envelope) throw new Error('Já existe um cofre local. Desbloqueie com a senha existente.');
    if (!create && !envelope) throw new Error('Crie um cofre local primeiro.');
    if (create && password.trim().length < 12) throw new Error('Crie uma senha com pelo menos 12 caracteres.');

    const salt = envelope?.salt ?? encode(crypto.getRandomValues(new Uint8Array(16)));
    let rawKey;
    let settings;
    if (envelope) {
      try {
        rawKey = await derive(password, salt);
        settings = await decrypt(envelope, rawKey);
      } catch {
        throw new Error('Senha incorreta ou cofre inválido.');
      }
    } else {
      rawKey = await derive(password, salt);
      const { [legacyKey]: previous } = await chrome.storage.session.get(legacyKey);
      settings = validateVaultSettings(previous ?? emptySettings());
      await write(salt, rawKey, settings);
    }
    await chrome.storage.session.set({ [sessionKey]: { salt, rawKey } });
    await chrome.storage.session.remove(legacyKey);
    return { vault: 'unlocked', settings };
  }

  async function save({ unlock }, settings) {
    await write(unlock.salt, unlock.rawKey, settings);
  }

  async function lock() {
    await chrome.storage.session.remove(sessionKey);
    return read();
  }

  return { read, open, save, lock };
})();
