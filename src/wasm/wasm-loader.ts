/**
 * WASM Plugin Loader
 *
 * Handles registration, loading, and lifecycle management of WASM plugins.
 * Supports hot-reload without server restart and automatic crash recovery.
 */

import * as path from 'path'
import * as fs from 'fs'
import * as express from 'express'
import { Request, Response, Router } from 'express'
import Debug from 'debug'
import {
  getWasmRuntime,
  WasmPluginInstance,
  WasmCapabilities
} from './wasm-runtime'
import {
  getPluginStoragePaths,
  initializePluginVfs,
  readPluginConfig,
  writePluginConfig
} from './wasm-storage'
import { SERVERROUTESPREFIX } from '../constants'

const debug = Debug('signalk:wasm:loader')

function backwardsCompat(url: string) {
  return [`${SERVERROUTESPREFIX}${url}`, url]
}

export interface WasmPluginMetadata {
  id: string
  name: string
  packageName: string
  version: string
  wasmManifest: string
  capabilities: WasmCapabilities
  packageLocation: string
}

export interface WasmPlugin {
  id: string
  name: string
  type: 'wasm'
  packageName: string
  version: string
  enabled: boolean
  keywords: string[]
  packageLocation: string
  metadata: WasmPluginMetadata
  instance?: WasmPluginInstance
  status: 'stopped' | 'starting' | 'running' | 'error' | 'crashed'
  statusMessage?: string
  errorMessage?: string
  schema?: any
  configuration?: any
  crashCount: number
  lastCrash?: Date
  restartBackoff: number // milliseconds
}

// Global plugin registry
const wasmPlugins: Map<string, WasmPlugin> = new Map()

// Crash recovery timers
const restartTimers: Map<string, NodeJS.Timeout> = new Map()

/**
 * Register a WASM plugin from package metadata
 */
