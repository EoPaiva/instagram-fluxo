(() => {
  'use strict';

  const maxRows = 20_000;
  const maxArchiveBytes = 96 * 1024 * 1024;
  const maxFollowingBytes = 24 * 1024 * 1024;
  const followingFile = /(?:^|\/)(?:following|accounts_you_follow)(?:_\d+)?\.(?:json|html?)$/i;

  const usernameOf = value => {
    if (typeof value !== 'string') return null;
    const name = value.trim().replace(/^@/, '').toLowerCase();
    return /^(?=.*[a-z0-9_])[a-z0-9._]{1,30}$/.test(name) ? name : null;
  };

  function usernameFromLink(value) {
    try {
      const link = new URL(value);
      if (link.protocol !== 'https:' || link.username || link.password || link.port ||
          !['instagram.com', 'www.instagram.com'].includes(link.hostname)) return null;
      return usernameOf(link.pathname.match(/^\/(?:_u\/)?([^/]+)\/?$/)?.[1]);
    } catch { return null; }
  }

  const personalCategory = /^(?:criador(?:a)? (?:de conteúdo|digital)|digital creator|artista|artist|public figure|figura pública|blogger|fotógraf[oa]|photographer|personal blog|blog pessoal|entrepreneur|empresári[oa])$/i;
  const businessCategory = /^(?:empresa(?: local)?|business|local business|company|loja|shopping & retail|retail|shopping e varejo|e-commerce|comércio|restaurant|restaurante|marca|brand|product\/service|produto\/serviço|organização(?: sem fins lucrativos)?|nonprofit organization|media\/news company|news & media website|site de notícias e mídia)$/i;
  const legalSuffix = /\b(?:ltda|eireli|corporation|corp|inc|llc)\.?$/i;
  const businessName = /^(?:(?:loja|editora|prefeitura|universidade|secretaria|concessionária|restaurante|supermercado)\s+\S|(?:clínica|companhia|instituto|museu|fundação|associação)\s+(?:de\s+)?\S)/i;

  function classify({ username, label = '', category = '' }) {
    const name = usernameOf(username);
    if (!name) return null;
    const clean = value => typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, 160) : '';
    const title = clean(label);
    const badge = clean(category);
    let kind = 'unknown';
    let reason = 'Sem sinal de página ou empresa.';
    if (personalCategory.test(badge)) {
      kind = 'person'; reason = `Categoria exibida: ${badge}.`;
    } else if (businessCategory.test(badge)) {
      kind = 'business'; reason = `Categoria exibida: ${badge}.`;
    } else if (legalSuffix.test(title) || businessName.test(title)) {
      kind = 'business'; reason = 'O nome exibido indica uma organização ou empresa.';
    }
    return { username: name, label: title, kind, reason };
  }

  function collect(records, { strict = false } = {}) {
    if (records.length > maxRows) throw new Error('A lista excede o limite de 20 mil perfis por arquivo.');
    const unique = new Map();
    for (const record of records) {
      const row = classify(record);
      if (!row && strict) throw new Error('Há uma entrada que não identifica um perfil válido do Instagram.');
      if (row && (!unique.has(row.username) || unique.get(row.username).kind === 'unknown')) unique.set(row.username, row);
    }
    return [...unique.values()];
  }

  function importText(text, name) {
    if (/\.json$/i.test(name)) {
      let value;
      try { value = JSON.parse(text.replace(/^\uFEFF/, '')); }
      catch { throw new Error('O arquivo JSON de Seguindo está inválido.'); }
      if (!Array.isArray(value?.relationships_following)) throw new Error('Escolha o arquivo Seguindo da exportação do Instagram.');
      return collect(value.relationships_following.map(row => {
        const card = row?.string_list_data?.[0];
        const linkName = usernameFromLink(card?.href);
        const textName = usernameOf(card?.value) ?? usernameOf(row?.title);
        const invalidLink = card?.href && (!linkName || textName && linkName !== textName);
        return { username: invalidLink ? null : linkName ?? textName };
      }), { strict: true });
    }
    const documentTitle = /<title\b[^>]*>\s*(?:seg[uú]indo|a seguir|following|contas que você segue|accounts you follow)\s*<\/title>/i.test(text);
    if (!followingFile.test(name) || !documentTitle) throw new Error('Escolha o HTML de Seguindo da exportação do Instagram.');
    // Template content is inert and stays detached throughout the import.
    const template = document.createElement('template');
    template.innerHTML = text;
    return collect([...template.content.querySelectorAll('a[href]')].flatMap(link => {
      const username = usernameFromLink(link.getAttribute('href'));
      return username ? [{ username }] : [];
    }), { strict: true });
  }

  async function inflate(bytes, method, expected) {
    if (method === 0 && bytes.length === expected) return bytes;
    if (method !== 8) throw new Error('Compressão ZIP incompatível. Extraia o arquivo Seguindo e importe-o diretamente.');
    const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
    const result = new Uint8Array(expected);
    let position = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (position + value.length > result.length) throw new Error('O conteúdo ultrapassa o tamanho declarado no ZIP.');
        result.set(value, position);
        position += value.length;
      }
    } catch (error) {
      await reader.cancel().catch(() => undefined);
      throw error;
    } finally { reader.releaseLock(); }
    if (position !== expected) throw new Error('O conteúdo do ZIP está incompleto.');
    return result;
  }

  async function importZip(file) {
    const archive = new Uint8Array(await file.arrayBuffer());
    const view = new DataView(archive.buffer);
    const u16 = offset => view.getUint16(offset, true);
    const u32 = offset => view.getUint32(offset, true);
    const fail = () => new Error('O ZIP está incompleto ou usa um formato incompatível. Extraia o arquivo Seguindo e importe-o diretamente.');
    let end = archive.length - 22;
    const earliest = Math.max(0, end - 65_535);
    while (end >= earliest && (u32(end) !== 0x06054b50 || end + 22 + u16(end + 20) !== archive.length)) end--;
    if (end < earliest || u16(end + 4) || u16(end + 6) || u16(end + 8) !== u16(end + 10)) throw fail();
    const total = u16(end + 10);
    const directory = u32(end + 16);
    const directoryEnd = directory + u32(end + 12);
    if (total === 0xffff || directoryEnd > end) throw fail();

    const decoder = new TextDecoder('utf-8', { fatal: true });
    const entries = [];
    let extracted = 0;
    for (let index = 0, offset = directory; index < total; index++) {
      if (offset + 46 > directoryEnd || u32(offset) !== 0x02014b50) throw fail();
      const nameLength = u16(offset + 28);
      const next = offset + 46 + nameLength + u16(offset + 30) + u16(offset + 32);
      if (next > directoryEnd) throw fail();
      const name = new TextDecoder().decode(archive.subarray(offset + 46, offset + 46 + nameLength));
      if (followingFile.test(name)) {
        const size = u32(offset + 24);
        const packed = u32(offset + 20);
        const local = u32(offset + 42);
        const method = u16(offset + 10);
        if ((u16(offset + 8) & 1) || local + 30 > directory || u32(local) !== 0x04034b50 || u16(local + 8) !== method) throw fail();
        const data = local + 30 + u16(local + 26) + u16(local + 28);
        extracted += size;
        if (data + packed > directory || extracted > maxFollowingBytes || entries.length >= 100) throw fail();
        const body = await inflate(archive.subarray(data, data + packed), method, size);
        entries.push(importText(decoder.decode(body), name));
      }
      offset = next;
    }
    if (!entries.length) throw new Error('O ZIP não contém um arquivo Seguindo do Instagram.');
    const rows = new Map();
    for (const entry of entries) for (const row of entry) rows.set(row.username, row);
    if (rows.size > maxRows) throw new Error('A lista excede o limite de 20 mil perfis.');
    return [...rows.values()];
  }

  async function importFile(file) {
    if (!file || !file.size) throw new Error('Escolha o arquivo da exportação do Instagram.');
    const zip = /\.zip$/i.test(file.name);
    if (file.size > (zip ? maxArchiveBytes : maxFollowingBytes)) throw new Error('Arquivo muito grande. Importe somente o arquivo Seguindo.');
    const rows = zip ? await importZip(file) : importText(await file.text(), file.name);
    return { rows, expectedCount: rows.length, complete: true, source: 'archive' };
  }

  function sleep(ms, signal) {
    signal?.throwIfAborted();
    return new Promise((resolve, reject) => {
      const abort = () => { clearTimeout(timer); reject(signal.reason); };
      const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, ms);
      signal?.addEventListener('abort', abort, { once: true });
    });
  }

  async function scan(tabId, rawOwner, { signal, onPage = async () => {} } = {}) {
    const owner = usernameOf(rawOwner);
    if (!owner || !Number.isInteger(tabId)) throw new Error('Carregue seu próprio perfil para ler a lista Seguindo.');
    return globalThis.instagramFlow.exclusive(owner, async () => {
      signal?.throwIfAborted();
      const profile = await globalThis.instagramFlow.readOwnProfile(tabId);
      if (usernameOf(profile?.username) !== owner) throw new Error('A conta conectada mudou.');
      const target = { tabId };
      await chrome.scripting.executeScript({ target, files: ['assisted-unfollow.js'] });
      const [opening] = await chrome.scripting.executeScript({ target, args: [owner], func: async name => {
        try {
          return { data: await globalThis.instagramFlowAssistedUnfollow.open(name, undefined, { allowUnknownTotal: true }) };
        } catch (error) { return { error: error.message, code: error.code }; }
      } });
      const read = result => {
        if (!result?.result || result.result.error) {
          const error = new Error(result?.result?.error ?? 'Não foi possível ler a lista Seguindo.');
          error.code = result?.result?.code;
          throw error;
        }
        return result.result.data;
      };
      const opened = read(opening);
      const unique = new Map();
      const unsaved = new Map();
      let expectedCount = Number.isSafeInteger(opened.total) ? opened.total : null;
      let stableCount = true;
      let atEnd = expectedCount === 0;
      let settledSince = 0;
      let stalledSince = 0;
      let lastSavedAt = performance.now();
      const result = complete => ({ rows: [...unique.values()], expectedCount, complete, source: 'scan' });
      const persist = async () => {
        if (unsaved.size === 0) return;
        await onPage({ ...result(false), rows: [...unsaved.values()], observed: unique.size });
        unsaved.clear();
        lastSavedAt = performance.now();
      };

      try {
        for (let step = 0; !atEnd && step < 1600; step++) {
          signal?.throwIfAborted();
          const [reading] = await chrome.scripting.executeScript({ target, args: [owner, step === 0, step > 0], func: (name, reset, advance) => {
            try { return { data: globalThis.instagramFlowAssistedUnfollow.inventoryPage(name, { reset, advance }) }; }
            catch (error) { return { error: error.message, code: error.code }; }
          } });
          const page = read(reading);
          if (page.expectedCount !== expectedCount) stableCount = false;
          const before = unique.size;
          for (const raw of page.rows) {
            const row = classify(raw);
            if (!row || row.username === owner || unique.has(row.username)) continue;
            unique.set(row.username, row);
            unsaved.set(row.username, row);
            if (unique.size > maxRows) throw new Error('A lista excede o limite de 20 mil perfis.');
          }
          const now = performance.now();
          if (unsaved.size >= 100 || now - lastSavedAt >= 2000) await persist();
          if (page.atBottom && !page.loading && !page.unidentified) {
            settledSince ||= now;
            const settledFor = now - settledSince;
            atEnd = expectedCount === unique.size ? settledFor >= 400 : settledFor >= 6500;
          } else settledSince = 0;
          if (page.atBottom && unique.size === before) stalledSince ||= now;
          else stalledSince = 0;
          if (stalledSince && now - stalledSince >= 15000) break;
          if (!atEnd) await sleep(230, signal);
        }
        signal?.throwIfAborted();
        return result(atEnd && stableCount && expectedCount === unique.size);
      } finally { await persist(); }
    });
  }

  globalThis.instagramFluxoInventory = Object.freeze({ scan, importFile });
})();
