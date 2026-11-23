import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { after, afterEach, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createContext, runInContext } from 'node:vm';
import { delay, http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

const extension = resolve(process.env.FLUXO_EXTENSION_DIR ?? fileURLToPath(new URL('../../instagram-fluxo/', import.meta.url)));
const providerUrls = {
  openai: 'https://api.openai.com/v1/chat/completions',
  gemini: 'https://generativelanguage.googleapis.com/v1beta/models/:model',
  openrouter: 'https://openrouter.ai/api/v1/chat/completions',
  claude: 'https://api.anthropic.com/v1/messages',
};
const profile = { username: 'conta_ficticia', bio: 'Engenharia de dados' };
const metaToken = 'fixture-meta-token';
const metaMetrics = ['reach', 'views', 'accounts_engaged', 'total_interactions'];
const metaUrl = 'https://graph.instagram.com/:version/17841400000000001/insights';
const server = setupServer();

before(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
after(() => server.close());

const noopEvent = { addListener() {} };
const networkGlobals = {
  fetch: (...args) => globalThis.fetch(...args),
  URL, URLSearchParams, AbortController, AbortSignal, setTimeout, clearTimeout,
};

function storageArea() {
  const entries = new Map();
  return {
    async get(key) { return { [key]: structuredClone(entries.get(key)) }; },
    async set(values) {
      for (const [key, value] of Object.entries(values)) entries.set(key, structuredClone(value));
    },
    async remove(key) { entries.delete(key); },
  };
}

function runScript(context, script) {
  const path = resolve(extension, script.replace(/^\/+/, ''));
  assert(path.startsWith(extension + sep), 'Os scripts da extensão devem estar no pacote testado.');
  runInContext(readFileSync(path, 'utf8'), context, { filename: path });
}

async function makeWorker() {
  let onMessage;
  const manifest = JSON.parse(readFileSync(resolve(extension, 'manifest.json'), 'utf8'));
  const origin = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop';
  const runtime = {
    id: new URL(origin).hostname,
    getURL: path => new URL(path, origin).href,
    getManifest: () => manifest,
    onMessage: { addListener(listener) { onMessage = listener; } },
    onStartup: noopEvent,
    onInstalled: noopEvent,
  };
  const context = createContext({
    ...networkGlobals,
    TextEncoder, TextDecoder, crypto, atob, btoa,
    chrome: {
      runtime,
      action: { onClicked: noopEvent },
      permissions: {
        async contains({ origins }) { return origins.every(origin => manifest.optional_host_permissions.includes(origin)); },
        onAdded: noopEvent,
        onRemoved: noopEvent,
      },
      storage: { local: storageArea(), session: storageArea() },
    },
    importScripts: (...scripts) => scripts.forEach(script => runScript(context, script)),
  });
  context.self = context;
  runScript(context, manifest.background.service_worker);
  assert.equal(typeof onMessage, 'function');

  const sender = { id: runtime.id, url: origin + '/dashboard.html' };
  const rpc = message => new Promise(reply => {
    assert.equal(onMessage(message, sender, result => reply(structuredClone(result))), true);
  });
  const unlock = await rpc({ type: 'unlockVault', password: 'fixture-vault-password', create: true });
  assert.equal(unlock?.ok, true, unlock?.error);
  for (const provider of Object.keys(providerUrls)) {
    const configured = await rpc({ type: 'configure', provider, key: `fixture-${provider}-key` });
    assert.equal(configured?.ok, true, configured?.error);
  }
  return rpc;
}

function mockProvider(requests, provider, reply) {
  server.use(http.post(providerUrls[provider], async ({ request }) => {
    requests.push({ provider, header: request.headers.get('authorization') ?? request.headers.get('x-goog-api-key') ?? request.headers.get('x-api-key'),
      body: await request.json() });
    return reply;
  }));
}

test('Análise troca de provedor após cota esgotada e credencial recusada', async () => {
  const requests = [];
  mockProvider(requests, 'openai', HttpResponse.json({ error: { code: 'insufficient_quota' } }, { status: 429 }));
  mockProvider(requests, 'gemini', HttpResponse.json({ error: { code: 403 } }, { status: 403 }));
  mockProvider(requests, 'openrouter', HttpResponse.json({ choices: [{ message: { content: '{"niche":"Dados"}' } }] }));
  mockProvider(requests, 'claude', HttpResponse.json({ error: { code: 500 } }, { status: 500 }));

  const rpc = await makeWorker();
  assert.deepEqual(await rpc({ type: 'analyze', profile }), {
    ok: true,
    data: { niche: 'Dados', provider: 'openrouter', fallbackFrom: ['openai', 'gemini'] },
  });
  assert.deepEqual(requests.map(({ provider, header }) => [provider, header]), [
    ['openai', 'Bearer fixture-openai-key'], ['gemini', 'fixture-gemini-key'], ['openrouter', 'Bearer fixture-openrouter-key'],
  ]);
  for (const { body } of requests) {
    assert.match(JSON.stringify(body), /Engenharia de dados/);
    assert.doesNotMatch(JSON.stringify(body), /fixture-\w+-key/);
  }
});

test('Falha de rede retorna o erro de conexão sem avançar para outro provedor', async () => {
  const requests = [];
  mockProvider(requests, 'openai', HttpResponse.error());
  mockProvider(requests, 'gemini', HttpResponse.json({ error: { code: 500 } }, { status: 500 }));

  const rpc = await makeWorker();
  const reply = await rpc({ type: 'analyze', profile });
  assert.equal(reply.ok, false);
  assert.match(reply.error, /Não foi possível conectar a OpenAI/);
  assert.deepEqual(requests.map(({ provider }) => provider), ['openai']);
});

function makeInsights() {
  function element() {
    return {
      value: '', textContent: '', dataset: {}, hidden: true, handlers: {},
      addEventListener(name, listener) { this.handlers[name] = listener; },
    };
  }
  const fields = new Map(['form', 'account', 'token', 'period', 'submit', 'cancel', 'status', 'results', 'result-period']
    .map(id => [id, element()]));
  const values = new Map(metaMetrics.map(metric => [metric, element()]));
  const field = id => fields.get(id);
  field('results').querySelector = selector => values.get(/^\[data-metric="([^"]+)"\]$/.exec(selector)?.[1]);
  field('account').value = '17841400000000001';
  field('token').value = metaToken;
  field('period').value = '14';
  const permissions = [];
  const context = createContext({
    ...networkGlobals,
    document: { getElementById: id => field(id.slice('insights-'.length)) },
    chrome: {
      permissions: { async request(options) { permissions.push(structuredClone(options)); return true; } },
      get storage() { assert.fail('Insights não deve acessar armazenamento.'); },
    },
    addEventListener() {},
  });
  runScript(context, 'meta-insights.js');
  return {
    field, values, permissions,
    submit(isTrusted = true) { return field('form').handlers.submit({ isTrusted, preventDefault() {} }); },
    cancel() { field('cancel').handlers.click(); },
  };
}

test('Meta Insights envia o token só no cabeçalho e exibe as métricas da resposta simulada', async () => {
  const requests = [];
  server.use(http.get(metaUrl, ({ request }) => {
    requests.push({ url: new URL(request.url), authorization: request.headers.get('authorization') });
    return HttpResponse.json({ data: metaMetrics.map((name, value) => ({ name, total_value: { value } })) });
  }));
  const insights = makeInsights();
  await insights.submit(false);
  assert.deepEqual(requests, []);
  await insights.submit();
  assert.equal(requests.length, 1);
  const [{ url, authorization }] = requests;
  assert.equal(authorization, `Bearer ${metaToken}`);
  assert.equal(url.searchParams.get('access_token'), null);
  assert.deepEqual(url.searchParams.get('metric').split(','), metaMetrics);
  assert.equal(Number(url.searchParams.get('until')) - Number(url.searchParams.get('since')) + 1, 14 * 86_400);
  assert.deepEqual(insights.permissions, [{ origins: ['https://graph.instagram.com/*'] }]);
  assert.equal(insights.field('token').value, '');
  assert.equal(insights.field('results').hidden, false);
  assert.equal(insights.field('status').textContent, 'Métricas atualizadas.');
  assert.deepEqual([...insights.values.values()].map(element => element.textContent), ['0', '1', '2', '3']);
});

test('Meta Insights mostra erro de token expirado sem devolver o token ao formulário', async () => {
  server.use(http.get(metaUrl, () => HttpResponse.json({ error: { code: 190, message: metaToken } }, { status: 400 })));
  const insights = makeInsights();
  await insights.submit();
  assert.match(insights.field('status').textContent, /token é inválido ou expirou/);
  assert.doesNotMatch(insights.field('status').textContent, new RegExp(metaToken));
  assert.equal(insights.field('status').dataset.tone, 'error');
  assert.equal(insights.field('token').value, '');
  assert.equal(insights.field('results').hidden, true);
});

test('Cancelar uma consulta lenta de Insights descarta a resposta atrasada', { timeout: 4000 }, async () => {
  let requestStarted;
  let responseReady;
  const started = new Promise(resolve => { requestStarted = resolve; });
  const ready = new Promise(resolve => { responseReady = resolve; });
  server.use(http.get(metaUrl, async () => {
    requestStarted();
    await delay(120);
    responseReady();
    return HttpResponse.json({ data: [{ name: 'reach', total_value: { value: 42 } }] });
  }));
  const insights = makeInsights();
  const pending = insights.submit();
  await started;
  assert.equal(insights.field('cancel').hidden, false);
  insights.cancel();
  await pending;
  await ready;
  assert.equal(insights.field('status').textContent, 'Consulta cancelada.');
  assert.equal(insights.field('submit').disabled, false);
  assert.equal(insights.field('results').hidden, true);
});
