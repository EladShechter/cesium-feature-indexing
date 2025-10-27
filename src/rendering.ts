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


export class Renderer {
    private viewer: Viewer;
    private client: ClusterWorkerClient;
    private billboardCollection: BillboardCollection;
    private pointCollection: PointPrimitiveCollection;
    private hudClusters: HTMLElement;
    private hudSingles: HTMLElement;

    private merc = new WebMercatorProjection();
    private readonly R = 6378137;
    private readonly WORLD_METERS = 2 * Math.PI * this.R;
    private lastBBox?: BBox;
    private lastZoom?: number;
    private renderedTileKeys: Set<string> = new Set();

    constructor(params: {
        viewer: Viewer;
        client: ClusterWorkerClient;
        billboardCollection: BillboardCollection;
        pointCollection: PointPrimitiveCollection;
        hudClusters: HTMLElement;
        hudSingles: HTMLElement;
    }) {
        this.viewer = params.viewer;
        this.client = params.client;
        this.billboardCollection = params.billboardCollection;
        this.pointCollection = params.pointCollection;
        this.hudClusters = params.hudClusters;
        this.hudSingles = params.hudSingles;
    }

    // ————————————————————————————————————————————————————————————————————————
    // Utilities
    // ————————————————————————————————————————————————————————————————————————
    private getViewBBoxAndZoomAndShouldRender(): { bbox: BBox; zoom: number, shouldRender: boolean } {
        const { bbox, zoom } = this.viewBBoxAndZoom();
        if (this.lastZoom === zoom && this.sameBBox(this.lastBBox, bbox)) {
            return {bbox, zoom, shouldRender: false };
        }
        this.lastZoom = zoom;
        this.lastBBox = bbox.slice() as BBox;

        return { bbox, zoom, shouldRender: true }
    }

    private viewBBoxAndZoom(): { bbox: BBox; zoom: number } {
        const rect = this.viewer.camera.computeViewRectangle(this.viewer.scene.globe.ellipsoid);
        if (!rect) return { bbox: [-180, -85, 180, 85] as any, zoom: 2 };

        const west = CMath.toDegrees(rect.west);
        const south = CMath.toDegrees(rect.south);
        const east = CMath.toDegrees(rect.east);
        const north = CMath.toDegrees(rect.north);

        const xW = this.merc.project(Cartographic.fromDegrees(west, 0)).x;
        const xE = this.merc.project(Cartographic.fromDegrees(east, 0)).x;
        let width = Math.abs(xE - xW);
        if (!isFinite(width) || width <= 0) width = this.WORLD_METERS;
        let zoom = Math.round(Math.log2(this.WORLD_METERS / width));
        zoom = Math.max(0, Math.min(18, zoom));

        return { bbox: [west, south, east, north] as any, zoom };
    }

    // ————————————————————————————————————————————————————————————————————————
    // Cluster flow (getClusters)
    // ————————————————————————————————————————————————————————————————————————
    renderClustersForView() {
        const { bbox, zoom, shouldRender } = this.getViewBBoxAndZoomAndShouldRender();
        if (!shouldRender) {
            return; // guard: no change
        }
        this.client.clusters(bbox, zoom);
    }

