import { expect } from 'chai'
import { SERVER_START_TIMEOUT, startServer } from './ts-servertestutilities'

type Server = Awaited<ReturnType<typeof startServer>>

const VESSEL = 'urn:mrn:imo:mmsi:244060000'

describe('Targets API', () => {
  let server: Server

  before(async function () {
    this.timeout(SERVER_START_TIMEOUT)
    server = await startServer()
    await server.sendADelta({
      context: `vessels.${VESSEL}`,
      updates: [
        {
          timestamp: new Date().toISOString(),
          values: [
            { path: '', value: { name: 'Nordic Star' } },
            {
              path: 'navigation.position',
              value: { latitude: 52.018, longitude: 4 }
            },
            { path: 'navigation.courseOverGroundTrue', value: Math.PI },
            { path: 'navigation.speedOverGround', value: 5 }
          ]
        }
      ]
    })
  })

  after(async () => {
    await server.stop()
  })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const targetsApi = () => (server.server.app as any).targetsApi

  it('lists AIS vessels as targets', async () => {
    const res = await server.get('/targets')
    expect(res.status).to.equal(200)
    const targets = await res.json()
    expect(targets[VESSEL]).to.include({
      id: VESSEL,
      context: `vessels.${VESSEL}`,
      name: 'Nordic Star',
      mmsi: '244060000'
    })
  })

  it('folds a sensor contact on that vessel into its target', async () => {
    targetsApi().updateContact('test-radar', {
      id: 'radar-0:17',
      type: 'radar',
      position: { latitude: 52.0182, longitude: 4.0001 },
      courseOverGroundTrue: Math.PI,
      speedOverGround: 5.2
    })
    const res = await server.get(`/targets/${encodeURIComponent(VESSEL)}`)
    expect(res.status).to.equal(200)
    const target = await res.json()
    expect(target.sources.map((s: { type: string }) => s.type)).to.deep.equal([
      'ais',
      'radar'
    ])
    const all = await (await server.get('/targets')).json()
    expect(Object.keys(all)).to.deep.equal([VESSEL])
  })

  it('drops a contact its provider removes', async () => {
    targetsApi().removeContact('test-radar', 'radar-0:17')
    const target = await (
      await server.get(`/targets/${encodeURIComponent(VESSEL)}`)
    ).json()
    expect(target.sources).to.have.length(1)
  })

  it('leaves out AIS motion much older than the position', async () => {
    const other = 'urn:mrn:imo:mmsi:244070000'
    const old = new Date(Date.now() - 5 * 60_000).toISOString()
    await server.sendADelta({
      context: `vessels.${other}`,
      updates: [
        {
          timestamp: old,
          values: [{ path: 'navigation.speedOverGround', value: 7 }]
        },
        {
          timestamp: new Date().toISOString(),
          values: [
            {
              path: 'navigation.position',
              value: { latitude: 52.5, longitude: 4 }
            },
            { path: 'navigation.courseOverGroundTrue', value: 1 }
          ]
        }
      ]
    })
    const target = await (
      await server.get(`/targets/${encodeURIComponent(other)}`)
    ).json()
    expect(target.courseOverGroundTrue).to.equal(1)
    expect(target).not.to.have.property('speedOverGround')
  })

  it('leaves out AIS motion much newer than the position', async () => {
    const other = 'urn:mrn:imo:mmsi:244080000'
    await server.sendADelta({
      context: `vessels.${other}`,
      updates: [
        {
          timestamp: new Date(Date.now() - 5 * 60_000).toISOString(),
          values: [
            {
              path: 'navigation.position',
              value: { latitude: 52.6, longitude: 4 }
            }
          ]
        },
        {
          timestamp: new Date().toISOString(),
          values: [{ path: 'navigation.speedOverGround', value: 7 }]
        }
      ]
    })
    const target = await (
      await server.get(`/targets/${encodeURIComponent(other)}`)
    ).json()
    expect(target).not.to.have.property('speedOverGround')
  })

  it('answers 404 for an unknown target', async () => {
    const res = await server.get('/targets/radar:nope')
    expect(res.status).to.equal(404)
  })

  it('rejects a contact that claims to be AIS', () => {
    expect(() =>
      targetsApi().updateContact('test-radar', {
        id: 'x',
        type: 'ais',
        position: { latitude: 52, longitude: 4 }
      })
    ).to.throw(/reserved/)
  })

  it('rejects contacts with malformed optional fields', () => {
    const base = {
      id: 'x',
      type: 'camera',
      position: { latitude: 52, longitude: 4 }
    }
    expect(() =>
      targetsApi().updateContact('test-radar', {
        ...base,
        speedOverGround: NaN
      })
    ).to.throw(/speedOverGround/)
    expect(() =>
      targetsApi().updateContact('test-radar', { ...base, confidence: 2 })
    ).to.throw(/confidence/)
    expect(() =>
      targetsApi().updateContact('test-radar', { ...base, confidence: '0.5' })
    ).to.throw(/confidence/)
    expect(() =>
      targetsApi().updateContact('test-radar', { ...base, mmsi: 244060000 })
    ).to.throw(/mmsi/)
  })

  it('serves its OpenAPI description', async () => {
    const res = await fetch(`${server.host}/skServer/openapi/targets`)
    expect(res.status).to.equal(200)
  })
})
