/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * MBTiles Hybrid Handler for WASM Charts Provider
 *
 * Handles MBTiles file operations that cannot be done in WASM:
 * - Tile serving (requires SQLite access)
 * - File upload (multipart form data)
 * - Metadata extraction from MBTiles files
 *
 * This follows the "hybrid" pattern used by signalk-logviewer.
 */

import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { Request, Response } from 'express'
import busboy from 'busboy'
import Debug from 'debug'
import { WasmPlugin } from '../loader/types'
import { getPluginStoragePaths } from '../wasm-storage'

const debug = Debug('signalk:wasm:mbtiles')

// We'll dynamically import better-sqlite3 only when needed
let Database: any = null

/**
 * Get better-sqlite3 Database class (lazy load)
 */
function getBetterSqlite3(): any {
  if (Database === null) {
    try {
      // better-sqlite3 is a native module, may not be available
      Database = require('better-sqlite3')
    } catch (e) {
      debug(`better-sqlite3 not available: ${e}`)
      throw new Error(
        'SQLite support not available. Install better-sqlite3: npm install better-sqlite3'
      )
    }
  }
  return Database
}

/**
 * Get the charts directory for a plugin
 */
function getChartsDirectory(plugin: WasmPlugin, configPath: string): string {
  // Use the same storage path logic as the rest of the WASM infrastructure
  const storagePaths = getPluginStoragePaths(
    configPath,
    plugin.id,
    plugin.packageName
  )
  const chartsDir = path.join(storagePaths.vfsRoot, 'charts')

  // Ensure directory exists
  if (!fs.existsSync(chartsDir)) {
    fs.mkdirSync(chartsDir, { recursive: true })
  }

  return chartsDir
}

/**
 * Handle tile request from MBTiles file
 * URL pattern: /tiles/{chartId}/{z}/{x}/{y}
 */
export async function handleMBTileRequest(
  req: Request,
  res: Response,
  plugin: WasmPlugin,
  configPath: string
): Promise<void> {
  // Parse URL: /tiles/{chartId}/{z}/{x}/{y}
  const match = req.path.match(/\/tiles\/([\w-]+)\/(\d+)\/(\d+)\/(\d+)/)
  if (!match) {
    res.status(400).json({
      error: 'Invalid tile path. Expected: /tiles/{chartId}/{z}/{x}/{y}'
    })
    return
  }

  const [, chartId, zStr, xStr, yStr] = match
  const z = parseInt(zStr, 10)
  const x = parseInt(xStr, 10)
  const y = parseInt(yStr, 10)

  debug(`Tile request: chart=${chartId}, z=${z}, x=${x}, y=${y}`)

  // Find MBTiles file
  const chartsDir = getChartsDirectory(plugin, configPath)
  const mbtilesPath = path.join(chartsDir, `${chartId}.mbtiles`)

  if (!fs.existsSync(mbtilesPath)) {
    debug(`MBTiles file not found: ${mbtilesPath}`)
    res.status(404).json({ error: 'Chart not found', chartId })
    return
  }

  try {
    const Sqlite = getBetterSqlite3()
    const db = new Sqlite(mbtilesPath, { readonly: true })

    // MBTiles uses TMS scheme where Y is flipped
    // TMS Y = 2^zoom - 1 - XYZ Y
    const tmsY = Math.pow(2, z) - 1 - y

    const stmt = db.prepare(
      'SELECT tile_data FROM tiles WHERE zoom_level = ? AND tile_column = ? AND tile_row = ?'
    )
    const row = stmt.get(z, x, tmsY) as { tile_data: Buffer } | undefined

    db.close()

    if (!row || !row.tile_data) {
      debug(`Tile not found: z=${z}, x=${x}, y=${y} (TMS y=${tmsY})`)
      // Return transparent PNG for missing tiles instead of 404
      res.status(204).send()
      return
    }

    // Detect image type from magic bytes
    const tileData = row.tile_data
    let contentType = 'image/png'

    if (tileData[0] === 0xff && tileData[1] === 0xd8) {
      contentType = 'image/jpeg'
    } else if (
      tileData[0] === 0x89 &&
      tileData[1] === 0x50 &&
      tileData[2] === 0x4e &&
      tileData[3] === 0x47
    ) {
      contentType = 'image/png'
    } else if (tileData[0] === 0x1f && tileData[1] === 0x8b) {
      // gzip compressed - likely PBF vector tile
      contentType = 'application/x-protobuf'
      res.setHeader('Content-Encoding', 'gzip')
    }

    res.setHeader('Content-Type', contentType)
    res.setHeader('Cache-Control', 'public, max-age=86400') // Cache for 24 hours
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.send(tileData)

    debug(`Served tile: z=${z}, x=${x}, y=${y}, size=${tileData.length} bytes`)
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error)
    debug(`Error reading tile: ${errMsg}`)
    res.status(500).json({ error: 'Failed to read tile', details: errMsg })
  }
}

