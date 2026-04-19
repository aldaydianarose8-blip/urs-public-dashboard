require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Serve static files from the frontend directory
app.use(express.static(path.join(__dirname, '../frontend')));

// Supabase client initialization
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Global Severity Thresholds (Fallback defaults)
let _severityThresholds = { low: 50, moderate: 70, high: 100 };

async function loadServerSeverityThresholds() {
    try {
        const { data, error } = await supabase
            .from('system_settings')
            .select('setting_value')
            .eq('setting_key', 'severity_thresholds')
            .single();
        if (!error && data?.setting_value) {
            _severityThresholds = data.setting_value;
        }
    } catch (err) {
        console.warn('Using default severity thresholds');
    }
}
loadServerSeverityThresholds();

function getServerNoiseCategory(db) {
    if (db <= _severityThresholds.low) return 'Low';
    if (db <= _severityThresholds.moderate) return 'Moderate';
    if (db <= _severityThresholds.high) return 'High';
    return 'Severe';
}

// Supabase Chunk Fetcher Helper
async function fetchSupabaseDataInChunks(baseQuery, maxTotal = 30000) {
    let allData = [];
    let page = 0;
    const pageSize = 1000;
    const concurrency = 10;
    let hasMore = true;

    while (hasMore && allData.length < maxTotal) {
        const promises = [];
        for (let i = 0; i < concurrency; i++) {
            const from = (page + i) * pageSize;
            const to = Math.min(from + pageSize - 1, maxTotal - 1);
            if (from >= maxTotal) break;
            promises.push(baseQuery.range(from, to).then(res => ({ data: res.data, error: res.error, requestedSize: to - from + 1 })));
        }
        if (promises.length === 0) break;
        const results = await Promise.all(promises);
        for (const res of results) {
            if (res.error) throw res.error;
            if (!res.data || res.data.length === 0) {
                hasMore = false;
                break;
            }
            allData = allData.concat(res.data);
            if (res.data.length < res.requestedSize && res.data.length < pageSize) {
                hasMore = false;
                break;
            }
        }
        page += concurrency;
    }
    return allData.slice(0, maxTotal);
}

// Logarithmic average helper
function calculateLogarithmicAverage(dbValues) {
    if (!dbValues || dbValues.length === 0) return null;
    const intensities = dbValues.map(v => Math.pow(10, v / 10));
    const avgIntensity = intensities.reduce((sum, v) => sum + v, 0) / intensities.length;
    return 10 * Math.log10(avgIntensity);
}

// -----------------------------
// PUBLIC API ENDPOINTS
// -----------------------------

// 1. Current Noise Level per Location
app.get('/api/noise/current', async (req, res) => {
    const { start, end } = req.query;
    try {
        const { data: allData, error: fetchError } = await supabase
            .from('noise_data')
            .select('location, sensor_id, db_spl, noise_source, confidence, timestamp')
            .gte('timestamp', start)
            .lt('timestamp', end)
            .order('timestamp', { ascending: false });

        if (fetchError) throw fetchError;

        const locationMap = new Map();
        allData.forEach(reading => {
            const location = reading.location || reading.sensor_id;
            if (!locationMap.has(location)) {
                locationMap.set(location, {
                    location,
                    sensor_id: reading.sensor_id,
                    db_spl: reading.db_spl,
                    noise_source: reading.noise_source,
                    confidence: reading.confidence,
                    timestamp: reading.timestamp
                });
            }
        });
        res.json({ locations: Array.from(locationMap.values()) });
    } catch (err) {
        res.status(500).json({ message: 'Server error' });
    }
});

