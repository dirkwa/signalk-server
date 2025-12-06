/**
 * WASM Socket Manager
 *
 * Manages UDP sockets for WASM plugins that need raw network access
 * (e.g., radar plugins, NMEA receivers, etc.)
 *
 * Uses Node.js dgram module, bridged to WASM via FFI
 */

import * as dgram from 'dgram'
import Debug from 'debug'

const debug = Debug('signalk:wasm:sockets')

/**
 * Buffered datagram for non-blocking receive
 */
interface BufferedDatagram {
  data: Buffer
  address: string
  port: number
  timestamp: number
}

/**
 * Pending socket option to apply after bind
 */
interface PendingOption {
  type: 'broadcast' | 'multicastTTL' | 'multicastLoopback' | 'joinMulticast' | 'leaveMulticast'
  value: boolean | number | { multicastAddress: string; interfaceAddress?: string }
}

/**
 * Managed UDP socket with receive buffer
 */
interface ManagedSocket {
  socket: dgram.Socket
  pluginId: string
  bound: boolean
  bindPromise: Promise<number> | null
  receiveBuffer: BufferedDatagram[]
  maxBufferSize: number
  multicastGroups: Set<string>
  pendingOptions: PendingOption[]
}

/**
 * Socket Manager - singleton for managing plugin sockets
 */
class SocketManager {
  private sockets: Map<number, ManagedSocket> = new Map()
  private nextSocketId: number = 1

  /**
   * Create a new UDP socket
   * @param pluginId - Plugin that owns the socket
   * @param type - Socket type: 'udp4' or 'udp6'
   * @returns Socket ID, or -1 on error
   */
  createSocket(pluginId: string, type: 'udp4' | 'udp6' = 'udp4'): number {
    try {
      const socketId = this.nextSocketId++
      const socket = dgram.createSocket({
        type,
        reuseAddr: true  // Allow multiple plugins to bind to same port
      })

      const managed: ManagedSocket = {
        socket,
        pluginId,
        bound: false,
        bindPromise: null,
        receiveBuffer: [],
        maxBufferSize: 1000, // Max buffered datagrams
        multicastGroups: new Set(),
        pendingOptions: []
      }

      // Set up message handler to buffer incoming data
      socket.on('message', (msg, rinfo) => {
        if (managed.receiveBuffer.length >= managed.maxBufferSize) {
          // Drop oldest message if buffer full
          managed.receiveBuffer.shift()
        }
        managed.receiveBuffer.push({
          data: Buffer.from(msg), // Copy the buffer
          address: rinfo.address,
          port: rinfo.port,
          timestamp: Date.now()
        })
      })

      socket.on('error', (err) => {
        debug(`[${pluginId}] Socket ${socketId} error: ${err.message}`)
      })

      socket.on('close', () => {
        debug(`[${pluginId}] Socket ${socketId} closed`)
        this.sockets.delete(socketId)
      })

      this.sockets.set(socketId, managed)
      debug(`[${pluginId}] Created socket ${socketId} (${type})`)
      return socketId
    } catch (error) {
      debug(`Failed to create socket: ${error}`)
      return -1
    }
  }

