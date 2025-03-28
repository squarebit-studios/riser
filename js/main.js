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

        // Component selection mode properties
        this.componentMode = 'object'; // 'object', 'vertex', 'edge', 'face'
        this.selectedComponents = []; // Array of selected components
        this.componentHelpers = { // Visual helpers for component selection
            vertexMarkers: null,
            edgeHighlights: null,
            faceHighlights: null
        };

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
                console.log('Mouse is released and recently clicked on manipulator');
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

                // Find which model contains this mesh
                let parentModel = null;
                this.models.forEach(model => {
                    let isPartOfModel = false;
                    model.traverse(child => {
                        if (child === hitMesh) {
                            isPartOfModel = true;
                        }
                    });
                    if (isPartOfModel) {
                        parentModel = model;
                    }
                });

                // Default to hit mesh if no parent model found
                const objectToSelect = parentModel || hitMesh;

                // Clear previous selections
                if (this.selectedObject) {
                    // Reset color of previously selected object
                    this.selectedObject.traverse(child => {
                        if (child.isMesh && child.material) {
                            if (Array.isArray(child.material)) {
                                child.material.forEach(mat => {
                                    if (mat.originalColor) {
                                        mat.color.copy(mat.originalColor);
                                    }
                                });
                            } else if (child.material.originalColor) {
                                child.material.color.copy(child.material.originalColor);
                            }
                        }
                    });
                }

                // Store selection
                this.selectedObject = objectToSelect;

                // Make selection visually obvious by changing color
                objectToSelect.traverse(child => {
                    if (child.isMesh && child.material) {
                        if (Array.isArray(child.material)) {
                            child.material.forEach(mat => {
                                // Store original color if not already stored
                                if (!mat.originalColor) {
                                    mat.originalColor = mat.color.clone();
                                }
                                // Set to bright highlight color
                                mat.color.set(0x00ffff); // Bright cyan
                            });
                        } else {
                            // Store original color if not already stored
                            if (!child.material.originalColor) {
                                child.material.originalColor = child.material.color.clone();
                            }
                            // Set to bright highlight color
                            child.material.color.set(0x00ffff); // Bright cyan
                        }
                    }
                });

                // Enable transform group
                if (this.transformGroup) {
                    this.transformGroup.style.opacity = '1';
                    this.transformGroup.style.pointerEvents = 'auto';
                }

                // Update channel box title
                if (this.channelBoxTitle) {
                    this.channelBoxTitle.innerText = objectToSelect.name || 'Selected Object';
                }

                // Attach transform controls directly to ensure they appear
                this.transformControls.attach(objectToSelect);
                this.transformControls.visible = true;
                this.transformControls.enabled = true;

                return true;
            } else {
                // No hit, deselect
                if (this.selectedObject) {
                    // Reset color
                    this.selectedObject.traverse(child => {
                        if (child.isMesh && child.material) {
                            if (Array.isArray(child.material)) {
                                child.material.forEach(mat => {
                                    if (mat.originalColor) {
                                        mat.color.copy(mat.originalColor);
                                    }
                                });
                            } else if (child.material.originalColor) {
                                child.material.color.copy(child.material.originalColor);
                            }
                        }
                    });

                    // Detach transform controls
                    this.transformControls.detach();

                    // Clear selection
                    this.selectedObject = null;

                    // Update UI
                    if (this.channelBoxTitle) {
                        this.channelBoxTitle.innerText = 'No Object Selected';
                    }
                    if (this.transformGroup) {
                        this.transformGroup.style.opacity = '0.5';
                        this.transformGroup.style.pointerEvents = 'none';
                    }
                }
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

        // Set up component mode for vertex/edge/face editing
        this.componentMode = 'object'; // 'object', 'vertex', 'edge', 'face'
        this.selectedComponents = [];
        this.componentHelpers = null;
        this.createComponentModeUI();

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
        // Set up menu item events
        document.getElementById('open-option').addEventListener('click', () => {
            this.fileInput.click();
        });

        document.getElementById('import-option').addEventListener('click', () => {
            this.importFileInput.click();
        });

        // View menu options
        document.getElementById('wireframe-option').addEventListener('click', () => {
            this.setDisplayMode('wireframe');
        });

        document.getElementById('shaded-option').addEventListener('click', () => {
            this.setDisplayMode('shaded');
        });

        document.getElementById('show-bones-option').addEventListener('click', (e) => {
            const menuItem = e.target;
            const showing = menuItem.classList.contains('active');

            // Toggle the active class
            if (showing) {
                menuItem.classList.remove('active');
                menuItem.textContent = 'Show Bones';
            } else {
                menuItem.classList.add('active');
                menuItem.textContent = 'Hide Bones';
            }

            // Toggle bone visibility on all models
            this.models.forEach(model => {
                if (model.userData && model.userData.hasSkeletalData) {
                    this.toggleBoneVisualization(model, !showing);
                }
            });
        });

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

    setupObjectSelection() {
        // Raycaster for object selection
        this.raycaster = new THREE.Raycaster();

        // Add click event listener to the renderer with proper raycasting
        this.renderer.domElement.addEventListener('click', (event) => {

            // Get mouse position in normalized coordinates
            const mouse = new THREE.Vector2();
            const rect = this.renderer.domElement.getBoundingClientRect();
            mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
            mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

            // Update the raycaster with camera and mouse position
            this.raycaster.setFromCamera(mouse, this.camera);

            // Collect all meshes for raycasting
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

            if (intersects.length > 0) {
                // Find the hit mesh
                const hitMesh = intersects[0].object;

                // Find which model contains this mesh
                let parentModel = null;
                this.models.forEach(model => {
                    let isPartOfModel = false;
                    model.traverse(child => {
                        if (child === hitMesh) {
                            isPartOfModel = true;
                        }
                    });
                    if (isPartOfModel) {
                        parentModel = model;
                    }
                });

                // Default to hit mesh if no parent model found
                const objectToSelect = parentModel || hitMesh;

                // Clear previous selections
                if (this.selectedObject) {
                    // Reset color of previously selected object
                    this.selectedObject.traverse(child => {
                        if (child.isMesh && child.material) {
                            if (Array.isArray(child.material)) {
                                child.material.forEach(mat => {
                                    if (mat.originalColor) {
                                        mat.color.copy(mat.originalColor);
                                    }
                                });
                            } else if (child.material.originalColor) {
                                child.material.color.copy(child.material.originalColor);
                            }
                        }
                    });
                }

                // Store selection
                this.selectedObject = objectToSelect;

                // Make selection visually obvious by changing color
                objectToSelect.traverse(child => {
                    if (child.isMesh && child.material) {
                        console.error("⚠️ PROPER SELECTION: Setting selection highlight color");
                        if (Array.isArray(child.material)) {
                            child.material.forEach(mat => {
                                // Store original color if not already stored
                                if (!mat.originalColor) {
                                    mat.originalColor = mat.color.clone();
                                }
                                // Set to bright highlight color
                                mat.color.set(0xff0000); // Bright red
                            });
                        } else {
                            // Store original color if not already stored
                            if (!child.material.originalColor) {
                                child.material.originalColor = child.material.color.clone();
                            }
                            // Set to bright highlight color
                            child.material.color.set(0xff0000); // Bright red
                        }
                    }
                });

                // Enable transform group
                if (this.transformGroup) {
                    this.transformGroup.style.opacity = '1';
                    this.transformGroup.style.pointerEvents = 'auto';
                }

                // Update channel box title
                if (this.channelBoxTitle) {
                    this.channelBoxTitle.innerText = objectToSelect.name || 'Selected Object';
                }

                // Attach transform controls directly to ensure they appear
                this.transformControls.attach(objectToSelect);
                this.transformControls.visible = true;
                this.transformControls.enabled = true;

            } else {
                // Deselect current object
                if (this.selectedObject) {
                    // Reset color
                    this.selectedObject.traverse(child => {
                        if (child.isMesh && child.material) {
                            if (Array.isArray(child.material)) {
                                child.material.forEach(mat => {
                                    if (mat.originalColor) {
                                        mat.color.copy(mat.originalColor);
                                    }
                                });
                            } else if (child.material.originalColor) {
                                child.material.color.copy(child.material.originalColor);
                            }
                        }
                    });

                    // Detach transform controls
                    this.transformControls.detach();

                    // Clear selection
                    this.selectedObject = null;

                    // Update UI
                    if (this.channelBoxTitle) {
                        this.channelBoxTitle.innerText = 'No Object Selected';
                    }
                    if (this.transformGroup) {
                        this.transformGroup.style.opacity = '0.5';
                        this.transformGroup.style.pointerEvents = 'none';
                    }
                }
            }
        });

        // Simplified touch event handlers
        const renderer = this.renderer.domElement;
        renderer.addEventListener('touchend', (event) => {
            if (event.changedTouches.length === 1) {

                // Get touch coordinates
                const touch = event.changedTouches[0];
                const rect = renderer.getBoundingClientRect();
                const touchX = ((touch.clientX - rect.left) / rect.width) * 2 - 1;
                const touchY = -((touch.clientY - rect.top) / rect.height) * 2 + 1;

                // Update raycaster
                this.raycaster.setFromCamera(new THREE.Vector2(touchX, touchY), this.camera);

                // Collect meshes
                const meshes = [];
                this.models.forEach(model => {
                    model.traverse(child => {
                        if (child.isMesh && child.visible) {
                            meshes.push(child);
                        }
                    });
                });

                // Raycast and select
                const intersects = this.raycaster.intersectObjects(meshes, false);
                if (intersects.length > 0) {
                    const hitMesh = intersects[0].object;

                    // Find parent model
                    let parentModel = null;
                    this.models.forEach(model => {
                        let isPartOfModel = false;
                        model.traverse(child => {
                            if (child === hitMesh) {
                                isPartOfModel = true;
                            }
                        });
                        if (isPartOfModel) {
                            parentModel = model;
                        }
                    });

                    const objectToSelect = parentModel || hitMesh;

                    // Clear previous selection
                    if (this.selectedObject) {
                        this.selectedObject.traverse(child => {
                            if (child.isMesh && child.material) {
                                if (Array.isArray(child.material)) {
                                    child.material.forEach(mat => {
                                        if (mat.originalColor) {
                                            mat.color.copy(mat.originalColor);
                                        }
                                    });
                                } else if (child.material.originalColor) {
                                    child.material.color.copy(child.material.originalColor);
                                }
                            }
                        });
                    }

                    // Update selection
                    this.selectedObject = objectToSelect;

                    // Highlight
                    objectToSelect.traverse(child => {
                        if (child.isMesh && child.material) {
                            if (Array.isArray(child.material)) {
                                child.material.forEach(mat => {
                                    if (!mat.originalColor) {
                                        mat.originalColor = mat.color.clone();
                                    }
                                    mat.color.set(0xff0000); // Red
                                });
                            } else {
                                if (!child.material.originalColor) {
                                    child.material.originalColor = child.material.color.clone();
                                }
                                child.material.color.set(0xff0000); // Red
                            }
                        }
                    });

                    // Update UI
                    if (this.transformGroup) {
                        this.transformGroup.style.opacity = '1';
                        this.transformGroup.style.pointerEvents = 'auto';
                    }
                    if (this.channelBoxTitle) {
                        this.channelBoxTitle.innerText = objectToSelect.name || 'Selected Object';
                    }

                    // Attach transform controls
                    this.transformControls.attach(objectToSelect);
                    this.transformControls.visible = true;
                    this.transformControls.enabled = true;
                }
            }
            event.preventDefault();
        }, { passive: false });
    }

    handleObjectSelection(raycaster) {
        // Get all objects in the scene that can be selected
        const selectableObjects = [];

        // Get all visible meshes from all models
        this.scene.traverse(object => {
            if (object.isMesh &&
                !(object.userData.isHelper) &&
                !(object.userData.isBoneJoint) &&
                object !== this.grid &&
                object.visible) {
                selectableObjects.push(object);
            }
        });

        // Find all intersections
        const intersects = raycaster.intersectObjects(selectableObjects, false);

        // If we hit something, select it or its parent model
        if (intersects.length > 0) {
            const hitObject = intersects[0].object;

            // Find if this mesh belongs to one of our loaded models
            const parentModel = this.findParentModel(hitObject);

            if (parentModel) {
                this.selectObject(parentModel);
                return true;
            } else {
                // If no parent model found, just select the object itself
                this.selectObject(hitObject);
                return true;
            }
        }

        return false;
    }

    // Helper to find the parent model for an object
    findParentModel(object) {
        for (const model of this.models) {
            let isPartOfModel = false;
            model.traverse(child => {
                if (child === object) {
                    isPartOfModel = true;
                }
            });

            if (isPartOfModel) {
                return model;
            }
        }
        return null;
    }

    handleComponentSelection(raycaster) {
        // Component selection only works on meshes, not bones
        const objects = [];

        // Collect all meshes from all models, excluding bone visualizations
        this.models.forEach(model => {
            model.traverse((child) => {
                if (child.isMesh &&
                    !(child.parent && child.parent.name === "BoneVisualization")) {
                    objects.push(child);
                }
            });
        });

        const intersects = raycaster.intersectObjects(objects, true);

        if (intersects.length > 0) {
            const intersectedObject = intersects[0].object;
            const intersectionPoint = intersects[0].point;

            // Process the intersection based on component mode
            if (this.componentMode === 'vertex') {
                const vertexInfo = this.findNearestVertex(intersectedObject, intersectionPoint);
                if (vertexInfo) {
                    this.selectComponent(vertexInfo, 'vertex');
                    return true;
                }
            } else if (this.componentMode === 'edge') {
                const edgeInfo = this.findNearestEdge(intersectedObject, intersectionPoint);
                if (edgeInfo) {
                    this.selectComponent(edgeInfo, 'edge');
                    return true;
                }
            } else if (this.componentMode === 'face') {
                const faceInfo = {
                    object: intersectedObject,
                    faceIndex: intersects[0].faceIndex,
                    point: intersectionPoint
                };
                this.selectComponent(faceInfo, 'face');
                return true;
            }
        }

        return false;
    }

    attachTransformControlsToComponent(component, position) {
        // Detach from any existing object
        this.transformControls.detach();

        // Create a manipulation handle
        const manipHandle = new THREE.Object3D();
        manipHandle.name = 'componentManipulator';

        // Set position of the manipulator
        if (position) {
            manipHandle.position.copy(position);
        } else if (component.position) {
            manipHandle.position.copy(component.position);
        }

        // Store reference to the component being manipulated
        manipHandle.userData = {
            componentType: component.type || 'unknown',
            component: component,
            originalPosition: position ? position.clone() : null
        };

        // Add listener to update the component when manipulator moves
        const updateListener = () => {
            this.updateComponentFromManipulator(manipHandle);
        };

        // Remove existing listeners to avoid duplicates
        this.transformControls.removeEventListener('objectChange', updateListener);

        // Add new listener
        this.transformControls.addEventListener('objectChange', updateListener);

        // Attach controls to handle
        this.transformControls.attach(manipHandle);

        // Add handle to scene if not already there
        if (!manipHandle.parent) {
            this.scene.add(manipHandle);
        }
    }

    updateComponentFromManipulator(manipHandle) {
        if (!manipHandle.userData || !manipHandle.userData.component) return;

        const component = manipHandle.userData.component;
        const originalPosition = manipHandle.userData.originalPosition;
        const displacement = new THREE.Vector3();

        if (originalPosition) {
            displacement.subVectors(manipHandle.position, originalPosition);
        }

        // Apply changes based on component type
        switch (component.type) {
            case 'vertex':
                this.updateVertexPosition(component, manipHandle.position, displacement);
                break;

            case 'edge':
                this.updateEdgePosition(component, manipHandle.position, displacement);
                break;

            case 'face':
                this.updateFacePosition(component, manipHandle.position, displacement);
                break;
        }
    }

    updateVertexPosition(vertexInfo, newPosition, displacement) {
        // Get the original mesh that contains this vertex
        const mesh = vertexInfo.originalMesh;
        if (!mesh || !mesh.geometry) return;

        // Get position attribute
        const positionAttribute = mesh.geometry.attributes.position;
        if (!positionAttribute) return;

        // Get the vertex index
        const vertexIndex = vertexInfo.vertexIndex;

        // Get current vertex position
        const vertex = new THREE.Vector3(
            positionAttribute.getX(vertexIndex),
            positionAttribute.getY(vertexIndex),
            positionAttribute.getZ(vertexIndex)
        );

        // Apply inverse world matrix to get to local space
        const worldToLocal = new THREE.Matrix4().copy(mesh.matrixWorld).invert();
        const localDisplacement = displacement.clone().applyMatrix4(worldToLocal);

        // Add displacement in local space
        vertex.add(localDisplacement);

        // Update the geometry
        positionAttribute.setXYZ(vertexIndex, vertex.x, vertex.y, vertex.z);
        positionAttribute.needsUpdate = true;

        // Update the vertex marker
        if (vertexInfo.containerMesh) {
            const dummy = new THREE.Object3D();
            const worldPos = vertex.clone().applyMatrix4(mesh.matrixWorld);

            dummy.position.copy(worldPos);
            dummy.updateMatrix();

            vertexInfo.containerMesh.setMatrixAt(vertexInfo.instanceId, dummy.matrix);
            vertexInfo.containerMesh.instanceMatrix.needsUpdate = true;
        }

        // If the geometry has an index, update any dependent attributes
        if (mesh.geometry.index) {
            mesh.geometry.computeVertexNormals();
        }

        // Update any associated edge or face helpers
        this.updateComponentHelpers();

        console.log('Vertex updated at position', newPosition);
    }

    updateEdgePosition(edgeInfo, newPosition, displacement) {
        // Get the original mesh that contains this edge
        const mesh = edgeInfo.originalMesh;
        if (!mesh || !mesh.geometry) return;

        // Get position attribute
        const positionAttribute = mesh.geometry.attributes.position;
        if (!positionAttribute) return;

        // Get edge vertex indices
        const startIndex = edgeInfo.startIndex / 2;
        const endIndex = edgeInfo.endIndex / 2;

        // Apply inverse world matrix to get to local space
        const worldToLocal = new THREE.Matrix4().copy(mesh.matrixWorld).invert();
        const localDisplacement = displacement.clone().applyMatrix4(worldToLocal);

        // Update the start vertex
        const startVertex = new THREE.Vector3(
            positionAttribute.getX(startIndex),
            positionAttribute.getY(startIndex),
            positionAttribute.getZ(startIndex)
        );
        startVertex.add(localDisplacement);
        positionAttribute.setXYZ(startIndex, startVertex.x, startVertex.y, startVertex.z);

        // Update the end vertex
        const endVertex = new THREE.Vector3(
            positionAttribute.getX(endIndex),
            positionAttribute.getY(endIndex),
            positionAttribute.getZ(endIndex)
        );
        endVertex.add(localDisplacement);
        positionAttribute.setXYZ(endIndex, endVertex.x, endVertex.y, endVertex.z);

        // Mark attribute as needing update
        positionAttribute.needsUpdate = true;

        // Update edge helper
        edgeInfo.position.copy(newPosition);

        // Update normal calculations
        mesh.geometry.computeVertexNormals();

        // Update helpers as edge geometry has changed
        this.updateComponentHelpers();

        console.log('Edge updated');
    }

    updateFacePosition(faceInfo, newPosition, displacement) {
        // Get the original mesh that contains this face
        const mesh = faceInfo.originalMesh;
        if (!mesh || !mesh.geometry) return;

        // Get position attribute
        const positionAttribute = mesh.geometry.attributes.position;
        if (!positionAttribute) return;

        // Apply inverse world matrix to get to local space
        const worldToLocal = new THREE.Matrix4().copy(mesh.matrixWorld).invert();
        const localDisplacement = displacement.clone().applyMatrix4(worldToLocal);

        // Get vertices for this face
        if (faceInfo.vertices) {
            // For each vertex in the face, update its position
            faceInfo.vertices.forEach((vertex, index) => {
                // Convert world vertex position to local
                const localVertex = vertex.clone().applyMatrix4(worldToLocal);

                // Add displacement
                localVertex.add(localDisplacement);

                // Find the vertex index in the geometry
                // This is simplified - in a real implementation we'd need to map
                // between the face vertices and the actual geometry indices
                if (faceInfo.faceIndex !== undefined) {
                    let vertexIndex;

                    if (mesh.geometry.index) {
                        // For indexed geometry
                        const faceStart = faceInfo.faceIndex * 3;
                        vertexIndex = mesh.geometry.index.array[faceStart + index];
                    } else {
                        // For non-indexed geometry
                        vertexIndex = faceInfo.faceIndex * 3 + index;
                    }

                    // Update the position
                    positionAttribute.setXYZ(
                        vertexIndex,
                        localVertex.x,
                        localVertex.y,
                        localVertex.z
                    );
                }
            });

            // Mark attribute as needing update
            positionAttribute.needsUpdate = true;

            // Update normal calculations
            mesh.geometry.computeVertexNormals();

            // Update face helper
            faceInfo.center.copy(newPosition);

            // Update helpers as face geometry has changed
            this.updateComponentHelpers();

            console.log('Face updated');
        }
    }

    updateComponentHelpers() {
        // If we're in component mode, rebuild the helpers to match updated geometry
        if (this.componentMode !== 'object' && this.selectedObject) {
            // Rebuild component helpers based on current mode
            this.initComponentHelpers();

            // Re-highlight selected components if any
            if (this.selectedComponents.length > 0) {
                // Implement highlighting of selected components here
                // This would involve finding and updating material colors
            }
        }
    }

    selectObject(object) {
        console.log("selectObject called with:", object ? (object.name || 'unnamed object') : 'null');

        // Deselect current object first
        if (this.selectedObject) {
            console.log("Deselecting previous object:", this.selectedObject.name || 'unnamed');
            this.deselectObject();
        }

        // Make sure object is valid and in the scene graph
        if (!object || !this.isObjectInScene(object)) {
            console.warn("Cannot select object that is not in the scene graph");
            return;
        }

        // Select new object
        this.selectedObject = object;
        console.log("New object selected:", object.name || 'unnamed');

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
            console.log("Attaching transform controls to object");
            this.transformControls.attach(object);
        } catch (error) {
            console.error("Error attaching transform controls:", error);
        }

        // Update input fields from object transform
        this.updateUIFromObject();

        // Check for skeleton and show bones UI if available
        if (object.userData && object.userData.hasSkeletalData) {
            console.log("Setting up bone controls for object with skeletal data");
            this.setupBoneControls(object);
        }

        // Push to undo stack
        this.saveSelectionState();
    }

    // Helper method to check if an object is in the scene graph
    isObjectInScene(object) {
        console.log(`Checking if object "${object.name || 'unnamed'}" is in scene`);

        // If the object is the scene itself
        if (object === this.scene) {
            console.log(`Object is the scene itself, returning true`);
            return true;
        }

        // If the object has no parent, it's not in the scene
        if (!object.parent) {
            console.log(`Object has no parent, returning false`);
            return false;
        }

        // Recursively check if any parent is the scene
        let parent = object.parent;
        let depth = 0;
        const maxDepth = 20; // Prevent infinite loops

        while (parent && depth < maxDepth) {
            if (parent === this.scene) {
                console.log(`Found scene as parent at depth ${depth}, returning true`);
                return true;
            }
            parent = parent.parent;
            depth++;
        }

        console.log(`No scene parent found after ${depth} levels, returning false`);
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
                console.log('Added bone controls panel to DOM', boneControlsPanel);
            } else {
                console.error('Could not find channel-box element to add bone controls');
                // Fallback: add to info panel
                const infoPanel = document.getElementById('info');
                if (infoPanel) {
                    infoPanel.appendChild(boneControlsPanel);
                    console.log('Added bone controls panel to info panel as fallback');
                } else {
                    // Last resort: add to body
                    document.body.appendChild(boneControlsPanel);
                    console.log('Added bone controls panel to body as last resort');
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

        // Reset the selected bone
        this.selectedBone = null;
    }

    deselectObject() {
        if (this.selectedObject) {
            // Remove transform controls
            this.transformControls.detach();
            this.selectedObject = null;

            // Clear selected bone reference
            this.selectedBone = null;

            // Disable transform group
            if (this.transformGroup) {
                this.transformGroup.style.opacity = '0.5';
                this.transformGroup.style.pointerEvents = 'none';
            }

            // Update channel box title
            if (this.channelBoxTitle) {
                this.channelBoxTitle.innerText = 'No Object Selected';
            }

            // Remove any bone controls
            this.removeBoneControls();

            // Hide bone manipulator controls if they exist
            if (this.boneManipulatorGroup) {
                this.boneManipulatorGroup.style.display = 'none';
            }
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

                this.processLoadedModel(object, fileName, isImport);
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

    // Process a loaded model regardless of file type
    processLoadedModel(object, fileName, isImport) {
        // Give the object a name based on file name if it doesn't have one
        if (!object.name || object.name === '') {
            object.name = fileName.split('.')[0];
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
        let isCtrlDown = false; // Add variable to track Ctrl key state

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

                // If manipulator is active while alt is pressed, temporarily hide it
                if (this.transformControls.visible && this.transformControls.object) {
                    this.transformControls.enabled = false;
                }

                // Prevent browser's default Alt key behavior
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
                activeControl = null;
                renderer.style.cursor = 'auto'; // Reset cursor

                // Restore manipulator when alt is released
                if (this.transformControls.object) {
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

        // Handle direct click on mesh to set tumble pivot point (with Ctrl)
        renderer.addEventListener('click', (event) => {
            // Only apply for left mouse button clicks WITH Ctrl key
            if (event.button === 0 && event.ctrlKey && this.model) {
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

                    // Visual feedback
                    console.log('Set pivot point at:', this.pivotPoint);
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
            const zoomFactor = adaptiveZoomSpeed * Math.sign(event.deltaY) * Math.min(Math.abs(event.deltaY), 50);

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
        // Process all models in the scene
        this.models.forEach(model => {
            model.traverse(child => {
                if (child.isMesh) {
                    if (mode === 'wireframe') {
                        // Store original material if not already stored
                        if (!child._originalMaterial) {
                            child._originalMaterial = child.material.clone();
                        }

                        // Create wireframe material
                        child.material = new THREE.MeshBasicMaterial({
                            color: 0x00ff00,
                            wireframe: true
                        });
                    } else if (mode === 'shaded') {
                        // Restore original material if available
                        if (child._originalMaterial) {
                            child.material = child._originalMaterial;
                        } else {
                            // Create default shaded material if no original is stored
                            child.material = new THREE.MeshStandardMaterial({
                                color: 0x808080,
                                metalness: 0.2,
                                roughness: 0.8
                            });
                        }
                    }
                }
            });
        });

        console.log(`Display mode set to: ${mode}`);
    }

    createComponentModeUI() {
        // Create component mode selection UI
        const componentModeContainer = document.createElement('div');
        componentModeContainer.id = 'component-mode-container';
        componentModeContainer.className = 'control-group';
        componentModeContainer.style.position = 'absolute';
        componentModeContainer.style.top = '10px';
        componentModeContainer.style.left = '10px';
        componentModeContainer.style.background = 'rgba(0, 0, 0, 0.7)';
        componentModeContainer.style.padding = '5px';
        componentModeContainer.style.borderRadius = '5px';
        componentModeContainer.style.display = 'flex';
        componentModeContainer.style.flexDirection = 'column';
        componentModeContainer.style.gap = '5px';

        // Title
        const title = document.createElement('div');
        title.textContent = 'Selection Mode';
        title.style.color = '#fff';
        title.style.fontSize = '12px';
        title.style.fontWeight = 'bold';
        title.style.marginBottom = '5px';
        componentModeContainer.appendChild(title);

        // Object mode button
        const objectModeBtn = document.createElement('button');
        objectModeBtn.textContent = 'Object';
        objectModeBtn.className = 'mode-button active';
        objectModeBtn.dataset.mode = 'object';
        componentModeContainer.appendChild(objectModeBtn);

        // Vertex mode button
        const vertexModeBtn = document.createElement('button');
        vertexModeBtn.textContent = 'Vertex';
        vertexModeBtn.className = 'mode-button';
        vertexModeBtn.dataset.mode = 'vertex';
        componentModeContainer.appendChild(vertexModeBtn);

        // Edge mode button
        const edgeModeBtn = document.createElement('button');
        edgeModeBtn.textContent = 'Edge';
        edgeModeBtn.className = 'mode-button';
        edgeModeBtn.dataset.mode = 'edge';
        componentModeContainer.appendChild(edgeModeBtn);

        // Face mode button
        const faceModeBtn = document.createElement('button');
        faceModeBtn.textContent = 'Face';
        faceModeBtn.className = 'mode-button';
        faceModeBtn.dataset.mode = 'face';
        componentModeContainer.appendChild(faceModeBtn);

        // Add styles for the buttons
        const style = document.createElement('style');
        style.textContent = `
            .mode-button {
                background-color: #555;
                color: white;
                border: none;
                padding: 5px 10px;
                text-align: center;
                text-decoration: none;
                display: inline-block;
                font-size: 12px;
                margin: 2px;
                cursor: pointer;
                border-radius: 3px;
            }
            .mode-button.active {
                background-color: #4CAF50;
            }
            .mode-button:hover {
                background-color: #777;
            }
            .mode-button.active:hover {
                background-color: #45a049;
            }
        `;
        document.head.appendChild(style);

        // Add event listeners for mode buttons
        const buttons = [objectModeBtn, vertexModeBtn, edgeModeBtn, faceModeBtn];
        buttons.forEach(button => {
            button.addEventListener('click', () => {
                // Update active button
                buttons.forEach(btn => btn.classList.remove('active'));
                button.classList.add('active');

                // Set component mode
                this.setComponentMode(button.dataset.mode);
            });
        });

        // Add to container
        this.container.appendChild(componentModeContainer);
    }

    setComponentMode(mode) {
        // Exit current mode
        this.clearComponentSelection();

        // Set new mode
        this.componentMode = mode;
        console.log(`Component mode set to: ${mode}`);

        // If we're switching to object mode, make sure we can select objects
        if (mode === 'object') {
            // Remove any component helpers
            this.removeComponentHelpers();

            // Restore normal object selection
            if (this.selectedObject) {
                this.transformControls.attach(this.selectedObject);
            }
        } else {
            // If we're in component mode but don't have an object selected, we can't do anything
            if (!this.selectedObject) {
                console.warn('No object selected. Please select an object first.');
                return;
            }

            // Initialize component selection by creating the necessary helpers
            this.initComponentHelpers();
        }
    }

    clearComponentSelection() {
        // Clear any selected components
        this.selectedComponents = [];

        // Update visual helpers
        this.updateComponentHelpers();
    }

    removeComponentHelpers() {
        // Remove vertex markers
        if (this.componentHelpers.vertexMarkers) {
            this.scene.remove(this.componentHelpers.vertexMarkers);
            this.componentHelpers.vertexMarkers = null;
        }

        // Remove edge highlights
        if (this.componentHelpers.edgeHighlights) {
            this.scene.remove(this.componentHelpers.edgeHighlights);
            this.componentHelpers.edgeHighlights = null;
        }

        // Remove face highlights
        if (this.componentHelpers.faceHighlights) {
            this.scene.remove(this.componentHelpers.faceHighlights);
            this.componentHelpers.faceHighlights = null;
        }
    }

    initComponentHelpers() {
        // Remove any existing helpers
        this.removeComponentHelpers();

        if (!this.selectedObject) return;

        // Create helpers based on the current component mode
        switch (this.componentMode) {
            case 'vertex':
                this.createVertexHelpers();
                break;
            case 'edge':
                this.createEdgeHelpers();
                break;
            case 'face':
                this.createFaceHelpers();
                break;
        }
    }

    createVertexHelpers() {
        // We'll create point markers for all vertices
        const vertexMarkers = new THREE.Group();
        vertexMarkers.name = 'vertexMarkers';

        // Process all meshes in the selected object
        this.selectedObject.traverse(child => {
            if (child.isMesh && child.geometry) {
                const geometry = child.geometry;

                // Make sure geometry attributes are available
                if (!geometry.attributes || !geometry.attributes.position) return;

                const positions = geometry.attributes.position;
                const vertexCount = positions.count;

                // Get world matrix to transform vertices to world space
                const worldMatrix = child.matrixWorld;

                // For optimization, we'll use instanced mesh for vertices
                const markerGeometry = new THREE.SphereGeometry(0.03, 4, 4); // Reduced segments for better performance
                const markerMaterial = new THREE.MeshBasicMaterial({
                    color: 0x00ffff,
                    transparent: true,
                    opacity: 0.7
                });

                // Create instanced mesh for better performance with many vertices
                const instancedMesh = new THREE.InstancedMesh(markerGeometry, markerMaterial, vertexCount);
                instancedMesh.count = vertexCount; // Set the number of instances
                instancedMesh.frustumCulled = false; // Disable frustum culling for now

                // Create a dummy object to help with matrix calculations
                const dummy = new THREE.Object3D();

                // Create a map to store vertex indices for raycasting
                instancedMesh.userData = {
                    type: 'vertex-container',
                    originalMesh: child,
                    vertexMap: new Map() // Map instance IDs to vertex indices
                };

                // Only display a subset of vertices for large meshes
                const skipFactor = vertexCount > 1000 ? Math.floor(vertexCount / 500) : 1;

                // Set up each instance
                let instanceCount = 0;
                for (let i = 0; i < vertexCount; i += skipFactor) {
                    if (instanceCount >= vertexCount) break;

                    const vertex = new THREE.Vector3(
                        positions.getX(i),
                        positions.getY(i),
                        positions.getZ(i)
                    );

                    // Transform vertex to world space
                    vertex.applyMatrix4(worldMatrix);

                    // Set position for this instance
                    dummy.position.copy(vertex);
                    dummy.updateMatrix();
                    instancedMesh.setMatrixAt(instanceCount, dummy.matrix);

                    // Store mapping from instance ID to vertex index
                    instancedMesh.userData.vertexMap.set(instanceCount, i);

                    instanceCount++;
                }

                // Adjust count to actual number of instances created
                instancedMesh.count = instanceCount;

                // Update the instance matrices
                instancedMesh.instanceMatrix.needsUpdate = true;

                vertexMarkers.add(instancedMesh);
            }
        });

        // Add markers to scene
        this.scene.add(vertexMarkers);
        this.componentHelpers.vertexMarkers = vertexMarkers;
    }

    createEdgeHelpers() {
        // Create line segments for edges
        const edgeGroup = new THREE.Group();
        edgeGroup.name = 'edgeHelpers';

        // Process all meshes in the selected object
        this.selectedObject.traverse(child => {
            if (child.isMesh && child.geometry) {
                // Use EdgesGeometry to extract edges
                const edgesGeometry = new THREE.EdgesGeometry(child.geometry);

                // Create both the visible lines and the selection mesh
                const edgeMaterial = new THREE.LineBasicMaterial({
                    color: 0x00ffff,
                    transparent: true,
                    opacity: 0.7,
                    linewidth: 1
                });

                const edges = new THREE.LineSegments(edgesGeometry, edgeMaterial);

                // For edge selection, create a set of "fat lines" - meshes that can be clicked
                const positions = edgesGeometry.attributes.position;
                const edgeCount = positions.count / 2; // Each edge has 2 vertices

                // Create a selection helper group for this mesh's edges
                const edgeSelectionHelper = new THREE.Group();
                edgeSelectionHelper.name = 'edgeSelectionHelper';

                // Create a map to store edge data
                edges.userData = {
                    type: 'edge-container',
                    originalMesh: child,
                    edgeMap: new Map(), // Map from helper ID to edge info
                    edgeHelpers: edgeSelectionHelper
                };

                // Only process some edges for large meshes
                const skipFactor = edgeCount > 500 ? Math.floor(edgeCount / 300) : 1;

                // For each edge, create a selectable "tube" around it
                for (let i = 0; i < edgeCount; i += skipFactor) {
                    const idx1 = i * 2;
                    const idx2 = i * 2 + 1;

                    if (idx2 >= positions.count) continue;

                    const start = new THREE.Vector3(
                        positions.getX(idx1),
                        positions.getY(idx1),
                        positions.getZ(idx1)
                    );

                    const end = new THREE.Vector3(
                        positions.getX(idx2),
                        positions.getY(idx2),
                        positions.getZ(idx2)
                    );

                    // Create edge directions and length
                    const direction = new THREE.Vector3().subVectors(end, start);
                    const edgeLength = direction.length();

                    // Skip very small edges
                    if (edgeLength < 0.01) continue;

                    // Create selectable helper geometry (thin cylinder)
                    const edgeGeometry = new THREE.CylinderGeometry(0.015, 0.015, edgeLength, 4, 1);

                    // Rotate and position cylinder to match edge
                    edgeGeometry.translate(0, edgeLength / 2, 0);

                    const edgeHelper = new THREE.Mesh(
                        edgeGeometry,
                        new THREE.MeshBasicMaterial({
                            color: 0x00ffff,
                            transparent: true,
                            opacity: 0.2,
                            visible: false // Hide these by default, just for selection
                        })
                    );

                    // Position the helper
                    edgeHelper.position.copy(start);

                    // Orient the helper along the edge
                    if (edgeLength > 0) {
                        // Get the rotation to align the cylinder with the edge
                        const up = new THREE.Vector3(0, 1, 0);
                        edgeHelper.quaternion.setFromUnitVectors(up, direction.clone().normalize());
                    }

                    // Store data for this edge
                    edgeHelper.userData = {
                        type: 'edge',
                        originalMesh: child,
                        startIndex: idx1,
                        endIndex: idx2,
                        startPosition: start.clone(),
                        endPosition: end.clone()
                    };

                    // Add to edge map for lookup
                    edges.userData.edgeMap.set(edgeHelper.id, {
                        helper: edgeHelper,
                        startIndex: idx1 / 2,
                        endIndex: idx2 / 2
                    });

                    edgeSelectionHelper.add(edgeHelper);
                }

                // Apply the mesh's transforms
                edges.applyMatrix4(child.matrixWorld);
                edgeSelectionHelper.applyMatrix4(child.matrixWorld);

                // Add both visible edges and selection helpers
                edgeGroup.add(edges);
                edgeGroup.add(edgeSelectionHelper);
            }
        });

        // Add edges to scene
        this.scene.add(edgeGroup);
        this.componentHelpers.edgeHighlights = edgeGroup;
    }

    createFaceHelpers() {
        // Create a group for face highlights
        const faceGroup = new THREE.Group();
        faceGroup.name = 'faceHelpers';

        // Process all meshes in the selected object
        this.selectedObject.traverse(child => {
            if (child.isMesh && child.geometry) {
                // For face selection, we'll create a copy of the mesh with special materials

                // Create a material for unselected faces
                const faceMaterial = new THREE.MeshBasicMaterial({
                    color: 0x00ffff,
                    transparent: true,
                    opacity: 0.2,
                    side: THREE.DoubleSide,
                    depthTest: true,
                    depthWrite: false,
                    polygonOffset: true,
                    polygonOffsetFactor: 1,
                    polygonOffsetUnits: 1
                });

                // Clone the geometry for highlighting
                let faceHighlightGeometry = child.geometry.clone();

                // Create the highlight mesh
                const highlightMesh = new THREE.Mesh(faceHighlightGeometry, faceMaterial);

                // Apply original mesh transforms
                highlightMesh.applyMatrix4(child.matrixWorld);

                // Store reference to original mesh and face info
                highlightMesh.userData = {
                    type: 'face-container',
                    originalMesh: child,
                    faceMap: new Map() // Will store face data if we need it
                };

                // Store geometry info for face selection
                if (faceHighlightGeometry.index) {
                    const indices = faceHighlightGeometry.index.array;
                    const positions = faceHighlightGeometry.attributes.position;

                    // For indexed geometry, triangles are defined by indices
                    const faceCount = indices.length / 3; // Each triangle has 3 indices

                    // Store triangle center points for selection
                    for (let i = 0; i < faceCount; i++) {
                        const a = indices[i * 3];
                        const b = indices[i * 3 + 1];
                        const c = indices[i * 3 + 2];

                        // Get vertices
                        const vertexA = new THREE.Vector3(
                            positions.getX(a),
                            positions.getY(a),
                            positions.getZ(a)
                        );

                        const vertexB = new THREE.Vector3(
                            positions.getX(b),
                            positions.getY(b),
                            positions.getZ(b)
                        );

                        const vertexC = new THREE.Vector3(
                            positions.getX(c),
                            positions.getY(c),
                            positions.getZ(c)
                        );

                        // Calculate center of triangle
                        const center = new THREE.Vector3()
                            .add(vertexA)
                            .add(vertexB)
                            .add(vertexC)
                            .divideScalar(3);

                        // Store data for lookup
                        highlightMesh.userData.faceMap.set(i, {
                            indices: [a, b, c],
                            center: center,
                            vertices: [vertexA, vertexB, vertexC]
                        });
                    }
                } else {
                    // For non-indexed geometry, vertices are in sequence for each triangle
                    const positions = faceHighlightGeometry.attributes.position;
                    const faceCount = positions.count / 3;

                    // Store triangle center points for selection
                    for (let i = 0; i < faceCount; i++) {
                        const a = i * 3;
                        const b = i * 3 + 1;
                        const c = i * 3 + 2;

                        // Get vertices
                        const vertexA = new THREE.Vector3(
                            positions.getX(a),
                            positions.getY(a),
                            positions.getZ(a)
                        );

                        const vertexB = new THREE.Vector3(
                            positions.getX(b),
                            positions.getY(b),
                            positions.getZ(b)
                        );

                        const vertexC = new THREE.Vector3(
                            positions.getX(c),
                            positions.getY(c),
                            positions.getZ(c)
                        );

                        // Calculate center of triangle
                        const center = new THREE.Vector3()
                            .add(vertexA)
                            .add(vertexB)
                            .add(vertexC)
                            .divideScalar(3);

                        // Store data for lookup
                        highlightMesh.userData.faceMap.set(i, {
                            indices: [a, b, c],
                            center: center,
                            vertices: [vertexA, vertexB, vertexC]
                        });
                    }
                }

                faceGroup.add(highlightMesh);
            }
        });

        // Add face highlights to scene
        this.scene.add(faceGroup);
        this.componentHelpers.faceHighlights = faceGroup;
    }

    /**
     * Frame the selected object, or all objects if nothing is selected
     */
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

    /**
     * Center the camera on the current target without changing distance
     */
    centerOnTarget() {
        // Get current direction from camera to target (need to reverse direction)
        const direction = new THREE.Vector3().subVectors(
            this.camera.position, this.cameraTarget
        ).normalize();

        // Get current distance to maintain
        const distance = this.camera.position.distanceTo(this.cameraTarget);

        // Calculate new camera position that centers on target
        const newPosition = new THREE.Vector3().copy(this.cameraTarget).addScaledVector(direction, distance);

        // Update camera position
        this.camera.position.copy(newPosition);

        console.log('Centered camera on target');
    }

    // Create visual representation of bones
    createBoneVisualization(model, bones) {
        // This method is no longer needed since we use THREE.SkeletonHelper exclusively
        // Method intentionally left empty but not removed to avoid breaking references
    }

    // Update the bone visualizations when bones move
    updateBoneVisualization(model) {
        // This method is no longer needed since THREE.SkeletonHelper updates automatically
        // Method intentionally left empty but not removed to avoid breaking references
    }

    // Toggle bone visualization visibility
    toggleBoneVisualization(model, visible) {
        if (!model || !model.userData.hasSkeletalData) return;

        // Only update the SkeletonHelper visibility
        if (model.userData.skeletonHelper) {
            model.userData.skeletonHelper.visible = visible;
        }

        // Store the visibility state
        model.userData.bonesVisible = visible;
    }

    // Select a bone for manipulation
    selectBone(bone) {
        // Check if bone is valid
        if (!bone) {
            console.warn("Cannot select null bone");
            return;
        }

        // Find the model that contains this bone
        const model = this.findModelForBone(bone);
        if (!model || !this.isObjectInScene(model)) {
            console.warn("Cannot select bone from a model that is not in the scene");
            return;
        }

        // Deselect previous bone if any
        if (this.selectedBone) {
            // Remove transform controls from previous bone
            this.transformControls.detach();
        }

        // Store the selected bone
        this.selectedBone = bone;

        // Switch to posing mode
        if (model.userData.posingMode === false) {
            // Find and click the posing mode button
            const posingButton = document.getElementById('posing-mode');
            if (posingButton) {
                posingButton.click();
            }
        }

        // Store the original bone transformations for reset if needed
        if (!bone.userData.originalMatrix) {
            bone.userData.originalMatrix = bone.matrix.clone();
            bone.userData.originalPosition = bone.position.clone();
            bone.userData.originalQuaternion = bone.quaternion.clone();
            bone.userData.originalScale = bone.scale.clone();
        }

        // Create a visual helper for the bone joint
        const jointGeometry = new THREE.SphereGeometry(0.05, 16, 16);
        const jointMaterial = new THREE.MeshBasicMaterial({ color: 0x00ff00 });
        const jointMesh = new THREE.Mesh(jointGeometry, jointMaterial);

        // Position the joint at the bone's world position
        const jointPos = bone.getWorldPosition(new THREE.Vector3());
        jointMesh.position.copy(jointPos);

        // Store reference to the bone
        jointMesh.userData.isBoneJoint = true;
        jointMesh.userData.bone = bone;

        // Add to scene
        this.scene.add(jointMesh);

        // Attach transform controls directly to the bone
        this.transformControls.attach(bone);
        this.selectedObject = bone;

        // Update UI with bone transformation values
        this.updateUIFromBone();

        // Show channel box
        this.channelBoxTitle.textContent = `${bone.name || 'Bone'} Transform`;
        this.transformGroup.style.opacity = '1';
        this.transformGroup.style.pointerEvents = 'auto';
        if (this.boneManipulatorGroup) {
            this.boneManipulatorGroup.style.display = 'block';
        }

        // Update the outliner selection
        this.updateBoneSelectionInOutliner(bone);

        // Force update the skinned meshes
        this.updateSkinnedMeshes(model);
    }

    // New method to update skinned meshes when bone transforms change
    updateSkinnedMeshes(model) {
        if (!model) return;

        // Ensure all bones are updated
        if (model.userData.bones) {
            model.userData.bones.forEach(bone => {
                bone.updateMatrix();
                bone.updateMatrixWorld(true);
            });
        }

        // Update all skinned meshes
        model.traverse((node) => {
            if (node.isSkinnedMesh) {
                // Update skeleton
                if (node.skeleton) {
                    node.skeleton.update();

                    // Manually update all bone matrices
                    if (node.skeleton.bones) {
                        node.skeleton.bones.forEach(bone => {
                            bone.updateMatrixWorld(true);
                        });
                    }
                }

                // Force bind matrices to update
                if (node.bindMatrix) {
                    node.bindMatrix.needsUpdate = true;
                }

                if (node.bindMatrixInverse) {
                    node.bindMatrixInverse.copy(new THREE.Matrix4().invert(node.bindMatrix));
                }

                // Force geometry attributes to update
                if (node.geometry) {
                    if (node.geometry.attributes) {
                        if (node.geometry.attributes.position) {
                            node.geometry.attributes.position.needsUpdate = true;
                        }
                        if (node.geometry.attributes.normal) {
                            node.geometry.attributes.normal.needsUpdate = true;
                        }
                        if (node.geometry.attributes.skinWeight) {
                            node.geometry.attributes.skinWeight.needsUpdate = true;
                        }
                        if (node.geometry.attributes.skinIndex) {
                            node.geometry.attributes.skinIndex.needsUpdate = true;
                        }
                    }
                    node.geometry.computeBoundingSphere();
                    node.geometry.computeBoundingBox();
                }

                // Force material update
                if (node.material) {
                    node.material.needsUpdate = true;
                }

                // Ensure proper rendering
                node.visible = true;
            }
        });

        // Update the scene
        model.updateMatrixWorld(true);
    }

    // Apply UI changes to the selected bone
    updateBoneTransform() {
        if (!this.selectedBone) return;

        // Store the original world position before any transforms
        const originalWorldPos = this.selectedBone.getWorldPosition(new THREE.Vector3());

        // Apply position
        this.selectedBone.position.set(
            parseFloat(this.translateXInput.value),
            parseFloat(this.translateYInput.value),
            parseFloat(this.translateZInput.value)
        );

        // Apply rotation (convert from degrees to radians)
        const euler = new THREE.Euler(
            parseFloat(this.rotateXInput.value) * THREE.MathUtils.DEG2RAD,
            parseFloat(this.rotateYInput.value) * THREE.MathUtils.DEG2RAD,
            parseFloat(this.rotateZInput.value) * THREE.MathUtils.DEG2RAD
        );
        this.selectedBone.quaternion.setFromEuler(euler);

        // Apply scale
        this.selectedBone.scale.set(
            parseFloat(this.scaleXInput.value),
            parseFloat(this.scaleYInput.value),
            parseFloat(this.scaleZInput.value)
        );

        // Update bone matrix and world matrix
        this.selectedBone.updateMatrix();
        this.selectedBone.updateMatrixWorld(true);

        // Find the model that contains this bone
        const model = this.findModelForBone(this.selectedBone);
        if (model) {
            // Update all bones in the skeleton
            if (model.userData.bones) {
                model.userData.bones.forEach(bone => {
                    bone.updateMatrix();
                    bone.updateMatrixWorld(true);
                });
            }

            // Update bone visualization
            this.updateBoneVisualization(model);

            // Update the skinned meshes
            this.updateSkinnedMeshes(model);
        }

        // Update the transform controls to match the bone
        if (this.selectedObject && this.selectedObject.userData.isBoneJoint) {
            const jointPos = this.selectedBone.getWorldPosition(new THREE.Vector3());
            this.selectedObject.position.copy(jointPos);
            this.transformControls.update();
        }
    }

    // Update UI inputs from bone transform
    updateUIFromBone() {
        if (!this.selectedBone) return;

        // Get bone's local position
        const position = this.selectedBone.position;
        const rotation = new THREE.Euler().setFromQuaternion(this.selectedBone.quaternion);
        const scale = this.selectedBone.scale;

        // Update translate inputs (in local space)
        this.translateXInput.value = position.x.toFixed(2);
        this.translateYInput.value = position.y.toFixed(2);
        this.translateZInput.value = position.z.toFixed(2);

        // Update rotate inputs - convert from radians to degrees
        this.rotateXInput.value = (rotation.x * THREE.MathUtils.RAD2DEG).toFixed(1);
        this.rotateYInput.value = (rotation.y * THREE.MathUtils.RAD2DEG).toFixed(1);
        this.rotateZInput.value = (rotation.z * THREE.MathUtils.RAD2DEG).toFixed(1);

        // Update scale inputs
        this.scaleXInput.value = scale.x.toFixed(2);
        this.scaleYInput.value = scale.y.toFixed(2);
        this.scaleZInput.value = scale.z.toFixed(2);
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

        // Add scene children (models, camera, lights, etc.)
        this.addCameraToOutliner(sceneChildren);
        this.addLightsToOutliner(sceneChildren);
        this.addModelsToOutliner(sceneChildren);
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
}

// Initialize the viewer when the page is loaded
document.addEventListener('DOMContentLoaded', () => {
    new ModelViewer();
}); 