import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { batonConfigSchema, envSchema } from './config';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, '..', 'schemas');
mkdirSync(outDir, { recursive: true });

const envJson = zodToJsonSchema(envSchema as never, 'BatonEnv');
const configJson = zodToJsonSchema(batonConfigSchema as never, 'BatonConfig');

writeFileSync(path.join(outDir, 'env.schema.json'), `${JSON.stringify(envJson, null, 2)}\n`);
writeFileSync(path.join(outDir, 'config.schema.json'), `${JSON.stringify(configJson, null, 2)}\n`);

console.log('Wrote packages/contracts/schemas/*.schema.json');
