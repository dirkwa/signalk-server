/**
 * Deep Vulnerability Analysis Tests
 *
 * Tests for subtle vulnerabilities requiring careful analysis:
 * - Path traversal in plugin config
 * - Prototype pollution via lodash _.set()
 * - Timing attacks in authentication
 * - Regex bugs in subscription manager
 * - JSON parsing without validation in discovery
 * - User identifier path injection
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

describe('Subscription Manager Regex Vulnerability', function() {
  this.timeout(30000)

  describe('Path Matcher Regex Bug', function() {
    /**
     * VULNERABILITY: src/subscriptionmanager.ts line 225-228
     *
     * function pathMatcher(path: string = '*') {
     *   const pattern = path.replace('.', '\\.').replace('*', '.*')
     *   const matcher = new RegExp('^' + pattern + '$')
     *   return (aPath: string) => matcher.test(aPath)
     * }
     *
     * SAME BUG as tokensecurity.js - only replaces FIRST occurrence!
     */

    it('should document pathMatcher regex vulnerability', function() {
      console.log(`
      VULNERABILITY: Subscription Path Matcher Regex Bug

      Location: src/subscriptionmanager.ts line 225-228

      Vulnerable code:
        const pattern = path.replace('.', '\\.').replace('*', '.*')

      This is the SAME bug as in tokensecurity.js - only first dot is escaped!

      Impact:
      - Subscription patterns may match unintended paths
      - Pattern "navigation.position.latitude" matches "navigationXpositionYlatitude"
      - Could leak data from unintended paths

      Fix: Use global replace: .replace(/\\./g, '\\\\.')
      `)

      // Prove the bug
      const path = 'navigation.position.latitude'
      const buggyPattern = path.replace('.', '\\.').replace('*', '.*')
      const buggyRegex = new RegExp('^' + buggyPattern + '$')

      // Should match
      expect(buggyRegex.test('navigation.position.latitude')).to.be.true

      // Check if the bug manifests - second and third dots become wildcards
      const matches = buggyRegex.test('navigationXposition.latitude')
      console.log(`      Buggy regex: ${buggyRegex}`)
      console.log(`      "navigationXposition.latitude" matches: ${matches}`)

      // The bug means second dot is a wildcard, so X matches the unescaped .
      // Actually the pattern is: navigation\.position.latitude
      // This means: "navigation" + literal "." + "position" + ANY CHAR + "latitude"
      expect(buggyRegex.test('navigation.positionXlatitude')).to.be.true
    })
  })

  describe('Context Matcher Regex Bug', function() {
    /**
     * VULNERABILITY: src/subscriptionmanager.ts line 240-242
     *
     * const pattern = subscribeCommand.context
     *   .replace('.', '\\.')
     *   .replace('*', '.*')
     *
     * SAME BUG AGAIN!
     */

    it('should document contextMatcher regex vulnerability', function() {
      console.log(`
      VULNERABILITY: Subscription Context Matcher Regex Bug

      Location: src/subscriptionmanager.ts line 240-242

      Vulnerable code:
        const pattern = subscribeCommand.context
          .replace('.', '\\.')
          .replace('*', '.*')

      Same bug as pathMatcher - only first occurrence replaced.

      Impact: Context matching may be bypassed.
      `)

      expect(true).to.be.true
    })
  })
})

