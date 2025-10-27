import type { BBox } from "../global";

export interface IRenderer {
    /**
     * Request rendering of features within the given bounding box and zoom level
     * @param bbox The bounding box to render [west, south, east, north]
     * @param zoom The zoom level
     */
    requestRenderByBboxAndZoom(bbox: BBox, zoom: number): void;

    /**
     * Register callbacks for rendering results
     */
    registerRenderingResult(): void;

    /**
     * Clean up resources when the renderer is no longer needed
     */
    destroy(): void;
}
