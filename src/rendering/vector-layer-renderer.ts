import {
    CallbackProperty,
    Cartesian3,
    Color,
    ColorMaterialProperty,
    CustomDataSource,
    DataSource,
    Entity,
    HeightReference,
    PointGraphics,
    PolygonGraphics,
    PolygonHierarchy,
    PolylineGraphics,
    Viewer
} from "cesium";
import { ClusterWorkerClient } from "../cluster-worker-client";
import { IVectorLayerRenderer, VectorLayerStyle } from "./renderer.interface";
import { getTileKey, getTilesInBbox } from "./tile-utils";
import type { BBox } from "../global";
import { Feature, FeatureCollection, Geometry, LineString, Polygon } from 'geojson';

interface CachedTile {
    entities: Entity[];
    timestamp: number;
}

export class VectorLayerRenderer implements IVectorLayerRenderer {
    private readonly viewer: Viewer;
    private readonly client: ClusterWorkerClient;
    private readonly tileCache: Map<string, CachedTile> = new Map();
    private vectorLayersDS!: DataSource;
    private currentTiles: Set<string> = new Set();
    private style: VectorLayerStyle = {} as VectorLayerStyle;
    private minZoom: number = 0;
    private maxZoom: number = 24;
    // private currentZoom: number = 0;
    private data: FeatureCollection<Geometry> | null = null;
    private cleanupCallbacks: (() => void)[] = [];

    constructor(viewer: Viewer, client: ClusterWorkerClient) {
        this.viewer = viewer;
        this.client = client;

        this.viewer.dataSources.add(new CustomDataSource('vector-layers-ds')).then(ds => {
            this.vectorLayersDS = ds;
        });

        // Setup cleanup on destroy
        this.cleanupCallbacks.push(() => {
            this.viewer.dataSources.remove(this.vectorLayersDS);
            this.tileCache.clear();
            this.currentTiles.clear();
        });
    }

    // setStyle(style: VectorLayerStyle): void {
    //     this.style = { ...this.style, ...style };
    //     this.refresh();
    // }
    //
    // setZoomRange(minZoom: number, maxZoom: number): void {
    //     this.minZoom = minZoom;
    //     this.maxZoom = maxZoom;
    //     this.refresh();
    // }

    requestRenderByBboxAndZoom(bbox: BBox, zoom: number): void {
        if (zoom < this.minZoom || zoom > this.maxZoom || !this.data) {
            this.clearTiles();
            return;
        }

        // this.currentZoom = zoom;
        const tiles = getTilesInBbox(bbox, zoom);
        const newTiles = new Set<string>();

        // Request new tiles
        for (const tile of tiles) {
            const tileKey = getTileKey(tile.x, tile.y, tile.z);
            newTiles.add(tileKey);

            if (!this.tileCache.has(tileKey)) {
                this.client.getVectorTile(tile.z, tile.x, tile.y);
            } else {
                // Update timestamp for LRU cache
                const cached = this.tileCache.get(tileKey)!;
                this.tileCache.set(tileKey, {
                    ...cached,
                    timestamp: Date.now()
                });
            }
        }

        // Remove old tiles
        this.cleanupOldTiles(newTiles);
        this.currentTiles = newTiles;
    }

    registerRenderingResult(): void {
        this.client.addVectorTileListener(({ z, x, y, features }) => {
            const tileKey = getTileKey(x, y, z);

            // Skip if we're no longer interested in this tile
            if (!this.currentTiles.has(tileKey)) return;

            // Clear existing entities for this tile
            const existing = this.tileCache.get(tileKey);
            if (existing) {
                existing.entities.forEach(e => this.vectorLayersDS.entities.remove(e));
            }

            // Create new entities
            const entities = features.map(feature => this.createEntity(feature));

            // Add to the scene
            const entitiesOnMap = entities.map(e => this.vectorLayersDS.entities.add(e));

            // Cache the new entities
            this.tileCache.set(tileKey, {
                entities: entitiesOnMap,
                timestamp: Date.now()
            });
        });
    }

    destroy(): void {
        this.cleanupCallbacks.forEach(cb => cb());
        this.cleanupCallbacks = [];
    }

