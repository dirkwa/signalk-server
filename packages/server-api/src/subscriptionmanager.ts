import { RelativePositionOrigin } from '.'
import { Context, Delta, Path } from './deltas'

/** @category Server API  */
export interface SubscriptionManager {
  subscribe(
    command: SubscribeMessage,
    unsubscribes: Unsubscribes,
    errorCallback: (err: unknown) => void,
    callback: SubscribeCallback,
    user?: string
  ): void

  unsubscribe(msg: UnsubscribeMessage, unsubscribes: Unsubscribes): void
}

/** @category Server API  */
export type SubscribeCallback = (delta: Delta) => void

/** @category Server API  */
export type Unsubscribes = Array<() => void>

/**
 * A message to allow a client to subscribe for data updates from a signalk server
 *
 * @see [SignalK Specification: Subscription Protocol](https://signalk.org/specification/1.7.0/doc/subscription_protocol.html?highlight=subscribe#introduction)
 * @category Server API
 */
export interface SubscribeMessage {
  /**
   * The context path for all subsequent paths, usually a vessel's path.
   */
  context: Context | RelativePositionOrigin

  /**
   * An array of paths to subscribe to, with optional criteria
   */
  subscribe: SubscriptionOptions[]
}

/** @inline
 */
type FixedPolicyOptions = {
  /**
   * - `fixed` - Send the last known values every `period`.
   * - `inline` - Send all changes as fast as they are received, but no faster than `minPeriod`. With this policy the client has an immediate copy of the current state of the server.
   */
  policy?: 'fixed'

  /**
   * The subscription will be sent every period millisecs.
   */
  period?: number

  /**
   * If policy=immediate or ideal, consecutive messages will be buffered until minPeriod has expired so the receiver is not swamped.
   */
  minPeriod?: never
}

/** @inline docs inherited from above
 */
type InstantPolicyOptions = {
  policy?: 'instant'
  minPeriod?: number
  period?: never
}

/**
 * Viewport options for paginated subscriptions.
 * When specified, only paths within the viewport range will be sent to the client.
 * This is useful for UI virtualization where only visible rows need data updates.
 * @category Server API
 */
export interface ViewportOptions {
  /**
   * The starting index of paths to include (0-based)
   */
  start: number

  /**
   * The number of paths to include from the start index
   */
  count: number

  /**
   * Sort order for paths. Defaults to 'path' (alphabetical by path name)
   */
  sort?: 'path' | 'timestamp' | 'source'
}

/**
 * Message to update viewport without full resubscribe.
 * Sent by client when user scrolls to a new position.
 * @category Server API
 */
export interface ViewportUpdateMessage {
  /**
   * The context this viewport update applies to
   */
  context: Context

  /**
   * The new viewport range
   */
  viewport: ViewportOptions
}

/**
 * Viewport metadata included in delta responses when viewport subscriptions are active
 * @category Server API
 */
export interface ViewportMetadata {
  /**
   * Total number of paths matching the subscription (before viewport filtering)
   */
  pathCount: number

  /**
   * Current viewport start index
   */
  start: number

  /**
   * Current viewport count
   */
  count: number
}

/**
 * A path object with optional criteria to control output
 * @inline
 * @category Server API
 */
export type SubscriptionOptions = (
  | FixedPolicyOptions
  | InstantPolicyOptions
) & {
  /**
   * The path to subscribe to.
   */
  path?: Path

  /**
   * The signal K format to use for the message. Only `delta` is currently supported. See [Signal K Data Model](https://signalk.org/specification/1.7.0/doc/data_model.html)
   */
  format?: 'delta'

  /**
   * Optional viewport for paginated subscriptions. When specified, only paths
   * within the viewport range will be sent to the client. The server will also
   * include viewport metadata (pathCount) in responses.
   */
  viewport?: ViewportOptions
}

/**
 * A message to allow a client to unsubscribe from data updates from a signalk server
 * @category Server API
 */
export interface UnsubscribeMessage {
  /**
   * The root path for all subsequent paths, usually a vessel's path.
   *
   * > [!NOTE]
   * > Currently only `*` is supported for the context.
   */
  context: '*'

  /**
   * An array of paths to unsubscribe from.

  * > [!NOTE]
   * > Currently only one entry is supported, and it must have `"path": "*"`.
   */
  unsubscribe: [
    {
      path: '*'
    }
  ]
}
