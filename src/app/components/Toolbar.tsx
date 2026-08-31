// ==========================================================================
// Riser - Copyright (c) 2026 Squarebit LLC. All rights reserved.
//
// The toolbar: what you reach for constantly, and nothing else.
//
// The previous version was fifteen identical grey rectangles in a row - undo,
// x-ray, four separate shading buttons, a slider, auto-place - all shouting at
// the same volume. A row where everything is emphasised is a row where nothing
// is, and the user has to read all fifteen labels to find the one that
// matters.
//
// What changed, and why:
//
//   ONE PRIMARY.        Auto-place is the accent-coloured button, because on a
//                       fresh character it is the thing to press. Everything
//                       else is quieter than it.
//   SHADING COLLAPSED.  Four buttons became one dropdown. They are mutually
//                       exclusive states of a single setting, and four buttons
//                       said "four features" instead.
//   VISIBILITY GROUPED. An eye menu holds what to show. Six toggles scattered
//                       through a bar is six things to scan; one eye is one.
//   A SEGMENT FOR MODE. Markers and Curves are a segmented control, because
//                       its shape says "pick one" without a word of copy.
//
// Everything here also lives in the menu bar. This is the shortcut, not the
// inventory.
// ==========================================================================

import { useApp } from '../AppContext';
import { useUiStore } from '../state';
import { MAX_SUBDIV_LEVEL, MIN_SUBDIV_LEVEL } from '../../viewport/SubdivSurface';

/** Every level the menu offers, 0 meaning off. */
const SUBDIV_LEVELS = Array.from(
  { length: MAX_SUBDIV_LEVEL - MIN_SUBDIV_LEVEL + 1 },
  (_, i) => MIN_SUBDIV_LEVEL + i
);
import { VIEW_MODES } from '../../viewport/ViewModes';
import { PLACEMENT_MODES } from '../../tools/placement';
import { ENVIRONMENTS } from '../../viewport/environments';
import { Button, IconButton, SegmentedControl } from './ui/Button';
import { DropdownMenu, MenuItem, MenuLabel, MenuSeparator } from './ui/Menu';
import { Icon } from './ui/Icon';

