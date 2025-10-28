import { Billboard, BillboardCollection, Cartesian3, PointPrimitive, PointPrimitiveCollection, Viewer } from "cesium";
import { IRenderer } from "./renderer.interface";
import { BaseRenderer } from "./base-renderer";
import type { BBox } from "../global";
import Supercluster, { ClusterProperties } from 'supercluster';
import { ClusterWorkerClient, TileResponse } from '../cluster-worker-client';

type RenderedFeatures = { billboards: Billboard[]; points: PointPrimitive[] };
type TileStatus = {
    resolve: () => void;
    reject: (reason?: any) => void;
    promise: Promise<void>;
    state: 'pending' | 'ready' | 'removed';
};

export class TileRenderer extends BaseRenderer implements IRenderer {
    private tileStatuses = new Map<string, TileStatus>();
    private renderedFeatures: Map<string, RenderedFeatures> = new Map();

    constructor(
        viewer: Viewer,
        client: ClusterWorkerClient,
        billboardCollection: BillboardCollection,
        pointCollection: PointPrimitiveCollection,
        hudClusters: HTMLElement,
        hudSingles: HTMLElement
    ) {
        super(viewer, client, billboardCollection, pointCollection, hudClusters, hudSingles);
    }

    async requestRenderByBboxAndZoom(bbox: BBox, zoom: number): Promise<void> {
        const tiles = this.computeCoveringTiles(bbox, zoom);
        console.log("Requesting tiles:", tiles, "zoom:", zoom);
        const currentTileKeys = new Set<string>();

        // Create or update status for each tile
        for (const t of tiles) {
            const key = `${zoom}/${t.x}/${t.y}`;
            currentTileKeys.add(key);
            
            if (!this.tileStatuses.has(key)) {
                // Create a new status for this tile
                let resolve: () => void;
                let reject: (reason?: any) => void;
                const promise = new Promise<void>((res, rej) => {
                    resolve = res;
                    reject = rej;
                });
                
                this.tileStatuses.set(key, {
                    resolve: resolve!,
                    reject: reject!,
                    promise,
                    state: 'pending'
                });
                
                // Request the tile data
                this.client.tile(zoom, t.x, t.y);
            }
        }

        await this.cleanupOldTiles(currentTileKeys);
    }

    registerRenderingResult(): void {
        this.client.addTileListener((tile: TileResponse) => {
            this.drawTile(tile);
        });
    }

    private async cleanupOldTiles(currentTileKeys: Set<string>): Promise<void> {
        const tilesToRemove = Array.from(this.tileStatuses.keys())
            .filter(key => !currentTileKeys.has(key));
        
        console.log("Current tile statuses:", this.tileStatuses);
        console.log("Removing tiles:", tilesToRemove);

        for (const tileKey of tilesToRemove) {
            const status = this.tileStatuses.get(tileKey);
            if (!status) continue;

            if (status.state === 'pending') {
                // Mark as removed but keep the promise to handle cleanup when it resolves
                status.state = 'removed';
                status.reject(new Error('Tile was removed before rendering completed'));
            } else if (status.state === 'ready') {
                const features = this.renderedFeatures.get(tileKey);
                if (features) {
                    for (const billboard of features.billboards) {
                        this.billboardCollection.remove(billboard);
                    }
                    for (const point of features.points) {
                        this.pointCollection.remove(point);
                    }
                    this.renderedFeatures.delete(tileKey);
                }
                this.tileStatuses.delete(tileKey);
            }
        }
    }

    private async drawTile(tile: { z: number; x: number; y: number; extent: number; features: Supercluster.TileFeature<any, any>[] }): Promise<void> {
        const { z, x: xTile, y: yTile, extent, features } = tile;
        const tileKey = `${z}/${xTile}/${yTile}`;
        
        // Check if this tile is still needed
        const tileStatus = this.tileStatuses.get(tileKey);
        if (!tileStatus || tileStatus.state === 'removed') {
            console.log(`Skipping rendering of removed tile: ${tileKey}`);
            return;
        }
        
        const n = Math.pow(2, z);
        const renderedFeatures: RenderedFeatures = { billboards: [], points: [] };

        for (const tf of features) {
            if (tf.type !== 1) continue;
            // TODO: extract the pos calculation and test it
            const g = tf.geometry[0];
            const tags = (tf.tags || {}) as ClusterProperties;
            const worldX = (g[0] + xTile * extent) / (extent * n);
            const worldY = (g[1] + yTile * extent) / (extent * n);
            const lon = worldX * 360 - 180;
            const lat = (Math.atan(Math.sinh(Math.PI * (1 - 2 * worldY))) * 180) / Math.PI;
            const pos = Cartesian3.fromDegrees(lon, lat);

            // Check again if tile was marked for removal during rendering
            if (tileStatus.state === 'removed') {
                // Clean up any already created features
                for (const billboard of renderedFeatures.billboards) {
                    this.billboardCollection.remove(billboard);
                }
                for (const point of renderedFeatures.points) {
                    this.pointCollection.remove(point);
                }
                console.log(`Aborted rendering of tile ${tileKey} (marked for removal)`);
                return;
            }

            const billboardOrPoint = this.drawFeature(pos, tags, (tf as any).id ?? "");
            if (billboardOrPoint) {
                if (tags.cluster) {
                    renderedFeatures.billboards.push(billboardOrPoint as Billboard);
                } else {
                    renderedFeatures.points.push(billboardOrPoint as PointPrimitive);
                }
            }
        }

        // Final check if tile is still needed
        if (tileStatus.state === 'removed') {
            for (const billboard of renderedFeatures.billboards) {
                this.billboardCollection.remove(billboard);
            }
            for (const point of renderedFeatures.points) {
                this.pointCollection.remove(point);
            }
            console.log(`Completed rendering of removed tile ${tileKey}, cleaned up`);
            return;
        }

        if (renderedFeatures.billboards.length > 0 || renderedFeatures.points.length > 0) {
            this.renderedFeatures.set(tileKey, renderedFeatures);
            tileStatus.state = 'ready';
            tileStatus.resolve();
        } else {
            this.tileStatuses.delete(tileKey);
        }
        
        this.updateHUD();
        this.viewer.scene.requestRender();
    }

    private computeCoveringTiles(bbox: BBox, z: number): Array<{ x: number; y: number }> {
        const [west, south, east, north] = bbox;
        const n = Math.pow(2, z);

        function lon2tileX(lon: number): number {
            return Math.floor(((lon + 180) / 360) * n);
        }

        function lat2tileY(lat: number): number {
            const rad = (lat * Math.PI) / 180;
            return Math.floor(
                ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n
            );
        }

        const x0 = lon2tileX(west);
        const y0 = lat2tileY(north);
        const x1 = lon2tileX(east);
        const y1 = lat2tileY(south);

        const tiles: Array<{ x: number; y: number }> = [];
        for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) {
            for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) {
                tiles.push({ x, y });
            }
        }
        return tiles;
    }
}
