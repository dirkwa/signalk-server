import { useState } from 'react'
import {
  Card,
  CardBody,
  CardTitle,
  Form,
  FormGroup,
  Label,
  Input,
  FormText,
  FormFeedback,
  Alert
} from 'reactstrap'
import type { InstallerConfig } from '../App'

interface SecuritySettingsProps {
  config: InstallerConfig
  updateConfig: (updates: Partial<InstallerConfig>) => void
}

function SecuritySettings({ config, updateConfig }: SecuritySettingsProps) {
  const [confirmPassword, setConfirmPassword] = useState('')

  const passwordsMatch = config.adminPassword === confirmPassword
  const passwordValid = config.adminPassword.length >= 8

  return (
    <div>
      <h2 className="mb-4">Security Settings</h2>

      <Alert color="info">
        <strong>Security is enabled by default.</strong> You'll need these
        credentials to access the admin interface after installation.
      </Alert>

      <Card>
        <CardBody>
          <CardTitle tag="h5">Administrator Account</CardTitle>

          <Form>
            <FormGroup>
              <Label for="adminUser">Username</Label>
              <Input
                type="text"
                id="adminUser"
                value={config.adminUser}
                onChange={(e) => updateConfig({ adminUser: e.target.value })}
                placeholder="admin"
              />
              <FormText>The username for the admin account.</FormText>
            </FormGroup>

            <FormGroup>
              <Label for="adminPassword">Password</Label>
              <Input
                type="password"
                id="adminPassword"
                value={config.adminPassword}
                onChange={(e) =>
                  updateConfig({ adminPassword: e.target.value })
                }
                invalid={config.adminPassword.length > 0 && !passwordValid}
                valid={passwordValid}
              />
              <FormFeedback>
                Password must be at least 8 characters.
              </FormFeedback>
              <FormText>
                Choose a strong password for the admin account.
              </FormText>
            </FormGroup>

            <FormGroup>
              <Label for="confirmPassword">Confirm Password</Label>
              <Input
                type="password"
                id="confirmPassword"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                invalid={confirmPassword.length > 0 && !passwordsMatch}
                valid={confirmPassword.length > 0 && passwordsMatch}
              />
              <FormFeedback>Passwords do not match.</FormFeedback>
            </FormGroup>
          </Form>
        </CardBody>
      </Card>
    </div>
  )
}

export default SecuritySettings
