import { expect } from 'chai'
import {
  badgesToIndicators,
  RegistryIndexSchema,
  RegistryPluginDetailSchema
} from '../../dist/appstore/registry.js'
import { Value } from '@sinclair/typebox/value'

describe('appstore/registry schema', () => {
  it('accepts a realistic index document', () => {
    const idx = {
      generated: '2026-04-23T04:46:43.384Z',
      server_version: '2.24.0',
      plugin_count: 2,
      plugins: [
        {
          name: '@signalk/freeboard-sk',
          version: '2.21.0',
          composite_stable: 100,
          badges_stable: ['compatible', 'loads', 'activates', 'tested'],
          test_status: 'passing',
          last_tested: '2026-04-20T04:48:56.389Z',
          installs: true,
          loads: true,
          activates: true,
          providers: []
        },
        {
          name: 'signalk-minimal',
          composite_stable: 50
        }
      ]
    }
    expect(Value.Check(RegistryIndexSchema, idx)).to.equal(true)
  })

  it('accepts a plugin detail document', () => {
    const detail = {
      name: 'advancedwind',
      versions: {
        '2.6.3': {
          'server@stable': {
            installs: true,
            loads: true,
            activates: true,
            composite: 75,
            badges: ['compatible', 'loads', 'activates', 'npm-audit-ok'],
            test_status: 'none'
          }
        }
      }
    }
    expect(Value.Check(RegistryPluginDetailSchema, detail)).to.equal(true)
  })
})

describe('appstore/registry badgesToIndicators', () => {
  it('marks compatible/loads/activates as ok when present', () => {
    const r = badgesToIndicators(
      ['compatible', 'loads', 'activates', 'tested', 'npm-audit-ok'],
      100
    )
    expect(r.score).to.equal(100)
    const byId = Object.fromEntries(r.checks.map((c) => [c.id, c]))
    expect(byId.compatible.status).to.equal('ok')
    expect(byId.loads.status).to.equal('ok')
    expect(byId.activates.status).to.equal('ok')
    expect(byId.tested.status).to.equal('ok')
    expect(byId.audit.status).to.equal('ok')
  })

  it('marks tested as fail when tests-failing badge present', () => {
    const r = badgesToIndicators(['compatible', 'tests-failing'], 50)
    const tested = r.checks.find((c) => c.id === 'tested')
    expect(tested?.status).to.equal('fail')
  })

  it('marks tested as warn when no test badges present', () => {
    const r = badgesToIndicators(['compatible', 'loads', 'activates'], 50)
    const tested = r.checks.find((c) => c.id === 'tested')
    expect(tested?.status).to.equal('warn')
  })

  it('marks audit as fail when audit-critical', () => {
    const r = badgesToIndicators(['compatible', 'audit-critical'], 60)
    const audit = r.checks.find((c) => c.id === 'audit')
    expect(audit?.status).to.equal('fail')
  })

  it('marks audit as warn for moderate/high', () => {
    expect(
      badgesToIndicators(['audit-moderate'], 50).checks.find(
        (c) => c.id === 'audit'
      )?.status
    ).to.equal('warn')
    expect(
      badgesToIndicators(['audit-high'], 50).checks.find(
        (c) => c.id === 'audit'
      )?.status
    ).to.equal('warn')
  })

  it('includes has-providers as an ok check when present', () => {
    const r = badgesToIndicators(['compatible', 'has-providers'], 30)
    expect(r.checks.find((c) => c.id === 'has-providers')?.status).to.equal(
      'ok'
    )
  })

  it('defaults score to 0 when composite is missing', () => {
    const r = badgesToIndicators(['compatible'], undefined)
    expect(r.score).to.equal(0)
  })

  it('handles undefined badges gracefully', () => {
    const r = badgesToIndicators(undefined, 10)
    expect(r.score).to.equal(10)
    expect(r.checks).to.have.length.greaterThan(0)
  })
})
