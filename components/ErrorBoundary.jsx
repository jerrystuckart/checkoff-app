import React from 'react'
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'

const AMBER = '#F5A623'
const NAVY  = '#1A1A2E'
const TEXT  = '#243045'
const MUTED = '#6F7785'
const BG    = '#FFF9F2'

/**
 * ErrorBoundary
 *
 * Wraps the entire app in App.jsx to catch any uncaught render errors
 * and show a clean recovery screen instead of a white crash screen.
 *
 * Usage in App.jsx:
 *   import ErrorBoundary from './components/ErrorBoundary'
 *   <ErrorBoundary>
 *     <SafeAreaProvider>...</SafeAreaProvider>
 *   </ErrorBoundary>
 */
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, info) {
    // In production you could send this to a logging service like Sentry
    console.warn('ErrorBoundary caught:', error.message, info.componentStack)
  }

  reset() {
    this.setState({ hasError: false, error: null })
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children
    }

    return (
      <View style={styles.container}>
        <Text style={styles.emoji}>😬</Text>
        <Text style={styles.title}>Something went wrong</Text>
        <Text style={styles.sub}>
          CheckOff hit an unexpected error. Your data is safe — tap below to try again.
        </Text>

        <TouchableOpacity
          style={styles.btn}
          onPress={() => this.reset()}
          activeOpacity={0.88}
        >
          <Text style={styles.btnText}>Try again</Text>
        </TouchableOpacity>

        {__DEV__ && this.state.error && (
          <Text style={styles.debug} numberOfLines={6}>
            {this.state.error.toString()}
          </Text>
        )}
      </View>
    )
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: BG,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  emoji:  { fontSize: 52, marginBottom: 16 },
  title:  { fontSize: 24, fontWeight: '800', color: TEXT, marginBottom: 12, textAlign: 'center' },
  sub:    { fontSize: 14, color: MUTED, textAlign: 'center', lineHeight: 21, marginBottom: 32, fontWeight: '500' },
  btn:    { backgroundColor: AMBER, borderRadius: 16, paddingVertical: 16, paddingHorizontal: 40, alignItems: 'center' },
  btnText:{ fontSize: 15, fontWeight: '800', color: NAVY },
  debug:  { marginTop: 24, fontSize: 10, color: MUTED, fontFamily: 'monospace', textAlign: 'left', width: '100%' },
})
