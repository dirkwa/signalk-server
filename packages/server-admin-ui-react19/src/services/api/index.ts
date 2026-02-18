import { createKeeperApi, type KeeperApi, KeeperApiError } from './keeper'
import { createSignalkApi, type SignalkApi } from './signalk'

export { KeeperApiError }
export type { KeeperApi, SignalkApi }
export * from './types'

export interface RuntimeConfig {
  containerRuntime: string | null
  keeperUrl: string | null
  useKeeper: boolean
}

let keeperApi: KeeperApi | null = null
let signalkApi: SignalkApi | null = null
let runtimeConfig: RuntimeConfig = {
  containerRuntime: null,
  keeperUrl: null,
  useKeeper: false
}

export function initializeApi(config: Partial<RuntimeConfig>): void {
  runtimeConfig = {
    containerRuntime: config.containerRuntime ?? null,
    keeperUrl: config.keeperUrl ?? null,
    useKeeper: config.useKeeper ?? false
  }

  signalkApi = createSignalkApi()

  if (runtimeConfig.useKeeper) {
    // Proxy through SignalK server — works with HTTPS, remote access, any network topology
    keeperApi = createKeeperApi(`${window.serverRoutesPrefix}/keeper`)
  }
}

export function getRuntimeConfig(): RuntimeConfig {
  return { ...runtimeConfig }
}

export function shouldUseKeeper(): boolean {
  return runtimeConfig.useKeeper && keeperApi !== null
}

export function getKeeperApi(): KeeperApi {
  if (!keeperApi) {
    throw new Error('Keeper API not initialized or not available')
  }
  return keeperApi
}

export function getSignalkApi(): SignalkApi {
  if (!signalkApi) {
    signalkApi = createSignalkApi()
  }
  return signalkApi
}

// Routes calls to Keeper or SignalK Server based on runtime config
export const serverApi = {
  restart: async (): Promise<void> => {
    if (shouldUseKeeper()) {
      await getKeeperApi().container.restart()
    } else {
      await getSignalkApi().restart()
    }
  },

  getStatus: async () => {
    if (shouldUseKeeper()) {
      return getKeeperApi().container.status()
    }
    return null
  },

  getStats: async () => {
    if (shouldUseKeeper()) {
      return getKeeperApi().container.stats()
    }
    return null
  }
}

export const backupApi = {
  // Keeper only — SignalK supports single download only
  list: async () => {
    if (shouldUseKeeper()) {
      return getKeeperApi().backups.list()
    }
    return null
  },

  create: async (options?: {
    type?: 'full' | 'config' | 'plugins'
    description?: string
    includePlugins?: boolean
  }) => {
    if (shouldUseKeeper()) {
      return getKeeperApi().backups.create({
        type: options?.type,
        description: options?.description
      })
    }
    return {
      downloadUrl: getSignalkApi().backup.download(
        options?.includePlugins ?? true
      )
    }
  },

  getDownloadUrl: (id?: string, includePlugins?: boolean): string => {
    if (shouldUseKeeper() && id) {
      return getKeeperApi().backups.download(id)
    }
    return getSignalkApi().backup.download(includePlugins ?? true)
  },

  upload: async (file: File) => {
    if (shouldUseKeeper()) {
      return getKeeperApi().backups.upload(file)
    }
    return getSignalkApi().backup.validate(file)
  },

  restore: async (idOrFiles: string | string[]) => {
    if (shouldUseKeeper()) {
      if (typeof idOrFiles === 'string') {
        await getKeeperApi().backups.restore(idOrFiles)
      } else {
        throw new Error('Keeper restore requires backup ID, not file list')
      }
    } else {
      if (Array.isArray(idOrFiles)) {
        await getSignalkApi().backup.restore(idOrFiles)
      } else {
        throw new Error('SignalK restore requires file list, not backup ID')
      }
    }
  },

  delete: async (id: string) => {
    if (shouldUseKeeper()) {
      await getKeeperApi().backups.delete(id)
    } else {
      throw new Error('Backup deletion not supported without Keeper')
    }
  },

  scheduler: {
    status: async () => {
      if (shouldUseKeeper()) {
        return getKeeperApi().backups.scheduler.status()
      }
      return null
    },

    update: async (config: {
      enabled?: boolean
      schedule?: string
      retentionDays?: number
    }) => {
      if (shouldUseKeeper()) {
        return getKeeperApi().backups.scheduler.update(config)
      }
      throw new Error('Backup scheduling not supported without Keeper')
    }
  },

  storage: async () => {
    if (shouldUseKeeper()) {
      return getKeeperApi().backups.storage()
    }
    return null
  },

  password: {
    status: async () => {
      if (shouldUseKeeper()) {
        return getKeeperApi().backups.password.status()
      }
      return null
    },

    change: async (password: string, confirmPassword: string) => {
      if (shouldUseKeeper()) {
        await getKeeperApi().backups.password.change(password, confirmPassword)
      } else {
        throw new Error(
          'Backup password management not supported without Keeper'
        )
      }
    },

    reset: async () => {
      if (shouldUseKeeper()) {
        await getKeeperApi().backups.password.reset()
      } else {
        throw new Error(
          'Backup password management not supported without Keeper'
        )
      }
    }
  }
}

