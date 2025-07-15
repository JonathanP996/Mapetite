import React, { useState, useEffect, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline } from 'react-leaflet';
import L from 'leaflet';
import axios from 'axios';
import polyline from '@mapbox/polyline';
import 'leaflet/dist/leaflet.css';

function App() {
  const [position, setPosition] = useState(null);
  const [places, setPlaces] = useState([]); // stores nearby food places
  const [destination, setDestination] = useState(null); // user-selected destination
  const [destinationQuery, setDestinationQuery] = useState('');
  const [bestRouteCoords, setBestRouteCoords] = useState([]);
  const autocompleteRef = useRef(null);
  const inputRef = useRef(null);

  // Custom pizza icon
  const pizzaIcon = new L.Icon({
    iconUrl: 'https://cdn-icons-png.flaticon.com/512/1046/1046784.png', // pizza slice icon
    iconSize: [32, 32],  // Size of the pizza icon
    iconAnchor: [16, 32],  // Point of the icon that will sit on the marker's position
    popupAnchor: [0, -32],  // Position of the popup relative to the marker
  });

  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          const { latitude, longitude } = pos.coords;
          const userPos = [latitude, longitude];
          setPosition(userPos);

          try {
            const response = await axios.get(`http://localhost:3001/places?lat=${latitude}&lng=${longitude}`);
            setPlaces(response.data.results);
          } catch (err) {
            console.error("Error fetching places from proxy:", err);
          }
        },
        async (err) => {
          console.error("Geolocation error:", err);
          const fallbackPos = [33.7490, -84.3880];
          setPosition(fallbackPos);
          try {
            const response = await axios.get(`http://localhost:3001/places?lat=${fallbackPos[0]}&lng=${fallbackPos[1]}`);
            setPlaces(response.data.results);
          } catch (err) {
            console.error("Error fetching places for fallback location:", err);
          }
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
      if (loc) {
        setDestination([loc.lat(), loc.lng()]);
        setDestinationQuery(place.formatted_address || '');

        (async () => {
          if (!position || places.length === 0) return;

          // Step 1: Get base route
          const mainRouteUrl = `http://localhost:3001/directions?origin=${position[0]},${position[1]}&destination=${loc.lat()},${loc.lng()}`;
          let mainRoute;
          try {
            const mainRouteRes = await axios.get(mainRouteUrl);
            mainRoute = mainRouteRes.data.routes[0];
          } catch (err) {
            console.error("Failed to fetch base route:", err);
            return;
          }

          // Step 2: Decode main route polyline
          const mainPath = polyline.decode(mainRoute.overview_polyline.points); // [[lat, lng], ...]
          const MAX_DISTANCE_DEGREES = 0.01; // ~1km

          // Step 3: Filter food spots that are close to the path
          const onRouteFoodPlaces = places.filter((place) => {
            const lat = place.geometry?.location?.lat;
            const lng = place.geometry?.location?.lng;
            if (!lat || !lng) return false;

            return mainPath.some(([rLat, rLng]) => {
              const latDiff = Math.abs(rLat - lat);
              const lngDiff = Math.abs(rLng - lng);
              return latDiff < MAX_DISTANCE_DEGREES && lngDiff < MAX_DISTANCE_DEGREES;
            });
          });

          // Step 4: Determine fastest detour route via food spot
          let shortestTime = Infinity;
          let bestRoute = null;

          for (const place of onRouteFoodPlaces) {
            const url = `http://localhost:3001/directions?origin=${position[0]},${position[1]}&destination=${loc.lat()},${loc.lng()}&waypoint=${place.place_id}`;

            try {
              const res = await axios.get(url);
              const route = res.data.routes[0];
              const totalTime = route.legs.reduce((sum, leg) => sum + leg.duration.value, 0);

              if (totalTime < shortestTime) {
                shortestTime = totalTime;
                bestRoute = route;
              }
            } catch (error) {
              console.error("Error fetching route via food:", error);
            }
          }

          // Step 5: Draw best route
          if (bestRoute) {
            const decoded = polyline.decode(bestRoute.overview_polyline.points);
            const latLngs = decoded.map(([lat, lng]) => [lat, lng]);
            setBestRouteCoords(latLngs);
          }
        })();
      }
    });
  }, [position, places]);

  return (
    <div style={{ height: '100vh', width: '100vw' }}>
      <div style={{ padding: '10px', background: 'white', zIndex: 999, position: 'absolute' }}>
        <input
          ref={inputRef}
          type="text"
          value={destinationQuery}
          onChange={(e) => setDestinationQuery(e.target.value)}
          placeholder="Enter a destination..."
        />
      </div>

      {position ? (
        <MapContainer center={position} zoom={15} style={{ height: '100%', width: '100%' }}>
          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />

          {/* Marker for your location */}
          <Marker position={position}>
            <Popup>You’re here 📍</Popup>
          </Marker>

          {/* Marker for destination */}
          {destination && (
            <Marker position={destination}>
              <Popup>Destination 📍</Popup>
            </Marker>
          )}

          {/* Fallback popup if no places found */}
          {places.length === 0 && (
            <Marker position={position}>
              <Popup>No food places found nearby 🍽️</Popup>
            </Marker>
          )}

          {/* Food places */}
          {places.map((place, index) => {
            const lat = place.geometry?.location?.lat;
            const lng = place.geometry?.location?.lng;
            if (!lat || !lng) return null;

            return (
              <Marker key={place.place_id || index} position={[lat, lng]} icon={pizzaIcon}>
                <Popup>
                  <strong>{place.name}</strong><br />
                  {place.vicinity || 'No address available'}
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