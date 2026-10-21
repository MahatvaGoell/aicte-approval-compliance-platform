import { useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useMeta } from '../session';
import { MutationError } from '../ui';

export function LoginPage() {
  const meta = useMeta();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function demoSignIn(demoEmail: string) {
    setBusy(true);
    setError(null);
    setEmail(demoEmail);
    try {
      await api.post('/auth/demo-login', { email: demoEmail });
      qc.clear();
      navigate('/');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/auth/login', { email, password });
      qc.clear();
      navigate('/');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <div className="login">
        <form className="card stack" onSubmit={submit} aria-labelledby="signin-title">
          <div>
            <h1 id="signin-title">Sign in</h1>
            <p className="muted">{meta.data?.brandName ?? 'AICTE Approval & Compliance Platform'}</p>
          </div>
          <label>
            Email
            <input id="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </label>
          <label>
            Password
            <input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </label>
          <MutationError error={error} />
          <button className="primary" type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
          <p className="small muted">Prototype for SIH 2026 problem statement 26262. Not an official AICTE system.</p>
        </form>
        {meta.data?.demoMode && (
          <section className="card stack" aria-labelledby="demo-title">
            <div>
              <h2 id="demo-title">Demo accounts</h2>
              <p className="small muted">Synthetic users for the demonstration. Click one to sign in as that user.</p>
            </div>
            <div className="account-list">
              {meta.data.demoAccounts.map((a) => (
                <button key={a.email} type="button" disabled={busy} onClick={() => demoSignIn(a.email)}>
                  <span>{a.label}</span>
                  <span className="mono muted">{a.email.split('@')[0]}</span>
                </button>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
