// ==========================================================================
// Riser - Copyright (c) 2026 Squarebit LLC. All rights reserved.
//
// A side panel that can be resized and folded away.
//
// This is deliberately NOT a docking system. Riser is a consumer product, and
// drag-to-dock asks someone to arrange a workspace before they can do the
// thing they came to do - it is a power-user affordance that trades a little
// flexibility for a lot of friction, and every phone app worth copying has
// none of it.
//
// What people actually want from "let me move the panels" is nearly always one
// of two things: more room for the character, or a panel out of the way. Both
// are answered by resizing and collapsing, neither of which can leave the
// layout in a state the user cannot get out of.
//
// Collapsed, the panel becomes a labelled rail rather than vanishing. A panel
// that disappears completely is a panel the user cannot find again.
// ==========================================================================

import React, { useCallback, useEffect, useRef } from 'react';
import { Icon, type IconName } from './Icon';

export interface SidePanelProps {
  side: 'left' | 'right';
  title: string;
  icon: IconName;
  width: number;
  onWidthChange: (width: number) => void;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  minWidth?: number;
  maxWidth?: number;
  /** Shown in the header, to the right of the title. */
  headerAccessory?: React.ReactNode;
  children: React.ReactNode;
}

export function SidePanel({
  side,
  title,
  icon,
  width,
  onWidthChange,
  collapsed,
  onCollapsedChange,
  minWidth = 200,
  maxWidth = 480,
  headerAccessory,
  children
}: SidePanelProps): JSX.Element {
  if (collapsed) {
    return (
      <button
        type="button"
        onClick={() => onCollapsedChange(false)}
        title={`Show ${title}`}
        aria-label={`Show ${title}`}
        data-testid={`expand-${side}-panel`}
        className={`group flex w-9 shrink-0 flex-col items-center gap-3 bg-panel-light py-3 text-ink-faint transition-colors hover:text-ink ${
          side === 'left' ? 'border-r' : 'border-l'
        } border-edge`}
      >
        <Icon name={icon} size={17} />
        <span
          className="whitespace-nowrap text-[11px] font-medium tracking-wide"
          style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}
        >
          {title}
        </span>
      </button>
    );
  }

  const resizer = (
    <Resizer
      side={side}
      width={width}
      min={minWidth}
      max={maxWidth}
      onWidthChange={onWidthChange}
      onCollapse={() => onCollapsedChange(true)}
    />
  );

  return (
    <>
      {side === 'right' && resizer}
      <aside
        style={{ width }}
        aria-label={title}
        className="flex min-h-0 shrink-0 flex-col bg-panel-light"
      >
        <header className="flex h-9 shrink-0 items-center gap-2 px-2.5">
          <Icon name={icon} size={15} className="shrink-0 text-ink-faint" />
          <h2 className="min-w-0 flex-1 truncate text-[12px] font-semibold uppercase tracking-wide text-ink-dim">
            {title}
          </h2>
          {headerAccessory}
          <button
            type="button"
            onClick={() => onCollapsedChange(true)}
            title={`Hide ${title}`}
            aria-label={`Hide ${title}`}
            data-testid={`collapse-${side}-panel`}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-control text-ink-faint transition-colors hover:bg-panel-lighter hover:text-ink"
          >
            <Icon name={side === 'left' ? 'chevronLeft' : 'chevronRight'} size={15} />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </aside>
      {side === 'left' && resizer}
    </>
  );
}

/**
 * The grabbable strip between a panel and the viewport.
 *
 * Four pixels wide but with a wider invisible grab area, because a 4px target
 * is a frustrating one and a 12px one that looks like 4px is not.
 *
 * Pointer capture is what makes the drag survive the pointer moving over the
 * WebGL canvas. Without it the viewport swallows the move events and the panel
 * stops following the cursor halfway through - which reads as the app being
 * broken rather than as an event-routing detail.
 */
function Resizer({
  side,
  width,
  min,
  max,
  onWidthChange,
  onCollapse
}: {
  side: 'left' | 'right';
  width: number;
  min: number;
  max: number;
  onWidthChange: (width: number) => void;
  onCollapse: () => void;
}): JSX.Element {
  const dragging = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);
  const ref = useRef<HTMLDivElement>(null);

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      dragging.current = true;
      startX.current = event.clientX;
      startWidth.current = width;
      ref.current?.setPointerCapture(event.pointerId);
      ref.current?.setAttribute('data-dragging', 'true');
      document.body.style.cursor = 'col-resize';
    },
    [width]
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!dragging.current) return;
      const delta = event.clientX - startX.current;
      const next = startWidth.current + (side === 'left' ? delta : -delta);
      // Dragging a panel shut is the fastest way to get it out of the way, and
      // people try it whether or not it is offered.
      if (next < min * 0.6) {
        onCollapse();
        dragging.current = false;
        return;
      }
      onWidthChange(Math.round(Math.min(Math.max(next, min), max)));
    },
    [side, min, max, onWidthChange, onCollapse]
  );

  const end = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    dragging.current = false;
    ref.current?.releasePointerCapture?.(event.pointerId);
    ref.current?.removeAttribute('data-dragging');
    document.body.style.cursor = '';
  }, []);

  // Keyboard resizing, because a drag-only control is unusable without a mouse.
  const onKeyDown = (event: React.KeyboardEvent): void => {
    const step = event.shiftKey ? 40 : 10;
    const grow = side === 'left' ? 'ArrowRight' : 'ArrowLeft';
    const shrink = side === 'left' ? 'ArrowLeft' : 'ArrowRight';
    if (event.key === grow) onWidthChange(Math.min(width + step, max));
    else if (event.key === shrink) onWidthChange(Math.max(width - step, min));
    else return;
    event.preventDefault();
  };

  return (
    <div
      ref={ref}
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize panel"
      aria-valuenow={width}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      onKeyDown={onKeyDown}
      onDoubleClick={onCollapse}
      className="rs-splitter group w-px cursor-col-resize"
    >
      {/* The real grab area, wider than the line it draws. */}
      <span className="absolute -left-1.5 -right-1.5 top-0 bottom-0 block" />
    </div>
  );
}

/** Keeps a pointer drag from selecting text across the whole document. */
export function useDragCursorReset(): void {
  useEffect(() => {
    const clear = (): void => {
      document.body.style.cursor = '';
    };
    window.addEventListener('pointerup', clear);
    return () => window.removeEventListener('pointerup', clear);
  }, []);
}
