import {
    Billboard,
    BillboardCollection,
    Cartesian3,
    Color, PointPrimitive,
    PointPrimitiveCollection,
    VerticalOrigin,
    Viewer
} from "cesium";
import { ClusterWorkerClient } from "../cluster-worker-client";
import {
    clusterSpriteId,
    clusterSpriteSide,
    colorForCount,
    formatCount,
    makeClusterSprite,
    sizeForCount
} from "../sprite-cache";
import Supercluster, { ClusterProperties } from 'supercluster';

export abstract class BaseRenderer {
    protected readonly hudClusters: HTMLElement;
    protected readonly hudSingles: HTMLElement;
    protected readonly billboardCollection: BillboardCollection;
    protected readonly pointCollection: PointPrimitiveCollection;

    protected constructor(
        protected readonly viewer: Viewer,
        protected readonly client: ClusterWorkerClient
    ) {
        this.hudClusters = document.getElementById("hudClusters")!;
        this.hudSingles = document.getElementById("hudSingles")!;
        this.billboardCollection = viewer.scene.primitives.add(new BillboardCollection());
        this.pointCollection = viewer.scene.primitives.add(new PointPrimitiveCollection());
    }

    protected drawFeature(pos: Cartesian3, props: Supercluster.ClusterProperties, id: string): Billboard | PointPrimitive | null {
        try {
            if (props.cluster) {
                const count: number = props.point_count;
                const size = sizeForCount(count);
                const color = colorForCount(count);
                const text = formatCount(count);
                // Billboards are sized in drawing-buffer pixels, so draw the sprite at the scene's pixel ratio
                const pixelRatio = this.drawingBufferPixelRatio();
                const sprite = makeClusterSprite(size, color, text, pixelRatio);
                const side = clusterSpriteSide(size, pixelRatio);

                const billboard = this.billboardCollection.add({
                    position: pos,
                    width: side,
                    height: side,
                    verticalOrigin: VerticalOrigin.CENTER,
                    disableDepthTestDistance: Number.POSITIVE_INFINITY,
                });
                billboard.setImage(clusterSpriteId(size, color, text, pixelRatio), sprite);

                billboard.id = {
                    kind: "cluster",
                    id: props.cluster_id,
                    count
                };
                return billboard;
            } else {
                const point = this.pointCollection.add({
                    position: pos,
                    // pixelSize is in CSS pixels (unlike billboards, the point shader applies czm_pixelRatio)
                    pixelSize: 6,
                    color: Color.SKYBLUE,
                    disableDepthTestDistance: Number.POSITIVE_INFINITY,
                });
                point.id = {
                    kind: "point",
                    id: id
                };
                return point;
            }
        } catch (error) {
            console.error("Error drawing feature:", error);
            return null;
        }
    }

    /**
     * Drawing-buffer pixels per CSS pixel. Same formula as Cesium's (private) scene.pixelRatio.
     */
    private drawingBufferPixelRatio(): number {
        const dpr = this.viewer.useBrowserRecommendedResolution ? 1 : window.devicePixelRatio;
        return dpr * this.viewer.resolutionScale;
    }

    /**
     * Update the HUD with current counts
     */
    protected updateHUD(): void {
        this.hudClusters.textContent = String(this.billboardCollection.length);
        this.hudSingles.textContent = String(this.pointCollection.length);
    }

    /**
     * Clean up resources
     */
    public destroy(): void {
        this.billboardCollection.removeAll();
        this.pointCollection.removeAll();
    }
}
