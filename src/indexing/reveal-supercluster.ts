// Worker-side: keep free of Cesium imports
import Supercluster from "supercluster";
import { latY, lngX } from "./mercator";

interface KDBushWithData {
    data: number[];
    range(minX: number, minY: number, maxX: number, maxY: number): number[];
    within(x: number, y: number, r: number): number[];
}

// Supercluster 8.0.1 internals this subclass depends on (see node_modules/supercluster/index.js)
interface SuperclusterInternals {
    options: Required<Omit<Supercluster.Options<any, any>, "reduce">> & Pick<Supercluster.Options<any, any>, "reduce">;
    trees: Array<KDBushWithData>;
    points: Array<GeoJSON.Feature<GeoJSON.Point>>;
    stride: number;
    _createTree(data: number[]): KDBushWithData;
    _cluster(tree: KDBushWithData, zoom: number): number[];
}

// Supercluster whose items join the hierarchy at their own level: an item with
// properties.revealZoom = R is added to trees[R] right before trees[R - 1] is clustered,
// so it appears in clusters below R only. Missing revealZoom = an ordinary point.
export class RevealSupercluster<P extends { revealZoom?: number } = Supercluster.AnyProps, C extends Supercluster.AnyProps = Supercluster.AnyProps>
    extends Supercluster<P, C> {

    // Mirrors supercluster 8.0.1 load() (index.js:39-87) minus log timing; the one change is marked.
    // The "points only" equivalence test guards library upgrades.
    load(points: Array<Supercluster.PointFeature<P>>): this {
        const self = this as unknown as SuperclusterInternals;
        const { minZoom, maxZoom, reduce } = self.options;
        self.points = points;

        const byLevel = new Map<number, number[]>();
        for (let i = 0; i < points.length; i++) {
            if (!points[i].geometry) continue;
            const level = Math.min(points[i].properties?.revealZoom ?? Infinity, maxZoom + 1);
            const group = byLevel.get(level);
            if (group) group.push(i);
            else byLevel.set(level, [i]);
        }
        const items = (level: number): number[] => {
            const data: number[] = [];
            for (const i of byLevel.get(level) ?? []) {
                const [lng, lat] = points[i].geometry.coordinates;
                data.push(Math.fround(lngX(lng)), Math.fround(latY(lat)), Infinity, i, -1, 1);
                if (reduce) data.push(0); // noop reduce slot
            }
            return data;
        };

        let tree = self.trees[maxZoom + 1] = self._createTree(items(maxZoom + 1));
        for (let z = maxZoom; z >= minZoom; z--) {
            // CHANGE: add the shapes that become points below level z + 1
            if (z + 1 <= maxZoom && byLevel.has(z + 1)) {
                tree = self.trees[z + 1] = self._createTree([...tree.data, ...items(z + 1)]);
            }
            tree = self.trees[z] = self._createTree(self._cluster(tree, z));
        }
        return this;
    }
}
