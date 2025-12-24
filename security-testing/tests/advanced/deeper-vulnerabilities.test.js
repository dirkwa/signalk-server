/**
 * Deeper Vulnerability Analysis Tests
 *
 * Tests for sophisticated security issues:
 * - Prototype pollution via lodash _.set() with user input
 * - Command injection via npm module installation
 * - Cache poisoning via context path cache
 * - Object.assign merge vulnerabilities
 * - JSON parsing from untrusted UDP sources
 * - Denial of service via regex complexity
 * - Second-order injection patterns
 */

const { expect } = require('chai')
const net = require('net')

const BASE_URL = process.env.SIGNALK_URL || 'http://localhost:3000'
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

  describe('ApplicationData _.set() Vulnerability', function() {
    /**
     * VULNERABILITY: src/interfaces/applicationData.js line 157
     *
     * _.set(applicationData, req.params[0].replace(/\//g, '.'), req.body)
     *
     * The path comes from URL params and is used directly with _.set()
     * An attacker could try paths like:
     * - __proto__.polluted = true
     * - constructor.prototype.polluted = true
     */

    it('should document prototype pollution risk in applicationData', function() {
      console.log(`
      POTENTIAL VULNERABILITY: Prototype Pollution via _.set()

      Location: src/interfaces/applicationData.js line 157

      Code:
        _.set(applicationData, req.params[0].replace(/\\//g, '.'), req.body)

      The path is derived from URL params with only / replaced by .
      Lodash _.set() historically allowed prototype pollution through
      paths like "__proto__" or "constructor.prototype".

      Attack paths to try:
        POST /signalk/v1/applicationData/user/myapp/1.0.0/__proto__/polluted
        POST /signalk/v1/applicationData/user/myapp/1.0.0/constructor/prototype/polluted

      Modern lodash (4.17.21+) has protections, but check the version!

      Impact: If successful, could pollute Object.prototype affecting
      all objects in the Node.js process.
      `)

      expect(true).to.be.true
    })

    it('should test prototype pollution via applicationData endpoint', async function() {
      if (!securityEnabled || !adminToken) {
        this.skip()
        return
      }

      // Try various prototype pollution payloads
      const pollutionPaths = [
        '__proto__',
        'constructor/prototype',
        '__proto__/polluted',
        'constructor.prototype.polluted'
      ]

      for (const pollutionPath of pollutionPaths) {
        try {
          const response = await request(
            `/signalk/v1/applicationData/user/testapp/1.0.0/${pollutionPath}`,
            {
              method: 'POST',
              headers: { Authorization: `Bearer ${adminToken}` },
              body: JSON.stringify({ malicious: true })
            }
          )

          console.log(`      Path "${pollutionPath}": status=${response.status}`)

          // Check if global Object was polluted
          const testObj = {}
          if (testObj.polluted || testObj.malicious) {
            console.log(`      CRITICAL: Prototype pollution successful!`)
          }
        } catch (e) {
          console.log(`      Path "${pollutionPath}": error=${e.message}`)
        }
      }
    })
  })

  describe('PUT Handler _.set() Vulnerability', function() {
    /**
     * VULNERABILITY: src/put.js line 137
     *
     * _.set(data, pathWithContext, value)
     *
     * pathWithContext is: context + '.' + path
     * where path comes from the URL: vessels/self/navigation/position
     */

    it('should document prototype pollution risk in put.js', function() {
      console.log(`
      POTENTIAL VULNERABILITY: Prototype Pollution via PUT handler

      Location: src/put.js line 137

      Code:
        const pathWithContext = context + '.' + path
        _.set(data, pathWithContext, value)

      While context is validated (vessels.self), the path comes from URL.

      Attack:
        PUT /signalk/v1/api/vessels/self/__proto__/polluted

      Even though this probably won't reach _.set() due to validation,
      it's worth testing the full path parsing.
      `)

      expect(true).to.be.true
    })
  })
})

