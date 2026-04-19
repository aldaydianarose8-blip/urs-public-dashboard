// Public Dashboard Logic - No Authentication Required
// If you host this frontend on a separate service from the backend, 
// change this to your absolute backend URL (e.g., 'https://your-api.onrender.com/api')
const API_BASE_URL = window.location.origin.includes('localhost') ? 'http://localhost:3000/api' : '/api';

// ==================== CONFIGURATION & CONSTANTS ====================
const CHART_COLORS = [
    '#2980B9', // Blue
    '#10B981', // Green
    '#F59E0B', // Amber
    '#6366F1', // Indigo
    '#EC4899', // Pink
    '#8B5CF6', // Violet
    '#EF4444', // Red
    '#14B8A6'  // Teal
];

const MIN_DB = 20;
const MAX_DB = 120;
const DB_RANGE = MAX_DB - MIN_DB;
const hoursLabels = ['7\nAM', '8\nAM', '9\nAM', '10\nAM', '11\nAM', '12\nPM',
    '1\nPM', '2\nPM', '3\nPM', '4\nPM', '5\nPM', '6\nPM'];

let _frontendThresholds = { low: 50, moderate: 70, high: 100 };
let chartPoints = []; // Stores point data for tooltips

document.addEventListener('DOMContentLoaded', () => {
    initDashboard();
    setInterval(updateDateTime, 1000);
    setInterval(refreshData, 30000); // Refresh every 30 seconds

    // Add resize listener to re-draw chart
    window.addEventListener('resize', refreshData);
});

