import { z } from 'zod';

const boolFromEnv = z
  .union([z.boolean(), z.string()])
  .transform((value) => {
    if (typeof value === 'boolean') return value;
    const normalized = value.trim().toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 'yes';
  });

/**
 * Validated process environment for the BATON control plane.
 * PORT and VMC_PORT both accepted; VMC_PORT wins when both are set.
 */
export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).optional(),
    VMC_PORT: z.string().optional(),
    PORT: z.string().optional(),
    BATON_HOST: z.string().optional(),
    HOST: z.string().optional(),
    BATON_API_TOKEN: z.string().optional(),
    BATON_SSH_HINT: z.string().optional(),
    BATON_PUBLIC_BASE_URL: z.string().optional(),
    BATON_CALLBACK_TOKEN: z.string().optional(),
    GITHUB_WEBHOOK_SECRET: z.string().optional(),
    GITHUB_WORKER_TOKEN: z.string().optional(),
    REDIS_URL: z.string().optional(),
    SHARED_REQUESTS_TOKEN: z.string().optional(),
    SPECTRE_DISPATCH_TRANSPORT: z.string().optional(),
    SPECTRE_WEBHOOK_URL: z.string().optional(),
    SPECTRE_DISPATCH_TOKEN: z.string().optional(),
    BATON_REQUIRE_API_TOKEN: boolFromEnv.optional(),
  })
  .passthrough();

export const batonConfigSchema = z.object({
  nodeEnv: z.enum(['development', 'test', 'production']).default('development'),
  port: z.number().int().positive(),
  host: z.string().min(1),
  apiToken: z.string().nullable(),
  sshHint: z.string().nullable(),
  publicBaseUrl: z.string().nullable(),
  callbackToken: z.string().nullable(),
  githubWebhookSecret: z.string().nullable(),
  githubWorkerToken: z.string().nullable(),
  redisUrl: z.string().nullable(),
  sharedRequestsToken: z.string().nullable(),
  spectreDispatchTransport: z.string().nullable(),
  spectreWebhookUrl: z.string().nullable(),
  spectreDispatchToken: z.string().nullable(),
});

export type BatonConfig = z.infer<typeof batonConfigSchema>;

function parsePort(raw: string | undefined, fallback: number): number {
  if (raw == null || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Invalid port value: ${raw}`);
  }
  return value;
}

export function loadConfigFromEnv(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): BatonConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const details = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
    throw new Error(`Invalid environment configuration: ${details}`);
  }

  const data = parsed.data;
  const port = parsePort(data.VMC_PORT ?? data.PORT, 4200);
  const host = (data.BATON_HOST || data.HOST || '127.0.0.1').trim() || '127.0.0.1';

  return batonConfigSchema.parse({
    nodeEnv: data.NODE_ENV ?? 'development',
    port,
    host,
    apiToken: data.BATON_API_TOKEN?.trim() || null,
    sshHint: data.BATON_SSH_HINT?.trim() || null,
    publicBaseUrl: data.BATON_PUBLIC_BASE_URL?.trim() || null,
    callbackToken: data.BATON_CALLBACK_TOKEN?.trim() || null,
    githubWebhookSecret: data.GITHUB_WEBHOOK_SECRET?.trim() || null,
    githubWorkerToken: data.GITHUB_WORKER_TOKEN?.trim() || null,
    redisUrl: data.REDIS_URL?.trim() || null,
    sharedRequestsToken: data.SHARED_REQUESTS_TOKEN?.trim() || null,
    spectreDispatchTransport: data.SPECTRE_DISPATCH_TRANSPORT?.trim() || null,
    spectreWebhookUrl: data.SPECTRE_WEBHOOK_URL?.trim() || null,
    spectreDispatchToken: data.SPECTRE_DISPATCH_TOKEN?.trim() || null,
  });
}
