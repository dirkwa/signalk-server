import React, { useCallback, useEffect, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import Alert from 'react-bootstrap/Alert'
import Badge from 'react-bootstrap/Badge'
import Button from 'react-bootstrap/Button'
import Card from 'react-bootstrap/Card'
import Col from 'react-bootstrap/Col'
import Form from 'react-bootstrap/Form'
import ProgressBar from 'react-bootstrap/ProgressBar'
import Row from 'react-bootstrap/Row'
import Table from 'react-bootstrap/Table'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faCircleNotch } from '@fortawesome/free-solid-svg-icons/faCircleNotch'
import { faDownload } from '@fortawesome/free-solid-svg-icons/faDownload'
import { faCheck } from '@fortawesome/free-solid-svg-icons/faCheck'
import { faUndo } from '@fortawesome/free-solid-svg-icons/faUndo'
import { faSync } from '@fortawesome/free-solid-svg-icons/faSync'
import { useAppStore, useRuntimeConfig } from '../../store'
import {
  updateApi,
  shouldUseKeeper,
  type VersionListResponse,
  type UpdateStatus,
  type ImageVersion,
  type VersionSettings
} from '../../services/api'

interface InstallingApp {
  name: string
  isWaiting?: boolean
  isInstalling?: boolean
}

interface AppStore {
  storeAvailable: boolean
  canUpdateServer: boolean
  isInDocker: boolean
  serverUpdate: string | null
  installing: InstallingApp[]
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleString()
}