export function Toolbar(): JSX.Element {
  const app = useApp();

  const activeTool = useUiStore((s) => s.activeTool);
  const symmetry = useUiStore((s) => s.symmetry);
  const hasSkeleton = useUiStore((s) => s.characterHasSkeleton);
  const characterName = useUiStore((s) => s.characterName);
  const viewMode = useUiStore((s) => s.viewMode);
  const placementMode = useUiStore((s) => s.placementMode);
  const environment = useUiStore((s) => s.environment);
  const useHdri = useUiStore((s) => s.useHdri);
  const subdivLevel = useUiStore((s) => s.subdivLevel);
  const subdivClamped = useUiStore((s) => s.subdivClamped);
  const smoothing = useUiStore((s) => s.smoothing);
  const showGeometry = useUiStore((s) => s.showGeometry);
  const showMarkers = useUiStore((s) => s.showMarkers);
  const showCurves = useUiStore((s) => s.showCurves);
  const showSkeleton = useUiStore((s) => s.showSkeleton);
  const showGrid = useUiStore((s) => s.showGrid);
  const xray = useUiStore((s) => s.xray);
  // Re-render undo/redo enablement when the document changes.
  useUiStore((s) => s.docRevision);

  const currentMode = VIEW_MODES.find((m) => m.id === viewMode) ?? VIEW_MODES[0]!;
  const currentPlacement =
    PLACEMENT_MODES.find((m) => m.id === placementMode) ?? PLACEMENT_MODES[0]!;
  const currentEnvironment =
    ENVIRONMENTS.find((e) => e.id === environment) ?? ENVIRONMENTS[0]!;
  // Anything hidden is worth saying out loud - "why can't I see my markers" is
  // otherwise a genuinely hard question to answer from the viewport alone.
  const hiddenCount = [!showGeometry, !showMarkers, !showCurves].filter(Boolean).length;

  return (
    <div className="flex h-11 shrink-0 items-center gap-1.5 border-y border-edge bg-panel-light px-2.5">
      {/* Tool ------------------------------------------------------------ */}
      <SegmentedControl
        value={activeTool}
        onChange={(tool) => useUiStore.getState().setActiveTool(tool)}
        options={[
          { value: 'marker', label: 'Markers', icon: 'marker', hint: 'Place markers (1)' },
          { value: 'curve', label: 'Curves', icon: 'curve', hint: 'Draw curves (2)' }
        ]}
      />

      <IconButton
        icon="mirror"
        label="Mirror across the centre line (S)"
        active={symmetry}
        onClick={() => useUiStore.getState().toggleSymmetry()}
      />

      {/* Where a click lands ------------------------------------------- */}
      <DropdownMenu
        label="Placement"
        trigger={(props) => (
          <Button
            {...props}
            ref={props.ref}
            icon="layers"
            trailingIcon="chevronDown"
            title="Where a click on the character puts the marker"
            data-testid="placement-menu"
          >
            {currentPlacement.label}
          </Button>
        )}
      >
        <MenuLabel>Place</MenuLabel>
        {PLACEMENT_MODES.map((mode) => (
          <MenuItem
            key={mode.id}
            label={mode.label}
            checked={placementMode === mode.id}
            description={mode.hint}
            data-testid={`placement-${mode.id}`}
            onSelect={() => useUiStore.getState().setPlacementMode(mode.id)}
          />
        ))}
      </DropdownMenu>

      <div className="rs-divider" />

      {/* Auto-place: the one primary action in the bar. ------------------ */}
      <Button
        variant="primary"
        icon="sparkles"
        onClick={() => app.autoPlace({ announce: true })}
        disabled={!characterName}
        title={
          !characterName
            ? 'Load a character first.'
            : hasSkeleton
              ? "Place markers from the character's own rig. Exact, and your own placements are kept."
              : 'Estimate markers by measuring the character. Approximate, and your own placements are kept.'
        }
      >
        Auto-place
      </Button>

      <div className="rs-divider" />

      {/* Shading, as one control ---------------------------------------- */}
      <DropdownMenu
        label="Shading"
        trigger={(props) => (
          <Button
            {...props}
            ref={props.ref}
            icon="shading"
            trailingIcon="chevronDown"
            title="How the character is shaded"
            data-testid="shading-menu"
          >
            {currentMode.label}
          </Button>
        )}
      >
        <MenuLabel>Shading</MenuLabel>
        {VIEW_MODES.map((mode) => (
          <MenuItem
            key={mode.id}
            label={mode.label}
            checked={viewMode === mode.id}
            description={mode.hint}
            data-testid={`shading-${mode.id}`}
            onSelect={() => useUiStore.getState().setViewMode(mode.id)}
          />
        ))}
      </DropdownMenu>

      {/* Lighting. Beside shading, because both answer "how does this look"
          and nobody hunts for one in the menu having just used the other. */}
      <DropdownMenu
        label="Lighting"
        trigger={(props) => (
          <Button
            {...props}
            ref={props.ref}
            icon="sun"
            trailingIcon="chevronDown"
            title="Lighting environment"
            data-testid="environment-menu"
          >
            {currentEnvironment.label}
          </Button>
        )}
      >
        <MenuLabel>Lighting</MenuLabel>
        {ENVIRONMENTS.map((preset) => (
          <MenuItem
            key={preset.id}
            label={preset.label}
            checked={environment === preset.id}
            description={preset.hint}
            data-testid={'environment-' + preset.id}
            onSelect={() => useUiStore.getState().setEnvironment(preset.id)}
          />
        ))}

        <MenuSeparator />
        <MenuItem
          label="Photographed lighting"
          checked={useHdri}
          description={
            useHdri
              ? 'Real HDR images - more incidental bounce, and a colour cast'
              : 'Using a generated sky - cleaner and more neutral'
          }
          data-testid="toggle-hdri"
          onSelect={() => useUiStore.getState().toggleHdri()}
        />
      </DropdownMenu>

      {/* Visibility ------------------------------------------------------ */}
      <DropdownMenu
        label="Show and hide"
        trigger={(props) => (
          <Button
            {...props}
            ref={props.ref}
            icon={hiddenCount > 0 ? 'eyeOff' : 'eye'}
            trailingIcon="chevronDown"
            title="Choose what is drawn"
            data-testid="visibility-menu"
            className={hiddenCount > 0 ? 'text-guide-active' : undefined}
          >
            {hiddenCount > 0 ? `${hiddenCount} hidden` : 'Show'}
          </Button>
        )}
      >
        <MenuLabel>Show</MenuLabel>
        <MenuItem
          label="Character"
          icon="cube"
          checked={showGeometry}
          description="Stays clickable while hidden"
          data-testid="show-geometry"
          onSelect={() => useUiStore.getState().toggleGeometry()}
        />
        <MenuItem
          label="Markers"
          icon="marker"
          checked={showMarkers}
          data-testid="show-markers"
          onSelect={() => useUiStore.getState().toggleMarkers()}
        />
        <MenuItem
          label="Curves"
          icon="curve"
          checked={showCurves}
          data-testid="show-curves"
          onSelect={() => useUiStore.getState().toggleCurves()}
        />
        <MenuItem
          label="Skeleton"
          icon="bone"
          checked={showSkeleton}
          disabled={!hasSkeleton}
          description={hasSkeleton ? "The character's own rig" : 'This character has no rig'}
          data-testid="show-skeleton"
          onSelect={() => useUiStore.getState().toggleSkeleton()}
        />
        <MenuItem
          label="Ground grid"
          icon="grid"
          checked={showGrid}
          onSelect={() => useUiStore.getState().toggleGrid()}
        />

        <MenuSeparator />
        <MenuItem
          label="See markers through the body"
          checked={xray}
          description="Draws them over the character rather than inside it"
          onSelect={() => useUiStore.getState().toggleXray()}
        />
      </DropdownMenu>

      <div className="rs-divider" />

      {/* Subdivision, as a toggle with the level tucked behind a menu.
          Unreal's arrangement, and it fits how the control is actually used:
          smoothing is on or off a hundred times for every time the level
          matters, and a slider made the rare decision as loud as the common
          one. Display only either way - bindings always name a cage triangle,
          so nothing here moves a marker anyone placed. */}
      <div className="flex items-center gap-px">
        <Button
          icon="shading"
          // Accent rather than the default pressed grey. A toggle that only
          // darkens by a shade is hard to read at a glance, and this one
          // changes what the whole viewport shows.
          variant={smoothing ? 'primary' : 'default'}
          active={smoothing}
          disabled={!characterName}
          data-testid="subdiv-toggle"
          onClick={() => useUiStore.getState().toggleSmoothing()}
          title={
            smoothing
              ? `Smoothing on, level ${subdivLevel}. Markers still bind to the original mesh.`
              : 'Smooth the surface for placement. Markers still bind to the original mesh.'
          }
          className="rounded-r-none"
        >
          Smooth
        </Button>

        <DropdownMenu
          label="Smoothing level"
          align="end"
          trigger={(props) => (
            <Button
              {...props}
              ref={props.ref}
              icon="more"
              aria-label="Smoothing level"
              title="Smoothing level"
              data-testid="subdiv-level-menu"
              disabled={!characterName}
              className="!px-1 rounded-l-none"
            />
          )}
        >
          <MenuLabel>Smoothing level</MenuLabel>
          {SUBDIV_LEVELS.map((level) => (
            <MenuItem
              key={level}
              label={`Level ${level}`}
              checked={smoothing && subdivLevel === level}
              description={
                level === 0
                  ? 'The mesh as the file describes it, drawn as quads'
                  : undefined
              }
              data-testid={`subdiv-level-${level}`}
              onSelect={() => useUiStore.getState().setSubdivLevel(level)}
            />
          ))}
        </DropdownMenu>
      </div>

      <div className="flex-1" />

      {subdivClamped && (
        <span
          className="flex items-center gap-1 text-[11px] text-guide-active"
          title="The mesh was already dense, so the level was reduced to keep the viewport responsive."
        >
          <Icon name="warning" size={13} />
          reduced
        </span>
      )}

      <IconButton
        icon="undo"
        label={app.store.undoLabel ? `Undo ${app.store.undoLabel}` : 'Undo'}
        disabled={!app.store.canUndo}
        onClick={() => app.undo()}
      />
      <IconButton
        icon="redo"
        label={app.store.redoLabel ? `Redo ${app.store.redoLabel}` : 'Redo'}
        disabled={!app.store.canRedo}
        onClick={() => app.redo()}
      />

      <div className="rs-divider" />

      <IconButton
        icon="frame"
        label="Frame the whole character (A)"
        onClick={() => app.frameCharacter()}
        disabled={!characterName}
      />
    </div>
  );
}
