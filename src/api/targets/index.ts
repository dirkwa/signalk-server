import {
  Position,
  SelfIdentity,
  Target,
  TargetContact
} from '@signalk/server-api'
import {
  IsoTimeSchema,
  PositionSchema,
  TargetContactSchema
} from '@signalk/server-api/typebox'
import { Value } from '@sinclair/typebox/value'
import { IRouter, Request, Response } from 'express'
import { createDebug } from '../../debug'
import { SignalKMessageHub } from '../../app'
import {
  AisVessel,
  associate,
  Observation,
  ProviderContact
} from './association'

const debug = createDebug('signalk-server:api:targets')

const TARGETS_API_PATH = `/signalk/v2/api/targets`

/** A contact its provider stops updating is dropped after this long. */
const CONTACT_MAX_AGE_MS = 60_000
/**
 * AIS vessels whose last position is older than this are not targets. Class A
 * ships at anchor report every three minutes, so this allows a few misses.
 */
const AIS_MAX_AGE_MS = 10 * 60_000

/** AIS motion reported further than this from its position is left out. */
const MOTION_MAX_LAG_MS = 60_000

const MMSI_URN = /^urn:mrn:imo:mmsi:(\d+)$/

export interface TargetsApplication
  extends IRouter, SignalKMessageHub, SelfIdentity {}

interface StoredContact extends ProviderContact {
  receivedAt: number
}

/**
 * Keeps the contacts provider plugins report and merges them with the AIS
 * vessels in the data model into one target list.
 *
 * Targets are computed when asked for rather than on every delta: consumers
 * poll at human time scales, and the data model already holds the latest AIS
 * state, so there is nothing to gain from work on the delta path.
 */
export class TargetsApi {
  private contacts = new Map<string, Map<string, StoredContact>>()
  private links: ReadonlyMap<string, string> = new Map()

  constructor(private app: TargetsApplication) {}

  async start() {
    this.initRoutes()
    return Promise.resolve()
  }

  updateContact(provider: string, contact: TargetContact): void {
    const problem = validateContact(contact)
    if (problem) {
      throw new Error(`Invalid target contact from ${provider}: ${problem}`)
    }
    const now = Date.now()
    const observedAt =
      contact.timestamp !== undefined ? Date.parse(contact.timestamp) : now
    let own = this.contacts.get(provider)
    if (!own) {
      own = new Map()
      this.contacts.set(provider, own)
    }
    own.set(contact.id, {
      provider,
      contact,
      observation: {
        position: contact.position,
        courseOverGroundTrue: contact.courseOverGroundTrue,
        speedOverGround: contact.speedOverGround,
        headingTrue: contact.headingTrue,
        timeMs: observedAt
      },
      receivedAt: now
    })
  }

  removeContact(provider: string, id: string): void {
    this.contacts.get(provider)?.delete(id)
  }

  /** Drops everything a provider reported, e.g. when its plugin stops. */
  removeProvider(provider: string): void {
    this.contacts.delete(provider)
  }

  getTargets(): Target[] {
    const now = Date.now()
    const { targets, links } = associate({
      now,
      ownPosition: this.ownPosition(),
      aisVessels: this.aisVessels(now),
      contacts: this.liveContacts(now),
      previous: this.links
    })
    this.links = links
    debug.enabled &&
      debug(`${targets.length} targets, ${links.size} contacts linked`)
    return targets
  }

  private liveContacts(now: number): ProviderContact[] {
    const live: ProviderContact[] = []
    for (const [provider, own] of this.contacts) {
      for (const [id, stored] of own) {
        if (now - stored.receivedAt > CONTACT_MAX_AGE_MS) {
          own.delete(id)
        } else {
          live.push(stored)
        }
      }
      if (own.size === 0) {
        this.contacts.delete(provider)
      }
    }
    return live
  }

