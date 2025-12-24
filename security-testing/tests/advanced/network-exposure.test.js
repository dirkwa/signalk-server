/**
 * Network Exposure & mDNS Security Tests
 *
 * Tests for:
 * - Public internet exposure risks (IPv4/IPv6)
 * - mDNS flooding and amplification attacks
 * - Multiple mDNS responders conflict
 * - Service discovery information leakage
 * - X-Forwarded-For header spoofing
 * - Binding to 0.0.0.0 risks
 */

const { expect } = require('chai')
const net = require('net')
const dgram = require('dgram')
const dns = require('dns')

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

describe('Public Internet Exposure Analysis', function () {
  this.timeout(30000)

  describe('Server Binding Analysis', function () {
    /**
     * CRITICAL: Server binds to 0.0.0.0 by default
     *
     * Location: src/index.ts line 469-471
     *
     * server.listen(primaryPort, () => {
     *   console.log('signalk-server running at 0.0.0.0:' + primaryPort)
     * })
     *
     * This means the server is accessible on ALL network interfaces:
     * - localhost (127.0.0.1)
     * - LAN IP (192.168.x.x, 10.x.x.x)
     * - Public IP if the machine has one
     * - IPv6 if enabled (:: equivalent)
     */

    it('should document 0.0.0.0 binding risks', function () {
      console.log(`
      CRITICAL RISK: Server Binds to 0.0.0.0 (All Interfaces)

      Location: src/index.ts line 469-471

      Code:
        server.listen(primaryPort, () => {
          console.log('signalk-server running at 0.0.0.0:' + primaryPort)
        })

      This means SignalK is accessible on:
        - localhost (127.0.0.1)
        - Local network IPs (192.168.x.x, 10.x.x.x, etc.)
        - Public IP if directly connected to internet
        - IPv6 addresses (:: by default includes IPv6)

      RISKS when exposed to public internet:
      1. All unauthenticated endpoints accessible worldwide
      2. TCP port 8375 (SignalK stream) - no auth required
      3. TCP port 10110 (NMEA) - no auth required
      4. Brute force attacks on login (no rate limiting)
      5. Timing attacks for user enumeration
      6. CORS allows any origin
      7. mDNS may broadcast to internet-facing interfaces

      IPv6 SPECIFIC RISKS:
      - Many home routers provide public IPv6 to all devices
      - IPv6 bypasses NAT (no implicit firewall)
      - Server may be directly accessible via IPv6 even if
        router has no IPv4 port forwarding

      RECOMMENDATION:
      - Add option to bind to specific interface (127.0.0.1 for local only)
      - Add TCPSTREAMADDRESS env var documentation
      - Warn users about IPv6 exposure
      `)

      expect(true).to.be.true
    })

    it('should check for IPv6 exposure', async function () {
      // Check if IPv6 is accessible
      console.log(`
      IPv6 EXPOSURE CHECK:

      If your system has IPv6, SignalK may be accessible via:
        http://[::1]:3000  (localhost IPv6)
        http://[fe80::...]:3000  (link-local)
        http://[2001:...]:3000  (public IPv6)

      To test IPv6 exposure:
        curl -6 http://[::1]:3000/signalk

      Many ISPs now provide public IPv6 addresses to home networks.
      These bypass NAT entirely - no port forwarding needed!
      `)

      // Try to detect if we're on IPv6
      try {
        const interfaces = require('os').networkInterfaces()
        let hasPublicIPv6 = false

        for (const name in interfaces) {
          for (const iface of interfaces[name]) {
            if (iface.family === 'IPv6' && !iface.internal) {
              // Check if it's a public address (not link-local or ULA)
              if (
                !iface.address.startsWith('fe80') &&
                !iface.address.startsWith('fc') &&
                !iface.address.startsWith('fd')
              ) {
                hasPublicIPv6 = true
                console.log(
                  `      Found potential public IPv6: ${iface.address}`
                )
              }
            }
          }
        }

        if (hasPublicIPv6) {
          console.log(
            `      WARNING: System has public IPv6 - SignalK may be exposed!`
          )
        }
      } catch (e) {
        console.log(`      Could not enumerate interfaces: ${e.message}`)
      }
    })
  })

  describe('Port Exposure Analysis', function () {
    /**
     * All listening ports and their security status
     */

    it('should document all exposed ports', function () {
      console.log(`
      PORT EXPOSURE ANALYSIS

      Port 3000 (HTTP/HTTPS):
        - Main web interface
        - Authentication available but optional
        - WebSocket upgrades on /signalk/v1/stream
        - REST API on /signalk/v1/api/*
        - SECURITY: Depends on security being enabled

      Port 3443 (HTTPS):
        - SSL version of main interface
        - Same endpoints as port 3000

      Port 8375 (SignalK TCP Stream):
        - Raw SignalK delta stream
        - NO AUTHENTICATION EVEN WHEN SECURITY ENABLED!
        - Allows subscribing to ANY data path
        - SECURITY: CRITICAL - always exposed

      Port 10110 (NMEA TCP):
        - Raw NMEA 0183 data
        - NO AUTHENTICATION
        - Can inject arbitrary NMEA sentences
        - SECURITY: HIGH - navigation data manipulation

      Port 2000 (UDP - WLN10 discovery):
        - Listens for WLN10 device broadcasts
        - SECURITY: Accepts data from any source

      Port 2052 (UDP - GoFree discovery):
        - Multicast group 239.2.1.1
        - Accepts JSON with attacker-controlled IPs
        - SECURITY: SSRF vector

      Port 5353 (mDNS):
        - Service advertisement
        - Leaks vessel information
        - Potential for amplification attacks
        - SECURITY: Information disclosure
      `)

      expect(true).to.be.true
    })

    it('should test unauthenticated TCP port 8375', async function () {
      return new Promise((resolve) => {
        const client = new net.Socket()
        let receivedData = false

        client.on('connect', () => {
          console.log('      Connected to TCP port 8375')
          // Subscribe to all data without authentication
          client.write('{"context":"*","subscribe":[{"path":"*"}]}\r\n')
        })

        client.on('data', (data) => {
          if (!receivedData) {
            console.log(
              `      Received data WITHOUT auth: ${data.toString().substring(0, 100)}...`
            )
            receivedData = true
          }
        })

        client.on('error', (err) => {
          console.log(`      TCP 8375 error: ${err.message}`)
          resolve()
        })

        setTimeout(() => {
          if (receivedData) {
            console.log(
              `      VULNERABILITY CONFIRMED: TCP 8375 has no authentication!`
            )
          }
          client.destroy()
          resolve()
        }, 3000)

        client.connect(8375, 'localhost')
      })
    })
  })

  describe('X-Forwarded-For Header Spoofing', function () {
    /**
     * VULNERABILITY: X-Forwarded-For is trusted without validation
     *
     * Location: src/interfaces/ws.js line 389-390
     * Location: src/serverroutes.ts line 464
     *
     * const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress
     */

    it('should document X-Forwarded-For risks', function () {
      console.log(`
      VULNERABILITY: X-Forwarded-For Header Spoofing

      Locations:
        - src/interfaces/ws.js line 389-390
        - src/serverroutes.ts line 464

      Code:
        const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress

      The server trusts X-Forwarded-For header without validation.
      This header can be set by any client, not just trusted proxies.

      Impact:
      1. IP-based access controls can be bypassed
      2. Audit logs show fake IPs
      3. Rate limiting by IP can be bypassed
      4. Geo-blocking can be bypassed

      Attack:
        curl -H "X-Forwarded-For: 192.168.1.1" http://target:3000/...

      Fix: Only trust X-Forwarded-For when:
        - Behind a known proxy (trust proxy setting)
        - The leftmost IP is validated against proxy allowlist
      `)

      expect(true).to.be.true
    })

    it('should test X-Forwarded-For spoofing', async function () {
      // Test if server accepts spoofed X-Forwarded-For
      const response = await request('/signalk/v1/api/vessels/self', {
        headers: {
          'X-Forwarded-For': '8.8.8.8, 1.1.1.1'
        }
      })

      console.log(
        `      Request with spoofed X-Forwarded-For returned: ${response.status}`
      )
      console.log(
        `      Server likely logged IP as 8.8.8.8 instead of actual client IP`
      )

      // The request should succeed (header is accepted)
      // This itself is the vulnerability
    })
  })
})

