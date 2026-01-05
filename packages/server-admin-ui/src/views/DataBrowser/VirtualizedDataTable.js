import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react'
import DataRow from './DataRow'
import subscriptionManager from './SubscriptionManager'
import granularSubscriptionManager from './GranularSubscriptionManager'
import './VirtualTable.css'

/**
 * VirtualizedDataTable - Window-scroll virtualized table
 * Simple implementation compatible with React 16
 */
function VirtualizedDataTable({
  pathKeys,
  context,
  raw,
  isPaused,
  onToggleSource,
  selectedSources,
  onToggleSourceFilter,
  sourceFilterActive
}) {
  const containerRef = useRef(null)
  const [visibleRange, setVisibleRange] = useState({ start: 0, end: 50 })
  const rowHeight = 40 // Base row height in pixels (content can overflow)
  const overscan = 15 // Extra rows above/below viewport (increased for variable content)

  // Calculate visible range based on scroll position
  const updateVisibleRange = useCallback(() => {
    if (!containerRef.current) return

    const rect = containerRef.current.getBoundingClientRect()
    const containerTop = rect.top
    const viewportHeight = window.innerHeight

    // Calculate which rows are visible
    let startOffset = 0
    if (containerTop < 0) {
      startOffset = Math.abs(containerTop)
    }

    const startIndex = Math.max(
      0,
      Math.floor(startOffset / rowHeight) - overscan
    )
    const visibleCount = Math.ceil(viewportHeight / rowHeight) + overscan * 2
    const endIndex = Math.min(pathKeys.length - 1, startIndex + visibleCount)

    setVisibleRange((prev) => {
      // Only update if range changed significantly to avoid excessive re-renders
      // Always update if at the very beginning (startIndex === 0) to ensure first row renders
      if (
        startIndex === 0 ||
        Math.abs(prev.start - startIndex) > 3 ||
        Math.abs(prev.end - endIndex) > 3
      ) {
        return { start: startIndex, end: endIndex }
      }
      return prev
    })
  }, [pathKeys.length, rowHeight, overscan])

  // Set up scroll listener
  useEffect(() => {
    updateVisibleRange()

    let ticking = false
    const handleScroll = () => {
      if (!ticking) {
        window.requestAnimationFrame(() => {
          updateVisibleRange()
          ticking = false
        })
        ticking = true
      }
    }

    window.addEventListener('scroll', handleScroll, { passive: true })
    window.addEventListener('resize', handleScroll, { passive: true })

    return () => {
      window.removeEventListener('scroll', handleScroll)
      window.removeEventListener('resize', handleScroll)
    }
  }, [updateVisibleRange])

  // Cleanup subscriptions on unmount
  useEffect(() => {
    return () => {
      subscriptionManager.unsubscribeAll()
    }
  }, [])

  // Handle pause/unpause
  useEffect(() => {
    if (isPaused) {
      subscriptionManager.unsubscribeAll()
    }
  }, [isPaused])

  // Calculate spacer heights for rows before/after visible range
  const spacerBeforeHeight = visibleRange.start * rowHeight
  const spacerAfterHeight = Math.max(
    0,
    (pathKeys.length - visibleRange.end - 1) * rowHeight
  )

  // Build visible items - memoized to prevent unnecessary re-renders
  // Only recalculates when visible range or path data changes
  // Note: Must be called before any early returns to maintain hook order
  const visibleItems = useMemo(() => {
    const items = []
    for (
      let i = visibleRange.start;
      i <= visibleRange.end && i < pathKeys.length;
      i++
    ) {
      if (pathKeys[i]) {
        items.push({
          index: i,
          pathKey: pathKeys[i]
        })
      }
    }
    return items
  }, [visibleRange.start, visibleRange.end, pathKeys])

  // Report visible paths to granular subscription manager
  // Must be after visibleItems useMemo since it depends on it
  useEffect(() => {
    if (isPaused) return
    if (visibleItems.length === 0) return

    const visiblePathKeys = visibleItems.map((item) => item.pathKey)
    granularSubscriptionManager.requestPaths(visiblePathKeys, pathKeys)
  }, [visibleRange.start, visibleRange.end, pathKeys, isPaused, visibleItems])

  if (pathKeys.length === 0) {
    return (
      <div className="virtual-table">
        <div className="virtual-table-info">
          No data available. Waiting for data...
        </div>
      </div>
    )
  }

  return (
    <div className="virtual-table" ref={containerRef}>
      {/* Header */}
      <div className="virtual-table-header">
        <div className="virtual-table-header-cell">Path</div>
        <div className="virtual-table-header-cell">Value</div>
        <div className="virtual-table-header-cell">Timestamp</div>
        <div className="virtual-table-header-cell">
          <label
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              margin: 0,
              cursor: 'pointer'
            }}
          >
            <input
              type="checkbox"
              onChange={onToggleSourceFilter}
              checked={sourceFilterActive}
              disabled={selectedSources.size === 0}
              title={
                selectedSources.size === 0
                  ? 'Check a source in the list to filter by source'
                  : sourceFilterActive
                    ? 'Uncheck to deactivate source filtering'
                    : 'Check to activate source filtering'
              }
              style={{
                marginRight: '5px',
                verticalAlign: 'middle'
              }}
            />
            Source
          </label>
        </div>
      </div>

      {/* Virtualized Body - using spacers instead of absolute positioning */}
      <div className="virtual-table-body">
        {/* Spacer for rows above visible range */}
        {spacerBeforeHeight > 0 && (
          <div style={{ height: spacerBeforeHeight }} />
        )}

        {/* Visible rows - rendered in normal flow for variable heights */}
        {visibleItems.map((item) => (
          <DataRow
            key={item.pathKey}
            pathKey={item.pathKey}
            context={context}
            index={item.index}
            raw={raw}
            isPaused={isPaused}
            onToggleSource={onToggleSource}
            selectedSources={selectedSources}
          />
        ))}

        {/* Spacer for rows below visible range */}
        {spacerAfterHeight > 0 && <div style={{ height: spacerAfterHeight }} />}
      </div>

      {/* Info footer */}
      <div className="virtual-table-info">
        Showing {visibleItems.length} of {pathKeys.length} paths (rows{' '}
        {visibleRange.start + 1}-
        {Math.min(visibleRange.end + 1, pathKeys.length)})
      </div>
    </div>
  )
}

export default React.memo(VirtualizedDataTable)
