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

-- =============================================================================
-- FUNCAO DE CONSULTA POR PESSOA (Task 2, pedido Paulo 04/08/2026)
-- Migracao aplicada em producao via MCP em 04/08/2026 (nome: historico_atendimentos_fn).
-- Le o historico de UMA pessoa a partir de vw_pessoa_atendimentos (Task 1), pronto para
-- a tela do painel SDR no momento de agendar. Recebe telefone em qualquer formato
-- (E.164, mascara ou ja canonico) e/ou kommo_lead_id; devolve jsonb com resumo
-- (faltas/comparecimentos/total/ultima_falta) e a lista de eventos do mais recente para
-- o mais antigo, so com desfecho faltou/compareceu (excluida e agendada ficam de fora:
-- nao sao historico de comparecimento).
--
-- DESVIO DO BRIEF (proposital, decidido antes de aplicar): o brief de Task 2 trazia a
-- canonizacao de telefone escrita INLINE de novo, dentro de uma CTE `canon`, duplicando
-- byte a byte a logica que a Task 1 ja extraiu para public.cbc_telefone_canonico(). Essa
-- duplicacao e exatamente o erro que a spec deste projeto ja registrou duas vezes (mapas
-- do ADVBOX, campos obrigatorios do contrato). A CTE `canon` abaixo so CHAMA
-- public.cbc_telefone_canonico(p_telefone) -- a mesma funcao que a coluna telefone de
-- vw_pessoa_atendimentos usa e que o indice idx_agenda_vc_telefone_canon indexa -- para
-- dar ao planner a melhor chance de casar o filtro com o indice depois de inlinear a
-- view. Fora essa troca, a funcao segue o brief literalmente (assinatura, security
-- invoker, search_path, grants).
--
-- NAO E WRAPPER DE vw_noshow_acervo (que leva 642 ms por calcular os cruzamentos das
-- ~618 pessoas antes de filtrar uma): esta funcao canoniza o telefone primeiro (CTE
-- canon) e so entao filtra vw_pessoa_atendimentos na entrada (CTE ev), sem nunca
-- materializar todas as pessoas.
--
-- DESEMPENHO (medido 04/08/2026, Step 7):
-- `explain (analyze, format text) select public.historico_atendimentos('5511966161366')`
-- mostra so um no `Result` (actual time entre 3.603 e 3.717 ms em execucoes sucessivas)
-- -- a funcao NAO e inlineada pelo planner por causa do `set search_path` (uma funcao
-- SQL com proconfig, isto e com qualquer clausula SET, nunca e inlineada, mesmo sendo
-- STABLE/IMMUTABLE), entao o EXPLAIN externo nao desce no plano interno. Execution Time
-- (top-level, o numero que importa para o requisito <50 ms): 3.698 ms e 3.717 ms em
-- duas medicoes -- cerca de 13x de folga.
--
-- PROVA DE USO DO INDICE (nao presumida -- o EXPLAIN de fora fica opaco, entao a
-- confirmacao veio por dois caminhos independentes):
-- (1) pg_stat_user_indexes.idx_scan de idx_agenda_vc_telefone_canon medido antes/depois
--     de 6 chamadas reais da funcao (1 explain analyze + 5 via generate_series): foi de
--     10 para 16, incremento EXATO de 6 -- cada chamada usou o indice exatamente 1 vez,
--     nenhuma caiu para seq scan.
-- (2) O corpo da funcao rodado avulso, fora da funcao (mesmas CTEs canon/ev, telefone
--     literal no lugar do parametro), com o EXPLAIN de fora enxergando tudo:
--       Aggregate (actual time=0.050..0.051 rows=1 loops=1)
--        -> Index Scan using idx_agenda_vc_telefone_canon on agenda_videochamadas a
--             (actual time=0.025..0.028 rows=4 loops=1)
--           Index Cond: (cbc_telefone_canonico(telefone) = '1166161366'::text)
--       Execution Time: 0.112 ms
--     A diferenca entre esse 0,112 ms (so a leitura indexada) e os ~3,6-3,7 ms da
--     funcao completa e overhead fixo de chamada de funcao (SPI) + parsing/planning
--     internos -- nao escala com o tamanho da tabela, entao a folga so cresce se o
--     volume da agenda crescer.
--
-- Conferencia funcional (Steps 4-6 do brief): telefone 5511966161366 / mascara
-- (11) 96616-1366 / canonico 1166161366 / lead 18234162 -> faltas=4 nos 4 formatos;
-- telefone 1172672721 (caso misto, motivo de existir a decisao de historico completo) ->
-- faltas=3, comparecimentos=2, total=5, 1o evento de `eventos` e 17/03/26 11:30
-- compareceu com via_meet=true; telefone 11999999999 (nunca faltou) ->
-- {faltas:0, comparecimentos:0, total:0, eventos:[]}, nunca null. Contagens podem variar
-- entre execucoes porque a agenda sincroniza sozinha varias vezes ao dia (mesma
-- observacao da vw_pessoa_atendimentos); ordem de `eventos` e o via_meet do 1o item nao.
--
-- Seguranca (Step 8): `set local role anon` seguido da chamada -> ERRO 42501 permission
-- denied for function historico_atendimentos (confirmado). `set local role authenticated`
-- seguido da chamada -> devolve normalmente (confirmado, faltas=4) -- a view por baixo
-- continua security definer (default; decisao da Task 1: agenda_videochamadas tem RLS
-- com zero policies, entao security_invoker faria authenticated ler 0 linhas), e esta
-- funcao e security invoker so para o proprio privilegio de EXECUTE, nao para o acesso a
-- tabela por baixo.
--
-- CORRECAO DE REVIEW (04/08/2026, sessao separada) -- PRECEDENCIA TELEFONE x LEAD.
-- Achado do revisor (Importante, medido): a regra de casamento original era um OR puro
-- entre telefone e lead. Se os dois parametros pertencessem a PESSOAS DIFERENTES, a
-- funcao devolvia a UNIAO dos dois historicos, sem nenhuma marca de qual evento era de
-- quem. Medido: telefone 1172672721 sozinho = 5 eventos (pessoa A); lead 12782548
-- sozinho = 4 eventos (pessoa B); os dois juntos = 9 (soma silenciosa das duas pessoas).
-- Risco real neste escritorio, que ja teve incidente de lead do Kommo mesclado ou
-- desatualizado apontando para a pessoa errada.
-- Decisao do Paulo (04/08/2026): telefone tem PRECEDENCIA; lead e RESERVA, so entra
-- quando o telefone nao resolve. Regra final:
--   - telefone canoniza para nao-nulo -> casa SO por telefone; p_lead_id e ignorado.
--   - telefone nulo/vazio/nao canoniza -> casa por p_lead_id (se houver).
--   - os dois nulos -> objeto vazio de sempre (nenhuma linha em ev, como ja era).
-- Fix (minimo, cirurgico): acrescentado "c.tel is null" na condicao do lead. As duas
-- metades do OR ficam mutuamente exclusivas em c.tel is [not] null -- no maximo uma
-- pode valer por chamada, entao nunca mais uniao de duas pessoas.
-- Reconferido apos a correcao, mesmo dia: telefone 1172672721 sozinho continua total=5
-- (nao regrediu), lead 12782548 sozinho continua total=4 (reserva intacta, nao quebrou),
-- e os dois juntos caiu de 9 para 5 (so o historico do telefone; lead ignorado). Steps
-- 4-6 do brief reconferidos sem regressao (Step 4 exercita a propria reserva:
-- historico_atendimentos(null, 18234162) -> faltas=4, igual a antes). Entradas
-- malformadas ('', '   ', 'abcdefgh', chamada sem nenhum argumento) continuam devolvendo
-- o objeto vazio, nunca erro. Seguranca (Step 8) reconferida: anon segue com ERRO 42501
-- permission denied; authenticated segue executando normalmente (grants em
-- information_schema.routine_privileges inalterados: authenticated/postgres/
-- service_role, sem anon nem public).
-- DESEMPENHO/PROVA continuam validos (medido de novo depois da correcao, mesmo metodo
-- do Step 7 -- ver bloco DESEMPENHO acima): Execution Time top-level entre 4,8 e 5,1 ms
-- em varias medicoes (o `set search_path` continua impedindo o inlining, entao o
-- EXPLAIN externo continua opaco -- ver nota da 1a aplicacao). Para provar sem presumir,
-- liguei auto_explain NA SESSAO (log_min_duration=0, log_nested_statements=true,
-- log_analyze=true, log_buffers=true -- o modulo ja vem pre-carregado neste Supabase,
-- LOAD e bloqueado) e li o log via MCP get_logs: a query interna (CTEs canon/ev) para
-- $1='1172672721', $2='12782548' -- o EXATO caso do revisor -- levou 2,682 ms e o plano
-- mostrou:
--   Bitmap Heap Scan on agenda_videochamadas a (actual time=0.821..2.600 rows=5 loops=1)
--     Recheck Cond: ((cbc_telefone_canonico(telefone) = cbc_telefone_canonico($1))
--                    OR (lead_id = $2))
--     Filter: (... AND (((cbc_telefone_canonico($1) IS NOT NULL) AND
--              (cbc_telefone_canonico(telefone) = cbc_telefone_canonico($1))) OR
--              ((cbc_telefone_canonico($1) IS NULL) AND ($2 IS NOT NULL) AND
--              (lead_id = $2))))
--     Rows Removed by Filter: 4
--     ->  BitmapOr (actual time=0.239..0.240 rows=0 loops=1)
--           ->  Bitmap Index Scan on idx_agenda_vc_telefone_canon (actual rows=5 loops=1)
--                 Index Cond: (cbc_telefone_canonico(telefone) = cbc_telefone_canonico($1))
--           ->  Bitmap Index Scan on idx_agenda_vc_lead (actual rows=4 loops=1)
--                 Index Cond: (lead_id = $2)
-- Prova dupla no proprio plano: (1) idx_agenda_vc_telefone_canon continua em uso (Bitmap
-- Index Scan, Index Cond batendo com a expressao do indice) mesmo com os dois parametros
-- preenchidos; (2) os indices ainda trazem os 9 candidatos de antes (5 do telefone + 4
-- do lead, via BitmapOr), e e o Filter da nova regra que descarta exatamente os "Rows
-- Removed by Filter: 4" -- os 4 eventos da pessoa B -- antes de chegarem no resultado.
-- vw_pessoa_atendimentos, vw_noshow_acervo e cbc_telefone_canonico NAO foram tocadas --
-- so o WHERE desta funcao mudou (nada de logica de canonizacao duplicada).
-- =============================================================================

