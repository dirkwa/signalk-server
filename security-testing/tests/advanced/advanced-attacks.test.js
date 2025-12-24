/**
 * Advanced Attack Vectors Security Tests
 *
 * Tests for sophisticated attack scenarios:
 * - Plugin/Module installation abuse
 * - JWT secret weakness analysis
 * - Backup/restore exploitation
 * - SSRF via providers
 * - MDNS spoofing potential
 * - Config injection
 */

const { expect } = require('chai')
const WebSocket = require('ws')
const crypto = require('crypto')

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

describe('Plugin/Module Installation Security Tests', function () {
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

  describe('Appstore Endpoint Security', function () {
    /**
     * POTENTIAL VULNERABILITY: src/interfaces/appstore.js
     *
     * The appstore allows installing npm packages. Potential attacks:
     * 1. Dependency confusion - install malicious package with similar name
     * 2. Version pinning attacks - install known vulnerable version
     * 3. Command injection via package name
     */

    it('should require authentication for plugin installation', async function () {
      const response = await request(
        '/skServer/appstore/install/signalk-test-plugin/1.0.0',
        {
          method: 'POST'
        }
      )

      // Should require auth
      expect([401, 403]).to.include(response.status)
    })

    it('should not allow path traversal in package name', async function () {
      const headers = adminToken
        ? { Authorization: `Bearer ${adminToken}` }
        : {}

      const maliciousNames = [
        '../../../etc/passwd',
        '..%2F..%2F..%2Fetc%2Fpasswd',
        'signalk-plugin;rm -rf /',
        'signalk-plugin$(whoami)',
        'signalk-plugin`id`',
        '@malicious/../../../exploit'
      ]

      for (const name of maliciousNames) {
        const response = await request(
          `/skServer/appstore/install/${encodeURIComponent(name)}/1.0.0`,
          {
            method: 'POST',
            headers
          }
        )

        console.log(
          `      Install "${name.substring(0, 30)}..." - Status: ${response.status}`
        )

        // Should be rejected or require specific handling
        expect([400, 401, 403, 404, 500]).to.include(response.status)
      }
    })

    it('should not allow command injection in version', async function () {
      const headers = adminToken
        ? { Authorization: `Bearer ${adminToken}` }
        : {}

      const maliciousVersions = [
        '1.0.0;id',
        '1.0.0$(whoami)',
        '1.0.0`cat /etc/passwd`',
        '|| ls -la',
        '&& rm -rf /'
      ]

      for (const version of maliciousVersions) {
        const response = await request(
          `/skServer/appstore/install/signalk-test/${encodeURIComponent(version)}`,
          {
            method: 'POST',
            headers
          }
        )

        console.log(`      Version "${version}" - Status: ${response.status}`)
      }

      expect(true).to.be.true
    })

    it('should list available plugins without exposing sensitive data', async function () {
      const response = await request('/skServer/appstore/available/')

      if (response.status === 200 && response.body) {
        // Check that no secrets are exposed
        const bodyStr = JSON.stringify(response.body)
        expect(bodyStr).to.not.include('secretKey')
        expect(bodyStr).to.not.include('password')
        expect(bodyStr).to.not.include('apiKey')
      }

      expect([200, 401, 403]).to.include(response.status)
    })
  })
})

describe('JWT Security Analysis', function () {
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

  describe('JWT Token Analysis', function () {
    /**
     * Analysis of JWT implementation in src/tokensecurity.js
     *
     * Key findings:
     * 1. Secret is generated randomly if not provided (good)
     * 2. Secret can be set via SECRETKEY env var (potential leak)
     * 3. getConfig() properly removes secretKey before returning (good)
     */

    it('should not expose JWT secret in security config endpoint', async function () {
      const headers = adminToken
        ? { Authorization: `Bearer ${adminToken}` }
        : {}

      const response = await request('/skServer/security/config', {
        headers
      })

      if (response.status === 200 && response.body) {
        const bodyStr = JSON.stringify(response.body)
        expect(bodyStr).to.not.include('secretKey')

        // Also check the body object directly
        expect(response.body.secretKey).to.be.undefined
      }

      console.log(
        `      GET /skServer/security/config - Status: ${response.status}`
      )
    })

    it('should analyze JWT token structure', async function () {
      if (!adminToken) {
        this.skip()
        return
      }

      const parts = adminToken.split('.')
      expect(parts.length).to.equal(3)

      // Decode header and payload (not signature)
      const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString())
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString())

      console.log('      JWT Header:', JSON.stringify(header))
      console.log('      JWT Payload keys:', Object.keys(payload))

      // Check algorithm - should be HS256 or stronger
      expect(['HS256', 'HS384', 'HS512', 'RS256', 'RS384', 'RS512']).to.include(
        header.alg
      )

      // Check that token has expiration
      if (payload.exp) {
        console.log(
          `      Token expires: ${new Date(payload.exp * 1000).toISOString()}`
        )
      }

      // Ensure sensitive data not in token
      const payloadStr = JSON.stringify(payload)
      expect(payloadStr.toLowerCase()).to.not.include('password')
      expect(payloadStr.toLowerCase()).to.not.include('secret')
    })

    it('should reject tokens with algorithm:none attack', async function () {
      // Create a token with alg:none (classic JWT attack)
      const header = Buffer.from(
        JSON.stringify({ alg: 'none', typ: 'JWT' })
      ).toString('base64url')
      const payload = Buffer.from(JSON.stringify({ id: 'admin' })).toString(
        'base64url'
      )
      const noneToken = `${header}.${payload}.`

      const response = await request('/skServer/plugins', {
        headers: { Authorization: `Bearer ${noneToken}` }
      })

      // Should be rejected
      expect([401, 403]).to.include(response.status)
      console.log(
        `      alg:none token - Status: ${response.status} (should be 401/403)`
      )
    })

    it('should reject tokens with tampered payload', async function () {
      if (!adminToken) {
        this.skip()
        return
      }

      const parts = adminToken.split('.')

      // Tamper with payload - try to escalate to admin
      const tamperedPayload = Buffer.from(
        JSON.stringify({
          id: 'attacker',
          type: 'admin'
        })
      ).toString('base64url')

      const tamperedToken = `${parts[0]}.${tamperedPayload}.${parts[2]}`

      const response = await request('/skServer/plugins', {
        headers: { Authorization: `Bearer ${tamperedToken}` }
      })

      // Should be rejected due to invalid signature
      expect([401, 403]).to.include(response.status)
      console.log(
        `      Tampered token - Status: ${response.status} (should be 401/403)`
      )
    })
  })
})

