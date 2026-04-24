import React from 'react'
import { NavLink } from 'react-router-dom'
import Card from 'react-bootstrap/Card'
import Badge from 'react-bootstrap/Badge'
import type { AppInfo } from '../../../store/types'
import ActionCellRenderer from '../Grid/cell-renderers/ActionCellRenderer'
import PluginIcon from './PluginIcon'
import ScoreRing from './ScoreRing'

interface PluginCardProps {
  app: AppInfo
  detailLinkBase?: string
}

const PluginCard: React.FC<PluginCardProps> = ({
  app,
  detailLinkBase = '/apps/store/plugin'
}) => {
  const score =
    typeof app.indicators === 'object' && app.indicators !== null
      ? (app.indicators as { score?: number }).score
      : undefined
  const stars = (app.rawMetrics as { stars?: number } | undefined)?.stars
  const downloads = (
    app.rawMetrics as { downloadsPerWeek?: number } | undefined
  )?.downloadsPerWeek
  const isInstalled = !!app.installedVersion
  const showDeprecated = app.deprecated && isInstalled

  return (
    <Card className="plugin-card h-100">
      <Card.Body className="d-flex p-3">
        <div className="d-flex flex-grow-1 gap-3">
          <div className="flex-shrink-0">
            <NavLink
              to={`${detailLinkBase}/${encodeURIComponent(app.name)}`}
              aria-label={`View details for ${app.displayName || app.name}`}
            >
              <PluginIcon
                name={app.name}
                displayName={app.displayName}
                appIcon={app.appIcon}
                installedIconUrl={app.installedIconUrl}
                size={48}
              />
            </NavLink>
          </div>
          <div className="flex-grow-1 min-w-0">
            <div className="d-flex align-items-center gap-2 flex-wrap">
              <NavLink
                to={`${detailLinkBase}/${encodeURIComponent(app.name)}`}
                className="text-dark text-decoration-none"
              >
                <h5 className="mb-0 plugin-card__title">
                  {app.displayName || app.name}
                </h5>
              </NavLink>
              {app.official && (
                <Badge bg="primary" className="plugin-card__badge">
                  OFFICIAL
                </Badge>
              )}
              {showDeprecated && (
                <Badge bg="danger" className="plugin-card__badge">
                  DEPRECATED
                </Badge>
              )}
            </div>
            <div className="text-muted small plugin-card__author">
              {app.author}
            </div>
            <p className="mb-0 mt-2 plugin-card__description">
              {app.description}
            </p>
          </div>
        </div>
        {(typeof score === 'number' ||
          typeof stars === 'number' ||
          typeof downloads === 'number') && (
          <div className="plugin-card__stats">
            {typeof score === 'number' && <ScoreRing score={score} size={34} />}
            {typeof stars === 'number' && (
              <div className="plugin-card__metric" title="GitHub stars">
                ★{stars}
              </div>
            )}
            {typeof downloads === 'number' && (
              <div className="plugin-card__metric" title="npm downloads / week">
                ↓{formatCount(downloads)}
              </div>
            )}
          </div>
        )}
      </Card.Body>
      <Card.Footer className="d-flex align-items-center gap-2">
        <div className="flex-grow-1 d-flex flex-wrap gap-1">
          {(app.categories || []).slice(0, 2).map((cat) => (
            <Badge key={cat} bg="light" text="dark" className="fw-normal">
              {cat}
            </Badge>
          ))}
        </div>
        <div className="text-muted small font-monospace">
          v{app.installedVersion || app.version}
        </div>
        <div className="plugin-card__action">
          <ActionCellRenderer data={app} />
        </div>
      </Card.Footer>
    </Card>
  )
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}

export default PluginCard
