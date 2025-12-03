/**
 * MBTiles Chart Manager - Frontend JavaScript
 *
 * This webapp manages charts for this plugin only (isolated VFS).
 */

const PLUGIN_ID = 'charts-provider-go';
const API_BASE = `/plugins/${PLUGIN_ID}`;

// State - only charts managed by THIS plugin
let charts = {};

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    loadStatus();
    loadCharts();
    setupUploadForm();
});

/**
 * Load plugin status and chart list from THIS plugin only
 */
async function loadStatus() {
    const statusEl = document.getElementById('status');
    try {
        const resp = await fetch(`${API_BASE}/api/status`);
        if (!resp.ok) throw new Error('Failed to fetch status');

        const data = await resp.json();
        statusEl.innerHTML = `
            <div class="status-info">
                <strong>Plugin:</strong> ${data.running ? 'Running' : 'Stopped'}<br>
                <strong>Charts loaded:</strong> ${data.chartCount}<br>
                <strong>Directory:</strong> ${data.directory}
            </div>
        `;
    } catch (err) {
        statusEl.innerHTML = `<div class="status-error">Error loading status: ${err.message}</div>`;
    }
}

/**
 * Load charts from THIS plugin's resource_list handler only
 * (Not from global /signalk/v2/api/resources/charts which shows ALL providers)
 */
async function loadCharts() {
    const listEl = document.getElementById('chart-list');
    listEl.innerHTML = '<div class="loading">Loading charts...</div>';

    try {
        // Use plugin's own status endpoint which includes chart count
        // Or call the resource_list directly through a plugin endpoint
        const resp = await fetch(`${API_BASE}/api/charts/list`);
        if (!resp.ok) {
            // Fallback: if list endpoint doesn't exist, show empty
            charts = {};
            renderCharts();
            return;
        }

        charts = await resp.json();
        renderCharts();
    } catch (err) {
        // On error, show empty list
        charts = {};
        renderCharts();
    }
}

/**
 * Render charts list - only charts from THIS plugin
 */
function renderCharts() {
    const listEl = document.getElementById('chart-list');
    const chartIds = Object.keys(charts);

    if (chartIds.length === 0) {
        listEl.innerHTML = '<div class="no-charts">No charts uploaded yet. Upload an MBTiles file above.</div>';
        return;
    }

    listEl.innerHTML = chartIds.map(id => {
        const chart = charts[id];
        const bounds = chart.bounds ? chart.bounds.map(b => b.toFixed(2)).join(', ') : 'Unknown';
        const zoom = `${chart.minzoom || '?'} - ${chart.maxzoom || '?'}`;
        const tileUrl = chart.tilemapUrl || `${API_BASE}/tiles/${id}/{z}/{x}/{y}`;

        return `
            <div class="chart-card" data-id="${id}">
                <div class="chart-info">
                    <h3>${chart.name || id}</h3>
                    ${chart.description ? `<p>${chart.description}</p>` : ''}
                    <p><strong>Bounds:</strong> ${bounds}</p>
                    <p><strong>Zoom:</strong> ${zoom}</p>
                    <p><strong>Tile URL:</strong> <code>${tileUrl}</code></p>
                </div>
                <div class="chart-actions">
                    <button class="btn btn-danger btn-small" onclick="deleteChart('${id}')">Delete</button>
                </div>
            </div>
        `;
    }).join('');
}

/**
 * Setup upload form - simplified to just file selection
 */
function setupUploadForm() {
    const form = document.getElementById('upload-form');
    const statusEl = document.getElementById('upload-status');
    const progressContainer = document.getElementById('upload-progress');
    const progressFill = document.getElementById('progress-fill');
    const progressText = document.getElementById('progress-text');

    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        const fileInput = document.getElementById('chart-file');
        const file = fileInput.files[0];

        if (!file) {
            statusEl.innerHTML = '<div class="status-error">Please select a file</div>';
            return;
        }

        if (!file.name.endsWith('.mbtiles')) {
            statusEl.innerHTML = '<div class="status-error">Please select an .mbtiles file</div>';
            return;
        }

        // Show progress
        progressContainer.style.display = 'flex';
        progressFill.style.width = '0%';
        progressText.textContent = '0%';
        statusEl.innerHTML = '';

        try {
            // Create FormData with just the file
            const formData = new FormData();
            formData.append('chart', file);

            // Upload with progress tracking
            const xhr = new XMLHttpRequest();

            xhr.upload.addEventListener('progress', (e) => {
                if (e.lengthComputable) {
                    const percent = Math.round((e.loaded / e.total) * 100);
                    progressFill.style.width = `${percent}%`;
                    progressText.textContent = `${percent}%`;
                }
            });

            xhr.addEventListener('load', () => {
                progressContainer.style.display = 'none';

                if (xhr.status >= 200 && xhr.status < 300) {
                    statusEl.innerHTML = '<div class="status-success">Chart uploaded successfully!</div>';
                    form.reset();
                    loadCharts();
                    loadStatus();
                } else {
                    let error = 'Upload failed';
                    try {
                        const resp = JSON.parse(xhr.responseText);
                        error = resp.error || resp.message || error;
                    } catch (e) {
                        error = xhr.responseText || error;
                    }
                    statusEl.innerHTML = `<div class="status-error">Error: ${error}</div>`;
                }
            });

            xhr.addEventListener('error', () => {
                progressContainer.style.display = 'none';
                statusEl.innerHTML = '<div class="status-error">Network error during upload</div>';
            });

            xhr.open('POST', `${API_BASE}/api/charts/upload`);
            xhr.send(formData);

        } catch (err) {
            progressContainer.style.display = 'none';
            statusEl.innerHTML = `<div class="status-error">Error: ${err.message}</div>`;
        }
    });
}

/**
 * Delete a chart from THIS plugin only
 */
async function deleteChart(chartId) {
    const chartName = charts[chartId]?.name || chartId;

    if (!confirm(`Delete chart "${chartName}"?\n\nThis will remove the chart and its MBTiles file.`)) {
        return;
    }

    try {
        // Delete the file first (this always works if file exists)
        const fileResp = await fetch(`${API_BASE}/api/charts/file/${chartId}`, {
            method: 'DELETE'
        });

        if (!fileResp.ok) {
            const error = await fileResp.text();
            throw new Error(error || 'Delete failed');
        }

        // Also notify WASM plugin to remove from its registry (optional, may fail if not in memory)
        try {
            await fetch(`${API_BASE}/api/charts/${chartId}`, {
                method: 'DELETE'
            });
        } catch (e) {
            // Ignore - file is already deleted, WASM registry cleanup is optional
        }

        // Remove from local state and re-render
        delete charts[chartId];
        renderCharts();
        loadStatus();

    } catch (err) {
        alert(`Error deleting chart: ${err.message}`);
    }
}
