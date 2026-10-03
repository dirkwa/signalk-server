import {
  Position,
  Target,
  TargetContact,
  TargetSource
} from '@signalk/server-api'

/**
 * Decides which sensor contacts are the same object.
 *
 * AIS vessels anchor the picture because they carry identity. A non-AIS contact
 * joins an AIS vessel when it says so through its MMSI, or when the AIS
 * position, extrapolated to the contact's time, lies within a distance gate and
 * the two agree on course and speed. Contacts no AIS vessel claims are grouped
 * with each other the same way, so a radar track and a camera detection of one
 * dark boat are still one target.
 *
 * A link, once made, is kept with a wider gate than it took to make it, so a
 * target near the threshold does not split and merge on every evaluation.
 */

/** Gate radius near own ship, covering GPS, antenna offset and timing errors. */
const MIN_GATE_M = 200
/**
 * Radar bearing error grows with range (1° is 17 m per km), so the gate widens
 * with the contact's distance from own ship.
 */
const GATE_RANGE_FRACTION = 0.05
/** An existing link survives until the gap exceeds this multiple of the gate. */
const KEEP_GATE_FACTOR = 1.5
/** Below this speed a course is noise and is not compared. */
const COURSE_MIN_SPEED = 1
const MAX_COURSE_DIFF = Math.PI / 4
const MIN_SPEED_TOLERANCE = 1.5
const SPEED_TOLERANCE_FRACTION = 0.5
/** AIS stays the target's kinematic source while its report is this fresh. */
const AIS_PREFERRED_AGE_MS = 60_000

const EARTH_RADIUS_M = 6371000

export interface Observation {
  position: Position
  courseOverGroundTrue?: number
  speedOverGround?: number
  headingTrue?: number
  timeMs: number
}

export interface AisVessel {
  vesselId: string
  context: string
  name?: string
  mmsi?: string
  observation: Observation
}

export interface ProviderContact {
  provider: string
  contact: TargetContact
  observation: Observation
}

export interface AssociationInput {
  now: number
  ownPosition?: Position
  aisVessels: AisVessel[]
  contacts: ProviderContact[]
  /** Target id each contact belonged to last time, by {@link contactKey}. */
  previous: ReadonlyMap<string, string>
}

export interface AssociationResult {
  targets: Target[]
  links: Map<string, string>
}

export function contactKey(provider: string, id: string): string {
  return `${provider}\u0000${id}`
}

interface Group {
  id: string
  ais?: AisVessel
  /** The observation new members are gated against. */
  reference: Observation
  members: ProviderContact[]
  providers: Set<string>
}

interface Candidate {
  contact: ProviderContact
  group: Group
  cost: number
}

export function associate(input: AssociationInput): AssociationResult {
  const groups: Group[] = input.aisVessels.map((ais) => ({
    id: ais.vesselId,
    ais,
    reference: ais.observation,
    members: [],
    providers: new Set()
  }))
  const takenIds = new Set(groups.map((g) => g.id))

  const unassigned = assignGreedily(input.contacts, groups, input)

  // Contacts that kept their previous target come first, so the target keeps
  // the id it had when the contact that named it is still around.
  const remaining = [...unassigned].sort(
    (a, b) =>
      Number(hasPreviousId(b, input, takenIds)) -
      Number(hasPreviousId(a, input, takenIds))
  )
  const darkGroups: Group[] = []
  for (const contact of remaining) {
    const [leftOver] = assignGreedily([contact], darkGroups, input)
    if (leftOver) {
      darkGroups.push(newDarkGroup(leftOver, input, takenIds))
    }
  }

  const links = new Map<string, string>()
  const targets: Target[] = []
  for (const group of [...groups, ...darkGroups]) {
    if (!group.ais && group.members.length === 0) {
      continue
    }
    for (const member of group.members) {
      links.set(contactKey(member.provider, member.contact.id), group.id)
    }
    targets.push(toTarget(group, input.now))
  }
  return { targets, links }
}

