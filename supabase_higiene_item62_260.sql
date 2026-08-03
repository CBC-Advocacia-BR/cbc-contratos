-- ═══════════════════════════════════════════════════════════════════════════
-- Auditoria 01/08/2026 — itens 62 e 260
-- Aplicado em producao em 03/08/2026
--   migracoes: indices_duplicados_ads_item62, telefones_suspeitos_item260 (+ _v2)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ITEM 62 — 4 pares de indices IDENTICOS na familia ads_* (atribuicao de anuncio e
-- eventos da CAPI da Meta). Indice duplicado nao acelera nada: o planejador usa um so.
-- O custo e de ESCRITA, e ads_capi_events recebe evento de hora em hora.
-- Conferido par a par: em cada um, UM sustenta constraint e o outro e avulso.
--   ads_attribution (ctwa_clid)  mantido _key (constraint) | removido _uidx
--   ads_attribution (wa_phone)   mantido waphone_idx       | removido idx_..._phone (0 usos)
--   ads_capi_events (event_id)   mantido _key (constraint) | removido _uidx
--   ads_settings    (key)        mantido pkey (primaria)   | removido key_uidx
-- Depois: 0 pares duplicados, 3 constraints intactas, dados preservados.
drop index if exists public.ads_attribution_ctwa_uidx;
drop index if exists public.idx_ads_attribution_phone;
drop index if exists public.ads_capi_events_event_id_uidx;
drop index if exists public.ads_settings_key_uidx;

-- ═══════════════════════════════════════════════════════════════════════════
-- ITEM 260 — ⚠️ A CANONIZACAO NAO FOI ALTERADA, e o motivo importa.
--
-- O item pede "usar o DDD+9 quando disponivel" para nao fundir pessoas distintas.
-- Medido no banco em 03/08/2026 sobre 4.888 numeros distintos:
--     200 colisoes de chave canonica
--     199 sao o MESMO numero com e sem o 9º digito  <- e para isso que a funcao existe
--       1 e '34655222777', celular que nao comeca com 9 = erro de digitacao
-- Passar a 9 digitos quebraria 199 fusoes CORRETAS para evitar zero erradas.
--
-- O problema real esta na ENTRADA. Em clientes.telefone: 609 cadastros suspeitos —
-- 288 com VARIOS telefones no mesmo campo separados por barra (esses geram uma chave
-- Frankenstein, com o DDD do primeiro e os digitos finais do ultimo, que nao pertence a
-- ninguem), 232 celulares a que faltou um digito, 36 com 11 digitos sem comecar com 9.
-- cliente_telefones (alimentada pelo sync) esta 100% limpa: 5.129 numeros, zero
-- problemas. A sujeira vem do que foi digitado a mao.
-- ═══════════════════════════════════════════════════════════════════════════

comment on function public.cbc_tel_canonico(text) is
  'Chave canonica de telefone: DDD + os 8 ULTIMOS digitos. O corte em 8 e deliberado — e '
  'o que faz o mesmo numero casar nos formatos antigo (10 digitos) e novo (11, com o 9). '
  'Medido em 03/08/2026: das 200 colisoes existentes, 199 sao esse casamento correto e 1 '
  'e numero digitado errado. NAO troque por 9 digitos (item 260): quebraria as 199 para '
  'evitar nenhuma. Para achar entrada malformada use cbc_tel_problema().';