const ServerUpdate: React.FC = () => {
  const navigate = useNavigate()
  const appStore = useAppStore() as AppStore
  const { useKeeper } = useRuntimeConfig()

  // Keeper-specific state
  const [versions, setVersions] = useState<VersionListResponse | null>(null)
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null)
  const [versionSettings, setVersionSettings] =
    useState<VersionSettings | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isPulling, setIsPulling] = useState<string | null>(null)
  const eventSourceRef = useRef<EventSource | null>(null)

  const loadVersionSettings = async () => {
    try {
      const settings = await updateApi.getSettings()
      if (settings) {
        setVersionSettings(settings)
      }
    } catch (err) {
      console.error('Failed to load version settings:', err)
    }
  }

  const handleToggleSetting = async (
    key: 'showBeta' | 'showMaster',
    value: boolean
  ) => {
    try {
      const updated = await updateApi.updateSettings({ [key]: value })
      if (updated) {
        setVersionSettings(updated)
      }
      // Reload versions to reflect the new filter
      await loadVersions()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update settings')
    }
  }

  // Load versions on mount
  useEffect(() => {
    if (useKeeper && shouldUseKeeper()) {
      loadVersions()
      loadUpdateStatus()
      loadVersionSettings()
    }

    return () => {
      // Cleanup SSE connection
      if (eventSourceRef.current) {
        eventSourceRef.current.close()
      }
    }
  }, [useKeeper])

  // Subscribe to update progress when update is in progress
  useEffect(() => {
    const state = updateStatus?.state
    if (
      state &&
      state !== 'idle' &&
      state !== 'complete' &&
      state !== 'failed'
    ) {
      // Set up SSE subscription inline to avoid dependency issues
      if (eventSourceRef.current) {
        eventSourceRef.current.close()
      }

      const es = updateApi.subscribeProgress((status) => {
        setUpdateStatus(status)
        if (status.state === 'complete' || status.state === 'failed') {
          eventSourceRef.current?.close()
          eventSourceRef.current = null
          loadVersions()
        }
      })

      if (es) {
        eventSourceRef.current = es
        es.onerror = () => {
          console.error('SSE connection error')
          es.close()
          eventSourceRef.current = null
        }
      }
    }
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close()
        eventSourceRef.current = null
      }
    }
  }, [updateStatus?.state])

  const loadVersions = async () => {
    setIsLoading(true)
    setError(null)
    try {
      const versionList = await updateApi.listVersions()
      if (versionList) {
        setVersions(versionList)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load versions')
    } finally {
      setIsLoading(false)
    }
  }

  const loadUpdateStatus = async () => {
    try {
      const status = await updateApi.status()
      if (status) {
        setUpdateStatus(status)
      }
    } catch (err) {
      console.error('Failed to load update status:', err)
    }
  }

  const subscribeToProgress = () => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close()
    }

    const es = updateApi.subscribeProgress((status) => {
      setUpdateStatus(status)
      if (status.state === 'complete' || status.state === 'failed') {
        eventSourceRef.current?.close()
        eventSourceRef.current = null
        // Reload versions after update completes
        loadVersions()
      }
    })

    if (es) {
      eventSourceRef.current = es
      es.onerror = () => {
        console.error('SSE connection error')
        es.close()
        eventSourceRef.current = null
      }
    }
  }

  const handlePullVersion = async (tag: string) => {
    setIsPulling(tag)
    setError(null)
    try {
      await updateApi.pullVersion(tag)
      await loadVersions()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to pull version')
    } finally {
      setIsPulling(null)
    }
  }

  const handleSwitchVersion = async (tag: string) => {
    if (
      !confirm(
        `Are you sure you want to switch to version ${tag}? This will restart the server.`
      )
    ) {
      return
    }
    setError(null)
    try {
      await updateApi.switchVersion(tag)
      setUpdateStatus({ state: 'switching', message: 'Switching version...' })
      subscribeToProgress()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to switch version')
    }
  }

  const handleStartUpdate = async (tag?: string) => {
    if (
      !confirm(
        'Are you sure you want to start the update? This will create a backup and restart the server.'
      )
    ) {
      return
    }
    setError(null)
    try {
      await updateApi.start(tag)
      setUpdateStatus({ state: 'checking', message: 'Starting update...' })
      subscribeToProgress()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start update')
    }
  }

  const handleRollback = async () => {
    if (
      !confirm('Are you sure you want to rollback to the previous version?')
    ) {
      return
    }
    setError(null)
    try {
      await updateApi.rollback()
      setUpdateStatus({ state: 'rolling_back', message: 'Rolling back...' })
      subscribeToProgress()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to rollback')
    }
  }

  // Standard update handler for non-Keeper mode
  const handleUpdate = useCallback(() => {
    if (confirm('Are you sure you want to update the server?')) {
      navigate('/appstore/updates')
      fetch(
        `${window.serverRoutesPrefix}/appstore/install/signalk-server/${appStore.serverUpdate}`,
        {
          method: 'POST',
          credentials: 'include'
        }
      )
    }
  }, [appStore.serverUpdate, navigate])

  // Keeper mode UI
  if (useKeeper && shouldUseKeeper()) {
    const getStatusColor = (state: string) => {
      switch (state) {
        case 'complete':
          return 'success'
        case 'failed':
          return 'danger'
        case 'rolling_back':
          return 'warning'
        default:
          return 'info'
      }
    }

    const getStatusText = (status: UpdateStatus) => {
      switch (status.state) {
        case 'idle':
          return 'Ready'
        case 'checking':
          return 'Checking for updates...'
        case 'pulling':
          return `Pulling new image... ${status.progress || 0}%`
        case 'backup':
          return 'Creating backup...'
        case 'switching':
          return 'Switching version...'
        case 'verifying':
          return 'Verifying new version...'
        case 'complete':
          return 'Update complete!'
        case 'failed':
          return `Update failed: ${status.error || 'Unknown error'}`
        case 'rolling_back':
          return 'Rolling back to previous version...'
        default:
          return status.message || 'Unknown state'
      }
    }

    const renderVersionRow = (version: ImageVersion, isCurrent: boolean) => (
      <tr key={version.tag} className={isCurrent ? 'table-success' : ''}>
        <td>
          {version.tag}
          {isCurrent && (
            <Badge bg="success" className="ms-2">
              Current
            </Badge>
          )}
        </td>
        <td>{formatDate(version.created)}</td>
        <td>{formatBytes(version.size)}</td>
        <td>
          {version.isLocal ? (
            <Badge bg="primary">Local</Badge>
          ) : (
            <Badge bg="secondary">Remote</Badge>
          )}
        </td>
        <td>
          {!version.isLocal && (
            <Button
              size="sm"
              variant="info"
              className="me-1"
              onClick={() => handlePullVersion(version.tag)}
              disabled={isPulling !== null}
              title="Pull this version"
            >
              {isPulling === version.tag ? (
                <FontAwesomeIcon icon={faCircleNotch} spin />
              ) : (
                <FontAwesomeIcon icon={faDownload} />
              )}
            </Button>
          )}
          {version.isLocal && !isCurrent && (
            <Button
              size="sm"
              variant="warning"
              onClick={() => handleSwitchVersion(version.tag)}
              disabled={
                updateStatus?.state !== 'idle' &&
                updateStatus?.state !== undefined
              }
              title="Switch to this version"
            >
              <FontAwesomeIcon icon={faSync} /> Switch
            </Button>
          )}
          {isCurrent && (
            <span className="text-muted">
              <FontAwesomeIcon icon={faCheck} /> Active
            </span>
          )}
        </td>
      </tr>
    )

    return (
      <div className="animated fadeIn">
        {error && (
          <Alert variant="danger" dismissible onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        {/* Current Status Card */}
        {versions && (
          <Card className="mb-4">
            <Card.Header>Current Version</Card.Header>
            <Card.Body>
              <Row>
                <Col md={4}>
                  <Form.Group>
                    <Form.Label>Version</Form.Label>
                    <div className="h5">{versions.current.tag}</div>
                  </Form.Group>
                </Col>
                <Col md={4}>
                  <Form.Group>
                    <Form.Label>Image Created</Form.Label>
                    <div>{formatDate(versions.current.created)}</div>
                  </Form.Group>
                </Col>
                <Col md={4}>
                  <Form.Group>
                    <Form.Label>Digest</Form.Label>
                    <div className="text-muted small">
                      {versions.current.digest.slice(0, 20)}...
                    </div>
                  </Form.Group>
                </Col>
              </Row>
            </Card.Body>
          </Card>
        )}

        {/* Update Progress Card */}
        {updateStatus && updateStatus.state !== 'idle' && (
          <Card className="mb-4">
            <Card.Header>
              Update Progress
              <Badge
                bg={getStatusColor(updateStatus.state)}
                className="float-end"
              >
                {updateStatus.state}
              </Badge>
            </Card.Header>
            <Card.Body>
              <p>{getStatusText(updateStatus)}</p>
              {updateStatus.progress !== undefined &&
                updateStatus.progress > 0 && (
                  <ProgressBar
                    animated={
                      updateStatus.state !== 'complete' &&
                      updateStatus.state !== 'failed'
                    }
                    variant={getStatusColor(updateStatus.state)}
                    now={updateStatus.progress}
                    label={`${updateStatus.progress}%`}
                  />
                )}
              {updateStatus.currentStep && updateStatus.totalSteps && (
                <small className="text-muted">
                  Step {updateStatus.currentStep} of {updateStatus.totalSteps}
                </small>
              )}
            </Card.Body>
            {updateStatus.state === 'failed' && (
              <Card.Footer>
                <Button variant="warning" onClick={handleRollback}>
                  <FontAwesomeIcon icon={faUndo} /> Rollback
                </Button>
              </Card.Footer>
            )}
          </Card>
        )}

        {/* Available Versions Card */}
        <Card className="mb-4">
          <Card.Header>
            Available Versions
            <Button
              size="sm"
              variant="secondary"
              className="float-end"
              onClick={loadVersions}
              disabled={isLoading}
            >
              {isLoading ? (
                <FontAwesomeIcon icon={faCircleNotch} spin />
              ) : (
                <FontAwesomeIcon icon={faSync} />
              )}{' '}
              Refresh
            </Button>
          </Card.Header>
          <Card.Body>
            {versionSettings && (
              <div className="mb-3 d-flex gap-4">
                <Form.Check
                  inline
                  type="checkbox"
                  id="showBeta"
                  label="Show beta versions"
                  checked={versionSettings.showBeta}
                  onChange={(e) =>
                    handleToggleSetting('showBeta', e.target.checked)
                  }
                />
                <Form.Check
                  inline
                  type="checkbox"
                  id="showMaster"
                  label="Show development builds"
                  checked={versionSettings.showMaster}
                  onChange={(e) =>
                    handleToggleSetting('showMaster', e.target.checked)
                  }
                />
              </div>
            )}
            {isLoading ? (
              <div className="text-center">
                <FontAwesomeIcon icon={faCircleNotch} spin size="2x" />
              </div>
            ) : versions ? (
              <Table responsive size="sm">
                <thead>
                  <tr>
                    <th>Version</th>
                    <th>Created</th>
                    <th>Size</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {/* Current version first */}
                  {versions.local.find((v) => v.tag === versions.current.tag) &&
                    renderVersionRow(
                      versions.local.find(
                        (v) => v.tag === versions.current.tag
                      )!,
                      true
                    )}
                  {/* Other local versions */}
                  {versions.local
                    .filter((v) => v.tag !== versions.current.tag)
                    .map((v) => renderVersionRow(v, false))}
                  {/* Available remote versions not yet pulled */}
                  {versions.available
                    .filter((v) => !versions.local.find((l) => l.tag === v.tag))
                    .slice(0, 10) // Limit to 10 remote versions
                    .map((v) => renderVersionRow(v, false))}
                </tbody>
              </Table>
            ) : (
              <p className="text-muted">Unable to load versions</p>
            )}
          </Card.Body>
          {versions && versions.available.length > 0 && (
            <Card.Footer>
              <Button
                variant="primary"
                onClick={() => handleStartUpdate()}
                disabled={
                  updateStatus?.state !== 'idle' &&
                  updateStatus?.state !== undefined
                }
              >
                <FontAwesomeIcon icon={faDownload} /> Update to Latest
              </Button>
            </Card.Footer>
          )}
        </Card>

        {/* Sponsoring Card */}
        <Card>
          <Card.Header>Sponsoring</Card.Header>
          <Card.Body>
            <p>
              If you find Signal K valuable to you consider sponsoring our work
              on developing it further.
            </p>
            <p>
              Your support allows us to do things like
              <ul>
                <li>travel to meet in person and push things forward</li>
                <li>purchase equipment to develop on</li>
                <li>upgrade our cloud resources beyond the free tiers</li>
              </ul>
            </p>
            <p>
              See{' '}
              <a href="https://opencollective.com/signalk">
                Signal K in Open Collective
              </a>{' '}
              for details.
            </p>
          </Card.Body>
        </Card>
      </div>
    )
  }

  // Standard SignalK Server mode UI (original)
  if (!appStore.storeAvailable) {
    return (
      <div className="animated fadeIn">
        <Card>
          <Card.Header>Waiting for App store data to load...</Card.Header>
        </Card>
      </div>
    )
  }

  let isInstalling = false
  let isInstalled = false
  const info = appStore.installing.find((p) => p.name === 'signalk-server')
  if (info) {
    if (info.isWaiting || info.isInstalling) {
      isInstalling = true
    } else {
      isInstalled = true
    }
  }

  return (
    <div className="animated fadeIn">
      {!appStore.canUpdateServer && (
        <Card className="border-warning">
          <Card.Header>Server Update</Card.Header>
          <Card.Body>
            This installation is not updatable from the admin user interface.
          </Card.Body>
        </Card>
      )}
      {appStore.isInDocker && (
        <Card className="border-warning">
          <Card.Header>Running as a Docker container</Card.Header>
          <Card.Body>
            <p>
              The server is running as a Docker container. You need to pull a
              new server version from Container registry to update.
            </p>
            <pre>
              <code>docker pull cr.signalk.io/signalk/signalk-server</code>
            </pre>
            <p>
              More info about running Signal K in Docker can be found at{' '}
              <a
                href="https://github.com/SignalK/signalk-server/blob/master/docker/README.md"
                target="_blank"
                rel="noopener noreferrer"
              >
                Docker README
              </a>{' '}
              .
            </p>
          </Card.Body>
        </Card>
      )}
      {appStore.canUpdateServer &&
        appStore.serverUpdate &&
        !isInstalling &&
        !isInstalled && (
          <Card>
            <Card.Header>
              Server version {appStore.serverUpdate} is available
            </Card.Header>
            <Card.Body>
              <a href="https://github.com/SignalK/signalk-server/releases/">
                Release Notes for latest releases.
              </a>
              <br />
              <br />
              <Button
                className="btn btn-danger"
                size="sm"
                variant="primary"
                onClick={handleUpdate}
              >
                Update
              </Button>
            </Card.Body>
          </Card>
        )}
      {isInstalling && (
        <Card>
          <Card.Header>Server Update</Card.Header>
          <Card.Body>The update is being installed</Card.Body>
        </Card>
      )}
      {isInstalled && (
        <Card>
          <Card.Header>Server Update</Card.Header>
          <Card.Body>
            The update has been installed, please restart the Signal K server.
          </Card.Body>
        </Card>
      )}
      {appStore.canUpdateServer && !appStore.serverUpdate && (
        <Card>
          <Card.Header>Server Update</Card.Header>
          <Card.Body>Your server is up to date.</Card.Body>
        </Card>
      )}

      <Card>
        <Card.Header>Sponsoring</Card.Header>
        <Card.Body>
          <p>
            If you find Signal K valuable to you consider sponsoring our work on
            developing it further.
          </p>
          <p>Your support allows us to do things like</p>
          <ul>
            <li>travel to meet in person and push things forward</li>
            <li>purchase equipment to develop on</li>
            <li>upgrade our cloud resources beyond the free tiers</li>
          </ul>
          <p>
            See{' '}
            <a href="https://opencollective.com/signalk">
              Signal K in Open Collective
            </a>{' '}
            for details.
          </p>
        </Card.Body>
      </Card>
    </div>
  )
}

export default ServerUpdate
