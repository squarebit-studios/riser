// ==========================================================================
// Riser - Copyright (c) 2026 Squarebit LLC. All rights reserved.
//
// Buttons, and the two grouped controls built from them.
//
// The variants exist to answer one question the old interface got wrong: which
// of these fifteen controls is the one to press? A row of identical grey
// rectangles says "all of them, equally", which is the same as saying nothing.
// So there is exactly one `primary` on screen at a time, `default` for things
// worth noticing, and `ghost` for everything that should recede until looked
// for.
//
// `IconButton` demands a `label`. An icon-only control with no accessible name
// is invisible to a screen reader and a guess for everyone else, and this is a
// consumer product - a mystery glyph is a support ticket.
// ==========================================================================

import React, { forwardRef } from 'react';
import { Icon, type IconName } from './Icon';

export type ButtonVariant = 'primary' | 'default' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-accent text-accent-ink font-medium shadow-raised hover:bg-accent-hover active:bg-accent-press',
  default:
    'bg-panel-lighter text-ink hover:bg-panel-hover active:bg-panel-active',
  ghost: 'text-ink-dim hover:bg-panel-lighter hover:text-ink active:bg-panel-hover',
  danger: 'text-danger hover:bg-danger-soft active:bg-danger-soft'
};

const SIZES: Record<ButtonSize, string> = {
  // Generous hit targets. 28px is the floor for a pointer, and the bars use it
  // everywhere so the whole row shares one rhythm.
  sm: 'h-7 gap-1.5 px-2 text-[12px] rounded-control',
  md: 'h-8 gap-2 px-2.5 rounded-control',
  lg: 'h-9 gap-2 px-3.5 rounded-control'
};

const BASE =
  'inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap ' +
  'transition-colors disabled:pointer-events-none disabled:opacity-40';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shown before the label. */
  icon?: IconName;
  /** Shown after the label - a chevron on a menu button, say. */
  trailingIcon?: IconName;
  /** Renders in the pressed state, for toggles. Sets aria-pressed. */
  active?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'default',
    size = 'md',
    icon,
    trailingIcon,
    active,
    className = '',
    children,
    ...rest
  },
  ref
) {
  // An active ghost has to look pressed rather than merely hovered, or a
  // toggle that is ON is indistinguishable from the pointer resting on it.
  //
  // A primary button is left alone. Its variant already says "on" in accent,
  // and adding the pressed grey on top puts two background utilities on the
  // same element: which one wins is then down to the order Tailwind happens to
  // emit them in, not to anything stated here. That is how the Smooth toggle
  // came out blue in one state and grey in another with identical props.
  const activeClass =
    !active || variant === 'primary'
      ? ''
      : variant === 'ghost'
        ? 'bg-accent-soft text-accent hover:bg-accent-soft hover:text-accent'
        : 'bg-panel-active text-ink';

  return (
    <button
      ref={ref}
      type="button"
      aria-pressed={active === undefined ? undefined : active}
      className={`${BASE} ${SIZES[size]} ${VARIANTS[variant]} ${activeClass} ${className}`}
      {...rest}
    >
      {icon && <Icon name={icon} size={size === 'lg' ? 18 : 16} />}
      {children}
      {trailingIcon && (
        <Icon name={trailingIcon} size={14} className="-mr-0.5 opacity-70" />
      )}
    </button>
  );
});

export interface IconButtonProps extends Omit<ButtonProps, 'children' | 'icon'> {
  icon: IconName;
  /** Required: the accessible name, and the tooltip. */
  label: string;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  function IconButton(
    { icon, label, size = 'md', variant = 'ghost', className = '', ...rest },
    ref
  ) {
    const square = size === 'sm' ? 'w-7' : size === 'lg' ? 'w-9' : 'w-8';
    return (
      <Button
        ref={ref}
        icon={icon}
        size={size}
        variant={variant}
        aria-label={label}
        title={label}
        className={`!px-0 ${square} ${className}`}
        {...rest}
      />
    );
  }
);

/**
 * A choice between mutually exclusive options - the active tool, say.
 *
 * A segmented control rather than separate toggle buttons because the shape
 * itself says "pick one of these", which two adjacent buttons do not. That is
 * the difference between a user working out the rule and being told it.
 */
export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  size = 'md',
  className = ''
}: {
  value: T;
  onChange: (value: T) => void;
  options: readonly { value: T; label: string; icon?: IconName; hint?: string }[];
  size?: ButtonSize;
  className?: string;
}): JSX.Element {
  const height = size === 'sm' ? 'h-7' : size === 'lg' ? 'h-9' : 'h-8';
  return (
    <div
      role="radiogroup"
      className={`inline-flex ${height} shrink-0 items-center gap-0.5 rounded-control bg-panel p-0.5 ${className}`}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            title={option.hint}
            onClick={() => onChange(option.value)}
            className={`inline-flex h-full items-center gap-1.5 whitespace-nowrap rounded-[6px] px-2.5 transition-colors ${
              selected
                ? 'bg-panel-active text-ink shadow-raised'
                : 'text-ink-dim hover:text-ink'
            }`}
          >
            {option.icon && <Icon name={option.icon} size={15} />}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * An on/off control with a visible state, for settings rather than actions.
 *
 * Used in menus and the inspector, where a pressed-looking button is easy to
 * misread as "press me" rather than "this is on".
 */
export function Switch({
  checked,
  onChange,
  label,
  hint
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  hint?: string;
}): JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      title={hint}
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between gap-3 rounded-control px-2 py-1.5 text-left text-ink-dim transition-colors hover:bg-panel-lighter hover:text-ink"
    >
      <span className="min-w-0 truncate">{label}</span>
      <span
        className={`relative h-[18px] w-[30px] shrink-0 rounded-full transition-colors ${
          checked ? 'bg-accent' : 'bg-panel-active'
        }`}
      >
        <span
          className={`absolute top-[2px] h-[14px] w-[14px] rounded-full bg-white transition-all ${
            checked ? 'left-[14px]' : 'left-[2px]'
          }`}
        />
      </span>
    </button>
  );
}
