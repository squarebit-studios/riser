class ModelViewer {
    constructor() {
        // DOM elements
        this.container = document.getElementById('canvas-container');
        this.fileInput = document.getElementById('file-input');
        this.importFileInput = document.getElementById('import-file-input');
        this.resetCameraButton = document.getElementById('reset-camera');
        this.resetTransformButton = document.getElementById('reset-transform');

        // Channel box elements
        this.channelBoxTitle = document.getElementById('channel-box-title');
        this.transformGroup = document.querySelector('.transform-group');
        this.morphTargetsContainer = document.getElementById('morph-targets-container');

        // Transform controls
        this.translateXInput = document.getElementById('translate-x');
        this.translateYInput = document.getElementById('translate-y');
        this.translateZInput = document.getElementById('translate-z');
        this.rotateXInput = document.getElementById('rotate-x');
        this.rotateYInput = document.getElementById('rotate-y');
        this.rotateZInput = document.getElementById('rotate-z');
        this.scaleXInput = document.getElementById('scale-x');
        this.scaleYInput = document.getElementById('scale-y');
        this.scaleZInput = document.getElementById('scale-z');

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

        // Manipulator transform controls
        this.transformControls = null;
        this.selectedObject = null;
        this.isDragging = false;
        this.lastDragEndTime = null;

        // Custom pivot properties
        this.pivotPoint = new THREE.Vector3(0, 0, 0); // True pivot point for tumbling

        // Camera information for custom controls
        this.cameraUp = new THREE.Vector3(0, 1, 0);

        // Transform values
        this.modelTransform = {
            translate: { x: 0, y: 0, z: 0 },
            rotate: { x: 0, y: 0, z: 0 },
            scale: { x: 1, y: 1, z: 1 },
            baseScale: 1 // Base scale to normalize model size
        };

        // Undo/Redo system
        this.undoStack = [];
        this.redoStack = [];
        this.maxUndoSteps = 50; // Maximum number of steps to keep in undo stack
        this.isUndoRedoAction = false; // Flag to prevent recursive undo/redo

        // Models collection
        this.models = []; // Array to hold all loaded models

        // Status trackers for file loading
        this.loadingModels = {};  // Object to track loading status by fileURL

        // Initialize the viewer
        this.init();
        this.setupEventListeners();
    }

    init() {
        // Create scene
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x2a2a2a);
        // Removed fog for clearer rendering

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

        // Handle if mouse is pressed or released
        // Add event listeners to the renderer's DOM element (or canvas)
        this.renderer.domElement.addEventListener('mousedown', onMouseDown);
        this.renderer.domElement.addEventListener('mouseup', onMouseUp);

        this.mousePressed = false;
        function onMouseDown(event) {
            // Mouse button is pressed
            this.mousePressed = true;
            // Add your logic for a "press" event here
        }

        function onMouseUp(event) {
            // Mouse button is released
            this.mousePressed = false;
            // Add your logic for a "release" event here
        }

        this.altKeyPressed = false;

        // Move key listeners to window object
        window.addEventListener('keydown', (event) => {
            if (event.key === 'Alt') {
                this.altKeyPressed = true;
            }
        });

        window.addEventListener('keyup', (event) => {
            if (event.key === 'Alt') {
                this.altKeyPressed = false;
            }
        });
        this.clickedOnManipulator = false;

        // Simple test click handler - placed early in initialization
        this.renderer.domElement.addEventListener('click', (event) => {
            // If alt key is pressed, don't allow selection
            if (this.altKeyPressed) {
                return;
            }
            if (!this.mousePressed && this.clickedOnManipulator) {
                this.clickedOnManipulator = false;
                return;
            }

            // Get normalized mouse coordinates for raycasting
            const rect = this.renderer.domElement.getBoundingClientRect();
            const mouseX = ((event.clientX - rect.left) / rect.width) * 2 - 1;
            const mouseY = -((event.clientY - rect.top) / rect.height) * 2 + 1;

            // Create raycaster if not already created
            if (!this.raycaster) {
                this.raycaster = new THREE.Raycaster();
            }

            // Update raycaster with mouse position and camera
            this.raycaster.setFromCamera(new THREE.Vector2(mouseX, mouseY), this.camera);

            // Collect all meshes from all models for raycasting
            const meshes = [];
            this.models.forEach(model => {
                model.traverse(child => {
                    if (child.isMesh && child.visible) {
                        meshes.push(child);
                    }
                });
            });

            // Perform the raycast
            const intersects = this.raycaster.intersectObjects(meshes, false);

            // If hit something, select the object
            if (intersects.length > 0) {
                const hitMesh = intersects[0].object;

                // Walk up the parent chain to find the top-level transform
                let currentObject = hitMesh;
                let topLevelTransform = null;
                while (currentObject.parent && currentObject.parent !== this.scene) {
                    currentObject = currentObject.parent;
                    if (!currentObject.isMesh) {
                        topLevelTransform = currentObject;
                    }
                }

                // Select the top-level transform if found, otherwise the hit mesh
                const objectToSelect = topLevelTransform || hitMesh;
                this.selectObject(objectToSelect);
                return true;
            } else {
                // No hit, deselect
                this.deselectObject();
            }
        });

        // Set up post-processing for outline effect
        this.composer = new THREE.EffectComposer(this.renderer);
        const renderPass = new THREE.RenderPass(this.scene, this.camera);
        this.composer.addPass(renderPass);

        // Set up outline effect for selected objects
        this.outlinePass = new THREE.OutlinePass(
            new THREE.Vector2(this.container.clientWidth, this.container.clientHeight),
            this.scene,
            this.camera
        );
        this.outlinePass.edgeStrength = 10;
        this.outlinePass.edgeGlow = 0;
        this.outlinePass.edgeThickness = 1;
        this.outlinePass.pulsePeriod = 0;
        this.outlinePass.visibleEdgeColor.set('#ffffff');
        this.outlinePass.hiddenEdgeColor.set('#190a05');
        this.composer.addPass(this.outlinePass);

        // Add FXAA anti-aliasing pass
        const fxaaPass = new THREE.ShaderPass(THREE.FXAAShader);
        fxaaPass.material.uniforms.resolution.value.set(
            1 / this.container.clientWidth,
            1 / this.container.clientHeight
        );
        this.composer.addPass(fxaaPass);

        // Create transform controls
        this.transformControls = new THREE.TransformControls(this.camera, this.renderer.domElement);
        this.transformControls.setMode('translate');
        this.transformControls.setSpace('local');
        this.scene.add(this.transformControls);

        // Add event listener for transform controls dragging
        this.transformControls.addEventListener('dragging-changed', (event) => {
            if (event.value) {
                // The TransformControls is being used (dragging started)
                this.clickedOnManipulator = true;
            }
        });

        // Add event listener for transform controls updates
        this.transformControls.addEventListener('objectChange', (event) => {
            if (this.selectedObject && this.selectedObject.userData.isBoneJoint && this.selectedBone) {
                // If the bone has a parent, convert to local space
                if (this.selectedBone.parent) {
                    // Get parent world matrix and invert it
                    const invParentMatrix = new THREE.Matrix4().copy(this.selectedBone.parent.matrixWorld).invert();

                    // Convert world position to local position
                    const localPos = worldPos.clone().applyMatrix4(invParentMatrix);

                    // Convert world rotation to local rotation
                    const parentQuat = this.selectedBone.parent.quaternion.clone();
                    const localQuat = worldQuat.clone().premultiply(parentQuat.invert());

                    // Convert world scale to local scale
                    const parentScale = this.selectedBone.parent.scale.clone();
                    const localScale = worldScale.clone().divide(parentScale);

                    // Update bone transform
                    this.selectedBone.position.copy(localPos);
                    this.selectedBone.quaternion.copy(localQuat);
                    this.selectedBone.scale.copy(localScale);
                } else {
                    // No parent, just copy world transform directly
                    this.selectedBone.position.copy(worldPos);
                    this.selectedBone.quaternion.copy(worldQuat);
                    this.selectedBone.scale.copy(worldScale);
                }

                // Update bone matrix and world matrix
                this.selectedBone.updateMatrix();
                this.selectedBone.updateMatrixWorld(true);

                // Find the model that contains this bone
                const model = this.findModelForBone(this.selectedBone);
                if (model) {
                    // Update bone visualization
                    this.updateBoneVisualization(model);

                    // Update the skinned meshes
                    this.updateSkinnedMeshes(model);
                }
            }
        });

        // Create pivot indicator
        this.pivotIndicator = this.createPivotIndicator();
        this.pivotIndicator.visible = false; // Hidden by default, shown when Ctrl is pressed
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

        // Initialize the outliner panel
        this.createOutliner();

        // Initialize the undo/redo system
        this.undoStack = [];
        this.redoStack = [];
        this.isUndoRedoAction = false;

        // Initialize bone-related UI
        const bonesMenuItem = document.getElementById('show-bones-option');
        if (bonesMenuItem) {
            bonesMenuItem.textContent = 'Show Bones';
            bonesMenuItem.classList.add('active'); // Start with bones visible by default
        }

        // Handle window resize
        window.addEventListener('resize', () => this.onWindowResize(), false);

        // Add status info for navigation
        this.addNavigationHelp();

        // Start animation
        this.animate();

        // Initialize slider values
        this.updateInputs();
    }

    setupLights() {
        // Ambient light
        const ambientLight = new THREE.AmbientLight(0x404040, 0.5);
        this.scene.add(ambientLight);
        this.lights.push(ambientLight);

        // Directional light 1 (key light)
        const dirLight1 = new THREE.DirectionalLight(0xffffff, 0.7); // Reduced intensity from 1.0 to 0.7
        dirLight1.position.set(1, 1, 1);
        dirLight1.castShadow = true;
        dirLight1.shadow.mapSize.width = 1024;
        dirLight1.shadow.mapSize.height = 1024;
        this.scene.add(dirLight1);
        this.lights.push(dirLight1);

        // Directional light 2 (fill light)
        const dirLight2 = new THREE.DirectionalLight(0xffffff, 0.3); // Reduced intensity from 0.5 to 0.3
        dirLight2.position.set(-1, 0.5, -1);
        this.scene.add(dirLight2);
        this.lights.push(dirLight2);

        // Hemisphere light
        const hemiLight = new THREE.HemisphereLight(0xffffbb, 0x080820, 0.3); // Reduced intensity from 0.5 to 0.3
        this.scene.add(hemiLight);
        this.lights.push(hemiLight);
    }

    setupEventListeners() {
        // Add mobile panel toggle functionality
        const togglePanelButton = document.getElementById('toggle-panel');
        const infoPanel = document.getElementById('info');

        if (togglePanelButton) {
            togglePanelButton.addEventListener('click', () => {
                infoPanel.classList.toggle('visible');

                // Also check if outliner exists and toggle its visibility on mobile
                const outlinerPanel = document.getElementById('outliner-panel');
                if (outlinerPanel) {
                    if (infoPanel.classList.contains('visible')) {
                        // Only show outliner if info panel is visible
                        outlinerPanel.style.display = 'block';
                    } else {
                        outlinerPanel.style.display = 'none';
                    }
                }
            });

            // Also close panel when clicking outside of it on mobile
            document.addEventListener('click', (e) => {
                const isMobile = window.innerWidth <= 768;
                const outlinerPanel = document.getElementById('outliner-panel');

                if (isMobile && infoPanel.classList.contains('visible') &&
                    !infoPanel.contains(e.target) &&
                    e.target !== togglePanelButton &&
                    !(outlinerPanel && outlinerPanel.contains(e.target))) {

                    // Hide both info panel and outliner
                    infoPanel.classList.remove('visible');
                    if (outlinerPanel) {
                        outlinerPanel.style.display = 'none';
                    }
                }
            });
        }

        // Simple direct approach for the mesh submenu
        const meshMenu = document.getElementById('mesh-menu-option');
        const submenu = meshMenu.querySelector('.submenu');

        // Direct click handler for mesh menu
        meshMenu.addEventListener('click', (e) => {
            // Prevent defaults
            e.preventDefault();
            e.stopPropagation();

            // Toggle submenu
            if (submenu.style.display === 'block') {
                submenu.style.display = 'none';
            } else {
                submenu.style.display = 'block';
            }
        });

        // Close submenu when clicking elsewhere
        document.addEventListener('click', (e) => {
            if (!meshMenu.contains(e.target)) {
                submenu.style.display = 'none';
            }
        });

        // Set up menu item events
        document.getElementById('new-scene-option').addEventListener('click', () => {
            this.resetScene();
        });

        document.getElementById('open-option').addEventListener('click', () => {
            this.fileInput.click();
        });

        document.getElementById('import-option').addEventListener('click', () => {
            this.importFileInput.click();
        });

        document.getElementById('wireframe-option').addEventListener('click', () => {
            this.setDisplayMode('wireframe');
        });

        document.getElementById('shaded-option').addEventListener('click', () => {
            this.setDisplayMode('shaded');
        });

        document.getElementById('shaded-wireframe-option').addEventListener('click', () => {
            this.setDisplayMode('shaded-wireframe');
        });

        document.getElementById('show-bones-option').addEventListener('click', () => {
            const model = this.selectedObject;
            if (model && model.userData.isModel) {
                this.toggleBoneVisualization(model, !model.userData.showBones);
            }
        });

        document.getElementById('reset-view-option').addEventListener('click', () => {
            this.resetCamera();
        });

        // Create menu options
        document.getElementById('create-cube').addEventListener('click', () => this.createPrimitive('cube'));
        document.getElementById('create-sphere').addEventListener('click', () => this.createPrimitive('sphere'));
        document.getElementById('create-cylinder').addEventListener('click', () => this.createPrimitive('cylinder'));
        document.getElementById('create-cone').addEventListener('click', () => this.createPrimitive('cone'));
        document.getElementById('create-torus').addEventListener('click', () => this.createPrimitive('torus'));
        document.getElementById('create-plane').addEventListener('click', () => this.createPrimitive('plane'));
        document.getElementById('create-tetrahedron').addEventListener('click', () => this.createPrimitive('tetrahedron'));
        document.getElementById('create-octahedron').addEventListener('click', () => this.createPrimitive('octahedron'));
        document.getElementById('create-dodecahedron').addEventListener('click', () => this.createPrimitive('dodecahedron'));
        document.getElementById('create-icosahedron').addEventListener('click', () => this.createPrimitive('icosahedron'));

        // Setup file inputs
        this.fileInput = document.createElement('input');
        this.fileInput.type = 'file';
        this.fileInput.accept = '.obj,.fbx,.gltf,.glb';
        this.fileInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                this.loadModel(e.target.files[0], false);
            }
        });

        this.importFileInput = document.createElement('input');
        this.importFileInput.type = 'file';
        this.importFileInput.accept = '.obj,.fbx,.gltf,.glb';
        this.importFileInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                this.loadModel(e.target.files[0], true);
            }
        });

        // Keyboard shortcuts
        window.addEventListener('keydown', (event) => {
            // Check if any input element has focus
            const activeElement = document.activeElement;
            const isInputFocused = activeElement.tagName === 'INPUT' ||
                activeElement.tagName === 'TEXTAREA' ||
                activeElement.isContentEditable;

            // If an input has focus, don't handle keyboard shortcuts
            if (isInputFocused) return;

            const key = event.key.toLowerCase();

            switch (key) {
                case 'w': // Translate
                    this.transformControls.setMode('translate');
                    event.preventDefault();
                    break;
                case 'e': // Rotate
                    this.transformControls.setMode('rotate');
                    event.preventDefault();
                    break;
                case 'r': // Scale
                    this.transformControls.setMode('scale');
                    event.preventDefault();
                    break;
                case 'f': // Frame selected or all
                    if (event.shiftKey) {
                        this.centerOnTarget();
                    } else {
                        this.frameSelected();
                    }
                    event.preventDefault();
                    break;
                case 'z': // Undo/Redo
                    if (event.ctrlKey || event.metaKey) {
                        if (event.shiftKey) {
                            this.redo();
                        } else {
                            this.undo();
                        }
                    }
                    event.preventDefault();
                    break;
                case 'escape': // Deselect object
                    if (this.selectedObject) {
                        this.saveSelectionState();
                        this.deselectObject();
                    }
                    break;
                case '4': // Wireframe mode
                    this.setDisplayMode('wireframe');
                    break;
                case '5': // Shaded mode
                    this.setDisplayMode('shaded');
                    break;
                // Test hotkeys removed (S and D keys)
            }
        });

        // Add event listeners for transform inputs
        this.translateXInput.addEventListener('change', () => {
            this.modelTransform.translate.x = parseFloat(this.translateXInput.value);
            this.updateModelTransform();
        });

        this.translateYInput.addEventListener('change', () => {
            this.modelTransform.translate.y = parseFloat(this.translateYInput.value);
            this.updateModelTransform();
        });

        this.translateZInput.addEventListener('change', () => {
            this.modelTransform.translate.z = parseFloat(this.translateZInput.value);
            this.updateModelTransform();
        });

        this.rotateXInput.addEventListener('change', () => {
            this.modelTransform.rotate.x = parseFloat(this.rotateXInput.value) * (Math.PI / 180);
            this.updateModelTransform();
        });

        this.rotateYInput.addEventListener('change', () => {
            this.modelTransform.rotate.y = parseFloat(this.rotateYInput.value) * (Math.PI / 180);
            this.updateModelTransform();
        });

        this.rotateZInput.addEventListener('change', () => {
            this.modelTransform.rotate.z = parseFloat(this.rotateZInput.value) * (Math.PI / 180);
            this.updateModelTransform();
        });

        this.scaleXInput.addEventListener('change', () => {
            this.modelTransform.scale.x = parseFloat(this.scaleXInput.value);
            this.updateModelTransform();
        });

        this.scaleYInput.addEventListener('change', () => {
            this.modelTransform.scale.y = parseFloat(this.scaleYInput.value);
            this.updateModelTransform();
        });

        this.scaleZInput.addEventListener('change', () => {
            this.modelTransform.scale.z = parseFloat(this.scaleZInput.value);
            this.updateModelTransform();
        });

        // Add click handler to canvas container to blur focused inputs
        this.container.addEventListener('click', (event) => {

            // Don't blur if Ctrl is pressed - this allows Ctrl+click to work for pivot setting
            if (event.ctrlKey) {
                return;
            }

            // Only blur if we have a focused transform input
            if (document.activeElement && document.activeElement.classList.contains('transform-input')) {
                document.activeElement.blur();
            }
        });

        // Set up the splitters for resizing panels
        this.setupSplitterDrag();
    }

    setupSplitterDrag() {
        const infoPanel = document.getElementById('info');
        const outlinerPanel = document.getElementById('outliner-panel');

        if (!infoPanel || !outlinerPanel) return;

        // Track if we're currently dragging
        let isDraggingInfoSplitter = false;
        let isDraggingOutlinerSplitter = false;

        // Function to handle mouse move for info panel (left splitter)
        const handleInfoPanelDrag = (e) => {
            if (!isDraggingInfoSplitter) return;

            // Set the width based on mouse position
            const newWidth = e.clientX;
            // Constrain to min width only (removing max width limit)
            const constrainedWidth = Math.max(200, newWidth);
            infoPanel.style.width = `${constrainedWidth}px`;

            // Prevent text selection during drag
            e.preventDefault();
        };

        // Function to handle mouse move for outliner panel (right splitter)
        const handleOutlinerPanelDrag = (e) => {
            if (!isDraggingOutlinerSplitter) return;

            // Calculate width from right edge
            const newWidth = window.innerWidth - e.clientX;
            // Constrain to min width only (removing max width limit)
            const constrainedWidth = Math.max(150, newWidth);
            outlinerPanel.style.width = `${constrainedWidth}px`;

            // Prevent text selection during drag
            e.preventDefault();
        };

        // Function to handle mouse up (stop dragging)
        const handleMouseUp = () => {
            isDraggingInfoSplitter = false;
            isDraggingOutlinerSplitter = false;
            document.body.style.cursor = '';
            document.removeEventListener('mousemove', handleInfoPanelDrag);
            document.removeEventListener('mousemove', handleOutlinerPanelDrag);
        };

        // Add mouse events for splitter detection and dragging
        document.addEventListener('mousedown', (e) => {
            // Check info panel splitter (right edge)
            const infoRect = infoPanel.getBoundingClientRect();
            if (e.clientX >= infoRect.right - 5 && e.clientX <= infoRect.right + 5) {
                isDraggingInfoSplitter = true;
                document.body.style.cursor = 'ew-resize';
                e.preventDefault();
            }

            // Check outliner panel splitter (left edge)
            const outlinerRect = outlinerPanel.getBoundingClientRect();
            if (e.clientX >= outlinerRect.left - 5 && e.clientX <= outlinerRect.left + 5) {
                isDraggingOutlinerSplitter = true;
                document.body.style.cursor = 'ew-resize';
                e.preventDefault();
            }
        });

        // Add mouse move listener for both splitters
        document.addEventListener('mousemove', (e) => {
            // Handle drag operations
            handleInfoPanelDrag(e);
            handleOutlinerPanelDrag(e);

            // Only update cursor if not currently dragging
            if (!isDraggingInfoSplitter && !isDraggingOutlinerSplitter) {
                const infoRect = infoPanel.getBoundingClientRect();
                const outlinerRect = outlinerPanel.getBoundingClientRect();

                // Near info panel right edge
                if (e.clientX >= infoRect.right - 5 && e.clientX <= infoRect.right + 5) {
                    document.body.style.cursor = 'ew-resize';
                }
                // Near outliner panel left edge
                else if (e.clientX >= outlinerRect.left - 5 && e.clientX <= outlinerRect.left + 5) {
                    document.body.style.cursor = 'ew-resize';
                }
                // Default cursor
                else if (document.body.style.cursor === 'ew-resize') {
                    document.body.style.cursor = '';
                }
            }
        });

        // Add mouse up listener to stop dragging
        document.addEventListener('mouseup', handleMouseUp);
    }

    updateInputs() {
        // Update translate inputs
        this.translateXInput.value = this.modelTransform.translate.x.toFixed(1);
        this.translateYInput.value = this.modelTransform.translate.y.toFixed(1);
        this.translateZInput.value = this.modelTransform.translate.z.toFixed(1);

        // Update rotate inputs - convert from radians to degrees
        this.rotateXInput.value = (this.modelTransform.rotate.x * (180 / Math.PI)).toFixed(0);
        this.rotateYInput.value = (this.modelTransform.rotate.y * (180 / Math.PI)).toFixed(0);
        this.rotateZInput.value = (this.modelTransform.rotate.z * (180 / Math.PI)).toFixed(0);

        // Update scale inputs
        this.scaleXInput.value = this.modelTransform.scale.x.toFixed(1);
        this.scaleYInput.value = this.modelTransform.scale.y.toFixed(1);
        this.scaleZInput.value = this.modelTransform.scale.z.toFixed(1);
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
        const scaleX = baseScale * this.modelTransform.scale.x;
        const scaleY = baseScale * this.modelTransform.scale.y;
        const scaleZ = baseScale * this.modelTransform.scale.z;

        this.model.scale.set(scaleX, scaleY, scaleZ);
    }

    updateTransformControls() {
        // Skip if we don't have a selected object
        if (!this.selectedObject) return;

        // Special handling for bones
        if (this.selectedBone) {
            // Update the transform controls to match the bone's world position
            if (this.selectedObject.userData.isBoneJoint) {
                const jointPos = this.selectedBone.getWorldPosition(new THREE.Vector3());
                this.selectedObject.position.copy(jointPos);
            }
            return;
        }

        // Normal object handling
        const position = new THREE.Vector3();
        const rotation = new THREE.Euler();
        const scale = new THREE.Vector3();

        // Decompose the matrix to get position, rotation, and scale
        this.selectedObject.updateMatrixWorld();
        this.selectedObject.matrixWorld.decompose(position, new THREE.Quaternion(), scale);

        // Update the transform controls
        this.transformControls.position.copy(position);
        this.transformControls.rotation.copy(rotation);
        this.transformControls.scale.copy(scale);
    }

    updateUIFromObject() {
        // Update UI values from the current transform of the selected object
        if (this.selectedObject) {
            // Store current model and its transforms
            this.model = this.selectedObject;

            // Update translation values
            this.modelTransform.translate.x = this.selectedObject.position.x;
            this.modelTransform.translate.y = this.selectedObject.position.y;
            this.modelTransform.translate.z = this.selectedObject.position.z;

            // Update rotation values - get Euler angles from the object
            this.modelTransform.rotate.x = this.selectedObject.rotation.x;
            this.modelTransform.rotate.y = this.selectedObject.rotation.y;
            this.modelTransform.rotate.z = this.selectedObject.rotation.z;

            // Calculate baseScale from the initial load or previous value
            // We want to keep the baseScale consistent
            const baseScale = this.modelTransform.baseScale;

            // Update scale values properly by dividing by the baseScale
            this.modelTransform.scale.x = this.selectedObject.scale.x / baseScale;
            this.modelTransform.scale.y = this.selectedObject.scale.y / baseScale;
            this.modelTransform.scale.z = this.selectedObject.scale.z / baseScale;

            // Update the UI inputs
            this.updateInputs();
        }
    }

    selectObject(object) {
        // Deselect current object first
        if (this.selectedObject) {
            this.deselectObject();
        }

        // Make sure object is valid and in the scene graph
        if (!object || !this.isObjectInScene(object)) {
            console.warn("Cannot select object that is not in the scene graph");
            return;
        }

        // Select new object
        this.selectedObject = object;

        // Initialize modelTransform if it doesn't exist
        if (!this.modelTransform) {
            this.modelTransform = {
                translate: { x: 0, y: 0, z: 0 },
                rotate: { x: 0, y: 0, z: 0 },
                scale: { x: 1, y: 1, z: 1 },
                baseScale: 1
            };
        }

        // Update channel box title
        if (this.channelBoxTitle) {
            this.channelBoxTitle.innerText = object.name || 'Selected Object';
        }

        // Enable transform group
        if (this.transformGroup) {
            this.transformGroup.style.opacity = '1';
            this.transformGroup.style.pointerEvents = 'auto';
        }

        // Update transform controls
        try {
            this.transformControls.attach(object);

            // Add event listener for transform changes
            const updateListener = () => {
                this.updateUIFromObject();
            };

            // Remove any existing listeners to avoid duplicates
            this.transformControls.removeEventListener('objectChange', updateListener);

            // Add new listener
            this.transformControls.addEventListener('objectChange', updateListener);
        } catch (error) {
            console.error("Error attaching transform controls:", error);
        }

        // Update input fields from object transform
        this.updateUIFromObject();

        // Check for skeleton and show bones UI if available
        if (object.userData && object.userData.hasSkeletalData) {
            this.setupBoneControls(object);
        }

        // Push to undo stack
        this.saveSelectionState();

        // Update outliner selection
        const outlinerItem = this.findOutlinerItemForObject(object);
        if (outlinerItem) {
            this.selectOutlinerItem(outlinerItem);
        }

        this.updateMorphTargetUI();
    }

    // Helper method to check if an object is in the scene graph
    isObjectInScene(object) {

        // If the object is the scene itself
        if (object === this.scene) {
            return true;
        }

        // If the object has no parent, it's not in the scene
        if (!object.parent) {
            return false;
        }

        // Recursively check if any parent is the scene
        let parent = object.parent;
        let depth = 0;
        const maxDepth = 20; // Prevent infinite loops

        while (parent && depth < maxDepth) {
            if (parent === this.scene) {
                return true;
            }
            parent = parent.parent;
            depth++;
        }

        return false;
    }

    setupBoneControls(object) {
        // Remove any existing animation controls
        this.removeBoneControls();

        // Create animation control panel if the model has animations or bones
        if ((object.userData.animations && object.userData.animations.length > 0) ||
            (object.userData.bones && object.userData.bones.length > 0)) {

            // Create container
            const boneControlsPanel = document.createElement('div');
            boneControlsPanel.className = 'channel-box';
            boneControlsPanel.id = 'bone-controls-panel';

            // Add bone visibility checkbox if bones exist
            let boneVisibilityHtml = '';
            if (object.userData.bones && object.userData.bones.length > 0) {
                boneVisibilityHtml = `
                <div class="control-group">
                    <label>Show Bones:</label>
                    <input type="checkbox" id="show-bones" ${object.userData.bonesVisible ? 'checked' : ''}>
                </div>`;
            }

            // Animation controls only if animations exist
            let animationControlsHtml = '';
            if (object.userData.animations && object.userData.animations.length > 0) {
                animationControlsHtml = `
                <h2>Animation Controls</h2>
                <div class="control-group">
                    <label>Mode:</label>
                    <div class="button-group" id="mode-toggle-group">
                        <button id="animation-mode" class="mode-button">Animation</button>
                        <button id="posing-mode" class="mode-button active">Posing</button>
                    </div>
                </div>
                <div id="animation-controls" style="display: none;">
                    <div class="control-group">
                        <label>Animation:</label>
                        <select id="animation-select" class="animation-select"></select>
                    </div>
                    <div class="control-group">
                        <label>Playback:</label>
                        <div class="button-group">
                            <button id="play-animation">Play</button>
                            <button id="pause-animation">Pause</button>
                            <button id="stop-animation">Stop</button>
                        </div>
                    </div>
                    <div class="control-group">
                        <label>Speed:</label>
                        <input type="range" id="animation-speed" min="0.1" max="2" step="0.1" value="1">
                        <span id="speed-value">1.0</span>
                    </div>
                </div>`;
            }

            // Create bone manipulator group for direct bone manipulation controls
            const boneManipulatorHtml = `
            <div id="bone-manipulator-group" class="control-group">
                <h2>Bone Manipulation</h2>
                <div class="control-group">
                    <p>Select bones directly in the scene or use the outliner to manipulate them.</p>
                </div>
            </div>`;

            // Build the HTML
            boneControlsPanel.innerHTML = `
                ${animationControlsHtml}
                ${animationControlsHtml && boneVisibilityHtml ? '<div class="separator"></div>' : ''}
                ${boneVisibilityHtml}
                ${boneManipulatorHtml}
            `;

            // Add to document after the regular channel box
            const channelBox = document.querySelector('.channel-box');
            if (channelBox && channelBox.parentNode) {
                channelBox.parentNode.insertBefore(boneControlsPanel, channelBox.nextSibling);
            } else {
                // Fallback: add to info panel
                const infoPanel = document.getElementById('info');
                if (infoPanel) {
                    infoPanel.appendChild(boneControlsPanel);
                } else {
                    // Last resort: add to body
                    document.body.appendChild(boneControlsPanel);
                }
            }

            // Store reference to the bone manipulator group
            this.boneManipulatorGroup = document.getElementById('bone-manipulator-group');

            // Set up bone visibility toggle
            if (object.userData.bones && object.userData.bones.length > 0) {
                const showBonesCheckbox = document.getElementById('show-bones');
                showBonesCheckbox.addEventListener('change', (e) => {
                    const visible = e.target.checked;
                    this.toggleBoneVisualization(object, visible);
                });

                // Initialize bone visibility
                if (object.userData.bonesVisible === undefined) {
                    object.userData.bonesVisible = true; // Default to visible
                    this.toggleBoneVisualization(object, true);
                }
            }

            // Populate animation select with available animations if they exist
            if (object.userData.animations && object.userData.animations.length > 0) {
                const animSelect = document.getElementById('animation-select');
                object.userData.animations.forEach((anim, index) => {
                    const option = document.createElement('option');
                    option.value = index;
                    option.text = anim.name || `Animation ${index + 1}`;
                    animSelect.appendChild(option);
                });

                // Set up event listeners for animation controls
                document.getElementById('animation-select').addEventListener('change', (e) => {
                    const animIndex = parseInt(e.target.value);
                    const mixer = object.userData.mixer;

                    // Stop all current actions
                    mixer.stopAllAction();

                    // Play selected animation
                    const action = mixer.clipAction(object.userData.animations[animIndex]);
                    action.play();
                });

                document.getElementById('play-animation').addEventListener('click', () => {
                    if (object.userData.mixer) {
                        object.userData.mixer.timeScale = parseFloat(document.getElementById('animation-speed').value);
                        const actions = object.userData.mixer._actions;
                        actions.forEach(action => {
                            action.paused = false;
                            action.play();
                        });
                    }
                });

                document.getElementById('pause-animation').addEventListener('click', () => {
                    if (object.userData.mixer) {
                        const actions = object.userData.mixer._actions;
                        actions.forEach(action => {
                            action.paused = true;
                        });
                    }
                });

                document.getElementById('stop-animation').addEventListener('click', () => {
                    if (object.userData.mixer) {
                        object.userData.mixer.stopAllAction();
                        // Restart the current animation but paused at the beginning
                        const animIndex = parseInt(document.getElementById('animation-select').value);
                        const action = object.userData.mixer.clipAction(object.userData.animations[animIndex]);
                        action.reset();
                    }
                });

                document.getElementById('animation-speed').addEventListener('input', (e) => {
                    const speed = parseFloat(e.target.value);
                    document.getElementById('speed-value').textContent = speed.toFixed(1);
                    if (object.userData.mixer) {
                        object.userData.mixer.timeScale = speed;
                    }
                });
            }

            // Set up mode toggle
            document.getElementById('animation-mode').addEventListener('click', () => {
                // Switch to animation mode
                document.getElementById('animation-mode').classList.add('active');
                document.getElementById('posing-mode').classList.remove('active');
                document.getElementById('animation-controls').style.display = 'block';

                // Set the mode flag
                object.userData.posingMode = false;

                // Start playing the selected animation
                if (object.userData.mixer) {
                    const animIndex = parseInt(document.getElementById('animation-select').value);
                    const action = object.userData.mixer.clipAction(object.userData.animations[animIndex]);
                    object.userData.mixer.stopAllAction();
                    action.play();
                }
            });

            document.getElementById('posing-mode').addEventListener('click', () => {
                // Switch to posing mode
                document.getElementById('posing-mode').classList.add('active');
                document.getElementById('animation-mode').classList.remove('active');
                document.getElementById('animation-controls').style.display = 'none';

                // Set the mode flag
                object.userData.posingMode = true;

                // Stop all animations
                if (object.userData.mixer) {
                    object.userData.mixer.stopAllAction();
                }
            });
        }
    }

    removeBoneControls() {
        const existingPanel = document.getElementById('bone-controls-panel');
        if (existingPanel) {
            existingPanel.remove();
        }

        // Clear reference to bone manipulator group
        this.boneManipulatorGroup = null;
    }

    // Reset the scene to its initial state - new functionality
    resetScene() {
        // Confirm with the user to prevent accidental resets
        if (!confirm('Create a new scene? All unsaved changes will be lost.')) {
            return;
        }

        // Deselect any currently selected object
        this.deselectObject();

        // Clear transform controls
        this.transformControls.detach();

        // Remove all user-added models from the scene
        [...this.models].forEach(model => {
            this.scene.remove(model);

            // Clean up any bone-related objects for this model
            if (model.userData && model.userData.skeletonHelper) {
                this.scene.remove(model.userData.skeletonHelper);
            }
        });

        // Clear the models array
        this.models = [];
        this.model = null;

        // Clear selection
        this.selectedObject = null;
        this.selectedBone = null;

        // Reset camera position
        this.resetCamera();

        // Clear undo/redo stacks
        this.undoStack = [];
        this.redoStack = [];

        // Reset display mode
        this.setDisplayMode('shaded');

        // Clean up any wireframe helpers
        this.scene.traverse(object => {
            if (object.userData && object.userData.isWireframeHelper) {
                object.parent.remove(object);
            }
        });

        // Update the outliner to show the empty scene
        this.updateOutliner();

        console.log('Scene reset to initial state');
    }

    deselectObject() {
        // If we have a selected object, deselect it
        if (this.selectedObject) {
            // Detach the transform controls
            this.transformControls.detach();

            // Remove the outline
            this.outlinePass.selectedObjects = [];

            this.selectedObject = null;

            // Clear selected bone reference
            this.selectedBone = null;

            // Update channel box title
            document.getElementById('channel-box-title').innerText = 'No Object Selected';

            // Reset transform inputs
            this.resetTransformInputs();

            // Remove active selection in outliner
            const activeElements = document.querySelectorAll('.outliner-item.active');
            activeElements.forEach(element => element.classList.remove('active'));
        }
    }

    enableTumbleControls(enabled) {
        // This function can be used to enable/disable camera tumbling
        // when using the transform controls
        this.tumbleControlsEnabled = enabled;
    }

    resetTransform() {
        // Reset to initial values
        this.modelTransform.translate = { x: 0, y: 0, z: 0 };
        this.modelTransform.rotate = { x: 0, y: 0, z: 0 };
        this.modelTransform.scale = { x: 1, y: 1, z: 1 };

        // Update sliders and model
        this.updateInputs();
        this.updateModelTransform();
    }

    // Reset transform inputs in the UI
    resetTransformInputs() {
        // Reset the transform input fields to default values
        document.getElementById('translate-x').value = '0';
        document.getElementById('translate-y').value = '0';
        document.getElementById('translate-z').value = '0';

        document.getElementById('rotate-x').value = '0';
        document.getElementById('rotate-y').value = '0';
        document.getElementById('rotate-z').value = '0';

        document.getElementById('scale-x').value = '1';
        document.getElementById('scale-y').value = '1';
        document.getElementById('scale-z').value = '1';
    }

    // Main model loading function that handles different file types
    loadModel(file, isImport = false) {
        // Get file extension to determine which loader to use
        const fileName = file.name;
        const extension = fileName.split('.').pop().toLowerCase();

        // Create file URL
        const fileURL = URL.createObjectURL(file);

        // If not importing, remove all previous models
        if (!isImport && this.models.length > 0) {
            // Clean up skeleton helpers first
            this.cleanupSkeletonHelpers();

            this.models.forEach(model => {
                this.scene.remove(model);
            });
            this.models = [];
            this.model = null;
        }

        // Initialize tracking for this file
        this.loadingModels[fileURL] = {
            status: 'loading',
            fileName: fileName
        };

        // Choose the appropriate loader based on file extension
        switch (extension) {
            case 'obj':
                this.loadOBJFile(fileURL, fileName, isImport);
                break;
            case 'fbx':
                this.loadFBXFile(fileURL, fileName, isImport);
                break;
            case 'gltf':
            case 'glb':
                this.loadGLTFFile(fileURL, fileName, isImport);
                break;
            default:
                console.error('Unsupported file format:', extension);
                alert('Unsupported file format. Please use OBJ, FBX, or GLTF/GLB files.');
                URL.revokeObjectURL(fileURL);
                delete this.loadingModels[fileURL];
                return;
        }
    }

    // Load OBJ file
    loadOBJFile(fileURL, fileName, isImport) {
        const loader = new THREE.OBJLoader();

        loader.load(
            fileURL,
            (object) => {
                // Mark as success before processing
                if (this.loadingModels[fileURL]) {
                    this.loadingModels[fileURL].status = 'success';
                }

                this.processLoadedModel(object, fileName, isImport, 'obj');
                URL.revokeObjectURL(fileURL);

                // Clean up tracking
                delete this.loadingModels[fileURL];
            },
            (xhr) => {
                console.log(`${(xhr.loaded / xhr.total * 100).toFixed(2)}% loaded`);
            },
            (error) => {
                console.error('Error loading OBJ file:', error);

                // Only show alert if we haven't already loaded this model successfully
                if (this.loadingModels[fileURL] && this.loadingModels[fileURL].status !== 'success') {
                    alert('Error loading the 3D model. Please try another file.');
                }

                // Clean up
                URL.revokeObjectURL(fileURL);
                delete this.loadingModels[fileURL];
            }
        );
    }

    // Load FBX file
    loadFBXFile(fileURL, fileName, isImport) {
        const loader = new THREE.FBXLoader();

        loader.load(
            fileURL,
            (object) => {
                // Mark as success before processing
                if (this.loadingModels[fileURL]) {
                    this.loadingModels[fileURL].status = 'success';
                }

                this.processLoadedModel(object, fileName, isImport);
                URL.revokeObjectURL(fileURL);

                // Clean up tracking
                delete this.loadingModels[fileURL];
            },
            (xhr) => {
                console.log(`${(xhr.loaded / xhr.total * 100).toFixed(2)}% loaded`);
            },
            (error) => {
                console.error('Error loading FBX file:', error);

                // Only show alert if we haven't already loaded this model successfully
                if (this.loadingModels[fileURL] && this.loadingModels[fileURL].status !== 'success') {
                    alert('Error loading the 3D model. Please try another file.');
                }

                // Clean up
                URL.revokeObjectURL(fileURL);
                delete this.loadingModels[fileURL];
            }
        );
    }

    // Load GLTF/GLB file
    loadGLTFFile(fileURL, fileName, isImport) {
        const loader = new THREE.GLTFLoader();

        loader.load(
            fileURL,
            (gltf) => {
                // Mark as success before processing
                if (this.loadingModels[fileURL]) {
                    this.loadingModels[fileURL].status = 'success';
                }

                // GLTF loader returns a different structure, extract the scene
                const object = gltf.scene;
                // Rename the root object to make it clear it's a model group
                object.name = fileName.split('.')[0] + '_group';
                this.processLoadedModel(object, fileName, isImport);
                URL.revokeObjectURL(fileURL);

                // Clean up tracking
                delete this.loadingModels[fileURL];
            },
            (xhr) => {
                console.log(`${(xhr.loaded / xhr.total * 100).toFixed(2)}% loaded`);
            },
            (error) => {
                console.error('Error loading GLTF file:', error);

                // Only show alert if we haven't already loaded this model successfully
                if (this.loadingModels[fileURL] && this.loadingModels[fileURL].status !== 'success') {
                    alert('Error loading the 3D model. Please try another file.');
                }

                // Clean up
                URL.revokeObjectURL(fileURL);
                delete this.loadingModels[fileURL];
            }
        );
    }

    // Unified primitive creation method
    createPrimitive(primitiveType) {
        let geometry;
        let name = primitiveType.charAt(0).toUpperCase() + primitiveType.slice(1);

        // Create the appropriate geometry based on primitive type
        switch (primitiveType.toLowerCase()) {
            case 'cube':
                geometry = new THREE.BoxGeometry(1, 1, 1);
                break;
            case 'sphere':
                geometry = new THREE.SphereGeometry(0.5, 32, 32);
                break;
            case 'cylinder':
                geometry = new THREE.CylinderGeometry(0.5, 0.5, 1, 32);
                break;
            case 'cone':
                geometry = new THREE.ConeGeometry(0.5, 1, 32);
                break;
            case 'torus':
                geometry = new THREE.TorusGeometry(0.5, 0.2, 16, 32);
                break;
            case 'plane':
                geometry = new THREE.PlaneGeometry(1, 1);
                break;
            case 'tetrahedron':
                geometry = new THREE.TetrahedronGeometry(0.5);
                break;
            case 'octahedron':
                geometry = new THREE.OctahedronGeometry(0.5);
                break;
            case 'dodecahedron':
                geometry = new THREE.DodecahedronGeometry(0.5);
                break;
            case 'icosahedron':
                geometry = new THREE.IcosahedronGeometry(0.5);
                break;
            default:
                console.warn(`Unknown primitive type: ${primitiveType}`);
                return null;
        }

        // Create material and mesh
        const material = new THREE.MeshStandardMaterial({
            color: 0x888888,
            roughness: 0.5,
            metalness: 0.5
        });

        // Create a group for the primitive
        const group = new THREE.Group();
        group.name = name;

        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = name + 'Shape';

        // Add mesh to group and group to scene
        group.add(mesh);
        this.scene.add(group);
        this.models.push(group);

        // Set as current model and select it
        this.model = group;
        this.selectObject(group);

        // Update the outliner
        this.updateOutliner();

        return group;
    }

    // Process a loaded model regardless of file type
    processLoadedModel(object, fileName, isImport, fileType = '') {
        // Give the object a name based on file name if it doesn't have one
        if (!object.name || object.name === '') {
            object.name = fileName.split('.')[0];
        }

        // Rename any meshes to include 'Shape' only for OBJ files
        if (fileType === 'obj') {
            object.traverse((child) => {
                if (child.isMesh) {
                    child.name = child.name + 'Shape';
                }
            });
        }

        // Scale the model to fit in view
        const boundingBox = new THREE.Box3().setFromObject(object);
        const size = boundingBox.getSize(new THREE.Vector3());
        const maxDimension = Math.max(size.x, size.y, size.z);

        if (maxDimension > 10) {
            const scale = 10 / maxDimension;
            object.scale.multiplyScalar(scale);
        }

        // Normalize position
        boundingBox.setFromObject(object);
        const center = boundingBox.getCenter(new THREE.Vector3());
        object.position.x -= center.x;
        object.position.y -= boundingBox.min.y; // Set on ground
        object.position.z -= center.z;

        // Assume we have THREE.js installed
        // Add model to scene
        this.scene.add(object);

        // Add model to our models array
        this.models.push(object);

        // Set as current model (the last loaded/imported becomes current)
        this.model = object;

        // Setup materials for the model
        this.setupModelMaterials(object);

        // Check for animations
        let animations = [];
        if (object.animations) {
            animations = object.animations;
        }

        // If a GLTF/FBX file, find animations in children
        if (animations.length === 0) {
            object.traverse(child => {
                if (child.animations && child.animations.length) {
                    animations = animations.concat(child.animations);
                }
            });
        }

        // If we have animations, set up animation mixer
        if (animations.length > 0) {
            console.error(`Model has animations: ${animations.length || object.animations.length}`);
            const mixer = new THREE.AnimationMixer(object);
            object.userData.mixer = mixer;
            object.userData.animations = animations;
            object.userData.currentAnimation = null;
            object.userData.posingMode = false; // Start in animation mode
        }

        // Check for skeletal data (bones)
        const skeletons = [];
        const bones = [];

        object.traverse(child => {
            if (child.isSkinnedMesh && child.skeleton) {
                skeletons.push(child.skeleton);
                child.skeleton.bones.forEach((bone) => {
                    if (!bones.includes(bone)) {
                        bones.push(bone);
                    }
                });
            }
        });

        if (bones.length > 0) {
            console.error('Model has skeletal data with', skeletons.length, 'skeletons and', bones.length, 'bones');

            // Store bones for later use
            object.userData.hasSkeletalData = true;
            object.userData.bones = bones;
            object.userData.posingMode = true; // Start in posing mode by default

            // Store bone reference for selection
            object.userData.boneHelpers = {};
            bones.forEach(bone => {
                object.userData.boneHelpers[bone.id] = bone;
            });

            // Create skeleton helper
            if (object.userData.skeletonHelper) {
                this.scene.remove(object.userData.skeletonHelper);
            }

            // Find the first skinned mesh to use for the skeleton helper
            let skinnedMesh = null;
            object.traverse(child => {
                if (child.isSkinnedMesh && !skinnedMesh) {
                    skinnedMesh = child;
                }
            });

            if (skinnedMesh) {
                // Use the root bone for better visualization
                const rootBone = bones[0];
                const skeletonHelper = new THREE.SkeletonHelper(rootBone);
                skeletonHelper.material.linewidth = 2;
                skeletonHelper.visible = true;
                // Make lines more visible with a different color
                skeletonHelper.material.color.set(0x00ff00);
                // Add to scene, not to the model, for correct rendering
                this.scene.add(skeletonHelper);
                object.userData.skeletonHelper = skeletonHelper;
                // Set initial visibility based on bonesVisible state
                object.userData.bonesVisible = true;
            }
        }

        // Reset the camera to fit the model
        this.zoomToFitAllModels();

        // Update the outliner to show the new model
        this.updateOutliner();

        console.error(`Model ${isImport ? 'imported' : 'loaded'}: ${object.name}`);

        // Removed automatic selection of first model

        // Check for morph targets
        object.traverse((child) => {
            if (child.isMesh && child.morphTargetInfluences && child.morphTargetInfluences.length > 0) {
                // Get the actual morph target names from the mesh
                const morphTargetNames = child.morphTargetDictionary || {};

                // If no dictionary exists, create one with the actual names
                if (Object.keys(morphTargetNames).length === 0) {
                    // For each morph target influence, get or create a name
                    for (let i = 0; i < child.morphTargetInfluences.length; i++) {
                        // Try to get the actual name from the mesh
                        let name = child.geometry?.morphTargetDictionary?.[i];
                        if (!name) {
                            name = `Target ${i + 1}`;
                        }
                        morphTargetNames[i] = name;
                    }
                    child.morphTargetDictionary = morphTargetNames;
                }
            }
        });
    }

    setupModelMaterials(model) {
        try {
            // Enable shadows and set up materials
            model.traverse((child) => {
                if (child.isMesh) {
                    // Apply shadow properties
                    child.castShadow = true;
                    child.receiveShadow = true;

                    // Set default material if missing
                    if (!child.material) {
                        child.material = new THREE.MeshStandardMaterial({
                            color: 0x808080,
                            metalness: 0.1, // Reduced metalness from 0.2 to 0.1
                            roughness: 0.9  // Increased roughness from 0.8 to 0.9
                        });
                    }

                    // Only convert materials if necessary
                    if (child.material &&
                        !(child.material instanceof THREE.MeshStandardMaterial) &&
                        !(child.material instanceof THREE.MeshPhongMaterial) &&
                        !(child.material instanceof THREE.MeshLambertMaterial)) {

                        try {
                            // Get color from existing material or use default
                            const color = child.material.color ?
                                child.material.color.clone() :
                                new THREE.Color(0x808080);

                            // Create new standard material with better highlight handling
                            const newMaterial = new THREE.MeshStandardMaterial({
                                color: color,
                                metalness: 0.1, // Reduced metalness from 0.2 to 0.1
                                roughness: 0.9  // Increased roughness from 0.8 to 0.9
                            });

                            child.material = newMaterial;
                        } catch (e) {
                            console.warn("Could not convert material, using default", e);
                            child.material = new THREE.MeshStandardMaterial({
                                color: 0x808080,
                                metalness: 0.1, // Reduced metalness from 0.2 to 0.1
                                roughness: 0.9  // Increased roughness from 0.8 to 0.9
                            });
                        }
                    } else if (child.material instanceof THREE.MeshStandardMaterial) {
                        // If it's already a MeshStandardMaterial, adjust its properties for better highlights
                        child.material.metalness = 0.1; // Reduced metalness
                        child.material.roughness = 0.9; // Increased roughness
                    }

                    // Safely compute vertex normals if geometry exists
                    if (child.geometry) {
                        try {
                            child.geometry.computeVertexNormals();

                            // Mark normals for update if they exist
                            if (child.geometry.attributes && child.geometry.attributes.normal) {
                                child.geometry.attributes.normal.needsUpdate = true;
                            }
                        } catch (e) {
                            console.warn("Could not compute normals for mesh", e);
                        }
                    }
                }
            });
        } catch (e) {
            console.warn("Error in setupModelMaterials", e);
            // Don't throw the error further to prevent the alert
        }
    }

    zoomToFitAllModels() {
        // Only proceed if we have models
        if (this.models.length === 0) return;

        // Calculate the bounding box of all models
        let allModelsBoundingBox = null;

        this.models.forEach(model => {
            const modelBox = new THREE.Box3().setFromObject(model);

            // If this is the first model, just use its bounding box
            if (!allModelsBoundingBox) {
                allModelsBoundingBox = modelBox;
            } else {
                // Otherwise, create a union of the current box and the model box
                allModelsBoundingBox.union(modelBox);
            }
        });

        // If we couldn't create a bounding box, exit
        if (!allModelsBoundingBox) return;

        // Get the center and size of the combined bounding box
        const center = allModelsBoundingBox.getCenter(new THREE.Vector3());
        const size = allModelsBoundingBox.getSize(new THREE.Vector3());

        // Calculate distance needed to fit all models in view
        const maxDim = Math.max(size.x, size.y, size.z);
        const fov = this.camera.fov * (Math.PI / 180);
        const distance = Math.abs(maxDim / Math.sin(fov / 2)) * 1.2; // Add 20% margin

        // Position camera to see all models
        this.camera.position.set(
            center.x,
            center.y + distance * 0.25,
            center.z + distance
        );

        // Update camera target to the center of all models
        this.cameraTarget.copy(center);
        this.pivotPoint.copy(center);

        // Look at the center
        this.camera.lookAt(this.cameraTarget);
        this.camera.updateProjectionMatrix();
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

        // Update composer size
        if (this.composer) {
            this.composer.setSize(this.container.clientWidth, this.container.clientHeight);

            // Update FXAA shader resolution uniforms
            this.composer.passes.forEach(pass => {
                if (pass.material && pass.material.uniforms && pass.material.uniforms.resolution) {
                    pass.material.uniforms.resolution.value.set(
                        1 / this.container.clientWidth,
                        1 / this.container.clientHeight
                    );
                }
            });
        }

        // Update outline pass size
        if (this.outlinePass) {
            this.outlinePass.resolution.copy(
                new THREE.Vector2(this.container.clientWidth, this.container.clientHeight)
            );
        }

        // Handle mobile panel visibility on resize
        const infoPanel = document.getElementById('info');
        const outlinerPanel = document.getElementById('outliner-panel');

        if (infoPanel) {
            // Handle desktop mode (> 768px)
            if (window.innerWidth > 768) {
                infoPanel.style.display = 'flex';
                infoPanel.classList.remove('visible');

                // Show outliner in normal position on desktop
                if (outlinerPanel) {
                    outlinerPanel.style.display = 'block';
                    outlinerPanel.style.position = '';
                    outlinerPanel.style.top = '';
                    outlinerPanel.style.right = '';
                    outlinerPanel.style.width = '';
                    outlinerPanel.style.maxWidth = '';
                    outlinerPanel.style.boxShadow = '';
                }
            } else {
                // Mobile mode (≤ 768px)
                // Keep panel hidden in mobile unless explicitly toggled
                if (!infoPanel.classList.contains('visible')) {
                    infoPanel.style.display = 'none';

                    // Also hide outliner on mobile
                    if (outlinerPanel) {
                        outlinerPanel.style.display = 'none';
                    }
                }
            }
        }
    }

    animate() {
        requestAnimationFrame(() => this.animate());

        // Update clock
        const delta = this.clock.getDelta();

        // Update any animation mixers, but only if not in posing mode
        this.models.forEach(model => {
            // Check if model has animation mixer and is not in posing mode
            if (model.userData && model.userData.mixer && model.userData.posingMode !== true) {
                model.userData.mixer.update(delta);
            }

            // SkeletonHelper will update automatically if the bones move
            // No need to manually update it as we did with the custom bone visualization
        });

        // Make sure camera is looking at target point
        this.camera.lookAt(this.cameraTarget);

        // Update pivot indicator position (but don't change visibility here)
        this.updatePivotIndicator();

        // Render using effect composer instead of directly rendering
        if (this.composer) {
            this.composer.render();
        } else {
            // Fallback to direct rendering if composer isn't available
            this.renderer.render(this.scene, this.camera);
        }
    }

    // Helper to find model that contains a specific bone
    findModelForBone(bone) {
        for (const model of this.models) {
            if (model.userData && model.userData.bones && model.userData.bones.includes(bone)) {
                return model;
            }
        }
        return null;
    }

    setupMayaControls() {
        const renderer = this.renderer.domElement;
        let isAltDown = false;
        let isCtrlDown = false;

        // Variables to track mouse positions
        const mouse = { x: 0, y: 0 };
        const prevMouse = { x: 0, y: 0 };

        // Tracking active control mode
        let activeControl = null;

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

        // Handle key events
        window.addEventListener('keydown', (event) => {
            if (event.key === 'Alt') {
                isAltDown = true;
                renderer.style.cursor = 'pointer'; // Change cursor to indicate selection mode
                // Disable transform controls when Alt is pressed
                if (this.transformControls) {
                    this.transformControls.enabled = false;
                }
                event.preventDefault();
            } else if (event.key === 'Control') {
                isCtrlDown = true;
                // Show pivot indicator when Ctrl is pressed
                if (this.pivotIndicator) {
                    this.pivotIndicator.visible = true;
                }
            }
        });

        window.addEventListener('keyup', (event) => {
            if (event.key === 'Alt') {
                isAltDown = false;
                renderer.style.cursor = 'default';
                // Re-enable transform controls when Alt is released
                if (this.transformControls) {
                    this.transformControls.enabled = true;
                }
            } else if (event.key === 'Control') {
                isCtrlDown = false;
                // Hide pivot indicator when Ctrl is released
                if (this.pivotIndicator) {
                    this.pivotIndicator.visible = false;
                }
            }
        });

        // Handle mouse down
        renderer.addEventListener('mousedown', (event) => {
            // Get mouse position in normalized coordinates
            const rect = renderer.getBoundingClientRect();
            mouse.x = event.clientX - rect.left;
            mouse.y = event.clientY - rect.top;
            prevMouse.x = mouse.x;
            prevMouse.y = mouse.y;

            // If Alt is pressed, handle selection
            if (isAltDown) {
                const raycaster = getMouseRay(mouse.x, mouse.y);
                event.preventDefault();
                return;
            }

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
        });

        // Handle direct click on mesh to set tumble pivot point (with Ctrl)
        renderer.addEventListener('click', (event) => {

            // If Alt is pressed, don't do any selection
            if (isAltDown) {
                event.preventDefault();
                return;
            }

            // Only apply for left mouse button clicks WITH Ctrl key
            if (event.button === 0 && isCtrlDown) {
                // Get accurate client coordinates relative to the renderer
                const rect = renderer.getBoundingClientRect();
                const mouseX = event.clientX - rect.left;
                const mouseY = event.clientY - rect.top;

                // Get raycaster from camera through click point
                const raycaster = getMouseRay(mouseX, mouseY);

                const intersects = raycaster.intersectObjects(this.scene.children, true);

                const filteredIntersects = intersects.filter(intersect => {
                    // Filter out wireframe helpers
                    if (intersect.object.userData &&
                        (intersect.object.userData.isWireframeHelper ||
                            intersect.object.userData.noSelection)) {
                        return false;
                    }

                    // Check if the hit object is part of any user-added model
                    for (const model of this.models) {
                        if (model === intersect.object || this.isObjectDescendantOf(intersect.object, model)) {
                            return true; // Found a match, keep this intersection
                        }
                    }

                    // If we got here, no match was found
                    return false;
                });

                // If we hit something, update the pivot point without moving the camera
                if (filteredIntersects.length > 0) {
                    // Set the new pivot point to the intersection point
                    this.pivotPoint.copy(filteredIntersects[0].point);

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
                // Make sure transform controls don't receive these events
                event.stopPropagation();

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

            // Make sure transform controls don't receive these events
            event.stopPropagation();

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
                // Adaptive zoom that normalizes speed based on distance

                // Get vector from camera to target (center of view)
                const zoomDirection = new THREE.Vector3().subVectors(
                    this.cameraTarget,
                    this.camera.position
                ).normalize();

                // Calculate current distance to target
                const currentDistance = this.camera.position.distanceTo(this.cameraTarget);

                // Base zoom speed - this determines the "feel" of zooming
                // Reduced by 25% from 0.01 to 0.0075
                const baseZoomSpeed = 0.00375; // Reduced by half to make zooming more precise

                // Scale zoom speed based on distance
                // This makes zoom take roughly the same mouse movement regardless of distance
                const adaptiveZoomSpeed = baseZoomSpeed * Math.max(currentDistance, 0.5);

                // Calculate zoom amount based on mouse movement and adaptive speed
                const zoomAmount = deltaX * adaptiveZoomSpeed;

                // Move camera along the view direction (toward camera target)
                this.camera.position.addScaledVector(zoomDirection, zoomAmount);

                // Log for debugging
                // console.log(`Distance: ${currentDistance.toFixed(2)}, Zoom speed: ${adaptiveZoomSpeed.toFixed(4)}`);
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

        // Add mouse wheel zoom with adaptive speed based on distance
        renderer.addEventListener('wheel', (event) => {
            // Get current distance to target
            const currentDistance = this.camera.position.distanceTo(this.cameraTarget);

            // Base zoom speed - this determines the "feel" of zooming
            // Reduced by 25% from 0.01 to 0.0075
            const baseZoomSpeed = 0.00375; // Reduced by half to make zooming more precise

            // Scale zoom speed based on distance
            // This makes zoom take roughly the same mouse movement regardless of distance
            const adaptiveZoomSpeed = baseZoomSpeed * Math.max(currentDistance, 0.5);

            // Calculate zoom factor from wheel delta
            const zoomFactor = -adaptiveZoomSpeed * Math.sign(event.deltaY) * Math.min(Math.abs(event.deltaY), 50);

            // Get fixed zoom direction from camera to target (center of view)
            const zoomDirection = new THREE.Vector3().subVectors(
                this.cameraTarget,
                this.camera.position
            ).normalize();

            // Apply zoom by moving camera along zoom direction
            this.camera.position.addScaledVector(zoomDirection, zoomFactor);

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
        // Only update the position of the pivot indicator to match our pivot point
        if (this.pivotIndicator) {
            this.pivotIndicator.position.copy(this.pivotPoint);
            // Note: Visibility is now controlled by Ctrl key state
        }
    }

    addNavigationHelp() {
        // Add help text for navigation at the bottom of the screen
        const helpContainer = document.createElement('div');
        helpContainer.classList.add('navigation-help');
        helpContainer.innerHTML = `
            <div class="help-icon">?</div>
            <div class="help-content">
                <h3>Navigation Controls</h3>
                <ul>
                    <li><strong>Alt + Left Mouse:</strong> Tumble/Orbit</li>
                    <li><strong>Alt + Middle Mouse:</strong> Pan</li>
                    <li><strong>Alt + Right Mouse:</strong> Zoom</li>
                    <li><strong>Mouse Wheel:</strong> Zoom In/Out</li>
                    <li><strong>F:</strong> Frame Selected Object</li>
                    <li><strong>Shift+F:</strong> Center on Target</li>
                    <li><strong>Ctrl + Click:</strong> Set Pivot Point</li>
                </ul>
                <h3>Manipulation</h3>
                <ul>
                    <li><strong>Left Click:</strong> Select object or bone</li>
                    <li><strong>W key:</strong> Translate mode</li>
                    <li><strong>E key:</strong> Rotate mode</li>
                    <li><strong>R key:</strong> Scale mode</li>
                    <li><strong>Esc:</strong> Deselect</li>
                </ul>
                <h3>Component Selection</h3>
                <ul>
                    <li><strong>Object Mode:</strong> Select whole objects</li>
                    <li><strong>Vertex Mode:</strong> Select individual vertices</li>
                    <li><strong>Edge Mode:</strong> Select model edges</li>
                    <li><strong>Face Mode:</strong> Select model faces</li>
                </ul>
            </div>
        `;
        document.body.appendChild(helpContainer);

        // Add styles for navigation help
        const navHelpStyle = document.createElement('style');
        navHelpStyle.textContent = `
            .navigation-help {
                position: fixed;
                bottom: 20px;
                right: 20px;
                z-index: 1000;
                font-family: Arial, sans-serif;
            }
            .help-icon {
                width: 40px;
                height: 40px;
                line-height: 40px;
                background: rgba(0,0,0,0.7);
                color: white;
                border-radius: 50%;
                text-align: center;
                cursor: pointer;
                font-size: 24px;
                box-shadow: 0 2px 5px rgba(0,0,0,0.3);
            }
            .help-content {
                position: absolute;
                bottom: 50px;
                right: 0;
                background: rgba(0,0,0,0.8);
                color: white;
                padding: 15px;
                border-radius: 5px;
                width: 280px;
                max-width: 90vw;
                box-shadow: 0 2px 10px rgba(0,0,0,0.5);
            }
            .help-content h3 {
                margin-top: 10px;
                margin-bottom: 10px;
                font-size: 16px;
            }
            .help-content ul {
                padding-left: 20px;
                margin-bottom: 10px;
            }
            .help-content li {
                margin-bottom: 5px;
                font-size: 14px;
            }
        `;
        document.head.appendChild(navHelpStyle);

        // Add help specifically for touchscreen users
        const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
        if (isTouchDevice) {
            this.addTouchHelp();
        }

        // Toggle visibility of help content on click
        const helpIcon = helpContainer.querySelector('.help-icon');
        const helpContent = helpContainer.querySelector('.help-content');
        helpContent.style.display = 'none'; // Initially hidden

        helpIcon.addEventListener('click', () => {
            helpContent.style.display = helpContent.style.display === 'none' ? 'block' : 'none';
        });
    }

    addTouchHelp() {
        // Create mobile touch help container
        const touchHelpContainer = document.createElement('div');
        touchHelpContainer.classList.add('touch-help');
        touchHelpContainer.innerHTML = `
            <div class="touch-help-icon">👆</div>
            <div class="touch-help-content">
                <h3>Touch Controls</h3>
                <ul>
                    <li><strong>One Finger:</strong> Rotate/Tumble</li>
                    <li><strong>Two Fingers:</strong> Pinch to Zoom, Move to Pan</li>
                    <li><strong>Three Fingers:</strong> Pan Camera</li>
                    <li><strong>Tap:</strong> Select Object/Bone</li>
                    <li><strong>Touch & Drag:</strong> Manipulate Selected Bone</li>
                </ul>
                <p>Use the transform control buttons (translate, rotate, scale) 
                to choose which transformation to apply when manipulating bones.</p>
            </div>
        `;
        document.body.appendChild(touchHelpContainer);

        // Add styles for the touch help
        const style = document.createElement('style');
        style.textContent = `
            .touch-help {
                position: fixed;
                bottom: 20px;
                left: 20px;
                z-index: 1000;
                font-family: Arial, sans-serif;
            }
            .touch-help-icon {
                width: 40px;
                height: 40px;
                line-height: 40px;
                background: rgba(0,0,0,0.7);
                color: white;
                border-radius: 50%;
                text-align: center;
                cursor: pointer;
                font-size: 24px;
                box-shadow: 0 2px 5px rgba(0,0,0,0.3);
            }
            .touch-help-content {
                display: none;
                position: absolute;
                bottom: 50px;
                right: 0;
                background: rgba(0,0,0,0.8);
                color: white;
                padding: 15px;
                border-radius: 5px;
                width: 280px;
                max-width: 90vw;
                box-shadow: 0 2px 10px rgba(0,0,0,0.5);
            }
            .touch-help-content h3 {
                margin-top: 0;
                margin-bottom: 10px;
                font-size: 16px;
            }
            .touch-help-content ul {
                padding-left: 20px;
                margin-bottom: 10px;
            }
            .touch-help-content li {
                margin-bottom: 5px;
                font-size: 14px;
            }
            .touch-help-content p {
                font-size: 14px;
                margin-top: 10px;
                font-style: italic;
            }
            @media (min-width: 769px) {
                .touch-help {
                    display: none;
                }
            }
        `;
        document.head.appendChild(style);

        // Toggle visibility of touch help content on click
        const touchHelpIcon = touchHelpContainer.querySelector('.touch-help-icon');
        const touchHelpContent = touchHelpContainer.querySelector('.touch-help-content');

        touchHelpIcon.addEventListener('click', () => {
            touchHelpContent.style.display = touchHelpContent.style.display === 'none' ? 'block' : 'none';
        });

        // Auto-show the touch help the first time
        setTimeout(() => {
            touchHelpContent.style.display = 'block';
            // Auto-hide after 5 seconds
            setTimeout(() => {
                touchHelpContent.style.display = 'none';
            }, 5000);
        }, 1000);
    }

    // ----- UNDO/REDO SYSTEM -----

    // Save the current transform state to the undo stack
    saveTransformState() {
        if (!this.selectedObject || this.isUndoRedoAction) return;

        const state = {
            type: 'transform',
            transform: JSON.parse(JSON.stringify(this.modelTransform)),
            objectId: this.selectedObject.id
        };

        this.pushToUndoStack(state);
    }

    // Save the current selection state to the undo stack
    saveSelectionState() {
        const state = {
            type: 'selection',
            selectedObjectId: this.selectedObject ? this.selectedObject.id : null
        };

        this.pushToUndoStack(state);
    }

    // Push a new state to the undo stack
    pushToUndoStack(state) {
        this.undoStack.push(state);
        // Clear redo stack when a new action is performed
        this.redoStack = [];

        // Limit undo stack size
        if (this.undoStack.length > this.maxUndoSteps) {
            this.undoStack.shift();
        }
    }

    // Undo the last action
    undo() {
        if (this.undoStack.length === 0) return;

        const state = this.undoStack.pop();
        this.redoStack.push(this.getCurrentState());
        this.applyState(state);
    }

    // Redo the last undone action
    redo() {
        if (this.redoStack.length === 0) return;

        const state = this.redoStack.pop();
        this.undoStack.push(this.getCurrentState());
        this.applyState(state);
    }

    // Get the current state
    getCurrentState() {
        if (this.selectedObject) {
            return {
                type: 'transform',
                transform: JSON.parse(JSON.stringify(this.modelTransform)),
                objectId: this.selectedObject.id
            };
        } else {
            return {
                type: 'selection',
                selectedObjectId: null
            };
        }
    }

    // Apply a saved state
    applyState(state) {
        this.isUndoRedoAction = true;

        if (state.type === 'transform') {
            // Restore transform state
            if (this.selectedObject && this.selectedObject.id === state.objectId) {
                this.modelTransform = JSON.parse(JSON.stringify(state.transform));
                this.updateInputs();
                this.updateModelTransform();
                this.updateTransformControls();
            }
        } else if (state.type === 'selection') {
            // Restore selection state
            if (state.selectedObjectId === null) {
                this.deselectObject();
            } else if (this.model && this.model.id === state.selectedObjectId) {
                this.selectObject(this.model);
            }
        }

        this.isUndoRedoAction = false;
    }

    // Method to set the display mode for all models
    setDisplayMode(mode) {
        // First, clean up any wireframe helpers
        this.scene.traverse(object => {
            if (object.userData && object.userData.isWireframeHelper) {
                object.parent.remove(object);
            }
        });

        // Set display mode for all models
        switch (mode) {
            case 'wireframe':
                this.models.forEach(model => {
                    model.traverse(child => {
                        if (child.isMesh && child.material) {
                            if (Array.isArray(child.material)) {
                                child.material.forEach(mat => {
                                    mat.wireframe = true;
                                    mat.needsUpdate = true;
                                });
                            } else {
                                child.material.wireframe = true;
                                child.material.needsUpdate = true;
                            }
                        }
                    });
                });
                break;
            case 'shaded':
                this.models.forEach(model => {
                    model.traverse(child => {
                        if (child.isMesh && child.material) {
                            if (Array.isArray(child.material)) {
                                child.material.forEach(mat => {
                                    mat.wireframe = false;
                                    mat.needsUpdate = true;
                                });
                            } else {
                                child.material.wireframe = false;
                                child.material.needsUpdate = true;
                            }
                        }
                    });
                });
                break;
            case 'shaded-wireframe':
                // First ensure shaded mode (no wireframe on materials)
                this.models.forEach(model => {
                    model.traverse(child => {
                        if (child.isMesh && child.material) {
                            if (Array.isArray(child.material)) {
                                child.material.forEach(mat => {
                                    mat.wireframe = false;
                                    mat.needsUpdate = true;
                                });
                            } else {
                                child.material.wireframe = false;
                                child.material.needsUpdate = true;
                            }
                        }
                    });
                });

                // Add wireframe to all models as separate lines
                this.models.forEach(model => {
                    model.traverse(child => {
                        if (child.isMesh) {
                            // Create wireframe overlay without modifying original material
                            const wireframe = new THREE.LineSegments(
                                new THREE.WireframeGeometry(child.geometry),
                                new THREE.LineBasicMaterial({
                                    color: 0x000000,
                                    linewidth: 1,
                                    opacity: 0.25,
                                    transparent: true
                                })
                            );

                            // Don't copy transforms - let the wireframe inherit from parent
                            // This ensures the wireframe always stays aligned with the mesh
                            // even when the mesh is transformed
                            wireframe.userData.isWireframeHelper = true;

                            // Set a flag to exclude wireframe helpers from raycasting
                            wireframe.userData.noSelection = true;

                            // Add to the mesh as a child
                            child.add(wireframe);
                        }
                    });
                });
                break;
            default:
                console.warn(`Unknown display mode: ${mode}`);
        }

        // Update current display mode
        this.currentDisplayMode = mode;
    }

    // Create the outliner panel to show scene hierarchy
    createOutliner() {
        // Create the outliner panel container
        const outlinerPanel = document.createElement('div');
        outlinerPanel.id = 'outliner-panel';
        outlinerPanel.className = 'outliner-panel';

        // Add title and content
        outlinerPanel.innerHTML = `
            <div class="outliner-header">
                <h3>Scene Outliner</h3>
                <button id="refresh-outliner" title="Refresh Outliner">↻</button>
            </div>
            <div class="outliner-content" id="outliner-content"></div>
        `;

        // Add styles for the outliner panel
        const style = document.createElement('style');
        style.textContent = `
            .outliner-panel {
                position: absolute;
                top: 10px;
                right: 10px;
                width: 250px;
                max-height: calc(100vh - 20px);
                background-color: rgba(30, 30, 30, 0.8);
                color: #fff;
                border-radius: 5px;
                box-shadow: 0 0 10px rgba(0, 0, 0, 0.5);
                z-index: 1000;
                display: flex;
                flex-direction: column;
                font-family: Arial, sans-serif;
                font-size: 14px;
                overflow: hidden;
            }
            
            .outliner-header {
                padding: 8px;
                border-bottom: 1px solid rgba(255, 255, 255, 0.1);
                display: flex;
                justify-content: space-between;
                align-items: center;
                background-color: rgba(40, 40, 40, 0.8);
            }
            
            .outliner-header h3 {
                margin: 0;
                font-size: 16px;
                font-weight: normal;
            }
            
            .outliner-header button {
                background: none;
                border: none;
                color: #aaa;
                font-size: 16px;
                cursor: pointer;
                padding: 2px 6px;
                border-radius: 3px;
            }
            
            .outliner-header button:hover {
                background-color: rgba(80, 80, 80, 0.5);
                color: #fff;
            }
            
            .outliner-content {
                padding: 0;
                overflow-y: auto;
                flex-grow: 1;
                max-height: calc(100vh - 80px);
            }
            
            .outliner-item {
                padding: 4px 8px 4px 12px;
                cursor: pointer;
                border-bottom: 1px solid rgba(255, 255, 255, 0.05);
                transition: background-color 0.2s;
                display: flex;
                align-items: center;
            }
            
            .outliner-item:hover {
                background-color: rgba(60, 60, 60, 0.8);
            }
            
            .outliner-item.selected {
                background-color: rgba(70, 130, 180, 0.3);
            }
            
            .outliner-toggle {
                margin-right: 5px;
                width: 15px;
                text-align: center;
                cursor: pointer;
                user-select: none;
            }
            
            .outliner-name {
                flex-grow: 1;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }
            
            .outliner-icon {
                margin-right: 5px;
                width: 16px;
                text-align: center;
                color: #aaa;
            }
            
            .outliner-children {
                margin-left: 15px;
                border-left: 1px dashed rgba(255, 255, 255, 0.1);
                display: none;
            }
            
            .outliner-children.expanded {
                display: block;
            }
            
            .bone-item {
                color: #aadeff;
            }
            
            .mesh-item {
                color: #ffaa7f;
            }
            
            .camera-item {
                color: #aaffaa;
            }
            
            .light-item {
                color: #ffffaa;
            }
            
            .object-item {
                color: #ffffff;
            }
        `;

        // Add to document
        document.head.appendChild(style);
        document.body.appendChild(outlinerPanel);

        // Add event listener for refresh button
        document.getElementById('refresh-outliner').addEventListener('click', () => {
            this.updateOutliner();
        });

        // Initial update of the outliner
        this.updateOutliner();
    }

    // Update the outliner panel with current scene contents
    updateOutliner() {
        const outlinerContent = document.getElementById('outliner-content');
        if (!outlinerContent) return;

        // Clear existing content
        outlinerContent.innerHTML = '';

        // Add scene root
        const sceneItem = document.createElement('div');
        sceneItem.className = 'outliner-item object-item';
        sceneItem.innerHTML = `
            <span class="outliner-toggle">+</span>
            <span class="outliner-icon">🌐</span>
            <span class="outliner-name">Scene</span>
        `;
        outlinerContent.appendChild(sceneItem);

        // Add children container
        const sceneChildren = document.createElement('div');
        sceneChildren.className = 'outliner-children';
        sceneChildren.id = 'scene-children';
        outlinerContent.appendChild(sceneChildren);

        // Add toggle behavior for scene
        sceneItem.querySelector('.outliner-toggle').addEventListener('click', (e) => {
            sceneChildren.classList.toggle('expanded');
            e.target.textContent = sceneChildren.classList.contains('expanded') ? '-' : '+';
        });

        // Expand by default
        sceneItem.querySelector('.outliner-toggle').click();

        // Add scene children (camera, lights, models, helpers)
        this.addCameraToOutliner(sceneChildren);
        this.addLightsToOutliner(sceneChildren);

        // Add models directly to scene children
        for (let i = 0; i < this.models.length; i++) {
            const model = this.models[i];
            this.addObjectHierarchyToOutliner(model, sceneChildren, 0);
        }

        this.addHelperObjectsToOutliner(sceneChildren);
    }

    // Add camera to outliner
    addCameraToOutliner(parent) {
        const cameraItem = document.createElement('div');
        cameraItem.className = 'outliner-item camera-item';
        cameraItem.innerHTML = `
            <span class="outliner-toggle"></span>
            <span class="outliner-icon">🎥</span>
            <span class="outliner-name">Camera</span>
        `;
        parent.appendChild(cameraItem);

        // Add click behavior for selection
        cameraItem.addEventListener('click', (e) => {
            if (e.target.classList.contains('outliner-toggle')) return;
            this.selectOutlinerItem(cameraItem, this.camera);
        });
    }

    // Add lights to outliner
    addLightsToOutliner(parent) {
        for (let i = 0; i < this.lights.length; i++) {
            const light = this.lights[i];
            const lightItem = document.createElement('div');

            // Determine light type
            let lightType = 'Light';
            let icon = '💡';

            if (light.isAmbientLight) {
                lightType = 'Ambient Light';
                icon = '☀️';
            } else if (light.isDirectionalLight) {
                lightType = 'Directional Light';
                icon = '☀️';
            } else if (light.isPointLight) {
                lightType = 'Point Light';
                icon = '💡';
            } else if (light.isSpotLight) {
                lightType = 'Spot Light';
                icon = '🔦';
            } else if (light.isHemisphereLight) {
                lightType = 'Hemisphere Light';
                icon = '🌓';
            }

            lightItem.className = 'outliner-item light-item';
            lightItem.innerHTML = `
                <span class="outliner-toggle"></span>
                <span class="outliner-icon">${icon}</span>
                <span class="outliner-name">${lightType} ${i + 1}</span>
            `;
            parent.appendChild(lightItem);

            // Add click behavior for selection
            lightItem.addEventListener('click', (e) => {
                if (e.target.classList.contains('outliner-toggle')) return;
                this.selectOutlinerItem(lightItem, light);
            });
        }
    }

    // Add models to outliner
    addModelsToOutliner(parent) {
        for (let i = 0; i < this.models.length; i++) {
            const model = this.models[i];

            // Create model item
            const modelItem = document.createElement('div');
            modelItem.className = 'outliner-item object-item';
            modelItem.innerHTML = `
                <span class="outliner-toggle">+</span>
                <span class="outliner-icon">📦</span>
                <span class="outliner-name">${model.name || `Model ${i + 1}`}</span>
            `;
            parent.appendChild(modelItem);

            // Add click behavior for selection
            modelItem.addEventListener('click', (e) => {
                if (e.target.classList.contains('outliner-toggle')) return;
                this.selectOutlinerItem(modelItem, model);
            });

            // Add children container
            const modelChildren = document.createElement('div');
            modelChildren.className = 'outliner-children';
            modelChildren.id = `model-children-${i}`;
            parent.appendChild(modelChildren);

            // Add toggle behavior
            modelItem.querySelector('.outliner-toggle').addEventListener('click', (e) => {
                modelChildren.classList.toggle('expanded');
                e.target.textContent = modelChildren.classList.contains('expanded') ? '-' : '+';
            });

            // Add model hierarchy
            this.addObjectHierarchyToOutliner(model, modelChildren, 0);
        }
    }

    // Add helper objects to outliner (grid, axes)
    addHelperObjectsToOutliner(parent) {
        // Add grid
        if (this.grid) {
            const gridItem = document.createElement('div');
            gridItem.className = 'outliner-item object-item';
            gridItem.innerHTML = `
                <span class="outliner-toggle"></span>
                <span class="outliner-icon">⊞</span>
                <span class="outliner-name">Grid</span>
            `;
            parent.appendChild(gridItem);

            // Add click behavior for selection
            gridItem.addEventListener('click', (e) => {
                if (e.target.classList.contains('outliner-toggle')) return;
                this.selectOutlinerItem(gridItem, this.grid);
            });
        }

        // Find axes helper
        this.scene.traverse((object) => {
            if (object.isAxesHelper) {
                const axesItem = document.createElement('div');
                axesItem.className = 'outliner-item object-item';
                axesItem.innerHTML = `
                    <span class="outliner-toggle"></span>
                    <span class="outliner-icon">⊕</span>
                    <span class="outliner-name">Axes Helper</span>
                `;
                parent.appendChild(axesItem);

                // Add click behavior for selection
                axesItem.addEventListener('click', (e) => {
                    if (e.target.classList.contains('outliner-toggle')) return;
                    this.selectOutlinerItem(axesItem, object);
                });
            }
        });
    }

    // Recursively add object hierarchy to outliner
    addObjectHierarchyToOutliner(object, parent, depth) {
        // Skip transform controls from outliner
        if (object === this.transformControls) return;

        // Skip non-visible objects
        if (object.userData && object.userData.isHelperObject) return;

        // Skip scene hierarchy for simple meshes
        if (object === this.scene && object.children.length === 1 && object.children[0].isMesh) {
            this.addObjectHierarchyToOutliner(object.children[0], parent, 0);
            return;
        }

        // Determine object type and icon
        let objectClass = 'object-item';
        let icon = '📦';

        if (object.isMesh) {
            objectClass = 'mesh-item';
            icon = '🔷';
        } else if (object.isBone) {
            objectClass = 'bone-item';
            icon = '🦴';
        } else if (object.isSkinnedMesh) {
            objectClass = 'mesh-item';
            icon = '👤';
        }

        // Create item
        const objectItem = document.createElement('div');
        objectItem.className = `outliner-item ${objectClass}`;
        objectItem.style.paddingLeft = `${depth * 10 + 8}px`;
        // Add data attribute to store object reference
        objectItem.dataset.objectId = object.uuid;

        // Determine if object has children
        const hasChildren = object.children.length > 0;
        const toggleSymbol = hasChildren ? '+' : '';

        objectItem.innerHTML = `
            <span class="outliner-toggle">${toggleSymbol}</span>
            <span class="outliner-icon">${icon}</span>
            <span class="outliner-name">${object.name || object.type || 'Object'}</span>
        `;
        parent.appendChild(objectItem);

        // Add click behavior for selection
        objectItem.addEventListener('click', (e) => {
            if (e.target.classList.contains('outliner-toggle')) return;

            // Handle bone selection
            if (object.isBone) {
                this.selectBone(object);
                this.selectOutlinerItem(objectItem);
            } else {
                this.selectObject(object);
                this.selectOutlinerItem(objectItem);
            }

            e.stopPropagation();
        });

        // If object has children, add them recursively
        if (hasChildren) {
            const childrenContainer = document.createElement('div');
            childrenContainer.className = 'outliner-children';
            parent.appendChild(childrenContainer);

            // Add toggle behavior
            objectItem.querySelector('.outliner-toggle').addEventListener('click', (e) => {
                childrenContainer.classList.toggle('expanded');
                e.target.textContent = childrenContainer.classList.contains('expanded') ? '-' : '+';
                e.stopPropagation();
            });

            // Add children
            for (const child of object.children) {
                this.addObjectHierarchyToOutliner(child, childrenContainer, depth + 1);
            }
        }
    }

    // Select an item in the outliner
    selectOutlinerItem(item, object = null) {
        // Remove selection from all items
        const items = document.querySelectorAll('.outliner-item');
        items.forEach(i => i.classList.remove('selected'));

        // Add selection to this item
        item.classList.add('selected');

        // Select the object if provided
        if (object && !object.isBone) {
            this.selectObject(object);
        }
    }

    // Update the outliner to show the selected bone
    updateBoneSelectionInOutliner(bone) {
        // Clear all selections first
        const items = document.querySelectorAll('.outliner-item');
        items.forEach(i => i.classList.remove('selected'));

        // Find the item that represents this bone by matching name
        if (bone && bone.name) {
            setTimeout(() => {
                const boneName = bone.name;
                const outlinerItems = document.querySelectorAll('.outliner-item.bone-item');

                for (const item of outlinerItems) {
                    const nameSpan = item.querySelector('.outliner-name');
                    if (nameSpan && nameSpan.textContent === boneName) {
                        // Select this item
                        item.classList.add('selected');

                        // Find parent containers and expand them
                        let parent = item.parentElement;
                        while (parent && parent.classList.contains('outliner-children')) {
                            if (!parent.classList.contains('expanded')) {
                                // Find the toggle button in the parent item and click it
                                const parentItem = parent.previousElementSibling;
                                if (parentItem && parentItem.classList.contains('outliner-item')) {
                                    const toggle = parentItem.querySelector('.outliner-toggle');
                                    if (toggle) {
                                        toggle.textContent = '-';
                                        parent.classList.add('expanded');
                                    }
                                }
                            }
                            parent = parent.parentElement;
                        }

                        // Scroll to this item
                        item.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        break;
                    }
                }
            }, 100); // Small delay to ensure DOM is updated
        }
    }

    // Cleanup skeleton helpers from the scene
    cleanupSkeletonHelpers() {
        // Remove skeleton helpers from the scene
        this.models.forEach(model => {
            if (model.userData && model.userData.skeletonHelper) {
                this.scene.remove(model.userData.skeletonHelper);
                model.userData.skeletonHelper = null;
            }
        });

        // Also check the scene for any orphaned skeleton helpers
        this.scene.traverse(object => {
            if (object.isSkeletonHelper) {
                this.scene.remove(object);
            }
        });
    }

    isObjectDescendantOf(object, parent) {
        while (object) {
            if (object === parent) return true;
            object = object.parent;
        }
        return false;
    }

    // Find outliner item for an object
    findOutlinerItemForObject(object) {
        if (!object) return null;
        return document.querySelector(`.outliner-item[data-object-id="${object.uuid}"]`);
    }

    updateMorphTargetUI() {
        const container = document.getElementById('morph-targets');
        const contentContainer = container.querySelector('.panel-content');
        const expandButton = container.querySelector('.expand-button');

        // Reset the container state
        container.classList.remove('collapsed');
        expandButton.textContent = '-';
        contentContainer.style.display = 'block';

        // Clear existing content
        contentContainer.innerHTML = '';

        // If no object is selected, just return
        if (!this.selectedObject) {
            return;
        }

        // Find all meshes with morph targets
        const meshesWithMorphs = [];
        if (this.selectedObject.isMesh && this.selectedObject.morphTargetInfluences) {
            meshesWithMorphs.push(this.selectedObject);
        }
        this.selectedObject.traverse((child) => {
            if (child.isMesh && child.morphTargetInfluences) {
                meshesWithMorphs.push(child);
            }
        });

        // If no morph targets found, return
        if (meshesWithMorphs.length === 0) {
            return;
        }

        // Create UI for each mesh with morph targets
        meshesWithMorphs.forEach((mesh) => {
            const morphTargetInfluences = mesh.morphTargetInfluences;

            // Create a slider for each morph target
            for (let i = 0; i < morphTargetInfluences.length; i++) {
                // Get the name from the morphTargetDictionary
                let name;
                if (mesh.morphTargetDictionary) {
                    const fullName = Object.entries(mesh.morphTargetDictionary).find(([key, value]) => value === i)?.[0];
                    if (fullName) {
                        const parts = fullName.split('.');
                        name = parts.length > 1 ? parts[1] : fullName;
                    }
                }
                if (!name) {
                    name = `Target ${i + 1}`;
                }

                const value = morphTargetInfluences[i];

                const item = document.createElement('div');
                item.className = 'morph-target-item';

                const nameSpan = document.createElement('span');
                nameSpan.className = 'morph-target-name';
                nameSpan.textContent = name;
                item.appendChild(nameSpan);

                const controls = document.createElement('div');
                controls.className = 'morph-target-controls';

                const slider = document.createElement('input');
                slider.type = 'range';
                slider.className = 'morph-target-slider';
                slider.min = 0;
                slider.max = 1;
                slider.step = 0.01;
                slider.value = value;
                controls.appendChild(slider);

                const valueSpan = document.createElement('span');
                valueSpan.className = 'morph-target-value';
                valueSpan.textContent = value.toFixed(2);
                controls.appendChild(valueSpan);

                item.appendChild(controls);
                contentContainer.appendChild(item);

                slider.addEventListener('input', () => {
                    const newValue = parseFloat(slider.value);
                    mesh.morphTargetInfluences[i] = newValue;
                    valueSpan.textContent = newValue.toFixed(2);
                });
            }
        });

        // Add expand/collapse functionality
        const header = container.querySelector('.panel-header');

        header.addEventListener('click', () => {
            container.classList.toggle('collapsed');
            expandButton.textContent = container.classList.contains('collapsed') ? '+' : '-';
            contentContainer.style.display = container.classList.contains('collapsed') ? 'none' : 'block';
        });
    }

    frameSelected() {
        if (this.selectedObject) {
            // Frame just the selected object
            const box = new THREE.Box3().setFromObject(this.selectedObject);
            const center = box.getCenter(new THREE.Vector3());
            const size = box.getSize(new THREE.Vector3());

            // Calculate maximum dimension to determine camera distance
            const maxDim = Math.max(size.x, size.y, size.z);
            const fov = this.camera.fov * (Math.PI / 180);
            const distance = Math.abs(maxDim / Math.sin(fov / 2)) * 1.2; // 20% margin

            // Update camera position to frame the object
            const direction = new THREE.Vector3().subVectors(
                this.camera.position, center
            ).normalize();

            this.camera.position.copy(center).addScaledVector(direction, distance);

            // Update camera target and pivot point
            this.cameraTarget.copy(center);
            this.pivotPoint.copy(center);

            // Update pivot indicator
            this.updatePivotIndicator();

            console.log(`Framed object: ${this.selectedObject.name || 'unnamed'}`);
        } else {
            // If nothing is selected, frame all models
            if (this.models && this.models.length > 0) {
                this.zoomToFitAllModels();
                console.log('Framed all models');
            } else {
                console.log('No models to frame');
            }
        }
    }

    // ... existing code ...
}

// Initialize the viewer when the page is loaded
document.addEventListener('DOMContentLoaded', () => {
    new ModelViewer();
});

// Add expand/collapse functionality for panels
document.querySelectorAll('.expand-button').forEach(button => {
    button.addEventListener('click', () => {
        const panel = button.closest('.panel');
        const isCollapsed = panel.classList.contains('collapsed');

        if (isCollapsed) {
            panel.classList.remove('collapsed');
            button.textContent = '-';
        } else {
            panel.classList.add('collapsed');
            button.textContent = '+';
        }
    });
}); 