// ==========================================================================
// Riser - Copyright (c) 2026 Squarebit LLC. All rights reserved.
//
// The icon set.
//
// Drawn here rather than pulled from a package. The set is small and unlikely
// to grow much, an icon library is a dependency whose whole value is breadth
// we do not need, and inlining means the icons ship in the same bundle as the
// code that uses them - no flash of missing glyph on first paint.
//
// All of them are 24-unit stroked outlines on `currentColor`, so an icon takes
// the colour of whatever it sits in and a disabled button dims its icon for
// free. Stroke rather than fill because a consistent stroke weight is what
// makes a mixed set look like a set.
//
// An icon is never the only thing that says what a control does unless the
// control is completely conventional (undo, close, search). Everything else
// carries a visible label or, at minimum, a tooltip AND an accessible name -
// "anyone should know what to do" does not survive a wall of mystery glyphs.
// ==========================================================================

import type { SVGProps } from 'react';

export type IconName =
  | 'marker'
  | 'curve'
  | 'sparkles'
  | 'eye'
  | 'eyeOff'
  | 'cube'
  | 'bone'
  | 'grid'
  | 'shading'
  | 'search'
  | 'chevronDown'
  | 'chevronRight'
  | 'chevronLeft'
  | 'check'
  | 'close'
  | 'plus'
  | 'trash'
  | 'undo'
  | 'redo'
  | 'frame'
  | 'upload'
  | 'download'
  | 'document'
  | 'folder'
  | 'save'
  | 'mirror'
  | 'layers'
  | 'help'
  | 'list'
  | 'guided'
  | 'next'
  | 'skip'
  | 'warning'
  | 'info'
  | 'sliders'
  | 'panelLeft'
  | 'panelRight'
  | 'more';

interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: IconName;
  /** Pixel size. 16 for inline, 18 in bars, 20 for a primary action. */
  size?: number;
}

export function Icon({ name, size = 16, ...rest }: IconProps): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      // Decorative by default: the control around it carries the name, and a
      // screen reader announcing "graphic" between every label is noise.
      aria-hidden="true"
      focusable="false"
      shapeRendering="geometricPrecision"
      {...rest}
    >
      {PATHS[name]}
    </svg>
  );
}

