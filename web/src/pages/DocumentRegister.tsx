import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState, type FocusEvent, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { Icon } from '../motion';
import { DocStamp, formatDate, humanise, Status } from '../ui';

type Row = any;

const CARD_W = 328;
const GAP = 18;

/** Hover preview: one card that trails the pointer with a small easing step per frame. */
function PreviewCard({ row, on, cardRef }: { row: Row | null; on: boolean; cardRef: RefObject<HTMLDivElement> }) {
  // Only fields the list already returns, plus the existing case detail, read lazily and cached.
  const detail = useQuery({
    queryKey: ['case', row?.application_id],
    queryFn: () => api.get<any>(`/applications/${row!.application_id}`),
    enabled: on && !!row,
    staleTime: 60_000,
  });
  const doc = detail.data?.documents?.find((d: any) => d.id === row?.id);
  const state = row ? row.state ?? row.review_state : undefined;
  return (
    <div ref={cardRef} className={`dp ${on ? 'on' : ''}`} aria-hidden="true" style={{ width: CARD_W }}>
      {row && (
        <>
          <div className="dp-top">
            <div className="dp-sheet">
              <div className="dp-letterhead"><span>{humanise(row.document_type)}</span><span>v{row.version_no}</span></div>
              <div className="dp-lines" />
              <div className="dp-lines short" />
              <span className="dp-stamp"><DocStamp state={state} bottom={`Version ${row.version_no}`} size={46} /></span>
            </div>
            <div className="dp-title">
              <strong>{row.title}</strong>
              <span className="small muted">{humanise(row.document_type)} · <span className="mono">{row.app_no}</span></span>
            </div>
          </div>
          <dl className="dp-kv">
            <dt>State</dt><dd><Status value={state} /></dd>
            <dt>Versions</dt><dd className="num">{doc ? doc.versions.length : row.version_no}</dd>
            <dt>Received</dt><dd>{formatDate(row.received_at, false)}</dd>
            <dt>Visibility</dt><dd>{row.visibility === 'INTERNAL' ? 'Internal only' : 'Institution visible'}</dd>
            <dt>Valid through</dt>
            <dd className={doc?.verifiedValidThrough ? '' : 'muted'}>{doc?.verifiedValidThrough ? formatDate(doc.verifiedValidThrough, false) : detail.isLoading ? '…' : 'Not recorded'}</dd>
          </dl>
          <div className="dp-open">Open in case<Icon name="arrow" /></div>
        </>
      )}
    </div>
  );
}

