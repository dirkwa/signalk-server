/*
 * Copyright 2026 Signal K contributors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

import { type Static, Type } from '@sinclair/typebox'

export const IndicatorStatusSchema = Type.Union(
  [Type.Literal('ok'), Type.Literal('warn'), Type.Literal('fail')],
  { $id: 'AppStoreIndicatorStatus' }
)
export type IndicatorStatus = Static<typeof IndicatorStatusSchema>

export const IndicatorCheckSchema = Type.Object(
  {
    id: Type.String(),
    status: IndicatorStatusSchema,
    title: Type.String(),
    subtitle: Type.String()
  },
  {
    $id: 'AppStoreIndicatorCheck',
    description:
      'One heuristic check contributing to the App Store indicator score.'
  }
)
export type IndicatorCheck = Static<typeof IndicatorCheckSchema>

export const IndicatorRawMetricsSchema = Type.Object(
  {
    stars: Type.Optional(Type.Number()),
    downloadsPerWeek: Type.Optional(Type.Number()),
    openIssues: Type.Optional(Type.Number()),
    contributors: Type.Optional(Type.Number()),
    lastReleaseDate: Type.Optional(Type.String())
  },
  {
    $id: 'AppStoreIndicatorRawMetrics',
    description: 'Raw informational metrics shown on the Indicators tab.'
  }
)
export type IndicatorRawMetrics = Static<typeof IndicatorRawMetricsSchema>

export const IndicatorResultSchema = Type.Object(
  {
    score: Type.Number({ minimum: 0, maximum: 100 }),
    checks: Type.Array(IndicatorCheckSchema),
    reportedPlatforms: Type.Array(Type.String()),
    rawMetrics: IndicatorRawMetricsSchema
  },
  {
    $id: 'AppStoreIndicatorResult',
    description:
      'Aggregate heuristic indicator result. Weights are not exposed.'
  }
)
export type IndicatorResult = Static<typeof IndicatorResultSchema>

export const SignalKPackageMetadataSchema = Type.Object(
  {
    displayName: Type.Optional(Type.String()),
    appIcon: Type.Optional(Type.String()),
    screenshots: Type.Optional(Type.Array(Type.String())),
    deprecated: Type.Optional(Type.Boolean()),
    requires: Type.Optional(Type.Array(Type.String())),
    recommends: Type.Optional(Type.Array(Type.String()))
  },
  {
    $id: 'SignalKPackageMetadata',
    description:
      'Metadata authors declare under the signalk key in package.json.',
    additionalProperties: true
  }
)
export type SignalKPackageMetadata = Static<typeof SignalKPackageMetadataSchema>

export const DependencyReferenceSchema = Type.Object(
  {
    name: Type.String(),
    displayName: Type.Optional(Type.String()),
    appIcon: Type.Optional(Type.String()),
    installed: Type.Boolean()
  },
  {
    $id: 'AppStoreDependencyReference',
    description:
      'A hydrated reference to another App Store plugin that this plugin ' +
      'requires or recommends.'
  }
)
export type DependencyReference = Static<typeof DependencyReferenceSchema>

export const AppStoreEntryExtensionSchema = Type.Object(
  {
    displayName: Type.Optional(Type.String()),
    appIcon: Type.Optional(Type.String()),
    screenshots: Type.Optional(Type.Array(Type.String())),
    official: Type.Boolean(),
    deprecated: Type.Boolean(),
    readmeUrl: Type.String(),
    changelogUrl: Type.Optional(Type.String()),
    githubUrl: Type.Optional(Type.String()),
    issuesUrl: Type.Optional(Type.String()),
    requires: Type.Optional(Type.Array(Type.String())),
    recommends: Type.Optional(Type.Array(Type.String())),
    indicators: Type.Optional(IndicatorResultSchema)
  },
  {
    $id: 'AppStoreEntryExtension',
    description: 'Extra fields enriched onto each App Store list entry.'
  }
)
export type AppStoreEntryExtension = Static<typeof AppStoreEntryExtensionSchema>

export const PluginDetailPayloadSchema = Type.Object(
  {
    name: Type.String(),
    version: Type.String(),
    displayName: Type.Optional(Type.String()),
    appIcon: Type.Optional(Type.String()),
    screenshots: Type.Array(Type.String()),
    official: Type.Boolean(),
    deprecated: Type.Boolean(),
    readme: Type.String(),
    changelog: Type.String(),
    indicators: Type.Optional(IndicatorResultSchema),
    requires: Type.Array(DependencyReferenceSchema),
    recommends: Type.Array(DependencyReferenceSchema),
    readmeFormat: Type.Literal('markdown'),
    changelogFormat: Type.Union([
      Type.Literal('markdown'),
      Type.Literal('synthesized')
    ]),
    fetchedAt: Type.Number(),
    fromCache: Type.Boolean()
  },
  {
    $id: 'AppStorePluginDetailPayload',
    description: 'Response body of GET /appstore/plugin/:name.'
  }
)
export type PluginDetailPayload = Static<typeof PluginDetailPayloadSchema>
