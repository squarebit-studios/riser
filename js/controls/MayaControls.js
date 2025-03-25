/**
 * MayaControls - Maya-style 3D camera controls for Three.js
 * Provides tumbling, panning, and zooming functionality similar to Maya and other professional 3D applications
 */
import { THREE } from '../utils/ThreeUtils.js';

class MayaControls {
    /**
     * Create a new MayaControls instance
     * @param {THREE.Camera} camera - The camera to control
     * @param {THREE.Vector3} cameraTarget - The point the camera looks at
     * @param {Element} domElement - The DOM element to attach listeners to (usually the renderer's domElement)
     * @param {Object} options - Optional settings
     */
    constructor(camera, cameraTarget, domElement, options = {}) {
        this.camera = camera;
        this.cameraTarget = cameraTarget;
        this.domElement = domElement;

        // The true pivot point for tumbling (can be different from camera target)
        this.pivotPoint = new THREE.Vector3();
        this.pivotPoint.copy(cameraTarget); // Initialize to same as camera target

        // Indicator for pivot point visualization
        this.pivotIndicator = null;

        // State tracking
        this.isEnabled = true;
        this.isAltDown = false;
        this.activeControl = null; // 'tumble', 'pan', 'zoom', or null

        // Mouse position tracking
        this.mouse = { x: 0, y: 0 };
        this.prevMouse = { x: 0, y: 0 };

        // For operations that need to track distance
        this.distanceToPivot = 0;
        this.zoomStartDistance = 0;

        // Configure options with defaults
        this.options = Object.assign({
            rotateSpeed: 0.005,
            panSpeed: 0.001,
            zoomSpeed: 0.0025,
            wheelZoomSpeed: 0.00025
        }, options);

        // Setup event listeners
        this.setupEventListeners();

        // Create pivot indicator if requested
        if (options.showPivotIndicator) {
            this.createPivotIndicator();
        }
    }

    /**
     * Setup all event listeners for camera controls
     */
    setupEventListeners() {
        // Key events
        window.addEventListener('keydown', this.onKeyDown.bind(this));
        window.addEventListener('keyup', this.onKeyUp.bind(this));

        // Mouse events
        this.domElement.addEventListener('mousedown', this.onMouseDown.bind(this));
        window.addEventListener('mousemove', this.onMouseMove.bind(this));
        window.addEventListener('mouseup', this.onMouseUp.bind(this));

        // Additional events
        this.domElement.addEventListener('click', this.onClick.bind(this));
        this.domElement.addEventListener('wheel', this.onWheel.bind(this), { passive: false });
        this.domElement.addEventListener('contextmenu', (event) => event.preventDefault());
    }

    /**
     * Remove all event listeners
     */
    dispose() {
        // Key events
        window.removeEventListener('keydown', this.onKeyDown.bind(this));
        window.removeEventListener('keyup', this.onKeyUp.bind(this));

        // Mouse events
        this.domElement.removeEventListener('mousedown', this.onMouseDown.bind(this));
        window.removeEventListener('mousemove', this.onMouseMove.bind(this));
        window.removeEventListener('mouseup', this.onMouseUp.bind(this));

        // Additional events
        this.domElement.removeEventListener('click', this.onClick.bind(this));
        this.domElement.removeEventListener('wheel', this.onWheel.bind(this));
        this.domElement.removeEventListener('contextmenu', (event) => event.preventDefault());
    }

    /**
     * Key down event handler
     */
    onKeyDown(event) {
        if (event.key === 'Alt') {
            this.isAltDown = true;
            this.domElement.style.cursor = 'pointer';
            event.preventDefault();
        }
    }

    /**
     * Key up event handler
     */
    onKeyUp(event) {
        if (event.key === 'Alt') {
            this.isAltDown = false;
            this.activeControl = null;
            this.domElement.style.cursor = 'auto';
        }
    }

    /**
     * Mouse down event handler
     */
    onMouseDown(event) {
        if (!this.isEnabled || !this.isAltDown) return;

        // Get accurate client coordinates relative to the renderer
        const rect = this.domElement.getBoundingClientRect();
        const mouseX = event.clientX - rect.left;
        const mouseY = event.clientY - rect.top;

        // Store initial mouse position
        this.prevMouse.x = mouseX;
        this.prevMouse.y = mouseY;

        // Store current distance to pivot for operations
        this.distanceToPivot = this.camera.position.distanceTo(this.pivotPoint);
        this.zoomStartDistance = this.distanceToPivot;

        // Determine which control to activate based on mouse button
        if (event.button === 0) { // Left button - Tumble
            this.activeControl = 'tumble';
            this.domElement.style.cursor = 'move';
        } else if (event.button === 1) { // Middle button - Pan
            this.activeControl = 'pan';
            this.domElement.style.cursor = 'grabbing';
        } else if (event.button === 2) { // Right button - Zoom
            this.activeControl = 'zoom';
            this.domElement.style.cursor = 'ns-resize';
        }

        event.preventDefault();
    }