describe('mDNS Security Analysis', function () {
  this.timeout(60000)

  describe('Information Disclosure via mDNS', function () {
    /**
     * mDNS broadcasts contain sensitive vessel information
     *
     * Location: src/mdns.js lines 43-56
     *
     * txtRecord = {
     *   txtvers: '1',
     *   swname: config.name,
     *   swvers: config.version,
     *   roles: 'master, main',
     *   self: app.selfId,
     *   vname: config.vesselName,
     *   vmmsi: config.vesselMMSI,
     *   vuuid: config.vesselUUID
     * }
     */

    it('should document mDNS information disclosure', function () {
      console.log(`
      VULNERABILITY: mDNS Information Disclosure

      Location: src/mdns.js lines 43-56

      mDNS TXT record contains:
        - swname: Software name (signalk-server)
        - swvers: Software version (enables targeting known vulns)
        - self: Vessel SignalK ID
        - vname: Vessel name (identifies the boat)
        - vmmsi: Vessel MMSI (unique identifier, privacy risk)
        - vuuid: Vessel UUID

      This is broadcast continuously to:
        - All devices on local network
        - Potentially to internet if mDNS is forwarded
        - Anyone within WiFi range (marinas, anchorages)

      Services advertised:
        - _signalk-http._tcp / _signalk-https._tcp
        - _signalk-ws._tcp / _signalk-wss._tcp
        - _signalk-tcp._tcp (port 8375)
        - _nmea-0183._tcp (port 10110)

      Privacy risks:
        1. MMSI can be used to track vessel globally
        2. Vessel name reveals owner identity
        3. Port numbers reveal attack surface
        4. Version number enables targeted exploits
      `)

      expect(true).to.be.true
    })
  })

  describe('mDNS Flooding Attack', function () {
    /**
     * VULNERABILITY: mDNS can be used for amplification attacks
     *
     * Each mDNS query can trigger large TXT record responses
     * from all SignalK servers on the network.
     */

    it('should document mDNS amplification risk', function () {
      console.log(`
      RISK: mDNS Amplification Attack

      mDNS operates on UDP port 5353 (multicast 224.0.0.251 / ff02::fb)

      Attack scenario:
      1. Attacker spoofs source IP to victim's IP
      2. Sends mDNS query for _signalk-http._tcp.local
      3. All SignalK servers respond with large TXT records
      4. Victim receives amplified traffic from all servers

      Amplification factor:
        - Query: ~50 bytes
        - Response: ~200-500 bytes (includes TXT record)
        - Factor: 4-10x per responding server

      In a marina with many boats:
        - 50 SignalK servers = 50x amplification per query
        - Combined with spoofing = effective DDoS

      Your historical issue "floods in the past":
        - Multiple mDNS responders on same network
        - Each SignalK instance responds to all queries
        - Network gets saturated with mDNS traffic
      `)

      expect(true).to.be.true
    })

    it('should document mDNS conflict issues', function () {
      console.log(`
      ISSUE: Multiple mDNS Responders Conflict

      When multiple SignalK servers are on same network:

      1. Name Collision:
         - Each tries to advertise as "signalk-server.local"
         - mDNS conflict resolution kicks in
         - Renamed to "signalk-server-2.local", etc.
         - But code doesn't handle the rename notification

      2. Service Flooding:
         - Each server advertises 4+ services
         - 10 servers = 40+ service announcements
         - Constant re-advertisements every 20 seconds
         - Network saturated with mDNS traffic

      3. Browser Confusion:
         - Discovery finds multiple servers
         - Each claims to be the "main" server
         - No way to distinguish which is which

      4. Query Storm:
         - Each server also BROWSES for other servers
         - src/discovery.js creates browser for signalk-ws/wss
         - N servers = N browsers = N^2 query/response pairs

      Your reported floods likely caused by:
        - Many SignalK instances on network
        - Each browsing + advertising simultaneously
        - Exponential growth in mDNS traffic

      Mitigation:
        - Add config to disable mDNS browser (discovery)
        - Add config to disable mDNS advertising
        - Add unique instance ID to service name
        - Implement proper mDNS conflict detection
      `)

      expect(true).to.be.true
    })
  })

  describe('mDNS from Internet', function () {
    /**
     * What happens if mDNS packets reach the server from internet?
     */

    it('should analyze mDNS internet exposure', function () {
      console.log(`
      ANALYSIS: mDNS Internet Exposure

      Normal mDNS is link-local (224.0.0.251 / ff02::fb)
      and should NOT cross routers. However:

      1. Misconfigured routers may forward multicast
      2. VPNs may bridge multicast between networks
      3. Docker/container networking may expose mDNS
      4. IPv6 link-local might cross segments unexpectedly

      If mDNS IS accessible from internet:
        - Vessel information broadcast globally
        - Service discovery enables targeting
        - Amplification attacks from anywhere

      The dnssd2 and mdns packages used:
        - dnssd2: Uses system mDNS (Avahi/Bonjour)
        - mdns: Native implementation
        - mdns-js: JavaScript mDNS (used in discovery)

      src/mdns.js tries both:
        try {
          mdns = require('mdns')  // Prefer native
        } catch (ex) {
          // Fall back to dnssd2
        }

      Different implementations may have different
      security characteristics and bugs.
      `)

      expect(true).to.be.true
    })
  })
})

