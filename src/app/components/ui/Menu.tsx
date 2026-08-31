// ==========================================================================
// Riser - Copyright (c) 2026 Squarebit LLC. All rights reserved.
//
// Menus: the bar at the top, the dropdowns hanging off it, and right-click
// menus in the viewport and the lists.
//
// One implementation for all three, because they are the same thing pointed at
// from different places, and because a right-click menu that behaves subtly
// differently from the File menu is a small, constant papercut.
//
// Two conventions worth stating, both from desktop applications and both
// things people expect without being able to name:
//
//   * Once one menu in the bar is open, HOVERING another switches to it. A
//     menu bar that makes you click twice feels broken even to someone who has
//     never thought about menu bars.
//   * A disabled item stays visible. Hiding what you cannot do right now means
//     the user cannot learn that it exists, and menus are where features are
//     discovered.
// ==========================================================================

import React, { createContext, useCallback, useContext, useRef, useState } from 'react';
import { Icon, type IconName } from './Icon';
import { Popover, type PopoverAlign } from './Popover';

// -------------------------------------------------------------------------
// Items
// -------------------------------------------------------------------------

export interface MenuItemProps {
  label: string;
  icon?: IconName;
  /** Right-aligned shortcut hint, e.g. "Ctrl+S". Display only. */
  shortcut?: string;
  onSelect?: () => void;
  disabled?: boolean;
  /** Renders a tick and sets aria-checked, for toggles. */
  checked?: boolean;
  danger?: boolean;
  /** Secondary line under the label, for anything that needs a word of help. */
  description?: string;
  'data-testid'?: string;
}

export function MenuItem({
  label,
  icon,
  shortcut,
  onSelect,
  disabled,
  checked,
  danger,
  description,
  ...rest
}: MenuItemProps): JSX.Element {
  const close = useContext(MenuCloseContext);
  const checkable = checked !== undefined;

  return (
    <button
      type="button"
      role={checkable ? 'menuitemcheckbox' : 'menuitem'}
      aria-checked={checkable ? checked : undefined}
      disabled={disabled}
      onClick={() => {
        onSelect?.();
        close();
      }}
      className={`flex w-full items-center gap-2.5 rounded-control px-2 py-1.5 text-left transition-colors disabled:pointer-events-none disabled:opacity-35 ${
        danger
          ? 'text-danger hover:bg-danger-soft'
          : 'text-ink-dim hover:bg-panel-lighter hover:text-ink'
      }`}
      {...rest}
    >
      <span className="flex h-4 w-4 shrink-0 items-center justify-center">
        {checkable ? (
          checked ? (
            <Icon name="check" size={15} className="text-accent" />
          ) : null
        ) : icon ? (
          <Icon name={icon} size={15} />
        ) : null}
      </span>

      <span className="min-w-0 flex-1">
        <span className="block truncate">{label}</span>
        {description && (
          <span className="block truncate text-[11px] text-ink-faint">
            {description}
          </span>
        )}
      </span>

      {shortcut && (
        <span className="shrink-0 font-mono text-[11px] text-ink-faint">
          {shortcut}
        </span>
      )}
    </button>
  );
}

export function MenuSeparator(): JSX.Element {
  return <div role="separator" className="my-1 h-px bg-edge" />;
}

export function MenuLabel({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <div className="px-2 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-ink-faint">
      {children}
    </div>
  );
}

/** Lets an item close the menu it is in without being handed a callback. */
const MenuCloseContext = createContext<() => void>(() => {});

export function MenuCloseProvider({
  close,
  children
}: {
  close: () => void;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <MenuCloseContext.Provider value={close}>{children}</MenuCloseContext.Provider>
  );
}

// -------------------------------------------------------------------------
// A single dropdown, hung off any trigger
// -------------------------------------------------------------------------

export function DropdownMenu({
  trigger,
  children,
  align = 'start',
  label,
  className
}: {
  /** Rendered with the props a trigger needs: ref, onClick, aria state. */
  trigger: (props: {
    ref: React.RefObject<HTMLButtonElement>;
    onClick: () => void;
    'aria-expanded': boolean;
    'aria-haspopup': 'menu';
  }) => JSX.Element;
  children: React.ReactNode;
  align?: PopoverAlign;
  label: string;
  className?: string;
}): JSX.Element {
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);

  return (
    <>
      {trigger({
        ref,
        onClick: () => setOpen((v) => !v),
        'aria-expanded': open,
        'aria-haspopup': 'menu'
      })}
      {ref.current && (
        <Popover
          anchor={ref.current}
          open={open}
          onClose={close}
          align={align}
          aria-label={label}
          className={className}
        >
          <MenuCloseProvider close={close}>{children}</MenuCloseProvider>
        </Popover>
      )}
    </>
  );
}