  /**
   * Bind socket to a port
   * @param socketId - Socket to bind
   * @param port - Port number (0 for any available port)
   * @param address - Address to bind to (optional, defaults to all interfaces)
   * @returns 0 on success, -1 on error
   */
  bind(socketId: number, port: number, address?: string): Promise<number> {
    const managed = this.sockets.get(socketId)
    if (!managed) {
      debug(`Socket ${socketId} not found`)
      return Promise.resolve(-1)
    }

    // Store the promise so setBroadcast etc. can wait for it
    managed.bindPromise = new Promise((resolve) => {
      try {
        managed.socket.bind(port, address, () => {
          managed.bound = true
          const addr = managed.socket.address()
          debug(`[${managed.pluginId}] Socket ${socketId} bound to ${addr.address}:${addr.port}`)

          // Apply any pending socket options now that we're bound
          for (const option of managed.pendingOptions) {
            try {
              if (option.type === 'broadcast') {
                managed.socket.setBroadcast(option.value as boolean)
                debug(`[${managed.pluginId}] Applied deferred setBroadcast(${option.value})`)
              } else if (option.type === 'multicastTTL') {
                managed.socket.setMulticastTTL(option.value as number)
                debug(`[${managed.pluginId}] Applied deferred setMulticastTTL(${option.value})`)
              } else if (option.type === 'multicastLoopback') {
                managed.socket.setMulticastLoopback(option.value as boolean)
                debug(`[${managed.pluginId}] Applied deferred setMulticastLoopback(${option.value})`)
              } else if (option.type === 'joinMulticast') {
                const { multicastAddress, interfaceAddress } = option.value as { multicastAddress: string; interfaceAddress?: string }
                if (interfaceAddress) {
                  managed.socket.addMembership(multicastAddress, interfaceAddress)
                } else {
                  managed.socket.addMembership(multicastAddress)
                }
                managed.multicastGroups.add(multicastAddress)
                debug(`[${managed.pluginId}] Applied deferred joinMulticast(${multicastAddress})`)
              } else if (option.type === 'leaveMulticast') {
                const { multicastAddress, interfaceAddress } = option.value as { multicastAddress: string; interfaceAddress?: string }
                if (interfaceAddress) {
                  managed.socket.dropMembership(multicastAddress, interfaceAddress)
                } else {
                  managed.socket.dropMembership(multicastAddress)
                }
                managed.multicastGroups.delete(multicastAddress)
                debug(`[${managed.pluginId}] Applied deferred leaveMulticast(${multicastAddress})`)
              }
            } catch (optionError) {
              debug(`[${managed.pluginId}] Error applying deferred option ${option.type}: ${optionError}`)
            }
          }
          managed.pendingOptions = []

          resolve(0)
        })
      } catch (error) {
        debug(`[${managed.pluginId}] Bind error: ${error}`)
        resolve(-1)
      }
    })

    return managed.bindPromise
  }

  /**
   * Join a multicast group
   * @param socketId - Socket to use
   * @param multicastAddress - Multicast group address (e.g., "239.254.2.0")
   * @param interfaceAddress - Interface address to use (optional)
   * @returns 0 on success, -1 on error
   */
  joinMulticast(socketId: number, multicastAddress: string, interfaceAddress?: string): number {
    const managed = this.sockets.get(socketId)
    if (!managed) {
      debug(`Socket ${socketId} not found`)
      return -1
    }

    // If socket is not yet bound, defer the multicast join until bind completes
    if (!managed.bound) {
      debug(`[${managed.pluginId}] Deferring joinMulticast(${multicastAddress}) until socket is bound`)
      managed.pendingOptions.push({
        type: 'joinMulticast',
        value: { multicastAddress, interfaceAddress }
      })
      return 0
    }

    try {
      if (interfaceAddress) {
        managed.socket.addMembership(multicastAddress, interfaceAddress)
      } else {
        managed.socket.addMembership(multicastAddress)
      }
      managed.multicastGroups.add(multicastAddress)
      debug(`[${managed.pluginId}] Socket ${socketId} joined multicast ${multicastAddress}`)
      return 0
    } catch (error) {
      debug(`[${managed.pluginId}] Join multicast error: ${error}`)
      return -1
    }
  }

  /**
   * Leave a multicast group
   * @param socketId - Socket to use
   * @param multicastAddress - Multicast group address
   * @param interfaceAddress - Interface address (optional)
   * @returns 0 on success, -1 on error
   */
  leaveMulticast(socketId: number, multicastAddress: string, interfaceAddress?: string): number {
    const managed = this.sockets.get(socketId)
    if (!managed) {
      debug(`Socket ${socketId} not found`)
      return -1
    }

    // If socket is not yet bound, defer the multicast leave until bind completes
    if (!managed.bound) {
      debug(`[${managed.pluginId}] Deferring leaveMulticast(${multicastAddress}) until socket is bound`)
      managed.pendingOptions.push({
        type: 'leaveMulticast',
        value: { multicastAddress, interfaceAddress }
      })
      return 0
    }

    try {
      if (interfaceAddress) {
        managed.socket.dropMembership(multicastAddress, interfaceAddress)
      } else {
        managed.socket.dropMembership(multicastAddress)
      }
      managed.multicastGroups.delete(multicastAddress)
      debug(`[${managed.pluginId}] Socket ${socketId} left multicast ${multicastAddress}`)
      return 0
    } catch (error) {
      debug(`[${managed.pluginId}] Leave multicast error: ${error}`)
      return -1
    }
  }

  /**
   * Set socket options
   */
  setMulticastTTL(socketId: number, ttl: number): number {
    const managed = this.sockets.get(socketId)
    if (!managed) return -1

    // If socket is not yet bound, defer the option
    if (!managed.bound) {
      debug(`[${managed.pluginId}] Deferring setMulticastTTL(${ttl}) until socket is bound`)
      managed.pendingOptions.push({ type: 'multicastTTL', value: ttl })
      return 0
    }

    try {
      managed.socket.setMulticastTTL(ttl)
      return 0
    } catch (error) {
      debug(`[${managed.pluginId}] setMulticastTTL error: ${error}`)
      return -1
    }
  }

