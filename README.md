# 3D Model Viewer

A web-based 3D model viewer that allows you to load and view OBJ 3D models in your browser. Built with Three.js.

## Features

- Load and display OBJ 3D model files
- Orbit controls to rotate, pan, and zoom the camera
- Adjustable model rotation speed
- Reset camera position
- Responsive design

## Technologies Used

- HTML5
- CSS3
- JavaScript (ES6+)
- Three.js (WebGL 3D library)

## Usage

1. Clone this repository:
   ```
   git clone https://github.com/yourusername/3d-viewer.git
   cd 3d-viewer
   ```

2. Open `index.html` in your web browser or serve it using a local development server.

3. Click on "Choose OBJ File" to upload your 3D model (OBJ format).

4. Use the following controls to interact with the model:
   - Left mouse button: Rotate the view
   - Right mouse button: Pan the view
   - Mouse wheel: Zoom in/out
   - Rotation speed slider: Adjust auto-rotation speed
   - Reset Camera button: Return to the default camera position

## Sample OBJ Models

You can find free OBJ models for testing at:
- [Free3D](https://free3d.com/)
- [TurboSquid](https://www.turbosquid.com/Search/3D-Models/free/obj)
- [Sketchfab](https://sketchfab.com/features/download)

## Development

To modify or extend this project:

1. Edit the HTML (`index.html`) to change the structure
2. Modify the CSS (`css/style.css`) to change the appearance
3. Update the JavaScript (`js/main.js`) to add or change functionality

## Run locally
1. cd into your riser repo folder and run this in a shell
2. python -m http.server 8002
3. Now go this address in your browser
4. http://localhost:8002/

## License

MIT License

## Acknowledgments

- Three.js - https://threejs.org/
- Three.js examples - https://threejs.org/examples/#webgl_animation_skinning_blending 
