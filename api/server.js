/* NFT FaceCam — NFT reader service (no dependencies, Node 18+).
 *
 *   GET /health
 *   GET /nfts?address=<0x… | name.eth | Solana address | name.sol>&chain=auto|eth|base|polygon|solana
 *   GET /img?url=<image url | ipfs:// | ar://>   (image pass-through with CORS so the app can process it)
 *
 * Read-only: it only looks up public on-chain data for an address you type in.
 * No wallet connection, no keys from the user, nothing stored.
 *
 * Optional environment variables (make lookups more reliable / higher limits):
 *   ALCHEMY_API_KEY      EVM fallback (Ethereum, Base, Polygon)
 *   BLOCKSCOUT_API_KEY   Blockscout PRO API
 *   HELIUS_API_KEY       Solana (DAS getAssetsByOwner, includes compressed NFTs)
 *   ME_API_KEY           Magic Eden API key
 */
const http = require('http');

const PORT = process.env.PORT || 10000;
const IPFS = ['https://ipfs.io/ipfs/', 'https://gateway.pinata.cloud/ipfs/', 'https://dweb.link/ipfs/'];
const EVM = [
  { key: 'eth', name: 'Ethereum', host: 'eth.blockscout.com', chainId: 1, alchemy: 'eth-mainnet' },
  { key: 'base', name: 'Base', host: 'base.blockscout.com', chainId: 8453, alchemy: 'base-mainnet' },
  { key: 'polygon', name: 'Polygon', host: 'polygon.blockscout.com', chainId: 137, alchemy: 'polygon-mainnet' }
];
const UA = 'NFT-FaceCam/1.0 (+https://nft-facecam.onrender.com)';

// ---------- helpers ----------
function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    ...(typeof body === 'string' || Buffer.isBuffer(body) ? {} : { 'Content-Type': 'application/json' }),
    ...headers
  });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

async function getJSON(url, opts = {}, ms = 12000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { ...opts, signal: ctl.signal, headers: { 'User-Agent': UA, Accept: 'application/json', ...(opts.headers || {}) } });
    if (!r.ok) throw new Error(`${new URL(url).host} HTTP ${r.status}`);
    return await r.json();
  } finally { clearTimeout(t); }
}