export async function registerWasmPlugin(
  app: any,
  packageName: string,
  metadata: any,
  location: string,
  configPath: string
): Promise<WasmPlugin> {
  debug(`Registering WASM plugin: ${packageName} from ${location}`)

  try {
    // Read package.json to get WASM metadata
    const packageJson = require(path.join(location, packageName, 'package.json'))

    if (!packageJson.wasmManifest) {
      throw new Error('Missing wasmManifest in package.json')
    }

    const wasmPath = path.join(location, packageName, packageJson.wasmManifest)
    const capabilities: WasmCapabilities = packageJson.wasmCapabilities || {
      network: false,
      storage: 'vfs-only',
      dataRead: true,
      dataWrite: true,
      serialPorts: false,
      putHandlers: false
    }

    // Load WASM module first to get plugin ID

    // Create temporary VFS for initial load (to get plugin metadata)
    const tempVfsRoot = path.join(configPath, 'plugin-config-data', '.temp-' + packageName.replace(/\//g, '-'))
    if (!fs.existsSync(tempVfsRoot)) {
      fs.mkdirSync(tempVfsRoot, { recursive: true })
    }

    const runtime = getWasmRuntime()
    const instance = await runtime.loadPlugin(
      packageName,
      wasmPath,
      tempVfsRoot,
      capabilities,
      app
    )

    // Get plugin metadata from WASM exports to determine plugin ID
    let pluginId: string
    let pluginName: string
    let schemaJson: string

    try {
      debug(`Available exports: ${Object.keys(instance.exports).join(', ')}`)
      debug(`Calling id() for ${packageName}`)
      pluginId = instance.exports.id()
      debug(`Got id: ${pluginId}`)

      debug(`Calling name() for ${packageName}`)
      pluginName = instance.exports.name()
      debug(`Got name: ${pluginName}`)

      debug(`Calling schema() for ${packageName}`)
      schemaJson = instance.exports.schema()
      debug(`Got schema: ${schemaJson?.substring(0, 100)}`)
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      const stack = error instanceof Error ? error.stack : ''
      debug(`Error calling WASM exports: ${errorMsg}`)
      debug(`Stack trace: ${stack}`)
      debug(`Error type: ${error?.constructor?.name}`)
      throw error // Re-throw the original error to preserve stack trace
    }

    // Now we have plugin ID, set up proper storage paths
    const storagePaths = getPluginStoragePaths(configPath, pluginId, packageName)

    // Initialize VFS
    initializePluginVfs(storagePaths)

    // Clean up temp VFS
    if (fs.existsSync(tempVfsRoot)) {
      fs.rmSync(tempVfsRoot, { recursive: true, force: true })
    }

    // Read saved configuration (or create default if not exists)
    const savedConfig = readPluginConfig(storagePaths.configFile)

    // Write initial config file if it doesn't exist
    if (!fs.existsSync(storagePaths.configFile)) {
      debug(`Creating initial config file for ${packageName}`)
      writePluginConfig(storagePaths.configFile, savedConfig)
    }

    const schema = schemaJson ? JSON.parse(schemaJson) : {}

    // Create plugin object
    const plugin: WasmPlugin = {
      id: pluginId,
      name: pluginName,
      type: 'wasm',
      packageName,
      version: metadata.version || packageJson.version,
      enabled: savedConfig.enabled || false,
      keywords: packageJson.keywords || [],
      packageLocation: location,
      metadata: {
        id: pluginId,
        name: pluginName,
        packageName,
        version: metadata.version || packageJson.version,
        wasmManifest: packageJson.wasmManifest,
        capabilities,
        packageLocation: location
      },
      instance,
      status: 'stopped',
      schema,
      configuration: savedConfig.configuration || {},
      crashCount: 0,
      restartBackoff: 1000 // Start with 1 second
    }

    // Register in global map
    wasmPlugins.set(pluginId, plugin)

    // Add to app.plugins array for unified plugin management
    if (app.plugins) {
      app.plugins.push(plugin)
    }

    // Set up REST API routes for this plugin
    setupWasmPluginRoutes(app, plugin, configPath)

    debug(`Registered WASM plugin: ${pluginId} (${pluginName})`)

    // Auto-start if enabled
    if (plugin.enabled) {
      await startWasmPlugin(app, pluginId)
    }

    return plugin
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error)
    debug(`Failed to register WASM plugin ${packageName}: ${errorMsg}`)
    throw new Error(`Failed to register WASM plugin: ${errorMsg}`)
  }
}

/**
 * Start a WASM plugin
 */
export async function startWasmPlugin(app: any, pluginId: string): Promise<void> {
  const plugin = wasmPlugins.get(pluginId)
  if (!plugin) {
    throw new Error(`WASM plugin ${pluginId} not found`)
  }

  if (plugin.status === 'running') {
    debug(`Plugin ${pluginId} already running`)
    return
  }

  debug(`Starting WASM plugin: ${pluginId}`)
  plugin.status = 'starting'
  plugin.errorMessage = undefined

  try {
    if (!plugin.instance) {
      throw new Error('Plugin instance not loaded')
    }

    // Call plugin start() with configuration
    const configJson = JSON.stringify(plugin.configuration)
    const result = plugin.instance.exports.start(configJson)

    if (result !== 0) {
      throw new Error(`Plugin start() returned error code: ${result}`)
    }

    plugin.status = 'running'
    plugin.statusMessage = 'Running'
    plugin.crashCount = 0 // Reset crash count on successful start
    plugin.restartBackoff = 1000

    debug(`Successfully started WASM plugin: ${pluginId}`)
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error)
    plugin.status = 'error'
    plugin.errorMessage = errorMsg
    debug(`Failed to start WASM plugin ${pluginId}: ${errorMsg}`)
    throw error
  }
}

/**
 * Stop a WASM plugin
 */
