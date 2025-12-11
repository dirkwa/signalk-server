---
title: Radar API
---

# Radar API

The Signal K server Radar API provides a unified interface for viewing and controlling marine radar equipment from any manufacturer. The API is **chartplotter-friendly**: clients can build dynamic UIs that automatically adapt to any radar's capabilities without hardcoding support for specific brands or models.

Radar functionality is provided by "provider plugins" that handle the interaction with radar hardware and stream spoke data to connected clients.

Requests to the Radar API are made to HTTP REST endpoints rooted at `/signalk/v2/api/vessels/self/radars`.

## Design Philosophy: Capabilities-Driven API

This API uses a **self-describing schema** pattern that benefits both radar provider developers and client/chartplotter developers.

### For Client/Chartplotter Developers

Build a **single, adaptive UI** that works with any radar—now and in the future—without hardcoding brand-specific logic.

**How it works:**

1. **Fetch capabilities once** when a radar connects — this tells you what the radar can do
2. **Generate UI widgets from the schema:**
   - `type: "boolean"` → Toggle switch
   - `type: "number"` with `range` → Slider with min/max/step
   - `type: "enum"` with `values` → Dropdown or button group
   - `type: "compound"` → Nested panel (e.g., mode selector + value slider)
   - `readOnly: true` → Display-only label (for info like serial number)
3. **Apply constraints dynamically** — gray out controls when conditions are met, show reasons
4. **Poll state for current values** — the schema tells you what to expect

**Example: Rendering a Gain Control**

```typescript
// Capability definition tells you everything needed:
const gainControl = {
  id: 'gain',
  name: 'Gain',
  type: 'compound',
  modes: ['auto', 'manual'],
  properties: {
    mode: { type: 'enum', values: [{ value: 'auto' }, { value: 'manual' }] },
    value: { type: 'number', range: { min: 0, max: 100, unit: 'percent' } }
  }
}

// Your UI renders:
// - Mode toggle: [Auto] [Manual]
// - Value slider: 0 ----[50]---- 100 (disabled when mode=auto)
```

Whether it's a Furuno DRS4D-NXT with 20+ controls or a basic radar with 5 controls, the same client code handles both.

### For Radar Provider Developers (Plugin Authors)

Different manufacturers have vastly different hardware capabilities, control sets, value ranges, and operating modes. Instead of clients hardcoding knowledge about each model, your provider plugin **declares** what the radar can do:

1. **Characteristics** — hardware capabilities (Doppler, dual-range, no-transmit zones, supported ranges)
2. **Controls** — schema for each control (type, valid values, modes, read-only status)
3. **Constraints** — dependencies between controls (e.g., "gain is read-only when preset mode is active")

### Control Categories

| Category       | Description                  | Examples                                                      |
| -------------- | ---------------------------- | ------------------------------------------------------------- |
| `base`         | Available on all radars      | power, range, gain, sea, rain                                 |
| `extended`     | Model-specific features      | dopplerMode, beamSharpening, targetExpansion, noTransmitZones |
| `installation` | Setup/configuration settings | antennaHeight, bearingAlignment                               |

Read-only information (serialNumber, firmwareVersion, operatingHours) is exposed as controls with `readOnly: true`.

_Note: Clients should consider showing `installation` category controls in a separate setup panel, potentially with confirmation dialogs, as these are typically configured once during radar installation._

## API Overview

```
/signalk/v2/api/vessels/self/radars
├── GET                              → List all radar IDs
├── /_providers
│   └── GET                          → List registered providers
└── /{id}
    ├── /capabilities GET            → Get radar schema (characteristics, controls)
    ├── /state GET                   → Get current values for all controls
    ├── /controls
    │   ├── GET                      → Get all control values
    │   ├── PUT                      → Set multiple controls
    │   └── /{controlId}
    │       ├── GET                  → Get single control value
    │       └── PUT                  → Set single control value
    └── /stream                      → WebSocket (binary spoke data)
```

