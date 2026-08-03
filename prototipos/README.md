# Protótipos — nada aqui vai para produção

Esta pasta guarda **mockups descartáveis**: telas em HTML puro usadas para escolher um
caminho antes de mexer no app de verdade. São 48 arquivos, ~2,7 MB.

## Por que ficam no repositório

Porque a decisão que eles registram continua valendo depois. Quando o guia do projeto ou
uma memória diz "mockup M2 escolhido", é para um arquivo daqui que ela aponta — apagar a
pasta apagaria o registro de por que a tela ficou do jeito que ficou.

## Como o build os ignora

Nada aqui é publicado, e isso não depende de ninguém lembrar:

- **A raiz do deploy é `client/`.** Esta pasta está fora dela, então o Vite nunca a
  enxerga e o Netlify nunca a envia.
- **O lint a exclui** explicitamente (`globalIgnores` em `client/eslint.config.js`),
  junto com `dist`, `backups` e `coverage`.

Conferido em 03/08/2026: nenhuma referência a `prototipos` em `netlify.toml`,
`package.json` ou `vite.config.js`.

## Ao criar um protótipo novo

Uma pasta por decisão, com nome que diga o assunto, e um `README.md` de uma linha dizendo
qual opção foi escolhida e em que data. Sem isso, daqui a três meses ninguém sabe qual dos
cinco arquivos virou o app.

## Onde fica o resto

| Pasta | O que é |
|---|---|
| `client/` | o aplicativo (é a raiz do deploy) |
| `docs/` | documentação viva: runbooks, referências de API, guias |
| `backups/` | cópias com data, feitas antes de cada alteração crítica |
| `relatorios/` | relatórios gerados para a equipe (PDF) |
| `prototipos/` | esta pasta: mockups, nunca publicados |
