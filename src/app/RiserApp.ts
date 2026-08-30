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
import { Picker, resolveBindingWorld } from '../viewport/Picker';
import { Overlays } from '../viewport/Overlays';
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
import { useUiStore } from './state';

export class RiserApp {
  readonly viewport: Viewport;
  readonly store: DocumentStore;

  private cameraRig: CameraRig | null = null;
  private toolManager: ToolManager | null = null;
  private overlays: Overlays | null = null;
  private picker: Picker;
  private markerLayer: MarkerLayer;
  private curveLayer: CurveLayer;

  private character: CharacterModel | null = null;
  private unsubscribeDoc: () => void;
  private unsubscribeUi: (() => void) | null = null;
  private unsubscribeFrame: (() => void) | null = null;

  /** Raycaster used for re-seating curve samples onto the surface. */
  private readonly projectionRaycaster = new THREE.Raycaster();

  constructor() {
    const ui = useUiStore.getState();

    this.viewport = new Viewport({ dark: ui.dark });
    this.picker = new Picker(this.viewport.camera);
    this.markerLayer = new MarkerLayer(this.viewport.overlayRoot);
    this.curveLayer = new CurveLayer(this.viewport.overlayRoot);

    this.store = new DocumentStore(createDocument(ui.templateId, ''));
    this.unsubscribeDoc = this.store.subscribe(() => {
      useUiStore.getState().bumpDoc(this.store.isDirty);
      this.syncFromDocument();
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
    });

    this.unsubscribeUi = useUiStore.subscribe((state, previous) =>
      this.onUiChanged(state, previous)
    );

    this.applyUiState();
    this.syncFromDocument();
    this.exposeForTesting();
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
    this.viewport.clearCharacter();
    this.character = model;
    this.viewport.characterRoot.add(model.root);

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
  }

  get characterModel(): CharacterModel | null {
    return this.character;
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
          guide.id === ui.selectedGuideId
            ? 'active'
            : guide.id === ui.activeGuideId
              ? 'active'
              : 'placed'
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

    const { width, height } = this.viewport.size;
    this.curveLayer.setResolution(width, height);
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
      vec3(documentToWorldDirection(this.viewport.characterRoot, n))
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
    return documentToWorld(this.viewport.characterRoot, position);
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
