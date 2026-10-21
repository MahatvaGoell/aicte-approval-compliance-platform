import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { ApiError } from './api';
import { ApplicationFormPage } from './pages/ApplicationForm';
import { ApplicationsPage } from './pages/Applications';
import { AuditPage } from './pages/Audit';
import { CasePage } from './pages/Case';
import { HomePage } from './pages/Home';
import { LoginPage } from './pages/Login';
import { SessionProvider, useMe, useMeta, useSession } from './session';
import { ErrorState, Loading } from './ui';

export function App() {
  const location = useLocation();
  if (location.pathname === '/login') return <LoginPage />;
  return <Authenticated />;
}

function Authenticated() {
  const me = useMe();
  if (me.isLoading) return <div className="content"><Loading rows={4} /></div>;
  if (me.error instanceof ApiError && me.error.status === 401) return <Navigate to="/login" replace />;
  if (me.error) return <div className="content"><ErrorState error={me.error} onRetry={() => me.refetch()} /></div>;
  return (
    <SessionProvider me={me.data!}>
      <Shell />
    </SessionProvider>
  );
}

function Shell() {
  const { me, can } = useSession();
  return (
    <div className="shell">
      <aside className="side">
        <div className="brand">
          AICTE Approval &amp; Compliance Platform
          <small>Prototype · SIH26262</small>
        </div>
        <nav className="nav" aria-label="Main">
          <NavLink to="/" end>{me.activeGrant.role === 'INSTITUTION_REP' ? 'Home' : 'My work'}</NavLink>
          {(can('APPLICATION_VIEW_SCOPE') || can('APPLICATION_VIEW_ASSIGNED')) && <NavLink to="/applications">Applications</NavLink>}
          {can('APPLICATION_CREATE') && <NavLink to="/applications/new">New application</NavLink>}
          {can('AUDIT_VIEW') && <NavLink to="/audit">Audit log</NavLink>}
        </nav>
      </aside>
      <div className="main">
        <DemoBanner />
        <TopBar />
        <main className="content" id="main">
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/applications" element={<ApplicationsPage />} />
            <Route path="/applications/new" element={<ApplicationFormPage />} />
            <Route path="/applications/:id" element={<CasePage />} />
            <Route path="/applications/:id/edit" element={<ApplicationFormPage />} />
            <Route path="/audit" element={<AuditPage />} />
            <Route path="*" element={<div className="card empty">Page not found.</div>} />
          </Routes>
        </main>
      </div>
    </div>
  );
}

function DemoBanner() {
  const meta = useMeta();
  if (!meta.data?.demoMode) return null;
  const days = meta.data.demoClockOffsetMs / 86_400_000;
  return (
    <div className="demo-banner" role="note">
      <strong>Demonstration environment.</strong> All institutions, people and rules are synthetic. Routing and timing rules are labelled demo
      assumptions, not AICTE rules.
      {days !== 0 && <> <strong>Demo clock: {days > 0 ? '+' : ''}{days.toFixed(1)} days.</strong></>}
    </div>
  );
}

function TopBar() {
  const { me, switchRole, logout } = useSession();
  return (
    <header className="topbar">
      <span className="muted small">{me.user.name}</span>
      {me.grants.length > 1 ? (
        <label className="row" style={{ fontWeight: 400 }}>
          <span className="small muted">Acting as</span>
          <select value={me.activeGrant.id} onChange={(e) => switchRole(e.target.value)} aria-label="Active role" style={{ width: 'auto' }}>
            {me.grants.map((g) => <option key={g.id} value={g.id}>{g.roleLabel} · {g.scope}</option>)}
          </select>
        </label>
      ) : (
        <span className="chip accent">{me.activeGrant.roleLabel} · {me.activeGrant.scope}</span>
      )}
      <button onClick={logout}>Sign out</button>
    </header>
  );
}