/**
 * Check if SQLite is available
 */
function isSqliteAvailable(): boolean {
  try {
    require.resolve('better-sqlite3')
    return true
  } catch {
    return false
  }
}

/**
 * Extract metadata from MBTiles file (optional - returns empty object if SQLite unavailable)
 */
function extractMBTilesMetadata(mbtilesPath: string): {
  name?: string
  description?: string
  bounds?: number[]
  minzoom?: number
  maxzoom?: number
  format?: string
  center?: number[]
} {
  // If SQLite is not available, return empty metadata
  if (!isSqliteAvailable()) {
    debug('SQLite not available, skipping metadata extraction')
    return {}
  }

  try {
    const Sqlite = getBetterSqlite3()
    const db = new Sqlite(mbtilesPath, { readonly: true })

    const metadata: any = {}

    try {
      const rows = db
        .prepare('SELECT name, value FROM metadata')
        .all() as Array<{ name: string; value: string }>

      for (const row of rows) {
        switch (row.name) {
          case 'name':
            metadata.name = row.value
            break
          case 'description':
            metadata.description = row.value
            break
          case 'bounds':
            // Format: "minLon,minLat,maxLon,maxLat"
            metadata.bounds = row.value.split(',').map(parseFloat)
            break
          case 'minzoom':
            metadata.minzoom = parseInt(row.value, 10)
            break
          case 'maxzoom':
            metadata.maxzoom = parseInt(row.value, 10)
            break
          case 'format':
            metadata.format = row.value
            break
          case 'center':
            // Format: "lon,lat,zoom"
            metadata.center = row.value.split(',').map(parseFloat)
            break
        }
      }
    } finally {
      db.close()
    }

    return metadata
  } catch (err) {
    debug(`Failed to extract metadata: ${err}`)
    return {}
  }
}

/**
 * Handle chart upload (multipart form data using busboy)
 */