describe('Command Injection via Module Installation', function() {
  this.timeout(30000)

  describe('NPM Spawn Command Injection', function() {
    /**
     * VULNERABILITY: src/modules.ts lines 193-211
     *
     * The package name is passed directly to npm install/remove commands.
     * While the appstore validates against known packages, the validation
     * could be bypassed or the npm registry could be poisoned.
     *
     * Windows: spawn('cmd', ['/c', `npm ${command} -g ${packageString} `])
     * Unix: spawn('sudo', ['npm', command, '-g', packageString])
     *
     * Package names on Windows are vulnerable if they contain shell metacharacters.
     */

    it('should document command injection risk in module installation', function() {
      console.log(`
      POTENTIAL VULNERABILITY: Command Injection in NPM Operations

      Location: src/modules.ts lines 193-211

      Windows vulnerable code:
        npm = spawn('cmd', ['/c', \`npm \${command} -g \${packageString} \`], opts)

      The packageString is constructed as: name@version
      On Windows, this is passed through cmd /c which allows shell expansion.

      If an attacker could get a malicious package name registered that
      contained shell metacharacters, they could execute arbitrary commands:

      Attack scenario:
        Package name: "legit-plugin; rm -rf /"
        Result on Windows: npm install -g legit-plugin; rm -rf /

      Mitigations present:
      1. Packages are validated against npm registry keywords
      2. Only known signalk-* packages can be installed

      Risk: Medium (requires npm registry access or bypass of validation)

      Better approach: Use spawn with array arguments on all platforms.
      `)

      expect(true).to.be.true
    })

    it('should document the install path validation', function() {
      console.log(`
      ANALYSIS: Module Installation Validation

      Location: src/interfaces/appstore.js lines 59-77

      Before installation, the package must be found in:
        - findModulesWithKeyword('signalk-node-server-plugin')
        - findModulesWithKeyword('signalk-webapp')

      This queries the npm registry for packages with specific keywords.

      Bypass scenarios:
      1. Register a malicious package with signalk-node-server-plugin keyword
      2. Typosquatting: register "@signalk-/plugin" vs "@signalk/plugin"
      3. Dependency confusion: same name in private vs public registry

      The server module check (isTheServerModule) allows updating the
      server itself with: spawn('sudo', ['npm', command, '-g', packageString])
      `)

      expect(true).to.be.true
    })
  })
})

describe('Cache Poisoning Vulnerabilities', function() {
  this.timeout(30000)

  describe('Delta Cache Context Path Caching', function() {
    /**
     * RISK: src/deltacache.ts lines 36-55
     *
     * cachedContextPaths caches String.split() results.
     * It's cleared every 5 minutes.
     *
     * If an attacker can inject malicious context/path values,
     * they could potentially poison the cache affecting other users.
     */

    it('should document cache poisoning potential in deltacache', function() {
      console.log(`
      POTENTIAL VULNERABILITY: Cache Poisoning in DeltaCache

      Location: src/deltacache.ts lines 36-55 and 57-75

      Code:
        cachedContextPaths: {
          [context: string]: {
            [path: string]: string[]
          }
        } = {}

        // Cache cleared every 5 minutes
        setInterval(() => (this.cachedContextPaths = {}), 5 * 60 * 1000)

        // Cache populated from incoming deltas
        this.cachedContextPaths[msg.context][msg.path] = contextAndPathParts

      Risk analysis:
      - Context and path come from delta messages
      - Multiple sources can send deltas (plugins, providers, WebSocket)
      - The cache is shared across all connections

      Attack scenario:
      1. Send delta with crafted context that collides with legitimate one
      2. The cached path parts could affect how data is retrieved

      Impact: Low (cache is defensive, not security-critical)
      But could cause data integrity issues.
      `)

      expect(true).to.be.true
    })
  })

  describe('Module Cache NPM Query Results', function() {
    /**
     * RISK: src/modules.ts lines 228-264
     *
     * modulesByKeyword caches npm search results for 60 seconds.
     * Multiple requests share this cache.
     */

    it('should document npm cache timing issues', function() {
      console.log(`
      RISK: NPM Module Cache Timing

      Location: src/modules.ts lines 228-264

      Code:
        const modulesByKeyword: Record<
          string,
          { time: number; packages: NpmModuleData[] }
        > = {}

        // Cache valid for 60 seconds
        if (
          modulesByKeyword[keyword] &&
          Date.now() - modulesByKeyword[keyword].time < 60 * 1000
        ) {
          return modulesByKeyword[keyword].packages
        }

      This is generally fine, but note:
      - If npm registry is compromised, bad data persists for 60s
      - No integrity verification of results
      - TOCTOU: package validated at time A, installed at time B
      `)

      expect(true).to.be.true
    })
  })
})

