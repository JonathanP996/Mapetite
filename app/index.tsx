import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
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
const SCREEN_HEIGHT = Dimensions.get('window').height;

const CUISINES = [
  'American', 'Chinese', 'Italian', 'Mexican', 'Japanese', 
  'Fast Food', 'Pizza', 'Seafood', 'Healthy', 'Cafe', 'Vegan'
];

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

  const [isSearchExpanded, setIsSearchExpanded] = useState(false);
  const [isResultsExpanded, setIsResultsExpanded] = useState(false);

  const [searchRadius, setSearchRadius] = useState(4828); 
  const [selectedCuisines, setSelectedCuisines] = useState<string[]>([]);
  
  // Dropdown states
  const [isRadiusOpen, setIsRadiusOpen] = useState(false);
  const [isCuisineOpen, setIsCuisineOpen] = useState(false);

  const GEOAPIFY_KEY = process.env.EXPO_PUBLIC_GEOAPIFY_KEY;

  // --- Animation Controllers ---
  const searchAnim = useRef(new Animated.Value(0)).current;  
  const resultsAnim = useRef(new Animated.Value(0)).current; 
  const resultsDragAnim = useRef(new Animated.Value(0)).current; 
  
  const loadingProgress = useRef(new Animated.Value(0)).current;
  const spinAnim = useRef(new Animated.Value(0)).current;
  
  const searchInputRef = useRef<TextInput>(null);

  // --- PanResponder for Drag-to-Expand ---
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
          Animated.spring(resultsDragAnim, {
            toValue: MAX_DRAG,
            friction: 8,
            useNativeDriver: false
          }).start(() => { currentDrag.current = MAX_DRAG; });
        } else {
          Animated.spring(resultsDragAnim, {
            toValue: 0,
            friction: 8,
            useNativeDriver: false
          }).start(() => { currentDrag.current = 0; });
        }
      }
    })
  ).current;

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

  useEffect(() => {
    Animated.loop(
      Animated.timing(spinAnim, {
        toValue: 1,
        duration: 1400,
        easing: Easing.inOut(Easing.cubic),
        useNativeDriver: true,
      })
    ).start();
  }, []);

  useEffect(() => {
    Animated.timing(loadingProgress, {
      toValue: loading ? 1 : 0,
      duration: loading ? 1000 : 700, 
      easing: Easing.inOut(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [loading]);

  const toggleCuisine = (cuisine: string) => {
    setSelectedCuisines(prev => 
      prev.includes(cuisine) 
        ? prev.filter(c => c !== cuisine)
        : [...prev, cuisine]
    );
  };

  const toggleRadiusDropdown = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setIsRadiusOpen(!isRadiusOpen);
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
      Animated.timing(searchAnim, {
        toValue: 1,
        duration: 500,
        easing: Easing.inOut(Easing.quad),
        useNativeDriver: false,
      }),
      Animated.timing(searchAnim, {
        toValue: 2,
        duration: 600, 
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      })
    ]).start(() => {
      searchInputRef.current?.focus();
    });
  };

  const collapseSearchPanel = () => {
    Keyboard.dismiss();
    Animated.sequence([
      Animated.timing(searchAnim, {
        toValue: 1,
        duration: 500,
        easing: Easing.inOut(Easing.cubic),
        useNativeDriver: false,
      }),
      Animated.timing(searchAnim, {
        toValue: 0,
        duration: 400,
        easing: Easing.inOut(Easing.quad),
        useNativeDriver: false,
      })
    ]).start(() => {
      setIsSearchExpanded(false);
      setSearch('');
      setSuggestions([]);
    });
  };

  const closeResultsPanel = () => {
    Animated.timing(resultsAnim, {
      toValue: 0,
      duration: 500,
      easing: Easing.inOut(Easing.cubic),
      useNativeDriver: false,
    }).start(() => {
      setIsResultsExpanded(false);
      resultsDragAnim.setValue(0);
      currentDrag.current = 0;
      setIsRadiusOpen(false);
      setIsCuisineOpen(false);
    });
  };

  // --- Math Engine (Raised for Keyboard Clearance) ---
  
  // Raised the expanded search bottom offset to 360 (Total bottom clearance: 400px)
  const searchBottomOffset = searchAnim.interpolate({ inputRange: [0, 1, 2], outputRange: [0, 450, 360] }); 
  const resultsBottomOffset = resultsAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 0] }); 
  const panelBottom = Animated.add(new Animated.Value(40), Animated.add(searchBottomOffset, resultsBottomOffset));

  const searchHeightOffset = searchAnim.interpolate({ inputRange: [0, 1, 2], outputRange: [0, 0, 200] }); 
  const resultsHeightOffset = resultsAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 180] }); // Base height for results
  
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

  // --- Orbit Loader Math ---
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
    if (text.length < 3) {
      setSuggestions([]);
      return;
    }
    try {
      const response = await fetch(
        `https://api.geoapify.com/v1/geocode/autocomplete?text=${encodeURIComponent(text)}&apiKey=${GEOAPIFY_KEY}`
      ); 
      const data = await response.json();
      if (data.features) setSuggestions(data.features);
    } catch (error) {
      console.error('Autocomplete error:', error);
    }
  };

  const handleSelectSuggestion = async (item: any) => {
    const [lon, lat] = item.geometry.coordinates;
    const formattedAddress = item.properties.formatted;
    setSearch(formattedAddress);
    setSuggestions([]); 
    
    Keyboard.dismiss();
    setIsSearchExpanded(false);

    Animated.sequence([
      Animated.timing(searchAnim, { toValue: 1, duration: 400, easing: Easing.inOut(Easing.cubic), useNativeDriver: false }),
      Animated.timing(searchAnim, { toValue: 0, duration: 400, easing: Easing.inOut(Easing.quad), useNativeDriver: false })
    ]).start(async () => {
      
      setLoading(true);

      if (!region) { setLoading(false); return; }
      
      setRegion({
        latitude: (region.latitude + lat) / 2,
        longitude: (region.longitude + lon) / 2,
        latitudeDelta: Math.abs(region.latitude - lat) * 1.5 || 0.05,
        longitudeDelta: Math.abs(region.longitude - lon) * 1.5 || 0.05,
      });

      try {
        let categoriesQuery = 'catering.fast_food,catering.restaurant'; 
        
        if (selectedCuisines.length > 0) {
          categoriesQuery = selectedCuisines.map(cuisine => {
            if (cuisine === 'Fast Food') return 'catering.fast_food';
            if (cuisine === 'Cafe') return 'catering.cafe';
            if (cuisine === 'Pizza') return 'catering.restaurant.pizza';
            if (cuisine === 'Seafood') return 'catering.restaurant.seafood';
            if (cuisine === 'Healthy') return 'catering.restaurant.healthy_food';
            return `catering.restaurant.${cuisine.toLowerCase()}`;
          }).join(',');
        }

        await new Promise(resolve => setTimeout(resolve, 3000));

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
          `https://api.geoapify.com/v2/places?categories=${categoriesQuery}&filter=circle:${lon},${lat},${searchRadius}&limit=20&apiKey=${GEOAPIFY_KEY}`
        );
        const placesData = await placesResponse.json();
        if (placesData.features) setFoodSpots(placesData.features);
      } catch (error) {
        Alert.alert('Error', 'Could not calculate route or fetch places.');
      }
      
      setLoading(false);

      setTimeout(() => {
        setIsResultsExpanded(true);
        Animated.timing(resultsAnim, {
          toValue: 1,
          duration: 600,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: false
        }).start();
      }, 800); 

    });
  };

  // Helper Labels for Closed Dropdowns
  const radiusLabel = {1609: '1 Mi', 4828: '3 Mi', 8046: '5 Mi'}[searchRadius] || '3 Mi';
  const cuisineLabel = selectedCuisines.length > 0 ? `${selectedCuisines.length} Selected` : 'Any';

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

      <Animated.View 
        style={[
          styles.mainPanelWrapper, 
          { 
            height: panelHeight,
            width: panelWidth,
            bottom: panelBottom,
            borderRadius: panelRadius,
          }
        ]}
      >
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: blurOpacity }]}>
          <BlurView intensity={85} tint="dark" style={StyleSheet.absoluteFill} />
        </Animated.View>

        <Animated.View style={[StyleSheet.absoluteFill, { 
          backgroundColor: '#181818', 
          opacity: solidColorOpacity 
        }]} />
        
        {/* Layer 1: The Morphing Center Icon */}
        <Animated.View 
          style={[styles.forkWrapper, { opacity: centerIconOpacity }]} 
          pointerEvents={isSearchExpanded || isResultsExpanded ? 'none' : 'auto'}
        >
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

        {/* Layer 2: The Expanded Search Bar & Suggestions */}
        <Animated.View 
          style={[StyleSheet.absoluteFill, { opacity: searchContentOpacity }]} 
          pointerEvents={isSearchExpanded ? 'auto' : 'none'}
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
            
            <TouchableOpacity onPress={collapseSearchPanel} style={styles.cancelBtn}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.hiddenContent}>
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

        {/* Layer 3: The Bottom Results Rectangle (With Modern Sleek Dropdowns) */}
        <Animated.View 
          style={[StyleSheet.absoluteFill, { opacity: resultsContentOpacity }]} 
          pointerEvents={isResultsExpanded ? 'auto' : 'none'}
        >
          {/* Draggable Header */}
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
            
            {/* Modern Sleek Radius Dropdown */}
            <TouchableOpacity style={styles.dropdownHeader} onPress={toggleRadiusDropdown} activeOpacity={0.7}>
              <Text style={styles.dropdownTitle}>Search Radius</Text>
              <View style={styles.dropdownValueRow}>
                <Text style={styles.dropdownValue}>{radiusLabel}</Text>
                <Ionicons name={isRadiusOpen ? 'chevron-up' : 'chevron-down'} size={16} color="#aaa" />
              </View>
            </TouchableOpacity>

            {isRadiusOpen && (
              <View style={styles.dropdownContent}>
                <View style={styles.pillContainer}>
                  {[
                    { label: '1 Mi', value: 1609 },
                    { label: '3 Mi', value: 4828 },
                    { label: '5 Mi', value: 8046 }
                  ].map((pill) => (
                    <TouchableOpacity
                      key={pill.label}
                      style={[styles.filterPill, searchRadius === pill.value && styles.filterPillActive]}
                      onPress={() => setSearchRadius(pill.value)}
                    >
                      <Text style={[styles.filterPillText, searchRadius === pill.value && styles.filterPillTextActive]}>
                        {pill.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            )}

            {/* Modern Sleek Cuisine Dropdown */}
            <TouchableOpacity style={styles.dropdownHeader} onPress={toggleCuisineDropdown} activeOpacity={0.7}>
              <Text style={styles.dropdownTitle}>Cuisines</Text>
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
                      key={cuisine}
                      style={[styles.filterPill, selectedCuisines.includes(cuisine) && styles.filterPillActive]}
                      onPress={() => toggleCuisine(cuisine)}
                    >
                      <Text style={[styles.filterPillText, selectedCuisines.includes(cuisine) && styles.filterPillTextActive]}>
                        {cuisine}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            )}

            <View style={styles.placeholderContainer}>
              <Ionicons name="restaurant-outline" size={36} color="#aaa" style={styles.placeholderIcon} />
              <Text style={styles.placeholderText}>Restaurant results will appear here</Text>
              <Text style={styles.placeholderSubText}>Drag up to expand</Text>
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
  
  mainPanelWrapper: {
    position: 'absolute',
    alignSelf: 'center', 
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

  // Results & Sleek Dropdown Styles
  resultsContentWrapper: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 10,
  },
  dropdownHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 12,
    marginBottom: 8,
  },
  dropdownTitle: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '600',
  },
  dropdownValueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  dropdownValue: {
    color: '#0a84ff',
    fontSize: 14,
    fontWeight: '500',
  },
  dropdownContent: {
    paddingHorizontal: 4,
    paddingBottom: 15,
    paddingTop: 5,
  },
  pillContainer: {
    flexDirection: 'row',
    gap: 10,
  },
  wrappedPillContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
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
  
  dragHandle: {
    width: 40,
    height: 5,
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
    borderRadius: 3,
    alignSelf: 'center',
    marginTop: 10,
    marginBottom: -10,
  },
  resultsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 15,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.1)',
  },
  resultsTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#ffffff',
  },
  closeBtn: {
    padding: 5,
  },
  placeholderContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingBottom: 20,
  },
  placeholderIcon: {
    marginBottom: 15,
  },
  placeholderText: {
    color: '#aaa',
    fontSize: 16,
    fontWeight: '500',
  },
  placeholderSubText: {
    color: '#666',
    fontSize: 14,
    marginTop: 8,
  }
});