import { expect } from 'chai'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { createIconProbeCache } from '../../dist/appstore/icon-probe.js'

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'appstore-iconprobe-'))
}

describe('appstore/icon-probe cache', () => {
  it('returns undefined for unknown entries', () => {
    const cache = createIconProbeCache(tmpDir())
    expect(cache.get('@signalk/foo', '1.0.0', './icon.svg')).to.equal(undefined)
  })

  it('persists resolved URLs across instances', () => {
    const dir = tmpDir()
    const a = createIconProbeCache(dir)
    const url = 'https://unpkg.com/@signalk/foo@1.0.0/public/icon.svg'
    a.set('@signalk/foo', '1.0.0', './icon.svg', url)
    const b = createIconProbeCache(dir)
    expect(b.get('@signalk/foo', '1.0.0', './icon.svg')).to.equal(url)
  })

  it('distinguishes null from undefined (null = probed, 404)', () => {
    const cache = createIconProbeCache(tmpDir())
    cache.set('@signalk/foo', '1.0.0', './icon.svg', null)
    const result = cache.get('@signalk/foo', '1.0.0', './icon.svg')
    expect(result).to.equal(null)
    expect(result).not.to.equal(undefined)
  })

  it('keys by package + version + declared path independently', () => {
    const cache = createIconProbeCache(tmpDir())
    cache.set('a', '1.0.0', './x', 'url-a')
    cache.set('a', '2.0.0', './x', 'url-b')
    cache.set('b', '1.0.0', './x', 'url-c')
    cache.set('a', '1.0.0', './y', 'url-d')
    expect(cache.get('a', '1.0.0', './x')).to.equal('url-a')
    expect(cache.get('a', '2.0.0', './x')).to.equal('url-b')
    expect(cache.get('b', '1.0.0', './x')).to.equal('url-c')
    expect(cache.get('a', '1.0.0', './y')).to.equal('url-d')
  })
})
