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

  it('serves its OpenAPI description', async () => {
    const res = await fetch(`${server.host}/skServer/openapi/targets`)
    expect(res.status).to.equal(200)
  })
})
