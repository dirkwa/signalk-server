/* eslint-disable @typescript-eslint/no-explicit-any */
import { createDebug } from '../../debug'
const debug = createDebug('signalk-server:api:ble')

import fs from 'fs'
import { IRouter, Request, Response } from 'express'
import { WithSecurityStrategy } from '../../security'
import { SignalKMessageHub, WithConfig } from '../../app'
import WebSocket from 'ws'
import { writeSettingsFile } from '../../config/config'
import { LocalBLEProvider } from './localProvider'
import { RemoteGatewayProvider } from './remoteProvider'
import { bleVendorName } from './bleCompanyIds'

import {
  BLEProvider,
  BLEProviders,
  BLEAdvertisement,
  BLEDeviceInfo,
  BLEConsumerInfo,
  BLEApi as IBLEApi,
  GATTSubscriptionDescriptor,
  GATTSubscriptionHandle,
  BLEGattConnection,
  isBLEProvider
} from '@signalk/server-api'

const BLE_API_PATH = `/signalk/v2/api/vessels/self/ble`

// Devices not seen for this long are pruned from the device table
const DEVICE_STALE_MS = 120_000

interface BLEApplication
  extends WithSecurityStrategy, SignalKMessageHub, WithConfig, IRouter {
  server?: any // HTTP server for WebSocket upgrade
}

interface BLESettings {
  localBluetoothManaged: boolean
  localAdapters: string[] // [] = auto-enumerate all available adapters
  localMaxGATTSlots: number
}

interface GATTClaim {
  pluginId: string
  providerId: string
  handle: GATTSubscriptionHandle
}

const DEFAULT_BLE_SETTINGS: BLESettings = {
  localBluetoothManaged: false,
  localAdapters: [],
  localMaxGATTSlots: 3
}

export class BLEApi implements IBLEApi {
  private bleProviders: Map<string, BLEProvider> = new Map()
  private providerUnsubscribers: Map<string, () => void> = new Map()
  private deviceTable: Map<string, BLEDeviceInfo> = new Map()
  private gattClaims: Map<string, GATTClaim> = new Map()
  private advertisementCallbacks: Map<string, (adv: BLEAdvertisement) => void> =
    new Map()
  private wsClients: Set<WebSocket> = new Set()
  private localProviders: Map<string, LocalBLEProvider> = new Map() // key = providerId
  private localProviderErrors: Map<string, string> = new Map() // key = adapterName
  private settings: BLESettings
  private remoteGatewayProvider: RemoteGatewayProvider | null = null

  get localBluetoothManaged(): boolean {
    return this.settings.localBluetoothManaged
  }

  get localAdapters(): string[] {
    return this.settings.localAdapters
  }

  constructor(private app: BLEApplication) {
    // Read or initialize settings
    const appSettings = (this.app.config?.settings as any) ?? {}
    if (!appSettings.bleApi) {
      appSettings.bleApi = { ...DEFAULT_BLE_SETTINGS }
    }
    this.settings = {
      ...DEFAULT_BLE_SETTINGS,
      ...appSettings.bleApi
    }
  }

  async start() {
    this.initApiEndpoints()
    this.initWebSocketEndpoint()

    // Initialize remote gateway provider (always on — handles ESP32 gateways)
    this.remoteGatewayProvider = new RemoteGatewayProvider(
      this.app,
      this.register.bind(this),
      this.unRegister.bind(this),
      this.releaseGATTClaimsForProvider.bind(this)
    )
    this.remoteGatewayProvider.attach(this.app)

    // Initialize local BLE providers if setting is enabled
    if (this.settings.localBluetoothManaged) {
      await this.initLocalProviders()
    }

    return Promise.resolve()
  }

  // Local Bluetooth adapter support requires Linux + BlueZ. Not available on
  // macOS or Windows (no DBus/BlueZ). See docs/develop/rest-api/ble_api.md.
  private isLocalBLESupported(): boolean {
    return process.platform === 'linux'
  }

