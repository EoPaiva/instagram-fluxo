'use strict';

// Permission-based CDN reads, separate from the relationship-action state queue.
// Only previously observed candidate URLs may be fetched. No Instagram cookies.
const profilePhotos = (() => {
  const storageKey = 'instagramFluxoPhotoCache:v1';
  const maxInput = 128 * 1024;
  const maxDataUrl = 32768;
  const maxEntries = 500;
  const maxStoredBytes = 16 * 1024 * 1024;
  const inflight = new Map();
  const failures = new Map();
  let cacheQueue = Promise.resolve();
  let active = 0;
  const waiting = [];

  function urlOf(value) {
    if (typeof value !== 'string' || value.length > 2048 || /[\u0000-\u0020\u007f\\]/.test(value)) return null;
    try {
      const url = new URL(value);
      const allowed = ['cdninstagram.com','fbcdn.net'].some(host => url.hostname === host || url.hostname.endsWith('.' + host));
      return url.protocol === 'https:' && !url.username && !url.password && !url.port && allowed && url.href.length <= 2048 ? url : null;
    } catch { return null; }
  }

  function dataUrlOf(value) {
    return typeof value === 'string' && value.length <= maxDataUrl && /^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(value);
  }

  function serializeCache(task) {
    const operation = cacheQueue.then(task);
    cacheQueue = operation.catch(() => undefined);
    return operation;
  }

  async function entries() {
    const stored = (await chrome.storage.local.get(storageKey))[storageKey];
    if (stored === undefined) return [];
    if (stored?.schemaVersion !== 1 || !Array.isArray(stored.entries) || stored.entries.length > maxEntries) throw new Error('Invalid photo cache');
    return stored.entries.filter(row => row && typeof row.owner === 'string' && typeof row.username === 'string' &&
      typeof row.source === 'string' && dataUrlOf(row.dataUrl) && Number.isSafeInteger(row.at));
  }

  async function cached(key) {
    return serializeCache(async () => (await entries()).find(row => row.key === key)?.dataUrl ?? null);
  }

  async function save(row) {
    await serializeCache(async () => {
      const rows = (await entries()).filter(item => !(item.owner === row.owner && item.username === row.username));
      rows.push(row);
      let size = rows.reduce((sum,item) => sum + JSON.stringify(item).length * 2,0);
      while (rows.length > maxEntries || size > maxStoredBytes) size -= JSON.stringify(rows.shift()).length * 2;
      await chrome.storage.local.set({[storageKey]:{schemaVersion:1,entries:rows}});
    });
  }

  async function limited(task) {
    if (active >= 2) {
      if (waiting.length >= 16) return {status:'unavailable'};
      await new Promise(resolve => waiting.push(resolve));
    } else active += 1;
    try { return await task(); }
    finally { const next=waiting.shift(); if(next)next();else active-=1; }
  }

  async function allowed(url) {
    return chrome.permissions.contains({origins:[url.origin + '/*']});
  }

  async function sourceMatches(owner, username, source, lookup) {
    const candidate = await lookup(owner,username);
    return urlOf(candidate?.avatarUrl)?.href === source;
  }

  function dimensions(bytes,type) {
    const word = offset => bytes[offset]*256+bytes[offset+1];
    if(type==='image/png' && bytes.length>=24) {
      const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
      return [view.getUint32(16),view.getUint32(20)];
    }
    if(type==='image/jpeg') {
      let position=2;
      while(position+3<bytes.length) {
        if(bytes[position++]!==255)return null;
        while(bytes[position]===255)position++;
        const marker=bytes[position++];
        if(marker===218||marker===217)return null;
        if(marker===1||marker>=208&&marker<=216)continue;
        const length=word(position);
        if(length<2||position+length>bytes.length)return null;
        if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)) {
          return length>=8?[word(position+5),word(position+3)]:null;
        }
        position+=length;
      }
    }
    if(type==='image/webp' && bytes.length>=30) {
      const tag=String.fromCharCode(...bytes.subarray(12,16));
      if(tag==='VP8X')return [1+bytes[24]+bytes[25]*256+bytes[26]*65536,1+bytes[27]+bytes[28]*256+bytes[29]*65536];
      if(tag==='VP8 '&&bytes[23]===157&&bytes[24]===1&&bytes[25]===42)return [(bytes[26]+bytes[27]*256)&16383,(bytes[28]+bytes[29]*256)&16383];
      if(tag==='VP8L'&&bytes[20]===47)return [1+bytes[21]+((bytes[22]&63)<<8),1+(bytes[22]>>6)+(bytes[23]<<2)+((bytes[24]&15)<<10)];
    }
    return null;
  }

  async function miniature(url) {
    if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas !== 'function') throw new Error('Image decoding unavailable');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(),8000);
    try {
      const response = await fetch(url.href,{method:'GET',credentials:'omit',redirect:'error',referrerPolicy:'no-referrer',
        cache:'force-cache',signal:controller.signal});
      const type = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      if (!response.ok || !['image/jpeg','image/png','image/webp'].includes(type) ||
          Number(response.headers.get('content-length')) > maxInput || !response.body) throw new Error('Image rejected');
      const reader = response.body.getReader(), chunks = [];
      let length = 0;
      try {
        while (true) {
          const {done,value} = await reader.read();
          if (done) break;
          length += value.byteLength;
          if (length > maxInput) { controller.abort(); throw new Error('Image too large'); }
          chunks.push(value);
        }
      } finally { reader.releaseLock(); }
      const bytes = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk,offset); offset += chunk.byteLength; }
      const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
      const png = bytes.length >= 8 && [137,80,78,71,13,10,26,10].every((n,i)=>bytes[i] === n);
      const webp = bytes.length >= 12 && [82,73,70,70].every((n,i)=>bytes[i] === n) && [87,69,66,80].every((n,i)=>bytes[i+8] === n);
      if (!(type === 'image/jpeg' && jpeg || type === 'image/png' && png || type === 'image/webp' && webp)) throw new Error('Image signature rejected');
      const bounds=dimensions(bytes,type);
      if(!bounds||bounds.some(n=>!Number.isSafeInteger(n)||n<=0||n>4096)||bounds[0]*bounds[1]>4*1024*1024)throw new Error('Image dimensions rejected');
      const bitmap = await createImageBitmap(new Blob([bytes],{type}));
      try {
        if (!bitmap.width || !bitmap.height || bitmap.width > 4096 || bitmap.height > 4096) throw new Error('Image dimensions rejected');
        const canvas = new OffscreenCanvas(96,96), context = canvas.getContext('2d');
        if (!context) throw new Error('Image rendering unavailable');
        const edge = Math.min(bitmap.width,bitmap.height);
        context.drawImage(bitmap,(bitmap.width-edge)/2,(bitmap.height-edge)/2,edge,edge,0,0,96,96);
        const output = await canvas.convertToBlob({type:'image/jpeg',quality:.82});
        if (output.type !== 'image/jpeg' || output.size > 24000) throw new Error('Thumbnail too large');
        const encoded = new Uint8Array(await output.arrayBuffer());
        let binary = '';
        for (let i=0;i<encoded.length;i+=1024) binary += String.fromCharCode(...encoded.subarray(i,i+1024));
        const result = 'data:image/jpeg;base64,' + btoa(binary);
        if (!dataUrlOf(result)) throw new Error('Thumbnail rejected');
        return result;
      } finally { bitmap.close(); }
    } finally { clearTimeout(timer); controller.abort(); }
  }

  async function get(message, lookup) {
    const owner = requireUsername(message.owner), username = requireUsername(message.username);
    const url = urlOf(message.avatarUrl);
    if (!url || !(await sourceMatches(owner,username,url.href,lookup))) return {status:'unavailable'};
    const source = await crypto.subtle.digest('SHA-256',new TextEncoder().encode(url.href));
    const hash = Array.from(new Uint8Array(source),byte=>byte.toString(16).padStart(2,'0')).join('');
    const key = owner + '|' + username + '|' + hash;
    const existing = await cached(key);
    if (existing) return {status:'ready',dataUrl:existing};
    if (!(await allowed(url))) return {status:'permission-required'};
    if ((failures.get(key) ?? 0) > Date.now()) return {status:'unavailable'};
    if (inflight.has(key)) return inflight.get(key);
    const operation = limited(async () => {
      try {
        if (!(await allowed(url)) || !(await sourceMatches(owner,username,url.href,lookup))) return {status:'unavailable'};
        const dataUrl = await miniature(url);
        if (!(await allowed(url)) || !(await sourceMatches(owner,username,url.href,lookup))) return {status:'unavailable'};
        await save({key,owner,username,source:hash,dataUrl,at:Date.now()});
        return {status:'ready',dataUrl};
      } catch {
        if (failures.size >= 500) failures.delete(failures.keys().next().value);
        failures.set(key,Date.now()+10*60000);
        return {status:'unavailable'};
      }
    }).finally(()=>inflight.delete(key));
    inflight.set(key,operation);
    return operation;
  }

  return {get};
})();
