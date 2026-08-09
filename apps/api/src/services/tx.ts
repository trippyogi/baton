import type { DbLike } from '../domain/types';

export function runTx<T>(db: DbLike, fn: () => T): T {
  if (typeof db.transaction !== 'function') {
    throw new Error('Database transaction support is required for domain writes');
  }
  return db.transaction(fn)();
}
