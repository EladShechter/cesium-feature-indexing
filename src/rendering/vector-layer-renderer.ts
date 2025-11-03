import { Color, Entity, EntityCollection, Viewer, PolygonHierarchy, Cartesian3, ColorMaterialProperty, CallbackProperty, PolygonGraphics, PolylineGraphics, PointGraphics, HeightReference, Math as CesiumMath } from "cesium";
import { ClusterWorkerClient } from "../cluster-worker-client";
import { IVectorLayerRenderer, VectorLayerStyle } from "./renderer.interface";
import { getTilesInBbox, tileToRectangle, getTileKey } from "./tile-utils";
import type { BBox } from "../global";
import type { Feature, FeatureCollection, Geometry } from 'geojson';

interface CachedTile {
    entities: Entity[];
    timestamp: number;
}

export class VectorLayerRenderer implements IVectorLayerRenderer {
    private readonly viewer: Viewer;
    private readonly client: ClusterWorkerClient;
    private readonly entityCollection: EntityCollection;
    private readonly tileCache: Map<string, CachedTile> = new Map();
    private currentTiles: Set<string> = new Set();
    private style: VectorLayerStyle = {};
    private minZoom: number = 0;
    private maxZoom: number = 24;
    private currentZoom: number = 0;
    private data: FeatureCollection<Geometry> | null = null;
    private cleanupCallbacks: (() => void)[] = [];

    constructor(viewer: Viewer, client: ClusterWorkerClient) {
        this.viewer = viewer;
        this.client = client;
        this.entityCollection = new EntityCollection();
        this.viewer.entities.add(this.entityCollection);

        // Setup cleanup on destroy
        this.cleanupCallbacks.push(() => {
            this.viewer.entities.remove(this.entityCollection);
            this.tileCache.clear();
            this.currentTiles.clear();
        });

        // Register event handlers
        this.setupEventHandlers();
    }

    loadData(data: FeatureCollection<Geometry>): void {
        this.data = data;
        this.client.buildVectorTiles(data);
        this.refresh();
    }

    setStyle(style: VectorLayerStyle): void {
        this.style = { ...this.style, ...style };
        this.refresh();
    }

    setZoomRange(minZoom: number, maxZoom: number): void {
        this.minZoom = minZoom;
        this.maxZoom = maxZoom;
        this.refresh();
    }

