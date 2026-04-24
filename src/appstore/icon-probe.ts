/*
 * Copyright 2026 Signal K contributors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

import fs from 'fs'
import path from 'path'
import { createDebug } from '../debug'
import { isAbsoluteUrl, resolveScreenshotUrl } from './cdn'

const debug = createDebug('signalk-server:appstore:icon-probe')

// When signalk.appIcon points at a path that isn't in the published tarball
// (common when source images live under public/ or assets/ but signalk.appIcon
// is relative to the repo root), try these alternative directories in order.
// Each candidate is ./{dir}/{basename-of-declared-path}.
const ALT_DIRS = ['public', 'assets', 'img', 'docs', 'dist', 'src']

const HEAD_TIMEOUT_MS = 8_000
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 1 week per package@version@path

interface ProbedEntry {
  resolved: string | null
  probedAt: number
}

export interface IconProbeCache {
  get(
    pkg: string,
    version: string,
    declaredPath: string
  ): string | null | undefined
  set(
    pkg: string,
    version: string,
    declaredPath: string,
    resolved: string | null
  ): void
}

export function createIconProbeCache(cacheDir: string): IconProbeCache {
  const file = path.join(cacheDir, 'iconUrls.json')
  let memo: Record<string, ProbedEntry> = {}
  let loaded = false

  function load() {
    if (loaded) return
    loaded = true
    try {
      if (fs.existsSync(file)) {
        memo = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<
          string,
          ProbedEntry
        >
      }
    } catch (err) {
      debug('iconUrls cache load failed: %O', err)
      memo = {}
    }
  }

  function persist() {
    try {
      fs.mkdirSync(cacheDir, { recursive: true })
      fs.writeFileSync(file, JSON.stringify(memo), 'utf8')
    } catch (err) {
      debug('iconUrls cache write failed: %O', err)
    }
  }

  function key(pkg: string, version: string, declaredPath: string): string {
    return `${pkg}@${version}@${declaredPath}`
  }

  return {
    get(pkg, version, declaredPath) {
      load()
      const entry = memo[key(pkg, version, declaredPath)]
      if (!entry) return undefined
      if (Date.now() - entry.probedAt > CACHE_TTL_MS) return undefined
      return entry.resolved
    },
    set(pkg, version, declaredPath, resolved) {
      load()
      memo[key(pkg, version, declaredPath)] = {
        resolved,
        probedAt: Date.now()
      }
      persist()
    }
  }
}

async function headOk(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: 'HEAD',
      signal: AbortSignal.timeout(HEAD_TIMEOUT_MS)
    })
    return res.ok
  } catch (err) {
    debug('HEAD %s failed: %O', url, err)
    return false
  }
}

function altCandidatesFor(
  pkg: string,
  version: string,
  declaredPath: string
): string[] {
  const base = declaredPath
    .replace(/\\/g, '/')
    .replace(/^\.?\/+/, '')
    .split('/')
    .pop()
  if (!base) return []
  return ALT_DIRS.map((dir) =>
    resolveScreenshotUrl(pkg, version, `./${dir}/${base}`)
  )
}

/**
 * Given a plugin package@version and a declared signalk.* relative path,
 * return a resolved CDN URL that is actually reachable.
 *
 * If the declared path HEADs 200, returns that URL.
 * Otherwise tries a small list of alternative directories (./public,
 * ./assets, ./img, ./docs, ./dist, ./src) with the basename of the
 * declared path. Returns the first URL that responds 200, or null when
 * nothing works.
 *
 * Absolute URLs (http, https, data:) are passed through untouched and
 * are NOT probed (trusted as-declared).
 */
export async function probeIconUrl(
  pkg: string,
  version: string,
  declaredPath: string,
  cache: IconProbeCache
): Promise<string | null> {
  if (isAbsoluteUrl(declaredPath)) return declaredPath

  const cached = cache.get(pkg, version, declaredPath)
  if (cached !== undefined) return cached

  const primary = resolveScreenshotUrl(pkg, version, declaredPath)
  if (await headOk(primary)) {
    cache.set(pkg, version, declaredPath, primary)
    return primary
  }

  for (const candidate of altCandidatesFor(pkg, version, declaredPath)) {
    if (candidate === primary) continue
    if (await headOk(candidate)) {
      cache.set(pkg, version, declaredPath, candidate)
      return candidate
    }
  }

  cache.set(pkg, version, declaredPath, null)
  return null
}
