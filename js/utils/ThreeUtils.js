/**
 * ThreeUtils - Three.js import and setup utility
 * This module imports THREE.js and required components and exports them for use in the application
 */

// Import THREE library from CDN
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.132.2/build/three.module.js';

// Import additional modules
import { OBJLoader } from 'https://cdn.jsdelivr.net/npm/three@0.132.2/examples/jsm/loaders/OBJLoader.js';
import { MTLLoader } from 'https://cdn.jsdelivr.net/npm/three@0.132.2/examples/jsm/loaders/MTLLoader.js';

// Log that THREE was imported successfully
console.log('THREE.js loaded successfully', {
    version: THREE.REVISION,
    hasOBJLoader: !!OBJLoader,
    hasMTLLoader: !!MTLLoader
});

// Create a custom OBJLoader class that matches the previous API pattern
class CustomOBJLoader extends OBJLoader {
    constructor() {
        super();
        console.log('CustomOBJLoader created');
    }

    // Override load method to match older API expectations if needed
    load(url, onLoad, onProgress, onError) {
        console.log('Loading OBJ from:', url);
        return super.load(url, onLoad, onProgress, onError);
    }
}

// Create a custom MTLLoader class that matches the previous API pattern
class CustomMTLLoader extends MTLLoader {
    constructor() {
        super();
        console.log('CustomMTLLoader created');
    }
}

// Add loaders to THREE namespace for backward compatibility
THREE.OBJLoader = CustomOBJLoader;
THREE.MTLLoader = CustomMTLLoader;

// Export
export { THREE }; 