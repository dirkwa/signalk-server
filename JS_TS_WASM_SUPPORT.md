# JavaScript/TypeScript WASM Plugin Support

## Overview

Enable JavaScript and TypeScript developers to write WASM plugins without learning Rust, using familiar tooling and syntax.

## Approach: AssemblyScript

**AssemblyScript** is the ideal choice for JS/TS → WASM:
- ✅ TypeScript-like syntax (strict subset)
- ✅ Compiles directly to WASM
- ✅ Excellent WASI support
- ✅ Small binaries (~10-50 KB)
- ✅ Good performance
- ✅ Easy tooling integration

### Why Not Other Options?

**JavaScript Engines (QuickJS, Javy)**:
- ❌ Large binaries (>1 MB)
- ❌ Runtime overhead
- ❌ Complex FFI

**Emscripten**:
- ❌ C/C++ focused
- ❌ Large runtime
- ❌ Not JS/TS native

**Native JS in WASM**:
- ❌ Still experimental
- ❌ Limited browser support
- ❌ No Node.js standard

## Implementation Plan

### 1. Add AssemblyScript Dependencies

```json
{
  "devDependencies": {
    "assemblyscript": "^0.27.0",
    "as-wasi": "^0.6.0"
  }
}
```

### 2. Create AssemblyScript SDK

**Package**: `@signalk/assemblyscript-plugin-sdk`

**Structure**:
```
packages/assemblyscript-plugin-sdk/
├── assembly/
│   ├── index.ts         # Public API
│   ├── signalk.ts       # Signal K types
│   └── ffi.ts           # FFI bindings
├── package.json
├── asconfig.json        # AssemblyScript config
└── tsconfig.json
```

### 3. Plugin Development Workflow

**Developer writes TypeScript:**
```typescript
// assembly/index.ts
import { Plugin, Delta, emit } from '@signalk/assemblyscript-plugin-sdk'

export class MyPlugin extends Plugin {
  id(): string {
    return 'my-ts-plugin'
  }

  name(): string {
    return 'My TypeScript WASM Plugin'
  }

  start(config: string): i32 {
    // Parse config
    const cfg = JSON.parse<Config>(config)

    // Emit delta
    emit(new Delta({
      context: 'vessels.self',
      updates: [/* ... */]
    }))

    return 0 // Success
  }

  stop(): i32 {
    return 0
  }

  schema(): string {
    return JSON.stringify({
      type: 'object',
      properties: {
        updateRate: { type: 'number', default: 1000 }
      }
    })
  }
}
```

**Build to WASM:**
```bash
npm run asbuild
# Outputs: build/plugin.wasm
```

### 4. AssemblyScript SDK Implementation

**assembly/index.ts**:
```typescript
// Export base Plugin class
export abstract class Plugin {
  abstract id(): string
  abstract name(): string
  abstract start(config: string): i32
  abstract stop(): i32
  abstract schema(): string
}

// Delta types
export class PathValue {
  constructor(
    public path: string,
    public value: string // JSON-encoded
  ) {}
}

export class Update {
  constructor(
    public source: Source,
    public timestamp: string,
    public values: PathValue[]
  ) {}
}

export class Delta {
  constructor(
    public context: string,
    public updates: Update[]
  ) {}
}

// API functions
export function emit(delta: Delta): void {
  const json = JSON.stringify(delta)
  sk_emit_delta(json)
}

export function setStatus(message: string): void {
  sk_set_status(message)
}

export function setError(message: string): void {
  sk_set_error(message)
}

export function getSelfPath(path: string): string | null {
  const buffer = new ArrayBuffer(1024)
  const len = sk_get_self_path(path, buffer)
  if (len === 0) return null
  return String.UTF8.decode(buffer.slice(0, len))
}

// FFI declarations
@external("env", "sk_emit_delta")
declare function sk_emit_delta(json: string): void

@external("env", "sk_set_status")
declare function sk_set_status(message: string): void

@external("env", "sk_set_error")
declare function sk_set_error(message: string): void

@external("env", "sk_get_self_path")
declare function sk_get_self_path(path: string, buffer: ArrayBuffer): i32
```

**assembly/signalk.ts** - Signal K types:
```typescript
export class Position {
  constructor(
    public latitude: f64,
    public longitude: f64
  ) {}
}

export class Source {
  constructor(
    public label: string,
    public type: string
  ) {}
}

// More Signal K types...
```

