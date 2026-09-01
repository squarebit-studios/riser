// ==========================================================================
// Riser - Copyright (c) 2026 Squarebit LLC. All rights reserved.
//
// UI state - and ONLY UI state.
//
// The authored document lives in DocumentStore (src/doc/history.ts), not here.
// This store holds what the chrome needs to render: which tool is active, what
// is selected, which overlays are on. Putting the document in a React store
// would mean a React render per frame of a marker drag, which is precisely the
// cost this architecture exists to avoid.
//
// `docRevision` is the bridge. RiserApp bumps it when the document changes, so
// components that show derived state - checklist progress, the inspector - can
// subscribe to a single number instead of to the document itself.
// ==========================================================================

import { create } from 'zustand';

/**
 * What a character load is doing, for the progress bar.
 *
 * Declared here rather than imported from `io/loadCharacter` so the store does
 * not depend on the loader, and so the cancel handler has somewhere to live
 * that the chrome can reach without reaching into the viewport.
 */
export interface LoadStatus {
  stage: 'downloading' | 'parsing' | 'building';
  received: number;
  total: number | null;
  /** Stops the load. Present only while there is still something to stop. */
  cancel?: () => void;
}
import type { ToolId } from '../tools/types';
import type { ControlVertexRef } from '../tools/curve/CurveLayer';
import { DEFAULT_TEMPLATE_ID } from '../templates';
import { DEFAULT_SUBDIV_LEVEL } from '../viewport/SubdivSurface';
import { DEFAULT_VIEW_MODE, type ViewMode } from '../viewport/ViewModes';
import { DEFAULT_PLACEMENT_MODE, type PlacementMode } from '../tools/placement';
import {
  DEFAULT_ENVIRONMENT,
  DEFAULT_USE_HDRI,
  type EnvironmentId
} from '../viewport/environments';

/**
 * Which guides the template list is showing.
 *
 * `unplaced` is the one that earns its keep: the question someone actually has
 * near the end is "what is left", and scanning forty rows for the empty ones
 * is work the interface should be doing.
 */
export type GuideFilter = 'all' | 'unplaced' | 'auto' | 'mine';

/** Panel sizes the user has not changed. */
const DEFAULT_LAYOUT = {
  leftWidth: 272,
  rightWidth: 300,
  leftCollapsed: false,
  rightCollapsed: false
};

/** Preferences that outlive a reload. Not the document - see doc/session.ts. */
interface PersistedUi {
  leftWidth: number;
  rightWidth: number;
  leftCollapsed: boolean;
  rightCollapsed: boolean;
  guided: boolean;
  showGrid: boolean;
  viewMode: ViewMode;
  subdivLevel: number;
  /** Whether smoothing is on. Separate from the level, so level 0 is a
   *  real choice: the unrefined mesh, drawn as quads. */
  smoothing: boolean;
  blendNormals: boolean;
  placementMode: PlacementMode;
  /** Which lighting environment the viewport uses. */
  environment: EnvironmentId;
  useHdri: boolean;
}

const LAYOUT_KEY = 'riser.ui.v1';

/**
 * Read the remembered layout.
 *
 * Every field is checked rather than trusted. This is data from a previous
 * version of the app in a store the user can edit, and a bad width here is a
 * panel that fills the screen with no obvious way back.
 */
