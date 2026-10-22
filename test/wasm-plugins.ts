/**
 * WASM Plugin Tests
 *
 * Tests that WASM plugins:
 * 1. Can be compiled from source (when SDK is available)
 * 2. Are discovered and loaded by the server
 * 3. Appear in the plugins API endpoint
 * 4. Can be enabled and started
 * 5. Stream Server-Sent Events pushed by the plugin
 *
 * Note: These tests require the example plugin to be pre-built.
 * Run from repo root: npm run build:all (which includes WASM examples)
 */

import { expect } from 'chai'
import fs from 'fs'
import path from 'path'
import { execSync } from 'child_process'
import net, { AddressInfo } from 'net'
import { freeport } from './ts-servertestutilities'
import {
  startServerP,
  serverTestConfigDirectory,
  getReadOnlyToken,
  getWriteToken,
  getAdminToken
} from './servertestutilities'
import express, { Response as ExpressResponse } from 'express'
import {
  BufferAbiExports,
  BufferAbiFunction,
  callBufferAbi,
  MAX_BUFFER_ABI_RESPONSE_BYTES,
  METADATA_BUFFER_BYTES,
  RESPONSE_BUFFER_BYTES
} from '../src/wasm/utils/buffer-abi'
import {
  sendWasmHttpResponse,
  setupPluginSpecificRoutes
} from '../src/wasm/loader/plugin-routes'
import { WasmPlugin } from '../src/wasm/loader/types'
import { WithSecurityStrategy } from '../src/security'
import { createEnvImports } from '../src/wasm/bindings/env-imports'
import { WasmCapabilities, WasmPluginInstance } from '../src/wasm/types'
import { wasmPlugins } from '../src/wasm/loader/plugin-registry'
import { stopWasmPlugin } from '../src/wasm/loader/plugin-lifecycle'
import { tcpSocketManager } from '../src/wasm/bindings/socket-manager'

interface PluginInfo {
  id: string
  packageName: string
  name: string
  version: string
  description: string
  type: string
  data: {
    enabled: boolean
  }
}

interface ServerInstance {
  stop: () => Promise<void>
  app: {
    handleMessage: (providerId: string, delta: object) => void
    config: {
      settings: {
        port: number
      }
    }
  }
}

// Use the same config directory as startServerP to ensure plugins are discovered
const testConfigDirectory = serverTestConfigDirectory

const examplePluginDir = path.join(
  __dirname,
  '..',
  'examples',
  'wasm-plugins',
  'example-hello-assemblyscript'
)

const wasmPath = path.join(examplePluginDir, 'plugin.wasm')

const examplePluginId = '_signalk_example-hello-assemblyscript'

/**
 * Where the example plugin is linked so plugin discovery finds it;
 * startServerP points SIGNALK_NODE_CONFIG_DIR at serverTestConfigDirectory().
 */
function examplePluginLinkPath(): string {
  return path.join(
    testConfigDirectory(),
    'node_modules',
    '@signalk',
    'example-hello-assemblyscript'
  )
}

/**
 * Symlink the built example plugin into the test config's node_modules,
 * replacing any stale link. Requires the build test to have produced the
 * .wasm binary first.
 */
function linkExamplePlugin(): void {
  if (!fs.existsSync(wasmPath)) {
    throw new Error(
      'WASM file does not exist. Build verification test should have created it.'
    )
  }
  const pluginDest = examplePluginLinkPath()
  fs.mkdirSync(path.dirname(pluginDest), { recursive: true })
  if (fs.existsSync(pluginDest)) {
    fs.rmSync(pluginDest, { recursive: true, force: true })
  }
  fs.symlinkSync(examplePluginDir, pluginDest, 'dir')
}

/** Remove the example plugin link so later suites start from a clean config. */
function unlinkExamplePlugin(): void {
  const pluginDest = examplePluginLinkPath()
  if (fs.existsSync(pluginDest)) {
    fs.rmSync(pluginDest, { recursive: true, force: true })
  }
}

// Must match ICON_PNG_BASE64 in the example plugin
const exampleIconPngBase64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

const SUBSCRIBER_POLL_ATTEMPTS = 40
const SUBSCRIBER_POLL_INTERVAL_MS = 50

interface SseClient {
  response: Response
  // Resolves with everything received once `text` has arrived, or with
  // null if the stream ends first
  waitFor: (text: string) => Promise<string | null>
  abort: () => void
}

/**
 * Open an event stream with fetch rather than EventSource, so tests can
 * observe the raw framing and whether the server ended the stream.
 */
async function openSseClient(url: string): Promise<SseClient> {
  const controller = new AbortController()
  const response = await fetch(url, {
    headers: { Accept: 'text/event-stream' },
    signal: controller.signal
  })
  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let received = ''
  return {
    response,
    waitFor: async (text: string) => {
      while (!received.includes(text)) {
        const { done, value } = await reader.read()
        if (done) {
          return null
        }
        received += decoder.decode(value, { stream: true })
      }
      return received
    },
    abort: () => controller.abort()
  }
}

