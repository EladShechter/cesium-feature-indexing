import { Cartesian3, Color, CustomDataSource, PolygonHierarchy, Viewer } from "cesium";
import type { TileShape } from "../global";
import type { ShapeDrawer } from "./shape-layer";
import { SHAPE_LINE_COLOR, SHAPE_POLYGON_FILL, SHAPE_POLYGON_OUTLINE } from "../map-constants";

const ID_PREFIX = "shape:";

/** Draws shapes as Cesium entities in a dedicated data source. */
export class EntityShapeDrawer implements ShapeDrawer {
    private readonly dataSource = new CustomDataSource("shapes");

    constructor(private readonly viewer: Viewer) {
        viewer.dataSources.add(this.dataSource);
    }

    add(shape: TileShape): void {
        const id = ID_PREFIX + shape.id;
        const properties = { featureId: shape.id };
        if (shape.kind === "polygon") {
            const [outer, ...holes] = shape.coordinates as number[][][];
            this.dataSource.entities.add({
                id,
                properties,
                polygon: {
                    hierarchy: new PolygonHierarchy(
                        this.toCartesian(outer),
                        holes.map(h => new PolygonHierarchy(this.toCartesian(h)))
                    ),
                    height: 0,
                    material: Color.fromCssColorString(SHAPE_POLYGON_FILL),
                    outline: true,
                    outlineColor: Color.fromCssColorString(SHAPE_POLYGON_OUTLINE),
                },
            });
        } else {
            this.dataSource.entities.add({
                id,
                properties,
                polyline: {
                    positions: this.toCartesian(shape.coordinates as number[][]),
                    width: 2,
                    material: Color.fromCssColorString(SHAPE_LINE_COLOR),
                },
            });
        }
    }

    remove(id: string): void {
        this.dataSource.entities.removeById(ID_PREFIX + id);
    }

    beginBatch(): void {
        this.dataSource.entities.suspendEvents();
    }

    endBatch(): void {
        this.dataSource.entities.resumeEvents();
        this.viewer.scene.requestRender();
    }

    count(): number {
        return this.dataSource.entities.values.length;
    }

    private toCartesian(ring: number[][]): Cartesian3[] {
        return Cartesian3.fromDegreesArray(ring.flat());
    }
}
