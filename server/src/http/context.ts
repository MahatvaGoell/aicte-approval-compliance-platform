import type { FastifyReply, FastifyRequest } from 'fastify';
import { AppError } from '../db.js';
import { now } from '../lib/clock.js';
import type { ActionContext } from '../modules/audit/audit.js';
import type { Actor, Capability } from '../modules/identity/permissions.js';

declare module 'fastify' {
  interface FastifyRequest {
    actor: Actor | null;
    correlationId: string;
    sessionToken: string | null;
  }
}

export function requireActor(req: FastifyRequest): Actor {
  if (!req.actor) throw new AppError(401, 'UNAUTHENTICATED', 'Sign in to continue');
  return req.actor;
}

export function requireCapability(req: FastifyRequest, cap: Capability): Actor {
  const actor = requireActor(req);
  if (!actor.capabilities.has(cap)) throw new AppError(403, 'FORBIDDEN', 'Your active role does not permit this action');
  return actor;
}

export function actionContext(req: FastifyRequest): ActionContext {
  return { actor: req.actor, correlationId: req.correlationId, at: now() };
}

export function idempotencyKey(req: FastifyRequest): string | undefined {
  const v = req.headers['idempotency-key'];
  return Array.isArray(v) ? v[0] : v;
}

export type Reply = FastifyReply;