export async function handleChartUpload(
  req: Request,
  res: Response,
  plugin: WasmPlugin,
  configPath: string
): Promise<void> {
  debug(`Chart upload request for plugin ${plugin.id}`)

  const chartsDir = getChartsDirectory(plugin, configPath)

  // Create a temp directory for upload
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chart-upload-'))
  let tempFilePath: string | null = null
  let originalFilename: string | null = null
  let uploadError: Error | null = null

  try {
    const bb = busboy({ headers: req.headers })

    // Promise to track upload completion
    await new Promise<void>((resolve, reject) => {
      bb.on(
        'file',
        (
          fieldname: string,
          file: NodeJS.ReadableStream,
          info: { filename: string }
        ) => {
          const { filename } = info
          debug(`Receiving file: fieldname=${fieldname}, filename=${filename}`)

          if (fieldname !== 'chart') {
            debug(`Ignoring field ${fieldname}, expected 'chart'`)
            file.resume() // Drain the stream
            return
          }

          if (!filename.endsWith('.mbtiles')) {
            uploadError = new Error('File must have .mbtiles extension')
            file.resume()
            return
          }

          originalFilename = filename
          tempFilePath = path.join(tmpDir, filename)

          const writeStream = fs.createWriteStream(tempFilePath)
          file.pipe(writeStream)

          writeStream.on('error', (err) => {
            debug(`Write stream error: ${err.message}`)
            uploadError = err
          })
        }
      )

      bb.on('error', (err: Error) => {
        debug(`Busboy error: ${err.message}`)
        reject(err)
      })

      bb.on('close', () => {
        debug(`Busboy close - file upload complete`)
        resolve()
      })

      req.pipe(bb)
    })

    // Check for upload errors
    if (uploadError) {
      throw uploadError
    }

    if (!tempFilePath || !originalFilename) {
      res.status(400).json({
        error: 'No file uploaded',
        hint: 'Upload a .mbtiles file using multipart/form-data with field name "chart"',
        example:
          'curl -F "chart=@myfile.mbtiles" http://localhost:3000/plugins/charts-provider-go/api/charts/upload'
      })
      return
    }

    // Derive chart ID from filename
    const chartName = path.basename(originalFilename, '.mbtiles')
    const chartId = chartName.toLowerCase().replace(/[^a-z0-9]/g, '-')
    const destPath = path.join(chartsDir, `${chartId}.mbtiles`)

    // Move file to charts directory
    fs.copyFileSync(tempFilePath, destPath)
    debug(`Saved chart file to: ${destPath}`)

    // Clean up temp file
    fs.unlinkSync(tempFilePath)

    // Extract metadata from MBTiles
    const mbtilesMetadata = extractMBTilesMetadata(destPath)

    // Build chart metadata
    const chartMetadata = {
      identifier: chartId,
      name: mbtilesMetadata.name || chartName,
      description: mbtilesMetadata.description || '',
      tilemapUrl: `/plugins/${plugin.id}/tiles/${chartId}/{z}/{x}/{y}`,
      bounds: mbtilesMetadata.bounds || [],
      minzoom: mbtilesMetadata.minzoom || 0,
      maxzoom: mbtilesMetadata.maxzoom || 18,
      format: 'mbtiles',
      type: 'baselayer'
    }

    // Register chart with WASM plugin by calling resource_set
    // The WASM plugin will emit the delta notification
    const asLoader = plugin.instance?.asLoader
    const rawExports = plugin.instance?.instance?.exports as any

    if (asLoader && typeof asLoader.exports.resource_set === 'function') {
      // AssemblyScript plugin
      const requestJson = JSON.stringify({ id: chartId, value: chartMetadata })
      const requestPtr = asLoader.exports.__newString(requestJson)
      const responsePtr = asLoader.exports.__newString('') // Dummy output
      asLoader.exports.resource_set(
        requestPtr,
        requestJson.length,
        responsePtr,
        1024
      )
      debug(`Registered chart with AssemblyScript plugin`)
    } else if (
      rawExports &&
      typeof rawExports.resource_set === 'function' &&
      typeof rawExports.allocate === 'function'
    ) {
      // Rust/Go plugin
      const requestJson = JSON.stringify({ id: chartId, value: chartMetadata })
      const requestBytes = Buffer.from(requestJson, 'utf8')
      const requestPtr = rawExports.allocate(requestBytes.length)
      const responsePtr = rawExports.allocate(1024)

      const memory = rawExports.memory as WebAssembly.Memory
      new Uint8Array(memory.buffer).set(requestBytes, requestPtr)

      rawExports.resource_set(
        requestPtr,
        requestBytes.length,
        responsePtr,
        1024
      )

      if (typeof rawExports.deallocate === 'function') {
        rawExports.deallocate(requestPtr, requestBytes.length)
        rawExports.deallocate(responsePtr, 1024)
      }
      debug(`Registered chart with Rust/Go plugin`)
    } else {
      debug(
        `Warning: Could not register chart with WASM plugin - no resource_set export`
      )
    }

    res.json({
      success: true,
      chartId,
      chart: chartMetadata,
      message: 'Chart uploaded and registered successfully'
    })
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error)
    debug(`Error uploading chart: ${errMsg}`)

    // Clean up temp file if exists
    if (tempFilePath && fs.existsSync(tempFilePath)) {
      fs.unlinkSync(tempFilePath)
    }

    res.status(500).json({ error: 'Failed to upload chart', details: errMsg })
  } finally {
    // Clean up temp directory
    try {
      if (fs.existsSync(tmpDir)) {
        fs.rmSync(tmpDir, { recursive: true })
      }
    } catch (e) {
      debug(`Failed to clean up temp dir: ${e}`)
    }
  }
}

