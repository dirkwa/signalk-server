/**
 * TypeBox Schema Definitions for the Signal K Targets API
 */

import { Type, type Static } from '@sinclair/typebox'
import { PositionSchema, IsoTimeSchema } from './shared-schemas'

const kinematics = {
  position: Type.Ref(PositionSchema),
  courseOverGroundTrue: Type.Optional(
    Type.Number({ description: 'Course over ground (rad, true)', units: 'rad' })
  ),
  speedOverGround: Type.Optional(
    Type.Number({ description: 'Speed over ground (m/s)', units: 'm/s' })
  ),
  headingTrue: Type.Optional(
    Type.Number({ description: 'Heading (rad, true)', units: 'rad' })
  )
}

const confidence = Type.Optional(
  Type.Number({
    minimum: 0,
    maximum: 1,
    description: 'Detection confidence, 0 to 1'
  })
)

const ref = Type.Optional(
  Type.String({
    description: "Signal K path of the sensor's own record of this contact",
    examples: ['vessels.self.radars.radar-0.targets.17']
  })
)

export const TargetContactSchema = Type.Object(
  {
    id: Type.String({
      minLength: 1,
      description:
        "Unique among the provider's contacts and stable while the sensor tracks the object",
      examples: ['radar-0-17']
    }),
    type: Type.String({
      minLength: 1,
      not: Type.Literal('ais'),
      description:
        'Sensor kind, e.g. `radar` or `camera`. `ais` is reserved for vessels in the data model.',
      examples: ['radar']
    }),
    ...kinematics,
    timestamp: Type.Optional(Type.Ref(IsoTimeSchema)),
    mmsi: Type.Optional(
      Type.String({
        description: 'MMSI, when the sensor has itself identified the vessel'
      })
    ),
    name: Type.Optional(Type.String()),
    confidence,
    ref
  },
  {
    $id: 'TargetContact',
    description: "One sensor's view of an object, as a provider reports it"
  }
)
export type TargetContactSchemaType = Static<typeof TargetContactSchema>

export const TargetSourceSchema = Type.Object(
  {
    type: Type.String({
      description:
        'Sensor kind: `ais` for vessels in the data model, otherwise what the provider reports, e.g. `radar` or `camera`',
      examples: ['radar']
    }),
    provider: Type.String({
      description: 'Plugin id of the provider, or the vessel context for AIS',
      examples: ['mayara-server-signalk-plugin']
    }),
    id: Type.String({
      description: 'Contact id within the provider, or the vessel id for AIS',
      examples: ['radar-0-17']
    }),
    ...kinematics,
    timestamp: Type.Ref(IsoTimeSchema),
    confidence,
    ref
  },
  {
    $id: 'TargetSource',
    description: "One sensor's contribution to a target"
  }
)
export type TargetSourceSchemaType = Static<typeof TargetSourceSchema>

export const TargetSchema = Type.Object(
  {
    id: Type.String({
      description:
        'Stable identifier: the vessel id when AIS sees the target, otherwise `<type>:<contact id>` of the contact that first saw it',
      examples: ['urn:mrn:imo:mmsi:244060000']
    }),
    context: Type.Optional(
      Type.String({
        description: 'Vessel context when AIS sees the target',
        examples: ['vessels.urn:mrn:imo:mmsi:244060000']
      })
    ),
    name: Type.Optional(Type.String({ examples: ['Nordic Star'] })),
    mmsi: Type.Optional(Type.String({ examples: ['244060000'] })),
    ...kinematics,
    timestamp: Type.Ref(IsoTimeSchema, {
      description:
        'Time of the observation the position and motion come from: AIS while its report is recent, otherwise the most recent sensor'
    }),
    sources: Type.Array(Type.Ref(TargetSourceSchema), {
      description: 'Every sensor that sees this target, AIS first'
    })
  },
  {
    $id: 'Target',
    description:
      'An object around the boat, merged from every sensor that sees it'
  }
)
export type TargetSchemaType = Static<typeof TargetSchema>