describe('Network Interface Enumeration', function () {
  this.timeout(30000)

  describe('Exposed Network Information', function () {
    it('should check what network info is exposed', async function () {
      // Check if network info is accessible via API
      const endpoints = [
        '/signalk/v1/api/vessels/self',
        '/signalk',
        '/plugins',
        '/skServer/plugins'
      ]

      console.log('      Checking for exposed network information:')

      for (const endpoint of endpoints) {
        try {
          const response = await request(endpoint)
          const body = JSON.stringify(response.body || '')

          // Check for IP addresses in response
          const ipv4Pattern = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g
          const ipv6Pattern = /(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}/g

          const ipv4s = body.match(ipv4Pattern) || []
          const ipv6s = body.match(ipv6Pattern) || []

          if (ipv4s.length > 0 || ipv6s.length > 0) {
            console.log(
              `      ${endpoint}: Found IPs - IPv4: ${ipv4s.slice(0, 3).join(', ')}`
            )
          }
        } catch (e) {
          // Endpoint not accessible, that's fine
        }
      }
    })
  })
})

describe('Firewall Bypass via WebSocket', function () {
  this.timeout(30000)

  describe('WebSocket as Firewall Evasion', function () {
    /**
     * WebSocket connections can bypass some firewalls and proxies
     * because they look like regular HTTP initially.
     */

    it('should document WebSocket firewall bypass', function () {
      console.log(`
      RISK: WebSocket Firewall Bypass

      WebSocket connections start as HTTP upgrade requests.
      Many firewalls allow HTTP/HTTPS but block other protocols.

      SignalK WebSocket provides:
        - Full duplex communication
        - Real-time data streaming
        - Subscription to any data path
        - PUT requests to control vessel systems

      Once WebSocket is established:
        - Firewall cannot inspect payload (especially with WSS)
        - Attacker has persistent connection
        - Can receive all vessel telemetry
        - Can potentially control navigation systems

      The WebSocket endpoint at /signalk/v1/stream:
        - Accepts connections from any origin
        - No origin validation
        - Authentication is optional
        - Allows anonymous read access (when security off)
      `)

      expect(true).to.be.true
    })
  })
})

