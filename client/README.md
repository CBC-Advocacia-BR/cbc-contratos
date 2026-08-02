# client/ — o aplicativo

Esta pasta **é a raiz do app no Netlify**: o build e o deploy saem daqui.

👉 **A documentação de entrada está em [`../README.md`](../README.md)** (o que o sistema é,
como rodar, como subir, o que não fazer). As decisões, regras de negócio e o histórico
detalhado estão em [`../CLAUDE.md`](../CLAUDE.md).

Este arquivo era o template do Vite ("React + Vite… two official plugins are available"),
que não dizia nada sobre este projeto — substituído em 02/08/2026 (auditoria, item 303).

## O que tem aqui

| Pasta | Conteúdo |
|---|---|
| `src/` | O aplicativo React — componentes, hooks, utilitários, testes |
| `src/utils/__tests__/` | Suíte de testes (vitest) — lógica pura, sem navegador |
| `netlify/functions/` | ~65 funções de servidor (`.mjs`, Node 22) + bibliotecas em `_lib/` |
| `netlify/edge-functions/` | 2 funções de borda (Deno/TypeScript): `health` e o proxy do ZapSign |
| `public/` | Arquivos servidos como estão (cabeçalhos, ícones, service worker do portal) |
| `portal.html` | **Entrada do Portal do Cliente** — este arquivo é o oficial; o de `public/` não entra no build |
| `dist/` | Resultado do build (não versionado) |

## Comandos

Preferir os atalhos da raiz (`npm run dev`, `npm test`, `npm run verificar`,
`npm run deploy`). Aqui direto, quando precisar de algo específico:

```bash
npm run dev
```

```bash
npm run build
```

```bash
npm test
```

```bash
npm run lint
```

Deploy e rollback: `./deploy.sh` e `./rollback.sh` — **nunca** `netlify deploy` na mão
(o script tem travas que já evitaram a produção regredir meses).

Consumo de banda do Netlify: `./check-bandwidth.sh`.