function loadLayout(): Partial<PersistedUi> {
  try {
    const raw = localStorage.getItem(LAYOUT_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Partial<PersistedUi>;
    const out: Partial<PersistedUi> = {};

    const width = (value: unknown): number | undefined =>
      typeof value === 'number' && Number.isFinite(value) && value >= 160 && value <= 640
        ? Math.round(value)
        : undefined;

    const left = width(parsed.leftWidth);
    if (left !== undefined) out.leftWidth = left;
    const right = width(parsed.rightWidth);
    if (right !== undefined) out.rightWidth = right;
    if (typeof parsed.leftCollapsed === 'boolean') out.leftCollapsed = parsed.leftCollapsed;
    if (typeof parsed.rightCollapsed === 'boolean') {
      out.rightCollapsed = parsed.rightCollapsed;
    }
    if (typeof parsed.guided === 'boolean') out.guided = parsed.guided;
    if (typeof parsed.showGrid === 'boolean') out.showGrid = parsed.showGrid;
    if (
      parsed.viewMode === 'lit' ||
      parsed.viewMode === 'flat' ||
      parsed.viewMode === 'wireframe' ||
      parsed.viewMode === 'litWireframe'
    ) {
      out.viewMode = parsed.viewMode;
    }
    if (typeof parsed.smoothing === 'boolean') {
      out.smoothing = parsed.smoothing;
    }
    if (typeof parsed.blendNormals === 'boolean') {
      out.blendNormals = parsed.blendNormals;
    }
    if (
      typeof parsed.subdivLevel === 'number' &&
      Number.isInteger(parsed.subdivLevel) &&
      parsed.subdivLevel >= 0 &&
      parsed.subdivLevel <= 3
    ) {
      out.subdivLevel = parsed.subdivLevel;
    }
    if (
      parsed.placementMode === 'auto' ||
      parsed.placementMode === 'surface' ||
      parsed.placementMode === 'center' ||
      parsed.placementMode === 'free'
    ) {
      out.placementMode = parsed.placementMode;
    }
    if (
      parsed.environment === 'studio' ||
      parsed.environment === 'day' ||
      parsed.environment === 'sunset' ||
      parsed.environment === 'night'
    ) {
      out.environment = parsed.environment;
    }
    if (typeof parsed.useHdri === 'boolean') out.useHdri = parsed.useHdri;
    return out;
  } catch {
    // A private window, cleared site data, or a browser that refuses storage.
    // None of those should stop the app opening.
    return {};
  }
}

export interface UiState {
  templateId: string;
  activeTool: ToolId;

  /** The guide the checklist is pointing at - the next click places this one. */
  activeGuideId: string | null;
  selectedGuideId: string | null;

  activeCurveId: string | null;
  selectedPoint: ControlVertexRef | null;

  symmetry: boolean;
  xray: boolean;
  /**
   * Catmull-Clark level for the displayed surface. 0 shows the raw cage.
   * Bindings are unaffected - they always name a cage triangle.
   */
  subdivLevel: number;
  /**
   * Whether smoothing is on, held apart from the level.
   *
   * Derived state ("on means level > 0") made level 0 unreachable while on,
   * so the unrefined mesh could never be looked at as quads. They are two
   * different questions: whether to smooth, and by how much.
   */
  smoothing: boolean;
  /** Set when a mesh was too dense for the requested level. */
  subdivClamped: boolean;
  /** How the character is shaded: lit, flat, wireframe, or lit with wires. */
  viewMode: ViewMode;
  /**
   * What a click on the character means: the surface, the centre of the volume
   * under it, or a free point in space.
   */
  placementMode: PlacementMode;
  /** Which lighting environment the viewport uses. */
  environment: EnvironmentId;
  /** Photographed lighting, or the procedural sky. */
  useHdri: boolean;
  showGrid: boolean;
  showMarkers: boolean;
  showCurves: boolean;
  /** The character's surface. Hidden via material, so it stays clickable. */
  showGeometry: boolean;
  /** The character's own rig, when it has one. */
  showSkeleton: boolean;
  dark: boolean;

  /**
   * Walk the user through unplaced guides one at a time.
   *
   * On by default, because the first thing someone sees should be one clear
   * instruction rather than a list of forty. Anyone who would rather work
   * down the list turns it off, and that choice is remembered.
   */
  guided: boolean;
  /** Text filter over the template list. */
  guideSearch: string;
  /** Which guides the list is showing. */
  guideFilter: GuideFilter;
  /** Groups the user has folded away, by group id. */
  collapsedGroups: string[];

  leftWidth: number;
  rightWidth: number;
  leftCollapsed: boolean;
  rightCollapsed: boolean;

  /** Bumped by RiserApp on every document change. */
  docRevision: number;
  dirty: boolean;

  characterName: string | null;
  /**
   * How many blend shapes the loaded character has.
   *
   * Here so the panel can learn they arrived. Reading them means fetching the
   * character file back, so they land well after the character does, and a
   * panel keyed on the character alone builds its list from an empty set and
   * never looks again.
   */
  blendShapeCount: number;
  /**
   * Whether shading should follow a blend shape.
   *
   * Off by default: keeping the file's own normals is free and exactly what
   * the artist shaded, and recomputing costs real time on a dense character.
   * On, the normals are rotated by how far the surface turned, so a shape
   * lights as though it moved rather than as though it had not.
   */
  blendNormals: boolean;
  characterHasSkeleton: boolean;
  loading: string | null;
  /** How far a character load has got, or null when nothing is loading. */
  loadProgress: LoadStatus | null;
  error: string | null;
  notice: string | null;

  setTemplateId: (id: string) => void;
  setActiveTool: (tool: ToolId) => void;
  setActiveGuideId: (id: string | null) => void;
  setSelectedGuideId: (id: string | null) => void;
  setActiveCurveId: (id: string | null) => void;
  setSelectedPoint: (ref: ControlVertexRef | null) => void;
  toggleSymmetry: () => void;
  toggleXray: () => void;
  setSubdivLevel: (level: number) => void;
  setSmoothing: (on: boolean) => void;
  toggleSmoothing: () => void;
  setViewMode: (mode: ViewMode) => void;
  setPlacementMode: (mode: PlacementMode) => void;
  setEnvironment: (id: EnvironmentId) => void;
  toggleHdri: () => void;
  setSubdivClamped: (clamped: boolean) => void;
  toggleGrid: () => void;
  toggleMarkers: () => void;
  toggleCurves: () => void;
  toggleGeometry: () => void;
  toggleSkeleton: () => void;
  setDark: (dark: boolean) => void;

  setGuided: (guided: boolean) => void;
  setGuideSearch: (text: string) => void;
  setGuideFilter: (filter: GuideFilter) => void;
  toggleGroup: (groupId: string) => void;
  setPanelWidth: (side: 'left' | 'right', width: number) => void;
  setPanelCollapsed: (side: 'left' | 'right', collapsed: boolean) => void;
  resetLayout: () => void;
  bumpDoc: (dirty: boolean) => void;
  setCharacter: (name: string | null, hasSkeleton: boolean) => void;
  setBlendShapeCount: (count: number) => void;
  toggleBlendNormals: () => void;
  setLoading: (message: string | null) => void;
  setLoadProgress: (progress: LoadStatus | null) => void;
  setError: (message: string | null) => void;
  setNotice: (message: string | null) => void;
}

export const useUiStore = create<UiState>((set) => ({
  templateId: DEFAULT_TEMPLATE_ID,
  activeTool: 'marker',

  activeGuideId: null,
  selectedGuideId: null,
  activeCurveId: null,
  selectedPoint: null,

  symmetry: true,
  xray: true,
  subdivLevel: DEFAULT_SUBDIV_LEVEL,
  smoothing: false,
  subdivClamped: false,
  viewMode: DEFAULT_VIEW_MODE,
  placementMode: DEFAULT_PLACEMENT_MODE,
  environment: DEFAULT_ENVIRONMENT,
  useHdri: DEFAULT_USE_HDRI,
  showGrid: true,
  showMarkers: true,
  showCurves: true,
  showGeometry: true,
  showSkeleton: false,
  dark: true,

  guided: true,
  guideSearch: '',
  guideFilter: 'all',
  collapsedGroups: [],

  ...DEFAULT_LAYOUT,
  ...loadLayout(),

  docRevision: 0,
  dirty: false,

  characterName: null,
  blendShapeCount: 0,
  blendNormals: false,
  characterHasSkeleton: false,
  loading: null,
  loadProgress: null,
  error: null,
  notice: null,

  setTemplateId: (templateId) =>
    set({
      templateId,
      // Selections are template-scoped; carrying them across would point at
      // guides the new template has never heard of.
      activeGuideId: null,
      selectedGuideId: null,
      activeCurveId: null,
      selectedPoint: null
    }),
  setActiveTool: (activeTool) => set({ activeTool }),
  setActiveGuideId: (activeGuideId) => set({ activeGuideId }),
  setSelectedGuideId: (selectedGuideId) => set({ selectedGuideId }),
  setActiveCurveId: (activeCurveId) => set({ activeCurveId, selectedPoint: null }),
  setSelectedPoint: (selectedPoint) => set({ selectedPoint }),

  toggleSymmetry: () => set((s) => ({ symmetry: !s.symmetry })),
  toggleXray: () => set((s) => ({ xray: !s.xray })),
  setSubdivLevel: (subdivLevel) =>
    // Choosing a level is also asking to see it. Picking "Level 2" from
    // the menu while smoothing is off and having nothing happen would be
    // a dead control.
    set({ subdivLevel, smoothing: true }),
  setSmoothing: (smoothing) => set({ smoothing }),
  toggleSmoothing: () =>
    set((s) => {
      if (s.smoothing) return { smoothing: false };
      // Turning smoothing ON at level 0 smooths nothing: the effective level
      // is the chosen one, and 0 means the cage. The button lit up and the
      // character did not move, which reads as a broken control rather than
      // as a subtlety about levels.
      //
      // Level 0 stays reachable, but by CHOOSING it from the menu, where
      // picking it says something. Arriving there by pressing a button called
      // Smooth does not.
      return { smoothing: true, subdivLevel: s.subdivLevel > 0 ? s.subdivLevel : 1 };
    }),
  setViewMode: (viewMode) => set({ viewMode }),
  setPlacementMode: (placementMode) => set({ placementMode }),
  setEnvironment: (environment) => set({ environment }),
  toggleHdri: () => set((s) => ({ useHdri: !s.useHdri })),
  setSubdivClamped: (subdivClamped) => set({ subdivClamped }),
  toggleGrid: () => set((s) => ({ showGrid: !s.showGrid })),
  toggleMarkers: () => set((s) => ({ showMarkers: !s.showMarkers })),
  toggleCurves: () => set((s) => ({ showCurves: !s.showCurves })),
  toggleGeometry: () => set((s) => ({ showGeometry: !s.showGeometry })),
  toggleSkeleton: () => set((s) => ({ showSkeleton: !s.showSkeleton })),
  setDark: (dark) => set({ dark }),

  setGuided: (guided) => set({ guided }),
  setGuideSearch: (guideSearch) => set({ guideSearch }),
  setGuideFilter: (guideFilter) => set({ guideFilter }),
  toggleGroup: (groupId) =>
    set((s) => ({
      collapsedGroups: s.collapsedGroups.includes(groupId)
        ? s.collapsedGroups.filter((id) => id !== groupId)
        : [...s.collapsedGroups, groupId]
    })),
  setPanelWidth: (side, width) =>
    set(side === 'left' ? { leftWidth: width } : { rightWidth: width }),
  setPanelCollapsed: (side, collapsed) =>
    set(side === 'left' ? { leftCollapsed: collapsed } : { rightCollapsed: collapsed }),
  resetLayout: () => set({ ...DEFAULT_LAYOUT }),

  bumpDoc: (dirty) => set((s) => ({ docRevision: s.docRevision + 1, dirty })),
  setCharacter: (characterName, characterHasSkeleton) =>
    // A new character has none until its file has been read again.
    set({ characterName, characterHasSkeleton, blendShapeCount: 0 }),
  setBlendShapeCount: (blendShapeCount) => set({ blendShapeCount }),
  toggleBlendNormals: () => set((s) => ({ blendNormals: !s.blendNormals })),
  setLoading: (loading) =>
    // Clearing the message clears the progress with it, so a finished load
    // cannot leave a stale bar behind.
    set(loading === null ? { loading, loadProgress: null } : { loading }),
  setLoadProgress: (loadProgress) => set({ loadProgress }),
  setError: (error) => set({ error }),
  setNotice: (notice) => set({ notice })
}));

/**
 * Remember the handful of preferences worth remembering.
 *
 * Written on change rather than on unload: `beforeunload` is not guaranteed to
 * run on mobile or when a tab is discarded, and losing a panel width because
 * the browser reclaimed the tab would be a small, baffling papercut.
 */
useUiStore.subscribe((state, previous) => {
  const changed =
    state.leftWidth !== previous.leftWidth ||
    state.rightWidth !== previous.rightWidth ||
    state.leftCollapsed !== previous.leftCollapsed ||
    state.rightCollapsed !== previous.rightCollapsed ||
    state.guided !== previous.guided ||
    state.showGrid !== previous.showGrid ||
    state.viewMode !== previous.viewMode ||
    state.subdivLevel !== previous.subdivLevel ||
    state.smoothing !== previous.smoothing ||
    state.blendNormals !== previous.blendNormals ||
    state.placementMode !== previous.placementMode ||
    state.environment !== previous.environment ||
    state.useHdri !== previous.useHdri;
  if (!changed) return;

  const persisted: PersistedUi = {
    leftWidth: state.leftWidth,
    rightWidth: state.rightWidth,
    leftCollapsed: state.leftCollapsed,
    rightCollapsed: state.rightCollapsed,
    guided: state.guided,
    showGrid: state.showGrid,
    viewMode: state.viewMode,
    subdivLevel: state.subdivLevel,
    smoothing: state.smoothing,
    blendNormals: state.blendNormals,
    placementMode: state.placementMode,
    environment: state.environment,
    useHdri: state.useHdri
  };
  try {
    localStorage.setItem(LAYOUT_KEY, JSON.stringify(persisted));
  } catch {
    // Storage refused. The app works, it just forgets - not worth a message.
  }
});
