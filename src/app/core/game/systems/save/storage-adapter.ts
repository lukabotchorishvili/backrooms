export interface StorageAdapter {
  readonly kind: 'local' | 'memory';
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

export class MemoryStorageAdapter implements StorageAdapter {
  readonly kind = 'memory' as const;
  private readonly map = new Map<string, string>();
  get(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  set(key: string, value: string): void {
    this.map.set(key, value);
  }
  remove(key: string): void {
    this.map.delete(key);
  }
}

export class LocalStorageAdapter implements StorageAdapter {
  readonly kind = 'local' as const;
  constructor(private readonly storage: Storage) {}
  get(key: string): string | null {
    return this.storage.getItem(key);
  }
  set(key: string, value: string): void {
    this.storage.setItem(key, value);
  }
  remove(key: string): void {
    this.storage.removeItem(key);
  }
}

/** localStorage when usable (private mode / disabled storage throw), otherwise in-memory. */
export function createStorageAdapter(): StorageAdapter {
  try {
    if (typeof localStorage === 'undefined') return new MemoryStorageAdapter();
    const probe = '__tfil_probe__';
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    return new LocalStorageAdapter(localStorage);
  } catch {
    return new MemoryStorageAdapter();
  }
}
