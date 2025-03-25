class ModelViewer {
    constructor() {
        // DOM elements
        this.container = document.getElementById('canvas-container');
        this.fileInput = document.getElementById('file-input');
        this.resetCameraButton = document.getElementById('reset-camera');
        this.resetTransformButton = document.getElementById('reset-transform');

        // Transform controls
        this.translateX = document.getElementById('translate-x');
        this.translateY = document.getElementById('translate-y');
        this.translateZ = document.getElementById('translate-z');
        this.rotateX = document.getElementById('rotate-x');
        this.rotateY = document.getElementById('rotate-y');
        this.rotateZ = document.getElementById('rotate-z');
        this.scaleX = document.getElementById('scale-x');
        this.scaleY = document.getElementById('scale-y');
        this.scaleZ = document.getElementById('scale-z');

        // Value displays
        this.translateXValue = document.getElementById('translate-x-value');
        this.translateYValue = document.getElementById('translate-y-value');
        this.translateZValue = document.getElementById('translate-z-value');
        this.rotateXValue = document.getElementById('rotate-x-value');
        this.rotateYValue = document.getElementById('rotate-y-value');
        this.rotateZValue = document.getElementById('rotate-z-value');
        this.scaleXValue = document.getElementById('scale-x-value');
        this.scaleYValue = document.getElementById('scale-y-value');
        this.scaleZValue = document.getElementById('scale-z-value');

        // Three.js variables
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.cameraTarget = null; // Target point the camera looks at
        this.model = null;
        this.lights = [];
        this.clock = new THREE.Clock();
        this.grid = null;
        this.pivotIndicator = null;

        // Custom pivot properties
        this.pivotPoint = new THREE.Vector3(0, 0, 0); // True pivot point for tumbling

        // Camera information for custom controls
        this.cameraUp = new THREE.Vector3(0, 1, 0);

        // Transform values
        this.modelTransform = {
            translate: { x: 0, y: 0, z: 0 },
            rotate: { x: 0, y: Math.PI, z: 0 },
            scale: { x: 1, y: 1, z: 1 },
            baseScale: 1 // Base scale to normalize model size
        };

        // Initialize the viewer
        this.init();
        this.setupEventListeners();
    }

    init() {
        // Create scene
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x2a2a2a);
        this.scene.fog = new THREE.Fog(0x2a2a2a, 10, 50);

        // Create camera
        const aspect = this.container.clientWidth / this.container.clientHeight;
        this.camera = new THREE.PerspectiveCamera(45, aspect, 0.1, 1000);
        this.camera.position.set(0, 5, 10);
        this.cameraTarget = new THREE.Vector3(0, 0, 0); // Initialize the target

        // Create renderer
        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.shadowMap.enabled = true;
        this.container.appendChild(this.renderer.domElement);

        // Create pivot indicator
        this.pivotIndicator = this.createPivotIndicator();
        this.scene.add(this.pivotIndicator);

        // Add Maya-style control handlers
        this.setupMayaControls();

        // Create lights
        this.setupLights();

        // Create grid helper at origin (0,0,0)
        this.grid = new THREE.GridHelper(20, 20);
        // Ensure grid is exactly at 0,0,0
        this.grid.position.set(0, 0, 0);
        this.scene.add(this.grid);

        // Add axes helper to visualize coordinates
        const axesHelper = new THREE.AxesHelper(5);
        this.scene.add(axesHelper);

        // Handle window resize
        window.addEventListener('resize', () => this.onWindowResize(), false);

        // Add status info for navigation
        this.addNavigationHelp();

        // Start animation
        this.animate();

        // Initialize slider values
        this.updateSliders();
    }

    setupLights() {
        // Ambient light
        const ambientLight = new THREE.AmbientLight(0x404040, 0.5);
        this.scene.add(ambientLight);
        this.lights.push(ambientLight);

        // Directional light 1 (key light)
        const dirLight1 = new THREE.DirectionalLight(0xffffff, 1);
        dirLight1.position.set(1, 1, 1);
        dirLight1.castShadow = true;
        dirLight1.shadow.mapSize.width = 1024;
        dirLight1.shadow.mapSize.height = 1024;
        this.scene.add(dirLight1);
        this.lights.push(dirLight1);

        // Directional light 2 (fill light)
        const dirLight2 = new THREE.DirectionalLight(0xffffff, 0.5);
        dirLight2.position.set(-1, 0.5, -1);
        this.scene.add(dirLight2);
        this.lights.push(dirLight2);

        // Hemisphere light
        const hemiLight = new THREE.HemisphereLight(0xffffbb, 0x080820, 0.5);
        this.scene.add(hemiLight);
        this.lights.push(hemiLight);
    }

    setupEventListeners() {
        // File input change event
        this.fileInput.addEventListener('change', (event) => {
            const file = event.target.files[0];
            if (file) {
                this.loadOBJModel(file);
            }
        });

        // Reset camera button click event
        this.resetCameraButton.addEventListener('click', () => {
            this.resetCamera();
        });

        // Reset transform button click event
        this.resetTransformButton.addEventListener('click', () => {
            this.resetTransform();
        });

        // Translation events
        this.translateX.addEventListener('input', (e) => {
            this.modelTransform.translate.x = parseFloat(e.target.value);
            this.translateXValue.textContent = this.modelTransform.translate.x.toFixed(1);
            this.updateModelTransform();
        });

        this.translateY.addEventListener('input', (e) => {
            this.modelTransform.translate.y = parseFloat(e.target.value);
            this.translateYValue.textContent = this.modelTransform.translate.y.toFixed(1);
            this.updateModelTransform();
        });

        this.translateZ.addEventListener('input', (e) => {
            this.modelTransform.translate.z = parseFloat(e.target.value);
            this.translateZValue.textContent = this.modelTransform.translate.z.toFixed(1);
            this.updateModelTransform();
        });

        // Rotation events
        this.rotateX.addEventListener('input', (e) => {
            this.modelTransform.rotate.x = parseFloat(e.target.value);
            this.rotateXValue.textContent = this.modelTransform.rotate.x.toFixed(2);
            this.updateModelTransform();
        });

        this.rotateY.addEventListener('input', (e) => {
            this.modelTransform.rotate.y = parseFloat(e.target.value);
            this.rotateYValue.textContent = this.modelTransform.rotate.y.toFixed(2);
            this.updateModelTransform();
        });

        this.rotateZ.addEventListener('input', (e) => {
            this.modelTransform.rotate.z = parseFloat(e.target.value);
            this.rotateZValue.textContent = this.modelTransform.rotate.z.toFixed(2);
            this.updateModelTransform();
        });

        // Scale events
        this.scaleX.addEventListener('input', (e) => {
            this.modelTransform.scale.x = parseFloat(e.target.value);
            this.scaleXValue.textContent = this.modelTransform.scale.x.toFixed(1);
            this.updateModelTransform();
        });

        this.scaleY.addEventListener('input', (e) => {
            this.modelTransform.scale.y = parseFloat(e.target.value);
            this.scaleYValue.textContent = this.modelTransform.scale.y.toFixed(1);
            this.updateModelTransform();
        });

        this.scaleZ.addEventListener('input', (e) => {
            this.modelTransform.scale.z = parseFloat(e.target.value);
            this.scaleZValue.textContent = this.modelTransform.scale.z.toFixed(1);
            this.updateModelTransform();
        });
    }

    updateSliders() {
        // Update translation sliders
        this.translateX.value = this.modelTransform.translate.x;
        this.translateY.value = this.modelTransform.translate.y;
        this.translateZ.value = this.modelTransform.translate.z;
        this.translateXValue.textContent = this.modelTransform.translate.x.toFixed(1);
        this.translateYValue.textContent = this.modelTransform.translate.y.toFixed(1);
        this.translateZValue.textContent = this.modelTransform.translate.z.toFixed(1);

        // Update rotation sliders
        this.rotateX.value = this.modelTransform.rotate.x;
        this.rotateY.value = this.modelTransform.rotate.y;
        this.rotateZ.value = this.modelTransform.rotate.z;
        this.rotateXValue.textContent = this.modelTransform.rotate.x.toFixed(2);
        this.rotateYValue.textContent = this.modelTransform.rotate.y.toFixed(2);
        this.rotateZValue.textContent = this.modelTransform.rotate.z.toFixed(2);

        // Update scale sliders
        this.scaleX.value = this.modelTransform.scale.x;
        this.scaleY.value = this.modelTransform.scale.y;
        this.scaleZ.value = this.modelTransform.scale.z;
        this.scaleXValue.textContent = this.modelTransform.scale.x.toFixed(1);
        this.scaleYValue.textContent = this.modelTransform.scale.y.toFixed(1);
        this.scaleZValue.textContent = this.modelTransform.scale.z.toFixed(1);
    }

    updateModelTransform() {
        if (!this.model) return;

        // Apply translation
        this.model.position.x = this.modelTransform.translate.x;
        this.model.position.y = this.modelTransform.translate.y;
        this.model.position.z = this.modelTransform.translate.z;

        // Apply rotation
        this.model.rotation.x = this.modelTransform.rotate.x;
        this.model.rotation.y = this.modelTransform.rotate.y;
        this.model.rotation.z = this.modelTransform.rotate.z;

        // Apply scale (with base normalization)
        const baseScale = this.modelTransform.baseScale;
        this.model.scale.x = baseScale * this.modelTransform.scale.x;
        this.model.scale.y = baseScale * this.modelTransform.scale.y;
        this.model.scale.z = baseScale * this.modelTransform.scale.z;
    }

    resetTransform() {
        // Reset to initial values
        this.modelTransform.translate = { x: 0, y: 0, z: 0 };
        this.modelTransform.rotate = { x: 0, y: Math.PI, z: 0 };
        this.modelTransform.scale = { x: 1, y: 1, z: 1 };

        // Update sliders and model
        this.updateSliders();
        this.updateModelTransform();
    }

    loadOBJModel(file) {
        // Remove previous model if exists
        if (this.model) {
            this.scene.remove(this.model);
            this.model = null;
        }

        // Create file URL
        const fileURL = URL.createObjectURL(file);

        // Create OBJ loader
        const loader = new THREE.OBJLoader();

        // Load OBJ file
        loader.load(
            fileURL,
            (object) => {
                // Model loaded successfully
                this.model = object;

                // Center model
                const box = new THREE.Box3().setFromObject(this.model);
                const center = box.getCenter(new THREE.Vector3());
                const size = box.getSize(new THREE.Vector3());

                // Calculate normalization scale
                const maxDim = Math.max(size.x, size.y, size.z);
                const baseScale = 5 / maxDim;
                this.modelTransform.baseScale = baseScale;

                // Reset transform to defaults except for y-rotation
                this.modelTransform.translate = { x: 0, y: 0, z: 0 };
                this.modelTransform.rotate = { x: 0, y: Math.PI, z: 0 };
                this.modelTransform.scale = { x: 1, y: 1, z: 1 };

                // Update model position to have its bottom at y=0
                const bottomOffset = box.min.y * baseScale;
                this.modelTransform.translate.y = -bottomOffset;

                // Update the sliders to reflect the new model
                this.updateSliders();
                this.updateModelTransform();

                // Enable shadows
                this.model.traverse((child) => {
                    if (child.isMesh) {
                        child.castShadow = true;
                        child.receiveShadow = true;

                        // Set default material if missing
                        if (!child.material) {
                            child.material = new THREE.MeshStandardMaterial({
                                color: 0x808080,
                                metalness: 0.2,
                                roughness: 0.8
                            });
                        }
                    }
                });

                // Add model to scene
                this.scene.add(this.model);

                // Reset camera position to show the model
                this.resetCamera();
            },
            (xhr) => {
                // Loading progress
                console.log(`${(xhr.loaded / xhr.total * 100).toFixed(2)}% loaded`);
            },
            (error) => {
                // Error loading model
                console.error('Error loading OBJ file:', error);
                alert('Error loading the 3D model. Please try another file.');
            }
        );

        // Clean up file URL
        URL.revokeObjectURL(fileURL);
    }

    resetCamera() {
        if (this.model) {
            // Get model bounds
            const box = new THREE.Box3().setFromObject(this.model);
            const center = box.getCenter(new THREE.Vector3());
            const size = box.getSize(new THREE.Vector3());

            // Set camera position
            const maxDim = Math.max(size.x, size.y, size.z);
            const fov = this.camera.fov * (Math.PI / 180);
            const distance = Math.abs(maxDim / Math.sin(fov / 2));

            this.camera.position.set(
                center.x + distance * 0.5,
                center.y + distance * 0.5,
                center.z + distance
            );

            // Update camera target and pivot point
            this.cameraTarget.copy(center);
            this.pivotPoint.copy(center);
        } else {
            // Reset to default position if no model
            this.camera.position.set(0, 5, 10);
            this.cameraTarget.set(0, 0, 0);
            this.pivotPoint.set(0, 0, 0);
        }

        // Directly look at the target
        this.camera.lookAt(this.cameraTarget);
        this.camera.updateProjectionMatrix();
    }

    onWindowResize() {
        // Update camera aspect ratio
        const aspect = this.container.clientWidth / this.container.clientHeight;
        this.camera.aspect = aspect;
        this.camera.updateProjectionMatrix();

        // Update renderer size
        this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
    }

    animate() {
        requestAnimationFrame(() => this.animate());

        // Make sure camera is looking at target point
        this.camera.lookAt(this.cameraTarget);

        // Update pivot indicator position
        this.updatePivotIndicator();

        // Render scene
        this.renderer.render(this.scene, this.camera);
    }

    setupMayaControls() {
        const renderer = this.renderer.domElement;
        let isAltDown = false;

        // Variables to track mouse positions
        const mouse = { x: 0, y: 0 };
        const prevMouse = { x: 0, y: 0 };

        // Tracking active control mode
        let activeControl = null; // 'tumble', 'pan', 'zoom', or null

        // For tumble operation - store distance to pivot
        let distanceToPivot = 0;

        // For zoom operation - store distance to pivot
        let zoomStartDistance = 0;

        // Screen-to-world conversion helpers
        const getMouseRay = (mouseX, mouseY) => {
            const ndcX = (mouseX / renderer.clientWidth) * 2 - 1;
            const ndcY = -(mouseY / renderer.clientHeight) * 2 + 1;

            const raycaster = new THREE.Raycaster();
            raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);
            return raycaster;
        };

        // Track Alt key state
        window.addEventListener('keydown', (event) => {
            if (event.key === 'Alt') {
                isAltDown = true;
                renderer.style.cursor = 'pointer'; // Change cursor to indicate special mode
                // Prevent browser's default Alt key behavior
                event.preventDefault();
            }
        });

        window.addEventListener('keyup', (event) => {
            if (event.key === 'Alt') {
                isAltDown = false;
                activeControl = null;
                renderer.style.cursor = 'auto'; // Reset cursor
            }
        });

        // Handle direct click on mesh to set tumble pivot point (without Alt)
        renderer.addEventListener('click', (event) => {
            // Only apply for left mouse button clicks without Alt key
            if (event.button === 0 && !isAltDown && this.model) {
                // Get accurate client coordinates relative to the renderer
                const rect = renderer.getBoundingClientRect();
                const mouseX = event.clientX - rect.left;
                const mouseY = event.clientY - rect.top;

                // Get raycaster from camera through click point
                const raycaster = getMouseRay(mouseX, mouseY);

                // Get all meshes in the model
                const meshes = [];
                this.model.traverse((child) => {
                    if (child.isMesh) {
                        meshes.push(child);
                    }
                });

                // Find intersection with model meshes
                const intersects = raycaster.intersectObjects(meshes, true);

                // If we hit something, update the pivot point without moving the camera
                if (intersects.length > 0) {
                    // Set the new pivot point to the intersection point
                    this.pivotPoint.copy(intersects[0].point);

                    // DO NOT update camera target - this keeps off-center rotation
                    // this.cameraTarget remains where it was

                    // Update the pivot indicator position
                    this.updatePivotIndicator();
                }
            }
        });

        // Handle mousedown for all Maya control modes
        renderer.addEventListener('mousedown', (event) => {
            if (isAltDown) {
                // Get accurate client coordinates relative to the renderer
                const rect = renderer.getBoundingClientRect();
                const mouseX = event.clientX - rect.left;
                const mouseY = event.clientY - rect.top;

                // Store initial mouse position
                prevMouse.x = mouseX;
                prevMouse.y = mouseY;

                // Store current distance to pivot for zoom operations
                distanceToPivot = this.camera.position.distanceTo(this.pivotPoint);
                zoomStartDistance = distanceToPivot;

                // Determine which control to activate based on the mouse button
                if (event.button === 0) { // Left button - Tumble
                    activeControl = 'tumble';
                    renderer.style.cursor = 'move';
                } else if (event.button === 1) { // Middle button - Pan
                    activeControl = 'pan';
                    renderer.style.cursor = 'grabbing';
                } else if (event.button === 2) { // Right button - Zoom
                    activeControl = 'zoom';
                    renderer.style.cursor = 'ns-resize';
                }

                event.preventDefault();
            }
        });

        // Custom handler for all movement types
        renderer.addEventListener('mousemove', (event) => {
            if (!isAltDown || !activeControl) return;

            // Get accurate client coordinates relative to the renderer
            const rect = renderer.getBoundingClientRect();
            mouse.x = event.clientX - rect.left;
            mouse.y = event.clientY - rect.top;

            const deltaX = mouse.x - prevMouse.x;
            const deltaY = mouse.y - prevMouse.y;

            if (activeControl === 'tumble') {
                const rotateSpeed = 0.005; // Reduced speed for more precision

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
                    -deltaX * rotateSpeed
                );

                // Apply horizontal rotation
                pivotToCamera.applyQuaternion(horizontalQuat);

                // Get the camera's right vector for vertical rotation
                // This ensures vertical rotation is always around the screen horizontal axis
                const cameraRight = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);

                // Create vertical rotation quaternion
                const verticalQuat = new THREE.Quaternion().setFromAxisAngle(
                    cameraRight,
                    -deltaY * rotateSpeed
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
            else if (activeControl === 'pan') {
                // Improved pan implementation that keeps pivot point fixed in world space

                // Calculate pan speed based on distance to pivot for consistent feeling at any zoom level
                const panSpeed = distanceToPivot * 0.001;

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
            else if (activeControl === 'zoom') {
                // Standard linear zoom toward camera target (center of view)
                // This ignores the pivot point and just zooms toward what's centered in the camera

                // Calculate zoom amount - right moves in, left moves out
                const zoomSpeed = 0.0025;

                // Get vector from camera to target (center of view)
                const zoomDirection = new THREE.Vector3().subVectors(
                    this.cameraTarget,
                    this.camera.position
                ).normalize();

                // Calculate zoom amount based on initial distance and mouse movement
                const zoomAmount = deltaX * zoomSpeed * zoomStartDistance;

                // Move camera along the view direction (toward camera target)
                this.camera.position.addScaledVector(zoomDirection, zoomAmount);
            }

            // Update for next movement
            prevMouse.x = mouse.x;
            prevMouse.y = mouse.y;

            event.preventDefault();
        });

        // Reset active control when mouse button is released
        window.addEventListener('mouseup', () => {
            activeControl = null;
            renderer.style.cursor = isAltDown ? 'pointer' : 'auto';
        });

        // Prevent context menu for right click
        renderer.addEventListener('contextmenu', (event) => {
            event.preventDefault();
        });

        // Add mouse wheel zoom (standard behavior, works without Alt)
        renderer.addEventListener('wheel', (event) => {
            const zoomSpeed = 0.00025; // 25% of original speed
            const delta = event.deltaY;

            // Get current distance for consistent zoom speed
            const distance = this.camera.position.distanceTo(this.cameraTarget);

            // Get fixed zoom direction from camera to target (center of view)
            const zoomDirection = new THREE.Vector3().subVectors(
                this.cameraTarget,
                this.camera.position
            ).normalize();

            // Apply zoom by moving camera along zoom direction
            this.camera.position.addScaledVector(zoomDirection, delta * zoomSpeed * distance);

            event.preventDefault();
        }, { passive: false });
    }

    createPivotIndicator() {
        // Create a small yellow sphere to indicate the tumble pivot
        const geometry = new THREE.SphereGeometry(0.1, 16, 16);
        const material = new THREE.MeshBasicMaterial({
            color: 0xffff00,
            transparent: true,
            opacity: 0.8,
            depthTest: false
        });
        return new THREE.Mesh(geometry, material);
    }

    updatePivotIndicator() {
        // Update the position of the pivot indicator to match our pivot point
        if (this.pivotIndicator) {
            this.pivotIndicator.position.copy(this.pivotPoint);
        }
    }

    addNavigationHelp() {
        // Create navigation help element
        const navHelp = document.createElement('div');
        navHelp.id = 'nav-help';
        navHelp.innerHTML = `
            <div class="nav-help-content">
                <h4>Maya-Style Navigation Controls:</h4>
                <ul>
                    <li><strong>Left Click</strong> on model: Set tumble pivot</li>
                    <li><strong>Alt + Left Click</strong>: Tumble/Orbit</li>
                    <li><strong>Alt + Middle Click</strong>: Pan</li>
                    <li><strong>Alt + Right Click</strong>: Zoom (right = in, left = out)</li>
                    <li><strong>Mouse Wheel</strong>: Zoom in/out</li>
                </ul>
            </div>
        `;

        // Apply styles
        navHelp.style.position = 'absolute';
        navHelp.style.bottom = '10px';
        navHelp.style.right = '10px';
        navHelp.style.background = 'rgba(0, 0, 0, 0.7)';
        navHelp.style.color = '#fff';
        navHelp.style.padding = '10px';
        navHelp.style.borderRadius = '5px';
        navHelp.style.fontSize = '12px';
        navHelp.style.zIndex = '100';

        // Add navigation help to the container
        this.container.appendChild(navHelp);
    }
}

// Initialize the viewer when the page is loaded
document.addEventListener('DOMContentLoaded', () => {
    new ModelViewer();
}); 