function normUrl(u) {
  if (!u || typeof u !== 'string') return null;
  u = u.trim();
  if (u.startsWith('data:image/')) return u;
  if (u.startsWith('ipfs://')) return IPFS[0] + u.slice(7).replace(/^ipfs\//, '');
  if (u.startsWith('ar://')) return 'https://arweave.net/' + u.slice(5);
  if (/^https?:\/\//i.test(u)) return u;
  if (/^(Qm[1-9A-Za-z]{44}|bafy[0-9a-z]{50,})/.test(u)) return IPFS[0] + u;
  return null;
}

const cache = new Map(); // key -> {t, v}
const CACHE_MS = 5 * 60 * 1000;
function cached(key) { const c = cache.get(key); return c && Date.now() - c.t < CACHE_MS ? c.v : null; }
function remember(key, v) { cache.set(key, { t: Date.now(), v }); if (cache.size > 500) cache.delete(cache.keys().next().value); }

const hits = new Map(); // ip -> [timestamps]
function limited(ip, max = 90) {
  const now = Date.now(), arr = (hits.get(ip) || []).filter(t => now - t < 60000);
  arr.push(now); hits.set(ip, arr);
  return arr.length > max;
}

// ---------- address resolution ----------
const isEvm = a => /^0x[0-9a-fA-F]{40}$/.test(a);
const isSol = a => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a);

async function resolveEns(name) {
  try {
    const j = await getJSON(`https://bens.services.blockscout.com/api/v1/1/domains/${encodeURIComponent(name)}`);
    const a = j && j.resolved_address && (j.resolved_address.hash || j.resolved_address);
    if (isEvm(a)) return a;
  } catch (e) { /* try next */ }
  try {
    const j = await getJSON(`https://api.ensideas.com/ens/resolve/${encodeURIComponent(name)}`);
    if (isEvm(j.address)) return j.address;
  } catch (e) { /* ignore */ }
  throw new Error(`Couldn't find the wallet for ${name}`);
}
async function resolveSns(name) {
  const j = await getJSON(`https://sns-sdk-proxy.bonfida.workers.dev/resolve/${encodeURIComponent(name.replace(/\.sol$/i, ''))}`);
  if (j && j.s === 'ok' && isSol(j.result)) return j.result;
  throw new Error(`Couldn't find the wallet for ${name}`);
}

// ---------- EVM ----------
async function evmBlockscout(chain, address) {
  const key = process.env.BLOCKSCOUT_API_KEY;
  const base = key ? `https://api.blockscout.com/${chain.chainId}/api/v2` : `https://${chain.host}/api/v2`;
  const headers = key ? { Authorization: `Bearer ${key}` } : {};
  const out = [];
  let params = 'type=ERC-721%2CERC-1155';
  for (let page = 0; page < 3; page++) {
    const j = await getJSON(`${base}/addresses/${address}/nft?${params}`, { headers });
    for (const it of j.items || []) {
      const md = it.metadata || {};
      const tok = it.token || {};
      const contract = tok.address_hash || tok.address || '';
      const image = normUrl(it.image_url) || normUrl(md.image) || normUrl(md.image_url) || normUrl(md.image_data && md.image_data.startsWith('<svg') ? 'data:image/svg+xml;utf8,' + encodeURIComponent(md.image_data) : null);
      if (!image) continue;
      out.push({
        id: `${chain.key}:${contract}:${it.id}`, chain: chain.key, chainName: chain.name,
        name: md.name || `${tok.name || 'NFT'} #${it.id}`, collection: tok.name || '', image
      });
    }
    if (!j.next_page_params) break;
    params = 'type=ERC-721%2CERC-1155&' + new URLSearchParams(j.next_page_params).toString();
  }
  return out;
}
async function evmAlchemy(chain, address) {
  const key = process.env.ALCHEMY_API_KEY;
  if (!key) throw new Error('no alchemy key');
  const j = await getJSON(`https://${chain.alchemy}.g.alchemy.com/nft/v3/${key}/getNFTsForOwner?owner=${address}&withMetadata=true&pageSize=100&excludeFilters[]=SPAM`);
  return (j.ownedNfts || []).map(n => ({
    id: `${chain.key}:${n.contract && n.contract.address}:${n.tokenId}`, chain: chain.key, chainName: chain.name,
    name: n.name || `${(n.contract && n.contract.name) || 'NFT'} #${n.tokenId}`,
    collection: (n.collection && n.collection.name) || (n.contract && n.contract.name) || '',
    image: normUrl(n.image && (n.image.cachedUrl || n.image.pngUrl || n.image.originalUrl)) || normUrl(n.raw && n.raw.metadata && n.raw.metadata.image)
  })).filter(n => n.image);
}
async function evmChain(chain, address) {
  try { return await evmBlockscout(chain, address); }
  catch (e) {
    if (process.env.ALCHEMY_API_KEY) return evmAlchemy(chain, address);
    throw e;
  }
}

// ---------- Solana ----------
async function solHelius(address) {
  const key = process.env.HELIUS_API_KEY;
  const out = [];
  for (let page = 1; page <= 3; page++) {
    const j = await getJSON(`https://mainnet.helius-rpc.com/?api-key=${key}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 'facecam', method: 'getAssetsByOwner', params: { ownerAddress: address, page, limit: 500, displayOptions: { showCollectionMetadata: true } } })
    });
    const items = (j.result && j.result.items) || [];
    for (const a of items) {
      if (a.interface && /Fungible/i.test(a.interface)) continue;
      const c = a.content || {};
      const file = (c.files || []).find(f => /image/.test(f.mime || '')) || (c.files || [])[0] || {};
      const image = normUrl(file.cdn_uri) || normUrl(c.links && c.links.image) || normUrl(file.uri);
      if (!image) continue;
      const coll = (a.grouping || []).find(g => g.group_key === 'collection');
      out.push({
        id: `solana:${a.id}`, chain: 'solana', chainName: 'Solana',
        name: (c.metadata && c.metadata.name) || 'Solana NFT',
        collection: (coll && coll.collection_metadata && coll.collection_metadata.name) || '', image
      });
    }
    if (items.length < 500) break;
  }
  return out;
}
async function solMagicEden(address) {
  const headers = process.env.ME_API_KEY ? { Authorization: `Bearer ${process.env.ME_API_KEY}` } : {};
  const out = [];
  for (let offset = 0; offset < 500; offset += 100) {
    const j = await getJSON(`https://api-mainnet.magiceden.dev/v2/wallets/${address}/tokens?offset=${offset}&limit=100`, { headers });
    const arr = Array.isArray(j) ? j : (j.tokens || []);
    for (const t of arr) {
      const image = normUrl(t.image) || normUrl(t.properties && t.properties.files && t.properties.files[0] && t.properties.files[0].uri);
      if (!image) continue;
      out.push({ id: `solana:${t.mintAddress}`, chain: 'solana', chainName: 'Solana', name: t.name || 'Solana NFT', collection: t.collectionName || t.collection || '', image });
    }
    if (arr.length < 100) break;
  }
  return out;
}
async function solana(address) {
  if (process.env.HELIUS_API_KEY) {
    try { return await solHelius(address); } catch (e) { /* fall back */ }
  }
  return solMagicEden(address);
}

// ---------- handlers ----------
async function handleNfts(q) {
  let input = String(q.get('address') || '').trim();
  const chain = String(q.get('chain') || 'auto').toLowerCase();
  if (!input) return [400, { error: 'Enter a wallet address' }];
  const ck = `nfts:${input.toLowerCase()}:${chain}`;
  const hit = cached(ck); if (hit) return [200, hit];

  let address = input, kind;
  if (/\.eth$/i.test(input)) { address = await resolveEns(input.toLowerCase()); kind = 'evm'; }
  else if (/\.sol$/i.test(input)) { address = await resolveSns(input.toLowerCase()); kind = 'sol'; }
  else if (isEvm(input)) kind = 'evm';
  else if (isSol(input)) kind = 'sol';
  else return [400, { error: "That doesn't look like a wallet address. Use 0x…, name.eth, a Solana address or name.sol" }];

  const items = [], errors = [], counts = {};
  if (kind === 'evm') {
    const chains = chain === 'auto' || chain === 'all' ? EVM : EVM.filter(c => c.key === chain);
    const res = await Promise.allSettled(chains.map(c => evmChain(c, address)));
    res.forEach((r, i) => {
      if (r.status === 'fulfilled') { items.push(...r.value); counts[chains[i].key] = r.value.length; }
      else errors.push(`${chains[i].name}: ${r.reason && r.reason.message}`);
    });
  } else {
    try { const v = await solana(address); items.push(...v); counts.solana = v.length; }
    catch (e) { errors.push(`Solana: ${e.message}`); }
  }
  const body = { input, address, kind, counts, items, errors };
  if (items.length || !errors.length) remember(ck, body);
  return [items.length || !errors.length ? 200 : 502, body];
}

function blockedHost(h) {
  return /^(localhost|127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?|\[?f[cd])/i.test(h) || h.endsWith('.internal') || h.endsWith('.local');
}

async function handleImg(q, res) {
  const raw = String(q.get('url') || '');
  let url = normUrl(raw);
  if (!url || url.startsWith('data:')) return send(res, 400, { error: 'bad url' });
  const tries = [url];
  const m = url.match(/\/ipfs\/(.+)$/);
  if (m) for (const g of IPFS.slice(1)) tries.push(g + m[1]);
  for (const u of tries) {
    let host;
    try { host = new URL(u).hostname; } catch { continue; }
    if (blockedHost(host)) return send(res, 400, { error: 'blocked host' });
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 20000);
    try {
      const r = await fetch(u, { signal: ctl.signal, redirect: 'follow', headers: { 'User-Agent': UA, Accept: 'image/*,*/*;q=0.5' } });
      if (!r.ok) continue;
      const type = (r.headers.get('content-type') || '').split(';')[0];
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length > 15 * 1024 * 1024) return send(res, 413, { error: 'image too large' });
      const looksImg = /^image\//.test(type) || /^\s*<svg/i.test(buf.slice(0, 200).toString());
      if (!looksImg) continue;
      return send(res, 200, buf, { 'Content-Type': type.startsWith('image/') ? type : 'image/svg+xml', 'Cache-Control': 'public, max-age=86400' });
    } catch (e) { /* next gateway */ } finally { clearTimeout(t); }
  }
  send(res, 502, { error: "Couldn't load that image" });
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, '');
  const u = new URL(req.url, 'http://x');
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  try {
    if (u.pathname === '/health' || u.pathname === '/') return send(res, 200, { ok: true, service: 'nft-facecam-api' });
    if (limited(ip, u.pathname === '/img' ? 240 : 40)) return send(res, 429, { error: 'Too many requests — try again in a minute' });
    if (u.pathname === '/nfts') { const [s, b] = await handleNfts(u.searchParams); return send(res, s, b); }
    if (u.pathname === '/img') return handleImg(u.searchParams, res);
    send(res, 404, { error: 'not found' });
  } catch (e) {
    send(res, 500, { error: e.message || 'Something went wrong' });
  }
});
if (require.main === module) server.listen(PORT, () => console.log('nft-facecam-api on', PORT));

module.exports = { normUrl, isEvm, isSol };
