import * as Sentry from '@sentry/react-native'

Sentry.init({
  dsn: 'https://8422d119eeac15280a1e0221eff3c797@o4511347335430144.ingest.us.sentry.io/4511349900509184',
})

// Ensure unhandled promise rejections are captured by Sentry in addition to
// whatever React Native does with them (fatal crash in RN 0.73+).
// This wraps the existing handler rather than replacing Sentry's own setup.
const _rnDefaultHandler = global.ErrorUtils?.getGlobalHandler?.()
global.ErrorUtils?.setGlobalHandler?.((error, isFatal) => {
  try { Sentry.captureException(error) } catch (_) {}
  if (_rnDefaultHandler) _rnDefaultHandler(error, isFatal)
})

import React, { useEffect, useState } from 'react'
import { NavigationContainer } from '@react-navigation/native'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs'
import { View, Text, StyleSheet } from 'react-native'

import { useAuth }             from './lib/useAuth'
import { useOnboarding }      from './lib/useOnboarding'
import { useNotifications }   from './lib/useNotifications'
import ErrorBoundary          from './components/ErrorBoundary'
import OnboardingScreen       from './screens/OnboardingScreen'
import ListSummaryScreen      from './screens/ListSummaryScreen'
import HomeScreen              from './screens/HomeScreen'
import ListScreen              from './screens/ListScreen'
import LeaderboardScreen       from './screens/LeaderboardScreen'
import SignInScreen            from './screens/SignInScreen'
import AdminScreen             from './screens/AdminScreen'
import CreateListScreen        from './screens/CreateListScreen'
import ItemDetailScreen        from './screens/ItemDetailScreen'
import NearbyScreen            from './screens/NearbyScreen'
import JoinListScreen          from './screens/JoinListScreen'
import PartnerPreviewScreen    from './screens/PartnerPreviewScreen'
import BadgesScreen            from './screens/BadgesScreen'
import ResetPasswordScreen     from './screens/ResetPasswordScreen'
import SplashScreen            from './screens/SplashScreen'
import ProfileScreen           from './screens/ProfileScreen'
import DareScreen              from './screens/DareScreen'
import PhotoCheckInScreen      from './screens/PhotoCheckInScreen'
import BrowseListsScreen       from './screens/BrowseListsScreen'
import CuratedListPreviewScreen from './screens/CuratedListPreviewScreen'
import SavedCrewScreen          from './screens/SavedCrewScreen'
import SecretRevealScreen       from './screens/SecretRevealScreen'
import PastListsScreen          from './screens/PastListsScreen'

const Stack = createNativeStackNavigator()
const Tab = createBottomTabNavigator()

const AMBER = '#F5A623'

function TabIcon({ label, focused }) {
  const glyphs = { Home: '⌂', Nearby: '⌖', Create: '+', Admin: '⚙', Profile: '◉' }

  return (
    <View style={tab.wrap}>
      <Text style={[tab.icon, focused && tab.on]}>{glyphs[label] ?? '·'}</Text>
      <Text style={[tab.label, focused && tab.on]}>{label}</Text>
    </View>
  )
}

const tab = StyleSheet.create({
  wrap:  { alignItems: 'center', paddingTop: 4 },
  icon:  { fontSize: 18, color: 'rgba(255,255,255,0.5)' },
  label: { fontSize: 9, color: 'rgba(255,255,255,0.5)', marginTop: 2, letterSpacing: -0.3 },
  on:    { color: AMBER },
})

const stackOpts = {
  headerStyle:      { backgroundColor: '#FFFFFF' },
  headerTintColor:  '#243045',
  headerTitleStyle: { fontWeight: '800', fontSize: 16, color: '#243045' },
  headerBackTitleVisible: false,
  headerBackTitle: '',  
  headerBackButtonDisplayMode: 'minimal',   
  contentStyle:     { backgroundColor: '#FFF9F2' },
  headerShadowVisible: false,
}

