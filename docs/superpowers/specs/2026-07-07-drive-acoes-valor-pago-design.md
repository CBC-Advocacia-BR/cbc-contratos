# Ações do Drive → valor pago + cruzamento ADVBOX no Cadastro Único — Design

> Spec de 07/07/2026 (rev. 2, com as considerações do Paulo). Origem: minerar o Google Drive do escritório, extrair de cada ação o **resort**, o **valor pago pelo cliente que consta na inicial** e o **link da pasta**, cruzar com o **ADVBOX** para saber quantas ações o cliente tem, e popular o **Cadastro Único** (ficha interna `ClientesTab`). **Mutirão único** (sem cron). Piloto HOT BEACH YOU validado.

## 1. Objetivo e escopo

Para cada pasta-ação do Drive (`Paulo 1 / Paulo 2 → Resort → Cliente → arquivos`), ler a **petição inicial** e registrar, vinculado ao cliente por **CPF**:
- resort/empreendimento réu;
- tipo de ação;
- **valor pago pelo cliente** — exclusivamente o valor **que consta na inicial** (valor "desatualizado", tal como escrito na peça);
- link da pasta da ação no Drive;
- **vínculo com a ação real no ADVBOX** (nº do processo / `lawsuit_id`) e **quantas ações** o cliente tem lá.

Exibir numa nova seção **"Ações no Drive"** na ficha do cliente (`ClientesTab`). **Nada no Portal público.** Um cliente pode ter **várias ações** (vários resorts / várias cotas) → relação 1-para-N.

### Considerações do Paulo (rev. 2) — travadas
1. **Somente valores mencionados na inicial.** SEM fallback no Extrato de Pagamento. Se a inicial não traz o valor → `needs_review`, **sem chute**.
2. **Duas pastas para a "mesma" ação ⇒ provavelmente são duas ações distintas.** Não deduplicar às cegas: **cruzar com o ADVBOX** e deixar o ADVBOX decidir quantas ações existem. Validado: FILIPE NICOLOTTI = 2 ações no ADVBOX com 1 só pasta no HBY; Andreo/Jaqueline = 2 pastas mas 0 ação no ADVBOX (pré-protocolo).
3. **Só os valores "desatualizados"** que constam nas iniciais (não calcular valor atualizado).

**Fora de escopo:** Portal público; automação/cron; valor atualizado; leitura do Extrato de Pagamento; OCR de CNH em imagem.

## 2. Resultado do piloto (evidência)
HOT BEACH YOU: 36 pastas, 0 erros. 28 com valor pago (frase-fonte auditável), 8 sem valor (2 legítimos, 6 sem inicial). **54/54 CPFs casaram** com `clientes`. Casamento por CPF acerta mesmo com nome divergente na pasta. Artifact publicado.

## 3. Cruzamento com o ADVBOX (espelho já existente)
Fonte da verdade sobre "quantas ações": tabelas-espelho no Supabase.
- **`bi_clientes`**: `cpf_cnpj` → `customer_id`, `cliente_uid` (liga ao MDM `clientes`), `qtd_processos`.
- **`bi_processos`**: `customer_ids` (array de bigint), `process_number`, `lawsuit_id`, `tipo`, `parte_contraria` (o réu/resort), `grupo`, `etapa`, `process_date`, `fees_money`.

Para cada pasta-ação: achar o `customer_id` do autor (via `bi_clientes` por CPF) → listar as ações do cliente em `bi_processos` (onde `customer_id = ANY(customer_ids)`) → **vincular a pasta a um `lawsuit_id`**:
- por `process_number` quando a inicial/pasta traz o CNJ; senão
- por `customer_id` + `parte_contraria`≈resort (+ tipo) — casa a pasta ao processo daquele resort.

Resolução do caso "2 pastas":
- vinculam a **2 lawsuits diferentes** → **2 ações distintas** (mantém as duas). 
- vinculam ao **mesmo lawsuit** (ou o cliente tem menos ações no ADVBOX que pastas) → `needs_review` (possível duplicata), **não colapsa sozinho**.
- cliente **não está no ADVBOX** → `needs_review = pré-protocolo` (ação não ajuizada).

## 4. Modelo de dados

Tabela nova **`cliente_acoes_drive`** (CBC; **RLS fechada**/PII, como `clientes`). 1 linha por pasta-ação; **`unique(drive_folder_id)`** (idempotência).

