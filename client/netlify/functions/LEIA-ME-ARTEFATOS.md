# ⚠️ NÃO cole aqui artefatos baixados de deploys da Netlify

Em 2026-07-02 a produção ficou fora do ar (~8h) porque estes arquivos foram
substituídos por artefatos BAIXADOS de um deploy (com o prelúdio
`import {createRequire as ___nfyCreateRequire} ...` / `let __filename=...`).
No deploy seguinte a Netlify adiciona o MESMO prelúdio de novo → `let`
duplicado → SyntaxError na inicialização → todas as funções respondem 502
("error decoding lambda response").

Correção aplicada: prelúdio removido dos 57 arquivos (backup em
`backups/20260702_052022_functions_prelude_fix/`). Se precisar recuperar uma
função de um deploy antigo, REMOVA as 6 primeiras linhas do prelúdio antes de
salvar aqui.
