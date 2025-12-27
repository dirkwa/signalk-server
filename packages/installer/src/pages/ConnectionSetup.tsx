import { useEffect, useState } from 'react'
import {
  Card,
  CardBody,
  CardTitle,
  FormGroup,
  Label,
  Input,
  ListGroup,
  ListGroupItem,
  Spinner,
  Alert,
} from 'reactstrap'
import { invoke } from '@tauri-apps/api/core'
import type { InstallerConfig } from '../App'

interface ConnectionSetupProps {
  config: InstallerConfig
  updateConfig: (updates: Partial<InstallerConfig>) => void
}

interface SerialPortInfo {
  path: string
  description: string
  manufacturer?: string
}

function ConnectionSetup({ config, updateConfig }: ConnectionSetupProps) {
  const [ports, setPorts] = useState<SerialPortInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const loadPorts = async () => {
      try {
        const result = await invoke<SerialPortInfo[]>('list_serial_ports')
        setPorts(result)
      } catch (e) {
        // Dev mode fallback
        setPorts([
          { path: '/dev/ttyUSB0', description: 'USB Serial Device' },
          { path: '/dev/ttyACM0', description: 'Arduino Compatible' },
        ])
        setError('Running in dev mode - showing sample ports')
      } finally {
        setLoading(false)
      }
    }
    loadPorts()
  }, [])

  const togglePort = (port: string) => {
    const current = config.serialPorts
    if (current.includes(port)) {
      updateConfig({ serialPorts: current.filter((p) => p !== port) })
    } else {
      updateConfig({ serialPorts: [...current, port] })
    }
  }

  return (
    <div>
      <h2 className="mb-4">Connection Setup</h2>

      <Card className="mb-4">
        <CardBody>
          <CardTitle tag="h5">Serial Ports</CardTitle>
          <p className="text-muted">
            Select the serial ports connected to your NMEA instruments. You can add more
            connections later through the SignalK admin interface.
          </p>

          {loading ? (
            <div className="text-center py-4">
              <Spinner color="primary" />
              <p className="mt-2">Scanning for serial ports...</p>
            </div>
          ) : error ? (
            <Alert color="warning">{error}</Alert>
          ) : ports.length === 0 ? (
            <Alert color="info">
              No serial ports detected. You can configure connections later through the
              admin interface.
            </Alert>
          ) : (
            <ListGroup>
              {ports.map((port) => (
                <ListGroupItem key={port.path}>
                  <FormGroup check>
                    <Input
                      type="checkbox"
                      checked={config.serialPorts.includes(port.path)}
                      onChange={() => togglePort(port.path)}
                    />
                    <Label check className="ms-2">
                      <strong>{port.path}</strong>
                      <br />
                      <small className="text-muted">
                        {port.description}
                        {port.manufacturer && ` (${port.manufacturer})`}
                      </small>
                    </Label>
                  </FormGroup>
                </ListGroupItem>
              ))}
            </ListGroup>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardBody>
          <CardTitle tag="h5">Other Connections</CardTitle>
          <p className="text-muted">
            Network connections (TCP/UDP), file playback, and other data sources can be
            configured after installation through the SignalK admin interface.
          </p>
        </CardBody>
      </Card>
    </div>
  )
}

export default ConnectionSetup