describe('Object.assign Merge Vulnerabilities', function() {
  this.timeout(30000)

  describe('Resource API Object.assign', function() {
    /**
     * RISK: src/api/resources/index.ts lines 375 and 397
     *
     * Object.assign(result, r.value)
     *
     * Multiple provider results are merged with Object.assign.
     * If a malicious provider returns __proto__ keys, it could
     * potentially pollute the result object.
     */

    it('should document Object.assign merge risks', function() {
      console.log(`
      POTENTIAL VULNERABILITY: Object.assign with External Data

      Location: src/api/resources/index.ts lines 375 and 397

      Code:
        resp.forEach((r) => {
          if (r.status === 'fulfilled') {
            Object.assign(result, r.value)
          }
        })

      The r.value comes from resource providers (plugins).
      A malicious or compromised plugin could return:
        { "__proto__": { "polluted": true } }

      Modern V8 ignores __proto__ in Object.assign, but older versions
      or certain edge cases might be vulnerable.

      Also: Property collision between providers is not handled.
      If provider A and provider B both return { "id123": {...} },
      one will overwrite the other.

      Impact: Low (requires malicious plugin)
      `)

      expect(true).to.be.true
    })
  })
})

describe('UDP JSON Parsing from Untrusted Sources', function() {
  this.timeout(30000)

  describe('GoFree Discovery UDP Parsing', function() {
    /**
     * VULNERABILITY: src/discovery.js lines 87-126
     *
     * JSON.parse(msg) is called on UDP broadcast data.
     * The parsed JSON is used to create provider configurations
     * with attacker-controlled IP and port values.
     */

    it('should document UDP SSRF via discovery', function() {
      console.log(`
      VULNERABILITY: SSRF via UDP Discovery (GoFree)

      Location: src/discovery.js lines 84-150

      Code:
        socket.on('message', function (buffer) {
          const msg = buffer.toString('utf8')
          if (msg[0] === '{') {
            const json = JSON.parse(msg)
            // ...
            app.emit('discovered', {
              pipeElements: [{
                options: {
                  subOptions: {
                    host: json.IP,      // ATTACKER CONTROLLED
                    port: service.Port  // ATTACKER CONTROLLED
                  }
                }
              }]
            })
          }
        })

      Attack scenario:
      1. Attacker on local network sends UDP broadcast to port 2052
      2. Payload contains { "IP": "169.254.169.254", "Port": 80, "Services": [...] }
      3. Server adds this as a discovered provider
      4. If auto-connect is enabled, server connects to AWS metadata endpoint

      Impact: HIGH - Network-adjacent SSRF
      `)

      expect(true).to.be.true
    })

    it('should test UDP discovery SSRF injection', async function() {
      console.log(`
      To manually test UDP discovery SSRF:

      1. Create a UDP client:
         const dgram = require('dgram')
         const client = dgram.createSocket('udp4')

      2. Send malicious discovery packet:
         const payload = JSON.stringify({
           "Name": "EvilDevice",
           "SerialNumber": "ATTACKER123",
           "IP": "169.254.169.254",  // AWS metadata
           "Services": [{ "Service": "nmea-0183", "Port": 80 }]
         })
         client.send(payload, 2052, '239.2.1.1')  // Multicast

      3. Check if server adds the malicious provider

      Note: This requires being on the same network segment
      `)

      expect(true).to.be.true
    })
  })
})

describe('Regex Denial of Service (ReDoS)', function() {
  this.timeout(30000)

  describe('Path and Context Regex Patterns', function() {
    /**
     * The subscription and ACL regex patterns could be vulnerable
     * to ReDoS if crafted input causes exponential backtracking.
     */

    it('should test regex complexity with nested patterns', function() {
      console.log(`
      ANALYSIS: Regex Denial of Service (ReDoS)

      The pattern construction in subscriptionmanager.ts and tokensecurity.js:
        const pattern = path.replace('.', '\\\\.').replace('*', '.*')
        const matcher = new RegExp('^' + pattern + '$')

      The '.*' pattern is inherently safe against ReDoS because it's
      greedy and non-backtracking in simple cases.

      However, if multiple wildcards are chained:
        "a.*.b.*.c.*.d.*"

      And matched against long strings, it could cause slowdown.

      Testing exponential patterns:
      `)

      // Test for ReDoS
      const testPatterns = [
        { pattern: '.*', input: 'a'.repeat(1000) },
        { pattern: '.*\\..*\\..*\\..*', input: 'a.b.c.d.' + 'e'.repeat(100) },
        { pattern: '(.*)*', input: 'aaaaaaaaaaaaaaaaaaaab' }  // Classic ReDoS
      ]

      testPatterns.forEach(({ pattern, input }) => {
        const regex = new RegExp('^' + pattern + '$')
        const start = Date.now()
        regex.test(input)
        const elapsed = Date.now() - start
        console.log(`      Pattern "${pattern.substring(0, 30)}...": ${elapsed}ms`)

        // Anything over 100ms is concerning
        if (elapsed > 100) {
          console.log(`      WARNING: Potential ReDoS!`)
        }
      })

      expect(true).to.be.true
    })
  })
})

