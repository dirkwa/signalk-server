import { useEffect, useState } from 'react'
import { Card, CardBody, CardTitle, CardText, Button, Alert } from 'reactstrap'
import { invoke } from '@tauri-apps/api/core'

interface WelcomeProps {
  onNext: () => void
}

interface ExistingInstall {
  found: boolean
  configPath?: string
  version?: string
}

function Welcome({ onNext }: WelcomeProps) {
  const [existingInstall, setExistingInstall] = useState<ExistingInstall | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const checkExisting = async () => {
      try {
        const result = await invoke<ExistingInstall>('check_existing_install')
        setExistingInstall(result)
      } catch (e) {
        // Not running in Tauri context (dev mode)
        setExistingInstall({ found: false })
      } finally {
        setLoading(false)
      }
    }
    checkExisting()
  }, [])

  return (
    <div className="text-center">
      <h2 className="mb-4">Welcome to SignalK Server</h2>

      <Card className="mb-4">
        <CardBody>
          <CardTitle tag="h5">What is SignalK?</CardTitle>
          <CardText>
            Signal K is a modern, open data format for marine use. The SignalK Server
            collects data from your boat's instruments and makes it available to apps,
            displays, and other devices on your network.
          </CardText>
        </CardBody>
      </Card>

      {loading ? (
        <p>Checking for existing installation...</p>
      ) : existingInstall?.found ? (
        <Alert color="info">
          <h5>Existing Installation Found</h5>
          <p>
            Configuration found at: <code>{existingInstall.configPath}</code>
            {existingInstall.version && (
              <>
                <br />
                Version: {existingInstall.version}
              </>
            )}
          </p>
          <p>Your existing configuration will be preserved during the upgrade.</p>
        </Alert>
      ) : (
        <Alert color="success">
          <h5>Fresh Installation</h5>
          <p>
            This wizard will guide you through setting up SignalK Server on your system.
            No existing installation was detected.
          </p>
        </Alert>
      )}

      <Card className="mb-4">
        <CardBody>
          <CardTitle tag="h5">This installer will:</CardTitle>
          <ul className="text-start">
            <li>Install SignalK Server with all required dependencies</li>
            <li>Configure your vessel information</li>
            <li>Set up connections to your marine instruments</li>
            <li>Configure network settings and security</li>
            <li>Optionally set up automatic startup</li>
          </ul>
        </CardBody>
      </Card>

      <Button color="primary" size="lg" onClick={onNext}>
        Get Started
      </Button>
    </div>
  )
}

export default Welcome
