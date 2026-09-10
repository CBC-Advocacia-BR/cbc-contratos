-- supabase_sdr_ia_config.sql — parametros do SDR de IA (Ana fora do horario). Nao liga nada:
-- ativo continua false e modo_teste true ate o piloto. (max_tokens 2048: thinking conta no teto)
update bot_config set value = value
  || jsonb_build_object('llm', coalesce(value->'llm','{}'::jsonb) || '{"modelo":"claude-opus-5","effort":"low","max_tokens":2048}'::jsonb)
  || jsonb_build_object('kommo', coalesce(value->'kommo','{}'::jsonb) || jsonb_build_object(
       'pipeline_sdr', 14170107,
       'etapas', jsonb_build_object('em_qualificacao',109397015,'follow_up_bot',109400411,'precisa_humano',109397011,
                                    'agendada',109397019,'nao_compareceu',109397023,'nao_quer',110972323,'cliente',111135391)))
  || '{"gatilhos":[{"pipeline_id":14170107},{"pipeline_id":13916619,"desde_inicio":true}]}'::jsonb
  || '{"roteamento":{"limiar":3,"preferida":"marianamaciel@advocaciacbc.com","janela_dias_uteis":2,"valor_alto_min":30000}}'::jsonb
  || jsonb_build_object('mensagens', coalesce(value->'mensagens','{}'::jsonb) || '{"transicao_humano":"Vou pedir para a nossa equipe continuar com você no próximo horário de atendimento. Obrigada pela paciência!"}'::jsonb)
  || '{"modo_teste":true,"ativo":false}'::jsonb
where key = 'agenda_bot';

-- (Paulo preenche) fatos que a Ana pode citar. Exemplo de linha, a validar:
-- insert into sdr_ia_fatos (chave, texto, fonte, verificado_por, verificado_em)
--   values ('sede', 'O escritório fica em Americana/SP e atende clientes em todo o Brasil.', 'site', 'Paulo', now());
