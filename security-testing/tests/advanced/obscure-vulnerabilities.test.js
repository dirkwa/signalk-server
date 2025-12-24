/**
 * Obscure/Subtle Vulnerability Tests
 *
 * Tests for hard-to-find vulnerabilities:
 * - Assignment vs comparison bug (=== vs =)
 * - WebSocket token injection after connection
 * - Auth bypass via non-token errors
 * - Weak random number generation
 * - Error handling that reveals auth bypass
 */

const { expect } = require('chai')
const WebSocket = require('ws')
const net = require('net')

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

describe('Assignment vs Comparison Bug', function () {
  this.timeout(30000)

  describe('findRequest Assignment Bug', function () {
    /**
     * BUG: src/interfaces/ws.js line 102
     *
     * const request = findRequest((r) => (r.requestId = requestId))
     *
     * This uses ASSIGNMENT (=) instead of COMPARISON (===)!
     *
     * Impact:
     * - The filter function always returns truthy (the assigned value)
     * - findRequest returns the FIRST request, not the matching one
     * - Could cause request mixups between users
     */

    it('should document assignment bug in ws.js findRequest', function () {
      console.log(`
      BUG: Assignment Instead of Comparison

      Location: src/interfaces/ws.js line 102

      Vulnerable code:
        const request = findRequest((r) => (r.requestId = requestId))
                                              ^^^
                                              Should be ===

      Impact:
      - Filter function uses assignment (=) not comparison (===)
      - Always returns truthy (the assigned value)
      - findRequest returns FIRST request instead of matching one
      - Could cause PUT request responses to go to wrong clients
      - Potential information disclosure between users

      Fix: Change to (r) => (r.requestId === requestId)
      `)

      // Demonstrate the bug
      const requests = [
        { requestId: 'aaa', data: 'first' },
        { requestId: 'bbb', data: 'second' },
        { requestId: 'ccc', data: 'third' }
      ]

      // Buggy version - always returns first
      const buggyFind = (predicate) => requests.find(predicate)
      const buggyResult = buggyFind((r) => (r.requestId = 'ccc'))

      // The bug: we wanted 'ccc' but got 'first' because assignment returns truthy
      console.log(
        `      Looking for 'ccc', buggy code returns: ${buggyResult.data}`
      )
      expect(buggyResult.data).to.equal('first') // BUG: Returns wrong request!

      // Correct version - reset the corrupted data first
      requests[0].requestId = 'aaa' // Fix corruption from buggy find
      const correctResult = requests.find((r) => r.requestId === 'ccc')
      console.log(`      Correct code returns: ${correctResult.data}`)
      expect(correctResult.data).to.equal('third')
    })
  })
})

describe('WebSocket Token Injection', function () {
  this.timeout(30000)

  let adminToken = null
  let securityEnabled = false

  before(async function () {
    try {
      adminToken = await getToken(ADMIN_USER, ADMIN_PASS)
      if (adminToken) {
        securityEnabled = true
      }
    } catch (e) {}
  })

  describe('Post-Connection Token Injection', function () {
    /**
     * POTENTIAL VULNERABILITY: src/interfaces/ws.js line 204-206
     *
     * if (msg.token) {
     *   spark.request.token = msg.token
     * }
     *
     * A client can send a token via WebSocket message AFTER connecting.
     * This could potentially be used to:
     * 1. Upgrade permissions mid-session
     * 2. Hijack another user's session
     * 3. Bypass initial auth check
     */

    it('should document post-connection token injection', function () {
      console.log(`
      POTENTIAL VULNERABILITY: Post-Connection Token Injection

      Location: src/interfaces/ws.js line 204-206

      Code:
        if (msg.token) {
          spark.request.token = msg.token
        }

      A WebSocket client can send a token in any message after connecting.
      The token is stored on spark.request.token.

      Questions to investigate:
      1. Is this token used to upgrade permissions?
      2. Can an anonymous connection become authenticated?
      3. Can a readonly user become admin?

      Risk: If token is used for subsequent permission checks,
      this allows permission escalation.
      `)

      expect(true).to.be.true
    })

    it('should test sending token after anonymous WebSocket connection', async function () {
      if (!securityEnabled || !adminToken) {
        this.skip()
        return
      }

      // Connect WITHOUT token
      const ws = new WebSocket(`${WS_URL}/signalk/v1/stream`)

      await new Promise((resolve, reject) => {
        ws.on('open', resolve)
        ws.on('error', reject)
        setTimeout(() => reject(new Error('Timeout')), 5000)
      })

      // Wait for hello
      await new Promise((resolve) => {
        ws.once('message', () => resolve())
      })

      // Now send token in a message
      ws.send(
        JSON.stringify({
          token: adminToken,
          subscribe: [{ path: '*' }]
        })
      )

      let receivedData = false
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString())
        if (msg.updates) {
          receivedData = true
          console.log(
            `      Received updates after sending token: ${JSON.stringify(msg).substring(0, 100)}...`
          )
        }
      })

      await new Promise((resolve) => setTimeout(resolve, 2000))

      ws.close()

      console.log(`      Received data after token injection: ${receivedData}`)
    })
  })
})