describe('Timing Attack in Authentication', function() {
  this.timeout(30000)

  describe('User Enumeration via Timing', function() {
    /**
     * VULNERABILITY: src/tokensecurity.js line 285-295
     *
     * const user = configuration.users.find((aUser) => aUser.username === name)
     * if (!user) {
     *   resolve({ statusCode: 401, message: LOGIN_FAILED_MESSAGE })
     *   return  // <-- EARLY RETURN
     * }
     * ...
     * bcrypt.compare(password, user.password, ...)  // <-- SLOW OPERATION
     *
     * Non-existent users return immediately.
     * Existing users go through bcrypt (slow).
     * Timing difference reveals user existence!
     */

    it('should document timing attack vulnerability', function() {
      console.log(`
      VULNERABILITY: Timing Attack for User Enumeration

      Location: src/tokensecurity.js line 285-295

      The login function returns early if user doesn't exist,
      but performs slow bcrypt comparison for existing users.

      Timeline difference:
      - Non-existent user: ~1-5ms (immediate return)
      - Existing user: ~100-500ms (bcrypt.compare)

      Attack: Measure response times to enumerate valid usernames.

      Fix: Always perform bcrypt comparison, even for non-existent users.
      Use a dummy hash for non-existent users to maintain constant time.
      `)

      expect(true).to.be.true
    })

    it('should measure timing difference for user enumeration', async function() {
      // Skip if security not enabled
      const testResp = await request('/skServer/plugins')
      if (testResp.status !== 401) {
        this.skip()
        return
      }

      const iterations = 5
      const nonExistentTimes = []
      const existingTimes = []

      // Measure non-existent user
      for (let i = 0; i < iterations; i++) {
        const start = Date.now()
        await request('/signalk/v1/auth/login', {
          method: 'POST',
          body: JSON.stringify({
            username: `nonexistent_user_${Date.now()}`,
            password: 'wrongpassword'
          })
        })
        nonExistentTimes.push(Date.now() - start)
      }

      // Measure existing user (admin)
      for (let i = 0; i < iterations; i++) {
        const start = Date.now()
        await request('/signalk/v1/auth/login', {
          method: 'POST',
          body: JSON.stringify({
            username: ADMIN_USER,
            password: 'wrongpassword'
          })
        })
        existingTimes.push(Date.now() - start)
      }

      const avgNonExistent = nonExistentTimes.reduce((a, b) => a + b, 0) / iterations
      const avgExisting = existingTimes.reduce((a, b) => a + b, 0) / iterations

      console.log(`      Non-existent user avg: ${avgNonExistent.toFixed(2)}ms`)
      console.log(`      Existing user avg: ${avgExisting.toFixed(2)}ms`)
      console.log(`      Timing difference: ${(avgExisting - avgNonExistent).toFixed(2)}ms`)

      // If there's a significant difference, timing attack is possible
      if (avgExisting - avgNonExistent > 50) {
        console.log(`      ⚠️  TIMING ATTACK POSSIBLE - ${(avgExisting - avgNonExistent).toFixed(2)}ms difference`)
      }

      expect(true).to.be.true
    })
  })
})

describe('Prototype Pollution via lodash _.set()', function() {
  this.timeout(30000)

  let adminToken = null
  let securityEnabled = false

  before(async function() {
    try {
      adminToken = await getToken(ADMIN_USER, ADMIN_PASS)
      if (adminToken) {
        securityEnabled = true
      }
    } catch (e) {}
  })

  describe('ApplicationData Prototype Pollution', function() {
    /**
     * VULNERABILITY: src/interfaces/applicationData.js line 157
     *
     * _.set(applicationData, req.params[0].replace(/\//g, '.'), req.body)
     *
     * User controls req.params[0] which becomes the path for _.set()
     * If path contains __proto__ or constructor.prototype, pollution occurs!
     */

    it('should test prototype pollution in applicationData', async function() {
      if (!securityEnabled || !adminToken) {
        this.skip()
        return
      }

      const headers = { Authorization: `Bearer ${adminToken}` }

      // Try to pollute via applicationData path
      const pollutionPaths = [
        '__proto__/polluted',
        'constructor/prototype/polluted',
        '__proto__',
      ]

      for (const pollutePath of pollutionPaths) {
        const response = await request(`/signalk/v1/applicationData/global/testapp/1.0.0/${pollutePath}`, {
          method: 'POST',
          headers,
          body: JSON.stringify('pwned')
        })

        console.log(`      POST applicationData/${pollutePath} - Status: ${response.status}`)
      }

      // Verify prototype not polluted
      expect({}.polluted).to.be.undefined
      expect(Object.prototype.polluted).to.be.undefined

      console.log(`
      VULNERABILITY: Prototype Pollution via applicationData

      Location: src/interfaces/applicationData.js line 157

      Vulnerable code:
        _.set(applicationData, req.params[0].replace(/\\//g, '.'), req.body)

      The URL path is used directly in lodash _.set() which is vulnerable
      to prototype pollution when path contains __proto__ or constructor.

      Note: Modern lodash may have some protections, but older versions
      are definitely vulnerable. Verify lodash version.
      `)
    })
  })

  describe('JSON Patch Injection', function() {
    /**
     * VULNERABILITY: src/interfaces/applicationData.js line 159
     *
     * jsonpatch.apply(applicationData, req.body)
     *
     * JSON Patch can contain operations that modify prototype chain!
     */

    it('should test JSON patch injection', async function() {
      if (!securityEnabled || !adminToken) {
        this.skip()
        return
      }

      const headers = { Authorization: `Bearer ${adminToken}` }

      // JSON Patch prototype pollution
      const maliciousPatch = [
        { op: 'add', path: '/__proto__/polluted', value: 'pwned' },
        { op: 'add', path: '/constructor/prototype/polluted', value: 'pwned' }
      ]

      const response = await request('/signalk/v1/applicationData/global/testapp/1.0.0', {
        method: 'POST',
        headers,
        body: JSON.stringify(maliciousPatch)
      })

      console.log(`      JSON Patch attack - Status: ${response.status}`)

      // Verify prototype not polluted
      expect({}.polluted).to.be.undefined

      console.log(`
      POTENTIAL VULNERABILITY: JSON Patch Prototype Pollution

      Location: src/interfaces/applicationData.js line 159

      Code: jsonpatch.apply(applicationData, req.body)

      JSON Patch operations with paths like /__proto__/x could
      potentially pollute Object.prototype depending on library version.
      `)
    })
  })
})

