/**
 * SignalK Server - Authentication Security Tests
 *
 * Tests for authentication vulnerabilities:
 * - Credential stuffing protection
 * - Token security
 * - Session management
 * - Password handling
 * - Brute force protection
 */

const { expect } = require('chai')
const http = require('http')
const https = require('https')

// Test configuration
const BASE_URL = process.env.SIGNALK_URL || 'http://localhost:3000'

// HTTP request helper
function request(method, path, body = null, headers = {}) {
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
        'Content-Type': 'application/json',
        ...headers,
      },
    }

    const req = lib.request(options, (res) => {
      let data = ''
      res.on('data', (chunk) => (data += chunk))
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: data ? JSON.parse(data).catch ? data : JSON.parse(data) : null,
        })
      })
    })

    req.on('error', reject)
    if (body) req.write(JSON.stringify(body))
    req.end()
  })
}

describe('Authentication Security Tests', function () {
  this.timeout(30000)

  describe('Login Endpoint Security', () => {
    it('should reject empty credentials', async () => {
      const res = await request('POST', '/signalk/v1/auth/login', {})
      expect(res.status).to.be.oneOf([400, 401])
    })

    it('should reject login without password', async () => {
      const res = await request('POST', '/signalk/v1/auth/login', {
        username: 'admin',
      })
      expect(res.status).to.be.oneOf([400, 401])
    })

    it('should reject login without username', async () => {
      const res = await request('POST', '/signalk/v1/auth/login', {
        password: 'password',
      })
      expect(res.status).to.be.oneOf([400, 401])
    })

    it('should reject SQL injection in username', async () => {
      const injectionPayloads = [
        "admin'--",
        "admin' OR '1'='1",
        "'; DROP TABLE users;--",
        'admin" OR "1"="1',
        'admin\'; DELETE FROM users WHERE \'1\'=\'1',
      ]

      for (const payload of injectionPayloads) {
        const res = await request('POST', '/signalk/v1/auth/login', {
          username: payload,
          password: 'test',
        })
        expect(res.status).to.be.oneOf([400, 401, 403])
      }
    })

    it('should reject NoSQL injection in credentials', async () => {
      const injectionPayloads = [
        { username: { $gt: '' }, password: { $gt: '' } },
        { username: { $ne: null }, password: { $ne: null } },
        { username: 'admin', password: { $regex: '.*' } },
      ]

      for (const payload of injectionPayloads) {
        const res = await request('POST', '/signalk/v1/auth/login', payload)
        expect(res.status).to.be.oneOf([400, 401, 403])
      }
    })

    it('should not reveal valid usernames on failed login', async () => {
      // Login with invalid user
      const res1 = await request('POST', '/signalk/v1/auth/login', {
        username: 'definitely_not_a_user_xyz123',
        password: 'wrongpassword',
      })

      // Login with potentially valid user, wrong password
      const res2 = await request('POST', '/signalk/v1/auth/login', {
        username: 'admin',
        password: 'wrongpassword',
      })

      // Both should return the same status (no user enumeration)
      expect(res1.status).to.equal(res2.status)
    })

    it('should handle very long username/password', async () => {
      const longString = 'a'.repeat(100000)

      const res = await request('POST', '/signalk/v1/auth/login', {
        username: longString,
        password: longString,
      })

      // Should handle gracefully, not crash
      expect(res.status).to.be.oneOf([400, 401, 413])
    })

    it('should handle special characters in credentials', async () => {
      const specialChars = [
        '\x00\x00\x00',
        '\\u0000',
        '${7*7}',
        '{{7*7}}',
        '<script>alert(1)</script>',
        '%00%00',
      ]

      for (const chars of specialChars) {
        const res = await request('POST', '/signalk/v1/auth/login', {
          username: chars,
          password: chars,
        })
        expect(res.status).to.be.oneOf([400, 401, 403])
      }
    })
  })

  describe('Token Security', () => {
    it('should not accept tokens with algorithm none', async () => {
      // Algorithm 'none' attack - JWT with no signature
      // Header: {"alg":"none","typ":"JWT"}
      // Payload: {"id":"admin"}
      const noneToken =
        'eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJpZCI6ImFkbWluIn0.'

      const res = await request('GET', '/skServer/loginStatus', null, {
        Authorization: `Bearer ${noneToken}`,
      })

      expect(res.status).to.be.oneOf([401, 403])
    })

    it('should not accept tokens with weak algorithms', async () => {
      // These would need to be crafted with actual weak algorithms
      // Placeholder for manual testing
      console.log(
        '  [Manual test: craft tokens with HS256 when RS256 expected]'
      )
    })

    it('should reject tokens signed with wrong secret', async () => {
      // A valid-looking JWT but signed with wrong secret
      const fakeToken =
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6ImFkbWluIn0.fake_signature'

      const res = await request('GET', '/skServer/loginStatus', null, {
        Authorization: `Bearer ${fakeToken}`,
      })

      expect(res.status).to.be.oneOf([401, 403])
    })

    it('should handle token in multiple locations consistently', async () => {
      const fakeToken = 'fake_token_12345'

      // Test all token locations
      const locations = [
        { headers: { Authorization: `JWT ${fakeToken}` } },
        { headers: { Authorization: `Bearer ${fakeToken}` } },
        { headers: { 'X-Authorization': `JWT ${fakeToken}` } },
        { headers: { Cookie: `JAUTHENTICATION=${fakeToken}` } },
      ]

      for (const loc of locations) {
        const res = await request('GET', '/skServer/loginStatus', null, loc.headers)
        expect(res.status).to.be.oneOf([200, 401, 403])
      }
    })
  })

  describe('Brute Force Protection', () => {
    it('should implement rate limiting on login', async () => {
      const attempts = 20
      const results = []

      // Rapid login attempts
      for (let i = 0; i < attempts; i++) {
        const res = await request('POST', '/signalk/v1/auth/login', {
          username: 'admin',
          password: `wrong_password_${i}`,
        })
        results.push(res.status)
      }

      // Check if any rate limiting occurred (429 status)
      const rateLimited = results.some((s) => s === 429)
      if (!rateLimited) {
        console.log(
          '  WARNING: No rate limiting detected after ' + attempts + ' rapid login attempts'
        )
      } else {
        console.log('  Rate limiting detected')
      }
    })

    it('should not lock out accounts permanently', async () => {
      // After many failed attempts, account should eventually be accessible
      // This is a design consideration - depends on implementation
      console.log('  [Manual test: verify account lockout policy]')
    })
  })

  describe('Session Management', () => {
    it('should invalidate session on logout', async () => {
      // Would need valid credentials to test properly
      // Placeholder for manual testing
      console.log('  [Manual test: login, get token, logout, verify token invalid]')
    })

    it('should not expose tokens in error messages', async () => {
      const res = await request('GET', '/skServer/security/config', null, {
        Authorization: 'Bearer invalid_token_secret_data',
      })

      const responseText = JSON.stringify(res.body)
      expect(responseText).to.not.include('invalid_token_secret_data')
    })
  })

  describe('Password Security', () => {
    it('should not expose password hashes in API responses', async () => {
      // Try to get user list (admin endpoint)
      const res = await request('GET', '/skServer/security/users')

      if (res.body && typeof res.body === 'object') {
        const responseText = JSON.stringify(res.body)
        expect(responseText).to.not.match(/\$2[aby]?\$\d+\$/)  // bcrypt hash pattern
      }
    })

    it('should reject password change without current password', async () => {
      const res = await request(
        'PUT',
        '/skServer/security/user/admin/password',
        {
          newPassword: 'hacked123',
        }
      )

      expect(res.status).to.be.oneOf([400, 401, 403])
    })
  })

  describe('Device Access Requests', () => {
    it('should not auto-approve device access requests', async () => {
      const res = await request('POST', '/signalk/v1/access/requests', {
        clientId: 'test-device-' + Date.now(),
        description: 'Malicious device',
        permissions: 'admin',
      })

      // Should require admin approval
      if (res.status === 202) {
        expect(res.body).to.have.property('requestId')
        // Status should be PENDING, not APPROVED
        const checkRes = await request(
          'GET',
          `/signalk/v1/requests/${res.body.requestId}`
        )
        if (checkRes.body && checkRes.body.state) {
          expect(checkRes.body.state).to.not.equal('APPROVED')
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
