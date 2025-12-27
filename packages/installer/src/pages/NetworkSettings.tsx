import { Card, CardBody, CardTitle, Form, FormGroup, Label, Input, FormText, Row, Col } from 'reactstrap'
import type { InstallerConfig } from '../App'

interface NetworkSettingsProps {
  config: InstallerConfig
  updateConfig: (updates: Partial<InstallerConfig>) => void
}

function NetworkSettings({ config, updateConfig }: NetworkSettingsProps) {
  return (
    <div>
      <h2 className="mb-4">Network Settings</h2>

      <Card className="mb-4">
        <CardBody>
          <CardTitle tag="h5">HTTP Server</CardTitle>

          <Form>
            <Row>
              <Col md={6}>
                <FormGroup>
                  <Label for="httpPort">HTTP Port</Label>
                  <Input
                    type="number"
                    id="httpPort"
                    value={config.httpPort}
                    onChange={(e) => updateConfig({ httpPort: parseInt(e.target.value) || 3000 })}
                    min={1}
                    max={65535}
                  />
                  <FormText>
                    The port for the web interface. Default is 3000.
                  </FormText>
                </FormGroup>
              </Col>
            </Row>
          </Form>
        </CardBody>
      </Card>

      <Card>
        <CardBody>
          <CardTitle tag="h5">SSL/TLS Encryption</CardTitle>

          <Form>
            <FormGroup check className="mb-3">
              <Input
                type="checkbox"
                id="enableSsl"
                checked={config.enableSsl}
                onChange={(e) => updateConfig({ enableSsl: e.target.checked })}
              />
              <Label check for="enableSsl">
                Enable HTTPS (SSL/TLS)
              </Label>
              <FormText className="d-block">
                Encrypts connections to the server. Recommended if accessing from outside
                your local network.
              </FormText>
            </FormGroup>

            {config.enableSsl && (
              <Row>
                <Col md={6}>
                  <FormGroup>
                    <Label for="sslPort">HTTPS Port</Label>
                    <Input
                      type="number"
                      id="sslPort"
                      value={config.sslPort}
                      onChange={(e) => updateConfig({ sslPort: parseInt(e.target.value) || 3443 })}
                      min={1}
                      max={65535}
                    />
                    <FormText>
                      The port for encrypted connections. Default is 3443.
                    </FormText>
                  </FormGroup>
                </Col>
              </Row>
            )}
          </Form>
        </CardBody>
      </Card>
    </div>
  )
}

export default NetworkSettings
