/**
 * Painel "Bot ADVBOX" — versao de TESTE do autoatendimento Kommo x ADVBOX.
 *  - Simulador: converse com o bot se passando por qualquer cliente/processo do ADVBOX
 *  - Novidades: andamentos/tarefas detectados + alerta de "nao comunicado" + resposta pronta
 *  - Etapas / Tarefas / Glossario / Intencoes: parametrizacao completa das respostas
 *  - Testadores: numeros de WhatsApp autorizados a testar o bot de verdade (via Kommo)
 *  - Config: mensagens gerais, template de andamento, integracao Kommo e IA
 */
import { useState, lazy, Suspense } from 'react';
import BackfillBar from './bot/BackfillBar';
import BotPendencias from './bot/BotPendencias';
import {
  ChatBubbleLeftRightIcon, BellAlertIcon, RectangleStackIcon, ClipboardDocumentListIcon,
  LanguageIcon, FunnelIcon, UserGroupIcon, Cog6ToothIcon, ChartBarIcon,
} from '@heroicons/react/24/outline';

const BotSimulator = lazy(() => import('./bot/BotSimulator'));
const BotNovidades = lazy(() => import('./bot/BotNovidades'));
const BotEtapas = lazy(() => import('./bot/BotEtapas'));
const BotTarefas = lazy(() => import('./bot/BotTarefas'));
const BotGlossario = lazy(() => import('./bot/BotGlossario'));
const BotIntencoes = lazy(() => import('./bot/BotIntencoes'));
const BotTestadores = lazy(() => import('./bot/BotTestadores'));
const BotConfig = lazy(() => import('./bot/BotConfig'));
const BotMetricas = lazy(() => import('./bot/BotMetricas'));

const TABS = [
  { key: 'simulador', label: 'Simulador', Icon: ChatBubbleLeftRightIcon, C: BotSimulator },
  { key: 'novidades', label: 'Novidades', Icon: BellAlertIcon, C: BotNovidades },
  { key: 'etapas', label: 'Etapas', Icon: RectangleStackIcon, C: BotEtapas },
  { key: 'tarefas', label: 'Tarefas', Icon: ClipboardDocumentListIcon, C: BotTarefas },
  { key: 'glossario', label: 'Glossário', Icon: LanguageIcon, C: BotGlossario },
  { key: 'intencoes', label: 'Intenções', Icon: FunnelIcon, C: BotIntencoes },
  { key: 'metricas', label: 'Métricas', Icon: ChartBarIcon, C: BotMetricas },
  { key: 'testadores', label: 'Testadores', Icon: UserGroupIcon, C: BotTestadores },
  { key: 'config', label: 'Config', Icon: Cog6ToothIcon, C: BotConfig },
];

export default function BotAdvboxPanel() {
  const [tab, setTab] = useState('simulador');
  const Active = TABS.find(t => t.key === tab)?.C || BotSimulator;

  // O wrapper da aba (TabScrollContainer no App.jsx) usa overflow-hidden e espera
  // que o painel traga sua propria area de rolagem (padrao h-full + flex-1 overflow-y-auto,
  // igual AsaasPanel/VendasParametrizacaoPanel). Cabecalho e sub-abas ficam fixos;
  // o conteudo de cada sub-aba rola.
  return (
    <div className="h-full flex flex-col">
      <div className="shrink-0 max-w-6xl mx-auto w-full px-4 pt-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h2 className="text-lg font-bold" style={{ fontFamily: 'Cormorant Garamond, serif' }}>Bot ADVBOX</h2>
            <p className="text-xs opacity-60">Autoatendimento de andamentos processuais — <b>versão de teste</b></p>
          </div>
          <span className="text-[10px] uppercase tracking-wider px-2 py-1 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 font-bold">beta · modo teste</span>
        </div>

        <div className="flex gap-1 overflow-x-auto max-sm:snap-x max-sm:snap-mandatory max-sm:pr-8 border-b border-gray-200 dark:border-gray-700 mt-3">
          {TABS.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`max-sm:snap-start flex items-center gap-1.5 px-3 py-2 text-xs font-bold uppercase tracking-wide whitespace-nowrap border-b-2 transition-colors ${
                tab === t.key ? 'border-[#C9A84C] text-[#1B3A5C] dark:text-white' : 'border-transparent opacity-50 hover:opacity-90'}`}>
              <t.Icon className="w-4 h-4" /> {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-6xl mx-auto w-full p-4">
          <BackfillBar />
          <BotPendencias onGoTo={setTab} />
          <Suspense fallback={<div className="p-8 text-center text-sm opacity-50 animate-pulse">Carregando…</div>}>
            <Active />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
