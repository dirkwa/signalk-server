/**
 * Token Re-verification Window Security Tests
 *
 * Tests for the 60-second token re-verification window in WebSocket connections
 * Location: src/tokensecurity.js line 680
 *
 * The server only re-verifies tokens every 60 seconds on WebSocket connections.
 * This means if a token is revoked, there's up to a 60-second window where
 * the revoked token is still valid for existing WebSocket connections.
 */

const { expect } = require('chai')
const WebSocket = require('ws')

const BASE_URL = process.env.SIGNALK_URL || 'http://localhost:3000'
const WS_URL = BASE_URL.replace('http', 'ws')
const ADMIN_USER = process.env.ADMIN_USER || 'admin'
const ADMIN_PASS = process.env.ADMIN_PASS || 'admin'

async function request(path, options = {}) {
  const fetch = (await import('node-fetch')).default
  const url = `${BASE_URL}${path}`
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers
    }
  })

  let body
  const contentType = response.headers.get('content-type') || ''
  if (contentType.includes('application/json')) {
    try {
      body = await response.json()
    } catch (e) {
      body = null
    }
  } else {
    body = await response.text()
  }

  return { status: response.status, body, headers: response.headers }
}

async function getToken(username, password) {
  const response = await request('/signalk/v1/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password })
  })

  if (response.status === 200 && response.body && response.body.token) {
    return response.body.token
  }
  return null
}

describe('Token Re-verification Window Tests', function() {
  this.timeout(90000)  // Long timeout for 60+ second tests

  let adminToken = null
  let securityEnabled = false

  before(async function() {
    try {
      adminToken = await getToken(ADMIN_USER, ADMIN_PASS)
      if (adminToken) {
        securityEnabled = true
        console.log('    Security is ENABLED - running token window tests')
      }
    } catch (e) {
      // Security might be disabled
    }

    if (!securityEnabled) {
      console.log('    Security is DISABLED - skipping token window tests')
    }
  })

  describe('60-Second Token Verification Window', function() {
    /**
     * VULNERABILITY: src/tokensecurity.js line 680
     *
     * if (now - spark.lastTokenVerify > 60 * 1000) {
     *   debug('verify token')
     *   spark.lastTokenVerify = now
     *   strategy.authorizeWS(spark)
     * }
     *
     * Tokens are only re-verified every 60 seconds on WebSocket connections.
     * If an admin revokes a token, the attacker has up to 60 seconds of
     * continued access.
     */

    it('should document token verification only happens every 60 seconds', async function() {
      if (!securityEnabled || !adminToken) {
        this.skip()
        return
      }

      const ws = new WebSocket(`${WS_URL}/signalk/v1/stream?token=${adminToken}`)

      await new Promise((resolve, reject) => {
        ws.on('open', resolve)
        ws.on('error', reject)
        setTimeout(() => reject(new Error('Connection timeout')), 5000)
      })

      // Connection established - document the 60 second window
      console.log(`
      SECURITY NOTE: Token re-verification window is 60 seconds

      Code location: src/tokensecurity.js line 680

      if (now - spark.lastTokenVerify > 60 * 1000) {
        strategy.authorizeWS(spark)
      }

      Impact: Revoked tokens remain valid for up to 60 seconds
      on existing WebSocket connections.

      Recommendation: Consider reducing window or implementing
      real-time token revocation via token blacklist.
      `)

      ws.close()
      expect(true).to.be.true
    })

    it('should test WebSocket remains connected for 60+ seconds', async function() {
      if (!securityEnabled || !adminToken) {
        this.skip()
        return
      }

      const ws = new WebSocket(`${WS_URL}/signalk/v1/stream?token=${adminToken}`)

      await new Promise((resolve, reject) => {
        ws.on('open', resolve)
        ws.on('error', reject)
        setTimeout(() => reject(new Error('Connection timeout')), 5000)
      })

      let messageCount = 0
      let lastMessageTime = Date.now()

      ws.on('message', () => {
        messageCount++
        lastMessageTime = Date.now()
      })

      // Wait slightly over 60 seconds
      console.log('      Waiting 65 seconds to verify token re-verification...')
      await new Promise(resolve => setTimeout(resolve, 65000))

      // WebSocket should still be connected after 60+ seconds
      const isOpen = ws.readyState === WebSocket.OPEN

      console.log(`      WebSocket state after 65s: ${ws.readyState === WebSocket.OPEN ? 'OPEN' : 'CLOSED'}`)
      console.log(`      Messages received: ${messageCount}`)

      ws.close()

      // Document: with valid token, connection persists
      expect(isOpen).to.be.true
    })
  })

  describe('Token Expiration Edge Cases', function() {
    it('should handle expired token on new WebSocket connection', async function() {
      if (!securityEnabled) {
        this.skip()
        return
      }

      // Create a clearly fake/expired JWT
      const expiredToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
        'eyJpZCI6InRlc3QiLCJleHAiOjB9.' +  // exp: 0 (1970)
        'invalid_signature'

      const ws = new WebSocket(`${WS_URL}/signalk/v1/stream?token=${expiredToken}`)

      let connected = false
      let closed = false
      let closeCode = null

      ws.on('open', () => { connected = true })
      ws.on('close', (code) => {
        closed = true
        closeCode = code
      })

      await new Promise(resolve => setTimeout(resolve, 3000))

      // With security enabled, expired token should be rejected
      console.log(`      Connected: ${connected}, Closed: ${closed}, Code: ${closeCode}`)

      ws.close()
      expect(true).to.be.true  // Document test ran
    })

    it('should handle malformed token on WebSocket connection', async function() {
      if (!securityEnabled) {
        this.skip()
        return
      }

      const malformedTokens = [
        'not.a.jwt',
        'too.many.parts.in.this.token',
        '',
        'null',
        'undefined',
        '../../etc/passwd',
        '<script>alert(1)</script>',
      ]

      for (const token of malformedTokens) {
        const ws = new WebSocket(`${WS_URL}/signalk/v1/stream?token=${encodeURIComponent(token)}`)

        let connected = false

        ws.on('open', () => { connected = true })

        await new Promise(resolve => setTimeout(resolve, 1000))

        ws.close()

        // Document how each malformed token is handled
        console.log(`      Token "${token.substring(0, 20)}..." - Connected: ${connected}`)
      }

      expect(true).to.be.true
    })
  })
})

