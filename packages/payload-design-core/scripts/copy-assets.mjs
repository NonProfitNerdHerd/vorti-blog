import { copyFileSync, mkdirSync } from 'node:fs'

mkdirSync(new URL('../dist/hero-board/', import.meta.url), { recursive: true })
copyFileSync(new URL('../src/hero-board/hero-board.css', import.meta.url), new URL('../dist/hero-board/hero-board.css', import.meta.url))
mkdirSync(new URL('../dist/admin/', import.meta.url), { recursive: true })
copyFileSync(new URL('../src/admin/template-builder.css', import.meta.url), new URL('../dist/admin/template-builder.css', import.meta.url))
