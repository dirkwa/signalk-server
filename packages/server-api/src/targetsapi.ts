import { Position } from '.'

/**
 * Targets API — one picture of the other vessels and objects around the boat.
 *
 * AIS, radar ARPA and camera detection each see some of the same boats. The
 * server keeps one list of targets and links the contacts that are the same
 * object, so a consumer such as a collision alarm sees one boat once, whichever
 * sensors report it.
 *
 * AIS vessels come straight from the data model (`vessels.*`). Every other
 * sensor contributes through {@link TargetsProviderRegistry.updateTargetContact}.
 *
 * Units are SI as in the rest of Signal K: metres, metres per second, and
 * radians for angles.
 *
 * @category Targets API
 */

/**
 * The kind of sensor a contact comes from. `ais` is reserved for vessels in the
 * data model; providers use `radar`, `camera`, or another short lowercase word.
 *
 * @category Targets API
 */
export type TargetSourceType = 'ais' | 'radar' | 'camera' | (string & {})

/**
 * One sensor's view of an object, as a provider plugin reports it.
 *
 * @category Targets API
 */
export interface TargetContact {
  /**
   * Identifier, unique among this plugin's contacts and stable for as long as
   * the sensor tracks the object, e.g. `<radarId>:<targetNumber>`.
   */
  id: string
  /** Sensor kind. Must not be `ais`. */
  type: TargetSourceType
  position: Position
  /** Course over ground (rad, true). */
  courseOverGroundTrue?: number
  /** Speed over ground (m/s). */
  speedOverGround?: number
  /** Heading (rad, true), when the sensor can tell it apart from course. */
  headingTrue?: number
  /** ISO 8601 time of the observation. Defaults to the time it was received. */
  timestamp?: string
  /**
   * MMSI, when the sensor has itself identified the vessel (a camera that
   * reads the name on the hull, a radar that matched its own AIS overlay).
   * Links the contact to that AIS vessel whatever the geometry says.
   */
  mmsi?: string
  /** Display name, used when no AIS name is known. */
  name?: string
  /** Detection confidence, 0 to 1. */
  confidence?: number
  /**
   * Signal K path of the sensor's own record of this contact, e.g.
   * `vessels.self.radars.radar-0.targets.17`.
   */
  ref?: string
}

/**
 * One sensor's contribution to a {@link Target}.
 *
 * @category Targets API
 */
export interface TargetSource {
  type: TargetSourceType
  /** Plugin id of the provider; for AIS, the vessel context. */
  provider: string
  /** Contact id within the provider; for AIS, the vessel id. */
  id: string
  position: Position
  courseOverGroundTrue?: number
  speedOverGround?: number
  headingTrue?: number
  timestamp: string
  confidence?: number
  ref?: string
}

/**
 * An object around the boat, merged from every sensor that sees it.
 *
 * @category Targets API
 *
 * @example
 * ```json
 * {
 *   "id": "urn:mrn:imo:mmsi:244060000",
 *   "context": "vessels.urn:mrn:imo:mmsi:244060000",
 *   "name": "Nordic Star",
 *   "mmsi": "244060000",
 *   "position": { "latitude": 52.01, "longitude": 4.02 },
 *   "courseOverGroundTrue": 3.14,
 *   "speedOverGround": 5.1,
 *   "timestamp": "2026-10-03T20:30:00.000Z",
 *   "sources": [
 *     { "type": "ais", "provider": "vessels.urn:mrn:imo:mmsi:244060000",
 *       "id": "urn:mrn:imo:mmsi:244060000", "position": { "latitude": 52.01, "longitude": 4.02 },
 *       "timestamp": "2026-10-03T20:30:00.000Z" },
 *     { "type": "radar", "provider": "mayara-server-signalk-plugin", "id": "radar-0-17",
 *       "position": { "latitude": 52.0102, "longitude": 4.0198 },
 *       "timestamp": "2026-10-03T20:30:02.000Z" }
 *   ]
 * }
 * ```
 */
export interface Target {
  /**
   * Stable identifier. The vessel id (`urn:mrn:imo:mmsi:…`) when AIS sees the
   * target, otherwise `<type>:<contact id>` of the contact that first saw it.
   */
  id: string
  /** Vessel context when AIS sees the target. */
  context?: string
  name?: string
  mmsi?: string
  /**
   * Best estimate of where the target is: AIS while its report is recent,
   * otherwise the most recent sensor observation.
   */
  position: Position
  courseOverGroundTrue?: number
  speedOverGround?: number
  headingTrue?: number
  /** Time of the observation the kinematics above come from. */
  timestamp: string
  /** Every sensor that sees this target, AIS first. */
  sources: TargetSource[]
}

/**
 * Lets a plugin publish what its sensor sees.
 *
 * Contacts are dropped when the plugin removes them, when the plugin stops, or
 * when they have not been updated for a minute, so a provider that crashes
 * leaves no ghosts behind.
 *
 * Both methods are optional, so that a provider can feature-detect them and
 * still run on servers that predate the Targets API.
 *
 * @category Targets API
 */
export interface TargetsProviderRegistry {
  /** Add a contact, or replace this plugin's contact with the same id. */
  updateTargetContact?: (contact: TargetContact) => void
  /** Remove one of this plugin's contacts, e.g. when the sensor lost it. */
  removeTargetContact?: (id: string) => void
}

/**
 * @category Targets API
 */
export type WithTargetsApi = {
  /**
   * Current targets. Optional, so that plugins can run on servers that predate
   * the Targets API.
   */
  getTargets?: () => Target[]
}
