---
title: Radar API
---

# Radar API

> [!WARNING]
> **STILL IN DEVELOPMENT** - This API is experimental and subject to change.

The Signal K server Radar API provides a common set of operations for viewing and controlling marine radar equipment via a "provider plugin". The provider plugin facilitates the interaction with the radar hardware and streams spoke data to connected clients.

Requests to the Radar API are made to HTTP REST endpoints rooted at `/signalk/v2/api/vessels/self/radars`.

## API Overview

```
/signalk/v2/api/vessels/self/radars
├── GET                         → List all radars with metadata
├── /_providers                 → GET list providers, manage default
│   ├── GET                     → List registered providers
│   ├── /_default
│   │   ├── GET                 → Get default provider ID
│   │   └── /{id} POST          → Set default provider
├── /{id}
│   ├── GET                     → Get radar info (status, range, controls, streamUrl)
│   ├── PUT                     → Set all controls
│   ├── /power PUT              → Set power state
│   ├── /range PUT              → Set range
│   ├── /gain PUT               → Set gain
│   └── /stream                 → WebSocket (binary spoke data)
```

## Radar Information

### Listing All Radars

To retrieve a list of all available radars from all providers:

```typescript
HTTP GET "/signalk/v2/api/vessels/self/radars"
```

_Response:_

```json
[
  {
    "id": "radar-0",
    "name": "Furuno DRS4D-NXT",
    "brand": "Furuno",
    "status": "transmit",
    "spokesPerRevolution": 2048,
    "maxSpokeLen": 1024,
    "range": 2000,
    "controls": {
      "gain": { "auto": false, "value": 50 },
      "sea": { "auto": true, "value": 30 }
    },
    "legend": [
      { "color": "#00ff00", "label": "Strong", "minValue": 200 },
      { "color": "#ffff00", "label": "Medium", "minValue": 100 }
    ],
    "streamUrl": "ws://192.168.1.100:3001/stream"
  }
]
```

### Getting a Specific Radar

```typescript
HTTP GET "/signalk/v2/api/vessels/self/radars/{id}"
```

_Example:_

```typescript
HTTP GET "/signalk/v2/api/vessels/self/radars/radar-0"
```

## Radar Control

All control operations require appropriate security permissions.

### Setting Power State

```typescript
HTTP PUT "/signalk/v2/api/vessels/self/radars/{id}/power"
```

_Request body:_

```json
{
  "value": "transmit"
}
```

Valid power states: `off`, `standby`, `transmit`, `warming`

### Setting Range

```typescript
HTTP PUT "/signalk/v2/api/vessels/self/radars/{id}/range"
```

_Request body:_

```json
{
  "value": 2000
}
```

The value is the range in meters (must be a positive number).

### Setting Gain

```typescript
HTTP PUT "/signalk/v2/api/vessels/self/radars/{id}/gain"
```

_Request body:_

```json
{
  "auto": false,
  "value": 50
}
```

### Setting All Controls

To update multiple controls at once:

```typescript
HTTP PUT "/signalk/v2/api/vessels/self/radars/{id}"
```

_Request body:_

```json
{
  "value": {
    "gain": { "auto": false, "value": 60 },
    "sea": { "auto": true },
    "rain": { "value": 20 }
  }
}
```

## Streaming (WebSocket)

Radar spoke data is streamed via WebSocket as binary frames. The connection URL depends on whether the radar provider specifies an external stream URL.

### The streamUrl Pattern

The `RadarInfo` object includes an optional `streamUrl` field:

```typescript
interface RadarInfo {
  id: string
  name: string
  brand?: string
  status: 'off' | 'standby' | 'transmit' | 'warming'
  spokesPerRevolution: number
  maxSpokeLen: number
  range: number
  controls: RadarControls
  legend?: LegendEntry[]
  streamUrl?: string // Optional - if absent, use /radars/{id}/stream
}
```

### When streamUrl is Present (External)

- Client connects directly to the external server (e.g., mayara-server, radar-server)
- Signal K handles only metadata and control endpoints
- Lower latency for high-bandwidth spoke data
- Signal K server not burdened with binary streaming

### When streamUrl is Absent (Integrated)

- Client connects to `/radars/{id}/stream` on Signal K
- Signal K proxies or generates the stream
- Simpler deployment (single server)
- Works for WASM plugins that handle everything internally

### Client Connection Logic

```javascript
// Fetch radar info
const radar = await fetch('/signalk/v2/api/vessels/self/radars/radar-0').then(
  (r) => r.json()
)

// Determine WebSocket URL
const wsUrl =
  radar.streamUrl ??
  `ws://${location.host}/signalk/v2/api/vessels/self/radars/${radar.id}/stream`