### 5. CLI Scaffolding Tool

**Package**: `@signalk/create-wasm-plugin`

```bash
npx @signalk/create-wasm-plugin my-plugin --language assemblyscript
```

Creates:
```
my-plugin/
├── assembly/
│   ├── index.ts         # Plugin implementation
│   └── tsconfig.json
├── package.json
├── asconfig.json
└── README.md
```

### 6. Build Configuration

**asconfig.json**:
```json
{
  "targets": {
    "release": {
      "outFile": "build/plugin.wasm",
      "sourceMap": false,
      "optimize": true,
      "shrinkLevel": 2,
      "converge": true,
      "noAssert": true
    },
    "debug": {
      "outFile": "build/plugin.debug.wasm",
      "sourceMap": true,
      "debug": true
    }
  },
  "options": {
    "bindings": "esm",
    "runtime": "stub"
  }
}
```

**package.json scripts**:
```json
{
  "scripts": {
    "asbuild:debug": "asc assembly/index.ts --target debug",
    "asbuild:release": "asc assembly/index.ts --target release",
    "asbuild": "npm run asbuild:release",
    "test": "npm run asbuild:debug && node tests/test.js"
  }
}
```

## Example Plugins

### Hello World (AssemblyScript)

```typescript
import { Plugin, Delta, Update, PathValue, Source, emit, setStatus } from '@signalk/assemblyscript-plugin-sdk'

export class HelloPlugin extends Plugin {
  id(): string {
    return 'hello-assemblyscript'
  }

  name(): string {
    return 'Hello AssemblyScript Plugin'
  }

  start(config: string): i32 {
    setStatus('Started')

    // Emit a test delta
    const delta = new Delta(
      'vessels.self',
      [
        new Update(
          new Source('hello-assemblyscript', 'plugin'),
          new Date().toISOString(),
          [
            new PathValue(
              'notifications.hello',
              JSON.stringify({
                state: 'normal',
                method: ['visual'],
                message: 'Hello from AssemblyScript!'
              })
            )
          ]
        )
      ]
    )

    emit(delta)
    return 0
  }

  stop(): i32 {
    setStatus('Stopped')
    return 0
  }

  schema(): string {
    return JSON.stringify({
      type: 'object',
      properties: {}
    })
  }
}
```

### Data Logger (AssemblyScript)

```typescript
import { Plugin, getSelfPath, setStatus } from '@signalk/assemblyscript-plugin-sdk'
import { Console } from 'as-wasi'

export class LoggerPlugin extends Plugin {
  private updateRate: i32 = 1000
  private intervalId: i32 = 0

  id(): string {
    return 'data-logger-as'
  }

  name(): string {
    return 'Data Logger (AssemblyScript)'
  }

  start(config: string): i32 {
    // Parse config
    const cfg = JSON.parse<Config>(config)
    this.updateRate = cfg.updateRate || 1000

    // Start logging interval
    this.logData()
    setStatus('Logging every ' + this.updateRate.toString() + 'ms')

    return 0
  }

  logData(): void {
    const sog = getSelfPath('navigation.speedOverGround')
    const cog = getSelfPath('navigation.courseOverGroundTrue')
    const pos = getSelfPath('navigation.position')

    if (sog && cog && pos) {
      const timestamp = Date.now().toString()
      const logLine = timestamp + ',' + sog + ',' + cog + ',' + pos + '\n'

      // Write to VFS
      // Using as-wasi for file operations
      Console.log(logLine)
    }
  }

  stop(): i32 {
    setStatus('Stopped')
    return 0
  }

  schema(): string {
    return JSON.stringify({
      type: 'object',
      properties: {
        updateRate: {
          type: 'number',
          title: 'Update Rate (ms)',
          default: 1000
        }
      }
    })
  }
}

class Config {
  updateRate!: i32
}
```

## Comparison: Rust vs AssemblyScript

### Rust Plugin
**Pros**:
- Best performance
- Memory safety
- Rich ecosystem
- Strong typing

**Cons**:
- Steeper learning curve
- Longer compile times
- More verbose

**Best for**:
- Performance-critical plugins
- Complex algorithms
- Low-level operations

### AssemblyScript Plugin
**Pros**:
- TypeScript-like syntax
- Familiar to JS developers
- Fast development
- Good performance

**Cons**:
- Smaller ecosystem
- Some TS features missing
- Manual memory management