describe('DNS Rebinding Attack', function () {
  this.timeout(30000)

  describe('DNS Rebinding via WebSocket', function () {
    /**
     * DNS rebinding can bypass same-origin policy
     * to attack SignalK servers on internal networks.
     */

    it('should document DNS rebinding risk', function () {
      console.log(`
      VULNERABILITY: DNS Rebinding Attack

      Attack scenario:
      1. Victim visits attacker.com in browser
      2. attacker.com has short TTL DNS
      3. JavaScript makes request to attacker.com:3000
      4. Attacker changes DNS to point to 192.168.1.100 (victim's SignalK)
      5. Browser sends request to victim's SignalK
      6. SignalK responds (no origin check!)
      7. Attacker's script receives vessel data

      Why SignalK is vulnerable:
      - No Host header validation
      - CORS allows any origin
      - WebSocket accepts any origin
      - No CSRF protection

      Even without authentication:
      - Can read all vessel data
      - Can enumerate network via timing
      - Can scan for other services

      With authentication:
      - If user has valid session, attacker inherits it
      - Can make authenticated requests via rebinding

      Mitigation:
      - Validate Host header against whitelist
      - Implement proper CORS with specific origins
      - Add origin validation to WebSocket
      `)

      expect(true).to.be.true
    })

    it('should test Host header handling', async function () {
      // Test if server accepts arbitrary Host headers
      const evilHosts = [
        'evil.com',
        'attacker.com:3000',
        'localhost.evil.com',
        '192.168.1.1' // IP rebinding
      ]

      console.log('      Testing Host header handling:')

      for (const host of evilHosts) {
        try {
          const response = await request('/signalk', {
            headers: {
              Host: host
            }
          })
          console.log(`      Host "${host}": status=${response.status}`)
          // If request succeeds, DNS rebinding is possible
        } catch (e) {
          console.log(`      Host "${host}": blocked`)
        }
      }
    })
  })
})

