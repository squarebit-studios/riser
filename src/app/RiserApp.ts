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
import { ViewModeController } from '../viewport/ViewModes';
import { SkeletonView } from '../viewport/SkeletonView';
import { documentToWorld, documentToWorldDirection } from '../viewport/space';
import { nearestPointOnMeshes } from '../viewport/nearest';
import { withDoubleSided } from '../viewport/Picker';
import { accelerate, releaseAcceleration, setPosed } from '../viewport/acceleration';
import { EyeMaterials } from '../viewport/EyeMaterials';
import { readEyeLooks } from '../io/eyeLook';
import { AnimationPlayer, type AddClipsResult } from '../viewport/animation';
import { CharacterModel } from '../io/CharacterModel';
import {
  loadCharacterFromFile,
  loadCharacterFromUrl,
  loadClipsFromFile,
  disposeLoaders
} from '../io/loadCharacter';
import { DocumentStore } from '../doc/history';
import * as M from '../doc/mutations';
import { createDocument, type RiserDocument, type Vec3 } from '../doc/types';
import {
  LocalStorageDocuments,
  StorageError,
  type DocumentStorage,
  type DocumentSummary
} from '../doc/storage';
import { getTemplate } from '../templates';
import { placeGuidesFromSkeleton } from '../tools/autoplace/fromSkeleton';
import { placeGuidesFromProportions } from '../tools/autoplace/fromProportions';
import { placeGuidesFromQuadruped } from '../tools/autoplace/fromQuadruped';
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
  exportRefFor,
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

/**
 * Face count above which smoothing is worth a warning.
 *
 * Not a hard limit - the app stays usable past it - but the point where a
 * character stops feeling immediate, so the user gets told before the next
 * level makes it worse.
 */
