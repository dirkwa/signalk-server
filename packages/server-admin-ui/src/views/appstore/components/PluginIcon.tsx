import React, { useState } from 'react'

interface PluginIconProps {
  name: string
  displayName?: string
  appIcon?: string
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
  size = 48
}) => {
  const [failed, setFailed] = useState(false)
  if (appIcon && !failed) {
    return (
      <img
        src={appIcon}
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
        onError={() => setFailed(true)}
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
