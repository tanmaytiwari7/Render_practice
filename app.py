from flask import Flask, render_template, request, jsonify
import requests
from skyfield.api import load, wgs84, EarthSatellite
import time
import re
import math
from threading import Lock

app = Flask(__name__)

# API Configuration
N2YO_API_KEY = 'QSLEFZ-4AJP9Y-UERVN8-5JG1'
OPEN_NOTIFY_URL = 'http://api.open-notify.org/iss-now.json'
CELESTRAK_URL = 'https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=tle'

# Cache configuration
tle_cache = {}
cache_lock = Lock()
CACHE_DURATION = 3600  # 1 hour cache

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/get_iss_position')
def get_iss_position():
    try:
        response = requests.get(OPEN_NOTIFY_URL, timeout=5)
        response.raise_for_status()
        data = response.json()
        return jsonify({
            'latitude': float(data['iss_position']['latitude']),
            'longitude': float(data['iss_position']['longitude']),
            'timestamp': data['timestamp']
        })
    except Exception as e:
        return jsonify({'error': f'Failed to fetch ISS data: {str(e)}'}), 500

def parse_tle_data(tle_text):
    """Improved TLE parsing with better error handling"""
    satellites = {}
    lines = [line.strip() for line in tle_text.split('\n') if line.strip()]
    
    i = 0
    while i < len(lines) - 2:
        try:
            name = lines[i]
            line1 = lines[i+1]
            line2 = lines[i+2]
            
            # Validate TLE format
            if not (line1.startswith('1 ') and line2.startswith('2 ')):
                i += 1
                continue
                
            # Extract NORAD ID
            sat_id = line2[2:7].strip()
            if not sat_id.isdigit():
                i += 1
                continue
                
            # Create satellite object
            sat = EarthSatellite(line1, line2, name)
            satellites[sat_id] = {
                'object': sat,
                'name': name,
                'tle': (line1, line2)
            }
            i += 3
        except Exception as e:
            app.logger.error(f"Error parsing TLE at line {i}: {str(e)}")
            i += 1
    
    return satellites

def get_tle_data(sat_ids):
    """Get TLE data with better error handling"""
    with cache_lock:
        now = time.time()
        key = ",".join(sorted(sat_ids))
        
        # Return cached data if available
        if key in tle_cache and now - tle_cache[key]['timestamp'] < CACHE_DURATION:
            return tle_cache[key]['data']
        
        # Fetch new TLE data
        try:
            url = f"{CELESTRAK_URL}&CATNR={','.join(sat_ids)}"
            response = requests.get(url, timeout=10)
            response.raise_for_status()
            
            tle_data = parse_tle_data(response.text)
            if not tle_data:
                raise ValueError("No valid TLE data found")
                
            tle_cache[key] = {
                'data': tle_data,
                'timestamp': now
            }
            return tle_data
        except Exception as e:
            app.logger.error(f"Error fetching TLE data: {str(e)}")
            return {}

@app.route('/get_closest_satellites', methods=['POST'])
def get_closest_satellites():
    try:
        data = request.json
        lat = float(data.get('latitude', 0))
        lon = float(data.get('longitude', 0))
        alt = float(data.get('altitude', 0))
        radius = int(data.get('radius', 10))
        
        # N2YO API call
        url = f'https://api.n2yo.com/rest/v1/satellite/above/{lat}/{lon}/{alt}/{radius}/&apiKey={N2YO_API_KEY}'
        response = requests.get(url, timeout=10)
        response.raise_for_status()
        
        n2yo_data = response.json()
        satellites = sorted(n2yo_data.get('above', []), key=lambda x: x['alt'])[:5]
        sat_ids = [str(sat['satid']) for sat in satellites]
        
        # Get TLE data
        tle_data = get_tle_data(sat_ids)
        
        results = []
        ts = load.timescale()
        
        for sat in satellites:
            sat_id = str(sat['satid'])
            sat_info = {
                'name': sat['satname'],
                'id': sat_id,
                'latitude': lat + (sat['satalt'] / 111.32),
                'longitude': lon + (sat['satlng'] / (111.32 * math.cos(math.radians(lat)))),
                'altitude': sat['satalt'],
                'velocity': sat.get('vel', 7.8)
            }
            
            if sat_id in tle_data:
                try:
                    t = ts.now()
                    geocentric = tle_data[sat_id]['object'].at(t)
                    subpoint = wgs84.subpoint(geocentric)
                    sat_info.update({
                        'latitude': subpoint.latitude.degrees,
                        'longitude': subpoint.longitude.degrees,
                        'altitude': subpoint.elevation.km,
                        'velocity': geocentric.velocity.km_per_s
                    })
                except Exception as e:
                    app.logger.error(f"Orbit calculation failed for {sat_id}: {str(e)}")
            
            results.append(sat_info)
        
        return jsonify(results)
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/get_satellite_position/<sat_id>')
def get_satellite_position(sat_id):
    try:
        if not re.match(r'^\d{1,5}$', sat_id):
            return jsonify({'error': 'Invalid satellite ID'}), 400
        
        # Try to get from cache first
        tle_data = get_tle_data([sat_id])
        
        if sat_id not in tle_data:
            # Fetch directly if not in cache
            url = f"{CELESTRAK_URL}&CATNR={sat_id}"
            response = requests.get(url, timeout=10)
            response.raise_for_status()
            
            tle_data = parse_tle_data(response.text)
            if sat_id not in tle_data:
                return jsonify({'error': 'Satellite not found in TLE data'}), 404
        
        # Calculate position
        ts = load.timescale()
        t = ts.now()
        geocentric = tle_data[sat_id]['object'].at(t)
        subpoint = wgs84.subpoint(geocentric)
        
        return jsonify({
            'name': tle_data[sat_id]['name'],
            'id': sat_id,
            'latitude': subpoint.latitude.degrees,
            'longitude': subpoint.longitude.degrees,
            'altitude': subpoint.elevation.km,
            'velocity': geocentric.velocity.km_per_s
        })
    except requests.exceptions.RequestException as e:
        return jsonify({'error': f'Network error: {str(e)}'}), 503
    except Exception as e:
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    app.run(debug=True)