/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * WASM Interface
 *
 * Manages the WASM runtime as a Signal K interface.
 * Can be enabled/disabled via settings.interfaces.wasm
 */

import Debug from 'debug'
const debug = Debug('signalk:interfaces:wasm')

module.exports = (app: any) => {
  const api: any = {}

  api.mdns = {
    name: '_signalk-wasm',
    type: 'tcp',
    port: app.config.port
  }

  api.start = () => {
    debug('Starting WASM interface')
    try {
      const {
        initializeWasmRuntime,
        initializeSubscriptionManager
      } = require('../wasm')
      app.wasmRuntime = initializeWasmRuntime()
      app.wasmSubscriptionManager = initializeSubscriptionManager()
      debug('WASM runtime initialized successfully')
      return { enabled: true }
    } catch (error) {
      debug('WASM runtime initialization failed:', error)
      return { enabled: false, error }
    }
  }

  api.stop = () => {
    debug('Stopping WASM interface')
    try {
      const { shutdownAllWasmPlugins } = require('../wasm')
      shutdownAllWasmPlugins(app)
    } catch (error) {
      debug('WASM shutdown error:', error)
    }
  }

  return api
}
