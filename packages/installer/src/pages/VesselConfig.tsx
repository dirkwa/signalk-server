import { Card, CardBody, CardTitle, Form, FormGroup, Label, Input, FormText } from 'reactstrap'
import type { InstallerConfig } from '../App'

interface VesselConfigProps {
  config: InstallerConfig
  updateConfig: (updates: Partial<InstallerConfig>) => void
}

function VesselConfig({ config, updateConfig }: VesselConfigProps) {
  return (
    <div>
      <h2 className="mb-4">Vessel Configuration</h2>

      <Card>
        <CardBody>
          <CardTitle tag="h5">Tell us about your boat</CardTitle>

          <Form>
            <FormGroup>
              <Label for="vesselName">Vessel Name</Label>
              <Input
                type="text"
                id="vesselName"
                value={config.vesselName}
                onChange={(e) => updateConfig({ vesselName: e.target.value })}
                placeholder="e.g., Sea Spirit"
              />
              <FormText>
                This name will be used to identify your vessel on the network.
              </FormText>
            </FormGroup>

            <FormGroup>
              <Label for="mmsi">MMSI Number (Optional)</Label>
              <Input
                type="text"
                id="mmsi"
                value={config.mmsi}
                onChange={(e) => updateConfig({ mmsi: e.target.value })}
                placeholder="e.g., 123456789"
                maxLength={9}
              />
              <FormText>
                The Maritime Mobile Service Identity is a unique 9-digit number for your vessel.
                If you don't have an MMSI, leave this blank and a unique ID will be generated.
              </FormText>
            </FormGroup>
          </Form>
        </CardBody>
      </Card>
    </div>
  )
}

export default VesselConfig
