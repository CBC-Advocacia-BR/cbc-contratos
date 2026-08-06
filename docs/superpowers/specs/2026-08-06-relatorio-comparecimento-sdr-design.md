# Relatorio de comparecimento em videochamadas para a SDR (06/08/2026)

## Pedido

Paulo (06/08/2026): relatorio em PDF para a SDR com as tendencias de comparecimento,
metricas e o que mais for necessario, sobre todo o historico de
atendimentos/comparecimentos/agendamentos de chamadas.

## Decisoes de escopo (Paulo, 06/08/2026)

1. **Tom analitico completo** — todas as tabelas e cortes (mes a mes, dia, hora,
   coortes), sem capitulo de recomendacoes. Leituras factuais curtas junto das tabelas
   sao analise, nao playbook.
2. **Agregado, sem comparacao por vendedora** — 96% dos eventos sao da agenda da
   Mariana; Beatriz tem 98 e Emerson 22 (amostra pequena vira ruido). O dado por
   vendedora continua nos paineis de socios.
3. **Ponta comercial com taxas, sem R$** — % de conversao em contrato por desfecho da
   call; nenhum valor financeiro no material.
4. **Estrutura de 9 secoes aprovada** com producao direta na mesma sessao.

## Base

`vw_pessoa_atendimentos` (producao, criada na sessao de 04/08): 1 linha por atendimento
agendado. Panorama medido em 06/08/2026: **2.936 eventos, 2.579 pessoas,
mar/2025 -> ago/2026**; 2.146 compareceram, 733 faltaram (25,5% das 2.879 decididas),
27 futuras, 30 excluidas. Complementos: `agenda_videochamadas` (auditoria Meet:
duracao, espera, meet_status), `contratos` (conversao, via linkKommo -> lead_id).

## Achado que muda o conteudo

**Antecedencia de marcacao nao e mensuravel no historico.** O `raw` da agenda so guarda
summary/colorId/backfill/htmlLink (sem `created` do Google); `kommo_leads.criado_em` e
data de importacao (2.473 de 2.778 calls acontecem "antes" do lead existir);
`kommo_lead_conversa` so casa 22 calls. O numero do prototipo SDR ("mesmo dia falta
9,8% vs 19%") nao foi reproduzivel de nenhuma tabela atual — o relatorio **nao o
repete**. No lugar entra um corte calculavel so com a agenda: **intervalo entre a falta
e a remarcacao** (ate 1 dia = 29,1% falta de novo; 2+ dias = 40,0%).

## Estrutura (9 secoes)

1. Panorama (KPIs; ~10 horarios perdidos por semana)
2. Metodo e regua do dado (auditoria Meet desde 23/07 com 97,5% de cobertura vence a
   cor da agenda; excluidas fora; limitacao da antecedencia declarada)
3. Mes a mes (18 meses; verao dez-fev = 29-31% de falta vs 17-20% set/out; jul/26
   recorde de volume com falta abaixo da media; agosto parcial)
4. Dia da semana (quinta pior 28,2%; sabado 19,6% com n=51)
5. Horario (tarde 14h-16h = 27-29% vs manha 19-24%)
6. Reincidencia e segunda chance (616 faltaram na 1a; 230 tiveram 2a call; 60%
   compareceram; gap falta->remarcacao; distribuicao de faltas por pessoa)
7. Auditoria do Meet desde 23/07 (365 conferidas; mediana 16,5 min; 82 faltas
   comprovadas; 35 esperas de 2+ min; contradicoes auditoria x cor)
8. Depois da call (conversao em contrato assinado por desfecho, recalculada, sem R$)
9. Ficha tecnica (fontes, data de medicao, ressalvas)

## Entrega

- `relatorios/Comparecimento-videochamadas-analise-SDR-06-08-2026.html` + `.pdf`
- Padrao visual dos relatorios CBC (A4, capa navy #1B3A5C, dourado #C9A84C, tabelas,
  2 graficos SVG: linha mensal e barras por horario)
- PDF via Chrome headless a partir do HTML (padrao da casa)

## Validacao

- Todos os numeros re-medidos na data da producao, numa unica leva de SQL (nenhum
  numero de memoria/sessoes antigas sem re-conferencia; os que nao se reproduzem nao
  entram).
- Total de faltas por pessoa cruzado com `vw_noshow_acervo` (mesma conferencia da spec
  de 04/08).
- Percentuais so aparecem com amostra >= 10 (regra do item 241).
