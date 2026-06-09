/* eslint-disable @typescript-eslint/no-explicit-any */

import { Delta, DeltaInputHandler } from '@signalk/server-api'

export default class DeltaChain {
  chain: any
  constructor(private dispatchMessage: any) {
    this.chain = []
  }

  process(msg: Delta) {
    return this.doProcess(0, msg)
  }

  doProcess(index: number, msg: any) {
    if (index >= this.chain.length) {
      this.dispatchMessage(msg)
      return
    }
    // Isolate handlers: a plugin's delta input handler that throws must not
    // abort the chain, or the delta (and any later handler's work, including
    // metadata registration) is silently dropped for every input. Log and
    // pass the unmodified delta to the next handler. `continued` guards
    // against advancing twice when a handler calls next() and then throws.
    let continued = false
    const next = (nextMsg: Delta) => {
      if (continued) {
        return
      }
      continued = true
      this.doProcess(index + 1, nextMsg)
    }
    try {
      this.chain[index](msg, next)
    } catch (err) {
      console.error('Delta input handler threw, skipping it:', err)
      next(msg)
    }
  }

  register(handler: DeltaInputHandler) {
    this.chain.push(handler)
    return () => {
      const handlerIndex = this.chain.indexOf(handler)
      if (handlerIndex >= 0) {
        this.chain.splice(handlerIndex, 1)
      }
    }
  }
}
