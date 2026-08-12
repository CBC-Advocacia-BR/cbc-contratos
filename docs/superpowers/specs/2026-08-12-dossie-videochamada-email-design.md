# Dossiê institucional por e-mail ao agendar videochamada — Design — 2026-08-12

**Objetivo:** assim que uma videochamada é agendada na agenda de uma vendedora, o lead recebe
no e-mail um PDF institucional personalizado (nome, dia e hora na capa) enviado de
`institucional@advocaciacbc.com`.

**Para quê:** aumentar a autoridade do escritório, reduzir o no-show e desarmar a objeção de
"isso é golpe". O lead chega à videochamada depois de uma qualificação feita no WhatsApp, sem
nunca ter visto o escritório.

**Linha de base medida (12/08/2026):** nos últimos 90 dias, das 430 videochamadas conferidas
pela auditoria do Meet, **96 faltaram (22,3%)**. Contando também as não auditadas dá quase o
mesmo: 123 de 550, ou 22,4%.

⚠️ Uma versão anterior deste documento dizia **28,5%**, e estava errada: dividia as faltas de
TODOS os atendimentos pelo total de apenas os auditados, ou seja, numerador de um conjunto
maior que o denominador. Volume atual: cerca de 8 por dia
útil, 230 por mês.

---

## Decisões do Paulo (12/08/2026)

1. **O PDF do Canva é a base.** Eu ajusto o arquivo (capa nova + reordenação), sem passar pelo
   Canva. As correções internas das páginas 6 e 9 dependem de acesso ao design.
2. **As páginas 9, 10 e 11 ficam** (avaliações do Google, depoimentos e matérias do Migalhas).
   O risco do Provimento 205/2021 do CFOAB foi apresentado e a decisão é dele, advogado.
3. **Canal de envio: Gmail API** com OAuth na conta `institucional@`.
4. **Destinatário: somente o cliente.** A vendedora não recebe cópia.
5. **Nada de envio retroativo.** O corte é uma data e hora que o Paulo define, não a data do
   deploy.
6. **Fase de teste primeiro:** eventos de teste, com todo e-mail indo para
   `paulo@advocaciacbc.com`.
7. **Sem grupo de controle.** A partir do "ok" dele, todo mundo recebe.
8. **Agendas monitoradas:** `marianamaciel@`, `beatriz@`, `emerson@` e `anacristina@` (Ana Piva,
   nova). `mizael@` sai da lista (zero atendimentos em 90 dias).

### Suposição a confirmar

**Responder-para = e-mail da vendedora.** Isso não põe a vendedora como destinatária; só faz a
resposta do lead chegar em quem vai atendê-lo, em vez de morrer numa caixa institucional. Se o
Paulo preferir, muda para `institucional@` em uma linha de configuração.

---

## O que já existe e será reusado

| Peça | Onde | Uso |
|---|---|---|
| Leitura das agendas (OAuth Google) | `_lib/googleAgenda.mjs` | fonte dos eventos; `classifyEvent` já extrai o e-mail do convidado externo |
| Cron a cada 45 min | `agenda-videochamadas-sync.mjs` | vira o gatilho; nenhum cron novo |
| Tabela `agenda_videochamadas` | migração `agenda_videochamadas` | ganha 2 colunas; nenhuma tabela nova |
| Vínculo com o Kommo | RPC `agenda_kommo_match` | nome completo do lead em 72% dos casos |
| Config e kill-switch | `bot_config` | `dossie_videochamada` |
| Console e heartbeat | `logAdvbox`, `heartbeat`, `monitor-watchdog` | vigilância |
| Vigia de credenciais | `tokens-vigia-cron.mjs` | passa a conferir também o token do Gmail |

### Qualidade dos dados (medida em 12/08/2026)

- **E-mail do lead: 463 de 463** atendimentos dos últimos 60 dias. Não há caso sem e-mail,
  porque o próprio `classifyEvent` só considera atendimento de venda o evento que tem convidado
  externo.
- **`cliente_nome` está vazio em 99,6%**: o `displayName` do convidado quase nunca vem.
- **O título do evento traz o primeiro nome**, no padrão `"Fatima +5518997479595"`.
- **72% casam com um lead do Kommo** (`lead_id` preenchido), que tem o nome completo.

### A cascata do nome: título primeiro, Kommo como reserva

O desenho inicial era o contrário (Kommo primeiro, por ser "o cadastro"). A medição derrubou
essa premissa: **em 63 de 334 pares (18,9%) os dois nomes divergem, e o título ganha quase
sempre**, porque é o que a vendedora escreveu **depois de falar com a pessoa**:

