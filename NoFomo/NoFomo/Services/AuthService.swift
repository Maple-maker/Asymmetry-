import Foundation
import AuthenticationServices

@MainActor
final class AuthService: ObservableObject {
    static let shared = AuthService()

    @Published var currentUser: AppUser?
    @Published var isAuthenticated = false
    @Published var currentToken: String?

    private let supabaseURL = "https://jmtkygwvmrolfvwueggs.supabase.co"
    private let anonKey = "YOUR_SUPABASE_ANON_KEY"

    private init() {
        loadStoredSession()
    }

    // MARK: - Sign in with Apple

    func handleAppleSignIn(_ authorization: ASAuthorization) async throws {
        guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential,
              let tokenData = credential.identityToken,
              let identityToken = String(data: tokenData, encoding: .utf8) else {
            throw AppError.unauthorized
        }

        let url = URL(string: "\(supabaseURL)/auth/v1/token?grant_type=id_token")!
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue(anonKey, forHTTPHeaderField: "apikey")
        req.httpBody = try JSONEncoder().encode([
            "provider": "apple",
            "id_token": identityToken,
        ])

        let (data, _) = try await URLSession.shared.data(for: req)
        let response = try JSONDecoder().decode(AuthResponse.self, from: data)
        await handleAuthResponse(response)
    }

    // MARK: - Email/password (fallback)

    func signInWithEmail(_ email: String, password: String) async throws {
        let url = URL(string: "\(supabaseURL)/auth/v1/token?grant_type=password")!
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue(anonKey, forHTTPHeaderField: "apikey")
        req.httpBody = try JSONEncoder().encode(["email": email, "password": password])
        let (data, _) = try await URLSession.shared.data(for: req)
        let response = try JSONDecoder().decode(AuthResponse.self, from: data)
        await handleAuthResponse(response)
    }

    func signUp(email: String, password: String) async throws {
        let url = URL(string: "\(supabaseURL)/auth/v1/signup")!
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue(anonKey, forHTTPHeaderField: "apikey")
        req.httpBody = try JSONEncoder().encode(["email": email, "password": password])
        let (data, _) = try await URLSession.shared.data(for: req)
        let response = try JSONDecoder().decode(AuthResponse.self, from: data)
        await handleAuthResponse(response)
    }

    func signOut() {
        currentToken = nil
        currentUser = nil
        isAuthenticated = false
        UserDefaults.standard.removeObject(forKey: "auth_token")
        UserDefaults.standard.removeObject(forKey: "auth_user_id")
    }

    // MARK: - Private

    private func handleAuthResponse(_ response: AuthResponse) async {
        currentToken = response.accessToken
        UserDefaults.standard.set(response.accessToken, forKey: "auth_token")
        UserDefaults.standard.set(response.user.id, forKey: "auth_user_id")
        currentUser = AppUser(
            id: response.user.id,
            email: response.user.email,
            subscriptionTier: .free,
            apnsToken: nil
        )
        isAuthenticated = true
    }

    private func loadStoredSession() {
        guard let token = UserDefaults.standard.string(forKey: "auth_token"),
              let userId = UserDefaults.standard.string(forKey: "auth_user_id") else { return }
        currentToken = token
        currentUser = AppUser(id: userId, email: nil, subscriptionTier: .free, apnsToken: nil)
        isAuthenticated = true
    }
}

private struct AuthResponse: Codable {
    let accessToken: String
    let user: AuthUser

    enum CodingKeys: String, CodingKey {
        case accessToken = "access_token"
        case user
    }
}

private struct AuthUser: Codable {
    let id: String
    let email: String?
}
