# Enriquecimento do contratante por CPF (BigDataCorp) — design

Data: 06/09/2026 · Aprovado pelo Paulo em 06/09 ("aprovado, sem profissão e sem token exclusivo").

## 1. Problema

Hoje, ao sair do campo CPF no formulário de Novo Contrato, o sistema consulta a cpfcnpj.com.br
(R$ 0,25 por consulta) e recebe **só o nome**. Os outros 13 campos obrigatórios do contratante
são digitados à mão ou vêm do OCR da CNH. A conta da BigDataCorp, contratada pelo escritório em
05/08/2026, devolve numa única chamada nome, sexo, nascimento, RG, estado civil, país de
nascimento e endereços, por **R$ 0,08** (preço desta conta, medido na API de Preços em 06/09).

Volume medido no banco: 166 contratantes com CPF em jul/26 e 192 em ago/26, dos quais 15% a 27%
já estavam no histórico (busca grátis). Custo esperado: **R$ 10 a R$ 15 por mês**, contra um
limite grátis de R$ 500 na parceria.

## 2. Escopo

Entra:
- Trocar a fonte da consulta de CPF para a BigDataCorp, no mesmo ponto do fluxo (blur do CPF),
  mantendo a busca no histórico do Supabase como primeiro passo.
- Preencher, **só se vazios**: nome, sexo, dataNascimento, rg, estadoCivil, nacionalidade, cep,
  uf, endereco, numero, complemento, bairro, cidade.
- Destaque visual do que foi preenchido, botão Desfazer e seletor quando houver mais de um
  endereço plausível.
- Trava de gasto em três camadas (configuração, contador local com cache, leitura diária do
  consumo real na BigDataCorp) e card no Monitor.

Fica fora (decisão do Paulo, 06/09):
- Profissão (`occupation_data`). Telefone, e-mail e link Kommo (o escritório já os tem).
- Token exclusivo: usa-se o token compartilhado da conta; o consumo lido no `/usage` é da conta
  inteira, e é exatamente isso que a trava precisa vigiar.
- Enriquecimento retroativo de contratos existentes. Bloco da empresa (PJ) continua com a consulta
  de CNPJ atual; o representante legal usa este fluxo porque é o mesmo campo CPF.

## 3. Arquitetura

```
FormPanel (blur do CPF)
  └─ 1) histórico Supabase (grátis)            [inalterado]
  └─ 2) GET /api/cpf-lookup?cpf=...            [função reescrita, mesmo endereço]
        ├─ rate limit bucket 'cpf' 20/min       [inalterado]
        ├─ orçamento: bot_config.enriquecimento + soma local do mês  → bloqueia se estourou
        ├─ cache: enriquecimento_consultas (mesmo CPF, 90 dias, resultado ok) → devolve grátis
        ├─ POST plataforma.bigdatacorp.com.br/pessoas  {q:"doc{cpf}", Datasets:"basic_data,addresses_extended"}
        ├─ _lib/bigdatacorp.mjs interpreta e normaliza
        └─ registra a consulta (RPC) e responde JSON normalizado
  └─ utils/enriquecimentoCpf.js aplica no contratante (só campos vazios) → updates + destaque + desfazer + alternativas de endereço

tokens-vigia-cron (08h BRT, já existe)
  └─ checagem nova "BigDataCorp": POST /usage → grava resumo em bot_config.enriquecimento.ultimo_usage
     ├─ ≥ aviso_pct do teto → alerta (sino + e-mail crítico)
     └─ ≥ teto ou TotalRequests ≥ TotalLimit → ativo_auto=false (formulário volta ao manual)

Monitor → RPC enriquecimento_resumo() → card "Enriquecimento de CPF"
```

### 3.1 Função `cpf-lookup.mjs` (reescrita, mesmo path `/api/cpf-lookup`)

Mantém o contrato de sempre responder de forma segura: em qualquer falha devolve
`{ valid: true, nome: '' }` e o formulário segue manual. O que muda:

- Variáveis novas no Netlify: `BIGDATACORP_ACCESS_TOKEN` e `BIGDATACORP_TOKEN_ID`. Sem elas,
  responde `{ valid: true, nome: '', error: 'TOKEN_NAO_CONFIGURADO' }` e grava erro no Monitor.
  `CPF_API_TOKEN` deixa de ser lida (a variável pode ficar no painel, inerte).
- Ordem: validação do CPF → rate limit → orçamento → cache → BigDataCorp (timeout 8 s) → registro.
- Resposta de sucesso (cacheável 1 dia no navegador, como hoje; **não** cachear no CDN, porque a
  resposta agora carrega endereço, e o cache do servidor já existe na tabela):

