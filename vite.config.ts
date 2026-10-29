import { defineConfig } from "vite";
import { viteStaticCopy } from "vite-plugin-static-copy";

export default defineConfig({
    root: '.',
    plugins: [
        viteStaticCopy({
            targets: [
                { src: "node_modules/cesium/Build/Cesium/**", dest: "cesium" }
            ]
        })
    ],
    define: {
        CESIUM_BASE_URL: JSON.stringify("/cesium")
    },
    server: {
        port: 5173
    },
    // main.ts uses top-level await, which the default build target does not support
    build: {
        target: "esnext"
    }
});
