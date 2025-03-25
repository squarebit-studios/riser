/**
 * Viewport - Manages the 3D scene, renderer and camera
 */
import { THREE } from '../utils/ThreeUtils.js';

class Viewport {
    /**
     * Create a new Viewport
     * @param {HTMLElement} container - The DOM element to render into
     * @param {Object} options - Optional settings
     */
    constructor(container, options = {}) {
        this.container = container;
        this.options = Object.assign({
            clearColor: 0x222222,
            shadowsEnabled: true,
            antialias: true
        }, options);

        this.width = this.container.clientWidth;
        this.height = this.container.clientHeight;
        this.aspect = this.width / this.height;

        // Setup core components
        this.setupScene();
        this.setupCamera();
        this.setupRenderer();
        this.setupLights();

        // Additional properties
        this.objects = []; // Store all objects in the scene
        this.clock = new THREE.Clock();
        this.animating = false;
        this.loadedModel = null;

        // Handle window resize
        window.addEventListener('resize', this.onWindowResize.bind(this));

        // Start animation loop
        this.animate();
    }

    /**
     * Setup the scene
     */
    setupScene() {
        this.scene = new THREE.Scene();

        // Add grid helper
        const gridHelper = new THREE.GridHelper(20, 20);
        this.scene.add(gridHelper);

        // Add axes helper
        const axesHelper = new THREE.AxesHelper(5);
        this.scene.add(axesHelper);
    }

    /**
     * Setup the camera
     */
    setupCamera() {
        this.camera = new THREE.PerspectiveCamera(45, this.aspect, 0.1, 1000);
        this.camera.position.set(0, 10, 20);
        this.cameraTarget = new THREE.Vector3(0, 0, 0);
        this.camera.lookAt(this.cameraTarget);
    }

    /**
     * Setup the renderer
     */
    setupRenderer() {
        this.renderer = new THREE.WebGLRenderer({
            antialias: this.options.antialias,
            alpha: true
        });

        this.renderer.setSize(this.width, this.height);
        this.renderer.setClearColor(this.options.clearColor);
        this.renderer.setPixelRatio(window.devicePixelRatio);

        // Enable shadows
        if (this.options.shadowsEnabled) {
            this.renderer.shadowMap.enabled = true;
            this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        }

        // Add renderer to DOM
        this.container.appendChild(this.renderer.domElement);
    }

    /**
     * Setup scene lighting
     */
    setupLights() {
        // Ambient light
        const ambientLight = new THREE.AmbientLight(0x404040, 0.5);
        this.scene.add(ambientLight);

        // Directional light (sun)
        const mainLight = new THREE.DirectionalLight(0xffffff, 0.8);
        mainLight.position.set(50, 100, 50);
        mainLight.castShadow = this.options.shadowsEnabled;

        // Configure shadow properties
        if (this.options.shadowsEnabled) {
            mainLight.shadow.mapSize.width = 2048;
            mainLight.shadow.mapSize.height = 2048;
            mainLight.shadow.camera.near = 0.5;
            mainLight.shadow.camera.far = 500;
            mainLight.shadow.camera.left = -100;
            mainLight.shadow.camera.right = 100;
            mainLight.shadow.camera.top = 100;
            mainLight.shadow.camera.bottom = -100;
        }

        this.scene.add(mainLight);

        // Additional fill light
        const fillLight = new THREE.DirectionalLight(0xffffff, 0.3);
        fillLight.position.set(-50, 50, -50);
        this.scene.add(fillLight);
    }

    /**
     * Handle window resize
     */
    onWindowResize() {
        this.width = this.container.clientWidth;
        this.height = this.container.clientHeight;
        this.aspect = this.width / this.height;

        // Update camera
        this.camera.aspect = this.aspect;
        this.camera.updateProjectionMatrix();

        // Update renderer
        this.renderer.setSize(this.width, this.height);
    }

    /**
     * Add an object to the scene
     * @param {THREE.Object3D} object - The object to add
     */
    addObject(object) {
        this.scene.add(object);
        this.objects.push(object);
    }

    /**
     * Remove an object from the scene
     * @param {THREE.Object3D} object - The object to remove
     */
    removeObject(object) {
        this.scene.remove(object);
        const index = this.objects.indexOf(object);
        if (index !== -1) {
            this.objects.splice(index, 1);
        }
    }

    /**
     * Clear all objects from the scene except helpers
     */
    clearObjects() {
        // Keep track of objects to remove
        const objectsToRemove = [];

        // Find objects that aren't helpers
        this.scene.traverse((object) => {
            // Skip grid and axes helpers
            if (object instanceof THREE.GridHelper ||
                object instanceof THREE.AxesHelper ||
                object instanceof THREE.Light) {
                return;
            }

            // Skip camera and scene itself
            if (object === this.scene || object === this.camera) {
                return;
            }

            // Add to removal list
            if (object.parent === this.scene) {
                objectsToRemove.push(object);
            }
        });

        // Remove the objects
        objectsToRemove.forEach(object => {
            this.scene.remove(object);
        });

        // Reset objects array
        this.objects = this.objects.filter(obj =>
            obj instanceof THREE.GridHelper ||
            obj instanceof THREE.AxesHelper ||
            obj instanceof THREE.Light
        );

        this.loadedModel = null;
    }

    /**
     * Load a model into the scene
     * @param {Object} modelData - The model data from ModelLoader
     */
    loadModel(modelData) {
        // Clear existing model
        if (this.loadedModel) {
            this.removeObject(this.loadedModel);
            this.loadedModel = null;
        }

        const model = modelData.model;
        const transform = modelData.transform;

        // Apply transformations
        model.scale.multiplyScalar(transform.baseScale);
        model.position.set(
            transform.translate.x,
            transform.translate.y,
            transform.translate.z
        );
        model.rotation.set(
            transform.rotate.x,
            transform.rotate.y,
            transform.rotate.z
        );

        // Add to scene
        this.addObject(model);
        this.loadedModel = model;

        // Center camera target on model
        this.cameraTarget.copy(modelData.center);
        this.cameraTarget.y *= transform.baseScale;

        // Update camera
        this.camera.lookAt(this.cameraTarget);

        return model;
    }

    /**
     * Set camera target
     * @param {THREE.Vector3} target - The new target
     */
    setCameraTarget(target) {
        this.cameraTarget.copy(target);
        this.camera.lookAt(this.cameraTarget);
    }

    /**
     * Render the scene
     */
    render() {
        this.renderer.render(this.scene, this.camera);
    }

    /**
     * Animation loop
     */
    animate() {
        this.animating = true;
        this.render();
        requestAnimationFrame(this.animate.bind(this));
    }

    /**
     * Stop animation
     */
    stopAnimation() {
        this.animating = false;
    }

    /**
     * Dispose of viewport resources
     */
    dispose() {
        // Stop animation
        this.stopAnimation();

        // Remove event listeners
        window.removeEventListener('resize', this.onWindowResize);

        // Dispose of objects
        this.clearObjects();

        // Dispose of renderer
        this.renderer.dispose();

        // Remove DOM element
        if (this.container && this.renderer.domElement) {
            this.container.removeChild(this.renderer.domElement);
        }
    }
}

// Export the class
export { Viewport }; 