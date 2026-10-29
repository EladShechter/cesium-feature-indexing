import "cesium/Build/Cesium/Widgets/widgets.css";
import { Viewer, Rectangle, ImageryLayer, OpenStreetMapImageryProvider } from "cesium";
import {
    buildRandomPointFeatures,
    // buildRandomLineStringFeatures,
    // buildRandomPolygonFeatures
} from "./data";
import { IRenderer, TileRenderer } from "./rendering";
import { setupPicking } from "./picking";
import type { BBox } from "./global";
import { ClusterWorkerClient } from "./cluster-worker-client";
import { CameraHandler } from './camera-handler';
import { setupZoomControls } from './zoom-controls';
import { CLUSTER_RADIUS_PX } from './map-constants';
// import { VectorLayerRenderer } from './rendering/vector-layer-renderer';
// import { FeatureCollection } from 'geojson';

declare const CESIUM_BASE_URL: string;
(window as any).CESIUM_BASE_URL = CESIUM_BASE_URL;

// ————————————————————————————————————————————————————————————————————————
// Cesium viewer tuned for performance
// ————————————————————————————————————————————————————————————————————————
const viewer = new Viewer("cesiumContainer", {
    animation: false,
    baseLayerPicker: false,
    timeline: false,
    infoBox: false,
    selectionIndicator: false,
    geocoder: false,
    // Render at device resolution. By default Cesium renders at CSS resolution and the browser upscales the canvas
    // on scaled displays (125%, 150%...), which blurs the cluster sprites and map labels.
    // Costs devicePixelRatio^2 more pixels to shade; set viewer.resolutionScale < 1 if the GPU struggles.
    useBrowserRecommendedResolution: false,
    // The default base layer is Bing via Cesium ion, which needs an ion token (black globe without one).
    // OSM tiles are free, but meant for light use: https://operations.osmfoundation.org/policies/tiles/
    baseLayer: new ImageryLayer(new OpenStreetMapImageryProvider({ url: "https://tile.openstreetmap.org/" }))
});

// Render on demand
viewer.scene.requestRenderMode = true;
viewer.scene.maximumRenderTimeChange = Number.POSITIVE_INFINITY;

// HUD refs
const hudZoom = document.getElementById("hudZoom")!;

// ————————————————————————————————————————————————————————————————————————
// Generate random points and fly to bbox
// ————————————————————————————————————————————————————————————————————————
const N = 100_000;
const bbox: BBox = [34.25, 29.45, 35.90, 33.35]; // avoid the poles a bit for nicer view
await flyToBbox(bbox);

const maxZoom = 18;

// Build features
const features = buildRandomPointFeatures(N, bbox);
// Vector tiles flow (lines + polygons), see docs/vector-tiles-flow.md:
// const features = [...buildRandomLineStringFeatures(N/2, bbox), ...buildRandomPolygonFeatures(N/2, bbox)]

// ————————————————————————————————————————————————————————————————————————
// Worker client: build index then serve cluster queries
// ————————————————————————————————————————————————————————————————————————
const worker = new Worker(new URL("./cluster-worker.ts", import.meta.url), { type: "module" });
const client = new ClusterWorkerClient(worker);
const cameraHandler = new CameraHandler(viewer, hudZoom, maxZoom);


// Create renderer class instance
const renderer: IRenderer = new TileRenderer(viewer, client);
// Vector tiles flow:
// const renderer: IRenderer = new VectorLayerRenderer(viewer, client);
renderer.registerRenderingResult();

client.addBuiltListener(() => {
    cameraHandler.renderForFirstTime((bbox, zoom) => renderer.requestRenderByBboxAndZoom(bbox, zoom));
});

// Build the index off-thread
// radius is in screen pixels, derived from the largest cluster sprite so bubbles don't overlap (see map-constants.ts)
client.build(features, { minPoints: 2, radius: CLUSTER_RADIUS_PX, maxZoom: maxZoom });
// Vector tiles flow:
// const featureCollection: FeatureCollection = { type: 'FeatureCollection', features };
// client.buildVectorTiles(featureCollection);

cameraHandler.setRenderingOnCameraChange((bbox, zoom) => renderer.requestRenderByBboxAndZoom(bbox, zoom));
setupZoomControls(viewer);

// Setup drill picking via extracted module
setupPicking(viewer, client, features);

async function flyToBbox(bbox: BBox): Promise<void> {
    const rect = Rectangle.fromDegrees(bbox[0], bbox[1], bbox[2], bbox[3]);
    
    return new Promise((resolve) => {
        viewer.camera.flyTo({
            destination: rect,
            duration: 1.5,
            complete: () => resolve()
        });
    });
}
