import React, {
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
  useDeferredValue
} from 'react'
import Select, {
  components,
  type OptionProps,
  type SingleValue
} from 'react-select'
import Button from 'react-bootstrap/Button'
import Card from 'react-bootstrap/Card'
import Col from 'react-bootstrap/Col'
import Form from 'react-bootstrap/Form'
import Row from 'react-bootstrap/Row'
import dayjs from 'dayjs'
import VirtualizedDataTable from './VirtualizedDataTable'
import type { PathData, MetaData } from '../../store'
import { buildSourceLabel, type SourcesData } from '../../utils/sourceLabels'
import granularSubscriptionManager from './GranularSubscriptionManager'
import { getPath$SourceKey, getPathFromKey } from './pathUtils'
import {
  useWebSocket,
  useDeltaMessages,
  getWebSocketService
} from '../../hooks/useWebSocket'
import {
  useStore,
  useShallow,
  useUnitPrefsLoaded,
  useConfiguredPriorityPaths,
  usePreferredSourceByPath
} from '../../store'

const getSignalkData = () => useStore.getState().signalkData

const TIMESTAMP_FORMAT = 'MM/DD HH:mm:ss'
const TIME_ONLY_FORMAT = 'HH:mm:ss'

const pauseStorageKey = 'admin.v1.dataBrowser.v1.pause'
const rawStorageKey = 'admin.v1.dataBrowser.v1.raw'
const contextStorageKey = 'admin.v1.dataBrowser.context'
const searchStorageKey = 'admin.v1.dataBrowser.search'
const viewBySourceStorageKey = 'admin.v1.dataBrowser.viewBySource'
const sourceFilterStorageKey = 'admin.v1.dataBrowser.sourceFilter'

const HEADER_PREFIX = '__header__\0'

function matchesSearch(key: string, search: string): boolean {
  if (!search || search.length === 0) return true
  const lowerKey = key.toLowerCase()
  const terms = search
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 0)
  if (terms.length === 0) return true
  return terms.some((term) => lowerKey.includes(term))
}

interface DeltaMessage {
  context?: string
  updates?: Array<{
    timestamp: string
    $source?: string
    source?: {
      pgn?: number
      sentence?: string
    }
    values?: Array<{
      path: string
      value: unknown
    }>
    meta?: Array<{
      path: string
      value: unknown
    }>
  }>
}

interface SelectOption {
  label: string
  value: string
  section?: 'all' | 'self' | 'ais'
  isFirstAis?: boolean
}

const ContextOption = (props: OptionProps<SelectOption>) => {
  const { data } = props
  const needsBorder = data.value === 'self' || data.isFirstAis
  return (
    <div style={needsBorder ? { borderTop: '1px solid #ccc' } : undefined}>
      <components.Option {...props} />
    </div>
  )
}