export async function stopWasmPlugin(pluginId: string): Promise<void> {
  const plugin = wasmPlugins.get(pluginId)
  if (!plugin) {
    throw new Error(`WASM plugin ${pluginId} not found`)
  }

  debug(`Stopping WASM plugin: ${pluginId}`)

  try {
    // Cancel any pending restart timers
    const timer = restartTimers.get(pluginId)
    if (timer) {
      clearTimeout(timer)
      restartTimers.delete(pluginId)
    }

    if (plugin.instance) {
      // Call plugin stop()
      const result = plugin.instance.exports.stop()
      if (result !== 0) {
        debug(`Plugin stop() returned error code: ${result}`)
      }
    }

    plugin.status = 'stopped'
    plugin.statusMessage = 'Stopped'
    debug(`Successfully stopped WASM plugin: ${pluginId}`)
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error)
    debug(`Error stopping WASM plugin ${pluginId}: ${errorMsg}`)
    plugin.status = 'error'
    plugin.errorMessage = errorMsg
    throw error
  }
}

/**
 * Reload a WASM plugin (hot-reload without server restart)
 */
export async function reloadWasmPlugin(
  app: any,
  pluginId: string
): Promise<void> {
  const plugin = wasmPlugins.get(pluginId)
  if (!plugin) {
    throw new Error(`WASM plugin ${pluginId} not found`)
  }

  debug(`Reloading WASM plugin: ${pluginId}`)

  try {
    const wasRunning = plugin.status === 'running'

    // Stop the plugin
    if (wasRunning) {
      await stopWasmPlugin(pluginId)
    }

    // Save current configuration
    const savedConfig = plugin.configuration

    // Reload WASM module
    const runtime = getWasmRuntime()
    await runtime.reloadPlugin(pluginId)

    // Get new instance
    const newInstance = runtime.getInstance(pluginId)
    if (!newInstance) {
      throw new Error('Failed to get reloaded instance')
    }

    plugin.instance = newInstance

    // Update schema from new instance
    const schemaJson = newInstance.exports.schema()
    plugin.schema = schemaJson ? JSON.parse(schemaJson) : {}

    // Restart if it was running
    if (wasRunning) {
      await startWasmPlugin(app, pluginId)
    }

    plugin.statusMessage = 'Reloaded successfully'
    debug(`Successfully reloaded WASM plugin: ${pluginId}`)
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error)
    plugin.status = 'error'
    plugin.errorMessage = `Reload failed: ${errorMsg}`
    debug(`Failed to reload WASM plugin ${pluginId}: ${errorMsg}`)
    throw error
  }
}

/**
 * Handle WASM plugin crash with automatic restart
 */
export async function handleWasmPluginCrash(
  app: any,
  pluginId: string,
  error: Error
): Promise<void> {
  const plugin = wasmPlugins.get(pluginId)
  if (!plugin) {
    return
  }

  plugin.crashCount++
  plugin.lastCrash = new Date()
  plugin.status = 'crashed'
  plugin.errorMessage = `Crashed: ${error.message}`

  debug(`WASM plugin ${pluginId} crashed (count: ${plugin.crashCount}): ${error.message}`)

  // Give up after 3 crashes in quick succession
  if (plugin.crashCount >= 3) {
    plugin.status = 'error'
    plugin.errorMessage = 'Plugin repeatedly crashing, automatic restart disabled'
    debug(`Plugin ${pluginId} disabled after 3 crashes`)
    return
  }

  // Schedule restart with exponential backoff
  plugin.restartBackoff = Math.min(plugin.restartBackoff * 2, 30000) // Max 30 seconds

  debug(`Scheduling restart for ${pluginId} in ${plugin.restartBackoff}ms`)

  const timer = setTimeout(async () => {
    try {
      debug(`Attempting automatic restart of ${pluginId}`)
      await reloadWasmPlugin(app, pluginId)
      plugin.statusMessage = 'Recovered from crash'
    } catch (restartError) {
      debug(`Failed to restart ${pluginId}:`, restartError)
      plugin.status = 'error'
      plugin.errorMessage = 'Failed to recover from crash'
    }
  }, plugin.restartBackoff)

  restartTimers.set(pluginId, timer)
}

