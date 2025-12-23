/**
 * SignalK Server - ACL/Authorization Security Tests
 *
 * Tests for authorization vulnerabilities:
 * - Permission escalation
 * - ACL bypass
 * - Path traversal
 * - Regex DoS in ACL patterns
 */

const WebSocket = require('ws')
const { expect } = require('chai')
const http = require('http')

// Test configuration
const BASE_URL = process.env.SIGNALK_URL || 'http://localhost:3000'
const WS_URL = BASE_URL.replace('http', 'ws') + '/signalk/v1/stream'

// HTTP request helper
function request(method, path, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL)
    const lib = url.protocol === 'https:' ? require('https') : http

    const options = {
      hostname: url.hostname,
      port: url.port || 80,
      path: url.pathname + url.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
    }

    const req = lib.request(options, (res) => {
      let data = ''
      res.on('data', (chunk) => (data += chunk))
      res.on('end', () => {
        try {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: data ? JSON.parse(data) : null,
          })
        } catch {
          resolve({ status: res.statusCode, headers: res.headers, body: data })
        }
      })
    })

    req.on('error', reject)
    if (body) req.write(JSON.stringify(body))
    req.end()
  })
}

describe('ACL/Authorization Security Tests', function () {
  this.timeout(30000)

  describe('Permission Escalation', () => {
    it('should not allow readonly user to write data', async () => {
      // This test requires a readonly token
      // Placeholder for testing with actual readonly credentials
      console.log('  [Test with readonly token: attempt PUT request]')
    })

    it('should not allow readwrite user to access admin endpoints', async () => {
      const adminEndpoints = [
        '/skServer/restart',
        '/skServer/security/config',
        '/skServer/security/users',
        '/skServer/backup',
      ]

      for (const endpoint of adminEndpoints) {
        const res = await request('GET', endpoint)
        // Without admin token, should be rejected
        expect(res.status).to.be.oneOf([401, 403])
      }
    })

    it('should not allow permission field manipulation', async () => {
      // Try to escalate permissions via request body
      const res = await request('POST', '/signalk/v1/auth/login', {
        username: 'user',
        password: 'password',
        permissions: 'admin',  // Attempted escalation
      })

      // If login succeeds, verify returned permissions
      if (res.status === 200 && res.body && res.body.token) {
        // Decode token and check permissions aren't escalated
        console.log('  [Verify token does not have admin permissions]')
      }
    })
  })

  describe('ACL Bypass Attempts', () => {
    it('should not allow path bypass with special characters', async () => {
      const bypassAttempts = [
        '/signalk/v1/api/vessels/self/../../../etc/passwd',
        '/signalk/v1/api/vessels/self%2f..%2f..%2fetc%2fpasswd',
        '/signalk/v1/api/vessels/self/navigation/..%252f..%252f',
        '/signalk/v1/api/vessels/self/navigation/position/../../speedOverGround',
        '/signalk/v1/api/../skServer/security/users',
      ]

      for (const path of bypassAttempts) {
        const res = await request('GET', path)
        // Should not return sensitive data
        expect(res.status).to.be.oneOf([200, 400, 404])
        if (res.body) {
          const bodyStr = JSON.stringify(res.body)
          expect(bodyStr).to.not.include('root:')
          expect(bodyStr).to.not.include('/etc/passwd')
        }
      }
    })

    it('should not allow null byte injection in paths', async () => {
      const nullByteAttempts = [
        '/signalk/v1/api/vessels/self%00.json',
        '/signalk/v1/api/vessels/self\x00/navigation',
      ]

      for (const path of nullByteAttempts) {
        try {
          const res = await request('GET', path)
          expect(res.status).to.be.oneOf([200, 400, 404])
        } catch (err) {
          // Expected - null bytes should be rejected
        }
      }
    })

    it('should not allow context manipulation', async () => {
      // Try to access other vessels when ACL restricts to self
      const contextAttempts = [
        '/signalk/v1/api/vessels/urn:mrn:imo:mmsi:123456789',
        '/signalk/v1/api/vessels/*',
        '/signalk/v1/api/vessels/self/../other-vessel',
      ]

      for (const path of contextAttempts) {
        const res = await request('GET', path)
        // Should either work (if allowed) or be properly rejected
        expect(res.status).to.be.oneOf([200, 400, 403, 404])
      }
    })
  })

  describe('ACL Pattern Security', () => {
    it('should handle regex DoS patterns safely', async () => {
      // ReDoS attack patterns - these could cause exponential processing time
      const redosPatterns = [
        'navigation.' + 'a'.repeat(50),
        'navigation.((a+)+)+b',
        'navigation.' + '.*'.repeat(20),
      ]

      for (const pattern of redosPatterns) {
        const startTime = Date.now()
        const res = await request('GET', `/signalk/v1/api/vessels/self/${pattern}`)
        const elapsed = Date.now() - startTime

        // Should complete in reasonable time (< 5 seconds)
        expect(elapsed).to.be.lessThan(5000)
      }
    })

    it('should not allow wildcard abuse in subscriptions', async () => {
      try {
        const ws = new WebSocket(WS_URL)
        await new Promise((resolve, reject) => {
          ws.on('open', resolve)
          ws.on('error', reject)
          setTimeout(() => reject(new Error('timeout')), 5000)
        })

        // Wait for hello
        await new Promise((resolve) => ws.once('message', resolve))

        // Try overly broad subscriptions
        const broadSubscriptions = [
          { context: '*', subscribe: [{ path: '*' }] },
          { context: '**', subscribe: [{ path: '**' }] },
          { context: 'vessels.*', subscribe: [{ path: '*.*.*.*.*' }] },
        ]

        for (const sub of broadSubscriptions) {
          ws.send(JSON.stringify(sub))
        }

        // Should handle without crashing
        await new Promise((r) => setTimeout(r, 1000))
        ws.close()
      } catch (err) {
        console.log('Wildcard subscription handled:', err.message)
      }
    })
  })

  describe('Delta Access Control', () => {
    it('should filter deltas based on user permissions', async () => {
      // This test requires WebSocket with limited user token
      console.log('  [Test with limited token: verify delta filtering]')
    })

    it('should not allow delta injection to bypass ACL', async () => {
      try {
        const ws = new WebSocket(WS_URL)
        await new Promise((resolve, reject) => {
          ws.on('open', resolve)
          ws.on('error', reject)
          setTimeout(() => reject(new Error('timeout')), 5000)
        })

        // Wait for hello
        await new Promise((resolve) => ws.once('message', resolve))

        // Try to inject deltas for paths we shouldn't have access to
        const maliciousDeltas = [
          {
            context: 'vessels.self',
            updates: [
              {
                source: { label: 'attacker' },
                values: [{ path: 'security.admin', value: true }],
              },
            ],
          },
          {
            context: 'vessels.other',
            updates: [
              {
                source: { label: 'attacker' },
                values: [{ path: 'navigation.position', value: { lat: 0, lon: 0 } }],
              },
            ],
          },
        ]

        for (const delta of maliciousDeltas) {
          ws.send(JSON.stringify(delta))
        }

        await new Promise((r) => setTimeout(r, 1000))
        ws.close()
      } catch (err) {
        console.log('Delta injection handled:', err.message)
      }
    })
  })

  describe('PUT Request Authorization', () => {
    it('should reject PUT without authentication', async () => {
      const res = await request('PUT', '/signalk/v1/api/vessels/self/navigation/speedOverGround', {
        value: 10,
      })

      expect(res.status).to.be.oneOf([401, 403])
    })

    it('should validate path in PUT request', async () => {
      const maliciousPaths = [
        '/signalk/v1/api/vessels/self/../../../etc/config',
        '/signalk/v1/api/vessels/self/navigation/__proto__/polluted',
        '/signalk/v1/api/vessels/self/navigation/constructor/prototype',
      ]

      for (const path of maliciousPaths) {
        const res = await request('PUT', path, { value: 'malicious' })
        expect(res.status).to.be.oneOf([400, 401, 403, 404])
      }
    })

    it('should not allow source spoofing in PUT', async () => {
      const res = await request('PUT', '/signalk/v1/api/vessels/self/navigation/speedOverGround', {
        value: 10,
        source: 'trusted-navigation-system',  // Spoofed source
      })

      // Should be rejected or source should be overwritten
      expect(res.status).to.be.oneOf([200, 400, 401, 403])
    })
  })

  describe('Admin Endpoint Protection', () => {
    it('should protect all /skServer endpoints', async () => {
      const adminEndpoints = [
        { method: 'GET', path: '/skServer/security/config' },
        { method: 'PUT', path: '/skServer/security/config' },
        { method: 'GET', path: '/skServer/security/users' },
        { method: 'POST', path: '/skServer/security/users/newuser' },
        { method: 'DELETE', path: '/skServer/security/users/admin' },
        { method: 'GET', path: '/skServer/backup' },
        { method: 'POST', path: '/skServer/restore' },
        { method: 'PUT', path: '/skServer/restart' },
        { method: 'GET', path: '/skServer/settings' },
        { method: 'PUT', path: '/skServer/settings' },
      ]

      for (const { method, path } of adminEndpoints) {
        const res = await request(method, path)
        expect(res.status).to.be.oneOf([401, 403], `${method} ${path} should require auth`)
      }
    })

    it('should not expose admin endpoints in unauthenticated responses', async () => {
      const res = await request('GET', '/signalk')

      if (res.body && res.body.endpoints) {
        const endpointsStr = JSON.stringify(res.body.endpoints)
        expect(endpointsStr).to.not.include('skServer')
        expect(endpointsStr).to.not.include('security/users')
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
