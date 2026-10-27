import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { ApiError } from './api';
import { Icon, Intro, ProgressBar, ThemeToggle, useNavIndicator, useSmoothScroll } from './motion';
import { ApplicationFormPage } from './pages/ApplicationForm';
import { ApplicationsPage } from './pages/Applications';
import { AuditPage } from './pages/Audit';
import { CasePage } from './pages/Case';
import { EvcPage } from './pages/Evc';
import { CompliancePage } from './pages/Compliance';
import { DashboardPage } from './pages/Dashboard';
import { ReportsPage } from './pages/Reports';
import { IntegrationPage } from './pages/Integration';
import { HomePage } from './pages/Home';
import { LoginPage } from './pages/Login';
import { NotificationsPage, useUnreadCount } from './pages/Notifications';
import { OpsPage } from './pages/Ops';
import { PolicyListPage, PolicyVersionPage } from './pages/Policy';
import { SessionProvider, useMe, useMeta, useSession } from './session';
import { ErrorState, initials, Loading } from './ui';

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

// Section label for each page, shown as the location in the top bar.
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
  if (path.startsWith('/documents')) return ['09','Documents'];
  if (path.startsWith('/obligations')) return ['10','Obligations'];
  if (path.startsWith('/dashboard')) return ['11', 'Dashboard'];
  if (path.startsWith('/reports')) return ['12', 'Reports'];
  if (path.startsWith('/integration')) return ['13', 'Mock integration'];
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
  const [navOpen, setNavOpen] = useState(false);
  useEffect(() => setNavOpen(false), [location.pathname]);
  useNavIndicator(navRef, indRef, location.pathname);
  const [, label] = sectionFor(location.pathname);
  // Case pages belong under Applications; the new-application form has its own entry.
  const inApplications = location.pathname.startsWith('/applications') && location.pathname !== '/applications/new' && !location.pathname.endsWith('/edit');
  return (
    <div className="shell">
      <a className="skip-link" href="#main">Skip to workspace</a>
      <aside className={`side ${navOpen ? 'menu-open' : ''}`}>
        <Link to="/" className="brand" aria-label="Home">
          <span className="brand-mark" aria-hidden="true">AT</span>
          <span className="brand-name">
            AICTE Compliance
            <small>Approval workflow · SIH26262</small>
          </span>
        </Link>
        <button className="mobile-menu" aria-controls="workspace-navigation" aria-expanded={navOpen} onClick={() => setNavOpen((open) => !open)}><Icon name="menu" />{navOpen ? 'Close menu' : 'Menu'}</button>
        <div className="workspace-navigation" id="workspace-navigation">
          <nav className="nav" aria-label="Main" ref={navRef}>
            <span className="nav-indicator" ref={indRef} aria-hidden="true" />
            <NavLink to="/" end><Icon name={me.activeGrant.role === 'INSTITUTION_REP' ? 'home' : 'inbox'} />{me.activeGrant.role === 'INSTITUTION_REP' ? 'Home' : 'My work'}</NavLink>
            {(can('APPLICATION_VIEW_SCOPE') || can('APPLICATION_VIEW_ASSIGNED')) && <NavLink to="/applications" className={() => (inApplications ? 'active' : '')}><Icon name="folder" />Applications</NavLink>}
            {can('APPLICATION_CREATE') && <NavLink to="/applications/new"><Icon name="plus" />New application</NavLink>}
            {(can('APPLICATION_VIEW_SCOPE')||can('APPLICATION_VIEW_ASSIGNED'))&&<><NavLink to="/documents"><Icon name="folder"/>Documents</NavLink><NavLink to="/obligations"><Icon name="layers"/>Obligations</NavLink></>}
            {(me.activeGrant.role === 'INSTITUTION_REP' || can('REPORTS_VIEW')) && <><NavLink to="/dashboard"><Icon name="pulse" />Dashboard</NavLink></>}
            {can('EVC_VIEW') && (me.activeGrant.role !== 'COMMITTEE_MEMBER' || me.activeGrant.committeeKind === 'EVC') && <NavLink to="/evc"><Icon name="calendar" />Expert visits</NavLink>}
          </nav>
          <details className="tool-nav" open={['/reports', '/audit', '/integration', '/policy', '/notifications', '/ops'].some((path) => location.pathname.startsWith(path))}>
            <summary><Icon name="sliders" />More tools<Icon name="chevron" /></summary>
            <nav className="nav secondary-nav" aria-label="More tools">
              {(me.activeGrant.role === 'INSTITUTION_REP' || can('REPORTS_VIEW')) && <NavLink to="/reports"><Icon name="layers" />Reports</NavLink>}
            {can('AUDIT_VIEW') && <NavLink to="/audit"><Icon name="shield" />Audit log</NavLink>}
            {can('INTEGRATION_VIEW') && <NavLink to="/integration"><Icon name="layers" />Mock integration</NavLink>}
            {can('POLICY_VIEW') && <NavLink to="/policy"><Icon name="layers" />Policy</NavLink>}
            <NavLink to="/notifications"><Icon name="bell" />Notifications</NavLink>
            {can('OPS_VIEW') && <NavLink to="/ops"><Icon name="pulse" />Operations</NavLink>}
            </nav>
          </details>
        </div>
        <div className="side-foot">
          <Icon name="shield" /><strong>Decisions stay human.</strong> The system routes, reminds and records. Only a competent authority decides.
        </div>
      </aside>
      <div className="main">
        <TopBar label={label} />
        <DemoBanner />
        <main className="content" id="main">
          <div className={`page surface-${label.toLowerCase().replaceAll(' ', '-')}`} key={location.pathname}>
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
              <Route path="/documents" element={<CompliancePage kind="documents"/>}/>
              <Route path="/obligations" element={<CompliancePage kind="obligations"/>}/>
              <Route path="/dashboard" element={<DashboardPage />} />
              <Route path="/reports" element={<ReportsPage />} />
              <Route path="/reports/:name" element={<ReportsPage />} />
              <Route path="/integration" element={<IntegrationPage />} />
              <Route path="*" element={<div className="card empty">Page not found.</div>} />
            </Routes>
          </div>
        </main>
      </div>
    </div>
  );
}

export function DemoBanner() {
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

function TopBar({ label }: { label: string }) {
  const { me, switchRole, logout } = useSession();
  return (
    <header className="topbar">
      <div className="crumb" aria-label="You are here"><span>Workspace</span><span className="sep" aria-hidden="true" /><strong>{label}</strong></div>
      <span className="who">
        <span className="avatar" aria-hidden="true">{initials(me.user.name)}</span>
        <span className="identity"><strong>{me.user.name}</strong><span className="small muted">{me.activeGrant.roleLabel}</span></span>
      </span>
      {me.grants.length > 1 ? (
        <label className="row" style={{ fontWeight: 400 }}>
          <span className="small muted">Acting as</span>
          <select value={me.activeGrant.id} onChange={(e) => switchRole(e.target.value)} aria-label="Active role" style={{ width: 'auto' }}>
            {me.grants.map((g) => <option key={g.id} value={g.id}>{g.roleLabel} · {g.scope}</option>)}
          </select>
        </label>
      ) : (
        <span className="chip neutral" title="Active role and scope">{me.activeGrant.scope}</span>
      )}
      <NotificationBell />
      <ThemeToggle />
      <button className="signout" onClick={logout} aria-label="Sign out"><Icon name="logout" /><span className="lbl">Sign out</span></button>
    </header>
  );
}
