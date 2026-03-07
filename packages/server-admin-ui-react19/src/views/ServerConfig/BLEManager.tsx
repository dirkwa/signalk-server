import React, { useState, useEffect, useCallback, useRef } from 'react'
import Badge from 'react-bootstrap/Badge'
import Card from 'react-bootstrap/Card'
import Col from 'react-bootstrap/Col'
import Row from 'react-bootstrap/Row'
import Table from 'react-bootstrap/Table'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faBluetooth } from '@fortawesome/free-brands-svg-icons/faBluetooth'
import { faCircle } from '@fortawesome/free-solid-svg-icons/faCircle'
import { faMicrochip } from '@fortawesome/free-solid-svg-icons/faMicrochip'
import { faTowerBroadcast } from '@fortawesome/free-solid-svg-icons/faTowerBroadcast'
import { faLink } from '@fortawesome/free-solid-svg-icons/faLink'

const BLE_API = '/signalk/v2/api/vessels/self/ble'
const PLUGIN_API = '/plugins/bt-sensors-plugin-sk'

interface SeenByEntry {
  providerId: string
  rssi: number
  lastSeen: number
}

interface BLEDeviceInfo {
  mac: string
  name?: string
  rssi: number
  lastSeen: number
  connectable: boolean
  seenBy: SeenByEntry[]
  gattClaimedBy?: string | null
}

interface ProviderInfo {
  name: string
  supportsGATT: boolean
  gattSlots: {
    total: number
    available: number
  }
}

interface GatewayInfo {
  gatewayId: string
  ipAddress?: string
  firmware?: string
  online: boolean
  connectedAt: number
  disconnectedAt?: number
  uptime: number
  freeHeap: number
  gattSlots: { total: number; available: number }
  deviceCount: number
}

type ProvidersMap = Record<string, ProviderInfo>

function formatAge(lastSeen: number): string {
  const seconds = Math.round((Date.now() - lastSeen) / 1000)
  if (seconds < 5) return 'just now'
  if (seconds < 60) return `${seconds}s ago`
  return `${Math.floor(seconds / 60)}m ago`
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h < 24) return `${h}h ${m}m`
  const d = Math.floor(h / 24)
  return `${d}d ${h % 24}h`
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  return `${Math.round(bytes / 1024)} KB`
}

function rssiColor(rssi: number): string {
  if (rssi >= -50) return 'success'
  if (rssi >= -70) return 'primary'
  if (rssi >= -85) return 'warning'
  return 'danger'
}

