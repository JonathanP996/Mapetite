import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { BlurView } from 'expo-blur';
import * as Location from 'expo-location';
import React, { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Dimensions,
  Easing,
  FlatList,
  Keyboard,
  LayoutAnimation,
  PanResponder,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  UIManager,
  View
} from 'react-native';
import MapView, { Marker, Polyline } from 'react-native-maps';
import Svg, { Circle } from 'react-native-svg';

// Enable LayoutAnimation for Android
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const SCREEN_WIDTH = Dimensions.get('window').width;

const CUISINES = [
  'Restaurant', 'Cafe', 'FastFood', 'Bakery', 'Brewery', 
  'Pizza', 'Seafood'
];

// --- POLYLINE DECODER FUNCTION ---
const decodePolyline = (encoded: string) => {
  let points = [];
  let index = 0, len = encoded.length;
  let lat = 0, lng = 0;

  while (index < len) {
    let b, shift = 0, result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    let dlat = ((result & 1) ? ~(result >> 1) : (result >> 1));
    lat += dlat;

    shift = 0;
    result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    let dlng = ((result & 1) ? ~(result >> 1) : (result >> 1));
    lng += dlng;

    points.push({ latitude: (lat / 1E5), longitude: (lng / 1E5) });
  }
  return points;
};

