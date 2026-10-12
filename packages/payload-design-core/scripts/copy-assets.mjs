import { copyFileSync, mkdirSync } from 'node:fs'
mkdirSync(new URL('../dist/views/', import.meta.url), {recursive:true})
copyFileSync(new URL('../src/views/views.css', import.meta.url), new URL('../dist/views/views.css', import.meta.url))
mkdirSync(new URL('../dist/blocks/', import.meta.url), {recursive:true})
copyFileSync(new URL('../src/blocks/variations.css', import.meta.url), new URL('../dist/blocks/variations.css', import.meta.url))
copyFileSync(new URL('../src/builder/variations-editor.css', import.meta.url), new URL('../dist/builder/variations-editor.css', import.meta.url))

mkdirSync(new URL('../dist/hero-board/', import.meta.url), { recursive: true })
copyFileSync(new URL('../src/hero-board/hero-board.css', import.meta.url), new URL('../dist/hero-board/hero-board.css', import.meta.url))
mkdirSync(new URL('../dist/admin/', import.meta.url), { recursive: true })
copyFileSync(new URL('../src/admin/template-builder.css', import.meta.url), new URL('../dist/admin/template-builder.css', import.meta.url))
copyFileSync(new URL('../src/admin/content-workspace.css', import.meta.url), new URL('../dist/admin/content-workspace.css', import.meta.url))

mkdirSync(new URL('../dist/builder/', import.meta.url), { recursive: true })
copyFileSync(new URL('../src/builder/builder-sidebar.css', import.meta.url), new URL('../dist/builder/builder-sidebar.css', import.meta.url))
copyFileSync(new URL('../src/builder/block-inspector.css', import.meta.url), new URL('../dist/builder/block-inspector.css', import.meta.url))
copyFileSync(new URL('../src/builder/editor-header.css', import.meta.url), new URL('../dist/builder/editor-header.css', import.meta.url))
copyFileSync(new URL('../src/builder/workspace-frame.css', import.meta.url), new URL('../dist/builder/workspace-frame.css', import.meta.url))
copyFileSync(new URL('../src/builder/block-actions.css', import.meta.url), new URL('../dist/builder/block-actions.css', import.meta.url))
