import React from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

interface ChangelogTabProps {
  changelog: string
  changelogFormat: 'markdown' | 'synthesized'
  version: string
}

function decorateChangelog(src: string): string {
  return src
    .split(/\r?\n/)
    .map((line) => {
      const m = line.match(/^([-*]\s+)(feat|fix|BREAKING|!)([:(].*)?/)
      if (!m) return line
      const tone =
        m[2].toLowerCase() === 'feat'
          ? 'plugin-detail__changelog-feat'
          : m[2].toLowerCase() === 'fix'
            ? 'plugin-detail__changelog-fix'
            : 'plugin-detail__changelog-breaking'
      return `${m[1]}<span class="${tone}">${m[2]}</span>${m[3] || ''}`
    })
    .join('\n')
}

const ChangelogTab: React.FC<ChangelogTabProps> = ({
  changelog,
  changelogFormat,
  version
}) => {
  if (!changelog || changelog.trim().length === 0) {
    return (
      <div className="text-muted">
        <p className="mb-1">No changelog available.</p>
        <p className="small mb-0">
          Current version: <strong>v{version}</strong>
        </p>
      </div>
    )
  }

  if (changelogFormat === 'synthesized') {
    return (
      <div>
        <div className="text-muted small mb-3">
          The plugin doesn&apos;t ship a CHANGELOG.md, so only version numbers
          are available.
        </div>
        <pre>{changelog}</pre>
      </div>
    )
  }

  const decorated = decorateChangelog(changelog)
  return (
    <div className="plugin-detail__markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{decorated}</ReactMarkdown>
    </div>
  )
}

export default ChangelogTab
