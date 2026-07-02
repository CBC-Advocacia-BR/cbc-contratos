# BRIEF — Redesign UI/UX: CBC Contratos (abas "Novo Contrato" e "Contratos Salvos")

## O sistema
Ferramenta interna do escritório **Conforto, Bergonsi & Cavalari Advogados** (OAB/SP 55.227 — Americana/SP).
Uma equipe de ~4 colaboradoras gera contratos de honorários advocatícios contra resorts/multipropriedade (timeshare),
envia para assinatura eletrônica via **ZapSign** e acompanha o status. Uso diário, alto volume (195 contratos até hoje).

Usuárias reais: **Mariana Maciel** (maior volume), **Maria**, **Ana Cristina**, **Beatriz** (e-mails @advocaciacbc.com).

## Identidade atual (referência, pode evoluir)
- Navy `#1B3A5C`, navy-escuro `#0F2035`, fundo claro `#F0F4F8`, azul-claro de apoio `#EEF4FF` / borda `#C0D0E8`
- Verde sucesso `#16A34A`, âmbar edição, vermelho cancelamento
- Problemas conhecidos do design atual (EVITAR repetir): micro-tipografia (tudo 8–11px), excesso de UPPERCASE em tudo,
  emojis usados como ícones (📝💾📤✅), hierarquia de status fraca, poluição de badges, formulário em acordeões que escondem estado.
- Decisão em aberto no escritório: possível uso de **dourado funcional** como acento (um dos mockups explora isso).

## Aba 1 — NOVO CONTRATO (formulário + preview ao vivo)
Layout atual: painel de formulário (480px) à esquerda + preview do documento à direita (abas "Contrato" / "Procuração Ad Judicia").

Campos/fluxo:
1. **Contratantes** — 1 ou 2 pessoas. Por contratante: CPF (com busca automática de nome via API ao sair do campo),
   RG, Nome completo, Nacionalidade, Profissão, Estado Civil (Solteiro(a)/Casado(a)/Divorciado(a)/Viúvo(a)/União Estável),
   E-mail, CEP (busca automática de endereço), UF, Endereço, Complemento, Bairro, Cidade.
   Extras: **upload de CNH com OCR** que preenche os campos automaticamente (drag & drop); botão "Mesmo endereço do Contratante 1".
2. **Resort + Tipo de Ação** — selects com opção "novo/outro".
3. **Honorários** — 3 modos: `Iniciais + Êxito` / `Somente Êxito` / `Somente Iniciais`.
   Presets reais: R$ 2.700 à vista · R$ 3.000 em 10x R$ 300 · R$ 3.000 em 12x R$ 250 · R$ 3.300 em 12x R$ 275 · Personalizado.
   Data da 1ª parcela. Percentual de êxito: 15/20/25/30% (20% é o mais comum; casos "somente êxito" usam 30–40%).
4. **Cláusulas** — 13 cláusulas padrão editáveis e reordenáveis (drag), Cláusula 2ª (Honorários) é gerada automaticamente;
   pode adicionar "cláusula avulsa". Títulos reais: 1ª Objeto do Contrato, 2ª Honorários (+§1º Solidariedade, §2º Êxito,
   §3º Multa 20%, §4º Sucumbência, §5º Pagamento via ASAAS, §6º Título Executivo, §7º Independência), 3ª Desistência,
   4ª Despesas Processuais, 5ª Dados de Contato, 6ª Abrangência do Mandato, 7ª Negociação Direta Proibida,
   8ª Confidencialidade e LGPD, 9ª Prestação de Contas, 10ª Advocacia de Meios, 11ª Revogação e Renúncia,
   12ª Herdeiros e Sucessores, 13ª Foro.
Ações: **Salvar Contrato** · **Gerar PDF e Salvar** · **Gerar Procuração** · **Enviar para ZapSign** · Limpar.
Há validação por campo (CPF válido ✓), indicador de progresso e atalhos de teclado (Ctrl+S salvar, Ctrl+Enter enviar).

