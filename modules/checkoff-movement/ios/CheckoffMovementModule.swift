import ExpoModulesCore
import CoreLocation

private let MOVEMENT_EVENT = "onMovement"

/// JS surface: isAvailableAsync, startAsync, stopAsync, isEnabledAsync, consumePendingAsync + event "onMovement" (no payload:
/// JS calls consumePendingAsync, so a hint is never handled twice and never lost if it arrives before the listener exists).
public final class CheckoffMovementModule: Module {
  public func definition() -> ModuleDefinition {
    Name("CheckoffMovement")

    Events(MOVEMENT_EVENT)

    OnCreate {
      MovementMonitor.shared.resumeIfEnabled()
    }

    OnStartObserving(MOVEMENT_EVENT) {
      MovementMonitor.shared.setHintListener { [weak self] in
        self?.sendEvent(MOVEMENT_EVENT, [:])
      }
      // Hints that arrived before JS was listening (e.g. a background relaunch): tell JS to drain them now.
      self.sendEvent(MOVEMENT_EVENT, [:])
    }

    OnStopObserving(MOVEMENT_EVENT) {
      MovementMonitor.shared.setHintListener(nil)
    }

    AsyncFunction("isAvailableAsync") { () -> Bool in
      return CLLocationManager.significantLocationChangeMonitoringAvailable()
    }

    AsyncFunction("isEnabledAsync") { () -> Bool in
      return MovementMonitor.shared.isEnabled
    }

    AsyncFunction("startAsync") { () -> String in
      return MovementMonitor.shared.start()
    }

    AsyncFunction("stopAsync") { () in
      MovementMonitor.shared.stop()
    }

    AsyncFunction("consumePendingAsync") { () -> [[String: Any]] in
      return MovementMonitor.shared.consumePending()
    }
  }
}
