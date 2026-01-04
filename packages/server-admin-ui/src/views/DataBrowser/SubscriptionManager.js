/**
 * SubscriptionManager - Minimal subscription cleanup utility
 *
 * Note: Granular per-path subscriptions were attempted but caused WebSocket
 * instability during scroll (too many subscribe/unsubscribe messages).
 * Currently using wildcard subscriptions instead. This module only provides
 * the unsubscribeAll() cleanup function.
 */

class SubscriptionManager {
  constructor() {
    this.webSocket = null
  }

  setWebSocket(ws) {
    this.webSocket = ws
  }

  /**
   * Unsubscribe from all paths - used during cleanup
   */
  unsubscribeAll() {
    if (this.webSocket) {
      try {
        const unsubMsg = {
          context: '*',
          unsubscribe: [{ path: '*' }]
        }
        this.webSocket.send(JSON.stringify(unsubMsg))
      } catch (_e) {
        // WebSocket may already be closed
      }
    }
  }
}

const subscriptionManager = new SubscriptionManager()

export default subscriptionManager
