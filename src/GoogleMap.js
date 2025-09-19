import React, { useEffect, useRef } from 'react';

const GoogleMap = ({
  position,
  destination,
  places,
  bestRouteCoords,
  onPlaceClick,
  mapRef,
  markerRefs
}) => {
  const mapContainer = useRef(null);
  const localMapRef = useRef(null);
  const routePolylineRef = useRef(null);

  useEffect(() => {
    if (!mapContainer.current) return;
    if (!window.google) return;

    const google = window.google;

    const center = Array.isArray(position) && Number.isFinite(position[0]) && Number.isFinite(position[1])
      ? { lat: position[0], lng: position[1] }
      : { lat: 0, lng: 0 };

    const map = new google.maps.Map(mapContainer.current, {
      center,
      zoom: 15,
      mapTypeControl: false,
      fullscreenControl: false,
      streetViewControl: false,
    });

    localMapRef.current = map;
    if (mapRef) mapRef.current = map;

    return () => {
      // No explicit destroy API; allow GC to collect
    };
  }, []);

  // Keep center in sync when position changes
  useEffect(() => {
    const map = localMapRef.current;
    if (!map || !Array.isArray(position)) return;
    const [lat, lng] = position;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    map.setCenter({ lat, lng });
  }, [position]);

  // Draw or update route polyline
  useEffect(() => {
    const map = localMapRef.current;
    if (!map) return;

    if (routePolylineRef.current) {
      routePolylineRef.current.setMap(null);
      routePolylineRef.current = null;
    }

    if (bestRouteCoords && bestRouteCoords.length > 1) {
      const path = bestRouteCoords
        .filter(arr => Array.isArray(arr) && Number.isFinite(arr[0]) && Number.isFinite(arr[1]))
        .map(([lat, lng]) => ({ lat, lng }));
      if (path.length < 2) return;
      routePolylineRef.current = new window.google.maps.Polyline({
        path,
        strokeColor: '#3b82f6',
        strokeOpacity: 0.8,
        strokeWeight: 4,
      });
      routePolylineRef.current.setMap(map);

      const bounds = new window.google.maps.LatLngBounds();
      path.forEach(p => bounds.extend(p));
      map.fitBounds(bounds, { top: 50, right: 50, bottom: 50, left: 50 });
    }
  }, [bestRouteCoords]);

  // Render places markers
  useEffect(() => {
    const map = localMapRef.current;
    if (!map) return;

    if (markerRefs.current) {
      Object.values(markerRefs.current).forEach(marker => {
        if (marker && marker.setMap) marker.setMap(null);
      });
      markerRefs.current = {};
    }

    (places || []).forEach((place) => {
      const lat = place.geometry?.location?.lat;
      const lng = place.geometry?.location?.lng;
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

      const marker = new window.google.maps.Marker({
        position: { lat, lng },
        map,
        title: place.name || 'Place',
      });

      if (onPlaceClick) {
        marker.addListener('click', () => {
          onPlaceClick(place);
        });
      }

      if (place.place_id) {
        markerRefs.current[place.place_id] = marker;
      }
    });
  }, [places, onPlaceClick]);

  // Render current location and destination markers
  useEffect(() => {
    const map = localMapRef.current;
    if (!map) return;

    // Current position marker
    let posMarker = null;
    if (Array.isArray(position) && Number.isFinite(position[0]) && Number.isFinite(position[1])) {
      posMarker = new window.google.maps.Marker({
        position: { lat: position[0], lng: position[1] },
        map,
        icon: {
          path: window.google.maps.SymbolPath.CIRCLE,
          scale: 7,
          fillColor: '#3b82f6',
          fillOpacity: 1,
          strokeColor: 'white',
          strokeWeight: 3,
        },
      });
    }

    // Destination marker
    let destMarker = null;
    if (Array.isArray(destination) && Number.isFinite(destination[0]) && Number.isFinite(destination[1])) {
      destMarker = new window.google.maps.Marker({
        position: { lat: destination[0], lng: destination[1] },
        map,
        icon: {
          path: window.google.maps.SymbolPath.CIRCLE,
          scale: 7,
          fillColor: '#ef4444',
          fillOpacity: 1,
          strokeColor: 'white',
          strokeWeight: 3,
        },
      });
    }

    return () => {
      if (posMarker) posMarker.setMap(null);
      if (destMarker) destMarker.setMap(null);
    };
  }, [position, destination]);

  return (
    <div style={{ width: '100%', height: '100%' }}>
      <div ref={mapContainer} style={{ width: '100%', height: '100%' }} />
    </div>
  );
};

export default GoogleMap;
