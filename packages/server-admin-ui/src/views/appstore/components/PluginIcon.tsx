import React, { useState } from 'react'

interface PluginIconProps {
  name: string
  displayName?: string
  appIcon?: string
  installedIconUrl?: string
  size?: number
}

function monogramFor(name: string, displayName?: string): string {
  const source = (displayName || name).replace(/^@[^/]+\//, '')
  const words = source.split(/[-_ .]+/).filter(Boolean)
  if (words.length === 0) return '?'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[1][0]).toUpperCase()
}

function colorFor(seed: string): string {
  let h = 0
  for (let i = 0; i < seed.length; i++) {
    h = (h * 31 + seed.charCodeAt(i)) >>> 0
  }
  const hue = h % 360
  return `hsl(${hue}, 45%, 55%)`
}

const PluginIcon: React.FC<PluginIconProps> = ({
  name,
  displayName,
  appIcon,
  installedIconUrl,
  size = 48
}) => {
  // Prefer the server's own mount (e.g. /@signalk/freeboard-sk/assets/icons/icon-72x72.png)
  // because it's what the Webapps view uses and it always works for installed plugins.
  // Fall back to the CDN-probed URL (appIcon) when the plugin is not installed or the
  // local image failed to load.
  const candidates: string[] = []
  if (installedIconUrl) candidates.push(installedIconUrl)
  if (appIcon && appIcon !== installedIconUrl) candidates.push(appIcon)

  const [failedIndex, setFailedIndex] = useState(-1)
  const activeSrc = candidates[failedIndex + 1]

  if (activeSrc) {
    return (
      <img
        key={activeSrc}
        src={activeSrc}
        alt=""
        width={size}
        height={size}
        style={{
          width: size,
          height: size,
          objectFit: 'cover',
          borderRadius: 8,
          background: '#f0f3f5'
        }}
        onError={() => setFailedIndex(failedIndex + 1)}
      />
    )
  }

  const monogram = monogramFor(name, displayName)
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: 8,
        background: colorFor(name),
        color: '#fff',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: size * 0.4,
        fontWeight: 600,
        letterSpacing: '0.02em'
      }}
      aria-hidden="true"
    >
      {monogram}
    </div>
  )
}

export default PluginIcon