-- Historico de comparecimento de UMA pessoa, pronto para a tela.
-- Aceita telefone em qualquer formato (5511966161366, (11) 96616-1366, 1166161366)
-- e canoniza DENTRO do banco: a regra tem de existir num lugar so. Este projeto ja
-- se queimou com logica duplicada que divergiu (mapas do ADVBOX, campos obrigatorios).
-- Reusa public.cbc_telefone_canonico() (Task 1) em vez de duplicar a canonizacao
-- inline: e a mesma funcao que a view chama e que o indice de expressao
-- idx_agenda_vc_telefone_canon foi criado sobre, entao o filtro tem a melhor chance
-- de casar com o indice depois do planner inlinear a view.
-- PRECEDENCIA (correcao de review 04/08/2026, ver bloco acima): telefone manda. Se
-- canonizar para nao-nulo, casa SO por telefone e p_lead_id e ignorado; lead e RESERVA,
-- so casa quando telefone e nulo/vazio/nao canoniza. Antes era OR puro (uniao das duas
-- pessoas quando telefone e lead nao eram da mesma pessoa) -- ver correcao acima.
create or replace function public.historico_atendimentos(
  p_telefone text default null,
  p_lead_id  bigint default null
) returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with canon as (
    select public.cbc_telefone_canonico(p_telefone) as tel
  ),
  ev as (
    select v.quando_brt, v.vendedora, v.desfecho, v.via_meet, v.scheduled_at
    from public.vw_pessoa_atendimentos v, canon c
    where v.desfecho in ('faltou','compareceu')
      and ( (c.tel is not null and v.telefone = c.tel)
         or (c.tel is null and p_lead_id is not null and v.kommo_lead_id = p_lead_id) )
  )
  select jsonb_build_object(
    'faltas',          count(*) filter (where desfecho='faltou'),
    'comparecimentos', count(*) filter (where desfecho='compareceu'),
    'total',           count(*),
    'ultima_falta',    max(quando_brt) filter (where desfecho='faltou'),
    'eventos', coalesce(
      jsonb_agg(jsonb_build_object(
        'quando',    to_char(quando_brt,'DD/MM/YY HH24:MI'),
        'vendedora', vendedora,
        'desfecho',  desfecho,
        'via_meet',  via_meet
      ) order by scheduled_at desc), '[]'::jsonb)
  )
  from ev;
