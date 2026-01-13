import { isUndefined } from 'lodash'
import * as keeper from './services/keeper'

const authFetch = (url, options) => {
  return fetch(url, {
    ...options,
    credentials: 'include'
  })
}

export function logout() {
  return (dispatch) => {
    dispatch({
      type: 'LOGOUT_REQUESTED'
    })
    authFetch('/signalk/v1/auth/logout', {
      method: 'PUT'
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error(response.statusText)
        }
        return response
      })
      .then(() => {
        dispatch({
          type: 'LOGOUT_SUCCESS'
        })
      })
      .catch((error) => {
        dispatch({
          type: 'LOGOUT_FAILED',
          data: error
        })
      })
      .then(() => {
        fetchLoginStatus(dispatch)
      })
  }
}

export async function login(
  dispatch,
  username,
  password,
  rememberMe,
  callback
) {
  const payload = {
    username: username,
    password: password,
    rememberMe: rememberMe
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
    dispatch({
      type: 'LOGIN_FAILURE',
      data: response.message
    })
    callback(response.message)
  } else if (response) {
    fetchAllData(dispatch)
    dispatch({
      type: 'LOGIN_SUCCESS'
    })
    callback(null)
  }
}

export function enableSecurity(dispatch, userId, password, callback) {
  var payload = {
    userId: userId,
    password: password,
    type: 'admin'
  }
  fetch(`${window.serverRoutesPrefix}/enableSecurity`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  }).then((response) => {
    if (response.status !== 200) {
      response.text().then((text) => {
        callback(text)
      })
    } else {
      callback(null)
    }
  })
}

export function restart() {
  return async (dispatch, getState) => {
    if (!confirm('Are you sure you want to restart?')) {
      return
    }

    const { keeper: keeperState } = getState()

    if (keeperState.available) {
      // Use Keeper to restart container
      try {
        await keeper.restartContainer()
        dispatch({ type: 'SERVER_RESTART' })
      } catch (error) {
        console.error('Keeper restart failed, falling back:', error)
        // Fallback to direct SignalK restart
        await fetch(`${window.serverRoutesPrefix}/restart`, {
          credentials: 'include',
          method: 'PUT'
        })
        dispatch({ type: 'SERVER_RESTART' })
      }
    } else {
      // Original behavior - direct SignalK restart
      await fetch(`${window.serverRoutesPrefix}/restart`, {
        credentials: 'include',
        method: 'PUT'
      })
      dispatch({ type: 'SERVER_RESTART' })
    }
  }
}

export const buildFetchAction =
  (endpoint, type, prefix) => async (dispatch) => {
    const response = await authFetch(
      `${isUndefined(prefix) ? window.serverRoutesPrefix : prefix}${endpoint}`
    )

    if (response.status === 200) {
      const data = await response.json()
      dispatch({
        type,
        data
      })
    }
  }

export const fetchLoginStatus = buildFetchAction(
  '/loginStatus',
  'RECEIVE_LOGIN_STATUS'
)
export const fetchPlugins = buildFetchAction('/plugins', 'RECEIVE_PLUGIN_LIST')
export const fetchWebapps = buildFetchAction('/webapps', 'RECEIVE_WEBAPPS_LIST')
export const fetchAddons = buildFetchAction('/addons', 'RECEIVE_ADDONS_LIST')
export const fetchApps = buildFetchAction(
  '/appstore/available',
  'RECEIVE_APPSTORE_LIST'
)
export const fetchAccessRequests = buildFetchAction(
  '/security/access/requests',
  'ACCESS_REQUEST'
)
export const fetchServerSpecification = buildFetchAction(
  '/signalk',
  'RECEIVE_SERVER_SPEC',
  ''
)

export function fetchAllData(dispatch) {
  fetchPlugins(dispatch)
  fetchWebapps(dispatch)
  fetchAddons(dispatch)
  fetchApps(dispatch)
  fetchLoginStatus(dispatch)
  fetchServerSpecification(dispatch)
  fetchAccessRequests(dispatch)
}

export function openServerEventsConnection(dispatch, isReconnect) {
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
  const ws = new WebSocket(
    proto +
      '://' +
      window.location.host +
      `/signalk/v1/stream?serverevents=all&subscribe=none&sendMeta=all`
  )

  ws.onmessage = function (event) {
    const serverEvent = JSON.parse(event.data)

    // Check for backpressure indicator on any delta
    if (serverEvent.$backpressure) {
      dispatch({
        type: 'BACKPRESSURE_WARNING',
        data: {
          accumulated: serverEvent.$backpressure.accumulated,
          duration: serverEvent.$backpressure.duration,
          timestamp: Date.now()
        }
      })
      // Auto-clear after 10 seconds
      setTimeout(() => {
        dispatch({ type: 'BACKPRESSURE_WARNING_CLEAR' })
      }, 10000)
    }

    if (serverEvent.type) {
      dispatch(serverEvent)
    } else if (serverEvent.name) {
      ws.skSelf = serverEvent.self
    } else if (ws.messageHandler) {
      ws.messageHandler(serverEvent)
    }
  }
  ws.onclose = () => {
    console.log('closed')
    dispatch({
      type: 'WEBSOCKET_CLOSE'
    })
  }
  ws.onerror = () => {
    dispatch({
      type: 'WEBSOCKET_ERROR'
    })
  }
  ws.onopen = () => {
    console.log('connected')
    dispatch({
      type: 'WEBSOCKET_OPEN',
      data: ws
    })
    if (isReconnect) {
      window.location.reload()
    }
  }
}

// Keeper integration actions

/**
 * Check if Keeper is available (call on app init when isInDocker)
 */
export function checkKeeperAvailability() {
  return async (dispatch) => {
    dispatch({ type: 'KEEPER_AVAILABILITY_CHECK' })
    try {
      const available = await keeper.checkKeeperAvailable()
      dispatch({ type: 'KEEPER_AVAILABILITY_RESULT', data: available })
    } catch (_error) {
      dispatch({ type: 'KEEPER_AVAILABILITY_RESULT', data: false })
    }
  }
}

/**
 * Fetch available versions from Keeper
 */
export function fetchKeeperVersions() {
  return async (dispatch) => {
    try {
      const result = await keeper.getVersions()
      if (result.success) {
        dispatch({ type: 'KEEPER_VERSIONS_RECEIVED', data: result.data })
      }
    } catch (error) {
      console.error('Failed to fetch Keeper versions:', error)
    }
  }
}

/**
 * Update Keeper update status in Redux
 */
export function updateKeeperStatus(status) {
  return { type: 'KEEPER_UPDATE_STATUS', data: status }
}
