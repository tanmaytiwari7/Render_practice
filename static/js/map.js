// Initialize map
const map = L.map('satellite-map').setView([0, 0], 2);

// Add dark tile layer
L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '© OpenStreetMap contributors, © CARTO',
    maxZoom: 18,
}).addTo(map);

// Variables
let issMarker;
let satelliteMarkers = [];
let refreshInterval;
let refreshCountdown = 10;
let userLocation = null;

// Matrix animation
function createMatrixEffect() {
    const container = document.querySelector('.container');
    const chars = "01アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン";
    
    for (let i = 0; i < 50; i++) {
        const line = document.createElement('div');
        line.className = 'matrix-line';
        line.style.left = `${Math.random() * 100}%`;
        line.style.animationDuration = `${5 + Math.random() * 10}s`;
        line.style.animationDelay = `${Math.random() * 5}s`;
        
        let content = '';
        const length = 10 + Math.floor(Math.random() * 20);
        for (let j = 0; j < length; j++) {
            content += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        
        line.textContent = content;
        container.appendChild(line);
    }
}

// Update time display
function updateTime() {
    const now = new Date();
    const timeStr = now.toLocaleTimeString();
    document.getElementById('time-display').textContent = timeStr;
}

// Add log to console
function addLog(message) {
    const now = new Date();
    const timeStr = now.toLocaleTimeString();
    const consoleElement = document.getElementById('console');
    const logEntry = document.createElement('div');
    logEntry.className = 'console-line';
    logEntry.textContent = `[${timeStr}] ${message}`;
    consoleElement.appendChild(logEntry);
    consoleElement.scrollTop = consoleElement.scrollHeight;
}

// Update refresh timer
function updateRefreshTimer() {
    document.getElementById('refresh-timer').textContent = refreshCountdown;
    if (refreshCountdown <= 0) {
        refreshCountdown = 10;
        fetchSatelliteData();
    } else {
        refreshCountdown--;
    }
}

// Get user location
function getUserLocation() {
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            position => {
                userLocation = {
                    lat: position.coords.latitude,
                    lon: position.coords.longitude,
                    alt: position.coords.altitude || 0
                };
                
                // Update location inputs
                document.getElementById('latitude').value = userLocation.lat.toFixed(6);
                document.getElementById('longitude').value = userLocation.lon.toFixed(6);
                
                addLog(`Location acquired: ${userLocation.lat.toFixed(4)}, ${userLocation.lon.toFixed(4)}`);
                fetchSatelliteData();
                
                // Add user marker
                L.marker([userLocation.lat, userLocation.lon], {
                    icon: L.divIcon({
                        className: 'user-marker',
                        html: '📍',
                        iconSize: [30, 30]
                    }),
                    isUserLocation: true
                }).addTo(map).bindPopup('Your Location').openPopup();
                
                // Center map on user
                map.setView([userLocation.lat, userLocation.lon], 6);
            },
            error => {
                addLog(`Geolocation error: ${error.message}`);
                // Default to ISS position if location fails
                fetchISSData();
            }
        );
    } else {
        addLog("Geolocation not supported by this browser");
        fetchISSData();
    }
}

// Update location manually
function updateLocation() {
    const latInput = document.getElementById('latitude');
    const lonInput = document.getElementById('longitude');
    
    const newLat = parseFloat(latInput.value);
    const newLon = parseFloat(lonInput.value);
    
    if (isNaN(newLat) || isNaN(newLon)) {
        addLog('Invalid coordinates. Please enter valid numbers.');
        return;
    }
    
    if (newLat < -90 || newLat > 90 || newLon < -180 || newLon > 180) {
        addLog('Invalid coordinates. Latitude must be between -90 and 90, longitude between -180 and 180.');
        return;
    }
    
    // Clear existing user marker
    map.eachLayer(layer => {
        if (layer.options && layer.options.isUserLocation) {
            map.removeLayer(layer);
        }
    });
    
    // Update user location
    userLocation = {
        lat: newLat,
        lon: newLon,
        alt: 0
    };
    
    // Add new marker
    L.marker([newLat, newLon], {
        icon: L.divIcon({
            className: 'user-marker',
            html: '📍',
            iconSize: [30, 30]
        }),
        isUserLocation: true
    }).addTo(map).bindPopup('Your Location').openPopup();
    
    // Center map
    map.setView([newLat, newLon], 6);
    
    // Fetch new data
    refreshCountdown = 0;
    updateRefreshTimer();
    
    addLog(`Location updated to: ${newLat.toFixed(4)}, ${newLon.toFixed(4)}`);
}