function DocumentTable({ rows }: { rows: Row[] }) {
  const navigate = useNavigate();
  const cardRef = useRef<HTMLDivElement>(null);
  const target = useRef({ x: 0, y: 0 });
  const pos = useRef({ x: 0, y: 0 });
  const raf = useRef(0);
  const lastRow = useRef<Row | null>(null);
  const [hover, setHover] = useState<Row | null>(null);
  const reduced = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const apply = () => { if (cardRef.current) cardRef.current.style.transform = `translate3d(${pos.current.x}px, ${pos.current.y}px, 0)`; };
  const step = () => {
    const dx = target.current.x - pos.current.x, dy = target.current.y - pos.current.y;
    pos.current = { x: pos.current.x + dx * 0.2, y: pos.current.y + dy * 0.2 };
    apply();
    raf.current = Math.abs(dx) + Math.abs(dy) > 0.6 ? requestAnimationFrame(step) : 0;
  };
  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  /** Where the card sits for a given anchor point, flipped when it would leave the screen. */
  function aim(x: number, y: number) {
    const h = cardRef.current?.offsetHeight ?? 250;
    let tx = x + GAP, ty = y + GAP;
    if (tx + CARD_W > window.innerWidth - 8) tx = x - GAP - CARD_W;
    if (ty + h > window.innerHeight - 8) ty = y - GAP - h;
    return { x: Math.max(8, tx), y: Math.max(8, ty) };
  }
  function show(row: Row, x: number, y: number, follow: boolean) {
    lastRow.current = row;
    const t = aim(x, y);
    target.current = t;
    if (!hover || !follow) { pos.current = t; apply(); }
    setHover(row);
    if (follow && !raf.current) raf.current = requestAnimationFrame(step);
  }
  const onRowEnter = (row: Row) => (e: ReactPointerEvent) => { if (e.pointerType === 'mouse') show(row, e.clientX, e.clientY, !reduced); };
  const onRowMove = (row: Row) => (e: ReactPointerEvent) => {
    if (e.pointerType !== 'mouse' || reduced) return;
    target.current = aim(e.clientX, e.clientY);
    if (!raf.current) raf.current = requestAnimationFrame(step);
    if (hover?.id !== row.id) { lastRow.current = row; setHover(row); }
  };
  // Keyboard: the card sits next to the focused row instead of following a pointer.
  const onRowFocus = (row: Row) => (e: FocusEvent<HTMLTableRowElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    show(row, r.left + 80, r.bottom - GAP + 6, false);
  };

  return (
    <>
      <div className="table-wrap doc-table" onPointerLeave={() => setHover(null)} onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setHover(null); }}>
        <table>
          <thead>
            <tr><th className="num hide-sm">#</th><th>Document</th><th className="hide-sm">Case</th><th className="hide-sm">Type</th><th className="num">Version</th><th className="hide-sm">Received</th><th>Status</th></tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.id} tabIndex={-1} onPointerEnter={onRowEnter(r)} onPointerMove={onRowMove(r)} onFocus={onRowFocus(r)}
                onClick={(e) => { if (!(e.target as HTMLElement).closest('a')) navigate(`/applications/${r.application_id}#document-${r.id}`); }}>
                <td className="num hide-sm doc-no">{i + 1}</td>
                <td>
                  <Link className="doc-title" to={`/applications/${r.application_id}#document-${r.id}`} aria-label={`${r.title}, version ${r.version_no}, ${r.app_no}`}>{r.title}</Link>
                  <span className="mono doc-case-sm">{r.app_no}</span>
                </td>
                <td className="hide-sm"><span className="mono">{r.app_no}</span></td>
                <td className="hide-sm">{humanise(r.document_type)}</td>
                <td className="num"><span className="mono">v{r.version_no}</span></td>
                <td className="hide-sm doc-date">{formatDate(r.received_at, false)}</td>
                <td><Status value={r.state ?? r.review_state} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* In the body: page sections animate with a transform, which would otherwise anchor a fixed card to them. */}
      {createPortal(<PreviewCard row={hover ?? lastRow.current} on={!!hover} cardRef={cardRef} />, document.body)}
    </>
  );
}

function DocumentSheets({ rows }: { rows: Row[] }) {
  return (
    <div className="document-library">
      {rows.map((r) => (
        <Link className={`sheet ${r.version_no > 1 ? 'stacked' : ''}`} key={r.id} to={`/applications/${r.application_id}#document-${r.id}`} aria-label={`${r.title}, version ${r.version_no}, ${r.app_no}`}>
          <div className="sheet-paper">
            <div className="sheet-letterhead"><span>{humanise(r.document_type)}</span><span>v{r.version_no}</span></div>
            <h2>{r.title}</h2>
            <div className="sheet-lines" aria-hidden="true" />
            <div className="sheet-foot"><span className="mono">{r.app_no}</span><span>{r.visibility === 'INTERNAL' ? 'Internal only' : 'Institution visible'} · received {formatDate(r.received_at, false)}</span><span><Status value={r.state ?? r.review_state} /></span></div>
          </div>
          <div className="sheet-stamp"><DocStamp state={r.state ?? r.review_state} bottom={`Version ${r.version_no}`} size={84} /></div>
        </Link>
      ))}
    </div>
  );
}

/** The document register: a compact table by default, the paper-sheet pile as a second view. */
export function DocumentViews({ rows }: { rows: Row[] }) {
  const [view, setView] = useState<'table' | 'sheets'>('table');
  return (
    <>
      <div className="doc-views">
        <div className="seg" role="group" aria-label="Layout">
          <button type="button" aria-pressed={view === 'table'} onClick={() => setView('table')}>Table</button>
          <button type="button" aria-pressed={view === 'sheets'} onClick={() => setView('sheets')}>Sheets</button>
        </div>
      </div>
      {view === 'table' ? <DocumentTable rows={rows} /> : <DocumentSheets rows={rows} />}
    </>
  );
}