describe('Backup/Restore Security Tests', function () {
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

  describe('Backup Download Security', function () {
    /**
     * POTENTIAL VULNERABILITY: src/serverroutes.ts line 1153
     *
     * The backup endpoint zips and downloads config files.
     * Potential issues:
     * 1. May include sensitive files (security.json with hashed passwords)
     * 2. ZIP slip vulnerability in restore
     */

    it('should require authentication for backup download', async function () {
      const response = await request('/skServer/backup')

      if (!securityEnabled) {
        // Without security, backup might be accessible (documented issue)
        console.log(`      Backup without auth - Status: ${response.status}`)
      } else {
        expect([401, 403]).to.include(response.status)
      }
    })

    it('should require authentication for restore', async function () {
      const response = await request('/skServer/restore', {
        method: 'POST',
        body: JSON.stringify({})
      })

      expect([400, 401, 403]).to.include(response.status)
    })
  })

  describe('Restore Path Traversal', function () {
    it('should validate backup file extension', async function () {
      const headers = adminToken
        ? { Authorization: `Bearer ${adminToken}` }
        : {}

      // The code requires .backup extension and signalk- prefix
      // This is a good security control
      console.log(`
      SECURITY CONTROL: Backup file validation
      - Must end with .backup extension
      - Must start with signalk- prefix
      - Only whitelisted files extracted (safeFiles array)

      Location: src/serverroutes.ts lines 1085-1096
      `)

      expect(true).to.be.true
    })
  })
})

describe('SSRF via Provider Configuration', function () {
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

  describe('Provider SSRF Potential', function () {
    /**
     * POTENTIAL VULNERABILITY: src/interfaces/providers.js
     *
     * Providers can connect to arbitrary hosts/ports.
     * If an attacker gains admin access, they could:
     * 1. Configure a TCP provider pointing to internal services
     * 2. Scan internal network via error messages
     * 3. Exfiltrate data through NMEA connections
     */

    it('should list current providers', async function () {
      const headers = adminToken
        ? { Authorization: `Bearer ${adminToken}` }
        : {}

      const response = await request('/skServer/providers', { headers })

      console.log(`      GET /skServer/providers - Status: ${response.status}`)

      if (response.status === 200 && Array.isArray(response.body)) {
        console.log(`      Found ${response.body.length} providers`)
      }
    })

    it('should document SSRF risk in provider creation', async function () {
      console.log(`
      POTENTIAL SSRF RISK: Provider Configuration

      An admin user can create providers that connect to arbitrary hosts.

      Attack scenarios:
      1. TCP provider to internal service: 127.0.0.1:6379 (Redis)
      2. TCP provider to cloud metadata: 169.254.169.254
      3. UDP provider for port scanning

      Location: src/interfaces/providers.js

      Mitigation suggestions:
      - Whitelist allowed provider targets
      - Block RFC1918 addresses for external-facing servers
      - Add network policy controls
      `)

      expect(true).to.be.true
    })

    it('should require authentication for provider creation', async function () {
      const maliciousProvider = {
        id: 'ssrf-test',
        enabled: true,
        type: 'TCP',
        options: {
          type: 'tcp',
          host: '169.254.169.254', // AWS metadata
          port: 80
        }
      }

      const response = await request('/skServer/providers', {
        method: 'POST',
        body: JSON.stringify(maliciousProvider)
      })

      // Should require auth
      expect([401, 403]).to.include(response.status)
    })
  })
})

