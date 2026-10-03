import { OpenApiDescription } from '../swagger'

/* eslint-disable @typescript-eslint/no-explicit-any */

const kinematics = {
  position: { $ref: '#/components/schemas/Position' },
  courseOverGroundTrue: {
    type: 'number',
    description: 'Course over ground (rad, true).'
  },
  speedOverGround: {
    type: 'number',
    description: 'Speed over ground (m/s).'
  },
  headingTrue: { type: 'number', description: 'Heading (rad, true).' }
}

export const targetsApiDoc: any = {
  openapi: '3.0.0',
  info: {
    version: '1.0.0',
    title: 'Signal K Targets API',
    description:
      'One picture of the vessels and objects around the boat. AIS vessels from the data model and the contacts that sensor plugins (radar ARPA, camera detection, …) report are merged, so one boat seen by several sensors is one target.',
    termsOfService: 'http://signalk.org/terms/',
    license: {
      name: 'Apache 2.0',
      url: 'http://www.apache.org/licenses/LICENSE-2.0.html'
    }
  },
  externalDocs: {
    url: 'http://signalk.org/specification/',
    description: 'Signal K specification.'
  },
  servers: [{ url: '/signalk/v2/api/targets' }],
  tags: [{ name: 'targets', description: 'Merged target picture.' }],
  components: {
    schemas: {
      Position: {
        type: 'object',
        required: ['latitude', 'longitude'],
        properties: {
          latitude: { type: 'number', example: 52.01 },
          longitude: { type: 'number', example: 4.02 }
        }
      },
      TargetSource: {
        type: 'object',
        required: ['type', 'provider', 'id', 'position', 'timestamp'],
        properties: {
          type: {
            type: 'string',
            description:
              'Sensor kind: `ais` for vessels in the data model, otherwise what the provider reports, e.g. `radar` or `camera`.',
            example: 'radar'
          },
          provider: {
            type: 'string',
            description:
              'Plugin id of the provider, or the vessel context for AIS.',
            example: 'mayara-server-signalk-plugin'
          },
          id: {
            type: 'string',
            description:
              'Contact id within the provider, or the vessel id for AIS.',
            example: 'radar-0:17'
          },
          ...kinematics,
          timestamp: { type: 'string', format: 'date-time' },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
          ref: {
            type: 'string',
            description:
              "Signal K path of the sensor's own record of this contact.",
            example: 'vessels.self.radars.radar-0.targets.17'
          }
        }
      },
      Target: {
        type: 'object',
        required: ['id', 'position', 'timestamp', 'sources'],
        properties: {
          id: {
            type: 'string',
            description:
              'Stable identifier: the vessel id when AIS sees the target, otherwise `<type>:<contact id>` of the contact that first saw it.',
            example: 'urn:mrn:imo:mmsi:244060000'
          },
          context: {
            type: 'string',
            description: 'Vessel context when AIS sees the target.',
            example: 'vessels.urn:mrn:imo:mmsi:244060000'
          },
          name: { type: 'string', example: 'Nordic Star' },
          mmsi: { type: 'string', example: '244060000' },
          ...kinematics,
          timestamp: {
            type: 'string',
            format: 'date-time',
            description:
              'Time of the observation the position and motion come from: AIS while its report is recent, otherwise the most recent sensor.'
          },
          sources: {
            type: 'array',
            description: 'Every sensor that sees this target, AIS first.',
            items: { $ref: '#/components/schemas/TargetSource' }
          }
        }
      }
    },
    responses: {
      ErrorResponse: {
        description: 'Failed operation',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['state', 'statusCode', 'message'],
              properties: {
                state: { type: 'string', enum: ['FAILED'] },
                statusCode: { type: 'number', enum: [404] },
                message: { type: 'string' }
              }
            }
          }
        }
      }
    },
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT'
      },
      cookieAuth: {
        type: 'apiKey',
        in: 'cookie',
        name: 'JAUTHENTICATION'
      }
    }
  },
  security: [{ cookieAuth: [] }, { bearerAuth: [] }],
  paths: {
    '/': {
      get: {
        tags: ['targets'],
        summary: 'List targets',
        description: 'All current targets, keyed by target id.',
        responses: {
          '200': {
            description: 'Targets by id',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  additionalProperties: {
                    $ref: '#/components/schemas/Target'
                  }
                }
              }
            }
          }
        }
      }
    },
    '/{id}': {
      get: {
        tags: ['targets'],
        summary: 'Get one target',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string' },
            example: 'urn:mrn:imo:mmsi:244060000'
          }
        ],
        responses: {
          '200': {
            description: 'The target',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Target' }
              }
            }
          },
          '404': { $ref: '#/components/responses/ErrorResponse' }
        }
      }
    }
  }
}

export const targetsApiRecord = {
  name: 'targets',
  path: '/signalk/v2/api/targets',
  apiDoc: targetsApiDoc as unknown as OpenApiDescription
}