```json
{
  "valid": true,
  "fonte": "bigdatacorp" | "cache" | "sem_dados",
  "nome": "MARIA DA SILVA",
  "sexo": "F",
  "dataNascimento": "1970-05-20",
  "rg": "123456789",
  "estadoCivil": "Casado(a)" | null,
  "paisNascimento": "BRASIL" | null,
  "situacaoCpf": "REGULAR" | "SUSPENSA" | ... | null,
  "indicioObito": false,
  "enderecos": [ { "cep": "13465000", "uf": "SP", "cidade": "Americana", "bairro": "Centro",
                   "logradouro": "Rua X", "numero": "100", "complemento": "Apto 12",
                   "tipo": "HOME", "principal": true, "ativo": true,
                   "ultimaPassagem": "2024-03-01" } ]
}
```

- Estados de erro, todos com `valid: true, nome: ''` para não pintar o CPF de inválido:
  `error: 'SEM_CREDITOS'` (orçamento estourado ou desligado), `'TOKEN_NAO_CONFIGURADO'`,
  `'INDISPONIVEL'` (timeout, 5xx, 429 da BigDataCorp). Cada um vira uma linha em
  `advbox_api_log` (origem `cpf`) **com o import de `logAdvbox` feito**, corrigindo o defeito
  atual em que a chamada sem import lançava ReferenceError dentro do try e o aviso nunca saía.
- Nunca grava nome, RG ou endereço em log. No log vai só o CPF mascarado (`***.***.789-**`).

### 3.2 Lib pura `_lib/bigdatacorp.mjs`

Sem rede, testável com fixture. Exporta:

- `montarRequisicao(cpf)` → `{ url, headers, body }`.
- `interpretarResposta(json)` → objeto normalizado da seção 3.1 ou `{ semDados: true }`.
  Lê `Result[0].BasicData` (Name, Gender, BirthDate, AlternativeIdNumbers.RG,
  MaritalStatusData.MaritalStatus, BirthCountry, TaxIdStatus, HasObitIndication) e
  `Result[0].ExtendedAddresses.Addresses[]` (Typology, Title, AddressMain, Number, Complement,
  Neighborhood, ZipCode, City, State, Type, IsActive, IsMainForEntity, EntityLastPassageDate).
  Confere `Status.basic_data[0].Code === 0`; código diferente vira `INDISPONIVEL`.
- `ordenarEnderecos(enderecos)` → lista ordenada e filtrada. Regra: descarta `Type` WORK; ordena
  por `IsMainForEntity`, depois `IsActive`, depois `EntityLastPassagem` mais recente. Endereços
  sem cidade ou sem logradouro saem. O primeiro é o sugerido; os demais (até 2) são alternativas.
- `mapearEstadoCivil(texto)` → uma das cinco opções de `ESTADOS_CIVIS` ou `null`
  (SOLTEIRO→Solteiro(a), CASADO→Casado(a), DIVORCIADO/SEPARADO→Divorciado(a), VIUVO→Viúvo(a),
  UNIAO ESTAVEL→União Estável; qualquer outra coisa → null). Tolerante a acento e caixa.

### 3.3 Orçamento: `_lib/enriquecimentoOrcamento.mjs` + tabela + config

Config em `bot_config`, chave `enriquecimento`:

```json
{ "ativo": true, "ativo_auto": true, "teto_mensal_reais": 450, "aviso_pct": 80,
  "custo_unitario": 0.08, "cache_dias": 90,
  "ultimo_usage": { "lido_em": "...", "total_reais": 24.56, "total_requisicoes": 1711,
                    "limite_requisicoes": 5000 } }
```

- `ativo` é o interruptor do Paulo; `ativo_auto` é o que o vigia derruba ao estourar e religa
  no primeiro dia do mês seguinte (quando o `/usage` volta a zero).
- Decisão pura `podeConsultar({ config, gastoLocalDesdeLeitura, hojeBrt })` →
  `{ ok, motivo }`. Gasto estimado do mês = `ultimo_usage.total_reais` (conta inteira, lido de
  manhã) + soma local das consultas pagas feitas depois daquela leitura. Bloqueia se
  `!ativo || !ativo_auto || gastoEstimado >= teto`. Dia 1 do mês antes da leitura do vigia usa só
  a soma local.

Tabela `enriquecimento_consultas` (migração `supabase_enriquecimento_cpf.sql`):