function updateDateTime() {
    const now = new Date();
    document.getElementById('currentDate').textContent = now.toLocaleDateString('en-US', {
        weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
    });
    document.getElementById('currentTime').textContent = now.toLocaleTimeString('en-US', {
        hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
}

async function initDashboard() {
    try {
        // First try to load thresholds
        const res = await fetch(`${API_BASE_URL}/settings/system?key=severity_thresholds`);
        const data = await res.json();
        if (res.ok && data.value) {
            _frontendThresholds = {
                low: data.value.low ?? 50,
                moderate: data.value.moderate ?? 70,
                high: data.value.high ?? 100
            };
        }
    } catch (err) {
        console.warn('Using default thresholds', err);
    }

    try {
        updateSeverityLabels(); // Apply thresholds to chart zones
        updateDateTime();
        await refreshData();
    } catch (err) {
        console.error('Initialization error:', err);
    }
}

function updateSeverityLabels() {
    const { low, moderate, high } = _frontendThresholds;
    const severeLabel = document.querySelector('.severity-severe');
    const highLabel = document.querySelector('.severity-high');
    const modLabel = document.querySelector('.severity-moderate');
    const lowLabel = document.querySelector('.severity-low');

    if (!severeLabel || !highLabel || !modLabel || !lowLabel) return;

    // dB range is 20 to 120 (DB_RANGE = 100)
    // Percentage from top: (MAX_DB - db) / DB_RANGE * 100%

    // Severe: high to 120
    severeLabel.style.top = '0%';
    severeLabel.style.height = `${(MAX_DB - high) / DB_RANGE * 100}%`;

    // High: moderate to high
    highLabel.style.top = `${(MAX_DB - high) / DB_RANGE * 100}%`;
    highLabel.style.height = `${(high - moderate) / DB_RANGE * 100}%`;

    // Moderate: low to moderate
    modLabel.style.top = `${(MAX_DB - moderate) / DB_RANGE * 100}%`;
    modLabel.style.height = `${(moderate - low) / DB_RANGE * 100}%`;

    // Low: 20 to low
    lowLabel.style.top = `${(MAX_DB - low) / DB_RANGE * 100}%`;
    lowLabel.style.height = `${(low - MIN_DB) / DB_RANGE * 100}%`;
}

function formatLocalTimestamp(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

async function refreshData() {
    try {
        const today = new Date();
        const start = formatLocalTimestamp(new Date(today.getFullYear(), today.getMonth(), today.getDate(), 0, 0, 0));
        const end = formatLocalTimestamp(new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999));

        console.log('Refreshing dashboard data:', { start, end });

        // Refresh thresholds periodically from settings
        try {
            const resSettings = await fetch(`${API_BASE_URL}/settings/system?key=severity_thresholds`);
            const setts = await resSettings.json();
            if (resSettings.ok && setts.value) {
                _frontendThresholds = {
                    low: setts.value.low ?? 50,
                    moderate: setts.value.moderate ?? 70,
                    high: setts.value.high ?? 100
                };
                updateSeverityLabels();
            }
        } catch (sErr) {
            console.warn('Could not refresh thresholds:', sErr);
        }

        await Promise.all([
            fetchCurrentNoise(start, end),
            fetchStats(start, end),
            fetchChartData(start, end)
        ]);

        // Re-load full sensor grid
        await loadAllSensorData();

        // Update last updated indicator
        const lastUpdatedEl = document.getElementById('lastUpdated');
        if (lastUpdatedEl) {
            const now = new Date();
            lastUpdatedEl.textContent = `Last updated: ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
        }
    } catch (err) {
        console.error('Error refreshing dashboard:', err);
    }
}

async function fetchCurrentNoise(start, end) {
    try {
        const response = await fetch(`${API_BASE_URL}/noise/current?start=${start}&end=${end}`);
        const data = await response.json();
        renderCurrentNoise(data.locations || []);
    } catch (err) {
        console.error('Error in fetchCurrentNoise:', err);
    }
}

async function fetchStats(start, end) {
    try {
        const response = await fetch(`${API_BASE_URL}/noise/stats?start=${start}&end=${end}`);
        const data = await response.json();

        const peakEl = document.getElementById('noise-peak');
        if (peakEl) {
            peakEl.textContent = data.noisePeak ? `${data.noisePeak.value} dB` : '-- dB';
        }

        const sourceEl = document.getElementById('noise-source');
        if (sourceEl) {
            sourceEl.textContent = data.mostCommonSource || '--';
        }

        renderLocationStats(data.locationStats || []);
    } catch (err) {
        console.error('Error in fetchStats:', err);
    }
}

async function fetchChartData(start, end) {
    try {
        const response = await fetch(`${API_BASE_URL}/noise/chart?start=${start}&end=${end}`);
        const data = await response.json();
        if (data && data.locationData) {
            drawChart(data.locationData, data.combinedAvg);
        }
    } catch (err) {
        console.error('Error in fetchChartData:', err);
    }
}

// ==================== RENDERING FUNCTIONS ====================

function getNoiseCategory(db) {
    if (db <= _frontendThresholds.low) return 'LOW';
    if (db <= _frontendThresholds.moderate) return 'MODERATE';
    if (db <= _frontendThresholds.high) return 'HIGH';
    return 'SEVERE';
}

function getSeverityClasses(db) {
    const category = getNoiseCategory(db);
    const cat = category.toLowerCase();
    const statusColor = cat === 'low' ? 'blue' :
        cat === 'moderate' ? 'yellow' :
            cat === 'high' ? 'orange' : 'red';

    return {
        text: `severity-${cat}`,
        bg: `status-indicator bg-${statusColor}`
    };
}

function renderCurrentNoise(locations) {
    const container = document.getElementById('current-noise');
    container.innerHTML = '';

    if (locations.length === 0) {
        container.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 40px; color: #9ca3af;">No sensor data available</div>';
        return;
    }

    locations.forEach(locData => {
        const { location, db_spl, noise_source, confidence } = locData;
        const db = Math.round(db_spl || 0);
        const conf = Math.round(confidence || 0);
        const category = getNoiseCategory(db);
        const severity = getSeverityClasses(db);

        const card = document.createElement('div');
        card.className = 'sensor-card';
        card.innerHTML = `
            <div class="sensor-header">
                <h2 class="sensor-title">${(location || 'UNKNOWN').toUpperCase()}</h2>
                <div class="${severity.bg}"></div>
            </div>
            <div class="sensor-content">
                <div class="noise-level-box">
                    <div class="noise-level-header">
                        <div class="source-icon"><i class="fa-solid fa-volume-high gradient-icon"></i></div>
                        <span class="noise-level-label">CURRENT NOISE LEVEL</span>
                    </div>
                    <div class="noise-level-value">${db} dB</div>
                    <div class="noise-level-category ${severity.text}">${category}</div>
                </div>
                <div class="noise-source-section">
                    <div class="source-header">
                        <div class="source-icon"><i class="fa-solid fa-satellite-dish gradient-icon"></i></div>
                        <span class="source-label">MOST RECENT SOURCE</span>
                    </div>
                    <div class="source-content">
                        <span class="source-indicator"></span>
                        <span class="source-value">${noise_source || 'Unknown'}</span>
                    </div>
                    <div class="confidence-section">
                        <div class="confidence-label-row">
                            <span class="confidence-label">Confidence:</span>
                            <span class="confidence-value">${conf}%</span>
                        </div>
                        <div class="progress-bar-container">
                            <div class="progress-bar-fill" style="width: ${conf}%"></div>
                        </div>
                    </div>
                </div>
            </div>
        `;
        container.appendChild(card);
    });
}

function formatDuration(hours) {
    const totalMinutes = Math.round(hours * 60);
    if (totalMinutes === 0) return `0 <span class="stat-unit">mins</span>`;

    const h = Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;

    if (h > 0 && m > 0) {
        return `${h} <span class="stat-unit">${h === 1 ? 'hr' : 'hrs'}</span> ${m} <span class="stat-unit">${m === 1 ? 'min' : 'mins'}</span>`;
    } else if (h > 0) {
        return `${h} <span class="stat-unit">${h === 1 ? 'hr' : 'hrs'}</span>`;
    } else {
        return `${m} <span class="stat-unit">${m === 1 ? 'min' : 'mins'}</span>`;
    }
}

function renderLocationStats(stats) {
    const container = document.getElementById('locationStatsContainer');
    container.innerHTML = '';

    stats.forEach(stat => {
        const card = document.createElement('div');
        card.className = 'stat-card';
        card.innerHTML = `
            <div class="stat-content">
                <div class="stat-label">High Noise Duration – ${stat.location}</div>
                <div class="stat-value">${formatDuration(stat.hoursAbove70)}</div>
            </div>
            <div class="stat-icon"><i class="fa-regular fa-clock"></i></div>
        `;

        // Color warning if > 1 hour
        const valueEl = card.querySelector('.stat-value');
        if (valueEl && stat.hoursAbove70 > 1) {
            valueEl.style.color = '#ff4035';
        }

        container.appendChild(card);
    });
}

// ==================== DETAILED SENSOR CARDS (Admin Replication) ====================

function getSourceIcon(noiseSource) {
    const NOISE_SOURCE_ICONS = {
        "Human Activity": "fa-solid fa-person",
        "Animal": "fa-solid fa-paw",
        "Vehicle": "fa-solid fa-car",
        "Car": "fa-solid fa-car",
        "Truck": "fa-solid fa-truck",
        "Bus": "fa-solid fa-bus",
        "Motorcycle": "fa-solid fa-motorcycle",
        "Tricycle": "fa-solid fa-motorcycle",
        "Jeepney": "fa-solid fa-bus",
        "Emergency vehicles": "fa-solid fa-truck-medical",
        "Bicycle": "fa-solid fa-bicycle",
        "Skateboard": "fa-solid fa-person-skating",
        "Tools & Machinery": "fa-solid fa-hammer",
        "Weather": "fa-solid fa-cloud-rain",
        "Nature & Ambience": "fa-solid fa-leaf"
    };
    const iconClass = NOISE_SOURCE_ICONS[noiseSource] || "fa-solid fa-question";
    return `<i class="${iconClass}"></i>`;
}

function getHourLabel(timestamp) {
    return new Date(timestamp).toLocaleTimeString('en-US', { hour: 'numeric', hour12: true });
}

function renderSourceGroup(sources, title, categoryTotalCount) {
    const topSources = Object.entries(sources || {})
        .sort((a, b) => b[1].count - a[1].count)
        .slice(0, 5);

    if (topSources.length === 0) return '';

    let groupHtml = `<div class="source-category-label">${title}</div>`;
    groupHtml += `<div class="source-items-list">`;
    groupHtml += topSources.map(([source, info], index) => {
        let timeInfo = '';
        if (info.timestamps && info.timestamps.length > 0) {
            const counts = {};
            info.timestamps.forEach(ts => {
                const hour = getHourLabel(ts);
                counts[hour] = (counts[hour] || 0) + 1;
            });
            const mostCommonTime = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
            timeInfo = `<div class="source-time-info" style="font-size: 0.7rem; color: #64748b; margin-bottom: 4px;">Most frequent: ${mostCommonTime}</div>`;
        }

        const freqPercentage = categoryTotalCount > 0 ? Math.round((info.count / categoryTotalCount) * 100) : 0;

        return `
            <div class="noise-source-item">
                <div class="rank-number">#${index + 1}</div>
                <div class="source-icon-circle">${getSourceIcon(source)}</div>
                <div class="source-info">
                    <div class="source-name">
                        ${source} <span class="source-avg-db">(${Math.round(info.avgDb)} dB)</span>
                    </div>
                    ${timeInfo}
                    <div class="source-confidence-row">
                        <span class="source-confidence-text">Confidence: ${Math.round(info.confidence)}%</span>
                        <div class="source-confidence-bar">
                            <div class="source-confidence-fill" style="width: ${info.confidence}%;"></div>
                        </div>
                    </div>
                </div>
                <div class="source-occurrences">
                    <span class="occurrence-count">${freqPercentage}%</span>
                    <span>Frequency</span>
                </div>
            </div>
        `;
    }).join('');
    groupHtml += `</div>`;
    return groupHtml;
}

function renderSeverityDistribution(prefix, severityCounts) {
    const normalizedCounts = { Severe: 0, High: 0, Moderate: 0, Low: 0 };
    if (severityCounts) {
        Object.keys(severityCounts).forEach(k => {
            const key = k.charAt(0).toUpperCase() + k.slice(1).toLowerCase();
            if (normalizedCounts.hasOwnProperty(key)) {
                normalizedCounts[key] = severityCounts[k];
            }
        });
    }

    const severityData = [
        { label: 'Severe', value: normalizedCounts.Severe, color: 'severe' },
        { label: 'High', value: normalizedCounts.High, color: 'high' },
        { label: 'Moderate', value: normalizedCounts.Moderate, color: 'moderate' },
        { label: 'Low', value: normalizedCounts.Low, color: 'low' }
    ];

    const total = severityData.reduce((sum, item) => sum + item.value, 0);

    const barsHTML = severityData.map(item => {
        const percentageValue = total > 0 ? (item.value / total) * 100 : 0;
        const width = total > 0 ? (item.value / total) * 100 : 0;

        return `
            <div class="bar-item">
                <div class="bar-header">
                    <span class="bar-label" style="color: ${item.color === 'severe' ? '#ef4444' : '#64748b'}">${item.label.toUpperCase()}</span>
                    <span class="bar-value">${Math.round(percentageValue)}%</span>
                </div>
                <div class="bar-track">
                    <div class="bar-fill bar-${item.color}" style="width: ${width}%;"></div>
                </div>
            </div>
        `;
    }).join('');

    const barsEl = document.getElementById(`${prefix}-severity-bars`);
    if (barsEl) barsEl.innerHTML = barsHTML;
}

async function loadSensorData(location, safeLocation) {
    try {
        const today = new Date();
        const start = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 0, 0, 0).toISOString();
        const end = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999).toISOString();

        const response = await fetch(`${API_BASE_URL}/noise/sensor/${location}?start=${start}&end=${end}`);
        if (!response.ok) {
            displayNoDataState(location);
            return;
        }

        const sensorData = await response.json();
        if (!sensorData || !sensorData.peakNoise) {
            displayNoDataState(location);
            return;
        }

        // Peak noise
        document.getElementById(`${safeLocation}-peak-db`).textContent = `${Math.round(sensorData.peakNoise.db_spl)} dB`;
        const peakLevelEl = document.getElementById(`${safeLocation}-peak-level`);
        const category = getNoiseCategory(sensorData.peakNoise.db_spl);
        peakLevelEl.textContent = category;
        peakLevelEl.style.color = category === 'SEVERE' ? '#ef4444' : '#64748b';

        document.getElementById(`${safeLocation}-peak-source`).textContent = sensorData.peakNoise.noise_source || 'Unknown';
        if (sensorData.peakNoise.timestamp) {
            document.getElementById(`${safeLocation}-peak-time`).textContent = new Date(sensorData.peakNoise.timestamp).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
        }

        const conf = Math.round(sensorData.peakNoise.confidence || 0);
        document.getElementById(`${safeLocation}-peak-confidence`).textContent = `Confidence: ${conf}%`;
        document.getElementById(`${safeLocation}-peak-confidence-bar`).style.width = `${conf}%`;
        document.getElementById(`${safeLocation}-peak-icon`).innerHTML = `<div class="peak-icon-circle">${getSourceIcon(sensorData.peakNoise.noise_source)}</div>`;

        // Frequent sources
        const frequentSourcesContainer = document.getElementById(`${safeLocation}-frequent-sources-container`);
        if (frequentSourcesContainer) {
            const hasRoadSources = Object.keys(sensorData.roadSources || {}).length > 0;
            const hasEnvSources = Object.keys(sensorData.envSources || {}).length > 0;

            if (!hasRoadSources && !hasEnvSources) {
                frequentSourcesContainer.innerHTML = `<div style="padding: 20px; text-align: center; color: #6b7280; font-size: 13px;">No significant noise events today</div>`;
            } else {
                let html = '';
                const totalRoadCount = Object.values(sensorData.roadSources || {}).reduce((sum, src) => sum + src.count, 0);
                const totalEnvCount = Object.values(sensorData.envSources || {}).reduce((sum, src) => sum + src.count, 0);
                html += renderSourceGroup(sensorData.roadSources, 'Road Transportation', totalRoadCount);
                html += renderSourceGroup(sensorData.envSources, 'Environmental Noise', totalEnvCount);
                frequentSourcesContainer.innerHTML = html;
            }
        }

        // Severity Distribution
        if (sensorData.severityCounts) {
            renderSeverityDistribution(safeLocation, sensorData.severityCounts);
        }
    } catch (err) {
        console.error(`Error loading ${location} sensor details:`, err);
        displayNoDataState(location);
    }
}

function displayNoDataState(location) {
    const safeLocation = location.replace(/\s+/g, '-').toLowerCase();
    const peakDb = document.getElementById(`${safeLocation}-peak-db`);
    if (peakDb) peakDb.textContent = '-- dB';
    const frequentSources = document.getElementById(`${safeLocation}-frequent-sources-container`);
    if (frequentSources) frequentSources.innerHTML = `<div style="padding: 20px; text-align: center; color: #6b7280; font-size: 13px;">No data available</div>`;
}

async function loadAllSensorData() {
    try {
        const today = new Date();
        const start = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 0, 0, 0).toISOString();
        const end = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999).toISOString();

        const response = await fetch(`${API_BASE_URL}/noise/stats?start=${start}&end=${end}`);
        const data = await response.json();
        const locations = (data.locationStats || []).map(l => l.location);

        const grid = document.getElementById('sensors-grid');
        if (!grid) return;

        // Rebuild grid if sensor count changed
        const currentCards = grid.querySelectorAll('.sensor').length;
        if (currentCards !== locations.length) {
            grid.innerHTML = '';
            for (const loc of locations) {
                const safeLocation = loc.replace(/\s+/g, '-').toLowerCase();
                const card = document.createElement('div');
                card.className = 'sensor';
                card.innerHTML = `
                    <div class="sensor-header2">
                        <div class="source-icon"><i class="fa-solid fa-tablet-screen-button gradient-icon"></i></div>
                        <h2 class="sensor-title" style="margin:0">${loc.toUpperCase()} LOCATION</h2>
                    </div>

                    <div class="section">
                        <div class="section-header2">
                            <div class="source-icon"><i class="fa-solid fa-chart-line gradient-icon"></i></div>
                            <h3 class="section-title2">PEAK NOISE & EXPOSURE</h3>
                        </div>
                        <div class="peak-noise-card">
                            <div class="peak-noise-left">
                                <div class="peak-db" id="${safeLocation}-peak-db">-- dB</div>
                                <div class="peak-level" id="${safeLocation}-peak-level">--</div>
                                <div class="peak-time" id="${safeLocation}-peak-time">-- : --</div>
                            </div>
                            <div class="peak-noise-right" id="${safeLocation}-peak-icon-container">
                                <div id="${safeLocation}-peak-icon"></div>
                                <div class="peak-source" id="${safeLocation}-peak-source">Loading...</div>
                                <div class="peak-confidence" id="${safeLocation}-peak-confidence">Confidence: --%</div>
                                <div class="confidence-bar">
                                    <div class="confidence-fill" id="${safeLocation}-peak-confidence-bar" style="width: 0%;"></div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div class="section">
                        <div class="section-header2">
                            <div class="source-icon"><i class="fa-solid fa-list-ol gradient-icon"></i></div>
                            <h3 class="section-title2">TOP NOISE SOURCES</h3>
                        </div>
                        <div id="${safeLocation}-frequent-sources-container"></div>
                    </div>

                    <div class="section">
                        <div class="section-header2">
                            <div class="source-icon"><i class="fa-solid fa-chart-pie gradient-icon"></i></div>
                            <h3 class="section-title2">NOISE SEVERITY</h3>
                        </div>
                        <div class="severity-chart-container">
                            <div class="horizontal-bars" id="${safeLocation}-severity-bars"></div>
                        </div>
                    </div>
                `;
                grid.appendChild(card);
            }
        }

        for (const loc of locations) {
            const safeLocation = loc.replace(/\s+/g, '-').toLowerCase();
            await loadSensorData(loc, safeLocation);
        }
    } catch (err) {
        console.error('Error loading sensor dynamic grid:', err);
    }
}

// ==================== CUSTOM CHART DRAWING (Admin Dashboard Replica) ====================

function drawChart(locationData, combinedAvg) {
    const canvas = document.getElementById('noiseChart');
    if (!canvas) return;

    chartPoints = []; // Clear for redraw
    const ctx = canvas.getContext('2d');

    // Handle high DPI displays
    const dpr = window.devicePixelRatio || 1;
    canvas.width = canvas.offsetWidth * dpr;
    canvas.height = 400 * dpr; // Fixed height defined in dashboard.css
    ctx.scale(dpr, dpr);

    const width = canvas.offsetWidth;
    const height = 400;

    // Responsive padding
    const isMobile = window.innerWidth <= 768;
    const isSmallMobile = window.innerWidth <= 480;

    const padding = {
        top: 20,
        right: isSmallMobile ? 40 : (isMobile ? 50 : 60),
        bottom: 40,
        left: isSmallMobile ? 35 : (isMobile ? 40 : 50)
    };
    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;

    ctx.clearRect(0, 0, width, height);

    const getY = (db) => height - padding.bottom - (chartHeight / DB_RANGE) * (db - MIN_DB);
    const getX = (index) => padding.left + (chartWidth / 11) * index;

    // --- Vertical Boundary Accents ---
    const drawVerticalAccents = (yStart, yEnd, color) => {
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(padding.left, yStart);
        ctx.lineTo(padding.left, yEnd);
        ctx.moveTo(width - padding.right, yStart);
        ctx.lineTo(width - padding.right, yEnd);
        ctx.stroke();
    };

    const y20 = getY(20);
    const yLow = getY(_frontendThresholds.low);
    const yMod = getY(_frontendThresholds.moderate);
    const yHigh = getY(_frontendThresholds.high);
    const y120 = getY(120);

    drawVerticalAccents(y20, yLow, '#60a5fa');  // Low (Blue)
    drawVerticalAccents(yLow, yMod, '#eab308');  // Moderate (Yellow)
    drawVerticalAccents(yMod, yHigh, '#ff8310'); // High (Orange)
    drawVerticalAccents(yHigh, y120, '#ef4444'); // Severe (Red matching new label style)

    // --- Vertical Grid Lines (Hours) ---
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 11; i++) {
        const x = getX(i);
        ctx.beginPath();
        ctx.moveTo(x, padding.top);
        ctx.lineTo(x, height - padding.bottom);
        ctx.stroke();
    }

    // --- Grid Lines & dbLevels ---
    let dbLevels = [20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120];
    const { low, moderate, high } = _frontendThresholds;
    [low, moderate, high].forEach(val => { if (!dbLevels.includes(val)) dbLevels.push(val); });
    dbLevels.sort((a, b) => a - b);

    ctx.font = '12px Segoe UI, sans-serif';
    ctx.textAlign = 'right';

    dbLevels.forEach(db => {
        const y = getY(db);
        if (db === 20 || db === low) { ctx.strokeStyle = '#60a5fa'; ctx.lineWidth = 2; }
        else if (db === moderate) { ctx.strokeStyle = '#eab308'; ctx.lineWidth = 2; }
        else if (db === high) { ctx.strokeStyle = '#ff8310'; ctx.lineWidth = 2; }
        else if (db === 120) { ctx.strokeStyle = '#ef4444'; ctx.lineWidth = 2; }
        else { ctx.strokeStyle = '#9ca3af'; ctx.lineWidth = 1; }

        ctx.beginPath();
        ctx.moveTo(padding.left, y);
        ctx.lineTo(width - padding.right, y);
        ctx.stroke();

        ctx.fillStyle = '#9ca3af';
        ctx.fillText(`${db} dB`, padding.left - 5, y + 4);
    });

    // --- X Axis Labels (Hours) ---
    ctx.textAlign = 'center';
    ctx.fillStyle = '#6b7280';
    hoursLabels.forEach((label, i) => {
        const x = getX(i);
        const baseY = height - padding.bottom + 15;
        if (window.innerWidth <= 600) {
            const parts = label.split('\n');
            ctx.font = '10px sans-serif';
            ctx.fillText(parts[0], x, baseY);
            ctx.fillText(parts[1], x, baseY + 12);
        } else {
            ctx.font = '12px sans-serif';
            ctx.fillText(label.replace('\n', ' '), x, baseY);
        }
    });

    // --- Legend Setup ---
    const legendContainer = document.querySelector('.chart-legend');
    if (legendContainer) legendContainer.innerHTML = '';

    // --- Draw Function for Lines ---
    function drawLine(data, color, lineWidth = 2.5, isDashed = false) {
        if (!data) return;
        ctx.strokeStyle = color;
        ctx.lineWidth = lineWidth;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        if (isDashed) ctx.setLineDash([5, 5]);
        else ctx.setLineDash([]);

        ctx.beginPath();
        let first = true;
        data.forEach((val, i) => {
            if (val !== null) {
                const x = getX(i);
                const y = getY(Math.min(MAX_DB, Math.max(MIN_DB, val)));
                if (first) { ctx.moveTo(x, y); first = false; }
                else ctx.lineTo(x, y);
            }
        });
        ctx.stroke();
        ctx.setLineDash([]);

        // Points (only for non-dashed)
        if (!isDashed) {
            ctx.fillStyle = color;
            data.forEach((val, i) => {
                if (val !== null) {
                    const x = getX(i);
                    const y = getY(Math.min(MAX_DB, Math.max(MIN_DB, val)));
                    ctx.beginPath();
                    const radius = window.innerWidth <= 480 ? 2 : 4;
                    ctx.arc(x, y, radius, 0, Math.PI * 2);
                    ctx.fill();

                    // Track for tooltip
                    chartPoints.push({
                        x, y,
                        value: Math.round(val),
                        location: Object.keys(locationData).find(key => locationData[key] === data) || 'Trend',
                        time: hoursLabels[i].replace('\n', ' ')
                    });
                }
            });
        }
    }

    // --- Rendering Locations & Legend ---
    const locations = Object.keys(locationData);
    locations.forEach((loc, idx) => {
        const color = CHART_COLORS[idx % CHART_COLORS.length];
        drawLine(locationData[loc], color);

        if (legendContainer) {
            const item = document.createElement('div');
            item.className = 'legend-item';
            item.innerHTML = `<div class="legend-line" style="background: ${color}"></div><span class="legend-text">${loc}</span>`;
            legendContainer.appendChild(item);
        }
    });

    if (combinedAvg && locations.length > 1) {
        drawLine(combinedAvg, '#374151', 1.5, true);
        if (legendContainer) {
            const item = document.createElement('div');
            item.className = 'legend-item';
            item.innerHTML = `<div class="legend-line" style="border-bottom: 2px dashed #374151; background: transparent;"></div><span class="legend-text">Average</span>`;
            legendContainer.appendChild(item);
        }
    }

    // --- Tooltip Event Listeners ---
    const tooltip = document.getElementById('chartTooltip');
    canvas.onmousemove = (e) => {
        const rect = canvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        const hitRadius = 15;
        const hit = chartPoints.find(p => Math.sqrt((p.x - mouseX) ** 2 + (p.y - mouseY) ** 2) < hitRadius);

        if (hit && tooltip) {
            tooltip.style.display = 'block';
            tooltip.style.left = `${e.clientX}px`;
            tooltip.style.top = `${e.clientY}px`;
            tooltip.innerHTML = `
                <div class="tooltip-header">${hit.location}</div>
                <div class="tooltip-row"><span class="tooltip-label">Time:</span><span class="tooltip-value">${hit.time}</span></div>
                <div class="tooltip-row"><span class="tooltip-label">Noise:</span><span class="tooltip-value" style="color: #3b82f6;">${hit.value} dB</span></div>
            `;
            canvas.style.cursor = 'pointer';
        } else if (tooltip) {
            tooltip.style.display = 'none';
            canvas.style.cursor = 'default';
        }
    };

    canvas.onmouseleave = () => { if (tooltip) tooltip.style.display = 'none'; };
}
