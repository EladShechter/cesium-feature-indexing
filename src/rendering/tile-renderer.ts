import { Billboard, BillboardCollection, Cartesian3, PointPrimitive, PointPrimitiveCollection, Viewer } from "cesium";
import { IRenderer } from "./renderer.interface";
import { BaseRenderer } from "./base-renderer";
import type { BBox } from "../global";
import Supercluster, { ClusterProperties } from 'supercluster';
import { ClusterWorkerClient, TileResponse } from '../cluster-worker-client';

type RenderedFeatures = { billboards: Billboard[]; points: PointPrimitive[] };
type TileStatus = {
    state: 'pending' | 'ready';
};

const MAX_MERCATOR_LAT = 85.0511287798;

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
    // Ready tiles that left the view, kept on screen until all current tiles are ready (avoids a blank flash)
    private staleTiles: Set<string> = new Set();
    
    // // Tile cache: stores raw tile data
    // private tileCache: Map<string, { data: any; timestamp: number }> = new Map();
    // // Feature cache: stores rendered features by zoom level
    // private featureCache: Map<string, { features: RenderedFeatures; timestamp: number }> = new Map();

    constructor(
        viewer: Viewer,
        client: ClusterWorkerClient,
    ) {
        super(viewer, client);
    }

    requestRenderByBboxAndZoom(bbox: BBox, zoom: number): void {
        const tiles = this.computeCoveringTiles(bbox, zoom);
        console.log("Requesting tiles:", tiles, "zoom:", zoom);
        const currentTileKeys = new Set<string>();

        // Create or update status for each tile
        for (const t of tiles) {
            const tileKey = `${zoom}/${t.x}/${t.y}`;
            currentTileKeys.add(tileKey);

            // A stale tile that came back into view is still drawn, just keep it
            this.staleTiles.delete(tileKey);

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

        // Pending tiles just lose their status, so their response is ignored by drawTile and they are
        // requested again if they come back into view. Ready tiles stay on screen as stale until the new ones are ready.
        for (const [tileKey, status] of tilesToRemove) {
            if (status.state === 'pending') {
                this.removeTile(tileKey);
            } else {
                this.staleTiles.add(tileKey);
            }
        }

        for (const key of this.renderedFeatures.keys()) {
            if (!this.tileStatuses.has(key) && !currentTileKeys.has(key)) {
                this.removeTile(key);
            }
        }

        this.removeStaleTilesWhenAllReady();
    }

    private removeStaleTilesWhenAllReady(): void {
        for (const status of this.tileStatuses.values()) {
            if (status.state === 'pending') return;
        }

        for (const tileKey of this.staleTiles) {
            this.removeTile(tileKey);
        }
        this.staleTiles.clear();
        this.updateHUD();
        this.viewer.scene.requestRender();
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
        
        // Only a pending tile is still needed (a ready one means this is a duplicate response)
        const tileStatus = this.tileStatuses.get(tileKey);
        if (tileStatus?.state !== 'pending') {
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
        }

        this.removeStaleTilesWhenAllReady();
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
            // Supercluster adds a buffer of features from neighbouring tiles (coordinates outside [0, extent)),
            // skip them so features near tile borders are drawn only once, by the tile that owns them
            if (!this.isInsideTile(tf, extent)) continue;
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

        // Empty tiles are marked ready too, so they are not requested again on every camera move
        this.renderedFeatures.set(tileKey, renderedFeatures);
        // Cache the rendered features for this zoom level
        // this.cacheFeatures(tileKey, renderedFeatures);
        this.updateTileRendered(tileKey);
    }

    private isInsideTile(tileFeature: Supercluster.TileFeature<any, any>, extent: number): boolean {
        const [px, py] = tileFeature.geometry[0];
        return px >= 0 && px < extent && py >= 0 && py < extent;
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
            // Web mercator is undefined at the poles, clamp to its latitude limit
            const clampedLat = Math.max(-MAX_MERCATOR_LAT, Math.min(MAX_MERCATOR_LAT, lat));
            const rad = (clampedLat * Math.PI) / 180;
            return Math.floor(
                ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n
            );
        }

        const clampTile = (v: number) => Math.max(0, Math.min(n - 1, v));
        const x0 = clampTile(lon2tileX(west));
        const x1 = clampTile(lon2tileX(east));
        const y0 = clampTile(lat2tileY(north));
        const y1 = clampTile(lat2tileY(south));

        // A view crossing the antimeridian has west > east, so it wraps around from x0 to x1
        const xs: number[] = [];
        if (west <= east) {
            for (let x = x0; x <= x1; x++) xs.push(x);
        } else {
            for (let x = x0; x < n; x++) xs.push(x);
            for (let x = 0; x <= x1; x++) xs.push(x);
        }

        const tiles: Array<{ x: number; y: number }> = [];
        for (const x of xs) {
            for (let y = y0; y <= y1; y++) {
                tiles.push({ x, y });
            }
        }
        return tiles;
    }
}
