import React, { Component } from 'react'
import { Button, Card, CardHeader, CardBody, Progress, Alert } from 'reactstrap'
import { connect } from 'react-redux'
import { withRouter } from 'react-router-dom'
import { fetchKeeperVersions, updateKeeperStatus } from '../../actions'
import * as keeper from '../../services/keeper'

class ServerUpdate extends Component {
  constructor(props) {
    super(props)
    this.state = {
      changelog: null,
      updating: false,
      updateProgress: null,
      updateError: null
    }

    this.handleUpdate = this.handleUpdate.bind(this)
    this.handleKeeperUpdate = this.handleKeeperUpdate.bind(this)
    this.fetchChangelog = this.fetchChangelog.bind(this)
    this.fetchChangelog()
  }

  componentDidMount() {
    // Check for Keeper updates if available
    if (this.props.keeper.available) {
      this.props.dispatch(fetchKeeperVersions())
    }
  }

  componentDidUpdate(prevProps) {
    // Fetch versions when Keeper becomes available
    if (!prevProps.keeper.available && this.props.keeper.available) {
      this.props.dispatch(fetchKeeperVersions())
    }
  }

  fetchChangelog() {
    fetch(
      `https://raw.githubusercontent.com/SignalK/signalk-server-node/master/CHANGELOG.md`
    )
      .then((response) => response.text())
      .then((data) => {
        this.setState({ changelog: data })
      })
  }

  async handleKeeperUpdate(targetTag) {
    if (!confirm(`Update to version ${targetTag}?`)) return

    this.setState({ updating: true, updateError: null })

    // Subscribe to update progress
    const unsubscribe = keeper.subscribeToUpdateStatus(
      (status) => {
        this.setState({ updateProgress: status })
        this.props.dispatch(updateKeeperStatus(status))
        if (status.state === 'complete' || status.state === 'failed') {
          unsubscribe()
          if (status.state === 'failed') {
            this.setState({
              updateError: status.error || 'Update failed',
              updating: false
            })
          }
          // On success, server will restart automatically
        }
      },
      (error) => {
        console.error('Update status error:', error)
        this.setState({
          updateError: 'Lost connection to update service',
          updating: false
        })
      }
    )

    try {
      const result = await keeper.startUpdate(targetTag, true)
      if (!result.success) {
        this.setState({
          updateError: result.error?.message || 'Failed to start update',
          updating: false
        })
        unsubscribe()
      }
    } catch (error) {
      this.setState({ updateError: error.message, updating: false })
      unsubscribe()
    }
  }

  handleUpdate() {
    console.log('handleUpdate')
    if (confirm(`Are you sure you want to update the server?'`)) {
      this.props.history.push('/appstore/updates')
      fetch(
        `${window.serverRoutesPrefix}/appstore/install/signalk-server/${this.props.appStore.serverUpdate}`,
        {
          method: 'POST',
          credentials: 'include'
        }
      ).then(() => {
        this.history.pushState(null, 'appstore/updates')
      })
    }
  }

  renderKeeperUpdate() {
    const { keeper: keeperState } = this.props
    const { updating, updateProgress, updateError } = this.state

    if (!keeperState.versions) {
      return (
        <Card>
          <CardHeader>Loading version information...</CardHeader>
          <CardBody>
            <i className="fa fa-spinner fa-spin" /> Checking for updates...
          </CardBody>
        </Card>
      )
    }

    const { currentVersion, updateAvailable, recommendedUpdate } =
      keeperState.versions

    return (
      <div>
        {updateError && (
          <Alert color="danger">
            <strong>Update Error:</strong> {updateError}
          </Alert>
        )}

        {updating && updateProgress && (
          <Card>
            <CardHeader>Update in Progress</CardHeader>
            <CardBody>
              <p>{updateProgress.statusMessage || 'Updating...'}</p>
              <Progress
                value={updateProgress.progress || 0}
                color="primary"
                animated
              />
              <small className="text-muted">
                State: {updateProgress.state || 'unknown'}
              </small>
            </CardBody>
          </Card>
        )}

        {!updating && updateAvailable && recommendedUpdate && (
          <Card className="border-info">
            <CardHeader>
              Update Available: {recommendedUpdate.tag || recommendedUpdate}
            </CardHeader>
            <CardBody>
              <p>
                Current version:{' '}
                {currentVersion?.tag || currentVersion || 'Unknown'}
                <br />
                New version: {recommendedUpdate.tag || recommendedUpdate}
              </p>
              <p>
                <a
                  href="https://github.com/SignalK/signalk-server/releases/"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Release Notes for latest releases
                </a>
              </p>
              <Button
                color="primary"
                onClick={() =>
                  this.handleKeeperUpdate(
                    recommendedUpdate.tag || recommendedUpdate
                  )
                }
              >
                <i className="fa fa-download" /> Update Now
              </Button>
            </CardBody>
          </Card>
        )}

        {!updating && !updateAvailable && (
          <Card>
            <CardHeader>Server Update</CardHeader>
            <CardBody>
              <p>Your server is up to date.</p>
              {currentVersion && (
                <p className="text-muted">
                  Current version: {currentVersion.tag || currentVersion}
                </p>
              )}
            </CardBody>
          </Card>
        )}
      </div>
    )
  }

