import React, { useState, useEffect, useRef, useMemo } from 'react';
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
  const [selectedPlace, setSelectedPlace] = useState(null);
  const [showInfoPopup, setShowInfoPopup] = useState(false);
  const [baseRouteTimeSec, setBaseRouteTimeSec] = useState(0);
  const [confirmRoute, setConfirmRoute] = useState(null); // holds { place, totalTime, addedTime, route }
  const [navigation, setNavigation] = useState(null); // { steps: [], current: 0, route }
  const watchIdRef = useRef(null);
  const [loadingDetours, setLoadingDetours] = useState({ active: false, total: 0, done: 0, etaSec: null, label: '', found: 0 });
  const [corridorMiles, setCorridorMiles] = useState(1); // adjustable corridor width (1-6 miles)
  const [samplingBoost, setSamplingBoost] = useState(false); // if true, use denser sampling
  const [cuisine, setCuisine] = useState(''); // keyword filter (fetch-time)
  const [minPrice, setMinPrice] = useState(''); // 0-4 (fetch-time)
  const [maxPrice, setMaxPrice] = useState(''); // 0-4 (fetch-time)
  // Popup-only filters (client-side filter of existing options)
  const [uiCuisine, setUiCuisine] = useState('');
  const [uiMinPrice, setUiMinPrice] = useState('');
  const [uiMaxPrice, setUiMaxPrice] = useState('');
  const [allPlaces, setAllPlaces] = useState([]);
  const [nextPageToken, setNextPageToken] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const autocompleteRef = useRef(null);
  const inputRef = useRef(null);
  const mapRef = useRef(null);
  const markerRefs = useRef({});

  // Keep popup filters in sync with primary filters so they are visible even before searching
  useEffect(() => {
    setUiCuisine(cuisine);
    setUiMinPrice(minPrice);
    setUiMaxPrice(maxPrice);
  }, [cuisine, minPrice, maxPrice]);

  // Compute visible options based on popup filters (client-side)
  const visibleOptions = useMemo(() => {
    const matchesCuisine = (p) => {
      if (!uiCuisine) return true;
      const kw = uiCuisine.toLowerCase();
      return (
        (p.place.name || '').toLowerCase().includes(kw) ||
        (Array.isArray(p.place.types) && p.place.types.join(' ').toLowerCase().includes(kw))
      );
    };
    const inPrice = (p) => {
      const lvl = typeof p.place.price_level === 'number' ? p.place.price_level : undefined;
      // If no price level is set on the place, allow it through unless explicitly filtering
      if (typeof lvl !== 'number') {
        return uiMinPrice === '' && uiMaxPrice === '';
      }
      const minOk = uiMinPrice === '' || lvl >= Number(uiMinPrice);
      const maxOk = uiMaxPrice === '' || lvl <= Number(uiMaxPrice);
      return minOk && maxOk;
    };
    return (detourOptions || [])
      .filter(matchesCuisine)
      .filter(inPrice)
      .slice()
      .sort((a,b)=>a.addedTime-b.addedTime || a.totalTime-b.totalTime);
  }, [detourOptions, uiCuisine, uiMinPrice, uiMaxPrice]);

  // Strip HTML tags from Google instruction strings
  const stripHtml = (s) => (s || '').replace(/<[^>]+>/g, '');

  // Build steps array from a Google Directions route
  const buildStepsFromRoute = (route) => {
    const steps = [];
    const legs = route?.legs || [];
    for (const leg of legs) {
      for (const st of (leg.steps || [])) {
        steps.push({
          instruction: stripHtml(st.html_instructions),
          durationSec: st.duration?.value || 0,
          distanceMeters: st.distance?.value || 0,
          end: {
            lat: st.end_location?.lat,
            lng: st.end_location?.lng
          }
        });
      }
    }
    return steps;
  };

  // Navigation: watch user position and advance steps
  useEffect(() => {
    if (!navigation) return;
    if (!navigator.geolocation) return;

    // Start high-accuracy watch
    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        setPosition([latitude, longitude]);
        // Advance step if close to end of current step
        setNavigation((prev) => {
          if (!prev) return prev;
          const idx = prev.current || 0;
          const step = prev.steps[idx];
          if (!step) return prev;
          const dKm = haversineDistanceKm(latitude, longitude, step.end.lat, step.end.lng);
          const thresholdKm = 0.04; // ~40 meters
          if (dKm <= thresholdKm) {
            const nextIdx = idx + 1;
            if (nextIdx >= prev.steps.length) {
              // Arrived at destination
              return null; // end navigation
            }
            return { ...prev, current: nextIdx };
          }
          return prev;
        });
      },
      (err) => {
        console.warn('Geolocation watch error:', err);
      },
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 10000 }
    );

    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
    };
  }, [navigation]);

  // Compute counts per cuisine option based on currently loaded detours and current price filters
  const cuisineCounts = useMemo(() => {
    const toLower = (s) => (s || '').toLowerCase();
    const withinPrice = (p) => {
      const lvl = typeof p.place.price_level === 'number' ? p.place.price_level : undefined;
      if (typeof lvl !== 'number') {
        return uiMinPrice === '' && uiMaxPrice === '';
      }
      const minOk = uiMinPrice === '' || lvl >= Number(uiMinPrice);
      const maxOk = uiMaxPrice === '' || lvl <= Number(uiMaxPrice);
      return minOk && maxOk;
    };
    const list = (detourOptions || []).filter(withinPrice);

    const options = [
      'chinese','italian','mexican','japanese','thai','indian','korean','vietnamese','french','mediterranean','american','pizza','sushi','seafood','steakhouse','fast food','cafe','dessert','vegetarian','vegan'
    ];

    const counts = {};
    counts[''] = list.length; // All Cuisines

    for (const kw of options) {
      const k = kw.toLowerCase();
      let c = 0;
      for (const item of list) {
        const name = toLower(item.place.name);
        const types = Array.isArray(item.place.types) ? toLower(item.place.types.join(' ')) : '';
        if (name.includes(k) || types.includes(k)) c++;
      }
      counts[k] = c;
    }
    return counts;
  }, [detourOptions, uiMinPrice, uiMaxPrice]);

  // Show place info popup
  const showPlaceInfo = (place, routeInfo = null) => {
    setSelectedPlace({ place, routeInfo });
    setShowInfoPopup(true);
  };

  const loadMorePlaces = async () => {
    if (loadingMore || !position || !destination) return;
    
    setLoadingMore(true);
    try {
      // Get places that haven't been processed for detour routes yet
      const processedPlaceIds = new Set(detourOptions.map(opt => opt.place.place_id));
      const unprocessedPlaces = allPlaces.filter(place => !processedPlaceIds.has(place.place_id));
      
      console.log(`🔄 Found ${unprocessedPlaces.length} unprocessed places out of ${allPlaces.length} total`);
      
      if (unprocessedPlaces.length === 0) {
        console.log('✅ All places have been processed for detour routes');
        setLoadingMore(false);
        return;
      }
      
      // Get the main route path for distance calculations
      const mainPath = bestRouteCoords.map(([lat, lng]) => [lat, lng]);
      const CORRIDOR_KM = 3 * 1.60934; // 3 miles in km
      
      // Filter unprocessed places to only those within the corridor
      const unprocessedPlacesInCorridor = unprocessedPlaces.filter(place => {
        const lat = place.geometry?.location?.lat;
        const lng = place.geometry?.location?.lng;
        if (!lat || !lng) return false;
        const distanceKm = distanceFromPointToPolylineKm(lat, lng, mainPath);
        return distanceKm <= (Math.max(1, Math.min(6, Number(corridorMiles) || 1)) * 1.60934);
      });
      
      console.log(`🍕 Unprocessed places within corridor: ${unprocessedPlacesInCorridor.length}/${unprocessedPlaces.length}`);
      
      // Sort unprocessed places by closeness to the main path so we process the next-best candidates first
      const sortedUnprocessed = unprocessedPlacesInCorridor
        .map(place => {
          const lat = place.geometry?.location?.lat;
          const lng = place.geometry?.location?.lng;
          if (!lat || !lng) return null;
          const m = computeAlongRouteDistanceKm(lat, lng, mainPath);
          return { place, off: m.offsetKm };
        })
        .filter(Boolean)
        .sort((a,b)=>a.off-b.off)
        .map(x=>x.place);

      // Calculate detour routes for next 10 unprocessed places
      const newOptions = [];
      for (const place of sortedUnprocessed.slice(0, 10)) {
        try {
          const lat = place.geometry?.location?.lat;
          const lng = place.geometry?.location?.lng;
          if (!lat || !lng) continue;
          
          // IMPORTANT: Our backend expects 'waypoint' to be a place_id and will
          // construct &waypoints=place_id:... when calling Google. Passing lat,lng
          // here causes Google to ignore the stop and returns base time (0 added).
          const routeUrl = `http://localhost:3001/directions?origin=${position[0]},${position[1]}&destination=${destination[0]},${destination[1]}&waypoint=${place.place_id}`;
          const res = await axios.get(routeUrl);
          const route = res.data.routes?.[0];
          if (!route) continue;
          
          const totalTime = route.legs.reduce((sum, leg) => sum + leg.duration.value, 0);
          const addedTime = Math.max(0, totalTime - baseRouteTimeSec);
          newOptions.push({ place, totalTime, addedTime, route });
          console.log(`⏱️ New route via "${place.name}" takes ${totalTime}s (+${addedTime}s)`);
        } catch (error) {
          console.error(`❌ Error fetching route via "${place.name}":`, error);
        }
      }
      
      // Add new options to existing ones and sort by added time
      const allOptions = [...detourOptions, ...newOptions]
        .sort((a, b) => a.addedTime - b.addedTime || a.totalTime - b.totalTime);
      
      setDetourOptions(allOptions);
      console.log(`✅ Added ${newOptions.length} new detour options. Total: ${allOptions.length}`);
      
    } catch (error) {
      console.error('❌ Failed to load more detour options:', error);
    } finally {
      setLoadingMore(false);
    }
  };

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

          // Show loading immediately while we compute base route and gather places
          setLoadingDetours({ active: true, total: 0, done: 0, etaSec: null, label: 'Calculating route...', found: 0 });

          // Step 1: Get base route
          const mainRouteUrl = `http://localhost:3001/directions?origin=${position[0]},${position[1]}&destination=${loc.lat()},${loc.lng()}`;
          console.log('🛣️ Fetching base route:', mainRouteUrl);
          let mainRoute;
          let baseTimeSec = 0; // baseline (direct) route duration in seconds
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
            // Compute base route time (seconds)
            baseTimeSec = (mainRoute?.legs || []).reduce((sum, l) => sum + (l.duration?.value || 0), 0);
            setBaseRouteTimeSec(baseTimeSec);
          } catch (err) {
            console.error("❌ Failed to fetch base route:", err);
            // Hide loading overlay on error
            setLoadingDetours({ active: false, total: 0, done: 0, etaSec: null, label: '', found: 0 });
            return;
          }

          // Step 2: Decode main route polyline
          const mainPath = polyline.decode(mainRoute.overview_polyline.points); // [[lat, lng], ...]
          console.log('🗺️ Decoded main path points:', mainPath.length);
          const CORRIDOR_MILES = Math.max(1, Math.min(6, Number(corridorMiles) || 1));
          const CORRIDOR_KM = CORRIDOR_MILES * 1.60934;

          // Reset prior results while we compute options
          setPlaces([]);
          setDetourOptions([]);

          // Step 3: Sample along the route and fetch places near those samples
          // Adaptive sampling: if corridor is tight (1 mile) and boost is off, sample sparser for speed
          const sampleEveryKm = samplingBoost ? 5 : ((Math.max(1, Math.min(6, Number(corridorMiles) || 1)) === 1) ? 9 : 5);
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
          let firstPageToken = null;
          // Initialize loading for sampling phase
          setLoadingDetours(prev => ({ ...prev, active: true, total: sampledCoords.length, done: 0, label: 'Finding restaurants along your route...', found: 0 }));
          for (const [sLat, sLng] of sampledCoords) {
            // Prefer rankby=distance to get places nearest to the path sample without sticking to a static radius
            const parts = [
              `lat=${sLat}`,
              `lng=${sLng}`,
              `rankby=distance`,
              `type=restaurant`
            ];
            if (cuisine) parts.push(`keyword=${encodeURIComponent(cuisine)}`);
            if (minPrice !== '') parts.push(`minprice=${minPrice}`);
            if (maxPrice !== '') parts.push(`maxprice=${maxPrice}`);
            const url = `http://localhost:3001/places?${parts.join('&')}`;
            console.log('🍕 Fetching places near sample:', url);
            try {
              const resp = await axios.get(url);
              const results = resp.data.results || [];
              for (const p of results) {
                if (!dedupeMap.has(p.place_id)) dedupeMap.set(p.place_id, p);
              }
              // Store the nextPageToken from the first successful request
              if (!firstPageToken && resp.data.next_page_token) {
                firstPageToken = resp.data.next_page_token;
              }
              console.log(`🍕 Added ${results.length}, unique so far: ${dedupeMap.size}`);
            } catch (e) {
              console.error('❌ Sample places fetch failed:', e?.response?.status, e?.response?.data || e);
            }
            // Update progress for sampling
            setLoadingDetours(prev => {
              const done = Math.min((prev.done || 0) + 1, prev.total || sampledCoords.length);
              return { ...prev, done, found: dedupeMap.size };
            });
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
          setAllPlaces(onRouteFoodPlaces);
          setNextPageToken(firstPageToken);
          console.log('✅ Set corridor places to state');

          // Step 4: Determine fastest detour routes via corridor places
          console.log('⏱️ Finding fastest detour routes...');
          const MAX_DETOURS = 30; // cap to reduce API calls
          // Prioritize by minimal offset to the main path (closest to route likely smaller detour)
          let candidates = onRouteFoodPlaces
            .map(p => {
              const lat = p.geometry?.location?.lat; const lng = p.geometry?.location?.lng;
              if (!lat || !lng) return null;
              const m = computeAlongRouteDistanceKm(lat, lng, mainPath);
              return { p, off: m.offsetKm };
            })
            .filter(Boolean)
            .sort((a,b)=>a.off-b.off)
            .slice(0, MAX_DETOURS)
            .map(x=>x.p);
          const options = [];

          // Initialize detour routing phase (keep found count, switch label; total now candidates length)
          const startTs = Date.now();
          setLoadingDetours(prev => ({ active: true, total: candidates.length, done: 0, etaSec: null, label: 'Scoring fastest detours...', found: prev.found || 0 }));

          // Concurrency: stream results in batches so UI updates immediately
          const CONCURRENCY = 5;
          const fetchOption = async (place) => {
            const url = `http://localhost:3001/directions?origin=${position[0]},${position[1]}&destination=${loc.lat()},${loc.lng()}&waypoint=${place.place_id}`;
            console.log(`🛣️ Checking route via "${place.name}":`, url);
            try {
              const res = await axios.get(url);
              const route = res.data.routes?.[0];
              if (!route) return;
              const totalTime = route.legs.reduce((sum, leg) => sum + leg.duration.value, 0);
              const addedTime = Math.max(0, totalTime - (baseTimeSec || 0));
              options.push({ place, totalTime, addedTime, route });
              // Stream update: refresh list with best-so-far
              setDetourOptions(prev => {
                const merged = [...options];
                merged.sort((a, b) => a.addedTime - b.addedTime || a.totalTime - b.totalTime);
                return merged;
              });
            } catch (error) {
              console.error(`❌ Error fetching route via "${place.name}":`, error);
            } finally {
              setLoadingDetours(prev => {
                const done = Math.min((prev.done || 0) + 1, prev.total || candidates.length);
                const elapsed = Math.max(0.001, (Date.now() - startTs) / 1000);
                const avg = elapsed / done;
                const remaining = Math.max(0, Math.round(avg * ((prev.total || candidates.length) - done)));
                return { ...prev, done, etaSec: remaining };
              });
            }
          };

          for (let i = 0; i < candidates.length; i += CONCURRENCY) {
            const batch = candidates.slice(i, i + CONCURRENCY);
            await Promise.all(batch.map(fetchOption));
          }

          options.sort((a, b) => a.addedTime - b.addedTime || a.totalTime - b.totalTime);
          setDetourOptions(options);
          console.log('✅ Detour options ready:', options.length);

          // Hide loading overlay
          setLoadingDetours({ active: false, total: 0, done: 0, etaSec: null, label: '' });

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
  }, [position, places, cuisine, minPrice, maxPrice, corridorMiles, samplingBoost]);

  return (
    <div style={{ height: '100vh', width: '100vw', display: 'flex' }}>
      {/* Global Loading Overlay during detour computation */}
      {loadingDetours.active && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(255,255,255,0.8)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 3000,
          pointerEvents: 'none' /* allow interacting with the app while loading */
        }}>
          <div className="loader"></div>
          <div style={{ marginTop: 12, fontFamily: 'DM Sans, sans-serif', color: '#333', fontWeight: 600 }}>
            {loadingDetours.label || 'Loading...'}
          </div>
          {loadingDetours.found > 0 && (
            <div style={{ marginTop: 4, fontFamily: 'DM Sans, sans-serif', color: '#555', fontSize: 12 }}>
              Found {loadingDetours.found} restaurants so far
            </div>
          )}
          <div style={{ marginTop: 4, fontFamily: 'DM Sans, sans-serif', color: '#555', fontSize: 12 }}>
            {loadingDetours.done}/{loadingDetours.total}{loadingDetours.etaSec != null ? ` · ETA ~${Math.max(1, loadingDetours.etaSec)}s` : ''}
          </div>
        </div>
      )}
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

      {/* Baseline Time Display */}
      {baseRouteTimeSec > 0 && (
        <div style={{ 
          position: 'absolute', 
          top: '80px', 
          right: '20px', 
          backgroundColor: 'white', 
          padding: '12px 16px', 
          borderRadius: '8px', 
          boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
          zIndex: 1000,
          fontFamily: 'DM Sans, sans-serif'
        }}>
          <div style={{ fontSize: '14px', fontWeight: '600', color: '#333', marginBottom: '4px' }}>
            🚗 Baseline Route
          </div>
          <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#0a7' }}>
            {Math.round(baseRouteTimeSec / 60)} minutes
          </div>
          <div style={{ fontSize: '12px', color: '#666' }}>
            Direct route (no stops)
          </div>
        </div>
      )}

      {/* Filter Panel - Only shows after search results */}
      {(!confirmRoute && !navigation) && detourOptions && detourOptions.length > 0 && (
        <div style={{ 
          position: 'absolute', 
          top: '20px', 
          right: '200px', 
          backgroundColor: 'white', 
          padding: '12px', 
          borderRadius: '8px', 
          boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
          minWidth: '280px',
          zIndex: 1000,
          animation: 'slideInFromRight 0.4s ease-out'
        }}>
          <div style={{ fontSize: '14px', fontWeight: '600', color: '#333', marginBottom: '4px' }}>
            🔍 Filter Results
          </div>
          {/* Corridor width slider */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '12px', color: '#666', minWidth: 80 }}>Search width</span>
            <input
              type="range"
              min={1}
              max={6}
              step={1}
              value={corridorMiles}
              onChange={(e)=>setCorridorMiles(Number(e.target.value))}
              style={{ flex: 1 }}
            />
            <span style={{ fontSize: '12px', color: '#333', fontWeight: 600 }}>{corridorMiles} mi</span>
          </div>
          {/* Sampling density toggle */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '12px', color: '#666', minWidth: 80 }}>Sampling</span>
            <button
              onClick={()=>setSamplingBoost(v=>!v)}
              style={{ padding: '6px 10px', background: samplingBoost ? '#0ea5e9' : '#e5e7eb', color: samplingBoost ? 'white' : '#111827', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}
            >
              {samplingBoost ? 'Thorough (5 km)' : 'Fast (9/5 km)'}
            </button>
            <span style={{ fontSize: '11px', color: '#777' }}>
              {samplingBoost ? 'Higher coverage' : 'Faster load'}
            </span>
          </div>
          
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <select 
              value={uiCuisine} 
              onChange={(e) => setUiCuisine(e.target.value)}
              style={{ padding: '6px 8px', border: '1px solid #ddd', borderRadius: '6px', flex: 1 }}
            >
              <option value="">All Cuisines ({cuisineCounts[''] || 0})</option>
              <option value="chinese">Chinese ({cuisineCounts['chinese'] || 0})</option>
              <option value="italian">Italian ({cuisineCounts['italian'] || 0})</option>
              <option value="mexican">Mexican ({cuisineCounts['mexican'] || 0})</option>
              <option value="japanese">Japanese ({cuisineCounts['japanese'] || 0})</option>
              <option value="thai">Thai ({cuisineCounts['thai'] || 0})</option>
              <option value="indian">Indian ({cuisineCounts['indian'] || 0})</option>
              <option value="korean">Korean ({cuisineCounts['korean'] || 0})</option>
              <option value="vietnamese">Vietnamese ({cuisineCounts['vietnamese'] || 0})</option>
              <option value="french">French ({cuisineCounts['french'] || 0})</option>
              <option value="mediterranean">Mediterranean ({cuisineCounts['mediterranean'] || 0})</option>
              <option value="american">American ({cuisineCounts['american'] || 0})</option>
              <option value="pizza">Pizza ({cuisineCounts['pizza'] || 0})</option>
              <option value="sushi">Sushi ({cuisineCounts['sushi'] || 0})</option>
              <option value="seafood">Seafood ({cuisineCounts['seafood'] || 0})</option>
              <option value="steakhouse">Steakhouse ({cuisineCounts['steakhouse'] || 0})</option>
              <option value="fast food">Fast Food ({cuisineCounts['fast food'] || 0})</option>
              <option value="cafe">Cafe ({cuisineCounts['cafe'] || 0})</option>
              <option value="dessert">Dessert ({cuisineCounts['dessert'] || 0})</option>
              <option value="vegetarian">Vegetarian ({cuisineCounts['vegetarian'] || 0})</option>
              <option value="vegan">Vegan ({cuisineCounts['vegan'] || 0})</option>
            </select>
          </div>
          
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <span style={{ fontSize: '12px', color: '#666', minWidth: '40px' }}>Price:</span>
            <select value={uiMinPrice} onChange={(e)=>setUiMinPrice(e.target.value)} style={{ padding: '6px 8px', border: '1px solid #ddd', borderRadius: '6px', flex: 1 }}>
              <option value="">min</option>
              <option value="0">$</option>
              <option value="1">$$</option>
              <option value="2">$$$</option>
              <option value="3">$$$$</option>
              <option value="4">$$$$$</option>
            </select>
            <span style={{ color: '#999', fontSize: '12px' }}>to</span>
            <select value={uiMaxPrice} onChange={(e)=>setUiMaxPrice(e.target.value)} style={{ padding: '6px 8px', border: '1px solid #ddd', borderRadius: '6px', flex: 1 }}>
              <option value="">max</option>
              <option value="0">$</option>
              <option value="1">$$</option>
              <option value="2">$$$</option>
              <option value="3">$$$$</option>
              <option value="4">$$$$$</option>
            </select>
          </div>
          
          <div style={{ fontSize: '11px', color: '#777', fontStyle: 'italic' }}>
            Filtering {detourOptions.length} found restaurants
          </div>
        </div>
      )}

      {/* Animated Sidebar */}
      <div 
        style={{ 
          width: (navigation || confirmRoute || detourOptions.length > 0) ? '360px' : '0px',
          maxWidth: '40vw', 
          borderRight: '1px solid #eee', 
          padding: (navigation || confirmRoute || detourOptions.length > 0) ? '12px' : '0px',
          overflowY: 'auto',
          transition: 'all 0.5s cubic-bezier(0.4, 0, 0.2, 1)',
          transform: (navigation || confirmRoute || detourOptions.length > 0) ? 'translateX(0)' : 'translateX(-100%)',
          opacity: (navigation || confirmRoute || detourOptions.length > 0) ? 1 : 0,
          whiteSpace: 'nowrap'
        }}
      >
        {navigation ? (
          <div style={{ whiteSpace: 'normal' }}>
            <div style={{ fontWeight: 'bold', fontSize: '18px', marginBottom: '8px' }}>Navigation</div>
            {(() => {
              const idx = navigation.current || 0;
              const step = navigation.steps[idx];
              const remainingSec = navigation.steps.slice(idx).reduce((s, st) => s + (st.durationSec || 0), 0);
              return (
                <div style={{ padding: '12px', background: '#f8f9fa', border: '1px solid #e9ecef', borderRadius: '8px', marginBottom: '12px' }}>
                  <div style={{ fontSize: '16px', fontWeight: 600, marginBottom: '6px' }}>{step ? step.instruction : 'Arrived'}</div>
                  <div style={{ color: '#0a7', fontSize: '14px', fontWeight: 600 }}>ETA: {Math.max(1, Math.round(remainingSec/60))} min</div>
                  <div style={{ color: '#666', fontSize: '12px', marginTop: '6px' }}>Step {Math.min(idx+1, navigation.steps.length)} of {navigation.steps.length}</div>
                </div>
              );
            })()}
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                style={{ flex: 1, padding: '10px', background: '#ef4444', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 600, cursor: 'pointer' }}
                onClick={() => setNavigation(null)}
              >
                End
              </button>
              <button
                style={{ flex: 1, padding: '10px', background: '#6b7280', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 600, cursor: 'pointer' }}
                onClick={() => setNavigation((n) => n ? { ...n, current: Math.min((n.current||0)+1, n.steps.length-1) } : n)}
              >
                Skip step
              </button>
            </div>
          </div>
        ) : confirmRoute ? (
          <div style={{ whiteSpace: 'normal' }}>
            <div style={{ fontWeight: 'bold', fontSize: '18px', marginBottom: '8px' }}>Route Confirmation</div>
            <div style={{ padding: '12px', background: '#f8f9fa', border: '1px solid #e9ecef', borderRadius: '8px', marginBottom: '12px' }}>
              <div style={{ fontSize: '16px', fontWeight: 600, marginBottom: '6px' }}>{confirmRoute.place.name}</div>
              <div style={{ fontSize: '12px', color: '#666', marginBottom: '8px' }}>{confirmRoute.place.vicinity || confirmRoute.place.formatted_address || ''}</div>
              <div style={{ color: '#0a7', fontSize: '14px', fontWeight: '600' }}>Total: {Math.round((confirmRoute.totalTime||0)/60)} minutes</div>
              <div style={{ color: '#e11d48', fontSize: '13px', fontWeight: '700', marginTop: '2px' }}>+{Math.round((confirmRoute.addedTime||0)/60)} minutes vs baseline</div>
              <div style={{ color: '#666', fontSize: '12px', marginTop: '6px' }}>Baseline: {Math.round((baseRouteTimeSec||0)/60)} minutes</div>
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                style={{ flex: 1, padding: '10px', background: '#10b981', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 600, cursor: 'pointer' }}
                onClick={() => {
                  if (!confirmRoute?.route) return;
                  const steps = buildStepsFromRoute(confirmRoute.route);
                  if (steps.length === 0) return;
                  setNavigation({ steps, current: 0, route: confirmRoute.route });
                }}
              >
                Go
              </button>
              <button
                style={{ flex: 1, padding: '10px', background: '#6b7280', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 600, cursor: 'pointer' }}
                onClick={() => setConfirmRoute(null)}
              >
                Back
              </button>
            </div>
            {/* External Maps Links */}
            {(() => {
              if (!position || !destination || !confirmRoute?.place) return null;
              const o = `${position[0]},${position[1]}`;
              const d = `${destination[0]},${destination[1]}`;
              const wLat = confirmRoute.place.geometry?.location?.lat;
              const wLng = confirmRoute.place.geometry?.location?.lng;
              const pid = confirmRoute.place.place_id;
              // Build Google Maps URL using coordinates for waypoints plus waypoint_place_ids to bind to the exact place
              const wp = (Number.isFinite(wLat) && Number.isFinite(wLng)) ? `${wLat},${wLng}` : '';
              const googleUrl = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(o)}&destination=${encodeURIComponent(d)}&waypoints=${encodeURIComponent(wp)}&waypoint_place_ids=${pid}&travelmode=driving`;
              const appleLeg1 = (Number.isFinite(wLat) && Number.isFinite(wLng)) ? `https://maps.apple.com/?saddr=${encodeURIComponent(o)}&daddr=${encodeURIComponent(`${wLat},${wLng}`)}&dirflg=d` : null;
              const appleLeg2 = (Number.isFinite(wLat) && Number.isFinite(wLng)) ? `https://maps.apple.com/?saddr=${encodeURIComponent(`${wLat},${wLng}`)}&daddr=${encodeURIComponent(d)}&dirflg=d` : null;
              return (
                <div style={{ marginTop: '12px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  <a href={googleUrl} target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }}>
                    <div style={{ padding: '8px 12px', background: '#1a73e8', color: 'white', borderRadius: '6px', fontSize: '12px', fontWeight: 600 }}>Open in Google Maps</div>
                  </a>
                  {appleLeg1 && appleLeg2 && (
                    <>
                      <a href={appleLeg1} target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }}>
                        <div style={{ padding: '8px 12px', background: '#111827', color: 'white', borderRadius: '6px', fontSize: '12px', fontWeight: 600 }}>Apple Maps (to stop)</div>
                      </a>
                      <a href={appleLeg2} target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }}>
                        <div style={{ padding: '8px 12px', background: '#111827', color: 'white', borderRadius: '6px', fontSize: '12px', fontWeight: 600 }}>Apple Maps (to destination)</div>
                      </a>
                    </>
                  )}
                </div>
              );
            })()}
          </div>
        ) : (
          <>
            <div style={{ fontWeight: 'bold', fontSize: '18px', marginBottom: '8px', whiteSpace: 'normal' }}>
              🍕 Fastest food detours
            </div>

            {/* Results list */}
            {visibleOptions.length === 0 && (
              <div style={{ color: '#666', whiteSpace: 'normal' }}>Select a destination to see options.</div>
            )}
            {visibleOptions.map((opt, idx) => (
              <div 
                key={opt.place.place_id || idx} 
                style={{ 
                  padding: '12px 8px', 
                  borderBottom: '1px solid #f0f0f0', 
                  cursor: 'pointer',
                  borderRadius: '8px',
                  marginBottom: '4px',
                  transition: 'all 0.2s ease',
                  whiteSpace: 'normal',
                  backgroundColor: '#fafafa'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = '#f0f8ff';
                  e.currentTarget.style.transform = 'translateX(4px)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = '#fafafa';
                  e.currentTarget.style.transform = 'translateX(0)';
                }}
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
                  // Show detailed info popup
                  showPlaceInfo(opt.place, opt);
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <div style={{ fontWeight: 600, fontSize: '14px', marginBottom: '4px' }}>
                    {idx + 1}. {opt.place.name}
                  </div>
                  <div style={{ color: '#0a7', fontSize: '12px', fontWeight: '600' }}>+{Math.round((opt.addedTime || 0) / 60)} minutes</div>
                </div>
                <div style={{ color: '#555', fontSize: '11px', marginBottom: '2px' }}>
                  {opt.place.vicinity || opt.place.formatted_address || ''}
                </div>
                <div style={{ color: '#888', fontSize: '11px' }}>
                  Total: {Math.round(opt.totalTime / 60)} min{typeof opt.place.price_level === 'number' ? ` · ${'$'.repeat(opt.place.price_level + 1)}` : ''}
                </div>
                {opt.place.rating && (
                  <div style={{ color: '#ff6b35', fontSize: '11px', marginTop: '2px' }}>
                    ⭐ {opt.place.rating}/5 ({opt.place.user_ratings_total || 0} reviews)
                  </div>
                )}
              </div>
            ))}
            
            {/* Load More Button */}
            {(() => {
              const processedPlaceIds = new Set(detourOptions.map(opt => opt.place.place_id));
              const unprocessedPlaces = allPlaces.filter(place => !processedPlaceIds.has(place.place_id));
              const hasUnprocessedPlaces = unprocessedPlaces.length > 0;
              
              console.log('🔍 Debug - allPlaces:', allPlaces.length, 'detourOptions:', detourOptions.length, 'unprocessed:', unprocessedPlaces.length);
              
              return detourOptions.length > 0 && (
                <div style={{ 
                  padding: '12px 8px', 
                  textAlign: 'center',
                  borderTop: '1px solid #f0f0f0',
                  marginTop: '8px'
                }}>
                  <button
                    onClick={loadMorePlaces}
                    disabled={loadingMore || !hasUnprocessedPlaces}
                    style={{
                      padding: '8px 16px',
                      backgroundColor: loadingMore ? '#ccc' : (hasUnprocessedPlaces ? '#007bff' : '#6c757d'),
                      color: 'white',
                      border: 'none',
                      borderRadius: '6px',
                      cursor: (loadingMore || !hasUnprocessedPlaces) ? 'not-allowed' : 'pointer',
                      fontSize: '12px',
                      fontWeight: '600',
                      transition: 'all 0.2s ease'
                    }}
                    onMouseEnter={(e) => {
                      if (!loadingMore && hasUnprocessedPlaces) {
                        e.currentTarget.style.backgroundColor = '#0056b3';
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!loadingMore && hasUnprocessedPlaces) {
                        e.currentTarget.style.backgroundColor = '#007bff';
                      }
                    }}
                  >
                    {loadingMore ? 'Loading Next 10...' : (hasUnprocessedPlaces ? `Load Next 10 Detours (${unprocessedPlaces.length} left)` : 'All Processed')}
                  </button>
                  <div style={{ fontSize: '10px', color: '#666', marginTop: '4px' }}>
                    {detourOptions.length} detour options • {allPlaces.length} restaurants found • {unprocessedPlaces.length} unprocessed
                  </div>
                </div>
              );
            })()}
          </>
        )}
      </div>

      {position ? (
        <div style={{ flex: 1, minWidth: 0 }}>
          <GoogleMap
            position={position}
            destination={destination}
            places={places}
            bestRouteCoords={bestRouteCoords}
            onPlaceClick={async (place) => {
              const lat = place.geometry?.location?.lat;
              const lng = place.geometry?.location?.lng;
              if (lat && lng && mapRef.current) {
                mapRef.current.panTo({ lat, lng });
                mapRef.current.setZoom(16);
              }
              // Fetch route via this place so we can show added time and enable 'Use This Route'
              try {
                if (!position || !destination) {
                  showPlaceInfo(place);
                  return;
                }
                const url = `http://localhost:3001/directions?origin=${position[0]},${position[1]}&destination=${destination[0]},${destination[1]}&waypoint=${place.place_id}`;
                const res = await axios.get(url);
                const route = res.data.routes?.[0];
                if (!route) {
                  showPlaceInfo(place);
                  return;
                }
                const totalTime = route.legs.reduce((sum, leg) => sum + leg.duration.value, 0);
                const addedTime = Math.max(0, totalTime - (baseRouteTimeSec || 0));
                showPlaceInfo(place, { place, totalTime, addedTime, route });
              } catch (e) {
                console.warn('Failed to fetch route for marker click:', e);
                showPlaceInfo(place);
              }
            }}
            mapRef={mapRef}
            markerRefs={markerRefs}
          />
        </div>
      ) : (
        <p>Loading map...</p>
      )}

      {/* Place Info Popup */}
      {showInfoPopup && selectedPlace && (
        <div 
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 2000
          }}
          onClick={() => setShowInfoPopup(false)}
        >
          <div 
            style={{
              backgroundColor: 'white',
              borderRadius: '12px',
              padding: '24px',
              maxWidth: '500px',
              width: '90%',
              maxHeight: '80vh',
              overflowY: 'auto',
              boxShadow: '0 20px 40px rgba(0, 0, 0, 0.3)',
              transform: 'scale(0.9)',
              animation: 'popupIn 0.3s ease-out forwards'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h2 style={{ margin: 0, fontSize: '24px', fontWeight: 'bold' }}>{selectedPlace.place.name}</h2>
              <button 
                onClick={() => setShowInfoPopup(false)}
                style={{
                  background: 'none',
                  border: 'none',
                  fontSize: '24px',
                  cursor: 'pointer',
                  color: '#666'
                }}
              >
                ×
              </button>
            </div>
            
            {/* Removed popup filter controls per request */}

            <div style={{ marginBottom: '16px' }}>
              <div style={{ color: '#555', fontSize: '14px', marginBottom: '8px' }}>
                📍 {selectedPlace.place.vicinity || selectedPlace.place.formatted_address || 'Address not available'}
              </div>
              
              {selectedPlace.place.rating && (
                <div style={{ color: '#ff6b35', fontSize: '16px', marginBottom: '8px' }}>
                  ⭐ {selectedPlace.place.rating}/5 ({selectedPlace.place.user_ratings_total || 0} reviews)
                </div>
              )}
              
              {typeof selectedPlace.place.price_level === 'number' && (
                <div style={{ color: '#0a7', fontSize: '14px', marginBottom: '8px' }}>
                  💰 Price Level: {'$'.repeat(selectedPlace.place.price_level + 1)}
                </div>
              )}
              
              {selectedPlace.place.types && (
                <div style={{ color: '#666', fontSize: '12px', marginBottom: '8px' }}>
                  🏷️ {selectedPlace.place.types.slice(0, 3).join(', ')}
                </div>
              )}
            </div>

            {selectedPlace.routeInfo && (
              <div style={{ 
                backgroundColor: '#f8f9fa', 
                padding: '16px', 
                borderRadius: '8px',
                border: '1px solid #e9ecef'
              }}>
                <h3 style={{ margin: '0 0 8px 0', fontSize: '18px', color: '#333' }}>Route Information</h3>
                <div style={{ color: '#0a7', fontSize: '16px', fontWeight: '500', marginBottom: '4px' }}>
                  ⏱️ Total Time: {Math.round(selectedPlace.routeInfo.totalTime / 60)} minutes
                </div>
                <div style={{ color: '#e11d48', fontSize: '14px', fontWeight: '600', marginBottom: '4px' }}>
                  (+{Math.round((selectedPlace.routeInfo.addedTime || 0) / 60)} minutes)
                </div>
                <div style={{ color: '#666', fontSize: '14px' }}>
                  🛣️ Route: {selectedPlace.routeInfo.route.summary || 'Route details'}
                </div>
              </div>
            )}

            <div style={{ marginTop: '20px', display: 'flex', gap: '12px' }}>
              <button 
                style={{
                  flex: 1,
                  padding: '12px',
                  backgroundColor: '#3b82f6',
                  color: 'white',
                  border: 'none',
                  borderRadius: '8px',
                  fontSize: '16px',
                  fontWeight: '500',
                  cursor: 'pointer'
                }}
                onClick={() => {
                  const lat = selectedPlace.place.geometry?.location?.lat;
                  const lng = selectedPlace.place.geometry?.location?.lng;
                  if (lat && lng && mapRef.current) {
                    mapRef.current.panTo({ lat, lng });
                    mapRef.current.setZoom(16);
                  }
                  setShowInfoPopup(false);
                }}
              >
                🗺️ View on Map
              </button>
              
              {selectedPlace.routeInfo && (
                <button 
                  style={{
                    flex: 1,
                    padding: '12px',
                    backgroundColor: '#10b981',
                    color: 'white',
                    border: 'none',
                    borderRadius: '8px',
                    fontSize: '16px',
                    fontWeight: '500',
                    cursor: 'pointer'
                  }}
                  onClick={() => {
                    const decoded = polyline.decode(selectedPlace.routeInfo.route.overview_polyline.points);
                    const latLngs = decoded.map(([lat, lng]) => [lat, lng]);
                    setBestRouteCoords(latLngs);
                    setConfirmRoute(selectedPlace.routeInfo);
                    setShowInfoPopup(false);
                  }}
                >
                  🚗 Use This Route
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      <style jsx>{`
        /* Cool loading dot animation */
        .loader {
          --s: 28px;
          height: var(--s);
          aspect-ratio: 2.5;
          --_g: #000 90%,#0000;
          --_g0: no-repeat radial-gradient(farthest-side          ,var(--_g));
          --_g1: no-repeat radial-gradient(farthest-side at top   ,var(--_g));
          --_g2: no-repeat radial-gradient(farthest-side at bottom,var(--_g));
          background: var(--_g0), var(--_g1), var(--_g2), var(--_g0), var(--_g1), var(--_g2);
          background-size: 20% 50%,20% 25%,20% 25%;
          animation: l45 1s infinite; 
        }
        @keyframes l45 {
          0%   {background-position:calc(0*100%/3) 50%,calc(1*100%/3) calc(50% + calc(var(--s)/8)),calc(1*100%/3) calc(50% - calc(var(--s)/8)), calc(3*100%/3) 50%,calc(2*100%/3) calc(50% + calc(var(--s)/8)),calc(2*100%/3) calc(50% - calc(var(--s)/8))}
          33%  {background-position:calc(0*100%/3) 50%,calc(1*100%/3) 100%           ,calc(1*100%/3) 0              , calc(3*100%/3) 50%,calc(2*100%/3) 100%           ,calc(2*100%/3) 0              }
          66%  {background-position:calc(1*100%/3) 50%,calc(0*100%/3) 100%           ,calc(0*100%/3) 0              , calc(2*100%/3) 50%,calc(3*100%/3) 100%           ,calc(3*100%/3) 0              }
          90%,
          100% {background-position:calc(1*100%/3) 50%,calc(0*100%/3) calc(50% + calc(var(--s)/8)),calc(0*100%/3) calc(50% - calc(var(--s)/8)), calc(2*100%/3) 50%,calc(3*100%/3) calc(50% + calc(var(--s)/8)),calc(3*100%/3) calc(50% - calc(var(--s)/8))}
        }
        @keyframes popupIn {
          from {
            transform: scale(0.9);
            opacity: 0;
          }
          to {
            transform: scale(1);
            opacity: 1;
          }
        }
        
        @keyframes slideInFromRight {
          from {
            transform: translateX(100%);
            opacity: 0;
          }
          to {
            transform: translateX(0);
            opacity: 1;
          }
        }
      `}</style>
    </div>
  );
}

export default App;