// --- HAVERSINE DISTANCE CALCULATOR ---
const getDistanceInMeters = (lat1: number, lon1: number, lat2: number, lon2: number) => {
  const R = 6371e3; 
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
    Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
};

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

  const [recentSearches, setRecentSearches] = useState<any[]>([]);
  // --- NEW: Track the current destination for active filtering ---
  const [currentDestination, setCurrentDestination] = useState<{latitude: number, longitude: number} | null>(null);

  const [isSearchExpanded, setIsSearchExpanded] = useState(false);
  const [isResultsExpanded, setIsResultsExpanded] = useState(false);

  const [selectedCuisines, setSelectedCuisines] = useState<string[]>([]);
  const [isCuisineOpen, setIsCuisineOpen] = useState(false);

  const [appleToken, setAppleToken] = useState<string | null>(null);
  
  useEffect(() => {
    async function fetchAppleToken() {
      try {
        const response = await fetch('https://mapetite-server.vercel.app/api/token');
        const data = await response.json();
        if (data.accessToken) {
          setAppleToken(data.accessToken);
        }
      } catch (error) {
        console.error("🔴 Failed to fetch token from Vercel:", error);
      }
    }
    fetchAppleToken();
  }, []);

  // --- NEW: Load Recent Searches ---
  useEffect(() => {
    async function loadRecentSearches() {
      try {
        const storedSearches = await AsyncStorage.getItem('@mapetite_recents');
        if (storedSearches) {
          setRecentSearches(JSON.parse(storedSearches));
        }
      } catch (error) {
        console.error("🔴 Failed to load recent searches:", error);
      }
    }
    loadRecentSearches();
  }, []);

  const searchAnim = useRef(new Animated.Value(0)).current;  
  const resultsAnim = useRef(new Animated.Value(0)).current; 
  const resultsDragAnim = useRef(new Animated.Value(0)).current; 
  const loadingProgress = useRef(new Animated.Value(0)).current;
  const spinAnim = useRef(new Animated.Value(0)).current;
  const searchInputRef = useRef<TextInput>(null);

  const MAX_DRAG = 450; 
  const currentDrag = useRef(0);

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gestureState) => Math.abs(gestureState.dy) > 10,
      onPanResponderGrant: () => {
        resultsDragAnim.setOffset(currentDrag.current);
        resultsDragAnim.setValue(0);
      },
      onPanResponderMove: (_, gestureState) => {
        resultsDragAnim.setValue(-gestureState.dy);
      },
      onPanResponderRelease: (_, gestureState) => {
        resultsDragAnim.flattenOffset();
        const estimatedVal = currentDrag.current - gestureState.dy;

        if (estimatedVal > MAX_DRAG / 2 || gestureState.vy < -0.8) {
          Animated.spring(resultsDragAnim, { toValue: MAX_DRAG, friction: 8, useNativeDriver: false }).start(() => { currentDrag.current = MAX_DRAG; });
        } else {
          Animated.spring(resultsDragAnim, { toValue: 0, friction: 8, useNativeDriver: false }).start(() => { currentDrag.current = 0; });
        }
      }
    })
  ).current;

  useEffect(() => {
    async function getCurrentLocation() {
      let { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;
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

  useEffect(() => {
    Animated.loop(
      Animated.timing(spinAnim, { toValue: 1, duration: 1400, easing: Easing.inOut(Easing.cubic), useNativeDriver: true })
    ).start();
  }, []);

  useEffect(() => {
    Animated.timing(loadingProgress, {
      toValue: loading ? 1 : 0, duration: loading ? 1000 : 700, easing: Easing.inOut(Easing.cubic), useNativeDriver: true
    }).start();
  }, [loading]);

  // --- NEW: Automatically re-search when the filter changes ---
  useEffect(() => {
    if (currentDestination && routeCoords.length > 0) {
      searchAlongCorridor(currentDestination.latitude, currentDestination.longitude, routeCoords, selectedCuisines);
    }
  }, [selectedCuisines]); 

  const toggleCuisine = (cuisine: string) => {
    setSelectedCuisines(prev => prev.includes(cuisine) ? prev.filter(c => c !== cuisine) : [...prev, cuisine]);
  };

  const toggleCuisineDropdown = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setIsCuisineOpen(!isCuisineOpen);
  };

  const expandSearchPanel = () => {
    if (isResultsExpanded) {
      setIsResultsExpanded(false);
      resultsAnim.setValue(0); 
      resultsDragAnim.setValue(0);
      currentDrag.current = 0;
    }
    setIsSearchExpanded(true);
    Animated.sequence([
      Animated.timing(searchAnim, { toValue: 1, duration: 500, easing: Easing.inOut(Easing.quad), useNativeDriver: false }),
      Animated.timing(searchAnim, { toValue: 2, duration: 600, easing: Easing.out(Easing.cubic), useNativeDriver: false })
    ]).start(() => { searchInputRef.current?.focus(); });
  };

  const collapseSearchPanel = () => {
    Keyboard.dismiss();
    Animated.sequence([
      Animated.timing(searchAnim, { toValue: 1, duration: 500, easing: Easing.inOut(Easing.cubic), useNativeDriver: false }),
      Animated.timing(searchAnim, { toValue: 0, duration: 400, easing: Easing.inOut(Easing.quad), useNativeDriver: false })
    ]).start(() => {
      setIsSearchExpanded(false);
      setSearch('');
      setSuggestions([]);
    });
  };

  const closeResultsPanel = () => {
    Animated.timing(resultsAnim, { toValue: 0, duration: 500, easing: Easing.inOut(Easing.cubic), useNativeDriver: false }).start(() => {
      setIsResultsExpanded(false);
      resultsDragAnim.setValue(0);
      currentDrag.current = 0;
      setIsCuisineOpen(false);
      setRouteCoords([]);
      setFoodSpots([]);
      setCurrentDestination(null);
    });
  };

  const searchBottomOffset = searchAnim.interpolate({ inputRange: [0, 1, 2], outputRange: [0, 450, 360] }); 
  const resultsBottomOffset = resultsAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 0] }); 
  const panelBottom = Animated.add(new Animated.Value(40), Animated.add(searchBottomOffset, resultsBottomOffset));
  const searchHeightOffset = searchAnim.interpolate({ inputRange: [0, 1, 2], outputRange: [0, 0, 200] }); 
  const resultsHeightOffset = resultsAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 180] }); 
  const basePanelHeight = Animated.add(new Animated.Value(105), Animated.add(searchHeightOffset, resultsHeightOffset));
  const panelHeight = Animated.add(basePanelHeight, resultsDragAnim);
  const searchWidthOffset = searchAnim.interpolate({ inputRange: [0, 1, 2], outputRange: [0, 0, (SCREEN_WIDTH * 0.92) - 105] });
  const resultsWidthOffset = resultsAnim.interpolate({ inputRange: [0, 1], outputRange: [0, (SCREEN_WIDTH * 0.92) - 105] });
  const panelWidth = Animated.add(new Animated.Value(105), Animated.add(searchWidthOffset, resultsWidthOffset));
  const searchRadiusOffset = searchAnim.interpolate({ inputRange: [0, 1, 2], outputRange: [0, 0, -28.5] }); 
  const resultsRadiusOffset = resultsAnim.interpolate({ inputRange: [0, 1], outputRange: [0, -28.5] });
  const panelRadius = Animated.add(new Animated.Value(52.5), Animated.add(searchRadiusOffset, resultsRadiusOffset));
  const searchContentOpacity = searchAnim.interpolate({ inputRange: [0, 1, 1.5, 2], outputRange: [0, 0, 0, 1] });
  const resultsContentOpacity = resultsAnim.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, 0, 1] });
  const iconOpacitySearch = searchAnim.interpolate({ inputRange: [0, 1, 1.2, 2], outputRange: [0, 0, -1, -1] });
  const iconOpacityResults = resultsAnim.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, -1, -1] });
  const centerIconOpacity = Animated.add(new Animated.Value(1), Animated.add(iconOpacitySearch, iconOpacityResults));
  const solidOpacitySearch = searchAnim.interpolate({ inputRange: [0, 1, 2], outputRange: [0, 0, -1] });
  const solidOpacityResults = resultsAnim.interpolate({ inputRange: [0, 1], outputRange: [0, -1] });
  const solidColorOpacity = Animated.add(new Animated.Value(1), Animated.add(solidOpacitySearch, solidOpacityResults));
  const blurOpacitySearch = searchAnim.interpolate({ inputRange: [0, 1, 2], outputRange: [0, 0, 1] });
  const blurOpacityResults = resultsAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 1] });
  const blurOpacity = Animated.add(blurOpacitySearch, blurOpacityResults);
  const forkScaleX = loadingProgress.interpolate({ inputRange: [0, 0.5], outputRange: [1, 0.05], extrapolate: 'clamp' });
  const forkScaleY = loadingProgress.interpolate({ inputRange: [0, 0.5], outputRange: [1, 1], extrapolate: 'clamp' });
  const forkOpacity = loadingProgress.interpolate({ inputRange: [0, 0.49, 0.5], outputRange: [1, 1, 0], extrapolate: 'clamp' });
  const spinnerScaleX = loadingProgress.interpolate({ inputRange: [0.5, 1], outputRange: [0.05, 1], extrapolate: 'clamp' });
  const spinnerScaleY = loadingProgress.interpolate({ inputRange: [0.5, 1], outputRange: [1, 1], extrapolate: 'clamp' });
  const spinnerOpacity = loadingProgress.interpolate({ inputRange: [0.49, 0.5, 0.51], outputRange: [0, 0, 1], extrapolate: 'clamp' });
  const spinnerRotate = spinAnim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  const spinnerPulseScale = spinAnim.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.6, 1.1, 0.6] });

  const handleTextChange = async (text: string) => {
    setSearch(text);
    if (text.length < 3) { setSuggestions([]); return; }
    if (!appleToken || !region) return;

    try {
      const response = await fetch(
        `https://maps-api.apple.com/v1/searchAutocomplete?q=${encodeURIComponent(text)}&searchLocation=${region.latitude},${region.longitude}`,
        { headers: { 'Authorization': `Bearer ${appleToken}` } }
      );
      const data = await response.json();
      if (data.results) setSuggestions(data.results);
    } catch (error) {
      console.error(error);
    }
  };

  // --- NEW: Reusable function to fetch spots along a route ---
  const searchAlongCorridor = async (destLat: number, destLon: number, coords: {latitude: number, longitude: number}[], targetCuisines: string[]) => {
    if (!appleToken) return;
    setLoading(true);

    const categoriesQuery = targetCuisines.length > 0 ? targetCuisines.join(',') : 'Restaurant';
    const breadcrumbs = [];

    if (coords.length > 0) {
      let totalDistance = 0;
      const cumulativeDistances = [0]; 
      
      for (let i = 1; i < coords.length; i++) {
        const dist = getDistanceInMeters(
          coords[i-1].latitude, coords[i-1].longitude,
          coords[i].latitude, coords[i].longitude
        );
        totalDistance += dist;
        cumulativeDistances.push(totalDistance);
      }

      const totalDistanceInMiles = totalDistance / 1609.34;
      let intervalPercentage;
      if (totalDistanceInMiles <= 4) intervalPercentage = 0.30; 
      else if (totalDistanceInMiles <= 10) intervalPercentage = 0.20; 
      else intervalPercentage = 0.10; 

      const dynamicInterval = totalDistance * intervalPercentage;

      breadcrumbs.push(coords[0]); 
      let nextTarget = dynamicInterval;
      for (let i = 1; i < coords.length; i++) {
        if (cumulativeDistances[i] >= nextTarget) {
          breadcrumbs.push(coords[i]);
          nextTarget += dynamicInterval; 
        }
      }
      breadcrumbs.push({ latitude: destLat, longitude: destLon });
    } else {
      breadcrumbs.push({ latitude: destLat, longitude: destLon });
    }

    const safeBreadcrumbs = breadcrumbs.slice(0, 15);

    try {
      const fetchPromises = safeBreadcrumbs.map(point => 
        fetch(
          `https://maps-api.apple.com/v1/search?q=${categoriesQuery}&searchLocation=${point.latitude},${point.longitude}&resultTypeFilter=Poi`,
          { headers: { 'Authorization': `Bearer ${appleToken}` } }
        ).then(res => res.json())
      );

      const resultsArray = await Promise.all(fetchPromises);
      const uniqueSpotsMap = new Map();

      resultsArray.forEach(placesData => {
        if (placesData.results) {
          placesData.results.forEach((poi: any) => {
            if (poi.coordinate && poi.coordinate.latitude != null) {
              const uniqueKey = `${poi.coordinate.latitude},${poi.coordinate.longitude}`;
              if (!uniqueSpotsMap.has(uniqueKey)) {
                uniqueSpotsMap.set(uniqueKey, {
                  coordinate: {
                    latitude: poi.coordinate.latitude,
                    longitude: poi.coordinate.longitude
                  },
                  name: poi.name || "Unknown Spot",
                  address: poi.formattedAddressLines ? poi.formattedAddressLines.join(', ') : ""
                });
              }
            }
          });
        }
      });
      setFoodSpots(Array.from(uniqueSpotsMap.values()));
    } catch (error) {
      console.error(error);
    }
    
    setLoading(false);
  };

  const handleSelectSuggestion = async (item: any) => {
    const displayString = item.displayLines?.join(', ') || "Unknown Location";
    setSearch(displayString);
    setSuggestions([]); 
    Keyboard.dismiss();
    // --- NEW: Save to Recent Searches ---
    const updatedRecents = [
      item, 
      ...recentSearches.filter(recent => 
        recent.displayLines.join(', ') !== item.displayLines?.join(', ')
      )
    ].slice(0, 5); // Keep only the last 5 searches
    setRecentSearches(updatedRecents);
    AsyncStorage.setItem('@mapetite_recents', JSON.stringify(updatedRecents)).catch(err => console.error(err));
    setIsSearchExpanded(false);

    Animated.sequence([
      Animated.timing(searchAnim, { toValue: 1, duration: 400, easing: Easing.inOut(Easing.cubic), useNativeDriver: false }),
      Animated.timing(searchAnim, { toValue: 0, duration: 400, easing: Easing.inOut(Easing.quad), useNativeDriver: false })
    ]).start(async () => {
      
      setLoading(true);
      if (!region || !appleToken) { setLoading(false); return; }
      
      try {
        const destLat = item.location.latitude;
        const destLon = item.location.longitude;
        
        // Save destination so the filter can use it later
        setCurrentDestination({ latitude: destLat, longitude: destLon });

        setRegion({
          latitude: (region.latitude + destLat) / 2,
          longitude: (region.longitude + destLon) / 2,
          latitudeDelta: Math.abs(region.latitude - destLat) * 1.5 || 0.05,
          longitudeDelta: Math.abs(region.longitude - destLon) * 1.5 || 0.05,
        });

        const routeResponse = await fetch(
          `https://maps-api.apple.com/v1/directions?origin=${region.latitude},${region.longitude}&destination=${destLat},${destLon}`,
          { headers: { 'Authorization': `Bearer ${appleToken}` } }
        );
        const routeData = await routeResponse.json();

        let decodedCoords: {latitude: number, longitude: number}[] = [];
        if (routeData.stepPaths) {
          decodedCoords = routeData.stepPaths.flat();
          setRouteCoords(decodedCoords); 
        } else {
          setRouteCoords([]);
        }

        // Run the extracted search function!
        await searchAlongCorridor(destLat, destLon, decodedCoords, selectedCuisines);

      } catch (error) {
        Alert.alert('Error', 'Apple Maps request failed.');
      }

      setTimeout(() => {
        setIsResultsExpanded(true);
        Animated.timing(resultsAnim, { toValue: 1, duration: 600, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
      }, 800); 
    });
  };

  const clearRecentSearches = async () => {
    setRecentSearches([]); // Clear the UI instantly
    try {
      await AsyncStorage.removeItem('@mapetite_recents'); // Wipe it from the phone's memory
    } catch (error) {
      console.error("🔴 Failed to clear recent searches:", error);
    }
  };
  
  const cuisineLabel = selectedCuisines.length > 0 ? `${selectedCuisines.length} Selected` : 'Any';

  return (
    <View style={styles.container}>
      {region && (
        <MapView style={styles.map} region={region} showsUserLocation={true}>
          {routeCoords.length > 0 && (
            <Polyline coordinates={routeCoords} strokeColor="#007AFF" strokeWidth={5} />
          )}
          {foodSpots.map((spot, index) => (
            <Marker key={index} coordinate={spot.coordinate} title={spot.name} description={spot.address} />
          ))}
        </MapView> 
      )}

      <Animated.View style={[styles.mainPanelWrapper, { height: panelHeight, width: panelWidth, bottom: panelBottom, borderRadius: panelRadius }]}>
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: blurOpacity }]}>
          <BlurView intensity={85} tint="dark" style={StyleSheet.absoluteFill} />
        </Animated.View>

        <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: '#181818', opacity: solidColorOpacity }]} />
        
        <Animated.View style={[styles.forkWrapper, { opacity: centerIconOpacity }]} pointerEvents={isSearchExpanded || isResultsExpanded ? 'none' : 'auto'}>
          <TouchableOpacity onPress={expandSearchPanel} style={styles.forkButton} disabled={loading}>
            <Animated.View style={{ position: 'absolute', opacity: forkOpacity, transform: [{ scaleX: forkScaleX }, { scaleY: forkScaleY }] }}>
              <MaterialCommunityIcons name="silverware-fork" size={48} color="#fff" />
            </Animated.View>
            <Animated.View style={{ position: 'absolute', opacity: spinnerOpacity, transform: [{ scaleX: spinnerScaleX }, { scaleY: spinnerScaleY }] }}>
              <Animated.View style={{ transform: [{ rotate: spinnerRotate }, { scale: spinnerPulseScale }] }}>
                <Svg width="50" height="50" viewBox="0 0 50 50">
                  <Circle cx="25" cy="25" r="20" stroke="#ffffff" strokeWidth="4" fill="none" strokeDasharray="26 15.888" strokeLinecap="round" />
                </Svg>
              </Animated.View>
            </Animated.View>
          </TouchableOpacity>
        </Animated.View>

        <Animated.View style={[StyleSheet.absoluteFill, { opacity: searchContentOpacity }]} pointerEvents={isSearchExpanded ? 'auto' : 'none'}>
          <View style={styles.searchRow}>
            <Ionicons name="search" size={20} color="#aaa" style={styles.searchIcon} />
            <TextInput 
              ref={searchInputRef} placeholder="Where are we going?" placeholderTextColor="#999" value={search}
              style={styles.searchBar} returnKeyType="search" onChangeText={handleTextChange} clearButtonMode="while-editing"
            />
            <TouchableOpacity onPress={collapseSearchPanel} style={styles.cancelBtn}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.hiddenContent}>
            
            {/* Show Recents when search bar is empty */}
            {search.length === 0 && recentSearches.length > 0 && (
              <View style={styles.dropdown}>
                
                {/* --- NEW: Header Row with Clear Button --- */}
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 15, paddingTop: 15, paddingBottom: 5 }}>
                  <Text style={{ color: '#aaa', fontSize: 13, fontWeight: '600' }}>
                    RECENT SEARCHES
                  </Text>
                  <TouchableOpacity onPress={clearRecentSearches}>
                    <Text style={{ color: '#0a84ff', fontSize: 13, fontWeight: '500' }}>
                      Clear
                    </Text>
                  </TouchableOpacity>
                </View>

                <FlatList
                  data={recentSearches}
                  keyExtractor={(item, index) => 'recent-' + index.toString()}
                  keyboardShouldPersistTaps="handled"
                  renderItem={({ item }) => (
                    <TouchableOpacity style={styles.suggestionItem} onPress={() => handleSelectSuggestion(item)}>
                      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <Ionicons name="time-outline" size={18} color="#aaa" style={{ marginRight: 10 }} />
                        <Text style={styles.suggestionText} numberOfLines={1}>
                          {item.displayLines.join(', ')}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  )}
                />
              </View>
            )}

            {/* Show Autocomplete when typing */}
            {suggestions.length > 0 && search.length > 0 && ( 
              <View style={styles.dropdown}>
                <FlatList
                  data={suggestions}
                  keyExtractor={(item, index) => 'suggestion-' + index.toString()}
                  keyboardShouldPersistTaps="handled"
                  renderItem={({ item }) => (
                    <TouchableOpacity style={styles.suggestionItem} onPress={() => handleSelectSuggestion(item)}>
                      <Text style={styles.suggestionText} numberOfLines={1}>
                        {item.displayLines.join(', ')}
                      </Text>
                    </TouchableOpacity>
                  )}
                />
              </View>
            )}

          </View>
        </Animated.View>

        <Animated.View style={[StyleSheet.absoluteFill, { opacity: resultsContentOpacity }]} pointerEvents={isResultsExpanded ? 'auto' : 'none'}>
          <View {...panResponder.panHandlers} style={{ backgroundColor: 'transparent' }}>
            <View style={styles.dragHandle} />
            <View style={styles.resultsHeader}>
              <Text style={styles.resultsTitle}>Nearby Spots</Text>
              <TouchableOpacity onPress={closeResultsPanel} style={styles.closeBtn}>
                <Ionicons name="close-circle" size={28} color="#aaa" />
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.resultsContentWrapper}>
            <TouchableOpacity style={styles.dropdownHeader} onPress={toggleCuisineDropdown} activeOpacity={0.7}>
              <Text style={styles.dropdownTitle}>Categories</Text>
              <View style={styles.dropdownValueRow}>
                <Text style={styles.dropdownValue}>{cuisineLabel}</Text>
                <Ionicons name={isCuisineOpen ? 'chevron-up' : 'chevron-down'} size={16} color="#aaa" />
              </View>
            </TouchableOpacity>

            {isCuisineOpen && (
              <View style={styles.dropdownContent}>
                <View style={styles.wrappedPillContainer}>
                  {CUISINES.map((cuisine) => (
                    <TouchableOpacity
                      key={cuisine} style={[styles.filterPill, selectedCuisines.includes(cuisine) && styles.filterPillActive]}
                      onPress={() => toggleCuisine(cuisine)}
                    >
                      <Text style={[styles.filterPillText, selectedCuisines.includes(cuisine) && styles.filterPillTextActive]}>{cuisine}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            )}

            <View style={styles.listWrapper}>
              {foodSpots.length === 0 ? (
                <View style={styles.placeholderContainer}>
                  <Ionicons name="restaurant-outline" size={36} color="#aaa" style={styles.placeholderIcon} />
                  <Text style={styles.placeholderText}>No spots found nearby.</Text>
                </View>
              ) : (
                <FlatList
                  data={foodSpots} keyExtractor={(item, index) => index.toString()} contentContainerStyle={{ paddingBottom: 20 }} showsVerticalScrollIndicator={false}
                  renderItem={({ item }) => (
                    <View style={styles.spotCard}>
                      <View style={styles.spotInfo}>
                        <Text style={styles.spotName} numberOfLines={1}>{item.name}</Text>
                        <Text style={styles.spotAddress} numberOfLines={2}>{item.address}</Text>
                      </View>
                      <Ionicons name="chevron-forward" size={20} color="#666" />
                    </View>
                  )}
                />
              )}
            </View>
          </View>
        </Animated.View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  map: { width: '100%', height: '100%' },
  mainPanelWrapper: { position: 'absolute', alignSelf: 'center', overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.5, shadowRadius: 15, elevation: 15 },
  forkWrapper: { ...StyleSheet.absoluteFillObject, justifyContent: 'center', alignItems: 'center' },
  forkButton: { width: 105, height: 105, justifyContent: 'center', alignItems: 'center' },
  searchRow: { height: 70, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20 },
  searchIcon: { marginRight: 10 },
  searchBar: { flex: 1, height: '100%', fontSize: 16, fontWeight: '500', color: '#ffffff' },
  cancelBtn: { marginLeft: 12 },
  cancelText: { color: '#0a84ff', fontSize: 16, fontWeight: '500' },
  hiddenContent: { flex: 1, paddingHorizontal: 20, paddingTop: 5 },
  dropdown: { backgroundColor: 'rgba(255, 255, 255, 0.1)', borderRadius: 12, flex: 1, marginBottom: 30 },
  suggestionItem: { padding: 15, borderBottomWidth: 1, borderBottomColor: 'rgba(255, 255, 255, 0.1)' },
  suggestionText: { color: '#ffffff', fontSize: 15 },
  resultsContentWrapper: { flex: 1, paddingHorizontal: 20, paddingTop: 10 },
  dropdownHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'rgba(255, 255, 255, 0.08)', paddingHorizontal: 16, paddingVertical: 14, borderRadius: 12, marginBottom: 8 },
  dropdownTitle: { color: '#ffffff', fontSize: 15, fontWeight: '600', flex: 1 },
  dropdownValueRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dropdownValue: { color: '#0a84ff', fontSize: 14, fontWeight: '500' },
  dropdownContent: { paddingHorizontal: 4, paddingBottom: 15, paddingTop: 5 },
  wrappedPillContainer: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  filterPill: { paddingVertical: 8, paddingHorizontal: 20, backgroundColor: 'rgba(255, 255, 255, 0.1)', borderRadius: 20, borderWidth: 1, borderColor: 'rgba(255, 255, 255, 0.1)' },
  filterPillActive: { backgroundColor: '#0a84ff', borderColor: '#0a84ff' },
  filterPillText: { fontWeight: '600', color: '#bbb' },
  filterPillTextActive: { color: '#fff' },
  dragHandle: { width: 40, height: 5, backgroundColor: 'rgba(255, 255, 255, 0.3)', borderRadius: 3, alignSelf: 'center', marginTop: 10, marginBottom: -10 },
  resultsHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingTop: 20, paddingBottom: 15, borderBottomWidth: 1, borderBottomColor: 'rgba(255, 255, 255, 0.1)' },
  resultsTitle: { fontSize: 20, fontWeight: 'bold', color: '#ffffff' },
  closeBtn: { padding: 5 },
  listWrapper: { flex: 1, marginTop: 10 },
  spotCard: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: 'rgba(255, 255, 255, 0.08)', padding: 16, borderRadius: 12, marginBottom: 10 },
  spotInfo: { flex: 1, paddingRight: 10 },
  spotName: { color: '#ffffff', fontSize: 16, fontWeight: '600', marginBottom: 4 },
  spotAddress: { color: '#aaa', fontSize: 13 },
  placeholderContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingBottom: 20 },
  placeholderIcon: { marginBottom: 15 },
  placeholderText: { color: '#aaa', fontSize: 16, fontWeight: '500' }
});