// Fetch ISS data
function fetchISSData() {
    addLog("Fetching ISS position...");
    fetch('/get_iss_position')
        .then(response => {
            if (!response.ok) {
                throw new Error(`HTTP error ${response.status}`);
            }
            return response.json();
        })
        .then(data => {
            if (data.error) {
                throw new Error(data.error);
            }
            
            const { latitude, longitude, timestamp } = data;
            
            // Update or create ISS marker
            if (issMarker) {
                issMarker.setLatLng([latitude, longitude]);
            } else {
                issMarker = L.marker([latitude, longitude], {
                    icon: L.divIcon({
                        className: 'iss-marker',
                        html: '🛰️',
                        iconSize: [30, 30]
                    })
                }).addTo(map).bindPopup('International Space Station');
                
                issMarker.on('click', () => {
                    displaySatelliteInfo({
                        name: 'ISS (International Space Station)',
                        id: '25544',
                        latitude: latitude,
                        longitude: longitude,
                        altitude: 400,  // Approx ISS altitude
                        velocity: 7.66  // Approx ISS velocity
                    });
                });
            }
            
            addLog(`ISS position updated: ${latitude.toFixed(4)}, ${longitude.toFixed(4)}`);
            
            // Center map on ISS if no user location
            if (!userLocation) {
                map.setView([latitude, longitude], 3);
            }
        })
        .catch(error => {
            addLog(`Failed to fetch ISS data: ${error.message}`);
        });
}

// Fetch satellite data
function fetchSatelliteData() {
    if (!userLocation) {
        addLog("No location available for satellite tracking");
        return;
    }
    
    addLog("Fetching nearby satellites...");
    
    // Clear previous satellite markers (except searched ones)
    satelliteMarkers = satelliteMarkers.filter(marker => {
        if (!marker.options.satId) {
            map.removeLayer(marker);
            return false;
        }
        return true;
    });
    
    // Fetch closest satellites
    fetch('/get_closest_satellites', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            latitude: userLocation.lat,
            longitude: userLocation.lon,
            altitude: userLocation.alt,
            radius: 10 // degrees of latitude/longitude to search
        })
    })
    .then(response => {
        if (!response.ok) {
            throw new Error(`HTTP error ${response.status}`);
        }
        return response.json();
    })
    .then(data => {
        if (data.error) {
            throw new Error(data.error);
        }
        
        addLog(`Found ${data.length} nearby satellites`);
        
        data.forEach(sat => {
            // Skip if we already have a marker for this satellite
            if (satelliteMarkers.some(m => m.options.satId === sat.id)) {
                return;
            }
            
            const marker = L.marker([sat.latitude, sat.longitude], {
                icon: L.divIcon({
                    className: 'satellite-marker',
                    html: '🛰',
                    iconSize: [20, 20]
                })
            }).addTo(map);
            
            marker.on('click', () => {
                displaySatelliteInfo(sat);
            });
            
            satelliteMarkers.push(marker);
        });
    })
    .catch(error => {
        addLog(`Failed to fetch satellite data: ${error.message}`);
    });
    
    // Always fetch ISS data too
    fetchISSData();
}

// Display satellite info
function displaySatelliteInfo(data) {
    document.getElementById('sat-name').textContent = data.name;
    document.getElementById('sat-id').textContent = data.id;
    document.getElementById('sat-lat').textContent = data.latitude.toFixed(4);
    document.getElementById('sat-lon').textContent = data.longitude.toFixed(4);
    document.getElementById('sat-alt').textContent = data.altitude.toFixed(2);
    document.getElementById('sat-vel').textContent = data.velocity.toFixed(2);
    
    addLog(`Selected satellite: ${data.name} (${data.id})`);
}