**Best for**:
- Quick prototypes
- Simple data processing
- JS/TS developers
- Migrating Node.js plugins

## Developer Experience Comparison

### Rust
```bash
# Setup
rustup target add wasm32-wasi

# Create
cargo new --lib my-plugin

# Build
cargo build --target wasm32-wasi --release

# Size
~50-200 KB (optimized)
```

### AssemblyScript
```bash
# Setup
npm install -g assemblyscript

# Create
npx @signalk/create-wasm-plugin my-plugin --lang as

# Build
npm run asbuild

# Size
~10-50 KB (optimized)
```

## Migration Path: Node.js → AssemblyScript

### Node.js Plugin (Before)
```javascript
module.exports = function(app) {
  const plugin = {
    id: 'my-plugin',
    name: 'My Plugin',

    start: function(options) {
      app.handleMessage('my-plugin', {
        updates: [{
          values: [{ path: 'foo', value: 'bar' }]
        }]
      })
    },

    stop: function() {}
  }

  return plugin
}
```

### AssemblyScript Plugin (After)
```typescript
export class MyPlugin extends Plugin {
  id(): string { return 'my-plugin' }
  name(): string { return 'My Plugin' }

  start(config: string): i32 {
    emit(new Delta('vessels.self', [
      new Update(
        new Source('my-plugin', 'plugin'),
        new Date().toISOString(),
        [new PathValue('foo', JSON.stringify('bar'))]
      )
    ]))
    return 0
  }

  stop(): i32 { return 0 }
  schema(): string { return '{}' }
}
```

**Migration complexity**: Low
**Time estimate**: 1-2 hours for simple plugins

## Implementation Tasks

### Phase 1A: AssemblyScript Support (2-3 weeks)

1. **Create AssemblyScript SDK** (Week 1)
   - [ ] Package structure
   - [ ] Core API bindings
   - [ ] Signal K types
   - [ ] Build configuration
   - [ ] Documentation

2. **CLI Scaffolding** (Week 2)
   - [ ] Enhance `create-wasm-plugin`
   - [ ] AssemblyScript templates
   - [ ] Build scripts
   - [ ] Testing utilities

3. **Example Plugins** (Week 2-3)
   - [ ] Hello World (AS)
   - [ ] Data Logger (AS)
   - [ ] Derived Data (AS)
   - [ ] Migration examples

4. **Documentation** (Week 3)
   - [ ] AssemblyScript plugin guide
   - [ ] Migration guide (Node.js → AS)
   - [ ] API reference
   - [ ] Video tutorial

### Testing Strategy

1. **SDK Tests**
   - Unit tests for FFI bindings
   - Integration tests with server
   - Type checking

2. **Example Plugins**
   - Build verification
   - Runtime testing
   - Performance benchmarks

3. **Migration Tests**
   - Port 3 existing plugins
   - Compare functionality
   - Measure effort

## Success Criteria

- [ ] AssemblyScript SDK published to npm
- [ ] CLI tool supports `--language assemblyscript`
- [ ] 3+ example AssemblyScript plugins
- [ ] Migration guide with real examples
- [ ] Developer tutorial (text + video)
- [ ] Performance within 10% of Rust
- [ ] Binary size <100 KB average

## Benefits

### For Developers
- **Lower barrier to entry**: Use TypeScript knowledge
- **Faster development**: Familiar syntax and tooling
- **Easy migration**: Port Node.js plugins incrementally
- **Good performance**: 80-90% of Rust speed
- **Small binaries**: 10-50 KB typical

### For Ecosystem
- **More WASM plugins**: Easier for existing developers
- **Faster adoption**: Don't need to learn Rust
- **Better testing**: More developers = more testing
- **Migration path**: Gradual transition from Node.js

### For Project
- **Validates architecture**: Multiple language support
- **Proves flexibility**: Not locked to Rust
- **Demonstrates value**: WASM benefits without Rust learning curve
- **Community growth**: More contributors

## Next Steps

1. **Start SDK Development**
   - Create `packages/assemblyscript-plugin-sdk`
   - Implement core bindings
   - Set up build system

2. **Update Documentation**
   - Add AssemblyScript section to dev guide
   - Create migration examples
   - Update README

3. **Create Example**
   - Build hello-world in AssemblyScript
   - Test with server
   - Verify hot-reload

4. **Enhance CLI**
   - Add `--language` flag
   - AssemblyScript template
   - Build script generation

Ready to implement AssemblyScript support alongside Rust?
