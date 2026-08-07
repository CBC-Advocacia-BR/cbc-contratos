# Historico de comparecimento no painel SDR (04/08/2026)

## Problema

A SDR marca a videochamada sem saber se a pessoa **ja faltou antes**. O dado existe e
esta completo desde mar/2025, mas hoje so serve para **campanha em massa**: o painel SDR
usa o acervo como fila ("Faltaram e podem voltar") e como alvo de disparo ("Acervo de
faltas, elegiveis"). No momento em que a decisao acontece, que e escolher o horario, a
tela nao diz nada.

O custo e concreto. Ha pessoas com 4 faltas seguidas, todas com a mesma vendedora, e a
agenda foi oferecida as 4 vezes como se fosse a primeira:

| Quando | Vendedora | Desfecho |
|---|---|---|
| 16/12/25 16:00 | marianamaciel | faltou |
| 18/12/25 10:30 | marianamaciel | faltou |
| 19/12/25 13:00 | marianamaciel | faltou |
| 23/12/25 10:30 | marianamaciel | faltou |

Cada uma dessas linhas e um horario nobre que nao foi para outro lead.

## Base de dados (medida em 04/08/2026)

- **617 pessoas** com pelo menos 1 falta, **721 faltas** no total.
- Em 31/07 o mesmo `select` devolvia 615 / 719. **Ninguem tocou em nada**: a
  `vw_noshow_acervo` deriva da agenda e se atualiza sozinha. E a prova de que o acervo
  esta vivo.
- **176 das 617 (28,5%) faltaram E compareceram** em outra call. 441 so faltaram.
  Este numero e o que define a decisao 1 abaixo.
- Casamento Kommo <-> agenda validado em amostra de 300: **300 de 300** batem pela
  canonizacao do telefone. O painel nao vai procurar e nao achar por diferenca de formato.

## Decisoes (Paulo, 04/08/2026)

1. **Historico completo, nao so as faltas.** Mostrar apenas as faltas trataria como
   problema as 176 pessoas que ja voltaram. Comparecimentos entram na mesma lista; o
   destaque continua sendo a contagem de faltas.
2. **Selo na fila + lista no modal Agendar.** A triagem acontece na fila: descobrir o
   historico so depois de abrir o modal ja gastou o tempo da SDR.
3. **Informa e sugere, sem travar.** Para quem faltou 2x ou mais, o horario sugerido passa
   a ser o mais proximo disponivel e a call entra na confirmacao da manha. A SDR ignora e
   marca o que quiser. Sem passo extra, sem bloqueio.

## Desenho

### Backend (producao)

**`vw_pessoa_atendimentos`** — view irma da `vw_noshow_acervo`, agora no nivel do
**evento**. Uma linha por atendimento agendado, de **todas** as pessoas com agenda (nao so
quem faltou, por causa da decisao 1):

| Coluna | Conteudo |
|---|---|
| `telefone` | canonico DDD + 8 digitos, mesma chave do acervo |
| `quando` | `scheduled_at` em BRT |
| `vendedora` | usuario antes do @ |
| `desfecho` | `compareceu` (`realizada` + `fechou`) / `faltou` (`no_show`) / `excluida` / `agendada` |
| `via_meet` | true = auditoria do Meet; false = cor da agenda |
| `kommo_lead_id`, `event_id` | rastreio |

Nao existe status `remarcada` no banco: a remarcacao aparece como um evento novo, e o
antigo fica com o desfecho que teve. A regra do desfecho e a mesma do acervo
(`meet_status` vence a cor, decisao do Paulo em 23/07), e `excluida` nunca conta como
falta.

**Por que `via_meet` importa:** em **108 eventos a auditoria contradisse a cor** que a
equipe marcou (84 estavam como `agendada` e a pessoa compareceu, 15 como `agendada` e
faltou, 4 como `realizada` que o Meet desmentiu, 1 o contrario). Quando a tela diz
"faltou", a SDR precisa poder saber se aquilo veio da auditoria do Meet, que e prova, ou
da cor que alguem marcou na agenda, que e julgamento.

Mesma origem do acervo (`agenda_videochamadas`), entao **zero job novo**: sincronizou a
agenda, o historico esta atualizado.

**`historico_atendimentos(p_telefone text, p_lead_id bigint default null)`** — funcao de
consulta. Recebe o telefone em qualquer formato, **canoniza dentro do banco**, casa por
telefone OU lead, devolve `{resumo, eventos[]}` pronto para a tela.

> **Por que funcao e nao consulta solta:** a canonizacao (tirar o `55`, cortar o 9o
> digito) precisa existir num lugar so. Este projeto ja se queimou duas vezes com logica
> duplicada que divergiu: os mapas do ADVBOX (causou o bug do Edmar) e a regra de campos
> obrigatorios do contrato. Se o painel canonizar em JS, um dia as duas versoes vao
> discordar e a tela vai dizer "nunca faltou" para quem faltou 4 vezes.

**Requisito de desempenho (medido em 04/08):** `select * from vw_noshow_acervo where
telefone = '...'` leva **642 ms**. A view calcula os cruzamentos (contratos via
`jsonb_array_elements`, cadastro unico, comparecimento) para **todas** as 617 pessoas e so
entao filtra uma. Serve para montar campanha; **nao serve para consulta por pessoa numa
tela**, ainda mais se a fila tiver 20 cards.

A funcao **nao pode ser um wrapper da view**. Ela tem de **canonizar primeiro e filtrar na
entrada**: resolver o telefone, buscar so os eventos daquela pessoa em
`agenda_videochamadas` (que tem indice por telefone), e so entao decidir o desfecho de
cada um. Alvo: **abaixo de 50 ms**. A conferencia de desempenho entra na validacao.

Exposicao igual a do acervo: `authenticated` e `powerbi_cbc` leem, **`anon` nao** (telefone
e nome de lead sao dado pessoal).

### Tela

**Card da fila:** selo curto `faltou 4x`. So aparece para quem tem falta; some para todo
mundo que nunca faltou. Tokens `--cbc-*`, com icone (nao sinaliza so por cor).

**Modal Agendar:** bloco "Historico com a gente" **acima** dos horarios, listando cada
atendimento do mais recente para o mais antigo, no formato `23/12 10h30, Mariana, faltou`.
Comparecimentos na mesma lista.

**Sugestao (decisao 3):** com 2+ faltas, o horario sugerido passa a ser o mais proximo
disponivel e a call ja entra na confirmacao da manha, com a frase explicando o porque. O
painel ja tem o numero que sustenta isso: call no mesmo dia falta 9,8% das vezes, contra
19% quando fica para depois de dois dias. Nada e bloqueado.

## Escopo

O painel SDR e **prototipo estatico** (`prototipos/sdr/index.html`), nao fala com o
Supabase. Entao:

- **Backend construido para valer**, em producao. E SQL, custo zero de manutencao, e serve
  qualquer tela futura (Dashboard, Saude do Funil, Power BI), nao so o painel.
- **Tela feita no prototipo**, com dados reais consultados agora, do mesmo jeito que o
  resto dele ja funciona.

Quando o painel virar app real, e trocar o dado embutido pela chamada da funcao, que ja
vai existir e estar testada.

## Fora de escopo (de proposito)

- Funil, Disparos e Templates do painel: nao mexer.
- Tabela nova ou rotina nova: nao existe. Tudo deriva da agenda que ja sincroniza.
- "Motivo da falta": o dado nao existe em lugar nenhum, nao vai ser inventado.
- Mudar a `vw_noshow_acervo`: ela continua como esta, servindo campanha. A view nova e
  irma, nao substituta.

## Como validar

1. **Numeros batem com o acervo:** `count(*) filter (where desfecho='faltou')` agrupado por
   telefone tem de reproduzir `qtd_noshow` da `vw_noshow_acervo`, pessoa a pessoa, com zero
   divergencia. Mesma conferencia que foi feita no item 175 antes de trocar a fonte da aba
   Boletos.
2. **Canonizacao:** telefone no formato Kommo (`5511999999999`) e no formato agenda
   (`1199999999`) tem de cair na mesma pessoa.
3. **Caso conhecido:** o telefone `1166161366` tem de devolver exatamente as 4 faltas de
   dezembro da tabela do inicio deste documento.
4. **Quem nunca faltou:** resposta vazia, sem selo e sem bloco na tela.
5. **Seguranca:** `SET ROLE anon` nao le a view nem executa a funcao.
6. **Desempenho:** a funcao tem de responder **abaixo de 50 ms** por pessoa (a view atual
   leva 642 ms; ver requisito acima). Medir com `explain analyze`, nao no olho.

## Frescor do dado (conferido em 04/08/2026)

O acervo **nao precisa de rotina de atualizacao**: e view, nao tabela. Nao existe copia
para envelhecer nem job para esquecer de rodar. A cadeia e:

```
Google Agenda  ->  agenda-videochamadas-sync  ->  agenda_videochamadas  ->  view calcula na leitura
                   meet-auditoria-sync (desfecho)
```

Como o painel SDR cria o evento no Google Agenda, **o que ele agenda ja alimenta o acervo
sozinho**. Nao ha passo de integracao a construir para isso.

Estado dos dois crons que sustentam a cadeia (04/08, 09h02, 42 min antes desta medicao):

| Cron | Estado | Ultimo resultado |
|---|---|---|
| `agenda-videochamadas-sync` | ok | 366 atendimentos de 1.077 eventos |
| `meet-auditoria-sync` | ok | 10 atualizadas de 13 conferencias |

**Cobertura da auditoria depois que ela passou a existir (23/07): 97,5%** (117 de 120).
Antes disso eram 66,6%, o que e historico e nao buraco atual. Correcao de uma anotacao
antiga: o Emerson **esta** sincronizado (93,3% em 90 dias), a nota de 23/07 que dizia o
contrario esta vencida.
