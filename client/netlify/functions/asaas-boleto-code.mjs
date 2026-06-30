/**
 * Retorna identificationField (linha digitável) + nossoNumero + barcode de 1 boleto.
 * Body: { paymentId: 'pay_xxx' }
 */
const ASAAS_KEY = process.env.ASAAS_API_KEY;
const CORS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
// (#156) Codigo de barras/linha digitavel de boleto nao muda apos geracao — cache 1h e agressivo
const CACHE_OK = { 'Cache-Control': 'public, max-age=3600, s-maxage=3600' };
const NO_CACHE = { 'Cache-Control': 'no-cache' };

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response('', { status: 200, headers: CORS });
  try {
    const { paymentId } = await req.json();
    if (!paymentId) return new Response(JSON.stringify({ error: 'paymentId required' }), { status: 400, headers: { ...CORS, ...NO_CACHE } });
    const r = await fetch(`https://api.asaas.com/v3/payments/${paymentId}/identificationField`, {
      headers: { access_token: ASAAS_KEY },
    });
    if (!r.ok) throw new Error(`asaas ${r.status}`);
    const d = await r.json();
    return new Response(JSON.stringify({ success: true, identificationField: d.identificationField, nossoNumero: d.nossoNumero, barCode: d.barCode }), { headers: { ...CORS, ...CACHE_OK } });
  } catch (err) {
    return new Response(JSON.stringify({ success: false, error: err.message }), { status: 500, headers: { ...CORS, ...NO_CACHE } });
  }
};
