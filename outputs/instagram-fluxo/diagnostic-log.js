'use strict';

// Future diagnostic events only. Never read workflow history, vault or old UI logs.
const diagnosticLog = (() => {
  const nativeHostName = 'dev.upaiva.instagram_fluxo.logs';
  const storageKey = 'instagramFluxoDiagnosticOutbox:v1';
  const maxPending = 20000;
  const retryAlarm = 'instagram-fluxo-diagnostics-retry';
  let serial=Promise.resolve(), sending=null, requested=false, closedAt=0;
  let retryDelay=30000;
  function serialized(callback){const next=serial.then(callback,callback);serial=next.catch(()=>{});return next;}
  async function read(){
    const saved=(await chrome.storage.local.get(storageKey))[storageKey];
    if(!saved)return{version:1,events:[],dropped:0,lastDeliveredAt:null,lastError:null,directory:null,file:null};
    if(saved.version!==1||!Array.isArray(saved.events))throw Error('diagnostic-state-invalid');
    return saved;
  }
  const save=value=>chrome.storage.local.set({[storageKey]:value});
  function view(value){return{state:value.lastError?(value.events.length?'buffered':'unavailable'):value.lastDeliveredAt?'ready':value.events.length?'buffered':'unavailable',
    pending:value.events.length,dropped:value.dropped??0,lastDeliveredAt:value.lastDeliveredAt??null,lastError:value.lastError??null,directory:value.directory??null,file:value.file??null};}
  async function emit(input){
    const event=instagramFluxoDiagnosticSchema.normalize(input,{id:crypto.randomUUID(),timestamp:Date.now()});
    if(!event)return{queued:false,reason:'event-rejected'};
    try{
      // Schedule a durable retry before committing events. A terminated worker
      // can therefore leave at most its own in-flight, uncommitted event behind.
      if(chrome.alarms?.get && !(await chrome.alarms.get(retryAlarm))) {
        await chrome.alarms.create(retryAlarm,{delayInMinutes:0.5});
      }
      await serialized(async()=>{
        const state=await read();
        if(state.events.length>=maxPending){state.events.shift();state.dropped=(state.dropped??0)+1;state.gapPending=(state.gapPending??0)+1;}
        state.events.push(event);await save(state);
      });
      void flush().catch(()=>{});return{queued:true,id:event.id};
    }catch{return{queued:false,reason:'diagnostic-storage-failed'};}
  }
  function request(type,events=[]){
    return new Promise((resolve,reject)=>{
      let port;
      try{port=chrome.runtime.connectNative(nativeHostName);}catch{return reject(Error('native-host-unavailable'));}
      const requestId=crypto.randomUUID();let settled=false;
      const timer=setTimeout(()=>finish(Error('native-host-timeout')),6000);
      function finish(error,value){if(settled)return;settled=true;clearTimeout(timer);try{port.disconnect();}catch{}error?reject(error):resolve(value);}
      port.onMessage.addListener(reply=>{
        if(reply?.protocol!==1||reply.requestId!==requestId||reply.ok!==true)return finish(Error('native-ack-invalid'));
        if(type==='append'){
          const expected=new Set(events.map(event=>event.id));
          if(!Array.isArray(reply.acceptedIds)||reply.acceptedIds.length!==expected.size||reply.acceptedIds.some(id=>!expected.delete(id))||expected.size)return finish(Error('native-ack-invalid'));
        }
        finish(null,reply);
      });
      port.onDisconnect.addListener(()=>{
        // Read lastError to consume Chrome's diagnostic; never persist its raw text.
        void chrome.runtime.lastError;
        finish(Error('native-host-disconnected'));
      });
      try{port.postMessage({protocol:1,type,requestId,...(type==='append'?{events}: {})});}catch{finish(Error('native-host-write-failed'));}
    });
  }
  async function flush({force=false}={}){
    if(sending){requested=true;return sending;}
    if(!force&&Date.now()<closedAt)return status();
    sending=(async()=>{
      try{
        while(true){
          const state=await serialized(read);
          if(!state.events.length&&!state.gapPending)break;
          if(state.gapPending){await serialized(async()=>{const current=await read();const gap=instagramFluxoDiagnosticSchema.normalize({event:'diagnostics.gap',source:'worker',level:'warn',count:current.gapPending,reason:'outbox-limit'},{id:crypto.randomUUID(),timestamp:Date.now()});current.gapPending=0;current.events.unshift(gap);await save(current);});continue;}
          const batch=state.events.slice(0,48);
          const reply=await request('append',batch);
          const ids=new Set(batch.map(event=>event.id));
          await serialized(async()=>{const current=await read();current.events=current.events.filter(event=>!ids.has(event.id));current.lastDeliveredAt=Date.now();current.lastError=null;
            current.directory=typeof reply.directory==='string'?reply.directory.slice(0,1024):null;current.file=typeof reply.file==='string'?reply.file.slice(0,180):null;await save(current);});
          retryDelay=30000;closedAt=0;
        }
      }catch(error){
        closedAt=Date.now()+retryDelay;retryDelay=Math.min(retryDelay*2,300000);
        await serialized(async()=>{const state=await read();state.lastError=['native-host-timeout','native-ack-invalid','native-host-disconnected','native-host-write-failed'].includes(error?.message)?error.message:'native-host-unavailable';await save(state);}).catch(()=>{});
        await chrome.alarms?.create?.(retryAlarm,{when:closedAt}).catch(()=>{});
      }
      return serialized(async()=>view(await read()));
    })().finally(()=>{
      sending=null;
      if(requested){requested=false;void flush().catch(()=>{});}
    });
    return sending;
  }
  async function status({probe=false}={}){
    if(probe){
      const before=await serialized(read);
      if(before.events.length)return flush({force:true});
      try{const reply=await request('status');await serialized(async()=>{const value=await read();value.lastError=null;value.lastDeliveredAt=Date.now();value.directory=typeof reply.directory==='string'?reply.directory.slice(0,1024):null;value.file=typeof reply.file==='string'?reply.file.slice(0,180):null;await save(value);});}
      catch{await serialized(async()=>{const value=await read();value.lastError='native-host-unavailable';await save(value);}).catch(()=>{});}
    }
    return serialized(async()=>view(await read()));
  }
  chrome.alarms?.onAlarm?.addListener(alarm=>{
    if(alarm.name===retryAlarm)void flush({force:true}).catch(()=>{});
  });
  return Object.freeze({emit,flush,status});
})();
