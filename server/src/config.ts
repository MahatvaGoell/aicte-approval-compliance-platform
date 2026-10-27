import { config as loadEnv } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(here, '..', '..');
loadEnv({ path: path.join(repoRoot, '.env') });

function bool(v: string | undefined, def: boolean) {
  if (v === undefined || v === '') return def;
  return v === 'true' || v === '1';
}

function list(v: string | undefined) {
  return (v ?? '').split(',').map((s) => s.trim()).filter(Boolean);
}

function resolveDir(v: string | undefined, def: string) {
  return path.resolve(repoRoot, v || def);
}

export const config = {
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://aicte:aicte_dev_password@127.0.0.1:54329/aicte',
  testDatabaseUrl: process.env.TEST_DATABASE_URL ?? 'postgres://aicte:aicte_dev_password@127.0.0.1:54329/aicte_test',
  witnessUrl:process.env.WITNESS_URL??'http://127.0.0.1:4100',
  witnessPublicKeyPath:resolveDir(process.env.WITNESS_PUBLIC_KEY_PATH,'./var/witness/keys/public.pem'),
  port: Number(process.env.PORT ?? 4000),
  appBaseUrl: process.env.APP_BASE_URL ?? 'http://localhost:5180',
  cookieSecure: bool(process.env.COOKIE_SECURE, false),
  sessionTtlHours: Number(process.env.SESSION_TTL_HOURS ?? 12),
  demoMode: bool(process.env.DEMO_MODE, false),
  storageDir: resolveDir(process.env.STORAGE_DIR, './var/storage'),
  maxUploadBytes: Number(process.env.MAX_UPLOAD_MB ?? 10) * 1024 * 1024,
  emailAdapter: (process.env.EMAIL_ADAPTER ?? 'outbox') as 'outbox' | 'smtp',
  outboxDir: resolveDir(process.env.OUTBOX_DIR, './var/outbox'),
  smtpUrl: process.env.SMTP_URL ?? '',
  emailFrom: process.env.EMAIL_FROM ?? 'AICTE Approval & Compliance Platform <no-reply@demo.aicte.test>',
  transientFailureDomains: list(process.env.EMAIL_TRANSIENT_FAILURE_DOMAINS ?? 'flaky.demo.test'),
  permanentFailureDomains: list(process.env.EMAIL_PERMANENT_FAILURE_DOMAINS ?? 'bounce.demo.test'),
  workerPollMs: Number(process.env.WORKER_POLL_MS ?? 1000),
  workerConcurrency: Number(process.env.WORKER_CONCURRENCY ?? 10),
  aiProvider: (process.env.AI_PROVIDER ?? 'none') as 'none' | 'anthropic',
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? '',
  aiModel: process.env.AI_MODEL ?? 'claude-sonnet-5-5',
  brandName: process.env.BRAND_NAME ?? 'AICTE Approval & Compliance Platform',
};

export type AppConfig = typeof config;