/**
 * Update WASM plugin configuration
 */
export async function updateWasmPluginConfig(
  app: any,
  pluginId: string,
  configuration: any,
  configPath: string
): Promise<void> {
  const plugin = wasmPlugins.get(pluginId)
  if (!plugin) {
    throw new Error(`WASM plugin ${pluginId} not found`)
  }

  debug(`updateWasmPluginConfig: Starting for ${pluginId}`)
  debug(`updateWasmPluginConfig: New configuration: ${JSON.stringify(configuration)}`)

  plugin.configuration = configuration
  debug(`updateWasmPluginConfig: Updated in-memory configuration`)

  // Save to disk
  const storagePaths = getPluginStoragePaths(configPath, plugin.id, plugin.packageName)
  debug(`updateWasmPluginConfig: Config file path: ${storagePaths.configFile}`)

  const config = {
    enabled: plugin.enabled,
    configuration
  }
  debug(`updateWasmPluginConfig: Writing config to disk: ${JSON.stringify(config)}`)
  writePluginConfig(storagePaths.configFile, config)
  debug(`updateWasmPluginConfig: Config written to disk`)

  // Restart plugin if running
  if (plugin.status === 'running') {
    debug(`updateWasmPluginConfig: Plugin is running, restarting...`)
    await stopWasmPlugin(pluginId)
    debug(`updateWasmPluginConfig: Plugin stopped`)
    await startWasmPlugin(app, pluginId)
    debug(`updateWasmPluginConfig: Plugin started`)
    plugin.statusMessage = 'Configuration updated'
  } else {
    debug(`updateWasmPluginConfig: Plugin not running (status: ${plugin.status}), skipping restart`)
  }

  debug(`updateWasmPluginConfig: Configuration updated for ${pluginId}`)
}

/**
 * Enable/disable a WASM plugin
 */
export async function setWasmPluginEnabled(
  app: any,
  pluginId: string,
  enabled: boolean,
  configPath: string
): Promise<void> {
  const plugin = wasmPlugins.get(pluginId)
  if (!plugin) {
    throw new Error(`WASM plugin ${pluginId} not found`)
  }

  debug(`setWasmPluginEnabled: Starting for ${pluginId}, enabled=${enabled}`)
  debug(`setWasmPluginEnabled: Current state - enabled: ${plugin.enabled}, status: ${plugin.status}`)

  plugin.enabled = enabled
  debug(`setWasmPluginEnabled: Updated in-memory enabled flag to ${enabled}`)

  // Save to disk
  const storagePaths = getPluginStoragePaths(configPath, plugin.id, plugin.packageName)
  debug(`setWasmPluginEnabled: Config file path: ${storagePaths.configFile}`)

  const config = {
    enabled,
    configuration: plugin.configuration
  }
  debug(`setWasmPluginEnabled: Writing config to disk: ${JSON.stringify(config)}`)
  writePluginConfig(storagePaths.configFile, config)
  debug(`setWasmPluginEnabled: Config written to disk`)

  // Start or stop accordingly
  if (enabled && plugin.status !== 'running') {
    debug(`setWasmPluginEnabled: Plugin should be enabled and is not running, starting...`)
    await startWasmPlugin(app, pluginId)
    debug(`setWasmPluginEnabled: Plugin started, new status: ${plugin.status}`)
  } else if (!enabled && plugin.status === 'running') {
    debug(`setWasmPluginEnabled: Plugin should be disabled and is running, stopping...`)
    await stopWasmPlugin(pluginId)
    debug(`setWasmPluginEnabled: Plugin stopped, new status: ${plugin.status}`)
  } else {
    debug(`setWasmPluginEnabled: No action needed - enabled=${enabled}, status=${plugin.status}`)
  }

  debug(`setWasmPluginEnabled: Completed - Plugin ${pluginId} ${enabled ? 'enabled' : 'disabled'}`)
}

