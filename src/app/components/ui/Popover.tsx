// ==========================================================================
// Riser - Copyright (c) 2026 Squarebit LLC. All rights reserved.
//
// The floating layer: dropdowns, menus and context menus all sit on this.
//
// Positioned `fixed` against the anchor's viewport rectangle rather than
// absolutely inside it. The panels scroll and clip their overflow, and an
// absolutely positioned menu inside a scrolling panel gets cut in half - the
// classic "my dropdown is behind the sidebar" bug. Fixed coordinates cost a
// measurement and are simply correct.
//
// It also flips: a menu near the right edge opens leftwards, and one near the
// bottom opens upwards, so a control in a corner is not a control with an
// unreachable menu.
// ==========================================================================

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/** Where the floating panel is placed relative to its anchor. */
export type PopoverAlign = 'start' | 'end';

export interface PopoverProps {
  /** The element to position against. A point, for a context menu. */
  anchor: HTMLElement | { x: number; y: number };
  open: boolean;
  onClose: () => void;
  align?: PopoverAlign;
  /** Gap between anchor and panel, in pixels. */
  offset?: number;
  className?: string;
  children: React.ReactNode;
  /** Labels the panel for assistive technology. */
  'aria-label'?: string;
  role?: string;
}

const MARGIN = 8;

export function Popover({
  anchor,
  open,
  onClose,
  align = 'start',
  offset = 6,
  className = '',
  children,
  role = 'menu',
  ...aria
}: PopoverProps): JSX.Element | null {
  const panelRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);

  // Measured after paint and before the browser shows it, so the panel never
  // appears in the wrong place for a frame and then jumps.
  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }
    const panel = panelRef.current;
    if (!panel) return;

    const { width, height } = panel.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    const rect =
      anchor instanceof HTMLElement
        ? anchor.getBoundingClientRect()
        : ({
            left: anchor.x,
            right: anchor.x,
            top: anchor.y,
            bottom: anchor.y,
            width: 0,
            height: 0
          } as DOMRect);

    let left = align === 'end' ? rect.right - width : rect.left;
    let top = rect.bottom + offset;

    // Flip up when there is no room below but there is above.
    if (top + height > vh - MARGIN && rect.top - height - offset > MARGIN) {
      top = rect.top - height - offset;
    }
    // Clamp rather than flip horizontally: a menu that slides to stay on
    // screen still points at its control, where a flipped one may not.
    left = Math.min(Math.max(MARGIN, left), vw - width - MARGIN);
    top = Math.min(Math.max(MARGIN, top), vh - height - MARGIN);

    setPosition({ left, top });
  }, [open, anchor, align, offset]);

  // Dismissal. `pointerdown` rather than `click`, so the press that closes a
  // menu does not also land on whatever is underneath it.
  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target)) return;
      if (anchor instanceof HTMLElement && anchor.contains(target)) return;
      onClose();
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    // Capture, so a scroll inside a panel closes the menu rather than leaving
    // it floating over unrelated content.
    const onScroll = (event: Event): void => {
      if (panelRef.current?.contains(event.target as Node)) return;
      onClose();
    };

    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onClose);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onClose);
    };
  }, [open, onClose, anchor]);

  if (!open) return null;

  return createPortal(
    <div
      ref={panelRef}
      role={role}
      {...aria}
      style={{
        position: 'fixed',
        left: position?.left ?? -9999,
        top: position?.top ?? -9999,
        // Hidden until measured, so it is never seen at the wrong coordinates.
        visibility: position ? 'visible' : 'hidden'
      }}
      className={`z-50 min-w-[13rem] animate-pop-in rounded-popover border border-edge bg-panel-light p-1 shadow-popover ${className}`}
    >
      {children}
    </div>,
    document.body
  );
}

/**
 * Open/close state for one popover, with the anchor ref it needs.
 *
 * A hook rather than a component so the trigger can be any control - a menu
 * bar item, an icon button, a right-click on the viewport.
 */
export function usePopover<T extends HTMLElement = HTMLButtonElement>(): {
  ref: React.RefObject<T>;
  open: boolean;
  setOpen: (open: boolean) => void;
  toggle: () => void;
  close: () => void;
} {
  const ref = useRef<T>(null);
  const [open, setOpen] = useState(false);
  return {
    ref,
    open,
    setOpen,
    toggle: () => setOpen((v) => !v),
    close: () => setOpen(false)
  };
}
