// ==========================================================================
// Riser - Copyright (c) 2026 Squarebit LLC. All rights reserved.
//
// The controller. Owns the three.js side, wires the tools to the document,
// and is the only place the two stores meet.
//
// It is a plain class, not a hook or a component, on purpose: it outlives
// React renders, holds GPU resources that must be disposed exactly once, and
// drives a frame loop that React must never be part of. React mounts it, reads
// from it, and calls methods on it - nothing more.
// ==========================================================================

import * as THREE from 'three';
import { Viewport } from '../viewport/Viewport';
import { CameraRig } from '../viewport/CameraRig';
import { SurfacePicker, resolveBindingWorld } from '../viewport/Picker';
import { Overlays } from '../viewport/Overlays';
import { SubdivSet } from '../viewport/SubdivSurface';
import { documentToWorld, documentToWorldDirection } from '../viewport/space';
import { CharacterModel } from '../io/CharacterModel';
import {
  loadCharacterFromFile,
  loadCharacterFromUrl,
  disposeLoaders
} from '../io/loadCharacter';
import { DocumentStore } from '../doc/history';
import * as M from '../doc/mutations';
import { createDocument, type RiserDocument, type Vec3 } from '../doc/types';
import { getTemplate } from '../templates';
import { placeGuidesFromSkeleton } from '../tools/autoplace/fromSkeleton';
import { placeGuidesFromProportions } from '../tools/autoplace/fromProportions';
import { ToolManager } from '../tools/ToolManager';
import { MarkerLayer } from '../tools/marker/MarkerLayer';
import { MarkerTool } from '../tools/marker/MarkerTool';
import { CurveLayer } from '../tools/curve/CurveLayer';
import { CurveTool } from '../tools/curve/CurveTool';
import { resampleCurve, DEFAULT_SAMPLES_PER_SEGMENT } from '../tools/curve/geometry';
import {
  controlVertexSampleIndices,
  interpolateNormals,
  projectSamplesToSurface,
  SEARCH_FRACTION
} from '../tools/curve/project';
import {
  clearSession,
  isReloadableRef,
  isWorthSaving,
  loadSession,
  saveSession
} from '../doc/session';
import { useUiStore } from './state';

/**
 * How long the document must sit still before it is written.
 *
 * Long enough that a drag writes once at the end rather than per frame, short
 * enough that a browser crash costs at most a moment's work.
 */
const AUTOSAVE_DELAY_MS = 700;

export class RiserApp {
  readonly viewport: Viewport;
  readonly store: DocumentStore;

  private cameraRig: CameraRig | null = null;
  private toolManager: ToolManager | null = null;
  private overlays: Overlays | null = null;
  private picker: SurfacePicker;
  private markerLayer: MarkerLayer;
  private curveLayer: CurveLayer;

  private character: CharacterModel | null = null;
  private subdivs: SubdivSet | null = null;
  private unsubscribeDoc: () => void;
  private unsubscribeUi: (() => void) | null = null;
  private unsubscribeFrame: (() => void) | null = null;

  /** Raycaster used for re-seating curve samples onto the surface. */
  private readonly projectionRaycaster = new THREE.Raycaster();

  /**
   * Set while a restored session is loading its character, so the automatic
   * placement that normally follows a load does not run over the work being
   * restored.
   */
  private restoring = false;
  private autosaveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    const ui = useUiStore.getState();

    this.viewport = new Viewport({ dark: ui.dark });
    this.picker = new SurfacePicker(this.viewport.camera);
    this.markerLayer = new MarkerLayer(this.viewport.overlayRoot);
    this.curveLayer = new CurveLayer(this.viewport.overlayRoot);

