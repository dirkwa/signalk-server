/** Exported memory */
export declare const memory: WebAssembly.Memory;
/**
 * assembly/index/plugin_id
 * @returns `~lib/string/String`
 */
export declare function plugin_id(): string;
/**
 * assembly/index/plugin_name
 * @returns `~lib/string/String`
 */
export declare function plugin_name(): string;
/**
 * assembly/index/plugin_schema
 * @returns `~lib/string/String`
 */
export declare function plugin_schema(): string;
/**
 * assembly/index/plugin_start
 * @param configPtr `usize`
 * @param configLen `usize`
 * @returns `i32`
 */
export declare function plugin_start(configPtr: number, configLen: number): number;
/**
 * assembly/index/plugin_stop
 * @returns `i32`
 */
export declare function plugin_stop(): number;
