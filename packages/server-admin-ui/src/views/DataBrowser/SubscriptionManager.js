/**
 * SubscriptionManager - Manages WebSocket subscriptions for visible paths
 *
 * Only subscribes to paths that are currently visible in the viewport.
 * Unsubscribes when paths scroll out of view.
 * Debounces subscription changes during fast scrolling.
 */

class SubscriptionManager {
  constructor() {
    this.webSocket = null
    this.subscribedPaths = new Set()
    this.pendingSubscribe = new Set()
    this.pendingUnsubscribe = new Set()
    this.debounceTimer = null
    this.debounceDelay = 150 // ms
    this.context = 'vessels.self'
    this.period = 1000 // update period in ms
  }

  /**
   * Set the WebSocket connection
   */
  setWebSocket(ws) {
    this.webSocket = ws
  }

  /**
   * Set the context for subscriptions
   */
  setContext(context) {
    if (this.context !== context) {
      // Unsubscribe from all paths in old context
      this.unsubscribeAll()
      this.context = context
    }
  }

  /**
   * Update which paths should be subscribed based on visible indices
   * @param {string[]} visiblePathKeys - Array of path keys currently visible
   */
  updateVisiblePaths(visiblePathKeys) {
    const visibleSet = new Set(visiblePathKeys)

    // Find paths to subscribe (visible but not subscribed)
    visiblePathKeys.forEach((pathKey) => {
      if (!this.subscribedPaths.has(pathKey)) {
        this.pendingSubscribe.add(pathKey)
        this.pendingUnsubscribe.delete(pathKey)
      }
    })

    // Find paths to unsubscribe (subscribed but not visible)
    this.subscribedPaths.forEach((pathKey) => {
      if (!visibleSet.has(pathKey)) {
        this.pendingUnsubscribe.add(pathKey)
        this.pendingSubscribe.delete(pathKey)
      }
    })

    // Debounce the actual subscription changes
    this.scheduleFlush()
  }

  /**
   * Schedule a debounced flush of pending changes
   */
  scheduleFlush() {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
    }
    this.debounceTimer = setTimeout(() => {
      this.flush()
    }, this.debounceDelay)
  }

  /**
   * Flush pending subscription changes to WebSocket
   */
  flush() {
    if (!this.webSocket) return

    // Process unsubscribes
    if (this.pendingUnsubscribe.size > 0) {
      const pathsToUnsubscribe = Array.from(this.pendingUnsubscribe)

      // Extract actual path from pathKey (remove source suffix)
      const uniquePaths = [
        ...new Set(
          pathsToUnsubscribe.map((pk) => {
            const data = this.getPathFromPathKey(pk)
            return data
          })
        )
      ]

      if (uniquePaths.length > 0) {
        const unsubMsg = {
          context: this.context === 'self' ? 'vessels.self' : this.context,
          unsubscribe: uniquePaths.map((path) => ({ path }))
        }

        try {
          this.webSocket.send(JSON.stringify(unsubMsg))
        } catch (e) {
          console.warn('Failed to send unsubscribe:', e)
        }
      }

      pathsToUnsubscribe.forEach((pk) => {
        this.subscribedPaths.delete(pk)
      })
      this.pendingUnsubscribe.clear()
    }

    // Process subscribes
    if (this.pendingSubscribe.size > 0) {
      const pathsToSubscribe = Array.from(this.pendingSubscribe)

      // Extract actual path from pathKey (remove source suffix)
      const uniquePaths = [
        ...new Set(
          pathsToSubscribe.map((pk) => {
            return this.getPathFromPathKey(pk)
          })
        )
      ]

      if (uniquePaths.length > 0) {
        const subMsg = {
          context: this.context === 'self' ? 'vessels.self' : this.context,
          subscribe: uniquePaths.map((path) => ({
            path,
            period: this.period
          }))
        }

        try {
          this.webSocket.send(JSON.stringify(subMsg))
        } catch (e) {
          console.warn('Failed to send subscribe:', e)
        }
      }

      pathsToSubscribe.forEach((pk) => {
        this.subscribedPaths.add(pk)
      })
      this.pendingSubscribe.clear()
    }
  }

  /**
   * Extract path from pathKey (pathKey format: "path$source")
   */
  getPathFromPathKey(pathKey) {
    const dollarIndex = pathKey.lastIndexOf('$')
    if (dollarIndex > 0) {
      return pathKey.substring(0, dollarIndex)
    }
    return pathKey
  }

  /**
   * Unsubscribe from all paths
   */
  unsubscribeAll() {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
    }

    if (this.webSocket && this.subscribedPaths.size > 0) {
      const unsubMsg = {
        context: '*',
        unsubscribe: [{ path: '*' }]
      }

      try {
        this.webSocket.send(JSON.stringify(unsubMsg))
      } catch (e) {
        console.warn('Failed to send unsubscribe all:', e)
      }
    }

    this.subscribedPaths.clear()
    this.pendingSubscribe.clear()
    this.pendingUnsubscribe.clear()
  }

  /**
   * Subscribe to all paths (fallback for initial data load)
   */
  subscribeToAll() {
    if (!this.webSocket) return

    const subMsg = {
      context: '*',
      subscribe: [
        {
          path: '*',
          period: 2000
        }
      ]
    }

    try {
      this.webSocket.send(JSON.stringify(subMsg))
    } catch (e) {
      console.warn('Failed to send subscribe all:', e)
    }
  }

  /**
   * Check if granular subscriptions are active
   */
  isGranularMode() {
    return this.subscribedPaths.size > 0
  }
}

// Singleton instance
const subscriptionManager = new SubscriptionManager()

export default subscriptionManager
export { SubscriptionManager }
