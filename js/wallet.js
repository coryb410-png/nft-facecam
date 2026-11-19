/* Load NFTs by pasting a wallet address (read-only, no wallet connection).
 * Talks to the NFT FaceCam reader service (api/server.js), which looks up public
 * on-chain data and passes images through so the app can process them. */
(function () {
  const $ = (id) => document.getElementById(id);
  const api = () => FC.config.NFT_API_URL.replace(/\/$/, '');
  const LS = 'nftfacecam.wallet';
  const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const BADGE = { eth: 'ETH', base: 'BASE', polygon: 'POL', solana: 'SOL' };

  const imgUrl = (u) => u.startsWith('data:') ? u : `${api()}/img?url=${encodeURIComponent(u)}`;

  class WalletLookup {
    constructor(app) {
      this.app = app; this.items = []; this.filter = 'all'; this.busy = false;
      $('walletClose').onclick = () => this.close();
      $('wallet').addEventListener('pointerdown', (e) => { if (e.target.id === 'wallet') this.close(); });
      $('walletForm').onsubmit = (e) => { e.preventDefault(); this.search($('walletInput').value); };
      $('chainTabs').onclick = (e) => {
        const b = e.target.closest('button'); if (!b) return;
        this.filter = b.dataset.chain;
        document.querySelectorAll('#chainTabs button').forEach(x => x.classList.toggle('active', x === b));
        this.render();
      };
      $('walletGrid').onclick = (e) => { const t = e.target.closest('.wnft'); if (t) this.pick(t.dataset.i); };
      try { $('walletInput').value = localStorage.getItem(LS) || ''; } catch { /* ignore */ }
    }

    open(prefill) {
      if (prefill) $('walletInput').value = prefill;
      $('wallet').classList.add('show');
      this.app.closeSheet && this.app.closeSheet();
      fetch(`${api()}/health`).catch(() => {}); // wake the reader service up early
      if (prefill) this.search(prefill);
      else setTimeout(() => $('walletInput').focus(), 50);
    }
    close() { $('wallet').classList.remove('show'); }

    status(html, kind = '') { const s = $('walletStatus'); s.className = 'wallet-status ' + kind; s.innerHTML = html; }

    async search(raw) {
      const address = String(raw || '').trim();
      if (!address || this.busy) return;
      try { localStorage.setItem(LS, address); } catch { /* ignore */ }
      this.busy = true; $('walletGo').disabled = true;
      this.items = []; this.render();
      this.status('<span class="spin"></span>Reading NFTs…');
      const slow = setTimeout(() => this.status('<span class="spin"></span>Waking up the NFT reader — the first search can take up to a minute…'), 6000);
      try {
        const r = await fetch(`${api()}/nfts?address=${encodeURIComponent(address)}&chain=auto`);
        const j = await r.json().catch(() => ({}));
        clearTimeout(slow);
        if (!r.ok && !(j.items && j.items.length)) throw new Error(j.error || (j.errors && j.errors.join(' · ')) || `Lookup failed (${r.status})`);
        this.items = j.items || [];
        this.kind = j.kind;
        document.querySelectorAll('#chainTabs button').forEach(b => {
          const k = b.dataset.chain;
          b.hidden = k !== 'all' && (j.kind === 'sol' ? k !== 'solana' : k === 'solana');
          const n = k === 'all' ? this.items.length : this.items.filter(i => i.chain === k).length;
          b.textContent = `${k === 'all' ? 'All' : { eth: 'Ethereum', base: 'Base', polygon: 'Polygon', solana: 'Solana' }[k]}${n ? ` · ${n}` : ''}`;
        });
        const short = j.address && j.address !== address ? ` <span class="muted">(${esc(j.address.slice(0, 6))}…${esc(j.address.slice(-4))})</span>` : '';
        if (!this.items.length) this.status(`No NFTs with images found for <b>${esc(address)}</b>${short}.${j.errors && j.errors.length ? `<br><small>${esc(j.errors.join(' · '))}</small>` : ''}`, 'warn');
        else this.status(`Found <b>${this.items.length}</b> NFT${this.items.length === 1 ? '' : 's'} for <b>${esc(address)}</b>${short}. Tap one to use it.${j.errors && j.errors.length ? `<br><small>Some chains didn't answer: ${esc(j.errors.join(' · '))}</small>` : ''}`, 'ok');
        this.render();
      } catch (e) {
        clearTimeout(slow);
        this.status(esc(e.message === 'Failed to fetch' ? "Couldn't reach the NFT reader. Check your connection and try again." : e.message), 'err');
      } finally { this.busy = false; $('walletGo').disabled = false; }
    }

    render() {
      const list = this.items.map((it, i) => ({ it, i })).filter(({ it }) => this.filter === 'all' || it.chain === this.filter);
      $('walletGrid').innerHTML = list.map(({ it, i }) => `
        <button class="wnft" data-i="${i}" title="${esc(it.name)}">
          <span class="wimg"><img loading="lazy" src="${esc(imgUrl(it.image))}" alt="" onerror="this.closest('.wnft').classList.add('broken')"></span>
          <span class="wname">${esc(it.name)}</span>
          <span class="wcoll">${esc(it.collection || '')}</span>
          <span class="wbadge ${it.chain}">${BADGE[it.chain] || it.chain}</span>
        </button>`).join('');
    }

    async pick(i) {
      const it = this.items[+i]; if (!it) return;
      const tile = document.querySelector(`.wnft[data-i="${i}"]`);
      if (tile) tile.classList.add('loading');
      try {
        const r = await fetch(imgUrl(it.image));
        if (!r.ok) throw new Error('image');
        const blob = await r.blob();
        if (!/^image\//.test(blob.type)) throw new Error('not an image');
        this.close();
        await this.app.addRecord({
          id: FC.util.uid(), name: it.name.slice(0, 40), kind: 'image', blob, created: Date.now(),
          points: null, removeBg: null, lidColor: null, opts: null, source: { chain: it.chain, id: it.id }
        });
      } catch (e) {
        FC.util.toast("Couldn't load that NFT's image (it may be a video or the host is down). Try another one.", 'error', 6000);
      } finally { if (tile) tile.classList.remove('loading'); }
    }
  }

  FC.WalletLookup = WalletLookup;
})();
