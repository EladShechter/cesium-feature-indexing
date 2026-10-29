// Shared by the main thread and the worker (keep this file free of Cesium imports)

// Nominal on-screen size of a web-mercator tile, used to turn screen pixels into zoom levels and index units.
// CameraHandler picks the zoom so a tile is shown at TILE_SIZE_PX to 2 * TILE_SIZE_PX on screen.
export const TILE_SIZE_PX = 256;

// Tile coordinate resolution used by supercluster / geojson-vt. It only affects position precision
// (4096 -> 1/16 px on a 256px tile): the worker converts the cluster radius into these units
// (CLUSTER_RADIUS_PX * EXTENT / TILE_SIZE_PX), so changing it does not change clustering or sprite sizes.
export const EXTENT = 4096;

// Cluster sprite radius, scaled by sqrt(point_count) from MIN (2 points) to MAX (SPRITE_MAX_COUNT points and above)
export const SPRITE_MIN_RADIUS_PX = 12;
export const SPRITE_MAX_RADIUS_PX = 28;
export const SPRITE_MAX_COUNT = 200;
// Room around the circle for its white outline
export const SPRITE_PAD_PX = 2;

// Extra space between the largest bubbles
export const CLUSTER_GAP_PX = 4;

// Supercluster merges points within this on-screen distance of each other, so clusters end up roughly this far
// apart (at least, since a tile is shown at >= TILE_SIZE_PX). Bubbles don't touch when it is at least the largest
// bubble's diameter, so it is derived from the sprite size: bigger sprites -> bigger radius -> fewer, coarser clusters.
export const CLUSTER_RADIUS_PX = 2 * (SPRITE_MAX_RADIUS_PX + SPRITE_PAD_PX) + CLUSTER_GAP_PX;
