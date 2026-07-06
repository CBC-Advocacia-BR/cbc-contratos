# Painel CBC em um computador novo — guia definitivo (testado)

> Consolida **tudo que precisou ser feito** para o painel funcionar sem erros (02/07/2026): formato do arquivo, carregamento sequencial, credenciais na aba certa, permissões do banco (já corrigidas no servidor) e fuso horário. Seguindo a ordem abaixo, nenhum dos erros da primeira instalação se repete.
>
> 🔑 **A senha do banco NÃO está neste arquivo** (ele fica no repositório/git). Ela está no **guia navegável privado** (Artifact 🔧, link com o Paulo) e na pergunta ao Claude ("qual a senha do Power BI?").

## Qual arquivo levar (o mais fácil para um PC que nunca viu o painel)

| Arquivo | Ao abrir num PC novo | Quando usar |
|---|---|---|
| **`CBC-Painel.pbix`** (salvo com dados) | abre **pronto, com dados, sem senha** | **o mais fácil — recomendado** |
| `...pbit` (template) | ❌ abre **vazio** e conecta ao banco na hora → erro de certificado | evitar para compartilhar |
| `CBC-Painel-PowerBI-v5.zip` (.pbip) | abre vazio; precisa Atualizar (senha + ajuste) | montar/editar do zero |

⚠️ **`.pbit` ≠ `.pbix`.** O `.pbit` (feito por "Exportar → Modelo do Power BI") **não leva os dados** — sempre tenta conectar ao abrir, e é o que causa o erro "O certificado remoto é inválido". Para compartilhar, use **Arquivo → Salvar como → tipo Arquivos do Power BI (\*.pbix)**. O `.pbix` com dados dispensa login para **visualizar** — só pede senha se clicar em Atualizar.

## Gerar o `.pbix` com dados (no PC que já funciona · 3 min)

> Só o Power BI Desktop (Windows) consegue embutir os dados no `.pbix` — não é possível gerar esse arquivo por fora. O passo abaixo é o que "baixa os dados para dentro".

1. Abra o painel que já funciona → clique em **Atualizar** (pega as últimas mudanças: equipes, crédito de publicações, regra de vencida etc.). Aguarde 2–4 min.
2. **Arquivo → Salvar como** → tipo **Arquivos do Power BI (*.pbix)** → salve como `CBC-Painel.pbix`.
3. Esse `.pbix` carrega **os dados dentro dele** — é ele que você leva (pendrive, Drive, e-mail interno).
4. ⚠️ **Não use "Exportar → Modelo do Power BI"** (gera `.pbit` vazio → erro de certificado no outro PC). O que embute os dados é **Salvar como → *.pbix**. E trate o arquivo como **confidencial** (dados de clientes).

## No computador novo — Caminho A: com o `.pbix` (recomendado, ~10 min)

1. **Instalar o Power BI Desktop**: Microsoft Store → "Power BI Desktop" → Instalar (gratuito). **Não precisa de conta** para usar — login só serve para Publicar.
2. **Abrir o `CBC-Painel.pbix`** (dois cliques) → o painel abre **completo, com dados, sem pedir senha**.
3. **Conferir 1 opção (30 segundos — importante)**: Arquivo → Opções e configurações → Opções → seção **ARQUIVO ATUAL → Carregamento de Dados** → **"Habilitar carregamento paralelo de tabelas"** deve estar **DESMARCADO**. (Se estiver marcado: desmarque → OK.) *Motivo: o banco aceita 15 conexões simultâneas; com paralelo ligado o Power BI tenta baixar as 10 tabelas juntas e estoura o limite.*
4. **Primeira atualização** (quando quiser dados novos): botão **Atualizar** → janela de credenciais:
   - Clique na aba **"Banco de dados"** à esquerda — ⚠️ **NUNCA** use a aba "Windows" (erro clássico).
   - **Usuário**: `powerbi_cbc.vygczeepvoyaehfchxko` (o sufixo faz parte do usuário!)
   - **Senha**: a senha do BI (guardada com o Paulo/Claude).
   - Se aparecer aviso de **criptografia**: aceite conectar assim mesmo. (Se der erro direto: Opções e configurações → Configurações da fonte de dados → selecione o servidor → Editar Permissões → desmarque "Criptografar conexões" → tente de novo.)
