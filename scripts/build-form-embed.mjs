import { build } from 'esbuild'
import { mkdir } from 'node:fs/promises'
await mkdir('public/forms-assets', { recursive: true })
await build({ entryPoints: { runtime: 'src/forms/embed-runtime.tsx', loader: 'src/forms/embed-loader.ts' }, outdir: 'public/forms-assets', bundle: true, minify: true, sourcemap: false, platform: 'browser', target: ['es2022'], format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' }, legalComments: 'linked' })
console.log('Built self-hosted Forms iframe runtime and resize loader.')
