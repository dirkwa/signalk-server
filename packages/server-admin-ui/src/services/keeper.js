/**
 * Keeper service for container management integration
 * Enables Admin UI to communicate with Keeper (port 3001) for:
 * - Container restart
 * - Container logs
 * - Version updates
 */

const KEEPER_PORT = 3001

// Build Keeper base URL from current location
function getKeeperUrl() {
  const { protocol, hostname } = window.location
  return `${protocol}//${hostname}:${KEEPER_PORT}`
}

// Cache for Keeper availability
let keeperAvailableCache = null
let keeperCheckPromise = null

/**
 * Check if Keeper is available
 * Results are cached for 30 seconds to avoid excessive health checks
 */
export async function checkKeeperAvailable() {
  // Return cached result if recent
  if (keeperAvailableCache !== null) {
    return keeperAvailableCache
  }

  // Avoid duplicate concurrent requests
  if (keeperCheckPromise) {
    return keeperCheckPromise
  }

  keeperCheckPromise = (async () => {
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 3000)

      const response = await fetch(`${getKeeperUrl()}/api/health`, {
        method: 'GET',
        signal: controller.signal
      })

      clearTimeout(timeoutId)

      const data = await response.json()
      keeperAvailableCache = data.success && data.data?.status !== 'unhealthy'

      // Cache expires after 30 seconds
      setTimeout(() => {
        keeperAvailableCache = null
      }, 30000)

      return keeperAvailableCache
    } catch (error) {
      console.log('Keeper not available:', error.message)
      keeperAvailableCache = false
      setTimeout(() => {
        keeperAvailableCache = null
      }, 30000)
      return false
    } finally {
      keeperCheckPromise = null
    }
  })()

  return keeperCheckPromise
}

/**
 * Restart container via Keeper
 */
export async function restartContainer() {
  const response = await fetch(`${getKeeperUrl()}/api/container/restart`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  })
  return response.json()
}

/**
 * Get container logs via Keeper
 * @param {number} lines - Number of log lines to fetch (default 500)
 */
export async function getContainerLogs(lines = 500) {
  const response = await fetch(
    `${getKeeperUrl()}/api/container/logs?lines=${lines}`
  )
  return response.json()
}

/**
 * Get available versions from Keeper
 */
export async function getVersions() {
  const response = await fetch(`${getKeeperUrl()}/api/versions`)
  return response.json()
}

/**
 * Start update process via Keeper
 * @param {string} targetTag - Version tag to update to
 * @param {boolean} createBackup - Whether to create backup before update
 */
export async function startUpdate(targetTag, createBackup = true) {
  const response = await fetch(`${getKeeperUrl()}/api/update/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ targetTag, createBackup })
  })
  return response.json()
}

/**
 * Get current update status
 */
export async function getUpdateStatus() {
  const response = await fetch(`${getKeeperUrl()}/api/update/status`)
  return response.json()
}

/**
 * Subscribe to update status via Server-Sent Events
 * @param {function} onMessage - Callback for status updates
 * @param {function} onError - Callback for errors
 * @returns {function} Unsubscribe function
 */
export function subscribeToUpdateStatus(onMessage, onError) {
  const evtSource = new EventSource(
    `${getKeeperUrl()}/api/update/status/stream`
  )

  evtSource.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data)
      onMessage(data)
    } catch (e) {
      console.error('Failed to parse update status:', e)
    }
  }

  evtSource.onerror = (error) => {
    if (onError) onError(error)
    evtSource.close()
  }

  // Return unsubscribe function
  return () => evtSource.close()
}

/**
 * Clear the availability cache (useful after actions that might affect Keeper)
 */
export function clearCache() {
  keeperAvailableCache = null
}

export default {
  checkKeeperAvailable,
  restartContainer,
  getContainerLogs,
  getVersions,
  startUpdate,
  getUpdateStatus,
  subscribeToUpdateStatus,
  clearCache,
  getKeeperUrl
}