| Título do evento | Nome no Kommo | Observação |
|---|---|---|
| Patty | `PATRICIA DE OLIVEIRA MOURA FROS` | o e-mail dela é `pattyfros90@` |
| Cidinha | `MARIA APARECIDA NOGUEIRA E SILVA` | o e-mail dela é `cidinhanog@` |
| Irasmom | `SILVA IRASMON` | Kommo com sobrenome primeiro: daria "Silva" |
| Eliomar | `Santos Eliomar` | idem: daria "Santos" |
| Robson | `robsonagnelo98` | apelido de sistema, não é nome |
| Guto | `Jose - CLAUDIANA DE SOUZA DUARTE COSTA` | campo com dois nomes colados |

Escrever "Olá, Maria" para quem se apresenta como Fátima é pior do que não escrever nome nenhum,
porque denuncia automação cega justamente no material que existe para parecer sério.

**Cobertura medida:** dos 465 eventos dos últimos 60 dias, **461 (99,1%) têm nome bom no
título**, 4 caem na reserva do Kommo e **nenhum fica sem nome**.

O token do título só é aceito com 2 ou mais caracteres, todos letras (o Unicode resolve os
acentos) e fora de uma lista de palavras que não são nome ("reagendamento", "retorno", "cliente",
"teste"). Isso é o que rejeita `"17 991393438"`, título que só tem telefone. A reserva do Kommo
passa pela mesma validação, o que rejeita `robsonagnelo98`.

---

## Arquitetura

```
agenda-videochamadas-sync   (cron */45, já existe)
    └── ao terminar o upsert, dispara
videochamada-dossie-worker  (novo, background)
    ├── seleciona   agendada · futura · sem dossie_email_em · com cliente_email
    │               · detectada depois do corte configurado
    ├── nome        título do evento → Kommo → sem nome
    ├── PDF         capa gerada na hora + miolo comprimido pronto
    ├── envia       Gmail da institucional@ · Responder-para = vendedora
    └── marca       dossie_email_em  /  dossie_email_erro
```

### Unidades

**`_lib/dossieVideochamada.mjs` (puro, testado).** Concentra as decisões, sem rede:
`primeiroNome(tituloEvento, nomeKommo)`, `elegivel(linha, config, agora)` e
`montarEmail({nome, quando, vendedora, config})`, que devolve assunto e HTML. É o padrão que o
guia do projeto já manda seguir: a decisão vira lib pura e a function só orquestra.

**`_lib/dossiePdf.mjs`.** Recebe nome, dia e hora e devolve os bytes do PDF: desenha a capa e
concatena o miolo. Não faz rede nem banco.

**`videochamada-dossie-worker.mjs`.** Orquestra: lê as pendentes, chama as duas libs, envia pelo
Gmail, grava o resultado, emite heartbeat e log.

### A capa é redesenhada, não remendada

A página 1 tem texto de verdade (fontes Montserrat embutidas), então dava para trocar as chaves
no lugar. **Não vamos.** As fontes vêm em subconjunto, só com os glifos que o documento usa; um
nome com "Ç" ou "Õ" fora do subconjunto sairia **em branco, e em silêncio**. Redesenhando o bloco
de texto sobre o fundo original, embutimos a fonte inteira (Montserrat Medium e Bold, geradas a
partir da fonte variável oficial) e controlamos a quebra de linha de nome comprido. É também onde
entram a data (que hoje falta na capa) e a correção de "ás" para "às".

⚠️ **Cobrir não é apagar.** A primeira versão desenhou um retângulo da cor do fundo por cima do
bloco antigo. Visualmente ficou perfeito, mas o texto continuava na camada de texto do PDF: quem
selecionasse e copiasse leria `{{nome}}`, e um leitor de tela anunciaria o placeholder. O certo é
**redação** (`add_redact_annot` + `apply_redactions`), que remove do fluxo de conteúdo. Aplicada
com `images=NONE` e `graphics=LINE_ART_NONE` para não arrastar junto o fundo, o logo nem a seta.
Conferido depois: nenhum `{{` sobra no texto da capa e os 18 links do Migalhas continuam vivos.

**Geometria da capa (medida, para quem for mexer):** página 810 x 1012,5 pt; fundo `#86CBFF`;
texto `#0b2342`; a zona segura do bloco vai de y=300 a y=555, entre o logo (acaba em y=234) e o
"CONHEÇA UM POUCO MAIS" (começa em y=569).

### O miolo é comprimido uma vez só

