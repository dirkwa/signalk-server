import { expect } from 'chai'
import { freeport } from './ts-servertestutilities'
import { startServerP, getAdminToken } from './servertestutilities'

/**
 * The admin UI's restart exits the process and relies on the supervisor to
 * start it again. It must stop the server first, as a SIGTERM does, so that
 * plugins and providers get to close. process.exit is replaced for the
 * duration so the exit can be observed without ending the test run.
 */
describe('admin restart', function () {
  it('stops the server before the process exits', async function () {
    const port = await freeport()
    const server = await startServerP(port, true)

    const originalExit = process.exit
    const exited = new Promise<{ code: unknown; started: boolean }>(
      (resolve) => {
        process.exit = ((code?: number) => {
          resolve({ code, started: server.app.started })
        }) as typeof process.exit
      }
    )
    try {
      const token = await getAdminToken(server)
      const res = await fetch(`http://0.0.0.0:${port}/skServer/restart`, {
        method: 'PUT',
        headers: { Cookie: `JAUTHENTICATION=${token}` }
      })
      expect(res.status).to.equal(200)

      const { code, started } = await exited
      expect(started, 'server must be stopped before exit').to.equal(false)
      expect(code).to.equal(0)
    } finally {
      process.exit = originalExit
      await server.stop()
    }
  })
})
