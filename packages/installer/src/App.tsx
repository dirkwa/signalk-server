import { useState } from 'react'
import { Routes, Route, useNavigate } from 'react-router-dom'
import { Button } from 'reactstrap'
import Welcome from './pages/Welcome'
import VesselConfig from './pages/VesselConfig'
import ConnectionSetup from './pages/ConnectionSetup'
import NetworkSettings from './pages/NetworkSettings'
import SecuritySettings from './pages/SecuritySettings'
import ServiceSettings from './pages/ServiceSettings'
import InstallProgress from './pages/InstallProgress'
import Complete from './pages/Complete'

export interface InstallerConfig {
  // Vessel
  vesselName: string
  mmsi: string
  // Network
  httpPort: number
  enableSsl: boolean
  sslPort: number
  // Security
  adminUser: string
  adminPassword: string
  // Service
  enableAutoStart: boolean
  // Connections
  serialPorts: string[]
}

const defaultConfig: InstallerConfig = {
  vesselName: '',
  mmsi: '',
  httpPort: 3000,
  enableSsl: false,
  sslPort: 3443,
  adminUser: 'admin',
  adminPassword: '',
  enableAutoStart: true,
  serialPorts: [],
}

const steps = [
  { path: '/', name: 'Welcome' },
  { path: '/vessel', name: 'Vessel' },
  { path: '/connections', name: 'Connections' },
  { path: '/network', name: 'Network' },
  { path: '/security', name: 'Security' },
  { path: '/service', name: 'Service' },
  { path: '/install', name: 'Install' },
  { path: '/complete', name: 'Complete' },
]

function App() {
  const [config, setConfig] = useState<InstallerConfig>(defaultConfig)
  const [currentStep, setCurrentStep] = useState(0)
  const navigate = useNavigate()

  const updateConfig = (updates: Partial<InstallerConfig>) => {
    setConfig((prev) => ({ ...prev, ...updates }))
  }

  const goToStep = (stepIndex: number) => {
    setCurrentStep(stepIndex)
    navigate(steps[stepIndex].path)
  }

  const nextStep = () => {
    if (currentStep < steps.length - 1) {
      goToStep(currentStep + 1)
    }
  }

  const prevStep = () => {
    if (currentStep > 0) {
      goToStep(currentStep - 1)
    }
  }

  return (
    <div className="installer-container">
      <header className="wizard-header">
        <img src="/signalk-logo.svg" alt="SignalK" />
        <h1>SignalK Server Installer</h1>
      </header>

      {currentStep > 0 && currentStep < steps.length - 1 && (
        <div className="step-indicator">
          {steps.slice(1, -1).map((step, index) => (
            <div
              key={step.path}
              className={`step-dot ${
                index < currentStep ? 'completed' : index === currentStep - 1 ? 'active' : ''
              }`}
              title={step.name}
            />
          ))}
        </div>
      )}

      <main className="wizard-content">
        <Routes>
          <Route
            path="/"
            element={<Welcome onNext={nextStep} />}
          />
          <Route
            path="/vessel"
            element={
              <VesselConfig
                config={config}
                updateConfig={updateConfig}
              />
            }
          />
          <Route
            path="/connections"
            element={
              <ConnectionSetup
                config={config}
                updateConfig={updateConfig}
              />
            }
          />
          <Route
            path="/network"
            element={
              <NetworkSettings
                config={config}
                updateConfig={updateConfig}
              />
            }
          />
          <Route
            path="/security"
            element={
              <SecuritySettings
                config={config}
                updateConfig={updateConfig}
              />
            }
          />
          <Route
            path="/service"
            element={
              <ServiceSettings
                config={config}
                updateConfig={updateConfig}
              />
            }
          />
          <Route
            path="/install"
            element={<InstallProgress config={config} onComplete={nextStep} />}
          />
          <Route path="/complete" element={<Complete />} />
        </Routes>
      </main>

      {currentStep > 0 && currentStep < steps.length - 2 && (
        <footer className="wizard-footer">
          <Button color="secondary" outline onClick={prevStep}>
            Back
          </Button>
          <Button color="primary" onClick={nextStep}>
            Next
          </Button>
        </footer>
      )}
    </div>
  )
}

export default App
