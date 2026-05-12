import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { View, Text, TouchableOpacity } from 'react-native';
import { useState } from 'react';
import MapScreen from './src/screens/MapScreen';
import DriversScreen from './src/screens/DriversScreen';
import AuthScreen from './src/screens/AuthScreen';
import { Driver } from './src/types';
import { clearToken } from './src/api';

const Tab = createBottomTabNavigator();

export default function App() {
  const [user, setUser] = useState<{ userId: string; role: string; name: string } | null>(null);
  const [drivers, setDrivers] = useState<Driver[]>([]);

  if (!user) {
    return <AuthScreen onAuth={setUser} />;
  }

  return (
    <NavigationContainer>
      <Tab.Navigator
        screenOptions={{
          headerStyle: { backgroundColor: '#1a1a2e' },
          headerTintColor: '#fff',
          tabBarActiveTintColor: '#4f46e5',
          tabBarInactiveTintColor: '#9ca3af',
        }}
      >
        <Tab.Screen
          name="Map"
          options={{
            title: 'Kigali Rides',
            tabBarLabel: 'Map',
            tabBarIcon: () => <Text>🗺️</Text>,
            headerRight: () => (
              <TouchableOpacity
                onPress={() => { clearToken(); setUser(null); }}
                style={{ marginRight: 14 }}
              >
                <Text style={{ color: '#a5b4fc', fontSize: 13 }}>Logout</Text>
              </TouchableOpacity>
            ),
          }}
        >
          {() => <MapScreen drivers={drivers} />}
        </Tab.Screen>
        <Tab.Screen
          name="Drivers"
          options={{
            title: 'Seed Drivers',
            tabBarLabel: 'Drivers',
            tabBarIcon: () => <Text>🚗</Text>,
            tabBarBadge: drivers.length > 0 ? drivers.length : undefined,
          }}
        >
          {() => <DriversScreen onDriversSeeded={setDrivers} seededCount={drivers.length} />}
        </Tab.Screen>
      </Tab.Navigator>
    </NavigationContainer>
  );
}
