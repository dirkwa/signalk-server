import React, { useState, useEffect, useCallback } from 'react'
import Alert from 'react-bootstrap/Alert'
import Badge from 'react-bootstrap/Badge'
import Button from 'react-bootstrap/Button'
import Card from 'react-bootstrap/Card'
import Col from 'react-bootstrap/Col'
import ProgressBar from 'react-bootstrap/ProgressBar'
import Row from 'react-bootstrap/Row'
import Table from 'react-bootstrap/Table'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faCircleNotch } from '@fortawesome/free-solid-svg-icons/faCircleNotch'
import { faHeartPulse } from '@fortawesome/free-solid-svg-icons/faHeartPulse'
import { faStethoscope } from '@fortawesome/free-solid-svg-icons/faStethoscope'
import { faCheck } from '@fortawesome/free-solid-svg-icons/faCheck'
import { faExclamationTriangle } from '@fortawesome/free-solid-svg-icons/faExclamationTriangle'
import { faXmark } from '@fortawesome/free-solid-svg-icons/faXmark'
import { faServer } from '@fortawesome/free-solid-svg-icons/faServer'
import { faSync } from '@fortawesome/free-solid-svg-icons/faSync'
import { faDownload } from '@fortawesome/free-solid-svg-icons/faDownload'
import { faRocket } from '@fortawesome/free-solid-svg-icons/faRocket'
import { useRuntimeConfig } from '../../store'
import {
  healthApi,
  serverApi,
  shouldUseKeeper,
  type HealthStatus,
  type DoctorResult,
  type SystemInfo,
  type ContainerInfo,
  type ContainerStats,
  type KeeperVersionStatus,
  type KeeperUpgradeState
} from '../../services/api'

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (days > 0) return `${days}d ${hours}h ${minutes}m`
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

