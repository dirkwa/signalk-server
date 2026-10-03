import { expect } from 'chai'
import {
  associate,
  AssociationInput,
  AisVessel,
  ProviderContact,
  Observation
} from '../dist/api/targets/association.js'

const NOW = Date.parse('2026-10-03T12:00:00Z')
const OWN = { latitude: 52, longitude: 4 }
/** Metres per degree of latitude, near enough for placing test contacts. */
const M_PER_DEG = 111_195
const NORTH = 0
const SOUTH = Math.PI

/** A position `north` and `east` metres from own ship. */
const at = (north: number, east = 0) => ({
  latitude: OWN.latitude + north / M_PER_DEG,
  longitude:
    OWN.longitude +
    east / (M_PER_DEG * Math.cos((OWN.latitude * Math.PI) / 180))
})

const obs = (north: number, extra: Partial<Observation> = {}): Observation => ({
  position: at(north),
  courseOverGroundTrue: SOUTH,
  speedOverGround: 5,
  timeMs: NOW,
  ...extra
})

const ais = (mmsi: string, observation: Observation): AisVessel => ({
  vesselId: `urn:mrn:imo:mmsi:${mmsi}`,
  context: `vessels.urn:mrn:imo:mmsi:${mmsi}`,
  mmsi,
  observation
})

const contact = (
  provider: string,
  type: string,
  id: string,
  observation: Observation,
  extra: { mmsi?: string; name?: string } = {}
): ProviderContact => ({
  provider,
  contact: { id, type, position: observation.position, ...extra },
  observation
})

const radar = (id: string, observation: Observation, mmsi?: string) =>
  contact('mayara', 'radar', id, observation, mmsi ? { mmsi } : {})

const run = (input: Partial<AssociationInput>) =>
  associate({
    now: NOW,
    ownPosition: OWN,
    aisVessels: [],
    contacts: [],
    previous: new Map(),
    ...input
  })

describe('Targets association', () => {
  it('links a radar contact to the AIS vessel it sits on', () => {
    const { targets } = run({
      aisVessels: [ais('244060000', obs(2000))],
      contacts: [radar('r0:1', obs(2050))]
    })
    expect(targets).to.have.length(1)
    expect(targets[0].id).to.equal('urn:mrn:imo:mmsi:244060000')
    expect(targets[0].context).to.equal('vessels.urn:mrn:imo:mmsi:244060000')
    expect(targets[0].sources.map((s) => s.type)).to.deep.equal([
      'ais',
      'radar'
    ])
  })

  it('keeps a distant radar contact as its own target', () => {
    const { targets } = run({
      aisVessels: [ais('244060000', obs(2000))],
      contacts: [radar('r0:1', obs(4000))]
    })
    expect(targets.map((t) => t.id)).to.have.members([
      'urn:mrn:imo:mmsi:244060000',
      'radar:r0:1'
    ])
  })

  it('does not link contacts going different ways', () => {
    const { targets } = run({
      aisVessels: [ais('244060000', obs(2000))],
      contacts: [radar('r0:1', obs(2050, { courseOverGroundTrue: NORTH }))]
    })
    expect(targets).to.have.length(2)
  })

  it('does not link contacts at very different speeds', () => {
    const { targets } = run({
      aisVessels: [ais('244060000', obs(2000))],
      contacts: [radar('r0:1', obs(2050, { speedOverGround: 0.2 }))]
    })
    expect(targets).to.have.length(2)
  })

  it('compares AIS where it has moved to since its last report', () => {
    const minuteOld = obs(2300, { timeMs: NOW - 60_000 })
    const { targets } = run({
      aisVessels: [ais('244060000', minuteOld)],
      contacts: [radar('r0:1', obs(2000))]
    })
    expect(targets).to.have.length(1)
  })

  it('links by MMSI whatever the geometry says', () => {
    const { targets } = run({
      aisVessels: [ais('244060000', obs(2000)), ais('244070000', obs(3000))],
      contacts: [radar('r0:1', obs(3000), '244060000')]
    })
    const linked = targets.find((t) => t.id === 'urn:mrn:imo:mmsi:244060000')
    expect(linked?.sources).to.have.length(2)
    const other = targets.find((t) => t.id === 'urn:mrn:imo:mmsi:244070000')
    expect(other?.sources).to.have.length(1)
  })

  it('lets one radar claim an AIS vessel only once, closest first', () => {
    const { targets } = run({
      aisVessels: [ais('244060000', obs(2000))],
      contacts: [radar('r0:far', obs(2150)), radar('r0:near', obs(2020))]
    })
    const vessel = targets.find((t) => t.id === 'urn:mrn:imo:mmsi:244060000')
    expect(vessel?.sources.map((s) => s.id)).to.deep.equal([
      'urn:mrn:imo:mmsi:244060000',
      'r0:near'
    ])
    expect(targets.map((t) => t.id)).to.include('radar:r0:far')
  })

  it('merges radar and camera contacts of a boat without AIS', () => {
    const { targets } = run({
      contacts: [
        radar('r0:1', obs(1500)),
        contact('camera-plugin', 'camera', 'cam:7', obs(1530), {
          name: 'Sailing yacht'
        })
      ]
    })
    expect(targets).to.have.length(1)
    expect(targets[0].id).to.equal('radar:r0:1')
    expect(targets[0].name).to.equal('Sailing yacht')
    expect(targets[0].context).to.equal(undefined)
  })

  it('keeps a link a little beyond the distance it took to make it', () => {
    const vessel = [ais('244060000', obs(2000))]
    const drifted = [radar('r0:1', obs(2250))]
    expect(
      run({ aisVessels: vessel, contacts: drifted }).targets
    ).to.have.length(2)

    const { links } = run({
      aisVessels: vessel,
      contacts: [radar('r0:1', obs(2050))]
    })
    const { targets } = run({
      aisVessels: vessel,
      contacts: drifted,
      previous: links
    })
    expect(targets).to.have.length(1)
  })

  it('keeps a dark target id while the contact that named it is tracked', () => {
    const first = run({ contacts: [radar('r0:1', obs(1500))] })
    const { targets } = run({
      contacts: [
        contact('camera-plugin', 'camera', 'cam:7', obs(1510)),
        radar('r0:1', obs(1500))
      ],
      previous: first.links
    })
    expect(targets).to.have.length(1)
    expect(targets[0].id).to.equal('radar:r0:1')
  })

  it('takes position from AIS while it is recent, then from the sensor', () => {
    const vessel = (age: number) => [
      ais('244060000', obs(2000, { timeMs: NOW - age }))
    ]
    const contacts = [radar('r0:1', obs(2040))]

    const fresh = run({ aisVessels: vessel(10_000), contacts }).targets[0]
    expect(fresh.timestamp).to.equal(new Date(NOW - 10_000).toISOString())

    const stale = run({
      aisVessels: vessel(120_000),
      contacts: [radar('r0:1', obs(1440))]
    }).targets[0]
    expect(stale.sources).to.have.length(2)
    expect(stale.position).to.deep.equal(at(1440))
    expect(stale.timestamp).to.equal(new Date(NOW).toISOString())
  })
})