create or replace function public.cbc_tel_problema(p text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  with a as (select coalesce(p,'') as bruto, regexp_replace(coalesce(p,''),'\D','','g') as x),
       b as (select bruto, case when length(x) in (12,13) and left(x,2)='55' then substr(x,3) else x end as d from a)
  select case
    when d = ''                                  then 'vazio'
    when bruto ~ '[/;,]|\se\s' and length(d) > 11 then 'vários telefones no mesmo campo (separe em cliente_telefones)'
    when length(d) > 13                           then 'vários telefones no mesmo campo (separe em cliente_telefones)'
    when length(d) < 10                           then 'curto demais (' || length(d) || ' dígitos)'
    when length(d) > 11                           then 'longo demais (' || length(d) || ' dígitos)'
    when left(d,2)::int not between 11 and 99     then 'DDD inválido (' || left(d,2) || ')'
    when length(d) = 11 and substr(d,3,1) <> '9'  then 'tem 11 dígitos mas não começa com 9 (celular deveria)'
    when length(d) = 10 and substr(d,3,1) = '9'   then 'parece celular a que faltou um dígito'
    else null
  end
  from b;
$$;

comment on function public.cbc_tel_problema(text) is
  'Item 260 — devolve o motivo de um telefone parecer errado, ou null se esta ok. Serve '
  'para a equipe achar o que corrigir; a canonizacao segue tolerante de proposito.';

create or replace view public.vw_telefones_suspeitos as
select
  c.id, c.nome, c.telefone,
  public.cbc_tel_problema(c.telefone) as problema,
  public.cbc_tel_canonico(c.telefone) as chave_gerada
from public.clientes c
where c.telefone is not null and c.telefone <> ''
  and public.cbc_tel_problema(c.telefone) is not null;

comment on view public.vw_telefones_suspeitos is
  'Item 260 — telefones de clientes que parecem digitados errado. Nao bloqueiam nada: '
  'existem para serem corrigidos a mao, porque um numero errado significa cobranca e '
  'lembrete que nao chegam.';

grant select on public.vw_telefones_suspeitos to authenticated;
grant execute on function public.cbc_tel_problema(text) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- Auditoria 01/08/2026 — item 158 (painel unico de logs)
-- Aplicado em 03/08/2026 (migracao painel_unico_de_logs_item158)
-- ═══════════════════════════════════════════════════════════════════════════
-- Entender um incidente exigia abrir TRES telas e cruzar horarios na cabeca:
-- advbox_api_log (robos), asaas_error_log (cobranca) e automation_log (contratos), cada
-- uma com nome de coluna proprio para dizer a mesma coisa.
-- Medido em 03/08: 2.054 registros em 7 dias nas 4 fontes.
-- activity_log entra so como rastro ('info') e nunca alarma: ela registra ACAO DE
-- USUARIO, e num incidente o que interessa dela e "quem mexeu perto da hora".
create or replace view public.vw_logs_unificados as
  select a.created_at as quando, 'robôs/integrações'::text as fonte,
         coalesce(a.origem,'advbox') as origem, lower(coalesce(a.nivel,'info')) as nivel,
         a.mensagem, a.contexto as detalhe, null::text as referencia,
         coalesce(a.visto,false) as visto
  from public.advbox_api_log a
  union all
  select e.created_at, 'cobrança (Asaas)', coalesce(e.source,'asaas'), 'erro',
         e.message, e.context, null, false
  from public.asaas_error_log e
  union all
  select m.created_at, 'automação de contrato', coalesce(m.action,'automacao'),
         case when m.status ilike 'error%' or m.status ilike 'fail%' then 'erro'
              when m.status ilike 'warn%' then 'aviso' else 'info' end,
         coalesce(m.client_name,'(sem cliente)') || ' — ' || coalesce(m.action,'?')
           || ': ' || coalesce(m.status,'?'),
         m.details, m.contract_id::text, false
  from public.automation_log m
  union all
  select l.created_at, 'ação de usuário', coalesce(l.action,'app'), 'info',
         coalesce(l.user_email,'(sem usuário)') || ' — ' || coalesce(l.action,'?'),
         l.details, l.calc_id, false
  from public.activity_log l;

comment on view public.vw_logs_unificados is
  'Item 158 — as quatro fontes de log numa linha so, com vocabulario unico. Existe para '
  'nao precisar cruzar tres telas durante um incidente.';

grant select on public.vw_logs_unificados to authenticated;
