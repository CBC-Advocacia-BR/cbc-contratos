// Diff visual de versões de modelo.
//
// Usa a biblioteca `diff` (Myers) para comparar textos blocos antigo/novo
// e gerar fragmentos HTML com marcação de adições/remoções.

import { diffWords, diffLines } from 'diff';

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function stripHtml(html) {
  return String(html || '')
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h\d|li)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
}

/** Retorna HTML colorido (adicionado verde, removido vermelho, igual cinza). */
export function diffTextToHtml(oldText, newText, mode = 'words') {
  const a = stripHtml(oldText || '');
  const b = stripHtml(newText || '');
  const parts = mode === 'lines' ? diffLines(a, b) : diffWords(a, b);
  return parts
    .map((p) => {
      const text = escapeHtml(p.value).replace(/\n/g, '<br/>');
      if (p.added) return `<ins style="background:#dcfce7;color:#166534;text-decoration:none;padding:0 2px;">${text}</ins>`;
      if (p.removed) return `<del style="background:#fee2e2;color:#991b1b;padding:0 2px;">${text}</del>`;
      return `<span style="color:#475569">${text}</span>`;
    })
    .join('');
}

/** Compara dois snapshots (do model_versions). Retorna um array de items. */
export function diffModelSnapshots(oldSnap, newSnap) {
  const items = [];

  // Metadados
  const metaFields = ['name', 'description', 'fixed_header', 'fixed_footer'];
  for (const f of metaFields) {
    const a = oldSnap?.model?.[f] || '';
    const b = newSnap?.model?.[f] || '';
    if (a !== b) items.push({ kind: 'meta', field: f, html: diffTextToHtml(a, b) });
  }

  // Blocos
  const oldBlocks = oldSnap?.blocks || [];
  const newBlocks = newSnap?.blocks || [];
  const oldByTitle = new Map(oldBlocks.map((b) => [b.title, b]));
  const newByTitle = new Map(newBlocks.map((b) => [b.title, b]));
  const allTitles = new Set([...oldByTitle.keys(), ...newByTitle.keys()]);
  for (const title of allTitles) {
    const a = oldByTitle.get(title);
    const b = newByTitle.get(title);
    if (a && b) {
      if ((a.content || '') !== (b.content || '')) {
        items.push({ kind: 'block-changed', title, html: diffTextToHtml(a.content, b.content) });
      }
    } else if (a) {
      items.push({ kind: 'block-removed', title, html: diffTextToHtml(a.content, '') });
    } else if (b) {
      items.push({ kind: 'block-added', title, html: diffTextToHtml('', b.content) });
    }
  }

  // Placeholders
  const oldPhs = oldSnap?.placeholders || [];
  const newPhs = newSnap?.placeholders || [];
  const oldKeys = new Set(oldPhs.map((p) => p.key));
  const newKeys = new Set(newPhs.map((p) => p.key));
  for (const k of newKeys) if (!oldKeys.has(k)) items.push({ kind: 'placeholder-added', title: k });
  for (const k of oldKeys) if (!newKeys.has(k)) items.push({ kind: 'placeholder-removed', title: k });

  return items;
}
