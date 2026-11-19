(() => {
  'use strict';
  const events = new Set(['diagnostics.initialized','diagnostics.gap','diagnostics.retention-pruned',
    'ui.click','ui.change','workflow.start','workflow.end','workflow.detail','workflow.error','workflow.stop',
    'queue.state','action.reserved','action.recorded','action.authorized','action.rejected',
    'pacing.blocked','pacing.cleared','pacing.configured','profile.loaded','reference.saved',
    'data.snapshot','data.export','settings.changed','vault.opened','vault.locked',
    'ai.started','ai.completed','ai.fallback','rpc.failed','runtime.error','runtime.rejection',
    'extension.started','extension.updated','permission.changed','native-list.pending']);
  const actions = new Set(['follow','unfollow','discovery','profile','ai','settings','pacing','storage','diagnostics']);
  const providers = new Set(['openai','gemini','openrouter','claude']);
  const counters = ['count','target','processed','followed','requested','skipped','observed','expected',
    'queueLength','attempt','elapsedMs','waitMs','nextAt','clickBy'];
  const commonFields = ['schemaVersion','id','timestamp','source','level','event','owner','runId'];
  const eventFields = {};
  function fields(names,allowed){for(const name of names)eventFields[name]=allowed;}
  fields(['ui.click','ui.change'],['control','enabled']);
  fields(['workflow.start','workflow.end','workflow.error','workflow.stop'],['action','phase','status','reason','control','username',...counters,'interrupted']);
  fields(['workflow.detail'],['action','phase','status','reason','control','username','message',...counters]);
  fields(['queue.state'],['action','phase','status','reason','username',...counters,'interrupted']);
  fields(['action.reserved','action.recorded','action.authorized','action.rejected'],['action','username','status','reason','nextAt','clickBy','count']);
  fields(['pacing.blocked','pacing.cleared','pacing.configured'],['reason','action','nextAt','waitMs','count','enabled']);
  fields(['profile.loaded','reference.saved'],['count']);
  fields(['data.snapshot','data.export'],['action','phase','status','count','expected','observed','complete']);
  fields(['settings.changed','vault.opened','vault.locked'],['provider','status','reason','enabled']);
  fields(['ai.started','ai.completed','ai.fallback'],['provider','status','reason','elapsedMs','count']);
  fields(['rpc.failed'],['control','reason','status','elapsedMs']);
  fields(['runtime.error','runtime.rejection'],['control','reason','count']);
  fields(['extension.started','extension.updated','permission.changed'],['status','reason','enabled']);
  fields(['diagnostics.initialized','diagnostics.gap','diagnostics.retention-pruned'],['status','count','reason']);
  fields(['native-list.pending'],['count','expected','observed','reason','phase']);
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const handle = /^(?!\.{1,2}$)[a-z0-9._]{1,30}$/i;
  function scrubText(input) {
    if (typeof input !== 'string') return '';
    return input.slice(0,6000)
      .replace(/(?:https?|chrome-extension|file):\/\/[^\s<>"']+/gi,'[endereço omitido]')
      .replace(/\b(?:sk-(?:proj-|ant-|or-)?[a-z0-9_-]{6,}|AIza[a-z0-9_-]{12,})\b/gi,'[chave removida]')
      .replace(/\bauthorization\s*[:=]\s*[^\r\n,;]+/gi,'[autorização removida]')
      .replace(/\bbearer\s+[^\s,;]+/gi,'[autorização removida]')
      .replace(/\beyJ[a-z0-9_-]+\.[a-z0-9_-]+\.[a-z0-9_-]+\b/gi,'[token removido]')
      .replace(/\b(?:gh[pousr]_[a-z0-9_]+|github_pat_[a-z0-9_]+|xox[baprs]-[a-z0-9-]+|AKIA[A-Z0-9]{12,})\b/gi,'[token removido]')
      .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?(?:-----END [^-]*PRIVATE KEY-----|$)/gi,'[chave privada removida]')
      .replace(/\b(?:api[_ -]?key|password|senha|secret|cookie|token)\s*[=:]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,'[segredo removido]')
      .replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,500);
  }
  function slug(value) {
    return typeof value==='string' && /^[a-z][a-z0-9_.-]{0,63}$/i.test(value) && scrubText(value)===value ? value : undefined;
  }
  function normalize(input, {id, timestamp, source} = {}) {
    if (!input || typeof input!=='object' || Array.isArray(input) || !events.has(input.event)) return null;
    const eventId = id ?? input.id;
    const at = timestamp ?? input.timestamp;
    if (!uuid.test(eventId??'') || !Number.isSafeInteger(at) || at<0) return null;
    const result = {schemaVersion:1,id:eventId,timestamp:at,
      source:['dashboard','worker','instagram'].includes(source??input.source)?source??input.source:'worker',
      level:['info','warn','error'].includes(input.level)?input.level:'info',event:input.event};
    for (const key of ['owner','username']) if (typeof input[key]==='string' && handle.test(input[key]) && scrubText(input[key])===input[key]) result[key]=input[key].toLowerCase();
    if (typeof input.runId==='string' && uuid.test(input.runId)) result.runId=input.runId;
    if (actions.has(input.action)) result.action=input.action;
    if (providers.has(input.provider)) result.provider=input.provider;
    for (const key of ['phase','status','reason','control']) {const value=slug(input[key]);if(value)result[key]=value;}
    if (typeof input.message==='string') result.message=scrubText(input.message);
    for (const key of counters) if (Number.isSafeInteger(input[key]) && input[key]>=0) result[key]=input[key];
    for (const key of ['complete','enabled','interrupted']) if(typeof input[key]==='boolean')result[key]=input[key];
    const allowed=new Set([...commonFields,...eventFields[input.event]]);
    return Object.fromEntries(Object.entries(result).filter(([key])=>allowed.has(key)));
  }
  globalThis.instagramFluxoDiagnosticSchema = Object.freeze({normalize,scrubText,events:Object.freeze([...events]),counters:Object.freeze(counters),commonFields,eventFields});
})();