| coluna | tipo | uso |
|---|---|---|
| id | bigserial | |
| cpf | text (11 dígitos) | chave do cache |
| resultado | text | `ok` · `sem_dados` · `cache` · `bloqueado` · `erro` |
| custo_estimado | numeric(6,2) | 0,08 em `ok`/`sem_dados`; 0 nos demais |
| resposta | jsonb | objeto normalizado (só em `ok`), servido pelo cache |
| usuario_email | text | quem disparou (do JWT, quando houver) |
| criado_em | timestamptz | |

RLS fechada (padrão `asaas_boletos`). A função grava e lê via RPCs `SECURITY DEFINER`
protegidas por `BOT_RPC_SECRET` (helper `_bot_chave_ok`): `enriquecimento_registrar(...)`,
`enriquecimento_cache(p_cpf, p_dias)`, `enriquecimento_gasto_desde(p_instante)`. Para o Monitor,
`enriquecimento_resumo()` executável por `authenticated`, devolve agregados do mês (consultas,
pagas, cache, custo) mais a config, **sem CPF**. Índice em `(cpf, criado_em desc)`. A tabela entra
na whitelist do backup (pequena; sem isso o alarme "tabela fora do backup" dispara).

### 3.4 Vigia diário (`tokens-vigia-cron.mjs`)

Checagem nova "BigDataCorp", no mesmo molde das outras: `POST /usage` com corpo `{}`. Lê
`UsageData.TotalEstimatedPrice`, `TotalRequests`, `TotalLimit` e grava em
`bot_config.enriquecimento.ultimo_usage` via `mergeConfig` (mescla rasa; grava a chave
`ultimo_usage` inteira). Em seguida:

- `total_reais >= teto * aviso_pct/100` → `sendCriticalAlert` + `logAdvbox('cpf','erro',...)`.
- `total_reais >= teto` ou `TotalRequests >= TotalLimit` → `ativo_auto=false` + alerta dizendo
  que o preenchimento automático foi pausado.
- Se o mês virou desde `lido_em` e `ativo_auto` era false → volta a true.
- Falha na chamada `/usage` conta como credencial quebrada (mesmo tratamento das outras).

### 3.5 Frontend

`utils/apiLookup.js`: `lookupCPF` passa a devolver o objeto normalizado inteiro (mantém o cache
em memória e o intervalo mínimo entre chamadas).

`utils/enriquecimentoCpf.js` (puro, testado): `aplicarEnriquecimento(contratante, dados)` →
`{ updates, camposPreenchidos, anterior, alternativasEndereco, avisos }`:
- Só preenche campo vazio (`''`, `null`, `undefined`). Nunca toca `telefone`, `email`, `linkKommo`.
- `nome` como veio (caixa alta é o padrão do formulário). `sexo` M/F. `dataNascimento` já em
  `yyyy-mm-dd`. `rg` passa por `maskRG`, `cep` por `maskCEP`.
- `nacionalidade`: se `paisNascimento` é BRASIL/BRASILEIRA e o campo está vazio →
  `brasileira` se sexo F, `brasileiro` se M, `brasileiro(a)` se sexo indefinido. Outro país → vazio.
- Endereço: aplica o primeiro de `enderecos` **somente se todos os 7 campos de endereço estiverem
  vazios** (endereço é um bloco; misturar rua de uma fonte com CEP de outra é pior que nada).
  `alternativasEndereco` traz os demais candidatos.
- `avisos`: `indicioObito` → "A base indica óbito para este CPF. Confirme com o cliente.";
  `situacaoCpf` diferente de REGULAR → "CPF com situação {X} na Receita."
- `anterior` guarda os valores substituídos (todos vazios, por construção), para o Desfazer.

`FormPanel.jsx`, em `handleCPFValidate`, após o histórico não achar:
- `cpfStatus` ganha o estado `enriquecido` (o `sem_creditos` e o `invalid` continuam).
- Chip sob o rótulo do CPF: "✓ 11 campos preenchidos pela consulta · **Desfazer**". Desfazer
  restaura `anterior` via `onChange(index, anterior)` e limpa o destaque. O chip some ao clicar em
  Desfazer, ao editar qualquer campo preenchido, ou após 20 s (o Desfazer some junto).
- Destaque: reutiliza o mecanismo `ocrFields` + classe `ocr-highlight` (pulso de 2 s) para os
  campos preenchidos. Nenhuma classe nova.
- Seletor de endereço: se `alternativasEndereco.length >= 1`, aparece um bloco compacto logo
  acima dos campos de endereço com o título "Encontramos {n} endereços. Qual usar?" e uma linha por
  opção (a aplicada vem marcada): `Rua X, 100 · Centro · Americana/SP · visto em mar/2024`.
  Clicar em outra troca os 7 campos. O bloco some ao escolher, ao editar um campo de endereço à
  mão, ou ao trocar de contratante. Tokens `--cbc-*`, foco visível, `role="radiogroup"`.
