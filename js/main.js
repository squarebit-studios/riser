/**
 * Main Application - 3D Model Viewer
 * 
 * This file coordinates the different components of the 3D viewer application.
 */

// Import dependencies
import { THREE } from './utils/ThreeUtils.js';
import { Viewport } from './core/Viewport.js';
import { MayaControls } from './controls/MayaControls.js';
import { ModelLoader } from './loaders/ModelLoader.js';
import { MathUtils } from './utils/MathUtils.js';
import { UIManager } from './ui/UIManager.js';

// Add event dispatcher functionality to MayaControls
MayaControls.prototype.addEventListener = function (type, listener) {
    if (this._listeners === undefined) this._listeners = {};
    if (this._listeners[type] === undefined) this._listeners[type] = [];
    if (this._listeners[type].indexOf(listener) === -1) {
        this._listeners[type].push(listener);
    }
};

MayaControls.prototype.dispatchEvent = function (event) {
    if (this._listeners === undefined) return;
    const listeners = this._listeners[event.type];
    if (listeners !== undefined) {
        const array = listeners.slice(0);
        for (let i = 0, l = array.length; i < l; i++) {
            array[i].call(this, event);
        }
    }
};

class App {
    /**
     * Create a new 3D Viewer Application
     */
    constructor() {
        // DOM elements
        this.container = document.getElementById('canvas-container');
        this.controls = document.getElementById('controls-panel');
        this.statusBar = document.getElementById('status-bar');

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

        // Reset buttons
        this.resetCameraButton = document.getElementById('reset-camera');
        this.resetTransformButton = document.getElementById('reset-transform');

        // Model transform data
        this.modelTransform = {
            translate: { x: 0, y: 0, z: 0 },
            rotate: { x: 0, y: Math.PI, z: 0 },
            scale: { x: 1, y: 1, z: 1 }
        };

        // Initialize components
        this.initComponents();
        this.setupEventListeners();

        // Debug message
        console.log('App initialized', this);
    }

    /**
     * Initialize application components
     */
    initComponents() {
        // Create viewport
        this.viewport = new Viewport(this.container, {
            clearColor: 0x222222,
            shadowsEnabled: true
        });

        // Store scene and loaded model references on container for raycasting
        this.container.scene = this.viewport.scene;
        this.container.loadedModel = this.viewport.loadedModel;

        // Create Maya-style camera controls
        this.cameraControls = new MayaControls(
            this.viewport.camera,
            this.viewport.cameraTarget,
            this.viewport.renderer.domElement,
            { debug: true }
        );

        // Set the scene in the controls
        this.cameraControls.setScene(this.viewport.scene);

        // Create model loader
        this.modelLoader = new ModelLoader({
            onProgress: (percent) => {
                this.uiManager.updateStatus(`Loading: ${percent.toFixed(1)}%`);
            },
            onError: (error) => {
                console.error('Error loading model:', error);
                this.uiManager.updateStatus('Error loading model');
                this.uiManager.hideLoading();
            }
        });

        // Create UI manager
        this.uiManager = new UIManager({
            fileInputId: 'file-input',
            dropZoneId: 'dropZone',
            loadingIndicatorId: 'loading-indicator',
            statusBarId: 'status-bar'
        });

        // Create pivot indicator
        this.pivotIndicator = this.uiManager.createPivotIndicator(this.viewport.scene);

        // Setup file loading callback
        this.uiManager.setFileSelectedCallback((file) => this.loadModel(file));

        // Show keyboard controls help
        this.uiManager.createKeyboardShortcutsHelp(this.container);

        // Initialize slider values
        this.updateSliders();
    }

    /**
     * Setup event listeners
     */
    setupEventListeners() {
        // Reset camera button
        if (this.resetCameraButton) {
            this.resetCameraButton.addEventListener('click', () => this.resetCamera());
        }

        // Reset transform button
        if (this.resetTransformButton) {
            this.resetTransformButton.addEventListener('click', () => this.resetTransform());
        }

        // Setup pivot indicator toggle with P key
        window.addEventListener('keydown', (event) => {
            if (event.key === 'p' || event.key === 'P') {
                const visible = this.uiManager.togglePivotIndicator(this.pivotIndicator);
                this.uiManager.updateStatus(`Pivot indicator ${visible ? 'shown' : 'hidden'}`);
            } else if (event.key === 'r' || event.key === 'R') {
                this.resetCamera();
            }
        });

        // Connect camera controls to pivot indicator updates
        this.cameraControls.addEventListener('pivotChanged', (event) => {
            this.updatePivotIndicator(event.position);
        });

        // Transform sliders
        this.setupTransformListeners();
    }

