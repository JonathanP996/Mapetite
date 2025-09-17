import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import polyline from '@mapbox/polyline';
import GoogleMap from './GoogleMap';
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

  // Compute along-route distance (km) for the closest projection of a point onto the route
  const computeAlongRouteDistanceKm = (pointLat, pointLng, pathLatLngs) => {
    if (!pathLatLngs || pathLatLngs.length < 2) return { alongKm: 0, offsetKm: Infinity };
    // Build prefix distances once per call; small path so okay to recompute here
    const prefixKm = [0];
    for (let i = 0; i < pathLatLngs.length - 1; i++) {
      const [aLat, aLng] = pathLatLngs[i];
      const [bLat, bLng] = pathLatLngs[i + 1];
      prefixKm.push(prefixKm[i] + haversineDistanceKm(aLat, aLng, bLat, bLng));
    }

    let best = { alongKm: 0, offsetKm: Infinity };
    for (let i = 0; i < pathLatLngs.length - 1; i++) {
      const [lat1, lon1] = pathLatLngs[i];
      const [lat2, lon2] = pathLatLngs[i + 1];

      const midLat = (lat1 + lat2) / 2;
      const x1 = toRadians(lon1) * Math.cos(toRadians(midLat));
      const y1 = toRadians(lat1);
      const x2 = toRadians(lon2) * Math.cos(toRadians(midLat));
      const y2 = toRadians(lat2);
      const xp = toRadians(pointLng) * Math.cos(toRadians(midLat));
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
      const approxLon = xProj / Math.cos(toRadians(midLat)) * (180 / Math.PI);
      const approxLat = yProj * (180 / Math.PI);
      const offsetKm = haversineDistanceKm(pointLat, pointLng, approxLat, approxLon);

      if (offsetKm < best.offsetKm) {
        const segKm = prefixKm[i + 1] - prefixKm[i];
        const alongKm = prefixKm[i] + t * segKm;
        best = { alongKm, offsetKm };
      }
    }
    return best;
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
            // Immediately draw the base route polyline before searching restaurants
            if (mainRoute?.overview_polyline?.points) {
              const baseDecoded = polyline.decode(mainRoute.overview_polyline.points);
              const baseLatLngs = baseDecoded.map(([lat, lng]) => [lat, lng]);
              setBestRouteCoords(baseLatLngs);
              console.log('🖊️ Drew base route polyline');
            }
          } catch (err) {
            console.error("❌ Failed to fetch base route:", err);
            return;
          }

          // Step 2: Decode main route polyline
          const mainPath = polyline.decode(mainRoute.overview_polyline.points); // [[lat, lng], ...]
          console.log('🗺️ Decoded main path points:', mainPath.length);
          const CORRIDOR_MILES = 3; // requested corridor width
          const CORRIDOR_KM = CORRIDOR_MILES * 1.60934;

          // Reset prior results while we compute options
          setPlaces([]);
          setDetourOptions([]);

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
            // Prefer rankby=distance to get places nearest to the path sample without sticking to a static radius
            const url = `http://localhost:3001/places?lat=${sLat}&lng=${sLng}&rankby=distance&type=restaurant`;
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
          // Distribute candidates along the route: bin by along-route distance and pick closest-to-route per bin
          const lastPoint = mainPath[mainPath.length - 1];
          // Total route length (km)
          let totalKm = 0;
          for (let i = 0; i < mainPath.length - 1; i++) {
            const [aLat, aLng] = mainPath[i];
            const [bLat, bLng] = mainPath[i + 1];
            totalKm += haversineDistanceKm(aLat, aLng, bLat, bLng);
          }
          const binCount = MAX_DETOURS;
          const binSizeKm = Math.max(0.001, totalKm / binCount);
          const bins = new Array(binCount).fill(null);

          for (const place of onRouteFoodPlaces) {
            const lat = place.geometry?.location?.lat;
            const lng = place.geometry?.location?.lng;
            if (!lat || !lng) continue;
            const { alongKm, offsetKm } = computeAlongRouteDistanceKm(lat, lng, mainPath);
            const binIdx = Math.min(binCount - 1, Math.max(0, Math.floor(alongKm / binSizeKm)));
            const current = bins[binIdx];
            if (!current || offsetKm < current.offsetKm) {
              bins[binIdx] = { place, alongKm, offsetKm };
            }
          }
          let candidates = bins.filter(Boolean).map(b => b.place);
          // If we still have too many (rare), trim by smallest offset
          if (candidates.length > MAX_DETOURS) {
            candidates = candidates
              .map(p => {
                const lat = p.geometry?.location?.lat; const lng = p.geometry?.location?.lng;
                const m = computeAlongRouteDistanceKm(lat, lng, mainPath); return { p, off: m.offsetKm };
              })
              .sort((a,b)=>a.off-b.off)
              .slice(0, MAX_DETOURS)
              .map(x=>x.p);
          }
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
                   mapRef.current.panTo({ lat, lng });
                   mapRef.current.setZoom(16);
                 }
                 // Google Maps markers do not have openPopup by default
               }}>
            <div style={{ fontWeight: 600 }}>{idx + 1}. {opt.place.name}</div>
            <div style={{ color: '#555', fontSize: '12px' }}>{opt.place.vicinity || opt.place.formatted_address || ''}</div>
            <div style={{ color: '#0a7', fontSize: '12px' }}>{Math.round(opt.totalTime / 60)} min total</div>
          </div>
        ))}
      </div>

      {position ? (
        <div style={{ flex: 1, minWidth: 0 }}>
          <GoogleMap
            position={position}
            destination={destination}
            places={places}
            bestRouteCoords={bestRouteCoords}
            onPlaceClick={(place) => {
              const lat = place.geometry?.location?.lat;
              const lng = place.geometry?.location?.lng;
              if (lat && lng && mapRef.current) {
                mapRef.current.panTo({ lat, lng });
                mapRef.current.setZoom(16);
              }
              const marker = markerRefs.current[place.place_id];
              // Popup handling differs in Google Maps; skipping popup toggle for now
            }}
            mapRef={mapRef}
            markerRefs={markerRefs}
          />
        </div>
      ) : (
        <p>Loading map...</p>
      )}
    </div>
  );
}

export default App;
