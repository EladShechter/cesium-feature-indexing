import {
    BillboardCollection,
    Cartesian3,
    PointPrimitiveCollection,
    VerticalOrigin,
    Viewer,
    Color
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
    // Cluster flow (getClusters)
    // ————————————————————————————————————————————————————————————————————————
    renderClustersForView(bbox: BBox, zoom: number) {
        this.client.clusters(bbox, zoom);
    }

    drawClustersAndSingles(features: GeoJSON.Feature<GeoJSON.Point, any>[]) {
        this.billboardCollection.removeAll();
        this.pointCollection.removeAll();

        let clusters = 0, singles = 0;

        for (const f of features) {
            const [lon, lat] = f.geometry.coordinates as [number, number];
            const pos = Cartesian3.fromDegrees(lon, lat);
            const props = f.properties || {};
            const isCluster = !!props.cluster;
            
            this.drawFeature(pos, props, (f as any).id, isCluster);
            
            if (isCluster) {
                clusters++;
            } else {
                singles++;
            }
        }

        this.updateHUD(clusters, singles);
        this.viewer.scene.requestRender();
    }

    // ————————————————————————————————————————————————————————————————————————
    // Tile flow (getTile) — for performance comparison
    // ————————————————————————————————————————————————————————————————————————
    renderTilesForView(bbox: BBox, zoom: number) {
        const tiles = this.computeCoveringTiles(bbox, zoom);
        for (const t of tiles) {
            const key = `${zoom}/${t.x}/${t.y}`;
            if (this.renderedTileKeys.has(key)) continue; // guard: already rendered/requested
            this.renderedTileKeys.add(key);
            this.client.tile(zoom, t.x, t.y);
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
            const isCluster = !!tags.cluster;
            
            this.drawFeature(pos, tags, tags?.id ?? "", isCluster);
            
            if (isCluster) {
                clusters++;
            } else {
                singles++;
            }
        }
        
        this.updateHUD(clusters, singles);
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

    private drawFeature(pos: Cartesian3, props: { point_count: number, cluster_id: string }, id: string | number, isCluster: boolean): void {
        if (isCluster) {
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

            billboard.id = {
                kind: "cluster",
                cluster_id: props.cluster_id,
                count
            };
        } else {
            const point = this.pointCollection.add({
                position: pos,
                pixelSize: 6,
                color: Color.SKYBLUE,
                disableDepthTestDistance: Number.POSITIVE_INFINITY,
            });
            point.id = {
                kind: "point",
                id: String(id)
            };
        }
    }

    private updateHUD(clusters: number, singles: number) {
        this.hudClusters.textContent = String(clusters);
        this.hudSingles.textContent = String(singles);
    }
}