export const updateApi = {
  listVersions: async () => {
    if (shouldUseKeeper()) {
      return getKeeperApi().versions.list()
    }
    return null
  },

  status: async () => {
    if (shouldUseKeeper()) {
      return getKeeperApi().update.status()
    }
    return null
  },

  start: async (version?: string) => {
    if (shouldUseKeeper()) {
      await getKeeperApi().update.start({ tag: version })
    } else {
      if (!version) {
        throw new Error('Version required for SignalK update')
      }
      await getSignalkApi().update.install(version)
    }
  },

  subscribeProgress: (
    onStatus: (status: import('./types').UpdateStatus) => void
  ): EventSource | null => {
    if (shouldUseKeeper()) {
      return getKeeperApi().update.statusStream(onStatus)
    }
    return null
  },

  rollback: async () => {
    if (shouldUseKeeper()) {
      await getKeeperApi().update.rollback()
    } else {
      throw new Error('Rollback not supported without Keeper')
    }
  },

  pullVersion: async (tag: string) => {
    if (shouldUseKeeper()) {
      await getKeeperApi().versions.pull(tag)
    } else {
      throw new Error('Version pull not supported without Keeper')
    }
  },

  switchVersion: async (tag: string) => {
    if (shouldUseKeeper()) {
      await getKeeperApi().versions.switch(tag)
    } else {
      throw new Error('Version switch not supported without Keeper')
    }
  },

  getSettings: async () => {
    if (shouldUseKeeper()) {
      return getKeeperApi().versions.settings()
    }
    return null
  },

  updateSettings: async (
    settings: Partial<import('./types').VersionSettings>
  ) => {
    if (shouldUseKeeper()) {
      return getKeeperApi().versions.updateSettings(settings)
    }
    return null
  }
}

export const cloudApi = {
  status: async () => {
    if (shouldUseKeeper()) {
      return getKeeperApi().cloud.status()
    }
    return null
  },

  gdrive: {
    connect: async () => {
      if (shouldUseKeeper()) {
        return getKeeperApi().cloud.gdrive.connect()
      }
      throw new Error('Cloud backup not supported without Keeper')
    },

    disconnect: async () => {
      if (shouldUseKeeper()) {
        await getKeeperApi().cloud.gdrive.disconnect()
      } else {
        throw new Error('Cloud backup not supported without Keeper')
      }
    },

    submitCode: async (code: string) => {
      if (shouldUseKeeper()) {
        await getKeeperApi().cloud.gdrive.submitCode(code)
      } else {
        throw new Error('Cloud backup not supported without Keeper')
      }
    }
  },

  sync: async () => {
    if (shouldUseKeeper()) {
      await getKeeperApi().cloud.sync()
    } else {
      throw new Error('Cloud backup not supported without Keeper')
    }
  },

  updateConfig: async (config: {
    syncMode?: string
    syncFrequency?: string
  }) => {
    if (shouldUseKeeper()) {
      await getKeeperApi().cloud.updateConfig(config)
    } else {
      throw new Error('Cloud backup not supported without Keeper')
    }
  },

  password: async () => {
    if (shouldUseKeeper()) {
      return getKeeperApi().cloud.password()
    }
    return null
  },

  installs: async () => {
    if (shouldUseKeeper()) {
      return getKeeperApi().cloud.installs()
    }
    return []
  },

  restorePrepare: async (folder: string, password?: string) => {
    if (shouldUseKeeper()) {
      return getKeeperApi().cloud.restorePrepare(folder, password)
    }
    throw new Error('Cloud restore not supported without Keeper')
  },

  restoreStart: async (snapshotId: string, mode: 'restore' | 'clone') => {
    if (shouldUseKeeper()) {
      await getKeeperApi().cloud.restoreStart(snapshotId, mode)
    } else {
      throw new Error('Cloud restore not supported without Keeper')
    }
  },

  restoreStatus: async () => {
    if (shouldUseKeeper()) {
      return getKeeperApi().cloud.restoreStatus()
    }
    return null
  },

  restoreReset: async () => {
    if (shouldUseKeeper()) {
      await getKeeperApi().cloud.restoreReset()
    }
  }
}

