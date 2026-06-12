import { expect } from 'chai'
import * as http from 'http'
import { AddressInfo } from 'net'
import {
  assertAllowedHost,
  BlockedHostError,
  isBlockedAddress,
  isValidRequestId,
  ssrfSafeLookup
} from '../src/ssrfGuard'

describe('ssrfGuard', () => {
  describe('isBlockedAddress', () => {
    const blocked = [
      '127.0.0.1',
      '127.1.2.3',
      '0.0.0.0',
      '169.254.169.254', // AWS/GCP/Azure instance metadata
      '169.254.0.1',
      '224.0.0.1', // multicast
      '255.255.255.255', // broadcast
      '::1',
      '::',
      'fe80::1', // IPv6 link-local
      'ff02::1', // IPv6 multicast
      '::ffff:127.0.0.1', // IPv4-mapped loopback (bypass form)
      '::ffff:169.254.169.254' // IPv4-mapped metadata (bypass form)
    ]
    blocked.forEach((address) => {
      it(`blocks ${address}`, () => {
        expect(isBlockedAddress(address)).to.equal(true)
      })
    })

    const allowed = [
      '10.0.0.1', // RFC1918 - legitimate boat LAN
      '172.16.5.4', // RFC1918
      '192.168.1.50', // RFC1918
      '8.8.8.8', // public
      '2001:4860:4860::8888', // public IPv6
      'fc00::1', // IPv6 ULA - boat LAN equivalent
      'fd12:3456::1'
    ]
    allowed.forEach((address) => {
      it(`allows ${address}`, () => {
        expect(isBlockedAddress(address)).to.equal(false)
      })
    })

    it('does not block non-IP strings (resolution happens elsewhere)', () => {
      expect(isBlockedAddress('example.com')).to.equal(false)
    })
  })

  describe('assertAllowedHost', () => {
    // Node connects directly to IP literals without invoking the lookup, so
    // these must be caught synchronously.
    ;['127.0.0.1', '169.254.169.254', '::1', '::ffff:169.254.169.254'].forEach(
      (host) => {
        it(`throws for literal ${host}`, () => {
          expect(() => assertAllowedHost(host)).to.throw(BlockedHostError)
        })
      }
    )
    ;['192.168.1.50', '8.8.8.8', 'example.com'].forEach((host) => {
      it(`allows ${host}`, () => {
        expect(() => assertAllowedHost(host)).to.not.throw()
      })
    })
  })

  describe('ssrfSafeLookup', () => {
    const lookupAsync = (host: string): Promise<string> =>
      new Promise((resolve, reject) => {
        ssrfSafeLookup(host, { family: 4 }, (err, address) => {
          if (err) {
            reject(err)
          } else {
            resolve(address as string)
          }
        })
      })

    it('rejects a literal loopback address', async () => {
      try {
        await lookupAsync('127.0.0.1')
        expect.fail('expected lookup to be rejected')
      } catch (err) {
        expect(err).to.be.instanceOf(BlockedHostError)
      }
    })

    it('rejects the cloud metadata address', async () => {
      try {
        await lookupAsync('169.254.169.254')
        expect.fail('expected lookup to be rejected')
      } catch (err) {
        expect(err).to.be.instanceOf(BlockedHostError)
      }
    })

    it('resolves an allowed literal address unchanged', async () => {
      expect(await lookupAsync('192.168.1.50')).to.equal('192.168.1.50')
    })

    it('blocks an http.request to loopback when used as lookup', (done) => {
      const server = http.createServer((_req, res) => res.end('ok'))
      server.listen(0, '127.0.0.1', () => {
        const { port } = server.address() as AddressInfo
        const req = http.request(
          { hostname: 'localhost', port, lookup: ssrfSafeLookup },
          () => {
            server.close()
            done(new Error('request should not have connected'))
          }
        )
        req.on('error', (err) => {
          server.close()
          try {
            expect(err).to.be.instanceOf(BlockedHostError)
            done()
          } catch (e) {
            done(e)
          }
        })
        req.end()
      })
    })
  })

  describe('isValidRequestId', () => {
    it('accepts a v4 UUID', () => {
      expect(isValidRequestId('b3c1d2e4-5f6a-4b8c-9d0e-1f2a3b4c5d6e')).to.equal(
        true
      )
    })

    const invalid = [
      '../../latest/meta-data/iam/security-credentials/role',
      '..%2f..%2fadmin',
      'not-a-uuid',
      'b3c1d2e4-5f6a-4b8c-9d0e-1f2a3b4c5d6e/extra',
      '',
      42,
      null,
      undefined
    ]
    invalid.forEach((value) => {
      it(`rejects ${JSON.stringify(value)}`, () => {
        expect(isValidRequestId(value)).to.equal(false)
      })
    })
  })
})