  private async getAvailableAdapters(): Promise<string[]> {
    // /sys/class/bluetooth is populated by the kernel for every BT adapter.
    // Empty or absent means no hardware — skip to avoid DBus stack traces.
    try {
      const entries = fs.readdirSync('/sys/class/bluetooth')
      if (entries.length === 0) {
        debug('No Bluetooth hardware detected — skipping local BLE')
        return []
      }
    } catch {
      debug('No Bluetooth hardware detected — skipping local BLE')
      return []
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { createBluetooth } = require('@naugehyde/node-ble')
      const { bluetooth, destroy } = createBluetooth()
      const adapters = await bluetooth.activeAdapters()
      destroy()
      return adapters.map((a: any) => a.adapter as string)
    } catch {
      return []
    }
  }

  private async initLocalProviders() {
    if (!this.isLocalBLESupported()) {
      debug('Local Bluetooth not supported on this platform — skipping')
      return
    }

    let adapterNames = this.settings.localAdapters
    if (adapterNames.length === 0) {
      adapterNames = await this.getAvailableAdapters()
      if (adapterNames.length === 0) adapterNames = ['hci0']
    }

    for (const adapterName of adapterNames) {
      const providerId = `_localBLE:${adapterName}`
      if (this.localProviders.has(providerId)) continue
      try {
        const provider = new LocalBLEProvider(
          adapterName,
          this.settings.localMaxGATTSlots,
          providerId
        )
        await provider.init()
        this.localProviders.set(providerId, provider)
        this.localProviderErrors.delete(adapterName)
        this.register(providerId, {
          name: `Local Bluetooth (${adapterName})`,
          methods: provider.getMethods()
        })
        await provider.startDiscovery()
        debug(`Local BLE provider registered and scanning: ${providerId}`)
      } catch (e: any) {
        const msg = `Local BLE adapter ${adapterName} unavailable: ${e.message}`
        debug(msg)
        // Suppress console.log for expected "no hardware / no BlueZ" errors
        const isExpected =
          e.message?.includes('org.freedesktop.DBus.Error.ServiceUnknown') ||
          e.message?.includes('not provided by any .service files') ||
          e.message?.includes('ENOENT') ||
          e.message?.includes('ECONNREFUSED')
        if (!isExpected) {
          console.log(`[BLE API] ${msg}`)
        }
        this.localProviderErrors.set(adapterName, e.message)
      }
    }
  }

  private async shutdownLocalProviders() {
    for (const [providerId, provider] of this.localProviders) {
      this.unRegister(providerId)
      provider.shutdown()
      debug(`Local BLE provider shut down: ${providerId}`)
    }
    this.localProviders.clear()
    this.localProviderErrors.clear()
  }

  // -------------------------------------------------------------------
  // Provider registration
  // -------------------------------------------------------------------

  register(pluginId: string, provider: BLEProvider) {
    debug(`Registering BLE provider: ${pluginId} "${provider.name}"`)

    if (!pluginId || !provider) {
      throw new Error(`Error registering BLE provider ${pluginId}!`)
    }
    if (!isBLEProvider(provider)) {
      throw new Error(`${pluginId} is missing BLEProvider properties/methods!`)
    }

    if (!this.bleProviders.has(pluginId)) {
      this.bleProviders.set(pluginId, provider)
    }

    // Subscribe to this provider's advertisements
    const unsub = provider.methods.onAdvertisement((adv: BLEAdvertisement) => {
      this._handleAdvertisement(adv)
    })
    this.providerUnsubscribers.set(pluginId, unsub)

    debug(`BLE providers registered: ${this.bleProviders.size}`)
  }

