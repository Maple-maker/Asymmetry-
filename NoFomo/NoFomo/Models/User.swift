import Foundation

struct AppUser: Codable {
    let id: String
    let email: String?
    let subscriptionTier: SubscriptionTier
    let apnsToken: String?

    enum CodingKeys: String, CodingKey {
        case id, email
        case subscriptionTier = "subscription_tier"
        case apnsToken = "apns_token"
    }
}

enum SubscriptionTier: String, Codable {
    case free
    case pro
    case annual

    var displayName: String {
        switch self {
        case .free: return "Free"
        case .pro: return "Pro — $9.99/mo"
        case .annual: return "Annual — $79.99/yr"
        }
    }

    var alertsPerDay: Int {
        switch self {
        case .free: return 1
        case .pro, .annual: return Int.max
        }
    }

    var isDelayed: Bool { self == .free }
    var hasFull: Bool { self != .free }
}
