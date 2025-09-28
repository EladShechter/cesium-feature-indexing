import "cesium/Build/Cesium/Widgets/widgets.css";
import { Viewer, BillboardCollection, PointPrimitiveCollection, Rectangle } from "cesium";
import { buildRandomFeatures, buildFeatureIndex } from "./data";
import { createRenderer } from "./rendering";
import { setupPicking } from "./picking";
import type { BBox } from "./global";
import { ClusterWorkerClient } from "./cluster-worker-client";

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

// ————————————————————————————————————————————————————————————————————————
// Generate random points and fly to bbox
// ————————————————————————————————————————————————————————————————————————
const N = 100_000;
const bbox: BBox = [34.25, 29.45, 35.90, 33.35]; // avoid the poles a bit for nicer view
const rect = Rectangle.fromDegrees(bbox[0], bbox[1], bbox[2], bbox[3]);
viewer.camera.flyTo({ destination: rect, duration: 1.5 });

// Build features
const features = buildRandomFeatures(N, bbox);


// ————————————————————————————————————————————————————————————————————————
// Worker client: build index then serve cluster queries
// ————————————————————————————————————————————————————————————————————————
const worker = new Worker(new URL("./cluster-worker.ts", import.meta.url), { type: "module" });
const client = new ClusterWorkerClient(worker);


// Create renderer using extracted module
const { renderClustersForView, drawClustersAndSingles, setRenderingOnCameraChange } = createRenderer({
    viewer,
    client,
    billboardCollection,
    pointCollection,
    hudClusters,
    hudSingles,
});

client.addBuiltListener(() => {
    renderClustersForView();
});

client.addClustersListener((features) => {
    drawClustersAndSingles(features);
});

// Build the index off-thread
client.build(features, { minPoints: 2, radius: 40, maxZoom: 18 });

setRenderingOnCameraChange(viewer, client);

// Setup drill picking via extracted module
setupPicking(viewer, client, features);

// Initial render once index is built (handled in onmessage)
