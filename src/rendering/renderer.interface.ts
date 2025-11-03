import type { BBox } from "../global";
import type { Feature, FeatureCollection, Geometry } from 'geojson';

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

export interface IVectorLayerRenderer extends IRenderer {
    /**
     * Load and render vector data from a GeoJSON source
     * @param data GeoJSON FeatureCollection to render
     * @param options Rendering options
     */
    loadData(data: FeatureCollection<Geometry>): void;
    
    /**
     * Update the style of the vector features
     * @param style Style properties to update
     */
    setStyle(style: VectorLayerStyle): void;
    
    /**
     * Set the minimum and maximum zoom levels for rendering
     * @param minZoom Minimum zoom level
     * @param maxZoom Maximum zoom level
     */
    setZoomRange(minZoom: number, maxZoom: number): void;
}

export interface VectorLayerStyle {
    /**
     * Fill color for polygons and points (CSS color string or array of colors for data-driven styling)
     */
    fillColor?: string | ((feature: Feature) => string);
    
    /**
     * Stroke color for lines and polygon outlines
     */
    strokeColor?: string | ((feature: Feature) => string);
    
    /**
     * Stroke width in pixels
     */
    strokeWidth?: number | ((feature: Feature) => number);
    
    /**
     * Opacity (0-1)
     */
    opacity?: number | ((feature: Feature) => number);
    
    /**
     * Point radius in pixels (for point features)
     */
    pointRadius?: number | ((feature: Feature) => number);
    
    /**
     * Whether to enable feature highlighting on hover
     */
    highlightOnHover?: boolean;
    
    /**
     * Style for highlighted features
     */
    highlightStyle?: Partial<Omit<VectorLayerStyle, 'highlightStyle' | 'highlightOnHover'>>;
}