    requestRenderByBboxAndZoom(bbox: BBox, zoom: number): void {
        if (zoom < this.minZoom || zoom > this.maxZoom || !this.data) {
            this.clearTiles();
            return;
        }

        this.currentZoom = zoom;
        const tiles = getTilesInBbox(bbox, zoom);
        const newTiles = new Set<string>();

        // Request new tiles
        for (const tile of tiles) {
            const tileKey = getTileKey(tile.x, tile.y, tile.z);
            newTiles.add(tileKey);

            if (!this.tileCache.has(tileKey)) {
                this.requestTile(tile.x, tile.y, tile.z);
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
        // Implementation for handling rendering callbacks
    }

    destroy(): void {
        this.cleanupCallbacks.forEach(cb => cb());
        this.cleanupCallbacks = [];
    }

    private setupEventHandlers(): void {
        // Handle vector tile responses
        this.client.addVectorTileListener(({ z, x, y, features }) => {
            const tileKey = getTileKey(x, y, z);
            
            // Skip if we're no longer interested in this tile
            if (!this.currentTiles.has(tileKey)) return;

            // Clear existing entities for this tile
            const existing = this.tileCache.get(tileKey);
            if (existing) {
                existing.entities.forEach(e => this.entityCollection.remove(e));
            }

            // Create new entities
            const entities = features.map(feature => this.createEntity(feature));
            
            // Cache the new entities
            this.tileCache.set(tileKey, {
                entities,
                timestamp: Date.now()
            });

            // Add to the scene
            entities.forEach(e => this.entityCollection.add(e));
        });
    }

    private createEntity(feature: Feature<Geometry>): Entity {
        const entity = new Entity({
            id: feature.id?.toString(),
            properties: feature.properties
        });

        const style = this.getFeatureStyle(feature);

        switch (feature.geometry.type) {
            case 'Polygon':
            case 'MultiPolygon':
                entity.polygon = new PolygonGraphics({
                    hierarchy: new CallbackProperty(() => this.convertToHierarchy(feature.geometry), false),
                    material: new ColorMaterialProperty(style.fillColor || Color.WHITE.withAlpha(0.5)),
                    outline: true,
                    outlineColor: style.strokeColor || Color.WHITE,
                    outlineWidth: style.strokeWidth || 1,
                    heightReference: HeightReference.CLAMP_TO_GROUND
                });
                break;

            case 'LineString':
            case 'MultiLineString':
                entity.polyline = new PolylineGraphics({
                    positions: new CallbackProperty(() => this.convertToPositions(feature.geometry), false),
                    material: new ColorMaterialProperty(style.strokeColor || Color.WHITE),
                    width: style.strokeWidth || 1,
                    clampToGround: true
                });
                break;

            case 'Point':
            case 'MultiPoint':
                entity.point = new PointGraphics({
                    pixelSize: style.pointRadius || 5,
                    color: new ColorMaterialProperty(style.fillColor || Color.WHITE),
                    outlineColor: new ColorMaterialProperty(style.strokeColor || Color.BLACK),
                    outlineWidth: 1,
                    heightReference: HeightReference.CLAMP_TO_GROUND
                });
                // Set position for point
                const coords = feature.geometry.type === 'Point' 
                    ? feature.geometry.coordinates 
                    : feature.geometry.coordinates[0];
                entity.position = Cartesian3.fromDegrees(coords[0], coords[1]);
                break;
        }

        return entity;
    }

    private convertToHierarchy(geometry: Geometry): PolygonHierarchy {
        // Implementation to convert GeoJSON geometry to Cesium PolygonHierarchy
        // This is a simplified version - you'll need to handle all geometry types
        if (geometry.type === 'Polygon') {
            const [exterior, ...holes] = geometry.coordinates;
            return new PolygonHierarchy(
                Cartesian3.fromDegreesArray(exterior.flat() as [number, number]),
                holes.map(hole => new PolygonHierarchy(Cartesian3.fromDegreesArray(hole.flat() as [number, number])))
            );
        }
        // Add support for MultiPolygon and other types
        return new PolygonHierarchy([]);
    }

    private convertToPositions(geometry: Geometry): Cartesian3[] {
        // Implementation to convert LineString coordinates to Cartesian3 positions
        if (geometry.type === 'LineString') {
            return Cartesian3.fromDegreesArray(geometry.coordinates.flat() as [number, number]);
        }
        // Add support for MultiLineString
        return [];
    }

    private getFeatureStyle(feature: Feature<Geometry>): VectorLayerStyle {
        const getValue = <T>(value: T | ((f: Feature) => T) | undefined, defaultValue: T): T => {
            if (value === undefined) return defaultValue;
            return typeof value === 'function' ? (value as (f: Feature) => T)(feature) : value;
        };

        return {
            fillColor: getValue(this.style.fillColor, '#ffffff'),
            strokeColor: getValue(this.style.strokeColor, '#000000'),
            strokeWidth: getValue(this.style.strokeWidth, 1),
            opacity: getValue(this.style.opacity, 1),
            pointRadius: getValue(this.style.pointRadius, 5)
        };
    }

    private requestTile(x: number, y: number, z: number): void {
        this.client.getVectorTile(z, x, y);
    }

    private cleanupOldTiles(currentTiles: Set<string>): void {
        // Remove tiles that are no longer needed
        for (const tileKey of this.currentTiles) {
            if (!currentTiles.has(tileKey)) {
                const cached = this.tileCache.get(tileKey);
                if (cached) {
                    cached.entities.forEach(e => this.entityCollection.remove(e));
                    this.tileCache.delete(tileKey);
                }
            }
        }
    }

    private clearTiles(): void {
        this.entityCollection.removeAll();
        this.tileCache.clear();
        this.currentTiles.clear();
    }

    private refresh(): void {
        if (this.viewer && this.data) {
            const camera = this.viewer.camera;
            const rectangle = camera.computeViewRectangle();
            if (rectangle) {
                const bbox: BBox = [
                    CesiumMath.toDegrees(rectangle.west),
                    CesiumMath.toDegrees(rectangle.south),
                    CesiumMath.toDegrees(rectangle.east),
                    CesiumMath.toDegrees(rectangle.north)
                ];
                this.requestRenderByBboxAndZoom(bbox, this.currentZoom);
            }
        }
    }
}
