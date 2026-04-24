import React from 'react'
import { NavLink } from 'react-router-dom'
import Badge from 'react-bootstrap/Badge'
import PluginIcon from '../components/PluginIcon'

export interface DependencyReference {
  name: string
  displayName?: string
  appIcon?: string
  installed: boolean
}

interface DependenciesSectionProps {
  title: string
  tone: 'required' | 'recommended'
  deps: DependencyReference[]
}

const DependenciesSection: React.FC<DependenciesSectionProps> = ({
  title,
  tone,
  deps
}) => {
  if (!deps || deps.length === 0) return null
  return (
    <div className="plugin-detail__deps">
      <div className="d-flex align-items-center gap-2 mb-2">
        <h6 className="mb-0">{title}</h6>
        {tone === 'required' && (
          <Badge bg="danger" className="fw-normal">
            Required
          </Badge>
        )}
        {tone === 'recommended' && (
          <Badge bg="info" className="fw-normal">
            Suggested
          </Badge>
        )}
      </div>
      <div className="d-flex flex-wrap gap-2">
        {deps.map((d) => (
          <NavLink
            key={d.name}
            to={`/apps/store/plugin/${encodeURIComponent(d.name)}`}
            className="text-decoration-none"
          >
            <div className="plugin-detail__dep-card d-flex align-items-center gap-2">
              <PluginIcon
                name={d.name}
                displayName={d.displayName}
                appIcon={d.appIcon}
                size={28}
              />
              <div className="flex-grow-1 min-w-0">
                <div className="plugin-detail__dep-name text-truncate">
                  {d.displayName || d.name}
                </div>
                {d.installed ? (
                  <small className="text-success">Installed</small>
                ) : (
                  <small className="text-muted">Not installed</small>
                )}
              </div>
            </div>
          </NavLink>
        ))}
      </div>
    </div>
  )
}

export default DependenciesSection