// Search functionality
function initSearch() {
    const searchInput = document.getElementById('search-input');
    const searchBtn = document.getElementById('search-btn');
    const searchResults = document.getElementById('search-results');
    const resultsList = document.getElementById('results-list');
    
    // Debounce search function
    let searchTimeout;
    
    function performSearch() {
        const query = searchInput.value.trim();
        if (query.length < 2) {
            searchResults.style.display = 'none';
            return;
        }
        
        addLog(`Searching for: ${query}`);
        
        fetch('/search_satellites', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                query: query
            })
        })
        .then(response => {
            if (!response.ok) {
                throw new Error(`HTTP error ${response.status}`);
            }
            return response.json();
        })
        .then(data => {
            if (data.error) {
                throw new Error(data.error);
            }
            
            // Clear previous results
            resultsList.innerHTML = '';
            
            if (data.length === 0) {
                resultsList.innerHTML = '<div class="result-item">No satellites found</div>';
            } else {
                data.forEach(sat => {
                    const item = document.createElement('div');
                    item.className = 'result-item';
                    item.textContent = `${sat.name} (ID: ${sat.id})`;
                    item.dataset.id = sat.id;
                    item.dataset.name = sat.name;
                    
                    item.addEventListener('click', () => {
                        addLog(`Selected satellite: ${sat.name}`);
                        fetchSatellitePosition(sat.id, sat.name);
                        searchResults.style.display = 'none';
                        searchInput.value = '';
                    });
                    
                    resultsList.appendChild(item);
                });
            }
            
            searchResults.style.display = 'block';
        })
        .catch(error => {
            addLog(`Search failed: ${error.message}`);
            resultsList.innerHTML = `<div class="result-item">Error: ${error.message}</div>`;
            searchResults.style.display = 'block';
        });
    }
    
    // Event listeners
    searchBtn.addEventListener('click', performSearch);
    
    searchInput.addEventListener('input', () => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(performSearch, 500);
    });
    
    searchInput.addEventListener('focus', () => {
        if (resultsList.children.length > 0) {
            searchResults.style.display = 'block';
        }
    });
    
    document.addEventListener('click', (e) => {
        if (!searchResults.contains(e.target) && e.target !== searchInput) {
            searchResults.style.display = 'none';
        }
    });
}

// Fetch individual satellite position
function fetchSatellitePosition(satId, satName) {
    addLog(`Fetching position for ${satName || satId}...`);
    
    fetch(`/get_satellite_position/${satId}`)
        .then(response => {
            if (!response.ok) {
                return response.json().then(err => {
                    throw new Error(err.error || `HTTP error ${response.status}`);
                });
            }
            return response.json();
        })
        .then(data => {
            if (data.error) {
                throw new Error(data.error);
            }
            
            // Create or update marker
            let marker = satelliteMarkers.find(m => m.options.satId === satId);
            
            if (!marker) {
                marker = L.marker([data.latitude, data.longitude], {
                    icon: L.divIcon({
                        className: 'satellite-marker',
                        html: '🛰',
                        iconSize: [20, 20]
                    }),
                    satId: satId
                }).addTo(map);
                
                marker.on('click', () => {
                    displaySatelliteInfo(data);
                });
                
                satelliteMarkers.push(marker);
            } else {
                marker.setLatLng([data.latitude, data.longitude]);
            }
            
            // Center map on satellite if this is the first time tracking
            if (!marker._map) {
                map.setView([data.latitude, data.longitude], 5);
            }
            
            displaySatelliteInfo(data);
            addLog(`Tracking ${data.name}`);
        })
        .catch(error => {
            addLog(`Failed to track satellite: ${error.message}`);
            
            // Show error in satellite info panel
            document.getElementById('sat-name').textContent = 'ERROR';
            document.getElementById('sat-id').textContent = satId;
            document.getElementById('sat-lat').textContent = '--';
            document.getElementById('sat-lon').textContent = '--';
            document.getElementById('sat-alt').textContent = '--';
            document.getElementById('sat-vel').textContent = '--';
        });
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    createMatrixEffect();
    updateTime();
    setInterval(updateTime, 1000);
    
    // Set up refresh interval
    refreshInterval = setInterval(updateRefreshTimer, 1000);
    
    // Manual refresh button
    document.getElementById('refresh-btn').addEventListener('click', () => {
        refreshCountdown = 10;
        fetchSatelliteData();
    });
    
    // Location update button
    document.getElementById('update-location').addEventListener('click', updateLocation);
    
    // Initial data fetch
    getUserLocation();
    
    // Set up periodic refresh (every 10 seconds)
    setInterval(fetchSatelliteData, 10000);
    
    // Initialize search
    initSearch();
});