/**
 * Cliente ADVBOX compartilhado pelas functions do Bot.
 * Base: https://app.advbox.com.br/api/v1 (Bearer token).
 * Rate limit ADVBOX: 30 GETs/min — o throttle abaixo respeita isso.
 */

const ADVBOX_TOKEN = process.env.ADVBOX_TOKEN;
const ADVBOX_URL = 'https://app.advbox.com.br/api/v1';
const HEADERS = {
  'Authorization': `Bearer ${ADVBOX_TOKEN}`,
  'Content-Type': 'application/json',
  'Accept': 'application/json',
  'User-Agent': 'Mozilla/5.0 (CBC-Contratos-Bot)',
};

// Throttle: max 15 GETs/min (metade do limite de 30/min do ADVBOX, para nunca
// conflitar com as demais integracoes do escritorio que usam a mesma conta).
let _maxPerMin = 15;
export function setThrottle(n) { _maxPerMin = Math.max(1, Math.min(25, n)); }
const _calls = [];
async function throttle() {
  const now = Date.now();
  while (_calls.length && now - _calls[0] > 60000) _calls.shift();
  if (_calls.length >= _maxPerMin) {
    const wait = 60000 - (now - _calls[0]) + 200;
    await new Promise(r => setTimeout(r, wait));
  }
  _calls.push(Date.now());
}

// (integ-5) timeout em cada chamada externa: ADVBOX as vezes pendura e a function
// fica esperando ate o teto do Netlify e morre sem rastro. 15s -> falha rapida.
const FETCH_TIMEOUT_MS = 15000;

// (observ-12) circuit breaker em memoria (por instancia): apos N falhas seguidas
// a chamada e curto-circuitada por um tempo, em vez de martelar um servico fora do ar.
const _breaker = { fails: 0, openUntil: 0 };
const BREAKER_THRESHOLD = 5;
const BREAKER_COOLDOWN_MS = 60000;

// (integ-11) espera progressiva com variacao aleatoria (jitter) entre retries.
function backoffMs(tentativa) {
  const base = 1500 * Math.pow(2, tentativa); // 1.5s, 3s, 6s...
  return base + Math.floor(Math.random() * 500);
}

