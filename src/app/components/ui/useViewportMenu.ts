// ==========================================================================
// Riser - Copyright (c) 2026 Squarebit LLC. All rights reserved.
//
// Opening the viewport menu without fighting the camera.
//
// The viewport uses the right button for two different things: dragging it
// pans the camera, and clicking it opens a menu. Those are not in conflict -
// every 3D application does both - but they have to be told apart, and
// `contextmenu` alone cannot tell them apart because it fires at the end of a
// drag exactly as it does after a click.
//
// The result was a menu appearing every time the user finished panning, over
// the very thing they had just moved into view.
//
// So the press is remembered and the release is measured against it. A menu
// opens when the pointer stayed put; a pan swallows it. The threshold is in
// pixels rather than time because that is what distinguishes the gestures -
// someone can hold the button still for a second and still mean "menu", and
// can flick a fast pan in under a hundred milliseconds.
//
// THE MENU OPENS ON POINTERUP, NOT ON `contextmenu`, and that is not a
// preference. WHEN `contextmenu` fires is platform-specific: Windows raises it
// when the right button is RELEASED, X11 raises it when the button is PRESSED.
// Deciding there meant the check worked perfectly on Windows and failed on
// Linux, where the event arrives before the drag it is supposed to notice -
// caught by CI, which runs Linux, after passing locally every time.
//
// `pointerup` happens after the movement on every platform, which is the whole
// requirement. `contextmenu` is still handled, but only to suppress the
// browser's own menu.
//
// TOUCH. There is no right button on an iPad, so a long press opens the menu
// instead - the platform convention, and the same gesture that opens a context
// menu everywhere else on the device. It is cancelled by movement, so a
// one-finger orbit never triggers it. Pinch and two-finger gestures are left
// entirely alone: they belong to the camera, and a menu appearing mid-pinch
// would be worse than having no menu at all.
// ==========================================================================

import { useCallback, useEffect, useRef, useState } from 'react';

/** Pointer travel, in CSS pixels, beyond which a press was a drag. */
const DRAG_SLOP = 6;
/** How long a touch must be held, in milliseconds, to mean "menu". */
const LONG_PRESS_MS = 500;

export interface ViewportMenuState {
  /** Where the menu should appear, or null when closed. */
  point: { x: number; y: number } | null;
  close: () => void;
  /** Spread onto the element that owns the viewport. */
  props: {
    onPointerDown: (event: React.PointerEvent) => void;
    onPointerMove: (event: React.PointerEvent) => void;
    onPointerUp: (event: React.PointerEvent) => void;
    onPointerCancel: (event: React.PointerEvent) => void;
    onContextMenu: (event: React.MouseEvent) => void;
  };
}

export function useViewportMenu(): ViewportMenuState {
  const [point, setPoint] = useState<{ x: number; y: number } | null>(null);

  const origin = useRef<{ x: number; y: number } | null>(null);
  const moved = useRef(false);
  const longPress = useRef<number | null>(null);
  const openedByTouch = useRef(false);

  const cancelLongPress = useCallback(() => {
    if (longPress.current !== null) {
      window.clearTimeout(longPress.current);
      longPress.current = null;
    }
  }, []);

  useEffect(() => cancelLongPress, [cancelLongPress]);

  const onPointerDown = useCallback(
    (event: React.PointerEvent) => {
      origin.current = { x: event.clientX, y: event.clientY };
      moved.current = false;
      openedByTouch.current = false;
      cancelLongPress();

      // Long press, for a device with no right button. Only ever a single
      // finger: a second one means the camera is being pinched or panned.
      if (event.pointerType === 'touch' && event.isPrimary) {
        const { clientX, clientY } = event;
        longPress.current = window.setTimeout(() => {
          if (moved.current) return;
          openedByTouch.current = true;
          setPoint({ x: clientX, y: clientY });
        }, LONG_PRESS_MS);
      }
    },
    [cancelLongPress]
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent) => {
      const start = origin.current;
      if (!start) return;
      if (
        Math.abs(event.clientX - start.x) > DRAG_SLOP ||
        Math.abs(event.clientY - start.y) > DRAG_SLOP
      ) {
        moved.current = true;
        cancelLongPress();
      }
    },
    [cancelLongPress]
  );

  const onPointerUp = useCallback(
    (event: React.PointerEvent) => {
      cancelLongPress();
      const wasDrag = moved.current;
      const openedAlready = openedByTouch.current;
      origin.current = null;

      // Right button, released where it was pressed: a menu request. A drag
      // panned the camera and is not one, and a long press has already opened
      // the menu itself.
      if (event.button === 2 && !wasDrag && !openedAlready) {
        setPoint({ x: event.clientX, y: event.clientY });
      }
    },
    [cancelLongPress]
  );

  const onPointerCancel = useCallback(() => {
    cancelLongPress();
    origin.current = null;
  }, [cancelLongPress]);

  const onContextMenu = useCallback((event: React.MouseEvent) => {
    // Suppression only. The browser's own menu over a 3D canvas offers nothing
    // but "save image", and WHEN this fires differs by platform - see above.
    event.preventDefault();
  }, []);

  return {
    point,
    close: useCallback(() => setPoint(null), []),
    props: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel,
      onContextMenu
    }
  };
}
