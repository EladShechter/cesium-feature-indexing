import { Cartographic, Matrix4, Viewer, Math as CesiumMath, WebMercatorProjection } from "cesium";
import type { BBox } from "./global";
import { TILE_SIZE_PX } from "./map-constants";

type RenderFunction = (bbox: BBox, zoom: number) => void;

const THROTTLE_MS = 100;

export class CameraHandler {
    private readonly R = 6378137;
    private readonly WORLD_METERS = 2 * Math.PI * this.R;
    private readonly merc = new WebMercatorProjection();

    private lastBBox?: BBox;
    private lastZoom?: number;

    // View state seen on the previous frame
    private readonly lastViewMatrix = new Matrix4();
    private lastCanvasWidth = 0;
    private lastCanvasHeight = 0;

    constructor(private viewer: Viewer, private hudZoom: HTMLElement, private maxZoom: number) {
    }

    /**
     * Re-renders whenever the view changes, whatever moved the camera (mouse, flyTo, zoomIn, setView...).
     *
     * Cesium's `camera.changed` only fires past `percentageChanged`, and `moveEnd` fires `cameraEventWaitTime`
     * (500ms) after the camera stops. Instead, compare the view matrix and canvas size on every frame:
     * `preUpdate` is raised on every animation frame, also in requestRenderMode, and the comparison is cheap.
     * A dirty view is refreshed at most every THROTTLE_MS, so the final position is picked up at most
     * THROTTLE_MS after the camera stops.
     */
    public setRenderingOnCameraChange(renderFunction: RenderFunction) {
        let dirty = false;
        let lastRefresh = 0;

        this.viewer.scene.preUpdate.addEventListener(() => {
            if (this.viewChangedSinceLastFrame()) {
                dirty = true;
            }

            const now = performance.now();
            if (dirty && now - lastRefresh >= THROTTLE_MS) {
                dirty = false;
                lastRefresh = now;
                this.renderWhenBboxAndZoomChanged(renderFunction);
            }
        });
    }

    public renderForFirstTime(renderFunction: RenderFunction) {
        this.renderWhenBboxAndZoomChanged(renderFunction);
    }

    private viewChangedSinceLastFrame(): boolean {
        const camera = this.viewer.camera;
        const canvas = this.viewer.canvas;
        const changed =
            !Matrix4.equalsEpsilon(camera.viewMatrix, this.lastViewMatrix, CesiumMath.EPSILON15) ||
            canvas.clientWidth !== this.lastCanvasWidth ||
            canvas.clientHeight !== this.lastCanvasHeight;

        if (changed) {
            Matrix4.clone(camera.viewMatrix, this.lastViewMatrix);
            this.lastCanvasWidth = canvas.clientWidth;
            this.lastCanvasHeight = canvas.clientHeight;
        }
        return changed;
    }

    private renderWhenBboxAndZoomChanged(renderFunction: RenderFunction): void {
        const { bbox, zoom } = this.viewBBoxAndZoom();
        if (this.lastZoom === zoom && this.sameBBox(this.lastBBox, bbox)) {
            return;
        }
        this.hudZoom.textContent = String(zoom);
        this.lastZoom = zoom;
        this.lastBBox = [...bbox] as BBox;
        renderFunction(bbox, zoom);
    }

    private viewBBoxAndZoom(): { bbox: BBox; zoom: number } {
        const rect = this.viewer.camera.computeViewRectangle(this.viewer.scene.globe.ellipsoid);
        if (!rect) return { bbox: [-180, -85, 180, 85] as BBox, zoom: 2 };

        const west = CesiumMath.toDegrees(rect.west);
        const south = CesiumMath.toDegrees(rect.south);
        const east = CesiumMath.toDegrees(rect.east);
        const north = CesiumMath.toDegrees(rect.north);

        const xW = this.merc.project(Cartographic.fromDegrees(west, 0)).x;
        const xE = this.merc.project(Cartographic.fromDegrees(east, 0)).x;
        // A view crossing the antimeridian has west > east, so its width wraps around the world
        let width = east >= west ? xE - xW : this.WORLD_METERS - (xW - xE);
        if (!isFinite(width) || width <= 0) width = this.WORLD_METERS;
        // Zoom at which a tile is TILE_SIZE_PX on screen. Floor (not round) so tiles are never drawn smaller
        // than TILE_SIZE_PX, which keeps clusters at least the cluster radius apart on screen.
        const metersPerPixel = width / this.viewer.canvas.clientWidth;
        let zoom = Math.floor(Math.log2(this.WORLD_METERS / (TILE_SIZE_PX * metersPerPixel)));
        zoom = Math.max(0, Math.min(this.maxZoom, zoom));

        return { bbox: [west, south, east, north] as BBox, zoom };
    }

    private sameBBox(a: BBox | undefined, b: BBox | undefined): boolean {
        if (!a || !b) return false;
        return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];
    }
}
