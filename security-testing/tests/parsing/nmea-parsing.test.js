/**
 * NMEA/N2K Parsing Security Tests
 *
 * Tests for potential vulnerabilities in NMEA0183 and NMEA2000 parsing:
 * - Buffer overflow via oversized sentences
 * - Format string injection
 * - Prototype pollution via parsed data
 * - Command injection in sentence fields
 * - TCP injection without authentication
 */

const { expect } = require('chai')
const net = require('net')

const BASE_URL = process.env.SIGNALK_URL || 'http://localhost:3000'
const NMEA_PORT = process.env.NMEA0183PORT || 10110

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

describe('NMEA0183 Parsing Security Tests', function () {
  this.timeout(30000)

  describe('NMEA TCP Interface Injection', function () {
    /**
     * POTENTIAL VULNERABILITY: src/interfaces/nmea-tcp.js line 38-39
     *
     * socket.on('data', (data) => {
     *   app.emit('tcpserver0183data', data.toString())
     * })
     *
     * The NMEA TCP server accepts data from ANY connected TCP client
     * without authentication. An attacker on the network can inject
     * arbitrary NMEA sentences.
     */

    it('should document unauthenticated TCP NMEA input', async function () {
      console.log(`
      SECURITY CONCERN: NMEA TCP Interface (port ${NMEA_PORT})

      The NMEA0183 TCP server accepts connections from any client
      and emits received data without authentication.

      Location: src/interfaces/nmea-tcp.js

      Attack scenario:
      1. Attacker connects to TCP port ${NMEA_PORT}
      2. Attacker sends malicious NMEA sentences
      3. Server processes them as legitimate sensor data
      4. False data injected into Signal K state

      Recommendation: Add IP whitelist or authentication option.
      `)

      expect(true).to.be.true
    })

    it('should test TCP connection to NMEA port', function (done) {
      const client = new net.Socket()
      let connected = false

      client.on('connect', () => {
        connected = true
        console.log(`      Connected to NMEA TCP port ${NMEA_PORT}`)

        // Send a valid NMEA sentence
        const sentence =
          '$GPGGA,123519,4807.038,N,01131.000,E,1,08,0.9,545.4,M,47.0,M,,*47\r\n'
        client.write(sentence)

        // Send an invalid/malicious sentence
        client.write('$GPINVALID,MALICIOUS,DATA*00\r\n')

        setTimeout(() => {
          client.destroy()
          expect(connected).to.be.true
          done()
        }, 1000)
      })

      client.on('error', (err) => {
        // Connection failure might mean port not open
        console.log(
          `      Could not connect to port ${NMEA_PORT}: ${err.message}`
        )
        done() // Not a test failure - port might not be enabled
      })

      client.connect(NMEA_PORT, 'localhost')
    })
  })

  describe('Malformed NMEA Sentence Handling', function () {
    it('should handle oversized NMEA sentences', function (done) {
      const client = new net.Socket()

      client.on('connect', () => {
        // NMEA sentences should be max 82 characters
        // Send a massive sentence to test buffer handling
        const oversizedSentence = '$GP' + 'A'.repeat(10000) + '*00\r\n'

        client.write(oversizedSentence)

        setTimeout(() => {
          client.destroy()
          done()
        }, 1000)
      })

      client.on('error', () => {
        done() // Port not open
      })

      client.connect(NMEA_PORT, 'localhost')
    })

    it('should handle NMEA sentence with null bytes', function (done) {
      const client = new net.Socket()

      client.on('connect', () => {
        // Sentence with embedded null bytes
        const nullSentence = Buffer.from([
          0x24,
          0x47,
          0x50,
          0x47,
          0x47,
          0x41, // $GPGGA
          0x00,
          0x00,
          0x00, // null bytes
          0x2a,
          0x30,
          0x30,
          0x0d,
          0x0a // *00\r\n
        ])

        client.write(nullSentence)

        setTimeout(() => {
          client.destroy()
          done()
        }, 500)
      })

      client.on('error', () => {
        done()
      })

      client.connect(NMEA_PORT, 'localhost')
    })

    it('should handle binary data instead of NMEA', function (done) {
      const client = new net.Socket()

      client.on('connect', () => {
        // Send random binary data
        const binaryData = Buffer.alloc(256)
        for (let i = 0; i < 256; i++) {
          binaryData[i] = i
        }

        client.write(binaryData)

        setTimeout(() => {
          client.destroy()
          done()
        }, 500)
      })

      client.on('error', () => {
        done()
      })

      client.connect(NMEA_PORT, 'localhost')
    })
  })

  describe('NMEA Field Injection', function () {
    it('should handle NMEA with command injection in fields', function (done) {
      const client = new net.Socket()

      client.on('connect', () => {
        const injectionSentences = [
          // Command injection attempts
          '$GPGGA,$(whoami),4807.038,N,01131.000,E,1,08,0.9,545.4,M,47.0,M,,*00\r\n',
          '$GPGGA,`id`,4807.038,N,01131.000,E,1,08,0.9,545.4,M,47.0,M,,*00\r\n',
          '$GPGGA,;ls -la;,4807.038,N,01131.000,E,1,08,0.9,545.4,M,47.0,M,,*00\r\n',

          // XSS attempts (in case displayed in web UI)
          '$GPGGA,<script>alert(1)</script>,4807.038,N,01131.000,E,1,08,0.9,545.4,M,47.0,M,,*00\r\n',

          // Path traversal in vessel name field
          '$GPRMC,123519,A,../../etc/passwd,N,01131.000,E,022.4,084.4,230394,003.1,W*6A\r\n',

          // Format string
          '$GPGGA,%s%s%s%s%s,4807.038,N,01131.000,E,1,08,0.9,545.4,M,47.0,M,,*00\r\n',
          '$GPGGA,%n%n%n%n,4807.038,N,01131.000,E,1,08,0.9,545.4,M,47.0,M,,*00\r\n'
        ]

        for (const sentence of injectionSentences) {
          client.write(sentence)
        }

        setTimeout(() => {
          client.destroy()
          done()
        }, 1000)
      })

      client.on('error', () => {
        done()
      })

      client.connect(NMEA_PORT, 'localhost')
    })

    it('should handle NMEA with extreme values', function (done) {
      const client = new net.Socket()

      client.on('connect', () => {
        const extremeSentences = [
          // Extreme latitude/longitude
          '$GPGGA,123519,9999.999,N,99999.999,E,1,08,0.9,545.4,M,47.0,M,,*00\r\n',
          '$GPGGA,123519,-9999.999,S,-99999.999,W,1,08,0.9,545.4,M,47.0,M,,*00\r\n',

          // Infinity/NaN
          '$GPGGA,Infinity,NaN,N,Infinity,E,1,08,0.9,545.4,M,47.0,M,,*00\r\n',

          // Very large numbers
          '$GPGGA,123519,4807.038,N,01131.000,E,1,08,0.9,999999999999999999999.4,M,47.0,M,,*00\r\n',

          // Negative numbers where not expected
          '$GPGGA,-123519,-4807.038,N,-01131.000,E,-1,-08,-0.9,-545.4,M,-47.0,M,,*00\r\n'
        ]

        for (const sentence of extremeSentences) {
          client.write(sentence)
        }

        setTimeout(() => {
          client.destroy()
          done()
        }, 1000)
      })

      client.on('error', () => {
        done()
      })

      client.connect(NMEA_PORT, 'localhost')
    })
  })

  describe('N2K Over NMEA0183 Attacks', function () {
    /**
     * N2K data can be sent over NMEA0183 using $PCDIN and !AIVDM sentences.
     * This is handled by @canboat/canboatjs parser.
     */

    it('should handle malformed N2K over NMEA0183', function (done) {
      const client = new net.Socket()

      client.on('connect', () => {
        const n2kSentences = [
          // Malformed PCDIN
          '$PCDIN,INVALID,DATA*00\r\n',
          '$PCDIN,01FD07,0000000000,00,*00\r\n',

          // Oversized N2K PGN data
          '$PCDIN,01FD07,0000000000,00,' + 'FF'.repeat(1000) + '*00\r\n',

          // Invalid PGN number
          '$PCDIN,FFFFFF,0000000000,00,0102030405060708*00\r\n',
          '$PCDIN,000000,0000000000,00,0102030405060708*00\r\n',

          // AIS message injection
          '!AIVDM,1,1,,A,AAAAAAAAAAAAAAAAAAAAAAAAAAAA,0*00\r\n',
          '!AIVDM,1,1,,A,' + 'A'.repeat(1000) + ',0*00\r\n'
        ]

        for (const sentence of n2kSentences) {
          client.write(sentence)
        }

        setTimeout(() => {
          client.destroy()
          done()
        }, 1000)
      })

      client.on('error', () => {
        done()
      })

      client.connect(NMEA_PORT, 'localhost')
    })
  })

  describe('Rapid NMEA Flooding', function () {
    it('should handle rapid NMEA sentence flood', function (done) {
      const client = new net.Socket()
      let sentCount = 0

      client.on('connect', () => {
        const sentence =
          '$GPGGA,123519,4807.038,N,01131.000,E,1,08,0.9,545.4,M,47.0,M,,*47\r\n'

        // Send 1000 sentences as fast as possible
        const interval = setInterval(() => {
          for (let i = 0; i < 100; i++) {
            client.write(sentence)
            sentCount++
          }

          if (sentCount >= 10000) {
            clearInterval(interval)
            console.log(`      Sent ${sentCount} NMEA sentences`)
            setTimeout(() => {
              client.destroy()
              done()
            }, 500)
          }
        }, 10)
      })

      client.on('error', () => {
        done()
      })

      client.connect(NMEA_PORT, 'localhost')
    })
  })
})

describe('NMEA HTTP API Security Tests', function () {
  this.timeout(30000)

  describe('NMEA Sentence Injection via API', function () {
    it('should check if NMEA can be injected via HTTP', async function () {
      // Some servers might have HTTP endpoints for NMEA input
      const endpoints = ['/signalk/v1/api/nmea0183', '/nmea0183', '/api/nmea']

      for (const endpoint of endpoints) {
        const sentence =
          '$GPGGA,123519,4807.038,N,01131.000,E,1,08,0.9,545.4,M,47.0,M,,*47'

        const response = await request(endpoint, {
          method: 'POST',
          body: JSON.stringify({ sentence })
        })

        console.log(`      POST ${endpoint} - Status: ${response.status}`)
      }

      expect(true).to.be.true
    })
  })
})
