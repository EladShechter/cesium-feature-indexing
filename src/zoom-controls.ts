import { Viewer } from "cesium";

// Fraction of the camera height moved per click
const ZOOM_FACTOR = 0.5;

// No explicit refresh or requestRender needed: CameraHandler detects any camera change on the next frame,
// and Cesium renders when the camera moved, also in requestRenderMode
export function setupZoomControls(viewer: Viewer) {
    document.getElementById("zoomIn")!.addEventListener("click", () => zoom(viewer, true));
    document.getElementById("zoomOut")!.addEventListener("click", () => zoom(viewer, false));
}

function zoom(viewer: Viewer, zoomIn: boolean): void {
    const camera = viewer.camera;
    // Scale the step by the height so each click feels the same at any altitude
    const amount = camera.positionCartographic.height * ZOOM_FACTOR;
    if (zoomIn) {
        camera.zoomIn(amount);
    } else {
        camera.zoomOut(amount);
    }
}
