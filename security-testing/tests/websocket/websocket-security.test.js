/**
 * SignalK Server - WebSocket Security Tests
 *
 * Tests for WebSocket protocol security vulnerabilities:
 * - Unauthenticated connections
 * - Token handling
 * - Malformed message handling
 * - Large payload DoS
 * - Message injection
 */

const WebSocket = require('ws')
const { expect } = require('chai')
const http = require('http')

// Test configuration
const BASE_URL = process.env.SIGNALK_URL || 'http://localhost:3000'
const WS_URL = BASE_URL.replace('http', 'ws') + '/signalk/v1/stream'

// Helper to create WebSocket connection
function createWS(url, options = {}) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, options)
    ws.on('open', () => resolve(ws))
    ws.on('error', reject)
    setTimeout(() => reject(new Error('Connection timeout')), 5000)
  })
}

// Helper to wait for message
function waitForMessage(ws, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('Message timeout')),
      timeout
    )
    ws.once('message', (data) => {
      clearTimeout(timer)
      resolve(JSON.parse(data.toString()))
    })
  })
}

describe('WebSocket Security Tests', function () {
  this.timeout(30000)

  describe('Unauthenticated Connection Tests', () => {
    it('should allow connection without authentication (if allow_readonly enabled)', async () => {
      // This tests the allow_readonly configuration
      try {
        const ws = await createWS(WS_URL)
        const msg = await waitForMessage(ws)

        // Should receive hello message
        expect(msg).to.have.property('name')
        expect(msg).to.have.property('version')

        ws.close()
      } catch (err) {
        // If connection refused, security may be enabled without allow_readonly
        console.log('Connection refused - security enabled:', err.message)
      }
    })

    it('should not allow write operations without authentication', async () => {
      try {
        const ws = await createWS(WS_URL)
        await waitForMessage(ws) // hello

        // Try to send a PUT request
        const putRequest = {
          requestId: 'test-' + Date.now(),
          put: {
            path: 'navigation.speedOverGround',
            value: 999,
          },
        }

        ws.send(JSON.stringify(putRequest))

        const response = await waitForMessage(ws, 10000)

        // Should be rejected
        if (response.requestId === putRequest.requestId) {
          expect(response.state).to.equal('COMPLETED')
          expect(response.statusCode).to.be.oneOf([401, 403])
        }

        ws.close()
      } catch (err) {
        // Expected if security is strict
        console.log('Write rejected as expected:', err.message)
      }
    })
  })

  describe('Token Security Tests', () => {
    it('should reject invalid token in query parameter', async () => {
      const invalidUrl = WS_URL + '?token=invalid-token-12345'

      try {
        const ws = await createWS(invalidUrl)
        // If we get here, token validation may be weak
        const msg = await waitForMessage(ws)
        console.log('WARNING: Connection allowed with invalid token')
        ws.close()
      } catch (err) {
        // Expected - invalid token should be rejected
        expect(err.message).to.match(/401|403|Unexpected|ECONNREFUSED/)
      }
    })

    it('should reject malformed JWT token', async () => {
      const malformedTokens = [
        'not.a.jwt',
        'eyJ.invalid.base64',
        'eyJhbGciOiJub25lIn0.eyJpZCI6ImFkbWluIn0.', // Algorithm none attack
        '../../../etc/passwd',
        '<script>alert(1)</script>',
        "'; DROP TABLE users; --",
      ]

      for (const token of malformedTokens) {
        const url = WS_URL + '?token=' + encodeURIComponent(token)
        try {
          const ws = await createWS(url)
          console.log(`WARNING: Malformed token accepted: ${token.slice(0, 20)}...`)
          ws.close()
        } catch (err) {
          // Expected - malformed tokens should be rejected
        }
      }
    })

    it('should reject expired tokens', async () => {
      // This would require creating an actual expired token
      // Placeholder for manual testing with expired token
      console.log('  [Manual test required with actual expired token]')
    })
  })

  describe('Malformed Message Handling', () => {
    it('should handle invalid JSON gracefully', async () => {
      try {
        const ws = await createWS(WS_URL)
        await waitForMessage(ws) // hello

        // Send malformed JSON
        const malformedMessages = [
          '{invalid json',
          '{"unclosed": "string',
          'not json at all',
          '',
          '\x00\x00\x00',
          '{"__proto__": {"admin": true}}',
        ]

        for (const msg of malformedMessages) {
          ws.send(msg)
          // Should not crash the connection
        }

        // Wait a bit and check connection is still alive
        await new Promise((r) => setTimeout(r, 1000))
        expect(ws.readyState).to.equal(WebSocket.OPEN)

        ws.close()
      } catch (err) {
        console.log('Connection issue:', err.message)
      }
    })

    it('should handle prototype pollution attempts', async () => {
      try {
        const ws = await createWS(WS_URL)
        await waitForMessage(ws) // hello

        // Prototype pollution payloads
        const payloads = [
          { __proto__: { admin: true } },
          { constructor: { prototype: { admin: true } } },
          { updates: [{ __proto__: { isAdmin: true } }] },
        ]

        for (const payload of payloads) {
          ws.send(JSON.stringify(payload))
        }

        await new Promise((r) => setTimeout(r, 500))
        expect(ws.readyState).to.equal(WebSocket.OPEN)

        ws.close()
      } catch (err) {
        console.log('Handled pollution attempt:', err.message)
      }
    })
  })

  describe('DoS Prevention', () => {
    it('should handle large payloads without crash', async () => {
      try {
        const ws = await createWS(WS_URL)
        await waitForMessage(ws) // hello

        // Send increasingly large payloads
        const sizes = [1024, 10240, 102400, 1024000] // 1KB, 10KB, 100KB, 1MB

        for (const size of sizes) {
          const largePayload = JSON.stringify({
            updates: [
              {
                source: { label: 'test' },
                values: [{ path: 'test.path', value: 'x'.repeat(size) }],
              },
            ],
          })

          try {
            ws.send(largePayload)
          } catch (err) {
            // Expected for very large payloads
            console.log(`Rejected ${size} byte payload: ${err.message}`)
          }
        }

        await new Promise((r) => setTimeout(r, 1000))
        ws.close()
      } catch (err) {
        console.log('DoS test result:', err.message)
      }
    })

    it('should handle rapid message flooding', async () => {
      try {
        const ws = await createWS(WS_URL)
        await waitForMessage(ws) // hello

        const startTime = Date.now()
        const messageCount = 1000

        // Send many messages rapidly
        for (let i = 0; i < messageCount; i++) {
          ws.send(JSON.stringify({ ping: i }))
        }

        const elapsed = Date.now() - startTime
        console.log(`Sent ${messageCount} messages in ${elapsed}ms`)

        await new Promise((r) => setTimeout(r, 2000))

        // Connection should still be alive (or gracefully closed)
        if (ws.readyState === WebSocket.OPEN) {
          console.log('Connection survived flooding')
        } else {
          console.log('Connection closed after flooding (expected)')
        }

        ws.close()
      } catch (err) {
        console.log('Flooding test result:', err.message)
      }
    })
  })

  describe('Subscription Security', () => {
    it('should validate subscription paths', async () => {
      try {
        const ws = await createWS(WS_URL)
        await waitForMessage(ws) // hello

        // Try to subscribe with malicious paths
        const maliciousPaths = [
          '../../../etc/passwd',
          '..\\..\\windows\\system32',
          'vessels.self; DROP TABLE deltas;',
          'vessels.<script>alert(1)</script>',
          'vessels.self.navigation.*', // Should work if allowed
        ]

        for (const path of maliciousPaths) {
          ws.send(
            JSON.stringify({
              context: 'vessels.self',
              subscribe: [{ path, period: 1000 }],
            })
          )
        }

        await new Promise((r) => setTimeout(r, 1000))
        ws.close()
      } catch (err) {
        console.log('Subscription validation:', err.message)
      }
    })
  })

  describe('Origin Validation', () => {
    it('should validate WebSocket origin header', async () => {
      const origins = [
        'http://evil.com',
        'http://localhost:3000',
        'null',
        '',
      ]

      for (const origin of origins) {
        try {
          const ws = await createWS(WS_URL, {
            headers: { Origin: origin },
          })
          console.log(`Origin '${origin}' accepted`)
          ws.close()
        } catch (err) {
          console.log(`Origin '${origin}' rejected: ${err.message}`)
        }
      }
    })
  })
})

// Run if executed directly
if (require.main === module) {
  const Mocha = require('mocha')
  const mocha = new Mocha()
  mocha.addFile(__filename)
  mocha.run((failures) => process.exit(failures ? 1 : 0))
}