describe('WASM Plugins', function () {
  this.timeout(60000) // WASM compilation and loading can take time

  describe('Build verification', () => {
    it('builds example-hello-assemblyscript and produces plugin.wasm', function () {
      // Clean any existing build artifacts
      if (fs.existsSync(wasmPath)) {
        fs.unlinkSync(wasmPath)
      }

      // Install dependencies if needed
      const nodeModulesPath = path.join(examplePluginDir, 'node_modules')
      if (!fs.existsSync(nodeModulesPath)) {
        console.log('Installing dependencies for example plugin...')
        // The audit request can stall until npm's five-minute fetch
        // timeout, and the build does not need it.
        execSync('npm install --no-audit --no-fund', {
          cwd: examplePluginDir,
          stdio: 'inherit'
        })
      }

      // Build the plugin
      console.log('Building example WASM plugin...')
      execSync('npm run build', {
        cwd: examplePluginDir,
        stdio: 'inherit'
      })

      // Assert that plugin.wasm was created
      expect(fs.existsSync(wasmPath), 'plugin.wasm should exist').to.equal(true)

      const stats = fs.statSync(wasmPath)
      expect(stats.size).to.be.greaterThan(
        1000,
        'WASM file should be non-trivial size'
      )
    })

    after(function () {
      // Clean up transpiled files generated during build
      const pluginJsPath = path.join(examplePluginDir, 'plugin.js')
      const pluginDtsPath = path.join(examplePluginDir, 'plugin.d.ts')

      if (fs.existsSync(pluginJsPath)) {
        fs.unlinkSync(pluginJsPath)
      }
      if (fs.existsSync(pluginDtsPath)) {
        fs.unlinkSync(pluginDtsPath)
      }
    })
  })

  describe('Plugin loading', () => {
    let server: ServerInstance | null = null

    before(function () {
      linkExamplePlugin()
    })

    after(async function () {
      if (server) {
        await server.stop()
      }
      unlinkExamplePlugin()
    })

    it('discovers and registers WASM plugin', async function () {
      const port = await freeport()

      server = await startServerP(port, false, {
        settings: {
          interfaces: {
            plugins: true,
            wasm: true
          }
        }
      })

      // Poll until WASM plugin appears in the plugins list
      let wasmPlugin: PluginInfo | undefined
      for (let i = 0; i < 40; i++) {
        const res = await fetch(`http://0.0.0.0:${port}/skServer/plugins`)
        const plugins: PluginInfo[] = await res.json()
        wasmPlugin = plugins.find(
          (p) =>
            p.id === '_signalk_example-hello-assemblyscript' ||
            p.packageName === '@signalk/example-hello-assemblyscript'
        )
        if (wasmPlugin) break
        await new Promise((r) => setTimeout(r, 50))
      }

      const response = await fetch(`http://0.0.0.0:${port}/skServer/plugins`)
      expect(response.status).to.equal(200)

      const plugins: PluginInfo[] = await response.json()
      wasmPlugin = plugins.find(
        (p) =>
          p.id === '_signalk_example-hello-assemblyscript' ||
          p.packageName === '@signalk/example-hello-assemblyscript'
      )

      expect(wasmPlugin, 'WASM plugin should be in plugins list').to.not.equal(
        undefined
      )
      expect(wasmPlugin!.type).to.equal(
        'wasm',
        'Plugin should be marked as WASM type'
      )
    })

    it('WASM plugin has correct metadata', async function () {
      // Use the server from the previous test
      const port = server!.app.config.settings.port

      const response = await fetch(`http://0.0.0.0:${port}/skServer/plugins`)
      const plugins: PluginInfo[] = await response.json()
      const wasmPlugin = plugins.find(
        (p) =>
          p.id === '_signalk_example-hello-assemblyscript' ||
          p.packageName === '@signalk/example-hello-assemblyscript'
      )

      expect(wasmPlugin).to.not.equal(undefined)
      expect(wasmPlugin!.name).to.be.a('string')
      expect(wasmPlugin!.version).to.equal('0.1.0')
      expect(wasmPlugin!.description).to.include('Hello World')
    })

    it('WASM plugin can be enabled and started', async function () {
      const port = server!.app.config.settings.port
      const pluginId = '_signalk_example-hello-assemblyscript'

      // Enable and start the plugin via config endpoint
      const configResponse = await fetch(
        `http://0.0.0.0:${port}/skServer/plugins/${pluginId}/config`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            enabled: true,
            configuration: {
              message: 'Test message'
            }
          })
        }
      )
      expect(configResponse.status).to.equal(200)

      // Poll until plugin is enabled
      let wasmPlugin: PluginInfo | undefined
      for (let i = 0; i < 20; i++) {
        const res = await fetch(`http://0.0.0.0:${port}/skServer/plugins`)
        const plugins: PluginInfo[] = await res.json()
        wasmPlugin = plugins.find((p) => p.id === pluginId)
        if (wasmPlugin?.data?.enabled) break
        await new Promise((r) => setTimeout(r, 50))
      }

      expect(
        wasmPlugin,
        'Plugin should still exist after enabling'
      ).to.not.equal(undefined)
      expect(wasmPlugin!.data.enabled).to.equal(
        true,
        'Plugin should be enabled'
      )
    })

    it('WASM endpoint returns a base64-encoded body as binary', async function () {
      const port = server!.app.config.settings.port
      const pluginId = '_signalk_example-hello-assemblyscript'

      const response = await fetch(
        `http://0.0.0.0:${port}/plugins/${pluginId}/api/icon.png`
      )
      expect(response.status).to.equal(200)
      expect(response.headers.get('content-type')).to.equal('image/png')
      const body = Buffer.from(await response.arrayBuffer())
      expect(body.equals(Buffer.from(exampleIconPngBase64, 'base64'))).to.equal(
        true
      )
    })
  })

  describe('HTTP response envelope', () => {
    /**
     * Minimal Express Response stub that records which writer methods
     * were called, to prove an invalid envelope writes nothing.
     */
    function recordingResponse(): {
      res: ExpressResponse
      calls: string[]
    } {
      const calls: string[] = []
      const record = (name: string) => () => {
        calls.push(name)
        return res
      }
      const res = {
        status: record('status'),
        setHeader: record('setHeader'),
        getHeader: () => undefined,
        send: record('send')
      } as unknown as ExpressResponse
      return { res, calls }
    }

    it('rejects an unknown bodyEncoding before writing the response', function () {
      const { res, calls } = recordingResponse()
      expect(() =>
        sendWasmHttpResponse(res, {
          statusCode: 200,
          headers: { 'Content-Type': 'image/png' },
          bodyEncoding: 'hex',
          body: '89504e47'
        })
      ).to.throw(/Unsupported bodyEncoding "hex"/)
      expect(calls).to.deep.equal([])
    })

    it('rejects a non-string body with base64 encoding', function () {
      const { res, calls } = recordingResponse()
      expect(() =>
        sendWasmHttpResponse(res, { bodyEncoding: 'base64', body: [1, 2] })
      ).to.throw(/requires a string body/)
      expect(calls).to.deep.equal([])
    })

    it('rejects a malformed base64 body', function () {
      const { res, calls } = recordingResponse()
      expect(() =>
        sendWasmHttpResponse(res, {
          bodyEncoding: 'base64',
          body: 'not*base64'
        })
      ).to.throw(/not valid base64/)
      expect(calls).to.deep.equal([])
    })

    it('sends an empty base64 body as an empty buffer', function () {
      const { res, calls } = recordingResponse()
      let sent: unknown
      res.send = ((value: unknown) => {
        sent = value
        return res
      }) as ExpressResponse['send']
      sendWasmHttpResponse(res, { bodyEncoding: 'base64', body: '' })
      expect(calls).to.deep.equal(['status'])
      expect(Buffer.isBuffer(sent) && sent.length === 0).to.equal(true)
    })
  })

  describe('Scoped package name', () => {
    const scopedPackageName = '@signalk-test/wasm-scoped-probe'
    const scopedPluginId = '_signalk-test_wasm-scoped-probe'
    const ascPath = path.join(__dirname, '..', 'node_modules', '.bin', 'asc')
    // Reads its config, saves a new one and opens a UDP socket on start,
    // reporting the outcome through sk_set_status
    const probeSource = `
import {
  readConfig,
  saveConfig,
  setStatus
} from '@signalk/assemblyscript-plugin-sdk/assembly'

@external("env", "sk_udp_create")
declare function sk_udp_create(socketType: i32): i32

export function plugin_name(): string {
  return 'Scoped probe'
}

export function plugin_schema(): string {
  return '{"type":"object","properties":{}}'
}

export function plugin_start(configPtr: usize, configLen: usize): i32 {
  // readConfig() decodes its whole fixed-size buffer, so cut the NUL padding
  const raw = readConfig()
  const end = raw.indexOf(String.fromCharCode(0))
  const config = end < 0 ? raw : raw.substring(0, end)
  const saved = saveConfig('{"greeting":"saved"}')
  const socket = sk_udp_create(0)
  setStatus('read:' + config + ' saved:' + saved.toString() + ' socket:' + (socket > 0 ? 'ok' : 'failed'))
  return 0
}

export function plugin_stop(): i32 {
  return 0
}
`
    let server: ServerInstance | null = null
    let url: string

    function probeDir(): string {
      return path.join(testConfigDirectory(), 'node_modules', scopedPackageName)
    }

    function configFile(): string {
      return path.join(
        testConfigDirectory(),
        'plugin-config-data',
        `${scopedPluginId}.json`
      )
    }

    async function getProbe(): Promise<PluginInfo & { statusMessage: string }> {
      const response = await fetch(`${url}/skServer/plugins`)
      const plugins: (PluginInfo & { statusMessage: string })[] =
        await response.json()
      const probe = plugins.find((p) => p.id === scopedPluginId)
      expect(probe, 'scoped probe plugin should be registered').to.not.equal(
        undefined
      )
      return probe!
    }

    function postConfig(body: object): Promise<Response> {
      return fetch(`${url}/skServer/plugins/${scopedPluginId}/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })
    }

    function probeSockets(): number | undefined {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { socketManager } = require('../dist/wasm/bindings/socket-manager')
      return socketManager.getStats().socketsPerPlugin[scopedPluginId]
    }

    before(async function () {
      const dir = probeDir()
      fs.rmSync(dir, { recursive: true, force: true })
      fs.mkdirSync(path.join(dir, 'assembly'), { recursive: true })
      fs.writeFileSync(
        path.join(dir, 'package.json'),
        JSON.stringify({
          name: scopedPackageName,
          version: '0.0.1',
          keywords: ['signalk-wasm-plugin'],
          wasmManifest: 'plugin.wasm',
          wasmCapabilities: { rawSockets: true }
        })
      )
      fs.writeFileSync(path.join(dir, 'assembly', 'index.ts'), probeSource)
      execSync(
        `"${ascPath}" assembly/index.ts --outFile plugin.wasm --runtime incremental --exportRuntime`,
        { cwd: dir, stdio: 'inherit' }
      )
      fs.rmSync(configFile(), { force: true })

      const port = await freeport()
      url = `http://0.0.0.0:${port}`
      server = await startServerP(port, false, {
        settings: {
          interfaces: {
            plugins: true,
            wasm: true
          }
        }
      })
    })

    after(async function () {
      if (server) {
        await server.stop()
      }
      fs.rmSync(path.dirname(probeDir()), { recursive: true, force: true })
      fs.rmSync(configFile(), { force: true })
    })

    it('keys status, config and sockets by the derived plugin id', async function () {
      const enableResponse = await postConfig({
        enabled: true,
        configuration: { greeting: 'hi' }
      })
      expect(enableResponse.status).to.equal(200)

      let probe = await getProbe()
      for (let i = 0; i < 40 && !probe.statusMessage; i++) {
        await new Promise((r) => setTimeout(r, 50))
        probe = await getProbe()
      }

      expect(probe.statusMessage).to.equal(
        'read:{"greeting":"hi"} saved:0 socket:ok'
      )
      const stored = JSON.parse(fs.readFileSync(configFile(), 'utf8'))
      expect(stored.configuration).to.deep.equal({ greeting: 'saved' })
      expect(probeSockets()).to.equal(1)

      const disableResponse = await postConfig({
        enabled: false,
        configuration: stored.configuration
      })
      expect(disableResponse.status).to.equal(200)
      expect(probeSockets()).to.equal(undefined)
    })
  })

  describe('Rebuilt binary', () => {
    const packageName = 'wasm-reload-probe'
    const ascPath = path.join(__dirname, '..', 'node_modules', '.bin', 'asc')
    let server: ServerInstance | null = null
    let url: string

    function probeDir(): string {
      return path.join(testConfigDirectory(), 'node_modules', packageName)
    }

    /**
     * Compile the probe as `build`: it reports `build <build>` as its status,
     * serves `build` at /api/build-<build> and handles PUT on probe.<build>,
     * reporting `put <build>` as its status when that handler runs
     */
    function buildProbe(build: string): void {
      fs.writeFileSync(
        path.join(probeDir(), 'assembly', 'index.ts'),
        `
import { setStatus } from '@signalk/assemblyscript-plugin-sdk/assembly'

@external("env", "sk_register_put_handler")
declare function sk_register_put_handler(contextPtr: usize, contextLen: usize, pathPtr: usize, pathLen: usize): i32

export function plugin_name(): string {
  return 'Reload probe'
}

export function plugin_schema(): string {
  return '{"type":"object","properties":{}}'
}

export function plugin_start(configPtr: usize, configLen: usize): i32 {
  setStatus('build ${build}')
  const context = String.UTF8.encode('vessels.self')
  const putPath = String.UTF8.encode('probe.${build}')
  sk_register_put_handler(changetype<usize>(context), context.byteLength, changetype<usize>(putPath), putPath.byteLength)
  return 0
}

export function handle_put_vessels_self_probe_${build}(value: string): string {
  setStatus('put ${build}')
  return '{"state":"COMPLETED","statusCode":200}'
}

export function http_endpoints(): string {
  return '[{"method":"GET","path":"/api/build-${build}","handler":"handle_${build}"}]'
}

export function handle_${build}(requestPtr: usize, requestLen: usize): string {
  return '{"statusCode":200,"body":"${build}"}'
}

export function plugin_stop(): i32 {
  return 0
}
`
      )
      execSync(
        `"${ascPath}" assembly/index.ts --outFile plugin.wasm --runtime incremental --exportRuntime`,
        { cwd: probeDir(), stdio: 'inherit' }
      )
    }

    /** Enable or disable the probe through Plugin Config */
    function setEnabled(enabled: boolean): Promise<Response> {
      return fetch(`${url}/skServer/plugins/${packageName}/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled, configuration: {} })
      })
    }

    async function statusMessage(): Promise<string> {
      const response = await fetch(`${url}/skServer/plugins`)
      const plugins: (PluginInfo & { statusMessage: string })[] =
        await response.json()
      return plugins.find((p) => p.id === packageName)?.statusMessage ?? ''
    }

    /** Poll until the probe reports `expected`, returning the last status */
    async function waitForStatus(expected: string): Promise<string> {
      let status = await statusMessage()
      for (let i = 0; i < 40 && status !== expected; i++) {
        await new Promise((r) => setTimeout(r, 50))
        status = await statusMessage()
      }
      return status
    }

    before(async function () {
      const dir = probeDir()
      fs.rmSync(dir, { recursive: true, force: true })
      fs.mkdirSync(path.join(dir, 'assembly'), { recursive: true })
      fs.writeFileSync(
        path.join(dir, 'package.json'),
        JSON.stringify({
          name: packageName,
          version: '0.0.1',
          keywords: ['signalk-wasm-plugin'],
          wasmManifest: 'plugin.wasm',
          wasmCapabilities: { putHandlers: true }
        })
      )
      buildProbe('one')

      const port = await freeport()
      url = `http://0.0.0.0:${port}`
      server = await startServerP(port, false, {
        settings: {
          interfaces: {
            plugins: true,
            wasm: true
          }
        }
      })
    })

    after(async function () {
      if (server) {
        await server.stop()
      }
      fs.rmSync(probeDir(), { recursive: true, force: true })
      fs.rmSync(
        path.join(
          testConfigDirectory(),
          'plugin-config-data',
          `${packageName}.json`
        ),
        { force: true }
      )
    })

    function getBuildEndpoint(build: string): Promise<Response> {
      return fetch(`${url}/plugins/${packageName}/api/build-${build}`)
    }

    async function putStatus(build: string): Promise<number> {
      const response = await fetch(
        `${url}/signalk/v1/api/vessels/self/probe/${build}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ value: 1 })
        }
      )
      return response.status
    }

    it('runs the rebuilt plugin.wasm after disable and enable', async function () {
      expect((await setEnabled(true)).status).to.equal(200)
      expect(await waitForStatus('build one')).to.equal('build one')
      const one = await getBuildEndpoint('one')
      expect(one.status).to.equal(200)
      expect(await one.text()).to.equal('one')
      await putStatus('one')
      expect(await waitForStatus('put one')).to.equal('put one')

      buildProbe('two')
      expect((await setEnabled(false)).status).to.equal(200)
      expect((await setEnabled(true)).status).to.equal(200)

      expect(await waitForStatus('build two')).to.equal('build two')
      const two = await getBuildEndpoint('two')
      expect(two.status).to.equal(200)
      expect(await two.text()).to.equal('two')
      expect((await getBuildEndpoint('one')).status).to.equal(404)
      await putStatus('two')
      expect(await waitForStatus('put two')).to.equal('put two')
      // 405: no PUT handler is registered for the path any more
      expect(await putStatus('one')).to.equal(405)
      expect(await statusMessage()).to.equal('put two')
      const metaOne = await fetch(
        `${url}/signalk/v1/api/vessels/self/probe/one/meta`
      )
      expect((await metaOne.json()).supportsPut).to.equal(false)
    })
  })

  describe('Endpoint access levels', () => {
    let server: ServerInstance | null = null
    let url: string
    let readToken: string
    let writeToken: string
    let adminToken: string

    before(async function () {
      linkExamplePlugin()
      const port = await freeport()
      url = `http://0.0.0.0:${port}`
      server = await startServerP(port, true, {
        settings: {
          interfaces: {
            plugins: true,
            wasm: true
          }
        }
      })
      readToken = await getReadOnlyToken(server)
      writeToken = await getWriteToken(server)
      adminToken = await getAdminToken(server)

      const enableResponse = await fetch(
        `${url}/skServer/plugins/${examplePluginId}/config`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${adminToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ enabled: true, configuration: {} })
        }
      )
      expect(enableResponse.status).to.equal(200)
    })

    after(async function () {
      if (server) {
        await server.stop()
      }
      unlinkExamplePlugin()
    })

    /** GET a route of the example plugin, authenticated only when a token is given. */
    function getEndpoint(route: string, token?: string): Promise<Response> {
      return fetch(`${url}/plugins/${examplePluginId}${route}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      })
    }

    it('readonly user can access an endpoint declared readonly', async function () {
      const response = await getEndpoint('/api/info', readToken)
      expect(response.status).to.equal(200)
      const body = await response.json()
      expect(body.language).to.equal('AssemblyScript')
    })

    it('readwrite user can access an endpoint declared readonly', async function () {
      const response = await getEndpoint('/api/info', writeToken)
      expect(response.status).to.equal(200)
    })

    it('unauthenticated request is denied an endpoint declared readonly', async function () {
      const response = await getEndpoint('/api/info')
      expect(response.status).to.equal(401)
    })

    it('readonly user is denied an endpoint declared readwrite', async function () {
      const response = await getEndpoint('/api/about', readToken)
      expect(response.status).to.equal(401)
    })

    it('readwrite user can access an endpoint declared readwrite', async function () {
      const response = await getEndpoint('/api/about', writeToken)
      expect(response.status).to.equal(200)
    })

    it('readonly user is denied an endpoint without an access level', async function () {
      const response = await getEndpoint('/api/status', readToken)
      expect(response.status).to.equal(401)
    })

    it('admin can access an endpoint without an access level', async function () {
      const response = await getEndpoint('/api/status', adminToken)
      expect(response.status).to.equal(200)
    })
  })

  describe('sk_get_self_path binding', () => {
    const PATH_PTR = 0
    const BUF_PTR = 1024
    const BUF_MAX_LEN = 4096
    const SPEED = 3.5

    let server: ServerInstance | null = null

    /** Calls the binding the way a WASM guest would, via linear memory. */
    function selfPathReader(dataRead: boolean): (skPath: string) => unknown {
      const memory = new WebAssembly.Memory({ initial: 1 })
      const imports = createEnvImports({
        pluginId: 'self-path-test',
        packageName: 'self-path-test',
        capabilities: {
          network: false,
          storage: 'none',
          dataRead,
          dataWrite: false,
          serialPorts: false,
          putHandlers: false
        },
        app: server!.app,
        memoryRef: { current: memory },
        rawExports: { current: null },
        asLoaderInstance: { current: null }
      })
      return (skPath: string) => {
        const pathBytes = Buffer.from(skPath, 'utf8')
        new Uint8Array(memory.buffer).set(pathBytes, PATH_PTR)
        const len: number = imports.sk_get_self_path(
          PATH_PTR,
          pathBytes.length,
          BUF_PTR,
          BUF_MAX_LEN
        )
        if (len === 0) return undefined
        return JSON.parse(
          Buffer.from(memory.buffer, BUF_PTR, len).toString('utf8')
        )
      }
    }

    before(async function () {
      const port = await freeport()
      const started: ServerInstance = await startServerP(port, false)
      server = started
      started.app.handleMessage('test', {
        updates: [
          { values: [{ path: 'navigation.speedOverGround', value: SPEED }] }
        ]
      })
    })

    after(async function () {
      if (server) {
        await server.stop()
      }
    })

    it('returns the self vessel value for a path', function () {
      const result = selfPathReader(true)('navigation.speedOverGround') as {
        value: number
      }
      expect(result.value).to.equal(SPEED)
    })

    it('returns nothing for a path without data', function () {
      expect(selfPathReader(true)('navigation.courseOverGroundTrue')).to.equal(
        undefined
      )
    })

    it('returns nothing without the dataRead capability', function () {
      expect(selfPathReader(false)('navigation.speedOverGround')).to.equal(
        undefined
      )
    })
  })

  describe('Stopping a plugin', () => {
    const pluginId = '_test_stop-cleanup'
    const packageName = '@test/stop-cleanup'
    const noCapabilities: WasmCapabilities = {
      network: false,
      storage: 'none',
      dataRead: false,
      dataWrite: false,
      serialPorts: false,
      putHandlers: false
    }

    /**
     * Register a running plugin whose instance is a stub, so stopping it
     * exercises only the host-side teardown.
     */
    function addStoppablePlugin(): void {
      const plugin: WasmPlugin = {
        id: pluginId,
        name: 'stop cleanup',
        type: 'wasm',
        packageName,
        version: '0.0.0',
        enabled: true,
        enableDebug: false,
        keywords: [],
        packageLocation: '',
        configPath: '',
        metadata: {
          id: pluginId,
          name: 'stop cleanup',
          packageName,
          version: '0.0.0',
          wasmManifest: '',
          capabilities: noCapabilities,
          packageLocation: ''
        },
        instance: {
          exports: { stop: () => 0 }
        } as unknown as WasmPluginInstance,
        status: 'running',
        crashCount: 0,
        restartBackoff: 0
      }
      wasmPlugins.set(pluginId, plugin)
    }

    afterEach(function () {
      wasmPlugins.delete(pluginId)
    })

    it('closes TCP sockets the plugin opened', async function () {
      addStoppablePlugin()
      const server = net.createServer()
      const peerClosed = new Promise<void>((resolve) => {
        server.on('connection', (peer) => {
          peer.on('close', () => resolve())
        })
      })
      await new Promise<void>((resolve) =>
        server.listen(0, '127.0.0.1', resolve)
      )
      const { port } = server.address() as net.AddressInfo
      const connected = new Promise<void>((resolve) =>
        server.once('connection', () => resolve())
      )

      try {
        const socketId = tcpSocketManager.createSocket(pluginId)
        expect(tcpSocketManager.connect(socketId, '127.0.0.1', port)).to.equal(
          0
        )
        await connected

        await stopWasmPlugin(pluginId)

        await peerClosed
        expect(tcpSocketManager.isConnected(socketId)).to.equal(-1)
      } finally {
        server.close()
      }
    })

    it('unregisters its PUT handlers', async function () {
      addStoppablePlugin()
      const registered = new Set<string>()
      const app = {
        registerActionHandler: (
          context: string,
          path: string,
          source: string
        ) => {
          const key = `${context}/${path}/${source}`
          registered.add(key)
          return () => registered.delete(key)
        }
      }
      const memory = new WebAssembly.Memory({ initial: 1 })
      const context = Buffer.from('vessels.self')
      const putPath = Buffer.from('electrical.switches.test.state')
      // Past the end of the context string so the two do not overlap
      const pathOffset = context.length
      new Uint8Array(memory.buffer).set(context, 0)
      new Uint8Array(memory.buffer).set(putPath, pathOffset)
      const imports = createEnvImports({
        pluginId,
        packageName,
        capabilities: { ...noCapabilities, putHandlers: true },
        app,
        memoryRef: { current: memory },
        rawExports: { current: null },
        asLoaderInstance: { current: null }
      })

      expect(
        imports.sk_register_put_handler(
          0,
          context.length,
          pathOffset,
          putPath.length
        )
      ).to.equal(1)
      expect(registered.size).to.equal(1)

      await stopWasmPlugin(pluginId)

      expect(registered.size).to.equal(0)
    })
  })

  describe('Stopping a resource provider plugin', () => {
    let server: ServerInstance | null = null
    const providerDir = path.join(
      __dirname,
      '..',
      'examples',
      'wasm-plugins',
      'example-routes-waypoints'
    )
    const providerPackageName = '@signalk/example-routes-waypoints'
    const providerPluginId = '_signalk_example-routes-waypoints'
    const providerLink = () =>
      path.join(
        testConfigDirectory(),
        'node_modules',
        '@signalk',
        'example-routes-waypoints'
      )

    const providerPollAttempts = 40
    const providerPollIntervalMs = 50

    /** Ids of the plugins currently serving the routes resource type. */
    async function routeProviders(port: number): Promise<string[]> {
      const res = await fetch(
        `http://0.0.0.0:${port}/signalk/v2/api/resources/routes/_providers`
      )
      expect(res.status).to.equal(200)
      return res.json()
    }

    /** Enable or disable the provider plugin through the admin config API. */
    async function setEnabled(port: number, enabled: boolean): Promise<void> {
      const res = await fetch(
        `http://0.0.0.0:${port}/skServer/plugins/${providerPluginId}/config`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled, configuration: {} })
        }
      )
      expect(res.status).to.equal(200)
    }

    /**
     * Poll the provider list until the predicate holds, since plugin start
     * and stop complete asynchronously after the config request returns.
     * Returns the last list seen so the caller asserts on it.
     */
    async function waitForProviders(
      port: number,
      predicate: (providers: string[]) => boolean
    ): Promise<string[]> {
      let providers = await routeProviders(port)
      for (let i = 0; i < providerPollAttempts && !predicate(providers); i++) {
        await new Promise((r) => setTimeout(r, providerPollIntervalMs))
        providers = await routeProviders(port)
      }
      return providers
    }

    before(async function () {
      if (!fs.existsSync(path.join(providerDir, 'node_modules'))) {
        execSync('npm install', { cwd: providerDir, stdio: 'inherit' })
      }
      execSync('npm run build', { cwd: providerDir, stdio: 'inherit' })

      const pluginDest = providerLink()
      fs.mkdirSync(path.dirname(pluginDest), { recursive: true })
      fs.rmSync(pluginDest, { recursive: true, force: true })
      fs.symlinkSync(providerDir, pluginDest, 'dir')

      const port = await freeport()
      server = await startServerP(port, false, {
        settings: {
          interfaces: {
            plugins: true,
            wasm: true
          }
        }
      })
    })

    after(async function () {
      if (server) {
        await server.stop()
      }
      fs.rmSync(providerLink(), { recursive: true, force: true })
    })

    it('is unlisted as a provider on stop and listed again on restart', async function () {
      const port = server!.app.config.settings.port

      await setEnabled(port, true)
      const whileRunning = await waitForProviders(port, (p) =>
        p.includes(providerPackageName)
      )
      expect(whileRunning).to.include(providerPackageName)

      await setEnabled(port, false)
      const afterStop = await waitForProviders(
        port,
        (p) => !p.includes(providerPackageName)
      )
      expect(afterStop).to.not.include(providerPackageName)

      await setEnabled(port, true)
      const afterRestart = await waitForProviders(port, (p) =>
        p.includes(providerPackageName)
      )
      expect(afterRestart).to.include(providerPackageName)
    })
  })

  describe('SSE channels', () => {
    let server: ServerInstance | null = null
    let url: string

    before(async function () {
      linkExamplePlugin()
      const port = await freeport()
      url = `http://0.0.0.0:${port}`
      server = await startServerP(port, false, {
        settings: {
          interfaces: {
            plugins: true,
            wasm: true
          }
        }
      })
      await setPluginEnabled(true)
    })

    after(async function () {
      if (server) {
        await server.stop()
      }
      unlinkExamplePlugin()
    })

    /** Start or stop the example plugin through the plugin config API. */
    async function setPluginEnabled(enabled: boolean): Promise<void> {
      const response = await fetch(
        `${url}/skServer/plugins/${examplePluginId}/config`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled, configuration: {} })
        }
      )
      expect(response.status).to.equal(200)
    }

    /** Trigger a plugin broadcast and return how many clients it reached. */
    async function broadcast(): Promise<number> {
      const response = await fetch(
        `${url}/plugins/${examplePluginId}/api/broadcast`,
        { method: 'POST' }
      )
      expect(response.status).to.equal(200)
      const body = await response.json()
      return body.sent
    }

    /**
     * Poll until the channel has the expected number of clients, since
     * connects and disconnects reach the server asynchronously.
     */
    async function waitForSubscriberCount(expected: number): Promise<void> {
      for (let i = 0; i < SUBSCRIBER_POLL_ATTEMPTS; i++) {
        if ((await broadcast()) === expected) {
          return
        }
        await new Promise((r) => setTimeout(r, SUBSCRIBER_POLL_INTERVAL_MS))
      }
      expect.fail(`channel never reached ${expected} subscribers`)
    }

    const eventsUrl = () => `${url}/plugins/${examplePluginId}/api/events`

    it('streams events pushed by the plugin to a subscribed client', async function () {
      const client = await openSseClient(eventsUrl())
      try {
        expect(client.response.status).to.equal(200)
        expect(client.response.headers.get('content-type')).to.match(
          /^text\/event-stream/
        )
        expect(await client.waitFor('\n\n')).to.equal(
          'event: welcome\ndata: Hello AssemblyScript Plugin\n\n'
        )

        expect(await broadcast()).to.equal(1)
        const received = await client.waitFor('broadcast #')
        expect(received).to.include(
          'event: greeting\ndata: Hello from AssemblyScript!\ndata: broadcast #'
        )
      } finally {
        client.abort()
      }
    })

    it('removes a client from the channel when it disconnects', async function () {
      const client = await openSseClient(eventsUrl())
      await client.waitFor('welcome')
      await waitForSubscriberCount(1)

      client.abort()
      await waitForSubscriberCount(0)
    })

    it('ends open streams when the plugin stops', async function () {
      const client = await openSseClient(eventsUrl())
      await client.waitFor('welcome')

      await setPluginEnabled(false)

      expect(await client.waitFor('never sent')).to.equal(null)
      expect(await broadcast()).to.equal(0)

      const refused = await fetch(eventsUrl())
      expect(refused.status).to.equal(503)
    })
  })
})

