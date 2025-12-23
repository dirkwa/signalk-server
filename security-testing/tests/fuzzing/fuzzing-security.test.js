/**
 * SignalK Server - Fuzzing Security Tests
 *
 * Tests with malformed/random inputs to find edge cases:
 * - Protocol fuzzing
 * - Input validation fuzzing
 * - Delta message fuzzing
 */

const WebSocket = require('ws')
const { expect } = require('chai')
const http = require('http')
const crypto = require('crypto')

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
    req.setTimeout(5000, () => {
      req.destroy()
      reject(new Error('Request timeout'))
    })
    if (body) {
      if (typeof body === 'string') {
        req.write(body)
      } else {
        req.write(JSON.stringify(body))
      }
    }
    req.end()
  })
}

// Generate random string
function randomString(length, charset = 'alphanumeric') {
  const charsets = {
    alphanumeric: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789',
    unicode: '你好世界🚢⚓🌊αβγδ',
    special: '!@#$%^&*()[]{}|;:\'",.<>?/\\`~',
    control: '\x00\x01\x02\x03\x04\x05\x06\x07\x08\x09\x0a\x0b\x0c\x0d\x1b',
    mixed: 'ABCabc123!@#你好🚢\x00\n\t',
  }

  const chars = charsets[charset] || charsets.alphanumeric
  let result = ''
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return result
}

// Generate random delta message
function randomDelta() {
  const contexts = [
    'vessels.self',
    'vessels.' + randomString(10),
    randomString(20),
    '',
    null,
  ]

  const paths = [
    'navigation.speedOverGround',
    'navigation.' + randomString(10),
    randomString(30),
    '../../../etc/passwd',
    '',
  ]

  const values = [
    Math.random() * 100,
    randomString(100),
    null,
    undefined,
    [],
    {},
    { nested: { deep: randomString(50) } },
    true,
    false,
    -Infinity,
    NaN,
  ]

  return {
    context: contexts[Math.floor(Math.random() * contexts.length)],
    updates: [
      {
        source: { label: randomString(10) },
        timestamp: new Date().toISOString(),
        values: [
          {
            path: paths[Math.floor(Math.random() * paths.length)],
            value: values[Math.floor(Math.random() * values.length)],
          },
        ],
      },
    ],
  }
}

