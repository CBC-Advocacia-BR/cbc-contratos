#!/usr/bin/env node
// Gera versoes WebP dos PNGs em public/ (#118)
// Uso: node scripts/generate-webp.mjs
// Roda sharp para converter logo-navy.png, logo-white.png, favicon.png
import sharp from 'sharp';
import { readdir, stat } from 'node:fs/promises';
import { join, basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const PUBLIC_DIR = join(__dirname, '..', 'public');

// PNGs a converter — editar aqui se adicionar novas logos/imagens
const TARGETS = ['favicon.png', 'logo-navy.png', 'logo-white.png'];

async function convert(name) {
  const inPath = join(PUBLIC_DIR, name);
  const outPath = join(PUBLIC_DIR, basename(name, extname(name)) + '.webp');
  try {
    const inStat = await stat(inPath);
    await sharp(inPath)
      .webp({ quality: 85, effort: 6 }) // 85 = boa qualidade + compressao agressiva
      .toFile(outPath);
    const outStat = await stat(outPath);
    const saving = ((1 - outStat.size / inStat.size) * 100).toFixed(1);
    console.log(`  ${name}  ${inStat.size} B  ->  ${basename(outPath)}  ${outStat.size} B  (-${saving}%)`);
  } catch (e) {
    console.error(`  Falhou ${name}: ${e.message}`);
  }
}

console.log('Gerando WebP em public/:');
for (const t of TARGETS) {
  await convert(t);
}
console.log('Feito.');
