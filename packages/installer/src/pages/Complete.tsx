import { Card, CardBody, CardTitle, Button, Alert } from 'reactstrap'
import { invoke } from '@tauri-apps/api/core'

function Complete() {
  const openAdminUI = async () => {
    try {
      await invoke('open_admin_ui')
    } catch {
      // Dev mode - just open in browser
      window.open('http://localhost:3000', '_blank')
    }
  }

  const closeInstaller = async () => {
    try {
      await invoke('close_installer')
    } catch {
      // Dev mode - just close window
      window.close()
    }
  }

  return (
    <div className="text-center">
      <div className="mb-4">
        <span style={{ fontSize: '4rem' }}>🎉</span>
      </div>

      <h2 className="mb-4">Installation Complete!</h2>

      <Alert color="success">
        SignalK Server has been successfully installed and is now running.
      </Alert>

      <Card className="mb-4">
        <CardBody>
          <CardTitle tag="h5">Next Steps</CardTitle>
          <ul className="text-start">
            <li>Access the admin interface to configure additional settings</li>
            <li>Install plugins to extend functionality</li>
            <li>Connect your chart plotter and other devices</li>
            <li>Explore the Signal K ecosystem of apps</li>
          </ul>
        </CardBody>
      </Card>

      <Card className="mb-4">
        <CardBody>
          <CardTitle tag="h5">Access Your Server</CardTitle>
          <p>
            The SignalK admin interface is available at:
            <br />
            <a
              href="http://localhost:3000"
              target="_blank"
              rel="noopener noreferrer"
            >
              http://localhost:3000
            </a>
          </p>
        </CardBody>
      </Card>

      <div className="d-flex justify-content-center gap-3">
        <Button color="primary" size="lg" onClick={openAdminUI}>
          Open Admin Interface
        </Button>
        <Button color="secondary" outline onClick={closeInstaller}>
          Close Installer
        </Button>
      </div>
    </div>
  )
}

export default Complete
