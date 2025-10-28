import { Billboard, BillboardCollection, Cartesian3, PointPrimitive, PointPrimitiveCollection, Viewer } from "cesium";
import { IRenderer } from "./renderer.interface";
import { BaseRenderer } from "./base-renderer";
import type { BBox } from "../global";
import Supercluster, { ClusterProperties } from 'supercluster';
import { ClusterWorkerClient, TileResponse } from '../cluster-worker-client';

type RenderedFeatures = { billboards: Billboard[]; points: PointPrimitive[] };
type TileStatus = {
    state: 'pending' | 'ready' | 'removed';
    onComplete?: () => void;
};

export class TileRenderer extends BaseRenderer implements IRenderer {
    private tileStatuses: Map<string, TileStatus> = new Map();
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

    requestRenderByBboxAndZoom(bbox: BBox, zoom: number): void {
        const tiles = this.computeCoveringTiles(bbox, zoom);
        console.log("Requesting tiles:", tiles, "zoom:", zoom);
        const currentTileKeys = new Set<string>();

        // Create or update status for each tile
        for (const t of tiles) {
            const key = `${zoom}/${t.x}/${t.y}`;
            currentTileKeys.add(key);
            
            if (!this.tileStatuses.has(key)) {
                this.tileStatuses.set(key, { state: 'pending' });
                this.client.tile(zoom, t.x, t.y);
            }
        }

        this.cleanupOldTiles(currentTileKeys);
    }

    registerRenderingResult(): void {
        this.client.addTileListener((tile: TileResponse) => {
            this.drawTile(tile);
        });
    }

    private cleanupOldTiles(currentTileKeys: Set<string>): void {
        const tilesToRemove = Array.from(this.tileStatuses.entries())
            .filter(([key]) => !currentTileKeys.has(key));
        
        console.log("Current tile statuses:", this.tileStatuses);
        console.log("Removing tiles:", tilesToRemove);

        for (const [tileKey, status] of tilesToRemove) {
            if (status.state === 'ready') {
                // Remove immediately if already rendered
                this.removeTile(tileKey);
            } else if (status.state === 'pending') {
                // Schedule removal when rendering completes
                status.state = 'removed';
                status.onComplete = () => this.removeTile(tileKey);
            }
        }
    }

    private removeTile(tileKey: string): void {
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

    private async drawTile(tile: { z: number; x: number; y: number; extent: number; features: Supercluster.TileFeature<any, any>[] }): Promise<void> {
        const { z, x: xTile, y: yTile, extent, features } = tile;
        const tileKey = `${z}/${xTile}/${yTile}`;
        
        // Check if this tile is still needed
        const tileStatus = this.tileStatuses.get(tileKey);
        if (!tileStatus || tileStatus.state === 'removed') {
            console.log(`Skipping rendering of removed tile: ${tileKey}`);
            return;
        }

        const renderedFeatures: RenderedFeatures = { billboards: [], points: [] };

        for (const tf of features) {
            if (tf.type !== 1) continue;
            const tags = (tf.tags || {}) as ClusterProperties;

            const { lat, lon } = this.getLatLonFromTileFeature(tf, z, xTile, yTile, extent);
            const pos = Cartesian3.fromDegrees(lon, lat);

            const billboardOrPoint = this.drawFeature(pos, tags, (tf as any).id ?? "");
            if (billboardOrPoint) {
                if (tags.cluster) {
                    renderedFeatures.billboards.push(billboardOrPoint as Billboard);
                } else {
                    renderedFeatures.points.push(billboardOrPoint as PointPrimitive);
                }
            }
        }

        if (renderedFeatures.billboards.length > 0 || renderedFeatures.points.length > 0) {
            this.renderedFeatures.set(tileKey, renderedFeatures);
            tileStatus.state = 'ready';
            // If there's a pending cleanup, execute it now
            if (tileStatus.onComplete) {
                tileStatus.onComplete();
            }
        } else {
            this.tileStatuses.delete(tileKey);
        }
        
        this.updateHUD();
        this.viewer.scene.requestRender();
    }

    private getLatLonFromTileFeature(tileFeature: Supercluster.TileFeature<any, any>, zoom: number, xTile: number, yTile: number, extent: number): {lat: number, lon: number} {
        const n = Math.pow(2, zoom);
        const g = tileFeature.geometry[0];
        const tags = (tileFeature.tags || {}) as ClusterProperties;
        const worldX = (g[0] + xTile * extent) / (extent * n);
        const worldY = (g[1] + yTile * extent) / (extent * n);
        const lon = worldX * 360 - 180;
        const lat = (Math.atan(Math.sinh(Math.PI * (1 - 2 * worldY))) * 180) / Math.PI;
        return { lat, lon };
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