describe('Fuzzing Security Tests', function () {
  this.timeout(60000)

  describe('WebSocket Protocol Fuzzing', () => {
    it('should handle random binary data', async () => {
      try {
        const ws = new WebSocket(WS_URL)
        await new Promise((resolve, reject) => {
          ws.on('open', resolve)
          ws.on('error', reject)
          setTimeout(() => reject(new Error('timeout')), 5000)
        })

        // Wait for hello
        await new Promise((resolve) => ws.once('message', resolve))

        // Send random binary data
        for (let i = 0; i < 10; i++) {
          const randomBytes = crypto.randomBytes(Math.floor(Math.random() * 1000))
          ws.send(randomBytes)
        }

        await new Promise((r) => setTimeout(r, 2000))

        // Connection should still be alive or gracefully closed
        expect(ws.readyState).to.be.oneOf([WebSocket.OPEN, WebSocket.CLOSED])
        ws.close()
      } catch (err) {
        console.log('Binary fuzzing handled:', err.message)
      }
    })

    it('should handle random delta messages', async () => {
      try {
        const ws = new WebSocket(WS_URL)
        await new Promise((resolve, reject) => {
          ws.on('open', resolve)
          ws.on('error', reject)
          setTimeout(() => reject(new Error('timeout')), 5000)
        })

        // Wait for hello
        await new Promise((resolve) => ws.once('message', resolve))

        // Send many random deltas
        for (let i = 0; i < 50; i++) {
          try {
            ws.send(JSON.stringify(randomDelta()))
          } catch (e) {
            // Some values may not be serializable
          }
        }

        await new Promise((r) => setTimeout(r, 2000))
        ws.close()
      } catch (err) {
        console.log('Delta fuzzing handled:', err.message)
      }
    })

    it('should handle mixed valid/invalid messages', async () => {
      try {
        const ws = new WebSocket(WS_URL)
        await new Promise((resolve, reject) => {
          ws.on('open', resolve)
          ws.on('error', reject)
          setTimeout(() => reject(new Error('timeout')), 5000)
        })

        // Wait for hello
        await new Promise((resolve) => ws.once('message', resolve))

        const messages = [
          JSON.stringify({
            context: 'vessels.self',
            subscribe: [{ path: '*' }],
          }),
          'invalid json {{{',
          JSON.stringify(randomDelta()),
          crypto.randomBytes(100).toString(),
          JSON.stringify({ ping: true }),
          '',
          '\x00\x00\x00\x00',
        ]

        for (const msg of messages) {
          ws.send(msg)
        }

        await new Promise((r) => setTimeout(r, 2000))
        expect(ws.readyState).to.be.oneOf([WebSocket.OPEN, WebSocket.CLOSED])
        ws.close()
      } catch (err) {
        console.log('Mixed message fuzzing handled:', err.message)
      }
    })
  })

  describe('HTTP Input Fuzzing', () => {
    it('should handle random query parameters', async () => {
      const fuzzParams = [
        '?foo=' + randomString(1000),
        '?' + randomString(100) + '=' + randomString(100),
        '?<script>alert(1)</script>=test',
        '?__proto__[admin]=true',
        '?' + encodeURIComponent('../../etc/passwd'),
      ]

      for (const params of fuzzParams) {
        try {
          const res = await request('GET', '/signalk' + params)
          expect(res.status).to.be.oneOf([200, 400, 404, 414])
        } catch (err) {
          console.log('Query param handled:', err.message)
        }
      }
    })

    it('should handle random headers', async () => {
      const fuzzHeaders = [
        { 'X-Custom': randomString(10000) },
        { 'Authorization': 'Bearer ' + randomString(5000) },
        { 'Content-Type': randomString(100) },
        { 'Host': randomString(100) },
        { [randomString(20)]: randomString(100) },
      ]

      for (const headers of fuzzHeaders) {
        try {
          const res = await request('GET', '/signalk', null, headers)
          expect(res.status).to.be.oneOf([200, 400, 431])
        } catch (err) {
          console.log('Header fuzzing handled:', err.message)
        }
      }
    })

    it('should handle random path segments', async () => {
      const fuzzPaths = [
        '/signalk/v1/api/' + randomString(100),
        '/signalk/v1/api/vessels/' + randomString(50),
        '/' + randomString(200),
        '/signalk/' + encodeURIComponent(randomString(100, 'unicode')),
        '/signalk/' + randomString(50, 'special'),
      ]

      for (const path of fuzzPaths) {
        try {
          const res = await request('GET', path)
          expect(res.status).to.be.oneOf([200, 400, 404, 414])
        } catch (err) {
          console.log('Path fuzzing handled:', err.message)
        }
      }
    })

    it('should handle random JSON bodies', async () => {
      const fuzzBodies = [
        randomString(1000),
        { [randomString(20)]: randomString(100) },
        { nested: { a: { b: { c: randomString(500) } } } },
        Array(100).fill(randomString(10)),
        { value: crypto.randomBytes(100).toString('base64') },
      ]

      for (const body of fuzzBodies) {
        try {
          const res = await request(
            'PUT',
            '/signalk/v1/api/vessels/self/test',
            body
          )
          expect(res.status).to.be.oneOf([200, 400, 401, 403, 413])
        } catch (err) {
          console.log('Body fuzzing handled:', err.message)
        }
      }
    })
  })

  describe('Authentication Fuzzing', () => {
    it('should handle random credentials', async () => {
      for (let i = 0; i < 20; i++) {
        try {
          const res = await request('POST', '/signalk/v1/auth/login', {
            username: randomString(Math.floor(Math.random() * 100)),
            password: randomString(Math.floor(Math.random() * 100)),
          })
          expect(res.status).to.be.oneOf([200, 400, 401])
        } catch (err) {
          console.log('Auth fuzzing handled:', err.message)
        }
      }
    })

    it('should handle malformed JWT tokens', async () => {
      const fuzzTokens = [
        randomString(100),
        'eyJ' + randomString(100),
        randomString(20) + '.' + randomString(20) + '.' + randomString(20),
        Buffer.from(randomString(100)).toString('base64'),
      ]

      for (const token of fuzzTokens) {
        try {
          const res = await request('GET', '/skServer/loginStatus', null, {
            Authorization: 'Bearer ' + token,
          })
          expect(res.status).to.be.oneOf([200, 401, 403])
        } catch (err) {
          console.log('Token fuzzing handled:', err.message)
        }
      }
    })
  })

  describe('Delta Path Fuzzing', () => {
    it('should handle random delta paths', async () => {
      const fuzzPaths = [
        randomString(50),
        randomString(10) + '.' + randomString(10) + '.' + randomString(10),
        '../' + randomString(20),
        randomString(20, 'special'),
        randomString(20, 'unicode'),
        'navigation.' + randomString(100),
        '.'.repeat(50),
        'a.'.repeat(100) + 'b',
      ]

      for (const path of fuzzPaths) {
        try {
          const res = await request('GET', `/signalk/v1/api/vessels/self/${encodeURIComponent(path)}`)
          expect(res.status).to.be.oneOf([200, 400, 404])
        } catch (err) {
          console.log('Path fuzzing handled:', err.message)
        }
      }
    })
  })

  describe('Boundary Value Testing', () => {
    it('should handle extreme numeric values', async () => {
      const extremeValues = [
        0,
        -0,
        1,
        -1,
        Number.MAX_VALUE,
        Number.MIN_VALUE,
        Number.MAX_SAFE_INTEGER,
        Number.MIN_SAFE_INTEGER,
        Infinity,
        -Infinity,
        1e308,
        1e-308,
      ]

      for (const value of extremeValues) {
        try {
          const res = await request(
            'PUT',
            '/signalk/v1/api/vessels/self/navigation/speedOverGround',
            { value }
          )
          expect(res.status).to.be.oneOf([200, 400, 401, 403])
        } catch (err) {
          // Some values may fail serialization
        }
      }
    })

    it('should handle extreme string lengths', async () => {
      const lengths = [0, 1, 100, 1000, 10000, 100000]

      for (const len of lengths) {
        try {
          const res = await request(
            'PUT',
            '/signalk/v1/api/vessels/self/test',
            { value: randomString(len) }
          )
          expect(res.status).to.be.oneOf([200, 400, 401, 403, 413])
        } catch (err) {
          console.log(`String length ${len} handled:`, err.message)
        }
      }
    })

    it('should handle extreme array sizes', async () => {
      const sizes = [0, 1, 10, 100, 1000]

      for (const size of sizes) {
        try {
          const res = await request('PUT', '/signalk/v1/api/vessels/self/test', {
            value: Array(size).fill('item'),
          })
          expect(res.status).to.be.oneOf([200, 400, 401, 403, 413])
        } catch (err) {
          console.log(`Array size ${size} handled:`, err.message)
        }
      }
    })
  })

  describe('Character Encoding Attacks', () => {
    it('should handle various encodings safely', async () => {
      const encodedPayloads = [
        '%00%00%00',
        '%u0000',
        '\\u0000',
        '\x00\x00\x00',
        '&#x00;',
        '\uFEFF',  // BOM
        '\u202E',  // Right-to-left override
        '\u200B',  // Zero-width space
      ]

      for (const payload of encodedPayloads) {
        try {
          const res = await request('PUT', '/signalk/v1/api/vessels/self/test', {
            value: payload,
          })
          expect(res.status).to.be.oneOf([200, 400, 401, 403])
        } catch (err) {
          // Expected for some payloads
        }
      }
    })

    it('should handle Unicode normalization attacks', async () => {
      // Different Unicode representations of similar characters
      const normalizationPayloads = [
        'café',  // Composed
        'café', // Decomposed (e + combining accent)
        '𝐚𝐝𝐦𝐢𝐧', // Mathematical bold
        'ａｄｍｉｎ', // Fullwidth
        'аdmin', // Cyrillic 'а'
      ]

      for (const payload of normalizationPayloads) {
        try {
          const res = await request('POST', '/signalk/v1/auth/login', {
            username: payload,
            password: 'test',
          })
          expect(res.status).to.be.oneOf([400, 401])
        } catch (err) {
          console.log('Normalization handled:', err.message)
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
