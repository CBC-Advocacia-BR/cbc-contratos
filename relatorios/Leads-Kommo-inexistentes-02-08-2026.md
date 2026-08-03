# Leads do Kommo que nao existem mais — corrigir o "Link Kommo"

Gerado em 02/08/2026 · 57 leads mortos

## O que aconteceu

O campo **Link Kommo** do contrato aponta para um lead que **nao existe mais** no Kommo (apagado, ou mesclado com outro lead — o merge apaga o perdedor). Enquanto o link estiver errado, esse cliente **nao recebe** no Kommo as notas de andamento do processo, de tarefa concluida, nem as mensagens de cobranca.

## Como corrigir

1. No Kommo, achar o lead **atual** do cliente (o que sobreviveu ao merge).
2. No sistema, abrir o contrato e trocar o **Link Kommo** do contratante pelo link do lead certo.
3. Avisar quem cuida do sistema para liberar o lead: `delete from kommo_leads_mortos where lead_id = '<id>';`

A partir dai o fluxo volta sozinho. Nada precisa ser reenviado a mao: as notas antigas nao voltam, mas os proximos andamentos passam a chegar normalmente.

## Contratos afetados (37 leads · 271 notas e 7 cobrancas perdidas)

| Cliente(s) | Contrato | Lead morto | Morto desde | Dias | Notas perdidas | Cobrancas nao enviadas |
|---|---|---|---|---|---|---|
| Vanessa Cristina Stievano Alves | b0c7e3e1 (assinado) | 18219824 | 13/07/2026 | 20 | 18 | 0 |
| Leonel do Carmo Salles | 4266f316 (assinado) | 18228060 | 17/07/2026 | 16 | 14 | 0 |
| Jean Carlos Lopes + Valquiria Sena da Silva Lopes | c49674d7 (assinado) | 6137642 | 22/06/2026 | 41 | 13 | 0 |
| Vladimir Eduardo Alexandre Ribeiro + Andreita Maria Alves Ribeiro | 447f0ff7 (assinado) | 10008370 | 01/07/2026 | 32 | 12 | 0 |
| Juliana Alves dos Anjos | c3ace7c7 (assinado) | 18228652 | 13/07/2026 | 20 | 12 | 0 |
| Cezario Carlos Guin + Neusa Terezinha Ferronato Pelle Guin | 9664d2d4 (assinado) | 18235948 | 14/07/2026 | 19 | 12 | 0 |
| Regina Cardoso Willmann | eb523bd7 (assinado) | 18227926 | 15/07/2026 | 18 | 12 | 0 |
| Lucineia Rodrigues de Farias + Germano Bruno Rizo de Farias | f2bedaf4 (assinado) | 6104736 | 25/06/2026 | 38 | 11 | 0 |
| Rosemary Aparecida Piccioni + Jose Mauro Madeiro | 98d080ae (assinado) | 18235856 | 14/07/2026 | 19 | 11 | 0 |
| Daniela Aparecida Manoel Caetano + Robson Bastos Caetano | 78956bd8 (assinado) | 17039280 | 14/07/2026 | 19 | 11 | 0 |
| Flavio De Carvalho Pereira + Fabiana Custodio Vieira | 85fbb169 (rascunho), f7c6d9cb (assinado) | 18219676 | 16/07/2026 | 17 | 11 | 0 |
| Eduardo Rodrigues da Silva + Veronica Marques | 7774ba96 (assinado) | 18232318 | 13/07/2026 | 20 | 10 | 0 |
| Janaina Mourao de Souza + Robson Rocha de Souza | ddf03f75 (assinado) | 6104738 | 22/06/2026 | 41 | 9 | 0 |
| Jefferson Machado Pirilo + Natalia Goncalves Santana Pirilo | 36dc159d (rascunho), b2978363 (assinado) | 6947534 | 30/06/2026 | 33 | 2 | 7 |
| Wagner de Souza Almeida + Cristiane Americo de Souza | 1a2af084 (assinado) | 18215576 | 13/07/2026 | 20 | 9 | 0 |
| Jaqueline Leite Ferreira da Cruz + Lincon Alexandre de Oliveira | bfb6db06 (assinado) | 6023416 | 19/06/2026 | 44 | 8 | 0 |
| Adenilson Jose da Silva + Morise Lelia Alves da Silva | 8c9b5009 (assinado) | 5810762 | 30/06/2026 | 33 | 8 | 0 |
| Regis Fernando Gomes da Silva | 5c0aacdf (assinado) | 7339832 | 02/07/2026 | 31 | 8 | 0 |
| Wesley Alvaro de Souza | 2a7c4ad9 (assinado) | 6130226 | 02/07/2026 | 31 | 8 | 0 |
| Fabio Ferreira Mendonca | 04217c91 (assinado) | 18221810 | 13/07/2026 | 20 | 8 | 0 |
| Grazieli Lanutto Vilanova Rodrigues | 9ffbe282 (assinado) | 18219750 | 13/07/2026 | 20 | 8 | 0 |
| Sergio Pignataro | d4f5f852 (assinado) | 11561530 | 30/06/2026 | 33 | 7 | 0 |
| Jose Antonio da Silveira | 6ce19c50 (assinado) | 13771584 | 15/07/2026 | 18 | 7 | 0 |
| Luciane de Paula Genofre + Nelson Kendy Endo | bcb126f4 (assinado) | 18237340 | 15/07/2026 | 18 | 6 | 0 |
| Marinaldo Gomes Batista | 344f5929 (assinado) | 18227230 | 15/07/2026 | 18 | 6 | 0 |
| Carlinhos Marques Ribeiro + Eluciane Roque Marques | 1eb29b6f (assinado) | 14015606 | 09/07/2026 | 24 | 5 | 0 |
| Francisco Marcos Barros | 29e5d82d (assinado) | 13160118 | 13/07/2026 | 20 | 5 | 0 |
| Anderson Ribeiro | 1e18f9e5 (assinado) | 6953956 | 01/07/2026 | 32 | 3 | 0 |
| Gabriel Silva Pires de Almeida | f46894d3 (assinado) | 18220764 | 15/07/2026 | 18 | 3 | 0 |
| Terezinha de Jesus Paulino da Costa | 1c5000de (rascunho), 197d27c5 (enviado_zapsign), ac366dd5 (enviado_zapsign), 45836412 (assinado) | 5663364 | 16/07/2026 | 17 | 3 | 0 |
| Joao Batista dos Santos | 0e1df48b (assinado) | 18228460 | 24/07/2026 | 9 | 3 | 0 |
| Camila Oliveira Ramos de Paula + Wanderson Rodrigues de Paula | ceb19769 (assinado) | 5663384 | 02/07/2026 | 31 | 2 | 0 |
| Alessandra Rigon Ribeiro | 3f1b01e7 (assinado) | 10690428 | 15/07/2026 | 18 | 2 | 0 |
| Kaue Gustavo Piai Silva | e392335b (assinado) | 6327122 | 02/07/2026 | 31 | 1 | 0 |
| JOAO CARLOS FERREIRA DE FREITAS + ANDRE DA SILVA BARROS | 16ed594c (assinado) | 18222192 | 14/07/2026 | 19 | 1 | 0 |
| Bruna Caroline Villela Campos + Leandro de Campos Goncalves | 67c34dd2 (assinado) | 5780790 | 14/07/2026 | 19 | 1 | 0 |
| Sebastiao Ferreira Araujo | bb89b7e8 (assinado) | 6040454 | 29/07/2026 | 4 | 1 | 0 |

