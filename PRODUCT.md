# Product

## Register

product

## Users

Sistema web **interno** do escritório CBC Advogados. Quatro perfis, todos com RBAC via `user_permissions.tabs`:

- **Advogados/sócios** — criam contratos, acompanham processos, leem KPIs (Dashboard, Dashboard Sócios). Contexto: alta frequência, querem velocidade e densidade de informação.
- **Secretárias/assistentes/vendedores** — preenchem formulários longos, acompanham assinaturas, gerenciam comissões ("Minhas Vendas"). Contexto: tarefa repetitiva de entrada de dados; precisam de validação clara e zero ambiguidade.
- **Administradores** (`is_admin`) — gestão de usuários/permissões, parametrização de vendas, auditoria.
- **Clientes finais** — assinam via ZapSign, recebem cobrança Asaas, acessam Portal do Cliente e bot WhatsApp (superfícies públicas separadas).

Paulo Conforto (`paulo@advocaciacbc.com`) é o admin master e proprietário; comunica em PT-BR.

## Product Purpose

**CBC Contratos** é uma plataforma end-to-end de **aquisição → contrato → cobrança → acompanhamento processual → relacionamento**. Evoluiu de um gerador de contratos para um cockpit operacional do escritório: cadastro de cliente (OCR de CNH/CPF), geração de contrato+procuração (HTML/PDF/DOCX), assinatura digital (ZapSign), arquivamento no Drive, lançamento no CRM jurídico (ADVBOX), movimentação de lead no CRM comercial (Kommo), cobrança (Asaas), monitoramento de distribuição (DataJud), comissionamento e BI da carteira. Em produção ativa (v6.6.0) em https://contratos-cbc.netlify.app. Sucesso = um operador completa o ciclo de um contrato sem sair do sistema e sem erro de dados, e um sócio enxerga a saúde da carteira em segundos.

## Brand Personality

Profissional jurídico, confiável, institucional — mas **eficiente e moderno**, não burocrático. Três palavras: **confiável, preciso, ágil**. A identidade visual carrega isso: navy (#1B3A5C) + dourado (#C9A84C) sobre creme (#F0F4F8), tipografia Cormorant Garamond (títulos de contrato/logo) + Lato (UI). O sistema deve transmitir a seriedade de um escritório de advocacia sem a friccão de um software jurídico legado.

## Anti-references

- Software jurídico legado (telas densas cinzas, tabelas sem hierarquia, jargão técnico cru exposto ao usuário).
- "AI slop" de dashboard: grid de cards idênticos com número grande + label pequeno + gradiente, eyebrows tracked em toda seção, gradient text.
- SaaS genérico azul-e-branco sem personalidade. A marca CBC (navy/dourado/Cormorant) é o diferencial e deve aparecer.
- Excesso de modais. Preferir progressive disclosure inline.

## Design Principles

1. **A ferramenta some na tarefa.** Para operadores em fluxo repetitivo (formulário, lista, conferência), familiaridade e previsibilidade vencem novidade. Mesmo vocabulário de componentes em todas as abas.
2. **Hierarquia antes de densidade.** O sistema é denso por necessidade (tabelas, KPIs, timelines). Densidade é permitida, mas sempre com um foco claro por tela — um elemento primário, o resto recua.
3. **Estado sempre visível.** Automações (ZapSign/ADVBOX/Drive/Kommo/Asaas) rodam em segundo plano; o usuário precisa enxergar o que aconteceu, o que falhou e o que está pendente sem adivinhar.
4. **Prevenir erro no ponto de entrada.** Validação inline, máscaras, defaults inteligentes e confirmação antes de ações destrutivas — dados de contrato têm valor jurídico.
5. **Marca como sinal, não decoração.** Navy/dourado/Cormorant marcam ação primária, seleção e títulos; nunca poluem estados inativos nem viram enfeite.

## Accessibility & Inclusion

- Contraste WCAG AA (≥4.5:1 corpo, ≥3:1 texto grande) — atenção ao dourado #C9A84C sobre fundos claros (insuficiente para texto pequeno; usar só em superfícies escuras ou como acento gráfico).
- Dark mode já suportado via tokens `--cbc-*`; manter paridade de contraste no dark.
- `prefers-reduced-motion`: toda animação precisa de alternativa (crossfade/instantâneo).
- Touch targets ≥44px em `pointer:coarse` (mobile/iPad já tratado no redesign Mobile 2.0).
- Significado nunca só por cor (status de contrato/boleto precisa de rótulo + ícone, não só verde/vermelho).
