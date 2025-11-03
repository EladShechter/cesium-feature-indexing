import { Cartographic, Viewer, Math as CesiumMath, WebMercatorProjection } from "cesium";
import type { BBox } from "./global";

type RenderFunction = (bbox: BBox, zoom: number) => void;

export class CameraHandler {
    private readonly R = 6378137;
    private readonly WORLD_METERS = 2 * Math.PI * this.R;
    private readonly merc = new WebMercatorProjection();

    private lastBBox?: BBox;
    private lastZoom?: number;

    constructor(private viewer: Viewer, private hudZoom: HTMLElement, private maxZoom: number) {
    }

    public setRenderingOnCameraChange(renderFunction: RenderFunction) {
        let lastRefresh = 0;
        const THROTTLE_MS = 100;

        this.viewer.camera.changed.addEventListener(() => {
            const now = performance.now();
            if (now - lastRefresh >= THROTTLE_MS) {
                lastRefresh = now;
                this.renderWhenBboxAndZoomChanged(renderFunction);
            }
        });

        let renderTimeout: number;
        this.viewer.camera.moveEnd.addEventListener(() => {
            if (renderTimeout) clearTimeout(renderTimeout);
            renderTimeout = setTimeout(() => {
                this.renderWhenBboxAndZoomChanged(renderFunction);
            }, THROTTLE_MS);
        });
    }

    public renderForFirstTime(renderFunction: RenderFunction) {
        this.renderWhenBboxAndZoomChanged(renderFunction);
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
        let width = Math.abs(xE - xW);
        if (!isFinite(width) || width <= 0) width = this.WORLD_METERS;
        let zoom = Math.round(Math.log2(this.WORLD_METERS / width));
        zoom = Math.max(0, Math.min(this.maxZoom, zoom));

        return { bbox: [west, south, east, north] as BBox, zoom };
    }

    private sameBBox(a: BBox | undefined, b: BBox | undefined): boolean {
        if (!a || !b) return false;
        return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];
    }
}