const DataBrowser: React.FC = () => {
  const { ws: webSocket, isConnected, skSelf } = useWebSocket()

  const [hasData, setHasData] = useState(false)
  const [pause, setPause] = useState(
    () => localStorage.getItem(pauseStorageKey) === 'true'
  )
  const [raw, setRaw] = useState(
    () => localStorage.getItem(rawStorageKey) === 'true'
  )
  const [context, setContext] = useState(
    () => localStorage.getItem(contextStorageKey) || 'self'
  )
  const [search, setSearch] = useState(
    () => localStorage.getItem(searchStorageKey) || ''
  )
  const [viewBySource, setViewBySource] = useState(
    () => localStorage.getItem(viewBySourceStorageKey) === 'true'
  )
  const [sourceFilter, setSourceFilter] = useState(
    () => localStorage.getItem(sourceFilterStorageKey) !== 'false'
  )
  const [rawSourcesData, setRawSourcesData] = useState<SourcesData | null>(null)
  const [collapsedSources, setCollapsedSources] = useState<Set<string>>(
    () => new Set()
  )

  const deferredSearch = useDeferredValue(search)
  const isSearchStale = search !== deferredSearch

  const dataVersion = useStore((s) => s.dataVersion)

  const contextKeys = useStore(
    useShallow((s) => Object.keys(s.signalkData).sort())
  )

  const updatePath = useStore((s) => s.updatePath)
  const updateMeta = useStore((s) => s.updateMeta)
  const getPathData = useStore((s) => s.getPathData)

  const unitPrefsLoaded = useUnitPrefsLoaded()
  const fetchUnitPreferences = useStore((s) => s.fetchUnitPreferences)
  const configuredPriorityPaths = useConfiguredPriorityPaths()
  const preferredSourceByPath = usePreferredSourceByPath()

  const didSubscribeRef = useRef(false)
  const webSocketRef = useRef<WebSocket | null>(null)
  const isMountedRef = useRef(true)

  const loadSources = useCallback(async (): Promise<SourcesData> => {
    const response = await fetch(`/signalk/v1/api/sources`, {
      credentials: 'include'
    })
    return (await response.json()) as SourcesData
  }, [])

  const handleMessage = useCallback(
    (msg: unknown) => {
      if (pause) {
        return
      }

      const currentSkSelf = getWebSocketService().getSkSelf()
      const deltaMsg = msg as DeltaMessage

      if (!currentSkSelf) {
        return
      }

      if (deltaMsg.context && deltaMsg.updates) {
        const key =
          deltaMsg.context === currentSkSelf ? 'self' : deltaMsg.context

        let isNew = false

        deltaMsg.updates.forEach((update) => {
          if (update.values) {
            const pgn =
              update.source && update.source.pgn && `(${update.source.pgn})`
            const sentence =
              update.source &&
              update.source.sentence &&
              `(${update.source.sentence})`

            update.values.forEach((vp) => {
              const timestamp = dayjs(update.timestamp)
              const formattedTimestamp = timestamp.isSame(dayjs(), 'day')
                ? timestamp.format(TIME_ONLY_FORMAT)
                : timestamp.format(TIMESTAMP_FORMAT)

              if (vp.path === '') {
                if (vp.value && typeof vp.value === 'object') {
                  Object.keys(vp.value as object).forEach((k) => {
                    const path$SourceKey = getPath$SourceKey(k, update.$source)
                    const pathData: PathData = {
                      path: k,
                      value: (vp.value as Record<string, unknown>)[k],
                      $source: update.$source,
                      pgn: pgn || undefined,
                      sentence: sentence || undefined,
                      timestamp: formattedTimestamp
                    }
                    const wasNew = !getPathData(key, path$SourceKey)
                    updatePath(key, path$SourceKey, pathData)
                    if (wasNew) isNew = true
                  })
                }
              } else {
                const path$SourceKey = getPath$SourceKey(
                  vp.path,
                  update.$source
                )
                const pathData: PathData = {
                  path: vp.path,
                  $source: update.$source,
                  value: vp.value,
                  pgn: pgn || undefined,
                  sentence: sentence || undefined,
                  timestamp: formattedTimestamp
                }
                const wasNew = !getPathData(key, path$SourceKey)
                updatePath(key, path$SourceKey, pathData)
                if (wasNew) isNew = true
              }
            })
          }
          if (update.meta) {
            update.meta.forEach((vp) => {
              updateMeta(key, vp.path, vp.value as Partial<MetaData>)
            })
          }
        })

        if ((isNew || (context && context === key)) && !hasData) {
          setHasData(true)
        }
      }
    },
    [pause, context, hasData, updatePath, updateMeta, getPathData]
  )

  useDeltaMessages(handleMessage)

  const subscribeToDataIfNeeded = useCallback(() => {
    if (
      !pause &&
      webSocket &&
      isConnected &&
      skSelf &&
      (webSocket !== webSocketRef.current || didSubscribeRef.current === false)
    ) {
      granularSubscriptionManager.setWebSocket(
        webSocket as unknown as WebSocket
      )
      granularSubscriptionManager.setSourcePolicy(
        sourceFilter ? 'preferred' : 'all'
      )
      granularSubscriptionManager.startDiscovery()

      webSocketRef.current = webSocket
      didSubscribeRef.current = true
    }
  }, [pause, webSocket, isConnected, skSelf, sourceFilter])

  useEffect(() => {
    isMountedRef.current = true

    loadSources()
      .then((sourcesData) => {
        if (isMountedRef.current) {
          setRawSourcesData(sourcesData)
        }
      })
      .catch((err) => console.warn('Failed to load sources:', err))

    if (!unitPrefsLoaded) {
      fetchUnitPreferences()
    }

    return () => {
      isMountedRef.current = false
    }
  }, [loadSources, unitPrefsLoaded, fetchUnitPreferences])

  const contextOptions: SelectOption[] = useMemo(() => {
    const currentData = getSignalkData()
    const options: SelectOption[] = [
      { value: 'all', label: 'ALL', section: 'all' }
    ]

    if (contextKeys.includes('self')) {
      const contextData = currentData['self']?.['name'] as
        | { value?: string }
        | undefined
      const contextName = contextData?.value
      options.push({
        value: 'self',
        label: `${contextName || ''} self`,
        section: 'self'
      })
    }

    let isFirst = true
    contextKeys.forEach((key) => {
      if (key !== 'self') {
        const contextData = currentData[key]?.['name'] as
          | { value?: string }
          | undefined
        const contextName = contextData?.value
        options.push({
          value: key,
          label: `${contextName || ''} ${key}`,
          section: 'ais',
          isFirstAis: isFirst
        })
        isFirst = false
      }
    })

    return options
  }, [contextKeys])

  useEffect(() => {
    subscribeToDataIfNeeded()
  }, [subscribeToDataIfNeeded])

  useEffect(() => {
    return () => {
      granularSubscriptionManager.unsubscribeAll()
      didSubscribeRef.current = false
    }
  }, [])

  const handleContextChange = useCallback(
    (selectedOption: SingleValue<SelectOption>) => {
      const value = selectedOption ? selectedOption.value : 'none'
      setContext(value)
      localStorage.setItem(contextStorageKey, value)
    },
    []
  )

  const currentContext: SelectOption | null =
    contextOptions.find((option) => option.value === context) || null

  const handleSearch = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const value = event.target.value
      setSearch(value)
      localStorage.setItem(searchStorageKey, value)
    },
    []
  )

  const showContext = context === 'all'

  const filteredPathKeys: string[] = useMemo(() => {
    const currentData = dataVersion >= 0 ? getSignalkData() : {}
    const contexts = context === 'all' ? Object.keys(currentData) : [context]

    let filtered: string[] = []

    const sourceLabels = new Map<string, string>()
    const getLabel = (src: string): string => {
      if (!src) return ''
      let label = sourceLabels.get(src)
      if (label === undefined) {
        label = buildSourceLabel(src, rawSourcesData)
        sourceLabels.set(src, label)
      }
      return label
    }

    for (const ctx of contexts) {
      const contextData = currentData[ctx] || {}
      for (const key of Object.keys(contextData)) {
        const pathData = contextData[key] as PathData | undefined
        const source = pathData?.$source || ''
        const pgn = pathData?.pgn || ''
        const sentence = pathData?.sentence || ''
        if (
          !matchesSearch(key, deferredSearch) &&
          !matchesSearch(source, deferredSearch) &&
          !matchesSearch(getLabel(source), deferredSearch) &&
          !matchesSearch(pgn, deferredSearch) &&
          !matchesSearch(sentence, deferredSearch)
        ) {
          continue
        }
        filtered.push(context === 'all' ? `${ctx}\0${key}` : key)
      }
    }

    // In "Priority filtered" mode, deduplicate by path — keep only the
    // preferred source's entry (or the first one seen if no priority is
    // configured for that path). The server's live delta stream already
    // filters, but the initial cached-data dump may contain multiple
    // sources for the same path.
    if (sourceFilter) {
      if (viewBySource) {
        // By Source + Priority filtered: remove entries where a different
        // source is configured as preferred for this path. Paths without
        // priority config keep all sources (server sends first-wins).
        filtered = filtered.filter((compositeKey) => {
          const nullIdx = compositeKey.indexOf('\0')
          const realKey =
            nullIdx >= 0 ? compositeKey.slice(nullIdx + 1) : compositeKey
          const path = getPathFromKey(realKey)
          const preferred = preferredSourceByPath.get(path)
          if (!preferred) return true
          const ctxPrefix = nullIdx >= 0 ? compositeKey.slice(0, nullIdx) : ''
          const pathData = currentData[ctxPrefix || context]?.[realKey] as
            | PathData
            | undefined
          return pathData?.$source === preferred
        })
      } else {
        // By Path + Priority filtered: deduplicate by path, keeping
        // only the preferred source's entry (or first seen if no
        // priority is configured).
        const seenPaths = new Map<string, string>()
        const deduped: string[] = []
        for (const compositeKey of filtered) {
          const nullIdx = compositeKey.indexOf('\0')
          const realKey =
            nullIdx >= 0 ? compositeKey.slice(nullIdx + 1) : compositeKey
          const path = getPathFromKey(realKey)
          const ctxPrefix = nullIdx >= 0 ? compositeKey.slice(0, nullIdx) : ''
          const dedupKey = ctxPrefix ? `${ctxPrefix}\0${path}` : path

          if (!seenPaths.has(dedupKey)) {
            seenPaths.set(dedupKey, compositeKey)
            deduped.push(compositeKey)
          } else {
            const pathData = currentData[ctxPrefix || context]?.[realKey] as
              | PathData
              | undefined
            const src = pathData?.$source
            if (src && preferredSourceByPath.get(path) === src) {
              const oldIdx = deduped.indexOf(seenPaths.get(dedupKey)!)
              if (oldIdx >= 0) deduped[oldIdx] = compositeKey
              seenPaths.set(dedupKey, compositeKey)
            }
          }
        }
        filtered = deduped
      }
    }

    if (!viewBySource) {
      return filtered.sort((a, b) => a.localeCompare(b))
    }

    const getSource = (compositeKey: string): string => {
      const nullIdx = compositeKey.indexOf('\0')
      const realKey =
        nullIdx >= 0 ? compositeKey.slice(nullIdx + 1) : compositeKey
      const ctx = nullIdx >= 0 ? compositeKey.slice(0, nullIdx) : context
      const pathData = currentData[ctx]?.[realKey] as PathData | undefined
      return pathData?.$source || 'unknown'
    }

    const matchedSourceCounts = new Map<string, number>()
    for (const key of filtered) {
      const src = getSource(key)
      matchedSourceCounts.set(src, (matchedSourceCounts.get(src) || 0) + 1)
    }

    filtered.sort((a, b) => {
      const srcA = getSource(a)
      const srcB = getSource(b)
      const srcCmp = srcA.localeCompare(srcB)
      if (srcCmp !== 0) return srcCmp
      return a.localeCompare(b)
    })

    const bySource = new Map<string, string[]>()
    for (const key of filtered) {
      const src = getSource(key)
      if (!bySource.has(src)) bySource.set(src, [])
      bySource.get(src)!.push(key)
    }

    const result: string[] = []
    for (const src of [...matchedSourceCounts.keys()].sort()) {
      const visibleCount = matchedSourceCounts.get(src)!
      result.push(`${HEADER_PREFIX}${src}\0${visibleCount}`)
      if (!collapsedSources.has(src)) {
        const paths = bySource.get(src)
        if (paths) result.push(...paths)
      }
    }
    return result
  }, [
    context,
    deferredSearch,
    dataVersion,
    viewBySource,
    sourceFilter,
    preferredSourceByPath,
    collapsedSources,
    rawSourcesData
  ])

  const toggleSourceCollapse = useCallback((sourceRef: string) => {
    setCollapsedSources((prev) => {
      const next = new Set(prev)
      if (next.has(sourceRef)) {
        next.delete(sourceRef)
      } else {
        next.add(sourceRef)
      }
      return next
    })
  }, [])

  const collapseAllSources = useCallback(() => {
    const all = new Set<string>()
    for (const key of filteredPathKeys) {
      if (key.startsWith(HEADER_PREFIX)) {
        const rest = key.slice(HEADER_PREFIX.length)
        const sepIdx = rest.indexOf('\0')
        all.add(sepIdx >= 0 ? rest.slice(0, sepIdx) : rest)
      }
    }
    setCollapsedSources(all)
  }, [filteredPathKeys])

  const expandAllSources = useCallback(() => {
    setCollapsedSources(new Set())
  }, [])

  const handleRawChange = useCallback(
    (event: React.ChangeEvent<HTMLSelectElement>) => {
      const newValue = event.target.value === 'raw'
      setRaw(newValue)
      localStorage.setItem(rawStorageKey, String(newValue))
    },
    []
  )

  const handlePause = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const newPause = event.target.checked
      setPause(newPause)
      localStorage.setItem(pauseStorageKey, String(newPause))
      if (newPause) {
        granularSubscriptionManager.unsubscribeAll()
        didSubscribeRef.current = false
      } else {
        loadSources()
          .then((sourcesData) => {
            setRawSourcesData(sourcesData)
          })
          .catch((err) => console.warn('Failed to load sources:', err))
        subscribeToDataIfNeeded()
      }
    },
    [loadSources, subscribeToDataIfNeeded]
  )

  const handleViewChange = useCallback(
    (event: React.ChangeEvent<HTMLSelectElement>) => {
      const newValue = event.target.value === 'bySource'
      setViewBySource(newValue)
      localStorage.setItem(viewBySourceStorageKey, String(newValue))
    },
    []
  )

  const handleSourcesChange = useCallback(
    (event: React.ChangeEvent<HTMLSelectElement>) => {
      const newValue = event.target.value === 'filtered'
      setSourceFilter(newValue)
      localStorage.setItem(sourceFilterStorageKey, String(newValue))
      if (!pause) {
        granularSubscriptionManager.unsubscribeAll()
        didSubscribeRef.current = false
      }
    },
    [pause]
  )

  return (
    <div className="animated fadeIn">
      <Card>
        <Card.Body>
          <Form
            action=""
            method="post"
            encType="multipart/form-data"
            className="form-horizontal"
            onSubmit={(e) => {
              e.preventDefault()
            }}
          >
            <Form.Group as={Row} className="mb-2 align-items-center g-2">
              <Col xs="12" md="3">
                <Select<SelectOption, false>
                  value={currentContext}
                  onChange={handleContextChange}
                  options={contextOptions}
                  placeholder="Select a context"
                  isSearchable={true}
                  maxMenuHeight={500}
                  noOptionsMessage={() => 'No contexts available'}
                  components={{ Option: ContextOption }}
                  styles={{
                    menu: (base) => ({ ...base, zIndex: 100 }),
                    option: (base, state) => ({
                      ...base,
                      backgroundColor: state.isSelected
                        ? base.backgroundColor
                        : 'transparent',
                      ':hover': {
                        backgroundColor: '#deebff'
                      }
                    })
                  }}
                />
              </Col>
              <Col xs="6" md="2">
                <Form.Select
                  value={viewBySource ? 'bySource' : 'paths'}
                  onChange={handleViewChange}
                >
                  <option value="paths">By Path</option>
                  <option value="bySource">By Source</option>
                </Form.Select>
              </Col>
              {viewBySource && (
                <Col xs="auto">
                  <Button
                    size="sm"
                    variant="outline-secondary"
                    onClick={expandAllSources}
                    style={{ marginRight: '4px' }}
                  >
                    Expand All
                  </Button>
                  <Button
                    size="sm"
                    variant="outline-secondary"
                    onClick={collapseAllSources}
                  >
                    Collapse All
                  </Button>
                </Col>
              )}
              <Col xs="6" md="2">
                <Form.Select
                  value={sourceFilter ? 'filtered' : 'all'}
                  onChange={handleSourcesChange}
                >
                  <option value="filtered">Priority filtered</option>
                  <option value="all">All sources</option>
                </Form.Select>
              </Col>
              <Col xs="6" md="2">
                <Form.Select
                  value={raw ? 'raw' : 'value'}
                  onChange={handleRawChange}
                >
                  <option value="value">As Value</option>
                  <option value="raw">As Raw</option>
                </Form.Select>
              </Col>
              <Col xs="6" md="auto" className="ms-md-auto">
                <label className="switch switch-text switch-primary">
                  <input
                    type="checkbox"
                    id="databrowser-pause"
                    name="pause"
                    className="switch-input"
                    onChange={handlePause}
                    checked={pause}
                  />
                  <span className="switch-label" data-on="Yes" data-off="No" />
                  <span className="switch-handle" />
                </label>{' '}
                <label
                  htmlFor="databrowser-pause"
                  style={{ whiteSpace: 'nowrap', cursor: 'pointer' }}
                >
                  Pause
                </label>
              </Col>
            </Form.Group>
            {context && context !== 'none' && (
              <Form.Group as={Row}>
                <Col xs="3" md="2">
                  <label htmlFor="databrowser-search">Search</label>
                </Col>
                <Col xs="12" md="12">
                  <Form.Control
                    type="text"
                    id="databrowser-search"
                    name="search"
                    autoComplete="off"
                    placeholder="e.g. pos wind furuno 65017 (path/source/PGN, space = OR)"
                    onChange={handleSearch}
                    value={search}
                  />
                </Col>
              </Form.Group>
            )}

            {context && context !== 'none' && (
              <div
                style={{
                  opacity: isSearchStale ? 0.7 : 1,
                  transition: 'opacity 0.15s'
                }}
              >
                <VirtualizedDataTable
                  path$SourceKeys={filteredPathKeys}
                  context={context}
                  raw={raw}
                  isPaused={pause}
                  showContext={showContext}
                  sourcesData={rawSourcesData}
                  configuredPriorityPaths={configuredPriorityPaths}
                  preferredSourceByPath={
                    !sourceFilter ? preferredSourceByPath : undefined
                  }
                  collapsedSources={viewBySource ? collapsedSources : undefined}
                  onToggleSourceCollapse={
                    viewBySource ? toggleSourceCollapse : undefined
                  }
                />
              </div>
            )}
          </Form>
        </Card.Body>
      </Card>
    </div>
  )
}

export default DataBrowser