    /**
     * Setup model transform controls event listeners
     */
    setupTransformListeners() {
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

    /**
     * Load a model file
     * @param {File} file - The file to load
     */
    loadModel(file) {
        // Show loading indicator
        this.uiManager.showLoading('Loading model...');
        this.uiManager.updateStatus('Loading model...');

        // Load the model
        this.modelLoader.loadFromFile(file)
            .then(modelData => {
                // Add the model to the scene
                const model = this.viewport.loadModel(modelData);

                // Update reference to loaded model on container for raycasting
                this.container.loadedModel = this.viewport.loadedModel;

                // Store transform data
                this.modelTransform.translate = Object.assign({}, modelData.transform.translate);
                this.modelTransform.rotate = Object.assign({}, modelData.transform.rotate);
                this.modelTransform.scale = Object.assign({}, modelData.transform.scale);
                this.modelTransform.baseScale = modelData.transform.baseScale;

                // Update UI
                this.updateSliders();
                this.uiManager.displayModelInfo(modelData);
                this.uiManager.hideLoading();

                // Set camera to view the model
                this.resetCamera();

                // Update pivot indicator to match model center
                this.updatePivotIndicator(modelData.center);

                // Update camera controls target
                this.cameraControls.setPivotPoint(modelData.center);

                console.log('Model loaded successfully:', {
                    modelData,
                    model: this.viewport.loadedModel,
                    scene: this.viewport.scene
                });
            })
            .catch(error => {
                console.error('Error loading model:', error);
                this.uiManager.updateStatus('Error loading model: ' + error.message);
                this.uiManager.hideLoading();
            });
    }

    /**
     * Update the model transform based on slider values
     */
    updateModelTransform() {
        if (!this.viewport.loadedModel) return;

        const model = this.viewport.loadedModel;
        const baseScale = this.modelTransform.baseScale || 1;

        // Apply translation
        model.position.set(
            this.modelTransform.translate.x,
            this.modelTransform.translate.y,
            this.modelTransform.translate.z
        );

        // Apply rotation
        model.rotation.set(
            this.modelTransform.rotate.x,
            this.modelTransform.rotate.y,
            this.modelTransform.rotate.z
        );

        // Apply scale
        model.scale.set(
            baseScale * this.modelTransform.scale.x,
            baseScale * this.modelTransform.scale.y,
            baseScale * this.modelTransform.scale.z
        );
    }

    /**
     * Update slider values to match current model transform
     */
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

    /**
     * Reset camera to view the entire model
     */
    resetCamera() {
        if (this.viewport.loadedModel) {
            // Get model bounds
            const box = new THREE.Box3().setFromObject(this.viewport.loadedModel);
            const center = box.getCenter(new THREE.Vector3());
            const size = box.getSize(new THREE.Vector3());

            // Calculate appropriate camera distance
            const maxDim = Math.max(size.x, size.y, size.z);
            const fov = this.viewport.camera.fov * (Math.PI / 180);
            const distance = Math.abs(maxDim / Math.sin(fov / 2));

            // Position camera to view the entire model
            this.viewport.camera.position.set(
                center.x + distance * 0.5,
                center.y + distance * 0.5,
                center.z + distance
            );

            // Set target to model center
            this.viewport.setCameraTarget(center);

            // Update camera controls
            this.cameraControls.setPivotPoint(center);
            this.cameraControls.update();

            // Update pivot indicator
            this.updatePivotIndicator(center);
        } else {
            // Reset to default if no model
            this.viewport.camera.position.set(0, 10, 20);
            this.viewport.setCameraTarget(new THREE.Vector3(0, 0, 0));
            this.cameraControls.setPivotPoint(new THREE.Vector3(0, 0, 0));
            this.updatePivotIndicator(new THREE.Vector3(0, 0, 0));
        }
    }

    /**
     * Reset model transform to defaults
     */
    resetTransform() {
        // Reset to default values
        this.modelTransform.translate = { x: 0, y: 0, z: 0 };
        this.modelTransform.rotate = { x: 0, y: Math.PI, z: 0 };
        this.modelTransform.scale = { x: 1, y: 1, z: 1 };

        // Update UI and model
        this.updateSliders();
        this.updateModelTransform();
    }

    /**
     * Update pivot indicator position
     * @param {THREE.Vector3} position - The new position
     */
    updatePivotIndicator(position) {
        if (this.pivotIndicator) {
            this.pivotIndicator.position.copy(position);
        }
    }

    /**
     * Load a test cube to verify the 3D view
     */
    loadTestCube() {
        console.log('Loading test cube');

        // Create a simple cube geometry
        const geometry = new THREE.BoxGeometry(1, 1, 1);
        const material = new THREE.MeshStandardMaterial({
            color: 0x00ff00,
            metalness: 0.2,
            roughness: 0.8
        });

        const cube = new THREE.Mesh(geometry, material);
        cube.position.set(0, 0.5, 0);
        cube.castShadow = true;
        cube.receiveShadow = true;

        // Add to scene
        this.viewport.scene.add(cube);
        this.viewport.loadedModel = cube;

        // Update container reference
        this.container.loadedModel = cube;

        // Update info
        this.uiManager.updateStatus('Test cube loaded');
        console.log('Test cube added to scene');

        return cube;
    }
}

// Initialize application when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    const app = new App();

    // Load test cube after a short delay to verify the 3D view
    setTimeout(() => {
        app.loadTestCube();
    }, 1000);
}); 