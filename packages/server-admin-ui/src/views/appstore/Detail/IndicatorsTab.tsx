import React from 'react'
import Alert from 'react-bootstrap/Alert'
import Badge from 'react-bootstrap/Badge'
import ScoreRing from '../components/ScoreRing'

interface Check {
  id: string
  status: 'ok' | 'warn' | 'fail'
  title: string
  subtitle: string
}

interface RawMetrics {
  stars?: number
  downloadsPerWeek?: number
  openIssues?: number
  contributors?: number
  lastReleaseDate?: string
}

export interface IndicatorResult {
  score: number
  checks: Check[]
  reportedPlatforms: string[]
  rawMetrics: RawMetrics
}

interface IndicatorsTabProps {
  indicators?: IndicatorResult
}

const statusToVariant: Record<Check['status'], string> = {
  ok: 'success',
  warn: 'warning',
  fail: 'danger'
}

const IndicatorsTab: React.FC<IndicatorsTabProps> = ({ indicators }) => {
  if (!indicators) {
    return (
      <Alert variant="warning" className="mb-0">
        Indicators are not available for this plugin.
      </Alert>
    )
  }
  const { score, checks, reportedPlatforms, rawMetrics } = indicators

  return (
    <div className="plugin-detail__indicators">
      <Alert variant="warning">
        <strong>These indicators are heuristic, not definitive.</strong>{' '}
        They&apos;re intended as feedback for plugin authors and context for
        users — not as a judgment of a plugin&apos;s usefulness. A low score
        doesn&apos;t mean a plugin is bad, and a high score doesn&apos;t mean it
        fits your setup.
      </Alert>

      <div className="d-flex align-items-center gap-3 mb-4">
        <ScoreRing score={score} size={64} />
        <div>
          <div className="h4 mb-0">{score} / 100</div>
          <div className="text-muted">
            Composite score from the{' '}
            <a
              href="https://dirkwa.github.io/signalk-plugin-registry/"
              target="_blank"
              rel="noreferrer"
            >
              Signal K Plugin Registry
            </a>
          </div>
        </div>
      </div>

      <h5>Automated checks</h5>
      <ul className="list-unstyled plugin-detail__checks">
        {checks.map((c) => (
          <li key={c.id} className="d-flex align-items-start gap-2 py-2">
            <Badge bg={statusToVariant[c.status]} className="mt-1">
              {c.status.toUpperCase()}
            </Badge>
            <div>
              <div className="fw-semibold">{c.title}</div>
              <div className="text-muted small">{c.subtitle}</div>
            </div>
          </li>
        ))}
      </ul>

      <h5 className="mt-4">Reported working on</h5>
      <p className="text-muted small">
        Community-submitted reports.{' '}
        <strong>
          Absence of a platform does not mean it&apos;s incompatible
        </strong>{' '}
        — Signal K runs on many more platforms than can be tested or listed.
        This is just &quot;who&apos;s reported it works&quot;.
      </p>
      {reportedPlatforms.length === 0 ? (
        <div className="text-muted">No platform reports submitted yet.</div>
      ) : (
        <div className="d-flex flex-wrap gap-2">
          {reportedPlatforms.map((p) => (
            <Badge key={p} bg="light" text="dark" className="fw-normal">
              {p}
            </Badge>
          ))}
        </div>
      )}

      <h5 className="mt-4">Raw metrics</h5>
      <dl className="row">
        <dt className="col-sm-4">GitHub stars</dt>
        <dd className="col-sm-8">{rawMetrics.stars ?? '—'}</dd>
        <dt className="col-sm-4">npm downloads / week</dt>
        <dd className="col-sm-8">{rawMetrics.downloadsPerWeek ?? '—'}</dd>
        <dt className="col-sm-4">Open issues</dt>
        <dd className="col-sm-8">{rawMetrics.openIssues ?? '—'}</dd>
        <dt className="col-sm-4">Contributors</dt>
        <dd className="col-sm-8">{rawMetrics.contributors ?? '—'}</dd>
        <dt className="col-sm-4">Last release</dt>
        <dd className="col-sm-8">
          {rawMetrics.lastReleaseDate
            ? rawMetrics.lastReleaseDate.substring(0, 10)
            : '—'}
        </dd>
      </dl>
      <p className="text-muted small mt-3 mb-0">
        Metrics are informational only — popularity ≠ quality ≠ fit for your
        setup.
      </p>
    </div>
  )
}

export default IndicatorsTab
