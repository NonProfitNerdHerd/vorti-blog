import { builtinEnvironments, type Environment } from 'vitest/environments'

// Components share repository fixtures with Node tests. Keep Node built-ins in
// the server module pipeline while providing the normal jsdom browser globals.
const nodeDOMEnvironment: Environment = {
  ...builtinEnvironments.jsdom,
  name: 'node-dom',
  viteEnvironment: 'ssr' as const,
  async setup(global, options) {
    const NodeUint8Array = global.Uint8Array
    const NodeArrayBuffer = global.ArrayBuffer
    const NodeTextEncoder = global.TextEncoder
    const NodeTextDecoder = global.TextDecoder
    const environment = await builtinEnvironments.jsdom.setup(global, options)
    // Node's encoder, Buffer, SQLite and esbuild must share Node's binary
    // constructors while jsdom supplies the document and browser UI globals.
    global.Uint8Array = NodeUint8Array
    global.ArrayBuffer = NodeArrayBuffer
    global.TextEncoder = NodeTextEncoder
    global.TextDecoder = NodeTextDecoder
    return environment
  },
}

export default nodeDOMEnvironment
