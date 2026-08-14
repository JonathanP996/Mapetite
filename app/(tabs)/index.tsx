import * as Location from 'expo-location';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import MapView, { Marker, Polyline } from 'react-native-maps';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function App() {
  // for just normal searching before hitting enter
  const [search, setSearch] = useState('');
  // for the loading spinner
  const [loading, setLoading] = useState(false);

  const GEOAPIFY_KEY = process.env.EXPO_PUBLIC_GEOAPIFY_KEY;
  
  // For autocomplete suggestions
  const [suggestions, setSuggestions] = useState<any[]>([]);

  // for the route
  const [routeCoords, setRouteCoords] = useState<{latitude: number, longitude: number}[]>([]);
  
  // Holds the food spots found by the API
  const [foodSpots, setFoodSpots] = useState<any[]>([]);

  // user's current location
  const [region, setRegion] = useState<{
    latitude: number;
    longitude: number;
    latitudeDelta: number;
    longitudeDelta: number;
  } | undefined>(undefined);

  useEffect(() => {
    async function getCurrentLocation() {
      let { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          'Permission Denied', 
          'Please enable location services to see your current position on the map.'
        );
      }

      let location = await Location.getCurrentPositionAsync({});
      setRegion({
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
        latitudeDelta: 0.05,
        longitudeDelta: 0.05,
      });
    }
    getCurrentLocation();
  }, []);

  const handleTextChange = async (text: string) => {
    setSearch(text);

    if (text.length < 3) {
      setSuggestions([]);
      return;
    }
    setLoading(true);
    try {
      const response = await fetch(
        `https://api.geoapify.com/v1/geocode/autocomplete?text=${encodeURIComponent(text)}&apiKey=${GEOAPIFY_KEY}`
      ); 
      const data = await response.json();
      
      if (data.features) {
        setSuggestions(data.features);
      }
    } catch (error) {
      console.error('Autocomplete error:', error);
    }
    setLoading(false);
  };

  const handleSelectSuggestion = async (item: any) => {
    const [lon, lat] = item.geometry.coordinates;
    const formattedAddress = item.properties.formatted;
    setSearch(formattedAddress);
    setSuggestions([]);

    if (!region) return;
    
    // 1. Move the camera so both start and end are somewhat visible
    setRegion({
      latitude: (region.latitude + lat) / 2,
      longitude: (region.longitude + lon) / 2,
      latitudeDelta: Math.abs(region.latitude - lat) * 1.5 || 0.05,
      longitudeDelta: Math.abs(region.longitude - lon) * 1.5 || 0.05,
    });

    setLoading(true);

    try {
      // 2. Fetch the route from Geoapify Routing API
      const routeResponse = await fetch(
        `https://api.geoapify.com/v1/routing?waypoints=${region.latitude},${region.longitude}|${lat},${lon}&mode=drive&apiKey=${GEOAPIFY_KEY}`
      );
      const routeData = await routeResponse.json();

      if (routeData.features && routeData.features.length > 0) {
        const rawCoords = routeData.features[0].geometry.coordinates[0];
        const formattedCoords = rawCoords.map((coord: any[]) => ({
          latitude: coord[1],
          longitude: coord[0]
        }));
        setRouteCoords(formattedCoords);
      }

      // 3. Fetch the food spots near the destination
      const placesResponse = await fetch(
        `https://api.geoapify.com/v2/places?categories=catering.fast_food,catering.restaurant&filter=circle:${lon},${lat},5000&limit=20&apiKey=${GEOAPIFY_KEY}`
      );
      const placesData = await placesResponse.json();
      
      if (placesData.features) {
        setFoodSpots(placesData.features);
      }

    } catch (error) {
      console.error('Routing/Places error:', error);
      Alert.alert('Error', 'Could not calculate route or fetch places.');
    }
    setLoading(false);
  };

  return (
    <View style={styles.container}>
      {/* Map itself */}
      {region && (
        <MapView 
          style={styles.map} 
          region={region} 
          showsUserLocation={true}
        >
          {routeCoords.length > 0 && (
            <Polyline 
              coordinates={routeCoords} 
              strokeColor="#007AFF"
              strokeWidth={5} 
            />
          )}

          {foodSpots.map((spot, index) => {
            const [spotLon, spotLat] = spot.geometry.coordinates;
            return (
              <Marker
                key={index}
                coordinate={{ latitude: spotLat, longitude: spotLon }}
                title={spot.properties.name || "Food Spot"}
                description={spot.properties.street || "Unknown address"}
              />
            );
          })}
        </MapView> 
      )}
      
      <SafeAreaView style={styles.searchContainer}>
        <View style={styles.searchBarWrapper}>
          <TextInput 
            placeholder="Search destination..."
            value={search}
            style={styles.searchBar}
            returnKeyType="search"
            onChangeText={handleTextChange}
            clearButtonMode="while-editing"
          />
          {suggestions.length > 0 && ( 
            <View style={styles.dropdown}>
              <FlatList
                data={suggestions}
                keyExtractor={(item, index) => index.toString()}
                renderItem={({ item }) => (
                  <TouchableOpacity 
                    style={styles.suggestionItem} 
                    onPress={() => handleSelectSuggestion(item)}
                  >
                    <Text numberOfLines={1}>{item.properties.formatted}</Text>
                  </TouchableOpacity>
                )}
              />
            </View>
          )}
          {loading && <ActivityIndicator style={styles.spinner}/>}
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  map: {
    width: '100%',
    height: '100%',
  },
  searchContainer: {
    position: 'absolute',
    top: 20,
    left: 10,
    right: 10,
    zIndex: 1,
  },
  searchBarWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderRadius: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  searchBar: {
    flex: 1,
    height: 50,
    paddingHorizontal: 16,
    fontSize: 16,
  },
  spinner: {
    paddingRight: 16,
  },
  dropdown: {
    backgroundColor: 'white',
    marginTop: 5,
    borderRadius: 8,
    maxHeight: 200,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  suggestionItem: {
    padding: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
});