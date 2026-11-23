'use strict';

globalThis.instagramFluxoBackupPanel = (() => {
  const maxFileBytes = 24 * 1024 * 1024;
  const count = new Intl.NumberFormat('pt-BR');
  const size = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });
  const date = new Intl.DateTimeFormat('pt-BR', { dateStyle:'medium', timeStyle:'short' });
  const storageLabels = {
    history:'Histórico de ações', queue:'Filas e listas', cleaner:'Lista branca e Limpa Perfil',
    photos:'Miniaturas', logs:'Logs à espera de gravação', legacy:'Base anterior', other:'Outros dados da extensão',
  };

  async function rpc(type, params = {}) {
    const reply = await chrome.runtime.sendMessage({ type, ...params });
    if (!reply?.ok) throw new Error(reply?.error || 'A base local não respondeu.');
    return reply.data;
  }

  function formatBytes(bytes) {
    if (bytes < 1024) return `${count.format(bytes)} B`;
    if (bytes < 1024 * 1024) return `${size.format(bytes / 1024)} KiB`;
    return `${size.format(bytes / (1024 * 1024))} MiB`;
  }

  async function writeBackup(folder, filename, blob) {
    const handle = await folder.getFileHandle(filename, { create:true });
    const writer = await handle.createWritable();
    try {
      await writer.write(blob);
      await writer.close();
    } catch (error) {
      await writer.abort().catch(() => {});
      throw error;
    }
  }

  function downloadBackup(filename, blob) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  function create({ getOwner, isBusy, onApplied }) {
    const byId = name => document.getElementById(name);
    const save = byId('backup-save');
    const choose = byId('backup-choose');
    const input = byId('backup-file');
    const status = byId('backup-status');
    const dialog = byId('backup-dialog');
    const overview = byId('backup-preview');
    const apply = byId('backup-apply');
    const storage = byId('storage-refresh');
    const totals = byId('storage-totals');
    const storageStatus = byId('storage-status');
    let pending = false;
    let selection;
    let fileOwner;

    function sync() {
      const disabled = pending || isBusy() || !getOwner();
      save.disabled = disabled;
      choose.disabled = disabled;
      apply.disabled = disabled || selection?.owner !== getOwner();
    }

    async function operate(action) {
      pending = true;
      status.textContent = '';
      sync();
      try { await action(); }
      catch (error) { status.textContent = error.name === 'AbortError' ? 'Operação cancelada.' : error.message; }
      finally { pending = false; sync(); }
    }

    save.addEventListener('click', event => {
      if (!event.isTrusted || save.disabled) return;
      const owner = getOwner();
      void operate(async () => {
        const folder = typeof globalThis.showDirectoryPicker === 'function'
          ? await globalThis.showDirectoryPicker({ mode:'readwrite' }) : null;
        if (owner !== getOwner() || isBusy()) throw new Error('A conta ou a operação do painel mudou. Tente de novo.');
        const backup = await rpc('backupExport', { owner });
        const blob = new Blob([JSON.stringify(backup)], { type:'application/json' });
        if (blob.size > maxFileBytes) throw new Error('A cópia excede o limite de 24 MiB para restauração.');
        const filename = `instagram-fluxo-${owner}-${new Date().toISOString().slice(0, 10)}-${crypto.randomUUID().slice(0, 8)}.json`;
        if (folder) await writeBackup(folder, filename, blob);
        else downloadBackup(filename, blob);
        status.textContent = `Backup de @${owner} salvo. ${filename}`;
      });
    });

    choose.addEventListener('click', event => {
      if (!event.isTrusted || choose.disabled) return;
      fileOwner = getOwner();
      input.click();
    });
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      input.value = '';
      const owner = fileOwner;
      fileOwner = undefined;
      if (!owner || owner !== getOwner() || choose.disabled || !file) return;
      void operate(async () => {
        if (file.size > maxFileBytes) throw new Error('O arquivo excede o limite de 24 MiB.');
        let backup;
        try { backup = JSON.parse(await file.text()); }
        catch { throw new Error('O arquivo não é um backup JSON válido.'); }
        const result = await rpc('backupPreview', { owner, backup });
        if (owner !== getOwner() || isBusy()) throw new Error('Carregue a conta do arquivo antes de restaurá-lo.');
        selection = { owner, backup };
        const items = [`${count.format(result.historyCount)} itens de histórico`, `${count.format(result.whitelistCount)} perfis protegidos`,
          `${count.format(result.runCount)} filas salvas`];
        if (result.hasCleanerJob) items.push('1 lote do Limpa Perfil');
        overview.textContent = `@${owner} · ${date.format(result.exportedAt)}. ${items.join(' · ')}.`;
        dialog.showModal();
      });
    });
    byId('backup-cancel').addEventListener('click', () => dialog.close());
    dialog.addEventListener('close', () => { selection = undefined; sync(); });
    apply.addEventListener('click', event => {
      if (!event.isTrusted || apply.disabled || !selection || !dialog.open) return;
      const { owner, backup } = selection;
      selection = undefined;
      dialog.close();
      void operate(async () => {
        await rpc('backupRestore', { owner, backup });
        status.textContent = `Backup de @${owner} incorporado à base local.`;
        await onApplied();
      });
    });

    storage.addEventListener('click', async event => {
      if (!event.isTrusted || storage.disabled) return;
      storage.disabled = true;
      storageStatus.textContent = 'Medindo os dados da extensão…';
      try {
        const result = await rpc('storageDetails');
        const entries = [{ label:'Armazenamento local', bytes:result.all },
          ...result.byGroup.map(entry => ({ label:storageLabels[entry.id], bytes:entry.bytes }))];
        if (result.indexed !== null) entries.push({ label:'IndexedDB (estimativa)', bytes:result.indexed });
        totals.replaceChildren(...entries.flatMap(({ label, bytes }) => {
          const key = document.createElement('dt');
          const value = document.createElement('dd');
          key.textContent = label;
          value.textContent = formatBytes(bytes);
          return [key, value];
        }));
        totals.hidden = false;
        storageStatus.textContent = result.indexed === null
          ? 'O Chrome não forneceu uma estimativa separada do IndexedDB.' : 'Espaço medido neste perfil do Chrome.';
      } catch (error) {
        storageStatus.textContent = error.message;
      } finally { storage.disabled = false; }
    });

    sync();
    return { sync };
  }

  return { create };
})();
