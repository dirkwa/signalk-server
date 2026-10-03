import { OpenApiDescription } from '../swagger'
import { typeboxToOpenApiSchemas } from '../openApiSchemas'
import {
  IsoTimeSchema,
  PositionSchema,
  TargetSchema,
  TargetSourceSchema
} from '@signalk/server-api/typebox'

const targetsApiDoc = {
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
    schemas: typeboxToOpenApiSchemas([
      TargetSchema,
      TargetSourceSchema,
      PositionSchema,
      IsoTimeSchema
    ]),
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
