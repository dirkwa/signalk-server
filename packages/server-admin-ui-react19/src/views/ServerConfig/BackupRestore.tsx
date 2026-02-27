import React, { useState, useCallback, useEffect } from 'react'
// react-bootstrap (used by upstream/standard UI sections)
import Button from 'react-bootstrap/Button'
import Card from 'react-bootstrap/Card'
import Col from 'react-bootstrap/Col'
import Form from 'react-bootstrap/Form'
import Row from 'react-bootstrap/Row'
import ProgressBar from 'react-bootstrap/ProgressBar'
// reactstrap (used by Keeper UI sections)
import {
  CardHeader,
  CardBody,
  CardFooter,
  Input,
  FormGroup,
  FormText,
  Progress,
  Table,
  Badge,
  Alert,
  Nav,
  NavItem,
  NavLink,
  TabContent,
  TabPane,
  Modal,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Label
} from 'reactstrap'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faCircleNotch } from '@fortawesome/free-solid-svg-icons/faCircleNotch'
import { faCircleDot } from '@fortawesome/free-regular-svg-icons/faCircleDot'
import { faDownload } from '@fortawesome/free-solid-svg-icons/faDownload'
import { faTrash } from '@fortawesome/free-solid-svg-icons/faTrash'
import { faUpload } from '@fortawesome/free-solid-svg-icons/faUpload'
import { faClock } from '@fortawesome/free-solid-svg-icons/faClock'
import { faLock } from '@fortawesome/free-solid-svg-icons/faLock'
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

  // Password state
  const [hasCustomPassword, setHasCustomPassword] = useState(false)
  const [passwordModalOpen, setPasswordModalOpen] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [resetModalOpen, setResetModalOpen] = useState(false)
  const [passwordLoading, setPasswordLoading] = useState(false)

  useEffect(() => {
    if (useKeeper && shouldUseKeeper()) {
      loadBackups()
      loadSchedulerStatus()
      loadPasswordStatus()
    }
  }, [useKeeper])

  const loadPasswordStatus = async () => {
    try {
      const status = await backupApi.password.status()
      if (status) {
        setHasCustomPassword(status.hasCustomPassword)
      }
    } catch (err) {
      console.error('Failed to load password status:', err)
    }
  }

  const handleChangePassword = async () => {
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match')
      return
    }
    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters')
      return
    }
    setPasswordLoading(true)
    try {
      await backupApi.password.change(newPassword, confirmPassword)
      setHasCustomPassword(true)
      setPasswordModalOpen(false)
      setNewPassword('')
      setConfirmPassword('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to change password')
    } finally {
      setPasswordLoading(false)
    }
  }

  const handleResetPassword = async () => {
    setPasswordLoading(true)
    try {
      await backupApi.password.reset()
      setHasCustomPassword(false)
      setResetModalOpen(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reset password')
    } finally {
      setPasswordLoading(false)
    }
  }

  const passwordsMatch =
    newPassword.length >= 8 && newPassword === confirmPassword

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
      return (
        <p className="text-muted text-center">No backups in this category</p>
      )
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
                  <Badge color={getBackupTypeColor(backup.type)}>
                    {backup.type}
                  </Badge>
                </td>
              )}
              <td>{formatBytes(backup.size)}</td>
              <td>{backup.description || '-'}</td>
              <td>
                <Button
                  size="sm"
                  color="primary"
                  className="me-1"
                  onClick={() => downloadBackup(backup.id)}
                  title="Download"
                >
                  <FontAwesomeIcon icon={faDownload} />
                </Button>
                <Button
                  size="sm"
                  color="warning"
                  className="me-1"
                  onClick={() => restoreKeeperBackup(backup.id)}
                  title="Restore"
                >
                  <FontAwesomeIcon icon={faUpload} />
                </Button>
                <Button
                  size="sm"
                  color="danger"
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
    ].sort(
      (a, b) => new Date(b.created).getTime() - new Date(a.created).getTime()
    )
  }

  const getBackupCount = (type: string): number => {
    if (!backupList) return 0
    if (type === 'all') return getAllBackups().length
    return (
      backupList.backups[type as keyof typeof backupList.backups]?.length || 0
    )
  }

  // Keeper mode UI
  if (useKeeper && shouldUseKeeper()) {
    return (
      <div>
        {error && (
          <Alert color="danger" toggle={() => setError(null)}>
            {error}
          </Alert>
        )}

        {/* Create Backup Card */}
        <Card className="mb-4">
          <CardHeader>Create Backup</CardHeader>
          <CardBody>
            <Form>
              <FormGroup row>
                <Label sm={2}>Type</Label>
                <Col sm={10}>
                  <Input
                    type="select"
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
                  </Input>
                </Col>
              </FormGroup>
              <FormGroup row>
                <Label sm={2}>Description</Label>
                <Col sm={10}>
                  <Input
                    type="text"
                    placeholder="Optional description"
                    value={backupDescription}
                    onChange={(e) => setBackupDescription(e.target.value)}
                  />
                </Col>
              </FormGroup>
            </Form>
          </CardBody>
          <CardFooter>
            <Button
              color="primary"
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
          </CardFooter>
        </Card>

        {/* Backup Scheduler Card */}
        {schedulerStatus && (
          <Card className="mb-4">
            <CardHeader>
              <FontAwesomeIcon icon={faClock} /> Automatic Backups
            </CardHeader>
            <CardBody>
              <Row>
                <Col sm={6}>
                  <FormGroup>
                    <Label>Status</Label>
                    <div>
                      <Badge
                        color={schedulerStatus.enabled ? 'success' : 'danger'}
                      >
                        {schedulerStatus.enabled ? 'Enabled' : 'Disabled'}
                      </Badge>
                    </div>
                  </FormGroup>
                </Col>
                {schedulerStatus.enabled && (
                  <>
                    <Col sm={6}>
                      <FormGroup>
                        <Label>Next Run</Label>
                        <div>
                          {schedulerStatus.nextRun
                            ? formatDate(schedulerStatus.nextRun)
                            : 'Not scheduled'}
                        </div>
                      </FormGroup>
                    </Col>
                    <Col sm={6}>
                      <FormGroup>
                        <Label>Last Run</Label>
                        <div>
                          {schedulerStatus.lastRun
                            ? formatDate(schedulerStatus.lastRun)
                            : 'Never'}
                          {schedulerStatus.lastResult && (
                            <Badge
                              color={
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
                      </FormGroup>
                    </Col>
                  </>
                )}
              </Row>
            </CardBody>
            <CardFooter>
              <Button
                color={schedulerStatus.enabled ? 'warning' : 'success'}
                onClick={toggleScheduler}
              >
                {schedulerStatus.enabled ? 'Disable' : 'Enable'} Automatic
                Backups
              </Button>
            </CardFooter>
          </Card>
        )}

        {/* Backup List Card */}
        <Card className="mb-4">
          <CardHeader>
            Available Backups
            {backupList && (
              <span className="float-end text-muted">
                Total: {formatBytes(backupList.totalSize)} / Available:{' '}
                {formatBytes(backupList.availableSpace)}
              </span>
            )}
          </CardHeader>
          <CardBody>
            {isLoading ? (
              <div className="text-center">
                <FontAwesomeIcon icon={faCircleNotch} spin size="2x" />
              </div>
            ) : backupList ? (
              <>
                <Nav tabs className="mb-3">
                  {[
                    { id: 'all', label: 'All' },
                    { id: 'manual', label: 'Manual' },
                    { id: 'full', label: 'Full' },
                    { id: 'config', label: 'Config' },
                    { id: 'plugins', label: 'Plugins' }
                  ].map((tab) => (
                    <NavItem key={tab.id}>
                      <NavLink
                        className={activeBackupTab === tab.id ? 'active' : ''}
                        onClick={() => setActiveBackupTab(tab.id)}
                        style={{ cursor: 'pointer' }}
                      >
                        {tab.label}
                        {getBackupCount(tab.id) > 0 && (
                          <Badge
                            color={getBackupTypeColor(tab.id)}
                            pill
                            className="ms-2"
                          >
                            {getBackupCount(tab.id)}
                          </Badge>
                        )}
                      </NavLink>
                    </NavItem>
                  ))}
                </Nav>
                <TabContent activeTab={activeBackupTab}>
                  <TabPane tabId="all">
                    {getAllBackups().length > 0 ? (
                      renderBackupTable(getAllBackups(), true)
                    ) : (
                      <p className="text-muted text-center">
                        No backups available
                      </p>
                    )}
                  </TabPane>
                  <TabPane tabId="manual">
                    {renderBackupTable(backupList.backups.manual)}
                  </TabPane>
                  <TabPane tabId="full">
                    {renderBackupTable(backupList.backups.full)}
                  </TabPane>
                  <TabPane tabId="config">
                    {renderBackupTable(backupList.backups.config)}
                  </TabPane>
                  <TabPane tabId="plugins">
                    {renderBackupTable(backupList.backups.plugins)}
                  </TabPane>
                </TabContent>
              </>
            ) : (
              <p className="text-muted">Unable to load backups</p>
            )}
          </CardBody>
          <CardFooter>
            <Button
              color="secondary"
              onClick={loadBackups}
              disabled={isLoading}
            >
              Refresh
            </Button>
          </CardFooter>
        </Card>

        {/* Upload Restore File Card */}
        <Card className="mb-4">
          <CardHeader>Restore from File</CardHeader>
          <CardBody>
            <FormText color="muted">
              Upload a backup file from another installation to restore
              settings.
            </FormText>
            <br />
            <FormGroup row>
              <Col xs="12" md={fieldColWidthMd}>
                <Input
                  type="file"
                  name="backupFile"
                  onChange={fileChanged}
                  accept=".zip,.tar.gz,.tgz"
                />
              </Col>
            </FormGroup>
            {restoreState === RESTORE_RUNNING && (
              <div>
                <FormText>Restoring... Please wait.</FormText>
                <Progress animated color="success" value={100} />
              </div>
            )}
          </CardBody>
          <CardFooter>
            <Button
              color="danger"
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
          </CardFooter>
        </Card>

        {/* Backup Password Card */}
        <Card>
          <CardHeader>
            <FontAwesomeIcon icon={faLock} /> Backup Password
          </CardHeader>
          <CardBody>
            <Row className="align-items-center">
              <Col>
                <p className="mb-1">
                  <strong>Status:</strong>{' '}
                  <Badge color={hasCustomPassword ? 'success' : 'secondary'}>
                    {hasCustomPassword ? 'Custom password' : 'Default password'}
                  </Badge>
                </p>
                <FormText color="muted">
                  All backups are password-protected. A default password is used
                  unless you set a custom one.
                </FormText>
              </Col>
            </Row>
          </CardBody>
          <CardFooter>
            <Button
              color="primary"
              className="me-2"
              onClick={() => setPasswordModalOpen(true)}
            >
              Change Password
            </Button>
            {hasCustomPassword && (
              <Button color="warning" onClick={() => setResetModalOpen(true)}>
                Reset to Default
              </Button>
            )}
          </CardFooter>
        </Card>

        {/* Change Password Modal */}
        <Modal
          isOpen={passwordModalOpen}
          toggle={() => setPasswordModalOpen(false)}
        >
          <ModalHeader toggle={() => setPasswordModalOpen(false)}>
            Change Backup Password
          </ModalHeader>
          <ModalBody>
            <Alert color="warning">
              <strong>Warning:</strong> Changing the password will re-create the
              backup repository. Existing backups will be lost.
            </Alert>
            <FormGroup>
              <Label for="new-password">New Password</Label>
              <Input
                type="password"
                id="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Minimum 8 characters"
              />
            </FormGroup>
            <FormGroup>
              <Label for="confirm-password">Confirm Password</Label>
              <Input
                type="password"
                id="confirm-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Re-enter password"
                valid={confirmPassword.length > 0 && passwordsMatch}
                invalid={confirmPassword.length > 0 && !passwordsMatch}
              />
            </FormGroup>
          </ModalBody>
          <ModalFooter>
            <Button
              color="secondary"
              onClick={() => setPasswordModalOpen(false)}
            >
              Cancel
            </Button>
            <Button
              color="danger"
              onClick={handleChangePassword}
              disabled={!passwordsMatch || passwordLoading}
            >
              {passwordLoading ? (
                <FontAwesomeIcon icon={faCircleNotch} spin />
              ) : (
                'Change Password'
              )}
            </Button>
          </ModalFooter>
        </Modal>

        {/* Reset Password Modal */}
        <Modal isOpen={resetModalOpen} toggle={() => setResetModalOpen(false)}>
          <ModalHeader toggle={() => setResetModalOpen(false)}>
            Reset to Default Password
          </ModalHeader>
          <ModalBody>
            <Alert color="warning">
              This will reset to the default password and re-create the backup
              repository. Existing backups will be lost.
            </Alert>
          </ModalBody>
          <ModalFooter>
            <Button color="secondary" onClick={() => setResetModalOpen(false)}>
              Cancel
            </Button>
            <Button
              color="warning"
              onClick={handleResetPassword}
              disabled={passwordLoading}
            >
              {passwordLoading ? (
                <FontAwesomeIcon icon={faCircleNotch} spin />
              ) : (
                'Reset to Default'
              )}
            </Button>
          </ModalFooter>
        </Modal>
      </div>
    )
  }

  // Standard SignalK Server mode UI (original — uses react-bootstrap)
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