/**
 * Get all WASM plugins
 */
export function getAllWasmPlugins(): WasmPlugin[] {
  return Array.from(wasmPlugins.values())
}

/**
 * Get a WASM plugin by ID
 */
export function getWasmPlugin(pluginId: string): WasmPlugin | undefined {
  return wasmPlugins.get(pluginId)
}

/**
 * Shutdown all WASM plugins
 */
export async function shutdownAllWasmPlugins(): Promise<void> {
  debug('Shutting down all WASM plugins')

  // Clear all restart timers
  for (const timer of restartTimers.values()) {
    clearTimeout(timer)
  }
  restartTimers.clear()

  // Stop all plugins
  const plugins = Array.from(wasmPlugins.values())
  for (const plugin of plugins) {
    try {
      if (plugin.status === 'running') {
        await stopWasmPlugin(plugin.id)
      }
    } catch (error) {
      debug(`Error stopping plugin ${plugin.id}:`, error)
    }
  }

  // Shutdown runtime
  const runtime = getWasmRuntime()
  await runtime.shutdown()

  wasmPlugins.clear()
  debug('All WASM plugins shut down')
}

/**
 * Set up REST API routes for a WASM plugin
 */
function setupWasmPluginRoutes(
  app: any,
  plugin: WasmPlugin,
  configPath: string
): void {
  const router = express.Router()

  // GET /plugins/:id - Get plugin info
  router.get('/', (req: Request, res: Response) => {
    res.json({
      enabled: plugin.enabled,
      enabledByDefault: false,
      id: plugin.id,
      name: plugin.name,
      version: plugin.version
    })
  })

  // POST /plugins/:id/config - Save plugin configuration
  router.post('/config', async (req: Request, res: Response) => {
    try {
      debug(`POST /config received for WASM plugin: ${plugin.id}`)
      debug(`Request body: ${JSON.stringify(req.body)}`)

      const newConfig = req.body

      debug(`Current plugin state - enabled: ${plugin.enabled}, configuration: ${JSON.stringify(plugin.configuration)}`)

      // Update plugin configuration
      debug(`Calling updateWasmPluginConfig with: ${JSON.stringify(newConfig.configuration)}`)
      await updateWasmPluginConfig(app, plugin.id, newConfig.configuration, configPath)
      debug(`updateWasmPluginConfig completed`)

      // Update enabled state if changed
      if (typeof newConfig.enabled === 'boolean' && newConfig.enabled !== plugin.enabled) {
        debug(`Updating enabled state from ${plugin.enabled} to ${newConfig.enabled}`)
        await setWasmPluginEnabled(app, plugin.id, newConfig.enabled, configPath)
        debug(`setWasmPluginEnabled completed`)
      } else {
        debug(`Enabled state unchanged: ${plugin.enabled}`)
      }

      debug(`Final plugin state - enabled: ${plugin.enabled}, status: ${plugin.status}`)

      const response = `Saved configuration for plugin ${plugin.id}`
      debug(`Sending response: ${response}`)
      res.json(response)
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      const stack = error instanceof Error ? error.stack : ''
      debug(`ERROR saving WASM plugin config: ${errorMsg}`)
      debug(`Stack trace: ${stack}`)
      console.error(`Error saving WASM plugin config:`, error)
      res.status(500).json({ error: errorMsg })
    }
  })

  // GET /plugins/:id/config - Get plugin configuration
  router.get('/config', (req: Request, res: Response) => {
    const storagePaths = getPluginStoragePaths(configPath, plugin.id, plugin.packageName)
    const config = readPluginConfig(storagePaths.configFile)

    res.json({
      enabled: plugin.enabled,
      configuration: plugin.configuration,
      ...config
    })
  })

  // Register the router for this plugin
  app.use(backwardsCompat(`/plugins/${plugin.id}`), router)
  debug(`Set up REST API routes for WASM plugin: ${plugin.id}`)
}
