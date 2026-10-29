// Cloudflare Worker: product search for one store
const API = 'https://api.kroger.com/v1';
const MAX_RESULTS = 5; // products returned per search

let token = null;
let tokenExpires = 0;

async function getToken(env) {
  if (token && Date.now() < tokenExpires) return token;
  const res = await fetch(`${API}/connect/oauth2/token`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      authorization: 'Basic ' + btoa(`${env.KROGER_CLIENT_ID}:${env.KROGER_CLIENT_SECRET}`)
    },
    body: 'grant_type=client_credentials&scope=product.compact'
  });
  if (!res.ok) throw new Error('token');
  const body = await res.json();
  token = body.access_token;
  tokenExpires = Date.now() + (body.expires_in - 60) * 1000;
  return token;
}

function entry(p, term) {
  const a = (p.aisleLocations || [])[0];
  return {
    term,
    id: p.productId,
    name: p.description,
    desc: (p.categories || [])[0] || '',
    cold: /refrigerated|frozen/i.test(p.temperature?.indicator || ''),
    loc: a ? { number: a.number || '', description: a.description || '', bay: a.bayNumber, side: a.side, shelf: a.shelfNumber } : null
  };
}

export default {
  async fetch(request, env) {
    const cors = {
      'access-control-allow-origin': env.ALLOWED_ORIGIN || '*',
      'content-type': 'application/json'
    };
    const term = (new URL(request.url).searchParams.get('term') || '').trim().slice(0, 60);
    if (term.length < 3) return new Response('{"items":[]}', { headers: cors });
    try {
      const params = new URLSearchParams({ 'filter.term': term, 'filter.locationId': env.LOCATION_ID, 'filter.limit': String(MAX_RESULTS) });
      const res = await fetch(`${API}/products?${params}`, { headers: { authorization: `Bearer ${await getToken(env)}` } });
      if (!res.ok) return new Response('{"items":[]}', { status: 502, headers: cors });
      const body = await res.json();
      return new Response(JSON.stringify({ items: (body.data || []).map(p => entry(p, term)) }), { headers: cors });
    } catch {
      return new Response('{"items":[]}', { status: 502, headers: cors });
    }
  }
};