| coluna | tipo | nota |
|---|---|---|
| `id` | uuid pk | `gen_random_uuid()` |
| `cpf` | text not null | só dígitos; autor principal (chave de casamento) |
| `cliente_id` | uuid null | → `clientes.id` (via `bi_clientes.cliente_uid` / match CPF) |
| `nome_autor` | text | como na inicial |
| `conjuge_cpf` / `conjuge_nome` | text null | 2º autor (dígitos) — usado p/ sugerir `clientes.conjuge_uid` |
| `resort` | text | balde/pasta-mãe do Drive |
| `reu_resort` | text | razão social da ré na inicial |
| `tipo_acao` | text | tipo da ação (da inicial) |
| `unidade_cota` | text null | nº da unidade fracionada / bloco / torre (distingue cotas) |
| `valor_pago` | numeric(14,2) null | **só o que consta na inicial** (desatualizado) |
| `valor_pago_texto` | text | frase exata de origem (auditoria) |
| `valor_causa` | numeric(14,2) null | referência |
| `is_recurso` | boolean default false | recursos não têm valor pago próprio |
| `drive_bucket` | text | "Paulo 1"/"Paulo 2"/... |
| `drive_folder_id` | text not null **unique** | chave natural |
| `drive_folder_link` | text | link da pasta |
| `inicial_file_id` / `inicial_file_name` | text | rastreabilidade |
| **`advbox_lawsuit_id`** | bigint null | ação vinculada no ADVBOX |
| **`advbox_process_number`** | text null | CNJ autoritativo (ADVBOX); senão o da inicial |
| **`advbox_tipo`** / **`advbox_etapa`** | text null | tipo/fase atual no ADVBOX |
| **`advbox_qtd_processos`** | int null | quantas ações o cliente tem no ADVBOX |
| `advbox_status` | text | `vinculado` \| `sem_processo` \| `multiplas_conferir` |
| `process_number` | text null | CNJ visto na inicial (bruto) |
| `confidence` | text | alta/media/baixa |
| `needs_review` | boolean default false | + `review_reason` text |
| `extraido_em` / `updated_at` | timestamptz | default now() |

*(Opcionais, só se o Paulo pedir: `data_contrato_compra date`, `dano_moral numeric`.)*

Índices: `(cpf)`, `(cliente_id)`, `(advbox_lawsuit_id)`, `unique(drive_folder_id)`.

## 5. Componentes e fluxo (unidades isoladas)

1. **Extrator (read-only, Drive)** — workflow reaproveitável (o do piloto). Por pasta: lista arquivos → acha a inicial → lê → extrai (autores+CPF, réu, tipo, **valor pago só da inicial**, valor da causa, unidade/cota, CNJ se houver, is_recurso). **Nunca** lê extrato; **nunca** escreve. Lotes de 4 + retry (evita throttle). Roda **resort a resort**.
2. **Cruzador ADVBOX (leitura Supabase)** — casa CPF→`bi_clientes`→`bi_processos`; vincula `advbox_lawsuit_id`/`process_number`/`qtd_processos`; define `advbox_status` e a resolução do caso "2 pastas".
3. **Casador MDM (puro)** — normaliza CPF, liga `cliente_id` (via `bi_clientes.cliente_uid`); sugere `conjuge_uid` quando a inicial revela o casal e o campo está vazio (**não** sobrescreve).
4. **Gravador (backfill)** — o orquestrador grava em lote na `cliente_acoes_drive` via **Supabase MCP** (upsert por `drive_folder_id`). Subagentes seguem só-leitura.
5. **Leitura pelo app** — RPC `SECURITY DEFINER` **`cliente_acoes_drive_list(p_cpfs text[])`**, espelhando o padrão de `cliente_dados_bancarios` em `clientesService.js`.
6. **UI** — seção **"Ações no Drive"** na ficha (`ClientesTab.jsx`): por ação → resort · tipo · **valor pago** (frase-fonte no hover) · unidade/cota · **nº do processo (ADVBOX)** · **[Abrir pasta ↗]** · selos (revisão / pré-protocolo / conferir-duplicata). Se `advbox_qtd_processos` ≠ nº de pastas achadas, mostra aviso. Read-only, tokens `--cbc-*`, dark-ok.

## 6. Mudanças de código/banco (para aprovação — REGRA #16)
- **Migração SQL** `drive_acoes_cliente` (`supabase_drive_acoes_cliente.sql`): tabela `cliente_acoes_drive` + índices + RLS fechada + RPC `cliente_acoes_drive_list` (SECURITY DEFINER).
- **`client/src/utils/clientesService.js`**: + `buscarAcoesDrive(cpfs)`.
- **`client/src/components/ClientesTab.jsx`**: + seção "Ações no Drive".
- **Backfill**: extrator (workflow) + cruzamento ADVBOX + INSERTs em lote via MCP. Não vai pro bundle.
- Backups antes de editar (REGRA #1/#3). **Sem deploy** até OK do Paulo.

## 7. Riscos e mitigações
- **Só inicial** ⇒ cobertura menor (pastas sem valor na inicial ficam `needs_review`), por decisão do Paulo — correto e auditável.
- **Throttle de rajada** (visto no 1º piloto): lotes de 4 + retry, resort a resort.
- **Vínculo pasta↔ADVBOX ambíguo** (sem CNJ na inicial): casa por cliente+réu; se ficar dúbio, `advbox_status='multiplas_conferir'` + `needs_review` (nunca inventa vínculo).
- **Espelho ADVBOX defasado** (monitor 2×/dia): aceitável p/ mutirão; `advbox_qtd_processos` é snapshot.
- **Escala** (~1.500–2.500 pastas): incremental por resort; idempotente por `drive_folder_id`.
- **Banco compartilhado**: nome específico, RLS fechada, grava só o orquestrador.

## 8. Critérios de aceite
- Ficha mostra as ações do Drive com resort, valor pago (só inicial + fonte), unidade/cota, nº do processo (ADVBOX) e link clicável.
- Casos de "2 pastas" aparecem como **conferir**, com o nº de ações do ADVBOX ao lado — nunca colapsados automaticamente.
- Re-rodar o backfill não duplica.
- `needs_review` isola pré-protocolo / sem-valor / vínculo dúbio.
- Desktop intocado fora da seção nova; dark-mode ok.
