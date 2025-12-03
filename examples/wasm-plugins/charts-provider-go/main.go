// Charts Provider - Go WASM Plugin for Signal K
//
// This plugin demonstrates:
// - Go/TinyGo WASM development for Signal K
// - Resource provider registration (charts type)
// - HTTP endpoints for chart management
// - Delta notifications for resource changes
//
// MBTiles tile serving is handled by Node.js (hybrid pattern)
// since SQLite is not available in WASM.

package main

import (
	"encoding/json"
	"unsafe"
)

// =============================================================================
// FFI Imports - These must match what the Signal K WASM runtime provides
// =============================================================================

//go:wasmimport env sk_debug
func sk_debug(ptr *byte, len uint32)

//go:wasmimport env sk_set_status
func sk_set_status(ptr *byte, len uint32)

//go:wasmimport env sk_set_error
func sk_set_error(ptr *byte, len uint32)

//go:wasmimport env sk_handle_message
func sk_handle_message(ptr *byte, len uint32)

//go:wasmimport env sk_register_resource_provider
func sk_register_resource_provider(ptr *byte, len uint32) int32

// =============================================================================
// Helper wrappers for FFI functions
// =============================================================================

func debug(msg string) {
	if len(msg) > 0 {
		sk_debug(unsafe.StringData(msg), uint32(len(msg)))
	}
}

func setStatus(msg string) {
	if len(msg) > 0 {
		sk_set_status(unsafe.StringData(msg), uint32(len(msg)))
	}
}

func setError(msg string) {
	if len(msg) > 0 {
		sk_set_error(unsafe.StringData(msg), uint32(len(msg)))
	}
}

func handleMessage(msg string) {
	if len(msg) > 0 {
		sk_handle_message(unsafe.StringData(msg), uint32(len(msg)))
	}
}

func registerResourceProvider(resourceType string) int32 {
	if len(resourceType) > 0 {
		return sk_register_resource_provider(unsafe.StringData(resourceType), uint32(len(resourceType)))
	}
	return 0
}

// =============================================================================
// Data Types
// =============================================================================

// ChartMetadata represents a single chart's metadata
type ChartMetadata struct {
	Identifier  string    `json:"identifier"`
	Name        string    `json:"name"`
	Description string    `json:"description,omitempty"`
	TilemapUrl  string    `json:"tilemapUrl"`
	Bounds      []float64 `json:"bounds,omitempty"`
	MinZoom     int       `json:"minzoom,omitempty"`
	MaxZoom     int       `json:"maxzoom,omitempty"`
	Format      string    `json:"format"`
	Type        string    `json:"type"`
}

// PluginConfig holds plugin configuration
type PluginConfig struct {
	ChartsDirectory string `json:"chartsDirectory"`
}

// =============================================================================
// Plugin State
// =============================================================================

var (
	charts    = make(map[string]ChartMetadata)
	config    PluginConfig
	isRunning bool
)

const (
	PLUGIN_ID   = "charts-provider-go"
	PLUGIN_NAME = "Charts Provider (Go)"
)

// =============================================================================
// Memory Allocation - Required for buffer-based string passing
// =============================================================================

//export allocate
func allocate(size uint32) *byte {
	buf := make([]byte, size)
	return &buf[0]
}

//export deallocate
func deallocate(ptr *byte, size uint32) {
	// In TinyGo with leaking GC, we don't need to explicitly free
	// The memory will be reclaimed when the module is unloaded
}

// =============================================================================
// Plugin Core Exports
// =============================================================================

//export plugin_id
func plugin_id(outPtr *byte, maxLen uint32) int32 {
	return writeString(PLUGIN_ID, outPtr, maxLen)
}

//export plugin_name
func plugin_name(outPtr *byte, maxLen uint32) int32 {
	return writeString(PLUGIN_NAME, outPtr, maxLen)
}

//export plugin_schema
func plugin_schema(outPtr *byte, maxLen uint32) int32 {
	schema := `{
	"type": "object",
	"title": "Charts Provider Configuration",
	"properties": {
		"chartsDirectory": {
			"type": "string",
			"title": "Charts Directory",
			"description": "Directory where MBTiles files are stored (relative to VFS)",
			"default": "charts"
		}
	}
}`
	return writeString(schema, outPtr, maxLen)
}

//export plugin_start
func plugin_start(configPtr *byte, configLen uint32) int32 {
	// Parse configuration
	configJson := readString(configPtr, configLen)
	debug("Charts Provider starting with config: " + configJson)

	if len(configJson) > 0 {
		if err := json.Unmarshal([]byte(configJson), &config); err != nil {
			setError("Failed to parse config: " + err.Error())
			return 1
		}
	}

	// Set default charts directory
	if config.ChartsDirectory == "" {
		config.ChartsDirectory = "charts"
	}

	// Register as charts resource provider
	result := registerResourceProvider("charts")
	if result != 1 {
		setError("Failed to register as charts resource provider")
		return 1
	}

	isRunning = true
	debug("Registered as charts resource provider")
	setStatus("Charts provider active")

	return 0
}