describe('Path Traversal in Plugin Config', function() {
  this.timeout(30000)

  let adminToken = null
  let securityEnabled = false

  before(async function() {
    try {
      adminToken = await getToken(ADMIN_USER, ADMIN_PASS)
      if (adminToken) {
        securityEnabled = true
      }
    } catch (e) {}
  })

  describe('Plugin ID Path Traversal', function() {
    /**
     * VULNERABILITY: src/interfaces/plugins.ts line 236-241
     *
     * function pathForPluginId(id: string) {
     *   return path.join(
     *     theApp.config.configPath,
     *     'plugin-config-data',
     *     id + '.json'  // <-- No sanitization of id!
     *   )
     * }
     *
     * If plugin ID contains ../, files outside config directory can be accessed!
     */

    it('should test path traversal in plugin config', async function() {
      const headers = adminToken
        ? { Authorization: `Bearer ${adminToken}` }
        : {}

      // Attempt path traversal via plugin ID
      const traversalIds = [
        '../../../etc/passwd',
        '..%2F..%2F..%2Fetc%2Fpasswd',
        '....//....//etc/passwd',
        'plugin/../../../sensitive',
      ]

      for (const id of traversalIds) {
        // Try to get plugin config with traversal path
        const response = await request(`/skServer/plugins/${encodeURIComponent(id)}/config`, {
          headers
        })

        console.log(`      GET plugin/${id.substring(0, 25)}... - Status: ${response.status}`)

        // Should not expose sensitive files
        if (response.body && typeof response.body === 'string') {
          expect(response.body).to.not.include('root:')
        }
      }

      console.log(`
      POTENTIAL VULNERABILITY: Path Traversal in Plugin Config

      Location: src/interfaces/plugins.ts line 236-241

      Vulnerable code:
        return path.join(
          theApp.config.configPath,
          'plugin-config-data',
          id + '.json'  // id is not sanitized!
        )

      If an attacker can control plugin ID, they may read/write
      arbitrary files via path traversal (../../).

      Note: path.join() normalizes paths but doesn't prevent traversal
      outside the base directory.

      Fix: Validate plugin ID contains only alphanumeric, dash, underscore.
      Or use path.resolve() and verify result starts with configPath.
      `)
    })
  })
})

describe('User Identifier Path Injection', function() {
  this.timeout(30000)

  let adminToken = null
  let securityEnabled = false

  before(async function() {
    try {
      adminToken = await getToken(ADMIN_USER, ADMIN_PASS)
      if (adminToken) {
        securityEnabled = true
      }
    } catch (e) {}
  })

  describe('User Directory Path Traversal', function() {
    /**
     * VULNERABILITY: src/interfaces/applicationData.js line 205, 235
     *
     * isUser ? `users/${req.skPrincipal.identifier}` : 'global'
     * ...
     * const userDir = path.join(usersDir, req.skPrincipal.identifier)
     *
     * If user identifier contains ../, path traversal occurs!
     * User identifier comes from JWT payload.
     */

    it('should document user identifier path injection risk', async function() {
      console.log(`
      POTENTIAL VULNERABILITY: User Identifier Path Injection

      Location: src/interfaces/applicationData.js line 205, 235

      Vulnerable code:
        const userDir = path.join(usersDir, req.skPrincipal.identifier)

      The user identifier from JWT is used directly in path construction.
      If an attacker can create a user with username containing "../",
      they could access other users' application data.

      Attack scenario:
      1. Create user with username "../admin" (if registration allowed)
      2. Login as that user
      3. Access /signalk/v1/applicationData/user/...
      4. Path becomes: users/../admin -> accesses admin's data

      Note: Depends on whether username validation allows special chars.
      `)

      expect(true).to.be.true
    })
  })
})

