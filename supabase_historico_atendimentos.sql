-- =============================================================================
-- HISTORICO DE ATENDIMENTOS EM VIDEOCHAMADAS, POR EVENTO (pedido Paulo 04/08/2026)
-- Migracao aplicada em producao via MCP em 04/08/2026 (nome: historico_atendimentos).
-- Irma da vw_noshow_acervo (agregada por pessoa, serve campanha de disparo): esta
-- view e no nivel do EVENTO, 1 linha por atendimento agendado, e cobre TODAS as
-- pessoas com agenda, nao so quem faltou. Decisao do Paulo (04/08/2026): mostrar
-- o historico completo, porque 176 das 617 pessoas do acervo faltaram E
-- compareceram depois, e mostrar so a falta trataria como problema quem ja
-- voltou. Consumida pela Task 2 (funcao de consulta da tela do SDR) para exibir
-- o historico de uma pessoa no momento de agendar.
-- Desfecho segue a mesma regra da vw_noshow_acervo: meet_status vence a cor
-- (decisao do Paulo em 23/07/2026); 'excluida' nunca conta como falta.
-- Exposicao: view "security definer" (default), SELECT para authenticated e
-- powerbi_cbc; anon sem acesso (dado pessoal: telefone e nome de lead).
-- Validacao 04/08/2026 (Step 4, zero divergencia exigida contra vw_noshow_acervo,
-- mesmo metodo do item 175): pessoas_no_acervo=617, pessoas_na_view=617,
-- divergencias=0. Distribuicao de desfechos (Step 6, valores aproximados porque
-- a agenda sincroniza sozinha varias vezes ao dia): compareceu=2127, faltou=721,
-- excluida=29, agendada=25 (total 2902 linhas) -- nenhum nulo, nenhum 'remarcada'.
--
-- CORRECAO DE REVIEW (04/08/2026, mesmo dia): idx_agenda_vc_telefone (btree na
-- coluna crua agenda_videochamadas.telefone) NUNCA era usado por esta view. A
-- causa: telefone da view e uma EXPRESSAO (CASE + CROSS JOIN LATERAL +
-- regexp_replace canonizando p/ DDD+8), nao passagem direta da coluna indexada
-- -- o planner nao empurra um filtro de igualdade sobre expressao calculada
-- para um indice btree na coluna crua. Provado com EXPLAIN (ANALYZE, BUFFERS)
-- em select * from vw_pessoa_atendimentos where telefone = '1166161366':
--   ANTES: Seq Scan on agenda_videochamadas, Execution Time 10.852 ms, "Rows
--          Removed by Filter: 2937", Buffers: shared hit=189. Indice
--          idx_agenda_vc_telefone presente mas nao usado.
--   DEPOIS: Index Scan using idx_agenda_vc_telefone_canon, Execution Time
--          0.954 ms, "Index Cond: (cbc_telefone_canonico(telefone) =
--          '1166161366'::text)", Buffers: shared hit=78 read=2.
-- Fix: extraida a EXATA logica de canonizacao que ja estava inline na view
-- (sem reinterpretar -- conferido com 0 mismatches contra a expressao antiga
-- nas 2941 linhas de agenda_videochamadas, nulos/vazios/malformados
-- inclusive) para a funcao imutavel public.cbc_telefone_canonico(text).
-- Indice de EXPRESSAO criado sobre essa mesma funcao
-- (idx_agenda_vc_telefone_canon); a view passou a chamar a funcao em vez do
-- CASE+LATERAL inline, para o planner casar o filtro com o indice depois do
-- inlining da view. Resultado da view idem: checksum md5 de todas as colunas
-- de todas as 2902 linhas (event_id+telefone+desfecho+kommo_lead_id+nome+
-- vendedora+via_meet, ordenado por event_id), calculado imediatamente antes e
-- imediatamente depois da correcao: 2c2454c29a868f3714f7f105a13e7377 nos dois
-- casos (identico). idx_agenda_vc_telefone (raiz do problema, e sem nenhum
-- consumidor que filtre a coluna crua por igualdade -- conferido em
-- pg_stat_statements: as poucas ocorrencias historicas de "telefone" em
-- queries contra agenda_videochamadas sempre transformam o valor antes de
-- comparar, ex. right(regexp_replace(...),8) ou fn_tel_key()/fone_chave(),
-- nenhuma delas casa com um indice simples na coluna crua) foi DROPADO para
-- nao deixar peso morto. idx_agenda_vc_lead NAO foi tocado -- Index Scan
-- confirmado (Index Cond: lead_id = ..., 0.106 ms) antes e depois desta
-- correcao, exatamente como o review apontou que ja estava certo.
-- Duas funcoes de canonizacao de telefone ja existiam no schema (fn_tel_key,
-- fone_chave) mas NENHUMA bate byte a byte com a regra desta view em casos
-- malformados: fone_chave descarta (vira NULL) qualquer resultado com mais de
-- 11 digitos apos tirar o 55 (a view aceita qualquer tamanho >=10, sem teto);
-- fn_tel_key devolve o valor cru (nao NULL) quando o resultado tem menos de
-- 10 digitos (a view devolve NULL). Por isso funcao nova em vez de reuso --
-- reaproveitar qualquer uma arriscaria mudar o resultado da view para
-- telefones malformados, fora do escopo autorizado desta correcao.
-- Reconferencia completa (Step 4/5/6 do brief) depois da correcao, no mesmo
-- dia: pessoas_no_acervo=618, pessoas_na_view=618, divergencias=0; caso
-- conhecido (1166161366) com as mesmas 4 linhas faltou/marianamaciel; e
-- compareceu=2127/faltou=722/excluida=29/agendada=24 (total 2902) -- as
-- pequenas variacoes vs. os numeros do paragrafo anterior (721->722 faltou,
-- 25->24 agendada, 617->618 pessoas) sao sincronizacao normal da agenda entre
-- as duas rodadas de conferencia (horas de diferenca), nao regressao: a
-- comparacao por checksum acima e no mesmo instante dos dois lados e bate
-- exata. Detalhe completo em .superpowers/sdd/task-1-report.md.
--
-- CORRECAO DE REVIEW (04/08/2026, sessao separada) -- DESAMBIGUACAO DE NOME.
-- Achado: o schema public tem quatro funcoes de canonizacao de telefone
-- (cbc_tel_canonico, fn_tel_key, fone_chave, cbc_telefone_canonico) e as duas
-- primeiras -- cbc_tel_canonico e cbc_telefone_canonico -- sao quase
-- homonimas com comportamento DIFERENTE em entrada malformada: (1) prefixo 55
-- -- cbc_tel_canonico so tira o 55 quando o comprimento e exatamente 12 ou
-- 13; cbc_telefone_canonico tira sempre que o comprimento e >=12, sem teto;
-- (2) poucos digitos (<10 apos a regra acima) -- cbc_tel_canonico devolve o
-- valor cru, cbc_telefone_canonico devolve NULL. Exemplo medido: entrada
-- 55119999999999 (14 digitos) -- cbc_tel_canonico devolve 5599999999 (trata
-- 55 como DDD), cbc_telefone_canonico devolve 1199999999 (trata 55 como
-- codigo de pais). cbc_tel_canonico e de fato compartilhada entre apps --
-- confirmado em uso por atendimento.ecossistema_contato,
-- atendimento.buscar_contatos e public.vw_telefones_suspeitos, alem desta
-- view. Fix: SO comentarios (via COMMENT ON FUNCTION) nas duas funcoes, cada
-- uma alertando da existencia da outra e descrevendo a diferenca com
-- exemplo. Nenhum corpo de funcao foi alterado -- corpos conferidos byte a
-- byte (pg_get_functiondef) antes/depois da migracao
-- "desambiguar_comentario_telefone_canonico", identicos nos dois momentos.
-- Achado a parte, fora do escopo desta correcao: existe uma QUINTA funcao,
-- cbc_fone_key, com corpo funcionalmente identico ao de cbc_tel_canonico
-- (mesmo algoritmo, CTEs com nomes diferentes) -- candidata a duplicata mas
-- nao mexida aqui. Detalhe completo em .superpowers/sdd/task-1-report.md.
-- =============================================================================

