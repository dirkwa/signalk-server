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
// v5 API Types
// ============================================================================

/**
 * Hardware characteristics of a radar.
 *
 * @category Radar API
 */
export interface RadarCharacteristics {
  /** Maximum detection range in meters */
  maxRange: number
  /** Minimum detection range in meters */
  minRange: number
  /** Supported discrete range values in meters */
  supportedRanges: number[]
  /** Number of spokes per full rotation */
  spokesPerRevolution: number
  /** Maximum spoke length in samples */
  maxSpokeLength: number
  /** Whether the radar supports Doppler/motion detection */
  hasDoppler: boolean
  /** Whether the radar supports dual-range mode */
  hasDualRange: boolean
  /** Maximum range for dual-range mode (if supported) */
  maxDualRange?: number
  /** Number of no-transmit zones supported */
  noTransmitZoneCount: number
}

/**
 * Control definition describing a radar control.
 *
 * @category Radar API
 */
export interface ControlDefinitionV5 {
  /** Semantic control ID (e.g., "gain", "beamSharpening") */
  id: string
  /** Human-readable name */
  name: string
  /** Description for tooltips */
  description: string
  /** Category: base controls all radars have, extended are model-specific */
  category: 'base' | 'extended'
  /** Control value type */
  type: 'boolean' | 'number' | 'enum' | 'compound'

  /** For type: "number" - value range constraints */
  range?: {
    min: number
    max: number
    step?: number
    unit?: string
  }

  /** For type: "enum" - allowed values */
  values?: Array<{
    value: string | number
    label: string
    description?: string
  }>

  /** For type: "compound" - property definitions */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  properties?: Record<string, any>

  /** Supported modes (auto/manual) */
  modes?: ('auto' | 'manual')[]
  /** Default mode */
  defaultMode?: 'auto' | 'manual'

  /** Whether this control is read-only */
  readOnly?: boolean
  /** Default value */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  default?: any
}

/**
 * Control constraint describing dependencies between controls.
 *
 * @category Radar API
 */
export interface ControlConstraint {
  /** Control ID this constraint applies to */
  controlId: string

  /** Condition that triggers the constraint */
  condition: {
    type: 'disabled_when' | 'read_only_when' | 'restricted_when'
    dependsOn: string
    operator: '==' | '!=' | '>' | '<' | '>=' | '<='
    value: string | number | boolean
  }

  /** Effect when condition is true */
  effect: {
    disabled?: boolean
    readOnly?: boolean
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    allowedValues?: any[]
    reason?: string
  }
}

/**
 * Capability manifest describing what a radar can do.
 * This is cacheable - capabilities rarely change at runtime.
 *
 * @category Radar API
 *
 * @example
 * ```json
 * {
 *   "id": "1",
 *   "make": "Furuno",
 *   "model": "DRS4D-NXT",
 *   "characteristics": {
 *     "maxRange": 88896,
 *     "minRange": 116,
 *     "supportedRanges": [116, 231, 463, ...],
 *     "hasDoppler": true
 *   },
 *   "controls": [
 *     {"id": "power", "type": "enum", ...},
 *     {"id": "gain", "type": "compound", ...}
 *   ]
 * }
 * ```
 */
export interface CapabilityManifest {
  /** Radar ID */
  id: string
  /** Manufacturer name */
  make: string
  /** Model name */
  model: string

  /** Model family (optional) */
  modelFamily?: string
  /** Serial number (optional) */
  serialNumber?: string
  /** Firmware version (optional) */
  firmwareVersion?: string

  /** Hardware characteristics */
  characteristics: RadarCharacteristics

  /** Available controls with their schemas */
  controls: ControlDefinitionV5[]

  /** Control dependencies/constraints */
  constraints?: ControlConstraint[]
}

/**
 * Current radar state in v5 format.
 * Contains status and all current control values.
 *
 * @category Radar API
 *
 * @example
 * ```json
 * {
 *   "id": "1",
 *   "timestamp": "2025-01-15T10:30:00Z",
 *   "status": "transmit",
 *   "controls": {
 *     "power": "transmit",
 *     "range": 5556,
 *     "gain": {"mode": "auto", "value": 65}
 *   }
 * }
 * ```
 */
export interface RadarStateV5 {
  /** Radar ID */
  id: string
  /** ISO 8601 timestamp of when state was captured */
  timestamp: string
  /** Current operational status */
  status: RadarStatus

  /** Current control values keyed by control ID */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  controls: Record<string, any>

  /** Controls that are currently disabled and why */
  disabledControls?: Array<{
    controlId: string
    reason: string
  }>
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
   * Set radar sea clutter.
   * @param radarId The radar ID
   * @param sea Sea clutter settings
   * @returns true on success
   */
  setSea?: (
    radarId: string,
    sea: { auto: boolean; value?: number }
  ) => Promise<boolean>

  /**
   * Set radar rain clutter.
   * @param radarId The radar ID
   * @param rain Rain clutter settings
   * @returns true on success
   */
  setRain?: (
    radarId: string,
    rain: { auto: boolean; value?: number }
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

  // ============================================
  // v5 API Methods
  // ============================================

  /**
   * Get capability manifest for a radar (v5).
   * Returns detailed capabilities including supported controls, ranges, features.
   * @param radarId The radar ID
   * @returns CapabilityManifest or null if not found
   */
  getCapabilities?: (radarId: string) => Promise<CapabilityManifest | null>

  /**
   * Get current radar state in v5 format.
   * Returns status and all current control values.
   * @param radarId The radar ID
   * @returns RadarState or null if not found
   */
  getState?: (radarId: string) => Promise<RadarStateV5 | null>

  /**
   * Get a single control value (v5).
   * @param radarId The radar ID
   * @param controlId The semantic control ID (e.g., "gain", "beamSharpening")
   * @returns Control value or null if not found
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getControl?: (radarId: string, controlId: string) => Promise<any | null>

  /**
   * Set a single control value (v5).
   * @param radarId The radar ID
   * @param controlId The semantic control ID (e.g., "gain", "beamSharpening")
   * @param value The value to set
   * @returns Result with success flag and optional error
   */
  setControl?: (
    radarId: string,
    controlId: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    value: any
  ) => Promise<{ success: boolean; error?: string }>
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
