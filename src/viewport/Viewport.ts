// ==========================================================================
// Riser - Copyright (c) 2026 Squarebit LLC. All rights reserved.
//
// The three.js application. This file owns the renderer, the scene graph and
// the animation frame.
//
// React does NOT participate here. The React tree mounts a container div and
// hands it to `Viewport.attach()`; from that point the viewport drives itself
// at display rate. Anything that has to change per frame - marker transforms,
// curve geometry, hover highlighting - mutates three.js objects and typed
// arrays directly. React only re-renders when the user changes something in
// the chrome, which is why marker dragging stays smooth with hundreds of
// markers on screen.
// ==========================================================================

import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { VIEWPORT_COLORS } from './palette';

/** Render layer for the character and anything pickable. */
export const LAYER_SCENE = 0;
/** Render layer for markers, curves, grid and gizmos. */
export const LAYER_OVERLAY = 1;
/**
 * Pick-only layer for subdivision control cages.
 *
 * The camera never enables this layer, so anything on it is invisible - but
 * three's raycaster is gated by layers alone (Raycaster.js `intersect` tests
 * `object.layers`, never `object.visible`), so a cage here stays perfectly
 * pickable. That is what lets the user click a smooth limit surface while the
 * binding lands on the cage triangle underneath it.
 */
export const LAYER_CAGE = 2;

export interface ViewportOptions {
  /** Start in dark mode. Switchable later via `setTheme`. */
  dark?: boolean;
  /** Cap the device pixel ratio. 2 is plenty and halves the fill cost on 3x displays. */
  maxPixelRatio?: number;
}

type FrameCallback = (dt: number, elapsed: number) => void;

export class Viewport {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;

  /** Everything loaded from the character asset hangs off this. */
  readonly characterRoot = new THREE.Group();
  /** Markers, curves and helpers. Never picked against, never exported. */
  readonly overlayRoot = new THREE.Group();

  private container: HTMLElement | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private rafHandle = 0;
  private readonly clock = new THREE.Clock();
  private readonly frameCallbacks = new Set<FrameCallback>();
  private pmrem: THREE.PMREMGenerator | null = null;
  private envTexture: THREE.Texture | null = null;
  private dark: boolean;
  private disposed = false;

  /**
   * Set by tools while they are mid-interaction. The renderer keeps drawing
   * either way; this exists so the camera rig can stand down without the tool
   * having to know about the rig.
   */
  interactionLock: string | null = null;

  constructor(options: ViewportOptions = {}) {
    this.dark = options.dark ?? true;

    this.camera = new THREE.PerspectiveCamera(35, 1, 0.01, 1000);
    this.camera.position.set(0, 1.5, 3.5);
    this.camera.layers.enable(LAYER_OVERLAY);

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      // Needed for Playwright screenshot comparison - without it the drawing
      // buffer is undefined after the frame is presented.
      preserveDrawingBuffer: true
    });
    this.renderer.setPixelRatio(
      Math.min(window.devicePixelRatio, options.maxPixelRatio ?? 2)
    );
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = false;

    this.characterRoot.name = 'CharacterRoot';
    this.overlayRoot.name = 'OverlayRoot';
    this.scene.add(this.characterRoot, this.overlayRoot);

    this.setupEnvironment();
    this.setupLights();
    this.applyTheme();
  }

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  attach(container: HTMLElement): void {
    if (this.container) this.detach();

    this.container = container;
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.renderer.domElement.style.outline = 'none';
    this.renderer.domElement.tabIndex = 0;

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.start();
  }

  detach(): void {
    this.stop();
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    if (this.container?.contains(this.renderer.domElement)) {
      this.container.removeChild(this.renderer.domElement);
    }
    this.container = null;
  }

  start(): void {
    if (this.rafHandle || this.disposed) return;
    this.clock.start();
    const loop = () => {
      this.rafHandle = requestAnimationFrame(loop);
      this.tick();
    };
    this.rafHandle = requestAnimationFrame(loop);
  }

  stop(): void {
    if (this.rafHandle) cancelAnimationFrame(this.rafHandle);
    this.rafHandle = 0;
  }

  dispose(): void {
    this.detach();
    this.disposed = true;
    this.frameCallbacks.clear();
    this.envTexture?.dispose();
    this.pmrem?.dispose();
    disposeSubtree(this.scene);
    this.renderer.dispose();
  }

  // -----------------------------------------------------------------------
  // Frame
  // -----------------------------------------------------------------------

  /** Register a per-frame callback. Returns an unsubscribe function. */
  onFrame(cb: FrameCallback): () => void {
    this.frameCallbacks.add(cb);
    return () => this.frameCallbacks.delete(cb);
  }

  private tick(): void {
    const dt = this.clock.getDelta();
    const elapsed = this.clock.elapsedTime;
    for (const cb of this.frameCallbacks) cb(dt, elapsed);
    this.renderer.render(this.scene, this.camera);
  }

  /** Force a single frame. Used by tests, which do not run a rAF loop. */
  renderOnce(): void {
    this.renderer.render(this.scene, this.camera);
  }

  // -----------------------------------------------------------------------
  // Sizing and theme
  // -----------------------------------------------------------------------

  resize(): void {
    if (!this.container) return;
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  get size(): { width: number; height: number } {
    const target = new THREE.Vector2();
    this.renderer.getSize(target);
    return { width: target.x, height: target.y };
  }

  setTheme(dark: boolean): void {
    this.dark = dark;
    this.applyTheme();
  }

  get isDark(): boolean {
    return this.dark;
  }

  private applyTheme(): void {
    this.scene.background = new THREE.Color(
      this.dark ? VIEWPORT_COLORS.background : VIEWPORT_COLORS.backgroundLight
    );
  }

  // -----------------------------------------------------------------------
  // Scene setup
  // -----------------------------------------------------------------------

  private setupEnvironment(): void {
    // RoomEnvironment gives materials something plausible to reflect without
    // shipping an HDRI. The store's Eye widget uses the same one, so a
    // character looks consistent across our sites.
    this.pmrem = new THREE.PMREMGenerator(this.renderer);
    const env = new RoomEnvironment();
    this.envTexture = this.pmrem.fromScene(env, 0.04).texture;
    this.scene.environment = this.envTexture;
    env.dispose();
  }

  private setupLights(): void {
    // A soft key/fill pair on top of the IBL. Enough to read surface form on a
    // flat-shaded grey character, which is what most uploads will be.
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(2, 3, 2.5);
    const fill = new THREE.DirectionalLight(0xffffff, 0.5);
    fill.position.set(-2.5, 1, -2);
    const ambient = new THREE.AmbientLight(0xffffff, 0.25);
    key.layers.enableAll();
    fill.layers.enableAll();
    ambient.layers.enableAll();
    this.scene.add(key, fill, ambient);
  }

  /** Remove and dispose whatever character is currently loaded. */
  clearCharacter(): void {
    disposeSubtree(this.characterRoot);
    this.characterRoot.clear();
  }
}

/** Dispose every geometry and material below `root`, without removing `root`. */
export function disposeSubtree(root: THREE.Object3D): void {
  root.traverse((obj) => {
    const mesh = obj as Partial<THREE.Mesh>;
    mesh.geometry?.dispose();
    const material = mesh.material;
    if (Array.isArray(material)) {
      material.forEach((m) => m.dispose());
    } else {
      material?.dispose();
    }
  });
}
