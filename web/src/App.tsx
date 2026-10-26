import { useRef } from 'react';
import { Link, NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { ApiError } from './api';
import { Icon, Intro, ProgressBar, ThemeToggle, useNavIndicator, useSmoothScroll } from './motion';
import { ApplicationFormPage } from './pages/ApplicationForm';
import { ApplicationsPage } from './pages/Applications';
import { AuditPage } from './pages/Audit';
import { CasePage } from './pages/Case';
import { EvcPage } from './pages/Evc';
import { HomePage } from './pages/Home';
import { LoginPage } from './pages/Login';
import { NotificationsPage, useUnreadCount } from './pages/Notifications';
import { OpsPage } from './pages/Ops';
import { PolicyListPage, PolicyVersionPage } from './pages/Policy';
import { SessionProvider, useMe, useMeta, useSession } from './session';
import { ErrorState, Loading } from './ui';

export function App() {
  const location = useLocation();
  useSmoothScroll();
  return (
    <>
      <Intro />
      <ProgressBar />
      {location.pathname === '/login' ? <LoginPage /> : <Authenticated />}
    </>
  );
}

function initials(name: string) {
  return name.replace(/\(.*\)/, '').split(/[\s.]+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
}

// Section label shown above each page, in the style "(02) Applications".
function sectionFor(path: string): [string, string] {
  if (path === '/') return ['01', 'Overview'];
  if (path === '/applications/new' || path.endsWith('/edit')) return ['03', 'Application form'];
  if (path.startsWith('/applications/')) return ['02', 'Case file'];
  if (path.startsWith('/applications')) return ['02', 'Applications'];
  if (path.startsWith('/audit')) return ['04', 'Audit log'];
  if (path.startsWith('/policy')) return ['05', 'Policy'];
  if (path.startsWith('/notifications')) return ['06', 'Notifications'];
  if (path.startsWith('/ops')) return ['07', 'Operations'];
  if (path.startsWith('/evc')) return ['08', 'Expert visits'];
  return ['00', 'Page'];
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
  const location = useLocation();
  const navRef = useRef<HTMLElement>(null);
  const indRef = useRef<HTMLSpanElement>(null);
  useNavIndicator(navRef, indRef, location.pathname);
  const [idx, label] = sectionFor(location.pathname);
  // Case pages belong under Applications; the new-application form has its own entry.
  const inApplications = location.pathname.startsWith('/applications') && location.pathname !== '/applications/new' && !location.pathname.endsWith('/edit');
  return (
    <div className="shell">
      <aside className="side">
        <Link to="/" className="brand" aria-label="Home">
          <span className="brand-mark">Ai</span>
          <span className="brand-name">
            AICTE Compliance
            <small>Approval workflow · SIH26262</small>
          </span>
        </Link>
        <div>
          <div className="nav-label">Workspace</div>
          <nav className="nav" aria-label="Main" ref={navRef}>
            <span className="nav-indicator" ref={indRef} aria-hidden="true" />
            <NavLink to="/" end><Icon name={me.activeGrant.role === 'INSTITUTION_REP' ? 'home' : 'inbox'} />{me.activeGrant.role === 'INSTITUTION_REP' ? 'Home' : 'My work'}</NavLink>
            {(can('APPLICATION_VIEW_SCOPE') || can('APPLICATION_VIEW_ASSIGNED')) && <NavLink to="/applications" className={() => (inApplications ? 'active' : '')}><Icon name="folder" />Applications</NavLink>}
            {can('APPLICATION_CREATE') && <NavLink to="/applications/new"><Icon name="plus" />New application</NavLink>}
            {can('AUDIT_VIEW') && <NavLink to="/audit"><Icon name="shield" />Audit log</NavLink>}
            {can('POLICY_VIEW') && <NavLink to="/policy"><Icon name="layers" />Policy</NavLink>}
            <NavLink to="/notifications"><Icon name="bell" />Notifications</NavLink>
            {can('OPS_VIEW') && <NavLink to="/ops"><Icon name="pulse" />Operations</NavLink>}
            {can('EVC_VIEW') && (me.activeGrant.role !== 'COMMITTEE_MEMBER' || me.activeGrant.committeeKind === 'EVC') && <NavLink to="/evc"><Icon name="calendar" />Expert visits</NavLink>}
          </nav>
        </div>
        <div className="side-foot">
          <strong>Decisions stay human.</strong> The system routes, reminds and records. Only a competent authority decides.
        </div>
      </aside>
      <div className="main">
        <TopBar />
        <DemoBanner />
        <main className="content" id="main">
          <div className="page" key={location.pathname}>
            <div className="eyebrow"><span className="idx">({idx})</span>{label}</div>
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/applications" element={<ApplicationsPage />} />
              <Route path="/applications/new" element={<ApplicationFormPage />} />
              <Route path="/applications/:id" element={<CasePage />} />
              <Route path="/applications/:id/edit" element={<ApplicationFormPage />} />
              <Route path="/audit" element={<AuditPage />} />
              <Route path="/policy" element={<PolicyListPage />} />
              <Route path="/policy/:id" element={<PolicyVersionPage />} />
              <Route path="/notifications" element={<NotificationsPage />} />
              <Route path="/ops" element={<OpsPage />} />
              <Route path="/evc" element={<EvcPage />} />
              <Route path="*" element={<div className="card empty">Page not found.</div>} />
            </Routes>
          </div>
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
      <span className="tag">DEMO</span>
      <span><strong>Demonstration environment.</strong> All institutions, people and rules are synthetic. Routing and timing rules are labelled demo
      assumptions, not AICTE rules.
      {days !== 0 && <> <strong>Demo clock: {days > 0 ? '+' : ''}{days.toFixed(1)} days.</strong></>}</span>
    </div>
  );
}

function NotificationBell() {
  const count = useUnreadCount();
  const n = count.data?.unreadCount ?? 0;
  return (
    <Link to="/notifications" className="btn icon bell" aria-label={n ? `${n} unread notifications` : 'Notifications'} title="Notifications">
      <Icon name="bell" />
      {n > 0 && <span className="badge num" key={n}>{n > 99 ? '99+' : n}</span>}
    </Link>
  );
}

function TopBar() {
  const { me, switchRole, logout } = useSession();
  return (
    <header className="topbar">
      <span className="who">
        <span className="avatar" aria-hidden="true">{initials(me.user.name)}</span>
        <span className="small">{me.user.name}</span>
      </span>
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
      <NotificationBell />
      <ThemeToggle />
      <button onClick={logout}><Icon name="logout" />Sign out</button>
    </header>
  );
}