-- Funcao de canonizacao de telefone (extraida da expressao que antes ficava
-- inline na view -- ver "CORRECAO DE REVIEW" acima). Usada pela view E pelo
-- indice de expressao logo abaixo, para garantir que o planner sempre consiga
-- casar os dois (mesma chamada de funcao dos dois lados).
create or replace function public.cbc_telefone_canonico(p_telefone text)
returns text
language sql
immutable
parallel safe
set search_path to 'public', 'pg_temp'
as $$
  select case when length(dd) >= 10 then left(dd,2)||right(dd,8) end
  from (
    select case
      when regexp_replace(coalesce(p_telefone,''),'\D','','g') ~ '^55'
           and length(regexp_replace(coalesce(p_telefone,''),'\D','','g')) >= 12
      then substr(regexp_replace(coalesce(p_telefone,''),'\D','','g'),3)
      else regexp_replace(coalesce(p_telefone,''),'\D','','g')
    end as dd
  ) c;
$$;

comment on function public.cbc_telefone_canonico(text) is
'Canoniza telefone para DDD+8 digitos (mesma regra usada em vw_pessoa_atendimentos e vw_noshow_acervo): tira nao-digitos, tira prefixo 55 se aplicavel, e se sobrarem >=10 digitos devolve os 2 primeiros + ultimos 8; senao NULL. Extraida em 04/08/2026 do CASE+LATERAL que estava inline em vw_pessoa_atendimentos, para permitir indice de expressao (correcao de review: idx_agenda_vc_telefone nao era usado pela view porque telefone e uma coluna calculada, nao passagem direta). ATENCAO (review 04/08/2026): esta funcao NAO e a public.cbc_tel_canonico, que e o normalizador de telefone COMPARTILHADO entre outros aplicativos do escritorio (usada em atendimento.ecossistema_contato, atendimento.buscar_contatos e public.vw_telefones_suspeitos) -- os nomes sao quase homonimos e e facil trocar uma pela outra sem perceber. Elas divergem em entrada malformada: (1) prefixo 55 -- esta funcao tira o 55 quando os digitos tem 12 ou mais, sem teto; cbc_tel_canonico so tira quando o comprimento e exatamente 12 ou 13; (2) poucos digitos, menos de 10 apos a regra acima -- esta funcao devolve NULL; cbc_tel_canonico devolve o valor cru (nao NULL). Exemplo medido: para a entrada 55119999999999 (14 digitos), esta funcao devolve 1199999999 (DDD 11, 55 tratado como codigo de pais) e cbc_tel_canonico devolve 5599999999 (55 tratado como DDD, nao descartado). Nunca usar uma no lugar da outra: cada uma foi calibrada para o consumidor que a chama.';

