/**
 * Base Plugin class that all AssemblyScript plugins must extend
 */

/**
 * Abstract base class for Signal K WASM plugins
 *
 * Plugins must implement all abstract methods:
 * - id(): Unique plugin identifier
 * - name(): Human-readable plugin name
 * - schema(): JSON schema for configuration UI
 * - start(): Initialize plugin with configuration
 * - stop(): Clean shutdown
 */
export abstract class Plugin {
  /**
   * Return unique plugin identifier (kebab-case recommended)
   */
  abstract id(): string

  /**
   * Return human-readable plugin name
   */
  abstract name(): string

  /**
   * Return JSON schema for configuration UI
   * Must be valid JSON Schema draft-07
   */
  abstract schema(): string

  /**
   * Initialize plugin with configuration
   * @param config JSON string with configuration
   * @returns 0 for success, non-zero for error
   */
  abstract start(config: string): i32

  /**
   * Stop plugin and clean up resources
   * @returns 0 for success, non-zero for error
   */
  abstract stop(): i32
}

/**
 * Plugin configuration interface
 * Extend this for type-safe configuration
 */
export class PluginConfig {
  enabled: bool = true
}
