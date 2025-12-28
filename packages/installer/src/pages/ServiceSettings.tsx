import {
  Card,
  CardBody,
  CardTitle,
  Form,
  FormGroup,
  Label,
  Input,
  FormText
} from 'reactstrap'
import type { InstallerConfig } from '../App'

interface ServiceSettingsProps {
  config: InstallerConfig
  updateConfig: (updates: Partial<InstallerConfig>) => void
}

function ServiceSettings({ config, updateConfig }: ServiceSettingsProps) {
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
                onChange={(e) =>
                  updateConfig({ enableAutoStart: e.target.checked })
                }
              />
              <Label check for="enableAutoStart">
                Start SignalK Server automatically on system boot
              </Label>
              <FormText className="d-block">
                When enabled, the server will start automatically when your
                computer boots up. This is recommended for dedicated boat
                computers.
              </FormText>
            </FormGroup>
          </Form>
        </CardBody>
      </Card>
    </div>
  )
}

export default ServiceSettings
