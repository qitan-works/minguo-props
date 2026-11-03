// localStorage 的安全包裝：所有讀寫都包在 try/catch 裡。
// 無痕視窗、停用網站資料、容量已滿或存取被拒時，照常運作，只是不自動保存。

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type SaveOutcome = 'saved' | 'unavailable' | 'quota' | 'error';

export interface SafeStore {
  load(): string | null;
  save(value: string): SaveOutcome;
  remove(): boolean;
}

function isQuotaError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as { name?: unknown; code?: unknown };
  return e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || e.code === 22;
}

/**
 * @param getStorage 取得 storage 的函式（存取 window.localStorage 本身就可能丟出例外，所以延後到呼叫時）。
 * @param key 儲存用的鍵名。
 */
export function createSafeStore(getStorage: () => StorageLike | null | undefined, key: string): SafeStore {
  function storage(): StorageLike | null {
    try {
      return getStorage() ?? null;
    } catch {
      return null;
    }
  }
  return {
    load(): string | null {
      try {
        return storage()?.getItem(key) ?? null;
      } catch {
        return null;
      }
    },
    save(value: string): SaveOutcome {
      const s = storage();
      if (!s) return 'unavailable';
      try {
        s.setItem(key, value);
        return 'saved';
      } catch (err) {
        return isQuotaError(err) ? 'quota' : 'error';
      }
    },
    remove(): boolean {
      try {
        const s = storage();
        if (!s) return false;
        s.removeItem(key);
        return true;
      } catch {
        return false;
      }
    },
  };
}