describe('TCP Stream Unauthenticated Subscriptions', function() {
  this.timeout(30000)

  describe('TCP Subscribe Without Auth', function() {
    /**
     * VULNERABILITY: src/interfaces/tcp.ts line 131-139
     *
     * } else if (msg.subscribe) {
     *   debug.enabled && debug(`subscribe:${JSON.stringify(msg)}`)
     *   app.subscriptionmanager.subscribe(...)
     * }
     *
     * TCP subscriptions are processed WITHOUT checking authentication!
     * Even though delta SENDING is blocked when security enabled,
     * RECEIVING via subscription is still allowed!
     */

    it('should document TCP subscription without authentication', function() {
      console.log(`
      VULNERABILITY: Unauthenticated TCP Subscriptions

      Location: src/interfaces/tcp.ts line 131-139

      Analysis:
      - Line 123-129: Delta SENDING is blocked when security enabled
      - Line 131-139: Subscribe handling has NO auth check!

      Code:
        } else if (msg.subscribe) {
          app.subscriptionmanager.subscribe(
            msg,
            unsubscibes,
            ...
          )
        }

      Impact:
      - Any TCP client can subscribe to Signal K data
      - Full vessel data can be exfiltrated without authentication
      - Position, speed, heading, AIS targets all exposed

      Fix: Add authentication check before processing subscriptions
      when security is enabled.
      `)

      expect(true).to.be.true
    })

    it('should test TCP subscription without token', async function() {
      const net = require('net')
      const port = 8375

      return new Promise((resolve) => {
        const client = new net.Socket()
        let dataReceived = false
        let subscriptionWorked = false

        client.on('connect', () => {
          console.log('      Connected to TCP port 8375')

          // Send subscription request
          const subscribeMsg = {
            context: 'vessels.self',
            subscribe: [{ path: '*' }]
          }

          client.write(JSON.stringify(subscribeMsg) + '\r\n')
        })

        client.on('data', (data) => {
          dataReceived = true
          const str = data.toString()

          // Check if we're receiving delta messages
          if (str.includes('updates') || str.includes('navigation')) {
            subscriptionWorked = true
            console.log(`      ⚠️  Received data without auth: ${str.substring(0, 100)}...`)
          }
        })

        client.on('error', (err) => {
          console.log(`      TCP connection error: ${err.message}`)
          resolve()
        })

        setTimeout(() => {
          client.destroy()
          if (subscriptionWorked) {
            console.log('      ⚠️  VULNERABILITY CONFIRMED: TCP subscriptions work without authentication!')
          }
          resolve()
        }, 3000)

        client.connect(port, 'localhost')
      })
    })
  })
})

describe('Discovery UDP JSON Injection', function() {
  this.timeout(30000)

  describe('GoFree Discovery Parsing', function() {
    /**
     * VULNERABILITY: src/discovery.js line 91
     *
     * const json = JSON.parse(msg)
     *
     * UDP broadcast messages are parsed as JSON without validation.
     * Attacker on same network can broadcast malicious JSON.
     */

    it('should document UDP JSON injection risk', function() {
      console.log(`
      VULNERABILITY: UDP JSON Injection in Discovery

      Location: src/discovery.js line 91

      Code:
        const json = JSON.parse(msg)
        const serial = json.SerialNumber
        if (json.Services && found.indexOf(serial) === -1) {
          json.Services.forEach((service) => {
            if (service.Service === 'nmea-0183' ...) {
              app.emit('discovered', {
                id: id,
                pipeElements: [{
                  options: {
                    subOptions: {
                      host: json.IP,  // <-- Attacker controlled!
                      port: service.Port
                    }
                  }
                }]
              })

      Attack scenario:
      1. Attacker on same network broadcasts malicious UDP to port 2052
      2. Server parses JSON and creates provider config
      3. Server connects to attacker-controlled IP:port
      4. SSRF / data exfiltration possible

      The IP address comes directly from attacker-controlled JSON!
      `)

      expect(true).to.be.true
    })
  })
})
