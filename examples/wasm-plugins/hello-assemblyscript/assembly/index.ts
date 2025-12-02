/**
 * Hello World - AssemblyScript WASM Plugin
 *
 * Demonstrates basic AssemblyScript plugin structure for Signal K
 */

import {
  Plugin,
  Delta,
  Update,
  PathValue,
  Source,
  Notification,
  NotificationState,
  emit,
  setStatus,
  setError,
  debug,
  getCurrentTimestamp
} from '../../../../packages/assemblyscript-plugin-sdk/assembly/index'

/**
 * Plugin configuration interface
 */
class HelloConfig {
  message: string = 'Hello from AssemblyScript!'
  updateInterval: i32 = 5000
}

/**
 * Hello World Plugin Implementation
 */
export class HelloPlugin extends Plugin {
  private config: HelloConfig = new HelloConfig()

  /**
   * Plugin ID - must be unique
   */
  id(): string {
    return 'hello-assemblyscript'
  }

  /**
   * Plugin name shown in admin UI
   */
  name(): string {
    return 'Hello AssemblyScript Plugin'
  }

  /**
   * JSON schema for configuration UI
   */
  schema(): string {
    return `{
      "type": "object",
      "properties": {
        "message": {
          "type": "string",
          "title": "Welcome Message",
          "default": "Hello from AssemblyScript!"
        },
        "updateInterval": {
          "type": "number",
          "title": "Update Interval (ms)",
          "default": 5000
        }
      }
    }`
  }

  /**
   * Start plugin with configuration
   */
  start(configJson: string): i32 {
    debug('========================================')
    debug('Hello AssemblyScript plugin starting...')
    debug(`Plugin ID: ${this.id()}`)
    debug(`Plugin Name: ${this.name()}`)
    debug(`Configuration received: ${configJson}`)
    debug('========================================')

    // Parse configuration
    // Note: AssemblyScript JSON parsing would need a JSON library
    // For now, using default config
    // In production, use a JSON parser like assemblyscript-json

    setStatus('Started successfully')
    debug('Status set to: Started successfully')

    // Emit a welcome notification
    debug('Emitting welcome notification...')
    this.emitWelcomeNotification()

    // Emit a test delta
    debug('Emitting test delta with plugin info...')
    this.emitTestDelta()

    debug('========================================')
    debug('Hello AssemblyScript plugin started successfully!')
    debug('========================================')
    return 0 // Success
  }

  /**
   * Stop plugin
   */
  stop(): i32 {
    debug('========================================')
    debug('Hello AssemblyScript plugin stopping...')
    debug(`Plugin ID: ${this.id()}`)
    setStatus('Stopped')
    debug('Status set to: Stopped')
    debug('Hello AssemblyScript plugin stopped successfully!')
    debug('========================================')
    return 0 // Success
  }

  /**
   * Emit a welcome notification
   */
  private emitWelcomeNotification(): void {
    debug('Building welcome notification...')
    const notification = new Notification(
      NotificationState.normal,
      this.config.message
    )

    const source = new Source(this.id(), 'plugin')
    const timestamp = getCurrentTimestamp()
    debug(`Timestamp: ${timestamp}`)

    const pathValue = new PathValue(
      'notifications.hello',
      notification.toJSON()
    )

    const update = new Update(source, timestamp, [pathValue])
    const delta = new Delta('vessels.self', [update])

    emit(delta)
    debug('✓ Welcome notification emitted to path: notifications.hello')
  }

  /**
   * Emit a test delta with plugin information
   */
  private emitTestDelta(): void {
    debug('Building plugin info delta...')
    const pluginInfo = `{
      "name": "${this.name()}",
      "id": "${this.id()}",
      "language": "AssemblyScript",
      "version": "0.1.0"
    }`

    const source = new Source(this.id(), 'plugin')
    const timestamp = getCurrentTimestamp()
    debug(`Timestamp: ${timestamp}`)

    const pathValue = new PathValue(
      'plugins.hello-assemblyscript.info',
      pluginInfo
    )

    const update = new Update(source, timestamp, [pathValue])
    const delta = new Delta('vessels.self', [update])

    emit(delta)
    debug('✓ Plugin info delta emitted to path: plugins.hello-assemblyscript.info')
  }
}

// Export plugin instance
// Signal K server will call the exported functions
const plugin = new HelloPlugin()

// Plugin lifecycle exports
export function plugin_id(): string {
  return plugin.id()
}

export function plugin_name(): string {
  return plugin.name()
}

export function plugin_schema(): string {
  return plugin.schema()
}

export function plugin_start(configPtr: usize, configLen: usize): i32 {
  // Read config string from memory
  const len = i32(configLen)
  const configBytes = new Uint8Array(len)
  for (let i: i32 = 0; i < len; i++) {
    configBytes[i] = load<u8>(configPtr + <usize>i)
  }
  const configJson = String.UTF8.decode(configBytes.buffer)

  return plugin.start(configJson)
}

export function plugin_stop(): i32 {
  return plugin.stop()
}