    drawClustersAndSingles(features: GeoJSON.Feature<GeoJSON.Point, any>[]) {
        this.billboardCollection.removeAll();
        this.pointCollection.removeAll();

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

                const billboard = this.billboardCollection.add({
                    position: pos,
                    image: sprite,
                    verticalOrigin: VerticalOrigin.CENTER,
                    disableDepthTestDistance: Number.POSITIVE_INFINITY,
                });

                billboard.id = { kind: "cluster", cluster_id: props.cluster_id, count };
            } else {
                singles++;
                const id: string = String((f as any).id);
                const point = this.pointCollection.add({
                    position: pos,
                    pixelSize: 6,
                    color: (window as any).Cesium?.Color?.SKYBLUE ?? undefined,
                    disableDepthTestDistance: Number.POSITIVE_INFINITY,
                });
                point.id = { kind: "point", id };
            }
        }

        this.hudClusters.textContent = String(clusters);
        this.hudSingles.textContent = String(singles);

        this.viewer.scene.requestRender();
    }

    setRenderingOnCameraChange() {
        let lastRefresh = 0;
        const THROTTLE_MS = 100;

        this.viewer.camera.changed.addEventListener(() => {
            if (!this.client.isIndexBuilt()) return;
            const now = performance.now();
            if (now - lastRefresh >= THROTTLE_MS) {
                lastRefresh = now;
                this.renderClustersForView();
            }
        });

        let renderTimeout: number;
        this.viewer.camera.moveEnd.addEventListener(() => {
            if (renderTimeout) clearTimeout(renderTimeout);
            renderTimeout = setTimeout(() => this.renderClustersForView(), THROTTLE_MS);
        });
    }

    // ————————————————————————————————————————————————————————————————————————
    // Tile flow (getTile) — for performance comparison
    // ————————————————————————————————————————————————————————————————————————
    renderTilesForView() {
        const { bbox, zoom, shouldRender } = this.getViewBBoxAndZoomAndShouldRender();
        if (!shouldRender) {
            return; // guard: no change
        }
        const z = zoom;
        const tiles = this.computeCoveringTiles(bbox, z);
        for (const t of tiles) {
            const key = `${z}/${t.x}/${t.y}`;
            if (this.renderedTileKeys.has(key)) continue; // guard: already rendered/requested
            this.renderedTileKeys.add(key);
            this.client.tile(z, t.x, t.y);
        }
    }

    drawTile(tile: { z: number; x: number; y: number; extent: number; features: any[] }) {
        // Note: We do NOT clear collections here; tiles are incremental. Caller may clear if desired.
        const { z, x: xTile, y: yTile, extent, features } = tile;
        let clusters = 0, singles = 0;
        const n = Math.pow(2, z);

        for (const tf of features) {
            if ((tf as any).type !== 1) continue; // only points
            const g = (tf as any).geometry as [number, number];
            const tags = (tf as any).tags || {};
            const worldX = (g[0] + xTile * extent) / (extent * n);
            const worldY = (g[1] + yTile * extent) / (extent * n);
            const lon = worldX * 360 - 180;
            const lat = (Math.atan(Math.sinh(Math.PI * (1 - 2 * worldY))) * 180) / Math.PI;
            const pos = Cartesian3.fromDegrees(lon, lat);

            if (tags.cluster) {
                clusters++;
                const count: number = tags.point_count;
                const size = sizeForCount(count);
                const color = colorForCount(count);
                const text = formatCount(count);
                const sprite = makeClusterSprite(size, color, text);
                const billboard = this.billboardCollection.add({
                    position: pos,
                    image: sprite,
                    verticalOrigin: VerticalOrigin.CENTER,
                    disableDepthTestDistance: Number.POSITIVE_INFINITY,
                });
                billboard.id = { kind: "cluster", cluster_id: tags.cluster_id, count };
            } else {
                singles++;
                const id: string = String(tags?.id ?? "");
                const point = this.pointCollection.add({
                    position: pos,
                    pixelSize: 6,
                    color: (window as any).Cesium?.Color?.SKYBLUE ?? undefined,
                    disableDepthTestDistance: Number.POSITIVE_INFINITY,
                });
                point.id = { kind: "point", id };
            }
        }

        // Optional HUD update accumulative; kept simple here
        // Consumers can clear and reset HUD counters around tile draws if needed
        this.viewer.scene.requestRender();
    }

    private computeCoveringTiles(bbox: BBox, z: number): Array<{ x: number; y: number }> {
        const [west, south, east, north] = bbox;
        const n = Math.pow(2, z);

        function lon2tileX(lon: number) {
            return Math.floor(((lon + 180) / 360) * n);
        }
        function lat2tileY(lat: number) {
            const rad = (lat * Math.PI) / 180;
            return Math.floor(
                ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n
            );
        }

        let x0 = lon2tileX(west);
        let x1 = lon2tileX(east);
        let y0 = lat2tileY(north);
        let y1 = lat2tileY(south);

        x0 = Math.max(0, Math.min(n - 1, x0));
        x1 = Math.max(0, Math.min(n - 1, x1));
        y0 = Math.max(0, Math.min(n - 1, y0));
        y1 = Math.max(0, Math.min(n - 1, y1));

        const tiles: Array<{ x: number; y: number }> = [];
        for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) {
            for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) {
                tiles.push({ x, y });
            }
        }
        return tiles;
    }

    private sameBBox(a?: BBox, b?: BBox, eps = 1e-7): boolean {
        if (!a || !b) return false;
        return (
            Math.abs(a[0] - b[0]) < eps &&
            Math.abs(a[1] - b[1]) < eps &&
            Math.abs(a[2] - b[2]) < eps &&
            Math.abs(a[3] - b[3]) < eps
        );
    }
}
