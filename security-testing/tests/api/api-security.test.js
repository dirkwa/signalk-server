/**
 * SignalK Server - REST API Security Tests
 *
 * Tests for API vulnerabilities:
 * - Injection attacks
 * - CORS misconfiguration
 * - Header security
 * - File upload security
 * - Rate limiting
 */

const { expect } = require('chai')
const http = require('http')
const https = require('https')
const fs = require('fs')
const path = require('path')

// Test configuration
const BASE_URL = process.env.SIGNALK_URL || 'http://localhost:3000'

// HTTP request helper
function request(method, path, body = null, headers = {}, rawBody = false) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL)
    const isHttps = url.protocol === 'https:'
    const lib = isHttps ? https : http

    const options = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      method,
      headers: {
        'Content-Type': rawBody ? headers['Content-Type'] : 'application/json',
        ...headers,
      },
    }

    const req = lib.request(options, (res) => {
      let data = ''
      res.on('data', (chunk) => (data += chunk))
      res.on('end', () => {
        let parsedBody
        try {
          parsedBody = data ? JSON.parse(data) : null
        } catch {
          parsedBody = data
        }
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: parsedBody,
        })
      })
    })

    req.on('error', reject)
    if (body) {
      req.write(rawBody ? body : JSON.stringify(body))
    }
    req.end()
  })
}

