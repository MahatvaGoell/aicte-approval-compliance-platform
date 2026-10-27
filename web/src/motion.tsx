import { useIsFetching, useIsMutating } from '@tanstack/react-query';
import Lenis from 'lenis';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';

// Presentation-only helpers: intro screen, loading bar, theme toggle, smooth scrolling and icons.
// Everything here respects prefers-reduced-motion and works without browser storage.

const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function readStore(store: 'local' | 'session', key: string) {
  try { return (store === 'local' ? localStorage : sessionStorage).getItem(key); } catch { return null; }
}
function writeStore(store: 'local' | 'session', key: string, value: string) {
  try { (store === 'local' ? localStorage : sessionStorage).setItem(key, value); } catch { /* storage unavailable */ }
}

/** Lenis smooth scrolling for the window; skipped when the user prefers reduced motion. */
export function useSmoothScroll() {
  useEffect(() => {
    if (reducedMotion()) return;
    const lenis = new Lenis({ duration: 1.1, easing: (t) => 1 - Math.pow(1 - t, 4), smoothWheel: true });
    let frame = 0;
    const raf = (time: number) => { lenis.raf(time); frame = requestAnimationFrame(raf); };
    frame = requestAnimationFrame(raf);
    return () => { cancelAnimationFrame(frame); lenis.destroy(); };
  }, []);
}

/** Brand intro shown once per browser session. Click to skip. */
export function Intro() {
  const [phase, setPhase] = useState<'show' | 'leave' | 'gone'>(() =>
    readStore('session', 'intro-seen') || reducedMotion() ? 'gone' : 'show');

  useEffect(() => {
    if (phase !== 'show') return;
    writeStore('session', 'intro-seen', '1');
    const leave = setTimeout(() => setPhase('leave'), 250);
    return () => clearTimeout(leave);
  }, [phase]);

  useEffect(() => {
    if (phase !== 'leave') return;
    const t = setTimeout(() => setPhase('gone'), 250);
    return () => clearTimeout(t);
  }, [phase]);

  if (phase === 'gone') return null;
  const word = 'AICTE';
  return (
    <div className={`intro ${phase === 'leave' ? 'leave' : ''}`} onClick={() => setPhase('leave')} aria-hidden="true">
      <div className="intro-inner">
        <div className="intro-word">
          {word.split('').map((c, i) => <span key={i} style={{ animationDelay: `${i * 55}ms` }}>{c}</span>)}
          <span style={{ animationDelay: `${word.length * 55}ms` }}><em>.</em></span>
        </div>

      </div>
    </div>
  );
}

/** Thin bar along the top while any query or mutation is in flight. */
export function ProgressBar() {
  const busy = useIsFetching() + useIsMutating() > 0;
  const [state, setState] = useState<'idle' | 'on' | 'off'>('idle');
  useEffect(() => {
    if (busy) { setState('on'); return; }
    setState((s) => (s === 'on' ? 'off' : s));
  }, [busy]);
  return <div className={`progress ${state === 'idle' ? '' : state}`} aria-hidden="true"><i /></div>;
}

