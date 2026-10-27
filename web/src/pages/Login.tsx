import { useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { Icon, ThemeToggle } from '../motion';
import { useMeta } from '../session';
import { ErrorState, Loading, MutationError, Postmark } from '../ui';

// The five things the platform does to every case, shown as postmarked hops on the welcome side.
const HOPS: [string, string][] = [['Route', 'versioned rules'], ['Clock', 'every deadline'], ['Escalate', 'notify, never decide'], ['Watch', 'conditions & expiry'], ['Prove', 'tamper-evident log']];

// Demo accounts grouped by the kind of user, so a presenter can pick a role at a glance.
const GROUPS: { title: string; icon: string; match: (handle: string) => boolean }[] = [
  { title: 'Institutions', icon: 'building', match: (h) => h.startsWith('inst.') },
  { title: 'Regional offices and bureau', icon: 'map', match: (h) => h.startsWith('ro.') || h === 'bureau' },
  { title: 'Committees', icon: 'users', match: (h) => h.startsWith('scrutiny.') || h.startsWith('evc') },
  { title: 'Authority', icon: 'gavel', match: (h) => h === 'authority' },
  { title: 'Policy, administration and audit', icon: 'sliders', match: () => true },
];
const ICON_FOR: Record<string, string> = { 'policy.admin': 'sliders', 'policy.approver': 'layers', admin: 'cog', auditor: 'eye' };

export function LoginPage() {
  const meta = useMeta();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [activeGroup, setActiveGroup] = useState(0);

  async function demoSignIn(demoEmail: string) {
    setBusy(demoEmail);
    setError(null);
    setEmail(demoEmail);
    try {
      await api.post('/auth/demo-login', { email: demoEmail });
      qc.clear();
      navigate('/');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy('form');
    setError(null);
    try {
      await api.post('/auth/login', { email, password });
      qc.clear();
      navigate('/');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  }

  const accounts = meta.data?.demoMode ? meta.data.demoAccounts : [];
  const placed = new Set<string>();
  const groups = GROUPS.map((g) => {
    const list = accounts.filter((a) => {
      const handle = a.email.split('@')[0];
      if (placed.has(a.email) || !g.match(handle)) return false;
      placed.add(a.email);
      return true;
    });
    return { ...g, list };
  }).filter((g) => g.list.length > 0);

  const form = (
    <form className="stack" onSubmit={submit} aria-labelledby="signin-title">
      <label>
        Email
        <input id="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </label>
      <label>
        Password
        <input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
      </label>
      <button className="primary" type="submit" disabled={busy !== null}>{busy === 'form' ? 'Signing in…' : 'Sign in'}</button>
    </form>
  );

  return (
    <div className="login-page">
      {meta.data?.demoMode && <div className="demo-banner" role="note"><span className="tag">DEMO</span><span className="demo-long"><strong>Demonstration environment.</strong> All institutions, people and rules are synthetic. Routing and timing rules are labelled demo assumptions, not AICTE rules.{meta.data.demoClockOffsetMs !== 0 && <strong> Demo clock: {meta.data.demoClockOffsetMs > 0 ? '+' : ''}{(meta.data.demoClockOffsetMs / 86_400_000).toFixed(1)} days.</strong>}</span><span className="demo-short" aria-hidden="true">Synthetic data · demo rules, not AICTE rules</span></div>}
    <div className="login-wrap">
      <section className="login-hero">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">AT</span>
          <span className="brand-name">
            {meta.data?.brandName ?? 'AICTE Approval & Compliance Platform'}
            <small>Prototype · SIH 2026 · PS 26262</small>
          </span>
        </div>
        <div className="stack" style={{ gap: 22 }}>
          <h1>
            Every approval file,
            <span className="dim">on time and on record.</span>
          </h1>
          <p className="lede">
            Applications are routed by versioned rules, every stage shows who owns the next action, and every step is written to a
            tamper-evident log. Decisions stay with the competent authority.
          </p>
          <div className="demo-track">
            <ol aria-label="How it works">
              {HOPS.map(([name, note], i) => (
                <li key={name} style={{ '--i': i } as any}>
                  <Postmark top={name} date={`STEP 0${i + 1}`} bottom="Approval track" size={72} land delay={200 + i * 180} />
                  <span className="hop-name">{name}</span><span className="cap">{note}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>
        <div className="login-trust"><Icon name="shield" /><p className="small muted">Not an official AICTE system. All institutions, people and documents are synthetic.</p></div>
      </section>

      <section className="login-panel" aria-labelledby="signin-title">
        <div className="login-panel-head">
          <div>
            <h2 id="signin-title">{groups.length ? 'Welcome to your workspace' : 'Sign in'}</h2>
            <p>{groups.length ? 'Choose who you are. Demo accounts sign in with one click.' : 'Use your account email and password.'}</p>
          </div>
          <ThemeToggle />
        </div>
        <MutationError error={error} />
        {meta.isLoading ? <Loading rows={4} /> : meta.error ? <ErrorState error={meta.error} onRetry={() => meta.refetch()} /> : groups.length > 0 ? (
          <>
            <div className="windows" role="group" aria-label="Workspace">
              {groups.map((g, index) => <button key={g.title} type="button" aria-pressed={index === activeGroup} onClick={() => setActiveGroup(index)}>{g.title}</button>)}
            </div>
            <div className="account-list">
              {groups.filter((_, index) => index === activeGroup).map((g) => (
                <div className="role-group" key={g.title}>
                  <h3>{g.title}</h3>
                  <div className="role-grid">
                    {g.list.map((a, i) => {
                      const handle = a.email.split('@')[0];
                      return (
                        <button
                          key={a.email}
                          type="button"
                          className={`role-card ${busy === a.email ? 'busy' : ''}`}
                          style={{ '--i': i } as any}
                          disabled={busy !== null}
                          onClick={() => demoSignIn(a.email)}
                        >
                          <span className="ico"><Icon name={ICON_FOR[handle] ?? g.icon} /></span>
                          <span className="t">
                            <b>{a.label}</b>
                            <span>{busy === a.email ? 'Signing in…' : handle}</span>
                          </span>
                          <Icon name="arrow" />
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
            <details className="pw">
              <summary>Sign in with email and password instead</summary>
              {form}
            </details>
          </>
        ) : form}
      </section>
    </div>
    </div>
  );
}
