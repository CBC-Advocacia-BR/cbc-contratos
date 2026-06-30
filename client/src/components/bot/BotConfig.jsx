import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import { CheckIcon, ArrowPathIcon } from '@heroicons/react/24/outline';

const GERAL_FIELDS = [
  ['saudacao', 'Saudação inicial'],
  ['nao_identificado', 'Cliente não identificado (pede CPF)'],
  ['multi_processo', 'Cliente com vários processos (use {{qtd}} e {{lista}})'],
  ['sem_novidade', 'Sem novidade há mais de 15 dias'],
  ['fallback', 'Mensagem quando o bot não entende'],
  ['despedida', 'Despedida'],
];

const TPL_FIELDS = [
  ['corpo', 'Corpo da resposta de andamento — placeholders: {{processo}} {{tipo}} {{fase}} {{timeline}} {{texto_fase}} {{em_andamento}} {{proximos_passos}} {{cliente}} {{primeiro_nome}}'],
  ['linha_timeline', 'Linha da timeline — {{data}} e {{texto}}'],
  ['titulo_concluidas', 'Título da seção “o que já fizemos”'],
  ['titulo_em_andamento', 'Título da seção “o que estamos fazendo”'],
];

export default function BotConfig() {
  const [cfg, setCfg] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('bot_config').select('key, value');
    if (error) { setErr(error.message); return; }
    const obj = {};
    for (const r of data || []) obj[r.key] = r.value || {};
    setCfg(obj);
  }, []);
  // fetch inicial via efeito (mesmo padrao dos demais paineis do projeto)
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  const edit = (section, key, value) => setCfg(c => ({ ...c, [section]: { ...(c[section] || {}), [key]: value } }));

  const saveAll = async () => {
    setSaving(true); setErr('');
    for (const key of ['geral', 'template_andamento', 'kommo', 'ia', 'monitor', 'portal_educacao']) {
      const { error } = await supabase.from('bot_config').upsert({ key, value: cfg[key] || {}, updated_at: new Date().toISOString() });
      if (error) { setErr(`${key}: ${error.message}`); setSaving(false); return; }
    }
    setSaving(false); setSaved(true); setTimeout(() => setSaved(false), 2000);
  };

  if (!cfg) return <div className="p-6 text-sm opacity-60 flex items-center gap-2"><ArrowPathIcon className="w-4 h-4 animate-spin" />Carregando configurações…</div>;

  const kommo = cfg.kommo || {};
  const ia = cfg.ia || {};

  return (
    <div className="space-y-4">
      {err && <div className="text-xs p-2 rounded bg-red-50 dark:bg-red-900/30">{err}</div>}

      <div className="card p-4">
        <h3 className="font-bold text-sm mb-3">💬 Mensagens gerais do bot</h3>
        <div className="grid md:grid-cols-2 gap-3">
          {GERAL_FIELDS.map(([key, label]) => (
            <div key={key}>
              <label className="text-[11px] font-bold uppercase tracking-wide opacity-60">{label}</label>
              <textarea className="input-field w-full text-sm" rows={3}
                value={(cfg.geral || {})[key] || ''} onChange={e => edit('geral', key, e.target.value)} />
            </div>
          ))}
        </div>
      </div>

      <div className="card p-4">
        <h3 className="font-bold text-sm mb-3">📋 Template da resposta de andamento</h3>
        <div className="space-y-3">
          {TPL_FIELDS.map(([key, label]) => (
            <div key={key}>
              <label className="text-[11px] font-bold uppercase tracking-wide opacity-60">{label}</label>
              <textarea className="input-field w-full text-sm font-mono" rows={key === 'corpo' ? 6 : 1}
                value={(cfg.template_andamento || {})[key] || ''} onChange={e => edit('template_andamento', key, e.target.value)} />
            </div>
          ))}
        </div>
      </div>

      <div className="card p-4">
        <h3 className="font-bold text-sm mb-1">📲 Integração Kommo (WhatsApp real)</h3>
        <p className="text-xs opacity-60 mb-3">Necessário para o teste pelo celular. Veja o passo a passo em <code>docs/BOT_ADVBOX_SETUP.md</code>. Sem isso, o Simulador continua funcionando normalmente.</p>
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-3">
          <div>
            <label className="text-[11px] font-bold uppercase opacity-60">ID do Salesbot (resposta)</label>
            <input className="input-field w-full text-sm" placeholder="ex.: 12345" value={kommo.bot_id || ''}
              onChange={e => edit('kommo', 'bot_id', e.target.value.replace(/\D/g, '') || null)} />
          </div>
          <div>
            <label className="text-[11px] font-bold uppercase opacity-60">ID campo “BOT_RESPOSTA” no LEAD</label>
            <input className="input-field w-full text-sm" placeholder="field_id numérico" value={kommo.field_id_lead || ''}
              onChange={e => edit('kommo', 'field_id_lead', e.target.value.replace(/\D/g, '') || null)} />
          </div>
          <div>
            <label className="text-[11px] font-bold uppercase opacity-60">ID campo “BOT_RESPOSTA” no CONTATO</label>
            <input className="input-field w-full text-sm" placeholder="field_id numérico" value={kommo.field_id_contato || ''}
              onChange={e => edit('kommo', 'field_id_contato', e.target.value.replace(/\D/g, '') || null)} />
          </div>
          <div>
            <label className="text-[11px] font-bold uppercase opacity-60">Entidade preferida</label>
            <select className="input-field w-full text-sm" value={kommo.entidade_preferida || 'lead'}
              onChange={e => edit('kommo', 'entidade_preferida', e.target.value)}>
              <option value="lead">Lead (recomendado)</option>
              <option value="contato">Contato</option>
            </select>
          </div>
        </div>
        <label className="flex items-center gap-2 mt-3 text-sm">
          <input type="checkbox" checked={!!kommo.ativo} onChange={e => edit('kommo', 'ativo', e.target.checked)} />
          <b>Bot ativo no WhatsApp</b> <span className="text-xs opacity-60">(responde apenas aos testadores cadastrados)</span>
        </label>
      </div>

      <div className="card p-4">
        <h3 className="font-bold text-sm mb-1">🚫 Termos de ocultação automática</h3>
        <p className="text-xs opacity-60 mb-2">Tarefas cujo nome contenha um destes termos são <b>ocultas do cliente automaticamente</b> (sem resposta do bot, sem nota no Kommo, sem alerta de novidade) — mas <b>continuam indo para o banco e o BI</b>. Cobre tarefas de sistema que não existem no catálogo (ex.: COMENTÁRIO). Para tipos específicos, use o checkbox "ocultar do cliente" na aba Tarefas. Separe por vírgula.</p>
        <textarea className="input-field w-full text-sm" rows={2}
          value={((cfg.monitor || {}).tarefas_ignoradas || []).join(', ')}
          onChange={e => edit('monitor', 'tarefas_ignoradas', e.target.value.split(',').map(s => s.trim()).filter(Boolean))} />
      </div>

      <div className="card p-4">
        <h3 className="font-bold text-sm mb-1">🤖 Tradução por IA (opcional)</h3>
        <p className="text-xs opacity-60 mb-3">Quando um andamento não casa com nenhum termo do glossário, a IA traduz para linguagem simples (com cache — cada texto é traduzido uma única vez). Requer a env var <code>ANTHROPIC_API_KEY</code> no Netlify.</p>
        <div className="grid md:grid-cols-3 gap-3 items-end">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={!!ia.ativa} onChange={e => edit('ia', 'ativa', e.target.checked)} />
            IA ativa
          </label>
          <div>
            <label className="text-[11px] font-bold uppercase opacity-60">Modelo</label>
            <input className="input-field w-full text-sm font-mono" value={ia.modelo || 'claude-opus-4-8'}
              onChange={e => edit('ia', 'modelo', e.target.value)} />
          </div>
        </div>
        <div className="mt-2">
          <label className="text-[11px] font-bold uppercase opacity-60">Instrução de tradução</label>
          <textarea className="input-field w-full text-sm" rows={2} value={ia.instrucao || ''}
            onChange={e => edit('ia', 'instrucao', e.target.value)} />
        </div>
      </div>

      <div className="card p-4">
        <h3 className="font-bold text-sm mb-1">🎓 Conteúdo do Portal do Cliente</h3>
        <p className="text-xs opacity-60">
          A educação por fase, a FAQ pública e as perguntas dos clientes agora são editadas na aba <b>Portal do Cliente</b> do sistema.
        </p>
      </div>

      <div className="sticky bottom-3 flex justify-end">
        <button className="btn-primary px-6 py-2 shadow-lg" onClick={saveAll} disabled={saving}>
          {saved ? <><CheckIcon className="w-4 h-4 inline mr-1" />Salvo!</> : saving ? 'Salvando…' : 'Salvar configurações'}
        </button>
      </div>
    </div>
  );
}