type Theme = 'light' | 'dark';
function currentTheme(): Theme {
  const set = document.documentElement.dataset.theme;
  if (set === 'light' || set === 'dark') return set;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** Applies the saved theme before first paint; called from main.tsx. */
export function applySavedTheme() {
  const saved = readStore('local', 'theme');
  if (saved === 'light' || saved === 'dark') document.documentElement.dataset.theme = saved;
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(currentTheme);
  function toggle() {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    writeStore('local', 'theme', next);
    setTheme(next);
  }
  return (
    <button className="icon" onClick={toggle} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`} title="Switch theme">
      {theme === 'dark' ? <Icon name="sun" /> : <Icon name="moon" />}
    </button>
  );
}

/** Moves a highlight behind the active link of a nav container. */
export function useNavIndicator(navRef: RefObject<HTMLElement>, indicatorRef: RefObject<HTMLElement>, dep: unknown) {
  const first = useRef(true);
  useLayoutEffect(() => {
    const nav = navRef.current;
    const ind = indicatorRef.current;
    if (!nav || !ind) return;
    const place = () => {
      const active = nav.querySelector<HTMLElement>('a.active');
      if (!active) { ind.style.opacity = '0'; return; }
      if (first.current) { ind.style.transition = 'none'; first.current = false; requestAnimationFrame(() => { ind.style.transition = ''; }); }
      ind.style.opacity = '1';
      ind.style.height = `${active.offsetHeight}px`;
      ind.style.width = `${active.offsetWidth}px`;
      ind.style.transform = `translate(${active.offsetLeft}px, ${active.offsetTop}px)`;
    };
    place();
    // Web fonts can change link heights after first paint; measure again whenever the nav resizes.
    document.fonts?.ready.then(place);
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(place) : null;
    observer?.observe(nav);
    window.addEventListener('resize', place);
    return () => { observer?.disconnect(); window.removeEventListener('resize', place); };
  }, [navRef, indicatorRef, dep]);
}

const PATHS: Record<string, ReactNode> = {
  home: <><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V21h14V9.5" /><path d="M10 21v-6h4v6" /></>,
  inbox: <><path d="M3 13h5l1.5 3h5L16 13h5" /><path d="M5.5 5h13L21 13v6H3v-6z" /></>,
  folder: <><path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2.5h8.5A1.5 1.5 0 0 1 21 9v9.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z" /></>,
  plus: <><path d="M12 5v14M5 12h14" /></>,
  shield: <><path d="M12 3 4.5 6v6c0 4.5 3.2 7.8 7.5 9 4.3-1.2 7.5-4.5 7.5-9V6z" /><path d="m9 12 2 2 4-4" /></>,
  building: <><path d="M4 21V5l8-2v18" /><path d="M12 8h8v13" /><path d="M7.5 8h1M7.5 12h1M7.5 16h1M15.5 12h1M15.5 16h1" /></>,
  map: <><path d="M9 4 3.5 6v14L9 18l6 2 5.5-2V4L15 6z" /><path d="M9 4v14M15 6v14" /></>,
  layers: <><path d="m12 3 9 5-9 5-9-5z" /><path d="m3 13 9 5 9-5" /></>,
  users: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.6-3.4 3.2-5.5 6.5-5.5s5.9 2.1 6.5 5.5" /><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.8c1.9.8 3.1 2.6 3.5 5.2" /></>,
  gavel: <><path d="m14 4 6 6" /><path d="m11.5 6.5 6 6" /><path d="m12.75 5.25-5 5 6 6 5-5" /><path d="M10 13 3.5 19.5" /><path d="M13 21h8" /></>,
  sliders: <><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0" /><circle cx="16" cy="6" r="2" /><circle cx="10" cy="12" r="2" /><circle cx="18" cy="18" r="2" /></>,
  cog: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z" /></>,
  eye: <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>,
  bell: <><path d="M6 9a6 6 0 0 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9z" /><path d="M10 20a2 2 0 0 0 4 0" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M7 3v4M17 3v4M3 11h18M7 15h3M14 15h3" /></>,
  pulse: <><path d="M3 12h4l2-6 4 12 2-6h6" /></>,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
  moon: <><path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z" /></>,
  logout: <><path d="M15 4h3.5A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5H15" /><path d="M10 16l-4-4 4-4M6 12h10" /></>,
  chevron: <path d="m8 10 4 4 4-4" />,
  menu: <path d="M4 6h16M4 12h16M4 18h16" />,
  arrow: <><path d="M4 12h16M14 6l6 6-6 6" /></>,
  check: <path d="m5 12 4 4L19 6" />,
  minus: <path d="M7 12h10" />,
  search: <><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4.5 4.5" /></>,
  document: <><path d="M6 3h8l4 4v14H6zM14 3v5h4M9 12h6M9 16h6" /></>,
};

export function Icon({ name }: { name: keyof typeof PATHS | string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {PATHS[name] ?? PATHS.layers}
    </svg>
  );
}