const FAKE_MEMORY_PAGES = 200

interface FakeBufferAbiPlugin {
  exports: BufferAbiExports & Record<string, unknown>
  liveAllocations: () => number
  calls: number[]
}

/**
 * Stands in for a compiled Rust plugin: real WebAssembly memory with a bump
 * allocator, and exports that follow the buffer ABI, returning `-n` when the
 * output buffer is too small for their result.
 */
function fakeBufferAbiPlugin(
  produce: (request: string | undefined) => string
): FakeBufferAbiPlugin {
  const memory = new WebAssembly.Memory({ initial: FAKE_MEMORY_PAGES })
  const live = new Map<number, number>()
  const calls: number[] = []
  let next = 8

  /** Bump-allocates so every live allocation has a unique pointer */
  const allocate = (size: number) => {
    const ptr = next
    next += size
    live.set(ptr, size)
    return ptr
  }
  /** Asserts the host frees exactly what it allocated, with the same size */
  const deallocate = (ptr: number, size: number) => {
    expect(live.get(ptr)).to.equal(size)
    live.delete(ptr)
  }
  /** Records the offered buffer size and applies the grow-on-negative rule */
  const write = (text: string, outPtr: number, outLen: number) => {
    const bytes = Buffer.from(text, 'utf8')
    calls.push(outLen)
    if (bytes.length > outLen) return -bytes.length
    new Uint8Array(memory.buffer).set(bytes, outPtr)
    return bytes.length
  }
  /** Decodes the request the host wrote into plugin memory */
  const read = (ptr: number, len: number) =>
    Buffer.from(memory.buffer, ptr, len).toString('utf8')

  return {
    exports: {
      memory,
      allocate,
      deallocate,
      handle: (
        reqPtr: number,
        reqLen: number,
        outPtr: number,
        outLen: number
      ) => write(produce(read(reqPtr, reqLen)), outPtr, outLen),
      describe: (outPtr: number, outLen: number) =>
        write(produce(undefined), outPtr, outLen)
    },
    liveAllocations: () => live.size,
    calls
  }
}

