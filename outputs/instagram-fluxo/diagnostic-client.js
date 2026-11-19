(() => {
  'use strict';
  let owner=null,runId=null;
  async function emit(input){
    const entry=instagramFluxoDiagnosticSchema.normalize({...input,owner:input.owner??owner,runId:input.runId??runId,source:'dashboard'},
      {id:crypto.randomUUID(),timestamp:Date.now(),source:'dashboard'});
    if(!entry)return;
    try{await chrome.runtime.sendMessage({type:'diagnosticAppend',entry});}catch{}
  }
  function context(value={}){owner=value.owner??null;runId=value.runId??null;}
  async function refresh(){
    const target=document.getElementById('diagnostic-status');
    try{
      const reply=await chrome.runtime.sendMessage({type:'diagnosticStatus'});
      if(!reply?.ok)throw Error();
      const state=reply.data;
      if(target)target.textContent=state.state==='ready'
        ? 'Logs automáticos em arquivo ativos. '+(state.directory??'')
        : 'Logs aguardando gravação local: '+state.pending+'. Recarregue a extensão após instalar o gravador.';
      const detail=document.getElementById('diagnostic-detail');
      if(detail)detail.textContent=state.dropped?'A fila atingiu o limite: '+state.dropped+' eventos antigos não puderam ser mantidos.':'';
      return state;
    }catch{if(target)target.textContent='Não foi possível consultar o gravador local. Reabra o painel após recarregar a extensão.';}
  }
  document.addEventListener('click',event=>{
    if(!event.isTrusted)return;
    const element=event.target.closest?.('button[id],summary[id],a[id]');
    if(element)void emit({event:element.id==='stop'?'workflow.stop':'ui.click',control:element.id});
  },true);
  document.addEventListener('change',event=>{
    const element=event.target;if(!event.isTrusted||!element?.id)return;
    // Field identity only; never read text/password/key/model/input values.
    void emit({event:'ui.change',control:element.id,...(element.type==='checkbox'?{enabled:element.checked}:{})});
  },true);
  addEventListener('error',event=>void emit({event:'runtime.error',level:'error',reason:'javascript-error',count:Number.isSafeInteger(event.lineno)?event.lineno:0}));
  addEventListener('unhandledrejection',()=>void emit({event:'runtime.rejection',level:'error',reason:'unhandled-rejection'}));
  document.addEventListener('DOMContentLoaded',()=>{
    document.getElementById('diagnostic-retry')?.addEventListener('click',async()=>{try{await chrome.runtime.sendMessage({type:'diagnosticFlush'});}catch{}await refresh();});
    void refresh();
  });
  globalThis.instagramFluxoDiagnostics=Object.freeze({emit,context,refresh});
})();
