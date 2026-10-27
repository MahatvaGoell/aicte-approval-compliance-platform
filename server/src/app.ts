import {publicLetterRoutes} from './modules/letters/routes.js';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import Fastify, { type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { config } from './config.js';
import { AppError, getPool } from './db.js';
import { newCorrelationId } from './lib/crypto.js';
import { refreshDemoOffset } from './lib/clock.js';
import { applicationRoutes } from './modules/applications/routes.js';
import { auditRoutes } from './modules/audit/routes.js';
import { actorFromToken } from './modules/identity/auth.js';
import { identityRoutes } from './modules/identity/routes.js';
import { integrationRoutes } from './modules/integration/routes.js';
import { notificationRoutes } from './modules/notifications/routes.js';
import { opsRoutes } from './modules/ops/routes.js';
import { policyRoutes } from './modules/policy/routes.js';
import { referenceRoutes } from './modules/reference/routes.js';
import { evcRoutes } from './modules/evc/routes.js';
import { documentRoutes } from './modules/documents/routes.js';
import { complianceRoutes } from './modules/compliance/routes.js';
import { reportRoutes } from './modules/reports/routes.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
export const CSRF_HEADER = 'x-requested-with';
export const CSRF_VALUE = 'aicte-web';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: process.env.NODE_ENV === 'test' ? false : { level: process.env.LOG_LEVEL ?? 'info', redact: ['req.headers.cookie', 'req.headers.authorization'] },
    bodyLimit: 1024 * 1024,
    maxParamLength:8192,
    trustProxy: false,
  });
  await app.register(cookie);
  await app.register(multipart,{limits:{fileSize:config.maxUploadBytes,files:1,fields:1,parts:2}});
  app.decorateRequest('actor', null);
  app.decorateRequest('correlationId', '');
  app.decorateRequest('sessionToken', null);

  app.addHook('onRequest', async (req, reply) => {
    const incoming = req.headers['x-correlation-id'];
    req.correlationId = typeof incoming === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(incoming) ? incoming : newCorrelationId();
    reply.header('x-correlation-id', req.correlationId);
    reply.header('cache-control', 'no-store');
    reply.header('x-content-type-options', 'nosniff');
    if (!req.url.startsWith('/api/')) return;
    // CSRF: browsers cannot send this custom header cross-site without a CORS preflight, which we never allow.
    if (!SAFE_METHODS.has(req.method) && req.headers[CSRF_HEADER] !== CSRF_VALUE) {
      throw new AppError(403, 'CSRF_CHECK_FAILED', `Mutating requests must include the ${CSRF_HEADER} header`);
    }
    if(req.url.startsWith('/api/v1/public/'))return;
    const pool = getPool();
    await refreshDemoOffset(pool);
    const token = req.cookies.sid;
    if (token) {
      req.sessionToken = token;
      req.actor = await actorFromToken(pool, token);
    }
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = req.correlationId;
    if (err instanceof AppError) {
      return reply.status(err.status).send({ error: { code: err.code, message: err.message, details: err.details ?? null, correlationId } });
    }
    if (err instanceof ZodError) {
      return reply.status(422).send({
        error: {
          code: 'VALIDATION_FAILED', message: 'The request is invalid',
          details: err.issues.map((i) => ({ field: i.path.join('.'), message: i.message })), correlationId,
        },
      });
    }
    const pgErr = err as { code?: string; constraint?: string };
    if (pgErr.code === '23P01') {
      return reply.status(409).send({ error: { code: 'EXPERT_RESERVATION_CONFLICT', message: 'An expert was booked for an overlapping visit. Refresh suggestions and choose another slot.', details: null, correlationId } });
    }
    if (pgErr.code === '40P01') {
      return reply.status(409).send({ error: { code: 'CONCURRENT_CHANGE', message: 'A concurrent change prevented this action. Refresh and retry.', details: null, correlationId } });
    }
    if (pgErr.code === '23505') {
      return reply.status(409).send({ error: { code: 'CONFLICT', message: 'A conflicting change was made at the same time. Refresh and try again.', details: { constraint: pgErr.constraint }, correlationId } });
    }
    if ((err as any).validation) {
      return reply.status(400).send({ error: { code: 'BAD_REQUEST', message: err.message, details: null, correlationId } });
    }
    if ((err as any).statusCode && (err as any).statusCode < 500) {
      return reply.status((err as any).statusCode).send({ error: { code: 'BAD_REQUEST', message: err.message, details: null, correlationId } });
    }
    req.log.error({ err, correlationId }, 'Unhandled error');
    if (process.env.DEBUG_ERRORS === 'true') console.error(err);
    return reply.status(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong. Quote the correlation ID when reporting it.', details: null, correlationId } });
  });

  app.get('/health/live', async () => ({ status: 'ok' }));
  app.get('/health/ready', async (_req, reply) => {
    try {
      await getPool().query('SELECT 1');
      return { status: 'ready', database: 'ok' };
    } catch {
      return reply.status(503).send({ status: 'not_ready', database: 'unreachable' });
    }
  });

  await app.register(publicLetterRoutes,{prefix:'/api/v1'});
  await app.register(identityRoutes, { prefix: '/api/v1' });
  await app.register(referenceRoutes, { prefix: '/api/v1' });
  await app.register(applicationRoutes, { prefix: '/api/v1' });
  await app.register(auditRoutes, { prefix: '/api/v1' });
  await app.register(policyRoutes, { prefix: '/api/v1' });
  await app.register(notificationRoutes, { prefix: '/api/v1' });
  await app.register(opsRoutes, { prefix: '/api/v1' });
  await app.register(evcRoutes, { prefix: '/api/v1' });
  await app.register(documentRoutes, { prefix: '/api/v1' });
  await app.register(complianceRoutes, { prefix: '/api/v1' });
  await app.register(reportRoutes, { prefix: '/api/v1' });
  await app.register(integrationRoutes, { prefix: '/api/v1' });

  app.setNotFoundHandler((req, reply) => {
    reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'No such endpoint', details: null, correlationId: req.correlationId } });
  });
  return app;
}

export { config };
