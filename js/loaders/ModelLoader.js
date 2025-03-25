/**
 * ModelLoader - Handles loading 3D models in various formats
 */
import { THREE } from '../utils/ThreeUtils.js';

class ModelLoader {
    /**
     * Create a new ModelLoader
     * @param {Object} options - Optional settings
     */
    constructor(options = {}) {
        this.options = Object.assign({
            defaultScale: 5,
            defaultRotation: { x: 0, y: Math.PI, z: 0 }
        }, options);

        // Setup loaders for different formats
        this.objLoader = new THREE.OBJLoader();

        // Event callbacks
        this.onProgress = options.onProgress || null;
        this.onError = options.onError || null;
    }

    /**
     * Load a model from a file
     * @param {File} file - The file to load
     * @returns {Promise<Object>} - Object containing the model and its metadata
     */
    loadFromFile(file) {
        const fileType = file.name.split('.').pop().toLowerCase();

        // Create file URL
        const fileURL = URL.createObjectURL(file);

        // Return promise to handle async loading
        return new Promise((resolve, reject) => {
            try {
                if (fileType === 'obj') {
                    this.loadOBJ(fileURL, (result) => {
                        // Cleanup URL after loading
                        URL.revokeObjectURL(fileURL);
                        resolve(result);
                    });
                } else {
                    throw new Error(`Unsupported file type: ${fileType}`);
                }
            } catch (error) {
                // Cleanup URL on error
                URL.revokeObjectURL(fileURL);

                // Call error callback if provided
                if (this.onError) {
                    this.onError(error);
                }

                reject(error);
            }
        });
    }

    /**
     * Load OBJ model
     * @param {string} url - URL of the OBJ file
     * @param {Function} callback - Callback when loading is complete
     */
    loadOBJ(url, callback) {
        this.objLoader.load(
            url,
            (object) => {
                // Process loaded model
                const result = this.processModel(object);
                callback(result);
            },
            (xhr) => {
                // Progress callback
                if (this.onProgress) {
                    const percentComplete = (xhr.loaded / xhr.total) * 100;
                    this.onProgress(percentComplete);
                }
            },
            (error) => {
                // Error callback
                if (this.onError) {
                    this.onError(error);
                }
            }
        );
    }

    /**
     * Process a loaded model to prepare it for viewing
     * @param {THREE.Object3D} model - The loaded model
     * @returns {Object} - Object containing the model and its metadata
     */
    processModel(model) {
        // Calculate the bounding box
        const box = new THREE.Box3().setFromObject(model);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());

        // Calculate normalization scale to standardize model size
        const maxDim = Math.max(size.x, size.y, size.z);
        const scale = this.options.defaultScale / maxDim;

        // Set default transform
        const transform = {
            translate: {
                x: 0,
                y: -box.min.y * scale, // Position model so bottom is at y=0
                z: 0
            },
            rotate: this.options.defaultRotation,
            scale: { x: 1, y: 1, z: 1 },
            baseScale: scale
        };

        // Setup materials if needed
        model.traverse((child) => {
            if (child.isMesh) {
                // Set shadow properties
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

        // Return model and metadata
        return {
            model: model,
            bounds: box,
            center: center,
            size: size,
            transform: transform
        };
    }
}

// Export the class
export { ModelLoader }; 