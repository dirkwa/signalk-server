import { useEffect, useState } from 'react'
import {
  Card,
  CardBody,
  Progress,
  ListGroup,
  ListGroupItem,
  Spinner,
  Alert
} from 'reactstrap'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import type { InstallerConfig } from '../App'

interface InstallProgressProps {
  config: InstallerConfig
  onComplete: () => void
}

interface InstallStep {
  id: string
  name: string
  status: 'pending' | 'in_progress' | 'completed' | 'error'
  message?: string
}

const initialSteps: InstallStep[] = [
  { id: 'extract', name: 'Extracting files', status: 'pending' },
  { id: 'config', name: 'Creating configuration', status: 'pending' },
  { id: 'bundles', name: 'Installing plugin bundles', status: 'pending' },
  { id: 'service', name: 'Setting up service', status: 'pending' },
  { id: 'verify', name: 'Verifying installation', status: 'pending' }
]

function InstallProgress({ config, onComplete }: InstallProgressProps) {
  const [steps, setSteps] = useState<InstallStep[]>(initialSteps)
  const [error, setError] = useState<string | null>(null)
  const [installing, setInstalling] = useState(false)

  useEffect(() => {
    let unlisten: (() => void) | undefined

    const startInstall = async () => {
      setInstalling(true)

      try {
        // Listen for progress events from Tauri
        unlisten = await listen<{
          step: string
          status: string
          message?: string
        }>('install-progress', (event) => {
          setSteps((prev) =>
            prev.map((step) =>
              step.id === event.payload.step
                ? {
                    ...step,
                    status: event.payload.status as InstallStep['status'],
                    message: event.payload.message
                  }
                : step
            )
          )
        })

        // Start the installation
        await invoke('run_installation', { config })

        // All done
        setTimeout(onComplete, 1000)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Installation failed')

        // Dev mode simulation
        if (typeof e === 'object' && e !== null && 'toString' in e) {
          const errorStr = e.toString()
          if (errorStr.includes('invoke')) {
            // Simulate installation in dev mode
            for (let i = 0; i < initialSteps.length; i++) {
              await new Promise((resolve) => setTimeout(resolve, 1000))
              setSteps((prev) =>
                prev.map((step, idx) => ({
                  ...step,
                  status:
                    idx <= i
                      ? 'completed'
                      : idx === i + 1
                        ? 'in_progress'
                        : 'pending'
                }))
              )
            }
            setError(null)
            setTimeout(onComplete, 1000)
          }
        }
      } finally {
        setInstalling(false)
      }
    }

    startInstall()

    return () => {
      unlisten?.()
    }
  }, [config, onComplete])

  const completedCount = steps.filter((s) => s.status === 'completed').length
  const progressPercent = (completedCount / steps.length) * 100

  const getStatusIcon = (status: InstallStep['status']) => {
    switch (status) {
      case 'completed':
        return '✓'
      case 'in_progress':
        return <Spinner size="sm" />
      case 'error':
        return '✗'
      default:
        return '○'
    }
  }

  const getStatusColor = (status: InstallStep['status']) => {
    switch (status) {
      case 'completed':
        return 'success'
      case 'in_progress':
        return 'primary'
      case 'error':
        return 'danger'
      default:
        return 'secondary'
    }
  }

  return (
    <div>
      <h2 className="mb-4">Installing SignalK Server</h2>

      {error && (
        <Alert color="danger">
          <strong>Installation Error:</strong> {error}
        </Alert>
      )}

      <Card className="mb-4">
        <CardBody>
          <Progress value={progressPercent} color="primary" className="mb-4" />

          <ListGroup>
            {steps.map((step) => (
              <ListGroupItem
                key={step.id}
                color={getStatusColor(step.status)}
                className="d-flex align-items-center"
              >
                <span
                  className="me-3"
                  style={{ width: '24px', textAlign: 'center' }}
                >
                  {getStatusIcon(step.status)}
                </span>
                <div>
                  <strong>{step.name}</strong>
                  {step.message && (
                    <small className="d-block text-muted">{step.message}</small>
                  )}
                </div>
              </ListGroupItem>
            ))}
          </ListGroup>
        </CardBody>
      </Card>

      {installing && (
        <p className="text-center text-muted">
          Please wait while SignalK Server is being installed...
        </p>
      )}
    </div>
  )
}

export default InstallProgress
