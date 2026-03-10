---
title: BLE Provider & Consumer Plugins
---

# BLE Provider and Consumer Plugins

The Signal K [BLE API](../rest-api/ble_api.md) decouples BLE hardware access from BLE data consumers. **Provider plugins** supply hardware (local BlueZ adapter, remote gateway, MQTT bridge, etc.). **Consumer plugins** subscribe to the merged advertisement stream and request GATT connections through the server.

## Consumer Plugin

Most BLE plugins are consumers — they process advertisements and optionally connect via GATT to read sensor data. The server handles provider selection, GATT slot management, and failover.

### Subscribing to Advertisements

```javascript
module.exports = function (app) {
  const plugin = { id: 'my-ble-plugin', name: 'My BLE Plugin' }
  let unsubscribe = null

  plugin.start = function () {
    unsubscribe = app.bleApi.onAdvertisement(plugin.id, (adv) => {
      // adv.mac, adv.rssi, adv.manufacturerData, adv.serviceData, …
      if (adv.mac === 'AA:BB:CC:DD:EE:FF') {
        processAdvertisement(adv)
      }
    })
  }

  plugin.stop = function () {
    if (unsubscribe) unsubscribe()
  }

  return plugin
}
```

`onAdvertisement` returns an unsubscribe function. Call it in `plugin.stop()`.

### GATT Subscriptions

For sensors that require a persistent GATT connection, use `subscribeGATT`. Provide a declarative descriptor — the server selects the best provider (strongest RSSI, available slots) and manages connect/reconnect autonomously.

```javascript
plugin.start = async function () {
  const descriptor = {
    mac: 'AA:BB:CC:DD:EE:FF',
    service: '0000180f-0000-1000-8000-00805f9b34fb', // Battery Service
    notify: ['00002a19-0000-1000-8000-00805f9b34fb'] // Battery Level
  }

  gattHandle = await app.bleApi.subscribeGATT(
    descriptor,
    plugin.id,
    (charUuid, data) => {
      const level = data.readUInt8(0)
      app.handleMessage(plugin.id, {
        updates: [
          {
            values: [
              {
                path: 'electrical.batteries.0.capacity.stateOfCharge',
                value: level / 100
              }
            ]
          }
        ]
      })
    }
  )

  gattHandle.onDisconnect(() => {
    app.debug('GATT disconnected — server will reconnect automatically')
  })
}

plugin.stop = async function () {
  if (gattHandle) await gattHandle.close()
}
```

### GATTSubscriptionDescriptor

| Field                         | Type      | Description                                                       |
| ----------------------------- | --------- | ----------------------------------------------------------------- |
| `mac`                         | string    | Target device MAC address                                         |
| `service`                     | string    | Primary service UUID                                              |
| `notify`                      | string[]? | Characteristic UUIDs to subscribe for notifications               |
| `poll`                        | object[]? | Characteristics to poll: `{ uuid, intervalMs, writeBeforeRead? }` |
| `init`                        | object[]? | One-time writes after connection: `{ uuid, data }` (hex)          |
| `periodicWrite`               | object[]? | Repeated writes: `{ uuid, data, intervalMs }` (hex)               |
| `failover.enabled`            | boolean?  | Enable provider failover on disconnect (default: true)            |
| `failover.migrationThreshold` | number?   | dBm advantage needed for proactive migration                      |
| `failover.migrationHoldTime`  | number?   | Seconds advantage must hold before migrating (default: 60)        |

### GATTSubscriptionHandle

| Member                  | Type            | Description                                     |
| ----------------------- | --------------- | ----------------------------------------------- |
| `write(charUuid, data)` | `Promise<void>` | Write to a characteristic                       |
| `close()`               | `Promise<void>` | Release the GATT claim                          |
| `connected`             | boolean         | Whether the GATT connection is currently active |
| `onDisconnect(cb)`      | void            | Called when the connection drops                |
| `onConnect(cb)`         | void            | Called when the connection (re-)establishes     |

### Raw GATT Connection

For sensors with truly dynamic GATT sequences, use `connectGATT` to get a raw connection handle. Prefer `subscribeGATT` with a descriptor when possible — it handles reconnection automatically.