  renderSponsoring() {
    return (
      <Card>
        <CardHeader>Sponsoring</CardHeader>
        <CardBody>
          <p>
            If you find Signal K valuable to you consider sponsoring our work on
            developing it further.
          </p>
          <p>
            Your support allows us to do things like
            <ul>
              <li>travel to meet in person and push things forward</li>
              <li>purchase equipment to develop on</li>
              <li>upgrade our cloud resources beyond the free tiers</li>
            </ul>
          </p>
          <p>
            See{' '}
            <a href="https://opencollective.com/signalk">
              Signal K in Open Collective
            </a>{' '}
            for details.
          </p>
        </CardBody>
      </Card>
    )
  }

  render() {
    const { appStore, keeper: keeperState } = this.props

    // If Keeper is available and we're in a container, show Keeper-managed updates
    if (appStore.isInDocker && keeperState.available) {
      return (
        <div className="animated fadeIn">
          {this.renderKeeperUpdate()}
          {this.renderSponsoring()}
        </div>
      )
    }

    // Original render logic for non-Keeper scenarios
    if (!appStore.storeAvailable) {
      return (
        <div className="animated fadeIn">
          <Card>
            <CardHeader>Waiting for App store data to load...</CardHeader>
          </Card>
        </div>
      )
    }
    let isInstalling = false
    let isInstalled = false
    let info = appStore.installing.find((p) => p.name === 'signalk-server')
    if (info) {
      if (info.isWaiting || info.isInstalling) {
        isInstalling = true
      } else {
        isInstalled = true
      }
    }
    return (
      <div className="animated fadeIn">
        {!appStore.canUpdateServer && (
          <Card className="border-warning">
            <CardHeader>Server Update</CardHeader>
            <CardBody>
              This installation is not updatable from the admin user interface.
            </CardBody>
          </Card>
        )}
        {appStore.isInDocker && !keeperState.available && (
          <Card className="border-warning">
            <CardHeader>Running as a Docker container</CardHeader>
            <CardBody>
              <p>
                The server is running as a Docker container. You need to pull a
                new server version from Container registry to update.
                <ul>
                  <code>docker pull cr.signalk.io/signalk/signalk-server</code>
                </ul>
              </p>
              <p>
                More info about running Signal K in Docker can be found at{' '}
                <a
                  href="https://github.com/SignalK/signalk-server/blob/master/docker/README.md"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Docker README
                </a>{' '}
                .
              </p>
            </CardBody>
          </Card>
        )}
        {appStore.canUpdateServer &&
          appStore.serverUpdate &&
          !isInstalling &&
          !isInstalled && (
            <Card>
              <CardHeader>
                Server version {appStore.serverUpdate} is available
              </CardHeader>
              <CardBody>
                <a href="https://github.com/SignalK/signalk-server/releases/">
                  Release Notes for latest releases.
                </a>
                <br />
                <br />
                <Button
                  className="btn btn-danger"
                  size="sm"
                  color="primary"
                  onClick={this.handleUpdate}
                >
                  Update
                </Button>
              </CardBody>
            </Card>
          )}
        {isInstalling && (
          <Card>
            <CardHeader>Server Update</CardHeader>
            <CardBody>The update is being installed</CardBody>
          </Card>
        )}
        {isInstalled && (
          <Card>
            <CardHeader>Server Update</CardHeader>
            <CardBody>
              The update has been installed, please restart the Signal K server.
            </CardBody>
          </Card>
        )}
        {appStore.canUpdateServer && !appStore.serverUpdate && (
          <Card>
            <CardHeader>Server Update</CardHeader>
            <CardBody>Your server is up to date.</CardBody>
          </Card>
        )}

        <Card>
          <CardHeader>Sponsoring</CardHeader>
          <CardBody>
            <p>
              If you find Signal K valuable to you consider sponsoring our work
              on developing it further.
            </p>
            <p>
              Your support allows us to do things like
              <ul>
                <li>travel to meet in person and push things forward</li>
                <li>purchase equipment to develop on</li>
                <li>upgrade our cloud resources beyond the free tiers</li>
              </ul>
            </p>
            <p>
              See{' '}
              <a href="https://opencollective.com/signalk">
                Signal K in Open Collective
              </a>{' '}
              for details.
            </p>
          </CardBody>
        </Card>
      </div>
    )
  }
}

export default connect(({ appStore, keeper }) => ({ appStore, keeper }))(
  withRouter(ServerUpdate)
)