// -------------------------------------------------------------------------
// The menu bar
// -------------------------------------------------------------------------

interface MenuBarState {
  openId: string | null;
  setOpenId: (id: string | null) => void;
}

const MenuBarContext = createContext<MenuBarState>({
  openId: null,
  setOpenId: () => {}
});

export function MenuBar({ children }: { children: React.ReactNode }): JSX.Element {
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <MenuBarContext.Provider value={{ openId, setOpenId }}>
      <div role="menubar" className="flex items-center gap-0.5">
        {children}
      </div>
    </MenuBarContext.Provider>
  );
}

export function MenuBarMenu({
  id,
  label,
  onOpen,
  children
}: {
  id: string;
  label: string;
  /**
   * Called each time the menu opens.
   *
   * For anything the menu shows that can go stale - the recent-documents list
   * being the reason this exists. Reading it once when the bar mounts means a
   * document saved afterwards is missing until the page is reloaded, and a
   * menu that lies about what you have saved is worse than one that costs a
   * read to open.
   */
  onOpen?: () => void;
  children: React.ReactNode;
}): JSX.Element {
  const { openId, setOpenId } = useContext(MenuBarContext);
  const ref = useRef<HTMLButtonElement>(null);
  const open = openId === id;
  const close = useCallback(() => setOpenId(null), [setOpenId]);

  const show = useCallback(() => {
    onOpen?.();
    setOpenId(id);
  }, [onOpen, setOpenId, id]);

  return (
    <>
      <button
        ref={ref}
        type="button"
        role="menuitem"
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid={`menu-${id}`}
        onClick={() => (open ? close() : show())}
        // Hover switches menus, but only once one is already open - otherwise
        // simply crossing the bar on the way somewhere else opens things.
        onPointerEnter={() => {
          if (openId !== null && openId !== id) show();
        }}
        className={`h-7 rounded-control px-2.5 transition-colors ${
          open ? 'bg-panel-active text-ink' : 'text-ink-dim hover:bg-panel-lighter hover:text-ink'
        }`}
      >
        {label}
      </button>
      {ref.current && (
        <Popover
          anchor={ref.current}
          open={open}
          onClose={close}
          aria-label={label}
          className="min-w-[15rem]"
        >
          <MenuCloseProvider close={close}>{children}</MenuCloseProvider>
        </Popover>
      )}
    </>
  );
}

// -------------------------------------------------------------------------
// Right-click menus
// -------------------------------------------------------------------------

export interface ContextMenuState {
  /** Where the menu should appear, or null when closed. */
  point: { x: number; y: number } | null;
  /** Whatever the caller needs to know about what was right-clicked. */
  target: unknown;
}

/**
 * Right-click support for any element.
 *
 * Returns the handler to spread onto the element and the state to render with.
 * The `target` is opaque on purpose: the viewport wants a guide id, a list row
 * wants a template entry, and this does not need to know the difference.
 */
export function useContextMenu<T = unknown>(): {
  props: { onContextMenu: (event: React.MouseEvent) => void };
  open: (event: React.MouseEvent | PointerEvent, target?: T) => void;
  close: () => void;
  point: { x: number; y: number } | null;
  target: T | null;
  isOpen: boolean;
} {
  const [state, setState] = useState<{
    point: { x: number; y: number } | null;
    target: T | null;
  }>({ point: null, target: null });

  const open = useCallback((event: React.MouseEvent | PointerEvent, target?: T) => {
    event.preventDefault();
    setState({ point: { x: event.clientX, y: event.clientY }, target: target ?? null });
  }, []);

  const close = useCallback(() => setState({ point: null, target: null }), []);

  return {
    props: { onContextMenu: (event: React.MouseEvent) => open(event) },
    open,
    close,
    point: state.point,
    target: state.target,
    isOpen: state.point !== null
  };
}

export function ContextMenu({
  point,
  onClose,
  label,
  children
}: {
  point: { x: number; y: number } | null;
  onClose: () => void;
  label: string;
  children: React.ReactNode;
}): JSX.Element | null {
  if (!point) return null;
  return (
    <Popover
      anchor={point}
      open
      onClose={onClose}
      offset={0}
      aria-label={label}
      className="min-w-[12rem]"
    >
      <MenuCloseProvider close={onClose}>{children}</MenuCloseProvider>
    </Popover>
  );
}