```javascript
const conn = await app.bleApi.connectGATT('AA:BB:CC:DD:EE:FF', plugin.id)
const services = await conn.discoverServices()
const data = await conn.read(serviceUuid, charUuid)
await conn.disconnect()
```

### BLE API Mode Detection

Consumer plugins that can also operate with a direct BlueZ connection should auto-detect which mode to use:

```javascript
plugin.start = async function () {
  if (app.bleApi) {
    // Server manages BLE — use the BLE API
    await startBleApiMode()
  } else {
    // Fall back to direct BlueZ access
    await startDirectBlueZMode()
  }
}
```

---

## Provider Plugin

A provider plugin gives the server access to a BLE radio. Register a provider by calling `app.bleApi.register()`. The server will call your `onAdvertisement` callback to receive all advertisements, merge them into the device table, and route GATT requests to your `subscribeGATT` method.

```javascript
const plugin = { id: 'my-ble-gateway', name: 'My BLE Gateway' }

plugin.start = function () {
  const provider = {
    name: 'My Gateway',
    methods: {
      startDiscovery: async () => {
        /* start scanning */
      },
      stopDiscovery: async () => {
        /* stop scanning */
      },
      getDevices: async () => [], // return visible MACs

      onAdvertisement(callback) {
        // Store callback and call it whenever an advertisement arrives:
        // callback({ mac, rssi, name, manufacturerData, serviceData, providerId: plugin.id, timestamp: Date.now() })
        return () => {
          /* unsubscribe */
        }
      },

      supportsGATT: () => true,
      availableGATTSlots: () => 3,

      async subscribeGATT(descriptor, callback) {
        // Connect to descriptor.mac, subscribe to descriptor.notify, etc.
        // Call callback(charUuid, buffer) on notifications.
        return {
          write: async (charUuid, data) => {
            /* write to characteristic */
          },
          close: async () => {
            /* disconnect and clean up */
          },
          connected: true,
          onDisconnect: (cb) => {
            /* register callback */
          },
          onConnect: (cb) => {
            /* register callback */
          }
        }
      }
    }
  }

  app.bleApi.register(plugin.id, provider)
}

plugin.stop = function () {
  app.bleApi.unRegister(plugin.id)
}
```

### BLEProviderMethods interface

| Method                          | Returns                           | Description                                         |
| ------------------------------- | --------------------------------- | --------------------------------------------------- |
| `startDiscovery()`              | `Promise<void>`                   | Begin scanning for advertisements                   |
| `stopDiscovery()`               | `Promise<void>`                   | Stop scanning                                       |
| `getDevices()`                  | `Promise<string[]>`               | MACs of currently visible devices                   |
| `onAdvertisement(cb)`           | `() => void`                      | Subscribe to advertisements; returns unsubscribe fn |
| `supportsGATT()`                | `boolean`                         | Whether this provider can make GATT connections     |
| `availableGATTSlots()`          | `number`                          | How many concurrent GATT connections are free       |
| `subscribeGATT(descriptor, cb)` | `Promise<GATTSubscriptionHandle>` | Establish a GATT subscription                       |
| `connectGATT?(mac)`             | `Promise<BLEGattConnection>`      | Raw GATT connection (optional)                      |

### Advertisement format

Each advertisement fired into the server must conform to `BLEAdvertisement`:

```typescript
{
  mac: 'AA:BB:CC:DD:EE:FF',   // uppercase colon-separated
  name?: 'SensorName',
  rssi: -72,
  manufacturerData?: { 1177: 'ff0102...' },  // key = decimal company ID
  serviceData?: { '0000feaa-...': 'deadbeef' },
  serviceUuids?: ['0000180f-...'],
  providerId: 'my-ble-gateway',   // must match the registered plugin ID
  timestamp: Date.now(),
  connectable?: true,
  txPower?: -59,
}
```

`manufacturerData` keys are **decimal** company IDs (matching the Bluetooth SIG assigned numbers list). The values are hex-encoded payloads **without** the 2-byte company ID prefix.
