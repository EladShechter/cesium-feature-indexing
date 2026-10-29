import { Cartesian2, Entity, ScreenSpaceEventType, Viewer } from "cesium";
import { buildFeatureIndex } from "./data";
import { ClusterWorkerClient } from "./cluster-worker-client";

export function setupPicking(
  viewer: Viewer,
  client: ClusterWorkerClient,
  features: GeoJSON.Feature<GeoJSON.Geometry>[]
) {
  const byId = buildFeatureIndex(features);

  viewer.screenSpaceEventHandler.setInputAction((event: { position: Cartesian2 }) => {
    const picks = viewer.scene.drillPick(event.position, 64);
    if (!picks?.length) return;

    const singleIds: string[] = [];
    const clusterIds: number[] = [];
    // a polygon's fill and outline are separate instances of one entity, so drillPick can return it twice
    const shapeIds = new Set<string>();

    for (const p of picks) {
      const meta: any = (p as any).id;
      if (!meta) continue;
      if (meta instanceof Entity) {
        shapeIds.add(meta.properties!.featureId.getValue());
        continue;
      }
      if (meta.kind === "point" && meta.id) singleIds.push(meta.id);
      if (meta.kind === "cluster" && typeof meta.id === "number") clusterIds.push(meta.id);
    }

    if (singleIds.length) {
      const picked = singleIds.map((id) => byId.get(String(id))).filter(Boolean);
      console.log("Picked single points:", picked);
    }

    if (shapeIds.size) {
      console.log("Picked shapes:", [...shapeIds].map((id) => byId.get(id)));
    }

    for (const cluster_id of clusterIds) client.leaves(cluster_id);
  }, ScreenSpaceEventType.LEFT_CLICK);

  client.addLeavesListener((leafFeatures) => {
    console.info(`Cluster contains ${leafFeatures.length} items:`, leafFeatures.map((l) => byId.get(l.properties.featureId)));
  });
}