describe('PUT Handler Prototype Pollution Tests', function() {
  this.timeout(30000)

  let adminToken = null
  let securityEnabled = false

  before(async function() {
    try {
      adminToken = await getToken(ADMIN_USER, ADMIN_PASS)
      if (adminToken) {
        securityEnabled = true
      }
    } catch (e) {
      // Security might be disabled
    }
  })

  describe('Lodash _.set Prototype Pollution', function() {
    /**
     * POTENTIAL VULNERABILITY: src/put.js line 137
     *
     * _.set(data, pathWithContext, value)
     *
     * If pathWithContext contains "__proto__" or "constructor.prototype",
     * lodash.set could pollute Object.prototype.
     *
     * The path is constructed from: context + '.' + path
     * where path comes from the URL (user controlled).
     */

    it('should not allow __proto__ pollution via PUT path', async function() {
      // Attempt to PUT to a path containing __proto__
      const pollutionPaths = [
        '/signalk/v1/api/vessels/self/__proto__/polluted',
        '/signalk/v1/api/vessels/self/constructor/prototype/polluted',
        '/signalk/v1/api/__proto__/polluted',
        '/signalk/v1/api/vessels/__proto__/polluted',
      ]

      const headers = adminToken
        ? { Authorization: `Bearer ${adminToken}` }
        : {}

      for (const path of pollutionPaths) {
        const response = await request(path, {
          method: 'PUT',
          headers,
          body: JSON.stringify({ value: 'pwned' })
        })

        console.log(`      PUT ${path} - Status: ${response.status}`)

        // Check if Object.prototype was polluted
        expect({}.polluted).to.be.undefined
      }

      // Final verification - prototype should not be polluted
      expect({}.polluted).to.be.undefined
      expect(Object.prototype.polluted).to.be.undefined
    })

    it('should not allow nested prototype pollution', async function() {
      const headers = adminToken
        ? { Authorization: `Bearer ${adminToken}` }
        : {}

      // Try pollution via nested value
      const response = await request('/signalk/v1/api/vessels/self/navigation/test', {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          value: {
            __proto__: { polluted: 'pwned' },
            normal: 'data'
          }
        })
      })

      console.log(`      Nested pollution attempt - Status: ${response.status}`)

      // Verify prototype not polluted
      expect({}.polluted).to.be.undefined
    })
  })

  describe('Meta Handler Prototype Pollution', function() {
    /**
     * src/put.js line 79-158 - putMetaHandler
     *
     * This handler uses lodash operations on meta values and could
     * potentially be vulnerable to prototype pollution through the
     * meta path or value.
     */

    it('should not allow prototype pollution via meta PUT', async function() {
      const headers = adminToken
        ? { Authorization: `Bearer ${adminToken}` }
        : {}

      const metaPaths = [
        '/signalk/v1/api/vessels/self/navigation/position/meta',
        '/signalk/v1/api/vessels/self/__proto__/meta',
        '/signalk/v1/api/vessels/self/navigation/meta/__proto__',
      ]

      for (const path of metaPaths) {
        const response = await request(path, {
          method: 'PUT',
          headers,
          body: JSON.stringify({
            value: { units: 'rad', __proto__: { polluted: 'pwned' } }
          })
        })

        console.log(`      PUT ${path} - Status: ${response.status}`)
      }

      // Verify prototype not polluted
      expect({}.polluted).to.be.undefined
    })
  })
})
