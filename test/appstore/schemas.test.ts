import { expect } from 'chai'
import { Value } from '@sinclair/typebox/value'
import {
  AppStoreEntryExtensionSchema,
  IndicatorCheckSchema,
  IndicatorResultSchema,
  PluginDetailPayloadSchema,
  SignalKPackageMetadataSchema
} from '../../dist/appstore/schemas.js'

describe('appstore/schemas', () => {
  it('accepts a valid SignalK package metadata block', () => {
    const value = {
      displayName: 'Example',
      appIcon: './icon.png',
      screenshots: ['./a.png', './b.png'],
      requires: ['signalk-charts-plugin'],
      recommends: ['@signalk/freeboard-sk']
    }
    expect(Value.Check(SignalKPackageMetadataSchema, value)).to.equal(true)
  })

  it('accepts an empty metadata block', () => {
    expect(Value.Check(SignalKPackageMetadataSchema, {})).to.equal(true)
  })

  it('rejects non-string screenshots', () => {
    const value = { screenshots: [1, 2, 3] }
    expect(Value.Check(SignalKPackageMetadataSchema, value)).to.equal(false)
  })

  it('rejects non-string requires entries', () => {
    const value = { requires: ['ok', 42] }
    expect(Value.Check(SignalKPackageMetadataSchema, value)).to.equal(false)
  })

  it('indicator check rejects unknown status', () => {
    const check = {
      id: 'x',
      status: 'pending',
      title: 't',
      subtitle: 's'
    }
    expect(Value.Check(IndicatorCheckSchema, check)).to.equal(false)
  })

  it('indicator result enforces score range', () => {
    const bad = {
      score: 150,
      checks: [],
      reportedPlatforms: [],
      rawMetrics: {}
    }
    expect(Value.Check(IndicatorResultSchema, bad)).to.equal(false)
  })

  it('entry extension requires official and deprecated booleans', () => {
    const bad = {
      readmeUrl: 'https://x'
    }
    expect(Value.Check(AppStoreEntryExtensionSchema, bad)).to.equal(false)
  })

  it('entry extension accepts minimal valid payload', () => {
    const ok = {
      official: false,
      deprecated: false,
      readmeUrl: 'https://unpkg.com/pkg@1.0.0/README.md'
    }
    expect(Value.Check(AppStoreEntryExtensionSchema, ok)).to.equal(true)
  })

  it('plugin detail payload round-trips a realistic record', () => {
    const payload = {
      name: 'signalk-example',
      version: '1.0.0',
      screenshots: [],
      official: false,
      deprecated: false,
      readme: '# hi',
      changelog: '',
      requires: [
        { name: 'signalk-charts-plugin', installed: false },
        { name: '@signalk/freeboard-sk', installed: true }
      ],
      recommends: [],
      readmeFormat: 'markdown',
      changelogFormat: 'synthesized',
      fetchedAt: 0,
      fromCache: false
    }
    expect(Value.Check(PluginDetailPayloadSchema, payload)).to.equal(true)
  })

  it('plugin detail payload rejects missing required arrays', () => {
    const bad = {
      name: 'x',
      version: '1.0.0',
      screenshots: [],
      official: false,
      deprecated: false,
      readme: '',
      changelog: '',
      readmeFormat: 'markdown',
      changelogFormat: 'markdown',
      fetchedAt: 0,
      fromCache: false
    }
    expect(Value.Check(PluginDetailPayloadSchema, bad)).to.equal(false)
  })
})
