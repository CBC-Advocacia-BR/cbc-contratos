// Config da aba "Agendamento Videochamada" (bot Ana) — 4 sub-abas de configuração.
// Padrão (Task 12): cada form clona bot_config.agenda_bot INTEIRO (structuredClone),
// edita só a sua sub-árvore e manda o objeto COMPLETO de volta pro salvar(novo) — o
// AgendaPanel faz um UPDATE que substitui o `value` inteiro (ver salvarCfg), então
// salvar um pedaço só apagaria o resto (vendedoras, regras, mensagens, kommo...).
import { useState } from 'react';
import { CheckIcon, ExclamationTriangleIcon, ArrowUturnLeftIcon } from '@heroicons/react/24/outline';

/* ─────────────────────────────────────────────────────────────────────────
 * DEFAULTS — copiados VERBATIM dos seeds da migração (supabase_agenda_bot.sql,
 * `insert into bot_config (key, value) values ('agenda_bot', ...)`). Usados
 * pelo botão "Restaurar padrão" (Mensagens por campo; Regras em bloco). Se a
 * migração mudar os seeds, atualizar aqui junto — mesma fonte, dois lugares.
 * ───────────────────────────────────────────────────────────────────────── */
// Constante de dados (não componente) — precisa ser importável (brief) p/ "Restaurar padrão" bater com a migração.
// eslint-disable-next-line react-refresh/only-export-components
export const DEFAULTS_MENSAGENS = {
  abertura: 'Olá! Sou a *Ana, assistente do escritório Conforto, Bergonsi e Cavalari*, escritório especializado em cancelamento de contratos. Estou aqui para te ajudar 😊\nMe conta: *o que vem acontecendo com a sua cota* que te fez buscar o cancelamento?',
  qual_resort: 'Entendi! Qual é o *resort/empreendimento* da sua cota?',
  qual_situacao: 'Você *ainda está pagando* ou *já quitou* a cota?',
  qual_valor: 'Quanto *aproximadamente já foi pago*? Pode ser um valor estimado.',
  pitch_oferta: 'Nesse caso você consegue iniciar o *processo de distrato* para devolver a cota ao resort e *restituir o que já foi pago, corrigido monetariamente*. 📍 O próximo passo é uma *videochamada* com nossa equipe: leva ~10 minutos, *não tem custo nenhum* e explicamos como funciona o processo, encargos e etc.\nTenho *{{slot1}}* ou *{{slot2}}* disponíveis. Qual prefere? (ou me diga outro horário)',
  oferta_slots: 'Consigo te encaixar em *{{slot1}}* ou *{{slot2}}*. Qual prefere?',
  confirmado: '*Ok, agendado {{dia}} às {{hora}}!* Vamos te mandar uma mensagem antes com o link da videochamada. Até lá! 😊',
  slot_ocupado: 'Esse horário acabou de ser preenchido 😅 Consigo *{{slot1}}* ou *{{slot2}}*. Qual prefere?',
  lembrete_1h: 'Passando para lembrar da nossa videochamada hoje às {{hora}} 😊 Tudo certo?',
  lembrete_t0: 'Temos um atendimento agendado agora. Segue o link do Google Meet para videochamada: {{link}}',
  noshow: 'Não conseguimos falar hoje 😕 Podemos *reagendar*? Tenho *{{slot1}}* ou *{{slot2}}*.',
  preco: 'Não consigo te passar um preço, pois trabalhamos de uma forma diferente.\n👉 Realizamos a videochamada, entendemos a sua situação com o resort e aí sim, vemos a melhor forma de seguir com a ação judicial, tanto em valores quanto em andamentos.\nTenho *{{slot1}}* ou *{{slot2}}* disponíveis 😊',
  pede_texto: 'Consegue me escrever em poucas palavras? Assim já te encaminho mais rápido 😊',
  handoff: 'Perfeito! Já estou chamando alguém da equipe para falar com você por aqui 😊',
  impasse: 'Sem problema! Vou pedir para a equipe combinar um horário com você por aqui, tudo bem?',
};