  setMulticastLoopback(socketId: number, enabled: boolean): number {
    const managed = this.sockets.get(socketId)
    if (!managed) return -1

    // If socket is not yet bound, defer the option
    if (!managed.bound) {
      debug(`[${managed.pluginId}] Deferring setMulticastLoopback(${enabled}) until socket is bound`)
      managed.pendingOptions.push({ type: 'multicastLoopback', value: enabled })
      return 0
    }

    try {
      managed.socket.setMulticastLoopback(enabled)
      return 0
    } catch (error) {
      debug(`[${managed.pluginId}] setMulticastLoopback error: ${error}`)
      return -1
    }
  }

  setBroadcast(socketId: number, enabled: boolean): number {
    const managed = this.sockets.get(socketId)
    if (!managed) return -1

    // If socket is not yet bound, defer the option
    if (!managed.bound) {
      debug(`[${managed.pluginId}] Deferring setBroadcast(${enabled}) until socket is bound`)
      managed.pendingOptions.push({ type: 'broadcast', value: enabled })
      return 0
    }

    try {
      managed.socket.setBroadcast(enabled)
      return 0
    } catch (error) {
      debug(`[${managed.pluginId}] setBroadcast error: ${error}`)
      return -1
    }
  }

  /**
   * Send data via UDP
   * @param socketId - Socket to use
   * @param data - Data to send
   * @param address - Destination address
   * @param port - Destination port
   * @returns Bytes sent, or -1 on error
   */
  send(socketId: number, data: Buffer, address: string, port: number): Promise<number> {
    return new Promise((resolve) => {
      const managed = this.sockets.get(socketId)
      if (!managed) {
        debug(`Socket ${socketId} not found`)
        resolve(-1)
        return
      }

      managed.socket.send(data, port, address, (err, bytes) => {
        if (err) {
          debug(`[${managed.pluginId}] Send error: ${err}`)
          resolve(-1)
        } else {
          resolve(bytes)
        }
      })
    })
  }

  /**
   * Receive data from buffer (non-blocking)
   * @param socketId - Socket to receive from
   * @returns Buffered datagram, or null if buffer empty
   */
  receive(socketId: number): BufferedDatagram | null {
    const managed = this.sockets.get(socketId)
    if (!managed) {
      debug(`Socket ${socketId} not found`)
      return null
    }

    return managed.receiveBuffer.shift() || null
  }

  /**
   * Get number of buffered datagrams
   */
  getBufferedCount(socketId: number): number {
    const managed = this.sockets.get(socketId)
    return managed ? managed.receiveBuffer.length : 0
  }

  /**
   * Close a socket
   * @param socketId - Socket to close
   */
  close(socketId: number): void {
    const managed = this.sockets.get(socketId)
    if (!managed) {
      debug(`Socket ${socketId} not found`)
      return
    }

    try {
      // Leave all multicast groups first
      for (const group of managed.multicastGroups) {
        try {
          managed.socket.dropMembership(group)
        } catch (e) {
          // Ignore errors when leaving groups during close
        }
      }

      managed.socket.close()
      this.sockets.delete(socketId)
      debug(`[${managed.pluginId}] Socket ${socketId} closed`)
    } catch (error) {
      debug(`[${managed.pluginId}] Close error: ${error}`)
    }
  }

  /**
   * Close all sockets for a plugin (cleanup on plugin stop)
   */
  closeAllForPlugin(pluginId: string): void {
    const toClose: number[] = []
    for (const [id, managed] of this.sockets) {
      if (managed.pluginId === pluginId) {
        toClose.push(id)
      }
    }
    for (const id of toClose) {
      this.close(id)
    }
    debug(`[${pluginId}] Closed ${toClose.length} sockets`)
  }

  /**
   * Get socket statistics
   */
  getStats(): { totalSockets: number; socketsPerPlugin: Record<string, number> } {
    const socketsPerPlugin: Record<string, number> = {}
    for (const managed of this.sockets.values()) {
      socketsPerPlugin[managed.pluginId] = (socketsPerPlugin[managed.pluginId] || 0) + 1
    }
    return {
      totalSockets: this.sockets.size,
      socketsPerPlugin
    }
  }
}

// Export singleton instance
export const socketManager = new SocketManager()

// Export types
export type { BufferedDatagram, ManagedSocket }
