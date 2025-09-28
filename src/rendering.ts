import {
    BillboardCollection,
    Cartesian3,
    Cartographic,
    Math as CMath,
    PointPrimitiveCollection,
    VerticalOrigin,
    Viewer,
    WebMercatorProjection,
} from "cesium";
import { colorForCount, formatCount, makeClusterSprite, sizeForCount } from "./sprite-cache";
import type { BBox } from "./global";
import { ClusterWorkerClient } from "./cluster-worker-client";


export function createRenderer(params: {
    viewer: Viewer;
    client: ClusterWorkerClient;
    billboardCollection: BillboardCollection;
    pointCollection: PointPrimitiveCollection;
    hudClusters: HTMLElement;
    hudSingles: HTMLElement;
}) {
    const { viewer, client, billboardCollection, pointCollection, hudClusters, hudSingles } = params;

    // ————————————————————————————————————————————————————————————————————————
    // Utilities to compute bbox + integer zoom from current view
    // ————————————————————————————————————————————————————————————————————————
    const R = 6378137;
    const WORLD_METERS = 2 * Math.PI * R;
    const merc = new WebMercatorProjection();

    function viewBBoxAndZoom(): { bbox: BBox; zoom: number } {
        const rect = viewer.camera.computeViewRectangle(viewer.scene.globe.ellipsoid);
        if (!rect) return { bbox: [-180, -85, 180, 85], zoom: 2 } as any;

        const west = CMath.toDegrees(rect.west);
        const south = CMath.toDegrees(rect.south);
        const east = CMath.toDegrees(rect.east);
        const north = CMath.toDegrees(rect.north);

        // meters in web mercator horizontally → zoom ≈ log2(world / width)
        const xW = merc.project(Cartographic.fromDegrees(west, 0)).x;
        const xE = merc.project(Cartographic.fromDegrees(east, 0)).x;
        let width = Math.abs(xE - xW);
        if (!isFinite(width) || width <= 0) width = WORLD_METERS;
        let zoom = Math.round(Math.log2(WORLD_METERS / width));
        zoom = Math.max(0, Math.min(18, zoom));

        return { bbox: [west, south, east, north] as any, zoom };
    }

    // ————————————————————————————————————————————————————————————————————————
    // Render: ask worker for clusters then draw them
    // ————————————————————————————————————————————————————————————————————————

    function renderClustersForView() {
        const { bbox, zoom } = viewBBoxAndZoom();
        client.clusters(bbox, zoom);
    }

    function drawClustersAndSingles(features: GeoJSON.Feature<GeoJSON.Point, any>[]) {
        billboardCollection.removeAll();
        pointCollection.removeAll();

        let clusters = 0,
            singles = 0;

        for (const f of features) {
            const [lon, lat] = f.geometry.coordinates as [number, number];
            const pos = Cartesian3.fromDegrees(lon, lat);
            const props = f.properties || {};

            if (props.cluster) {
                clusters++;
                const count: number = props.point_count;
                const size = sizeForCount(count);
                const color = colorForCount(count);
                const text = formatCount(count);
                const sprite = makeClusterSprite(size, color, text);

                const billboard = billboardCollection.add({
                    position: pos,
                    image: sprite,
                    verticalOrigin: VerticalOrigin.CENTER,
                    disableDepthTestDistance: Number.POSITIVE_INFINITY,
                });

                billboard.id = { kind: "cluster", cluster_id: props.cluster_id, count };
            } else {
                singles++;
                const id: string = String((f as any).id);
                const point = pointCollection.add({
                    position: pos,
                    pixelSize: 6,
                    color: (window as any).Cesium?.Color?.SKYBLUE ?? undefined, // optional; Cesium's default is fine
                    disableDepthTestDistance: Number.POSITIVE_INFINITY,
                });
                point.id = { kind: "point", id };
            }
        }

        hudClusters.textContent = String(clusters);
        hudSingles.textContent = String(singles);

        // render-on-demand: request a single frame
        viewer.scene.requestRender();
    }

    function setRenderingOnCameraChange(viewer: Viewer, clusterClient: ClusterWorkerClient) {
        // Recluster while camera moves (throttled) and once at the end
        let lastRefresh = 0;
        const THROTTLE_MS = 100; // adjust as needed

        viewer.camera.changed.addEventListener(() => {
            if (!clusterClient.isIndexBuilt()) return;
            const now = performance.now();
            if (now - lastRefresh >= THROTTLE_MS) {
                lastRefresh = now;
                renderClustersForView();
            }
        });

        let renderTimeout: number;
        viewer.camera.moveEnd.addEventListener(() => {
            if (renderTimeout) clearTimeout(renderTimeout);
            renderTimeout = setTimeout(renderClustersForView, THROTTLE_MS);
        });
    }

    return { renderClustersForView, drawClustersAndSingles, setRenderingOnCameraChange };
}
