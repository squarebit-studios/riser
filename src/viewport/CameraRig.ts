// ==========================================================================
// Riser - Copyright (c) 2026 Squarebit LLC. All rights reserved.
//
// Camera navigation and framing.
//
// Built on OrbitControls rather than a hand-rolled rig: it is battle-tested,
// and the behaviour we actually need on top of it is framing, not a different
// navigation model. The one thing tools require is the ability to stand the
// camera down mid-interaction, which `setEnabled` provides.
//
// NAVIGATION BINDINGS. Two sets, and which one is live depends on whether Alt
// is held:
//
//              plain                 with Alt held
//   left       tumble                tumble
//   middle     zoom                  pan
//   right      pan                   zoom
//
// The Alt set is Maya's, and it is muscle memory for anyone who has rigged a
// character before - which is everyone this tool is for. The plain set is what
// a browser user expects from any 3D viewer, and it stays, because a consumer
// product cannot require a modifier key to look at something.
//
// Implemented by swapping `OrbitControls.mouseButtons` when Alt goes down and
// up. OrbitControls reads that table at pointerdown, so the swap only has to
// beat the press, not the drag - which is why this needs no fight with event
// ordering and no reimplementation of the controls.
// ==========================================================================

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

/** Distance from a framed object, as a multiple of its bounding sphere radius. */
const FRAME_PADDING = 2.4;
const FRAME_DURATION = 0.45;

interface FrameTransition {
  fromPos: THREE.Vector3;
  toPos: THREE.Vector3;
  fromTarget: THREE.Vector3;
  toTarget: THREE.Vector3;
  elapsed: number;
  duration: number;
}

const easeInOutCubic = (t: number): number =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

export class CameraRig {
  readonly controls: OrbitControls;
  private transition: FrameTransition | null = null;

