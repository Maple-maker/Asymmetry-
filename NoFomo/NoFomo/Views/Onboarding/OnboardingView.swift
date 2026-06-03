import SwiftUI
import AuthenticationServices

struct OnboardingView: View {
    @EnvironmentObject var auth: AuthService
    @State private var page = 0
    @State private var showAuth = false
    @State private var email = ""
    @State private var password = ""
    @State private var isLoading = false
    @State private var errorMessage: String?

    private let pages: [(icon: String, title: String, subtitle: String)] = [
        ("antenna.radiowaves.left.and.right.fill",
         "Never miss alpha again.",
         "No Fomo scans government contracts, FDA approvals, earnings transcripts, and tech giant signals — 24/7."),
        ("brain.fill",
         "AI council debates every pick.",
         "Gemini, DeepSeek, and an AI CIO each argue bull AND bear — you get the synthesis, not a single opinion."),
        ("chart.bar.fill",
         "Only the best surface.",
         "A 75/100 conviction gate filters noise. You see Tier 1 and Tier 2 opportunities only. No filler."),
        ("bell.fill",
         "Get the BLUF. Read the rest when you want.",
         "Real-time push alert with the key insight. Full debate, financials, and buy zones in the app."),
    ]

    var body: some View {
        ZStack {
            DS.Color.background.ignoresSafeArea()

            if showAuth {
                authView
                    .transition(.asymmetric(insertion: .move(edge: .trailing), removal: .move(edge: .leading)))
            } else {
                onboardingCarousel
                    .transition(.asymmetric(insertion: .move(edge: .leading), removal: .move(edge: .trailing)))
            }
        }
        .animation(.spring(response: 0.4), value: showAuth)
    }

    // MARK: — Carousel

    private var onboardingCarousel: some View {
        VStack(spacing: 0) {
            Spacer()

            // Icon
            Image(systemName: pages[page].icon)
                .font(.system(size: 64, weight: .medium))
                .foregroundStyle(
                    LinearGradient(colors: [DS.Color.bull, DS.Color.tier2], startPoint: .topLeading, endPoint: .bottomTrailing)
                )
                .padding(.bottom, 40)

            Text(pages[page].title)
                .font(DS.Font.displayBold(28))
                .foregroundColor(.white)
                .multilineTextAlignment(.center)
                .padding(.horizontal, DS.paddingScreen)

            Text(pages[page].subtitle)
                .font(DS.Font.body(16))
                .foregroundColor(DS.Color.textSecondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, DS.paddingScreen)
                .padding(.top, 12)

            Spacer()

            // Page dots
            HStack(spacing: 6) {
                ForEach(0..<pages.count, id: \.self) { i in
                    Capsule()
                        .fill(i == page ? DS.Color.bull : DS.Color.border)
                        .frame(width: i == page ? 20 : 6, height: 6)
                }
            }
            .padding(.bottom, 32)

            // CTA
            VStack(spacing: 12) {
                if page < pages.count - 1 {
                    Button(action: { withAnimation { page += 1 } }) {
                        Text("Continue")
                            .font(DS.Font.displayMedium(16))
                            .foregroundColor(.black)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 16)
                            .background(DS.Color.bull)
                            .clipShape(RoundedRectangle(cornerRadius: 14))
                    }
                } else {
                    Button(action: { withAnimation { showAuth = true } }) {
                        Text("Get Started — Free")
                            .font(DS.Font.displayMedium(16))
                            .foregroundColor(.black)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 16)
                            .background(DS.Color.bull)
                            .clipShape(RoundedRectangle(cornerRadius: 14))
                    }
                }

                Button(action: { withAnimation { showAuth = true } }) {
                    Text("I already have an account")
                        .font(DS.Font.body(14))
                        .foregroundColor(DS.Color.textSecondary)
                }
            }
            .padding(.horizontal, DS.paddingScreen)
            .padding(.bottom, 48)
        }
    }

    // MARK: — Auth

    private var authView: some View {
        VStack(spacing: 0) {
            // Back
            HStack {
                Button(action: { withAnimation { showAuth = false } }) {
                    Image(systemName: "chevron.left")
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundColor(DS.Color.textSecondary)
                }
                Spacer()
            }
            .padding(.horizontal, DS.paddingScreen)
            .padding(.top, 60)

            Spacer()

            VStack(alignment: .leading, spacing: 6) {
                Text("No Fomo")
                    .font(DS.Font.displayBold(32))
                    .foregroundColor(.white)
                Text("Sign in to access the radar.")
                    .font(DS.Font.body())
                    .foregroundColor(DS.Color.textSecondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, DS.paddingScreen)

            Spacer()

            VStack(spacing: 12) {
                // Sign in with Apple (primary)
                SignInWithAppleButton(.signIn) { req in
                    req.requestedScopes = [.email]
                } onCompletion: { result in
                    Task {
                        switch result {
                        case .success(let auth):
                            isLoading = true
                            try? await AuthService.shared.handleAppleSignIn(auth)
                            isLoading = false
                        case .failure(let err):
                            errorMessage = err.localizedDescription
                        }
                    }
                }
                .signInWithAppleButtonStyle(.white)
                .frame(height: 54)
                .clipShape(RoundedRectangle(cornerRadius: 14))

                // Divider
                HStack {
                    Rectangle().fill(DS.Color.border).frame(height: 0.5)
                    Text("or")
                        .font(DS.Font.caption())
                        .foregroundColor(DS.Color.textMuted)
                        .padding(.horizontal, 12)
                    Rectangle().fill(DS.Color.border).frame(height: 0.5)
                }

                // Email
                VStack(spacing: 10) {
                    TextField("Email", text: $email)
                        .textFieldStyle(NFFTextField())
                        .keyboardType(.emailAddress)
                        .autocapitalization(.none)
                    SecureField("Password", text: $password)
                        .textFieldStyle(NFFTextField())
                }

                if let err = errorMessage {
                    Text(err)
                        .font(DS.Font.caption())
                        .foregroundColor(DS.Color.bear)
                }

                Button(action: {
                    Task {
                        isLoading = true
                        errorMessage = nil
                        do {
                            try await AuthService.shared.signInWithEmail(email, password: password)
                        } catch {
                            errorMessage = "Sign in failed. Check your credentials."
                        }
                        isLoading = false
                    }
                }) {
                    Group {
                        if isLoading {
                            ProgressView().tint(.black)
                        } else {
                            Text("Continue with Email")
                                .font(DS.Font.displayMedium(16))
                                .foregroundColor(.black)
                        }
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 16)
                    .background(DS.Color.bull)
                    .clipShape(RoundedRectangle(cornerRadius: 14))
                }
                .disabled(isLoading || email.isEmpty || password.isEmpty)

                Button(action: {
                    Task {
                        isLoading = true
                        try? await AuthService.shared.signUp(email: email, password: password)
                        isLoading = false
                    }
                }) {
                    Text("Create account")
                        .font(DS.Font.body(14))
                        .foregroundColor(DS.Color.tier2)
                }
            }
            .padding(.horizontal, DS.paddingScreen)
            .padding(.bottom, 48)
        }
    }
}

// MARK: — Custom text field style

struct NFFTextField: TextFieldStyle {
    func _body(configuration: TextField<Self._Label>) -> some View {
        configuration
            .font(DS.Font.body())
            .foregroundColor(.white)
            .padding(14)
            .background(DS.Color.card)
            .overlay(RoundedRectangle(cornerRadius: 10).stroke(DS.Color.border, lineWidth: 0.5))
            .clipShape(RoundedRectangle(cornerRadius: 10))
    }
}