## Aba 2 — CONTRATOS SALVOS
Hoje: busca (nome/CPF/resort), filtros por status em pills, lista de cards expansíveis com barra de progresso
(Rascunho → Salvo → Enviado → Assinado), detalhe com dados + **links de assinatura ZapSign por signatário**
(copiar link individual/todos, status Pendente/Assinado por pessoa), "Carregar no Formulário", excluir, seleção múltipla,
paginação (10/pág), sincronização de status com ZapSign (botão + auto), pull-to-refresh no mobile.

Fluxo de status: `rascunho` → `enviado_zapsign` ("Enviado") → `assinado`. Também `cancelado`.

## DADOS REAIS (usar exatamente estes nos mockups)
Totais: **195 contratos — 164 assinados · 26 enviados (aguardando assinatura) · 5 rascunhos**.

| Contratante 1 | Contratante 2 | CPF | Resort | Tipo de Ação | Status | Honorários | Êxito | Criado | Por |
|---|---|---|---|---|---|---|---|---|---|
| Fabiane Aparecida Borges | Roberto Ribeiro dos Santos | 055.843.406-18 | Ilhas do Lago | Cota Quitada sem Matrícula | enviado | R$ 3.300 12x R$ 275 | 20% | 01/07/2026 | Mariana |
| Fabio Tavares de Melo | Patricia Pinheiro de Melo | 318.761.358-67 | Leaves Premium | Distrato por Atraso | enviado | R$ 3.300 12x R$ 275 | 20% | 01/07/2026 | Mariana |
| Natalia Zulmira Sales da Silva | Dimas Sales da Silva | 346.116.158-63 | Olimpia Park Resort | Devolução 80% | enviado | R$ 3.300 12x R$ 275 | 20% | 30/06/2026 | Mariana |
| Marco Antonio Puppin | — | 040.853.568-79 | Thermas São Pedro | Devolução 80% | assinado | R$ 3.300 12x R$ 275 | 20% | 30/06/2026 | Mariana |
| Rosemary Aparecida Piccioni | — | 577.678.239-20 | Thermas São Pedro | Devolução 80% | assinado | R$ 3.300 12x R$ 275 | 20% | 30/06/2026 | Mariana |
| João Carlos Ferreira de Freitas | André da Silva Barros | 067.504.508-81 | Thermas São Pedro | Ação de Cobrança | assinado | Somente êxito | 40% | 26/06/2026 | Mariana |
| Andreia Flor da Silva | — | 939.465.036-91 | Lagoa Quente/Ecotowers | Devolução 80% | assinado | R$ 3.300 12x R$ 275 | 20% | 26/06/2026 | Mariana |
| Flavio de Carvalho Pereira | Fabiana Custodio Vieira | 849.125.456-00 | Alta Vista | Cota Quitada sem Matrícula | enviado | Somente êxito | 35% | 26/06/2026 | Mariana |
| Terezinha de Jesus Paulino da Costa | — | 122.551.748-63 | Ondas Praia | Devolução 80% | enviado | Somente êxito | 30% | 26/06/2026 | Maria |
| Vanessa de Pietro Soares | — | 137.674.498-89 | Gran Paradiso | Distrato por Atraso | assinado | R$ 3.300 12x R$ 275 | 20% | 26/06/2026 | Ana Cristina |
| Flavio de Carvalho Pereira | — | 849.125.456-00 | Alta Vista | Cota Quitada sem Matrícula | rascunho | R$ 3.000 12x R$ 250 | 20% | 25/06/2026 | Mariana |
| Terezinha de Jesus Paulino da Costa | — | 122.551.748-63 | Ondas Praia | Devolução 80% | rascunho | Somente êxito | 30% | 25/06/2026 | Maria |
| Ernando Raimundo dos Santos Filho | — | 048.177.056-98 | Ondas Praia | Ação de Cobrança | assinado | Somente êxito | 35% | 25/06/2026 | Mariana |
| Gabriel Silva Pires de Almeida | — | 142.047.217-88 | Ondas Praia | Revisão de Distrato | assinado | R$ 3.300 12x R$ 275 | 20% | 25/06/2026 | Beatriz |