/**
 * Assigns contacts to groups cheapest pair first, at most one contact per
 * provider in each group: one sensor does not see the same boat twice.
 * Returns the contacts left over.
 */
function assignGreedily(
  contacts: ProviderContact[],
  groups: Group[],
  input: AssociationInput
): ProviderContact[] {
  const candidates: Candidate[] = []
  for (const contact of contacts) {
    for (const group of groups) {
      const cost = matchCost(contact, group, input)
      if (cost !== undefined) {
        candidates.push({ contact, group, cost })
      }
    }
  }
  candidates.sort((a, b) => a.cost - b.cost)

  const assigned = new Set<ProviderContact>()
  for (const { contact, group } of candidates) {
    if (assigned.has(contact) || group.providers.has(contact.provider)) {
      continue
    }
    group.members.push(contact)
    group.providers.add(contact.provider)
    assigned.add(contact)
  }
  return contacts.filter((c) => !assigned.has(c))
}

/**
 * How well a contact fits a group, lower is better, or `undefined` when it
 * cannot belong to it. A matching MMSI beats any geometric match.
 */
function matchCost(
  { contact, provider, observation }: ProviderContact,
  group: Group,
  input: AssociationInput
): number | undefined {
  if (contact.mmsi !== undefined && group.ais?.mmsi !== undefined) {
    return contact.mmsi === group.ais.mmsi ? -1 : undefined
  }
  const wasLinked =
    input.previous.get(contactKey(provider, contact.id)) === group.id
  const gate =
    gateRadius(observation.position, input.ownPosition) *
    (wasLinked ? KEEP_GATE_FACTOR : 1)
  const expected = extrapolate(group.reference, observation.timeMs)
  const gap = distance(expected, observation.position)
  if (gap > gate || !motionAgrees(group.reference, observation, wasLinked)) {
    return undefined
  }
  return gap / gate - (wasLinked ? 1 : 0)
}

function gateRadius(position: Position, ownPosition?: Position): number {
  if (!ownPosition) {
    return MIN_GATE_M
  }
  return Math.max(
    MIN_GATE_M,
    distance(position, ownPosition) * GATE_RANGE_FRACTION
  )
}

function motionAgrees(
  a: Observation,
  b: Observation,
  lenient: boolean
): boolean {
  const factor = lenient ? KEEP_GATE_FACTOR : 1
  if (a.speedOverGround !== undefined && b.speedOverGround !== undefined) {
    const tolerance = Math.max(
      MIN_SPEED_TOLERANCE,
      SPEED_TOLERANCE_FRACTION * Math.max(a.speedOverGround, b.speedOverGround)
    )
    if (Math.abs(a.speedOverGround - b.speedOverGround) > tolerance * factor) {
      return false
    }
    if (
      a.courseOverGroundTrue !== undefined &&
      b.courseOverGroundTrue !== undefined &&
      a.speedOverGround >= COURSE_MIN_SPEED &&
      b.speedOverGround >= COURSE_MIN_SPEED &&
      angleBetween(a.courseOverGroundTrue, b.courseOverGroundTrue) >
        MAX_COURSE_DIFF * factor
    ) {
      return false
    }
  }
  return true
}

function hasPreviousId(
  { provider, contact }: ProviderContact,
  input: AssociationInput,
  takenIds: Set<string>
): boolean {
  const previousId = input.previous.get(contactKey(provider, contact.id))
  return previousId !== undefined && !takenIds.has(previousId)
}

function newDarkGroup(
  member: ProviderContact,
  input: AssociationInput,
  takenIds: Set<string>
): Group {
  const { provider, contact, observation } = member
  const previousId = input.previous.get(contactKey(provider, contact.id))
  let id =
    previousId !== undefined && !takenIds.has(previousId)
      ? previousId
      : `${contact.type}:${contact.id}`
  if (takenIds.has(id)) {
    id = `${id}@${provider}`
  }
  takenIds.add(id)
  return {
    id,
    reference: observation,
    members: [member],
    providers: new Set([provider])
  }
}

