import {
    BillboardCollection,
    Cartesian3,
    PointPrimitiveCollection,
    VerticalOrigin,
    Viewer,
    Color,
} from "cesium";

type RenderedTile = { x: number; y: number; z: number };
type RenderedFeatures = { billboards: string[]; points: string[] };
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

    private renderedTiles: Map<string, RenderedTile> = new Map();
    private renderedFeatures: Map<string, RenderedFeatures> = new Map();

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

    registerDrawingCluster() {
        this.client.addClustersListener((features) => {
            this.drawClustersAndSingles(features);
        });
    }

    private drawClustersAndSingles(features: GeoJSON.Feature<GeoJSON.Point, any>[]) {
        this.billboardCollection.removeAll();
        this.pointCollection.removeAll();

        for (const f of features) {
            const [lon, lat] = f.geometry.coordinates as [number, number];
            const pos = Cartesian3.fromDegrees(lon, lat);
            const props = f.properties || {};
            const isCluster = !!props.cluster;

            this.drawFeature(pos, props, (f as any).id, isCluster);
        }

        this.updateHUD();
        this.viewer.scene.requestRender();
    }

    // ————————————————————————————————————————————————————————————————————————
    // Tile flow (getTile) — for performance comparison
    // ————————————————————————————————————————————————————————————————————————
    renderTilesForView(bbox: BBox, zoom: number) {
        const tiles = this.computeCoveringTiles(bbox, zoom);
        const currentTileKeys = new Set<string>();

        for (const t of tiles) {
            const key = `${zoom}/${t.x}/${t.y}`;
            currentTileKeys.add(key);
            if (!this.renderedTiles.has(key)) {
                this.client.tile(zoom, t.x, t.y);
            }
        }

        // Clean up any tiles that are no longer in view
        this.cleanupOldTiles(currentTileKeys);
    }

    registerDrawingTiles() {
        this.client.addTileListener((tile) => {
            this.drawTile(tile);
        });
    }

    private cleanupOldTiles(currentTileKeys: Set<string>) {
        // Find tiles that are no longer needed
        const tilesToRemove = Array.from(this.renderedTiles.keys())
            .filter(key => !currentTileKeys.has(key));

        // Remove billboards and points for old tiles
        for (const tileKey of tilesToRemove) {
            const features = this.renderedFeatures.get(tileKey);
            if (features) {
                // Remove billboards
                for (const id of features.billboards) {
                    // @ts-ignore - getById is not in the type definition but exists in Cesium
                    const billboard = this.billboardCollection.getById(id);
                    if (billboard) {
                        this.billboardCollection.remove(billboard);
                    }
                }
                // Remove points
                for (const id of features.points) {
                    // @ts-ignore - getById is not in the type definition but exists in Cesium
                    const point = this.pointCollection.getById(id);
                    if (point) {
                        this.pointCollection.remove(point);
                    }
                }
                this.renderedFeatures.delete(tileKey);
            }
            this.renderedTiles.delete(tileKey);
        }
    }

    private drawTile(tile: { z: number; x: number; y: number; extent: number; features: any[] }) {
        const { z, x: xTile, y: yTile, extent, features } = tile;
        const tileKey = `${z}/${xTile}/${yTile}`;

        // Skip if this tile is already rendered
        if (this.renderedTiles.has(tileKey)) {
            return;
        }

        const n = Math.pow(2, z);
        const featureIds: RenderedFeatures = { billboards: [], points: [] };

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

            const id = this.drawFeature(pos, tags, tags?.id ?? "", isCluster);
            if (id) {
                if (isCluster) {
                    featureIds.billboards.push(id);
                } else {
                    featureIds.points.push(id);
                }
            }
        }

        // Store the rendered features for this tile
        if (featureIds.billboards.length > 0 || featureIds.points.length > 0) {
            this.renderedTiles.set(tileKey, {x: xTile, y: yTile, z});
            this.renderedFeatures.set(tileKey, featureIds);
        }

        this.updateHUD();
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

    private drawFeature(pos: Cartesian3, props: { point_count: number, cluster_id: string }, id: string | number, isCluster: boolean): string | null {
        try {
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

                const billboardId = `b_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                billboard.id = {
                    kind: "cluster",
                    cluster_id: props.cluster_id,
                    count,
                    _internalId: billboardId
                };
                return billboardId;
            } else {
                const point = this.pointCollection.add({
                    position: pos,
                    pixelSize: 6,
                    color: Color.SKYBLUE,
                    disableDepthTestDistance: Number.POSITIVE_INFINITY,
                });
                const pointId = `p_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                point.id = {
                    kind: "point",
                    id: String(id),
                    _internalId: pointId
                };
                return pointId;
            }
        } catch (error) {
            console.error("Error drawing feature:", error);
            return null;
        }
    }

    private updateHUD() {
        this.hudClusters.textContent = String(this.billboardCollection.length);
        this.hudSingles.textContent = String(this.pointCollection.length);
    }
}