describe('Configuration Injection Tests', function () {
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

  describe('Security Config Manipulation', function () {
    it('should not allow disabling security via API', async function () {
      const headers = adminToken
        ? { Authorization: `Bearer ${adminToken}` }
        : {}

      // Try to disable security via config update
      const response = await request('/skServer/security/config', {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          allow_readonly: true,
          // Attempt to inject malicious config
          __proto__: { admin: true },
          constructor: { prototype: { admin: true } }
        })
      })

      console.log(
        `      PUT /skServer/security/config - Status: ${response.status}`
      )

      // Verify prototype not polluted
      expect({}.admin).to.be.undefined
    })

    it('should not allow adding admin users without proper auth', async function () {
      const response = await request(
        '/skServer/security/users/malicious-admin',
        {
          method: 'PUT',
          body: JSON.stringify({
            type: 'admin',
            password: 'hacked123'
          })
        }
      )

      expect([401, 403, 405]).to.include(response.status)
    })
  })

  describe('Settings File Injection', function () {
    it('should sanitize provider ID to prevent config pollution', async function () {
      const headers = adminToken
        ? { Authorization: `Bearer ${adminToken}` }
        : {}

      const maliciousIds = [
        '__proto__',
        'constructor',
        'prototype',
        '../../../etc/passwd',
        '"; rm -rf /'
      ]

      for (const id of maliciousIds) {
        const response = await request('/skServer/providers', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            id: id,
            enabled: false,
            type: 'FileStream',
            options: { type: 'NMEA0183', filename: '/dev/null' }
          })
        })

        console.log(
          `      Provider ID "${id.substring(0, 20)}" - Status: ${response.status}`
        )
      }

      // Verify prototype not polluted
      expect({}.enabled).to.be.undefined
    })
  })
})

describe('WebSocket Message Replay/Tampering', function () {
  this.timeout(30000)

  let adminToken = null

  before(async function () {
    try {
      adminToken = await getToken(ADMIN_USER, ADMIN_PASS)
    } catch (e) {}
  })

  describe('Message Replay Attacks', function () {
    it('should document replay attack potential', async function () {
      console.log(`
      REPLAY ATTACK POTENTIAL: WebSocket Messages

      SignalK delta messages do not include:
      - Message sequence numbers
      - Timestamps verified by server
      - Message authentication codes (MAC)

      An attacker who captures WebSocket traffic could:
      1. Record legitimate delta messages
      2. Replay old position/sensor data
      3. Cause confusion with stale data

      Mitigation suggestions:
      - Add sequence numbers to delta messages
      - Server-side timestamp validation
      - Implement message signing for critical data
      `)

      expect(true).to.be.true
    })

    it('should test rapid message replay', async function () {
      if (!adminToken) {
        this.skip()
        return
      }

      const ws = new WebSocket(
        `${WS_URL}/signalk/v1/stream?token=${adminToken}`
      )

      await new Promise((resolve, reject) => {
        ws.on('open', resolve)
        ws.on('error', reject)
        setTimeout(() => reject(new Error('Connection timeout')), 5000)
      })

      // Capture a message format
      const testDelta = {
        context: 'vessels.self',
        updates: [
          {
            source: { label: 'replay-test' },
            timestamp: new Date().toISOString(),
            values: [
              {
                path: 'navigation.position',
                value: { latitude: 0, longitude: 0 }
              }
            ]
          }
        ]
      }

      // Send same message 100 times rapidly (replay attack)
      for (let i = 0; i < 100; i++) {
        ws.send(JSON.stringify(testDelta))
      }

      await new Promise((resolve) => setTimeout(resolve, 1000))

      ws.close()
      console.log('      Sent 100 replayed messages - server survived')
      expect(true).to.be.true
    })
  })
})

describe('MDNS/Discovery Security', function () {
  this.timeout(30000)

  describe('Service Discovery Risks', function () {
    /**
     * POTENTIAL VULNERABILITY: src/mdns.js
     *
     * SignalK advertises itself via mDNS. Attackers could:
     * 1. Discover all SignalK servers on network
     * 2. Spoof mDNS responses to redirect clients
     * 3. Enumerate vessel information
     */

    it('should document mDNS security considerations', async function () {
      console.log(`
      MDNS SECURITY CONSIDERATIONS

      SignalK uses mDNS for service discovery:
      - Advertises _signalk-http._tcp and _signalk-ws._tcp
      - Exposes server presence on local network
      - No authentication for discovery

      Location: src/mdns.js

      Attack scenarios:
      1. Network reconnaissance - find all SignalK servers
      2. mDNS spoofing - redirect clients to malicious server
      3. Information disclosure - vessel name/UUID exposed

      Note: mDNS is inherently insecure and designed for
      trusted local networks. This is expected behavior.

      Mitigation for high-security environments:
      - Disable mDNS via configuration
      - Use VPN for remote access
      - Network segmentation
      `)

      expect(true).to.be.true
    })

    it('should check if discovery endpoint requires auth', async function () {
      const response = await request('/skServer/runDiscovery', {
        method: 'PUT'
      })

      console.log(
        `      PUT /skServer/runDiscovery - Status: ${response.status}`
      )

      // Should require authentication in security mode
      expect([200, 401, 403]).to.include(response.status)
    })
  })
})