function NearbyStack() {
  return (
    <Stack.Navigator screenOptions={stackOpts}>
      <Stack.Screen
        name="Nearby"
        component={NearbyScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="ItemDetail"
        component={ItemDetailScreen}
        options={({ route }) => ({
          title: route.params?.item?.body?.slice(0, 30) ?? 'Item',
        })}
      />
      <Stack.Screen
        name="List"
        component={ListScreen}
        options={({ route }) => ({ title: route.params?.title ?? 'Items' })}
      />
      <Stack.Screen
        name="Leaderboard"
        component={LeaderboardScreen}
        options={({ route }) => ({ title: route.params?.title ?? 'Crew' })}
      />
      <Stack.Screen
        name="Dare"
        component={DareScreen}
        options={{ title: 'Dares' }}
      />
      <Stack.Screen
        name="PhotoCheckIn"
        component={PhotoCheckInScreen}
        options={{ title: 'Add photo' }}
      />
      <Stack.Screen
        name="SecretReveal"
        component={SecretRevealScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="ListSummary"
        component={ListSummaryScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="SignIn"
        component={SignInScreen}
        options={{ headerShown: false }}
      />
    </Stack.Navigator>
  )
}

function HomeStack() {
  return (
    <Stack.Navigator screenOptions={stackOpts}>
      <Stack.Screen
        name="Home"
        component={HomeScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="BrowseLists"
        component={BrowseListsScreen}
        options={{ title: 'Browse lists' }}
      />
      <Stack.Screen
        name="CuratedListPreview"
        component={CuratedListPreviewScreen}
        options={({ route }) => ({ title: route.params?.groupName ?? 'Preview' })}
      />
      <Stack.Screen
        name="CreateList"
        component={CreateListScreen}
        options={{ headerShown: false, title: 'List Setup' }}
      />
      <Stack.Screen
        name="List"
        component={ListScreen}
        options={({ route }) => ({ title: route.params?.title ?? 'Items' })}
      />
      <Stack.Screen
        name="Leaderboard"
        component={LeaderboardScreen}
        options={({ route }) => ({ title: route.params?.title ?? 'Crew' })}
      />
      <Stack.Screen
        name="SignIn"
        component={SignInScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="ItemDetail"
        component={ItemDetailScreen}
        options={({ route }) => ({
          title: route.params?.item?.body?.slice(0, 30) ?? 'Item',
        })}
      />
      <Stack.Screen
        name="Dare"
        component={DareScreen}
        options={{ title: 'Dares' }}
      />
      <Stack.Screen
        name="Badges"
        component={BadgesScreen}
        options={{ title: 'Your badges' }}
      />
      <Stack.Screen
        name="PhotoCheckIn"
        component={PhotoCheckInScreen}
        options={{ title: 'Add photo' }}
      />
      <Stack.Screen
        name="SecretReveal"
        component={SecretRevealScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="ListSummary"
        component={ListSummaryScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="SavedCrew"
        component={SavedCrewScreen}
        options={{ title: 'Your crew', headerShown: false }}
      />
      <Stack.Screen
        name="JoinList"
        component={JoinListScreen}
        options={{ title: 'Join list' }}
      />
      <Stack.Screen
        name="ResetPassword"
        component={ResetPasswordScreen}
        options={{ title: 'Reset password' }}
      />
      <Stack.Screen
        name="PastLists"
        component={PastListsScreen}
        options={{ headerShown: false }}
      />
    </Stack.Navigator>
  )
}

function CreateStack() {
  return (
    <Stack.Navigator screenOptions={stackOpts}>
      <Stack.Screen
        name="CreateList"
        component={CreateListScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="List"
        component={ListScreen}
        options={({ route }) => ({ title: route.params?.title ?? 'Items' })}
      />
      <Stack.Screen
        name="Leaderboard"
        component={LeaderboardScreen}
        options={{ title: 'Crew' }}
      />
      <Stack.Screen
        name="ItemDetail"
        component={ItemDetailScreen}
        options={({ route }) => ({
          title: route.params?.item?.body?.slice(0, 30) ?? 'Item',
        })}
      />
      <Stack.Screen
        name="Dare"
        component={DareScreen}
        options={{ title: 'Dares' }}
      />
      <Stack.Screen
        name="PhotoCheckIn"
        component={PhotoCheckInScreen}
        options={{ title: 'Add photo' }}
      />
      <Stack.Screen
        name="SecretReveal"
        component={SecretRevealScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="ListSummary"
        component={ListSummaryScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="SavedCrew"
        component={SavedCrewScreen}
        options={{ title: 'Your crew', headerShown: false }}
      />
    </Stack.Navigator>
  )
}

function ProfileStack() {
  return (
    <Stack.Navigator screenOptions={stackOpts}>
      <Stack.Screen
        name="Profile"
        component={ProfileScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="Badges"
        component={BadgesScreen}
        options={{ title: 'Your badges' }}
      />
      <Stack.Screen
        name="Dare"
        component={DareScreen}
        options={{ title: 'Dares' }}
      />
      <Stack.Screen
        name="SavedCrew"
        component={SavedCrewScreen}
        options={{ title: 'Your crew', headerShown: false }}
      />
      <Stack.Screen
        name="SignIn"
        component={SignInScreen}
        options={{ headerShown: false }}
      />
    </Stack.Navigator>
  )
}

function AdminStack() {
  return (
    <Stack.Navigator screenOptions={stackOpts}>
      <Stack.Screen
        name="AdminItems"
        component={AdminScreen}
        options={{ title: 'Item manager' }}
      />
      <Stack.Screen
        name="PartnerPreview"
        component={PartnerPreviewScreen}
        options={{ title: 'Partner preview' }}
      />
    </Stack.Navigator>
  )
}

function MainTabs({ isSignedIn, isAdmin }) {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: '#0F0F1E',
          borderTopColor: 'rgba(255,255,255,0.1)',
          borderTopWidth: 0.5,
          height: 72,
          paddingBottom: 12,
          paddingTop: 6,
        },
        tabBarShowLabel: false,
      }}
    >
      <Tab.Screen
        name="HomeTab"
        component={HomeStack}
        options={{
          tabBarIcon: ({ focused }) => (
            <TabIcon label="Home" focused={focused} />
          ),
        }}
      />
      <Tab.Screen
        name="NearbyTab"
        component={NearbyStack}
        options={{
          tabBarIcon: ({ focused }) => (
            <TabIcon label="Nearby" focused={focused} />
          ),
        }}
      />
      <Tab.Screen
        name="CreateTab"
        component={CreateStack}
        options={{
          tabBarButton: isSignedIn ? undefined : () => null,
          tabBarItemStyle: isSignedIn ? undefined : { display: 'none' },
          tabBarIcon: ({ focused }) => (
            <TabIcon label="Create" focused={focused} />
          ),
        }}
      />
      <Tab.Screen
        name="ProfileTab"
        component={ProfileStack}
        options={{
          tabBarIcon: ({ focused }) => (
            <TabIcon label="Profile" focused={focused} />
          ),
        }}
      />
      <Tab.Screen
        name="AdminTab"
        component={AdminStack}
        options={{
          // Always register the screen so React Navigation v7 doesn't drop it
          // when isAdmin resolves true after the initial render.
          // Hide the tab button entirely for non-admins instead of conditionally
          // mounting the Tab.Screen, which causes the navigator to silently lose it.
          tabBarButton: isAdmin ? undefined : () => null,
          tabBarItemStyle: isAdmin ? undefined : { display: 'none' },
          tabBarIcon: ({ focused }) => (
            <TabIcon label="Admin" focused={focused} />
          ),
        }}
      />
    </Tab.Navigator>
  )
}

function App() {
  const { loading, isSignedIn, isAdmin, userId } = useAuth()
  const { needsOnboarding, completeOnboarding, checkingOnboarding } = useOnboarding()
  useNotifications(userId)


  // Show splash for a minimum of 2 seconds AND until auth resolves —
  // whichever takes longer. Reduced from 3s for snappier first-launch feel.
  // useAuth has its own 5s safety timeout so loading will always resolve.
  const [minTimeElapsed, setMinTimeElapsed] = React.useState(false)

  React.useEffect(() => {
    const timer = setTimeout(() => setMinTimeElapsed(true), 2000)
    return () => clearTimeout(timer)
  }, [])

  // Show splash until BOTH auth is done AND min time has elapsed AND onboarding check is done
  const showSplash = loading || !minTimeElapsed || checkingOnboarding

  // Show onboarding after splash, before main app, on first launch only
  if (!showSplash && needsOnboarding) {
    return (
      <SafeAreaProvider>
        <OnboardingScreen onComplete={completeOnboarding} />
      </SafeAreaProvider>
    )
  }

  return (
    <ErrorBoundary>
      <SafeAreaProvider>
        {showSplash ? (
          <SplashScreen />
        ) : (
          <NavigationContainer
            linking={{
              prefixes: [
                'checkoff://',
                'https://getcheckoff.com',
                'https://www.getcheckoff.com',
              ],
              config: {
                screens: {
                  HomeTab: {
                    screens: {
                      JoinList: 'join/:invite_code',
                      ResetPassword: {
                        path: 'reset-password',
                        parse: {
                          access_token: (v) => v,
                          refresh_token: (v) => v,
                          token: (v) => v,
                          type: (v) => v,
                        },
                      },
                      Home: '',
                    },
                  },
                },
              },
            }}
          >
            <MainTabs isSignedIn={isSignedIn} isAdmin={isAdmin} />
          </NavigationContainer>
        )}
      </SafeAreaProvider>
    </ErrorBoundary>
  )
}

export default Sentry.wrap(App)