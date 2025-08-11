// main.js

document.addEventListener('DOMContentLoaded', () => {
    // --- A. CONFIGURATION & STATE ---
    const ROUTING_CONFIG = { MAX_WALKING_DISTANCE_METERS: 2500 };
    const HEALTH_METRICS_CONFIG = {
        MET_VALUES: { 'foot-walking': 3.5, 'cycling-regular': 4.0 },
        CAR_EMISSIONS_G_PER_KM: 130,
    };
    const PRICING_CONFIG = {
        'auto-rickshaw': { baseFare: 25, perKm: 17, minKm: 1.5 },
        'cycling-regular': { unlockFee: 10, perMinute: 2.5 },
        'foot-walking': { cost: 0 }
    };
    const AppState = {
        map: null, startMarker: null, endMarker: null,
        startCoord: null, endCoord: null, routeLayers: {},
        trafficSignalLayer: null, poiLayer: null, activeRouteGeoJSON: null, parkingLayer: null,
        redIcon: L.icon({
            iconUrl: 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon.png',
            iconSize:[25,41], iconAnchor:[12,41], popupAnchor:[1,-34], className: 'red-icon'
        })
    };

    // --- B. UI ELEMENT REFERENCES ---
    const UI = {
        startInput: document.getElementById('startInput'), endInput: document.getElementById('endInput'),
        startBtn: document.getElementById('startBtn'), endBtn: document.getElementById('endBtn'),
        planBtn: document.getElementById('planBtn'), userWeight: document.getElementById('userWeight'),
        statusEl: document.getElementById('status'), routeLegendEl: document.getElementById('routeLegend'),
        routeSummaryEl: document.getElementById('routeSummary'), clearBtn: document.getElementById('clearBtn'),
        helpBtn: document.getElementById('helpBtn'), helpModal: document.getElementById('helpModal'),
        modalCloseBtn: document.getElementById('modalCloseBtn'),
        poiControls: document.getElementById('poiControls'),
        poiCheckboxes: document.querySelectorAll('input[name="poi"]'),
        parkingContainer: document.getElementById('parkingContainer'),
        findParkingBtn: document.getElementById('findParkingBtn'),
        weatherWidget: document.getElementById('weatherWidget'),
    };

    // --- C. INITIALIZATION ---
    function init() {
        AppState.map = L.map('map', { zoomControl: true }).setView([18.5204, 73.8567], 13);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19,
            attribution: '&copy; OpenStreetMap contributors | Directions &copy; OpenRouteService'
        }).addTo(AppState.map);
        setupEventListeners();
        setStatus('Ready — set start and end points.');
        fetchAndDisplayTrafficSignals();
        fetchAndDisplayWeather();
    }

    // --- D. EVENT LISTENERS ---
    function setupEventListeners() {
        UI.startBtn.addEventListener('click', () => handleGeocode('start'));
        UI.endBtn.addEventListener('click', () => handleGeocode('end'));
        UI.planBtn.addEventListener('click', handleRoutePlanning);
        UI.clearBtn.addEventListener('click', clearAll);
        UI.helpBtn.addEventListener('click', () => UI.helpModal.classList.add('visible'));
        UI.modalCloseBtn.addEventListener('click', () => UI.helpModal.classList.remove('visible'));
        UI.helpModal.addEventListener('click', (e) => {
            if (e.target === UI.helpModal) UI.helpModal.classList.remove('visible');
        });
        UI.poiCheckboxes.forEach(checkbox => checkbox.addEventListener('change', fetchAndDisplayPois));
        UI.findParkingBtn.addEventListener('click', fetchAndDisplayParking);
        AppState.map.on('click', (ev) => {
            const { lat, lng } = ev.latlng;
            if (!AppState.startCoord || (AppState.startCoord && AppState.endCoord)) {
                setStart([lat, lng], true);
            } else {
                setEnd([lat, lng], true);
            }
        });
        AppState.map.on('moveend', fetchAndDisplayTrafficSignals);
    }

    // --- E. CORE LOGIC ---
    async function fetchAndDisplayWeather() {
        const lat = 18.5204; const lon = 73.8567;
        const url = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${OWM_API_KEY}&units=metric`;
        try {
            const response = await fetch(url);
            if (!response.ok) throw new Error('Weather data not available.');
            const data = await response.json();
            const icon = data.weather[0].icon;
            const temp = Math.round(data.main.temp);
            const description = data.weather[0].description;
            const feelsLike = Math.round(data.main.feels_like);
            let recommendation = '';
            if (['09d', '09n', '10d', '10n', '11d', '11n'].includes(icon)) {
                recommendation = '🌧️ Rain likely, be prepared.';
            } else if (feelsLike > 35) {
                recommendation = '☀️ Extreme heat, stay hydrated!';
            } else {
                recommendation = '👍 Great weather for a ride!';
            }
            UI.weatherWidget.innerHTML = ` <img src="https://openweathermap.org/img/wn/${icon}.png" alt="${description}" style="width:30px; height:30px; vertical-align:middle; margin-right: 5px;"> <strong>${temp}°C</strong> in Pune. ${recommendation}`;
        } catch (error) {
            console.error("Failed to fetch weather:", error);
            UI.weatherWidget.textContent = 'Could not load weather data.';
        }
    }
    async function fetchAndDisplayTrafficSignals() {
        const bounds = AppState.map.getBounds();
        const bbox = `${bounds.getSouth()},${bounds.getWest()},${bounds.getNorth()},${bounds.getEast()}`;
        const query = `[out:json];(node["highway"="traffic_signals"](${bbox}););out center;`;
        const url = `https://overpass.kumi.systems/api/interpreter?data=${encodeURIComponent(query)}`;
        try {
            const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
            if (!response.ok) throw new Error('Overpass API request failed.');
            const data = await response.json();
            if (AppState.trafficSignalLayer) AppState.map.removeLayer(AppState.trafficSignalLayer);
            const signalMarkers = data.elements.map(element => 
                L.circleMarker([element.lat, element.lon], {
                    radius: 4, fillColor: "#ff7800", color: "#000",
                    weight: 0.5, opacity: 1, fillOpacity: 0.8
                }).bindPopup('Traffic Signal')
            );
            AppState.trafficSignalLayer = L.layerGroup(signalMarkers).addTo(AppState.map);
        } catch (error) { console.error("Failed to fetch traffic signals:", error); }
    }
    async function fetchAndDisplayPois() {
        if (!AppState.activeRouteGeoJSON) return;
        const selectedPois = Array.from(UI.poiCheckboxes).filter(cb => cb.checked).map(cb => cb.value);
        if (AppState.poiLayer) AppState.map.removeLayer(AppState.poiLayer);
        if (selectedPois.length === 0) { setStatus('Select a category to show points of interest.'); return; }
        try {
            const routeFeature = AppState.activeRouteGeoJSON.features[0];
            const routeBbox = turf.bbox(routeFeature);
            const bboxString = `${routeBbox[1]},${routeBbox[0]},${routeBbox[3]},${routeBbox[2]}`;
            const query = `[out:json];(node[amenity~"^(${selectedPois.join('|')})$"](${bboxString}));out center;`;
            const url = `https://overpass.kumi.systems/api/interpreter?data=${encodeURIComponent(query)}`;
            setStatus('Finding points of interest...');
            const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
            if (!response.ok) throw new Error('Map data server is busy.');
            const data = await response.json();
            const finalMarkers = [];
            data.elements.forEach(element => {
                const poiPoint = turf.point([element.lon, element.lat]);
                const distanceToLine = turf.pointToLineDistance(poiPoint, routeFeature, { units: 'meters' });
                if (distanceToLine < 25) {
                    const amenity = element.tags.amenity;
                    let icon = amenity === 'cafe' ? '☕' : amenity === 'restaurant' ? '🍴' : amenity === 'fuel' ? '⛽' : amenity === 'hotel' ? '🏨' : '❓';
                    const popupText = `${icon} ${element.tags.name || amenity.replace('_', ' ')}`;
                    finalMarkers.push(L.marker([element.lat, element.lon]).bindPopup(popupText));
                }
            });
            AppState.poiLayer = L.layerGroup(finalMarkers).addTo(AppState.map);
            setStatus(`Found ${finalMarkers.length} relevant points of interest.`);
        } catch (error) {
            console.error("Failed to fetch POIs:", error);
            setStatus('Map data server is busy. Please try again.', true);
        }
    }
    
    async function fetchAndDisplayParking() {
        if (!AppState.endCoord) { setStatus("Please set a destination first.", true); return; }
        const radius = 800;
        const [lat, lon] = AppState.endCoord;
        const query = `[out:json];(node(around:${radius},${lat},${lon})[amenity=parking][fee=yes];way(around:${radius},${lat},${lon})[amenity=parking][fee=yes];);out center;`;
        const url = `https://overpass.kumi.systems/api/interpreter?data=${encodeURIComponent(query)}`;
        setStatus("Searching for nearby parking...");
        try {
            const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
            if (!response.ok) throw new Error('Map data server is busy.');
            const data = await response.json();
            if (AppState.parkingLayer) AppState.map.removeLayer(AppState.parkingLayer);
            if (data.elements.length === 0) { setStatus(`No paid parking found within ${radius}m of destination.`); return; }
            const parkingIcon = L.divIcon({ html: '<b>P</b>', className: 'parking-icon', iconSize: [24, 24], iconAnchor: [12, 12] });
            const parkingMarkers = data.elements.map(element => {
                const pos = element.center ? [element.center.lat, element.center.lon] : [element.lat, element.lon];
                const name = element.tags.name || "Paid Parking";
                const marker = L.marker(pos, { icon: parkingIcon }).bindPopup(name);

                marker.on('mouseover', () => marker.getElement().classList.add('parking-icon-hover'));
                marker.on('mouseout', () => marker.getElement().classList.remove('parking-icon-hover'));

                marker.on('click', async () => {
                    const parkingCoord = [pos[0], pos[1]];
                    setStatus(`Calculating walk from "${name}"...`);
                    try {
                        const walkingRoute = await fetchORSRoute('foot-walking', parkingCoord, AppState.endCoord);
                        drawRoute(walkingRoute, 'var(--secondary-500)', 'last-mile-walk');
                        const summary = walkingRoute.features[0].properties.summary;
                        setStatus(`Walk from parking: ${formatMeters(summary.distance)} • ${formatSeconds(summary.duration)}`);
                    } catch (error) {
                        setStatus("Could not calculate walking route from parking.", true);
                    }
                });
                return marker;
            });
            AppState.parkingLayer = L.layerGroup(parkingMarkers).addTo(AppState.map);
            setStatus(`Found ${parkingMarkers.length} paid parking locations. Click one to see the walking route.`);
        } catch (error) {
            console.error("Failed to fetch parking:", error);
            setStatus("Map data server is busy. Please try again.", true);
        }
    }

    async function handleGeocode(type) {
        const inputEl = (type === 'start') ? UI.startInput : UI.endInput;
        const address = inputEl.value;
        if (!address) return;
        setStatus(`Searching for "${address}"...`);
        try {
            const url = `https://api.openrouteservice.org/geocode/search?api_key=${ORS_API_KEY}&text=${encodeURIComponent(address)}&boundary.country=IND&boundary.circle.lat_lon=18.52,73.85`;
            const res = await fetch(url);
            const data = await res.json();
            if (!data.features || data.features.length === 0) throw new Error("Address not found.");
            const [lng, lat] = data.features[0].geometry.coordinates;
            const displayName = data.features[0].properties.label;
            if (type === 'start') setStart([lat, lng]); else setEnd([lat, lng]);
            AppState.map.panTo([lat, lng]);
            setStatus(`Location found: ${displayName}`);
        } catch (err) { setStatus(err.message, true); }
    }

    async function handleRoutePlanning() {
        if (!AppState.startCoord || !AppState.endCoord) { setStatus('Please set both start and destination.', true); return; }
        setStatus('Finding smart routes...');
        UI.planBtn.disabled = true;
        UI.planBtn.classList.add('loading');
        clearRoutes();
        try {
            const drivingRouteData = await fetchORSRoute('driving-car', AppState.startCoord, AppState.endCoord);
            const distance = drivingRouteData.features[0].properties.summary.distance;
            const profiles = [{ name: 'cycling-regular', color: 'var(--primary-600)', label: 'Cycling' }];
            if (distance < ROUTING_CONFIG.MAX_WALKING_DISTANCE_METERS) {
                profiles.push({ name: 'foot-walking', color: 'var(--secondary-500)', label: 'Walking' });
            }
            const routePromises = profiles.map(p => fetchORSRoute(p.name, AppState.startCoord, AppState.endCoord));
            const results = await Promise.allSettled(routePromises);
            let calculatedRoutes = { 'driving-car': { summary: drivingRouteData.features[0].properties.summary, geojson: drivingRouteData } };
            drawRoute(drivingRouteData, 'var(--neutral-500)', 'driving-car');
            results.forEach((result, index) => {
                if (result.status === 'fulfilled' && result.value) {
                    const profile = profiles[index];
                    const geojson = result.value;
                    calculatedRoutes[profile.name] = { summary: geojson.features[0].properties.summary, geojson: geojson };
                    drawRoute(geojson, profile.color, profile.name);
                }
            });
            for (const profileName in calculatedRoutes) {
                const routeData = calculatedRoutes[profileName];
                routeData.signalCount = countSignalsOnRoute(routeData.geojson);
            }
            const recommendedProfile = calculatedRoutes['cycling-regular'] ? 'cycling-regular' : 'driving-car';
            if (calculatedRoutes[recommendedProfile]) {
                AppState.activeRouteGeoJSON = calculatedRoutes[recommendedProfile].geojson;
                UI.poiControls.style.display = 'block';
            }
            updateLegendUI(calculatedRoutes);
            updateSummaryUI(calculatedRoutes);
            if (Object.keys(AppState.routeLayers).length > 0) {
                const group = L.featureGroup(Object.values(AppState.routeLayers));
                AppState.map.fitBounds(group.getBounds(), { padding: [40, 40] });
                UI.parkingContainer.style.display = 'block';
            } else {
                setStatus('Could not find any viable routes.', true);
            }
        } catch (err) {
            console.error("Route planning error:", err);
            setStatus(err.message || 'Could not plan routes.', true);
        } finally {
            UI.planBtn.disabled = false;
            UI.planBtn.classList.remove('loading');
        }
    }

    async function fetchORSRoute(profile, start, end) {
        const url = `https://api.openrouteservice.org/v2/directions/${profile}?api_key=${ORS_API_KEY}&start=${start[1]},${start[0]}&end=${end[1]},${end[0]}`;
        const res = await fetch(url);
        if (!res.ok) {
            const errorData = await res.json();
            throw new Error(errorData.error.message || `Route for ${profile} failed.`);
        }
        return await res.json();
    }
    
    // --- F. MAP & UI HELPERS ---
    function setStart([lat, lng], byClick = false) {
        AppState.startCoord = [lat, lng];
        if (AppState.startMarker) AppState.startMarker.setLatLng([lat, lng]);
        else AppState.startMarker = L.marker([lat, lng], { draggable: true, zIndexOffset: 1000 }).addTo(AppState.map).bindPopup('Start').openPopup();
        AppState.startMarker.on('dragend', (e) => AppState.startCoord = [e.target.getLatLng().lat, e.target.getLatLng().lng]);
        if (byClick) UI.startInput.value = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    }
    function setEnd([lat, lng], byClick = false) {
        AppState.endCoord = [lat, lng];
        if (AppState.endMarker) AppState.endMarker.setLatLng([lat, lng]);
        else AppState.endMarker = L.marker([lat, lng], { draggable: true, icon: AppState.redIcon, zIndexOffset: 1000 }).addTo(AppState.map).bindPopup('End').openPopup();
        AppState.endMarker.on('dragend', (e) => AppState.endCoord = [e.target.getLatLng().lat, e.target.getLatLng().lng]);
        if (byClick) UI.endInput.value = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    }
    function drawRoute(geojson, color, profileName) {
        const style = {
            color,
            weight: profileName === 'cycling-regular' ? 7 : 5,
            opacity: 0.85
        };
        if (profileName === 'last-mile-walk') {
            style.dashArray = '5, 10';
            style.weight = 4;
        }
        const layer = L.geoJSON(geojson, { style: () => style });
        layer.addTo(AppState.map);
        AppState.routeLayers[profileName] = layer;
    }
    function updateLegendUI(routes) {
        const profiles = [
            { name: 'cycling-regular', color: 'var(--primary-600)', label: 'Cycling' },
            { name: 'driving-car', color: 'var(--neutral-500)', label: 'Driving' },
            { name: 'foot-walking', color: 'var(--secondary-500)', label: 'Walking' }
        ];
        let html = '';
        profiles.forEach(profile => {
            if (routes[profile.name]) {
                html += `<div class="legend-item"><span class="legend-color-swatch" style="background-color:${profile.color};"></span>${profile.label}</div>`;
            }
        });
        UI.routeLegendEl.innerHTML = html;
    }
    function updateSummaryUI(routes) {
        const driving = routes['driving-car'];
        const cycling = routes['cycling-regular'];
        const walking = routes['foot-walking'];
        const userWeight = parseFloat(UI.userWeight.value) || 65;
        let html = '';
        if (driving && cycling) {
            const saved = driving.summary.duration - cycling.summary.duration;
            if (saved > 0) html += `<div class="time-saved">⚡ You save ~${formatSeconds(saved)} by cycling!</div>`;
        } else if (driving && walking) {
            const saved = driving.summary.duration - walking.summary.duration;
            if (saved > 0) html += `<div class="time-saved">⚡ You save ~${formatSeconds(saved)} by walking!</div>`;
        }
        const createRouteHTML = (profile, routeData) => {
            if (!routeData || !routeData.summary) return '';
            const summary = routeData.summary;
            const cost = calculateCost(profile, summary);
            const calories = calculateCalories(profile, summary.duration, userWeight);
            const co2Saved = calculateCO2Saved(summary.distance);
            let mainInfo = `<div class="route-main"><strong>${profile.split('-')[0].charAt(0).toUpperCase() + profile.split('-')[0].slice(1)}:</strong> ${formatMeters(summary.distance)} • ${formatSeconds(summary.duration)}`;
            if (cost > 0) mainInfo += ` • <span style="font-weight:bold;">₹${cost}</span>`;
            if (routeData.signalCount > 0) mainInfo += ` • <span title="Traffic Signals">🚦x ${routeData.signalCount}</span>`;
            mainInfo += `</div>`;
            let healthInfo = '';
            if (profile !== 'driving-car') {
                healthInfo = `<div class="health-metrics">🔥 ${calories} kcal burned • 🌳 ${co2Saved}g CO₂ saved</div>`;
            }
            return `<div class="route-block">${mainInfo}${healthInfo}</div>`;
        };
        if (cycling) html += createRouteHTML('cycling-regular', cycling);
        if (walking) html += createRouteHTML('foot-walking', walking);
        if (driving) html += createRouteHTML('driving-car', driving);
        UI.routeSummaryEl.innerHTML = html;
    }
    function setStatus(text, isError = false) {
        UI.statusEl.textContent = text || '';
        UI.statusEl.style.color = isError ? 'var(--danger)' : '#333';
    }
    function clearRoutes() {
        for (const key in AppState.routeLayers) AppState.map.removeLayer(AppState.routeLayers[key]);
        AppState.routeLayers = {};
        UI.routeSummaryEl.innerHTML = '';
        UI.routeLegendEl.innerHTML = '';
    }
    function clearAll() {
        clearRoutes();
        if (AppState.trafficSignalLayer) { AppState.map.removeLayer(AppState.trafficSignalLayer); AppState.trafficSignalLayer = null; }
        if (AppState.poiLayer) { AppState.map.removeLayer(AppState.poiLayer); AppState.poiLayer = null; }
        if (AppState.parkingLayer) { AppState.map.removeLayer(AppState.parkingLayer); AppState.parkingLayer = null; }
        if (AppState.startMarker) { AppState.map.removeLayer(AppState.startMarker); AppState.startMarker = null; }
        if (AppState.endMarker) { AppState.map.removeLayer(AppState.endMarker); AppState.endMarker = null; }
        AppState.startCoord = null; AppState.endCoord = null; AppState.activeRouteGeoJSON = null;
        UI.startInput.value = ''; UI.endInput.value = '';
        UI.poiControls.style.display = 'none';
        UI.parkingContainer.style.display = 'none';
        UI.poiCheckboxes.forEach(cb => cb.checked = false);
        setStatus('Ready. Set start and end points.');
    }

    // --- G. UTILITY & HEALTH METRIC HELPERS ---
    function formatMeters(m) { return (m >= 1000) ? `${(m/1000).toFixed(1)} km` : `${Math.round(m)} m`; }
    function formatSeconds(s) { const mins = Math.round(s / 60); return (mins < 60) ? `${mins} min` : `${(mins / 60).toFixed(1)} h`; }
    function calculateCalories(profile, durationSec, weightKg) {
        const metValue = HEALTH_METRICS_CONFIG.MET_VALUES[profile];
        if (!metValue) return 0;
        return Math.round((metValue * 3.5 * weightKg) / 200 * (durationSec / 60));
    }
    function calculateCO2Saved(distanceMeters) {
        return Math.round((distanceMeters / 1000) * HEALTH_METRICS_CONFIG.CAR_EMISSIONS_G_PER_KM);
    }
    function calculateCost(profile, summary) {
        let cost = 0;
        const profileKey = profile === 'driving-car' ? 'auto-rickshaw' : profile;
        const rules = PRICING_CONFIG[profileKey];
        if (!rules) return 0;
        const distanceKm = summary.distance / 1000;
        const durationMin = summary.duration / 60;
        if (profile === 'driving-car') {
            cost = rules.baseFare;
            if (distanceKm > rules.minKm) cost += (distanceKm - rules.minKm) * rules.perKm;
        } else if (profile === 'cycling-regular') {
            cost = rules.unlockFee + (durationMin * rules.perMinute);
        }
        return Math.round(cost);
    }
    function countSignalsOnRoute(routeGeoJSON) {
        if (!AppState.trafficSignalLayer || !routeGeoJSON || !window.turf) return 0;
        let signalCount = 0;
        const routeLine = routeGeoJSON.features[0];
        const signalMarkers = AppState.trafficSignalLayer.getLayers();
        signalMarkers.forEach(marker => {
            const signalPoint = turf.point([marker.getLatLng().lng, marker.getLatLng().lat]);
            const distanceToLine = turf.pointToLineDistance(signalPoint, routeLine, { units: 'meters' });
            if (distanceToLine < 20) {
                signalCount++;
            }
        });
        return signalCount;
    }

    // --- KICK IT OFF ---
    init();
});