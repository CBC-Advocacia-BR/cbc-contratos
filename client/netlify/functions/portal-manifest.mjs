/**
 * Manifest dinâmico do PWA do portal (#9): o start_url precisa carregar o
 * token do cliente, então o manifest é gerado por função em vez de estático.
 * O portal injeta <link rel="manifest" href="...?t=TOKEN"> via JS.
 */
export default async (req) => {
  const url = new URL(req.url);
  const t = (url.searchParams.get('t') || '').trim().slice(0, 64).replace(/[^a-f0-9]/gi, '');
  const manifest = {
    name: 'CBC Advogados — Meu Processo',
    short_name: 'CBC',
    description: 'Acompanhe seu processo, seus pagamentos e seu acordo.',
    start_url: t ? `/portal?t=${t}` : '/portal',
    scope: '/portal',
    display: 'standalone',
    background_color: '#F7F3EB',
    theme_color: '#142A43',
    icons: [
      { src: '/favicon.png', sizes: '192x192', type: 'image/png' },
      { src: '/logo-navy.png', sizes: '512x512', type: 'image/png' },
    ],
  };
  return new Response(JSON.stringify(manifest), {
    headers: { 'Content-Type': 'application/manifest+json', 'Cache-Control': 'public, max-age=3600' },
  });
};

export const config = { path: '/.netlify/functions/portal-manifest' };