    private createEntity(feature: Feature<Geometry>): Entity.ConstructorOptions {
        const entity: Entity.ConstructorOptions = {
            id: feature.id?.toString(),
            properties: feature.properties ?? {}
        };

        const style = this.getFeatureStyle(feature);

        switch (feature.geometry.type) {
            case 'Polygon':
                entity.polygon = new PolygonGraphics({
                    hierarchy: new CallbackProperty(() => this.convertToHierarchy(feature.geometry as Polygon), false),
                    material: new ColorMaterialProperty(Color.fromCssColorString(style.fillColor) || Color.WHITE.withAlpha(0.5)),
                    outline: true,
                    outlineColor: Color.fromCssColorString(style.strokeColor) || Color.WHITE,
                    outlineWidth: style.strokeWidth || 1,
                    heightReference: HeightReference.CLAMP_TO_GROUND
                });
                break;

            case 'LineString':
                entity.polyline = new PolylineGraphics({
                    positions: new CallbackProperty(() => this.convertToPositions(feature.geometry as LineString), false),
                    material: new ColorMaterialProperty(Color.fromCssColorString(style.strokeColor) || Color.WHITE),
                    width: style.strokeWidth || 1,
                    clampToGround: true
                });
                break;

            case 'Point':
                entity.point = new PointGraphics({
                    pixelSize: style.pointRadius || 5,
                    color: new ColorMaterialProperty(Color.fromCssColorString(style.fillColor) || Color.WHITE),
                    outlineColor: new ColorMaterialProperty(Color.fromCssColorString(style.strokeColor) || Color.BLACK),
                    outlineWidth: 1,
                    heightReference: HeightReference.CLAMP_TO_GROUND
                });
                // Set position for point
                const coords = feature.geometry.coordinates;
                entity.position = Cartesian3.fromDegrees(coords[0], coords[1]);
                break;
        }

        return entity;
    }

    private convertToHierarchy(geometry: Polygon): PolygonHierarchy {
        const [exterior, ...holes] = geometry.coordinates;
        return new PolygonHierarchy(
            Cartesian3.fromDegreesArray(exterior.flat() as [number, number]),
            holes.map(hole => new PolygonHierarchy(Cartesian3.fromDegreesArray(hole.flat() as [number, number])))
        );
    }

    private convertToPositions(geometry: LineString): Cartesian3[] {
        return Cartesian3.fromDegreesArray(geometry.coordinates.flat() as [number, number]);
    }

    private getFeatureStyle(feature: Feature<Geometry>): VectorLayerStyle {
        return {
            fillColor: this.style.fillColor || '#ffffff',
            strokeColor: this.style.strokeColor || '#000000',
            strokeWidth: this.style.strokeWidth || 1,
            opacity: this.style.opacity || 1,
            pointRadius: this.style.pointRadius || 5
        };
    }

    private cleanupOldTiles(currentTiles: Set<string>): void {
        // Remove tiles that are no longer needed
        for (const tileKey of this.currentTiles) {
            if (!currentTiles.has(tileKey)) {
                const cached = this.tileCache.get(tileKey);
                if (cached) {
                    cached.entities.forEach(e => this.vectorLayersDS.entities.remove(e));
                    this.tileCache.delete(tileKey);
                }
            }
        }
    }

    private clearTiles(): void {
        this.vectorLayersDS.entities.removeAll();
        this.tileCache.clear();
        this.currentTiles.clear();
    }

    // private refresh(): void {
    //     if (this.viewer && this.data) {
    //         const camera = this.viewer.camera;
    //         const rectangle = camera.computeViewRectangle();
    //         if (rectangle) {
    //             const bbox: BBox = [
    //                 CesiumMath.toDegrees(rectangle.west),
    //                 CesiumMath.toDegrees(rectangle.south),
    //                 CesiumMath.toDegrees(rectangle.east),
    //                 CesiumMath.toDegrees(rectangle.north)
    //             ];
    //             this.requestRenderByBboxAndZoom(bbox, this.currentZoom);
    //         }
    //     }
    // }
}
