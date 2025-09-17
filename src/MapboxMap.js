import React, { useRef, useEffect, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';

// Ensure Mapbox GL always has an access token set
mapboxgl.accessToken = process.env.REACT_APP_MAPBOX_TOKEN || '';

const MapboxMap = ({ 
  position, 
  destination, 
  places, 
  bestRouteCoords, 
  onPlaceClick,
  mapRef,
  markerRefs 
}) => {
  const mapContainer = useRef(null);
  const [map, setMap] = useState(null);
  const [directions, setDirections] = useState(null);

  useEffect(() => {
    if (!mapContainer.current) return;

    const mapInstance = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/streets-v12',
      center: position || [0, 0],
      zoom: 15,
      accessToken: process.env.REACT_APP_MAPBOX_TOKEN
    });

    mapInstance.on('load', () => {
      setMap(mapInstance);
      if (mapRef) mapRef.current = mapInstance;
      
      // Add navigation control
      mapInstance.addControl(new mapboxgl.NavigationControl(), 'top-right');
    });

    return () => {
      mapInstance.remove();
    };
  }, []);

  // Fetch and display directions when destination changes
  useEffect(() => {
    if (!map || !position || !destination) return;

    const fetchDirections = async () => {
      try {
        const response = await fetch(
          `https://api.mapbox.com/directions/v5/mapbox/driving/${position[1]},${position[0]};${destination[1]},${destination[0]}?geometries=geojson&access_token=${process.env.REACT_APP_MAPBOX_TOKEN}`
        );
        const data = await response.json();
        
        if (data.routes && data.routes.length > 0) {
          const route = data.routes[0];
          
          // Remove existing route source if it exists
          if (map.getSource('route')) {
            map.removeLayer('route');
            map.removeSource('route');
          }
          
          // Add new route
          map.addSource('route', {
            type: 'geojson',
            data: {
              type: 'Feature',
              properties: {},
              geometry: route.geometry
            }
          });
          
          map.addLayer({
            id: 'route',
            type: 'line',
            source: 'route',
            layout: {
              'line-join': 'round',
              'line-cap': 'round'
            },
            paint: {
              'line-color': '#3b82f6',
              'line-width': 4,
              'line-opacity': 0.8
            }
          });
          
          // Fit map to route bounds
          const coordinates = route.geometry.coordinates;
          const bounds = coordinates.reduce((bounds, coord) => {
            return bounds.extend(coord);
          }, new mapboxgl.LngLatBounds(coordinates[0], coordinates[0]));
          
          map.fitBounds(bounds, {
            padding: 50
          });
        }
      } catch (error) {
        console.error('Error fetching directions:', error);
      }
    };

    fetchDirections();
  }, [map, position, destination]);

  // Add markers when places change
  useEffect(() => {
    if (!map || !places.length) return;

    // Clear existing markers
    if (markerRefs.current) {
      Object.values(markerRefs.current).forEach(marker => {
        if (marker && marker.remove) marker.remove();
      });
      markerRefs.current = {};
    }

    // Add place markers
    places.forEach((place) => {
      const lat = place.geometry?.location?.lat;
      const lng = place.geometry?.location?.lng;
      if (!lat || !lng) return;

      const el = document.createElement('div');
      el.style.cssText = `
        width: 32px;
        height: 32px;
        background-image: url('https://cdn-icons-png.flaticon.com/512/1046/1046784.png');
        background-size: contain;
        background-repeat: no-repeat;
        cursor: pointer;
        border: 2px solid white;
        border-radius: 50%;
        box-shadow: 0 2px 4px rgba(0,0,0,0.3);
      `;
      
      el.addEventListener('click', () => {
        if (onPlaceClick) onPlaceClick(place);
      });

      const marker = new mapboxgl.Marker(el)
        .setLngLat([lng, lat])
        .addTo(map);

      if (place.place_id) {
        markerRefs.current[place.place_id] = marker;
      }
    });
  }, [map, places, onPlaceClick]);

  // Add location markers
  useEffect(() => {
    if (!map) return;

    // Clear existing location markers
    const existingMarkers = document.querySelectorAll('.location-marker, .destination-marker');
    existingMarkers.forEach(marker => marker.remove());

    // Add current location marker
    if (position) {
      const locationEl = document.createElement('div');
      locationEl.className = 'location-marker';
      locationEl.style.cssText = `
        width: 20px;
        height: 20px;
        background-color: #3b82f6;
        border: 3px solid white;
        border-radius: 50%;
        box-shadow: 0 2px 4px rgba(0,0,0,0.3);
      `;

      new mapboxgl.Marker(locationEl)
        .setLngLat([position[1], position[0]])
        .setPopup(new mapboxgl.Popup().setHTML(`
          <div style="padding: 8px;">
            <strong>You're here 📍</strong>
          </div>
        `))
        .addTo(map);
    }

    // Add destination marker
    if (destination) {
      const destEl = document.createElement('div');
      destEl.className = 'destination-marker';
      destEl.style.cssText = `
        width: 20px;
        height: 20px;
        background-color: #ef4444;
        border: 3px solid white;
        border-radius: 50%;
        box-shadow: 0 2px 4px rgba(0,0,0,0.3);
      `;

      new mapboxgl.Marker(destEl)
        .setLngLat([destination[1], destination[0]])
        .setPopup(new mapboxgl.Popup().setHTML(`
          <div style="padding: 8px;">
            <strong>Destination 📍</strong>
          </div>
        `))
        .addTo(map);
    }
  }, [map, position, destination]);

  return (
    <div className="mapbox-container" style={{ width: '100%', height: '100%' }}>
      <div ref={mapContainer} style={{ width: '100%', height: '100%' }} />
    </div>
  );
};

export default MapboxMap;
