/**
 * Radar API Types
 *
 * Types and interfaces for the Signal K Radar API at
 * /signalk/v2/api/vessels/self/radars
 */

// ============================================================================
// Radar Status Types
// ============================================================================

/** @category Radar API */
export type RadarStatus = 'off' | 'standby' | 'transmit' | 'warming'

// ============================================================================
// Radar Control Types
// ============================================================================

/** @category Radar API */
export interface RadarControlValue {
  auto: boolean
  value: number
}

/** @category Radar API */
export interface RadarControls {
  gain: RadarControlValue
  sea?: RadarControlValue
  rain?: { value: number }
  interferenceRejection?: { value: number }
  targetExpansion?: { value: number }
  targetBoost?: { value: number }
  // Extensible for radar-specific controls
  [key: string]: RadarControlValue | { value: number } | undefined
}

/** @category Radar API */
export interface LegendEntry {
  color: string
  label: string
  minValue?: number
  maxValue?: number
}

// ============================================================================
// Radar Info (Response Object)
// ============================================================================

/**
 * Radar information returned by GET /radars/{id}
 *
 * @category Radar API
 *
 * @example
 * ```json
 * {
 *   "id": "radar-0",
 *   "name": "Furuno DRS4D-NXT",
 *   "brand": "Furuno",
 *   "status": "transmit",
 *   "spokesPerRevolution": 2048,
 *   "maxSpokeLen": 1024,
 *   "range": 2000,
 *   "controls": {
 *     "gain": { "auto": false, "value": 50 },
 *     "sea": { "auto": true, "value": 30 }
 *   },
 *   "streamUrl": "ws://192.168.1.100:3001/v1/api/stream/radar-0"
 * }
 * ```
 */
export interface RadarInfo {
  /** Unique identifier for this radar */
  id: string
  /** Display name */
  name: string
  /** Radar brand/manufacturer */
  brand?: string
  /** Current operational status */
  status: RadarStatus
  /** Number of spokes per full rotation */
  spokesPerRevolution: number
  /** Maximum spoke length in samples */
  maxSpokeLen: number
  /** Current range in meters */
  range: number
  /** Current control settings */
  controls: RadarControls
  /** Color legend for radar display */
  legend?: LegendEntry[]
  /**
   * WebSocket URL for radar spoke streaming.
   *
   * - If **absent**: Clients use the built-in stream endpoint:
   *   `ws://server/signalk/v2/api/vessels/self/radars/{id}/stream`
   *   or `ws://server/signalk/v2/api/streams/radars/{id}`
   *   (WASM plugins emit spokes via `sk_radar_emit_spokes()` FFI binding)
   *
   * - If **present**: Clients connect directly to external URL (backward compat)
   *   @example "ws://192.168.1.100:3001/stream" (external mayara-server)
   */
  streamUrl?: string
}

// ============================================================================
// Radar Provider Interface (for plugins)
// ============================================================================

/**
 * Provider interface for plugins that provide radar data.
 *
 * @category Radar API
 *
 * @example
 * ```javascript
 * app.registerRadarProvider({
 *   name: 'Furuno Radar Plugin',
 *   methods: {
 *     getRadars: async () => ['radar-0'],
 *     getRadarInfo: async (id) => ({
 *       id: 'radar-0',
 *       name: 'Furuno DRS4D-NXT',
 *       status: 'transmit',
 *       spokesPerRevolution: 2048,
 *       maxSpokeLen: 1024,
 *       range: 2000,
 *       controls: { gain: { auto: false, value: 50 } },
 *       streamUrl: 'ws://192.168.1.100:3001/stream'
 *     }),
 *     setPower: async (id, state) => { ... },
 *     setRange: async (id, range) => { ... },
 *     setGain: async (id, gain) => { ... }
 *   }
 * })
 * ```
 */
export interface RadarProvider {
  /** Display name for this radar provider */
  name: string
  /** Provider methods */
  methods: RadarProviderMethods
}

/** @category Radar API */
export interface RadarProviderMethods {
  /** Plugin ID (set automatically on registration) */
  pluginId?: string

  /**
   * Get list of radar IDs this provider manages.
   * @returns Array of radar IDs
   */
  getRadars: () => Promise<string[]>

  /**
   * Get detailed info for a specific radar.
   * @param radarId The radar ID
   * @returns Radar info or null if not found
   */
  getRadarInfo: (radarId: string) => Promise<RadarInfo | null>

  /**
   * Set radar power state.
   * @param radarId The radar ID
   * @param state Target power state
   * @returns true on success
   */
  setPower?: (radarId: string, state: RadarStatus) => Promise<boolean>

  /**
   * Set radar range in meters.
   * @param radarId The radar ID
   * @param range Range in meters
   * @returns true on success
   */
  setRange?: (radarId: string, range: number) => Promise<boolean>

  /**
   * Set radar gain.
   * @param radarId The radar ID
   * @param gain Gain settings
   * @returns true on success
   */
  setGain?: (
    radarId: string,
    gain: { auto: boolean; value?: number }
  ) => Promise<boolean>

  /**
   * Set multiple radar controls at once.
   * @param radarId The radar ID
   * @param controls Partial controls to update
   * @returns true on success
   */
  setControls?: (
    radarId: string,
    controls: Partial<RadarControls>
  ) => Promise<boolean>

  /**
   * Handle WebSocket stream connection (optional).
   * Only needed if provider doesn't expose external streamUrl.
   * @param radarId The radar ID
   * @param ws WebSocket connection to send spoke data to
   */
  handleStreamConnection?: (radarId: string, ws: WebSocket) => void
}

// ============================================================================
// Radar API Interface
// ============================================================================

/**
 * Radar API methods available on the server.
 *
 * @category Radar API
 */
export interface RadarApi {
  /** Register a radar provider plugin */
  register: (pluginId: string, provider: RadarProvider) => void
  /** Unregister a radar provider plugin */
  unRegister: (pluginId: string) => void
  /** Get list of all radars from all providers */
  getRadars: () => Promise<RadarInfo[]>
  /** Get info for a specific radar */
  getRadarInfo: (radarId: string) => Promise<RadarInfo | null>
}

/**
 * Registry interface exposed to plugins via ServerAPI.
 *
 * @category Radar API
 */
export interface RadarProviderRegistry {
  /**
   * Register a radar provider plugin.
   * See Radar Provider Plugins documentation for details.
   *
   * @category Radar API
   */
  registerRadarProvider: (provider: RadarProvider) => void
  /**
   * Access the Radar API to get radar info and manage radars.
   *
   * @category Radar API
   */
  radarApi: RadarApi
}

/**
 * List of registered radar providers (for /_providers endpoint)
 *
 * @hidden visible through API
 * @category Radar API
 */
export interface RadarProviders {
  [id: string]: {
    name: string
    isDefault: boolean
  }
}

// ============================================================================
// Validation
// ============================================================================

/**
 * Type guard to validate a RadarProvider object.
 *
 * @category Radar API
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const isRadarProvider = (obj: any): obj is RadarProvider => {
  const typedObj = obj
  return (
    ((typedObj !== null && typeof typedObj === 'object') ||
      typeof typedObj === 'function') &&
    typeof typedObj['name'] === 'string' &&
    ((typedObj['methods'] !== null &&
      typeof typedObj['methods'] === 'object') ||
      typeof typedObj['methods'] === 'function') &&
    (typeof typedObj['methods']['pluginId'] === 'undefined' ||
      typeof typedObj['methods']['pluginId'] === 'string') &&
    typeof typedObj['methods']['getRadars'] === 'function' &&
    typeof typedObj['methods']['getRadarInfo'] === 'function'
  )
}
