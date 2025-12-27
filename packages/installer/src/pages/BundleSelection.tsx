import {
  Card,
  CardBody,
  Row,
  Col,
  FormGroup,
  Label,
  Input,
  Badge
} from 'reactstrap'
import type { InstallerConfig } from '../App'
import bundlesData from '../bundles.json'

interface BundleSelectionProps {
  config: InstallerConfig
  updateConfig: (updates: Partial<InstallerConfig>) => void
}

interface Bundle {
  name: string
  description: string
  icon: string
  plugins: string[]
  optionalDependencies?: string[]
}

interface BundlesData {
  common: {
    description: string
    plugins: string[]
  }
  bundles: Record<string, Bundle>
}

const iconMap: Record<string, string> = {
  box: '📦',
  plug: '🔌',
  serial: '🔗',
  map: '🗺️',
  gauge: '📊',
  mobile: '📱',
  bluetooth: '📶',
  battery: '🔋',
  cloud: '☁️',
  flag: '🏁',
  radar: '📡',
  database: '💾',
  workflow: '⚙️'
}

function BundleSelection({ config, updateConfig }: BundleSelectionProps) {
  const data = bundlesData as BundlesData
  const bundles = data.bundles

  const toggleBundle = (bundleId: string) => {
    const current = config.selectedBundles || []

    if (bundleId === 'minimal') {
      // Minimal is exclusive - selecting it deselects all others
      if (current.includes('minimal')) {
        updateConfig({ selectedBundles: [] })
      } else {
        updateConfig({ selectedBundles: ['minimal'] })
      }
    } else {
      // Selecting any other bundle deselects minimal
      let newSelection: string[]
      if (current.includes(bundleId)) {
        newSelection = current.filter((id) => id !== bundleId)
      } else {
        newSelection = [...current.filter((id) => id !== 'minimal'), bundleId]
      }
      updateConfig({ selectedBundles: newSelection })
    }
  }

  const isSelected = (bundleId: string) => {
    return (config.selectedBundles || []).includes(bundleId)
  }

  const getTotalPlugins = () => {
    const selected = config.selectedBundles || []
    if (selected.includes('minimal') || selected.length === 0) {
      return 0
    }

    const plugins = new Set<string>()
    // Add common plugins
    data.common.plugins.forEach((p) => plugins.add(p))
    // Add plugins from selected bundles
    selected.forEach((bundleId) => {
      const bundle = bundles[bundleId]
      if (bundle) {
        bundle.plugins.forEach((p) => plugins.add(p))
      }
    })
    return plugins.size
  }

  return (
    <div>
      <h2 className="mb-4">Plugin Bundles</h2>
      <p className="text-muted mb-4">
        Select the features you want to install. You can add more plugins later
        through the AppStore in the admin interface.
      </p>

      <Row>
        {Object.entries(bundles).map(([id, bundle]) => (
          <Col md={6} lg={4} key={id}>
            <Card
              className={`mb-3 ${isSelected(id) ? 'border-primary' : ''}`}
              style={{ cursor: 'pointer' }}
              onClick={() => toggleBundle(id)}
            >
              <CardBody>
                <FormGroup check className="mb-2">
                  <Input
                    type="checkbox"
                    checked={isSelected(id)}
                    onChange={() => toggleBundle(id)}
                    onClick={(e) => e.stopPropagation()}
                  />
                  <Label check className="ms-2">
                    <span className="me-2">{iconMap[bundle.icon] || '📦'}</span>
                    <strong>{bundle.name}</strong>
                  </Label>
                </FormGroup>
                <small className="text-muted d-block mb-2">
                  {bundle.description}
                </small>
                {bundle.plugins.length > 0 && (
                  <Badge color="secondary">
                    {bundle.plugins.length} plugins
                  </Badge>
                )}
              </CardBody>
            </Card>
          </Col>
        ))}
      </Row>

      <div className="mt-3 p-3 bg-light rounded">
        <strong>Selected:</strong>{' '}
        {(config.selectedBundles || []).length === 0 ? (
          <span className="text-muted">
            None selected (will install minimal)
          </span>
        ) : (
          <>
            {(config.selectedBundles || [])
              .map((id) => bundles[id]?.name)
              .join(', ')}
            {!isSelected('minimal') && (
              <span className="ms-2 text-muted">
                ({getTotalPlugins()} plugins total)
              </span>
            )}
          </>
        )}
      </div>
    </div>
  )
}

export default BundleSelection
