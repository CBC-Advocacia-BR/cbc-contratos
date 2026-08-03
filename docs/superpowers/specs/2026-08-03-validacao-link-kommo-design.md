# Validar o Link Kommo na origem (03/08/2026)

## Problema

O campo **Link Kommo** e digitado a mao no formulario (REGRA #4) e **congela** em
`contratos.dados->contratantes[].linkKommo`. Ninguem confere se o lead existe.

Em 02/08/2026 isso ja tinha custado: **37 leads mortos / 42 contratos** (quase todos
`assinado`) apontando para lead inexistente, com **271 notas e 57 cobrancas** que nunca
chegaram ao cliente — algumas ha 44 dias. A causa mais comum e o merge de leads
duplicados na UI do Kommo, que **apaga** o lead perdedor; tambem aparece link de outra
conta (`brunoadvocaciacbccom.kommo.com`), inalcancavel pelo nosso token.

O trabalho de 02/08 (fila terminal + `kommo_leads_mortos`) parou o desperdicio e o ruido,
mas trata o **sintoma**. Todo merge futuro cria um link morto novo. Isto aqui e a causa.

## Decisoes (Paulo, 03/08/2026)

1. **Avisa ao colar, bloqueia so no envio.** Quem cola o link esta com o Kommo aberto
   naquele instante — e o unico momento em que o erro custa 10 segundos para corrigir.
   Salvar rascunho segue livre (o contrato pode estar sendo montado antes de o lead
   existir). O portao real e o checklist de envio ao ZapSign.
2. **API fora do ar = deixa passar.** Nao da para provar que o lead e invalido, entao o
   contrato segue com aviso neutro. Uma instabilidade do Kommo nunca pode impedir uma
   assinatura.

## Desenho

### Onde entra

Nada de function nova. **`resolve-kommo-lead.mjs` ganha um modo leve.** Ele ja faz o
`GET /leads/{id}` com JWT do Supabase, timeout instrumentado e log no Monitor; o que
sobra dele (contato, tags, RPC do Cadastro Unico, 1a mensagem) e caro e inutil para uma
conferencia de existencia. Com `{ apenasExistencia: true }` ele responde logo apos o GET
do lead. Reusa auth, instrumentacao e tratamento de erro — e evita mais uma das 114
functions quase duplicada.

### Os tres vereditos

| Veredito | Quando | Efeito |
|---|---|---|
| `existe` | `GET /leads/{id}` respondeu com lead | segue normal |
| `nao_existe` | HTTP **404**, 204/vazio, **ou host != `advocaciacbc.kommo.com`** | aviso vermelho; bloqueia o envio |
| `desconhecido` | timeout, 429, 5xx, token vencido, rede | aviso cinza; **nao** bloqueia |

⚠️ **Armadilha que define o codigo**: `kGet` do `_lib/kommo.mjs` **lanca excecao** quando
o HTTP nao e ok, entao um lead inexistente chega como `Error('Kommo GET /leads/9 HTTP
404')` — indistinguivel, a olho nu, de um 500 transitorio. Sem separar o 404 do resto, ou
o sistema bloqueia contrato legitimo quando o Kommo oscila, ou deixa passar lead morto.
A separacao mora em `_lib/kommoLink.mjs` (modulo puro, testado).

### Auto-cura da `kommo_leads_mortos`

Se o lead **existe** e esta na `kommo_leads_mortos`, o endpoint **apaga a linha**. Assim,
quando a equipe corrige o link de um dos 42 contratos, o fluxo volta sozinho — o
`delete from kommo_leads_mortos` manual documentado em 02/08 deixa de ser necessario.

Se o link colado **ja esta** na lista de mortos, o aviso sai na hora, sem chamar o Kommo.

### Nao registrar reprovacao do formulario

O que o formulario reprovar **nao** entra na `kommo_leads_mortos`. Um id digitado errado
poluiria a tabela e passaria a barrar trabalho legitimo. Essa lista so cresce com falha
real comprovada na fila.

### Frontend

- **Aviso ao colar**: `onBlur` do campo em `FormPanel`, reusando `errors.linkKommo` +
  `.input-error` que ja existem. Sem componente novo.
- **Portao no envio**: mais uma linha no `PreSendChecklist`, no mesmo formato do
  CEP x cidade — que ja tem exatamente a semantica necessaria:
  `status: loading | pass | fail | unknown`, onde `unknown` e cinza e nao conta como ok
  (item ux-16). `fail` bloqueia, `unknown` passa.

## Modulos

| Arquivo | Papel |
|---|---|
| `_lib/kommoLink.mjs` (novo, puro) | `classificarLink(url)` e `classificarFalha(erro)` — decide host/id e separa 404 de transitorio |
| `resolve-kommo-lead.mjs` | modo `apenasExistencia` + auto-cura da lista de mortos |
| `utils/kommoLeadCheck.js` (novo) | cliente do frontend (JWT + timeout + cache curto) |
| `FormPanel.jsx` | aviso no blur |
| `PreSendChecklist.jsx` | portao do envio |

## Testes

`kommoLink.test.js`: host oficial x outra conta x lixo; id extraido de varios formatos;
404 -> `nao_existe`; 429/500/timeout/401 -> `desconhecido`. O caso 404-vs-500 e o coracao
da feature e tem teste explicito nos dois sentidos.