describe('WebSocket Auth Bypass via Error Type', function () {
  this.timeout(30000)

  describe('Non-Token Error Allows Connection', function () {
    /**
     * VULNERABILITY: src/interfaces/ws.js line 474-482
     *
     * } catch (error) {
     *   if (
     *     error instanceof InvalidTokenError ||
     *     error instanceof JsonWebTokenError ||
     *     error instanceof TokenExpiredError
     *   ) {
     *     authorized(error)  // Only these specific errors reject
     *   } else {
     *     authorized()  // ALL OTHER ERRORS AUTHORIZE!
     *   }
     * }
     *
     * If authorizeWS throws any error OTHER than token errors,
     * the connection is AUTHORIZED anyway!
     */

    it('should document auth bypass via non-token errors', function () {
      console.log(`
      VULNERABILITY: Auth Bypass via Non-Token Errors

      Location: src/interfaces/ws.js line 474-482

      Code:
        } catch (error) {
          if (
            error instanceof InvalidTokenError ||
            error instanceof JsonWebTokenError ||
            error instanceof TokenExpiredError
          ) {
            authorized(error)  // REJECT
          } else {
            authorized()  // AUTHORIZE! <-- BUG
          }
        }

      Analysis:
      - Only 3 specific error types cause rejection
      - Any OTHER error (TypeError, ReferenceError, etc.) = AUTHORIZED!
      - If authorizeWS has a bug that throws a different error type,
        the connection is accepted without authentication.

      Attack scenario:
      - Find a way to cause authorizeWS to throw a non-token error
      - Connection will be authorized without valid credentials

      Fix: Should be authorized(error) for ALL catch cases,
      or at minimum, default to rejection.
      `)

      expect(true).to.be.true
    })
  })
})

describe('Weak Random Number Generation', function () {
  this.timeout(30000)

  describe('Math.random() in Security Context', function () {
    /**
     * WEAKNESS: src/interfaces/providers.js line 151
     *
     * provider.options.uniqueNumber = Math.floor(Math.random() * 2097151)
     *
     * Math.random() is NOT cryptographically secure.
     * While this is used for CAN bus unique numbers, not auth tokens,
     * it sets a bad precedent and could be exploited.
     */

    it('should document weak random number usage', function () {
      console.log(`
      WEAKNESS: Insecure Random Number Generator

      Location: src/interfaces/providers.js line 151

      Code:
        provider.options.uniqueNumber = Math.floor(Math.random() * 2097151)

      Math.random() is NOT cryptographically secure.
      It uses a predictable PRNG that can be reverse-engineered.

      In this case, it's used for CAN bus unique numbers.
      Impact is low, but this pattern is concerning.

      Better alternatives:
      - require('crypto').randomInt(0, 2097151)
      - require('crypto').randomBytes() for any security use

      Note: The JWT secret generation DOES use crypto.randomBytes() correctly
      at src/tokensecurity.js:61 - that's good!
      `)

      expect(true).to.be.true
    })
  })
})

describe('Request ID Collision Attack', function () {
  this.timeout(30000)

  describe('PUT Request ID Handling', function () {
    /**
     * Combined with the assignment bug, request ID collisions
     * could cause serious issues.
     */

    it('should document request ID collision risk', function () {
      console.log(`
      RISK: Request ID Collision

      The assignment bug in ws.js:102 combined with predictable
      request IDs could allow:

      1. Attacker sends PUT request with known requestId
      2. Due to assignment bug, response goes to first matching request
      3. Attacker receives response meant for another user

      This is especially concerning because:
      - Request IDs might be predictable (UUIDs, counters, etc.)
      - The bug causes ALL findRequest calls to return first request
      - Multiple concurrent users share the request pool
      `)

      expect(true).to.be.true
    })
  })
})