  /**
   * Home position, captured the first time a character is framed. `reset()`
   * returns here rather than to an arbitrary origin.
   */
  private home: { position: THREE.Vector3; target: THREE.Vector3 } | null = null;

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    domElement: HTMLElement
  ) {
    this.controls = new OrbitControls(camera, domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.screenSpacePanning = true;
    this.controls.minDistance = 0.05;
    this.controls.maxDistance = 200;
    // Stop just short of the poles so the up vector never flips mid-drag.
    this.controls.minPolarAngle = 0.01;
    this.controls.maxPolarAngle = Math.PI - 0.01;
    this.controls.zoomSpeed = 0.9;
    this.controls.rotateSpeed = 0.85;

    this.applyButtons(false);
    this.listenForAlt();
  }

  /**
   * Which mouse button does what, with and without Alt.
   *
   * Kept as data rather than branching at the call site, so the two mappings
   * can be read side by side and neither can drift.
   */
  private applyButtons(altHeld: boolean): void {
    this.controls.mouseButtons = altHeld
      ? {
          LEFT: THREE.MOUSE.ROTATE,
          MIDDLE: THREE.MOUSE.PAN,
          RIGHT: THREE.MOUSE.DOLLY
        }
      : {
          LEFT: THREE.MOUSE.ROTATE,
          MIDDLE: THREE.MOUSE.DOLLY,
          RIGHT: THREE.MOUSE.PAN
        };
  }

  /**
   * Follow the Alt key.
   *
   * On `window`, not the canvas: Alt can be pressed before the pointer is over
   * the viewport, and a listener on the canvas alone would miss it and give
   * the user the wrong mapping for their first drag.
   *
   * A blur reset matters more than it looks. Alt-Tab fires keydown and then
   * takes the focus away, so the keyup never arrives - and without this the
   * controls would stay in the Alt mapping indefinitely, with right-drag
   * zooming when the user expects it to pan.
   */
  private listenForAlt(): void {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.altKey) this.applyButtons(true);
    };
    const onKeyUp = (event: KeyboardEvent): void => {
      if (!event.altKey) this.applyButtons(false);
    };
    const onBlur = (): void => this.applyButtons(false);

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);

    this.stopListening = () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }

  private stopListening: (() => void) | null = null;

  /**
   * Tools call this while dragging so a marker drag does not also tumble the
   * camera. Any in-flight framing transition is cancelled, since the user has
   * clearly taken over.
   */
  setEnabled(enabled: boolean): void {
    this.controls.enabled = enabled;
    if (!enabled) this.transition = null;
  }

  update(dt: number): void {
    if (this.transition) {
      const t = this.transition;
      t.elapsed += dt;
      const k = easeInOutCubic(Math.min(1, t.elapsed / t.duration));
      this.camera.position.lerpVectors(t.fromPos, t.toPos, k);
      this.controls.target.lerpVectors(t.fromTarget, t.toTarget, k);
      if (k >= 1) this.transition = null;
    }
    this.controls.update();
  }

  /** Frame a bounding box, keeping the current viewing direction. */
  frameBox(box: THREE.Box3, animate = true): void {
    if (box.isEmpty()) return;

    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const fov = THREE.MathUtils.degToRad(this.camera.fov);
    const distance = (sphere.radius / Math.sin(fov / 2)) * (FRAME_PADDING / 2.4);

    const direction = new THREE.Vector3()
      .subVectors(this.camera.position, this.controls.target)
      .normalize();
    // On a cold start the camera and target can coincide; pick a sensible
    // three-quarter view rather than dividing by zero.
    if (direction.lengthSq() < 1e-8) direction.set(0.35, 0.25, 1).normalize();

    const toPos = sphere.center.clone().addScaledVector(direction, distance);
    this.moveTo(toPos, sphere.center.clone(), animate);

    this.controls.minDistance = Math.max(0.001, sphere.radius * 0.05);
    this.controls.maxDistance = sphere.radius * 40;
  }

  /** Frame an object and remember the result as the home view. */
  frameObject(object: THREE.Object3D, animate = true): void {
    const box = new THREE.Box3().setFromObject(object);
    this.frameBox(box, animate);
    // Capture home from the destination, not the current position, so calling
    // reset() immediately after loading does the expected thing.
    this.home = {
      position: (this.transition?.toPos ?? this.camera.position).clone(),
      target: (this.transition?.toTarget ?? this.controls.target).clone()
    };
  }

  /** Frame a point at a fixed radius - used for "focus the selected marker". */
  framePoint(point: THREE.Vector3, radius: number, animate = true): void {
    const box = new THREE.Box3().setFromCenterAndSize(
      point,
      new THREE.Vector3(radius * 2, radius * 2, radius * 2)
    );
    this.frameBox(box, animate);
  }

  /** Return to the view captured when the character was first framed. */
  reset(animate = true): void {
    if (!this.home) return;
    this.moveTo(this.home.position.clone(), this.home.target.clone(), animate);
  }

  /** Snap to an axis-aligned view of the current target. */
  setView(view: 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom'): void {
    const target = this.controls.target.clone();
    const distance = this.camera.position.distanceTo(target);
    const dir = {
      front: new THREE.Vector3(0, 0, 1),
      back: new THREE.Vector3(0, 0, -1),
      left: new THREE.Vector3(-1, 0, 0),
      right: new THREE.Vector3(1, 0, 0),
      top: new THREE.Vector3(0, 1, 0),
      bottom: new THREE.Vector3(0, -1, 0)
    }[view];
    this.moveTo(target.clone().addScaledVector(dir, distance), target, true);
  }

  private moveTo(
    position: THREE.Vector3,
    target: THREE.Vector3,
    animate: boolean
  ): void {
    if (!animate) {
      this.camera.position.copy(position);
      this.controls.target.copy(target);
      this.controls.update();
      this.transition = null;
      return;
    }
    this.transition = {
      fromPos: this.camera.position.clone(),
      toPos: position,
      fromTarget: this.controls.target.clone(),
      toTarget: target,
      elapsed: 0,
      duration: FRAME_DURATION
    };
  }

  dispose(): void {
    this.stopListening?.();
    this.stopListening = null;
    this.controls.dispose();
  }
}