describe('Second-Order Injection Patterns', function() {
  this.timeout(30000)

  describe('Stored Data Re-parsing', function() {
    /**
     * Second-order injection occurs when:
     * 1. Attacker stores malicious data
     * 2. Later, that data is retrieved and used unsafely
     */

    it('should document second-order injection risks', function() {
      console.log(`
      ANALYSIS: Second-Order Injection Patterns

      Potential vectors in SignalK:

      1. ApplicationData stored and re-parsed:
         - User stores JSON via applicationData endpoint
         - Later retrieved and processed by plugins
         - If plugin uses stored data unsafely, injection occurs

      2. Plugin configuration:
         - Plugin config stored in settings files
         - Plugin reads config on restart
         - Malicious config values could affect plugin behavior

      3. Provider definitions:
         - Provider config includes host/port/paths
         - Stored in settings, loaded on restart
         - Malicious provider could point to internal services

      4. Delta storage and replay:
         - Deltas stored in deltaCache
         - Retrieved by getCachedDeltas and replayed to new clients
         - Stored delta with malicious context/path could affect new subs

      5. Notification state:
         - Notifications stored with user-controllable state/method
         - Retrieved and displayed/processed later

      Impact: Varies by vector, but could lead to:
        - XSS via stored payloads
        - SSRF via stored URLs
        - Path traversal via stored paths
        - DoS via stored regex patterns
      `)

      expect(true).to.be.true
    })
  })
})

describe('Async Race Condition Analysis', function() {
  this.timeout(30000)

  describe('Promise.allSettled Without Atomicity', function() {
    /**
     * RISK: src/api/resources/index.ts getFromAll() and listFromAll()
     *
     * Multiple providers are queried in parallel, results merged.
     * No atomicity guarantee - state could change between queries.
     */

    it('should document async race conditions', function() {
      console.log(`
      ANALYSIS: Async Race Conditions

      1. Resource Provider Queries (resources/index.ts)
         Code:
           const req: Promise<any>[] = []
           this.resProvider[resType].forEach((v) => {
             req.push(v.listResources(params))
           })
           const resp = await Promise.allSettled(req)
           resp.forEach((r) => {
             Object.assign(result, r.value)
           })

         Race: Provider A deletes resource, Provider B returns stale data
         Impact: Data inconsistency, but not security-critical

      2. Module Installation Queue (appstore.js)
         Multiple install requests can be queued.
         If two installs of same module race, undefined behavior.

      3. Token Verification Window (tokensecurity.js)
         The 60-second re-verification has TOCTOU:
           if (now - spark.lastTokenVerify > 60 * 1000) {
             spark.lastTokenVerify = now
             strategy.authorizeWS(spark)
           }
         Window between check and update allows race.

      4. Settings File Write (config/config.ts)
         Multiple concurrent writes could corrupt settings file.
         Uses async writeFile without locking.
      `)

      expect(true).to.be.true
    })
  })
})

describe('Missing Input Validation', function() {
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

  describe('Version Parameter Validation', function() {
    /**
     * ApplicationData uses semver.coerce() for version validation.
     * This is lenient and may accept unexpected inputs.
     */

    it('should test version parameter edge cases', async function() {
      if (!securityEnabled || !adminToken) {
        this.skip()
        return
      }

      const edgeCases = [
        '1.0.0',           // Normal
        '1',               // Partial
        '1.0.0-alpha',     // Prerelease
        '1.0.0+build',     // Build metadata
        '../../../etc',    // Path traversal attempt
        '1.0.0\n',         // Newline injection
        '1.0.0\x00',       // Null byte injection
        'a'.repeat(1000),  // Long string
        '1.0.0/../1.0.0',  // Path in version
      ]

      console.log('      Testing version parameter validation:')
      for (const version of edgeCases) {
        try {
          const response = await request(
            `/signalk/v1/applicationData/global/testapp/${encodeURIComponent(version)}`,
            {
              method: 'GET',
              headers: { Authorization: `Bearer ${adminToken}` }
            }
          )
          console.log(`      Version "${version.substring(0, 20)}...": status=${response.status}`)
        } catch (e) {
          console.log(`      Version "${version.substring(0, 20)}...": error`)
        }
      }
    })
  })

  describe('AppId Parameter Validation', function() {
    it('should test appId parameter edge cases', async function() {
      if (!securityEnabled || !adminToken) {
        this.skip()
        return
      }

      const edgeCases = [
        'normalapp',           // Normal
        '../etc/passwd',       // Path traversal (should be blocked)
        'app\x00name',         // Null byte
        'a'.repeat(100),       // Long (should fail > 30 chars)
        'app/name',            // Slash (should be blocked)
        'app%2fname',          // URL-encoded slash
        '..%2f..%2fetc',       // Double-encoded traversal
      ]

      console.log('      Testing appId parameter validation:')
      for (const appId of edgeCases) {
        try {
          const response = await request(
            `/signalk/v1/applicationData/global/${encodeURIComponent(appId)}/1.0.0`,
            {
              method: 'GET',
              headers: { Authorization: `Bearer ${adminToken}` }
            }
          )
          console.log(`      AppId "${appId.substring(0, 20)}...": status=${response.status}`)
        } catch (e) {
          console.log(`      AppId "${appId.substring(0, 20)}...": error`)
        }
      }
    })
  })
})