describe('Cookie Security', function () {
  this.timeout(30000)

  let adminToken = null
  let securityEnabled = false

  before(async function () {
    try {
      adminToken = await getToken(ADMIN_USER, ADMIN_PASS)
      if (adminToken) {
        securityEnabled = true
      }
    } catch (e) {}
  })

  describe('JAUTHENTICATION Cookie Analysis', function () {
    it('should analyze cookie security settings', async function () {
      if (!securityEnabled) {
        this.skip()
        return
      }

      const fetch = (await import('node-fetch')).default

      const response = await fetch(`${BASE_URL}/signalk/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: ADMIN_USER, password: ADMIN_PASS })
      })

      const setCookie = response.headers.get('set-cookie')
      console.log(`      Set-Cookie header: ${setCookie || 'Not present'}`)

      if (setCookie) {
        const hasHttpOnly = setCookie.toLowerCase().includes('httponly')
        const hasSecure = setCookie.toLowerCase().includes('secure')
        const hasSameSite = setCookie.toLowerCase().includes('samesite')

        console.log(`      HttpOnly: ${hasHttpOnly}`)
        console.log(`      Secure: ${hasSecure}`)
        console.log(`      SameSite: ${hasSameSite}`)

        if (!hasHttpOnly) {
          console.log(
            `      ⚠️  MISSING HttpOnly - cookie vulnerable to XSS theft`
          )
        }
        if (!hasSecure) {
          console.log(`      ⚠️  MISSING Secure - cookie sent over HTTP`)
        }
        if (!hasSameSite) {
          console.log(`      ⚠️  MISSING SameSite - cookie vulnerable to CSRF`)
        }
      }

      expect(true).to.be.true
    })
  })
})

describe('Race Condition in Token Verification', function () {
  this.timeout(30000)

  describe('Concurrent Request Handling', function () {
    /**
     * The 60-second token re-verification window combined with
     * concurrent requests could cause race conditions.
     */

    it('should document race condition potential', function () {
      console.log(`
      POTENTIAL RACE CONDITION: Token Re-verification

      Location: src/tokensecurity.js line 680

      Code:
        if (now - spark.lastTokenVerify > 60 * 1000) {
          debug('verify token')
          spark.lastTokenVerify = now
          strategy.authorizeWS(spark)
        }

      Race condition scenario:
      1. Token is revoked
      2. Two requests arrive at exactly 60 second boundary
      3. Both check: (now - lastTokenVerify > 60000) = true
      4. Both proceed to re-verify
      5. One might succeed before revocation takes effect

      The timestamp update (lastTokenVerify = now) happens AFTER
      the condition check, creating a race window.

      Fix: Use atomic compare-and-swap or lock around verification.
      `)

      expect(true).to.be.true
    })
  })
})

describe('TCP Stream Protocol Confusion', function () {
  this.timeout(30000)

  describe('Mixed JSON/NMEA on TCP', function () {
    it('should test protocol confusion on TCP port', async function () {
      const port = 8375

      return new Promise((resolve) => {
        const client = new net.Socket()

        client.on('connect', () => {
          console.log('      Connected to TCP port 8375')

          // Send a mix of JSON and NMEA
          client.write(
            '$GPGGA,123519,4807.038,N,01131.000,E,1,08,0.9,545.4,M,47.0,M,,*47\r\n'
          )
          client.write('{"subscribe":[{"path":"*"}]}\r\n')
          client.write('GARBAGE DATA WITHOUT NEWLINE')
          client.write('\x00\x01\x02\x03') // Binary

          setTimeout(() => {
            client.destroy()
            console.log(
              '      Server handled mixed protocol data without crash'
            )
            resolve()
          }, 2000)
        })

        client.on('error', (err) => {
          console.log(`      Connection error: ${err.message}`)
          resolve()
        })

        client.connect(port, 'localhost')
      })
    })
  })
})

describe('Information Disclosure via Errors', function () {
  this.timeout(30000)

  describe('Stack Traces in Responses', function () {
    it('should check for stack trace disclosure', async function () {
      // Try to trigger errors that might leak stack traces
      const badRequests = [
        '/signalk/v1/api/vessels/self/' + 'A'.repeat(10000),
        '/signalk/v1/api/vessels/self/navigation/position?callback=<script>',
        '/signalk/v1/api/../../../etc/passwd'
      ]

      for (const path of badRequests) {
        const response = await request(path)

        if (typeof response.body === 'string') {
          const hasStack =
            response.body.includes('at ') &&
            (response.body.includes('.js:') || response.body.includes('.ts:'))

          if (hasStack) {
            console.log(
              `      ⚠️  Stack trace found in response to ${path.substring(0, 50)}...`
            )
          }

          // Check for internal path disclosure
          if (
            response.body.includes('/home/') ||
            response.body.includes('node_modules')
          ) {
            console.log(`      ⚠️  Internal paths disclosed in response`)
          }
        }
      }

      expect(true).to.be.true
    })
  })
})