// [chave, dica curta] — ordem igual à da migração. Rótulo do campo = a própria chave
// (pedido do brief); a dica só ajuda a identificar rapidamente qual mensagem é qual.
const MENSAGENS_META = [
  ['abertura', 'Primeira mensagem, ao iniciar a conversa'],
  ['qual_resort', 'Pergunta o resort/empreendimento'],
  ['qual_situacao', 'Pergunta se ainda paga ou já quitou a cota'],
  ['qual_valor', 'Pergunta o valor aproximado já pago'],
  ['pitch_oferta', 'Explica o distrato e faz a 1ª oferta de horário'],
  ['oferta_slots', 'Reoferece horários sem repetir o pitch completo'],
  ['confirmado', 'Confirmação enviada depois de agendar'],
  ['slot_ocupado', 'Avisa que o horário escolhido acabou de ser preenchido'],
  ['lembrete_1h', 'Lembrete ~1h antes da videochamada'],
  ['lembrete_t0', 'Mensagem na hora da call, com o link do Meet'],
  ['noshow', 'Lead não apareceu na call — tenta reagendar'],
  ['preco', 'Resposta quando o lead pergunta preço/valor'],
  ['pede_texto', 'Pede pro lead escrever (áudio não entendido)'],
  ['handoff', 'Aviso ao transferir a conversa para um humano'],
  ['impasse', 'Aviso de que a equipe vai combinar o horário manualmente'],
];

// eslint-disable-next-line react-refresh/only-export-components -- idem acima (dado, não componente)
export const DEFAULTS_REGRAS = {
  dias: [1, 2, 3, 4, 5],
  hora_inicio: '08:00',
  hora_fim: '17:00',
  granularidade_min: 30,
  antecedencia_min_minutos: 60,
  horizonte_dias_uteis: 5,
  almoco: null,
  slots_por_oferta: 2,
  max_recusas: 2,
  max_reagendamentos: 2,
  duracao_evento_min: 30,
  silencio_humano_horas: 24,
  janela_margem_min: 60,
  feriados: [],
};

// dow: 0=Dom...6=Sáb (Date#getDay(), mesma convenção de agendaSlots.mjs/partesLocais)
const DIAS_SEMANA = [[0, 'Dom'], [1, 'Seg'], [2, 'Ter'], [3, 'Qua'], [4, 'Qui'], [5, 'Sex'], [6, 'Sáb']];

/* ─── estilos utilitários — só tokens --cbc-* (fallback = valor "light" do index.css) ─── */
const rotuloCls = 'text-[11px] font-bold uppercase tracking-wide block mb-1';
const mutedTxt = { color: 'var(--cbc-text-muted, #5E6675)' };
const campoCls = 'w-full rounded-lg border px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cbc-navy,#1B3A5C)]/40';
const campoStyle = { borderColor: 'var(--cbc-border, #E2E8F0)', background: 'var(--cbc-bg-card, #FFFFFF)', color: 'var(--cbc-text-primary, #1B3A5C)' };
const cartaoCls = 'rounded-2xl border p-4 space-y-3';
const cartaoStyle = { borderColor: 'var(--cbc-border, #E2E8F0)', background: 'var(--cbc-bg-card, #FFFFFF)' };
const linkBtnCls = 'text-[11px] font-bold uppercase tracking-wide inline-flex items-center gap-1 cursor-pointer hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cbc-navy,#1B3A5C)]/40 rounded';

function Cartao({ titulo, dica, children }) {
  return (
    <div className={cartaoCls} style={cartaoStyle}>
      <div>
        <h3 className="text-sm font-bold" style={{ color: 'var(--cbc-text-primary, #1B3A5C)' }}>{titulo}</h3>
        {dica && <p className="text-xs mt-0.5" style={mutedTxt}>{dica}</p>}
      </div>
      {children}
    </div>
  );
}

function BarraSalvar({ onSalvar, salvando, salvo, motivoBloqueio }) {
  return (
    <div className="flex items-center gap-3 flex-wrap sticky bottom-0 py-3" style={{ background: 'var(--cbc-bg, #F0F4F8)' }}>
      <button type="button" onClick={onSalvar} disabled={salvando || !!motivoBloqueio}
        className="px-5 py-2 rounded-lg text-sm font-bold uppercase tracking-wide cursor-pointer text-white disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cbc-navy,#1B3A5C)]/40"
        style={{ background: 'var(--cbc-navy, #1B3A5C)' }}>
        {salvando ? 'Salvando…' : 'Salvar'}
      </button>
      {salvo && (
        <span className="text-xs font-bold inline-flex items-center gap-1" style={{ color: 'var(--cbc-success, #15803D)' }}>
          <CheckIcon className="w-4 h-4" aria-hidden="true" /> Salvo!
        </span>
      )}
      {motivoBloqueio && (
        <span className="text-xs inline-flex items-center gap-1" style={{ color: 'var(--cbc-danger, #B91C1C)' }}>
          <ExclamationTriangleIcon className="w-3.5 h-3.5 shrink-0" aria-hidden="true" /> {motivoBloqueio}
        </span>
      )}
    </div>
  );
}

