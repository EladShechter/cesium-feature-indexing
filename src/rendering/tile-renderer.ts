import { Billboard, BillboardCollection, Cartesian3, PointPrimitive, PointPrimitiveCollection, Viewer } from "cesium";
import { IRenderer } from "./renderer.interface";
import { BaseRenderer } from "./base-renderer";
import type { BBox } from "../global";
import Supercluster, { ClusterProperties } from 'supercluster';
import { ClusterWorkerClient, TileResponse } from '../cluster-worker-client';

type RenderedFeatures = { billboards: Billboard[]; points: PointPrimitive[] };

export class TileRenderer extends BaseRenderer implements IRenderer {
    private renderedTiles: Set<string> = new Set();
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
        const currentTileKeys = new Set<string>();

        for (const t of tiles) {
            const key = `${zoom}/${t.x}/${t.y}`;
            currentTileKeys.add(key);
            if (!this.renderedTiles.has(key)) {
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
        const tilesToRemove = Array.from(this.renderedTiles)
            .filter(key => !currentTileKeys.has(key));

        for (const tileKey of tilesToRemove) {
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
            this.renderedTiles.delete(tileKey);
        }
    }

    private drawTile(tile: { z: number; x: number; y: number; extent: number; features: Supercluster.TileFeature<any, any>[] }): void {
        const { z, x: xTile, y: yTile, extent, features } = tile;
        const tileKey = `${z}/${xTile}/${yTile}`;
        
        if (this.renderedTiles.has(tileKey)) {
            return;
        }

        const n = Math.pow(2, z);
        const featureIds: RenderedFeatures = { billboards: [], points: [] };

        for (const tf of features) {
            if (tf.type !== 1) continue;
            
            const g = tf.geometry[0];
            const tags = (tf.tags || {}) as ClusterProperties;
            const worldX = (g[0] + xTile * extent) / (extent * n);
            const worldY = (g[1] + yTile * extent) / (extent * n);
            const lon = worldX * 360 - 180;
            const lat = (Math.atan(Math.sinh(Math.PI * (1 - 2 * worldY))) * 180) / Math.PI;
            const pos = Cartesian3.fromDegrees(lon, lat);

            const billboardOrPoint = this.drawFeature(pos, tags, (tf as any).id ?? "");
            if (billboardOrPoint) {
                if (tags.cluster) {
                    featureIds.billboards.push(billboardOrPoint as Billboard);
                } else {
                    featureIds.points.push(billboardOrPoint as PointPrimitive)
                }
            }
        }

        if (featureIds.billboards.length > 0 || featureIds.points.length > 0) {
            this.renderedTiles.add(tileKey);
            this.renderedFeatures.set(tileKey, featureIds);
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
