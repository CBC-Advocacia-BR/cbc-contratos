// (auditoria 01/08/2026 — itens 227/296) Fuso FIXO nos testes.
//
// POR QUE: depois que os computes do funil passaram a ler dia/mes em hora LOCAL
// (e nao mais cortando a string UTC), o resultado de qualquer teste com data passou
// a depender do fuso da maquina. O Mac do escritorio roda em America/Sao_Paulo e o
// GitHub Actions roda em UTC — sem isto, o MESMO teste passaria aqui e falharia no CI
// (ou pior: passaria nos dois por acidente e esconderia uma regressao de fuso).
//
// America/Sao_Paulo e o fuso do negocio: e nele que "a call foi dia 31" e verdade.
// Node aplica a mudanca de process.env.TZ nas proximas leituras de Date, e o vitest
// carrega os setupFiles antes dos arquivos de teste.
process.env.TZ = 'America/Sao_Paulo';
