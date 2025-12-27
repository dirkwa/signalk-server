import { useEffect, useState } from 'react'
import { Card, CardBody, CardTitle, Form, FormGroup, Label, Input, FormText, Alert } from 'reactstrap'
import { invoke } from '@tauri-apps/api/core'
import type { InstallerConfig } from '../App'

interface ServiceSettingsProps {
  config: InstallerConfig
  updateConfig: (updates: Partial<InstallerConfig>) => void
}

interface PlatformInfo {
  os: string
  serviceManager: string
  requiresAdmin: boolean
}

function ServiceSettings({ config, updateConfig }: ServiceSettingsProps) {
  const [platformInfo, setPlatformInfo] = useState<PlatformInfo | null>(null)

  useEffect(() => {
    const loadPlatformInfo = async () => {
      try {
        const info = await invoke<PlatformInfo>('get_platform_info')
        setPlatformInfo(info)
      } catch {
        // Dev mode fallback
        setPlatformInfo({
          os: 'linux',
          serviceManager: 'systemd (user)',
          requiresAdmin: false,
        })
      }
    }
    loadPlatformInfo()
  }, [])

  const getServiceDescription = () => {
    if (!platformInfo) return ''

    switch (platformInfo.os) {
      case 'linux':
        return 'SignalK will run as a systemd user service, starting automatically when you log in.'
      case 'macos':
        return 'SignalK will run as a launchd agent, starting automatically when you log in.'
      case 'windows':
        return 'SignalK will run as a scheduled task, starting automatically when you log in.'
      default:
        return 'SignalK will be configured to start automatically.'
    }
  }

  return (
    <div>
      <h2 className="mb-4">Service Settings</h2>

      <Card>
        <CardBody>
          <CardTitle tag="h5">Automatic Startup</CardTitle>

          <Form>
            <FormGroup check className="mb-3">
              <Input
                type="checkbox"
                id="enableAutoStart"
                checked={config.enableAutoStart}
                onChange={(e) => updateConfig({ enableAutoStart: e.target.checked })}
              />
              <Label check for="enableAutoStart">
                Start SignalK Server automatically
              </Label>
              <FormText className="d-block">{getServiceDescription()}</FormText>
            </FormGroup>
          </Form>

          {platformInfo && (
            <Alert color="secondary" className="mt-3">
              <small>
                <strong>Platform:</strong> {platformInfo.os}
                <br />
                <strong>Service Manager:</strong> {platformInfo.serviceManager}
                {platformInfo.requiresAdmin && (
                  <>
                    <br />
                    <em>Note: Admin privileges may be required for service installation.</em>
                  </>
                )}
              </small>
            </Alert>
          )}
        </CardBody>
      </Card>
    </div>
  )
}

export default ServiceSettings
