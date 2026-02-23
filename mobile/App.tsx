/// <reference types="nativewind/types" />
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SettingsProvider } from './context/SettingsContext';
import HomeScreen from './screen/HomeScreen';
import CommodityDetailScreen from './screen/CommodityDetailScreen';
import SettingsScreen from './screen/SettingsScreen';
import ChangelogScreen from './screen/ChangelogScreen';
import { Commodity } from './types/commodity';

export type RootStackParamList = {
  Home: undefined;
  CommodityDetail: { commodity: Commodity };
  Settings: undefined;
  Changelog: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function App() {
  return (
    <SettingsProvider>
      <NavigationContainer>
        <Stack.Navigator
          initialRouteName="Home"
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: '#f8fafc' }, // slate-50
          }}
        >
          <Stack.Screen name="Home" component={HomeScreen} />
          <Stack.Screen
            name="CommodityDetail"
            component={CommodityDetailScreen}
            options={{
              headerShown: true,
              headerTitle: '',
              headerTransparent: true,
              headerTintColor: '#0f172a', // slate-900
            }}
          />
          <Stack.Screen
            name="Settings"
            component={SettingsScreen}
            options={{
              headerShown: true,
              headerTitle: '',
              headerTransparent: true,
              presentation: 'modal',
            }}
          />
          <Stack.Screen
            name="Changelog"
            component={ChangelogScreen}
            options={{
              headerShown: false,
              presentation: 'modal',
            }}
          />
        </Stack.Navigator>
        <StatusBar style="auto" />
      </NavigationContainer>
    </SettingsProvider>
  );
}
