import "cesium/Build/Cesium/Widgets/widgets.css";
import { Viewer, BillboardCollection, PointPrimitiveCollection, Rectangle } from "cesium";
import {
    buildRandomPointFeatures,
    buildFeatureIndex,
    buildRandomLineStringFeatures,
    buildRandomPolygonFeatures
} from "./data";
import { ClusterRenderer, IRenderer, TileRenderer } from "./rendering";
import { setupPicking } from "./picking";
import type { BBox } from "./global";
import { ClusterWorkerClient } from "./cluster-worker-client";
import { CameraHandler } from './camera-handler';

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
    geocoder: false
});

// Render on demand
viewer.scene.requestRenderMode = true;
viewer.scene.maximumRenderTimeChange = Number.POSITIVE_INFINITY;

// Collections
const billboardCollection = viewer.scene.primitives.add(new BillboardCollection());
const pointCollection = viewer.scene.primitives.add(new PointPrimitiveCollection());

// HUD refs
const hudClusters = document.getElementById("hudClusters")!;
const hudSingles = document.getElementById("hudSingles")!;
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
// const features = [...buildRandomLineStringFeatures(N/2, bbox), ...buildRandomPolygonFeatures(N/2, bbox)]

// ————————————————————————————————————————————————————————————————————————
// Worker client: build index then serve cluster queries
// ————————————————————————————————————————————————————————————————————————
const worker = new Worker(new URL("./cluster-worker.ts", import.meta.url), { type: "module" });
const client = new ClusterWorkerClient(worker);
const cameraHandler = new CameraHandler(viewer, hudZoom, maxZoom);


// Create renderer class instance
const renderer: IRenderer = new TileRenderer(
    viewer,
    client,
    billboardCollection,
    pointCollection,
    hudClusters,
    hudSingles
);
renderer.registerRenderingResult();

client.addBuiltListener(() => {
    cameraHandler.renderForFirstTime((bbox, zoom) => renderer.requestRenderByBboxAndZoom(bbox, zoom));
});

// Build the index off-thread
client.build(features, { minPoints: 2, radius: 40, maxZoom: maxZoom });

cameraHandler.setRenderingOnCameraChange((bbox, zoom) => renderer.requestRenderByBboxAndZoom(bbox, zoom));

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
