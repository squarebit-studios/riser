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
        this.controls = null;
        this.model = null;
        this.lights = [];
        this.clock = new THREE.Clock();
        this.grid = null;
        this.pivotIndicator = null;

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

        // Create renderer
        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.shadowMap.enabled = true;
        this.container.appendChild(this.renderer.domElement);

        // Create orbit controls with Maya-style navigation
        this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);

        // Configure controls to match Maya navigation style
        // Disable default mouse button mappings
        this.controls.enableRotate = false;
        this.controls.enablePan = false;
        this.controls.enableZoom = false;

        // Disable keyboard controls
        this.controls.enableKeys = false;

        // Disable automatic rotation
        this.controls.autoRotate = false;

        // Enable damping for smoother movement
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.05;

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

            // Update camera target
            this.controls.target.copy(center);
        } else {
            // Reset to default position if no model
            this.camera.position.set(0, 5, 10);
            this.controls.target.set(0, 0, 0);
        }

        this.camera.updateProjectionMatrix();
        this.controls.update();
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

        // Update controls
        this.controls.update();

        // Update pivot indicator position
        this.updatePivotIndicator();

        // Render scene
        this.renderer.render(this.scene, this.camera);
    }

    setupMayaControls() {
        const renderer = this.renderer.domElement;
        let isAltDown = false;

        // Variables to track previous mouse positions for custom controls
        const mouse = { x: 0, y: 0 };
        const prevMouse = { x: 0, y: 0 };

        // Tracking active control mode
        let activeControl = null; // 'rotate', 'pan', 'zoom', or null

        // For pan control - store the world point that was clicked
        let panningPoint = new THREE.Vector3();
        let panningPlane = new THREE.Plane();

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
                const raycaster = new THREE.Raycaster();
                const mousePosition = new THREE.Vector2(
                    (event.clientX / renderer.clientWidth) * 2 - 1,
                    -(event.clientY / renderer.clientHeight) * 2 + 1
                );

                raycaster.setFromCamera(mousePosition, this.camera);

                // Get all meshes in the model
                const meshes = [];
                this.model.traverse((child) => {
                    if (child.isMesh) {
                        meshes.push(child);
                    }
                });

                // Find intersection with model meshes
                const intersects = raycaster.intersectObjects(meshes, true);

                // If we hit something, update the orbit controls target
                if (intersects.length > 0) {
                    // Store the camera position before changing the target
                    const cameraPosition = this.camera.position.clone();

                    // Set the orbit target to the intersection point
                    this.controls.target.copy(intersects[0].point);

                    // Restore the camera position to prevent automatic movement
                    this.camera.position.copy(cameraPosition);

                    // Update the controls
                    this.controls.update();

                    // Update the pivot indicator
                    this.updatePivotIndicator();
                }
            }
        });

        // Handle mousedown for all Maya control modes
        renderer.addEventListener('mousedown', (event) => {
            if (isAltDown) {
                // Store initial position for all types of movement
                prevMouse.x = event.clientX;
                prevMouse.y = event.clientY;

                // Determine which control to activate based on the mouse button
                if (event.button === 0) { // Left button - Tumble/Orbit
                    activeControl = 'rotate';
                    renderer.style.cursor = 'move';
                } else if (event.button === 1) { // Middle button - Pan
                    activeControl = 'pan';
                    renderer.style.cursor = 'grabbing';

                    // For Maya-style panning, we need to get the 3D point under the cursor
                    // Compute a panning plane that's perpendicular to the camera direction
                    const raycaster = new THREE.Raycaster();
                    const mousePosition = new THREE.Vector2(
                        (event.clientX / renderer.clientWidth) * 2 - 1,
                        -(event.clientY / renderer.clientHeight) * 2 + 1
                    );

                    raycaster.setFromCamera(mousePosition, this.camera);

                    // Use the target point for the panning plane
                    panningPlane.setFromNormalAndCoplanarPoint(
                        this.camera.getWorldDirection(new THREE.Vector3()).negate(),
                        this.controls.target
                    );

                    // Get the point on the plane where the ray intersects
                    raycaster.ray.intersectPlane(panningPlane, panningPoint);
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

            mouse.x = event.clientX;
            mouse.y = event.clientY;

            const deltaX = mouse.x - prevMouse.x;
            const deltaY = mouse.y - prevMouse.y;

            if (activeControl === 'rotate') {
                // Manual tumble/orbit implementation
                const rotateSpeed = 0.01;

                // Horizontal movement = rotate around vertical axis (y)
                this.camera.position.sub(this.controls.target);
                this.camera.position.applyAxisAngle(new THREE.Vector3(0, 1, 0), -deltaX * rotateSpeed);

                // Vertical movement = rotate around horizontal axis (x)
                // Get the camera's right vector (perpendicular to look direction and up vector)
                const right = new THREE.Vector3();
                this.camera.getWorldDirection(right);
                right.cross(this.camera.up).normalize();

                // Rotate around the right vector
                this.camera.position.applyAxisAngle(right, -deltaY * rotateSpeed);

                // Move camera back to its position relative to target
                this.camera.position.add(this.controls.target);
                this.camera.lookAt(this.controls.target);
            }
            else if (activeControl === 'pan') {
                // True Maya-style panning where point under cursor follows the cursor

                // Get the new ray under the cursor
                const raycaster = new THREE.Raycaster();
                const mousePosition = new THREE.Vector2(
                    (event.clientX / renderer.clientWidth) * 2 - 1,
                    -(event.clientY / renderer.clientHeight) * 2 + 1
                );

                raycaster.setFromCamera(mousePosition, this.camera);

                // Find where this ray intersects our panning plane
                const newPanningPoint = new THREE.Vector3();
                raycaster.ray.intersectPlane(panningPlane, newPanningPoint);

                // The translation is the difference between the original point and the new point
                const translation = new THREE.Vector3().subVectors(panningPoint, newPanningPoint);

                // Move both camera and target by this translation to maintain relative positions
                this.camera.position.add(translation);
                this.controls.target.add(translation);
            }
            else if (activeControl === 'zoom') {
                // Maya-style zoom: move right to zoom in, left to zoom out
                // Reduced to 25% of original speed
                const zoomSpeed = 0.0025; // Original was 0.01, now 0.0025 (25%)

                // Apply zoom by changing camera position
                const zoomDirection = new THREE.Vector3().subVectors(
                    this.controls.target,
                    this.camera.position
                ).normalize();

                // Move camera toward/away from target
                this.camera.position.addScaledVector(
                    zoomDirection,
                    deltaX * zoomSpeed *
                    this.camera.position.distanceTo(this.controls.target)
                );
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
            // Reduced to 25% of original speed
            const zoomSpeed = 0.00025; // Original was 0.001, now 0.00025 (25%)
            const delta = event.deltaY;

            // Get zoom direction
            const zoomDirection = new THREE.Vector3().subVectors(
                this.controls.target,
                this.camera.position
            ).normalize();

            // Apply zoom by changing camera position
            this.camera.position.addScaledVector(
                zoomDirection,
                delta * zoomSpeed *
                this.camera.position.distanceTo(this.controls.target)
            );

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
        // Update the position of the pivot indicator to match the orbit controls target
        if (this.pivotIndicator && this.controls) {
            this.pivotIndicator.position.copy(this.controls.target);
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