## Radar Information

### Listing All Radars

Retrieve a list of all available radar IDs:

```typescript
HTTP GET "/signalk/v2/api/vessels/self/radars"
```

_Response:_

```json
["Furuno-6424", "Navico-HALO"]
```

### Getting Radar Capabilities

The capability manifest describes everything a radar can do. Clients should fetch this once and cache it.

```typescript
HTTP GET "/signalk/v2/api/vessels/self/radars/{id}/capabilities"
```

_Response:_

```json
{
  "id": "Furuno-6424",
  "make": "Furuno",
  "model": "DRS4D-NXT",
  "modelFamily": "DRS-NXT",
  "serialNumber": "6424",
  "characteristics": {
    "maxRange": 74080,
    "minRange": 50,
    "supportedRanges": [
      50, 75, 100, 250, 500, 750, 1000, 1500, 2000, 3000, 4000, 6000, 8000,
      12000, 16000, 24000, 36000, 48000, 64000, 74080
    ],
    "spokesPerRevolution": 2048,
    "maxSpokeLength": 512,
    "hasDoppler": true,
    "hasDualRange": true,
    "maxDualRange": 22224,
    "noTransmitZoneCount": 2
  },
  "controls": [
    {
      "id": "power",
      "name": "Power",
      "description": "Radar power state",
      "category": "base",
      "type": "enum",
      "values": [
        { "value": "off", "label": "Off" },
        { "value": "standby", "label": "Standby" },
        { "value": "transmit", "label": "Transmit" }
      ]
    },
    {
      "id": "range",
      "name": "Range",
      "description": "Detection range in meters",
      "category": "base",
      "type": "enum",
      "values": [
        { "value": 50, "label": "50m" },
        { "value": 1852, "label": "1nm" },
        { "value": 3704, "label": "2nm" }
      ]
    },
    {
      "id": "gain",
      "name": "Gain",
      "description": "Receiver gain adjustment",
      "category": "base",
      "type": "compound",
      "modes": ["auto", "manual"],
      "defaultMode": "auto",
      "properties": {
        "mode": { "type": "string" },
        "value": {
          "type": "number",
          "range": { "min": 0, "max": 100, "unit": "percent" }
        }
      }
    },
    {
      "id": "serialNumber",
      "name": "Serial Number",
      "description": "Radar hardware serial number",
      "category": "base",
      "type": "string",
      "readOnly": true
    },
    {
      "id": "firmwareVersion",
      "name": "Firmware Version",
      "description": "Radar firmware version",
      "category": "base",
      "type": "string",
      "readOnly": true
    },
    {
      "id": "operatingHours",
      "name": "Operating Hours",
      "description": "Total hours of radar operation",
      "category": "base",
      "type": "number",
      "range": { "min": 0, "max": 999999, "step": 0.1, "unit": "hours" },
      "readOnly": true
    },
    {
      "id": "dopplerMode",
      "name": "Doppler Mode",
      "description": "Target velocity color coding",
      "category": "extended",
      "type": "enum",
      "values": [
        { "value": "off", "label": "Off" },
        { "value": "normal", "label": "Normal" },
        { "value": "approaching", "label": "Approaching Only" }
      ]
    }
  ],
  "constraints": [
    {
      "controlId": "gain",
      "condition": {
        "type": "read_only_when",
        "dependsOn": "presetMode",
        "operator": "!=",
        "value": "custom"
      },
      "effect": {
        "readOnly": true,
        "reason": "Controlled by preset mode"
      }
    }
  ]
}
```

### Getting Radar State

Current values for all controls, plus operational status:

```typescript
HTTP GET "/signalk/v2/api/vessels/self/radars/{id}/state"
```

_Response:_

