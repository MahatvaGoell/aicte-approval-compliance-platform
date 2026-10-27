import { useEffect, useRef, useState, type FocusEvent, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';

export const CARD_W = 328;
const GAP = 18;

/**
 * One preview card that trails the pointer with a small easing step per frame, shared by the registers.
 * Under reduced motion, and for keyboard focus, the card sits beside the row instead of following.
 */
export function useTrailingCard<T extends { id: string }>() {
  const cardRef = useRef<HTMLDivElement>(null);
  const target = useRef({ x: 0, y: 0 });
  const pos = useRef({ x: 0, y: 0 });
  const raf = useRef(0);
  const last = useRef<T | null>(null);
  const [hover, setHover] = useState<T | null>(null);
  const reduced = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const apply = () => { if (cardRef.current) cardRef.current.style.transform = `translate3d(${pos.current.x}px, ${pos.current.y}px, 0)`; };
  const step = () => {
    const dx = target.current.x - pos.current.x, dy = target.current.y - pos.current.y;
    pos.current = { x: pos.current.x + dx * 0.2, y: pos.current.y + dy * 0.2 };
    apply();
    raf.current = Math.abs(dx) + Math.abs(dy) > 0.6 ? requestAnimationFrame(step) : 0;
  };
  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  /** Where the card sits for an anchor point, flipped when it would leave the screen. */
  function aim(x: number, y: number) {
    const h = cardRef.current?.offsetHeight ?? 250;
    let tx = x + GAP, ty = y + GAP;
    if (tx + CARD_W > window.innerWidth - 8) tx = x - GAP - CARD_W;
    if (ty + h > window.innerHeight - 8) ty = y - GAP - h;
    return { x: Math.max(8, tx), y: Math.max(8, ty) };
  }
  function show(row: T, x: number, y: number, follow: boolean) {
    last.current = row;
    const t = aim(x, y);
    target.current = t;
    if (!hover || !follow) { pos.current = t; apply(); }
    setHover(row);
    if (follow && !raf.current) raf.current = requestAnimationFrame(step);
  }

  return {
    cardRef,
    /** The row being previewed now, and the last one (kept so the card can fade out with its content). */
    active: hover,
    shown: hover ?? last.current,
    /** Spread onto each row. */
    rowProps: (row: T) => ({
      onPointerEnter: (e: ReactPointerEvent) => { if (e.pointerType === 'mouse') show(row, e.clientX, e.clientY, !reduced); },
      onPointerMove: (e: ReactPointerEvent) => {
        if (e.pointerType !== 'mouse' || reduced) return;
        target.current = aim(e.clientX, e.clientY);
        if (!raf.current) raf.current = requestAnimationFrame(step);
        if (hover?.id !== row.id) { last.current = row; setHover(row); }
      },
      onFocus: (e: FocusEvent<HTMLElement>) => {
        const r = e.currentTarget.getBoundingClientRect();
        show(row, r.left + 80, r.bottom - GAP + 6, false);
      },
    }),
    /** Spread onto the element that wraps all rows. */
    wrapProps: {
      onPointerLeave: () => setHover(null),
      onBlur: (e: FocusEvent<HTMLElement>) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setHover(null); },
    },
  };
}

/** The floating card itself. It lives in the body: page sections animate with a transform, which would anchor a fixed card to them. */
export function TrailingCard({ cardRef, on, children }: { cardRef: RefObject<HTMLDivElement>; on: boolean; children: ReactNode }) {
  return createPortal(
    <div ref={cardRef} className={`dp ${on ? 'on' : ''}`} aria-hidden="true" style={{ width: CARD_W }}>{children}</div>,
    document.body,
  );
}