// 2. Overview Statistics
app.get('/api/noise/stats', async (req, res) => {
    const { start, end } = req.query;
    try {
        const { data: peakData, error: peakError } = await supabase
            .from('noise_data')
            .select('db_spl, noise_source, sensor_id, location, timestamp')
            .gte('timestamp', start)
            .lt('timestamp', end)
            .order('db_spl', { ascending: false })
            .limit(1);

        const peakRecord = peakData?.[0] || null;
        const noisePeak = {
            value: peakRecord ? Math.round(peakRecord.db_spl) : 0,
            location: peakRecord ? (peakRecord.location || peakRecord.sensor_id) : 'N/A',
            timestamp: peakRecord ? peakRecord.timestamp : null
        };

        const data = await fetchSupabaseDataInChunks(
            supabase.from('noise_data').select('db_spl, noise_source, sensor_id, location, timestamp')
                .gte('timestamp', start).lt('timestamp', end).order('timestamp', { ascending: true })
        );

        const loudSources = data.filter(d => d.db_spl > _severityThresholds.moderate);
        const sourceCounts = {};
        loudSources.forEach(d => {
            const src = d.noise_source || 'Unknown';
            sourceCounts[src] = (sourceCounts[src] || 0) + 1;
        });
        const mostCommonSource = Object.entries(sourceCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || '--';

        const locationMap = new Map();
        data.forEach(reading => {
            const location = reading.location || reading.sensor_id;
            if (!locationMap.has(location)) locationMap.set(location, []);
            if (reading.db_spl > _severityThresholds.moderate) locationMap.get(location).push(reading);
        });

        const locationStats = Array.from(locationMap.entries()).map(([location, readings]) => ({
            location,
            hoursAbove70: parseFloat(((readings.length * 5) / 3600).toFixed(2))
        }));

        res.json({ noisePeak, mostCommonSource, locationStats });
    } catch (err) {
        res.status(500).json({ message: 'Server error' });
    }
});

// 3. Chart Data
app.get('/api/noise/chart', async (req, res) => {
    const { start, end } = req.query;
    try {
        const data = await fetchSupabaseDataInChunks(
            supabase.from('noise_data').select('db_spl, location, timestamp, sensor_id')
                .gte('timestamp', start).lt('timestamp', end).order('timestamp', { ascending: true })
        );

        const activeLocations = [...new Set(data.map(d => d.location || d.sensor_id))].filter(Boolean);
        const locationData = {};
        activeLocations.forEach(loc => locationData[loc] = Array(12).fill(null));
        const combinedAvg = Array(12).fill(null);
        const startDate = new Date(start);

        for (let hour = 7; hour <= 18; hour++) {
            const hourStart = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate(), hour, 0, 0);
            const hourEnd = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate(), hour + 1, 0, 0);
            const idx = hour - 7;
            const hourRecords = data.filter(d => {
                const ts = new Date(d.timestamp);
                return ts >= hourStart && ts < hourEnd;
            });
            if (hourRecords.length === 0) continue;
            combinedAvg[idx] = calculateLogarithmicAverage(hourRecords.map(d => d.db_spl).filter(v => v > 0));
            activeLocations.forEach(loc => {
                const locValues = hourRecords.filter(d => (d.location || d.sensor_id) === loc).map(d => d.db_spl).filter(v => v > 0);
                if (locValues.length > 0) locationData[loc][idx] = calculateLogarithmicAverage(locValues);
            });
        }
        res.json({ locationData, combinedAvg });
    } catch (err) {
        res.status(500).json({ message: 'Server error' });
    }
});

// 4. Sensor Detailed Data
app.get('/api/noise/sensor/:sensorId', async (req, res) => {
    const { sensorId } = req.params;
    const { start, end } = req.query;
    try {
        const data = await fetchSupabaseDataInChunks(
            supabase.from('noise_data').select('*').or(`sensor_id.eq.${sensorId},location.eq.${sensorId}`)
                .gte('timestamp', start).lt('timestamp', end).order('timestamp', { ascending: true })
        );

        if (!data || data.length === 0) return res.json({ peakNoise: null, roadSources: {}, envSources: {}, totalReadings: 0 });

        const peakNoise = data.reduce((max, curr) => curr.db_spl > max.db_spl ? curr : max, data[0]);

        const roadTransportationSources = ['Vehicle', 'Car', 'Truck', 'Bus', 'Motorcycle', 'Emergency vehicles', 'Bicycle', 'Skateboard', 'Jeepney', 'Tricycle'];
        const environmentalSources = ['Human Activity', 'Animal', 'Tools & Machinery', 'Weather', 'Nature & Ambience'];

        const roadSources = {};
        const envSources = {};

        data.filter(r => r.db_spl > _severityThresholds.moderate).forEach(record => {
            const source = record.noise_source || 'Unknown';
            const target = roadTransportationSources.includes(source) ? roadSources : envSources;
            if (!target[source]) target[source] = { count: 0, confidenceSum: 0, confidenceCount: 0, dbValues: [], timestamps: [] };
            target[source].count++;
            target[source].confidenceSum += record.confidence || 0;
            target[source].confidenceCount++;
            target[source].dbValues.push(record.db_spl);
            target[source].timestamps.push(record.timestamp);
        });

        [roadSources, envSources].forEach(group => {
            Object.keys(group).forEach(src => {
                group[src].avgDb = calculateLogarithmicAverage(group[src].dbValues);
                group[src].confidence = Math.round(group[src].confidenceSum / group[src].confidenceCount);
            });
        });

        const severityCounts = { Severe: 0, High: 0, Moderate: 0, Low: 0 };
        data.forEach(r => severityCounts[getServerNoiseCategory(r.db_spl)]++);

        const { count: highNoiseCount } = await supabase.from('noise_data').select('*', { count: 'exact', head: true })
            .or(`sensor_id.eq.${sensorId},location.eq.${sensorId}`).gte('timestamp', start).lt('timestamp', end).gt('db_spl', _severityThresholds.moderate);

        res.json({ peakNoise, roadSources, envSources, severityCounts, hoursAbove70: parseFloat((((highNoiseCount || 0) * 5) / 3600).toFixed(2)), totalReadings: data.length });
    } catch (err) {
        res.status(500).json({ message: 'Server error' });
    }
});

// 5. System Settings (Thresholds)
app.get('/api/settings/system', async (req, res) => {
    const { key } = req.query;
    try {
        const { data, error } = await supabase
            .from('system_settings')
            .select('setting_value')
            .eq('setting_key', key)
            .single();

        if (error) throw error;

        // Sync local thresholds if this is the key we use for calculations
        if (key === 'severity_thresholds' && data?.setting_value) {
            _severityThresholds = data.setting_value;
        }

        res.json({ value: data?.setting_value });
    } catch (err) {
        console.error('Error fetching settings:', err);
        res.status(500).json({ message: 'Server error' });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 Public Dashboard Backend running on http://localhost:${PORT}`);
});
