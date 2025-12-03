# Charts Provider (Go) - Signal K WASM Plugin

A Go/TinyGo WASM plugin that provides MBTiles chart support for Signal K Server.

## Features

- **Resource Provider**: Registers as a `charts` resource provider for Signal K
- **MBTiles Support**: Serves raster tiles from MBTiles files
- **Web Interface**: HTML frontend for uploading and managing charts
- **Delta Notifications**: Emits Signal K deltas when charts are added/removed
- **Go/TinyGo**: Demonstrates Go WASM plugin development for Signal K

## Architecture

This plugin uses a **hybrid architecture**:

```
┌──────────────────┐     ┌─────────────────────────┐
│  WASM Plugin     │     │  Node.js Host           │
│  (Go/TinyGo)     │     │  (SQLite/File I/O)      │
├──────────────────┤     ├─────────────────────────┤
│ - Resource API   │────▶│ - MBTiles file storage  │
│ - Delta emission │     │ - SQLite tile reading   │
│ - Chart metadata │     │ - File upload handling  │
└──────────────────┘     └─────────────────────────┘
```

- **Go WASM**: Handles resource provider registration, metadata, and deltas
- **Node.js**: Handles SQLite access (tile serving) and file uploads

This pattern is necessary because WASM cannot access native SQLite.

### SQLite Dependency

The Node.js host uses `better-sqlite3` for reading tiles from MBTiles files.
This is an optional dependency - if not installed, tile serving won't work but the plugin will still load.

```bash
# Install SQLite support (from Signal K server root)
npm install better-sqlite3
```

## Installation

### Prerequisites

- [TinyGo](https://tinygo.org/getting-started/install/) 0.30+ installed
- Signal K Server 2.18.0+wasm4 or later with WASM plugin support
- `better-sqlite3` npm package (optional dependency for tile serving)

### Build

```bash
cd examples/wasm-plugins/charts-provider-go

# Build WASM binary
tinygo build -o plugin.wasm -target=wasip1 -gc=leaking -no-debug main.go

# Or use npm script
npm run build
```

### Install to Signal K

```bash
# Copy to Signal K plugins directory
mkdir -p ~/.signalk/node_modules/@signalk/charts-provider-go
cp plugin.wasm package.json public/ ~/.signalk/node_modules/@signalk/charts-provider-go/
```

## Usage

### Web Interface

Access the chart manager at:
```
http://localhost:3000/plugins/charts-provider-go/
```

### API Endpoints

#### Resource API (via Signal K)
```bash
# List all charts
curl http://localhost:3000/signalk/v2/api/resources/charts

# Get specific chart
curl http://localhost:3000/signalk/v2/api/resources/charts/my-chart
```

#### Plugin Endpoints
```bash
# Get plugin status
curl http://localhost:3000/plugins/charts-provider-go/api/status

# Upload a chart
curl -F "chart=@myfile.mbtiles" -F "name=My Chart" \
     http://localhost:3000/plugins/charts-provider-go/api/charts/upload

# Delete a chart
curl -X DELETE http://localhost:3000/plugins/charts-provider-go/api/charts/my-chart
```

#### Tile Serving
```bash
# Get a tile (z/x/y)
curl http://localhost:3000/plugins/charts-provider-go/tiles/my-chart/10/512/384
```

### Using with Freeboard-SK

Charts registered by this plugin appear automatically in Freeboard-SK and other
Signal K chart clients. The tile URL format is:

```
/plugins/charts-provider-go/tiles/{chartId}/{z}/{x}/{y}
```

## MBTiles Format

MBTiles is a SQLite database format for storing map tiles:

- **Format**: SQLite database with `.mbtiles` extension
- **Tiles**: PNG or JPEG images stored in the `tiles` table
- **Metadata**: Name, bounds, zoom levels in the `metadata` table

### Where to Get MBTiles Charts

- [OpenSeaMap](https://openseamap.org) - Free nautical charts
- [ChartWork](https://www.chartwork.io) - Chart conversion tools
- [GDAL](https://gdal.org) - Convert various formats to MBTiles

## Development

### Building TinyGo WASM

```bash
# Debug build (larger, with debug info)
tinygo build -o plugin.wasm -target=wasip1 main.go

# Release build (smaller, optimized)
tinygo build -o plugin.wasm -target=wasip1 -gc=leaking -no-debug main.go
```

### FFI Imports

The plugin imports these host functions from Signal K:

```go
//go:wasmimport env sk_debug
func sk_debug(ptr *byte, len uint32)

//go:wasmimport env sk_set_status
func sk_set_status(ptr *byte, len uint32)

//go:wasmimport env sk_handle_message
func sk_handle_message(ptr *byte, len uint32)

//go:wasmimport env sk_register_resource_provider
func sk_register_resource_provider(ptr *byte, len uint32) int32
```

### Exports

The plugin exports these functions:

| Export | Description |
|--------|-------------|
| `allocate` | Memory allocation for string passing |
| `deallocate` | Memory deallocation |
| `plugin_id` | Returns plugin ID |
| `plugin_name` | Returns plugin name |
| `plugin_schema` | Returns JSON schema |
| `plugin_start` | Initialize plugin |
| `plugin_stop` | Stop plugin |
| `http_endpoints` | Custom HTTP endpoint definitions |
| `resource_list` | List all charts |
| `resource_get` | Get chart metadata |
| `resource_set` | Update chart metadata |
| `resource_delete` | Remove chart |

## Delta Notifications

When charts are added/removed, the plugin emits Signal K deltas:

```json
{
  "updates": [{
    "values": [{
      "path": "resources.charts.my-chart",
      "value": {
        "identifier": "my-chart",
        "name": "My Chart",
        "tilemapUrl": "/plugins/charts-provider-go/tiles/my-chart/{z}/{x}/{y}",
        "bounds": [3.0, 51.0, 10.0, 56.0],
        "minzoom": 5,
        "maxzoom": 16,
        "format": "mbtiles",
        "type": "baselayer"
      }
    }]
  }]
}
```

For deletions, `value` is `null`.

## Configuration

Configuration schema:

```json
{
  "type": "object",
  "properties": {
    "chartsDirectory": {
      "type": "string",
      "description": "Directory for MBTiles files (relative to VFS)",
      "default": "charts"
    }
  }
}
```

## Capabilities

```json
{
  "wasmCapabilities": {
    "network": false,
    "storage": "vfs-only",
    "dataRead": true,
    "dataWrite": true,
    "httpEndpoints": true,
    "resourceProvider": true
  }
}
```

## License

Apache-2.0

## See Also

- [Signal K WASM Plugin Guide](../../../wasm/WASM_PLUGIN_DEV_GUIDE.md)
- [TinyGo Documentation](https://tinygo.org/docs/)
- [MBTiles Specification](https://github.com/mapbox/mbtiles-spec)
