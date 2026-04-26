import { SourceRef } from '@signalk/server-api'
import assert from 'assert'
import { getToPreferredDelta, SourcePrioritiesData } from '../src/deltaPriority'
import chai from 'chai'
chai.should()

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeDelta(sourceRef: string, path: string, value: number): any {
  return {
    context: 'self',
    updates: [
      {
        $source: sourceRef,
        values: [{ path, value }]
      }
    ]
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function accepted(result: any): boolean {
  return result.updates[0].values.length > 0
}

describe('toPreferredDelta logic', () => {
  it('handles undefined values', () => {
    const sourcePreferences: SourcePrioritiesData = {}
    const toPreferredDelta = getToPreferredDelta(sourcePreferences, 200)

    const delta = toPreferredDelta(
      {
        context: 'self',
        updates: [
          {
            meta: [
              {
                path: 'environment.wind.speedApparent',
                value: { units: 'A' }
              }
            ]
          }
        ]
      },
      new Date(),
      'self'
    )
    assert(delta.updates[0].values === undefined)
  })

  it('works', () => {
    const sourcePreferences: SourcePrioritiesData = {
      'environment.wind.speedApparent': [
        {
          sourceRef: 'a' as SourceRef,
          timeout: 0
        },
        {
          sourceRef: 'b' as SourceRef,
          timeout: 150
        },
        {
          sourceRef: 'c' as SourceRef,
          timeout: 150
        }
      ]
    }
    const toPreferredDelta = getToPreferredDelta(sourcePreferences, 200)

    let totalDelay = 0
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result: any[] = []
    const expectedResult: string[] = []
    let n = 0
    function push(sourceRef: string, delay: number, shouldBeEmitted: boolean) {
      totalDelay += delay
      if (shouldBeEmitted) {
        expectedResult.push(sourceRef)
      }
      setTimeout(() => {
        result.push(
          toPreferredDelta(
            {
              context: 'self',
              updates: [
                {
                  $source: sourceRef,
                  values: [
                    {
                      path: 'environment.wind.speedApparent',
                      value: n++
                    }
                  ]
                }
              ]
            },
            new Date(),
            'self'
          )
        )
      }, totalDelay)
    }

    push('a', 0, true)
    push('b', 50, false)
    push('c', 50, false)
    push('b', 100, true)
    push('a', 0, true)
    push('b', 10, false)
    push('c', 10, false)
    push('c', 150, true)
    push('b', 10, true)
    push('c', 10, false)
    push('c', 150, true)
    push('a', 10, true)
    push('b', 10, false)
    push('d', 0, false)
    push('c', 10, false)
    push('c', 150, true)
    push('d', 205, true)

    return new Promise((resolve, reject) => {
      setTimeout(() => {
        try {
          result
            .filter((r) => r.updates[0].values.length > 0)
            .map((r) => r.updates[0].$source)
            .should.eql(expectedResult)
          resolve(undefined)
        } catch (err) {
          reject(err)
        }
      }, totalDelay + 10)
    })
  })
})

describe('disabled source (timeout=-1)', () => {
  const PATH = 'environment.wind.speedApparent'

  it('disabled source in path-level config is always rejected', () => {
    const pathConfig: SourcePrioritiesData = {
      [PATH]: [
        { sourceRef: 'a' as SourceRef, timeout: 0 },
        { sourceRef: 'b' as SourceRef, timeout: -1 }
      ]
    }
    const toPreferred = getToPreferredDelta(pathConfig)
    const t = 1000000

    const r1 = toPreferred(makeDelta('b', PATH, 1), new Date(t), 'self')
    assert(!accepted(r1), 'disabled b rejected initially')

    const r2 = toPreferred(
      makeDelta('b', PATH, 2),
      new Date(t + 999999),
      'self'
    )
    assert(!accepted(r2), 'disabled b rejected even after long delay')
  })

  it('enabled siblings still work when a source is disabled', () => {
    const pathConfig: SourcePrioritiesData = {
      [PATH]: [
        { sourceRef: 'a' as SourceRef, timeout: 0 },
        { sourceRef: 'b' as SourceRef, timeout: -1 },
        { sourceRef: 'c' as SourceRef, timeout: 5000 }
      ]
    }
    const toPreferred = getToPreferredDelta(pathConfig)
    const t = 1000000

    toPreferred(makeDelta('a', PATH, 1), new Date(t), 'self')

    const r1 = toPreferred(makeDelta('b', PATH, 2), new Date(t + 1), 'self')
    assert(!accepted(r1), 'disabled b rejected')

    const r2 = toPreferred(makeDelta('c', PATH, 3), new Date(t + 5001), 'self')
    assert(accepted(r2), 'enabled c accepted after timeout')
  })

  it('disabled preferred source allows next source to win', () => {
    const pathConfig: SourcePrioritiesData = {
      [PATH]: [
        { sourceRef: 'a' as SourceRef, timeout: -1 },
        { sourceRef: 'b' as SourceRef, timeout: 0 }
      ]
    }
    const toPreferred = getToPreferredDelta(pathConfig)
    const t = 1000000

    const r1 = toPreferred(makeDelta('a', PATH, 1), new Date(t), 'self')
    assert(!accepted(r1), 'disabled preferred source a rejected')

    const r2 = toPreferred(makeDelta('b', PATH, 2), new Date(t), 'self')
    assert(accepted(r2), 'next source b accepted')

    const r3 = toPreferred(makeDelta('a', PATH, 3), new Date(t + 1), 'self')
    assert(!accepted(r3), 'disabled a still rejected')
  })
})

describe('path-level displaces unknown incumbent', () => {
  const PATH = 'environment.wind.speedApparent'

  it('configured source displaces unknown incumbent immediately', () => {
    // An unknown (unconfigured) source publishes the path first and
    // becomes 'latest'. When the user's configured source arrives, it
    // must win immediately — otherwise the configured source gets
    // permanently shadowed by the unconfigured one.
    const pathConfig: SourcePrioritiesData = {
      [PATH]: [{ sourceRef: 'venus' as SourceRef, timeout: 60000 }]
    }
    const toPreferred = getToPreferredDelta(pathConfig)
    const t = 1000000

    const r1 = toPreferred(makeDelta('n2k', PATH, 1), new Date(t), 'self')
    assert(accepted(r1), 'first n2k delta accepted (nothing else seen yet)')

    const r2 = toPreferred(
      makeDelta('venus', PATH, 2),
      new Date(t + 100),
      'self'
    )
    assert(accepted(r2), 'configured venus displaces unconfigured n2k')

    const r3 = toPreferred(makeDelta('n2k', PATH, 3), new Date(t + 200), 'self')
    assert(!accepted(r3), 'n2k rejected while configured venus is winning')
  })

  it("configured source's timeout holds off unknown competitors", () => {
    // With a 60s timeout configured, an unknown source must not steal
    // the slot after just unknownSourceTimeout.
    const pathConfig: SourcePrioritiesData = {
      [PATH]: [{ sourceRef: 'plugin' as SourceRef, timeout: 60000 }]
    }
    const toPreferred = getToPreferredDelta(pathConfig, 10000)
    const t = 1000000

    toPreferred(makeDelta('plugin', PATH, 1), new Date(t), 'self')

    const r1 = toPreferred(
      makeDelta('n2k', PATH, 2),
      new Date(t + 11000),
      'self'
    )
    assert(
      !accepted(r1),
      'unknown n2k rejected within configured timeout even past unknownSourceTimeout'
    )

    const r2 = toPreferred(
      makeDelta('n2k', PATH, 3),
      new Date(t + 60001),
      'self'
    )
    assert(accepted(r2), 'unknown n2k accepted after configured timeout')
  })

  it('unknown source that briefly won does not self-renew forever', () => {
    // If the configured source goes silent just long enough for an
    // unknown source to squeeze in, the unknown source must not then
    // self-renew via the "latest.sourceRef === sourceRef" rule —
    // otherwise a transient gap permanently shadows the configured
    // preference.
    const pathConfig: SourcePrioritiesData = {
      [PATH]: [{ sourceRef: 'plugin' as SourceRef, timeout: 1000 }]
    }
    const toPreferred = getToPreferredDelta(pathConfig, 500)
    const t = 1000000

    toPreferred(makeDelta('plugin', PATH, 1), new Date(t), 'self')

    const r1 = toPreferred(
      makeDelta('n2k', PATH, 2),
      new Date(t + 1500),
      'self'
    )
    assert(accepted(r1), 'n2k accepted after plugin goes silent')

    const r2 = toPreferred(
      makeDelta('plugin', PATH, 3),
      new Date(t + 1501),
      'self'
    )
    assert(accepted(r2), 'plugin reclaims the slot from unknown incumbent')
  })
})

describe('notifications bypass priority', () => {
  const NOTI = 'notifications.instrument.NoFix'

  it('notification from low-priority source is accepted', () => {
    const pathConfig: SourcePrioritiesData = {
      [NOTI]: [
        { sourceRef: 'plotter' as SourceRef, timeout: 5000 },
        { sourceRef: 'i70' as SourceRef, timeout: 5000 }
      ]
    }
    const toPreferred = getToPreferredDelta(pathConfig)
    const t = 1000000

    toPreferred(makeDelta('plotter', NOTI, 1), new Date(t), 'self')
    const r = toPreferred(makeDelta('i70', NOTI, 2), new Date(t + 1), 'self')
    assert(
      accepted(r),
      'i70 notification accepted despite plotter being higher priority'
    )
  })

  it('notification from disabled source is still accepted', () => {
    const pathConfig: SourcePrioritiesData = {
      [NOTI]: [{ sourceRef: 'i70' as SourceRef, timeout: -1 }]
    }
    const toPreferred = getToPreferredDelta(pathConfig)
    const r = toPreferred(makeDelta('i70', NOTI, 1), new Date(1000000), 'self')
    assert(accepted(r), 'disabled source notification still accepted')
  })

  it('path-level config on a notification path is ignored', () => {
    const pathConfig: SourcePrioritiesData = {
      [NOTI]: [{ sourceRef: 'plotter' as SourceRef, timeout: 5000 }]
    }
    const toPreferred = getToPreferredDelta(pathConfig)
    const t = 1000000

    toPreferred(makeDelta('plotter', NOTI, 1), new Date(t), 'self')
    const r = toPreferred(makeDelta('i70', NOTI, 2), new Date(t + 1), 'self')
    assert(accepted(r), 'unconfigured source still wins on notification path')
  })

  it('non-notification path in same scenario still respects priority', () => {
    const pathConfig: SourcePrioritiesData = {
      'environment.wind.speedApparent': [
        { sourceRef: 'plotter' as SourceRef, timeout: 5000 },
        { sourceRef: 'i70' as SourceRef, timeout: 5000 }
      ]
    }
    const toPreferred = getToPreferredDelta(pathConfig)
    const PATH = 'environment.wind.speedApparent'
    const t = 1000000

    toPreferred(makeDelta('plotter', PATH, 1), new Date(t), 'self')
    const r = toPreferred(makeDelta('i70', PATH, 2), new Date(t + 1), 'self')
    assert(
      !accepted(r),
      'i70 rejected on regular path because plotter is higher priority'
    )
  })
})

describe('non-self context', () => {
  it('non-self context deltas pass through unchanged', () => {
    const pathConfig: SourcePrioritiesData = {
      'environment.wind.speedApparent': [
        { sourceRef: 'a' as SourceRef, timeout: 0 },
        { sourceRef: 'b' as SourceRef, timeout: -1 }
      ]
    }
    const toPreferred = getToPreferredDelta(pathConfig)
    const PATH = 'environment.wind.speedApparent'

    // Even disabled source b passes through for non-self context
    const delta = makeDelta('b', PATH, 1)
    delta.context = 'vessels.urn:mrn:imo:1234567'
    const r = toPreferred(delta, new Date(1000000), 'self')
    assert(accepted(r), 'non-self context should pass through unchanged')
  })
})

describe('transport-agnostic CAN Name matching', () => {
  const CAN = 'c0788c00e7e04312'
  const PATH = 'navigation.speedOverGround'

  it('accepts same CAN Name under a different provider', () => {
    const cfg: SourcePrioritiesData = {
      [PATH]: [
        { sourceRef: `YDEN02.${CAN}` as SourceRef, timeout: 0 },
        { sourceRef: 'derived-data' as SourceRef, timeout: 5000 }
      ]
    }
    const toPreferred = getToPreferredDelta(cfg)
    // Delta arrives via a remote Signal K server with the remote
    // providerId baked into $source.
    const r = toPreferred(
      makeDelta(`canhat.${CAN}`, PATH, 5),
      new Date(1000000),
      'self'
    )
    assert(
      accepted(r),
      'same CAN Name under a different provider should be treated as the ranked source'
    )
  })

  it('blocks a disabled CAN Name across providers', () => {
    const cfg: SourcePrioritiesData = {
      [PATH]: [
        { sourceRef: 'derived-data' as SourceRef, timeout: 0 },
        { sourceRef: `YDEN02.${CAN}` as SourceRef, timeout: -1 }
      ]
    }
    const toPreferred = getToPreferredDelta(cfg)
    const r = toPreferred(
      makeDelta(`canhat.${CAN}`, PATH, 5),
      new Date(1000000),
      'self'
    )
    assert(
      !accepted(r),
      'blacklisting a CAN Name under one provider should block it under any provider'
    )
  })

  it('does not conflate NMEA 0183 talkers across providers', () => {
    const cfg: SourcePrioritiesData = {
      [PATH]: [
        { sourceRef: 'serial0.GP' as SourceRef, timeout: 0 },
        { sourceRef: 'tcp.GP' as SourceRef, timeout: -1 }
      ]
    }
    const toPreferred = getToPreferredDelta(cfg)
    // serial0.GP is the preferred source; tcp.GP is disabled.
    // Both share the suffix "GP" but that is not a unique identity.
    const rDisabled = toPreferred(
      makeDelta('tcp.GP', PATH, 1),
      new Date(1000000),
      'self'
    )
    assert(!accepted(rDisabled), 'tcp.GP is disabled, so blocked')
    const rAllowed = toPreferred(
      makeDelta('serial0.GP', PATH, 2),
      new Date(1000100),
      'self'
    )
    assert(accepted(rAllowed), 'serial0.GP is allowed')
  })
})
