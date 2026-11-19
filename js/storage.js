/* Local-only storage: your avatar collection lives in this browser (IndexedDB),
 * settings in localStorage. Nothing is uploaded anywhere. */
(function () {
  const DB = 'nftfacecam', STORE = 'avatars';
  let dbp = null;

  function open() {
    if (dbp) return dbp;
    dbp = new Promise((res, rej) => {
      try {
        const r = indexedDB.open(DB, 1);
        r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'id' });
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      } catch (e) { rej(e); }
    });
    return dbp;
  }
  async function tx(mode, fn) {
    const db = await open();
    return new Promise((res, rej) => {
      const t = db.transaction(STORE, mode);
      const out = fn(t.objectStore(STORE));
      t.oncomplete = () => res(out && out.result !== undefined ? out.result : out);
      t.onerror = () => rej(t.error);
    });
  }

  const avatars = {
    async list() {
      try {
        const all = await tx('readonly', s => s.getAll());
        return (all || []).sort((a, b) => (b.created || 0) - (a.created || 0));
      } catch (e) { console.warn('Collection storage unavailable', e); return []; }
    },
    async put(rec) { try { await tx('readwrite', s => s.put(rec)); } catch (e) { console.warn(e); } },
    async remove(id) { try { await tx('readwrite', s => s.delete(id)); } catch (e) { console.warn(e); } }
  };

  const KEY = 'nftfacecam.settings.v1';
  const settings = {
    load(defaults) {
      try { return Object.assign({}, defaults, JSON.parse(localStorage.getItem(KEY) || '{}')); }
      catch { return Object.assign({}, defaults); }
    },
    save(obj) { try { localStorage.setItem(KEY, JSON.stringify(obj)); } catch { /* ignore */ } }
  };

  FC.storage = { avatars, settings };
})();