async function advGet(path, tentativa = 0) {
  // (observ-12) se o disjuntor estiver aberto, falha rapido sem bater na API.
  if (Date.now() < _breaker.openUntil) {
    throw new Error('ADVBOX: indisponivel (circuit breaker aberto)');
  }
  await throttle();
  let r;
  try {
    r = await fetch(`${ADVBOX_URL}${path}`, { headers: HEADERS, redirect: 'manual', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  } catch (e) {
    // erro de rede / timeout: tenta de novo com backoff (ate 2x) antes de desistir
    if (tentativa < 2) {
      await new Promise(res => setTimeout(res, backoffMs(tentativa)));
      return advGet(path, tentativa + 1);
    }
    _registraFalha();
    throw new Error(`ADVBOX GET ${path} falhou: ${e.name === 'TimeoutError' ? 'timeout' : e.message}`);
  }
  if (r.status === 204) { _registraSucesso(); return null; }   // ADVBOX usa 204 para "vazio"
  if (r.status === 302) { _registraFalha(); throw new Error('ADVBOX: token invalido (redirect login)'); }
  if (r.status === 429) {
    // pode acontecer quando backfill + bot + outras integracoes coincidem:
    // espera (com jitter) e tenta de novo (ate 2x) em vez de falhar
    if (tentativa < 2) {
      await new Promise(res => setTimeout(res, 12000 * (tentativa + 1) + Math.floor(Math.random() * 1000)));
      return advGet(path, tentativa + 1);
    }
    _registraFalha();
    throw new Error('ADVBOX: rate limit (429)');
  }
  if (r.status >= 500 && tentativa < 2) {
    // erro temporario do servidor ADVBOX -> backoff e retry
    await new Promise(res => setTimeout(res, backoffMs(tentativa)));
    return advGet(path, tentativa + 1);
  }
  if (!r.ok) { _registraFalha(); throw new Error(`ADVBOX GET ${path} HTTP ${r.status}`); }
  _registraSucesso();
  return r.json();
}

function _registraSucesso() { _breaker.fails = 0; }
function _registraFalha() {
  _breaker.fails++;
  if (_breaker.fails >= BREAKER_THRESHOLD) {
    _breaker.openUntil = Date.now() + BREAKER_COOLDOWN_MS;
    _breaker.fails = 0;
  }
}

function asList(result) {
  if (!result) return [];
  if (Array.isArray(result)) return result;
  return result.data || result.customers || result.lawsuits || [];
}

const digits = (s) => String(s || '').replace(/\D/g, '');

/** Settings da conta (users, stages, tasks, type_lawsuits...) — cache com validade.
 * (integ-15) antes o cache durava a vida inteira da instancia (backfill encadeia
 * blocos de 12min); se uma etapa/tarefa nova fosse criada no ADVBOX no meio, o
 * bot mostrava "etapa desconhecida". TTL de 10min mantem fresco sem perder o cache. */
let _settings = null;
let _settingsAt = 0;
const SETTINGS_TTL_MS = 10 * 60 * 1000;
export async function getSettings() {
  if (!_settings || (Date.now() - _settingsAt) > SETTINGS_TTL_MS) {
    _settings = await advGet('/settings');
    _settingsAt = Date.now();
  }
  return _settings;
}

/** Busca cliente por telefone. Tenta com e sem DDI 55, e variante sem o 9 extra. */
export async function findCustomerByPhone(phone) {
  const d = digits(phone);
  const candidates = new Set();
  if (d) {
    candidates.add(d);
    if (d.startsWith('55') && d.length >= 12) {
      const local = d.slice(2);
      candidates.add(local);
      if (local.length === 11) candidates.add(local.slice(0, 2) + local.slice(3)); // sem o 9
    } else if (d.length >= 10) {
      candidates.add('55' + d);
    }
  }
  for (const c of candidates) {
    for (const field of ['phone', 'cellphone']) {
      try {
        const res = await advGet(`/customers?${field}=${encodeURIComponent(c)}&limit=5`);
        const list = asList(res);
        if (list.length) return list[0];
      } catch { /* tenta proxima variante */ }
    }
  }
  return null;
}

export async function findCustomerByCPF(cpf) {
  const clean = digits(cpf);
  if (clean.length !== 11 && clean.length !== 14) return null;
  const res = await advGet(`/customers?identification=${encodeURIComponent(clean)}&limit=5`);
  const list = asList(res);
  // confere o CPF de fato (filtro do ADVBOX pode ser frouxo)
  return list.find(c => digits(c.identification) === clean) || list[0] || null;
}

export async function searchCustomers(query) {
  const q = String(query || '').trim();
  if (!q) return [];
  if (digits(q).length === 11 && digits(q).length === q.replace(/[.\-\s]/g, '').length) {
    const byCpf = await findCustomerByCPF(q);
    if (byCpf) return [byCpf];
  }
  const res = await advGet(`/customers?name=${encodeURIComponent(q)}&limit=15`);
  return asList(res);
}

export async function getCustomer(id) {
  const res = await advGet(`/customers/${id}`);
  if (!res) return null;
  return res.data && !Array.isArray(res.data) ? res.data : (Array.isArray(res.data) ? res.data[0] : res);
}

export async function getLawsuit(id) {
  const res = await advGet(`/lawsuits/${id}`);
  if (!res) return null;
  return res.data && !Array.isArray(res.data) ? res.data : (Array.isArray(res.data) ? res.data[0] : res);
}

export async function searchLawsuitByNumber(processNumber) {
  const res = await advGet(`/lawsuits?process_number=${encodeURIComponent(String(processNumber).trim())}&limit=5`);
  return asList(res)[0] || null;
}

/** Andamentos de um processo (origin TRIBUNAL/MANUAL). Mais recentes primeiro. */
export async function getMovements(lawsuitId, limit = 10) {
  const res = await advGet(`/movements/${lawsuitId}`);
  const list = asList(res);
  list.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  return list.slice(0, limit);
}

/** Ultimo andamento de cada processo no periodo (sync incremental do monitor). */
export async function getLastMovements(dateStart, dateEnd) {
  const res = await advGet(`/last_movements?date_start=${dateStart}&date_end=${dateEnd}&limit=100`);
  return asList(res);
}

/** Pagina de last_movements (offset) — para o monitor varrer a janela inteira */
export async function getLastMovementsPage(dateStart, dateEnd, offset = 0, limit = 100) {
  const res = await advGet(`/last_movements?date_start=${dateStart}&date_end=${dateEnd}&limit=${limit}&offset=${offset}`);
  return asList(res);
}

/** Tarefas do processo: status 'pending' | 'completed' */
export async function getHistory(lawsuitId, status) {
  const qs = status ? `?status=${status}` : '';
  const res = await advGet(`/history/${lawsuitId}${qs}`);
  return asList(res);
}

/** Tarefas gerais (posts) com filtros de data — usado pelo monitor */
export async function getPosts(params = {}) {
  const qs = new URLSearchParams(params).toString();
  const res = await advGet(`/posts${qs ? '?' + qs : ''}`);
  return asList(res);
}

/** Versao "crua" do /posts: retorna { items, totalCount } para paginacao por offset */
export async function getPostsPage(params = {}) {
  const qs = new URLSearchParams(params).toString();
  const res = await advGet(`/posts${qs ? '?' + qs : ''}`);
  return { items: asList(res), totalCount: res?.totalCount ?? null };
}

/** Pagina de processos (id apenas) para o backfill: { items, totalCount } */
export async function getLawsuitsPage(offset = 0, limit = 50) {
  const res = await advGet(`/lawsuits?limit=${limit}&offset=${offset}`);
  return { items: asList(res), totalCount: res?.totalCount ?? null };
}

/** Pagina de clientes (snapshot diario): { items, totalCount } */
export async function getCustomersPage(offset = 0, limit = 50) {
  const res = await advGet(`/customers?limit=${limit}&offset=${offset}`);
  return { items: asList(res), totalCount: res?.totalCount ?? null };
}

/** Pagina de lancamentos financeiros (snapshot diario): { items, totalCount } */
export async function getTransactionsPage(offset = 0, limit = 50) {
  const res = await advGet(`/transactions?limit=${limit}&offset=${offset}`);
  return { items: asList(res), totalCount: res?.totalCount ?? null };
}

export { digits };