-- Correcao de review (04/08/2026, sessao separada): a public.cbc_tel_canonico
-- (funcao PRE-EXISTENTE, definida em outra migracao, COMPARTILHADA entre
-- aplicativos do escritorio -- ver uso confirmado no comentario abaixo) tem
-- nome quase identico a esta funcao e comportamento diferente em entrada
-- malformada (ver os dois comentarios). Sem o aviso, um humano ou uma sessao
-- futura trabalhando em outro app poderia trocar uma pela outra sem perceber.
-- NAO recriar o corpo de cbc_tel_canonico aqui -- ela pertence a outra
-- migracao/app; este bloco so acrescenta o comentario de alerta, nenhum
-- comportamento muda.
comment on function public.cbc_tel_canonico(text) is
'Chave canonica de telefone: DDD + os 8 ULTIMOS digitos. O corte em 8 e deliberado — e o que faz o mesmo numero casar nos formatos antigo (10 digitos) e novo (11, com o 9). Medido em 03/08/2026: das 200 colisoes existentes, 199 sao esse casamento correto e 1 e numero digitado errado. NAO troque por 9 digitos (item 260): quebraria as 199 para evitar nenhuma. Para achar entrada malformada use cbc_tel_problema(). ATENCAO (review 04/08/2026): existe uma funcao irma de nome quase igual, public.cbc_telefone_canonico, criada para o indice de expressao de public.vw_pessoa_atendimentos -- NAO e este normalizador e NAO deve ser confundida com ele. As duas divergem em entrada malformada: (1) prefixo 55 -- esta funcao (cbc_tel_canonico) so tira o 55 quando o comprimento e exatamente 12 ou 13 digitos; cbc_telefone_canonico tira sempre que o comprimento e >=12, sem teto; (2) poucos digitos, menos de 10 apos a regra acima -- esta funcao devolve o valor cru (nao NULL); cbc_telefone_canonico devolve NULL. Exemplo medido: para a entrada 55119999999999 (14 digitos), esta funcao devolve 5599999999 (55 tratado como DDD) e cbc_telefone_canonico devolve 1199999999 (55 tratado como codigo de pais, corretamente removido). Esta funcao (cbc_tel_canonico) e a compartilhada entre aplicativos -- confirmado em uso por atendimento.ecossistema_contato, atendimento.buscar_contatos e public.vw_telefones_suspeitos; cbc_telefone_canonico serve so a vw_pessoa_atendimentos. Nao trocar uma pela outra.';