Tipos de ação reais: Ação de Cobrança, Cancelamento de Contrato, Cota Quitada sem Matrícula, Dano Moral,
Devolução 80%, Devolução 50%, Distrato por Atraso, Execução Honorários, Revisão de Distrato.
Resorts reais: Ondas Praia, Thermas São Pedro, Ilhas do Lago, Leaves Premium, Olimpia Park Resort,
Lagoa Quente/Ecotowers, Alta Vista, Gran Paradiso, Encontro das Águas, Águas da Serra, Costa do Sauípe, Praia Bonita.

## Requisitos de cada mockup
- **1 arquivo HTML autocontido** (CSS no `<style>`, JS vanilla no `<script>`, Google Fonts via CDN ok, sem build).
- Desktop-first (a equipe usa desktop), mas sem quebrar em ~768px.
- **Interativo**: alternar entre as duas abas ("Novo Contrato" / "Contratos Salvos"), filtros de status funcionando,
  cards/linhas expansíveis, busca filtrando de verdade os dados embutidos, steps/acordeões navegáveis, micro-interações.
- Preview do documento pode ser simulado (bloco de papel com texto do contrato usando as cláusulas reais).
- Todo texto em **pt-BR**.
- Badge fixo discreto no canto inferior com o nome do mockup + link "← Todos os mockups" para `index.html`.
- **Ícones somente SVG inline** (traço consistente). PROIBIDO emoji como ícone.
- Tipografia distintiva via Google Fonts (PROIBIDO Inter, Roboto, Arial, system-ui como fonte principal, Space Grotesk).
- Números tabulares (`font-variant-numeric: tabular-nums`) em valores, CPFs e datas.
- Status SEMPRE com cor + ícone + rótulo (nunca só cor). Contraste AA (4.5:1) em texto.
- Micro-interações 150–300ms, entrada da página com reveal escalonado (animation-delay), hover states caprichados.
- Corpo de texto ≥ 13px; rótulos ≥ 11px. Fugir da micro-tipografia do sistema atual.

---

# V2 — RESTRIÇÕES OBRIGATÓRIAS (revisão do usuário, 01/07/2026)

O usuário pediu: **"Refazer todos os mockups para respeitarem o design system atual. Não deve mudar o padrão do contrato, somente o formulário e a aba de contratos salvos."**

Ou seja: MANTER o conceito de UX de cada mockup (estrutura, layout, interações), mas re-skin completo dentro da identidade visual atual do sistema. As seções abaixo SOBRESCREVEM qualquer instrução anterior de fontes/cores/estética.

## 1. Design system atual (usar EXATAMENTE estes tokens)

**Fontes** (PROIBIDO Google Fonts para a UI):
- UI: `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`
- Dados tabulares/tokens (opcional, com moderação): `ui-monospace, 'SF Mono', SFMono-Regular, Menlo, monospace`
- Documento (contrato/procuração): `'Times New Roman', Times, serif` (ver §3)

**Cores claras (tema principal):**
- Navy principal `#1B3A5C` · navy-light `#264a72` · navy-dark `#0F2035` (tab bar/header escuro)
- Fundo do app `#F0F4F8` (cream) · borda suave `#E4EAF0` · painel/realce azul-claro `#EEF4FF` com borda `#C0D0E8`
- Texto: títulos/valores `#333`–`#1A1A1A`, labels `#5A6070`, secundário gray-400/500 do Tailwind
- Cards brancos, `border-radius` 12px (rounded-xl), sombra `0 1px 6px rgba(0,0,0,.09)`

**Status (idênticos ao sistema):**
- Rascunho: texto `#9CA3AF`, fundo `#F3F4F6`
- Enviado/Aguardando: texto `#2563EB`, fundo `#EFF6FF`
- Assinado: texto `#16A34A`, fundo `#F0FDF4`
- Cancelado: texto `#DC2626`, fundo `#FEF2F2`
- Sempre cor + ícone SVG + rótulo. NADA de dourado, oliva, sálvia, terracota, ciano etc.

**Tema escuro (somente para o mockup M2, que é dark):** usar o dark do sistema — fundo `#111827` (gray-900), superfícies `#1F2937` (gray-800), bordas `#374151`, header `#0F172A`, barra de abas `#020617`, texto gray-100/300/400, acento azul `#60A5FA`/`#2563EB`. Sem acentos exóticos.

