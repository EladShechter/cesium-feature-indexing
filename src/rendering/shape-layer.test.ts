import { describe, it, expect } from "vitest";
import type { TileShape } from "../global";
import { ShapeLayer, type ShapeDrawer } from "./shape-layer";

describe("ShapeLayer", () => {
    it("addTile given the same shape in two tiles draws it once", () => {
        // given
        const drawer = new FakeDrawer();
        const layer = new ShapeLayer(drawer);
        const shape = randomShape();
        // when
        layer.addTile("10/1/1", [shape]);
        layer.addTile("10/1/2", [shape]);
        // then
        expect(drawer.added).toEqual([shape.id]);
    });
    it("removeTile given a shape in two tiles removes it only after both are removed", () => {
        // given
        const drawer = new FakeDrawer();
        const layer = new ShapeLayer(drawer);
        const shape = randomShape();
        layer.addTile("10/1/1", [shape]);
        layer.addTile("10/1/2", [shape]);
        // when
        layer.removeTile("10/1/1");
        const removedAfterFirst = [...drawer.removed];
        layer.removeTile("10/1/2");
        // then
        expect(removedAfterFirst).toEqual([]);
        expect(drawer.removed).toEqual([shape.id]);
    });
    it("addTile given a zoom swap keeps a shared shape without redrawing it", () => {
        // given
        const drawer = new FakeDrawer();
        const layer = new ShapeLayer(drawer);
        const shape = randomShape();
        layer.addTile("10/1/1", [shape]);
        // when
        layer.addTile("11/2/2", [shape]);
        layer.removeTile("10/1/1");
        // then
        expect(drawer.added).toEqual([shape.id]);
        expect(drawer.removed).toEqual([]);
    });
    it("removeTile given an unknown tile does nothing", () => {
        // given
        const drawer = new FakeDrawer();
        const layer = new ShapeLayer(drawer);
        // when
        layer.removeTile("3/1/1");
        // then
        expect(drawer.removed).toEqual([]);
    });
});

class FakeDrawer implements ShapeDrawer {
    added: string[] = [];
    removed: string[] = [];
    private live = new Set<string>();
    add(shape: TileShape) {
        this.added.push(shape.id);
        this.live.add(shape.id);
    }
    remove(id: string) {
        this.removed.push(id);
        this.live.delete(id);
    }
    count() {
        return this.live.size;
    }
}

function randomShape(): TileShape {
    return { id: crypto.randomUUID(), kind: "line", coordinates: [[0, 0], [1, 1]] };
}
