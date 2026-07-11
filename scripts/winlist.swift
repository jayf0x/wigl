// Lists wigl's OS windows (bounds, layer, onscreen) without needing
// Accessibility or Screen Recording permission — works in sandboxed agent
// shells where screenshots and osascript don't. Note: the onscreen flag
// flip-flops with Space/display focus; trust bounds + count, not onscreen.
import CoreGraphics

let list = CGWindowListCopyWindowInfo([.optionAll], kCGNullWindowID) as! [[String: Any]]
var found = 0
for w in list where (w["kCGWindowOwnerName"] as? String) == "wigl" {
    let b = w["kCGWindowBounds"] as? [String: Any] ?? [:]
    let width = b["Width"] as? Int ?? 0
    let height = b["Height"] as? Int ?? 0
    // skip the tiny system companion windows (menu-bar shadows etc.)
    if height <= 40 && width > 500 { continue }
    found += 1
    print("window \(found): \(width)x\(height) at (\(b["X"] ?? "?"), \(b["Y"] ?? "?"))",
          "onscreen:", w["kCGWindowIsOnscreen"] as? Bool ?? false)
}
if found == 0 { print("no wigl windows found — is the app running?") }