// Connect to stream
const socket = new WebSocket(wsUrl)
socket.binaryType = 'arraybuffer'

socket.onmessage = (event) => {
  const spokeData = new Uint8Array(event.data)
  // Process binary spoke data...
}
```

### Benefits of This Pattern

| Scenario            | streamUrl | Description                                     |
| ------------------- | --------- | ----------------------------------------------- |
| External server     | Present   | High-bandwidth streams bypass Signal K          |
| Integrated plugin   | Absent    | Signal K handles everything                     |
| Hybrid              | Either    | Flexibility for different deployment topologies |
| Backward compatible | Present   | Works with existing external radar servers      |
| Future-proof        | Absent    | When WASM can handle full streaming, omit it    |

## Data Types

### RadarInfo

| Field                 | Type          | Required | Description                     |
| --------------------- | ------------- | -------- | ------------------------------- |
| `id`                  | string        | Yes      | Unique radar identifier         |
| `name`                | string        | Yes      | Display name                    |
| `brand`               | string        | No       | Manufacturer/brand              |
| `status`              | RadarStatus   | Yes      | Current operational status      |
| `spokesPerRevolution` | number        | Yes      | Number of spokes per rotation   |
| `maxSpokeLen`         | number        | Yes      | Maximum spoke length in samples |
| `range`               | number        | Yes      | Current range in meters         |
| `controls`            | RadarControls | Yes      | Current control settings        |
| `legend`              | LegendEntry[] | No       | Color legend for display        |
| `streamUrl`           | string        | No       | WebSocket URL for spoke stream  |

### RadarStatus

```typescript
type RadarStatus = 'off' | 'standby' | 'transmit' | 'warming'
```

### RadarControls

```typescript
interface RadarControls {
  gain: RadarControlValue // Required
  sea?: RadarControlValue // Optional sea clutter
  rain?: { value: number } // Optional rain clutter
  interferenceRejection?: { value: number }
  targetExpansion?: { value: number }
  targetBoost?: { value: number }
  [key: string]: RadarControlValue | { value: number } | undefined
}

interface RadarControlValue {
  auto: boolean
  value: number
}
```

### LegendEntry

```typescript
interface LegendEntry {
  color: string
  label: string
  minValue?: number
  maxValue?: number
}
```

## Providers

The Radar API supports the registration of multiple radar provider plugins.

The first plugin registered is set as the _default_ provider and all requests will be directed to it.

### Listing Available Radar Providers

```typescript
HTTP GET "/signalk/v2/api/vessels/self/radars/_providers"
```

_Response:_

```json
{
  "mayara-radar": {
    "name": "Mayara Radar Plugin",
    "isDefault": true
  },
  "furuno-plugin": {
    "name": "Furuno Radar Provider",
    "isDefault": false
  }
}
```

### Getting the Default Provider

```typescript
HTTP GET "/signalk/v2/api/vessels/self/radars/_providers/_default"
```

_Response:_

```json
{
  "id": "mayara-radar"
}
```

### Setting the Default Provider

```typescript
HTTP POST "/signalk/v2/api/vessels/self/radars/_providers/_default/{id}"
```

_Example:_

```typescript
HTTP POST "/signalk/v2/api/vessels/self/radars/_providers/_default/furuno-plugin"
```

## Creating a Radar Provider Plugin

To create a radar provider plugin, implement the `RadarProvider` interface:

```typescript
interface RadarProvider {
  name: string
  methods: RadarProviderMethods
}

interface RadarProviderMethods {
  // Required
  getRadars(): Promise<string[]>
  getRadarInfo(radarId: string): Promise<RadarInfo | null>

  // Optional control methods
  setPower?(radarId: string, state: RadarStatus): Promise<boolean>
  setRange?(radarId: string, range: number): Promise<boolean>
  setGain?(
    radarId: string,
    gain: { auto: boolean; value?: number }
  ): Promise<boolean>
  setControls?(
    radarId: string,
    controls: Partial<RadarControls>
  ): Promise<boolean>

  // Optional streaming (for integrated providers)
  handleStreamConnection?(radarId: string, ws: WebSocket): void
}
```

Register with the server:

```typescript
app.radarApi.register(plugin.id, {
  name: 'My Radar Plugin',
  methods: {
    getRadars: async () => ['radar-0'],
    getRadarInfo: async (id) => ({
      /* ... */
    }),
    setPower: async (id, state) => {
      /* ... */
    }
    // ...
  }
})
```

For WASM plugins, use the `radarProvider` capability and implement the corresponding FFI exports.
