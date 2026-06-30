import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { RESORTS } from '../data/clausulas';

// SQL to create the Supabase table (run manually in Supabase SQL editor):
// CREATE TABLE empreendimentos (
//   id SERIAL PRIMARY KEY,
//   nome TEXT UNIQUE NOT NULL,
//   created_at TIMESTAMPTZ DEFAULT NOW()
// );
// ALTER TABLE empreendimentos ENABLE ROW LEVEL SECURITY;
// CREATE POLICY "allow all" ON empreendimentos FOR ALL USING (true) WITH CHECK (true);

export function useEmpreendimentos() {
  const [list, setList] = useState(RESORTS);
  const [loading, setLoading] = useState(true);
  const [seeded, setSeeded] = useState(false);

  async function load() {
    try {
      const { data, error } = await supabase
        .from('empreendimentos')
        .select('nome')
        .order('nome', { ascending: true });

      if (!error && data && data.length > 0) {
        setList(data.map(r => r.nome));
        setSeeded(true);
      } else if (!error && data && data.length === 0 && !seeded) {
        // Table exists but is empty — seed with static list
        await seedTable();
      }
    } catch {
      // Table doesn't exist yet — use static list
    } finally {
      setLoading(false);
    }
  }

  async function seedTable() {
    try {
      const rows = RESORTS.map(nome => ({ nome }));
      await supabase.from('empreendimentos').upsert(rows, { onConflict: 'nome' });
      setSeeded(true);
    } catch { /* ignore */ }
  }

  useEffect(() => {
    load();

    // (resilience 28/04) Nome fixo do channel — antes usava Date.now() e vazava
    // conexao a cada mount, esgotando o pool PostgreSQL. Cleanup garantido pelo
    // removeChannel no return.
    // Mantido event='*' porque qualquer mudanca em empreendimentos (insert, update,
    // delete) deve recarregar a lista. Volume baixissimo (lista ~80 itens).
    const channel = supabase
      .channel('empreendimentos-sync')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'empreendimentos' }, () => {
        load();
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  const addEmpreendimento = async (nome) => {
    const trimmed = nome.trim();
    if (!trimmed) return false;
    if (list.includes(trimmed)) return true;

    const newList = [...list, trimmed].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    setList(newList);

    try {
      await supabase.from('empreendimentos').upsert({ nome: trimmed }, { onConflict: 'nome' });
    } catch { /* local state already updated */ }

    return true;
  };

  return { list, loading, addEmpreendimento };
}