```json
{
  "id": "Furuno-6424",
  "timestamp": "2025-01-15T10:30:00Z",
  "status": "transmit",
  "controls": {
    "power": "transmit",
    "range": 1852,
    "gain": { "mode": "auto", "value": 50 },
    "sea": { "mode": "auto", "value": 30 },
    "rain": { "mode": "manual", "value": 0 },
    "serialNumber": "6424",
    "firmwareVersion": "01.05",
    "operatingHours": 29410.6,
    "dopplerMode": "normal"
  },
  "disabledControls": []
}
```

## Radar Control

All control operations require appropriate security permissions.

### Setting a Single Control

```typescript
HTTP PUT "/signalk/v2/api/vessels/self/radars/{id}/controls/{controlId}"
```

**Setting power state:**

```typescript
HTTP PUT "/signalk/v2/api/vessels/self/radars/Furuno-6424/controls/power"
```

_Request body:_

```json
{ "value": "transmit" }
```

**Setting range:**

```typescript
HTTP PUT "/signalk/v2/api/vessels/self/radars/Furuno-6424/controls/range"
```

_Request body:_

```json
{ "value": 1852 }
```

**Setting gain (compound control):**

```typescript
HTTP PUT "/signalk/v2/api/vessels/self/radars/Furuno-6424/controls/gain"
```

_Request body:_

```json
{ "value": { "mode": "manual", "value": 75 } }
```

### Setting Multiple Controls

Update multiple controls in a single request:

```typescript
HTTP PUT "/signalk/v2/api/vessels/self/radars/{id}/controls"
```

_Request body:_

```json
{
  "gain": { "mode": "manual", "value": 60 },
  "sea": { "mode": "auto" },
  "rain": { "mode": "manual", "value": 20 }
}
```

## Streaming (WebSocket)

Radar spoke data is streamed via WebSocket as binary frames. The state response includes an optional `streamUrl` field indicating where to connect.

### Connection Logic

```javascript
// Fetch radar state
const state = await fetch(
  '/signalk/v2/api/vessels/self/radars/Furuno-6424/state'
).then((r) => r.json())

// Determine WebSocket URL
const wsUrl =
  state.streamUrl ??
  `ws://${location.host}/signalk/v2/api/vessels/self/radars/${state.id}/stream`

// Connect to stream
const socket = new WebSocket(wsUrl)
socket.binaryType = 'arraybuffer'

socket.onmessage = (event) => {
  const spokeData = new Uint8Array(event.data)
  // Process binary spoke data...
}
```

### Stream URL Patterns

| Scenario          | streamUrl | Description                                |
| ----------------- | --------- | ------------------------------------------ |
| External server   | Present   | High-bandwidth streams bypass Signal K     |
| Integrated plugin | Absent    | Signal K handles everything via `/stream`  |
| WASM plugin       | Present   | Points to dedicated binary stream endpoint |

## Data Types

### CapabilityManifest

```typescript
interface CapabilityManifest {
  id: string
  make: string
  model: string
  modelFamily?: string
  serialNumber?: string
  firmwareVersion?: string
  characteristics: Characteristics
  controls: ControlDefinition[]
  constraints?: ControlConstraint[]
}
```

### Characteristics

```typescript
interface Characteristics {
  maxRange: number // Maximum detection range in meters
  minRange: number // Minimum detection range in meters
  supportedRanges: number[] // Discrete range values in meters
  spokesPerRevolution: number
  maxSpokeLength: number
  hasDoppler: boolean
  hasDualRange: boolean
  maxDualRange?: number // Max range in dual-range mode (meters), omitted if 0
  noTransmitZoneCount: number
}
```

### ControlDefinition

```typescript
interface ControlDefinition {
  id: string // Semantic ID (e.g., "gain", "beamSharpening")
  name: string // Human-readable name
  description: string // Tooltip/help text
  category: 'base' | 'extended' | 'installation'
  type: 'boolean' | 'number' | 'enum' | 'compound' | 'string'
  range?: RangeSpec // For number types
  values?: EnumValue[] // For enum types
  properties?: Record<string, PropertyDefinition> // For compound types
  modes?: string[] // e.g., ["auto", "manual"]
  defaultMode?: string
  readOnly?: boolean // True for info fields
  default?: any
}

