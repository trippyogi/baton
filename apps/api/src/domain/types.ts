export type SqliteStatement = {
  get: (...params: unknown[]) => unknown;
  all: (...params: unknown[]) => unknown[];
  run: (...params: unknown[]) => { changes: number };
};

export type DbLike = {
  prepare: (sql: string) => SqliteStatement;
  exec?: (sql: string) => unknown;
  transaction?: <T>(fn: () => T) => () => T;
};

export function nowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
