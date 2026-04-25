import { SourceRef } from '@signalk/server-api'
import { writeSettingsFile } from './config/config'
import { createDebug } from './debug'
import * as fs from 'fs'
import * as path from 'path'

const debug = createDebug('signalk-server:sourceref-migration')

const LABELS_FILENAME = 'n2k-channel-labels.json'

interface MigrationApp {
  config: {
    configPath: string
    settings: {
      sourcePriorities?: Record<
        string,
        Array<{ sourceRef: string; timeout: number }>
      >
      sourceAliases?: Record<string, string>
      ignoredInstanceConflicts?: Record<string, string>
      priorityGroups?: Array<{ id: string; sources: string[] }>
    }
  }
  activateSourcePriorities: () => void
  deltaCache: {
    removeSource(sourceRef: SourceRef): void
  }
  emit(event: string, ...args: unknown[]): boolean
}

export function migrateSourceRef(
  app: MigrationApp,
  oldRef: string,
  newRef: string
): void {
  const settings = app.config.settings
  let settingsChanged = false
  const migrated = new Set<string>()

  // 1. sourcePriorities (path-level) — dedupe per path if newRef already present
  if (settings.sourcePriorities) {
    for (const [, entries] of Object.entries(settings.sourcePriorities)) {
      if (!Array.isArray(entries)) continue
      const hasNewRef = entries.some((e) => e.sourceRef === newRef)
      if (hasNewRef) {
        const before = entries.length
        const filtered = entries.filter((e) => e.sourceRef !== oldRef)
        if (filtered.length !== before) {
          entries.length = 0
          entries.push(...filtered)
          settingsChanged = true
          migrated.add('sourcePriorities')
        }
      } else {
        for (const entry of entries) {
          if (entry.sourceRef === oldRef) {
            entry.sourceRef = newRef
            settingsChanged = true
            migrated.add('sourcePriorities')
          }
        }
      }
    }
  }

  // 2. sourceAliases — keep existing newRef alias if present
  if (settings.sourceAliases && oldRef in settings.sourceAliases) {
    if (!(newRef in settings.sourceAliases)) {
      settings.sourceAliases[newRef] = settings.sourceAliases[oldRef]
    }
    delete settings.sourceAliases[oldRef]
    settingsChanged = true
    migrated.add('sourceAliases')
  }

  // 3. ignoredInstanceConflicts (keys are "refA+refB" sorted pairs)
  if (settings.ignoredInstanceConflicts) {
    const updates: Array<{ oldKey: string; newKey: string; value: string }> = []
    for (const [key, value] of Object.entries(
      settings.ignoredInstanceConflicts
    )) {
      const parts = key.split('+')
      if (parts.includes(oldRef)) {
        const newParts = parts.map((p) => (p === oldRef ? newRef : p))
        const newKey = newParts.sort().join('+')
        updates.push({ oldKey: key, newKey, value })
      }
    }
    for (const { oldKey, newKey, value } of updates) {
      delete settings.ignoredInstanceConflicts[oldKey]
      if (!(newKey in settings.ignoredInstanceConflicts)) {
        settings.ignoredInstanceConflicts[newKey] = value
      }
      settingsChanged = true
    }
    if (updates.length > 0) {
      migrated.add('ignoredInstanceConflicts')
    }
  }

  // 4. priorityGroups — rewrite or dedupe sourceRef inside each group
  if (settings.priorityGroups) {
    for (const group of settings.priorityGroups) {
      const hasNewRef = group.sources.includes(newRef)
      if (hasNewRef) {
        const before = group.sources.length
        const filtered = group.sources.filter((ref) => ref !== oldRef)
        if (filtered.length !== before) {
          group.sources = filtered
          settingsChanged = true
          migrated.add('priorityGroups')
        }
      } else {
        const idx = group.sources.indexOf(oldRef)
        if (idx !== -1) {
          group.sources[idx] = newRef
          settingsChanged = true
          migrated.add('priorityGroups')
        }
      }
    }
  }

  // 5. Channel labels file
  const labelsPath = path.join(app.config.configPath, LABELS_FILENAME)
  try {
    const raw = fs.readFileSync(labelsPath, 'utf-8')
    const labels: Record<string, string> = JSON.parse(raw)
    const oldPrefix = oldRef + ':'
    const labelUpdates: Array<[string, string, string]> = []
    for (const [key, value] of Object.entries(labels)) {
      if (key.startsWith(oldPrefix)) {
        const suffix = key.slice(oldPrefix.length)
        labelUpdates.push([key, `${newRef}:${suffix}`, value])
      }
    }
    if (labelUpdates.length > 0) {
      for (const [oldKey, newKey, value] of labelUpdates) {
        delete labels[oldKey]
        if (!(newKey in labels)) {
          labels[newKey] = value
        }
      }
      // Sync write keeps callers (including the migration tests) able to
      // observe the new file shape immediately on return. Channel labels
      // files are tiny (one entry per N2K instance) so the blocking cost
      // is negligible at startup.
      fs.writeFileSync(labelsPath, JSON.stringify(labels, null, 2))
      migrated.add('channelLabels')
    }
  } catch (e: unknown) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
      debug('Failed to migrate channel labels: %s', (e as Error).message)
    }
  }

  const finalize = () => {
    // 6. Clean up deltaCache for old sourceRef. Only safe to do once
    // settings have been persisted — otherwise a write failure would
    // leave disk pointing at the old ref while the cache has already
    // dropped its leaf, producing two-second-of-amnesia on restart.
    app.deltaCache.removeSource(oldRef as SourceRef)

    // 7. Recompile priority engine
    app.activateSourcePriorities()

    // 8. Notify clients (only for sections that were actually migrated)
    if (migrated.has('sourcePriorities') && settings.sourcePriorities) {
      app.emit('serverevent', {
        type: 'SOURCEPRIORITIES',
        data: settings.sourcePriorities
      })
    }
    if (migrated.has('sourceAliases') && settings.sourceAliases) {
      app.emit('serverAdminEvent', {
        type: 'SOURCEALIASES',
        data: settings.sourceAliases
      })
    }
    if (migrated.has('priorityGroups') && settings.priorityGroups) {
      app.emit('serverAdminEvent', {
        type: 'PRIORITYGROUPS',
        data: settings.priorityGroups
      })
    }

    if (migrated.size > 0) {
      console.log(
        `sourceRef migrated ${oldRef} -> ${newRef}: ${[...migrated].join(', ')}`
      )
    }
    debug(
      'Migration complete: %s -> %s (%s)',
      oldRef,
      newRef,
      [...migrated].join(', ')
    )
  }

  if (settingsChanged) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    writeSettingsFile(app as any, settings, (err: Error) => {
      if (err) {
        console.error('Failed to save settings after sourceRef migration:', err)
        // Still finalise: in-memory state has already been mutated
        // (settings, deltaCache references), so skipping the priority
        // engine recompile and event broadcast would leave the running
        // server inconsistent with itself. The disk/memory divergence
        // self-heals on the next successful settings write.
      }
      finalize()
    })
  } else {
    // Nothing to persist (e.g. only channelLabels file was rewritten).
    finalize()
  }
}