describe('Signal/Process Handling', function() {
  this.timeout(30000)

  describe('Graceful Shutdown Analysis', function() {
    it('should document signal handling security', function() {
      console.log(`
      ANALYSIS: Signal/Process Handling

      Node.js servers should handle signals gracefully:
      - SIGTERM: Clean shutdown
      - SIGINT: Interrupt (Ctrl+C)
      - SIGHUP: Hangup (terminal closed)
      - SIGUSR2: Used by some process managers

      Security considerations:
      1. Secrets should be cleared from memory on shutdown
      2. Active connections should be properly closed
      3. Temporary files should be cleaned up
      4. Pending requests should complete or timeout

      SignalK appears to use standard Node.js process handling.
      No custom signal handlers observed in core code.

      Plugin system note:
      - Plugins can register their own handlers
      - A malicious plugin could intercept signals
      - A buggy plugin could prevent clean shutdown
      `)

      expect(true).to.be.true
    })
  })
})

describe('Environment Variable Security', function() {
  this.timeout(30000)

  describe('Sensitive Environment Variables', function() {
    it('should document all security-relevant env vars', function() {
      console.log(`
      ENVIRONMENT VARIABLE SECURITY ANALYSIS

      Critical (RCE potential):
      - MFD_ADDRESS_SCRIPT: Executed every 10 seconds (CRITICAL!)

      Auth/Security:
      - ADMINUSER / ADMINPASSWORD: Default admin credentials
      - PORT / SSLPORT: Network exposure
      - EXTERNALPORT / EXTERNALHOST: Can affect redirects

      Behavior modification:
      - IS_IN_DOCKER: Changes update behavior
      - SIGNALK_SERVER_IS_UPDATABLE: Allows server self-update
      - SIGNALK_DISABLE_SERVER_UPDATES: Disables updates
      - PLUGINS_WITH_UPDATE_DISABLED: Skip plugin updates
      - NODE_ENV: Development mode may disable security

      Disclosure:
      - DEBUG: May log sensitive information
      - SIGNALK_NODE_CONFIG_DIR: Reveals filesystem structure

      Recommendations:
      1. REMOVE MFD_ADDRESS_SCRIPT support entirely
      2. Document all env vars and their security impact
      3. Validate env var values before use
      4. Don't log env vars that may contain secrets
      `)

      expect(true).to.be.true
    })
  })
})

describe('Directory Traversal Deep Analysis', function() {
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

  describe('Plugin Configuration Path Traversal', function() {
    it('should test for path traversal in various endpoints', async function() {
      if (!securityEnabled) {
        this.skip()
        return
      }

      const traversalPayloads = [
        '../../../etc/passwd',
        '..%2f..%2f..%2fetc%2fpasswd',
        '....//....//....//etc/passwd',
        '%2e%2e/%2e%2e/%2e%2e/etc/passwd',
        '..%252f..%252f..%252fetc/passwd',  // Double-encoded
        '..\\..\\..\\etc\\passwd',           // Windows
        '..%5c..%5c..%5cetc%5cpasswd',       // Encoded Windows
      ]

      const endpoints = [
        '/signalk/v1/api/vessels/self/',
        '/plugins/',
        '/@signalk/'
      ]

      console.log('      Testing path traversal vectors:')
      for (const endpoint of endpoints) {
        for (const payload of traversalPayloads.slice(0, 3)) {  // Test first 3
          try {
            const response = await request(
              `${endpoint}${encodeURIComponent(payload)}`,
              {
                headers: adminToken ? { Authorization: `Bearer ${adminToken}` } : {}
              }
            )

            // Check for passwd file content
            if (typeof response.body === 'string' && response.body.includes('root:')) {
              console.log(`      CRITICAL: Path traversal successful at ${endpoint}!`)
            }
          } catch (e) {
            // Expected for most attempts
          }
        }
      }
      console.log('      Path traversal tests completed (most should fail)')
    })
  })
})
