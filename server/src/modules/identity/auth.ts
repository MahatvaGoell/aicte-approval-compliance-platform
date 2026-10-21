import { config } from '../../config.js';
import type { Db } from '../../db.js';
import { AppError, maybe, q } from '../../db.js';
import { newToken, sha256, verifyPassword } from '../../lib/crypto.js';
import { now } from '../../lib/clock.js';
import { type Actor, type Role, capabilitiesFor, ROLE_LABELS } from './permissions.js';

const MAX_FAILED_LOGINS = 5;
const LOCKOUT_MINUTES = 15;

export interface GrantRow {
  id: string;
  user_id: string;
  role: Role;
  official_designation: string | null;
  institution_id: string | null;
  institution_name: string | null;
  region_ids: string[];
  scope_all: boolean;
  committee_id: string | null;
  committee_kind: string | null;
  committee_name: string | null;
  extra_capabilities: string[];
  valid_from: Date;
  valid_to: Date | null;
}

/** Grants that are usable right now: not revoked and inside their validity window (business time). */
export async function activeGrants(db: Db, userId: string): Promise<GrantRow[]> {
  return q<GrantRow>(
    db,
    `SELECT g.*, i.name AS institution_name, c.kind AS committee_kind, c.name AS committee_name
       FROM capability_grants g
       LEFT JOIN institutions i ON i.id = g.institution_id
       LEFT JOIN committees c ON c.id = g.committee_id
      WHERE g.user_id = $1 AND g.revoked_at IS NULL
        AND g.valid_from <= $2 AND (g.valid_to IS NULL OR g.valid_to > $2)
      ORDER BY g.granted_at`,
    [userId, now()],
  );
}

export function describeGrant(g: GrantRow) {
  const scope =
    g.role === 'INSTITUTION_REP'
      ? g.institution_name
      : g.committee_name
        ? g.committee_name
        : g.scope_all
          ? 'All regions'
          : g.region_ids.length
            ? g.region_ids.join(', ')
            : 'System';
  return {
    id: g.id,
    role: g.role,
    roleLabel: ROLE_LABELS[g.role],
    officialDesignation: g.official_designation,
    scope,
    institutionId: g.institution_id,
    regionIds: g.region_ids,
    scopeAll: g.scope_all,
    committeeId: g.committee_id,
    committeeKind: g.committee_kind,
    extraCapabilities: g.extra_capabilities,
    validTo: g.valid_to,
  };
}

export async function login(db: Db, email: string, password: string, ip: string, userAgent: string) {
  const user = await maybe(db, 'SELECT * FROM users WHERE lower(email) = lower($1)', [email.trim()]);
  const invalid = new AppError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect');
  if (!user || !user.is_active) {
    // Still spend time on a hash so response time does not reveal which emails exist.
    verifyPassword(password, 'scrypt$16384$AAAAAAAAAAAAAAAAAAAAAA==$' + 'A'.repeat(86) + '==');
    throw invalid;
  }
  if (user.locked_until && new Date(user.locked_until) > new Date()) {
    throw new AppError(423, 'ACCOUNT_LOCKED', 'Too many failed attempts. Try again after 15 minutes.');
  }
  if (!verifyPassword(password, user.password_hash)) {
    const failed = user.failed_logins + 1;
    const lock = failed >= MAX_FAILED_LOGINS ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000) : null;
    await db.query('UPDATE users SET failed_logins = $2, locked_until = $3 WHERE id = $1', [
      user.id, lock ? 0 : failed, lock,
    ]);
    throw invalid;
  }
  const grants = await activeGrants(db, user.id);
  if (grants.length === 0) {
    throw new AppError(403, 'NO_ACTIVE_ROLE', 'This account has no active role assignment');
  }
  await db.query('UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = $1', [user.id]);
  return createSession(db, user.id, grants[0].id, ip, userAgent);
}

/**
 * Demo mode only: signs in as one of the listed synthetic accounts without a password.
 * The caller must check config.demoMode and the allowlist; this function checks them again.
 */
export async function demoLogin(db: Db, email: string, allowed: readonly string[], ip: string, userAgent: string) {
  if (!config.demoMode || !allowed.includes(email.toLowerCase())) {
    throw new AppError(404, 'NOT_FOUND', 'Not found');
  }
  const user = await maybe(db, 'SELECT * FROM users WHERE lower(email) = lower($1) AND is_active', [email]);
  if (!user) throw new AppError(404, 'NOT_FOUND', 'Not found');
  const grants = await activeGrants(db, user.id);
  if (grants.length === 0) throw new AppError(403, 'NO_ACTIVE_ROLE', 'This account has no active role assignment');
  return createSession(db, user.id, grants[0].id, ip, userAgent);
}

async function createSession(db: Db, userId: string, grantId: string, ip: string, userAgent: string) {
  const token = newToken();
  // Session lifetime uses real time: the demo clock must never extend or shorten a login.
  const expires = new Date(Date.now() + config.sessionTtlHours * 3600_000);
  await db.query(
    `INSERT INTO sessions (token_hash, user_id, active_grant_id, expires_at, ip, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [sha256(token), userId, grantId, expires, ip, userAgent.slice(0, 300)],
  );
  return { token, expires };
}

export async function logout(db: Db, token: string) {
  await db.query('UPDATE sessions SET revoked_at = now() WHERE token_hash = $1', [sha256(token)]);
}

/** Resolves a session token to an Actor, re-checking that the active grant is still valid. */
export async function actorFromToken(db: Db, token: string): Promise<Actor | null> {
  const s = await maybe(
    db,
    `SELECT s.id AS session_id, s.active_grant_id, u.id AS user_id, u.name, u.email, u.is_active
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now()`,
    [sha256(token)],
  );
  if (!s || !s.is_active) return null;
  const grants = await activeGrants(db, s.user_id);
  const g = grants.find((x) => x.id === s.active_grant_id);
  if (!g) return null; // grant revoked or expired: the session no longer authorises anything
  await db.query('UPDATE sessions SET last_seen_at = now() WHERE id = $1', [s.session_id]);
  return {
    userId: s.user_id,
    name: s.name,
    email: s.email,
    sessionId: s.session_id,
    grantId: g.id,
    role: g.role,
    officialDesignation: g.official_designation,
    capabilities: capabilitiesFor(g.role, g.extra_capabilities),
    institutionId: g.institution_id,
    regionIds: g.region_ids,
    scopeAll: g.scope_all,
    committeeId: g.committee_id,
    committeeKind: g.committee_kind,
  };
}

export async function switchGrant(db: Db, actor: Actor, grantId: string) {
  const grants = await activeGrants(db, actor.userId);
  if (!grants.some((g) => g.id === grantId)) {
    throw new AppError(403, 'GRANT_NOT_AVAILABLE', 'That role is not available to you');
  }
  await db.query('UPDATE sessions SET active_grant_id = $2 WHERE id = $1', [actor.sessionId, grantId]);
}