    this.store = new DocumentStore(createDocument(ui.templateId, ''));
    this.unsubscribeDoc = this.store.subscribe(() => {
      useUiStore.getState().bumpDoc(this.store.isDirty);
      this.syncFromDocument();
      this.scheduleAutosave();
    });
  }

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  mount(container: HTMLElement): void {
    this.viewport.attach(container);
    const canvas = this.viewport.renderer.domElement;

    this.cameraRig = new CameraRig(this.viewport.camera, canvas);
    this.overlays = new Overlays(this.viewport.overlayRoot);
    this.toolManager = new ToolManager(canvas, this.cameraRig);

    this.toolManager.register(new MarkerTool(this.markerToolDeps()));
    this.toolManager.register(new CurveTool(this.curveToolDeps()));
    this.toolManager.setActive(useUiStore.getState().activeTool);

    this.unsubscribeFrame = this.viewport.onFrame((dt) => {
      this.cameraRig?.update(dt);
      this.toolManager?.update(dt);
      // Both layers keep their points screen-constant, and the active tool
      // only updates its own, so update the other one here.
      this.markerLayer.update(this.viewport.camera);
      this.curveLayer.update(this.viewport.camera);

      // Line2 computes its width in SCREEN space, so its material has to know
      // the canvas size. Setting this only when the document changed left it
      // at the 1x1 default for the first frames and stale after every resize,
      // which does not degrade gracefully - the line is simply not drawn.
      const { width, height } = this.viewport.size;
      this.curveLayer.setResolution(width, height);
    });

    this.unsubscribeUi = useUiStore.subscribe((state, previous) =>
      this.onUiChanged(state, previous)
    );

    this.applyUiState();
    this.syncFromDocument();
    this.exposeForTesting();
    this.restoreSession();
  }

  /**
   * Publish the controller on `window.__riser` for end-to-end tests.
   *
   * Gated rather than unconditional: in a production build the handle only
   * appears with `?e2e=1` in the URL. A 3D editor holds no secrets, so this is
   * about keeping the public surface honest, not about hiding anything - tests
   * that assert on the real document beat tests that squint at pixels.
   */
  private exposeForTesting(): void {
    const wanted =
      import.meta.env.DEV ||
      (typeof location !== 'undefined' && location.search.includes('e2e'));
    if (!wanted) return;
    (window as unknown as { __riser?: RiserApp }).__riser = this;
  }

  unmount(): void {
    if (this.autosaveTimer) clearTimeout(this.autosaveTimer);
    this.autosaveTimer = null;
    this.subdivs?.dispose();
    this.subdivs = null;
    this.unsubscribeFrame?.();
    this.unsubscribeUi?.();
    this.unsubscribeDoc();
    this.toolManager?.dispose();
    this.cameraRig?.dispose();
    this.overlays?.dispose();
    this.markerLayer.dispose();
    this.curveLayer.dispose();
    this.viewport.dispose();
    disposeLoaders();
  }

  // -----------------------------------------------------------------------
  // Character
  // -----------------------------------------------------------------------

  async loadFromUrl(url: string): Promise<void> {
    await this.withLoading(`Loading ${basename(url)}`, () => loadCharacterFromUrl(url));
  }

  async loadFromFile(file: File): Promise<void> {
    await this.withLoading(`Loading ${file.name}`, () => loadCharacterFromFile(file));
  }

  private async withLoading(
    message: string,
    load: () => Promise<CharacterModel>
  ): Promise<void> {
    const ui = useUiStore.getState();
    ui.setLoading(message);
    ui.setError(null);
    try {
      this.setCharacter(await load());
    } catch (err) {
      ui.setError(err instanceof Error ? err.message : String(err));
    } finally {
      useUiStore.getState().setLoading(null);
    }
  }

  private setCharacter(model: CharacterModel): void {
    this.subdivs?.dispose();
    this.subdivs = null;
    this.viewport.clearCharacter();
    this.character = model;
    this.viewport.characterRoot.add(model.root);

    // Build the subdivision surfaces before framing, so the camera frames what
    // will actually be on screen.
    const ui0 = useUiStore.getState();
    this.subdivs = new SubdivSet(model.meshes);
    this.subdivs.setLevel(ui0.subdivLevel);
    ui0.setSubdivClamped(this.subdivs.clamped);

    const bounds = model.bounds;
    this.overlays?.fitTo(bounds);
    this.cameraRig?.frameObject(model.root, false);

    // A new character means new geometry; existing bindings are re-evaluated
    // against it rather than trusted, which is what makes swapping a mesh for
    // a higher-resolution build non-destructive.
    this.store.apply(
      (d) =>
        M.setCharacterRef(
          d,
          model.source.ref,
          model.source.metersPerUnit ?? d.metersPerUnit,
          model.source.upAxis ?? d.upAxis
        ),
      'Set character'
    );

    useUiStore
      .getState()
      .setCharacter(basename(model.source.ref), model.skeleton !== null);
    this.syncFromDocument();

    // Never open on an empty checklist when something can be worked out. A
    // rigged character contains the answer outright; an unrigged one can still
    // be measured. Skipped while restoring, where the checklist is already
    // full of the user's own work.
    if (!this.restoring) this.autoPlace({ announce: true });
  }

  /**
   * Fill in guides by the best means available.
   *
   * Tiers, best first. A skeleton is exact, so it always wins; measuring the
   * shape is a fallback that produces something plausible rather than
   * something correct, and says so through the confidence it records. Neither
   * ever touches a guide the user placed.
   */
  autoPlace(options: { announce?: boolean } = {}): number {
    const character = this.character;
    if (!character) return 0;

    if (character.skeleton) return this.autoPlaceFromSkeleton(options);
    return this.autoPlaceFromProportions(options);
  }

  /** True when there is anything for Auto-place to do. */
  get canAutoPlace(): boolean {
    return this.character !== null;
  }

  /**
   * Fill in guides by measuring the character's shape.
   *
   * For the common case: an upload with no rig. Deliberately refuses rather
   * than guessing when the shape does not measure like a two-legged figure -
   * scattering human guides over a horse costs the user more than an empty
   * checklist does.
   */
  autoPlaceFromProportions(options: { announce?: boolean } = {}): number {
    const ui = useUiStore.getState();
    const character = this.character;
    if (!character) return 0;

    const template = getTemplate(ui.templateId);
    const result = placeGuidesFromProportions(
      character,
      this.documentRoot,
      template,
      this.store.document
    );

    if (result.guides.length === 0) {
      if (options.announce && result.reason) ui.setNotice(result.reason);
      return 0;
    }

    this.store.apply(
      (d) => M.placeGuides(d, result.guides),
      `Estimate ${result.guides.length} guides from the character's shape`
    );

    if (options.announce) {
      const confidence = Math.round((result.landmarks?.confidence ?? 0) * 100);
      ui.setNotice(
        `Estimated ${result.guides.length} guides from the character's shape ` +
          `(${confidence}% confident). Check them before exporting.`
      );
    }

    const next = result.unmatched[0];
    if (next) ui.setActiveGuideId(next);

    return result.guides.length;
  }

  /**
   * Fill in guides from the character's own skeleton.
   *
   * Never touches a guide the user placed - see `autoReplaceableIds`. Safe to
   * run repeatedly, which is why it can be both automatic on load and a button.
   */
  autoPlaceFromSkeleton(options: { announce?: boolean } = {}): number {
    const ui = useUiStore.getState();
    const character = this.character;
    if (!character) return 0;

    if (!character.skeleton) {
      if (options.announce) {
        ui.setNotice('This character has no skeleton, so there is nothing to read.');
      }
      return 0;
    }

    const template = getTemplate(ui.templateId);
    const result = placeGuidesFromSkeleton(
      character,
      this.documentRoot,
      template,
      this.store.document
    );

    if (result.guides.length === 0) {
      if (options.announce) {
        ui.setNotice(
          'The skeleton did not match any of this template\'s guides. Place them by hand.'
        );
      }
      return 0;
    }

    this.store.apply(
      (d) => M.placeGuides(d, result.guides),
      `Place ${result.guides.length} guides from skeleton`
    );

    if (options.announce) {
      const remaining = result.unmatched.length;
      ui.setNotice(
        `Placed ${result.guides.length} guides from the rig` +
          (remaining > 0 ? `. ${remaining} still need placing by hand.` : '.')
      );
    }

    // Point the checklist at the first thing still to do.
    const next = result.unmatched[0];
    if (next) ui.setActiveGuideId(next);

    return result.guides.length;
  }

  get characterModel(): CharacterModel | null {
    return this.character;
  }

  // -----------------------------------------------------------------------
  // Session
  // -----------------------------------------------------------------------

  /**
   * Write the document to the session slot shortly after it stops changing.
   *
   * Debounced rather than immediate: dragging a marker produces a mutation per
   * frame, and serializing the whole layer sixty times a second to write it
   * into localStorage would be felt.
   */
  private scheduleAutosave(): void {
    if (this.restoring) return;
    if (this.autosaveTimer) clearTimeout(this.autosaveTimer);
    this.autosaveTimer = setTimeout(() => {
      this.autosaveTimer = null;
      this.saveSessionNow();
    }, AUTOSAVE_DELAY_MS);
  }

  /** Write immediately. Exposed so tests do not have to wait on a timer. */
  saveSessionNow(): boolean {
    const doc = this.store.document;
    if (!isWorthSaving(doc)) return false;
    try {
      return saveSession(doc, window.localStorage);
    } catch {
      return false;
    }
  }

  /** Forget the stored session. Used by "start over". */
  forgetSession(): void {
    try {
      clearSession(window.localStorage);
    } catch {
      // Nothing depends on this having worked.
    }
  }

  /**
   * Bring back whatever was open when the tab last closed.
   *
   * The document always comes back. The CHARACTER only comes back when its
   * reference is something the browser can fetch again - a bundled asset or a
   * URL. An upload is just a file name here: those bytes lived in the user's
   * file picker and were never ours to keep, so the guides are restored and
   * the user is told to reopen the mesh rather than being left with markers
   * bound to nothing.
   */
  private restoreSession(): void {
    let snapshot: ReturnType<typeof loadSession> = null;
    try {
      snapshot = loadSession(window.localStorage);
    } catch {
      return;
    }
    if (!snapshot) return;

    const ui = useUiStore.getState();
    this.restoring = true;
    this.store.reset(snapshot.doc);
    if (snapshot.doc.templateId) ui.setTemplateId(snapshot.doc.templateId);

    const ref = snapshot.characterRef;
    if (!isReloadableRef(ref)) {
      this.restoring = false;
      this.syncFromDocument();
      ui.setNotice(
        `Restored your last document. Load ${ref || 'the character'} again to ` +
          'see the markers on the mesh.'
      );
      return;
    }

    void this.loadFromUrl(ref)
      .then(() => {
        ui.setNotice('Restored your last document.');
      })
      .catch(() => {
        ui.setNotice(
          'Restored your last document, but its character could not be loaded.'
        );
      })
      .finally(() => {
        this.restoring = false;
        this.syncFromDocument();
      });
  }

  /**
   * The anchor for DOCUMENT space - the loaded asset's own root, not the
   * viewport's character root.
   *
   * Between the two sit transforms that exist only for display: the units
   * scale and up-axis flip three's USD composer applies, and the ground-align
   * and recentre from normalize.ts. None of them exist on the stage the worker
   * opens, so anchoring above them would store positions the server cannot
   * reproduce. See src/io/document-space.test.ts.
   */
  get documentRoot(): THREE.Object3D {
    return this.character?.root ?? this.viewport.characterRoot;
  }

  get subdivStats(): { level: number; cageFaces: number; limitFaces: number } | null {
    if (!this.subdivs) return null;
    return { level: this.subdivs.currentLevel, ...this.subdivs.totals };
  }

  // -----------------------------------------------------------------------
  // Document -> scene
  // -----------------------------------------------------------------------

  /**
   * Rebuild the overlay layers from the document.
   *
   * Positions come from the BINDING where one exists, not from the stored
   * position. The two agree in the session that authored them, but after a
   * reload against different geometry only the binding is still true - and
   * preferring it here is what makes a character swap re-seat the markers
   * instead of leaving them floating.
   */
  syncFromDocument(): void {
    const doc = this.store.document;
    const ui = useUiStore.getState();

    this.markerLayer.setMarkers(
      doc.guides.map((guide) => ({
        id: guide.id,
        position: this.resolveWorld(guide.position, guide.binding),
        state:
          guide.id === ui.selectedGuideId || guide.id === ui.activeGuideId
            ? 'active'
            : // A guess the app made reads differently from a position the
              // user stood behind.
              guide.source === 'user'
              ? 'placed'
              : 'suggested'
      }))
    );

    this.curveLayer.setCurves(
      doc.curves.map((curve) => {
        const points = curve.points.map((p) =>
          vec3(this.resolveWorld(p.position, p.binding))
        );
        return {
          id: curve.id,
          points,
          polyline: this.projectCurve(points, curve.points.map((p) => p.normal), curve.closed),
          closed: curve.closed,
          active: curve.id === ui.activeCurveId
        };
      })
    );

  }

  /**
   * Resample a curve and pull the samples back onto the character.
   *
   * Without this the smooth curve cuts through convex forms and floats off
   * concave ones - a traced jawline disappears inside the head between control
   * vertices. Returns undefined when there is no character to project against,
   * which tells the layer to interpolate plainly instead.
   */
  private projectCurve(
    worldPoints: Vec3[],
    normals: Vec3[],
    closed: boolean
  ): Vec3[] | undefined {
    if (!this.character || worldPoints.length < 2) return undefined;

    const samples = resampleCurve(worldPoints, closed, DEFAULT_SAMPLES_PER_SEGMENT);
    if (samples.length < 2) return undefined;

    const worldNormals = normals.map((n) =>
      vec3(documentToWorldDirection(this.documentRoot, n))
    );
    const height = this.character.bounds.getSize(new THREE.Vector3()).y;

    return projectSamplesToSurface(
      samples,
      interpolateNormals(worldNormals, samples.length, closed),
      this.character.meshes,
      this.projectionRaycaster,
      {
        searchDistance: Math.max(height * SEARCH_FRACTION, 1e-4),
        // Control vertices are already bound to a triangle; moving them would
        // contradict the binding the server evaluates.
        pinned: controlVertexSampleIndices(
          worldPoints.length,
          DEFAULT_SAMPLES_PER_SEGMENT,
          closed
        )
      }
    );
  }

  private resolveWorld(
    position: Vec3,
    binding: { primPath: string; faceIndex: number; barycentric: Vec3; offset: Vec3 } | null
  ): THREE.Vector3 {
    if (binding && this.character) {
      const mesh =
        this.character.meshForPrimPath(binding.primPath) ?? this.character.primaryMesh;
      if (mesh) {
        const world = resolveBindingWorld(mesh, binding);
        if (world) return world;
      }
    }
    return documentToWorld(this.documentRoot, position);
  }

  // -----------------------------------------------------------------------
  // Commands the UI calls
  // -----------------------------------------------------------------------

  frameCharacter(): void {
    if (this.character) this.cameraRig?.frameObject(this.character.root);
  }

  frameSelection(): void {
    const ui = useUiStore.getState();
    const id = ui.selectedGuideId ?? ui.activeGuideId;
    if (!id) return this.frameCharacter();
    const position = this.markerLayer.positionOf(id);
    if (!position) return this.frameCharacter();
    const height = this.character
      ? this.character.bounds.getSize(new THREE.Vector3()).y
      : 1;
    this.cameraRig?.framePoint(position, height * 0.08);
  }

  setView(view: 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom'): void {
    this.cameraRig?.setView(view);
  }

  resetView(): void {
    this.cameraRig?.reset();
  }

  undo(): void {
    this.store.undo();
  }

  redo(): void {
    this.store.redo();
  }

  loadDocument(doc: RiserDocument): void {
    this.store.reset(doc);
    useUiStore.getState().setTemplateId(doc.templateId);
    this.syncFromDocument();
  }

  newDocument(templateId: string): void {
    this.store.reset(
      createDocument(templateId, this.character?.source.ref ?? '', {
        metersPerUnit: this.character?.source.metersPerUnit ?? 0.01,
        upAxis: this.character?.source.upAxis ?? 'Y'
      })
    );
    useUiStore.getState().setTemplateId(templateId);
  }

  /** Drop guides and curves the newly chosen template does not define. */
  applyTemplateChange(templateId: string): void {
    const template = getTemplate(templateId);
    this.store.apply(
      (d) =>
        M.setTemplate(
          d,
          templateId,
          new Set(template.guides.map((g) => g.id)),
          new Set(template.curves.map((c) => c.id))
        ),
      `Switch to ${template.label}`
    );
  }

  clearGuides(): void {
    this.store.apply((d) => M.removeAllGuides(d), 'Clear all markers');
  }

  clearCurves(): void {
    this.store.apply((d) => M.removeAllCurves(d), 'Clear all curves');
  }

  // -----------------------------------------------------------------------
  // UI state -> scene
  // -----------------------------------------------------------------------

  private onUiChanged(state: ReturnType<typeof useUiStore.getState>, previous: ReturnType<typeof useUiStore.getState>): void {
    if (state.activeTool !== previous.activeTool) {
      this.toolManager?.setActive(state.activeTool);
    }
    if (state.dark !== previous.dark) {
      this.viewport.setTheme(state.dark);
      this.overlays?.setTheme(state.dark);
    }
    if (state.showGrid !== previous.showGrid) {
      this.overlays?.setGridVisible(state.showGrid);
    }
    if (state.symmetry !== previous.symmetry) {
      this.overlays?.setSymmetryVisible(state.symmetry);
    }
    if (state.subdivLevel !== previous.subdivLevel && this.subdivs) {
      this.subdivs.setLevel(state.subdivLevel);
      useUiStore.getState().setSubdivClamped(this.subdivs.clamped);
      // Markers deliberately do NOT move. Their offsets were measured against
      // the surface the user clicked, and re-deriving them on a level change
      // would relocate work the user already did.
    }
    if (state.xray !== previous.xray) {
      this.markerLayer.setXray(state.xray);
      this.curveLayer.setXray(state.xray);
    }
    if (state.showMarkers !== previous.showMarkers) {
      this.markerLayer.setVisible(state.showMarkers);
    }
    if (state.showCurves !== previous.showCurves) {
      this.curveLayer.setVisible(state.showCurves);
    }
    if (
      state.activeGuideId !== previous.activeGuideId ||
      state.selectedGuideId !== previous.selectedGuideId ||
      state.activeCurveId !== previous.activeCurveId
    ) {
      this.syncFromDocument();
    }
    if (state.templateId !== previous.templateId) {
      this.syncFromDocument();
    }
  }

  private applyUiState(): void {
    const ui = useUiStore.getState();
    this.viewport.setTheme(ui.dark);
    this.overlays?.setGridVisible(ui.showGrid);
    this.overlays?.setSymmetryVisible(ui.symmetry);
    this.markerLayer.setXray(ui.xray);
    this.curveLayer.setXray(ui.xray);
    this.markerLayer.setVisible(ui.showMarkers);
    this.curveLayer.setVisible(ui.showCurves);
  }

  // -----------------------------------------------------------------------
  // Tool wiring
  // -----------------------------------------------------------------------

  private markerToolDeps() {
    return {
      viewport: this.viewport,
      picker: this.picker,
      layer: this.markerLayer,
      store: this.store,
      getCharacter: () => this.character,
      getDocumentRoot: () => this.documentRoot,
      getTemplate: () => getTemplate(useUiStore.getState().templateId),
      getActiveGuideId: () => useUiStore.getState().activeGuideId,
      setActiveGuideId: (id: string | null) =>
        useUiStore.getState().setActiveGuideId(id),
      getSelectedGuideId: () => useUiStore.getState().selectedGuideId,
      setSelectedGuideId: (id: string | null) =>
        useUiStore.getState().setSelectedGuideId(id),
      isSymmetryEnabled: () => useUiStore.getState().symmetry,
      onNotice: (message: string) => useUiStore.getState().setNotice(message)
    };
  }

  private curveToolDeps() {
    return {
      viewport: this.viewport,
      picker: this.picker,
      layer: this.curveLayer,
      store: this.store,
      getCharacter: () => this.character,
      getDocumentRoot: () => this.documentRoot,
      getTemplate: () => getTemplate(useUiStore.getState().templateId),
      getActiveCurveId: () => useUiStore.getState().activeCurveId,
      setActiveCurveId: (id: string | null) => useUiStore.getState().setActiveCurveId(id),
      getSelectedPoint: () => useUiStore.getState().selectedPoint,
      setSelectedPoint: (ref: { curveId: string; index: number } | null) =>
        useUiStore.getState().setSelectedPoint(ref),
      isSymmetryEnabled: () => useUiStore.getState().symmetry,
      onNotice: (message: string) => useUiStore.getState().setNotice(message)
    };
  }
}

function vec3(v: THREE.Vector3): Vec3 {
  return [v.x, v.y, v.z];
}

function basename(path: string): string {
  const clean = path.split(/[?#]/)[0] ?? path;
  return clean.split(/[\\/]/).pop() || clean;
}
