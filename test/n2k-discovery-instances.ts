import { expect } from 'chai'
import {
  buildPgnDataInstancesFromTree,
  buildPgnSourceKeysFromTree
} from '../src/n2k-discovery-instances'

// The SK self-vessel tree has paths like
//   electrical.batteries.<n>.voltage = { value, $source }
// Two devices each with their own $source publishing their own
// instance must produce non-overlapping entries — no false conflicts.

describe('buildPgnDataInstancesFromTree', function () {
  it('reads currently-published battery instances per source from the tree', function () {
    const tree = {
      electrical: {
        batteries: {
          '0': {
            voltage: { value: 24.1, $source: 'N2K.lynx-bms' }
          },
          '2': {
            voltage: { value: 13.8, $source: 'N2K.virtual-battery' }
          }
        }
      }
    }
    const out = buildPgnDataInstancesFromTree(tree)
    expect(out).to.have.property('N2K.lynx-bms')
    expect(out).to.have.property('N2K.virtual-battery')
    // PGN 127508 paths share electrical.batteries.<n> with 127506 and
    // 127513, so the helper credits all three to whoever publishes the
    // path. That's fine for conflict detection — those PGNs all share
    // the same primary key (instance) and would conflict together.
    expect(out['N2K.lynx-bms']['127508']).to.deep.equal([0])
    expect(out['N2K.virtual-battery']['127508']).to.deep.equal([2])
  })

  it('reads switch bank instances from electrical.switches.bank.<n>', function () {
    const tree = {
      electrical: {
        switches: {
          bank: {
            '20': {
              '1': {
                state: { value: 1, $source: 'N2K.ydcc-04-a' }
              }
            },
            '21': {
              '1': {
                state: { value: 0, $source: 'N2K.ydcc-04-b' }
              }
            },
            '100': {
              '1': {
                order: { value: 1, $source: 'N2K.ydri-04' }
              }
            }
          }
        }
      }
    }
    const out = buildPgnDataInstancesFromTree(tree)
    expect(out['N2K.ydcc-04-a']['127501']).to.deep.equal([20])
    expect(out['N2K.ydcc-04-b']['127501']).to.deep.equal([21])
    expect(out['N2K.ydri-04']['127501']).to.deep.equal([100])
  })

  it('handles multi-source leaves (values block)', function () {
    const tree = {
      electrical: {
        batteries: {
          '0': {
            voltage: {
              value: 24.1,
              $source: 'N2K.preferred',
              values: {
                'N2K.preferred': { value: 24.1 },
                'N2K.backup': { value: 24.0 }
              }
            }
          }
        }
      }
    }
    const out = buildPgnDataInstancesFromTree(tree)
    expect(out['N2K.preferred']['127508']).to.deep.equal([0])
    expect(out['N2K.backup']['127508']).to.deep.equal([0])
  })

  it('returns an empty object for an empty tree', function () {
    expect(buildPgnDataInstancesFromTree({})).to.deep.equal({})
    expect(buildPgnDataInstancesFromTree(undefined)).to.deep.equal({})
  })

  it('skips non-numeric instance keys', function () {
    const tree = {
      electrical: {
        batteries: {
          notes: { value: 'meta', $source: 'N2K.x' }, // not a real path
          '0': {
            voltage: { value: 24, $source: 'N2K.x' }
          }
        }
      }
    }
    const out = buildPgnDataInstancesFromTree(tree)
    expect(out['N2K.x']['127508']).to.deep.equal([0])
  })
})

describe('buildPgnSourceKeysFromTree', function () {
  it('builds compound instance:sourceLabel keys for temperature PGNs', function () {
    const tree = {
      environment: {
        inside: {
          '0': {
            temperature: { value: 295, $source: 'N2K.cabin-sensor' }
          }
        },
        outside: {
          '0': {
            temperature: { value: 285, $source: 'N2K.outdoor-sensor' }
          }
        }
      }
    }
    const out = buildPgnSourceKeysFromTree(tree)
    expect(out['N2K.cabin-sensor']['130312']).to.deep.equal(['0:inside'])
    expect(out['N2K.outdoor-sensor']['130312']).to.deep.equal(['0:outside'])
  })

  it('returns empty object for tree without temp/humidity paths', function () {
    expect(
      buildPgnSourceKeysFromTree({ electrical: { batteries: {} } })
    ).to.deep.equal({})
  })
})
