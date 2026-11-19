/* Wallet / on-chain collection support — architecture for a future release.
 * The app works fully without a wallet. To add a chain, implement a provider with:
 *   { id, name, chains:[...], isAvailable(): bool, connect(): Promise<address>,
 *     listNFTs(address): Promise<[{ name, image, chain, contract, tokenId }]> }
 * and register it with FC.wallet.register(provider). Each NFT's `image` is then
 * imported through the same path as "Import from URL" (ipfs:// and ar:// supported).
 */
(function () {
  const providers = [];

  // Example provider skeletons. Listing NFTs needs an indexer API (Alchemy, Helius,
  // Reservoir, SimpleHash, your own...) — set FC.config.NFT_INDEXER_URL and fill in listNFTs.
  const evm = {
    id: 'evm', name: 'Ethereum / Polygon / Base', chains: ['Ethereum', 'Polygon', 'Base'],
    isAvailable: () => !!window.ethereum,
    async connect() {
      const [addr] = await window.ethereum.request({ method: 'eth_requestAccounts' });
      return addr;
    },
    async listNFTs(address) { return indexer(address, 'evm'); }
  };
  const solana = {
    id: 'solana', name: 'Solana', chains: ['Solana'],
    isAvailable: () => !!(window.solana || (window.phantom && window.phantom.solana)),
    async connect() {
      const p = window.solana || window.phantom.solana;
      const r = await p.connect();
      return r.publicKey.toString();
    },
    async listNFTs(address) { return indexer(address, 'solana'); }
  };

  async function indexer(address, chain) {
    const url = FC.config.NFT_INDEXER_URL;
    if (!url) return [];
    const res = await fetch(`${url}?address=${encodeURIComponent(address)}&chain=${chain}`);
    return res.ok ? res.json() : [];
  }

  FC.wallet = {
    register(p) { providers.push(p); },
    providers: () => providers.slice(),
    enabled: false // flip to true once an indexer is configured
  };
  FC.wallet.register(evm);
  FC.wallet.register(solana);
})();
