export const CLAUSULAS_PADRAO = [
  {
    id: 'clausula1',
    titulo: 'Cláusula 1ª — Do Objeto e da Natureza do Serviço',
    texto: '', // Gerada automaticamente com os dados de ação/resort
    editavel: false,
    autoObjeto: true,
  },
  {
    id: 'clausula2',
    titulo: 'Cláusula 2ª — Do Escopo de Atuação',
    texto: '', // Gerada automaticamente com tabela INCLUÍDO/NÃO INCLUÍDO
    editavel: false,
    autoEscopo: true,
  },
  {
    id: 'clausula3',
    titulo: 'Cláusula 3ª — Dos Honorários Advocatícios',
    texto: '', // Preenchida automaticamente
    editavel: false,
    auto: true,
  },
  {
    id: 'clausula4',
    titulo: 'Cláusula 4ª — Da Desistência, Rescisão e Revogação',
    texto: 'a) Desistência antes do ajuizamento: São devidos honorários referentes a uma consulta e uma hora técnica de avaliação de documentos, calculados conforme a tabela de honorários vigente da OAB/SP, com prazo de pagamento de 10 (dez) dias úteis após a notificação.\n\nb) Desistência ou rescisão após o ajuizamento por ato do CLIENTE (inclui desistência da ação, rescisão imotivada, negociação direta com a parte contrária sem participação do ESCRITÓRIO ou qualquer ato que impeça a continuidade do mandato): são devidos todos os honorários fixos integralmente, no prazo de 15 (quinze) dias úteis, além dos honorários de êxito proporcionais: 50% sobre o proveito econômico pretendido antes da sentença; 75% após a sentença/antes do trânsito em julgado; 100% após o trânsito em julgado.\n\nc) Revogação do mandato pelo CLIENTE: Obriga o CLIENTE à nomeação imediata de novo advogado. O ESCRITÓRIO continuará a representar o CLIENTE pelos 10 (dez) dias seguintes à notificação, exclusivamente para evitar prejuízo processual.\n\nd) Renúncia ao mandato pelo ESCRITÓRIO: Em caso de justa causa — incluindo conflito de interesses, inadimplemento prolongado ou falta de urbanidade e tratamento respeitoso —, o ESCRITÓRIO pode renunciar ao mandato, mas continuará atuando por 10 (dez) dias para não prejudicar o CLIENTE. Nessa hipótese, são devidos apenas os honorários proporcionais ao serviço já prestado.',
    editavel: true,
  },
  {
    id: 'clausula5',
    titulo: 'Cláusula 5ª — Das Despesas Processuais',
    texto: 'a) As custas iniciais, taxas de distribuição, emolumentos e demais despesas necessárias ao processo são de responsabilidade exclusiva do CLIENTE e deverão ser pagas previamente quando solicitado pelo ESCRITÓRIO. Essas despesas são pagas diretamente ao Tribunal — não ficam com o escritório.\n\nb) Caso o ESCRITÓRIO antecipe despesas processuais em nome do CLIENTE, este deverá reembolsá-las no prazo de 5 (cinco) dias úteis.\n\nc) O CLIENTE está ciente de que, na hipótese de improcedência total ou parcial da demanda, poderá ser condenado ao pagamento de honorários da parte adversa. O ESCRITÓRIO avaliará e comunicará oportunamente essa possibilidade.',
    editavel: true,
  },
  {
    id: 'clausula6',
    titulo: 'Cláusula 6ª — Da Comunicação, Confidencialidade e LGPD',
    texto: 'a) Canal oficial: Toda comunicação formal entre as partes será realizada exclusivamente pelo WhatsApp (19) 98805-1878. Mensagens em outros canais não geram obrigações ao escritório.\n\nb) Ambas as partes comprometem-se a manter sigilo sobre informações pessoais e processuais, não divulgando conteúdo que possa causar prejuízo à outra parte, a terceiros ou ao andamento do processo.\n\nc) Prestação de contas: O CLIENTE tem direito a solicitar, a qualquer momento, informações sobre o andamento do processo durante a sua vigência.\n\nd) Para os fins da LGPD (Lei 13.709/2018), o ESCRITÓRIO compromete-se a utilizar os dados do CLIENTE exclusivamente para os fins deste contrato, observando os princípios da finalidade, adequação, livre acesso, qualidade, transparência, segurança, prevenção e não discriminação.',
    editavel: true,
  },
  {
    id: 'clausula7',
    titulo: 'Cláusula 7ª — Das Obrigações do Cliente',
    texto: 'a) Manter dados de contato (telefone, e-mail, endereço) sempre atualizados junto ao escritório.\n\nb) Fornecer prontamente todos os documentos e informações solicitados, ciente de que atrasos podem impactar o andamento processual.\n\nc) Abster-se de contatar diretamente a parte adversa ou seus representantes sem prévia autorização do ESCRITÓRIO, sob pena de rescisão por culpa do CLIENTE com as consequências previstas na Cláusula 4ª.\n\nd) Não realizar declarações públicas sobre o processo (redes sociais, mídia) sem autorização prévia do ESCRITÓRIO, para não prejudicar a estratégia processual.',
    editavel: true,
  },
  {
    id: 'clausula8',
    titulo: 'Cláusula 8ª — Das Disposições Gerais',
    texto: 'a) Foro: Comarca de Americana/SP.\n\nb) Lei aplicável: Estatuto da OAB (Lei 8.906/94), Código de Ética e normas da OAB/SP.\n\nc) Alterações: Somente por escrito, assinadas por ambas as partes.\n\nd) A tolerância de uma parte em relação ao descumprimento de obrigação pela outra não implica novação ou renúncia ao direito de exigir cumprimento futuro.',
    editavel: true,
  },
];