**Componentes de referência do sistema:**
- Header: barra navy `#1B3A5C` com "CONFORTO, BERGONSI & CAVALARI ADVOGADOS" (bold, uppercase, tracking) e "OAB/SP n 55227 — Americana - SP" menor com opacidade.
- Abas principais: barra `#0F2035`, botões uppercase bold pequenos, aba ativa `bg-white/10` texto branco, inativa `text-white/50`.
- Cabeçalhos de seção/card: fundo navy, texto branco uppercase 11–12px bold tracking 1px.
- Inputs: borda `#D1D5DB`, rounded-lg (8px), focus borda navy + ring navy/30; labels uppercase bold pequenas navy.
- Botão primário: navy sólido, texto branco uppercase bold 12px; secundário: fundo `#EEF4FF` texto navy borda `#C0D0E8`; perigo: borda/texto vermelho.
- Badges: pill com fundo pastel + texto colorido (padrões de status acima).

**Permitido melhorar (objetivo do redesign):** legibilidade (corpo ≥ 13px, labels ≥ 11px, menos uppercase gratuito em texto corrido), hierarquia, espaçamento, micro-interações 150–300ms, reveal escalonado. O resultado deve parecer uma **evolução natural do sistema atual** — mesma marca, mesma linguagem — e não outro produto.

## 2. O que cada mockup MANTÉM da sua v1
O conceito estrutural e as interações: M1 ledger/livro de registros e seções numeradas · M2 tabela densa + drawer + ⌘K + atalhos · M3 kanban por status + trilha de etapas · M4 wizard capítulo-a-capítulo + documento vivo · M5 stat-cards que filtram + grid de cards + painel de resumo sticky. Dados reais idem v1.

## 3. PADRÃO DO DOCUMENTO — INTOCÁVEL
Onde houver preview do contrato/procuração, renderizar o documento EXATAMENTE como o sistema gera hoje (página branca, sem timbre, sem monograma, sem marca d'água, sem highlights persistentes, sem tipografia decorativa):
- `font-family: 'Times New Roman', Times, serif; font-size: 12pt; line-height: 1.8; text-align: justify; color: #000; padding: 30px 35px;` sobre página branca com sombra leve de papel.
- Título centralizado bold 14pt: `CONTRATO DE PRESTAÇÃO DE SERVIÇOS E HONORÁRIOS ADVOCATÍCIOS`
- Preâmbulo: "Pelo presente instrumento particular de prestação de serviços jurídicos, de um lado:" + qualificação do(s) contratante(s) em caixa alta no nome (**NOME**, nacionalidade, estado civil, profissão, RG: …, CPF: …, e-mail: …, residente e domiciliado na …, no bairro …, na cidade …/UF, CEP: …), depois: "**CONFORTO E BERGONSI SOCIEDADE DE ADVOGADOS**, CNPJ 56.096.172/0001-65, doravante como contratado; têm entre si, justos e avençados, o que adiante segue: **[AÇÃO] REFERENTE AO [RESORT]**." (tudo em caixa alta no trecho da ação).
- Cláusulas numeradas como `<p><strong>1- </strong>texto…</p>`; parágrafos (§) como `<p style="text-indent:40px">texto…</p>` SEM título separado — o texto corrido das cláusulas reais do brief.
- Encerramento: "E por estarem as partes acima contratadas firmam o presente contrato particular para que produza seus legais e regulares efeitos de direito." + "Americana, data da assinatura digital."
- Assinaturas: linha superior de 280px centralizada + nome em caixa alta; contratantes primeiro, depois os advogados **BRUNO CAVALARI GOMES CAMARGO — OAB/SP 390.509** e **PAULO ROBERTO CONFORTO — OAB/SP 391.151** lado a lado.
- Procuração Ad Judicia: mesma folha/estilo Times.
- Nenhuma animação/decoração DENTRO do documento (M4: a indicação de "onde estou editando" deve ficar FORA do papel, ex. barrinha "Editando: Cláusula 2ª — Honorários" acima do preview, como o sistema já faz).

## 4. Renomear referências visuais
Nos badges/títulos internos, manter os nomes dos mockups, mas remover menções a "dourado", fontes específicas etc. que não se apliquem mais.
