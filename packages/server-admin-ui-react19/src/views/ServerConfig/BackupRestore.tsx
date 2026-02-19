import React, { useState, useCallback, useEffect, useRef } from 'react'
import Alert from 'react-bootstrap/Alert'
import Badge from 'react-bootstrap/Badge'
import Button from 'react-bootstrap/Button'
import Card from 'react-bootstrap/Card'
import Col from 'react-bootstrap/Col'
import Form from 'react-bootstrap/Form'
import Modal from 'react-bootstrap/Modal'
import Nav from 'react-bootstrap/Nav'
import ProgressBar from 'react-bootstrap/ProgressBar'
import Row from 'react-bootstrap/Row'
import Spinner from 'react-bootstrap/Spinner'
import Tab from 'react-bootstrap/Tab'
import Table from 'react-bootstrap/Table'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faCircleNotch } from '@fortawesome/free-solid-svg-icons/faCircleNotch'
import { faCircleDot } from '@fortawesome/free-regular-svg-icons/faCircleDot'
import { faDownload } from '@fortawesome/free-solid-svg-icons/faDownload'
import { faTrash } from '@fortawesome/free-solid-svg-icons/faTrash'
import { faUpload } from '@fortawesome/free-solid-svg-icons/faUpload'
import { faClock } from '@fortawesome/free-solid-svg-icons/faClock'
import { faLock } from '@fortawesome/free-solid-svg-icons/faLock'
import { faCloud } from '@fortawesome/free-solid-svg-icons/faCloud'
import { faCloudArrowUp } from '@fortawesome/free-solid-svg-icons/faCloudArrowUp'
import { faLink } from '@fortawesome/free-solid-svg-icons/faLink'
import { faLinkSlash } from '@fortawesome/free-solid-svg-icons/faLinkSlash'
import { faWifi } from '@fortawesome/free-solid-svg-icons/faWifi'
import { faEye } from '@fortawesome/free-solid-svg-icons/faEye'
import { faEyeSlash } from '@fortawesome/free-solid-svg-icons/faEyeSlash'
import { faCopy } from '@fortawesome/free-solid-svg-icons/faCopy'
import { faCloudArrowDown } from '@fortawesome/free-solid-svg-icons/faCloudArrowDown'
import { faFolder } from '@fortawesome/free-solid-svg-icons/faFolder'
import { useStore, useRestarting, useRuntimeConfig } from '../../store'
import { restartAction } from '../../actions'
import {
  backupApi,
  cloudApi,
  shouldUseKeeper,
  type KeeperBackup,
  type BackupListResponse,
  type BackupSchedulerStatus
} from '../../services/api'
import type {
  CloudSyncStatus,
  PasswordStatusResult
} from '../../services/api/types'

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
  const [activeBackupTab, setActiveBackupTab] = useState<string>('all')

  // Password state
  const [hasCustomPassword, setHasCustomPassword] = useState(false)
  const [passwordModalOpen, setPasswordModalOpen] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [resetModalOpen, setResetModalOpen] = useState(false)
  const [passwordLoading, setPasswordLoading] = useState(false)

  // Cloud backup state
  const [cloudStatus, setCloudStatus] = useState<CloudSyncStatus | null>(null)
  const [passwordStatus, setPasswordStatus] =
    useState<PasswordStatusResult | null>(null)
  const [showRecoveryPassword, setShowRecoveryPassword] = useState(false)
  const [disconnectConfirm, setDisconnectConfirm] = useState(false)
  const [cloudLoading, setCloudLoading] = useState(false)
  const [authPolling, setAuthPolling] = useState(false)
  const [callbackUrl, setCallbackUrl] = useState('')
  const [showCallbackFallback, setShowCallbackFallback] = useState(false)
  const authPollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const authStartTimeRef = useRef<number>(0)

  // Cloud restore state
  const [showCloudRestore, setShowCloudRestore] = useState(false)
  const [cloudRestoreStep, setCloudRestoreStep] = useState<
    | 'select-install'
    | 'enter-password'
    | 'preparing'
    | 'select-snapshot'
    | 'confirm'
    | 'restoring'
  >('select-install')
  const [cloudInstalls, setCloudInstalls] = useState<
    Array<{
      folder: string
      info?: {
        installName?: string
        vesselName?: string
        hardware?: string
        lastUpdated?: string
      }
    }>
  >([])
  const [selectedInstall, setSelectedInstall] = useState<
    (typeof cloudInstalls)[0] | null
  >(null)
  const [cloudRestorePassword, setCloudRestorePassword] = useState('')
  const [cloudSnapshots, setCloudSnapshots] = useState<
    Array<{
      id: string
      createdAt: string
      version: { tag: string }
      type: string
      size: number
      description?: string
    }>
  >([])
  const [selectedCloudSnapshot, setSelectedCloudSnapshot] = useState<
    string | null
  >(null)
  const [cloudRestoreMode, setCloudRestoreMode] = useState<'restore' | 'clone'>(
    'restore'
  )
  const [cloudRestoreError, setCloudRestoreError] = useState<string | null>(
    null
  )

  // Backup exclusions state
  const [dataDirs, setDataDirs] = useState<
    Array<{
      name: string
      size: number
      excluded: boolean
      type?: 'dir' | 'history'
    }>
  >([])
  const [dataDirsLoading, setDataDirsLoading] = useState(true)
  const [savedExclusions, setSavedExclusions] = useState<string[]>([])
  const [showExclusionConfirm, setShowExclusionConfirm] = useState(false)

  // Check if exclusions have been locally modified
  const currentExclusions = dataDirs
    .filter((d) => d.excluded)
    .map((d) => d.name + '/')
    .sort()
  const exclusionsChanged =
    JSON.stringify(currentExclusions) !==
    JSON.stringify([...savedExclusions].sort())

  useEffect(() => {
    if (useKeeper && shouldUseKeeper()) {
      loadBackups()
      loadSchedulerStatus()
      loadPasswordStatus()
      loadCloudStatus()
      loadDataDirs()
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

  const loadCloudStatus = async () => {
    try {
      const status = await cloudApi.status()
      if (status) {
        setCloudStatus(status)
      }
      const pw = await cloudApi.password()
      if (pw) {
        setPasswordStatus(pw)
      }
    } catch (err) {
      console.error('Failed to load cloud status:', err)
    }
  }

  const loadDataDirs = async () => {
    try {
      const dirs = await backupApi.dataDirs()
      if (dirs) {
        setDataDirs(dirs)
        setSavedExclusions(
          dirs.filter((d) => d.excluded).map((d) => d.name + '/')
        )
      }
    } catch (err) {
      console.error('Failed to load data directories:', err)
    } finally {
      setDataDirsLoading(false)
    }
  }

  const handleExclusionToggle = (dirName: string, excluded: boolean) => {
    setDataDirs((prev) =>
      prev.map((d) => (d.name === dirName ? { ...d, excluded } : d))
    )
  }

  const resetExclusions = () => {
    setDataDirs((prev) =>
      prev.map((d) => ({
        ...d,
        excluded: savedExclusions.includes(d.name + '/')
      }))
    )
  }

  const saveExclusions = async () => {
    setShowExclusionConfirm(false)
    try {
      const newExclusions = dataDirs
        .filter((d) => d.excluded)
        .map((d) => d.name + '/')
      await backupApi.exclusions.update(newExclusions)
      setSavedExclusions(newExclusions)
      await loadBackups()
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to update exclusions'
      )
      loadDataDirs()
    }
  }

  const handleConnectGDrive = async () => {
    setCloudLoading(true)
    try {
      const result = await cloudApi.gdrive.connect()
      window.open(result.authUrl, '_blank', 'width=600,height=700')
      // Start polling for auth completion
      setAuthPolling(true)
      setShowCallbackFallback(false)
      setCallbackUrl('')
      authStartTimeRef.current = Date.now()
      if (authPollRef.current) clearInterval(authPollRef.current)
      authPollRef.current = setInterval(async () => {
        try {
          const state = await cloudApi.gdrive.authState()
          if (state.state === 'completed') {
            if (authPollRef.current) clearInterval(authPollRef.current)
            authPollRef.current = null
            setAuthPolling(false)
            setShowCallbackFallback(false)
            await loadCloudStatus()
          } else if (state.state === 'failed') {
            if (authPollRef.current) clearInterval(authPollRef.current)
            authPollRef.current = null
            setAuthPolling(false)
            setShowCallbackFallback(false)
            setError(state.error || 'Authorization failed')
          } else if (Date.now() - authStartTimeRef.current > 15000) {
            // After 15s, show fallback for remote users
            setShowCallbackFallback(true)
          }
        } catch {
          // Ignore poll errors
        }
      }, 2000)
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to connect Google Drive'
      )
    } finally {
      setCloudLoading(false)
    }
  }

  const handleCancelAuth = useCallback(async () => {
    if (authPollRef.current) {
      clearInterval(authPollRef.current)
      authPollRef.current = null
    }
    setAuthPolling(false)
    setShowCallbackFallback(false)
    setCallbackUrl('')
    try {
      await cloudApi.gdrive.cancel()
    } catch {
      // Ignore cancel errors
    }
  }, [])

  const handleForwardCallback = useCallback(async () => {
    if (!callbackUrl.trim()) return
    try {
      await cloudApi.gdrive.forwardCallback(callbackUrl.trim())
      // Auth state polling will pick up the completion
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to forward callback'
      )
    }
  }, [callbackUrl])

  // Cleanup auth polling on unmount
  useEffect(() => {
    return () => {
      if (authPollRef.current) {
        clearInterval(authPollRef.current)
      }
    }
  }, [])

  const handleDisconnectGDrive = async () => {
    setCloudLoading(true)
    try {
      await cloudApi.gdrive.disconnect()
      setDisconnectConfirm(false)
      await loadCloudStatus()
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to disconnect Google Drive'
      )
    } finally {
      setCloudLoading(false)
    }
  }

  const handleCloudSync = async () => {
    try {
      await cloudApi.sync()
      // Optimistically show syncing state immediately
      setCloudStatus((prev) => (prev ? { ...prev, syncing: true } : prev))
      // Poll will pick up via the useEffect that watches cloudStatus.syncing
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start sync')
    }
  }

  const handleSyncModeChange = async (syncMode: string) => {
    try {
      await cloudApi.updateConfig({ syncMode })
      await loadCloudStatus()
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to update sync mode'
      )
    }
  }

  const handleSyncFrequencyChange = async (syncFrequency: string) => {
    try {
      await cloudApi.updateConfig({ syncFrequency })
      await loadCloudStatus()
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to update sync frequency'
      )
    }
  }

  // Poll cloud status while syncing
  useEffect(() => {
    if (!cloudStatus?.syncing) return
    const interval = setInterval(loadCloudStatus, 5000)
    return () => clearInterval(interval)
  }, [cloudStatus?.syncing])

  // Cloud restore handlers
  const openCloudRestore = useCallback(async () => {
    setCloudRestoreError(null)
    setCloudRestoreStep('select-install')
    setSelectedInstall(null)
    setCloudRestorePassword('')
    setCloudSnapshots([])
    setSelectedCloudSnapshot(null)
    setCloudRestoreMode('restore')
    setShowCloudRestore(true)
    setCloudLoading(true)

    try {
      const installs = await cloudApi.installs()
      setCloudInstalls(installs || [])
    } catch (err) {
      setCloudRestoreError(
        err instanceof Error
          ? err.message
          : 'Failed to load cloud installations'
      )
    } finally {
      setCloudLoading(false)
    }
  }, [])

  const handleCloudRestorePrepare = useCallback(async () => {
    if (!selectedInstall) return
    setCloudRestoreError(null)
    setCloudRestoreStep('preparing')

    try {
      const result = await cloudApi.restorePrepare(
        selectedInstall.folder,
        cloudRestorePassword || undefined
      )

      if (result.phase === 'failed') {
        setCloudRestoreError(result.error || 'Failed to prepare cloud restore')
        setCloudRestoreStep('enter-password')
        return
      }

      setCloudSnapshots(result.snapshots)
      setCloudRestoreStep('select-snapshot')
    } catch (err) {
      setCloudRestoreError(
        err instanceof Error ? err.message : 'Failed to prepare cloud restore'
      )
      setCloudRestoreStep('enter-password')
    }
  }, [selectedInstall, cloudRestorePassword])

  const handleCloudRestoreStart = useCallback(async () => {
    if (!selectedCloudSnapshot) return
    setCloudRestoreError(null)
    setCloudRestoreStep('restoring')

    try {
      await cloudApi.restoreStart(selectedCloudSnapshot, cloudRestoreMode)
      setShowCloudRestore(false)
      // The restore is now running - SignalK will restart
      setRestoreState(RESTORE_RUNNING)
    } catch (err) {
      setCloudRestoreError(
        err instanceof Error ? err.message : 'Failed to start cloud restore'
      )
      setCloudRestoreStep('confirm')
    }
  }, [selectedCloudSnapshot, cloudRestoreMode])

  const closeCloudRestore = useCallback(() => {
    setShowCloudRestore(false)
    cloudApi.restoreReset().catch(() => {})
  }, [])

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
      await backupApi.create({ type: 'full' })
      await loadBackups()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create backup')
    } finally {
      setIsCreatingBackup(false)
    }
  }, [])

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
                  <Badge bg={getBackupTypeColor(backup.type)}>
                    {backup.type}
                  </Badge>
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
          <Alert variant="danger" dismissible onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        {/* Backup Exclusions Card */}
        <Card className="mb-4">
          <Card.Header>
            <FontAwesomeIcon icon={faFolder} /> Backup Exclusions
          </Card.Header>
          <Card.Body>
            {dataDirsLoading ? (
              <div className="text-center py-3">
                <FontAwesomeIcon icon={faCircleNotch} spin />
              </div>
            ) : dataDirs.length === 0 ? (
              <Form.Text className="text-muted">
                No data directories found.
              </Form.Text>
            ) : (
              <>
                <Form.Text className="text-muted d-block mb-2">
                  Excluded directories are not included in backups. Charts and
                  plugins can be re-downloaded after restore.
                </Form.Text>
                {dataDirs.map((dir) => (
                  <Form.Check
                    key={dir.name}
                    type="checkbox"
                    id={`exclude-${dir.name}`}
                    checked={dir.excluded}
                    onChange={(e) =>
                      handleExclusionToggle(dir.name, e.target.checked)
                    }
                    label={
                      <span>
                        {dir.name}{' '}
                        <span className="text-muted">
                          ({formatBytes(dir.size)})
                        </span>
                        {dir.name === 'node_modules' && (
                          <span className="text-muted fst-italic">
                            {' '}
                            — reinstalled on restore
                          </span>
                        )}
                        {dir.name.startsWith('charts') && (
                          <span className="text-muted fst-italic">
                            {' '}
                            — re-downloadable
                          </span>
                        )}
                      </span>
                    }
                  />
                ))}
                {exclusionsChanged && (
                  <>
                    <Alert variant="warning" className="mt-3 mb-0 py-2">
                      Changing exclusions will delete all existing backups to
                      reclaim space. If cloud sync is enabled, you&apos;ll also
                      need to delete the backup folder on Google Drive and sync
                      again.
                    </Alert>
                    <div className="mt-2 d-flex gap-2">
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={() => setShowExclusionConfirm(true)}
                      >
                        Save Changes
                      </Button>
                      <Button
                        variant="outline-secondary"
                        size="sm"
                        onClick={resetExclusions}
                      >
                        Discard
                      </Button>
                    </div>
                  </>
                )}
              </>
            )}
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
              Create Manual Backup
            </Button>
          </Card.Footer>
        </Card>

        {/* Backup Password Card */}
        <Card className="mb-4">
          <Card.Header>
            <FontAwesomeIcon icon={faLock} /> Backup Password
          </Card.Header>
          <Card.Body>
            <Row className="align-items-center">
              <Col>
                <p className="mb-1">
                  <strong>Status:</strong>{' '}
                  <Badge bg={hasCustomPassword ? 'success' : 'secondary'}>
                    {hasCustomPassword ? 'Custom password' : 'Default password'}
                  </Badge>
                </p>
                <Form.Text className="text-muted">
                  All backups are password-protected. A default password is used
                  unless you set a custom one.
                </Form.Text>
                {passwordStatus?.password && (
                  <div className="mt-2 d-flex align-items-center gap-2">
                    <strong>Recovery Password:</strong>
                    <code>
                      {showRecoveryPassword
                        ? passwordStatus.password
                        : '\u2022'.repeat(16)}
                    </code>
                    <Button
                      variant="link"
                      size="sm"
                      className="p-0"
                      onClick={() =>
                        setShowRecoveryPassword(!showRecoveryPassword)
                      }
                      title={
                        showRecoveryPassword ? 'Hide password' : 'Show password'
                      }
                    >
                      <FontAwesomeIcon
                        icon={showRecoveryPassword ? faEyeSlash : faEye}
                      />
                    </Button>
                    <Button
                      variant="link"
                      size="sm"
                      className="p-0"
                      onClick={() => {
                        if (passwordStatus?.password) {
                          navigator.clipboard.writeText(passwordStatus.password)
                        }
                      }}
                      title="Copy to clipboard"
                    >
                      <FontAwesomeIcon icon={faCopy} />
                    </Button>
                  </div>
                )}
                <Form.Text className="text-muted d-block mt-1">
                  You need this password to restore backups on a new device.
                </Form.Text>
              </Col>
            </Row>
          </Card.Body>
          <Card.Footer>
            <Button
              variant="primary"
              className="me-2"
              onClick={() => setPasswordModalOpen(true)}
            >
              Change Password
            </Button>
            {hasCustomPassword && (
              <Button variant="warning" onClick={() => setResetModalOpen(true)}>
                Reset to Default
              </Button>
            )}
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
                        bg={schedulerStatus.enabled ? 'success' : 'danger'}
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
                <Tab.Container
                  activeKey={activeBackupTab}
                  onSelect={(k) => k && setActiveBackupTab(k)}
                >
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
                            <Badge
                              bg={getBackupTypeColor(tab.id)}
                              pill
                              className="ms-2"
                            >
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
                        <p className="text-muted text-center">
                          No backups available
                        </p>
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

        {/* Cloud Backup Card */}
        <Card className="mt-4">
          <Card.Header>
            <FontAwesomeIcon icon={faCloud} /> Cloud Backup
          </Card.Header>
          <Card.Body>
            {/* Google Drive Connection */}
            <Row className="mb-3 align-items-center">
              <Col sm={3}>
                <strong>Google Drive</strong>
              </Col>
              <Col>
                {cloudStatus?.connected ? (
                  <div>
                    <Badge bg="success" className="me-2">
                      <FontAwesomeIcon icon={faLink} className="me-1" />
                      Connected
                    </Badge>
                    {cloudStatus.email && (
                      <span className="text-muted">{cloudStatus.email}</span>
                    )}
                    <Button
                      variant="outline-secondary"
                      size="sm"
                      className="ms-3"
                      onClick={() => setDisconnectConfirm(true)}
                    >
                      <FontAwesomeIcon icon={faLinkSlash} className="me-1" />
                      Disconnect
                    </Button>
                  </div>
                ) : authPolling ? (
                  <div>
                    <div className="d-flex align-items-center gap-2 mb-2">
                      <Spinner size="sm" />
                      <span>Waiting for Google authorization...</span>
                    </div>
                    <span
                      className="text-muted d-block mb-2"
                      style={{ fontSize: '0.85rem' }}
                    >
                      Complete the sign-in in the browser tab that just opened.
                    </span>
                    {showCallbackFallback && (
                      <div
                        className="mt-3 p-2 border rounded"
                        style={{ fontSize: '0.85rem' }}
                      >
                        <div className="text-muted mb-2">
                          <strong>Remote access?</strong> If a page failed to
                          load after signing in, copy the URL from that page and
                          paste it here:
                        </div>
                        <div className="d-flex gap-2">
                          <Form.Control
                            size="sm"
                            type="text"
                            placeholder="http://127.0.0.1:53682/..."
                            value={callbackUrl}
                            onChange={(
                              e: React.ChangeEvent<HTMLInputElement>
                            ) => setCallbackUrl(e.target.value)}
                            onKeyDown={(e: React.KeyboardEvent) => {
                              if (e.key === 'Enter') handleForwardCallback()
                            }}
                          />
                          <Button
                            variant="primary"
                            size="sm"
                            onClick={handleForwardCallback}
                            disabled={!callbackUrl.trim()}
                          >
                            Submit
                          </Button>
                        </div>
                      </div>
                    )}
                    <Button
                      variant="outline-secondary"
                      size="sm"
                      className="mt-2"
                      onClick={handleCancelAuth}
                    >
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <div>
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={handleConnectGDrive}
                      disabled={cloudLoading}
                    >
                      {cloudLoading ? (
                        <FontAwesomeIcon icon={faCircleNotch} spin />
                      ) : (
                        <FontAwesomeIcon icon={faLink} />
                      )}{' '}
                      Connect Google Drive
                    </Button>
                  </div>
                )}
              </Col>
            </Row>

            {cloudStatus?.connected && (
              <>
                {/* Sync Mode */}
                <Row className="mb-3 align-items-center">
                  <Col sm={3}>
                    <strong>Sync Mode</strong>
                  </Col>
                  <Col sm={4}>
                    <Form.Select
                      size="sm"
                      value={cloudStatus.syncMode || 'manual'}
                      onChange={(e) => handleSyncModeChange(e.target.value)}
                    >
                      <option value="manual">Manual only</option>
                      <option value="after_backup">After each backup</option>
                      <option value="scheduled">Scheduled</option>
                    </Form.Select>
                  </Col>
                  {cloudStatus.syncMode === 'scheduled' && (
                    <Col sm={3}>
                      <Form.Select
                        size="sm"
                        value={cloudStatus.syncFrequency || 'daily'}
                        onChange={(e) =>
                          handleSyncFrequencyChange(e.target.value)
                        }
                      >
                        <option value="daily">Daily</option>
                        <option value="weekly">Weekly</option>
                      </Form.Select>
                    </Col>
                  )}
                </Row>

                {/* Sync Status */}
                <Row className="mb-3 align-items-center">
                  <Col sm={3}>
                    <strong>Status</strong>
                  </Col>
                  <Col>
                    <div className="d-flex align-items-center gap-3">
                      {cloudStatus.syncing ? (
                        <div>
                          <span className="d-flex align-items-center gap-2">
                            <FontAwesomeIcon icon={faCircleNotch} spin />{' '}
                            {cloudStatus.syncProgress ? (
                              <>
                                Syncing{' '}
                                {formatBytes(
                                  cloudStatus.syncProgress.totalBytes
                                )}{' '}
                                to Google Drive
                                {cloudStatus.syncProgress.processedBlobs !==
                                  undefined &&
                                  cloudStatus.syncProgress.totalBlobs !==
                                    undefined && (
                                    <span className="text-muted">
                                      ({cloudStatus.syncProgress.processedBlobs}
                                      /{cloudStatus.syncProgress.totalBlobs}{' '}
                                      blobs)
                                    </span>
                                  )}
                              </>
                            ) : (
                              'Syncing...'
                            )}
                            <Button
                              variant="outline-danger"
                              size="sm"
                              onClick={async () => {
                                try {
                                  await cloudApi.cancelSync()
                                  setCloudStatus((prev) =>
                                    prev ? { ...prev, syncing: false } : prev
                                  )
                                } catch (err) {
                                  console.error('Failed to cancel sync:', err)
                                }
                              }}
                            >
                              Cancel
                            </Button>
                          </span>
                        </div>
                      ) : (
                        <Button
                          variant="outline-primary"
                          size="sm"
                          onClick={handleCloudSync}
                          disabled={cloudLoading}
                        >
                          <FontAwesomeIcon
                            icon={faCloudArrowUp}
                            className="me-1"
                          />
                          Sync Now
                        </Button>
                      )}
                      <span className="text-muted">
                        <FontAwesomeIcon icon={faClock} className="me-1" />
                        Last sync:{' '}
                        {cloudStatus.lastSync
                          ? formatDate(cloudStatus.lastSync)
                          : 'Never'}
                      </span>
                      {cloudStatus.internetAvailable === false && (
                        <Badge bg="warning">
                          <FontAwesomeIcon icon={faWifi} className="me-1" />
                          No internet
                        </Badge>
                      )}
                    </div>
                    {cloudStatus.lastSyncError && (
                      <Alert variant="danger" className="mt-2 mb-0 py-2">
                        {cloudStatus.lastSyncError}
                      </Alert>
                    )}
                  </Col>
                </Row>

                {/* Restore from Cloud */}
                <Row
                  className="mt-3 pt-3 align-items-center"
                  style={{ borderTop: '1px solid #dee2e6' }}
                >
                  <Col sm={3}>
                    <strong>
                      <FontAwesomeIcon
                        icon={faCloudArrowDown}
                        className="me-1"
                      />
                      Restore from Cloud
                    </strong>
                  </Col>
                  <Col>
                    <Button
                      variant="outline-primary"
                      size="sm"
                      onClick={openCloudRestore}
                    >
                      <FontAwesomeIcon
                        icon={faCloudArrowDown}
                        className="me-1"
                      />
                      Restore from Cloud
                    </Button>
                    <Form.Text className="text-muted d-block mt-1">
                      Restore a backup from Google Drive to this device.
                    </Form.Text>
                  </Col>
                </Row>
              </>
            )}
          </Card.Body>
        </Card>

        {/* Restore from File Card */}
        <Card className="mt-4">
          <Card.Header>
            <FontAwesomeIcon icon={faUpload} /> Restore from File
          </Card.Header>
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

        {/* Exclusion Confirm Modal */}
        <Modal
          show={showExclusionConfirm}
          onHide={() => setShowExclusionConfirm(false)}
        >
          <Modal.Header closeButton>
            <Modal.Title>Confirm Exclusion Changes</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            <p>
              Changing backup exclusions will{' '}
              <strong>delete all existing backups</strong> and create a fresh
              one with the new settings.
            </p>
            <p>
              If cloud sync is enabled, you will also need to manually delete
              the backup folder on Google Drive and sync again.
            </p>
          </Modal.Body>
          <Modal.Footer>
            <Button
              variant="secondary"
              onClick={() => setShowExclusionConfirm(false)}
            >
              Cancel
            </Button>
            <Button variant="danger" onClick={saveExclusions}>
              Save Changes
            </Button>
          </Modal.Footer>
        </Modal>

        {/* Cloud Restore Wizard Modal */}
        <Modal
          show={showCloudRestore}
          onHide={
            cloudRestoreStep === 'preparing' || cloudRestoreStep === 'restoring'
              ? undefined
              : closeCloudRestore
          }
          backdrop={
            cloudRestoreStep === 'preparing' || cloudRestoreStep === 'restoring'
              ? 'static'
              : true
          }
          keyboard={
            cloudRestoreStep !== 'preparing' && cloudRestoreStep !== 'restoring'
          }
          size="lg"
        >
          <Modal.Header
            closeButton={
              cloudRestoreStep !== 'preparing' &&
              cloudRestoreStep !== 'restoring'
            }
          >
            <Modal.Title>
              <FontAwesomeIcon icon={faCloudArrowDown} className="me-2" />
              Restore from Cloud
            </Modal.Title>
          </Modal.Header>
          <Modal.Body>
            {cloudRestoreError && (
              <Alert
                variant="danger"
                dismissible
                onClose={() => setCloudRestoreError(null)}
              >
                {cloudRestoreError}
              </Alert>
            )}

            {/* Step 1: Select Installation */}
            {cloudRestoreStep === 'select-install' && (
              <>
                <p>Select the installation to restore from:</p>
                {cloudLoading ? (
                  <div className="text-center py-4">
                    <Spinner size="sm" className="me-2" />
                    Loading cloud installations...
                  </div>
                ) : cloudInstalls.length === 0 ? (
                  <Alert variant="info">
                    No installations found on Google Drive.
                  </Alert>
                ) : (
                  <div className="d-flex flex-column gap-2">
                    {cloudInstalls.map((install) => (
                      <div
                        key={install.folder}
                        className={`p-3 rounded border ${
                          selectedInstall?.folder === install.folder
                            ? 'border-primary bg-light'
                            : ''
                        }`}
                        style={{ cursor: 'pointer' }}
                        onClick={() => setSelectedInstall(install)}
                      >
                        <strong>
                          {install.info?.vesselName ||
                            install.info?.installName ||
                            install.folder}
                        </strong>
                        {install.info?.hardware && (
                          <span className="text-muted ms-2">
                            ({install.info.hardware})
                          </span>
                        )}
                        {install.info?.lastUpdated && (
                          <div
                            className="text-muted"
                            style={{ fontSize: '0.85rem' }}
                          >
                            Last synced: {formatDate(install.info.lastUpdated)}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}

            {/* Step 2: Enter Password */}
            {cloudRestoreStep === 'enter-password' && (
              <>
                <p>
                  Enter the recovery password from the source device (
                  {selectedInstall?.info?.vesselName || selectedInstall?.folder}
                  ).
                </p>
                <Form.Group className="mb-3">
                  <Form.Label>Recovery Password</Form.Label>
                  <Form.Control
                    type="password"
                    value={cloudRestorePassword}
                    onChange={(e) => setCloudRestorePassword(e.target.value)}
                    placeholder="Enter recovery password"
                  />
                  <Form.Text className="text-muted">
                    If this is the same device and you haven&apos;t changed the
                    password, you can leave this empty.
                  </Form.Text>
                </Form.Group>
              </>
            )}

            {/* Step 3: Preparing */}
            {cloudRestoreStep === 'preparing' && (
              <div className="text-center py-4">
                <Spinner size="sm" className="me-2" />
                <p className="mt-2">Downloading backup from cloud...</p>
                <p className="text-muted" style={{ fontSize: '0.85rem' }}>
                  This may take several minutes depending on backup size and
                  internet speed.
                </p>
              </div>
            )}

            {/* Step 4: Select Snapshot */}
            {cloudRestoreStep === 'select-snapshot' && (
              <>
                <p>Select a backup to restore:</p>
                {cloudSnapshots.length === 0 ? (
                  <Alert variant="warning">
                    No snapshots found in this installation.
                  </Alert>
                ) : (
                  <>
                    <div
                      style={{
                        maxHeight: '300px',
                        overflowY: 'auto',
                        border: '1px solid #dee2e6',
                        borderRadius: '4px'
                      }}
                    >
                      {cloudSnapshots.slice(0, 20).map((snap) => (
                        <div
                          key={snap.id}
                          className={`p-2 d-flex align-items-center gap-2 ${
                            selectedCloudSnapshot === snap.id ? 'bg-light' : ''
                          }`}
                          style={{
                            cursor: 'pointer',
                            borderBottom: '1px solid #dee2e6'
                          }}
                          onClick={() => setSelectedCloudSnapshot(snap.id)}
                        >
                          <Form.Check
                            type="radio"
                            checked={selectedCloudSnapshot === snap.id}
                            onChange={() => setSelectedCloudSnapshot(snap.id)}
                          />
                          <div className="flex-grow-1">
                            <div>
                              {formatDate(snap.createdAt)}
                              <Badge
                                bg="secondary"
                                className="ms-2"
                                style={{ fontSize: '0.7rem' }}
                              >
                                {snap.type}
                              </Badge>
                            </div>
                            {snap.description && (
                              <div
                                className="text-muted"
                                style={{ fontSize: '0.8rem' }}
                              >
                                {snap.description}
                              </div>
                            )}
                          </div>
                          <span
                            className="text-muted"
                            style={{ fontSize: '0.8rem' }}
                          >
                            {formatBytes(snap.size)}
                          </span>
                          <span
                            className="text-muted"
                            style={{ fontSize: '0.8rem' }}
                          >
                            v{snap.version?.tag || '?'}
                          </span>
                        </div>
                      ))}
                    </div>

                    <Form.Group className="mt-3">
                      <Form.Label>Restore Mode</Form.Label>
                      <div className="d-flex gap-3">
                        <Form.Check
                          type="radio"
                          id="cr-mode-restore"
                          label="Restore"
                          checked={cloudRestoreMode === 'restore'}
                          onChange={() => setCloudRestoreMode('restore')}
                        />
                        <Form.Check
                          type="radio"
                          id="cr-mode-clone"
                          label="Clone (new device)"
                          checked={cloudRestoreMode === 'clone'}
                          onChange={() => setCloudRestoreMode('clone')}
                        />
                      </div>
                      <Form.Text className="text-muted">
                        {cloudRestoreMode === 'restore'
                          ? 'Replaces this installation with the cloud backup.'
                          : 'Restores the backup but creates a new device identity. Use for a spare device or hardware upgrade.'}
                      </Form.Text>
                    </Form.Group>
                  </>
                )}
              </>
            )}

            {/* Step 5: Confirm */}
            {cloudRestoreStep === 'confirm' && (
              <>
                <Alert variant="warning">
                  <strong>Warning:</strong> This will replace all SignalK
                  configuration and data on this device with the selected cloud
                  backup.
                </Alert>
                <div className="mb-3">
                  <div>
                    <strong>Source:</strong>{' '}
                    {selectedInstall?.info?.vesselName ||
                      selectedInstall?.folder}
                  </div>
                  <div>
                    <strong>Snapshot:</strong>{' '}
                    {cloudSnapshots.find((s) => s.id === selectedCloudSnapshot)
                      ? formatDate(
                          cloudSnapshots.find(
                            (s) => s.id === selectedCloudSnapshot
                          )!.createdAt
                        )
                      : selectedCloudSnapshot}
                  </div>
                  <div>
                    <strong>Mode:</strong>{' '}
                    {cloudRestoreMode === 'clone'
                      ? 'Clone (new device identity)'
                      : 'Restore'}
                  </div>
                </div>
                <p>
                  A safety backup will be created before the restore. SignalK
                  will restart during the process and will be temporarily
                  unavailable.
                </p>
              </>
            )}

            {/* Step 6: Restoring */}
            {cloudRestoreStep === 'restoring' && (
              <div className="text-center py-4">
                <Spinner size="sm" className="me-2" />
                <p className="mt-2">Starting restore...</p>
              </div>
            )}
          </Modal.Body>
          <Modal.Footer>
            {cloudRestoreStep !== 'preparing' &&
              cloudRestoreStep !== 'restoring' && (
                <Button variant="secondary" onClick={closeCloudRestore}>
                  Cancel
                </Button>
              )}

            {cloudRestoreStep === 'select-install' && (
              <Button
                variant="primary"
                disabled={!selectedInstall}
                onClick={() => setCloudRestoreStep('enter-password')}
              >
                Next
              </Button>
            )}

            {cloudRestoreStep === 'enter-password' && (
              <>
                <Button
                  variant="secondary"
                  onClick={() => setCloudRestoreStep('select-install')}
                >
                  Back
                </Button>
                <Button variant="primary" onClick={handleCloudRestorePrepare}>
                  Prepare Restore
                </Button>
              </>
            )}

            {cloudRestoreStep === 'select-snapshot' && (
              <>
                <Button
                  variant="secondary"
                  onClick={() => setCloudRestoreStep('enter-password')}
                >
                  Back
                </Button>
                <Button
                  variant="primary"
                  disabled={!selectedCloudSnapshot}
                  onClick={() => setCloudRestoreStep('confirm')}
                >
                  Next
                </Button>
              </>
            )}

            {cloudRestoreStep === 'confirm' && (
              <>
                <Button
                  variant="secondary"
                  onClick={() => setCloudRestoreStep('select-snapshot')}
                >
                  Back
                </Button>
                <Button variant="danger" onClick={handleCloudRestoreStart}>
                  {cloudRestoreMode === 'clone'
                    ? 'Clone & Restore'
                    : 'Start Restore'}
                </Button>
              </>
            )}
          </Modal.Footer>
        </Modal>

        {/* Disconnect Confirm Modal */}
        <Modal
          show={disconnectConfirm}
          onHide={() => setDisconnectConfirm(false)}
        >
          <Modal.Header closeButton>
            <Modal.Title>Disconnect Google Drive</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            <p>
              This will remove the Google Drive connection. Cloud sync will stop
              and you will need to reconnect to resume cloud backups.
            </p>
            <p>
              Your existing cloud backups on Google Drive will not be deleted.
            </p>
          </Modal.Body>
          <Modal.Footer>
            <Button
              variant="secondary"
              onClick={() => setDisconnectConfirm(false)}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={handleDisconnectGDrive}
              disabled={cloudLoading}
            >
              {cloudLoading ? <Spinner size="sm" /> : 'Disconnect'}
            </Button>
          </Modal.Footer>
        </Modal>

        {/* Change Password Modal */}
        <Modal
          show={passwordModalOpen}
          onHide={() => setPasswordModalOpen(false)}
        >
          <Modal.Header closeButton>
            <Modal.Title>Change Backup Password</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            <Alert variant="warning">
              <strong>Warning:</strong> Changing the password will re-create the
              backup repository. Existing backups will be lost.
            </Alert>
            <Form.Group className="mb-3">
              <Form.Label htmlFor="new-password">New Password</Form.Label>
              <Form.Control
                type="password"
                id="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Minimum 8 characters"
              />
            </Form.Group>
            <Form.Group className="mb-3">
              <Form.Label htmlFor="confirm-password">
                Confirm Password
              </Form.Label>
              <Form.Control
                type="password"
                id="confirm-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Re-enter password"
                isValid={confirmPassword.length > 0 && passwordsMatch}
                isInvalid={confirmPassword.length > 0 && !passwordsMatch}
              />
            </Form.Group>
          </Modal.Body>
          <Modal.Footer>
            <Button
              variant="secondary"
              onClick={() => setPasswordModalOpen(false)}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={handleChangePassword}
              disabled={!passwordsMatch || passwordLoading}
            >
              {passwordLoading ? <Spinner size="sm" /> : 'Change Password'}
            </Button>
          </Modal.Footer>
        </Modal>

        {/* Reset Password Modal */}
        <Modal show={resetModalOpen} onHide={() => setResetModalOpen(false)}>
          <Modal.Header closeButton>
            <Modal.Title>Reset to Default Password</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            <Alert variant="warning">
              This will reset to the default password and re-create the backup
              repository. Existing backups will be lost.
            </Alert>
          </Modal.Body>
          <Modal.Footer>
            <Button
              variant="secondary"
              onClick={() => setResetModalOpen(false)}
            >
              Cancel
            </Button>
            <Button
              variant="warning"
              onClick={handleResetPassword}
              disabled={passwordLoading}
            >
              {passwordLoading ? <Spinner size="sm" /> : 'Reset to Default'}
            </Button>
          </Modal.Footer>
        </Modal>
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
