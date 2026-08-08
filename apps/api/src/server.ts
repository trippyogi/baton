/**
 * Reserved for the future full TypeScript server entry.
 * Runtime boots through `apps/api/bootstrap.cjs` + compiled `dist/` routes.
 * Excluded from the CJS emit tsconfig to avoid import.meta / ESM conflicts
 * with better-sqlite3 on Windows Node 24.
 */
export {};