export const RESORTS = [
  'Aegea Di Roma', 'Alchimyst', 'Alta Vista', 'Amazone Fun Parks', 'Aquan Prime',
  'Asa Delta (Chateau du Golden)', 'Atrium Thermas', 'AVIVA Ocean', 'Barretos Country',
  'Beach Park', 'Brava Mundo', 'Búzios Beach', 'Búzios Fractional', 'Canastra Hotel',
  'Centrinho dos Ingleses', 'China Park', 'Costão do Santinho', 'Encontro das Águas',
  'ESTALEIRINHO SPE S/A', 'Evian Thermas', 'Golden Dolphin', 'Golden Laghetto',
  'Golden Tulip Canela', 'Golden Villagio', 'Gramado Buona Vitta', 'Gramado Exclusive Resort',
  'Gramado Parks', 'Gramado Termas', 'Gran Garden', 'Gran Paradiso', 'Gran Valley Resort',
  'Grandes Lagos', 'Hard Rock Fortaleza', 'Hard Rock Gramado', 'Hard Rock Ilha do Sol',
  'HOLIDAY STUDIO', 'Hot Beach', 'Hot Beach You', 'Hot Springs', 'Ibiobi Smart Club',
  'Ibiomi Smartclub', 'Ilhas do Lago', 'IMGBRAVA', 'Ipioca Beach', 'Itapirica', 'JANGAL',
  'Jardim das Palmeiras II', 'Jardins da Lagoa', 'JERIQUIÁ DUNAS', 'JERIQUIÁ LAGOA RESORT',
  'JUREMA MORADA DA SERRA', 'Kawana', 'Lagoa Quente/Ecotowers', 'Laguna',
  'Le Charmat de Luxe', 'Leaves Premium', 'Livyd Angra dos Reis', 'Long Beach',
  'Mirante da Serra', 'Momentum', 'My Mabu', 'Ohana Beach Park', 'Oikos Maragogi Resort',
  'Olimpia Park Resort', 'Ondas Praia', 'OWN TIME HOME CLUB', 'Penha Wish Resort',
  'Pipa Island', 'Pipa Ocean', 'Pirâmide Palace', 'PITANGUI BEACH RESORT', 'Poehma Resort',
  'Porto 2 Life', 'Porto Alto Resort', 'Porto Galinhas Marina', 'Porto Life Resort',
  'Praia Brava', 'Praias do Lago', 'Pyrenéus Residence', 'Quinta Santa Bárbara Eco Resort',
  'RECANTO CATARATAS', 'Refúgio das Lontras', 'Resort do Lago', 'Riacho Doce',
  'Royal Prime', 'Royal Star', 'Salinas Beach', 'Salinas Premium', 'Solar das Águas',
  'Solar Pedra das Ilhas', 'Stilo Laghetto', 'Terra Nova Ondas', 'TERRENO', 'The Coral',
  'Thermas São Pedro', 'Toulon', 'Varandas', 'Wanderlust', 'Wyndham',
];

export const HONORARIOS_OPCOES = [
  { total: 2700, parcelas: 1, valorParcela: 2700, label: 'À vista' },
  { total: 3000, parcelas: 10, valorParcela: 300, label: '10x' },
  { total: 3000, parcelas: 12, valorParcela: 250, label: '12x' },
  { total: 3300, parcelas: 12, valorParcela: 275, label: '12x' },
];

export const PERCENTUAIS_EXITO = [15, 20, 25, 30];

export const TIPOS_ACAO = [
  'Ação de Cobrança',
  'Cancelamento de Contrato',
  'Cota Quitada sem Matrícula',
  'Dano Moral',
  'Devolução 80%',
  'Devolução 50%',
  'Distrato por Atraso',
  'Revisão de Distrato',
  'Execução Honorários',
];

export const ESTADOS_CIVIS = [
  'Solteiro(a)',
  'Casado(a)',
  'Divorciado(a)',
  'Viúvo(a)',
  'União Estável',
];
