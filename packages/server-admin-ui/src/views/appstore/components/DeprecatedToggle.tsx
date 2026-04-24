import React from 'react'
import Form from 'react-bootstrap/Form'

interface DeprecatedToggleProps {
  count: number
  enabled: boolean
  onChange: (next: boolean) => void
}

const DeprecatedToggle: React.FC<DeprecatedToggleProps> = ({
  count,
  enabled,
  onChange
}) => {
  if (count <= 0) return null
  return (
    <Form.Check
      type="checkbox"
      id="appstore-show-deprecated"
      className="appstore__deprecated-toggle"
      checked={enabled}
      onChange={(e) => onChange(e.target.checked)}
      label={
        <span>
          Show {count} deprecated plugin{count === 1 ? '' : 's'}{' '}
          <small className="text-muted">
            (already-installed deprecated plugins are always shown)
          </small>
        </span>
      }
    />
  )
}

export default DeprecatedToggle