export const healthApi = {
  check: async () => {
    if (shouldUseKeeper()) {
      return getKeeperApi().health.check()
    }
    return null
  },

  signalkHealth: async () => {
    if (shouldUseKeeper()) {
      return getKeeperApi().health.signalk()
    }
    return null
  },

  runDoctor: async () => {
    if (shouldUseKeeper()) {
      return getKeeperApi().doctor.diagnose()
    }
    return null
  },

  applyFix: async (fixId: string) => {
    if (shouldUseKeeper()) {
      return getKeeperApi().doctor.applyFix(fixId)
    }
    return null
  },

  systemInfo: async () => {
    if (shouldUseKeeper()) {
      return getKeeperApi().system.info()
    }
    return null
  },

  checkKeeperUpdate: async () => {
    if (shouldUseKeeper()) {
      return getKeeperApi().system.keeperVersion()
    }
    return null
  },

  getKeeperUpgradeState: async () => {
    if (shouldUseKeeper()) {
      return getKeeperApi().system.keeperUpgradeState()
    }
    return null
  },

  prepareKeeperUpgrade: async (version: string) => {
    if (shouldUseKeeper()) {
      return getKeeperApi().system.keeperUpgradePrepare(version)
    }
    return null
  },

  applyKeeperUpgrade: async () => {
    if (shouldUseKeeper()) {
      return getKeeperApi().system.keeperUpgradeApply()
    }
    return null
  }
}

export const historyApi = {
  status: async () => {
    if (shouldUseKeeper()) {
      return getKeeperApi().history.status()
    }
    return null
  },

  settings: async () => {
    if (shouldUseKeeper()) {
      return getKeeperApi().history.settings()
    }
    return null
  },

  credentials: async () => {
    if (shouldUseKeeper()) {
      return getKeeperApi().history.credentials()
    }
    return null
  },

  enable: async (options?: {
    retentionDays?: number
    bucket?: string
    org?: string
  }) => {
    if (shouldUseKeeper()) {
      return getKeeperApi().history.enable(options)
    }
    throw new Error('History management not supported without Keeper')
  },

  disable: async (retainData: boolean = true) => {
    if (shouldUseKeeper()) {
      await getKeeperApi().history.disable(retainData)
    } else {
      throw new Error('History management not supported without Keeper')
    }
  },

  updateRetention: async (retentionDays: number) => {
    if (shouldUseKeeper()) {
      return getKeeperApi().history.updateRetention(retentionDays)
    }
    throw new Error('History management not supported without Keeper')
  },

  grafana: {
    enable: async () => {
      if (shouldUseKeeper()) {
        return getKeeperApi().history.grafana.enable()
      }
      throw new Error('Grafana management not supported without Keeper')
    },

    disable: async () => {
      if (shouldUseKeeper()) {
        return getKeeperApi().history.grafana.disable()
      }
      throw new Error('Grafana management not supported without Keeper')
    },

    refresh: async () => {
      if (shouldUseKeeper()) {
        return getKeeperApi().history.grafana.refresh()
      }
      throw new Error('Grafana management not supported without Keeper')
    }
  }
}