const HEAVY_LIMIT_FACES = 600_000;

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
  private viewModes: ViewModeController | null = null;
  private skeletonView = new SkeletonView();

  /**
   * Clip playback. Public because the Animation panel drives it directly.
   *
   * It lives on the controller rather than in the panel for the same reason
   * everything else here does: it holds three.js state, it has to be ticked by
   * the frame loop, and it must survive the panel being unmounted when the
   * user switches back to the Details tab.
   */
  readonly animation = new AnimationPlayer();

  /**
   * Whether the raycast acceleration has been told the character is posed.
   *
   * Mirrored here rather than asked of `setPosed` because the answer has to be
   * pushed on a TRANSITION, not every frame: switching every mesh's raycast
   * sixty times a second to the same value it already had would undo the point
   * of accelerating them.
   */
  private posedForPicking = false;
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
  /**
   * Where the current character was fetched from.
   *
   * Kept apart from the document's `characterRef`, which is what gets written
   * into an exported layer. This is a URL this browser can request again; that
   * is a relative path meant to resolve beside the exported file.
   */
  private characterUrl = '';

  /**
   * The Squarebit Eye looks on the current character, and the materials built
   * from them.
   *
   * A Squarebit Eye is a refracted iris projection, which no USD surface
   * schema can express - so without this a character with real eyes renders as
   * a pair of white spheres. Riser's face template asks for eye guides, and an
   * eye guide is placed by aiming at an iris, a limbus and a pupil. The
   * landmarks the marker exists to record were exactly what the missing shader
   * was hiding.
   */
  private readonly eyes = new EyeMaterials();

  /**
   * Named documents.
   *
   * Local for now. `ServerDocuments` implements the same interface, so signing
   * in later is a matter of swapping this rather than rewriting the callers -
   * which is why the interface exists at all.
   */
  private readonly library: DocumentStorage = new LocalStorageDocuments();
  /** The saved document currently open, so Save updates rather than duplicates. */
  private openDocumentId: string | null = null;

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

    // Follows what is DISPLAYED, which is the cage at subdivision level 0 and
    // the limit surface above it - not the character's mesh list, which is
    // always the cages.
    this.viewport.scene.add(this.skeletonView.object);

    this.viewModes = new ViewModeController(() =>
      this.subdivs?.displayedMeshes() ?? this.character?.meshes ?? []
    );

    this.cameraRig = new CameraRig(this.viewport.camera, canvas);
    this.overlays = new Overlays(this.viewport.overlayRoot);
    this.toolManager = new ToolManager(canvas, this.cameraRig);

    this.toolManager.register(new MarkerTool(this.markerToolDeps()));
    this.toolManager.register(new CurveTool(this.curveToolDeps()));
    this.toolManager.setActive(useUiStore.getState().activeTool);

    this.unsubscribeFrame = this.viewport.onFrame((dt) => {
      // First in the frame, so everything below - the skeleton overlay in
      // particular - reads bones that have already been posed for this frame
      // rather than last frame's. Cheap when nothing is playing.
      this.animation.update(dt);

      // A BVH indexes REST geometry, so the fast raycast is only correct while
      // the skeleton sits at its bind pose. The moment a clip drives the rig,
      // picking has to go back to three's skinning-aware raycast or a marker
      // placed against the moving character binds to the triangle that used to
      // be under the cursor - a wrong binding, written silently, which is the
      // one failure this application cannot tolerate.
      //
      // Checked here rather than pushed from the player because the player
      // must not know about picking, and because every path that poses the
      // character - play, scrub, choose a clip, load a new one - passes
      // through this loop anyway.
      if (this.animation.posed !== this.posedForPicking) {
        this.posedForPicking = this.animation.posed;
        setPosed(this.posedForPicking);
      }
      this.cameraRig?.update(dt);
      this.toolManager?.update(dt);
      // Both layers keep their points screen-constant, and the active tool
      // only updates its own, so update the other one here.
      this.markerLayer.update(this.viewport.camera);
      this.curveLayer.update(this.viewport.camera);
      // Cheap when hidden - it returns immediately - and correct when shown
      // even if something else is driving the bones.
      this.skeletonView.update();

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
    this.viewModes?.dispose();
    this.viewModes = null;
    this.skeletonView.dispose();
    this.animation.dispose();
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

  /**
   * Give the character's eyes their real look, if it shipped with one.
   *
   * Reads the `squarebitEye:*` attributes straight out of the file rather than
   * from the loaded objects: three's USD composer builds meshes and materials
   * and has no reason to carry custom attributes onto them, so the look is in
   * the crate and nowhere else. See io/eyeLook.ts.
   *
   * Silent when there is nothing to do, which is most characters. A failure
   * here leaves the white stand-in that was already there and never costs the
   * character.
   */
  private async shadeEyes(model: CharacterModel): Promise<void> {
    // Re-fetched rather than plumbed through the loader. The browser has the
    // file in cache from the load that just happened, so this is cheap, and it
    // keeps the loader from having to hold bytes for a consumer it knows
    // nothing about.
    //
    // An uploaded character has no URL to re-read, so its eyes keep the white
    // stand-in. Worth fixing when uploads matter more than stock assets do.
    const url = this.characterUrl;
    if (!url) return;

    try {
      const response = await fetch(url);
      if (!response.ok) return;
      const source = url.endsWith('.usda')
        ? await response.text()
        : await response.arrayBuffer();

      const looks = readEyeLooks(source);
      if (looks.length === 0) return;

      const shaded = this.eyes.apply(model.meshes, looks, this.characterUrl);
      if (shaded > 0) {
        useUiStore
          .getState()
          .setNotice(
            shaded === 1
              ? 'Applied a Squarebit Eye look to one eye.'
              : `Applied Squarebit Eye looks to ${shaded} eyes.`
          );
      }
    } catch (error) {
      console.warn('Could not read Squarebit Eye looks from this character.', error);
    }
  }

  async loadFromUrl(url: string): Promise<void> {
    this.characterUrl = url;
    await this.withLoading(`Loading ${basename(url)}`, () => loadCharacterFromUrl(url));
  }

  async loadFromFile(file: File): Promise<void> {
    // An upload cannot be fetched again, so there is no URL to remember: the
    // bytes came from the user's file picker and were never ours to keep.
    this.characterUrl = '';
    await this.withLoading(`Loading ${file.name}`, () => loadCharacterFromFile(file));
  }

  /**
   * Add animation clips from an uploaded file to the character on screen.
   *
   * Separate from `loadFromFile` on purpose. Dropping a .glb on the viewport
   * REPLACES the character, and someone who wants to see their character walk
   * has no reason to expect that dropping a walk cycle throws their character
   * away - so the two arrive through two different controls, and this one
   * never touches the geometry.
   *
   * Clips that name nothing on the loaded character are refused with a reason
   * rather than added and left inert. See viewport/animation.ts.
   */
  async addAnimationFromFile(file: File): Promise<AddClipsResult> {
    const ui = useUiStore.getState();
    const empty: AddClipsResult = { added: [], rejected: [], warnings: [] };

    if (!this.character) {
      ui.setError('Load a character before adding animation to it.');
      return empty;
    }

    ui.setLoading(`Reading ${file.name}`);
    ui.setError(null);
    try {
      const { clips } = await loadClipsFromFile(file);
      if (clips.length === 0) {
        ui.setError(`${file.name} contains no animation.`);
        return empty;
      }

      const result = this.animation.addClips(clips);

      // One message, chosen by what actually happened. Reporting every clip
      // separately turns a two-clip file into two notifications, and the user
      // only ever wanted to know whether it worked.
      if (result.added.length === 0) {
        ui.setError(result.rejected[0]?.message ?? `Nothing in ${file.name} applies here.`);
      } else if (result.warnings.length > 0) {
        ui.setNotice(result.warnings[0]!);
      } else {
        const names = result.added.map((c) => c.name).join(', ');
        ui.setNotice(
          `Added ${names}. Nothing in the document changed - clips drive the mesh only.`
        );
      }
      return result;
    } catch (err) {
      ui.setError(err instanceof Error ? err.message : String(err));
      return empty;
    } finally {
      useUiStore.getState().setLoading(null);
    }
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
    // Put the old character's materials back before its meshes are discarded.
    this.viewModes?.dispose();
    this.subdivs?.dispose();
    this.subdivs = null;
    if (this.character) releaseAcceleration(this.character.root);
    // The previous character's eye materials and their textures go with it.
    this.eyes.dispose();
    this.viewport.clearCharacter();
    this.character = model;
    this.viewport.characterRoot.add(model.root);

    // Index the geometry before anything picks against it. Paid once, against
    // every raycast for the life of this character - see acceleration.ts.
    accelerate(model.root);

    void this.shadeEyes(model);

    // Build the subdivision surfaces before framing, so the camera frames what
    // will actually be on screen.
    const ui0 = useUiStore.getState();
    this.subdivs = new SubdivSet(model.meshes);
    this.subdivs.setLevel(ui0.subdivLevel);
    ui0.setSubdivClamped(this.subdivs.clamped);
    // A freshly built limit surface carries the material it was constructed
    // with and knows nothing about view modes, so the mode has to be reapplied
    // after every rebuild.
    this.viewModes?.setMode(ui0.viewMode);
    this.viewModes?.setSurfaceVisible(ui0.showGeometry);

    // The rig, if there is one. Shown only when asked for, but built now so
    // the toggle is instant rather than costing a traversal on first use.
    this.skeletonView.setCharacter(model.root);
    this.skeletonView.setVisible(ui0.showSkeleton);

    // Clips the asset brought with it, if any. Any clip the user had uploaded
    // is dropped here rather than carried over: it was bound by name to the
    // OLD character's bones, and re-binding it to a new one without saying so
    // is retargeting by accident.
    this.animation.setCharacter(
      model.root,
      model.animations,
      basename(model.source.ref)
    );

    const bounds = model.bounds;
    this.overlays?.fitTo(bounds);
    this.cameraRig?.frameObject(model.root, false);

    // A new character means new geometry; existing bindings are re-evaluated
    // against it rather than trusted, which is what makes swapping a mesh for
    // a higher-resolution build non-destructive.
    // The EXPORTED reference: a relative path beside the layer, not the served
    // path the browser fetched from. The latter resolves only inside this app,
    // so a layer carrying it opens nowhere else - which is the whole point of
    // referencing the asset rather than copying it.
    this.store.apply(
      (d) =>
        M.setCharacterRef(
          d,
          exportRefFor(model.source.ref),
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
    // Which measurement to use is a property of the TEMPLATE, not of the mesh.
    // A four-legged animal has to be sliced along its length rather than its
    // height, and the user has already told us which they are working on by
    // choosing the template.
    const result =
      template.id === 'quadruped'
        ? placeGuidesFromQuadruped(character, this.documentRoot, template, this.store.document)
        : placeGuidesFromProportions(
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
      return saveSession(doc, window.localStorage, this.characterUrl);
    } catch {
      return false;
    }
  }

  // -----------------------------------------------------------------------
  // The document library
  // -----------------------------------------------------------------------

  get currentDocumentId(): string | null {
    return this.openDocumentId;
  }

  async listDocuments(): Promise<DocumentSummary[]> {
    try {
      return await this.library.list();
    } catch {
      return [];
    }
  }

  /**
   * Save under a name, creating a new document or updating the open one.
   *
   * Passing a name always creates a NEW document, which is what "Save as"
   * means. Saving without one updates what is open, and falls back to creating
   * if nothing is.
   */
  async saveDocument(name?: string): Promise<DocumentSummary | null> {
    const ui = useUiStore.getState();
    const doc =
      name === undefined
        ? this.store.document
        : this.store.apply((d) => M.setName(d, name), 'Rename');

    try {
      const summary = await this.library.save(
        doc,
        name === undefined ? (this.openDocumentId ?? undefined) : undefined,
        this.characterUrl
      );
      this.openDocumentId = summary.id;
      this.store.markSaved();
      ui.setNotice(`Saved "${summary.name}".`);
      return summary;
    } catch (err) {
      ui.setError(
        err instanceof StorageError ? err.message : 'Could not save the document.'
      );
      return null;
    }
  }

  /**
   * Open a saved document, and put its character back on screen.
   *
   * The character is reloaded from the URL recorded when it was saved, not
   * from the layer's own reference - that is a path relative to an exported
   * file and means nothing to a browser. Automatic placement is suppressed
   * throughout, exactly as it is for a session restore: this document already
   * holds the user's work.
   */
  async openDocument(id: string): Promise<boolean> {
    const ui = useUiStore.getState();
    try {
      const { summary, doc } = await this.library.load(id);
      this.restoring = true;
      this.store.reset(doc);
      this.openDocumentId = id;
      ui.setTemplateId(doc.templateId);

      const url = summary.loadUrl ?? '';
      if (isReloadableRef(url)) {
        await this.loadFromUrl(url);
      } else {
        ui.setNotice(
          `Opened "${summary.name}". Load its character again to see the markers ` +
            'on the mesh.'
        );
      }
      return true;
    } catch (err) {
      ui.setError(
        err instanceof StorageError ? err.message : 'Could not open the document.'
      );
      return false;
    } finally {
      this.restoring = false;
      this.syncFromDocument();
      this.store.markSaved();
    }
  }

  async deleteDocument(id: string): Promise<void> {
    try {
      await this.library.remove(id);
      if (this.openDocumentId === id) this.openDocumentId = null;
    } catch (err) {
      useUiStore
        .getState()
        .setError(
          err instanceof StorageError ? err.message : 'Could not delete the document.'
        );
    }
  }

  /** Start a new document, keeping the character that is already loaded. */
  startNewDocument(): void {
    this.openDocumentId = null;
    this.newDocument(useUiStore.getState().templateId);
    this.forgetSession();
    this.autoPlace({ announce: false });
  }

  /** Change the reference written into the exported layer. */
  setCharacterRef(ref: string): void {
    this.store.apply((d) => M.setCharacterRef(d, ref), 'Set character reference');
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

    const url = snapshot.loadUrl;
    if (!isReloadableRef(url)) {
      this.restoring = false;
      this.syncFromDocument();
      ui.setNotice(
        `Restored your last document. Load ${
          snapshot.doc.characterRef.replace(/^\.\//, '') || 'the character'
        } again to see the markers on the mesh.`
      );
      return;
    }

    void this.loadFromUrl(url)
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

    // Positions may have moved, so every measured depth is now suspect.
    this.depthRevision++;
    this.depthCache.clear();

    // The document is the source of truth for which template is in use, and
    // the UI store only mirrors it. Reconciling here rather than at each call
    // site covers switching, undo, redo and opening a saved document at once.
    //
    // Worth stating because the failure was quiet: switching the template used
    // to write the document alone, React re-rendered the picker back to the
    // old value, and from then on the two disagreed - so choosing Quadruped
    // and loading a horse still ran the biped measurement and placed nothing.
    if (ui.templateId !== doc.templateId) ui.setTemplateId(doc.templateId);

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
          polyline: hugsSurface(curve, this.characterHeight)
            ? this.projectCurve(
                points,
                curve.points.map((p) => p.normal),
                curve.closed
              )
            : undefined,
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
  /** The character's height in document units, for depth comparisons. */
  private get characterHeight(): number {
    if (!this.character) return 1;
    return Math.max(this.character.bounds.getSize(new THREE.Vector3()).y, 1e-3);
  }

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

  /**
   * How far inside the character a guide sits, in document units.
   *
   * Positive is inside, negative is outside, zero is on the skin.
   *
   * MEASURED GEOMETRICALLY, not read off the binding. The first version
   * computed the inward component of the offset along the guide's normal,
   * which is exactly what a placement mode sets - and which is wrong for any
   * guide a placement mode did not set. Automatic placement stores its normal
   * pointing the other way, so an auto-placed chest reported "26 cm ABOVE the
   * surface" when it was sitting correctly inside the body. A readout that
   * only makes sense for guides placed one particular way is worse than none,
   * because it is the thing the user checks when they suspect a problem.
   *
   * So: distance to the nearest surface, signed by whether the point is
   * actually inside the mesh. True for every guide, however it got there.
   */
  placementDepth(guideId: string): number {
    const guide = this.store.document.guides.find((g) => g.id === guideId);
    if (!guide || !this.character) return 0;

    const cached = this.depthCache.get(guideId);
    if (cached && cached.revision === this.depthRevision) return cached.depth;

    const world = documentToWorld(this.documentRoot, guide.position);

    // Measured against the mesh the marker is BOUND to, not every mesh on the
    // character.
    //
    // This is both faster and more honest. Faster because the search is brute
    // force over triangles: on a 137k-triangle character it took 576ms, which
    // the inspector then paid twice on every render and the user felt as a
    // marker taking a second and a half to appear. More honest because the
    // question is "how far below its own surface does this sit" - and on a
    // clothed character the nearest surface to a marker in the hip can be a
    // sleeve, which answers a different question.
    const bound = guide.binding
      ? this.character.meshForPrimPath(guide.binding.primPath)
      : undefined;
    const searched = bound ? [bound] : this.character.meshes;

    const nearest = nearestPointOnMeshes(searched, world);
    const depth = nearest
      ? (this.isInsideCharacter(world) ? 1 : -1) * nearest.worldPoint.distanceTo(world)
      : 0;

    this.depthCache.set(guideId, { revision: this.depthRevision, depth });
    return depth;
  }

  /**
   * Memoised depths, and the revision they were measured at.
   *
   * The inspector asks for this while rendering, which React does freely and
   * often. Recomputing a raycast-and-nearest-point search each time turned a
   * readout into the most expensive thing in the application.
   */
  private readonly depthCache = new Map<string, { revision: number; depth: number }>();
  private depthRevision = 0;

  /**
   * Whether a world point lies inside the character.
   *
   * Cast a ray out from the point: if the first surface it crosses is facing
   * AWAY (an exit face), we started inside it. Parity on the raw crossing
   * count would be simpler and wrong, because a clothed character nests - a
   * point inside Gary's hip exits his body and then his spacesuit, two
   * crossings, which even-odd counting calls "outside".
   *
   * The direction is deliberately not axis-aligned, so a point sitting exactly
   * on a symmetry plane or an axis-aligned face does not graze every polygon
   * it meets.
   */
  private isInsideCharacter(world: THREE.Vector3): boolean {
    const character = this.character;
    if (!character) return false;

    // Several directions, and a majority vote.
    //
    // One ray is not enough, and the failure is not rare: a single direction
    // can graze a face, leave through a seam between two pieces, or exit at a
    // spot where the winding is inconsistent, and the answer flips. A marker
    // correctly at the centre of the biped torso was reported as "3.4 cm
    // ABOVE the surface" for exactly that reason - a readout that is wrong
    // when the user is checking a suspicion is worse than no readout.
    const directions = [
      new THREE.Vector3(0.371, 0.826, 0.424),
      new THREE.Vector3(-0.802, 0.331, 0.497),
      new THREE.Vector3(0.263, -0.905, 0.334),
      new THREE.Vector3(0.577, 0.211, -0.789),
      new THREE.Vector3(-0.451, -0.532, -0.717)
    ].map((d) => d.normalize());

    let votesInside = 0;
    let votesCast = 0;

    // Double-sided for the same reason the through-pick is: a front-facing
    // material hides exactly the exit faces this needs to see.
    withDoubleSided(character.meshes, () => {
      const raycaster = new THREE.Raycaster();
      const normalMatrix = new THREE.Matrix3();

      for (const direction of directions) {
        raycaster.set(world.clone(), direction);
        for (const hit of raycaster.intersectObjects(character.meshes, true)) {
          const faceNormal = hit.face?.normal;
          if (!faceNormal) continue;
          hit.object.updateWorldMatrix(true, false);
          const worldNormal = faceNormal
            .clone()
            .applyMatrix3(normalMatrix.getNormalMatrix(hit.object.matrixWorld))
            .normalize();
          // A grazing hit says nothing about which side we are on.
          const facing = worldNormal.dot(direction);
          if (Math.abs(facing) < 0.05) continue;
          votesCast++;
          if (facing > 0) votesInside++;
          break;
        }
      }
    });

    return votesCast > 0 && votesInside * 2 > votesCast;
  }

  /**
   * What a click at this screen position actually crosses.
   *
   * A diagnostic for the tests and for working out why a placement went where
   * it did. Volume measurement depends on geometry nobody can see, so without
   * a way to read the crossings back the only tool left is guessing.
   */
  debugThrough(x: number, y: number): {
    primPath: string;
    z: number;
    facing: 'in' | 'out';
    distance: number;
  }[] {
    const character = this.character;
    if (!character) return [];
    const { width, height } = this.viewport.size;
    const hits = this.picker.pickThrough(x, y, width, height, character.meshes);

    const direction = new THREE.Vector3();
    this.viewport.camera.getWorldDirection(direction);
    return hits.map((hit) => ({
      primPath: hit.primPath.split('/').pop() ?? '',
      z: Number(hit.point.z.toFixed(4)),
      facing: hit.normal.dot(direction) < 0 ? 'in' : 'out',
      distance: Number(hit.distance.toFixed(4))
    }));
  }

  /** A guide's position in world space. A diagnostic, like debugThrough. */
  guideWorld(guideId: string): [number, number, number] | null {
    const guide = this.store.document.guides.find((g) => g.id === guideId);
    if (!guide) return null;
    const w = documentToWorld(this.documentRoot, guide.position);
    return [w.x, w.y, w.z];
  }

  clearGuides(): void {
    this.store.apply((d) => M.removeAllGuides(d), 'Clear all markers');
  }

  /** Remove one guide, so its slot goes back to unplaced. */
  clearGuide(id: string): void {
    if (!this.store.document.guides.some((g) => g.id === id)) return;
    const label = getTemplate(useUiStore.getState().templateId).guides.find(
      (g) => g.id === id
    )?.label;
    this.store.apply((d) => M.removeGuide(d, id), `Clear ${label ?? id}`);
  }

  /** Accept an automatic guess as the user's own, without moving it. */
  confirmGuide(id: string): void {
    const guide = this.store.document.guides.find((g) => g.id === id);
    if (!guide || guide.source === 'user') return;
    const label = getTemplate(useUiStore.getState().templateId).guides.find(
      (g) => g.id === id
    )?.label;
    this.store.apply((d) => M.confirmGuide(d, id), `Confirm ${label ?? id}`);
  }

  /** Accept every automatic guess at once. */
  confirmAllGuides(): number {
    const pending = this.store.document.guides.filter((g) => g.source !== 'user');
    if (pending.length === 0) return 0;
    this.store.apply(
      (d) => M.confirmAllGuides(d),
      `Confirm ${pending.length} suggested markers`
    );
    return pending.length;
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
    if (
      state.environment !== previous.environment ||
      state.useHdri !== previous.useHdri
    ) {
      void this.viewport.setEnvironment(state.environment, state.useHdri);
    }
    if (state.viewMode !== previous.viewMode) {
      this.viewModes?.setMode(state.viewMode);
    }
    if (state.subdivLevel !== previous.subdivLevel && this.subdivs) {
      this.subdivs.setLevel(state.subdivLevel);
      // A rebuilt limit surface is new geometry with no BVH of its own.
      if (this.character) accelerate(this.character.root);
      const ui = useUiStore.getState();
      ui.setSubdivClamped(this.subdivs.clamped);
      this.reportSubdivision(state.subdivLevel);
      // Changing the level rebuilds the displayed meshes, so the shading has
      // to be put back on the new ones.
      this.viewModes?.refresh();
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
    if (state.showGeometry !== previous.showGeometry) {
      this.viewModes?.setSurfaceVisible(state.showGeometry);
    }
    if (state.showSkeleton !== previous.showSkeleton) {
      this.skeletonView.setVisible(state.showSkeleton);
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

  /**
   * Say what smoothing actually did, when it is not what was asked for.
   *
   * Silence here is the bad outcome: someone drags the slider to 3, the
   * surface does not change, and nothing in the interface accounts for it.
   * They are left to conclude the control is broken rather than that their
   * character is too heavy for it.
   *
   * The message names the reason and the number, because "too heavy" without a
   * figure is not something the user can act on - and the action available to
   * them is a real one: decimate the mesh, or work at a lower level.
   */
  private reportSubdivision(requested: number): void {
    const subdivs = this.subdivs;
    if (!subdivs) return;
    const ui = useUiStore.getState();

    if (subdivs.clamped) {
      const effective = subdivs.effectiveLevel;
      ui.setNotice(
        `Smoothing level ${requested} is too heavy for this character - ` +
          `${subdivs.totalCageFaces().toLocaleString()} faces before smoothing. ` +
          `Showing level ${effective} instead.`
      );
      return;
    }

    // Not clamped, but close enough to be worth a word: the next level up is
    // where this character stops being interactive.
    const limitFaces = subdivs.totals.limitFaces;
    if (requested > 0 && limitFaces > HEAVY_LIMIT_FACES) {
      ui.setNotice(
        `Smoothed to ${limitFaces.toLocaleString()} faces. Higher levels may ` +
          'become slow on this character.'
      );
    }
  }

  private applyUiState(): void {
    const ui = useUiStore.getState();
    this.viewport.setTheme(ui.dark);
    void this.viewport.setEnvironment(ui.environment, ui.useHdri);
    this.overlays?.setGridVisible(ui.showGrid);
    this.overlays?.setSymmetryVisible(ui.symmetry);
    this.markerLayer.setXray(ui.xray);
    this.curveLayer.setXray(ui.xray);
    this.markerLayer.setVisible(ui.showMarkers);
    this.curveLayer.setVisible(ui.showCurves);
    this.viewModes?.setSurfaceVisible(ui.showGeometry);
    this.skeletonView.setVisible(ui.showSkeleton);
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
      getPlacementMode: () => useUiStore.getState().placementMode,
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
      getPlacementMode: () => useUiStore.getState().placementMode,
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

/**
 * Whether a curve is meant to lie on the skin.
 *
 * The display projection pulls a curve's samples back onto the mesh, because a
 * smooth curve otherwise cuts through convex forms and floats off concave ones
 * - a traced jawline vanishes inside the head between control vertices.
 *
 * But that is exactly the wrong thing to do to a curve the user deliberately
 * placed INSIDE the character. A spine curve run through the torso would be
 * dragged straight back out to the skin, silently undoing the placement mode
 * they chose.
 *
 * Decided by measurement rather than by a flag in the format: how far each
 * control vertex sits below its own surface, which the binding's offset
 * already records. Cage-to-limit offsets from subdivision are a fraction of a
 * face; a centre placement is half a limb thick. The two are not close.
 */
function hugsSurface(
  curve: { points: readonly { normal: Vec3; binding: { offset: Vec3 } | null }[] },
  characterHeight: number
): boolean {
  const limit = characterHeight * INTERIOR_CURVE_FRACTION;

  for (const point of curve.points) {
    const offset = point.binding?.offset;
    if (!offset) continue;
    // Depth below the surface is the inward component of the offset.
    const depth = -(
      offset[0] * point.normal[0] +
      offset[1] * point.normal[1] +
      offset[2] * point.normal[2]
    );
    if (depth > limit) return false;
  }
  return true;
}

/**
 * Below this fraction of the character's height, an offset is subdivision
 * gap rather than a deliberate placement inside the volume.
 */
const INTERIOR_CURVE_FRACTION = 0.01;

// ==========================================================================
// Hot reloading
//
// RiserApp owns imperative three.js state - a renderer, a picker, a
// subdivision cache, an environment controller - held in a single instance
// that React creates once and never recreates. Vite's Fast Refresh can swap a
// React component's code; it cannot swap the code inside a live object that
// component is merely holding.
//
// Without this, editing anything under src/viewport or src/tools left the
// running app on the OLD code while the module graph said otherwise. The
// result was not an obvious failure but a half-updated app: characters that
// silently stopped loading, a fix that appeared not to work, a stale Tailwind
// config serving classes that no longer existed. Every one of those cost real
// time to diagnose as "the dev server, not the code".
//
// So changes to this module - and to everything it imports, since the update
// propagates up to the nearest accepting boundary - reload the page instead.
// A full reload is slower than a hot patch and always correct, which is the
// right trade for a module like this one.
// ==========================================================================
if (import.meta.hot) {
  import.meta.hot.accept(() => {
    window.location.reload();
  });
}
