// Worker-side: keep free of Cesium imports
import bbox from "@turf/bbox";
import Flatbush from "flatbush";
import type Supercluster from "supercluster";
import type { BBox, TileShape } from "../global";
import { EXTENT, TILE_SIZE_PX } from "../map-constants";
import { tileBBox } from "./mercator";
import { anchorPoint, revealZoom } from "./reveal";
import { RevealSupercluster } from "./reveal-supercluster";

export type ItemKind = "point" | "polygon" | "line";
export type ItemProps = { kind: ItemKind; featureId: string; revealZoom: number };
export type ClusterBreakdown = { points: number; polygons: number; lines: number };
export type IndexOptions = { minPoints: number; radiusPx: number; maxZoom: number };
export type IndexedShape = TileShape & { bbox: BBox; revealZoom: number };
type Item = GeoJSON.Feature<GeoJSON.Point, ItemProps>;
// supercluster sets id on unclustered points (the item's featureId); @types/supercluster omits it
export type TileItem = Supercluster.TileFeature<ClusterBreakdown, ItemProps> & { id?: string };

// Points become items as-is; polygons / lines become shapes plus an anchor item that stands in for them below R
export function toIndexItems(features: GeoJSON.Feature<GeoJSON.Geometry | null>[], maxZoom: number): { items: Item[]; shapes: IndexedShape[]; skipped: number } {
    const items: Item[] = [];
    const shapes: IndexedShape[] = [];
    let skipped = 0;
    const item = (featureId: string, kind: ItemKind, coordinates: number[], R: number): Item =>
        ({ type: "Feature", id: featureId, properties: { kind, featureId, revealZoom: R }, geometry: { type: "Point", coordinates } });

    features.forEach((feature, index) => {
        const featureId = String(feature.id ?? index);
        const geometry = feature.geometry;
        if (isEmpty(geometry)) {
            skipped++;
        } else if (geometry?.type === "Point") {
            items.push(item(featureId, "point", geometry.coordinates, Infinity));
        } else if (geometry?.type === "Polygon" || geometry?.type === "LineString") {
            const kind = geometry.type === "Polygon" ? "polygon" : "line";
            const box = bbox(geometry) as BBox;
            const R = revealZoom(box, maxZoom);
            shapes.push({ id: featureId, kind, coordinates: geometry.coordinates, bbox: box, revealZoom: R });
            if (R > 0) items.push(item(featureId, kind, anchorPoint(geometry), R));
        } else {
            skipped++;
        }
    });
    return { items, shapes, skipped };
}

function isEmpty(geometry: GeoJSON.Geometry | null): boolean {
    if (geometry?.type === "Polygon") return !geometry.coordinates[0]?.length;
    return (geometry?.type === "Point" || geometry?.type === "LineString") && geometry.coordinates.length === 0;
}

export class FeatureIndex {
    private skippedCount = 0;
    private cluster: RevealSupercluster<ItemProps, ClusterBreakdown>;
    private shapeIndex: Flatbush | null = null;
    private shapes: IndexedShape[] = [];

    constructor(private readonly options: IndexOptions) {
        const { minPoints, radiusPx, maxZoom } = options;
        this.cluster = new RevealSupercluster<ItemProps, ClusterBreakdown>({
            minPoints, maxZoom, extent: EXTENT, radius: radiusPx * EXTENT / TILE_SIZE_PX,
            map: ({ kind }) => ({ points: +(kind === "point"), polygons: +(kind === "polygon"), lines: +(kind === "line") }),
            reduce: (acc, props) => {
                acc.points += props.points;
                acc.polygons += props.polygons;
                acc.lines += props.lines;
            }
        });
    }

    get skipped(): number {
        return this.skippedCount;
    }

    load(features: GeoJSON.Feature<GeoJSON.Geometry | null>[]): void {
        const { items, shapes, skipped } = toIndexItems(features, this.options.maxZoom);
        this.skippedCount = skipped;
        if (skipped > 0) console.warn(`FeatureIndex: skipped ${skipped} features with missing or unsupported geometry`);

        this.cluster.load(items);

        // shapes with R > maxZoom are never drawn as geometry
        this.shapes = shapes.filter(s => s.revealZoom <= this.options.maxZoom);
        this.shapeIndex = null;
        if (this.shapes.length > 0) {
            this.shapeIndex = new Flatbush(this.shapes.length);
            for (const { bbox: [west, south, east, north] } of this.shapes) this.shapeIndex.add(west, south, east, north);
            this.shapeIndex.finish();
        }
    }

    getTile(z: number, x: number, y: number): { features: TileItem[]; shapes: TileShape[] } {
        // an anchor stays in trees[R] and above as an unclustered point; from R on its shape is drawn instead.
        // Zooms above maxZoom reuse trees[maxZoom + 1], whose R = maxZoom + 1 anchors are never drawn as shapes
        const features: TileItem[] = (this.cluster.getTile(z, x, y)?.features ?? [])
            .filter(f => "cluster" in f.tags || (f.tags as ItemProps).revealZoom > Math.min(z, this.options.maxZoom));
        const shapes = (this.shapeIndex?.search(...tileBBox(z, x, y)) ?? [])
            .map(i => this.shapes[i])
            .filter(s => s.revealZoom <= z)
            .map(({ id, kind, coordinates }) => ({ id, kind, coordinates }));
        return { features, shapes };
    }

    getLeaves(clusterId: number): Item[] {
        return this.cluster.getLeaves(clusterId, Infinity, 0);
    }
}
