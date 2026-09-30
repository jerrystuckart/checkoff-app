import CoreLocation
import Foundation
import os.log

/// Diagnostics for device testing (Console.app, subsystem com.checkoff.movement). Never logs coordinates.
let movementLog = OSLog(subsystem: "com.checkoff.movement", category: "lifecycle")

/// Owns the OS significant-location-change subscription and a small persistent queue of movement hints.
///
/// Design rules (see docs/visit-recovery/native_movement_refresh.md):
///  * It only ever reports WHERE THE PHONE ROUGHLY IS after a >= ~500 m move. It never decides dwell, visits, check-offs or points.
///  * Apple: the service relaunches a terminated app into the background when a new location arrives, but the app must recreate
///    the location manager and call startMonitoringSignificantLocationChanges() again. `resumeIfEnabled()` does exactly that, and
///    is called from the app-delegate subscriber (launch reason .location) as well as when the module is created.
///  * Hints are persisted in UserDefaults until JS consumes them, so a relaunch that happens before the JS listener is attached
///    loses nothing. The queue is bounded.
///  * The user's force-quit is an OS rule this code cannot override.
final class MovementMonitor: NSObject, CLLocationManagerDelegate {
  static let shared = MovementMonitor()

  private let enabledKey = "checkoff.movement.enabled"
  private let pendingKey = "checkoff.movement.pending"
  private let maxPending = 20
  private var manager: CLLocationManager?
  private var onHint: (() -> Void)?

  private override init() { super.init() }

  var isEnabled: Bool { UserDefaults.standard.bool(forKey: enabledKey) }

  func setHintListener(_ listener: (() -> Void)?) { onHint = listener }

  /// Result strings are part of the JS contract: 'started' | 'unavailable' | 'no_always_permission'.
  @discardableResult
  func start() -> String {
    guard CLLocationManager.significantLocationChangeMonitoringAvailable() else { return "unavailable" }
    let status = CLLocationManager().authorizationStatus
    guard status == .authorizedAlways else { return "no_always_permission" }
    UserDefaults.standard.set(true, forKey: enabledKey)
    attachManagerAndStart()
    return "started"
  }

  func stop() {
    UserDefaults.standard.set(false, forKey: enabledKey)
    DispatchQueue.main.async {
      self.manager?.stopMonitoringSignificantLocationChanges()
      self.manager?.delegate = nil
      self.manager = nil
    }
    UserDefaults.standard.removeObject(forKey: pendingKey)
  }

  /// Called on every launch (incl. a background relaunch caused by a location event) and when the module is created.
  func resumeIfEnabled() {
    guard isEnabled, CLLocationManager.significantLocationChangeMonitoringAvailable() else { return }
    if CLLocationManager().authorizationStatus != .authorizedAlways { return }
    attachManagerAndStart()
  }

  private func attachManagerAndStart() {
    DispatchQueue.main.async {
      if self.manager == nil {
        let m = CLLocationManager()
        m.delegate = self
        self.manager = m
      }
      // Apple: calling this repeatedly does not generate new events; stopping first resets the behaviour, and a relaunch must
      // restart the service. Stop-then-start is therefore always safe and is what delivers the current event after a relaunch.
      self.manager?.stopMonitoringSignificantLocationChanges()
      self.manager?.startMonitoringSignificantLocationChanges()
    }
  }

  /// Returns and clears the queued hints (oldest first).
  func consumePending() -> [[String: Any]] {
    let defaults = UserDefaults.standard
    let list = (defaults.array(forKey: pendingKey) as? [[String: Any]]) ?? []
    defaults.removeObject(forKey: pendingKey)
    return list
  }

  // MARK: CLLocationManagerDelegate

  func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
    guard let loc = locations.last else { return }
    let hint: [String: Any] = [
      "latitude": loc.coordinate.latitude,
      "longitude": loc.coordinate.longitude,
      "accuracy": loc.horizontalAccuracy,
      "timestampMs": Int64(loc.timestamp.timeIntervalSince1970 * 1000),
      "receivedAtMs": Int64(Date().timeIntervalSince1970 * 1000),
      "appState": UIApplication.shared.applicationState.rawValue, // 0 active, 1 inactive, 2 background
    ]
    let defaults = UserDefaults.standard
    var list = (defaults.array(forKey: pendingKey) as? [[String: Any]]) ?? []
    list.append(hint)
    if list.count > maxPending { list.removeFirst(list.count - maxPending) }
    defaults.set(list, forKey: pendingKey)
    os_log("hint queued (pending=%d, appState=%d, jsListening=%{public}@)", log: movementLog, type: .info, list.count, UIApplication.shared.applicationState.rawValue, onHint == nil ? "no" : "yes")
    onHint?()
  }

  func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
    // Not fatal: the next significant change retries. Nothing to surface to JS.
  }

  func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
    if isEnabled && manager.authorizationStatus != .authorizedAlways {
      // Permission was downgraded: stop cleanly so JS sees 'no_always_permission' on its next start() attempt.
      manager.stopMonitoringSignificantLocationChanges()
    } else if isEnabled {
      manager.stopMonitoringSignificantLocationChanges()
      manager.startMonitoringSignificantLocationChanges()
    }
  }
}