-- Historico de comparecimento por pessoa, no nivel do EVENTO.
-- Irma da vw_noshow_acervo (que e agregada por pessoa e serve campanha).
-- Cobre TODAS as pessoas com agenda, nao so quem faltou: a decisao do Paulo
-- (04/08/2026) e mostrar historico completo, porque 176 das 617 pessoas do acervo
-- faltaram E compareceram, e mostrar so a falta trataria como problema quem ja
-- voltou.
create or replace view public.vw_pessoa_atendimentos as
select
  public.cbc_telefone_canonico(a.telefone) as telefone,
  a.event_id,
  a.scheduled_at,
  (a.scheduled_at at time zone 'America/Sao_Paulo') as quando_brt,
  split_part(coalesce(a.vendedora_email,''),'@',1) as vendedora,
  case
    when a.status = 'excluida' then 'excluida'
    when coalesce(a.meet_status, a.status) in ('realizada','fechou') then 'compareceu'
    when coalesce(a.meet_status, a.status) = 'no_show' then 'faltou'
    else 'agendada'
  end as desfecho,
  (a.meet_status is not null) as via_meet,
  a.lead_id as kommo_lead_id,
  nullif(trim(a.cliente_nome),'') as nome
from public.agenda_videochamadas a
where a.telefone is not null and a.telefone <> '';

comment on view public.vw_pessoa_atendimentos is
'Historico de comparecimento no nivel do evento: 1 linha por atendimento agendado, com telefone canonico DDD+8 (via public.cbc_telefone_canonico, indexado), desfecho (compareceu/faltou/excluida/agendada) e via_meet (true=auditoria do Meet, false=cor da agenda). Auto-atualizada a partir de agenda_videochamadas. Criada 04/08/2026; indice de telefone corrigido em 04/08/2026 (review).';

-- Indice de EXPRESSAO sobre a mesma funcao que a view chama: e o que faz o
-- planner casar o filtro `telefone = 'X'` da view com um indice depois do
-- inlining da view (um btree comum na coluna crua NAO serve -- ver nota no
-- cabecalho). Substitui idx_agenda_vc_telefone, que foi dropado no fim deste
-- arquivo por ter ficado sem nenhum uso.
create index if not exists idx_agenda_vc_telefone_canon
  on public.agenda_videochamadas (public.cbc_telefone_canonico(telefone));

-- este continua certo: kommo_lead_id e passagem direta da coluna (sem
-- expressao no meio), Index Scan confirmado antes e depois da correcao acima
-- (Index Cond: lead_id = ..., 0.106 ms). Nao mexido.
create index if not exists idx_agenda_vc_lead on public.agenda_videochamadas (lead_id);

-- correcao de review 04/08/2026: este indice nunca era usado pela view (ver
-- cabecalho) e nenhuma outra consulta do projeto filtra a coluna crua
-- agenda_videochamadas.telefone por igualdade -- substituido pelo indice de
-- expressao acima. Removido em vez de deixar peso morto.
drop index if exists public.idx_agenda_vc_telefone;

revoke all on public.vw_pessoa_atendimentos from anon;
grant select on public.vw_pessoa_atendimentos to authenticated;
grant select on public.vw_pessoa_atendimentos to powerbi_cbc;
