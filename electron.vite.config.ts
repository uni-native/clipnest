import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import vue from '@vitejs/plugin-vue'

const shared = resolve(__dirname, 'src/shared')
const main = resolve(__dirname, 'src/main')
const preload = resolve(__dirname, 'src/preload')
const rendererSrc = resolve(__dirname, 'src/renderer/src')

export default defineConfig({
  main: {
    resolve: {
      alias: {
        '@shared': shared,
        '@main': main,
        '@preload': preload,
      },
    },
    build: {
      outDir: resolve(__dirname, 'out/main'),
      target: 'node22',
      sourcemap: true,
                                                        
                                                                        
      rollupOptions: {
        external: ['koffi', 'better-sqlite3', 'ws', '@huggingface/transformers'],
      },
    },
  },
  preload: {
    resolve: {
      alias: {
        '@shared': shared,
        '@main': main,
        '@preload': preload,
      },
    },
    build: {
      outDir: resolve(__dirname, 'out/preload'),
      target: 'node22',
      sourcemap: true,
    },
  },
  renderer: {
    resolve: {
      alias: {
        '@shared': shared,
        '@renderer': rendererSrc,
      },
    },
    plugins: [vue()],
    build: {
      outDir: resolve(__dirname, 'out/renderer'),
      sourcemap: false,
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html'),
        },
      },
    },
  },
})
