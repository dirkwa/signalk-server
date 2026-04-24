/*
 * Copyright 2026 Signal K contributors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

import { createDebug } from '../debug'
import { AppStoreCache } from './cache'

const debug = createDebug('signalk-server:appstore:offline')

interface InstalledModuleLike {
  packageName?: string
  name?: string
  version?: string
  id?: string
}

interface AppLike {
  plugins?: InstalledModuleLike[]
  webapps?: InstalledModuleLike[]
  addons?: InstalledModuleLike[]
  embeddablewebapps?: InstalledModuleLike[]
}

function installedAsEntries(app: AppLike): Record<string, unknown>[] {
  const sources: Array<[InstalledModuleLike[] | undefined, boolean, boolean]> =
    [
      [app.plugins, true, false],
      [app.webapps, false, true],
      [app.addons, false, true],
      [app.embeddablewebapps, false, true]
    ]

  const seen = new Set<string>()
  const entries: Record<string, unknown>[] = []

  for (const [list, isPlugin, isWebapp] of sources) {
    if (!list) continue
    for (const mod of list) {
      const name = mod.packageName || mod.name
      if (!name || seen.has(name)) continue
      seen.add(name)
      entries.push({
        name,
        version: mod.version ?? 'unknown',
        description: '',
        author: '',
        categories: [],
        updated: '',
        keywords: [],
        npmUrl: null,
        isPlugin,
        isWebapp,
        isEmbeddableWebapp: false,
        id: mod.id,
        installedVersion: mod.version
      })
    }
  }
  return entries
}

export function buildOfflineResponse(
  app: AppLike,
  cache: AppStoreCache
): Record<string, unknown> {
  const installed = installedAsEntries(app)
  const cachedList = cache.readList<Record<string, unknown>>()

  if (cachedList?.payload) {
    debug('offline: falling back to cached list from %d', cachedList.writtenAt)
    return {
      ...cachedList.payload,
      storeAvailable: false,
      fromCache: true,
      cacheAge: Date.now() - cachedList.writtenAt
    }
  }

  return {
    available: installed,
    installed,
    updates: [],
    installing: [],
    categories: ['All'],
    storeAvailable: false,
    isInDocker: process.env.IS_IN_DOCKER === 'true',
    fromCache: false
  }
}
