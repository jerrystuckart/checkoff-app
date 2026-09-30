import ExpoModulesCore
import UIKit
import os.log

/// Apple: when the OS relaunches a terminated app for a significant location change, the launch options carry
/// UIApplication.LaunchOptionsKey.location and the app must recreate its location manager and restart the service.
/// Doing it here (before React Native and JS exist) means the triggering location is delivered and queued even if JS is slow.
public final class CheckoffMovementAppDelegate: ExpoAppDelegateSubscriber {
  public func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
    os_log("didFinishLaunching (locationLaunch=%{public}@)", log: movementLog, type: .info, launchOptions?[.location] != nil ? "yes" : "no")
    MovementMonitor.shared.resumeIfEnabled()
    return true
  }
}
