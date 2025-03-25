/**
 * UIManager - Handles UI elements and interactions
 */
import { THREE } from '../utils/ThreeUtils.js';

class UIManager {
    /**
     * Create a new UI Manager
     * @param {Object} options - Optional settings
     */
    constructor(options = {}) {
        this.options = Object.assign({
            fileInputId: 'fileInput',
            dropZoneId: 'dropZone',
            loadingIndicatorId: 'loadingIndicator',
            pivotIndicatorVisible: true,
            statusBarId: 'statusBar'
        }, options);

        // Initialize UI elements
        this.fileInput = document.getElementById(this.options.fileInputId);
        this.dropZone = document.getElementById(this.options.dropZoneId);
        this.loadingIndicator = document.getElementById(this.options.loadingIndicatorId);
        this.statusBar = document.getElementById(this.options.statusBarId);

        // Callbacks
        this.onFileSelected = null;

        // Initialize UI
        this.setupFileInput();
        this.setupDropZone();
    }

    /**
     * Set up file input element
     */
    setupFileInput() {
        if (!this.fileInput) {
            console.warn('File input element not found');
            return;
        }

        this.fileInput.addEventListener('change', (event) => {
            const files = event.target.files;
            if (files.length > 0) {
                this.handleFileSelection(files[0]);
            }
        });
    }

    /**
     * Set up drop zone for drag-and-drop
     */
    setupDropZone() {
        if (!this.dropZone) {
            console.warn('Drop zone element not found');
            return;
        }

        // Prevent default drag behaviors
        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
            this.dropZone.addEventListener(eventName, preventDefaults, false);
            document.body.addEventListener(eventName, preventDefaults, false);
        });

        // Highlight drop zone when item is dragged over it
        ['dragenter', 'dragover'].forEach(eventName => {
            this.dropZone.addEventListener(eventName, () => {
                this.dropZone.classList.add('highlight');
            }, false);
        });

        ['dragleave', 'drop'].forEach(eventName => {
            this.dropZone.addEventListener(eventName, () => {
                this.dropZone.classList.remove('highlight');
            }, false);
        });

        // Handle dropped files
        this.dropZone.addEventListener('drop', (event) => {
            const dt = event.dataTransfer;
            const files = dt.files;

            if (files.length > 0) {
                this.handleFileSelection(files[0]);
            }
        }, false);

        function preventDefaults(e) {
            e.preventDefault();
            e.stopPropagation();
        }
    }

    /**
     * Handle the selected file
     * @param {File} file - The selected file
     */
    handleFileSelection(file) {
        if (typeof this.onFileSelected === 'function') {
            this.onFileSelected(file);
        }
    }

    /**
     * Set file selected callback
     * @param {Function} callback - Function to call when file is selected
     */
    setFileSelectedCallback(callback) {
        this.onFileSelected = callback;
    }

    /**
     * Show loading indicator
     * @param {string} message - Optional message to display
     */
    showLoading(message = 'Loading...') {
        if (this.loadingIndicator) {
            this.loadingIndicator.textContent = message;
            this.loadingIndicator.style.display = 'block';
        }
    }

    /**
     * Hide loading indicator
     */
    hideLoading() {
        if (this.loadingIndicator) {
            this.loadingIndicator.style.display = 'none';
        }
    }

    /**
     * Create a pivot indicator for the scene
     * @param {THREE.Scene} scene - The scene to add the indicator to
     * @returns {THREE.Object3D} The created pivot indicator
     */
    createPivotIndicator(scene) {
        // Create a yellow sphere to represent the pivot point
        const geometry = new THREE.SphereGeometry(0.1, 16, 16);
        const material = new THREE.MeshBasicMaterial({ color: 0xffff00 });
        const pivotIndicator = new THREE.Mesh(geometry, material);

        // Add to scene
        scene.add(pivotIndicator);

        // Set visibility based on options
        pivotIndicator.visible = this.options.pivotIndicatorVisible;

        return pivotIndicator;
    }

    /**
     * Update the status bar text
     * @param {string} message - Message to display
     */
    updateStatus(message) {
        if (this.statusBar) {
            this.statusBar.textContent = message;
        }
    }

    /**
     * Show information about the loaded model
     * @param {Object} modelData - Information about the loaded model
     */
    displayModelInfo(modelData) {
        if (!modelData) return;

        const info = {
            triangles: 0,
            vertices: 0
        };

        // Count triangles and vertices
        modelData.model.traverse((child) => {
            if (child.isMesh && child.geometry) {
                if (child.geometry.index !== null) {
                    info.triangles += child.geometry.index.count / 3;
                } else if (child.geometry.attributes.position) {
                    info.triangles += child.geometry.attributes.position.count / 3;
                }

                if (child.geometry.attributes.position) {
                    info.vertices += child.geometry.attributes.position.count;
                }
            }
        });

        // Format with thousands separators
        const formattedTriangles = Math.round(info.triangles).toLocaleString();
        const formattedVertices = Math.round(info.vertices).toLocaleString();

        // Display in status bar
        this.updateStatus(`Model: ${formattedTriangles} triangles, ${formattedVertices} vertices`);
    }

    /**
     * Set the visibility of the pivot indicator
     * @param {boolean} visible - Whether the pivot indicator should be visible
     * @param {THREE.Object3D} pivotIndicator - The pivot indicator object
     */
    setPivotIndicatorVisible(visible, pivotIndicator) {
        this.options.pivotIndicatorVisible = visible;

        if (pivotIndicator) {
            pivotIndicator.visible = visible;
        }
    }

    /**
     * Toggle the visibility of the pivot indicator
     * @param {THREE.Object3D} pivotIndicator - The pivot indicator object
     * @returns {boolean} The new visibility state
     */
    togglePivotIndicator(pivotIndicator) {
        this.options.pivotIndicatorVisible = !this.options.pivotIndicatorVisible;

        if (pivotIndicator) {
            pivotIndicator.visible = this.options.pivotIndicatorVisible;
        }

        return this.options.pivotIndicatorVisible;
    }

    /**
     * Create keyboard shortcut display
     * @param {HTMLElement} container - Container element to add the help display to
     */
    createKeyboardShortcutsHelp(container) {
        const helpElement = document.createElement('div');
        helpElement.className = 'keyboard-shortcuts';
        helpElement.innerHTML = `
            <div class="shortcuts-title">Keyboard Shortcuts</div>
            <div class="shortcut-row"><span>Alt + Left Mouse</span><span>Tumble/Orbit</span></div>
            <div class="shortcut-row"><span>Alt + Middle Mouse</span><span>Pan</span></div>
            <div class="shortcut-row"><span>Alt + Right Mouse</span><span>Zoom</span></div>
            <div class="shortcut-row"><span>Mouse Wheel</span><span>Zoom</span></div>
            <div class="shortcut-row"><span>Left Click on Model</span><span>Set Pivot Point</span></div>
            <div class="shortcut-row"><span>P</span><span>Toggle Pivot Indicator</span></div>
            <div class="shortcut-row"><span>R</span><span>Reset View</span></div>
        `;

        // Add help element to container
        if (container) {
            container.appendChild(helpElement);
        }

        return helpElement;
    }
}

// Export the class
export { UIManager }; 