  private ownPosition(): Position | undefined {
    const self = this.vessels()[this.app.selfId]
    const position = self?.navigation?.position?.value
    return isPosition(position) ? position : undefined
  }

  private aisVessels(now: number): AisVessel[] {
    const result: AisVessel[] = []
    for (const [vesselId, vessel] of Object.entries(this.vessels())) {
      if (vesselId === this.app.selfId) {
        continue
      }
      const observation = vesselObservation(vessel)
      if (!observation || now - observation.timeMs > AIS_MAX_AGE_MS) {
        continue
      }
      const mmsi =
        typeof vessel.mmsi === 'string'
          ? vessel.mmsi
          : MMSI_URN.exec(vesselId)?.[1]
      result.push({
        vesselId,
        context: `vessels.${vesselId}`,
        ...(typeof vessel.name === 'string' && { name: vessel.name }),
        ...(mmsi !== undefined && { mmsi }),
        observation
      })
    }
    return result
  }

  private vessels(): Record<string, VesselNode> {
    return (this.app.signalk.retrieve().vessels ?? {}) as Record<
      string,
      VesselNode
    >
  }

  private initRoutes() {
    this.app.get(TARGETS_API_PATH, (_req: Request, res: Response) => {
      const byId: Record<string, Target> = {}
      for (const target of this.getTargets()) {
        byId[target.id] = target
      }
      res.json(byId)
    })

    this.app.get(`${TARGETS_API_PATH}/:id`, (req: Request, res: Response) => {
      const target = this.getTargets().find((t) => t.id === req.params.id)
      if (target) {
        res.json(target)
      } else {
        res.status(404).json({
          state: 'FAILED',
          statusCode: 404,
          message: `Target ${req.params.id} not found`
        })
      }
    })
  }
}

/** The slice of a vessel in the full data model the Targets API reads. */
interface VesselNode {
  name?: unknown
  mmsi?: unknown
  navigation?: {
    position?: { value?: unknown; timestamp?: string }
    courseOverGroundTrue?: Leaf
    speedOverGround?: Leaf
    headingTrue?: Leaf
  }
}

interface Leaf {
  value?: unknown
  timestamp?: string
}

function vesselObservation(vessel: VesselNode): Observation | undefined {
  const nav = vessel.navigation
  const position = nav?.position?.value
  const timeMs = Date.parse(nav?.position?.timestamp ?? '')
  if (!isPosition(position) || Number.isNaN(timeMs)) {
    return undefined
  }
  return {
    position: { latitude: position.latitude, longitude: position.longitude },
    courseOverGroundTrue: motionAt(nav?.courseOverGroundTrue, timeMs),
    speedOverGround: motionAt(nav?.speedOverGround, timeMs),
    headingTrue: motionAt(nav?.headingTrue, timeMs),
    timeMs
  }
}

/**
 * A motion value, unless it was reported well apart from the position it would
 * be reported with: a target carries one timestamp, so a consumer could not
 * otherwise tell a course or speed from another time.
 */
function motionAt(leaf: Leaf | undefined, positionMs: number) {
  const timeMs = Date.parse(leaf?.timestamp ?? '')
  return Math.abs(positionMs - timeMs) <= MOTION_MAX_LAG_MS
    ? finite(leaf?.value)
    : undefined
}

const CONTACT_SCHEMA_REFS = [PositionSchema, IsoTimeSchema]

function validateContact(contact: TargetContact): string | undefined {
  if (contact?.type === 'ais') {
    return "type 'ais' is reserved for vessels in the data model"
  }
  const error = Value.Errors(
    TargetContactSchema,
    CONTACT_SCHEMA_REFS,
    contact
  ).First()
  return error && `${error.path || 'contact'}: ${error.message}`
}

function isPosition(value: unknown): value is Position {
  const p = value as Position | undefined
  return (
    typeof p === 'object' &&
    p !== null &&
    Number.isFinite(p.latitude) &&
    Number.isFinite(p.longitude)
  )
}

function finite(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}
