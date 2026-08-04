// ─────────────────────────────────────────────────────────────────────────
// (auditoria 01/08/2026 — item 287) LINGUAGEM ÚNICA DE ÍCONE.
//
// O sistema falava três línguas ao mesmo tempo: Heroicons em 56 arquivos, emoji em 31 e
// SVG desenhado à mão em alguns. O problema não é estético:
//
//   1. Emoji IGNORA a cor do texto. Num botão dourado, num cabeçalho navy ou no modo
//      escuro, o ícone continua com as cores dele — foi assim que avisos ficaram
//      ilegíveis no tema escuro.
//   2. O desenho vem do APARELHO, não do sistema: o mesmo ⚠️ é amarelo no iPhone,
//      laranja no Android e cinza no Windows. Num produto jurídico isso lê como
//      descuido.
//
// Este componente existe para que trocar de ícone seja uma linha, e para que nenhuma
// tela precise importar cinco ícones diferentes só para mostrar um aviso.
//
// USO:  <Ico nome="aviso" />                 tamanho padrão, herda a cor do texto
//       <Ico nome="ok" className="w-3 h-3" /> tamanho sob medida
//
// Todo ícone é decorativo por padrão (aria-hidden): quem precisa de significado deve
// escrevê-lo em texto ao lado, nunca depender do desenho — a mesma regra que já vale
// para os estados de erro do formulário.
// ─────────────────────────────────────────────────────────────────────────
import {
  ExclamationTriangleIcon, CheckIcon, CheckCircleIcon, XMarkIcon, XCircleIcon,
  SparklesIcon, ScaleIcon, ClipboardDocumentListIcon, CalendarDaysIcon,
  TrophyIcon, BellIcon, BellSlashIcon, TrashIcon, MagnifyingGlassIcon,
  ChatBubbleLeftRightIcon, ArrowDownTrayIcon, NoSymbolIcon, ClockIcon,
  LinkIcon, DocumentTextIcon, CurrencyDollarIcon, UserIcon, BuildingOffice2Icon,
  PhoneIcon, EnvelopeIcon, ArrowPathIcon, InformationCircleIcon, LightBulbIcon,
  RocketLaunchIcon, ChartBarIcon, FlagIcon, LockClosedIcon, PaperAirplaneIcon,
  ArrowTrendingUpIcon, ArrowTrendingDownIcon, FireIcon, HandThumbUpIcon,
} from '@heroicons/react/24/outline';

// De-para do que existia em emoji para o nome que as telas usam agora.
// A chave é o SIGNIFICADO, não o desenho: assim trocar o ícone no futuro não exige
// caçar 130 lugares.
const MAPA = {
  aviso: ExclamationTriangleIcon,      // ⚠ ⚠️
  ok: CheckIcon,                        // ✓
  okCirculo: CheckCircleIcon,           // ✅
  fechar: XMarkIcon,                    // ✕ ✖
  erro: XCircleIcon,                    // ❌
  celebrar: SparklesIcon,               // 🎉 🎊
  juridico: ScaleIcon,                  // ⚖ ⚖️
  lista: ClipboardDocumentListIcon,     // 📋 📝
  agenda: CalendarDaysIcon,             // 📅 🗓
  trofeu: TrophyIcon,                   // 🏆 🥇 🥈 🥉
  sino: BellIcon,                       // 🔔
  sinoMudo: BellSlashIcon,              // 🔕
  lixeira: TrashIcon,                   // 🗑 🗑️
  buscar: MagnifyingGlassIcon,          // 🔎 🔍
  conversa: ChatBubbleLeftRightIcon,    // 💬
  baixar: ArrowDownTrayIcon,            // ⬇ 📥
  bloqueado: NoSymbolIcon,              // 🚫
  relogio: ClockIcon,                   // ⏳ ⏰ 🕐
  link: LinkIcon,                       // 🔗
  documento: DocumentTextIcon,          // 📄 📃
  dinheiro: CurrencyDollarIcon,         // 💰 💵
  pessoa: UserIcon,                     // 👤 🙋
  empresa: BuildingOffice2Icon,         // 🏢 🏨
  telefone: PhoneIcon,                  // 📱 ☎ 📞
  email: EnvelopeIcon,                  // ✉ 📧
  atualizar: ArrowPathIcon,             // 🔄 ♻
  info: InformationCircleIcon,          // ℹ
  ideia: LightBulbIcon,                 // 💡
  lancar: RocketLaunchIcon,             // 🚀
  grafico: ChartBarIcon,                // 📊 📈
  bandeira: FlagIcon,                   // 🚩 🏁
  cadeado: LockClosedIcon,              // 🔒 🔐
  enviar: PaperAirplaneIcon,            // 📤 ✈
  subindo: ArrowTrendingUpIcon,         // 📈 ⬆
  descendo: ArrowTrendingDownIcon,      // 📉 ⬇
  quente: FireIcon,                     // 🔥
  positivo: HandThumbUpIcon,            // 👍
};

export default function Ico({ nome, className = 'w-4 h-4', ...resto }) {
  const Componente = MAPA[nome] || InformationCircleIcon;
  return <Componente className={className} aria-hidden="true" {...resto} />;
}
