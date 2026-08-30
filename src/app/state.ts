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
import type { ToolId } from '../tools/types';
import type { ControlVertexRef } from '../tools/curve/CurveLayer';
import { DEFAULT_TEMPLATE_ID } from '../templates';
import { DEFAULT_SUBDIV_LEVEL } from '../viewport/SubdivSurface';

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
  /** Set when a mesh was too dense for the requested level. */
  subdivClamped: boolean;
  showGrid: boolean;
  showMarkers: boolean;
  showCurves: boolean;
  dark: boolean;

  /** Bumped by RiserApp on every document change. */
  docRevision: number;
  dirty: boolean;

  characterName: string | null;
  characterHasSkeleton: boolean;
  loading: string | null;
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
  setSubdivClamped: (clamped: boolean) => void;
  toggleGrid: () => void;
  toggleMarkers: () => void;
  toggleCurves: () => void;
  setDark: (dark: boolean) => void;
  bumpDoc: (dirty: boolean) => void;
  setCharacter: (name: string | null, hasSkeleton: boolean) => void;
  setLoading: (message: string | null) => void;
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
  subdivClamped: false,
  showGrid: true,
  showMarkers: true,
  showCurves: true,
  dark: true,

  docRevision: 0,
  dirty: false,

  characterName: null,
  characterHasSkeleton: false,
  loading: null,
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
  setSubdivLevel: (subdivLevel) => set({ subdivLevel }),
  setSubdivClamped: (subdivClamped) => set({ subdivClamped }),
  toggleGrid: () => set((s) => ({ showGrid: !s.showGrid })),
  toggleMarkers: () => set((s) => ({ showMarkers: !s.showMarkers })),
  toggleCurves: () => set((s) => ({ showCurves: !s.showCurves })),
  setDark: (dark) => set({ dark }),

  bumpDoc: (dirty) => set((s) => ({ docRevision: s.docRevision + 1, dirty })),
  setCharacter: (characterName, characterHasSkeleton) =>
    set({ characterName, characterHasSkeleton }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
  setNotice: (notice) => set({ notice })
}));