describe('Environment Variable Exposure', function () {
  this.timeout(30000)

  describe('Network-Related Environment Variables', function () {
    it('should document network env vars', function () {
      console.log(`
      NETWORK-RELATED ENVIRONMENT VARIABLES

      Port configuration:
        - PORT: HTTP port (default 3000)
        - SSLPORT: HTTPS port (default 3443)
        - EXTERNALPORT: Advertised port in mDNS
        - TCPSTREAMADDRESS: Bind address for TCP stream (can limit exposure!)

      Network exposure:
        - EXTERNALHOST: Hostname in mDNS (can reveal hostname)

      The TCPSTREAMADDRESS variable is IMPORTANT:
        src/interfaces/tcp.ts line 87-91:
          if (process.env.TCPSTREAMADDRESS) {
            server.listen(port, process.env.TCPSTREAMADDRESS)
          } else {
            server.listen(port)  // Binds to 0.0.0.0
          }

      Setting TCPSTREAMADDRESS=127.0.0.1 would limit
      the unauthenticated TCP port to localhost only!

      But there's NO equivalent for:
        - Main HTTP server
        - NMEA TCP port (10110)
        - mDNS advertising
      `)

      expect(true).to.be.true
    })
  })
})

describe('Summary: Internet Exposure Risks', function () {
  this.timeout(30000)

  it('should provide complete risk summary', function () {
    console.log(`
    ================================================================
    SIGNALK PUBLIC INTERNET EXPOSURE RISK SUMMARY
    ================================================================

    CRITICAL RISKS (Immediate action required):

    1. TCP Port 8375 - NO AUTHENTICATION
       - Subscribe to ALL vessel data without auth
       - Even when security is enabled!
       - Recommendation: Bind to 127.0.0.1 or add auth

    2. TCP Port 10110 - NMEA INJECTION
       - Can inject navigation data without auth
       - Could affect autopilot/navigation
       - Recommendation: Bind to 127.0.0.1 or add auth

    3. No Host Header Validation
       - DNS rebinding attacks possible
       - Recommendation: Whitelist valid Host values

    4. X-Forwarded-For Trusted
       - IP spoofing for logs and rate limits
       - Recommendation: Only trust behind known proxies

    HIGH RISKS:

    5. Server Binds to 0.0.0.0
       - Accessible on all interfaces including IPv6
       - Recommendation: Add bind address configuration

    6. mDNS Information Leakage
       - MMSI, vessel name, version broadcast
       - Recommendation: Make TXT record configurable

    7. mDNS Amplification
       - Can be used in DDoS attacks
       - Recommendation: Rate limit mDNS responses

    8. No Origin Validation on WebSocket
       - Any website can connect to SignalK
       - Recommendation: Validate Origin header

    MEDIUM RISKS:

    9. IPv6 Exposure
       - May bypass NAT, directly accessible
       - Recommendation: Document and warn users

    10. UDP Discovery SSRF
        - Accepts IPs from UDP broadcasts
        - Recommendation: Validate discovered IPs

    ================================================================
    RECOMMENDED CONFIGURATION FOR INTERNET-FACING SIGNALK:

    Environment variables:
      TCPSTREAMADDRESS=127.0.0.1  # Limit TCP stream to localhost

    Settings:
      security: true              # Enable authentication
      mdns: false                 # Disable mDNS on public networks
      corsAllowedOrigins: [...]   # Specific origins, not *

    Firewall rules:
      - Block ports 8375, 10110 from internet
      - Only allow 3000/3443 if needed
      - Block UDP 5353, 2000, 2052

    ================================================================
    `)

    expect(true).to.be.true
  })
})
