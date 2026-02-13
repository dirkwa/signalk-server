import { isUndefined } from 'lodash'
import { webSocketService } from './services/WebSocketService'
import { useStore } from './store'
import { serverApi } from './services/api'

declare global {
  interface Window {
    serverRoutesPrefix: string
  }
}

const authFetch = (url: string, options?: RequestInit): Promise<Response> => {
  return fetch(url, {
    ...options,
    credentials: 'include'
  })
}

export async function logoutAction(): Promise<void> {
  try {
    const response = await authFetch('/signalk/v1/auth/logout', {
      method: 'PUT'
    })
    if (!response.ok) {
      throw new Error(response.statusText)
    }
    await fetchLoginStatus()
  } catch (error) {
    console.error('Logout failed:', error)
    await fetchLoginStatus()
  }
}

/**
 * Uses Keeper API when running in Podman/Universal Installer environment,
 * otherwise falls back to SignalK Server API.
 */
export async function restartAction(): Promise<void> {
  if (confirm('Are you sure you want to restart?')) {
    try {
      await serverApi.restart()
    } catch (error) {
      // Network errors and 502s are expected during restart — the server goes down
      // before the proxied response arrives, breaking the connection.
      const isExpectedRestartError =
        error instanceof TypeError || // fetch network error
        (error instanceof Error && /502|503|fetch/.test(error.message))
      if (!isExpectedRestartError) {
        console.error('Failed to restart server:', error)
        alert(
          `Restart failed: ${error instanceof Error ? error.message : 'Unknown error'}`
        )
        return
      }
    }
    useStore.getState().setRestarting(true)
  }
}

export async function loginAction(
  username: string,
  password: string,
  rememberMe: boolean
): Promise<string | null> {
  const payload = {
    username,
    password,
    rememberMe
  }
  const request = await authFetch('/signalk/v1/auth/login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  })

  const response = await request.json()
  if (request.status !== 200) {
    return response.message
  }
  await fetchAllData()
  return null
}

export async function enableSecurity(
  userId: string,
  password: string
): Promise<string | null> {
  const payload = {
    userId,
    password,
    type: 'admin'
  }
  const response = await fetch(`${window.serverRoutesPrefix}/enableSecurity`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  })
  if (response.status !== 200) {
    const text = await response.text()
    return text
  }
  await fetchLoginStatus()
  return null
}

export async function fetchLoginStatus(): Promise<void> {
  const response = await authFetch(`${window.serverRoutesPrefix}/loginStatus`)
  if (response.status === 200) {
    const data = await response.json()
    useStore.getState().setLoginStatus(data)
  }
}

export async function fetchAllData(): Promise<void> {
  const fetchAndSet = async <T>(
    endpoint: string,
    setter: (data: T) => void,
    prefix?: string
  ) => {
    try {
      const response = await authFetch(
        `${isUndefined(prefix) ? window.serverRoutesPrefix : prefix}${endpoint}`
      )
      if (response.status === 200) {
        const data = await response.json()
        setter(data)
      }
    } catch (error) {
      console.error(`Failed to fetch ${endpoint}:`, error)
    }
  }

  const state = useStore.getState()

  await Promise.all([
    fetchAndSet('/plugins', state.setPlugins),
    fetchAndSet('/webapps', state.setWebapps),
    fetchAndSet('/addons', state.setAddons),
    fetchAndSet('/appstore/available', state.setAppStore),
    fetchAndSet('/loginStatus', state.setLoginStatus),
    fetchAndSet('/signalk', state.setServerSpecification, ''),
    fetchAndSet('/security/access/requests', state.setAccessRequests)
  ])
}

export function openServerEventsConnection(isReconnect?: boolean): void {
  webSocketService.connect(isReconnect)
}

export function closeServerEventsConnection(skipReconnect = false): void {
  webSocketService.close(skipReconnect)
}

export function getWebSocketService() {
  return webSocketService
}