5. Aguarde **2–4 min** — as tabelas baixam **uma por vez** (comportamento correto). Depois: **Arquivo → Salvar**.

## Caminho B: do zero, sem o `.pbix` (~15 min)

1. Baixe `powerbi/CBC-Painel-PowerBI-v5.zip` do repositório (use sempre a **versão mais recente** — as antigas tinham os erros de formato).
2. **Extraia TUDO** (botão direito → Extrair Tudo — nunca abra de dentro do ZIP).
3. Instale o Power BI Desktop (passo A.1) e abra `CBC-Painel.pbip`.
4. **ANTES de atualizar**: faça o passo A.3 (desmarcar carregamento paralelo) — no caminho B isso é **obrigatório**, o arquivo novo vem com a opção ligada por padrão.
5. Siga os passos A.4 e A.5 (o arquivo abre vazio; os dados entram no primeiro Atualizar).

## Publicar no navegador (opcional)

Exige conta Microsoft de **e-mail corporativo** — se não tiver, crie grátis com o e-mail do escritório (seção 8.0 do `POWERBI_PAINEL_TUTORIAL.md`). Depois: Entrar no Desktop → Publicar → Meu workspace → agendar atualização 07h/18h em app.powerbi.com.

## Todos os erros que já aconteceram — e a solução na hora

| Mensagem na tela | Causa | Solução |
|---|---|---|
| `Missing required artifact 'model.bim'` | pacote em formato novo (v1) | usar o `.pbix` atual ou o ZIP **v5** (formato clássico) |
| `A medida 'Retrabalho' não pode ser criada porque já existe uma coluna` | pacote v2 antigo | usar v5 |
| `Falha ao carregar o relatório / Erro ao renderizar` | pacote v3 antigo | usar v5 |
| `max clients reached... pool_size: 15` (e/ou `OLE DB 0x80040E4E` em várias tabelas) | carregamento paralelo ligado | desmarcar a opção (passo A.3) → **fechar e reabrir** o Power BI → Atualizar |
| `O certificado remoto é inválido…` (ao abrir/atualizar) | o PC não valida o certificado do banco (antivírus/proxy/root desatualizado) | **desligar a validação**: Arquivo → Opções e configurações → Configurações da fonte de dados → selecione o servidor → Editar Permissões → desmarque "Criptografar conexões" → OK → Atualizar. Melhor: usar o `.pbix` com dados (nem conecta). |
| `permission denied for table contratos` | permissão no banco | já corrigida no servidor (02/07); só atualizar de novo — se voltar, avisar o Claude |
| `Um erro ao carregar uma tabela anterior cancelou o carregamento` | não é o erro real | procure a ÚNICA tabela com mensagem diferente — ela é a causa |
| Credencial recusada | aba errada ou usuário incompleto | aba **"Banco de dados"** + usuário com o sufixo `.vygczeepvoyaehfchxko` inteiro |
| Números de "hoje/vencida" estranhos à noite | fuso | corrigido no servidor (horário de Brasília) — nada a fazer |
| Pede login ao abrir | não pede — login é só para Publicar | pode usar sem conta |

## Regras de ouro

- Sempre **extrair o ZIP inteiro** antes de abrir.
- O espelho sincroniza com o ADVBOX às **6h30 e 17h30** (seg–sex) — Atualizar fora disso traz a última foto.
- Senha do banco: com o Paulo (ou perguntar ao Claude "qual a senha do Power BI?").
- Qualquer tela de erro nova: **print (ou "Copiar detalhes") → mandar para o Claude** — todo o pacote é texto e se corrige em minutos.

*Guias-irmãos: `POWERBI_PAINEL_TUTORIAL.md` (montar/editar) · `POWERBI_GUIA_PAINEL.md` (ler e interpretar).*