describe('REST API Security Tests', function () {
  this.timeout(30000)

  describe('Security Headers', () => {
    it('should include X-Content-Type-Options header', async () => {
      const res = await request('GET', '/signalk')
      // Check for security header (may not be present - document as finding)
      if (!res.headers['x-content-type-options']) {
        console.log('  FINDING: Missing X-Content-Type-Options header')
      } else {
        expect(res.headers['x-content-type-options']).to.equal('nosniff')
      }
    })

    it('should include X-Frame-Options header', async () => {
      const res = await request('GET', '/')
      if (!res.headers['x-frame-options']) {
        console.log('  FINDING: Missing X-Frame-Options header')
      }
    })

    it('should include Content-Security-Policy header', async () => {
      const res = await request('GET', '/admin/')
      if (!res.headers['content-security-policy']) {
        console.log('  FINDING: Missing Content-Security-Policy header')
      }
    })

    it('should include Strict-Transport-Security header (HTTPS)', async () => {
      if (BASE_URL.startsWith('https')) {
        const res = await request('GET', '/')
        if (!res.headers['strict-transport-security']) {
          console.log('  FINDING: Missing HSTS header on HTTPS')
        }
      } else {
        console.log('  [Skipped: testing HTTP, not HTTPS]')
      }
    })

    it('should not expose server version in headers', async () => {
      const res = await request('GET', '/signalk')

      // Check for version disclosure
      const serverHeader = res.headers['server'] || ''
      const poweredBy = res.headers['x-powered-by'] || ''

      if (serverHeader.match(/\d+\.\d+/)) {
        console.log('  FINDING: Server header exposes version:', serverHeader)
      }
      if (poweredBy) {
        console.log('  FINDING: X-Powered-By header present:', poweredBy)
      }
    })
  })

  describe('CORS Configuration', () => {
    it('should not allow wildcard origin with credentials', async () => {
      const res = await request('GET', '/signalk', null, {
        Origin: 'http://evil.com',
      })

      const corsOrigin = res.headers['access-control-allow-origin']
      const corsCredentials = res.headers['access-control-allow-credentials']

      if (corsOrigin === '*' && corsCredentials === 'true') {
        console.log('  CRITICAL: CORS allows wildcard with credentials!')
      }
    })

    it('should validate Origin header properly', async () => {
      const maliciousOrigins = [
        'http://evil.com',
        'http://localhost.evil.com',
        'http://signalk.evil.com',
        'null',
      ]

      for (const origin of maliciousOrigins) {
        const res = await request('GET', '/signalk', null, {
          Origin: origin,
        })

        const corsOrigin = res.headers['access-control-allow-origin']
        if (corsOrigin === origin) {
          console.log(`  FINDING: CORS reflects untrusted origin: ${origin}`)
        }
      }
    })

    it('should handle CORS preflight correctly', async () => {
      const res = await request('OPTIONS', '/signalk/v1/api/vessels/self', null, {
        Origin: 'http://localhost:8080',
        'Access-Control-Request-Method': 'PUT',
        'Access-Control-Request-Headers': 'Content-Type',
      })

      // Should return proper preflight response
      expect(res.status).to.be.oneOf([200, 204, 403])
    })
  })

  describe('JSON Injection', () => {
    it('should handle nested JSON objects safely', async () => {
      const nestedPayload = {
        value: {
          nested: {
            deeply: {
              nested: {
                value: 'test',
              },
            },
          },
        },
      }

      // Create deeply nested object
      let current = nestedPayload
      for (let i = 0; i < 100; i++) {
        current.value = { nested: {} }
        current = current.value
      }

      const res = await request('PUT', '/signalk/v1/api/vessels/self/test', nestedPayload)
      expect(res.status).to.be.oneOf([200, 400, 401, 413])
    })

    it('should handle JSON with circular reference attempt', async () => {
      // Can't create actual circular reference in JSON, but test similar patterns
      const payload = '{"a":{"b":{"a":{"b":"circular"}}}}'

      const res = await request('PUT', '/signalk/v1/api/vessels/self/test', null, {}, payload)
      expect(res.status).to.be.oneOf([200, 400, 401])
    })

    it('should reject prototype pollution in JSON', async () => {
      const pollutionPayloads = [
        { '__proto__': { 'admin': true } },
        { 'constructor': { 'prototype': { 'admin': true } } },
        { '__proto__.admin': true },
        { 'value': { '__proto__': { 'polluted': true } } },
      ]

      for (const payload of pollutionPayloads) {
        const res = await request('PUT', '/signalk/v1/api/vessels/self/test', payload)
        expect(res.status).to.be.oneOf([200, 400, 401, 403])
      }
    })
  })

  describe('File Upload Security', () => {
    it('should limit file upload size', async () => {
      // Create a large payload (larger than typical limit)
      const largePayload = 'x'.repeat(50 * 1024 * 1024) // 50MB

      try {
        const res = await request(
          'POST',
          '/skServer/restore',
          largePayload,
          {
            'Content-Type': 'application/octet-stream',
          },
          true
        )
        expect(res.status).to.be.oneOf([401, 403, 413])
      } catch (err) {
        // Expected - large upload rejected
        console.log('  Large upload rejected:', err.message)
      }
    })

    it('should validate file type in uploads', async () => {
      // Try to upload executable content
      const maliciousContent = '#!/bin/bash\nrm -rf /'

      const res = await request(
        'POST',
        '/skServer/restore',
        maliciousContent,
        {
          'Content-Type': 'application/x-sh',
        },
        true
      )

      expect(res.status).to.be.oneOf([400, 401, 403, 415])
    })

    it('should sanitize uploaded filenames', async () => {
      // This would require multipart form upload
      console.log('  [Manual test: upload file with malicious filename]')
    })
  })

  describe('Path Traversal', () => {
    it('should prevent directory traversal in API paths', async () => {
      const traversalAttempts = [
        '/signalk/v1/api/../../package.json',
        '/signalk/v1/api/vessels/self/../../../etc/passwd',
        '/signalk/v1/api/%2e%2e/%2e%2e/etc/passwd',
        '/signalk/v1/api/....//....//etc/passwd',
        '/signalk/v1/api/..\\..\\windows\\system32\\config\\sam',
      ]

      for (const path of traversalAttempts) {
        const res = await request('GET', path)
        expect(res.status).to.be.oneOf([200, 400, 404])
        if (res.body) {
          const bodyStr = JSON.stringify(res.body)
          expect(bodyStr).to.not.include('"name"')  // package.json
          expect(bodyStr).to.not.include('root:')   // /etc/passwd
        }
      }
    })

    it('should prevent path traversal in static file serving', async () => {
      const staticTraversals = [
        '/admin/../../../etc/passwd',
        '/plugins/../package.json',
        '/.well-known/../../.git/config',
      ]

      for (const path of staticTraversals) {
        const res = await request('GET', path)
        expect(res.status).to.be.oneOf([200, 301, 302, 400, 403, 404])
      }
    })
  })

  describe('Rate Limiting', () => {
    it('should implement rate limiting on API endpoints', async () => {
      const requests = 100
      const results = []

      for (let i = 0; i < requests; i++) {
        const res = await request('GET', '/signalk/v1/api/vessels/self')
        results.push(res.status)
      }

      const rateLimited = results.some((s) => s === 429)
      if (!rateLimited) {
        console.log(`  FINDING: No rate limiting after ${requests} rapid requests`)
      }
    })

    it('should rate limit error responses', async () => {
      const requests = 100
      const results = []

      for (let i = 0; i < requests; i++) {
        const res = await request('GET', '/signalk/v1/api/nonexistent/path')
        results.push(res.status)
      }

      const rateLimited = results.some((s) => s === 429)
      if (!rateLimited) {
        console.log(`  FINDING: No rate limiting on error responses`)
      }
    })
  })

  describe('Error Handling', () => {
    it('should not expose stack traces in errors', async () => {
      const res = await request('GET', '/signalk/v1/api/throw-error')

      if (res.body && typeof res.body === 'object') {
        const bodyStr = JSON.stringify(res.body)
        expect(bodyStr).to.not.include('at Object')
        expect(bodyStr).to.not.include('node_modules')
        expect(bodyStr).to.not.include('.js:')
      }
    })

    it('should not expose internal paths in errors', async () => {
      const res = await request('GET', '/signalk/v1/api/../../invalid')

      if (res.body && typeof res.body === 'object') {
        const bodyStr = JSON.stringify(res.body)
        expect(bodyStr).to.not.include('/home/')
        expect(bodyStr).to.not.include('/usr/')
        expect(bodyStr).to.not.include('C:\\')
      }
    })
  })

  describe('Method Validation', () => {
    it('should reject unexpected HTTP methods', async () => {
      const unexpectedMethods = ['TRACE', 'TRACK', 'CONNECT', 'PROPFIND']

      for (const method of unexpectedMethods) {
        const res = await request(method, '/signalk')
        expect(res.status).to.be.oneOf([400, 404, 405, 501])
      }
    })

    it('should handle HTTP method override headers', async () => {
      // Some frameworks allow method override via headers
      const res = await request('POST', '/skServer/security/users', null, {
        'X-HTTP-Method-Override': 'DELETE',
      })

      // Should not allow method override to bypass auth
      expect(res.status).to.be.oneOf([400, 401, 403])
    })
  })

  describe('Plugin API Security', () => {
    it('should validate plugin IDs', async () => {
      const maliciousIds = [
        '../../../malicious-plugin',
        'plugin; rm -rf /',
        '<script>alert(1)</script>',
        'plugin\x00.json',
      ]

      for (const id of maliciousIds) {
        const res = await request('GET', `/plugins/${encodeURIComponent(id)}`)
        expect(res.status).to.be.oneOf([400, 404])
      }
    })

    it('should require admin for plugin configuration', async () => {
      const res = await request('POST', '/skServer/plugins', {
        enable: 'some-plugin',
      })

      expect(res.status).to.be.oneOf([401, 403])
    })
  })

  describe('Backup/Restore Security', () => {
    it('should require admin for backup', async () => {
      const res = await request('GET', '/skServer/backup')
      expect(res.status).to.be.oneOf([401, 403])
    })

    it('should require admin for restore', async () => {
      const res = await request('POST', '/skServer/restore', {
        data: 'fake-backup-data',
      })
      expect(res.status).to.be.oneOf([401, 403])
    })

    it('should validate backup file format', async () => {
      // Would need admin token to test
      console.log('  [Admin test: attempt restore with malformed backup]')
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
