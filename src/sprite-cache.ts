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

type Key = string; // `${size}|${text}|${color}`
const cache = new Map<Key, HTMLCanvasElement>();

export function makeClusterSprite(size: number, colorCss: string, text: string): HTMLCanvasElement {
    const key: Key = `${size}|${text}|${colorCss}`;
    const cached = cache.get(key);
    if (cached) return cached;

    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1)); // crisp, bounded
    const radius = size;
    const pad = 2;
    const side = (radius * 2 + pad * 2) * dpr;

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
    g.font = `${Math.round(radius * 0.7)}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
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
export function sizeForCount(n: number): number {
    const min = 12, max = 48, cap = 200;
    const t = Math.sqrt(Math.min(n, cap)) / Math.sqrt(cap);
    return Math.round(min + (max - min) * t);
}

export function colorForCount(n: number): string {
    // blue → red by log scale
    const t = Math.min(1, Math.log(Math.max(2, n)) / Math.log(100));
    const hue = 210 - 210 * t; // 210deg ~ blue → 0deg red
    return `hsl(${hue}, 70%, 45%)`;
}