Páginas 2 a 12 recomprimidas de 16,5 MB para cerca de 4 MB (medido), guardadas prontas no repo.
Cada envio só cola a capa na frente, o que é rápido e não repete o trabalho pesado. O texto e os
links do Migalhas continuam intactos: a compressão mexe só nas imagens.

---

## Regras de envio

| Situação | Comportamento |
|---|---|
| Evento anterior ao corte configurado | não envia (a trava que impede 3.036 e-mails no primeiro disparo) |
| Evento cancelado, excluído ou já passado | não envia |
| Sem `cliente_email` | não envia |
| Sem nome identificado | envia; capa e texto funcionam sem o nome |
| Remarcação que mova o horário em mais de 1h | reenvia **uma** vez, com assunto de remarcação, porque o PDF anterior ficou com a data errada |
| Falha no envio | grava `dossie_email_erro`, aparece no console do Monitor, tenta de novo na rodada seguinte, até 3 vezes |
| `ativo: false` na config | não envia nada |
| `modo_teste: true` | envia com os dados reais, mas todo destinatário vira `paulo@advocaciacbc.com` |

### Banco

Duas colunas em `agenda_videochamadas`: `dossie_email_em timestamptz` e `dossie_email_erro text`.
A RLS da tabela é fechada (PII de cliente), então a gravação passa pela RPC protegida por
`BOT_RPC_SECRET`, como o resto da tabela.

### Configuração (`bot_config.dossie_videochamada`)

`ativo`, `modo_teste`, `email_teste`, `corte_em` (o carimbo de data e hora a partir do qual vale),
`assunto`, `corpo_html`, `responder_para` (`vendedora` ou `institucional`), `max_tentativas`.
Tudo editável sem deploy.

---

## Vigilância

O canal escolhido tem um modo de falha conhecido neste projeto: o token OAuth do Google que
sustenta as agendas **já morreu sozinho uma vez** (23/07/2026, `invalid_grant`), porque o app
OAuth está em modo Testing. Por isso:

1. O app OAuth precisa ser publicado como **Interno** no Workspace antes de valer em produção.
2. `heartbeat('videochamada-dossie', ...)` a cada rodada, para o watchdog cobrar ausência.
3. A credencial do Gmail entra no `tokens-vigia-cron`, que já confere Kommo, Meta, ZapSign,
   ADVBOX e Asaas uma vez por dia e avisa antes de o dado sumir da tela.

Sem isso, um token morto significa dossiê nenhum enviado por semanas, sem ninguém perceber.

---

## Texto do e-mail

- **De:** Conforto, Bergonsi & Cavalari Advogados `<institucional@advocaciacbc.com>`
- **Responder para:** e-mail da vendedora
- **Assunto:** Sua videochamada de {{dia_semana}} ({{data_curta}}), às {{hora}}
- **Anexo:** `CBC-Advogados-Apresentacao.pdf`

O corpo repete no texto o essencial que está no anexo (duração, que não é preciso decidir nada,
o que ajuda ter em mãos), porque anexo de 4 MB muita gente não abre no celular. Traz também um
bloco de verificação com OAB, CNPJ e endereço, que é o que ataca diretamente a objeção de golpe
e é justamente o que falta no PDF:

> Conforto, Bergonsi & Cavalari Sociedade de Advogados, OAB/SP 55.227,
> CNPJ 56.096.172/0001-65. Rua Guatemala, 122, Jardim Santo Antônio,
> Americana/SP, CEP 13465-761.

---

## Fora de escopo, de propósito

Lembrete no dia da chamada e disparo por WhatsApp. As colunas `lembrete_1h_em`,
`lembrete_t0_em` e `noshow_msg_em` já existem na tabela e estão sem uso, ou seja, isso é o
projeto seguinte. Métrica de abertura de e-mail também fica fora: exige pixel de rastreio, que
tem custo de privacidade e não muda decisão nenhuma aqui.

## Como saberemos se funcionou

A base já audita comparecimento pelo Meet. Sem grupo de controle (decisão do Paulo), a
comparação é contra os 90 dias anteriores: **22,3% de falta** é a linha de base. Cada ponto
percentual recuperado vale cerca de 1,8 atendimento por mês.

## Pendências com o Paulo

1. Publicar o app OAuth como **Interno** no Google Cloud Console (exige admin do Workspace).
2. Um consentimento único, logado na `institucional@`, com escopo `gmail.send`.
3. Definir o carimbo de `corte_em` ("a partir de agora vale").
4. Compartilhar o design do Canva, se quiser as correções internas das páginas 6 e 9.
5. Confirmar o Responder-para (vendedora, que é o default proposto, ou institucional).
