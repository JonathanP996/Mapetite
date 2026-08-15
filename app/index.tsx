import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import * as Location from 'expo-location';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Dimensions,
  Easing,
  FlatList,
  Keyboard,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from 'react-native';
import MapView, { Marker, Polyline } from 'react-native-maps';

const SCREEN_WIDTH = Dimensions.get('window').width;

export default function App() {
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [routeCoords, setRouteCoords] = useState<{latitude: number, longitude: number}[]>([]);
  const [foodSpots, setFoodSpots] = useState<any[]>([]);
  const [region, setRegion] = useState<{
    latitude: number;
    longitude: number;
    latitudeDelta: number;
    longitudeDelta: number;
  } | undefined>(undefined);

  const [searchRadius, setSearchRadius] = useState(4828); 
  const [isExpanded, setIsExpanded] = useState(false);

  const GEOAPIFY_KEY = process.env.EXPO_PUBLIC_GEOAPIFY_KEY;

  const masterAnim = useRef(new Animated.Value(0)).current;
  const searchInputRef = useRef<TextInput>(null);

  useEffect(() => {
    async function getCurrentLocation() {
      let { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Denied', 'Please enable location services.');
        return;
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

  const expandPanel = () => {
    setIsExpanded(true);
    Animated.sequence([
      Animated.timing(masterAnim, {
        toValue: 1,
        duration: 600,
        easing: Easing.inOut(Easing.quad),
        useNativeDriver: false,
      }),
      Animated.delay(150),
      Animated.timing(masterAnim, {
        toValue: 2,
        // Sped back up for a snappy, responsive ink bleed
        duration: 700, 
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      })
    ]).start(() => {
      searchInputRef.current?.focus();
    });
  };

  const collapsePanel = () => {
    Keyboard.dismiss();
    Animated.sequence([
      Animated.timing(masterAnim, {
        toValue: 1,
        duration: 600,
        easing: Easing.inOut(Easing.cubic),
        useNativeDriver: false,
      }),
      Animated.delay(100),
      Animated.timing(masterAnim, {
        toValue: 0,
        duration: 500,
        easing: Easing.inOut(Easing.quad),
        useNativeDriver: false,
      })
    ]).start(() => setIsExpanded(false));
  };

  // --- Dynamic Positioning & Sizing ---
  const panelBottom = masterAnim.interpolate({
    inputRange: [0, 1, 2],
    outputRange: [40, 490, 372.5] 
  });
  
  const panelHeight = masterAnim.interpolate({
    inputRange: [0, 1, 2],
    outputRange: [105, 105, 340] 
  });

  const panelWidth = masterAnim.interpolate({
    inputRange: [0, 1, 2],
    outputRange: [105, 105, SCREEN_WIDTH * 0.92] 
  });

  const panelRadius = masterAnim.interpolate({
    inputRange: [0, 1, 2],
    outputRange: [52.5, 52.5, 24] 
  });

  // --- Ink Bleed / Halo Math ---
  const bleedScale1 = masterAnim.interpolate({
    inputRange: [0, 1, 1.5, 2],
    outputRange: [1, 1, 1.08, 1] 
  });
  
  const bleedOpacity1 = masterAnim.interpolate({
    inputRange: [0, 1, 1.2, 1.8, 2],
    outputRange: [0, 0, 0.4, 0.4, 0] 
  });

  const bleedScale2 = masterAnim.interpolate({
    inputRange: [0, 1, 1.5, 2],
    outputRange: [1, 1, 1.14, 1] 
  });

  const bleedOpacity2 = masterAnim.interpolate({
    inputRange: [0, 1, 1.2, 1.8, 2],
    outputRange: [0, 0, 0.15, 0.15, 0]
  });

  // --- Fade Transitions ---
  const solidColorOpacity = masterAnim.interpolate({
    inputRange: [0, 1, 1.8, 2],
    outputRange: [1, 1, 1, 0] 
  });

  const blurOpacity = masterAnim.interpolate({
    inputRange: [0, 1, 1.8, 2],
    outputRange: [0, 0, 0, 1] 
  });

  const forkOpacity = masterAnim.interpolate({
    inputRange: [0, 1, 1.2, 2],
    outputRange: [1, 1, 0, 0] 
  });

  const contentOpacity = masterAnim.interpolate({
    inputRange: [0, 1, 1.6, 2],
    outputRange: [0, 0, 0, 1] 
  });

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
      if (data.features) setSuggestions(data.features);
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
    collapsePanel();

    if (!region) return;
    
    setRegion({
      latitude: (region.latitude + lat) / 2,
      longitude: (region.longitude + lon) / 2,
      latitudeDelta: Math.abs(region.latitude - lat) * 1.5 || 0.05,
      longitudeDelta: Math.abs(region.longitude - lon) * 1.5 || 0.05,
    });

    setLoading(true);

    try {
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

      const placesResponse = await fetch(
        `https://api.geoapify.com/v2/places?categories=catering.fast_food,catering.restaurant&filter=circle:${lon},${lat},${searchRadius}&limit=20&apiKey=${GEOAPIFY_KEY}`
      );
      const placesData = await placesResponse.json();
      if (placesData.features) setFoodSpots(placesData.features);
    } catch (error) {
      Alert.alert('Error', 'Could not calculate route or fetch places.');
    }
    setLoading(false);
  };

  const basePanelStyle = {
    position: 'absolute' as const,
    alignSelf: 'center' as const,
    height: panelHeight,
    width: panelWidth,
    bottom: panelBottom,
    borderRadius: panelRadius,
  };

  return (
    <View style={styles.container}>
      
      {region && (
        <MapView style={styles.map} region={region} showsUserLocation={true}>
          {routeCoords.length > 0 && (
            <Polyline coordinates={routeCoords} strokeColor="#007AFF" strokeWidth={5} />
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
      
      <Animated.View style={[basePanelStyle, { 
        backgroundColor: '#181818', 
        opacity: bleedOpacity2, 
        transform: [{ scale: bleedScale2 }] 
      }]} pointerEvents="none" />

      <Animated.View style={[basePanelStyle, { 
        backgroundColor: '#181818', 
        opacity: bleedOpacity1, 
        transform: [{ scale: bleedScale1 }] 
      }]} pointerEvents="none" />

      <Animated.View style={[basePanelStyle, styles.mainPanelWrapper]}>
        
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: blurOpacity }]}>
          <BlurView intensity={85} tint="dark" style={StyleSheet.absoluteFill} />
        </Animated.View>

        <Animated.View style={[StyleSheet.absoluteFill, { 
          backgroundColor: '#181818', 
          opacity: solidColorOpacity 
        }]} />
        
        <Animated.View 
          style={[styles.forkWrapper, { opacity: forkOpacity }]} 
          pointerEvents={isExpanded ? 'none' : 'auto'}
        >
          <TouchableOpacity onPress={expandPanel} style={styles.forkButton}>
            <MaterialCommunityIcons name="silverware-fork" size={48} color="#fff" />
          </TouchableOpacity>
        </Animated.View>

        <Animated.View 
          style={[StyleSheet.absoluteFill, { opacity: contentOpacity }]} 
          pointerEvents={isExpanded ? 'auto' : 'none'}
        >
          <View style={styles.searchRow}>
            <Ionicons name="search" size={20} color="#aaa" style={styles.searchIcon} />
            <TextInput 
              ref={searchInputRef}
              placeholder="Where are we going?"
              placeholderTextColor="#999"
              value={search}
              style={styles.searchBar}
              returnKeyType="search"
              onChangeText={handleTextChange}
              clearButtonMode="while-editing"
            />
            {loading && <ActivityIndicator color="#fff" style={styles.spinner}/>}
            
            <TouchableOpacity onPress={collapsePanel} style={styles.cancelBtn}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.hiddenContent}>
            <View style={styles.filterSection}>
              <Text style={styles.filterTitle}>Search Radius</Text>
              <View style={styles.pillContainer}>
                {[
                  { label: '1 Mi', value: 1609 },
                  { label: '3 Mi', value: 4828 },
                  { label: '5 Mi', value: 8046 }
                ].map((pill) => (
                  <TouchableOpacity
                    key={pill.label}
                    style={[
                      styles.filterPill,
                      searchRadius === pill.value && styles.filterPillActive
                    ]}
                    onPress={() => setSearchRadius(pill.value)}
                  >
                    <Text style={[
                      styles.filterPillText,
                      searchRadius === pill.value && styles.filterPillTextActive
                    ]}>
                      {pill.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {suggestions.length > 0 && ( 
              <View style={styles.dropdown}>
                <FlatList
                  data={suggestions}
                  keyExtractor={(item, index) => index.toString()}
                  keyboardShouldPersistTaps="handled"
                  renderItem={({ item }) => (
                    <TouchableOpacity 
                      style={styles.suggestionItem} 
                      onPress={() => handleSelectSuggestion(item)}
                    >
                      <Text style={styles.suggestionText} numberOfLines={1}>
                        {item.properties.formatted}
                      </Text>
                    </TouchableOpacity>
                  )}
                />
              </View>
            )}
          </View>
        </Animated.View>

      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  map: { width: '100%', height: '100%' },
  
  mainPanelWrapper: {
    overflow: 'hidden', 
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.5,
    shadowRadius: 15,
    elevation: 15,
  },

  forkWrapper: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
  forkButton: {
    width: 105,
    height: 105,
    justifyContent: 'center',
    alignItems: 'center',
  },
  
  searchRow: {
    height: 70, 
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  searchIcon: { marginRight: 10 },
  searchBar: {
    flex: 1,
    height: '100%',
    fontSize: 16,
    fontWeight: '500',
    color: '#ffffff',
  },
  spinner: { marginLeft: 10 },
  cancelBtn: { marginLeft: 12 },
  cancelText: {
    color: '#0a84ff', 
    fontSize: 16,
    fontWeight: '500',
  },

  hiddenContent: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 5,
  },
  filterSection: { marginBottom: 15 },
  filterTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#ccc',
    marginBottom: 10,
    marginLeft: 5,
  },
  pillContainer: {
    flexDirection: 'row',
    gap: 10,
  },
  filterPill: {
    paddingVertical: 8,
    paddingHorizontal: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  filterPillActive: {
    backgroundColor: '#0a84ff',
    borderColor: '#0a84ff',
  },
  filterPillText: {
    fontWeight: '600',
    color: '#bbb',
  },
  filterPillTextActive: { color: '#fff' },
  
  dropdown: {
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 12,
    flex: 1,
    marginBottom: 30, 
  },
  suggestionItem: {
    padding: 15,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.1)',
  },
  suggestionText: {
    color: '#ffffff',
    fontSize: 15,
  },
});