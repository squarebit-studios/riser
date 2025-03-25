/**
 * ThreeUtils - Three.js import and setup utility
 * This module imports THREE.js and required components and exports them for use in the application
 */

// Import THREE library
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.132.2/build/three.module.js';

// Import additional modules
import { OBJLoader } from 'https://cdn.jsdelivr.net/npm/three@0.132.2/examples/jsm/loaders/OBJLoader.js';
import { MTLLoader } from 'https://cdn.jsdelivr.net/npm/three@0.132.2/examples/jsm/loaders/MTLLoader.js';

// Create a custom OBJLoader that matches the previous API pattern
class CustomOBJLoader extends OBJLoader {
    constructor() {
        super();
    }
}

// Create a custom MTLLoader that matches the previous API pattern
class CustomMTLLoader extends MTLLoader {
    constructor() {
        super();
    }
}

// Add loaders to THREE namespace for backward compatibility
THREE.OBJLoader = CustomOBJLoader;
THREE.MTLLoader = CustomMTLLoader;

// Export everything
export { THREE }; 