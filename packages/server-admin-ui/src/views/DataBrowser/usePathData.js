import { useState, useEffect } from 'react'
import store from './DataBrowserStore'

/**
 * Hook to subscribe to a specific path's data
 * Only re-renders when THIS path's data changes
 */
export function usePathData(context, pathKey) {
  const [data, setData] = useState(() => store.getPathData(context, pathKey))

  useEffect(() => {
    // Get initial data
    setData(store.getPathData(context, pathKey))

    // Subscribe to updates for this specific path
    const unsubscribe = store.subscribe(context, pathKey, (newData) => {
      setData(newData)
    })

    return unsubscribe
  }, [context, pathKey])

  return data
}

/**
 * Hook to get metadata for a path
 */
export function useMetaData(context, path) {
  const [meta, setMeta] = useState(() => store.getMeta(context, path))

  useEffect(() => {
    setMeta(store.getMeta(context, path))
  }, [context, path])

  return meta
}

/**
 * Hook to get all path keys for a context (for virtualization)
 * Re-renders when paths are added/removed
 */
export function usePathKeys(
  context,
  searchFilter,
  sourceFilter,
  selectedSources,
  sourceFilterActive
) {
  const [version, setVersion] = useState(store.version)
  const [pathKeys, setPathKeys] = useState([])

  // Subscribe to structural changes
  useEffect(() => {
    const unsubscribe = store.subscribeToStructure((newVersion) => {
      setVersion(newVersion)
    })
    return unsubscribe
  }, [])

  // Recompute filtered/sorted path keys when version, context, or filters change
  useEffect(() => {
    const allKeys = store.getPathKeys(context)

    const filtered = allKeys.filter((key) => {
      // Search filter
      if (searchFilter && searchFilter.length > 0) {
        if (key.toLowerCase().indexOf(searchFilter.toLowerCase()) === -1) {
          return false
        }
      }

      // Source filter
      if (sourceFilterActive && selectedSources && selectedSources.size > 0) {
        const data = store.getPathData(context, key)
        if (data && !selectedSources.has(data.$source)) {
          return false
        }
      }

      return true
    })

    filtered.sort()
    setPathKeys(filtered)
  }, [
    version,
    context,
    searchFilter,
    sourceFilter,
    selectedSources,
    sourceFilterActive
  ])

  return pathKeys
}

/**
 * Hook to get all available contexts
 */
export function useContexts() {
  const [version, setVersion] = useState(store.version)
  const [contexts, setContexts] = useState([])

  useEffect(() => {
    const unsubscribe = store.subscribeToStructure((newVersion) => {
      setVersion(newVersion)
    })
    return unsubscribe
  }, [])

  useEffect(() => {
    setContexts(store.getContexts())
  }, [version])

  return contexts
}
