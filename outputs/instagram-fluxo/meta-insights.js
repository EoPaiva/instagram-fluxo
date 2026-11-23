'use strict';

(() => {
  const graph = 'https://graph.instagram.com';
  const version = 'v27.0';
  const metrics = ['reach', 'views', 'accounts_engaged', 'total_interactions'];
  const days = new Set([7, 14, 28]);
  const dayMs = 86_400_000;
  const date = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium', timeZone: 'UTC' });
  const number = new Intl.NumberFormat('pt-BR');
  const byId = id => document.getElementById('insights-' + id);
  const form = byId('form');
  const account = byId('account');
  const token = byId('token');
  const period = byId('period');
  const submit = byId('submit');
  const cancel = byId('cancel');
  const status = byId('status');
  const results = byId('results');
  const resultPeriod = byId('result-period');
  const values = new Map(metrics.map(metric => [metric, results.querySelector(`[data-metric="${metric}"]`)]));
  let current;

  function tell(message, tone = '') {
    status.textContent = message;
    status.dataset.tone = tone;
  }

  function setPending(pending) {
    account.disabled = pending;
    token.disabled = pending;
    period.disabled = pending;
    submit.disabled = pending;
    cancel.hidden = !pending;
  }

  function rangeFor(length) {
    const end = Math.floor(Date.now() / dayMs) * dayMs;
    const start = end - length * dayMs;
    return { start, end };
  }

  function graphError(response, body) {
    const code = body?.error?.code;
    if ([102, 190].includes(code) || response.status === 401) return 'O token é inválido ou expirou. Gere outro token no app da Meta.';
    if ([10, 200, 294].includes(code) || response.status === 403) return 'O token não tem acesso aos Insights dessa conta. Confira as permissões no app da Meta.';
    if ([4, 17, 32, 613, 80002].includes(code) || response.status === 429) return 'A Meta limitou as consultas. Tente novamente mais tarde.';
    if (code === 3006) return 'A Meta ainda não tem dados suficientes para essa conta no período.';
    if (code === 100 || response.status === 404) return 'Confira o ID da conta profissional e se o token foi emitido para essa conta.';
    return 'A Meta não concluiu a consulta. Tente novamente mais tarde.';
  }

  async function readMetrics(id, accessToken, range, signal) {
    const url = new URL(`/${version}/${id}/insights`, graph);
    url.search = new URLSearchParams({ metric: metrics.join(','), metric_type: 'total_value', period: 'day',
      since: String(range.start / 1000), until: String(range.end / 1000 - 1) });
    const response = await fetch(url, { method: 'GET', headers: { Authorization: `Bearer ${accessToken}` },
      credentials: 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer', signal });
    const body = await response.json().catch(() => null);
    signal.throwIfAborted();
    if (!response.ok || body?.error) return { error: graphError(response, body) };
    if (!Array.isArray(body?.data)) return { error: 'A Meta retornou uma resposta inesperada. Tente novamente mais tarde.' };
    const totals = new Map();
    for (const row of body.data) {
      const value = row?.total_value?.value;
      if (values.has(row?.name) && Number.isSafeInteger(value) && value >= 0) totals.set(row.name, value);
    }
    return { totals };
  }

  function renderTotals(totals, range) {
    for (const [metric, element] of values) {
      element.textContent = totals.has(metric) ? number.format(totals.get(metric)) : 'Indisponível';
    }
    resultPeriod.textContent = `${date.format(range.start)} a ${date.format(range.end - dayMs)} (UTC)`;
    results.hidden = false;
    tell(totals.size === metrics.length ? 'Métricas atualizadas.' : 'A Meta retornou apenas parte das métricas para esse período.');
  }

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!event.isTrusted || current) return;
    const id = account.value.trim();
    let accessToken = token.value.trim();
    const length = Number(period.value);
    if (!/^[1-9][0-9]{0,31}$/.test(id) || !/^[A-Za-z0-9._~+/=-]{1,2048}$/.test(accessToken) || !days.has(length)) {
      tell('Confira o ID, o token e o período informados.', 'error');
      return;
    }

    const controller = new AbortController();
    const { signal } = controller;
    current = controller;
    token.value = '';
    results.hidden = true;
    setPending(true);
    tell('Consultando a Meta…');
    let timer;
    try {
      const allowed = await chrome.permissions.request({ origins: [`${graph}/*`] });
      signal.throwIfAborted();
      if (!allowed) {
        tell('A consulta precisa da permissão do Chrome para acessar a API da Meta.', 'error');
        return;
      }
      const range = rangeFor(length);
      timer = setTimeout(() => controller.abort('timeout'), 15_000);
      const { totals, error } = await readMetrics(id, accessToken, range, signal);
      if (error) tell(error, 'error');
      else if (totals.size === 0) tell('A Meta não retornou métricas para esse período.');
      else renderTotals(totals, range);
    } catch {
      if (signal.reason === 'timeout') tell('A consulta demorou mais que o esperado. Tente novamente.', 'error');
      else if (signal.aborted) tell('Consulta cancelada.');
      else tell('Não foi possível acessar a API da Meta. Confira a conexão e tente novamente.', 'error');
    } finally {
      accessToken = '';
      clearTimeout(timer);
      current = undefined;
      setPending(false);
    }
  });

  cancel.addEventListener('click', () => current?.abort());
  addEventListener('pagehide', () => {
    token.value = '';
    current?.abort();
  });
})();
