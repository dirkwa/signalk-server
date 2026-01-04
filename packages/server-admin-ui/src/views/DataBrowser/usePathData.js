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
