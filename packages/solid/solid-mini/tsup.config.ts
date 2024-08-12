import { defineConfig } from 'tsup'

export default defineConfig(options => ({
  minify: false,
  entry: ['packages/solid/src/reactive/signal.ts'],
  outDir: 'packages/solid/src/reactive/dist',
  splitting: false,
  sourcemap: true,
  clean: true,
  format: ['esm'],
  external: [],
  dts: false,
}))
