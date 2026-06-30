// (resilience 28/04) Cache IndexedDB dos ultimos 100 contratos visualizados.
// Usado como fallback offline quando o Supabase esta indisponivel/lento.
// Trim automatico mantem so os 100 mais recentes (FIFO por cached_at).

const DB_NAME = 'cbc-contracts-cache';
const STORE = 'recent';
const MAX_CONTRACTS = 100;

let dbPromise = null;

function getDB() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      try {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(STORE)) {
            const store = db.createObjectStore(STORE, { keyPath: 'id' });
            store.createIndex('cached_at', 'cached_at');
            store.createIndex('nome', 'nome_contratante1');
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      } catch (e) {
        reject(e);
      }
    });
  }
  return dbPromise;
}

/**
 * Salva ate MAX_CONTRACTS contratos no cache. Funcao tolerante a falha — se o
 * IndexedDB estiver indisponivel (modo privado, quota cheia), apenas loga warn.
 * Roda em background, nao deve bloquear a UI.
 */
export async function cacheContracts(contracts) {
  if (!Array.isArray(contracts) || contracts.length === 0) return;
  try {
    const db = await getDB();
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const now = Date.now();
    contracts.slice(0, MAX_CONTRACTS).forEach(c => {
      if (c && c.id) store.put({ ...c, cached_at: now });
    });

    // Trim — mantem so os MAX_CONTRACTS mais recentes
    const idx = store.index('cached_at');
    const all = await new Promise((resolve, reject) => {
      const req = idx.getAll();
      req.onsuccess = (e) => resolve(e.target.result || []);
      req.onerror = () => reject(req.error);
    });
    if (all.length > MAX_CONTRACTS) {
      const toDelete = all
        .sort((a, b) => a.cached_at - b.cached_at)
        .slice(0, all.length - MAX_CONTRACTS);
      toDelete.forEach(c => store.delete(c.id));
    }
  } catch (e) {
    console.warn('[contractsCache] cache contratos falhou:', e?.message || e);
  }
}

/**
 * Le todos os contratos do cache, ordenados por mais recente primeiro.
 * Retorna array vazio se cache nao existir ou indexedDB falhar.
 */
export async function getCachedContracts() {
  try {
    const db = await getDB();
    const tx = db.transaction(STORE, 'readonly');
    return await new Promise((resolve) => {
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => {
        const list = (req.result || []).sort((a, b) => b.cached_at - a.cached_at);
        resolve(list);
      };
      req.onerror = () => resolve([]);
    });
  } catch {
    return [];
  }
}

/**
 * Limpa o cache. Util em logout ou debug. Nao falha se o store nao existir.
 */
export async function clearCache() {
  try {
    const db = await getDB();
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).clear();
  } catch (e) {
    console.warn('[contractsCache] clear falhou:', e?.message || e);
  }
}
