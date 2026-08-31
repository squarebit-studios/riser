// ==========================================================================
// Riser - Copyright (c) 2026 Squarebit LLC. All rights reserved.
//
// Search, sliders, collapsible sections and progress - the small controls that
// the panels are built out of.
// ==========================================================================

import React, { useId, useRef } from 'react';
import { Icon, type IconName } from './Icon';

/**
 * A search field with a clear button.
 *
 * Escape clears rather than blurring. Someone who has filtered a list to two
 * rows and wants all forty back reaches for Escape, and having it move focus
 * instead is the kind of thing that makes an interface feel unresponsive
 * without anyone being able to say why.
 */
export function SearchField({
  value,
  onChange,
  placeholder = 'Search',
  'data-testid': testId
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  'data-testid'?: string;
}): JSX.Element {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className="relative flex items-center">
      <Icon
        name="search"
        size={15}
        className="pointer-events-none absolute left-2.5 text-ink-faint"
      />
      <input
        ref={ref}
        type="search"
        value={value}
        placeholder={placeholder}
        data-testid={testId}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && value) {
            e.preventDefault();
            e.stopPropagation();
            onChange('');
          }
        }}
        className="h-8 w-full rounded-control bg-panel-lighter pl-8 pr-8 text-ink placeholder:text-ink-faint focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-0 [&::-webkit-search-cancel-button]:hidden"
      />
      {value && (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => {
            onChange('');
            ref.current?.focus();
          }}
          className="absolute right-1.5 flex h-5 w-5 items-center justify-center rounded-full text-ink-faint transition-colors hover:bg-panel-hover hover:text-ink"
        >
          <Icon name="close" size={12} />
        </button>
      )}
    </div>
  );
}

/** A labelled slider with its value shown. */
export function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  hint,
  warn
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  hint?: string;
  /** Draws the value in the warning colour - a level that had to be reduced. */
  warn?: boolean;
}): JSX.Element {
  const id = useId();
  return (
    <div className="flex items-center gap-2" title={hint}>
      <label htmlFor={id} className="shrink-0 text-ink-dim">
        {label}
      </label>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1 w-20 cursor-pointer appearance-none rounded-full bg-panel-active accent-accent"
      />
      <span
        className={`w-3 text-center font-mono text-[11px] ${
          warn ? 'text-guide-active' : 'text-ink-faint'
        }`}
      >
        {value}
      </span>
    </div>
  );
}

/**
 * A section that can be folded away.
 *
 * Open state is the caller's, not this component's, so it can be remembered
 * across a reload - a panel that forgets what you collapsed every time you
 * refresh is worse than one that does not collapse at all.
 */
export function Disclosure({
  title,
  open,
  onToggle,
  badge,
  icon,
  children,
  'data-testid': testId
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  /** Right-aligned status: a count, a progress ring, a word. */
  badge?: React.ReactNode;
  icon?: IconName;
  children: React.ReactNode;
  'data-testid'?: string;
}): JSX.Element {
  return (
    <section>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        data-testid={testId}
        className="flex w-full items-center gap-1.5 rounded-control px-1.5 py-1.5 text-left text-ink-dim transition-colors hover:bg-panel-lighter hover:text-ink"
      >
        <Icon
          name="chevronRight"
          size={14}
          className={`shrink-0 transition-transform ${open ? 'rotate-90' : ''}`}
        />
        {icon && <Icon name={icon} size={15} className="shrink-0" />}
        <span className="min-w-0 flex-1 truncate font-medium">{title}</span>
        {badge}
      </button>
      {open && <div className="pb-1">{children}</div>}
    </section>
  );
}

/**
 * Progress as a ring.
 *
 * A ring rather than "4/10" alone because the shape is readable at a glance
 * down a column of groups, which is exactly how it is used: the question being
 * asked is "which group still needs work", not "what is the exact count".
 * The count is in the tooltip and the label for anyone who wants it.
 */
export function ProgressRing({
  done,
  total,
  size = 16
}: {
  done: number;
  total: number;
  size?: number;
}): JSX.Element {
  const fraction = total > 0 ? done / total : 0;
  const radius = size / 2 - 1.5;
  const circumference = 2 * Math.PI * radius;
  const complete = total > 0 && done >= total;

  return (
    <span
      className="flex shrink-0 items-center gap-1.5"
      title={`${done} of ${total} placed`}
    >
      <span className="font-mono text-[11px] text-ink-faint">
        {done}/{total}
      </span>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className="text-panel-active"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - fraction)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          className={complete ? 'text-curve' : 'text-accent'}
        />
      </svg>
    </span>
  );
}

/** Small rounded label - "auto", "yours", a template name. */
export function Chip({
  children,
  tone = 'neutral',
  className = ''
}: {
  children: React.ReactNode;
  tone?: 'neutral' | 'accent' | 'suggested' | 'warn';
  className?: string;
}): JSX.Element {
  const tones = {
    neutral: 'bg-panel-lighter text-ink-faint',
    accent: 'bg-accent-soft text-accent',
    suggested: 'bg-guide-suggested/20 text-guide-suggested',
    warn: 'bg-guide-active/20 text-guide-active'
  };
  return (
    <span
      className={`shrink-0 rounded-full px-1.5 py-px text-[10px] font-medium uppercase tracking-wide ${tones[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

/**
 * A row of mutually exclusive filters.
 *
 * Deliberately not a `<select>`: the whole value of a filter is seeing what
 * the options are and how many each would give you without opening anything.
 */
export function FilterChips<T extends string>({
  value,
  onChange,
  options
}: {
  value: T;
  onChange: (value: T) => void;
  options: readonly { value: T; label: string; count?: number }[];
}): JSX.Element {
  return (
    <div role="radiogroup" className="flex flex-wrap items-center gap-1">
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option.value)}
            className={`h-6 rounded-full px-2 text-[11px] font-medium transition-colors ${
              selected
                ? 'bg-accent text-accent-ink'
                : 'bg-panel-lighter text-ink-dim hover:bg-panel-hover hover:text-ink'
            }`}
          >
            {option.label}
            {option.count !== undefined && (
              <span className={selected ? 'opacity-70' : 'text-ink-faint'}>
                {' '}
                {option.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