/**
 * Handle chart list request - returns only charts from this plugin's VFS
 */
export async function handleChartList(
  req: Request,
  res: Response,
  plugin: WasmPlugin,
  configPath: string
): Promise<void> {
  debug(`Chart list request for plugin ${plugin.id}`)

  const chartsDir = getChartsDirectory(plugin, configPath)
  const charts: Record<string, any> = {}

  try {
    // List all .mbtiles files in the charts directory
    if (fs.existsSync(chartsDir)) {
      const files = fs
        .readdirSync(chartsDir)
        .filter((f) => f.endsWith('.mbtiles'))

      for (const file of files) {
        const chartId = path.basename(file, '.mbtiles')
        const mbtilesPath = path.join(chartsDir, file)

        try {
          const metadata = extractMBTilesMetadata(mbtilesPath)
          charts[chartId] = {
            identifier: chartId,
            name: metadata.name || chartId,
            description: metadata.description || '',
            tilemapUrl: `/plugins/${plugin.id}/tiles/${chartId}/{z}/{x}/{y}`,
            bounds: metadata.bounds || [],
            minzoom: metadata.minzoom || 0,
            maxzoom: metadata.maxzoom || 18,
            format: 'mbtiles',
            type: 'baselayer'
          }
        } catch (err) {
          debug(`Failed to read metadata for ${file}: ${err}`)
          // Still include the chart with minimal info
          charts[chartId] = {
            identifier: chartId,
            name: chartId,
            tilemapUrl: `/plugins/${plugin.id}/tiles/${chartId}/{z}/{x}/{y}`,
            format: 'mbtiles',
            type: 'baselayer'
          }
        }
      }
    }

    res.json(charts)
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error)
    debug(`Error listing charts: ${errMsg}`)
    res.status(500).json({ error: 'Failed to list charts', details: errMsg })
  }
}

/**
 * Handle chart deletion
 * This deletes the MBTiles file from disk
 */
export async function handleChartDelete(
  req: Request,
  res: Response,
  plugin: WasmPlugin,
  configPath: string,
  chartId: string
): Promise<void> {
  debug(`Chart delete request: ${chartId}`)

  const chartsDir = getChartsDirectory(plugin, configPath)
  const mbtilesPath = path.join(chartsDir, `${chartId}.mbtiles`)

  if (!fs.existsSync(mbtilesPath)) {
    debug(`MBTiles file not found: ${mbtilesPath}`)
    res.status(404).json({ error: 'Chart file not found', chartId })
    return
  }

  try {
    // Delete the file
    fs.unlinkSync(mbtilesPath)
    debug(`Deleted chart file: ${mbtilesPath}`)

    // The WASM plugin handles removing from its registry and emitting delta
    // via the http_delete_chart endpoint

    res.json({
      success: true,
      chartId,
      message: 'Chart file deleted successfully'
    })
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error)
    debug(`Error deleting chart: ${errMsg}`)
    res
      .status(500)
      .json({ error: 'Failed to delete chart file', details: errMsg })
  }
}

/**
 * Initialize charts from disk into the WASM plugin's memory
 * Called after plugin_start() to restore charts from previous sessions
 */
