export function formatCount(n: number): string {
    if (n < 1000) return String(n);

    const units = ["K", "M", "B", "T"];
    let u = -1;
    let v = n;
    while (v >= 1000 && u < units.length - 1) {
        v /= 1000;
        u++;
    }
    const decimals = v < 10 ? 2 : v < 100 ? 1 : 0; // e.g. 1.23K, 23.2K, 123K
    return `${Number(v.toFixed(decimals))}${units[u]}`;
}

import { SPRITE_MAX_COUNT, SPRITE_MAX_RADIUS_PX, SPRITE_MIN_RADIUS_PX, SPRITE_PAD_PX } from "./map-constants";

type Key = string; // `${size}|${text}|${color}`
const cache = new Map<Key, HTMLCanvasElement>();

/**
 * Stable id for the sprite. Pass it to Billboard.setImage so all billboards with the same sprite share
 * one texture atlas entry (a canvas passed as `image` gets a new GUID, and a new atlas entry, per billboard).
 */
export function clusterSpriteId(size: number, colorCss: string, text: string, pixelRatio: number): Key {
    return `cluster|${size}|${text}|${colorCss}|${pixelRatio}`;
}

/**
 * Side of the sprite in drawing-buffer pixels (CSS size * pixelRatio, rounded). Use it for the billboard
 * width/height: Cesium sizes billboards in drawing-buffer pixels, and drawing the canvas at exactly that size
 * maps one texture pixel to one screen pixel, so the sprite is not resampled (which is what makes it blurry).
 */
export function clusterSpriteSide(size: number, pixelRatio: number): number {
    return Math.round((size * 2 + SPRITE_PAD_PX * 2) * pixelRatio);
}

/**
 * @param pixelRatio the scene's drawing-buffer pixels per CSS pixel (`scene.pixelRatio`)
 */
export function makeClusterSprite(size: number, colorCss: string, text: string, pixelRatio: number): HTMLCanvasElement {
    const key = clusterSpriteId(size, colorCss, text, pixelRatio);
    const cached = cache.get(key);
    if (cached) return cached;

    const radius = size;
    const pad = SPRITE_PAD_PX;
    const side = clusterSpriteSide(size, pixelRatio);

    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = side;
    const g = canvas.getContext("2d")!;
    // Draw in CSS units; the exact scale (side / css side) keeps the circle centred after rounding
    const scale = side / (radius * 2 + pad * 2);
    g.scale(scale, scale);

    // Circle
    g.beginPath();
    g.arc(radius + pad, radius + pad, radius, 0, Math.PI * 2);
    g.fillStyle = colorCss;
    g.fill();
    g.lineWidth = 2;
    g.strokeStyle = "#fff";
    g.stroke();

    // Text
    // Longer labels (e.g. "1.23K") get a smaller font so they stay inside the circle
    // Semibold white on the solid circle is readable without an outline (a thick dark stroke fills in small glyphs)
    g.font = `600 ${Math.round(radius * (text.length > 3 ? 0.58 : 0.72))}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillStyle = "white";
    const cx = radius + pad, cy = radius + pad;
    g.fillText(text, cx, cy);

    cache.set(key, canvas);
    return canvas;
}

// Simple size & color scaling helpers
// The cluster radius is derived from SPRITE_MAX_RADIUS_PX (see map-constants.ts), so bubbles don't overlap
export function sizeForCount(n: number): number {
    const t = Math.sqrt(Math.min(n, SPRITE_MAX_COUNT)) / Math.sqrt(SPRITE_MAX_COUNT);
    return Math.round(SPRITE_MIN_RADIUS_PX + (SPRITE_MAX_RADIUS_PX - SPRITE_MIN_RADIUS_PX) * t);
}

export function colorForCount(n: number): string {
    // blue → red by log scale
    const t = Math.min(1, Math.log(Math.max(2, n)) / Math.log(100));
    const hue = 210 - 210 * t; // 210deg ~ blue → 0deg red
    return `hsl(${hue}, 70%, 45%)`;
}
