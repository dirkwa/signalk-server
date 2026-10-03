---
title: Targets API
---

# Targets API

The Targets API gives one picture of the vessels and objects around the boat. AIS, radar ARPA and camera detection often see the same boat; the server links their contacts so that each boat is **one target**, whichever sensors report it. A collision alarm, a plotter or a logger reads that list instead of combining AIS vessels, radar targets and camera detections itself, so one boat raises one alarm and is drawn once.

Endpoint: `/signalk/v2/api/targets`

The OpenAPI definition is available in the Admin UI under _Documentation -> OpenAPI_.

## Where targets come from

- **AIS** vessels come from the data model (`vessels.*`) with no extra work: every vessel other than self with a recently reported position is a target.
- **Every other sensor** is a provider plugin that reports its _contacts_ with `app.updateTargetContact()` and withdraws them with `app.removeTargetContact()`.

A contact is dropped when its plugin removes it, when the plugin stops, or when it has not been updated for a minute.

## How contacts are linked

AIS vessels anchor the picture because they carry identity. A contact from another sensor joins an AIS vessel when:

- it carries that vessel's `mmsi`, because the sensor identified it (a camera reading the hull, a radar matching its own AIS overlay); or
- the AIS position, dead-reckoned to the time of the contact, lies within a distance gate that widens with range (radar bearing error grows with distance), and the two agree on course and speed.

A contact that carries an MMSI is never linked by position to a vessel with a different or unknown MMSI, nor grouped with a contact carrying a different one.

One sensor never contributes two contacts to the same target; when two contacts of one provider fit, the closer one wins. Contacts that no AIS vessel claims are grouped with each other the same way, so a radar track and a camera detection of a boat without AIS are still one target.

A link, once made, holds with a wider gate than it took to make it, so a target near the threshold does not split and merge from one request to the next.

## Target ids

- A target AIS sees has the vessel id as its id, e.g. `urn:mrn:imo:mmsi:244060000`, and its vessel context in `context`.
- Any other target is named after the contact that first saw it, `<type>:<contact id>`, e.g. `radar:radar-0-17`, and keeps that id while that contact is tracked. When AIS later identifies it, the target takes the vessel id. A target AIS stops reporting keeps the vessel id while a sensor still tracks it, without `context`.

## Position and motion

`position`, `courseOverGroundTrue`, `speedOverGround` and `headingTrue` come from AIS while its last report is recent, and otherwise from the most recent sensor observation. `timestamp` says when that observation was made. AIS course, speed and heading reported well apart from the position are left out rather than passed on under the position's timestamp. Each sensor's own view is in `sources`, AIS first, for consumers that want to choose themselves.

Units are SI as in the rest of Signal K: metres, metres per second, radians.

## Reading targets

```
GET /signalk/v2/api/targets
GET /signalk/v2/api/targets/{id}
```

The list is an object keyed by target id:

```json
{
  "urn:mrn:imo:mmsi:244060000": {
    "id": "urn:mrn:imo:mmsi:244060000",
    "context": "vessels.urn:mrn:imo:mmsi:244060000",
    "name": "Nordic Star",
    "mmsi": "244060000",
    "position": { "latitude": 52.018, "longitude": 4.0 },
    "courseOverGroundTrue": 3.1416,
    "speedOverGround": 5,
    "timestamp": "2026-10-03T20:30:00.000Z",
    "sources": [
      {
        "type": "ais",
        "provider": "vessels.urn:mrn:imo:mmsi:244060000",
        "id": "urn:mrn:imo:mmsi:244060000",
        "position": { "latitude": 52.018, "longitude": 4.0 },
        "courseOverGroundTrue": 3.1416,
        "speedOverGround": 5,
        "timestamp": "2026-10-03T20:30:00.000Z"
      },
      {
        "type": "radar",
        "provider": "mayara-server-signalk-plugin",
        "id": "radar-0-17",
        "position": { "latitude": 52.0182, "longitude": 4.0001 },
        "courseOverGroundTrue": 3.1416,
        "speedOverGround": 5.2,
        "timestamp": "2026-10-03T20:30:02.000Z",
        "ref": "vessels.self.radars.radar-0.targets.17"
      }
    ]
  }
}
```

Plugins read the same list with `app.getTargets()`.

## Providing contacts

```javascript
// Feature-detect, so the plugin still runs on older servers
if (app.updateTargetContact) {
  app.updateTargetContact({
    id: 'radar-0-17',
    type: 'radar',
    position: { latitude: 52.0182, longitude: 4.0001 },
    courseOverGroundTrue: 3.1416,
    speedOverGround: 5.2,
    ref: 'vessels.self.radars.radar-0.targets.17'
  })
}

// when the sensor loses the object
app.removeTargetContact?.('radar-0-17')
```

| Field                                                    | Required | Meaning                                                                                        |
| -------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------- |
| `id`                                                     | yes      | Unique among the plugin's contacts and stable while the sensor tracks the object.              |
| `type`                                                   | yes      | Sensor kind, e.g. `radar` or `camera`. `ais` is reserved.                                      |
| `position`                                               | yes      | `{ latitude, longitude }`. Convert range and bearing to a position before reporting.           |
| `courseOverGroundTrue`, `speedOverGround`, `headingTrue` | no       | Motion, in radians and m/s. Without course and speed a contact is linked on position alone.    |
| `timestamp`                                              | no       | ISO 8601 time of the observation, on the server's clock. Defaults to the time it was received. |
| `mmsi`                                                   | no       | Set only when the sensor itself identified the vessel; it overrides geometry.                  |
| `name`, `confidence`, `ref`                              | no       | Display name, confidence 0–1, and the Signal K path of the sensor's own record of the contact. |

Report every contact at least once a minute while it is tracked; updating at the sensor's own rate is fine. A provider that already merges several sensors of its own (mayara with several radars, for example) reports its merged tracks as one provider.