export async function initializeChartsFromDisk(
  plugin: WasmPlugin,
  configPath: string
): Promise<number> {
  debug(`Initializing charts from disk for ${plugin.id}`)

  const chartsDir = getChartsDirectory(plugin, configPath)
  let chartCount = 0

  if (!fs.existsSync(chartsDir)) {
    debug(`Charts directory does not exist: ${chartsDir}`)
    return 0
  }

  const files = fs.readdirSync(chartsDir).filter((f) => f.endsWith('.mbtiles'))
  debug(`Found ${files.length} .mbtiles files in ${chartsDir}`)

  for (const file of files) {
    const chartId = path.basename(file, '.mbtiles')
    const mbtilesPath = path.join(chartsDir, file)

    try {
      // Extract metadata from MBTiles
      const metadata = extractMBTilesMetadata(mbtilesPath)

      // Build chart metadata
      const chartMetadata = {
        identifier: chartId,
        name: metadata.name || chartId,
        description: metadata.description || '',
        tilemapUrl: `/plugins/${plugin.id}/tiles/${chartId}/{z}/{x}/{y}`,
        bounds: metadata.bounds || [],
        minzoom: metadata.minzoom || 0,
        maxzoom: metadata.maxzoom || 18,
        format: 'mbtiles',
        type: 'baselayer'
      }

      // Register chart with WASM plugin by calling resource_set
      const asLoader = plugin.instance?.asLoader
      const rawExports = plugin.instance?.instance?.exports as any

      if (asLoader && typeof asLoader.exports.resource_set === 'function') {
        // AssemblyScript plugin
        const requestJson = JSON.stringify({
          id: chartId,
          value: chartMetadata
        })
        const requestPtr = asLoader.exports.__newString(requestJson)
        const responsePtr = asLoader.exports.__newString('') // Dummy output
        asLoader.exports.resource_set(
          requestPtr,
          requestJson.length,
          responsePtr,
          1024
        )
        debug(`Registered chart ${chartId} with AssemblyScript plugin`)
        chartCount++
      } else if (
        rawExports &&
        typeof rawExports.resource_set === 'function' &&
        typeof rawExports.allocate === 'function'
      ) {
        // Rust/Go plugin
        const requestJson = JSON.stringify({
          id: chartId,
          value: chartMetadata
        })
        const requestBytes = Buffer.from(requestJson, 'utf8')
        const requestPtr = rawExports.allocate(requestBytes.length)
        const responsePtr = rawExports.allocate(1024)

        const memory = rawExports.memory as WebAssembly.Memory
        new Uint8Array(memory.buffer).set(requestBytes, requestPtr)

        rawExports.resource_set(
          requestPtr,
          requestBytes.length,
          responsePtr,
          1024
        )

        if (typeof rawExports.deallocate === 'function') {
          rawExports.deallocate(requestPtr, requestBytes.length)
          rawExports.deallocate(responsePtr, 1024)
        }
        debug(`Registered chart ${chartId} with Rust/Go plugin`)
        chartCount++
      } else {
        debug(
          `Warning: Could not register chart ${chartId} - no resource_set export`
        )
      }
    } catch (err) {
      debug(`Failed to initialize chart ${chartId}: ${err}`)
    }
  }

  debug(`Initialized ${chartCount} charts from disk for ${plugin.id}`)
  return chartCount
}

/**
 * Check if a request should be intercepted for MBTiles handling
 */
export function shouldInterceptMBTiles(
  plugin: WasmPlugin,
  req: Request
): 'tile' | 'upload' | 'delete' | false {
  // Only intercept for charts-provider plugins
  if (!plugin.id.includes('charts-provider')) {
    return false
  }

  const path = req.path

  // Tile requests: /tiles/{chartId}/{z}/{x}/{y}
  if (path.match(/\/tiles\/[\w-]+\/\d+\/\d+\/\d+/)) {
    return 'tile'
  }

  // Upload requests: POST /api/charts/upload
  if (path === '/api/charts/upload' && req.method === 'POST') {
    return 'upload'
  }

  // Delete with file cleanup: DELETE /api/charts/file/{id}
  if (path.match(/\/api\/charts\/file\/[\w-]+/) && req.method === 'DELETE') {
    return 'delete'
  }

  return false
}