describe('WASM buffer ABI', () => {
  const LARGE_BYTES = 200 * 1024

  it('returns output that fits the initial buffer in one call', () => {
    const plugin = fakeBufferAbiPlugin((req) => `echo:${req}`)
    const result = callBufferAbi(
      plugin.exports,
      'handle',
      plugin.exports.handle as BufferAbiFunction,
      RESPONSE_BUFFER_BYTES,
      'hello'
    )
    expect(result).to.equal('echo:hello')
    expect(plugin.calls).to.deep.equal([RESPONSE_BUFFER_BYTES])
    expect(plugin.liveAllocations()).to.equal(0)
  })

  it('grows the buffer when the export returns a negative length', () => {
    const big = 'é'.repeat(LARGE_BYTES)
    const plugin = fakeBufferAbiPlugin(() => big)
    const result = callBufferAbi(
      plugin.exports,
      'describe',
      plugin.exports.describe as BufferAbiFunction,
      METADATA_BUFFER_BYTES
    )
    expect(result).to.equal(big)
    expect(plugin.calls).to.deep.equal([
      METADATA_BUFFER_BYTES,
      Buffer.byteLength(big)
    ])
    expect(plugin.liveAllocations()).to.equal(0)
  })

  it('rejects a request above the maximum buffer size', () => {
    const plugin = fakeBufferAbiPlugin(() =>
      'x'.repeat(MAX_BUFFER_ABI_RESPONSE_BYTES + 1)
    )
    expect(() =>
      callBufferAbi(
        plugin.exports,
        'handle',
        plugin.exports.handle as BufferAbiFunction,
        RESPONSE_BUFFER_BYTES,
        '{}'
      )
    ).to.throw(/handle requested a \d+ byte response buffer, exceeding/)
    expect(plugin.calls).to.have.length(1)
    expect(plugin.liveAllocations()).to.equal(0)
  })

  it('rejects an export that still does not fit after growing', () => {
    let size = RESPONSE_BUFFER_BYTES
    const plugin = fakeBufferAbiPlugin(() => {
      size *= 2
      return 'x'.repeat(size)
    })
    expect(() =>
      callBufferAbi(
        plugin.exports,
        'handle',
        plugin.exports.handle as BufferAbiFunction,
        RESPONSE_BUFFER_BYTES,
        '{}'
      )
    ).to.throw(/handle requested \d+ bytes after being given/)
    expect(plugin.calls).to.have.length(2)
    expect(plugin.liveAllocations()).to.equal(0)
  })

  it('serves a Rust HTTP endpoint response larger than 64 KB', async () => {
    const body = 'x'.repeat(LARGE_BYTES)
    const fake = fakeBufferAbiPlugin((req) =>
      req === undefined
        ? JSON.stringify([{ method: 'GET', path: '/big', handler: 'handle' }])
        : JSON.stringify({
            statusCode: 200,
            headers: { 'Content-Type': 'text/plain' },
            body
          })
    )
    fake.exports.http_endpoints = fake.exports.describe
    const router = express.Router()
    const plugin = {
      id: 'buffer-abi-test',
      router,
      instance: { instance: { exports: fake.exports } }
    } as unknown as WasmPlugin
    setupPluginSpecificRoutes({} as WithSecurityStrategy, plugin)

    const app = express()
    app.use(plugin.endpointRouter!)
    const server = app.listen(0)
    await new Promise((resolve) => server.once('listening', resolve))
    try {
      const { port } = server.address() as AddressInfo
      const res = await fetch(`http://127.0.0.1:${port}/big`)
      expect(res.status).to.equal(200)
      expect(await res.text()).to.equal(body)
    } finally {
      await new Promise((resolve) => server.close(resolve))
    }
  })
})
