import React, { useState, useCallback, useEffect } from 'react'
import Alert from 'react-bootstrap/Alert'
import Badge from 'react-bootstrap/Badge'
import Button from 'react-bootstrap/Button'
import Card from 'react-bootstrap/Card'
import Col from 'react-bootstrap/Col'
import Form from 'react-bootstrap/Form'
import Nav from 'react-bootstrap/Nav'
import ProgressBar from 'react-bootstrap/ProgressBar'
import Row from 'react-bootstrap/Row'
import Tab from 'react-bootstrap/Tab'
import Table from 'react-bootstrap/Table'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faCircleNotch } from '@fortawesome/free-solid-svg-icons/faCircleNotch'
import { faCircleDot } from '@fortawesome/free-regular-svg-icons/faCircleDot'
import { faDownload } from '@fortawesome/free-solid-svg-icons/faDownload'
import { faTrash } from '@fortawesome/free-solid-svg-icons/faTrash'
import { faUpload } from '@fortawesome/free-solid-svg-icons/faUpload'
import { faClock } from '@fortawesome/free-solid-svg-icons/faClock'
import { useStore, useRestarting, useRuntimeConfig } from '../../store'
import { restartAction } from '../../actions'
import {
  backupApi,
  shouldUseKeeper,
  type KeeperBackup,
  type BackupListResponse,
  type BackupSchedulerStatus
} from '../../services/api'

const RESTORE_NONE = 0
const RESTORE_VALIDATING = 1
const RESTORE_CONFIRM = 2
const RESTORE_RUNNING = 3

interface RestoreStatus {
  state?: string
  message?: string
  percentComplete?: number
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

const BackupRestore: React.FC = () => {
  const restoreStatus = useStore(
    (state) => state.restoreStatus
  ) as RestoreStatus
  const restarting = useRestarting()
  const { useKeeper } = useRuntimeConfig()

  // Standard restore state
  const [restoreFile, setRestoreFile] = useState<File | null>(null)
  const [restoreState, setRestoreState] = useState(RESTORE_NONE)
  const [includePlugins, setIncludePlugins] = useState(false)
  const [restoreContents, setRestoreContents] = useState<
    Record<string, boolean>
  >({})

  // Keeper-specific state
  const [backupList, setBackupList] = useState<BackupListResponse | null>(null)
  const [schedulerStatus, setSchedulerStatus] =
    useState<BackupSchedulerStatus | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isCreatingBackup, setIsCreatingBackup] = useState(false)
  const [backupType, setBackupType] = useState<'full' | 'config' | 'plugins'>(
    'full'
  )
  const [backupDescription, setBackupDescription] = useState('')
  const [activeBackupTab, setActiveBackupTab] = useState<string>('all')

  useEffect(() => {
    if (useKeeper && shouldUseKeeper()) {
      loadBackups()
      loadSchedulerStatus()
    }
  }, [useKeeper])

