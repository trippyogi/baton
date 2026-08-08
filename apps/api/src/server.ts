/**
 * TypeScript API entry used for typechecking and future full port.
 * Runtime start path is `apps/api/bootstrap.cjs`.
 */
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { loadConfigFromEnv } from '@baton/contracts';

const require = createRequire(import.meta.url);
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

dotenv.config({ path: path.join(rootDir, '.env') });

const config = loadConfigFromEnv(process.env);

process.env.VMC_PORT = String(config.port);
process.env.BATON_HOST = config.host;
if (config.apiToken) process.env.BATON_API_TOKEN = config.apiToken;
else delete process.env.BATON_API_TOKEN;

const { startServer } = require(path.join(rootDir, 'server', 'index.js')) as {
  startServer: (options?: { port?: number; host?: string }) => unknown;
};

export function boot(): void {
  startServer({ port: config.port, host: config.host });
}
