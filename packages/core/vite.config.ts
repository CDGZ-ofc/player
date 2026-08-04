import path from "path";
import { defineConfig } from "vite";
import dts from "vite-plugin-dts";
import wasm from "vite-plugin-wasm";

export default defineConfig({
	build: {
		sourcemap: true,
		outDir: "dist",
		emptyDirBeforeWrite: true,
		cssMinify: "lightningcss",
		rollupOptions: {
			input: {
				main: path.resolve(__dirname, "index.html"),
			},
			output: {
				entryFileNames: "assets/[name]-[hash].js",
				chunkFileNames: "assets/[name]-[hash].js",
				assetFileNames: "assets/[name]-[hash].[ext]",
			},
		},
	},
	resolve: {
		alias: {
			"@applemusic-like-lyrics/ttml": path.resolve(
				__dirname,
				"../ttml/src",
			),
		},
	},
	plugins: [
		wasm(),
		dts({
			exclude: ["src/test.ts"],
		}),
	],
});