/** Draft = clone do bot_config.agenda_bot INTEIRO (nunca só a sub-árvore editada —
 *  ver comentário no topo do arquivo). `salvo` é local (o `salvando` vem de cima,
 *  do AgendaPanel, que é quem de fato chama o Supabase).
 *  `salvarAgora` aceita um `draftParaSalvar` opcional (default = o draft do hook) para
 *  quem precisar saneá-lo de forma síncrona antes de salvar (ver ConfigRegras/ConfigGeral)
 *  sem cair no problema clássico de "setDraft + salvarAgora na mesma função" ler o draft
 *  ANTIGO (setState não reflete no fechamento léxico até o próximo render). */
function useCfgDraft(cfg, salvar) {
  const [draft, setDraft] = useState(() => structuredClone(cfg));
  const [salvo, setSalvo] = useState(false);

  const salvarAgora = async (draftParaSalvar = draft) => {
    setSalvo(false);
    const ok = await salvar(draftParaSalvar);
    if (ok) { setSalvo(true); setTimeout(() => setSalvo(false), 2000); }
  };

  return { draft, setDraft, salvo, salvarAgora };
}

/** Garante number finito em cada chave de `obj`; troca por `defaults[chave]` quando o
 *  valor não é um número finito (ex.: '' deixada por um <input type="number"> limpo).
 *  Sem isso, alguns consumidores server-side usam `??`/uso direto (não `||`) nesses
 *  campos (ex.: agendaEngine.mjs `cfg.regras.max_recusas ?? 2`, `slots_por_oferta` sem
 *  fallback algum) — uma string vazia sobrevive ao `??` e quebra silenciosamente a
 *  regra (ex.: max_recusas='' faz `recusas >= ''` virar `recusas >= 0`, sempre true).
 *  PURA — sem I/O, só normaliza o objeto antes de mandar pro salvar(). */