//export plugin_stop
func plugin_stop() int32 {
	isRunning = false
	debug("Charts Provider stopped")
	setStatus("Stopped")
	return 0
}

// =============================================================================
// HTTP Endpoints
// =============================================================================

//export http_endpoints
func http_endpoints(outPtr *byte, maxLen uint32) int32 {
	// Note: Upload and tile serving are handled by Node.js hybrid handlers
	// These endpoints handle metadata operations
	endpoints := `[
	{"method":"GET","path":"/api/status","handler":"http_get_status"},
	{"method":"POST","path":"/api/charts/register","handler":"http_post_register"},
	{"method":"DELETE","path":"/api/charts/:id","handler":"http_delete_chart"}
]`
	return writeString(endpoints, outPtr, maxLen)
}

//export http_get_status
func http_get_status(reqPtr *byte, reqLen uint32, respPtr *byte, respMaxLen uint32) int32 {
	debug("HTTP GET /api/status")

	chartCount := len(charts)
	status := map[string]interface{}{
		"running":    isRunning,
		"chartCount": chartCount,
		"directory":  config.ChartsDirectory,
	}

	statusJson, _ := json.Marshal(status)
	response := `{"statusCode":200,"headers":{"Content-Type":"application/json"},"body":"` + escapeJson(string(statusJson)) + `"}`

	return writeString(response, respPtr, respMaxLen)
}

//export http_post_register
func http_post_register(reqPtr *byte, reqLen uint32, respPtr *byte, respMaxLen uint32) int32 {
	debug("HTTP POST /api/charts/register")

	// Parse request
	reqJson := readString(reqPtr, reqLen)

	type RequestContext struct {
		Body *ChartMetadata `json:"body"`
	}

	var req RequestContext
	if err := json.Unmarshal([]byte(reqJson), &req); err != nil {
		response := `{"statusCode":400,"headers":{"Content-Type":"application/json"},"body":"{\"error\":\"Invalid request format\"}"}`
		return writeString(response, respPtr, respMaxLen)
	}

	if req.Body == nil || req.Body.Identifier == "" {
		response := `{"statusCode":400,"headers":{"Content-Type":"application/json"},"body":"{\"error\":\"Missing chart identifier\"}"}`
		return writeString(response, respPtr, respMaxLen)
	}

	chart := *req.Body

	// Set defaults
	if chart.Format == "" {
		chart.Format = "mbtiles"
	}
	if chart.Type == "" {
		chart.Type = "baselayer"
	}
	if chart.TilemapUrl == "" {
		chart.TilemapUrl = "/plugins/" + PLUGIN_ID + "/tiles/" + chart.Identifier + "/{z}/{x}/{y}"
	}

	// Store chart metadata
	charts[chart.Identifier] = chart

	// Emit delta notification for new chart
	emitChartDelta(chart.Identifier, &chart)

	debug("Registered chart: " + chart.Identifier)
	setStatus("Charts: " + string(rune(len(charts))))

	chartJson, _ := json.Marshal(chart)
	response := `{"statusCode":200,"headers":{"Content-Type":"application/json"},"body":"` + escapeJson(string(chartJson)) + `"}`

	return writeString(response, respPtr, respMaxLen)
}

//export http_delete_chart
func http_delete_chart(reqPtr *byte, reqLen uint32, respPtr *byte, respMaxLen uint32) int32 {
	debug("HTTP DELETE /api/charts/:id")

	// Parse request to get chart ID from params
	reqJson := readString(reqPtr, reqLen)

	type RequestContext struct {
		Params map[string]string `json:"params"`
	}

	var req RequestContext
	if err := json.Unmarshal([]byte(reqJson), &req); err != nil {
		response := `{"statusCode":400,"headers":{"Content-Type":"application/json"},"body":"{\"error\":\"Invalid request\"}"}`
		return writeString(response, respPtr, respMaxLen)
	}

	chartId := req.Params["id"]
	if chartId == "" {
		response := `{"statusCode":400,"headers":{"Content-Type":"application/json"},"body":"{\"error\":\"Missing chart ID\"}"}`
		return writeString(response, respPtr, respMaxLen)
	}

	if _, exists := charts[chartId]; !exists {
		response := `{"statusCode":404,"headers":{"Content-Type":"application/json"},"body":"{\"error\":\"Chart not found\"}"}`
		return writeString(response, respPtr, respMaxLen)
	}

	// Remove chart
	delete(charts, chartId)

	// Emit delta notification for deletion (null value)
	emitChartDelta(chartId, nil)

	debug("Deleted chart: " + chartId)

	response := `{"statusCode":200,"headers":{"Content-Type":"application/json"},"body":"{\"success\":true,\"deleted\":\"` + chartId + `\"}"}`
	return writeString(response, respPtr, respMaxLen)
}