$$;

comment on function public.historico_atendimentos(text, bigint) is
'Historico de comparecimento de uma pessoa (faltas + presencas), pronto para a tela do painel SDR. Canoniza o telefone internamente via public.cbc_telefone_canonico() (fonte unica, mesma funcao usada por vw_pessoa_atendimentos e pelo indice idx_agenda_vc_telefone_canon). PRECEDENCIA (decisao do Paulo, correcao de review 04/08/2026): telefone manda -- se canonizar para nao-nulo, casa SO por telefone e p_lead_id e ignorado; lead e RESERVA, so casa quando o telefone e nulo/vazio/nao canoniza; os dois nulos devolvem o objeto vazio de sempre. Antes desta correcao era um OR puro (telefone OU lead), que misturava o historico de DUAS PESSOAS DIFERENTES quando telefone e lead nao pertenciam a mesma pessoa (medido: 5 + 4 = 9 eventos de gente distinta somados sem marca de origem) -- risco real neste escritorio, que ja teve lead do Kommo mesclado/desatualizado apontando para a pessoa errada. Filtra na entrada (nao e wrapper de vw_noshow_acervo). Criada 04/08/2026, precedencia corrigida no mesmo dia.';

revoke all on function public.historico_atendimentos(text, bigint) from anon, public;
grant execute on function public.historico_atendimentos(text, bigint) to authenticated;