    /**
     * Mouse move event handler
     */
    onMouseMove(event) {
        if (!this.isEnabled || !this.isAltDown || !this.activeControl) return;

        // Get accurate client coordinates relative to the renderer
        const rect = this.domElement.getBoundingClientRect();
        this.mouse.x = event.clientX - rect.left;
        this.mouse.y = event.clientY - rect.top;

        const deltaX = this.mouse.x - this.prevMouse.x;
        const deltaY = this.mouse.y - this.prevMouse.y;

        // Handle different control types
        if (this.activeControl === 'tumble') {
            this.handleTumble(deltaX, deltaY);
        }
        else if (this.activeControl === 'pan') {
            this.handlePan(deltaX, deltaY);
        }
        else if (this.activeControl === 'zoom') {
            this.handleZoom(deltaX);
        }

        // Update for next movement
        this.prevMouse.x = this.mouse.x;
        this.prevMouse.y = this.mouse.y;

        event.preventDefault();
    }

    /**
     * Mouse up event handler
     */
    onMouseUp() {
        this.activeControl = null;
        this.domElement.style.cursor = this.isAltDown ? 'pointer' : 'auto';
    }

    /**
     * Mouse wheel event handler
     */
    onWheel(event) {
        if (!this.isEnabled) return;

        const delta = event.deltaY;
        const distance = this.camera.position.distanceTo(this.cameraTarget);

        // Get fixed zoom direction from camera to target (center of view)
        const zoomDirection = new THREE.Vector3().subVectors(
            this.cameraTarget,
            this.camera.position
        ).normalize();

        // Apply zoom by moving camera along zoom direction
        this.camera.position.addScaledVector(
            zoomDirection,
            delta * this.options.wheelZoomSpeed * distance
        );

        event.preventDefault();
    }

    /**
     * Click event handler for setting pivot point
     */
    onClick(event) {
        if (!this.isEnabled || this.isAltDown || event.button !== 0) return;

        // Get accurate client coordinates relative to the renderer
        const rect = this.domElement.getBoundingClientRect();
        const mouseX = event.clientX - rect.left;
        const mouseY = event.clientY - rect.top;

        // Get raycaster from camera through click point
        const raycaster = this.getMouseRay(mouseX, mouseY);

        // Get all meshes in the model for raycasting
        let meshes = [];
        if (this.domElement.parentNode && this.domElement.parentNode.scene) {
            // Try to get scene from parent element
            const scene = this.domElement.parentNode.scene;
            scene.traverse((child) => {
                if (child.isMesh) {
                    meshes.push(child);
                }
            });
        }

        // Find intersection with model meshes
        const intersects = raycaster.intersectObjects(meshes, true);

        // If we hit something, update the pivot point without moving the camera
        if (intersects.length > 0) {
            // Set the new pivot point to the intersection point
            this.pivotPoint.copy(intersects[0].point);

            // Update the pivot indicator position
            this.updatePivotIndicator();

            // Dispatch pivot changed event
            this.dispatchEvent({ type: 'pivotChanged', position: this.pivotPoint.clone() });
        }
    }

    /**
     * Handle tumble operation
     */
    handleTumble(deltaX, deltaY) {
        // Get vector from pivot to camera
        const pivotToCamera = new THREE.Vector3().subVectors(
            this.camera.position,
            this.pivotPoint
        );

        // Store the original camera-to-pivot distance
        const originalDistance = pivotToCamera.length();

        // Create a quaternion for horizontal rotation around world up
        const yAxis = new THREE.Vector3(0, 1, 0);
        const horizontalQuat = new THREE.Quaternion().setFromAxisAngle(
            yAxis,
            -deltaX * this.options.rotateSpeed
        );

        // Apply horizontal rotation
        pivotToCamera.applyQuaternion(horizontalQuat);

        // Get the camera's right vector for vertical rotation
        // This ensures vertical rotation is always around the screen horizontal axis
        const cameraRight = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);

        // Create vertical rotation quaternion
        const verticalQuat = new THREE.Quaternion().setFromAxisAngle(
            cameraRight,
            -deltaY * this.options.rotateSpeed
        );

