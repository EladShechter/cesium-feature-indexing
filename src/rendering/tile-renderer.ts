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

// Cache configuration
// const CACHE_CONFIG = {
//     // Maximum number of tiles to cache
//     MAX_TILE_CACHE_SIZE: 100,
//     // Maximum number of rendered features to cache per zoom level
//     MAX_FEATURES_CACHE_SIZE: 30,
//     // Time in ms after which a tile is considered stale
//     TILE_STALE_TIME: 5 * 60 * 1000 // 5 minutes
// };

export class TileRenderer extends BaseRenderer implements IRenderer {
    private tileStatuses: Map<string, TileStatus> = new Map();
    private renderedFeatures: Map<string, RenderedFeatures> = new Map();
    
    // // Tile cache: stores raw tile data
    // private tileCache: Map<string, { data: any; timestamp: number }> = new Map();
    // // Feature cache: stores rendered features by zoom level
    // private featureCache: Map<string, { features: RenderedFeatures; timestamp: number }> = new Map();

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
            const tileKey = `${zoom}/${t.x}/${t.y}`;
            currentTileKeys.add(tileKey);

            // Skip if already processing or rendered
            if (this.tileStatuses.has(tileKey)) {
                continue;
            }

            // Check feature cache first
            // const cachedFeatures = this.getCachedFeatures(tileKey);
            // if (cachedFeatures) {
            //     console.log(`Using cached features for ${tileKey}`);
            //     const features: RenderedFeatures = { billboards: [], points: [] }
            //     for (const billboard of cachedFeatures.billboards) {
            //         features.billboards.push(this.billboardCollection.add(billboard));
            //     }
            //     for (const point of cachedFeatures.points) {
            //         features.points.push(this.pointCollection.add(point));
            //     }
            //
            //     this.renderedFeatures.set(tileKey, cachedFeatures);
            //     this.updateTileRendered(tileKey);
            //     continue;
            // }

            // Check tile cache
            // const cachedTile = this.tileCache.get(tileKey);
            // if (cachedTile && (Date.now() - cachedTile.timestamp) < CACHE_CONFIG.TILE_STALE_TIME) {
            //     console.log(`Using cached tile data for ${tileKey}`);
            //     this.tileStatuses.set(tileKey, { state: 'pending' });
            //     // Process the cached tile data immediately
            //     this.processTileFeatures(
            //         tileKey,
            //         cachedTile.data.features,
            //         zoom,
            //         t.x,
            //         t.y,
            //         cachedTile.data.extent
            //     );
            //     continue;
            // }

            // If not in any cache, request from web worker
            this.tileStatuses.set(tileKey, { state: 'pending' });
            this.client.tile(zoom, t.x, t.y);
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
                const originalOnComplete = status.onComplete;
                status.state = 'removed';
                status.onComplete = () => {
                    this.removeTile(tileKey);
                    originalOnComplete?.();
                };
            }
        }

        for (const key of this.renderedFeatures.keys()) {
            if (!this.tileStatuses.has(key) && !currentTileKeys.has(key)) {
                this.removeTile(key);
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

    private drawTile(tile: { z: number; x: number; y: number; extent: number; features: Supercluster.TileFeature<any, any>[] }): void {
        const { z, x: xTile, y: yTile, extent, features } = tile;
        const tileKey = `${z}/${xTile}/${yTile}`;
        
        // Check if this tile is still needed
        const tileStatus = this.tileStatuses.get(tileKey);
        if (!tileStatus || tileStatus.state === 'removed') {
            console.log(`Skipping rendering of removed tile: ${tileKey}`);
            return;
        }

        // // Cache the tile data
        // this.tileCache.set(tileKey, {
        //     data: { z, x: xTile, y: yTile, extent, features },
        //     timestamp: Date.now()
        // });
        // this.cleanupTileCache();

        // Process the features
        this.processTileFeatures(tileKey, features, z, xTile, yTile, extent);
    }

    private updateTileRendered(tileKey: string): void {
        const tileStatus = this.tileStatuses.get(tileKey);
        if (tileStatus) {
            tileStatus.state = 'ready';
            // If there's a pending cleanup, execute it now
            if (tileStatus.onComplete) {
                tileStatus.onComplete();
            }
        }

        this.updateHUD();
        this.viewer.scene.requestRender();
    }

    private processTileFeatures(
        tileKey: string, 
        features: Supercluster.TileFeature<any, any>[],
        z: number,
        xTile: number,
        yTile: number,
        extent: number
    ): void {
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
            // Cache the rendered features for this zoom level
            // this.cacheFeatures(tileKey, renderedFeatures);
            this.updateTileRendered(tileKey);
        } else {
            this.tileStatuses.delete(tileKey);
        }
    }


    // private getCachedFeatures(tileKey: string): RenderedFeatures | null {
    //     const cached = this.featureCache.get(tileKey);
    //     if (!cached) return null;
    //
    //     // Update the timestamp to mark as recently used
    //     cached.timestamp = Date.now();
    //     return cached.features;
    // }
    //
    // private cacheFeatures(tileKey: string, features: RenderedFeatures): void {
    //     this.featureCache.set(tileKey, {
    //         features,
    //         timestamp: Date.now()
    //     });
    //
    //     this.cleanupFeatureCache();
    // }
    //
    // private cleanupFeatureCache() {
    //     // Clean up if we exceed the cache size
    //     if (this.featureCache.size > CACHE_CONFIG.MAX_FEATURES_CACHE_SIZE) {
    //         // Convert to array, sort by timestamp (oldest first), and remove the oldest entries
    //         const entries = Array.from(this.featureCache.entries())
    //             .sort((a, b) => a[1].timestamp - b[1].timestamp);
    //
    //         // Remove oldest entries until we're under the limit
    //         while (this.featureCache.size > CACHE_CONFIG.MAX_FEATURES_CACHE_SIZE * 0.9) {
    //             const [key] = entries.shift()!;
    //             this.featureCache.delete(key);
    //         }
    //     }
    // }
    //
    // private cleanupTileCache(): void {
    //     if (this.tileCache.size <= CACHE_CONFIG.MAX_TILE_CACHE_SIZE) {
    //         return;
    //     }
    //
    //     // Convert to array and sort by timestamp (oldest first)
    //     const entries = Array.from(this.tileCache.entries())
    //         .sort((a, b) => a[1].timestamp - b[1].timestamp);
    //
    //     // Remove oldest entries until we're under the limit
    //     while (this.tileCache.size > CACHE_CONFIG.MAX_TILE_CACHE_SIZE * 0.9) { // Keep 90% of max size
    //         const [key] = entries.shift()!;
    //         this.tileCache.delete(key);
    //     }
    // }


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
