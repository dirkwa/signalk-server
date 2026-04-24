/*
 * Copyright 2017 Scott Bender <scott@scottbender.net>
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0

 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
*/

import { createDebug } from '../debug'
const debug = createDebug('signalk-server:interfaces:appstore')
const _ = require('lodash')
const semver = require('semver')
const { gt } = semver
const { installModule, removeModule, getPluginDataSize } = require('../modules')
const {
  isTheServerModule,
  findModulesWithKeyword,
  fetchDistTagsForPackages,
  getLatestServerVersion,
  getAuthor,
  getKeywords
} = require('../modules')
const { SERVERROUTESPREFIX } = require('../constants')
const { getCategories, getAvailableCategories } = require('../categories')
const {
  createCache,
  createIconProbeCache,
  createNpmMetadataClient,
  createRegistryClient,
  enrichEntry,
  buildOfflineResponse,
  buildPluginDetail,
  readDetailFromCache,
  badgesToIndicators,
  probeIconUrl
} = require('../appstore')

const bundledAdminUIs = ['@signalk/server-admin-ui']

const npmServerInstallLocations = [
  '/usr/bin/signalk-server',
  '/usr/lib/node_modules/signalk-server/bin/signalk-server',
  '/usr/local/bin/signalk-server',
  '/usr/local/lib/node_modules/signalk-server/bin/signalk-server'
]