        // Apply vertical rotation
        pivotToCamera.applyQuaternion(verticalQuat);

        // Make sure we maintain the original distance (avoid any scaling issues)
        pivotToCamera.normalize().multiplyScalar(originalDistance);

        // Set the new camera position
        this.camera.position.copy(this.pivotPoint).add(pivotToCamera);

        // Keep pivot point off-center - DO NOT update cameraTarget to match pivot
        // Instead, calculate a new camera orientation that keeps the tumbling centered
        // on the pivot point without changing what's in the center of the screen

        // Get offset from camera target to pivot
        const targetToPivot = new THREE.Vector3().subVectors(
            this.pivotPoint,
            this.cameraTarget
        );

        // Rotate this offset vector the same way we rotated the camera
        targetToPivot.applyQuaternion(horizontalQuat);
        targetToPivot.applyQuaternion(verticalQuat);

        // Calculate the new camera target position that keeps the same
        // relationship between the pivot and what's in the center of the screen
        const newTarget = new THREE.Vector3().copy(this.pivotPoint).sub(targetToPivot);
        this.cameraTarget.copy(newTarget);
    }

    /**
     * Handle pan operation
     */
    handlePan(deltaX, deltaY) {
        // Calculate pan speed based on distance to pivot for consistent feeling at any zoom level
        const panSpeed = this.distanceToPivot * this.options.panSpeed;

        // Get camera's viewing plane vectors
        const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
        const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion);

        // Create movement vector in world space
        const movement = new THREE.Vector3()
            .addScaledVector(right, -deltaX * panSpeed)
            .addScaledVector(up, deltaY * panSpeed);

        // Move the camera position
        this.camera.position.add(movement);

        // Move the camera target by the same amount to maintain view direction
        this.cameraTarget.add(movement);

        // The pivot point remains fixed in world space - do not move it
    }

    /**
     * Handle zoom operation
     */
    handleZoom(deltaX) {
        // Standard linear zoom toward camera target (center of view)
        // This ignores the pivot point and just zooms toward what's centered in the camera

        // Get vector from camera to target (center of view)
        const zoomDirection = new THREE.Vector3().subVectors(
            this.cameraTarget,
            this.camera.position
        ).normalize();

        // Calculate zoom amount based on initial distance and mouse movement
        const zoomAmount = deltaX * this.options.zoomSpeed * this.zoomStartDistance;

        // Move camera along the view direction (toward camera target)
        this.camera.position.addScaledVector(zoomDirection, zoomAmount);
    }

    /**
     * Create a raycaster from mouse coordinates
     */
    getMouseRay(mouseX, mouseY) {
        const ndcX = (mouseX / this.domElement.clientWidth) * 2 - 1;
        const ndcY = -(mouseY / this.domElement.clientHeight) * 2 + 1;

        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);
        return raycaster;
    }

    /**
     * Create pivot indicator
     */
    createPivotIndicator() {
        // Create a small yellow sphere to indicate the tumble pivot
        const geometry = new THREE.SphereGeometry(0.1, 16, 16);
        const material = new THREE.MeshBasicMaterial({
            color: 0xffff00,
            transparent: true,
            opacity: 0.8,
            depthTest: false
        });

        this.pivotIndicator = new THREE.Mesh(geometry, material);
        this.updatePivotIndicator();

        return this.pivotIndicator;
    }

    /**
     * Update pivot indicator position
     */
    updatePivotIndicator() {
        if (this.pivotIndicator) {
            this.pivotIndicator.position.copy(this.pivotPoint);
        }
    }

    /**
     * Update function to be called in animation loop
     */
    update() {
        // Make sure camera is looking at target point
        this.camera.lookAt(this.cameraTarget);

        // Update pivot indicator position if exists
        this.updatePivotIndicator();
    }

    /**
     * Set a new pivot point
     */
    setPivotPoint(point) {
        this.pivotPoint.copy(point);
        this.updatePivotIndicator();
        // Dispatch pivot changed event
        this.dispatchEvent({ type: 'pivotChanged', position: this.pivotPoint.clone() });
    }

    /**
     * Set the camera target
     */
    setCameraTarget(target) {
        this.cameraTarget.copy(target);
    }

    /**
     * Reset controls to default
     */
    reset() {
        // Reset the pivot point to match camera target
        this.pivotPoint.copy(this.cameraTarget);
        this.updatePivotIndicator();
    }
}

// Export the class
export { MayaControls }; 