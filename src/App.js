import React, { useState, useEffect, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline } from 'react-leaflet';
import L from 'leaflet';
import axios from 'axios';
import polyline from '@mapbox/polyline';
import 'leaflet/dist/leaflet.css';
import './App.scss';


function App() {
  const [position, setPosition] = useState(null);
  const [places, setPlaces] = useState([]); // stores nearby food places
  const [destination, setDestination] = useState(null); // user-selected destination
  const [destinationQuery, setDestinationQuery] = useState('');
  const [bestRouteCoords, setBestRouteCoords] = useState([]);
  const [detourOptions, setDetourOptions] = useState([]);
  const autocompleteRef = useRef(null);
  const inputRef = useRef(null);
  const mapRef = useRef(null);
  const markerRefs = useRef({});

  // Custom pizza icon
  const pizzaIcon = new L.Icon({
    iconUrl: 'https://cdn-icons-png.flaticon.com/512/1046/1046784.png', // pizza slice icon
    iconSize: [32, 32],  // Size of the pizza icon
    iconAnchor: [16, 32],  // Point of the icon that will sit on the marker's position
    popupAnchor: [0, -32],  // Position of the popup relative to the marker
  });

  const locationIcon = new L.Icon({
    iconUrl: 'https://cdn-icons-png.flaticon.com/512/684/684908.png', // blue marker for current location
    iconSize: [32, 32],
    iconAnchor: [16, 32],
    popupAnchor: [0, -32],
  });

  const destinationIcon = new L.Icon({
    iconUrl: 'https://cdn-icons-png.flaticon.com/512/684/684908.png', // red pin (you can replace with a more destination-style icon)
    iconSize: [32, 32],
    iconAnchor: [16, 32],
    popupAnchor: [0, -32],
  });

  // Distance helpers (WGS84 haversine + point-to-segment distance)
  const toRadians = (deg) => (deg * Math.PI) / 180;
  const haversineDistanceKm = (lat1, lon1, lat2, lon2) => {
    const R = 6371; // km
    const dLat = toRadians(lat2 - lat1);
    const dLon = toRadians(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  };

  // Approx distance from point to polyline (min distance to any segment)
  const distanceFromPointToPolylineKm = (pointLat, pointLng, pathLatLngs) => {
    if (!pathLatLngs || pathLatLngs.length < 2) return Infinity;
    let minKm = Infinity;
    for (let i = 0; i < pathLatLngs.length - 1; i++) {
      const [lat1, lon1] = pathLatLngs[i];
      const [lat2, lon2] = pathLatLngs[i + 1];

      // Equirectangular projection for short segments (good enough locally)
      const x1 = toRadians(lon1) * Math.cos(toRadians((lat1 + lat2) / 2));
      const y1 = toRadians(lat1);
      const x2 = toRadians(lon2) * Math.cos(toRadians((lat1 + lat2) / 2));
      const y2 = toRadians(lat2);
      const xp = toRadians(pointLng) * Math.cos(toRadians((lat1 + lat2) / 2));
      const yp = toRadians(pointLat);

      const dx = x2 - x1;
      const dy = y2 - y1;
      const segLen2 = dx * dx + dy * dy;
      let t = 0;
      if (segLen2 > 0) {
        t = ((xp - x1) * dx + (yp - y1) * dy) / segLen2;
        t = Math.max(0, Math.min(1, t));
      }
      const xProj = x1 + t * dx;
      const yProj = y1 + t * dy;

      // Convert projected radian-space distance back to km
      // Use small-angle approximation by mapping back to lat/lon near segment
      const approxLon = xProj / Math.cos(toRadians((lat1 + lat2) / 2)) * (180 / Math.PI);
      const approxLat = yProj * (180 / Math.PI);
      const km = haversineDistanceKm(pointLat, pointLng, approxLat, approxLon);
      if (km < minKm) minKm = km;
    }
    return minKm;
  };

  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const { latitude, longitude } = pos.coords;
          const userPos = [latitude, longitude];
          setPosition(userPos);
          console.log('📍 Position set:', userPos);
        },
        (err) => {
          console.error("Geolocation error:", err);
          const fallbackPos = [33.7490, -84.3880];
          setPosition(fallbackPos);
          console.log('📍 Using fallback position:', fallbackPos);
        }
      );
    }
  }, []);

  // Google Places Autocomplete effect
  useEffect(() => {
    if (!window.google || !inputRef.current) return; // wait for Google Maps API to load

    // Initialize the autocomplete after Google Maps is loaded
    autocompleteRef.current = new window.google.maps.places.Autocomplete(inputRef.current, {
      types: ['geocode'],
    });

    autocompleteRef.current.addListener('place_changed', () => {
      const place = autocompleteRef.current.getPlace();
      const loc = place.geometry?.location;
      console.log('🔍 Place selected:', place);
      console.log('📍 Location:', loc);
      
      if (loc) {
        setDestination([loc.lat(), loc.lng()]);
        setDestinationQuery(place.formatted_address || '');
        console.log('✅ Destination set to:', [loc.lat(), loc.lng()]);

        (async () => {
          console.log('🚀 Starting route calculation...');
          console.log('📍 Current position:', position);
          
          if (!position) {
            console.log('❌ Missing position:', { position });
            return;
          }

          // Step 1: Get base route
          const mainRouteUrl = `http://localhost:3001/directions?origin=${position[0]},${position[1]}&destination=${loc.lat()},${loc.lng()}`;
          console.log('🛣️ Fetching base route:', mainRouteUrl);
          let mainRoute;
          try {
            const mainRouteRes = await axios.get(mainRouteUrl);
            console.log('✅ Base route response:', mainRouteRes.data);
            mainRoute = mainRouteRes.data.routes[0];
            console.log('📊 Main route:', mainRoute);
          } catch (err) {
            console.error("❌ Failed to fetch base route:", err);
            return;
          }

          // Step 2: Decode main route polyline
          const mainPath = polyline.decode(mainRoute.overview_polyline.points); // [[lat, lng], ...]
          console.log('🗺️ Decoded main path points:', mainPath.length);
          const CORRIDOR_MILES = 3; // requested corridor width
          const CORRIDOR_KM = CORRIDOR_MILES * 1.60934;

          // Step 3: Sample along the route and fetch places near those samples
          const sampleEveryKm = 5; // ~5km sampling
          const sampledCoords = [];
          let accumulatedKm = 0;
          for (let i = 0; i < mainPath.length - 1; i++) {
            const [aLat, aLng] = mainPath[i];
            const [bLat, bLng] = mainPath[i + 1];
            const segKm = haversineDistanceKm(aLat, aLng, bLat, bLng);
            accumulatedKm += segKm;
            if (accumulatedKm >= sampleEveryKm || i === 0) {
              sampledCoords.push([aLat, aLng]);
              accumulatedKm = 0;
            }
          }
          sampledCoords.push(mainPath[mainPath.length - 1]);
          console.log('📍 Sample points along route:', sampledCoords.length);

          // Fetch places per sample point (radius ~ 4.8km = 3mi)
          const dedupeMap = new Map();
          for (const [sLat, sLng] of sampledCoords) {
            const url = `http://localhost:3001/places?lat=${sLat}&lng=${sLng}&radius=${Math.round(CORRIDOR_KM * 1000)}`;
            console.log('🍕 Fetching places near sample:', url);
            try {
              const resp = await axios.get(url);
              const results = resp.data.results || [];
              for (const p of results) {
                if (!dedupeMap.has(p.place_id)) dedupeMap.set(p.place_id, p);
              }
              console.log(`🍕 Added ${results.length}, unique so far: ${dedupeMap.size}`);
            } catch (e) {
              console.error('❌ Sample places fetch failed:', e?.response?.status, e?.response?.data || e);
            }
          }

          const sampledPlaces = Array.from(dedupeMap.values());
          console.log('🍕 Total unique places from samples:', sampledPlaces.length);

          // Step 4: Filter to 3-mile corridor distance to the actual path
          console.log('🔍 Filtering places within 3-mile corridor...');
          const onRouteFoodPlaces = sampledPlaces.filter((place) => {
            const lat = place.geometry?.location?.lat;
            const lng = place.geometry?.location?.lng;
            if (!lat || !lng) return false;
            const distanceKm = distanceFromPointToPolylineKm(lat, lng, mainPath);
            return distanceKm <= CORRIDOR_KM;
          });
          console.log(`🍕 Places within corridor: ${onRouteFoodPlaces.length}/${sampledPlaces.length}`);
          setPlaces(onRouteFoodPlaces);
          console.log('✅ Set corridor places to state');

          // Step 4: Determine fastest detour routes via corridor places
          console.log('⏱️ Finding fastest detour routes...');
          const MAX_DETOURS = 30; // cap to reduce API calls
          const candidates = onRouteFoodPlaces.slice(0, MAX_DETOURS);
          const options = [];

          for (const place of candidates) {
            const url = `http://localhost:3001/directions?origin=${position[0]},${position[1]}&destination=${loc.lat()},${loc.lng()}&waypoint=${place.place_id}`;
            console.log(`🛣️ Checking route via "${place.name}":`, url);

            try {
              const res = await axios.get(url);
              const route = res.data.routes?.[0];
              if (!route) continue;
              const totalTime = route.legs.reduce((sum, leg) => sum + leg.duration.value, 0);
              options.push({ place, totalTime, route });
              console.log(`⏱️ Route via "${place.name}" takes ${totalTime}s`);
            } catch (error) {
              console.error(`❌ Error fetching route via "${place.name}":`, error);
            }
          }

          options.sort((a, b) => a.totalTime - b.totalTime);
          setDetourOptions(options);
          console.log('✅ Detour options ready:', options.length);

          // Step 5: Draw best route (top option)
          if (options.length > 0) {
            console.log('🎯 Drawing best route');
            const decoded = polyline.decode(options[0].route.overview_polyline.points);
            const latLngs = decoded.map(([lat, lng]) => [lat, lng]);
            setBestRouteCoords(latLngs);
            console.log('✅ Route coordinates set:', latLngs.length, 'points');
          } else {
            console.log('❌ No best route found');
          }
        })();
      }
    });
  }, [position, places]);

  return (
    <div style={{ height: '100vh', width: '100vw', display: 'flex' }}>
      <div className="fancy-search">
        <div className="fs-container">
          <svg viewBox="0 0 420 60" xmlns="http://www.w3.org/2000/svg">
            <rect className="bar" />
            <g className="magnifier">
              <circle className="glass" />
              <line className="handle" x1="32" y1="32" x2="44" y2="44"></line>
            </g>
            <g className="sparks">
              <circle className="spark"/>
              <circle className="spark"/>
              <circle className="spark"/>
            </g>
            <g className="burst pattern-one">
              <circle className="particle circle"/>
              <path className="particle triangle"/>
              <circle className="particle circle"/>
              <path className="particle plus"/>
              <rect className="particle rect"/>
              <path className="particle triangle"/>
            </g>
            <g className="burst pattern-two">
              <path className="particle plus"/>
              <circle className="particle circle"/>
              <path className="particle triangle"/>
              <rect className="particle rect"/>
              <circle className="particle circle"/>
              <path className="particle plus"/>
            </g>
            <g className="burst pattern-three">
              <circle className="particle circle"/>
              <rect className="particle rect"/>
              <path className="particle plus"/>
              <path className="particle triangle"/>
              <rect className="particle rect"/>
              <path className="particle plus"/>
            </g>
          </svg>
          <input
            ref={inputRef}
            type="search"
            name="q"
            aria-label="Search for destination"
            value={destinationQuery}
            onChange={(e) => setDestinationQuery(e.target.value)}
            placeholder="Enter a destination..."
          />
        </div>
      </div>

      <div style={{ position: 'absolute', top: '10px', right: '20px', fontSize: '50px', fontWeight: 'bold', fontFamily: 'DM Sans, sans-serif', zIndex: 1000 }}>
        Mapetite
      </div>

      {/* Sidebar */}
      <div style={{ width: '360px', maxWidth: '40vw', borderRight: '1px solid #eee', padding: '12px', overflowY: 'auto' }}>
        <div style={{ fontWeight: 'bold', fontSize: '18px', marginBottom: '8px' }}>Fastest food detours</div>
        {detourOptions.length === 0 && (
          <div style={{ color: '#666' }}>Select a destination to see options.</div>
        )}
        {detourOptions.map((opt, idx) => (
          <div key={opt.place.place_id || idx} style={{ padding: '8px 4px', borderBottom: '1px solid #f0f0f0', cursor: 'pointer' }}
               onClick={() => {
                 const decoded = polyline.decode(opt.route.overview_polyline.points);
                 const latLngs = decoded.map(([lat, lng]) => [lat, lng]);
                 setBestRouteCoords(latLngs);
                 const lat = opt.place.geometry?.location?.lat;
                 const lng = opt.place.geometry?.location?.lng;
                 if (lat && lng && mapRef.current) {
                   mapRef.current.flyTo([lat, lng], 16, { duration: 0.8 });
                 }
                 const marker = markerRefs.current[opt.place.place_id];
                 if (marker && marker.openPopup) {
                   marker.openPopup();
                 }
               }}>
            <div style={{ fontWeight: 600 }}>{idx + 1}. {opt.place.name}</div>
            <div style={{ color: '#555', fontSize: '12px' }}>{opt.place.vicinity || opt.place.formatted_address || ''}</div>
            <div style={{ color: '#0a7', fontSize: '12px' }}>{Math.round(opt.totalTime / 60)} min total</div>
          </div>
        ))}
      </div>

      {position ? (
        <MapContainer center={position} zoom={15} style={{ height: '100%', width: '100%' }} whenCreated={(map) => { mapRef.current = map; }}>
          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />

          {/* Marker for your location */}
          <Marker position={position} icon={locationIcon}>
            <Popup>
              <strong>You’re here 📍</strong>
              {position && (
                <img
                  src={`https://maps.googleapis.com/maps/api/staticmap?center=${position[0]},${position[1]}&zoom=15&size=200x200&markers=color:blue%7C${position[0]},${position[1]}&key=${process.env.REACT_APP_GOOGLE_BROWSER_KEY}`}
                  alt="Your location"
                  style={{ width: '100%', marginTop: '8px', borderRadius: '8px' }}
                />
              )}
            </Popup>
          </Marker>

          {/* Marker for destination */}
          {destination && (
            <Marker position={destination} icon={destinationIcon}>
              <Popup>
                <strong>Destination 📍</strong>
                {destination && (
                  <img
                    src={`https://maps.googleapis.com/maps/api/staticmap?center=${destination[0]},${destination[1]}&zoom=15&size=200x200&markers=color:red%7C${destination[0]},${destination[1]}&key=${process.env.REACT_APP_GOOGLE_BROWSER_KEY}`}
                    alt="Destination"
                    style={{ width: '100%', marginTop: '8px', borderRadius: '8px', color: "blue"}}
                  />
                )}
              </Popup>
            </Marker>
          )}

          {/* Fallback popup if no places found */}
          {/* No default places before destination; optional hint could go here */}

          {/* Food places */}
          {destination && places.map((place, index) => {
            const lat = place.geometry?.location?.lat;
            const lng = place.geometry?.location?.lng;
            if (!lat || !lng) return null;

            return (
              <Marker
                key={place.place_id || index}
                position={[lat, lng]}
                icon={pizzaIcon}
                ref={(el) => { if (el && place.place_id) { markerRefs.current[place.place_id] = el; } }}
              >
                <Popup>
                  <strong>{place.name}</strong><br />
                  {place.vicinity || 'No address available'}
                  {place.photos && place.photos.length > 0 && (
                    <img
                      src={`https://maps.googleapis.com/maps/api/place/photo?maxwidth=200&photoreference=${place.photos[0].photo_reference}&key=${process.env.REACT_APP_GOOGLE_BROWSER_KEY}`}
                      alt="Food place"
                      style={{ width: '100%', marginTop: '8px', borderRadius: '8px' }}
                    />
                  )}
                </Popup>
              </Marker>
            );
          })}

          {bestRouteCoords.length > 0 && (
            <Polyline positions={bestRouteCoords} color="blue" />
          )}
        </MapContainer>
      ) : (
        <p>Loading map...</p>
      )}
    </div>
  );
}

export default App;
