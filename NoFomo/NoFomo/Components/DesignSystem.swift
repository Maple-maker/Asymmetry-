import SwiftUI

// MARK: — No Fomo Design System

enum DS {

    // MARK: Colors
    enum Color {
        static let background     = SwiftUI.Color(hex: "#0A0A0F")
        static let card           = SwiftUI.Color(hex: "#12121A")
        static let cardElevated   = SwiftUI.Color(hex: "#1A1A25")
        static let border         = SwiftUI.Color(hex: "#2A2A35")

        static let bull           = SwiftUI.Color(hex: "#00FF88")
        static let bear           = SwiftUI.Color(hex: "#FF3B5C")
        static let neutral        = SwiftUI.Color(hex: "#FFB800")

        static let tier1          = SwiftUI.Color(hex: "#FFD700")  // gold
        static let tier2          = SwiftUI.Color(hex: "#00BFFF")  // electric blue
        static let tier3          = SwiftUI.Color(hex: "#888888")  // gray

        static let textPrimary    = SwiftUI.Color.white
        static let textSecondary  = SwiftUI.Color(hex: "#888888")
        static let textMuted      = SwiftUI.Color(hex: "#555566")

        static let accent         = SwiftUI.Color(hex: "#7B61FF")  // purple accent
    }

    // MARK: Typography
    enum Font {
        static func displayBold(_ size: CGFloat) -> SwiftUI.Font { .system(size: size, weight: .bold, design: .default) }
        static func displayMedium(_ size: CGFloat) -> SwiftUI.Font { .system(size: size, weight: .medium, design: .default) }
        static func mono(_ size: CGFloat) -> SwiftUI.Font { .system(size: size, weight: .semibold, design: .monospaced) }
        static func body(_ size: CGFloat = 15) -> SwiftUI.Font { .system(size: size, weight: .regular) }
        static func caption(_ size: CGFloat = 12) -> SwiftUI.Font { .system(size: size, weight: .medium) }
    }

    // MARK: Radius / Spacing
    static let radiusCard: CGFloat = 16
    static let radiusSmall: CGFloat = 8
    static let paddingCard: CGFloat = 16
    static let paddingScreen: CGFloat = 20
}

// MARK: — Color hex init

extension Color {
    init(hex: String) {
        let scanner = Scanner(string: hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted))
        var rgb: UInt64 = 0
        scanner.scanHexInt64(&rgb)
        let r = Double((rgb >> 16) & 0xFF) / 255
        let g = Double((rgb >> 8) & 0xFF) / 255
        let b = Double(rgb & 0xFF) / 255
        self.init(red: r, green: g, blue: b)
    }
}

// MARK: — Verdict color/label helpers

extension Verdict {
    var color: Color {
        switch self {
        case .bull: return DS.Color.bull
        case .bear: return DS.Color.bear
        case .neutral: return DS.Color.neutral
        }
    }
    var label: String {
        switch self {
        case .bull: return "BULL"
        case .bear: return "BEAR"
        case .neutral: return "NEUTRAL"
        }
    }
    var icon: String {
        switch self {
        case .bull: return "arrow.up.right"
        case .bear: return "arrow.down.right"
        case .neutral: return "minus"
        }
    }
}

extension Int {
    var tierColor: Color {
        switch self {
        case 1: return DS.Color.tier1
        case 2: return DS.Color.tier2
        default: return DS.Color.tier3
        }
    }
    var tierLabel: String {
        switch self {
        case 1: return "TIER 1 — EXCEPTIONAL"
        case 2: return "TIER 2 — HIGH CONVICTION"
        default: return "TIER 3 — WATCH"
        }
    }
    var tierShort: String {
        switch self {
        case 1: return "T1"
        case 2: return "T2"
        default: return "T3"
        }
    }
}