  unRegister(pluginId: string) {
    if (!pluginId) return
    debug(`Unregistering BLE provider: ${pluginId}`)

    // Unsubscribe from provider advertisements
    const unsub = this.providerUnsubscribers.get(pluginId)
    if (unsub) {
      unsub()
      this.providerUnsubscribers.delete(pluginId)
    }

    // Release GATT claims held through this provider
    for (const [mac, claim] of this.gattClaims) {
      if (claim.providerId === pluginId) {
        claim.handle.close().catch(() => {})
        this.gattClaims.delete(mac)
      }
    }

    this.bleProviders.delete(pluginId)
    debug(`BLE providers remaining: ${this.bleProviders.size}`)
  }

  // -------------------------------------------------------------------
  // Advertisement handling
  // -------------------------------------------------------------------

  onAdvertisement(
    pluginId: string,
    callback: (adv: BLEAdvertisement) => void
  ): () => void {
    this.advertisementCallbacks.set(pluginId, callback)
    return () => {
      this.advertisementCallbacks.delete(pluginId)
    }
  }

  private _handleAdvertisement(adv: BLEAdvertisement) {
    const mac = adv.mac.toUpperCase()

    // Update device table
    let device = this.deviceTable.get(mac)
    if (!device) {
      device = {
        mac,
        name: adv.name,
        rssi: adv.rssi,
        lastSeen: adv.timestamp,
        connectable: adv.connectable ?? false,
        seenBy: []
      }
      this.deviceTable.set(mac, device)
    }

    // Update seenBy entry for this provider
    const providerEntry = device.seenBy.find(
      (s) => s.providerId === adv.providerId
    )
    if (providerEntry) {
      providerEntry.rssi = adv.rssi
      providerEntry.lastSeen = adv.timestamp
    } else {
      device.seenBy.push({
        providerId: adv.providerId,
        rssi: adv.rssi,
        lastSeen: adv.timestamp
      })
    }

    // Update aggregate fields — prefer GAP local name, fall back to vendor lookup
    if (adv.name) {
      device.name = adv.name
    } else if (!device.name) {
      const companyId = Object.keys(adv.manufacturerData ?? {})[0]
      if (companyId !== undefined) {
        device.name = bleVendorName(parseInt(companyId)) ?? undefined
      }
    }
    if (adv.connectable) device.connectable = true
    device.rssi = Math.max(...device.seenBy.map((s) => s.rssi))
    device.lastSeen = Math.max(...device.seenBy.map((s) => s.lastSeen))

    // GATT claim info
    const claim = this.gattClaims.get(mac)
    device.gattClaimedBy = claim?.pluginId

    // Fan out to callbacks
    for (const cb of this.advertisementCallbacks.values()) {
      try {
        cb(adv)
      } catch (e: any) {
        debug(`Advertisement callback error: ${e.message}`)
      }
    }

    // Fan out to WebSocket clients
    const json = JSON.stringify(adv)
    for (const ws of this.wsClients) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(json)
      }
    }
  }

  // -------------------------------------------------------------------
  // Device queries
  // -------------------------------------------------------------------

  async getDevices(): Promise<BLEDeviceInfo[]> {
    this.pruneStaleDevices()
    // Ensure every GATT-claimed device is in the table, even if it stopped
    // advertising after connection (GATT devices typically do).
    for (const [mac, claim] of this.gattClaims) {
      if (!this.deviceTable.has(mac)) {
        this.deviceTable.set(mac, {
          mac,
          rssi: 0,
          lastSeen: Date.now(),
          connectable: true,
          seenBy: [{ providerId: claim.providerId, rssi: 0, lastSeen: Date.now() }]
        })
      }
      const device = this.deviceTable.get(mac)!
      device.gattClaimedBy = claim.pluginId
    }
    // Clear gattClaimedBy for devices no longer claimed
    for (const [mac, device] of this.deviceTable) {
      if (!this.gattClaims.has(mac)) {
        device.gattClaimedBy = undefined
      }
    }
    return Array.from(this.deviceTable.values())
  }

  async getDevice(mac: string): Promise<BLEDeviceInfo | null> {
    return this.deviceTable.get(mac.toUpperCase()) ?? null
  }

  private pruneStaleDevices() {
    const cutoff = Date.now() - DEVICE_STALE_MS
    for (const [mac, device] of this.deviceTable) {
      // Never prune a device that has an active GATT claim
      if (this.gattClaims.has(mac)) continue
      if (device.lastSeen < cutoff) {
        this.deviceTable.delete(mac)
      }
    }
  }

  // -------------------------------------------------------------------
  // GATT
  // -------------------------------------------------------------------

  async subscribeGATT(
    descriptor: GATTSubscriptionDescriptor,
    pluginId: string,
    callback: (charUuid: string, data: Buffer) => void
  ): Promise<GATTSubscriptionHandle> {
    const mac = descriptor.mac.toUpperCase()

    // Check existing claim
    const existing = this.gattClaims.get(mac)
    if (existing) {
      throw new Error(`Device ${mac} already claimed by ${existing.pluginId}`)
    }

    // Select best provider
    const providerId = this.selectGATTProvider(mac)
    if (!providerId) {
      throw new Error(
        `No provider with GATT support and available slots can see ${mac}`
      )
    }

    const provider = this.bleProviders.get(providerId)!
    const handle = await provider.methods.subscribeGATT(descriptor, callback)

    this.gattClaims.set(mac, { pluginId, providerId, handle })
    debug(`GATT claim: ${mac} → ${pluginId} via ${providerId}`)

    // Ensure the device exists in the table — GATT devices may stop advertising
    // once connected, so they would otherwise be pruned.
    if (!this.deviceTable.has(mac)) {
      this.deviceTable.set(mac, {
        mac,
        rssi: 0,
        lastSeen: Date.now(),
        connectable: true,
        seenBy: [{ providerId, rssi: 0, lastSeen: Date.now() }]
      })
    }
    // Keep lastSeen fresh for the duration of the claim so the device
    // is not pruned while GATT is active (GATT devices stop advertising).
    const keepAliveTimer = setInterval(() => {
      const d = this.deviceTable.get(mac)
      if (d) d.lastSeen = Date.now()
    }, DEVICE_STALE_MS / 2)

    // Wire up cleanup on close
    const origClose = handle.close.bind(handle)
    handle.close = async () => {
      clearInterval(keepAliveTimer)
      this.gattClaims.delete(mac)
      debug(`GATT released: ${mac} (was ${pluginId})`)
      return origClose()
    }

    return handle
  }

  async connectGATT(mac: string, pluginId: string): Promise<BLEGattConnection> {
    mac = mac.toUpperCase()

    const existing = this.gattClaims.get(mac)
    if (existing) {
      throw new Error(`Device ${mac} already claimed by ${existing.pluginId}`)
    }

    const providerId = this.selectGATTProvider(mac)
    if (!providerId) {
      throw new Error(`No provider with GATT support can see ${mac}`)
    }

    const provider = this.bleProviders.get(providerId)!
    if (!provider.methods.connectGATT) {
      throw new Error(
        `Provider ${providerId} does not support raw GATT connections`
      )
    }

    const conn = await provider.methods.connectGATT(mac)

    // Record claim with a synthetic handle
    const syntheticHandle: GATTSubscriptionHandle = {
      write: async () => {},
      close: async () => {
        this.gattClaims.delete(mac)
        await conn.disconnect()
      },
      connected: conn.connected,
      onDisconnect: conn.onDisconnect,
      onConnect: () => {}
    }
    this.gattClaims.set(mac, {
      pluginId,
      providerId,
      handle: syntheticHandle
    })

    return conn
  }

  async releaseGATTDevice(mac: string, pluginId: string): Promise<void> {
    mac = mac.toUpperCase()
    const claim = this.gattClaims.get(mac)
    if (!claim) return
    if (claim.pluginId !== pluginId) {
      throw new Error(
        `Device ${mac} is claimed by ${claim.pluginId}, not ${pluginId}`
      )
    }
    await claim.handle.close()
    this.gattClaims.delete(mac)
  }

  getGATTClaims(): Map<string, string> {
    const result = new Map<string, string>()
    for (const [mac, claim] of this.gattClaims) {
      result.set(mac, claim.pluginId)
    }
    return result
  }

  /**
   * Release all GATT claims held through the given providerId.
   * Called when a gateway WS disconnects so plugins can re-subscribe
   * via another provider (or the same one when it reconnects).
   */
  private _buildSettingsResponse() {
    const adapterErrors: Record<string, string> = {}
    for (const [k, v] of this.localProviderErrors) {
      adapterErrors[k] = v
    }
    return {
      localBluetoothManaged: this.settings.localBluetoothManaged,
      localAdapters: this.settings.localAdapters,
      localMaxGATTSlots: this.settings.localMaxGATTSlots,
      localBLESupported: this.isLocalBLESupported(),
      activeAdapters: Array.from(this.localProviders.keys()),
      adapterErrors
    }
  }

  releaseGATTClaimsForProvider(providerId: string) {
    for (const [mac, claim] of this.gattClaims) {
      if (claim.providerId === providerId) {
        // Remove claim first so close() doesn't double-delete
        this.gattClaims.delete(mac)
        // Close silently — the underlying WS is already dead
        claim.handle.close().catch(() => {})
        debug(
          `GATT claim released (gateway offline): ${mac} was ${claim.pluginId} via ${providerId}`
        )
      }
    }
  }

  private selectGATTProvider(mac: string): string | undefined {
    const device = this.deviceTable.get(mac)
    if (!device) return undefined

    // Sort providers by RSSI (strongest first), filter to those with
    // GATT support and available slots
    const candidates = device.seenBy
      .filter((s) => {
        const provider = this.bleProviders.get(s.providerId)
        return (
          provider &&
          provider.methods.supportsGATT() &&
          provider.methods.availableGATTSlots() > 0
        )
      })
      .sort((a, b) => b.rssi - a.rssi)

    return candidates.length > 0 ? candidates[0].providerId : undefined
  }

  // -------------------------------------------------------------------
  // REST endpoints
  // -------------------------------------------------------------------

  private initApiEndpoints() {
    debug(`Initialise ${BLE_API_PATH} endpoints`)

    // API overview
    this.app.get(`${BLE_API_PATH}`, async (_req: Request, res: Response) => {
      res.json({
        devices: {
          description:
            'All visible BLE devices across all providers, deduplicated by MAC'
        },
        providers: {
          description: 'Registered BLE providers'
        },
        gattClaims: {
          description: 'Current GATT connection claims'
        }
      })
    })

    // List providers
    this.app.get(
      `${BLE_API_PATH}/_providers`,
      async (_req: Request, res: Response) => {
        const providers: BLEProviders = {}
        for (const [id, provider] of this.bleProviders) {
          providers[id] = {
            name: provider.name,
            supportsGATT: provider.methods.supportsGATT(),
            gattSlots: {
              total: 0, // provider doesn't expose total, only available
              available: provider.methods.availableGATTSlots()
            }
          }
        }
        res.json(providers)
      }
    )

    // List devices
    this.app.get(
      `${BLE_API_PATH}/devices`,
      async (_req: Request, res: Response) => {
        const devices = await this.getDevices()
        res.json(devices)
      }
    )

    // Single device
    this.app.get(
      `${BLE_API_PATH}/devices/:mac`,
      async (req: Request, res: Response) => {
        const device = await this.getDevice(req.params.mac)
        if (device) {
          res.json(device)
        } else {
          res.status(404).json({ message: 'Device not found' })
        }
      }
    )

    // Device GATT claim
    this.app.get(
      `${BLE_API_PATH}/devices/:mac/gatt`,
      async (req: Request, res: Response) => {
        const mac = req.params.mac.toUpperCase()
        const claim = this.gattClaims.get(mac)
        res.json({
          claimedBy: claim?.pluginId ?? null
        })
      }
    )

    // Consumer plugins
    this.app.get(
      `${BLE_API_PATH}/consumers`,
      async (_req: Request, res: Response) => {
        const consumerMap = new Map<string, BLEConsumerInfo>()

        for (const pluginId of this.advertisementCallbacks.keys()) {
          consumerMap.set(pluginId, {
            pluginId,
            advertisementSubscriber: true,
            gattClaims: []
          })
        }
        for (const [mac, claim] of this.gattClaims) {
          let entry = consumerMap.get(claim.pluginId)
          if (!entry) {
            entry = {
              pluginId: claim.pluginId,
              advertisementSubscriber: false,
              gattClaims: []
            }
            consumerMap.set(claim.pluginId, entry)
          }
          entry.gattClaims.push(mac)
        }

        res.json(Array.from(consumerMap.values()))
      }
    )

    // BLE settings
    this.app.get(
      `${BLE_API_PATH}/settings`,
      async (_req: Request, res: Response) => {
        res.json(this._buildSettingsResponse())
      }
    )

    this.app.put(
      `${BLE_API_PATH}/settings`,
      async (req: Request, res: Response) => {
        const body = req.body
        let changed = false
        let providerChange = false

        if (typeof body.localBluetoothManaged === 'boolean') {
          if (body.localBluetoothManaged && !this.isLocalBLESupported()) {
            res.status(400).json({
              message:
                'Local Bluetooth adapter management is only supported on Linux.'
            })
            return
          }
          this.settings.localBluetoothManaged = body.localBluetoothManaged
          changed = true
          providerChange = true
        }
        if (Array.isArray(body.localAdapters)) {
          this.settings.localAdapters = body.localAdapters
          changed = true
          providerChange = true
        }
        if (typeof body.localMaxGATTSlots === 'number') {
          this.settings.localMaxGATTSlots = body.localMaxGATTSlots
          changed = true
          providerChange = true
        }

        if (changed) {
          // Persist to settings.json
          const appSettings = this.app.config.settings as any
          appSettings.bleApi = { ...this.settings }
          writeSettingsFile(
            this.app as any,
            this.app.config.settings,
            (err: any) => {
              if (err) {
                debug(`Error saving BLE settings: ${err.message}`)
              }
            }
          )

          // Apply provider change
          if (providerChange) {
            await this.shutdownLocalProviders()
            if (this.settings.localBluetoothManaged) {
              await this.initLocalProviders()
            }
          }
        }

        res.json(this._buildSettingsResponse())
      }
    )
  }

  // -------------------------------------------------------------------
  // WebSocket endpoint for advertisement streaming
  // -------------------------------------------------------------------

  private initWebSocketEndpoint() {
    const wsPath = `${BLE_API_PATH}/advertisements`
    const wss = new WebSocket.Server({ noServer: true })

    wss.on('connection', (ws: WebSocket) => {
      debug('WebSocket client connected for BLE advertisements')
      this.wsClients.add(ws)
      ws.on('close', () => {
        this.wsClients.delete(ws)
        debug('WebSocket client disconnected')
      })
      ws.on('error', () => {
        this.wsClients.delete(ws)
      })
    })

    // Defer until the HTTP server is available
    const tryAttach = () => {
      const server = this.app.server
      if (!server) {
        debug('HTTP server not yet available, retrying in 1s...')
        setTimeout(tryAttach, 1000)
        return
      }

      server.on('upgrade', (request: any, socket: any, head: any) => {
        const url = new URL(request.url, `http://${request.headers.host}`)
        if (url.pathname === wsPath) {
          wss.handleUpgrade(request, socket, head, (ws: WebSocket) => {
            wss.emit('connection', ws, request)
          })
        }
      })
      debug(`WebSocket endpoint ready at ${wsPath}`)
    }

    tryAttach()
  }
}