  const loadBackups = async () => {
    setIsLoading(true)
    setError(null)
    try {
      const list = await backupApi.list()
      if (list) {
        setBackupList(list)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load backups')
    } finally {
      setIsLoading(false)
    }
  }

  const loadSchedulerStatus = async () => {
    try {
      const status = await backupApi.scheduler.status()
      if (status) {
        setSchedulerStatus(status)
      }
    } catch (err) {
      console.error('Failed to load scheduler status:', err)
    }
  }

  const cancelRestore = useCallback(() => {
    setRestoreState(RESTORE_NONE)
  }, [])

  const fileChanged = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      setRestoreFile(event.target.files?.[0] || null)
    },
    []
  )

  // Standard backup (download)
  const backup = useCallback(() => {
    const url = backupApi.getDownloadUrl(undefined, includePlugins)
    window.location.href = url
  }, [includePlugins])

  const createKeeperBackup = useCallback(async () => {
    setIsCreatingBackup(true)
    setError(null)
    try {
      await backupApi.create({
        type: backupType,
        description: backupDescription || undefined
      })
      setBackupDescription('')
      await loadBackups()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create backup')
    } finally {
      setIsCreatingBackup(false)
    }
  }, [backupType, backupDescription])

  const downloadBackup = useCallback((id: string) => {
    const url = backupApi.getDownloadUrl(id)
    window.location.href = url
  }, [])

  const deleteBackup = useCallback(async (id: string) => {
    if (!confirm('Are you sure you want to delete this backup?')) return
    try {
      await backupApi.delete(id)
      await loadBackups()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete backup')
    }
  }, [])

  const restoreKeeperBackup = useCallback(async (id: string) => {
    if (
      !confirm(
        'Are you sure you want to restore from this backup? This will overwrite your current settings.'
      )
    )
      return
    setRestoreState(RESTORE_RUNNING)
    try {
      await backupApi.restore(id)
      // The server will restart automatically
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to restore backup')
      setRestoreState(RESTORE_NONE)
    }
  }, [])

  // Standard restore flow
  const restore = useCallback(() => {
    const filesToRestore = Object.entries(restoreContents)
      .filter(([, selected]) => selected)
      .map(([filename]) => filename)

    backupApi
      .restore(filesToRestore)
      .then(() => {
        setRestoreState(RESTORE_RUNNING)
      })
      .catch((error) => {
        alert(error.message)
        setRestoreState(RESTORE_NONE)
        setRestoreFile(null)
      })
  }, [restoreContents])

  const handleRestart = useCallback(() => {
    restartAction()
    setRestoreState(RESTORE_NONE)
    window.location.href = '/admin/#/dashboard'
  }, [])

  const validate = useCallback(async () => {
    if (!restoreFile) {
      alert('Please choose a file')
      return
    }

    setRestoreState(RESTORE_VALIDATING)
    try {
      const result = await backupApi.upload(restoreFile)
      if ('files' in result && Array.isArray(result.files)) {
        // SignalK server response
        const contents: Record<string, boolean> = {}
        result.files.forEach((filename: string) => {
          contents[filename] = true
        })
        setRestoreState(RESTORE_CONFIRM)
        setRestoreContents(contents)
      } else if ('id' in result) {
        // Keeper response - file uploaded, can restore directly
        if (confirm('Backup file validated. Do you want to restore now?')) {
          await restoreKeeperBackup((result as KeeperBackup).id)
        } else {
          setRestoreState(RESTORE_NONE)
          await loadBackups()
        }
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Validation failed')
      setRestoreState(RESTORE_NONE)
      setRestoreFile(null)
    }
  }, [restoreFile, restoreKeeperBackup])

  const handleRestoreFileChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const value =
        event.target.type === 'checkbox'
          ? event.target.checked
          : event.target.value
      setRestoreContents((prev) => ({
        ...prev,
        [event.target.name]: value as boolean
      }))
    },
    []
  )

  const includePluginsChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      setIncludePlugins(event.target.checked)
    },
    []
  )

  const toggleScheduler = useCallback(async () => {
    if (!schedulerStatus) return
    try {
      const newStatus = await backupApi.scheduler.update({
        enabled: !schedulerStatus.enabled
      })
      if (newStatus) {
        setSchedulerStatus(newStatus)
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to update scheduler'
      )
    }
  }, [schedulerStatus])

  const fieldColWidthMd = 10

  const getBackupTypeColor = (type: string): string => {
    switch (type) {
      case 'manual':
        return 'primary'
      case 'full':
        return 'success'
      case 'config':
        return 'info'
      case 'plugins':
        return 'warning'
      default:
        return 'secondary'
    }
  }

  const renderBackupTable = (backups: KeeperBackup[], showType = false) => {
    if (backups.length === 0) {
      return <p className="text-muted text-center">No backups in this category</p>
    }
    return (
      <Table size="sm" responsive>
        <thead>
          <tr>
            <th>Date</th>
            {showType && <th>Type</th>}
            <th>Size</th>
            <th>Description</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {backups.map((backup) => (
            <tr key={backup.id}>
              <td>{formatDate(backup.created)}</td>
              {showType && (
                <td>
                  <Badge bg={getBackupTypeColor(backup.type)}>{backup.type}</Badge>
                </td>
              )}
              <td>{formatBytes(backup.size)}</td>
              <td>{backup.description || '-'}</td>
              <td>
                <Button
                  size="sm"
                  variant="primary"
                  className="me-1"
                  onClick={() => downloadBackup(backup.id)}
                  title="Download"
                >
                  <FontAwesomeIcon icon={faDownload} />
                </Button>
                <Button
                  size="sm"
                  variant="warning"
                  className="me-1"
                  onClick={() => restoreKeeperBackup(backup.id)}
                  title="Restore"
                >
                  <FontAwesomeIcon icon={faUpload} />
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() => deleteBackup(backup.id)}
                  title="Delete"
                >
                  <FontAwesomeIcon icon={faTrash} />
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
    )
  }

  const getAllBackups = (): KeeperBackup[] => {
    if (!backupList) return []
    return [
      ...backupList.backups.manual,
      ...backupList.backups.full,
      ...backupList.backups.config,
      ...backupList.backups.plugins
    ].sort((a, b) => new Date(b.created).getTime() - new Date(a.created).getTime())
  }

  const getBackupCount = (type: string): number => {
    if (!backupList) return 0
    if (type === 'all') return getAllBackups().length
    return backupList.backups[type as keyof typeof backupList.backups]?.length || 0
  }

  // Keeper mode UI
  if (useKeeper && shouldUseKeeper()) {
    return (
      <div>
        {error && (
          <Alert variant="danger" dismissible onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        {/* Create Backup Card */}
        <Card className="mb-4">
          <Card.Header>Create Backup</Card.Header>
          <Card.Body>
            <Form>
              <Row className="mb-3">
                <Form.Label column sm={2}>Type</Form.Label>
                <Col sm={10}>
                  <Form.Select
                    value={backupType}
                    onChange={(e) =>
                      setBackupType(
                        e.target.value as 'full' | 'config' | 'plugins'
                      )
                    }
                  >
                    <option value="full">Full (settings + plugins)</option>
                    <option value="config">Configuration only</option>
                    <option value="plugins">Plugins only</option>
                  </Form.Select>
                </Col>
              </Row>
              <Row className="mb-3">
                <Form.Label column sm={2}>Description</Form.Label>
                <Col sm={10}>
                  <Form.Control
                    type="text"
                    placeholder="Optional description"
                    value={backupDescription}
                    onChange={(e) => setBackupDescription(e.target.value)}
                  />
                </Col>
              </Row>
            </Form>
          </Card.Body>
          <Card.Footer>
            <Button
              variant="primary"
              onClick={createKeeperBackup}
              disabled={isCreatingBackup}
            >
              {isCreatingBackup ? (
                <FontAwesomeIcon icon={faCircleNotch} spin />
              ) : (
                <FontAwesomeIcon icon={faCircleDot} />
              )}{' '}
              Create Backup
            </Button>
          </Card.Footer>
        </Card>

        {/* Backup Scheduler Card */}
        {schedulerStatus && (
          <Card className="mb-4">
            <Card.Header>
              <FontAwesomeIcon icon={faClock} /> Automatic Backups
            </Card.Header>
            <Card.Body>
              <Row>
                <Col sm={6}>
                  <Form.Group>
                    <Form.Label>Status</Form.Label>
                    <div>
                      <Badge
                        bg={
                          schedulerStatus.enabled ? 'success' : 'danger'
                        }
                      >
                        {schedulerStatus.enabled ? 'Enabled' : 'Disabled'}
                      </Badge>
                    </div>
                  </Form.Group>
                </Col>
                {schedulerStatus.enabled && (
                  <>
                    <Col sm={6}>
                      <Form.Group>
                        <Form.Label>Next Run</Form.Label>
                        <div>
                          {schedulerStatus.nextRun
                            ? formatDate(schedulerStatus.nextRun)
                            : 'Not scheduled'}
                        </div>
                      </Form.Group>
                    </Col>
                    <Col sm={6}>
                      <Form.Group>
                        <Form.Label>Last Run</Form.Label>
                        <div>
                          {schedulerStatus.lastRun
                            ? formatDate(schedulerStatus.lastRun)
                            : 'Never'}
                          {schedulerStatus.lastResult && (
                            <Badge
                              bg={
                                schedulerStatus.lastResult === 'success'
                                  ? 'success'
                                  : 'danger'
                              }
                              className="ms-2"
                            >
                              {schedulerStatus.lastResult}
                            </Badge>
                          )}
                        </div>
                      </Form.Group>
                    </Col>
                  </>
                )}
              </Row>
            </Card.Body>
            <Card.Footer>
              <Button
                variant={schedulerStatus.enabled ? 'warning' : 'success'}
                onClick={toggleScheduler}
              >
                {schedulerStatus.enabled ? 'Disable' : 'Enable'} Automatic
                Backups
              </Button>
            </Card.Footer>
          </Card>
        )}

        {/* Backup List Card */}
        <Card className="mb-4">
          <Card.Header>
            Available Backups
            {backupList && (
              <span className="float-end text-muted">
                Total: {formatBytes(backupList.totalSize)} / Available:{' '}
                {formatBytes(backupList.availableSpace)}
              </span>
            )}
          </Card.Header>
          <Card.Body>
            {isLoading ? (
              <div className="text-center">
                <FontAwesomeIcon icon={faCircleNotch} spin size="2x" />
              </div>
            ) : backupList ? (
              <>
                <Tab.Container activeKey={activeBackupTab} onSelect={(k) => k && setActiveBackupTab(k)}>
                  <Nav variant="tabs" className="mb-3">
                    {[
                      { id: 'all', label: 'All' },
                      { id: 'manual', label: 'Manual' },
                      { id: 'full', label: 'Full' },
                      { id: 'config', label: 'Config' },
                      { id: 'plugins', label: 'Plugins' }
                    ].map((tab) => (
                      <Nav.Item key={tab.id}>
                        <Nav.Link eventKey={tab.id}>
                          {tab.label}
                          {getBackupCount(tab.id) > 0 && (
                            <Badge bg={getBackupTypeColor(tab.id)} pill className="ms-2">
                              {getBackupCount(tab.id)}
                            </Badge>
                          )}
                        </Nav.Link>
                      </Nav.Item>
                    ))}
                  </Nav>
                  <Tab.Content>
                    <Tab.Pane eventKey="all">
                      {getAllBackups().length > 0 ? (
                        renderBackupTable(getAllBackups(), true)
                      ) : (
                        <p className="text-muted text-center">No backups available</p>
                      )}
                    </Tab.Pane>
                    <Tab.Pane eventKey="manual">
                      {renderBackupTable(backupList.backups.manual)}
                    </Tab.Pane>
                    <Tab.Pane eventKey="full">
                      {renderBackupTable(backupList.backups.full)}
                    </Tab.Pane>
                    <Tab.Pane eventKey="config">
                      {renderBackupTable(backupList.backups.config)}
                    </Tab.Pane>
                    <Tab.Pane eventKey="plugins">
                      {renderBackupTable(backupList.backups.plugins)}
                    </Tab.Pane>
                  </Tab.Content>
                </Tab.Container>
              </>
            ) : (
              <p className="text-muted">Unable to load backups</p>
            )}
          </Card.Body>
          <Card.Footer>
            <Button
              variant="secondary"
              onClick={loadBackups}
              disabled={isLoading}
            >
              Refresh
            </Button>
          </Card.Footer>
        </Card>

        {/* Upload Restore File Card */}
        <Card>
          <Card.Header>Restore from File</Card.Header>
          <Card.Body>
            <Form.Text className="text-muted">
              Upload a backup file from another installation to restore
              settings.
            </Form.Text>
            <br />
            <Row className="mb-3">
              <Col xs="12" md={fieldColWidthMd}>
                <Form.Control
                  type="file"
                  name="backupFile"
                  onChange={fileChanged}
                  accept=".zip,.tar.gz,.tgz"
                />
              </Col>
            </Row>
            {restoreState === RESTORE_RUNNING && (
              <div>
                <Form.Text>Restoring... Please wait.</Form.Text>
                <ProgressBar animated variant="success" now={100} />
              </div>
            )}
          </Card.Body>
          <Card.Footer>
            <Button
              variant="danger"
              onClick={validate}
              disabled={
                restoreFile === null || restoreState === RESTORE_RUNNING
              }
            >
              {restoreState === RESTORE_VALIDATING ? (
                <FontAwesomeIcon icon={faCircleNotch} spin />
              ) : (
                <FontAwesomeIcon icon={faUpload} />
              )}{' '}
              Upload and Restore
            </Button>
          </Card.Footer>
        </Card>
      </div>
    )
  }

  // Standard SignalK Server mode UI (original)
  return (
    <div>
      {restoreState === RESTORE_NONE && !restoreStatus.state && (
        <Card>
          <Card.Header>Backup Settings</Card.Header>
          <Card.Body>
            <Form
              action=""
              method="post"
              encType="multipart/form-data"
              className="form-horizontal"
            >
              <Form.Text className="text-muted">
                This will backup your server and plugin settings.
              </Form.Text>
              <br />
              <Form.Group as={Row}>
                <Col xs="3" md="2">
                  <Form.Label htmlFor="backup-includePlugins">
                    Include Plugins
                  </Form.Label>
                </Col>
                <Col xs="2" md={fieldColWidthMd}>
                  <Form.Label className="switch switch-text switch-primary">
                    <Form.Control
                      type="checkbox"
                      id="backup-includePlugins"
                      name="enabled"
                      className="switch-input"
                      onChange={includePluginsChange}
                      checked={includePlugins}
                    />
                    <span
                      className="switch-label"
                      data-on="Yes"
                      data-off="No"
                    />
                    <span className="switch-handle" />
                  </Form.Label>
                  <Form.Text className="text-muted">
                    Selecting Yes will increase the size of the backup, but will
                    allow for offline restore.
                  </Form.Text>
                </Col>
              </Form.Group>
            </Form>
          </Card.Body>
          <Card.Footer>
            <Button size="sm" variant="primary" onClick={backup}>
              <FontAwesomeIcon icon={faCircleDot} /> Backup
            </Button>{' '}
          </Card.Footer>
        </Card>
      )}
      <Card>
        <Card.Header>Restore Settings</Card.Header>
        <Card.Body>
          <Form
            action=""
            method="post"
            encType="multipart/form-data"
            className="form-horizontal"
          >
            {restoreState === RESTORE_NONE && !restoreStatus.state && (
              <div>
                <Form.Text className="text-muted">
                  Please select the backup file from your device to use in
                  restoring the settings. Your existing settings will be
                  overwritten.
                </Form.Text>
                <br />
                <Form.Group as={Row}>
                  <Col xs="12" md={fieldColWidthMd}>
                    <Form.Control
                      type="file"
                      name="backupFile"
                      onChange={fileChanged}
                    />
                  </Col>
                </Form.Group>
              </div>
            )}
            {restoreState === RESTORE_CONFIRM && (
              <Form.Group>
                <Col xs="12" md={fieldColWidthMd}>
                  {Object.keys(restoreContents).map((name) => {
                    return (
                      <div key={name}>
                        <Form.Label className="switch switch-text switch-primary">
                          <Form.Control
                            type="checkbox"
                            id={name}
                            name={name}
                            className="switch-input"
                            onChange={handleRestoreFileChange}
                            checked={restoreContents[name]}
                          />
                          <span
                            className="switch-label"
                            data-on="Yes"
                            data-off="No"
                          />
                          <span className="switch-handle" />
                        </Form.Label>{' '}
                        {name}
                      </div>
                    )
                  })}
                </Col>
              </Form.Group>
            )}
            {restoreStatus &&
              restoreStatus.state &&
              restoreStatus.state !== 'Complete' && (
                <div>
                  <Form.Group as={Row}>
                    <Col xs="12" md={fieldColWidthMd}>
                      <Form.Text>
                        {restoreStatus.state} : {restoreStatus.message}
                      </Form.Text>
                    </Col>
                  </Form.Group>
                  <Form.Group as={Row}>
                    <Col xs="12" md={fieldColWidthMd}>
                      <ProgressBar
                        animated
                        variant="success"
                        now={restoreStatus.percentComplete}
                      />
                    </Col>
                  </Form.Group>
                </div>
              )}
            {restoreStatus.state && restoreStatus.state === 'Complete' && (
              <div>
                <Form.Group as={Row}>
                  <Col xs="12" md={fieldColWidthMd}>
                    <Form.Text>Please Restart</Form.Text>
                  </Col>
                </Form.Group>
                <Form.Group as={Row}>
                  <Col xs="12" md={fieldColWidthMd}>
                    <Button size="sm" variant="danger" onClick={handleRestart}>
                      <FontAwesomeIcon icon={faCircleNotch} spin={restarting} />{' '}
                      Restart
                    </Button>
                  </Col>
                </Form.Group>
              </div>
            )}
          </Form>
        </Card.Body>
        <Card.Footer>
          {restoreState === RESTORE_NONE && !restoreStatus.state && (
            <div>
              <Button
                size="sm"
                variant="danger"
                onClick={validate}
                disabled={restoreFile === null}
              >
                <FontAwesomeIcon icon={faCircleDot} /> Restore
              </Button>{' '}
            </div>
          )}
          {restoreState === RESTORE_CONFIRM && (
            <div>
              <Button size="sm" variant="primary" onClick={cancelRestore}>
                <FontAwesomeIcon icon={faCircleDot} /> Cancel
              </Button>{' '}
              <Button size="sm" variant="danger" onClick={restore}>
                <FontAwesomeIcon icon={faCircleDot} /> Confirm
              </Button>
            </div>
          )}
        </Card.Footer>
      </Card>
    </div>
  )
}

export default BackupRestore
