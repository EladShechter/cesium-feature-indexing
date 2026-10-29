import type { TileShape } from "../global";

export interface ShapeDrawer {
    add(shape: TileShape): void;
    remove(id: string): void;
    count(): number;
}

/** Reference-counts shapes per tile so each shape is drawn once and removed with its last tile. */
export class ShapeLayer {
    private refs = new Map<string, number>();
    private tiles = new Map<string, string[]>();

    constructor(private drawer: ShapeDrawer) {}

    addTile(tileKey: string, shapes: TileShape[]): void {
        if (this.tiles.has(tileKey)) return;
        const unique = new Map(shapes.map(s => [s.id, s]));
        for (const shape of unique.values()) {
            const n = this.refs.get(shape.id) ?? 0;
            if (n === 0) this.drawer.add(shape);
            this.refs.set(shape.id, n + 1);
        }
        const ids = [...unique.keys()];
        this.tiles.set(tileKey, ids);
    }

    removeTile(tileKey: string): void {
        const ids = this.tiles.get(tileKey);
        if (!ids) return;
        this.tiles.delete(tileKey);
        for (const id of ids) this.release(id);
    }

    count(): number {
        return this.drawer.count();
    }

    private release(id: string): void {
        const n = (this.refs.get(id) ?? 0) - 1;
        if (n <= 0) {
            this.refs.delete(id);
            this.drawer.remove(id);
        } else this.refs.set(id, n);
    }
}