function toTarget(group: Group, now: number): Target {
  const sources: TargetSource[] = []
  if (group.ais) {
    sources.push(
      toSource(
        'ais',
        group.ais.context,
        group.ais.vesselId,
        group.ais.observation
      )
    )
  }
  for (const { provider, contact, observation } of group.members) {
    sources.push({
      ...toSource(contact.type, provider, contact.id, observation),
      ...(contact.confidence !== undefined && {
        confidence: contact.confidence
      }),
      ...(contact.ref !== undefined && { ref: contact.ref })
    })
  }

  const best = bestObservation(group, now)
  const named = group.members.find((m) => m.contact.name !== undefined)
  const identified = group.members.find((m) => m.contact.mmsi !== undefined)
  const name = group.ais?.name ?? named?.contact.name
  const mmsi = group.ais?.mmsi ?? identified?.contact.mmsi
  return {
    id: group.id,
    ...(group.ais && { context: group.ais.context }),
    ...(name !== undefined && { name }),
    ...(mmsi !== undefined && { mmsi }),
    ...kinematics(best),
    timestamp: new Date(best.timeMs).toISOString(),
    sources
  }
}

function bestObservation(group: Group, now: number): Observation {
  if (group.ais && now - group.ais.observation.timeMs <= AIS_PREFERRED_AGE_MS) {
    return group.ais.observation
  }
  const observations = group.members.map((m) => m.observation)
  if (group.ais) {
    observations.push(group.ais.observation)
  }
  return observations.reduce((a, b) => (b.timeMs > a.timeMs ? b : a))
}

function toSource(
  type: string,
  provider: string,
  id: string,
  observation: Observation
): TargetSource {
  return {
    type,
    provider,
    id,
    ...kinematics(observation),
    timestamp: new Date(observation.timeMs).toISOString()
  }
}

function kinematics(o: Observation) {
  return {
    position: o.position,
    ...(o.courseOverGroundTrue !== undefined && {
      courseOverGroundTrue: o.courseOverGroundTrue
    }),
    ...(o.speedOverGround !== undefined && {
      speedOverGround: o.speedOverGround
    }),
    ...(o.headingTrue !== undefined && { headingTrue: o.headingTrue })
  }
}

/** Dead-reckons an observation to `timeMs` along its course and speed. */
export function extrapolate(o: Observation, timeMs: number): Position {
  if (o.speedOverGround === undefined || o.courseOverGroundTrue === undefined) {
    return o.position
  }
  const run = (o.speedOverGround * (timeMs - o.timeMs)) / 1000
  const dLat = (run * Math.cos(o.courseOverGroundTrue)) / EARTH_RADIUS_M
  const dLon =
    (run * Math.sin(o.courseOverGroundTrue)) /
    (EARTH_RADIUS_M * Math.cos(toRad(o.position.latitude)))
  return {
    latitude: o.position.latitude + toDeg(dLat),
    longitude: normaliseLongitude(o.position.longitude + toDeg(dLon))
  }
}

/** Great-circle distance in metres (haversine). */
export function distance(a: Position, b: Position): number {
  const dLat = toRad(b.latitude - a.latitude)
  const dLon = toRad(b.longitude - a.longitude)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.latitude)) *
      Math.cos(toRad(b.latitude)) *
      Math.sin(dLon / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)))
}

function angleBetween(a: number, b: number): number {
  const d = Math.abs(a - b) % (2 * Math.PI)
  return d > Math.PI ? 2 * Math.PI - d : d
}

function normaliseLongitude(lon: number): number {
  return ((((lon + 180) % 360) + 360) % 360) - 180
}

const toRad = (deg: number) => (deg * Math.PI) / 180
const toDeg = (rad: number) => (rad * 180) / Math.PI
