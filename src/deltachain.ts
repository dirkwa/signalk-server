/* eslint-disable @typescript-eslint/no-explicit-any */

import { Delta, DeltaInputHandler } from '@signalk/server-api'

export default class DeltaChain {
  chain: any
  next: any
  constructor(private dispatchMessage: any) {
    this.chain = []
    this.next = []
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
    // pass the unmodified delta to the next handler.
    try {
      this.chain[index](msg, this.next[index])
    } catch (err) {
      console.error('Delta input handler threw, skipping it:', err)
      this.doProcess(index + 1, msg)
    }
  }

  register(handler: DeltaInputHandler) {
    this.chain.push(handler)
    this.updateNexts()
    return () => {
      const handlerIndex = this.chain.indexOf(handler)
      if (handlerIndex >= 0) {
        this.chain.splice(handlerIndex, 1)
        this.updateNexts()
      }
    }
  }

  updateNexts() {
    this.next = this.chain.map((chainElement: any, index: number) => {
      return (msg: any) => {
        this.doProcess(index + 1, msg)
      }
    })
  }
}