- Avisos (`avisos`) saem em `toast.warning`, um por aviso.
- Sem crédito/pausado: `cpfStatus='sem_creditos'` com o texto "consulta pausada (limite mensal)",
  toast "Preenchimento automático de CPF pausado por limite mensal. Preencha manualmente." A
  mensagem antiga que mandava avisar o Bruno para recarregar sai (não há mais recarga).
- Sem dados na base: comportamento neutro, igual ao CPF válido sem nome hoje.
- Mobile: chip e seletor são blocos em fluxo, sem posição absoluta; nada a esconder.

### 3.6 Monitor

Card "Enriquecimento de CPF (BigDataCorp)" na seção de integrações do `MonitorPanel`, lendo
`enriquecimento_resumo()`: gasto estimado do mês / teto com barra, consultas do mês (pagas ·
cache · bloqueadas), leitura do `/usage` (valor da conta inteira e hora), e um selo
"pausado automaticamente" quando `ativo_auto=false`. Sem botões nesta leva; ligar e desligar é
pelo `bot_config`.

## 4. Erros e casos-limite

| Situação | Comportamento |
|---|---|
| BigDataCorp fora, timeout 8 s, 429, 5xx | `INDISPONIVEL`; formulário manual; log erro; **não** registra custo |
| `Result` vazio | `sem_dados`; registra 0,08 (a API pode cobrar); cacheia por 90 dias para não repetir |
| Token inválido (401/403) | `TOKEN_NAO_CONFIGURADO`; log erro; vigia pega de manhã |
| Orçamento estourado ou `ativo=false` | `SEM_CREDITOS` sem chamar a API; registra `bloqueado` (custo 0) |
| Mesmo CPF em 90 dias | cache; `fonte: 'cache'`; custo 0 |
| Dois contratantes, mesmo fluxo | cada blur é independente; o Desfazer é por contratante |
| Usuário já digitou nome antes do blur | nome não é sobrescrito; se divergir do oficial, nada acontece (fora de escopo) |
| Vigia falha em ler `/usage` | orçamento usa a última leitura + soma local; alerta de credencial |
| Virada de mês | `ativo_auto` religa na primeira leitura do mês; até então vale a soma local |

## 5. Testes

- `_lib/bigdatacorp.test.mjs`: fixture real anonimizada (uma consulta paga de R$ 0,08 feita na
  implementação, com nome/RG/endereço trocados) cobrindo: normalização, RG ausente, estado civil
  vazio e desconhecido, ordenação de endereços (WORK descartado, principal antes de ativo, mais
  recente antes), `Status` com código de erro.
- `_lib/enriquecimentoOrcamento.test.mjs`: teto, aviso, `ativo=false`, `ativo_auto=false`,
  dia 1 sem leitura, soma local após a leitura.
- `utils/__tests__/enriquecimentoCpf.test.js`: não sobrescreve campo preenchido, nunca toca
  telefone/e-mail/Kommo, bloco de endereço só quando todo vazio, nacionalidade por sexo, máscaras,
  avisos de óbito e situação, `anterior` permite desfazer exato.
- Trava existente `camposObrigatorios` não muda (nenhum campo obrigatório novo).
- Em produção: uma consulta real via formulário e conferência do registro na tabela, do log e do
  card do Monitor; disparo manual do vigia pelo "Run now" da Netlify.

## 6. Entrega

1. Migração `supabase_enriquecimento_cpf.sql` (tabela, RLS, RPCs, whitelist do backup, seed da
   config).
2. Envs `BIGDATACORP_ACCESS_TOKEN` e `BIGDATACORP_TOKEN_ID` no Netlify (Paulo; exige redeploy).
3. Código: libs, função, vigia, frontend, Monitor, testes. Backup em `backups/` antes (REGRA #1).
4. Deploy por `deploy.sh`; guia do projeto atualizado com o bloco de estado.

Rollback: `./rollback.sh <deploy anterior>`; a env `CPF_API_TOKEN` continua no painel, então o
código antigo volta a funcionar. A migração é aditiva.

## 7. Riscos assumidos

- Endereço da base pode estar desatualizado. Mitigação: seletor com data da última passagem e o
  preenchimento nunca sobrescreve o que a vendedora digitou.
- Token compartilhado com outros projetos: um lote grande deles pode esgotar a cota e pausar o
  formulário. A trava é justamente para isso, e o card do Monitor mostra o gasto da conta inteira.
- O token foi colado em chat em 05/08 e 06/09. Rotacionar no BDC Center é decisão do Paulo.
