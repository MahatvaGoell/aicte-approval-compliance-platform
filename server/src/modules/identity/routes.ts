import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { config } from '../../config.js';
import { AppError, getPool } from '../../db.js';
import { demoOffsetMs, now } from '../../lib/clock.js';
import { requireActor } from '../../http/context.js';
import { activeGrants, demoLogin, describeGrant, login, logout, switchGrant } from './auth.js';
import { ROLE_LABELS } from './permissions.js';

// Simple in-memory limiter for login attempts per client address (per API process).
const attempts = new Map<string, { count: number; windowStart: number }>();
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 20;

function rateLimit(ip: string) {
  const t = Date.now();
  const entry = attempts.get(ip);
  if (!entry || t - entry.windowStart > WINDOW_MS) {
    attempts.set(ip, { count: 1, windowStart: t });
    return;
  }
  entry.count += 1;
  if (entry.count > MAX_PER_WINDOW) throw new AppError(429, 'RATE_LIMITED', 'Too many sign-in attempts. Wait a minute and try again.');
}

export function resetLoginRateLimit() {
  attempts.clear();
}

export async function identityRoutes(app: FastifyInstance) {
  app.post('/auth/login', async (req, reply) => {
    rateLimit(req.ip);
    const body = z.object({ email: z.string().email().max(200), password: z.string().min(1).max(200) }).parse(req.body);
    const { token, expires } = await login(getPool(), body.email, body.password, req.ip, String(req.headers['user-agent'] ?? ''));
    reply.setCookie('sid', token, {
      httpOnly: true, sameSite: 'strict', secure: config.cookieSecure, path: '/', expires,
    });
    return { ok: true };
  });

  // Demo mode only: one-click sign-in as a listed synthetic account. Returns 404 outside demo mode.
  app.post('/auth/demo-login', async (req, reply) => {
    if (!config.demoMode) throw new AppError(404, 'NOT_FOUND', 'Not found');
    rateLimit(req.ip);
    const body = z.object({ email: z.string().email().max(200) }).parse(req.body);
    const { token, expires } = await demoLogin(
      getPool(), body.email, DEMO_ACCOUNTS.map((a) => a.email), req.ip, String(req.headers['user-agent'] ?? ''),
    );
    reply.setCookie('sid', token, {
      httpOnly: true, sameSite: 'strict', secure: config.cookieSecure, path: '/', expires,
    });
    return { ok: true };
  });

  app.post('/auth/logout', async (req, reply) => {
    if (req.sessionToken) await logout(getPool(), req.sessionToken);
    reply.clearCookie('sid', { path: '/' });
    return { ok: true };
  });

  app.post('/auth/switch-role', async (req) => {
    const actor = requireActor(req);
    const body = z.object({ grantId: z.string().uuid() }).parse(req.body);
    await switchGrant(getPool(), actor, body.grantId);
    return { ok: true };
  });

  app.get('/me', async (req) => {
    const actor = requireActor(req);
    const grants = await activeGrants(getPool(), actor.userId);
    return {
      user: { id: actor.userId, name: actor.name, email: actor.email },
      activeGrant: describeGrant(grants.find((g) => g.id === actor.grantId)!),
      grants: grants.map(describeGrant),
      capabilities: [...actor.capabilities].sort(),
      roleLabel: ROLE_LABELS[actor.role],
    };
  });

  // Public, used by the login page and the demo banner.
  app.get('/meta', async () => ({
    brandName: config.brandName,
    demoMode: config.demoMode,
    businessTime: now().toISOString(),
    demoClockOffsetMs: demoOffsetMs(),
    demoAccounts: config.demoMode ? DEMO_ACCOUNTS : [],
  }));
}

// Listed only in demo mode, where they can also sign in with one click (/auth/demo-login).
// Passwords for these synthetic accounts are documented in the README.
export const DEMO_ACCOUNTS = [
  { email: 'inst.west@demo.aicte.test', label: 'Institution representative (Demo Institute of Technology, Pune)' },
  { email: 'inst.north@demo.aicte.test', label: 'Institution representative (Demo College of Engineering, Lucknow)' },
  { email: 'ro.west@demo.aicte.test', label: 'Regional officer, Demo West region' },
  { email: 'ro.north@demo.aicte.test', label: 'Regional officer, Demo North region' },
  { email: 'bureau@demo.aicte.test', label: 'Bureau officer, all regions' },
  { email: 'scrutiny.west1@demo.aicte.test', label: 'Scrutiny committee member, Demo West' },
  { email: 'scrutiny.west2@demo.aicte.test', label: 'Scrutiny committee member, Demo West' },
  { email: 'scrutiny.north1@demo.aicte.test', label: 'Scrutiny committee member, Demo North' },
  { email: 'authority@demo.aicte.test', label: 'Competent authority' },
  { email: 'policy.admin@demo.aicte.test', label: 'Policy administrator' },
  { email: 'policy.approver@demo.aicte.test', label: 'Policy approver' },
  { email: 'admin@demo.aicte.test', label: 'System administrator' },
  { email: 'auditor@demo.aicte.test', label: 'Auditor (read-only)' },
];