module.exports = function (app) {
  let moduleInstalling
  const modulesInstalledSinceStartup = {}
  const moduleInstallQueue = []
  const cache = createCache(app.config.configPath)
  const registry = createRegistryClient({
    cacheDir: `${app.config.configPath}/appstore-cache`
  })
  const iconProbe = createIconProbeCache(
    `${app.config.configPath}/appstore-cache`
  )
  const npmMetadata = createNpmMetadataClient(
    `${app.config.configPath}/appstore-cache`
  )
  const iconUrlLookup = (pkg, version, declaredPath) =>
    iconProbe.get(pkg, version, declaredPath)
  // npm's search API does not surface the signalk.* key from package.json,
  // so plugins discovered via findModulesWithKeyword never have appIcon /
  // screenshots / displayName on the ModuleInfo object. For INSTALLED
  // plugins the real package.json is available locally — overlay it when
  // enriching so installed plugins get their declared signalk.* data even
  // though npm search omits it.
  const installedMetadataCache = new Map()

  return {
    start: function () {
      app.post(
        [
          `${SERVERROUTESPREFIX}/appstore/install/:name/:version`,
          `${SERVERROUTESPREFIX}/appstore/install/:org/:name/:version`
        ],
        (req, res) => {
          let name = req.params.name
          const version = req.params.version

          if (req.params.org) {
            name = req.params.org + '/' + name
          }

          findPluginsAndWebapps()
            .then(([plugins, webapps]) => {
              if (
                !isTheServerModule(name, app.config) &&
                !plugins.find(packageNameIs(name)) &&
                !webapps.find(packageNameIs(name))
              ) {
                res.status(404)
                res.json('No such webapp or plugin available:' + name)
              } else {
                if (moduleInstalling) {
                  moduleInstallQueue.push({ name: name, version: version })
                  sendAppStoreChangedEvent()
                } else {
                  installSKModule(name, version)
                }
                res.json(`Installing ${name}...`)
              }
            })
            .catch((error) => {
              console.log(error.message)
              debug(error.stack)
              res.status(500)
              res.json(error.message)
            })
        }
      )

      app.post(
        [
          `${SERVERROUTESPREFIX}/appstore/remove/:name`,
          `${SERVERROUTESPREFIX}/appstore/remove/:org/:name`
        ],
        (req, res) => {
          let name = req.params.name

          if (req.params.org) {
            name = req.params.org + '/' + name
          }

          findPluginsAndWebapps()
            .then(([plugins, webapps]) => {
              if (
                !plugins.find(packageNameIs(name)) &&
                !webapps.find(packageNameIs(name))
              ) {
                res.status(404)
                res.json('No such webapp or plugin available:' + name)
              } else {
                const deleteData = req.body && req.body.deleteData === true
                if (moduleInstalling) {
                  moduleInstallQueue.push({
                    name: name,
                    isRemove: true,
                    deleteData: deleteData
                  })
                  sendAppStoreChangedEvent()
                } else {
                  removeSKModule(name, deleteData)
                }
                res.json(`Removing ${name}...`)
              }
            })
            .catch((error) => {
              console.log(error.message)
              debug(error.stack)
              res.status(500)
              res.json(error.message)
            })
        }
      )

      app.get(
        [
          `${SERVERROUTESPREFIX}/appstore/datasize/:name`,
          `${SERVERROUTESPREFIX}/appstore/datasize/:org/:name`
        ],
        async (req, res) => {
          let name = req.params.name
          if (req.params.org) {
            name = req.params.org + '/' + name
          }
          const plugin = getPlugin(name)
          const pluginId = plugin ? plugin.id : undefined
          if (!pluginId) {
            res.json({ totalBytes: 0, fileCount: 0, hasData: false })
            return
          }
          try {
            const dataSize = await getPluginDataSize(
              app.config.configPath,
              pluginId
            )
            res.json(dataSize)
          } catch (error) {
            console.error('Failed to get plugin data size:', error)
            res.json({ totalBytes: 0, fileCount: 0, hasData: false })
          }
        }
      )

      app.get(`${SERVERROUTESPREFIX}/appstore/available/`, (req, res) => {
        const installedNames = getInstalledPackageNames()

        Promise.all([
          findPluginsAndWebapps(),
          getLatestServerVersion(app.config.version).catch(() => '0.0.0'),
          fetchDistTagsForPackages(installedNames).catch(() => ({})),
          registry.getIndex().catch(() => undefined)
        ])
          .then(
            ([[plugins, webapps], serverVersion, distTagsMap, regIndex]) => {
              const result = getAllModuleInfo(
                plugins,
                webapps,
                serverVersion,
                distTagsMap,
                regIndex
              )
              return { result, plugins, webapps }
            }
          )
          .then(({ result, plugins, webapps }) => {
            try {
              cache.writeList(result)
            } catch (err) {
              debug('writeList failed: %O', err)
            }
            scheduleInstalledDetailRefresh(result)
            scheduleIconProbe(plugins, webapps)
            res.json(result)
          })
          .catch((error) => {
            console.log(error.message)
            debug(error.stack)
            res.json(buildOfflineResponse(app, cache))
          })
      })

      app.get(
        [
          `${SERVERROUTESPREFIX}/appstore/plugin/:name`,
          `${SERVERROUTESPREFIX}/appstore/plugin/:org/:name`
        ],
        async (req, res) => {
          let name = req.params.name
          if (req.params.org) {
            name = req.params.org + '/' + name
          }

          try {
            const detail = await loadPluginDetail(name)
            if (!detail) {
              res.status(404).json({
                error: 'Plugin not found',
                name,
                storeAvailable: false
              })
              return
            }
            res.json(detail)
          } catch (err) {
            console.log(err.message)
            debug(err.stack)
            const cached = readDetailFromCache(cache, name)
            if (cached) {
              res.json({ ...cached, storeAvailable: false, fromCache: true })
              return
            }
            res.status(503).json({
              error:
                'Plugin details not available. Reconnect and refresh to view.',
              name,
              storeAvailable: false
            })
          }
        }
      )

      app.post(`${SERVERROUTESPREFIX}/appstore/refresh`, (req, res) => {
        cache.invalidateList()
        registry.invalidate()
        iconProbe.invalidate()
        npmMetadata.invalidate()
        installedMetadataCache.clear()
        res.json({ ok: true })
      })

      app.post(
        `${SERVERROUTESPREFIX}/appstore/install-with-deps`,
        async (req, res) => {
          const { name, version } = req.body || {}
          if (!name || typeof name !== 'string') {
            res.status(400).json({ error: 'name is required' })
            return
          }
          try {
            const [plugins, webapps] = await findPluginsAndWebapps()
            const match =
              plugins.find((p) => p.package.name === name) ||
              webapps.find((w) => w.package.name === name)
            if (!match) {
              res.status(404).json({ error: `No such plugin: ${name}` })
              return
            }
            const ext = enrichEntry(match.package, { iconUrlLookup })
            const required = ext.requires || []
            const toInstall = []
            for (const dep of required) {
              if (!getPlugin(dep) && !getWebApp(dep)) {
                toInstall.push(dep)
              }
            }
            toInstall.push(name)
            for (const pkgName of toInstall) {
              const pkgVersion =
                pkgName === name
                  ? version
                  : resolveLatestVersion(pkgName, plugins, webapps)
              if (moduleInstalling) {
                moduleInstallQueue.push({
                  name: pkgName,
                  version: pkgVersion
                })
              } else {
                installSKModule(pkgName, pkgVersion)
              }
            }
            sendAppStoreChangedEvent()
            res.json({ queued: toInstall })
          } catch (err) {
            console.log(err.message)
            debug(err.stack)
            res.status(500).json({ error: err.message })
          }
        }
      )
    },
    stop: () => undefined
  }

  async function loadPluginDetail(name) {
    const [plugins, webapps] = await findPluginsAndWebapps()
    const match =
      plugins.find((p) => p.package.name === name) ||
      webapps.find((w) => w.package.name === name)
    if (!match) {
      const cached = readDetailFromCache(cache, name)
      return cached || null
    }
    const pkg = match.package
    const isInstalled = !!getPlugin(name) || !!getWebApp(name)
    let pkgForEnrichment = pkg
    if (isInstalled) {
      const installedMeta = getInstalledPackageMetadata(name)
      if (installedMeta && installedMeta.signalk) {
        pkgForEnrichment = { ...pkg, signalk: installedMeta.signalk }
      }
    } else {
      // npm search strips the signalk.* key, so a non-installed plugin's
      // detail page would miss icon/screenshots/requires/recommends. The
      // per-version registry endpoint returns the full package.json; it's
      // only one extra request on the detail path (unlike the list path).
      try {
        const registryMeta = await npmMetadata.get(pkg.name, pkg.version)
        if (registryMeta && registryMeta.signalk) {
          pkgForEnrichment = { ...pkg, signalk: registryMeta.signalk }
        }
      } catch (err) {
        debug('npm metadata fetch for %s failed: %O', name, err)
      }
    }
    const ext = enrichEntry(pkgForEnrichment, {
      includeIndicators: true,
      iconUrlLookup
    })
    const resolver = buildDependencyResolver(plugins, webapps)
    const [detail, regIndexEntry] = await Promise.all([
      buildPluginDetail(
        {
          name: pkg.name,
          version: pkg.version,
          displayName: ext.displayName,
          appIcon: ext.appIcon,
          screenshots: ext.screenshots || [],
          official: ext.official,
          deprecated: ext.deprecated,
          description: pkg.description,
          keywords: pkg.keywords || [],
          npmReadme: pkg.readme,
          githubUrl: ext.githubUrl,
          lastReleaseDate: pkg.date,
          requires: ext.requires,
          recommends: ext.recommends
        },
        resolver
      ),
      registry.getIndexEntry(name).catch(() => undefined)
    ])

    if (regIndexEntry) {
      const { score, checks } = badgesToIndicators(
        regIndexEntry.badges_stable,
        regIndexEntry.composite_stable
      )
      detail.indicators = {
        score,
        checks,
        reportedPlatforms: [],
        rawMetrics: {
          lastReleaseDate: regIndexEntry.last_tested
        }
      }
    }

    if (isInstalled) {
      const localIcons = buildLocalAssetUrls(pkg.name, pkgForEnrichment)
      if (localIcons?.appIcon) detail.installedIconUrl = localIcons.appIcon
      if (localIcons?.screenshots && localIcons.screenshots.length > 0) {
        detail.installedScreenshotUrls = localIcons.screenshots
      }
    }
    cache.writePluginDetail(detail, isInstalled)
    return detail
  }

  function getInstalledPackageMetadata(name) {
    if (installedMetadataCache.has(name)) {
      return installedMetadataCache.get(name)
    }
    const webapp = getWebApp(name)
    // app.webapps[i] is already the full package.json metadata
    if (webapp && typeof webapp === 'object' && webapp.signalk) {
      installedMetadataCache.set(name, webapp)
      return webapp
    }
    const plugin = getPlugin(name)
    if (plugin && plugin.packageLocation) {
      try {
        // packageLocation is the parent directory; append /package.json
        const pkgPath = `${plugin.packageLocation}/${name}/package.json`
        const metadata = require(pkgPath)
        installedMetadataCache.set(name, metadata)
        return metadata
      } catch (err) {
        debug('failed to read installed package.json for %s: %O', name, err)
      }
    }
    if (webapp && typeof webapp === 'object') {
      installedMetadataCache.set(name, webapp)
      return webapp
    }
    installedMetadataCache.set(name, undefined)
    return undefined
  }

  // Webapps and plugins that ship static assets are mounted by the server at
  // /<package-name>/, so declared paths that look wrong against unpkg's raw
  // tarball layout (e.g. freeboard-sk's "./assets/icons/icon-72x72.png" which
  // is actually at "/public/assets/icons/icon-72x72.png" inside the tarball)
  // resolve correctly against the mounted serving root. Reuse that URL
  // scheme for installed plugins so the App Store card matches what Webapps
  // shows elsewhere in the admin UI.
  function buildLocalAssetUrl(pkgName, declaredPath) {
    if (!declaredPath || typeof declaredPath !== 'string') return undefined
    if (/^(https?:)?\/\//i.test(declaredPath)) return declaredPath
    if (declaredPath.startsWith('data:')) return declaredPath
    const cleaned = declaredPath.replace(/^\.\//, '')
    return `/${pkgName}/${cleaned}`
  }

  function buildLocalAssetUrls(pkgName, pkg) {
    const signalk = pkg && pkg.signalk
    if (!signalk || typeof signalk !== 'object') return undefined
    const appIcon =
      typeof signalk.appIcon === 'string' && signalk.appIcon.trim()
        ? buildLocalAssetUrl(pkgName, signalk.appIcon.trim())
        : undefined
    let screenshots
    if (Array.isArray(signalk.screenshots)) {
      screenshots = signalk.screenshots
        .filter((s) => typeof s === 'string' && s.trim())
        .map((s) => buildLocalAssetUrl(pkgName, s.trim()))
        .filter(Boolean)
    }
    if (!appIcon && (!screenshots || screenshots.length === 0)) return undefined
    return { appIcon, screenshots }
  }

  function resolveLatestVersion(name, plugins, webapps) {
    const match =
      plugins.find((p) => p.package.name === name) ||
      webapps.find((w) => w.package.name === name)
    return match ? match.package.version : undefined
  }

  function buildDependencyResolver(plugins, webapps) {
    const byName = new Map()
    for (const p of plugins) byName.set(p.package.name, p.package)
    for (const w of webapps) byName.set(w.package.name, w.package)
    return (name) => {
      const pkg = byName.get(name)
      const installed = !!getPlugin(name) || !!getWebApp(name)
      if (!pkg) {
        return { installed }
      }
      const ext = enrichEntry(pkg, { iconUrlLookup })
      return {
        displayName: ext.displayName,
        appIcon: ext.appIcon,
        installed
      }
    }
  }

  function scheduleInstalledDetailRefresh(result) {
    const installedNames = getInstalledPackageNames()
    if (installedNames.length === 0) return
    setImmediate(() => {
      installedNames.forEach((name) => {
        loadPluginDetail(name).catch((err) =>
          debug('background detail refresh for %s failed: %O', name, err)
        )
      })
      void result
    })
  }

  function collectIconProbeTasks(plugins, webapps) {
    const tasks = []
    const queuedKey = new Set()
    for (const list of [plugins, webapps]) {
      for (const mod of list) {
        const pkg = mod.package
        const signalk = pkg.signalk
        if (!signalk || typeof signalk !== 'object') continue
        const paths = []
        if (typeof signalk.appIcon === 'string' && signalk.appIcon.trim()) {
          paths.push(signalk.appIcon.trim())
        }
        if (Array.isArray(signalk.screenshots)) {
          for (const s of signalk.screenshots) {
            if (typeof s === 'string' && s.trim()) paths.push(s.trim())
          }
        }
        for (const declaredPath of paths) {
          const key = `${pkg.name}@${pkg.version}@${declaredPath}`
          if (queuedKey.has(key)) continue
          if (iconProbe.get(pkg.name, pkg.version, declaredPath) !== undefined)
            continue
          queuedKey.add(key)
          tasks.push({ name: pkg.name, version: pkg.version, declaredPath })
        }
      }
    }
    return tasks
  }

  async function runIconProbeTasks(tasks) {
    const CONCURRENCY = 6
    let i = 0
    async function worker() {
      while (true) {
        const idx = i++
        if (idx >= tasks.length) return
        const t = tasks[idx]
        try {
          await probeIconUrl(t.name, t.version, t.declaredPath, iconProbe)
        } catch (err) {
          debug('icon probe %s failed: %O', t.name, err)
        }
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()))
  }

  function scheduleIconProbe(plugins, webapps) {
    setImmediate(() => {
      const tasks = collectIconProbeTasks(plugins, webapps)
      if (tasks.length === 0) return
      debug('scheduling %d icon probes', tasks.length)
      runIconProbeTasks(tasks).catch((err) =>
        debug('icon probe run failed: %O', err)
      )
    })
  }

  function findPluginsAndWebapps() {
    return Promise.all([
      findModulesWithKeyword('signalk-node-server-plugin'),
      findModulesWithKeyword('signalk-embeddable-webapp'),
      findModulesWithKeyword('signalk-webapp')
    ]).then(([plugins, embeddableWebapps, webapps]) => {
      const allWebapps = []
        .concat(embeddableWebapps)
        .concat(webapps)
        .filter((m) => !bundledAdminUIs.includes(m.package.name))
      return [
        plugins,
        _.uniqBy(allWebapps, (plugin) => {
          return plugin.package.name
        })
      ]
    })
  }

  function getInstalledPackageNames() {
    return [
      ...new Set(
        [
          ...(app.plugins || []).map((p) => p.packageName),
          ...(app.webapps || []).map((w) => w.name),
          ...(app.addons || []).map((a) => a.name),
          ...(app.embeddablewebapps || []).map((e) => e.name)
        ].filter(Boolean)
      )
    ]
  }

  function getPlugin(id) {
    return app.plugins.find((plugin) => plugin.packageName === id)
  }

  function getWebApp(id) {
    return (
      (app.webapps && app.webapps.find((webapp) => webapp.name === id)) ||
      (app.addons && app.addons.find((webapp) => webapp.name === id)) ||
      (app.embeddablewebapps &&
        app.embeddablewebapps.find((webapp) => webapp.name === id))
    )
  }

  function emptyAppStoreInfo(storeAvailable = true) {
    return {
      available: [],
      installed: [],
      updates: [],
      installing: [],
      categories: getAvailableCategories(),
      storeAvailable: storeAvailable,
      isInDocker: process.env.IS_IN_DOCKER === 'true'
    }
  }

  function getAllModuleInfo(
    plugins,
    webapps,
    serverVersion,
    distTagsMap = {},
    regIndex
  ) {
    const all = emptyAppStoreInfo()
    const regLookup = new Map()
    if (regIndex?.plugins) {
      for (const entry of regIndex.plugins) {
        regLookup.set(entry.name, entry)
      }
    }

    if (
      process.argv.length > 1 &&
      (npmServerInstallLocations.includes(process.argv[1]) ||
        process.env.SIGNALK_SERVER_IS_UPDATABLE) &&
      !process.env.SIGNALK_DISABLE_SERVER_UPDATES
    ) {
      all.canUpdateServer = !all.isInDocker && true
      if (gt(serverVersion, app.config.version)) {
        all.serverUpdate = serverVersion

        const info = {
          name: app.config.name,
          version: serverVersion,
          description: app.config.description,
          author: getAuthor(app.config),
          npmUrl: null,
          isPlugin: false,
          isWebapp: false
        }

        if (moduleInstallQueue.find((p) => p.name === info.name)) {
          info.isWaiting = true
          all.installing.push(info)
        } else if (modulesInstalledSinceStartup[info.name]) {
          if (moduleInstalling && moduleInstalling.name === info.name) {
            info.isInstalling = true
          } else if (modulesInstalledSinceStartup[info.name].code !== 0) {
            info.installFailed = true
          }
          all.installing.push(info)
        }
      }
    } else {
      all.canUpdateServer = false
    }

    getModulesInfo(plugins, getPlugin, all, distTagsMap, regLookup)
    getModulesInfo(webapps, getWebApp, all, distTagsMap, regLookup)

    if (process.env.PLUGINS_WITH_UPDATE_DISABLED) {
      const disabled = process.env.PLUGINS_WITH_UPDATE_DISABLED.split(',')
      all.updates.forEach((info) => {
        if (disabled.includes(info.name)) {
          info.updateDisabled = true
        }
      })
    }

    return all
  }

  function getModulesInfo(modules, existing, result, distTagsMap, regLookup) {
    modules.forEach((plugin) => {
      const name = plugin.package.name
      const version = plugin.package.version

      if (!semver.valid(version)) {
        console.warn(
          `Skipping ${name}: invalid semver version '${version}'. ` +
            `Please inform the plugin developer to publish a valid semver version.`
        )
        return
      }

      const installedLocally =
        !!getPlugin(name) || !!getWebApp(name) || !!existing(name)
      // For installed plugins, the real package.json (including signalk.*)
      // is available on disk. npm search strips the signalk key, so merge
      // the on-disk metadata over the npm search result before enrichment.
      let packageForEnrichment = plugin.package
      let localIcons
      if (installedLocally) {
        const installedMeta = getInstalledPackageMetadata(name)
        if (installedMeta && installedMeta.signalk) {
          packageForEnrichment = {
            ...plugin.package,
            signalk: installedMeta.signalk
          }
          localIcons = buildLocalAssetUrls(name, installedMeta)
        } else {
          localIcons = buildLocalAssetUrls(name, plugin.package)
        }
      }
      const ext = enrichEntry(packageForEnrichment, { iconUrlLookup })
      const pluginInfo = {
        name: name,
        version: version,
        description: plugin.package.description,
        author: getAuthor(plugin.package),
        categories: getCategories(plugin.package),
        updated: plugin.package.date,
        keywords: getKeywords(plugin.package),
        npmUrl: getNpmUrl(plugin),
        isPlugin: plugin.package.keywords.some(
          (v) => v === 'signalk-node-server-plugin'
        ),
        isWebapp: plugin.package.keywords.some((v) => v === 'signalk-webapp'),
        isEmbeddableWebapp: plugin.package.keywords.some(
          (v) => v === 'signalk-embeddable-webapp'
        ),
        displayName: ext.displayName,
        appIcon: ext.appIcon,
        installedIconUrl: localIcons?.appIcon,
        screenshots: ext.screenshots,
        installedScreenshotUrls: localIcons?.screenshots,
        official: ext.official,
        deprecated: ext.deprecated,
        githubUrl: ext.githubUrl,
        issuesUrl: ext.issuesUrl,
        requires: ext.requires,
        recommends: ext.recommends
      }

      const regEntry = regLookup && regLookup.get(name)
      if (regEntry) {
        const { score, checks } = badgesToIndicators(
          regEntry.badges_stable,
          regEntry.composite_stable
        )
        pluginInfo.indicators = {
          score,
          checks,
          reportedPlatforms: [],
          rawMetrics: {
            lastReleaseDate: regEntry.last_tested
          }
        }
        pluginInfo.registryBadges = regEntry.badges_stable || []
        pluginInfo.registryTestStatus = regEntry.test_status
      }

      const tags = distTagsMap[name]
      if (tags) {
        let highest = null
        for (const [tag, tagVersion] of Object.entries(tags)) {
          if (tag === 'latest') continue
          const parsed = semver.parse(tagVersion)
          if (
            parsed &&
            parsed.prerelease.length > 0 &&
            semver.gt(
              `${parsed.major}.${parsed.minor}.${parsed.patch}`,
              version
            )
          ) {
            if (!highest || semver.gt(tagVersion, highest)) {
              highest = tagVersion
            }
          }
        }
        if (highest) {
          pluginInfo.prereleaseVersion = highest
        }
      }

      const installedModule = existing(name)

      if (installedModule) {
        pluginInfo.id = installedModule.id
        pluginInfo.installedVersion = installedModule.version
      }

      if (moduleInstallQueue.find((p) => p.name === name)) {
        pluginInfo.isWaiting = true
        addIfNotDuplicate(result.installing, pluginInfo)
      } else if (modulesInstalledSinceStartup[name]) {
        if (moduleInstalling && moduleInstalling.name === name) {
          if (moduleInstalling.isRemove) {
            pluginInfo.isRemoving = true
          } else {
            pluginInfo.isInstalling = true
          }
        } else if (modulesInstalledSinceStartup[name].code !== 0) {
          pluginInfo.installFailed = true
          addIfNotDuplicate(result.available, pluginInfo)
        }
        pluginInfo.isRemove = modulesInstalledSinceStartup[name].isRemove
        addIfNotDuplicate(result.installing, pluginInfo)
      } else if (installedModule) {
        if (
          semver.valid(installedModule.version) &&
          gt(version, installedModule.version)
        ) {
          addIfNotDuplicate(result.updates, pluginInfo)
        } else if (!semver.valid(installedModule.version)) {
          console.warn(
            `Installed module ${name} has invalid semver version '${installedModule.version}'. ` +
              `Please inform the plugin developer.`
          )
        }
        addIfNotDuplicate(result.installed, pluginInfo)
      }
      addIfNotDuplicate(result.available, pluginInfo)

      return result
    })
  }

  function addIfNotDuplicate(theArray, moduleInfo) {
    if (!theArray.find((p) => p.name === moduleInfo.name)) {
      theArray.push(moduleInfo)
    }
  }

  function getNpmUrl(moduleInfo) {
    const npm = _.get(moduleInfo.package, 'links.npm')
    return npm || null
  }

  function sendAppStoreChangedEvent() {
    findPluginsAndWebapps().then(([plugins, webapps]) => {
      getLatestServerVersion(app.config.version)
        .then((serverVersion) =>
          getAllModuleInfo(plugins, webapps, serverVersion)
        )
        .then((result) => {
          app.emit('serverevent', {
            type: 'APP_STORE_CHANGED',
            from: 'signalk-server',
            data: result
          })
        })
    })
  }

  function installSKModule(module, version) {
    if (isTheServerModule(module, app.config)) {
      try {
        app.providers.forEach((providerHolder) => {
          if (
            typeof providerHolder.pipeElements[0].pipeline[0].options
              .filename !== 'undefined'
          ) {
            debug('close file connection:', providerHolder.id)
            providerHolder.pipeElements[0].end()
          }
        })
      } catch (err) {
        debug(err)
      }
    }
    updateSKModule(module, version, false)
  }

  function removeSKModule(module, deleteData) {
    const plugin = getPlugin(module)
    const pluginId = plugin ? plugin.id : undefined
    updateSKModule(module, null, true, pluginId, deleteData)
  }

  function updateSKModule(module, version, isRemove, pluginId, deleteData) {
    moduleInstalling = {
      name: module,
      output: [],
      version: version,
      isRemove: isRemove
    }
    modulesInstalledSinceStartup[module] = moduleInstalling

    sendAppStoreChangedEvent()

    const onData = (output) => {
      modulesInstalledSinceStartup[module].output.push(output)
      console.log(`stdout: ${output}`)
    }
    const onErr = (output) => {
      modulesInstalledSinceStartup[module].output.push(output)
      console.error(`stderr: ${output}`)
    }
    const onClose = (code) => {
      debug('close: ' + module)
      modulesInstalledSinceStartup[module].code = code
      moduleInstalling = undefined
      debug(`child process exited with code ${code}`)

      if (isRemove && pluginId) {
        delete app.providerStatus[pluginId]
      }

      if (moduleInstallQueue.length) {
        const next = moduleInstallQueue.splice(0, 1)[0]
        if (next.isRemove) {
          removeSKModule(next.name, next.deleteData)
        } else {
          installSKModule(next.name, next.version)
        }
      }

      sendAppStoreChangedEvent()
    }

    if (isRemove) {
      removeModule(
        app.config,
        module,
        version,
        onData,
        onErr,
        onClose,
        pluginId,
        deleteData
      )
    } else {
      installModule(app.config, module, version, onData, onErr, onClose)
    }
  }
}

function packageNameIs(name) {
  return (x) => x.package.name === name
}