interface RangeSpec {
  min: number
  max: number
  step?: number
  unit?: string // e.g., "percent", "meters", "hours"
}

interface EnumValue {
  value: string | number
  label: string
  description?: string
}

interface PropertyDefinition {
  type: string
  description?: string
  range?: RangeSpec
  values?: EnumValue[]
}
```

### RadarState

```typescript
interface RadarState {
  id: string
  timestamp: string // ISO 8601
  status: 'off' | 'standby' | 'transmit' | 'warming'
  controls: Record<string, any>
  disabledControls?: DisabledControl[]
  streamUrl?: string // WebSocket URL for spoke data
}

interface DisabledControl {
  controlId: string
  reason: string
}
```

### ControlConstraint

```typescript
interface ControlConstraint {
  controlId: string
  condition: {
    type: 'disabled_when' | 'read_only_when' | 'restricted_when'
    dependsOn: string // Control ID this depends on
    operator: string // "==", "!=", "<", ">", etc.
    value: any // Value to compare against
  }
  effect: {
    disabled?: boolean
    readOnly?: boolean
    allowedValues?: any[] // Restricted set when condition is met
    reason?: string // Human-readable explanation
  }
}
```

## Providers

The Radar API supports registration of multiple radar provider plugins. All radars from all providers are aggregated under the unified API.

### Listing Available Radar Providers

```typescript
HTTP GET "/signalk/v2/api/vessels/self/radars/_providers"
```

_Response:_

```json
{
  "mayara-radar": {
    "name": "Mayara Radar Plugin"
  },
  "navico-radar": {
    "name": "Navico Radar Provider"
  }
}
```

## Creating a Radar Provider Plugin

To create a radar provider plugin, implement the `RadarProvider` interface:

```typescript
interface RadarProvider {
  name: string
  methods: RadarProviderMethods
}

interface RadarProviderMethods {
  // Required - radar discovery
  getRadars(): Promise<string[]>
  getCapabilities(radarId: string): Promise<CapabilityManifest | null>
  getState(radarId: string): Promise<RadarState | null>

  // Required - control
  setControl(radarId: string, controlId: string, value: any): Promise<boolean>
  setControls(radarId: string, controls: Record<string, any>): Promise<boolean>

  // Optional - streaming (for integrated providers)
  handleStreamConnection?(radarId: string, ws: WebSocket): void
}
```

Register with the server:

```typescript
app.radarApi.register(plugin.id, {
  name: 'My Radar Plugin',
  methods: {
    getRadars: async () => ['radar-1'],
    getCapabilities: async (id) => ({
      id,
      make: 'MyBrand',
      model: 'Model-X',
      characteristics: {
        /* ... */
      },
      controls: [
        /* ... */
      ]
    }),
    getState: async (id) => ({
      id,
      timestamp: new Date().toISOString(),
      status: 'transmit',
      controls: { power: 'transmit', gain: { mode: 'auto', value: 50 } }
    }),
    setControl: async (id, controlId, value) => {
      // Send command to radar hardware
      return true
    },
    setControls: async (id, controls) => {
      // Send multiple commands
      return true
    }
  }
})
```

For WASM plugins, use the `radarProvider` capability and implement the corresponding FFI exports.

## Caching

Radar API responses include `Cache-Control: no-cache` headers. Clients should not cache radar data as it can change at any time:

- **Model identification**: Some radars (e.g., Furuno) identify their model via TCP connection, which happens after initial discovery
- **Status changes**: Radar power state, transmit status can change
- **Control values**: Gain, sea clutter, range, etc. can be modified by the user or other clients

Clients that need to minimize API calls should implement their own caching strategy with appropriate invalidation logic.