## Leads mortos sem contrato vinculado (20)

Vieram da regua de cobranca (cadastro do cliente/Asaas), nao do formulario de contrato. Corrigir o lead no cadastro do cliente.

| Lead morto | Morto desde | Dias | Notas perdidas | Cobrancas nao enviadas |
|---|---|---|---|---|
| 15397984 | 06/07/2026 | 27 | 0 | 4 |
| 33905116 | 06/07/2026 | 27 | 0 | 4 |
| 12838804 | 13/07/2026 | 20 | 0 | 3 |
| 16804722 | 13/07/2026 | 20 | 0 | 3 |
| 10691304 | 13/07/2026 | 20 | 0 | 3 |
| 12837508 | 13/07/2026 | 20 | 0 | 3 |
| 12837512 | 13/07/2026 | 20 | 0 | 3 |
| 12836018 | 13/07/2026 | 20 | 0 | 3 |
| 12834634 | 13/07/2026 | 20 | 0 | 3 |
| 12833200 | 13/07/2026 | 20 | 0 | 3 |
| 12837654 | 13/07/2026 | 20 | 0 | 3 |
| 17057832 | 13/07/2026 | 20 | 0 | 3 |
| 5828432 | 20/07/2026 | 13 | 0 | 2 |
| 9353250 | 20/07/2026 | 13 | 0 | 2 |
| 12839132 | 20/07/2026 | 13 | 0 | 2 |
| 12831976 | 24/07/2026 | 9 | 0 | 2 |
| 10690030 | 06/07/2026 | 27 | 0 | 1 |
| 12839870 | 24/07/2026 | 9 | 0 | 1 |
| 12808134 | 31/07/2026 | 2 | 0 | 1 |
| 16719658 | 31/07/2026 | 2 | 0 | 1 |