const SystemHealth: React.FC = () => {
  const { useKeeper } = useRuntimeConfig()

  const [healthStatus, setHealthStatus] = useState<HealthStatus | null>(null)
  const [doctorResult, setDoctorResult] = useState<DoctorResult | null>(null)
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null)
  const [containerInfo, setContainerInfo] = useState<ContainerInfo | null>(null)
  const [containerStats, setContainerStats] = useState<ContainerStats | null>(
    null
  )
  const [isLoading, setIsLoading] = useState(false)
  const [isRunningDoctor, setIsRunningDoctor] = useState(false)
  const [applyingFixId, setApplyingFixId] = useState<string | null>(null)
  const [fixSuccess, setFixSuccess] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [keeperVersion, setKeeperVersion] =
    useState<KeeperVersionStatus | null>(null)
  const [upgradeState, setUpgradeState] = useState<KeeperUpgradeState | null>(
    null
  )
  const [isUpgrading, setIsUpgrading] = useState(false)

  useEffect(() => {
    if (!useKeeper || !shouldUseKeeper()) {
      return
    }

    const loadHealthStatus = async () => {
      const status = await healthApi.check()
      if (status) {
        setHealthStatus(status)
      }
    }

    const loadSystemInfo = async () => {
      const info = await healthApi.systemInfo()
      if (info) {
        setSystemInfo(info)
      }
    }

    const loadContainerInfo = async () => {
      const info = await serverApi.getStatus()
      if (info) {
        setContainerInfo(info)
      }
    }

    const loadStats = async () => {
      const stats = await serverApi.getStats()
      if (stats) {
        setContainerStats(stats)
      }
    }

    const loadKeeperVersion = async () => {
      const version = await healthApi.checkKeeperUpdate()
      if (version) {
        setKeeperVersion(version)
      }
    }

    const doLoadAllData = async () => {
      setIsLoading(true)
      setError(null)
      try {
        await Promise.all([
          loadHealthStatus(),
          loadSystemInfo(),
          loadContainerInfo(),
          loadStats(),
          loadKeeperVersion()
        ])
      } catch (err) {
        setError(
          err instanceof Error ? err.message : 'Failed to load health data'
        )
      } finally {
        setIsLoading(false)
      }
    }

    doLoadAllData()
    const interval = setInterval(loadStats, 5000)
    return () => clearInterval(interval)
  }, [useKeeper])

  const loadAllData = async () => {
    setIsLoading(true)
    setError(null)
    try {
      const [
        healthResult,
        systemResult,
        containerResult,
        statsResult,
        versionResult
      ] = await Promise.all([
        healthApi.check(),
        healthApi.systemInfo(),
        serverApi.getStatus(),
        serverApi.getStats(),
        healthApi.checkKeeperUpdate()
      ])
      if (healthResult) setHealthStatus(healthResult)
      if (systemResult) setSystemInfo(systemResult)
      if (containerResult) setContainerInfo(containerResult)
      if (statsResult) setContainerStats(statsResult)
      if (versionResult) setKeeperVersion(versionResult)
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to load health data'
      )
    } finally {
      setIsLoading(false)
    }
  }

  const runDoctor = useCallback(async () => {
    setIsRunningDoctor(true)
    setError(null)
    setFixSuccess(null)
    try {
      const result = await healthApi.runDoctor()
      if (result) {
        setDoctorResult(result)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Doctor check failed')
    } finally {
      setIsRunningDoctor(false)
    }
  }, [])

  const applyFix = useCallback(
    async (fixId: string, fixTitle: string) => {
      setApplyingFixId(fixId)
      setError(null)
      setFixSuccess(null)
      try {
        const result = await healthApi.applyFix(fixId)
        if (result?.success) {
          setFixSuccess(`${fixTitle}: ${result.message}`)
          // Re-run diagnosis to update the UI
          await runDoctor()
        } else {
          setError(result?.message || 'Fix failed')
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to apply fix')
      } finally {
        setApplyingFixId(null)
      }
    },
    [runDoctor]
  )

  const startKeeperUpgrade = useCallback(async () => {
    if (!keeperVersion?.latestVersion) return

    setIsUpgrading(true)
    setError(null)
    setUpgradeState({ step: 'downloading' })

    try {
      // Phase 1: Download new version
      const prepResult = await healthApi.prepareKeeperUpgrade(
        keeperVersion.latestVersion
      )
      if (!prepResult?.success) {
        throw new Error(prepResult?.error || 'Failed to download update')
      }

      setUpgradeState({
        step: 'ready',
        targetVersion: keeperVersion.latestVersion
      })

      // Phase 2: Apply update (this will restart Keeper)
      setUpgradeState({
        step: 'applying',
        targetVersion: keeperVersion.latestVersion
      })
      const applyResult = await healthApi.applyKeeperUpgrade()
      if (!applyResult?.success) {
        throw new Error(applyResult?.error || 'Failed to apply update')
      }

      // Keeper is restarting - show reconnecting state
      setUpgradeState({
        step: 'reconnecting',
        targetVersion: keeperVersion.latestVersion
      })

      // Poll for Keeper to come back online
      let attempts = 0
      const maxAttempts = 60 // 2 minutes max
      const pollInterval = setInterval(async () => {
        attempts++
        try {
          const newVersion = await healthApi.checkKeeperUpdate()
          if (newVersion) {
            clearInterval(pollInterval)
            setKeeperVersion(newVersion)
            setUpgradeState({ step: 'idle' })
            setIsUpgrading(false)
            // Reload all data
            loadAllData()
          }
        } catch {
          // Keeper still restarting
          if (attempts >= maxAttempts) {
            clearInterval(pollInterval)
            setError('Keeper restart timed out. Please refresh the page.')
            setUpgradeState({ step: 'idle' })
            setIsUpgrading(false)
          }
        }
      }, 2000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upgrade failed')
      setUpgradeState({ step: 'idle' })
      setIsUpgrading(false)
    }
  }, [keeperVersion])

  const getStatusBadge = (status: 'healthy' | 'degraded' | 'unhealthy') => {
    const colors = {
      healthy: 'success',
      degraded: 'warning',
      unhealthy: 'danger'
    }
    return (
      <Badge bg={colors[status]}>
        {status.charAt(0).toUpperCase() + status.slice(1)}
      </Badge>
    )
  }

  const getCheckIcon = (status: 'pass' | 'warn' | 'fail') => {
    switch (status) {
      case 'pass':
        return <FontAwesomeIcon icon={faCheck} className="text-success" />
      case 'warn':
        return (
          <FontAwesomeIcon
            icon={faExclamationTriangle}
            className="text-warning"
          />
        )
      case 'fail':
        return <FontAwesomeIcon icon={faXmark} className="text-danger" />
    }
  }

  const getContainerStateBadge = (state: string) => {
    const colors: Record<string, string> = {
      running: 'success',
      stopped: 'secondary',
      created: 'info',
      exited: 'danger',
      paused: 'warning'
    }
    return <Badge bg={colors[state] || 'secondary'}>{state}</Badge>
  }

  // Not in Keeper mode - show message
  if (!useKeeper || !shouldUseKeeper()) {
    return (
      <div className="animated fadeIn">
        <Card>
          <Card.Header>System Health</Card.Header>
          <Card.Body>
            <Alert variant="info">
              System health monitoring is only available when running with the
              Universal Installer (Keeper).
            </Alert>
          </Card.Body>
        </Card>
      </div>
    )
  }

  return (
    <div className="animated fadeIn">
      {error && (
        <Alert variant="danger" dismissible onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {/* Overall Health Status */}
      <Card className="mb-4">
        <Card.Header>
          <FontAwesomeIcon icon={faHeartPulse} className="me-2" />
          System Health
          {healthStatus && (
            <span className="float-end">
              {getStatusBadge(healthStatus.status)}
            </span>
          )}
        </Card.Header>
        <Card.Body>
          {isLoading ? (
            <div className="text-center">
              <FontAwesomeIcon icon={faCircleNotch} spin size="2x" />
            </div>
          ) : healthStatus ? (
            <Row>
              <Col md={6}>
                <h6>Service Checks</h6>
                <Table size="sm" borderless>
                  <tbody>
                    <tr>
                      <td>Podman Socket</td>
                      <td className="text-end">
                        {healthStatus.checks.podmanSocket ? (
                          <Badge bg="success">Connected</Badge>
                        ) : (
                          <Badge bg="danger">Disconnected</Badge>
                        )}
                      </td>
                    </tr>
                    <tr>
                      <td>SignalK Container</td>
                      <td className="text-end">
                        {healthStatus.checks.signalkContainer ? (
                          <Badge bg="success">Running</Badge>
                        ) : (
                          <Badge bg="danger">Not Running</Badge>
                        )}
                      </td>
                    </tr>
                    {healthStatus.checks.networkConnectivity !== undefined && (
                      <tr>
                        <td>Network Connectivity</td>
                        <td className="text-end">
                          {healthStatus.checks.networkConnectivity ? (
                            <Badge bg="success">OK</Badge>
                          ) : (
                            <Badge bg="warning">Limited</Badge>
                          )}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </Table>
              </Col>
              <Col md={6}>
                <h6>Keeper Info</h6>
                <Table size="sm" borderless>
                  <tbody>
                    <tr>
                      <td>Version</td>
                      <td className="text-end">{healthStatus.version}</td>
                    </tr>
                    <tr>
                      <td>Uptime</td>
                      <td className="text-end">
                        {formatUptime(healthStatus.uptime)}
                      </td>
                    </tr>
                  </tbody>
                </Table>
              </Col>
            </Row>
          ) : (
            <p className="text-muted">Unable to load health status</p>
          )}
        </Card.Body>
        <Card.Footer>
          <Button
            variant="secondary"
            size="sm"
            onClick={loadAllData}
            disabled={isLoading}
          >
            <FontAwesomeIcon icon={faSync} spin={isLoading} /> Refresh
          </Button>
        </Card.Footer>
      </Card>

      {/* Doctor / Preflight Checks */}
      <Card className="mb-4">
        <Card.Header>
          <FontAwesomeIcon icon={faStethoscope} className="me-2" />
          System Doctor
          {doctorResult && (
            <span className="float-end">
              <Badge
                bg={
                  doctorResult.overall === 'pass'
                    ? 'success'
                    : doctorResult.overall === 'warn'
                      ? 'warning'
                      : 'danger'
                }
              >
                {doctorResult.overall.toUpperCase()}
              </Badge>
            </span>
          )}
        </Card.Header>
        <Card.Body>
          <p className="text-muted">
            Run a comprehensive system check to identify potential issues with
            your SignalK installation.
          </p>
          {doctorResult && (
            <Table size="sm" className="mt-3">
              <thead>
                <tr>
                  <th>Check</th>
                  <th>Status</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {doctorResult.checks.map((check) => (
                  <tr key={check.name}>
                    <td>{check.name}</td>
                    <td>{getCheckIcon(check.status)}</td>
                    <td>
                      {check.message}
                      {check.details && (
                        <small className="d-block text-muted">
                          {check.details}
                        </small>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}

          {/* Issues with Fixes */}
          {doctorResult?.issues && doctorResult.issues.length > 0 && (
            <div className="mt-4">
              <h6>
                <FontAwesomeIcon
                  icon={faExclamationTriangle}
                  className="me-2 text-warning"
                />
                Issues Detected ({doctorResult.issues.length})
              </h6>
              {fixSuccess && (
                <Alert variant="success" className="mt-2">
                  {fixSuccess}
                </Alert>
              )}
              {doctorResult.issues.map((issue) => (
                <Card
                  key={issue.id}
                  className={`mt-2 border-${issue.severity === 'critical' ? 'danger' : 'warning'}`}
                >
                  <Card.Body className="py-2">
                    <div className="d-flex justify-content-between align-items-start">
                      <div>
                        <strong
                          className={
                            issue.severity === 'critical'
                              ? 'text-danger'
                              : 'text-warning'
                          }
                        >
                          {issue.title}
                        </strong>
                        <p className="mb-1 small text-muted">
                          {issue.description}
                        </p>
                        <Badge bg="secondary" className="me-1">
                          {issue.category}
                        </Badge>
                        <Badge
                          bg={
                            issue.severity === 'critical' ? 'danger' : 'warning'
                          }
                        >
                          {issue.severity}
                        </Badge>
                      </div>
                      {issue.autoFixable && issue.fixes.length > 0 && (
                        <div>
                          {issue.fixes.map((fix) => (
                            <Button
                              key={fix.id}
                              variant="success"
                              size="sm"
                              onClick={() => applyFix(fix.id, fix.title)}
                              disabled={applyingFixId === fix.id}
                              title={fix.description}
                            >
                              {applyingFixId === fix.id ? (
                                <FontAwesomeIcon icon={faCircleNotch} spin />
                              ) : (
                                <FontAwesomeIcon icon={faSync} />
                              )}{' '}
                              {fix.title}
                            </Button>
                          ))}
                        </div>
                      )}
                    </div>
                  </Card.Body>
                </Card>
              ))}
            </div>
          )}
        </Card.Body>
        <Card.Footer>
          <Button
            variant="primary"
            onClick={runDoctor}
            disabled={isRunningDoctor}
          >
            {isRunningDoctor ? (
              <FontAwesomeIcon icon={faCircleNotch} spin />
            ) : (
              <FontAwesomeIcon icon={faStethoscope} />
            )}{' '}
            Run Doctor Check
          </Button>
        </Card.Footer>
      </Card>

      {/* Container Status */}
      {containerInfo && (
        <Card className="mb-4">
          <Card.Header>
            <FontAwesomeIcon icon={faServer} className="me-2" />
            Container Status
            <span className="float-end">
              {/* Running container badges */}
              <Badge bg="primary" className="me-1">
                SignalK
              </Badge>
              {systemInfo?.keeper && (
                <Badge bg="info" className="me-1">
                  Keeper
                </Badge>
              )}
              {systemInfo?.memory?.influxdbMB &&
                systemInfo.memory.influxdbMB > 0 && (
                  <Badge bg="warning" className="me-1">
                    InfluxDB
                  </Badge>
                )}
              {systemInfo?.memory?.grafanaMB &&
                systemInfo.memory.grafanaMB > 0 && (
                  <Badge bg="success" className="me-1">
                    Grafana
                  </Badge>
                )}
              {keeperVersion?.updateAvailable && (
                <Badge bg="danger" className="ms-2">
                  Update Available
                </Badge>
              )}
            </span>
          </Card.Header>
          <Card.Body>
            {/* Keeper Upgrade Status */}
            {isUpgrading && upgradeState && (
              <Alert variant="info" className="mb-3">
                <FontAwesomeIcon icon={faCircleNotch} spin className="me-2" />
                {upgradeState.step === 'downloading' &&
                  'Downloading Keeper update...'}
                {upgradeState.step === 'ready' &&
                  `Update ${upgradeState.targetVersion} ready to apply`}
                {upgradeState.step === 'applying' &&
                  'Applying update and restarting Keeper...'}
                {upgradeState.step === 'reconnecting' &&
                  'Waiting for Keeper to restart...'}
                {upgradeState.progress !== undefined &&
                  upgradeState.progress > 0 && (
                    <ProgressBar now={upgradeState.progress} className="mt-2" />
                  )}
              </Alert>
            )}

            {/* Keeper Update Available */}
            {keeperVersion?.updateAvailable && !isUpgrading && (
              <Alert variant="warning" className="mb-3">
                <FontAwesomeIcon icon={faRocket} className="me-2" />
                <strong>Keeper Update Available:</strong> Version{' '}
                {keeperVersion.latestVersion}
                <div className="mt-2">
                  <small className="text-muted">
                    Current: {keeperVersion.currentVersion} | Last checked:{' '}
                    {new Date(keeperVersion.lastChecked).toLocaleString()}
                  </small>
                </div>
                <Button
                  variant="success"
                  size="sm"
                  className="mt-2"
                  onClick={startKeeperUpgrade}
                >
                  <FontAwesomeIcon icon={faDownload} className="me-1" />
                  Upgrade to {keeperVersion.latestVersion}
                </Button>
              </Alert>
            )}
            <Row>
              <Col md={6}>
                <Table size="sm" borderless>
                  <tbody>
                    <tr>
                      <td>SignalK Container</td>
                      <td className="text-end">
                        {getContainerStateBadge(containerInfo.state)}
                      </td>
                    </tr>
                    <tr>
                      <td>Image</td>
                      <td
                        className="text-end text-truncate"
                        style={{ maxWidth: '200px' }}
                      >
                        {containerInfo.image}
                      </td>
                    </tr>
                    {containerInfo.health && (
                      <tr>
                        <td>Health</td>
                        <td className="text-end">
                          <Badge
                            bg={
                              containerInfo.health.status === 'healthy'
                                ? 'success'
                                : 'warning'
                            }
                          >
                            {containerInfo.health.status}
                          </Badge>
                        </td>
                      </tr>
                    )}
                    {systemInfo?.keeper && (
                      <tr>
                        <td>Keeper Version</td>
                        <td className="text-end">
                          {systemInfo.keeper.version}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </Table>
              </Col>
              <Col md={6}>
                {/* CPU Usage */}
                {systemInfo?.cpu && (
                  <div className="mb-3">
                    <h6>CPU Usage</h6>
                    <div className="mb-1">
                      <small>
                        System: {systemInfo.cpu.systemPercent.toFixed(1)}% (
                        {systemInfo.cpu.cpuCount} cores)
                      </small>
                      <ProgressBar
                        now={systemInfo.cpu.systemPercent}
                        variant="secondary"
                        style={{ height: '10px' }}
                      />
                    </div>
                    <div>
                      <small>
                        SignalK: {systemInfo.cpu.signalkPercent.toFixed(1)}%
                      </small>
                      <ProgressBar
                        now={systemInfo.cpu.signalkPercent}
                        variant="primary"
                        style={{ height: '10px' }}
                      />
                    </div>
                  </div>
                )}

                {/* Memory Usage */}
                <h6>System Memory Usage</h6>
                {systemInfo?.memory ? (
                  <>
                    <div className="mb-2">
                      <ProgressBar style={{ height: '20px' }}>
                        <ProgressBar
                          variant="primary"
                          now={
                            (systemInfo.memory.signalkMB /
                              systemInfo.memory.totalMB) *
                            100
                          }
                          key="signalk"
                        />
                        {systemInfo.memory.keeperMB > 0 && (
                          <ProgressBar
                            variant="info"
                            now={
                              (systemInfo.memory.keeperMB /
                                systemInfo.memory.totalMB) *
                              100
                            }
                            key="keeper"
                          />
                        )}
                        {systemInfo.memory.influxdbMB > 0 && (
                          <ProgressBar
                            variant="warning"
                            now={
                              (systemInfo.memory.influxdbMB /
                                systemInfo.memory.totalMB) *
                              100
                            }
                            key="influxdb"
                          />
                        )}
                        {systemInfo.memory.grafanaMB > 0 && (
                          <ProgressBar
                            variant="success"
                            now={
                              (systemInfo.memory.grafanaMB /
                                systemInfo.memory.totalMB) *
                              100
                            }
                            key="grafana"
                          />
                        )}
                      </ProgressBar>
                    </div>
                    <small className="text-muted">
                      <Badge bg="primary" className="me-1">
                        SignalK: {systemInfo.memory.signalkMB} MB
                      </Badge>
                      {systemInfo.memory.keeperMB > 0 && (
                        <Badge bg="info" className="me-1">
                          Keeper: {systemInfo.memory.keeperMB} MB
                        </Badge>
                      )}
                      {systemInfo.memory.influxdbMB > 0 && (
                        <Badge bg="warning" className="me-1">
                          InfluxDB: {systemInfo.memory.influxdbMB} MB
                        </Badge>
                      )}
                      {systemInfo.memory.grafanaMB > 0 && (
                        <Badge bg="success" className="me-1">
                          Grafana: {systemInfo.memory.grafanaMB} MB
                        </Badge>
                      )}
                    </small>
                    <div className="mt-2">
                      <small className="text-muted">
                        Total: {systemInfo.memory.usedMB} MB /{' '}
                        {systemInfo.memory.totalMB} MB (
                        {systemInfo.memory.usedPercent}%)
                      </small>
                    </div>
                  </>
                ) : containerStats ? (
                  <>
                    <div className="mb-2">
                      <small>
                        CPU: {containerStats.cpu.percentage.toFixed(1)}%
                      </small>
                      <ProgressBar
                        now={containerStats.cpu.percentage}
                        variant="info"
                        className="mb-2"
                      />
                    </div>
                    <div className="mb-2">
                      <small>
                        Memory: {formatBytes(containerStats.memory.usage)} /{' '}
                        {formatBytes(containerStats.memory.limit)} (
                        {containerStats.memory.percentage.toFixed(1)}%)
                      </small>
                      <ProgressBar
                        now={containerStats.memory.percentage}
                        variant="primary"
                        className="mb-2"
                      />
                    </div>
                  </>
                ) : null}
                {containerStats && (
                  <small className="text-muted d-block mt-2">
                    Network: {formatBytes(containerStats.network.rxBytes)} rx /{' '}
                    {formatBytes(containerStats.network.txBytes)} tx
                  </small>
                )}
              </Col>
            </Row>
          </Card.Body>
        </Card>
      )}

      {/* System Info */}
      {systemInfo && (
        <Card className="mb-4">
          <Card.Header>System Information</Card.Header>
          <Card.Body>
            <Row>
              <Col md={6}>
                <Table size="sm" borderless>
                  <tbody>
                    <tr>
                      <td>OS</td>
                      <td className="text-end">{systemInfo.os}</td>
                    </tr>
                    <tr>
                      <td>Architecture</td>
                      <td className="text-end">{systemInfo.arch}</td>
                    </tr>
                    <tr>
                      <td>Hostname</td>
                      <td className="text-end">{systemInfo.hostname}</td>
                    </tr>
                  </tbody>
                </Table>
              </Col>
              <Col md={6}>
                <h6>Capabilities</h6>
                <Table size="sm" borderless>
                  <tbody>
                    <tr>
                      <td>D-Bus</td>
                      <td className="text-end">
                        {systemInfo.capabilities.dbus ? (
                          <Badge bg="success">Available</Badge>
                        ) : (
                          <Badge bg="secondary">Not Available</Badge>
                        )}
                      </td>
                    </tr>
                    <tr>
                      <td>Bluetooth</td>
                      <td className="text-end">
                        {systemInfo.capabilities.bluetooth ? (
                          <Badge bg="success">Available</Badge>
                        ) : (
                          <Badge bg="secondary">Not Available</Badge>
                        )}
                      </td>
                    </tr>
                    <tr>
                      <td>Serial Ports</td>
                      <td className="text-end">
                        {systemInfo.capabilities.serialPorts.length > 0 ? (
                          <Badge bg="success">
                            {systemInfo.capabilities.serialPorts.length} found
                          </Badge>
                        ) : (
                          <Badge bg="secondary">None</Badge>
                        )}
                      </td>
                    </tr>
                    <tr>
                      <td>CAN Interfaces (SocketCAN)</td>
                      <td className="text-end">
                        {systemInfo.capabilities.canInterfaces?.length > 0 ? (
                          <Badge bg="success">
                            {systemInfo.capabilities.canInterfaces.length} found
                          </Badge>
                        ) : (
                          <Badge bg="secondary">None</Badge>
                        )}
                      </td>
                    </tr>
                  </tbody>
                </Table>
              </Col>
            </Row>
            {systemInfo.storage && (
              <div className="mt-3">
                <h6>Storage</h6>
                <small>
                  Used: {formatBytes(systemInfo.storage.used)} / Total:{' '}
                  {formatBytes(systemInfo.storage.total)}(
                  {(
                    (systemInfo.storage.used / systemInfo.storage.total) *
                    100
                  ).toFixed(1)}
                  %)
                </small>
                <ProgressBar
                  now={
                    (systemInfo.storage.used / systemInfo.storage.total) * 100
                  }
                  variant={
                    systemInfo.storage.available < 1073741824
                      ? 'danger'
                      : 'info'
                  }
                />
              </div>
            )}
          </Card.Body>
        </Card>
      )}
    </div>
  )
}

export default SystemHealth
