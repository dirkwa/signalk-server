/**
 * Signal K WASM Plugin System
 *
 * Main entry point for WASM/WASIX plugin infrastructure.
 * Exports all public APIs for WASM plugin management.
 */

// Runtime
export {
  WasmRuntime,
  WasmPluginInstance,
  WasmCapabilities,
  getWasmRuntime,
  initializeWasmRuntime
} from './wasm-runtime'

// Storage
export {
  PluginStoragePaths,
  getPluginStoragePaths,
  initializePluginVfs,
  readPluginConfig,
  writePluginConfig,
  migrateFromNodeJs,
  cleanupVfsTmp,
  getVfsDiskUsage,
  deletePluginVfs
} from './wasm-storage'

// Loader
export {
  WasmPluginMetadata,
  WasmPlugin,
  registerWasmPlugin,
  startWasmPlugin,
  stopWasmPlugin,
  reloadWasmPlugin,
  handleWasmPluginCrash,
  updateWasmPluginConfig,
  setWasmPluginEnabled,
  getAllWasmPlugins,
  getWasmPlugin,
  shutdownAllWasmPlugins
} from './wasm-loader'

// ServerAPI Bridge
export {
  ServerAPIBridge,
  createServerAPIBridge,
  createWasmImports,
  callWasmExport
} from './wasm-serverapi'

// Subscriptions
export {
  DeltaSubscription,
  Delta,
  getSubscriptionManager,
  initializeSubscriptionManager
} from './wasm-subscriptions'