function comNumerosSaneados(obj, chaves, defaults) {
  const out = { ...obj };
  for (const chave of chaves) if (!Number.isFinite(out[chave])) out[chave] = defaults[chave];
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
// ConfigMensagens
// ═══════════════════════════════════════════════════════════════════════════
export function ConfigMensagens({ cfg, salvar, salvando }) {
  const { draft, setDraft, salvo, salvarAgora } = useCfgDraft(cfg, salvar);
  const mensagens = draft.mensagens || {};

  const editar = (chave, valor) => setDraft((d) => ({ ...d, mensagens: { ...(d.mensagens || {}), [chave]: valor } }));
  const restaurar = (chave) => editar(chave, DEFAULTS_MENSAGENS[chave] ?? '');

  return (
    <div className="space-y-4">
      <p className="text-xs" style={mutedTxt}>
        Todas as falas da Ana. Cada mensagem vira uma nota/resposta real no WhatsApp via Kommo — teste no <b>Simulador</b> antes de mudar algo em produção.
      </p>
      <div className="rounded-xl border px-3 py-2 text-xs" style={{ ...mutedTxt, borderColor: 'var(--cbc-border, #E2E8F0)', background: 'var(--cbc-bg-subtle, #F7FAFC)' }}>
        Variáveis disponíveis (conforme a mensagem): <code>{'{{slot1}}'}</code> <code>{'{{slot2}}'}</code> <code>{'{{dia}}'}</code> <code>{'{{hora}}'}</code> <code>{'{{link}}'}</code> — troque pelo valor real ao enviar; uma mensagem sem a variável correspondente simplesmente não a usa.
      </div>

      <div className="grid md:grid-cols-2 gap-3">
        {MENSAGENS_META.map(([chave, dica]) => (
          <Cartao key={chave} titulo={chave} dica={dica}>
            <textarea rows={3} className={`${campoCls} font-mono`} style={campoStyle}
              value={mensagens[chave] ?? ''} onChange={(e) => editar(chave, e.target.value)} />
            <button type="button" onClick={() => restaurar(chave)} className={linkBtnCls} style={{ color: 'var(--cbc-info, #1D4ED8)' }}>
              <ArrowUturnLeftIcon className="w-3.5 h-3.5" aria-hidden="true" /> Restaurar padrão
            </button>
          </Cartao>
        ))}
      </div>

      <BarraSalvar onSalvar={salvarAgora} salvando={salvando} salvo={salvo} />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// ConfigRegras
// ═══════════════════════════════════════════════════════════════════════════
// Campos numéricos de `regras` consumidos SEM fallback seguro no servidor (alguns usam
// `??`/uso direto, não `||` — ver comentário de comNumerosSaneados acima). Saneados no
// momento de salvar, não a cada tecla (senão o campo "trava" no default enquanto o
// usuário apaga pra digitar de novo — problema clássico de controlled input).
const REGRAS_CAMPOS_NUMERICOS = [
  'granularidade_min', 'antecedencia_min_minutos', 'horizonte_dias_uteis', 'slots_por_oferta',
  'max_recusas', 'max_reagendamentos', 'duracao_evento_min', 'silencio_humano_horas',
];

export function ConfigRegras({ cfg, salvar, salvando }) {
  const { draft, setDraft, salvo, salvarAgora } = useCfgDraft(cfg, salvar);
  const regras = draft.regras || {};
  const dias = regras.dias || [];

  const editar = (chave, valor) => setDraft((d) => ({ ...d, regras: { ...(d.regras || {}), [chave]: valor } }));
  const numero = (chave) => (e) => editar(chave, e.target.value === '' ? '' : Number(e.target.value));

  // Sanitiza os numéricos SÓ no clique de Salvar (não a cada tecla) e manda o objeto já
  // corrigido direto pro salvarAgora — setDraft() aqui não bastaria: o fechamento de
  // salvarAgora só veria o draft novo no PRÓXIMO render, não neste clique.
  const salvarSaneado = () => {
    let regrasSaneadas = comNumerosSaneados(regras, REGRAS_CAMPOS_NUMERICOS, DEFAULTS_REGRAS);
    // almoco com inicio/fim parcialmente vazio (usuário limpou o <input type="time">) faz
    // dentroDoExpediente() em agendaSlots.mjs comparar com NaN — a comparação vira sempre
    // false e o intervalo de almoço deixa de ser respeitado silenciosamente. Mais seguro
    // tratar como "sem almoço" (null) do que persistir um horário quebrado.
    if (regrasSaneadas.almoco && (!regrasSaneadas.almoco.inicio || !regrasSaneadas.almoco.fim)) {
      regrasSaneadas = { ...regrasSaneadas, almoco: null };
    }
    const draftFinal = { ...draft, regras: regrasSaneadas };
    setDraft(draftFinal);
    return salvarAgora(draftFinal);
  };

  const toggleDia = (dia) => {
    const set = new Set(dias);
    if (set.has(dia)) set.delete(dia); else set.add(dia);
    editar('dias', [...set].sort((a, b) => a - b));
  };

  const restaurarTudo = () => setDraft((d) => ({ ...d, regras: structuredClone(DEFAULTS_REGRAS) }));

  const feriadosTexto = (regras.feriados || []).join('\n');
  const editarFeriados = (texto) => editar('feriados', texto.split('\n').map((s) => s.trim()).filter(Boolean));

  const semAlmoco = !regras.almoco;
  const toggleAlmoco = (semAlmocoNovo) => editar('almoco', semAlmocoNovo ? null : { inicio: '12:00', fim: '13:00' });
  const editarAlmoco = (campo, valor) => editar('almoco', { ...(regras.almoco || { inicio: '12:00', fim: '13:00' }), [campo]: valor });

  const motivoBloqueio = dias.length === 0
    ? 'Selecione ao menos 1 dia da semana.'
    : (!regras.hora_inicio || !regras.hora_fim)
      ? 'Preencha o horário de início e de fim.'
      : (regras.hora_inicio >= regras.hora_fim)
        ? 'Horário de início precisa ser antes do horário de fim.'
        : '';

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button type="button" onClick={restaurarTudo} className={linkBtnCls} style={{ color: 'var(--cbc-info, #1D4ED8)' }}>
          <ArrowUturnLeftIcon className="w-3.5 h-3.5" aria-hidden="true" /> Restaurar padrão (todas as regras)
        </button>
      </div>

      <Cartao titulo="Dias e horário de atendimento" dica="Define a JANELA em que a Ana busca/oferece horários (não altera compromissos já marcados).">
        <div className="flex flex-wrap gap-2">
          {DIAS_SEMANA.map(([valor, texto]) => {
            const ativo = dias.includes(valor);
            return (
              <button key={valor} type="button" onClick={() => toggleDia(valor)} aria-pressed={ativo}
                className={`px-3 py-1.5 rounded-lg border text-xs font-bold cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cbc-navy,#1B3A5C)]/40 ${ativo ? 'text-white' : ''}`}
                style={ativo
                  ? { borderColor: 'var(--cbc-navy, #1B3A5C)', background: 'var(--cbc-navy, #1B3A5C)' }
                  : { borderColor: 'var(--cbc-border, #E2E8F0)', background: 'var(--cbc-bg-card, #FFFFFF)', color: 'var(--cbc-text-primary, #1B3A5C)' }}>
                {texto}
              </button>
            );
          })}
        </div>
        <div className="grid grid-cols-2 gap-3 max-w-xs">
          <div>
            <label className={rotuloCls} style={mutedTxt}>Início</label>
            <input type="time" className={campoCls} style={campoStyle} value={regras.hora_inicio || ''} onChange={(e) => editar('hora_inicio', e.target.value)} />
          </div>
          <div>
            <label className={rotuloCls} style={mutedTxt}>Fim</label>
            <input type="time" className={campoCls} style={campoStyle} value={regras.hora_fim || ''} onChange={(e) => editar('hora_fim', e.target.value)} />
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={semAlmoco} onChange={(e) => toggleAlmoco(e.target.checked)} /> Sem intervalo de almoço
        </label>
        {!semAlmoco && (
          <div className="grid grid-cols-2 gap-3 max-w-xs">
            <div>
              <label className={rotuloCls} style={mutedTxt}>Almoço — início</label>
              <input type="time" className={campoCls} style={campoStyle} value={regras.almoco?.inicio || ''} onChange={(e) => editarAlmoco('inicio', e.target.value)} />
            </div>
            <div>
              <label className={rotuloCls} style={mutedTxt}>Almoço — fim</label>
              <input type="time" className={campoCls} style={campoStyle} value={regras.almoco?.fim || ''} onChange={(e) => editarAlmoco('fim', e.target.value)} />
            </div>
          </div>
        )}
      </Cartao>

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <Cartao titulo="Granularidade (min)" dica="Espaço entre um horário oferecido e o próximo">
          <input type="number" min={5} step={5} className={campoCls} style={campoStyle} value={regras.granularidade_min ?? ''} onChange={numero('granularidade_min')} />
        </Cartao>
        <Cartao titulo="Antecedência mínima (min)" dica="Folga antes do 1º horário oferecido">
          <input type="number" min={0} step={5} className={campoCls} style={campoStyle} value={regras.antecedencia_min_minutos ?? ''} onChange={numero('antecedencia_min_minutos')} />
        </Cartao>
        <Cartao titulo="Horizonte (dias úteis)" dica="Até quantos dias úteis à frente busca horário">
          <input type="number" min={1} step={1} className={campoCls} style={campoStyle} value={regras.horizonte_dias_uteis ?? ''} onChange={numero('horizonte_dias_uteis')} />
        </Cartao>
        <Cartao titulo="Slots por oferta" dica="Quantos horários a Ana oferece por vez">
          <input type="number" min={1} max={5} step={1} className={campoCls} style={campoStyle} value={regras.slots_por_oferta ?? ''} onChange={numero('slots_por_oferta')} />
        </Cartao>
        <Cartao titulo="Duração do evento (min)" dica="Duração de cada videochamada no Calendar">
          <input type="number" min={5} step={5} className={campoCls} style={campoStyle} value={regras.duracao_evento_min ?? ''} onChange={numero('duracao_evento_min')} />
        </Cartao>
        <Cartao titulo="Máx. recusas" dica="Recusas de horário até escalar p/ humano">
          <input type="number" min={0} step={1} className={campoCls} style={campoStyle} value={regras.max_recusas ?? ''} onChange={numero('max_recusas')} />
        </Cartao>
        <Cartao titulo="Máx. reagendamentos" dica="Reagendamentos pós-agendado até escalar p/ humano">
          <input type="number" min={0} step={1} className={campoCls} style={campoStyle} value={regras.max_reagendamentos ?? ''} onChange={numero('max_reagendamentos')} />
        </Cartao>
        <Cartao titulo="Silêncio pós-humano (h)" dica="Horas pausada após um humano responder">
          <input type="number" min={0} step={1} className={campoCls} style={campoStyle} value={regras.silencio_humano_horas ?? ''} onChange={numero('silencio_humano_horas')} />
        </Cartao>
      </div>

      <Cartao titulo="Feriados" dica="1 data por linha, formato AAAA-MM-DD — nesses dias a Ana não oferece horário">
        <textarea rows={4} className={`${campoCls} font-mono`} style={campoStyle} value={feriadosTexto}
          onChange={(e) => editarFeriados(e.target.value)} placeholder={'2026-12-25\n2027-01-01'} />
      </Cartao>

      <BarraSalvar onSalvar={salvarSaneado} salvando={salvando} salvo={salvo} motivoBloqueio={motivoBloqueio} />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// ConfigVendedoras
// ═══════════════════════════════════════════════════════════════════════════
export function ConfigVendedoras({ cfg, salvar, salvando }) {
  const { draft, setDraft, salvo, salvarAgora } = useCfgDraft(cfg, salvar);
  const vendedoras = draft.vendedoras || [];

  const editar = (idx, campo, valor) => setDraft((d) => ({
    ...d,
    vendedoras: (d.vendedoras || []).map((v, i) => (i === idx ? { ...v, [campo]: valor } : v)),
  }));

  const somaPesos = vendedoras.reduce((s, v) => s + (Number(v.peso) || 0), 0);
  const motivoBloqueio = somaPesos <= 0 ? 'A soma dos pesos precisa ser maior que zero (senão ninguém é sorteado para novos agendamentos).' : '';

  return (
    <div className="space-y-4">
      <div className="rounded-xl border px-3 py-2 text-xs space-y-1" style={{ ...mutedTxt, borderColor: 'var(--cbc-border, #E2E8F0)', background: 'var(--cbc-bg-subtle, #F7FAFC)' }}>
        <p><b>Peso</b> decide a proporção do sorteio entre as vendedoras ativas (ex.: 60/20/20 = Mariana pega ~60% dos novos agendamentos).</p>
        <p><b>Ativa</b> controla <b>só o sorteio de NOVOS agendamentos</b>. Uma vendedora <b>inativa não recebe agendamento novo</b>, mas continua aparecendo normalmente na aba <b>Agenda</b> e no sync do Google Calendar — "inativa" não é "some da agenda".</p>
        <p>Sem adicionar/remover vendedora nesta tela na v1 — só editar as já cadastradas. E-mail é o ID do Google Calendar dessa vendedora: mudar aqui não move agendamentos antigos, só passa a valer para os novos.</p>
      </div>

      <div className="rounded-2xl border overflow-x-auto" style={cartaoStyle}>
        <table className="w-full text-sm min-w-[640px]">
          <thead>
            <tr className="border-b" style={{ borderColor: 'var(--cbc-border, #E2E8F0)' }}>
              {['E-mail (Google Calendar)', 'Nome', 'User ID (Kommo)', 'Peso', 'Ativa'].map((h) => (
                <th key={h} className="text-left px-3 py-2 text-[10.5px] font-bold uppercase tracking-wide" style={mutedTxt}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {vendedoras.length === 0 && (
              <tr><td colSpan={5} className="px-3 py-4 text-center text-xs" style={mutedTxt}>Nenhuma vendedora cadastrada em bot_config.agenda_bot.vendedoras.</td></tr>
            )}
            {vendedoras.map((v, i) => (
              <tr key={i} className="border-b last:border-b-0" style={{ borderColor: 'var(--cbc-border, #E2E8F0)' }}>
                <td className="px-3 py-2">
                  <input type="email" className={campoCls} style={campoStyle} value={v.email || ''} onChange={(e) => editar(i, 'email', e.target.value)} />
                </td>
                <td className="px-3 py-2">
                  <input type="text" className={campoCls} style={campoStyle} value={v.nome || ''} onChange={(e) => editar(i, 'nome', e.target.value)} />
                </td>
                <td className="px-3 py-2">
                  <input type="number" className={campoCls} style={campoStyle} value={v.user_id ?? ''} onChange={(e) => editar(i, 'user_id', e.target.value === '' ? null : Number(e.target.value))} />
                </td>
                <td className="px-3 py-2">
                  <input type="number" min={0} className={campoCls} style={campoStyle} value={v.peso ?? ''} onChange={(e) => editar(i, 'peso', e.target.value === '' ? 0 : Number(e.target.value))} />
                </td>
                <td className="px-3 py-2 text-center">
                  <input type="checkbox" checked={!!v.ativa} onChange={(e) => editar(i, 'ativa', e.target.checked)}
                    aria-label={`${v.nome || v.email || 'vendedora'} ativa`} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs" style={mutedTxt}>Soma atual dos pesos: <b style={{ color: motivoBloqueio ? 'var(--cbc-danger, #B91C1C)' : 'var(--cbc-text-primary, #1B3A5C)' }}>{somaPesos}</b></p>

      <BarraSalvar onSalvar={salvarAgora} salvando={salvando} salvo={salvo} motivoBloqueio={motivoBloqueio} />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// ConfigGeral
// ═══════════════════════════════════════════════════════════════════════════
const LLM_MODELOS = ['claude-sonnet-5', 'claude-haiku-4-5'];
const STT_PROVEDORES = ['groq', 'openai'];

export function ConfigGeral({ cfg, salvar, salvando }) {
  const { draft, setDraft, salvo, salvarAgora } = useCfgDraft(cfg, salvar);
  const [confirmaDesligarTeste, setConfirmaDesligarTeste] = useState(false);
  const kommo = draft.kommo || {};

  const editarRaiz = (campo, valor) => setDraft((d) => ({ ...d, [campo]: valor }));
  const editarLlm = (campo, valor) => setDraft((d) => ({ ...d, llm: { ...(d.llm || {}), [campo]: valor } }));
  const editarStt = (campo, valor) => setDraft((d) => ({ ...d, stt: { ...(d.stt || {}), [campo]: valor } }));

  const pedirDesligarModoTeste = () => {
    if (draft.modo_teste) { setConfirmaDesligarTeste(true); return; }
    editarRaiz('modo_teste', true);
  };
  const confirmarDesligar = () => { editarRaiz('modo_teste', false); setConfirmaDesligarTeste(false); };

  // agendaEngine.mjs lê `cfg.llm?.confianca_minima ?? 0.6` — `??` não pega '' (deixada por
  // um <input type="number"> limpo), e '' < qualquer confiança vira sempre true (comparação
  // numérica coage '' para 0), desligando de fato o guard-rail de handoff por baixa confiança.
  // 0.6 = default do seed da migração (supabase_agenda_bot.sql, key agenda_bot → llm).
  const salvarSaneado = () => {
    const confiancaAtual = draft.llm?.confianca_minima;
    const draftFinal = Number.isFinite(confiancaAtual) ? draft
      : { ...draft, llm: { ...(draft.llm || {}), confianca_minima: 0.6 } };
    if (draftFinal !== draft) setDraft(draftFinal);
    return salvarAgora(draftFinal);
  };

  return (
    <div className="space-y-4">
      <Cartao titulo="Liga/desliga">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={!!draft.ativo} onChange={(e) => editarRaiz('ativo', e.target.checked)} />
          <b>Ana ativa</b> <span style={mutedTxt}>(recebe e responde os leads dos gatilhos configurados)</span>
        </label>

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={!!draft.modo_teste} onChange={() => pedirDesligarModoTeste()} />
          <b>Modo teste</b> <span style={mutedTxt}>(restringe a Ana aos números de teste; ver aba Testadores do Bot ADVBOX)</span>
        </label>

        {!draft.modo_teste && (
          <div className="flex items-start gap-2 rounded-lg border px-3 py-2 text-xs font-bold"
            style={{ borderColor: 'var(--cbc-danger-border, #FCA5A5)', background: 'var(--cbc-danger-bg, #FEF2F2)', color: 'var(--cbc-danger, #B91C1C)' }}>
            <ExclamationTriangleIcon className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
            Modo teste DESLIGADO: a Ana passa a responder TODOS os leads do funil (não só testadores). Confirme que as regras/mensagens estão revisadas antes de deixar assim.
          </div>
        )}

        {confirmaDesligarTeste && (
          <div className="rounded-lg border px-3 py-2 space-y-2" style={{ borderColor: 'var(--cbc-danger-border, #FCA5A5)', background: 'var(--cbc-danger-bg, #FEF2F2)' }}>
            <p className="text-xs font-bold" style={{ color: 'var(--cbc-danger, #B91C1C)' }}>
              Confirma desligar o modo teste? A Ana passa a responder TODOS os leads do funil, não só testadores.
            </p>
            <div className="flex gap-2">
              <button type="button" onClick={confirmarDesligar}
                className="px-3 py-1.5 rounded-lg text-xs font-bold uppercase cursor-pointer text-white"
                style={{ background: 'var(--cbc-danger, #B91C1C)' }}>Sim, desligar</button>
              <button type="button" onClick={() => setConfirmaDesligarTeste(false)}
                className="px-3 py-1.5 rounded-lg text-xs font-bold uppercase cursor-pointer border"
                style={{ borderColor: 'var(--cbc-border, #E2E8F0)', color: 'var(--cbc-text-secondary, #4A5568)' }}>Cancelar</button>
            </div>
          </div>
        )}
      </Cartao>

      <div className="grid md:grid-cols-2 gap-3">
        <Cartao titulo="IA — interpretação das mensagens">
          <div>
            <label className={rotuloCls} style={mutedTxt}>Modelo (llm.modelo)</label>
            <select className={campoCls} style={campoStyle} value={draft.llm?.modelo || ''} onChange={(e) => editarLlm('modelo', e.target.value)}>
              {LLM_MODELOS.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div>
            <label className={rotuloCls} style={mutedTxt}>Confiança mínima (llm.confianca_minima)</label>
            <input type="number" min={0} max={1} step={0.05} className={campoCls} style={campoStyle}
              value={draft.llm?.confianca_minima ?? ''} onChange={(e) => editarLlm('confianca_minima', e.target.value === '' ? '' : Number(e.target.value))} />
            <p className="text-[11px] mt-1" style={mutedTxt}>Abaixo disso, a Ana prefere transferir para um humano a arriscar uma resposta errada.</p>
          </div>
        </Cartao>

        <Cartao titulo="Transcrição de áudio (STT)">
          <div>
            <label className={rotuloCls} style={mutedTxt}>Provedor (stt.provedor)</label>
            <select className={campoCls} style={campoStyle} value={draft.stt?.provedor || ''} onChange={(e) => editarStt('provedor', e.target.value)}>
              {STT_PROVEDORES.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
        </Cartao>
      </div>

      <Cartao titulo="IDs Kommo (somente leitura)"
        dica="Configurados no Kommo: Leads → funil Venda → Automatizar → Bots/Salesbot (mesmo processo do bot de Cobrança — ver docs/COBRANCA_SALESBOT_SETUP.md). Para corrigir um ID, edite bot_config → agenda_bot → kommo direto no Supabase.">
        <div className="grid sm:grid-cols-3 gap-3">
          <div>
            <label className={rotuloCls} style={mutedTxt}>campo_ana_id</label>
            <input type="text" disabled className={`${campoCls} opacity-70 cursor-not-allowed`} style={campoStyle} value={kommo.campo_ana_id ?? '— não configurado —'} readOnly />
          </div>
          <div>
            <label className={rotuloCls} style={mutedTxt}>salesbot_id</label>
            <input type="text" disabled className={`${campoCls} opacity-70 cursor-not-allowed`} style={campoStyle} value={kommo.salesbot_id ?? '— não configurado —'} readOnly />
          </div>
          <div>
            <label className={rotuloCls} style={mutedTxt}>salesbot_template_id</label>
            <input type="text" disabled className={`${campoCls} opacity-70 cursor-not-allowed`} style={campoStyle} value={kommo.salesbot_template_id ?? '— não configurado —'} readOnly />
          </div>
        </div>
      </Cartao>

      <BarraSalvar onSalvar={salvarSaneado} salvando={salvando} salvo={salvo} />
    </div>
  );
}
