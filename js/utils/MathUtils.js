/**
 * MathUtils - Utility functions for 3D math operations
 */
class MathUtils {
    /**
     * Calculate ray from screen coordinates
     * @param {number} x - Screen X coordinate
     * @param {number} y - Screen Y coordinate
     * @param {HTMLElement} element - DOM element for coordinate reference
     * @param {THREE.Camera} camera - The camera to use for the ray
     * @returns {THREE.Raycaster} The raycaster with the calculated ray
     */
    static calculateRayFromScreenCoords(x, y, element, camera) {
        // Create normalized device coordinates
        const rect = element.getBoundingClientRect();
        const mouseX = ((x - rect.left) / rect.width) * 2 - 1;
        const mouseY = -((y - rect.top) / rect.height) * 2 + 1;

        // Set up raycaster
        const raycaster = new THREE.Raycaster();
        const mouseVector = new THREE.Vector2(mouseX, mouseY);

        raycaster.setFromCamera(mouseVector, camera);
        return raycaster;
    }

    /**
     * Get the closest intersection with a mesh
     * @param {THREE.Raycaster} raycaster - The raycaster with ray direction
     * @param {THREE.Object3D} object - The object to intersect with
     * @param {boolean} recursive - Whether to check intersections recursively
     * @returns {THREE.Vector3|null} Point of intersection or null if none
     */
    static getIntersectionPoint(raycaster, object, recursive = true) {
        const intersects = raycaster.intersectObject(object, recursive);

        if (intersects.length > 0) {
            return intersects[0].point.clone();
        }

        return null;
    }

    /**
     * Calculate quaternion for orbit rotation
     * @param {number} deltaX - Mouse movement in X direction
     * @param {number} deltaY - Mouse movement in Y direction
     * @param {THREE.Vector3} eye - Current camera position
     * @param {THREE.Vector3} target - Current look target
     * @param {THREE.Vector3} up - Camera up vector
     * @returns {THREE.Quaternion} Rotation quaternion
     */
    static calculateOrbitRotation(deltaX, deltaY, eye, target, up) {
        // Create rotation quaternion
        const rotation = new THREE.Quaternion();

        // Get the camera's local axes
        const offset = new THREE.Vector3().subVectors(eye, target);
        const forward = new THREE.Vector3().subVectors(target, eye).normalize();
        const right = new THREE.Vector3().crossVectors(forward, up).normalize();
        const upVector = new THREE.Vector3().crossVectors(right, forward).normalize();

        // Calculate individual rotations
        if (deltaY !== 0) {
            // Rotate around the right vector (vertical rotation)
            const verticalRotation = new THREE.Quaternion().setFromAxisAngle(
                right,
                deltaY
            );
            rotation.multiply(verticalRotation);
        }

        if (deltaX !== 0) {
            // Rotate around the up vector (horizontal rotation)
            const horizontalRotation = new THREE.Quaternion().setFromAxisAngle(
                upVector,
                deltaX
            );
            rotation.multiply(horizontalRotation);
        }

        return rotation;
    }

    /**
     * Apply a quaternion rotation to a vector around a pivot point
     * @param {THREE.Vector3} vector - The vector to rotate
     * @param {THREE.Vector3} pivot - The pivot point
     * @param {THREE.Quaternion} quaternion - The rotation quaternion
     * @returns {THREE.Vector3} The rotated vector
     */
    static rotateAroundPivot(vector, pivot, quaternion) {
        // Create copy of the vector
        const result = vector.clone();

        // Translate to origin relative to pivot
        result.sub(pivot);

        // Apply rotation
        result.applyQuaternion(quaternion);

        // Translate back
        result.add(pivot);

        return result;
    }

    /**
     * Calculate pan offset
     * @param {number} deltaX - Mouse movement in X direction
     * @param {number} deltaY - Mouse movement in Y direction  
     * @param {THREE.Vector3} eye - Current camera position
     * @param {THREE.Vector3} target - Current look target
     * @param {THREE.Vector3} up - Camera up vector
     * @param {number} distance - Distance from eye to target
     * @returns {THREE.Vector3} Pan offset
     */
    static calculatePanOffset(deltaX, deltaY, eye, target, up, distance) {
        const offset = new THREE.Vector3();

        // Get the camera's local axes
        const forward = new THREE.Vector3().subVectors(target, eye).normalize();
        const right = new THREE.Vector3().crossVectors(forward, up).normalize();
        const upVector = new THREE.Vector3().crossVectors(right, forward).normalize();

        // Scale by distance for consistent speed regardless of zoom level
        const factor = distance * 0.001;

        // Calculate offset based on mouse movement
        offset.addScaledVector(right, -deltaX * factor);
        offset.addScaledVector(upVector, deltaY * factor);

        return offset;
    }

    /**
     * Calculate zoom offset
     * @param {number} delta - Zoom delta (positive for zoom in, negative for zoom out)
     * @param {THREE.Vector3} eye - Current camera position
     * @param {THREE.Vector3} target - Current look target
     * @param {number} factor - Zoom factor/speed
     * @returns {THREE.Vector3} Zoom offset
     */
    static calculateZoomOffset(delta, eye, target, factor) {
        const offset = new THREE.Vector3();

        // Get direction from eye to target
        const direction = new THREE.Vector3().subVectors(target, eye).normalize();

        // Calculate zoom offset along the direction
        offset.copy(direction).multiplyScalar(delta * factor);

        return offset;
    }
}

// Export the class
export { MathUtils }; 