export default function BLEManager() {
  const [devices, setDevices] = useState<BLEDeviceInfo[]>([])
  const [providers, setProviders] = useState<ProvidersMap>({})
  const [gateways, setGateways] = useState<GatewayInfo[]>([])
  const [wsConnected, setWsConnected] = useState(false)
  const [advCount, setAdvCount] = useState(0)
  const wsRef = useRef<WebSocket | null>(null)
  const advCountRef = useRef(0)

  const fetchProviders = useCallback(async () => {
    try {
      const response = await fetch(`${BLE_API}/_providers`, {
        credentials: 'include'
      })
      if (response.ok) {
        setProviders(await response.json())
      }
    } catch (e) {
      console.error('Failed to fetch BLE providers:', e)
    }
  }, [])

  const fetchDevices = useCallback(async () => {
    try {
      const response = await fetch(`${BLE_API}/devices`, {
        credentials: 'include'
      })
      if (response.ok) {
        setDevices(await response.json())
      }
    } catch (e) {
      console.error('Failed to fetch BLE devices:', e)
    }
  }, [])

  const fetchGateways = useCallback(async () => {
    try {
      const response = await fetch(`${PLUGIN_API}/gateways`, {
        credentials: 'include'
      })
      if (response.ok) {
        setGateways(await response.json())
      }
    } catch (_e) {
      // Plugin may not be installed — ignore
    }
  }, [])

  // Poll every 5 seconds (initial fetch + interval)
  useEffect(() => {
    const poll = () => {
      fetchProviders()
      fetchDevices()
      fetchGateways()
    }
    const interval = setInterval(poll, 5000)
    poll()
    return () => clearInterval(interval)
  }, [fetchProviders, fetchDevices, fetchGateways])

  // WebSocket for advertisement count
  useEffect(() => {
    const wsProto = window.location.protocol === 'https:' ? 'wss' : 'ws'
    const ws = new WebSocket(
      `${wsProto}://${window.location.host}${BLE_API}/advertisements`
    )
    wsRef.current = ws

    ws.onopen = () => setWsConnected(true)
    ws.onclose = () => setWsConnected(false)
    ws.onerror = () => setWsConnected(false)
    ws.onmessage = () => {
      advCountRef.current += 1
    }

    // Update displayed count every second
    const countInterval = setInterval(() => {
      setAdvCount(advCountRef.current)
    }, 1000)

    return () => {
      clearInterval(countInterval)
      ws.close()
    }
  }, [])

  const providerEntries = Object.entries(providers)
  const hasProviders = providerEntries.length > 0

  return (
    <div className="animated fadeIn">
      {/* Status overview */}
      <Row className="mb-3">
        <Col sm="3">
          <Card className="text-center">
            <Card.Body className="py-3">
              <div className="h5 mb-0">
                {gateways.filter((g) => g.online).length}
              </div>
              <small className="text-body-secondary text-uppercase fw-bold">
                Gateways
              </small>
            </Card.Body>
          </Card>
        </Col>
        <Col sm="3">
          <Card className="text-center">
            <Card.Body className="py-3">
              <div className="h5 mb-0">{providerEntries.length}</div>
              <small className="text-body-secondary text-uppercase fw-bold">
                Providers
              </small>
            </Card.Body>
          </Card>
        </Col>
        <Col sm="3">
          <Card className="text-center">
            <Card.Body className="py-3">
              <div className="h5 mb-0">{devices.length}</div>
              <small className="text-body-secondary text-uppercase fw-bold">
                Devices
              </small>
            </Card.Body>
          </Card>
        </Col>
        <Col sm="3">
          <Card className="text-center">
            <Card.Body className="py-3">
              <div className="h5 mb-0">
                <FontAwesomeIcon
                  icon={faCircle}
                  className={wsConnected ? 'text-success' : 'text-danger'}
                  style={{ fontSize: '0.6em', verticalAlign: 'middle' }}
                />{' '}
                {advCount}
              </div>
              <small className="text-body-secondary text-uppercase fw-bold">
                Advertisements
              </small>
            </Card.Body>
          </Card>
        </Col>
      </Row>

      {/* Gateways */}
      {gateways.length > 0 && (
        <Card className="mb-3">
          <Card.Header>
            <FontAwesomeIcon icon={faMicrochip} /> <strong>BLE Gateways</strong>
            <Badge bg="primary" className="ms-2">
              {gateways.filter((g) => g.online).length}/{gateways.length}
            </Badge>
          </Card.Header>
          <Card.Body>
            <Table hover responsive striped size="sm">
              <thead>
                <tr>
                  <th>Hostname</th>
                  <th>IP Address</th>
                  <th>Status</th>
                  <th>Firmware</th>
                  <th>Uptime</th>
                  <th>Free Heap</th>
                  <th>GATT</th>
                  <th>Devices</th>
                  <th>WS Connected</th>
                </tr>
              </thead>
              <tbody>
                {gateways.map((gw) => (
                  <tr key={gw.gatewayId}>
                    <td>
                      <strong>{gw.gatewayId}</strong>
                    </td>
                    <td>
                      <code>{gw.ipAddress || '-'}</code>
                    </td>
                    <td>
                      <Badge bg={gw.online ? 'success' : 'danger'}>
                        {gw.online ? 'Online' : 'Offline'}
                      </Badge>
                    </td>
                    <td>{gw.firmware || '-'}</td>
                    <td>{gw.uptime > 0 ? formatDuration(gw.uptime) : '-'}</td>
                    <td>{gw.freeHeap > 0 ? formatBytes(gw.freeHeap) : '-'}</td>
                    <td>
                      {gw.gattSlots.total > 0
                        ? `${gw.gattSlots.total - gw.gattSlots.available}/${gw.gattSlots.total}`
                        : '-'}
                    </td>
                    <td>{gw.deviceCount}</td>
                    <td>
                      {gw.online
                        ? formatAge(gw.connectedAt)
                        : gw.disconnectedAt
                          ? formatAge(gw.disconnectedAt)
                          : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card.Body>
        </Card>
      )}

      {/* Providers */}
      <Card className="mb-3">
        <Card.Header>
          <FontAwesomeIcon icon={faTowerBroadcast} />{' '}
          <strong>BLE Providers</strong>
        </Card.Header>
        <Card.Body>
          {!hasProviders ? (
            <p className="text-body-secondary mb-0">
              No BLE providers registered. Install a BLE provider plugin to get
              started.
            </p>
          ) : (
            <Table hover responsive striped size="sm">
              <thead>
                <tr>
                  <th>Plugin ID</th>
                  <th>Name</th>
                  <th>GATT Support</th>
                  <th>GATT Slots</th>
                </tr>
              </thead>
              <tbody>
                {providerEntries.map(([id, info]) => (
                  <tr key={id}>
                    <td>
                      <code>{id}</code>
                    </td>
                    <td>{info.name}</td>
                    <td>
                      {info.supportsGATT ? (
                        <Badge bg="success">Yes</Badge>
                      ) : (
                        <Badge bg="secondary">No</Badge>
                      )}
                    </td>
                    <td>
                      {info.supportsGATT
                        ? `${info.gattSlots.available} available`
                        : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card.Body>
      </Card>

      {/* Devices */}
      <Card>
        <Card.Header>
          <FontAwesomeIcon icon={faBluetooth} /> <strong>BLE Devices</strong>
          {devices.length > 0 && (
            <Badge bg="primary" className="ms-2">
              {devices.length}
            </Badge>
          )}
        </Card.Header>
        <Card.Body>
          {devices.length === 0 ? (
            <p className="text-body-secondary mb-0">
              {hasProviders
                ? 'No BLE devices detected yet. Waiting for advertisements...'
                : 'No devices. Register a BLE provider plugin first.'}
            </p>
          ) : (
            <Table hover responsive striped size="sm">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>MAC Address</th>
                  <th>RSSI</th>
                  <th>Last Seen</th>
                  <th>Connectable</th>
                  <th>Seen By</th>
                  <th>GATT</th>
                </tr>
              </thead>
              <tbody>
                {devices
                  .sort((a, b) => (b.rssi ?? -999) - (a.rssi ?? -999))
                  .map((device) => (
                    <tr key={device.mac}>
                      <td>{device.name || <em>Unknown</em>}</td>
                      <td>
                        <code>{device.mac}</code>
                      </td>
                      <td>
                        <Badge bg={rssiColor(device.rssi)}>
                          {device.rssi} dBm
                        </Badge>
                      </td>
                      <td>{formatAge(device.lastSeen)}</td>
                      <td>
                        {device.connectable ? (
                          <Badge bg="info">Yes</Badge>
                        ) : (
                          '-'
                        )}
                      </td>
                      <td>
                        {device.seenBy.map((s) => (
                          <Badge
                            key={s.providerId}
                            bg="secondary"
                            className="me-1"
                          >
                            {s.providerId} ({s.rssi})
                          </Badge>
                        ))}
                      </td>
                      <td>
                        {device.gattClaimedBy ? (
                          <Badge bg="warning" text="dark">
                            <FontAwesomeIcon icon={faLink} />{' '}
                            {device.gattClaimedBy}
                          </Badge>
                        ) : (
                          '-'
                        )}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </Table>
          )}
        </Card.Body>
      </Card>
    </div>
  )
}
