import { Cartesian2, ScreenSpaceEventType, Viewer } from "cesium";
import { buildFeatureIndex } from "./data";
import { ClusterWorkerClient } from "./cluster-worker-client";

export function setupPicking(
  viewer: Viewer,
  client: ClusterWorkerClient,
  features: GeoJSON.Feature<GeoJSON.Point>[]
) {
  const byId = buildFeatureIndex(features);

  viewer.screenSpaceEventHandler.setInputAction((event: { position: Cartesian2 }) => {
    const picks = viewer.scene.drillPick(event.position, 64);
    if (!picks?.length) return;

    const singleIds: string[] = [];
    const clusterIds: number[] = [];

    for (const p of picks) {
      const meta: any = (p as any).id;
      if (!meta) continue;
      if (meta.kind === "point" && meta.id) singleIds.push(meta.id);
      if (meta.kind === "cluster" && typeof meta.id === "number") clusterIds.push(meta.cluster_id);
    }

    if (singleIds.length) {
      const picked = singleIds.map((id) => byId.get(String(id))).filter(Boolean);
      console.log("Picked single points:", picked);
    }

    for (const cluster_id of clusterIds) client.leaves(cluster_id);
  }, ScreenSpaceEventType.LEFT_CLICK);

  client.addLeavesListener((leafFeatures) => {
    console.info(`Cluster contains ${leafFeatures.length} items:`, leafFeatures);
  });
}
