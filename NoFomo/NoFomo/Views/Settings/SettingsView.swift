import SwiftUI

struct SettingsView: View {
    @EnvironmentObject var auth: AuthService

    var body: some View {
        NavigationStack {
            ZStack {
                DS.Color.background.ignoresSafeArea()
                List {
                    // Subscription section
                    Section {
                        subscriptionCard
                    }
                    .listRowBackground(DS.Color.card)
                    .listRowSeparatorTint(DS.Color.border)

                    Section("Alerts") {
                        toggle("Tier 1 alerts", icon: "bolt.fill", color: DS.Color.tier1)
                        toggle("Tier 2 alerts", icon: "bell.fill", color: DS.Color.tier2)
                        toggle("FDA approvals", icon: "pills.fill", color: DS.Color.bull)
                        toggle("Gov contracts", icon: "building.columns.fill", color: DS.Color.accent)
                        toggle("Partnerships", icon: "link", color: DS.Color.neutral)
                    }
                    .listRowBackground(DS.Color.card)
                    .listRowSeparatorTint(DS.Color.border)

                    Section("About") {
                        infoRow("Version", value: "1.0.0")
                        infoRow("Not investment advice", value: "For research only")
                    }
                    .listRowBackground(DS.Color.card)
                    .listRowSeparatorTint(DS.Color.border)

                    Section {
                        Button(action: { auth.signOut() }) {
                            Text("Sign Out")
                                .foregroundColor(DS.Color.bear)
                                .frame(maxWidth: .infinity, alignment: .center)
                        }
                    }
                    .listRowBackground(DS.Color.card)
                }
                .scrollContentBackground(.hidden)
                .navigationTitle("Account")
                .navigationBarTitleDisplayMode(.large)
                .toolbarColorScheme(.dark, for: .navigationBar)
            }
        }
    }

    private var subscriptionCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(auth.currentUser?.subscriptionTier.displayName ?? "Free")
                        .font(DS.Font.displayBold(16))
                        .foregroundColor(.white)
                    Text(auth.currentUser?.subscriptionTier == .free ? "1 alert/day · 24h delayed" : "Unlimited real-time alerts")
                        .font(DS.Font.caption(12))
                        .foregroundColor(DS.Color.textSecondary)
                }
                Spacer()
                if auth.currentUser?.subscriptionTier == .free {
                    Button(action: {}) {
                        Text("Upgrade")
                            .font(DS.Font.caption(12))
                            .foregroundColor(.black)
                            .padding(.horizontal, 14)
                            .padding(.vertical, 8)
                            .background(DS.Color.tier1)
                            .clipShape(Capsule())
                    }
                }
            }
            if auth.currentUser?.subscriptionTier == .free {
                Text("Pro: $9.99/mo · Annual: $79.99/yr (save 33%)")
                    .font(DS.Font.caption(11))
                    .foregroundColor(DS.Color.tier1)
            }
        }
    }

    @State private var alertToggles: [String: Bool] = [:]

    private func toggle(_ label: String, icon: String, color: Color) -> some View {
        HStack(spacing: 12) {
            Image(systemName: icon)
                .foregroundColor(color)
                .frame(width: 20)
            Text(label)
                .foregroundColor(.white)
                .font(DS.Font.body())
            Spacer()
            Toggle("", isOn: Binding(
                get: { alertToggles[label] ?? true },
                set: { alertToggles[label] = $0 }
            ))
            .tint(DS.Color.bull)
        }
    }

    private func infoRow(_ label: String, value: String) -> some View {
        HStack {
            Text(label).foregroundColor(.white).font(DS.Font.body())
            Spacer()
            Text(value).foregroundColor(DS.Color.textSecondary).font(DS.Font.caption())
        }
    }
}
