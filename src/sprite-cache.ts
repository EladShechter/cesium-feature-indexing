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
export function clusterSpriteId(size: number, colorCss: string, text: string): Key {
    return `cluster|${size}|${text}|${colorCss}`;
}

/**
 * On-screen side of the sprite in CSS pixels. Set it as the billboard width/height, because the canvas is
 * drawn at devicePixelRatio and would otherwise appear dpr times too large.
 */
export function clusterSpriteSide(size: number): number {
    return size * 2 + SPRITE_PAD_PX * 2;
}

export function makeClusterSprite(size: number, colorCss: string, text: string): HTMLCanvasElement {
    const key = clusterSpriteId(size, colorCss, text);
    const cached = cache.get(key);
    if (cached) return cached;

    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1)); // crisp, bounded
    const radius = size;
    const pad = SPRITE_PAD_PX;
    const side = clusterSpriteSide(size) * dpr;

    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = Math.ceil(side);
    const g = canvas.getContext("2d")!;
    g.scale(dpr, dpr);

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
    g.font = `${Math.round(radius * (text.length > 3 ? 0.55 : 0.7))}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.lineWidth = 3;
    g.strokeStyle = "black";
    g.fillStyle = "white";
    const cx = radius + pad, cy = radius + pad;
    g.strokeText(text, cx, cy);
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
