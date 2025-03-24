class ModelViewer {
    constructor() {
        // DOM elements
        this.container = document.getElementById('canvas-container');
        this.fileInput = document.getElementById('file-input');
        this.rotationSpeedInput = document.getElementById('rotation-speed');
        this.resetCameraButton = document.getElementById('reset-camera');

        // Three.js variables
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.controls = null;
        this.model = null;
        this.lights = [];
        this.rotationSpeed = 0.5;
        this.clock = new THREE.Clock();

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

        // Create orbit controls
        this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.05;

        // Create lights
        this.setupLights();

        // Create grid helper
        const gridHelper = new THREE.GridHelper(20, 20);
        this.scene.add(gridHelper);

        // Handle window resize
        window.addEventListener('resize', () => this.onWindowResize(), false);

        // Start animation
        this.animate();
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

        // Rotation speed input change event
        this.rotationSpeedInput.addEventListener('input', (event) => {
            this.rotationSpeed = parseFloat(event.target.value);
        });

        // Reset camera button click event
        this.resetCameraButton.addEventListener('click', () => {
            this.resetCamera();
        });
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

                // Normalize and center
                const maxDim = Math.max(size.x, size.y, size.z);
                const scale = 5 / maxDim;
                this.model.scale.set(scale, scale, scale);
                this.model.position.sub(center.multiplyScalar(scale));

                // Set initial rotation
                this.model.rotation.y = Math.PI / 4;

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

        // Rotate model if exists
        if (this.model && this.rotationSpeed > 0) {
            const delta = this.clock.getDelta();
            this.model.rotation.y += delta * this.rotationSpeed;
        }

        // Render scene
        this.renderer.render(this.scene, this.camera);
    }
}

// Initialize the viewer when the page is loaded
document.addEventListener('DOMContentLoaded', () => {
    new ModelViewer();
}); 