const PATHS: Record<IconName, JSX.Element> = {
  marker: (
    <>
      <path d="M12 21s7-5.686 7-11a7 7 0 1 0-14 0c0 5.314 7 11 7 11Z" />
      <circle cx="12" cy="10" r="2.5" />
    </>
  ),
  curve: (
    <>
      <path d="M3 17c4.5 0 4.5-10 9-10s4.5 6 9 6" />
      <circle cx="3" cy="17" r="1.6" />
      <circle cx="12" cy="7" r="1.6" />
      <circle cx="21" cy="13" r="1.6" />
    </>
  ),
  sparkles: (
    <>
      <path d="M12 3.5 13.7 8.3 18.5 10 13.7 11.7 12 16.5 10.3 11.7 5.5 10 10.3 8.3Z" />
      <path d="M18.5 16.5 19.2 18.3 21 19l-1.8.7-.7 1.8-.7-1.8L16 19l1.8-.7Z" />
    </>
  ),
  eye: (
    <>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  eyeOff: (
    <>
      <path d="M10.7 6.2A8.7 8.7 0 0 1 12 6c6 0 9.5 6 9.5 6a17 17 0 0 1-2.7 3.4" />
      <path d="M6.5 7.8A17 17 0 0 0 2.5 12S6 18 12 18a9 9 0 0 0 3.6-.75" />
      <path d="m3 3 18 18" />
    </>
  ),
  cube: (
    <>
      <path d="M12 2.8 20.5 7.4v9.2L12 21.2 3.5 16.6V7.4Z" />
      <path d="m3.5 7.4 8.5 4.6 8.5-4.6M12 12v9.2" />
    </>
  ),
  bone: (
    <>
      <path d="M7.5 16.5 16.5 7.5" />
      <circle cx="5.6" cy="18.4" r="2.6" />
      <circle cx="18.4" cy="5.6" r="2.6" />
      <circle cx="12" cy="12" r="1.4" />
    </>
  ),
  grid: (
    <>
      <path d="M3 9h18M3 15h18M9 3v18M15 3v18" />
      <rect x="3" y="3" width="18" height="18" rx="2" />
    </>
  ),
  shading: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 3a9 9 0 0 1 0 18Z" fill="currentColor" stroke="none" />
    </>
  ),
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m20 20-4.7-4.7" />
    </>
  ),
  chevronDown: <path d="m6 9.5 6 6 6-6" />,
  chevronRight: <path d="m9.5 6 6 6-6 6" />,
  chevronLeft: <path d="m14.5 6-6 6 6 6" />,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  plus: <path d="M12 5v14M5 12h14" />,
  trash: (
    <>
      <path d="M4 7h16M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7" />
      <path d="M6.5 7 7.4 19a1.6 1.6 0 0 0 1.6 1.5h6a1.6 1.6 0 0 0 1.6-1.5L17.5 7" />
    </>
  ),
  undo: (
    <>
      <path d="M4 9h9.5a5.5 5.5 0 0 1 0 11H8" />
      <path d="m8 4.5-4 4.5 4 4.5" />
    </>
  ),
  redo: (
    <>
      <path d="M20 9h-9.5a5.5 5.5 0 0 0 0 11H16" />
      <path d="m16 4.5 4 4.5-4 4.5" />
    </>
  ),
  frame: (
    <>
      <path d="M3 8.5V5a2 2 0 0 1 2-2h3.5M21 8.5V5a2 2 0 0 0-2-2h-3.5M3 15.5V19a2 2 0 0 0 2 2h3.5M21 15.5V19a2 2 0 0 1-2 2h-3.5" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  upload: (
    <>
      <path d="M12 16V4" />
      <path d="m7.5 8.5 4.5-4.5 4.5 4.5" />
      <path d="M4 15v3.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V15" />
    </>
  ),
  download: (
    <>
      <path d="M12 4v12" />
      <path d="m7.5 11.5 4.5 4.5 4.5-4.5" />
      <path d="M4 15v3.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V15" />
    </>
  ),
  document: (
    <>
      <path d="M13.5 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5Z" />
      <path d="M13.5 3v5.5H19" />
    </>
  ),
  folder: (
    <path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4l2 2.5h9A1.5 1.5 0 0 1 21 10v8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18Z" />
  ),
  save: (
    <>
      <path d="M5 4h11l3 3v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z" />
      <path d="M8 4v5h7V4M8 20v-5h8v5" />
    </>
  ),
  mirror: (
    <>
      <path d="M12 3v18" strokeDasharray="2 3" />
      <path d="M9 7 4 12l5 5ZM15 7l5 5-5 5Z" />
    </>
  ),
  layers: (
    <>
      <path d="m12 3 9 5-9 5-9-5Z" />
      <path d="m3 13 9 5 9-5" />
    </>
  ),
  help: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.6 9.3a2.5 2.5 0 1 1 3.3 2.4c-.6.2-.9.8-.9 1.4v.4" />
      <path d="M12 17.2h.01" strokeWidth="2.2" />
    </>
  ),
  list: <path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01" />,
  guided: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m10 8.5 6 3.5-6 3.5Z" />
    </>
  ),
  next: <path d="M5 12h13m-5-5 5 5-5 5" />,
  skip: <path d="M6 6v12M18 6v12M8 12h8m-3-3 3 3-3 3" />,
  warning: (
    <>
      <path d="M10.6 4.2 2.9 17.4A1.6 1.6 0 0 0 4.3 20h15.4a1.6 1.6 0 0 0 1.4-2.6L13.4 4.2a1.6 1.6 0 0 0-2.8 0Z" />
      <path d="M12 9.5v4M12 17h.01" strokeWidth="2.2" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5.5M12 7.8h.01" strokeWidth="2.2" />
    </>
  ),
  sliders: (
    <>
      <path d="M4 8h9M17 8h3M4 16h3M11 16h9" />
      <circle cx="15" cy="8" r="2" />
      <circle cx="9" cy="16" r="2" />
    </>
  ),
  panelLeft: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M9.5 4v16" />
    </>
  ),
  panelRight: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M14.5 4v16" />
    </>
  ),
  more: (
    <>
      <circle cx="5.5" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="18.5" cy="12" r="1.4" fill="currentColor" stroke="none" />
    </>
  )
};