// =============================================================================
// Resource Provider Handlers
// =============================================================================

//export resource_list
func resource_list(reqPtr *byte, reqLen uint32, respPtr *byte, respMaxLen uint32) int32 {
	debug("resource_list called")

	// Return all charts as a map
	result, err := json.Marshal(charts)
	if err != nil {
		return writeString("{}", respPtr, respMaxLen)
	}

	return writeString(string(result), respPtr, respMaxLen)
}

//export resource_get
func resource_get(reqPtr *byte, reqLen uint32, respPtr *byte, respMaxLen uint32) int32 {
	// Parse request: {"id": "chart-id", "property": null}
	reqJson := readString(reqPtr, reqLen)
	debug("resource_get: " + reqJson)

	type GetRequest struct {
		Id       string  `json:"id"`
		Property *string `json:"property"`
	}

	var req GetRequest
	if err := json.Unmarshal([]byte(reqJson), &req); err != nil {
		return writeString(`{"error":"Invalid request"}`, respPtr, respMaxLen)
	}

	chart, exists := charts[req.Id]
	if !exists {
		return writeString(`{"error":"Chart not found"}`, respPtr, respMaxLen)
	}

	result, _ := json.Marshal(chart)
	return writeString(string(result), respPtr, respMaxLen)
}

//export resource_set
func resource_set(reqPtr *byte, reqLen uint32, respPtr *byte, respMaxLen uint32) int32 {
	// Parse request: {"id": "chart-id", "value": {...}}
	reqJson := readString(reqPtr, reqLen)
	debug("resource_set: " + reqJson)

	type SetRequest struct {
		Id    string        `json:"id"`
		Value ChartMetadata `json:"value"`
	}

	var req SetRequest
	if err := json.Unmarshal([]byte(reqJson), &req); err != nil {
		return writeString(`{"error":"Invalid request"}`, respPtr, respMaxLen)
	}

	// Update chart
	req.Value.Identifier = req.Id
	charts[req.Id] = req.Value

	// Emit delta
	emitChartDelta(req.Id, &req.Value)

	return writeString(`{"success":true}`, respPtr, respMaxLen)
}

//export resource_delete
func resource_delete(reqPtr *byte, reqLen uint32, respPtr *byte, respMaxLen uint32) int32 {
	// Parse request: {"id": "chart-id"}
	reqJson := readString(reqPtr, reqLen)
	debug("resource_delete: " + reqJson)

	type DeleteRequest struct {
		Id string `json:"id"`
	}

	var req DeleteRequest
	if err := json.Unmarshal([]byte(reqJson), &req); err != nil {
		return writeString(`{"error":"Invalid request"}`, respPtr, respMaxLen)
	}

	if _, exists := charts[req.Id]; !exists {
		return writeString(`{"error":"Chart not found"}`, respPtr, respMaxLen)
	}

	delete(charts, req.Id)

	// Emit delta for deletion
	emitChartDelta(req.Id, nil)

	return writeString(`{"success":true}`, respPtr, respMaxLen)
}

// =============================================================================
// Delta Notifications
// =============================================================================

func emitChartDelta(chartId string, chartData *ChartMetadata) {
	var value string
	if chartData == nil {
		value = "null"
	} else {
		valueBytes, _ := json.Marshal(chartData)
		value = string(valueBytes)
	}

	// Format per resource_provider_plugins.md
	// Use Signal K v2 format (resources not in full model cache)
	delta := `{"updates":[{"values":[{"path":"resources.charts.` + chartId + `","value":` + value + `}]}]}`

	handleMessage(delta)
	debug("Emitted chart delta for: " + chartId)
}

// =============================================================================
// Helper Functions
// =============================================================================

func writeString(s string, ptr *byte, maxLen uint32) int32 {
	if len(s) == 0 {
		return 0
	}

	bytes := []byte(s)
	length := len(bytes)
	if uint32(length) > maxLen {
		length = int(maxLen)
	}

	// Copy bytes to output buffer
	dst := unsafe.Slice(ptr, length)
	copy(dst, bytes[:length])

	return int32(length)
}

func readString(ptr *byte, len uint32) string {
	if ptr == nil || len == 0 {
		return ""
	}
	return string(unsafe.Slice(ptr, len))
}

func escapeJson(s string) string {
	// Simple JSON string escaping for embedding in response
	result := ""
	for _, c := range s {
		switch c {
		case '"':
			result += `\"`
		case '\\':
			result += `\\`
		case '\n':
			result += `\n`
		case '\r':
			result += `\r`
		case '\t':
			result += `\t`
		default:
			result += string(c)
		}
	}
	return result
}

// Required for TinyGo WASM
func main() {}
