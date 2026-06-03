import SwiftUI

// MARK: — Main feed card

struct OpportunityCard: View {
    let opportunity: Opportunity
    var onTap: () -> Void = {}
    var onWatchlist: () -> Void = {}

    @State private var isWatchlisted = false

    var body: some View {
        Button(action: onTap) {
            VStack(alignment: .leading, spacing: 0) {
                // ── Header row
                headerRow
                    .padding(.horizontal, DS.paddingCard)
                    .padding(.top, DS.paddingCard)

                // ── BLUF
                Text(opportunity.bluf)
                    .font(DS.Font.body(15))
                    .foregroundColor(.white)
                    .lineLimit(3)
                    .padding(.horizontal, DS.paddingCard)
                    .padding(.top, 10)

                // ── Source tag
                HStack(spacing: 6) {
                    Image(systemName: "bolt.fill")
                        .font(.system(size: 10))
                        .foregroundColor(DS.Color.tier1)
                    Text("Signal: \(opportunity.sourceCompany) → \(opportunity.signalShort)")
                        .font(DS.Font.caption(11))
                        .foregroundColor(DS.Color.textSecondary)
                }
                .padding(.horizontal, DS.paddingCard)
                .padding(.top, 8)

                // ── Metrics strip
                metricsStrip
                    .padding(.horizontal, DS.paddingCard)
                    .padding(.top, 12)

                // ── AI Council verdict row
                councilRow
                    .padding(.horizontal, DS.paddingCard)
                    .padding(.vertical, 12)

                // ── Buy zone footer (premium blur if locked)
                buyZoneFooter
            }
            .background(DS.Color.card)
            .clipShape(RoundedRectangle(cornerRadius: DS.radiusCard))
            .overlay(
                RoundedRectangle(cornerRadius: DS.radiusCard)
                    .stroke(tierBorderColor, lineWidth: 0.5)
            )
        }
        .buttonStyle(.plain)
    }

    // MARK: — Sub-views

    private var headerRow: some View {
        HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 4) {
                // Badge row: tier + optional triple signal
                HStack(spacing: 6) {
                    Text(opportunity.tier.tierShort)
                        .font(DS.Font.caption(10))
                        .foregroundColor(opportunity.tier.tierColor)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 3)
                        .background(opportunity.tier.tierColor.opacity(0.15))
                        .clipShape(Capsule())

                    if opportunity.isTripleSignal {
                        HStack(spacing: 3) {
                            Image(systemName: "bolt.fill")
                                .font(.system(size: 9, weight: .bold))
                            Text("TRIPLE SIGNAL")
                                .font(DS.Font.caption(9))
                        }
                        .foregroundColor(DS.Color.tier1)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 3)
                        .background(DS.Color.tier1.opacity(0.15))
                        .clipShape(Capsule())
                        .overlay(Capsule().stroke(DS.Color.tier1.opacity(0.4), lineWidth: 0.5))
                    }
                }

                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text("$\(opportunity.ticker)")
                        .font(DS.Font.displayBold(22))
                        .foregroundColor(.white)
                    Text(opportunity.companyName)
                        .font(DS.Font.body(13))
                        .foregroundColor(DS.Color.textSecondary)
                        .lineLimit(1)
                }
            }

            Spacer()

            VStack(alignment: .trailing, spacing: 6) {
                ScoreGauge(score: opportunity.overallScore, size: 56)

                // Watchlist button
                Button(action: {
                    isWatchlisted.toggle()
                    onWatchlist()
                }) {
                    Image(systemName: isWatchlisted ? "bookmark.fill" : "bookmark")
                        .font(.system(size: 14))
                        .foregroundColor(isWatchlisted ? DS.Color.tier1 : DS.Color.textSecondary)
                }
            }
        }
    }

    private var metricsStrip: some View {
        HStack(spacing: 0) {
            if let price = opportunity.snap?.price {
                metricPill(label: "Price", value: "$\(String(format: "%.2f", price))")
                Divider().frame(height: 24).background(DS.Color.border)
            }
            if let upside = opportunity.upsidePct {
                metricPill(label: "Upside", value: "+\(Int(upside))%", color: DS.Color.bull)
                Divider().frame(height: 24).background(DS.Color.border)
            }
            if let cap = opportunity.snap?.formattedMarketCap {
                metricPill(label: "Mkt Cap", value: cap)
                Divider().frame(height: 24).background(DS.Color.border)
            }
            metricPill(label: "Prob.", value: "\(Int(opportunity.probabilityScore))%",
                       color: opportunity.probabilityScore >= 65 ? DS.Color.bull : DS.Color.neutral)
        }
        .padding(.vertical, 8)
        .background(DS.Color.cardElevated)
        .clipShape(RoundedRectangle(cornerRadius: DS.radiusSmall))
    }

    private func metricPill(label: String, value: String, color: Color = .white) -> some View {
        VStack(spacing: 2) {
            Text(label)
                .font(DS.Font.caption(10))
                .foregroundColor(DS.Color.textSecondary)
            Text(value)
                .font(DS.Font.mono(13))
                .foregroundColor(color)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 6)
    }

    private var councilRow: some View {
        HStack(spacing: 8) {
            Text("AI Council")
                .font(DS.Font.caption(11))
                .foregroundColor(DS.Color.textSecondary)

            Spacer()

            VerdictChip(label: "Gemini", verdict: opportunity.geminiVerdict)
            VerdictChip(label: "DeepSeek", verdict: opportunity.deepseekVerdict)
            VerdictChip(label: "CIO", verdict: opportunity.debateVerdict, isHighlighted: true)
        }
    }

    private var buyZoneFooter: some View {
        Group {
            if opportunity.isPremium && !(AuthService.shared.currentUser?.subscriptionTier.hasFull ?? false) {
                // Locked — blur + paywall prompt
                ZStack {
                    HStack {
                        buyZoneContent
                    }
                    .blur(radius: 6)

                    HStack(spacing: 6) {
                        Image(systemName: "lock.fill")
                            .font(.system(size: 12))
                        Text("Pro — unlock buy zones")
                            .font(DS.Font.caption())
                    }
                    .foregroundColor(.white)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 8)
                    .background(.ultraThinMaterial)
                    .clipShape(Capsule())
                }
                .padding(.horizontal, DS.paddingCard)
                .padding(.bottom, DS.paddingCard)
            } else {
                buyZoneContent
                    .padding(.horizontal, DS.paddingCard)
                    .padding(.bottom, DS.paddingCard)
            }
        }
    }

    private var buyZoneContent: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("BUY ZONES")
                .font(DS.Font.caption(10))
                .foregroundColor(DS.Color.textSecondary)

            HStack(spacing: 8) {
                if let aggressive = opportunity.buyZoneAggressive {
                    buyZoneBadge("Aggressive", price: aggressive, color: DS.Color.bull)
                }
                if let base = opportunity.buyZoneBase {
                    buyZoneBadge("Base", price: base, color: DS.Color.neutral)
                }
                if let conservative = opportunity.buyZoneConservative {
                    buyZoneBadge("Conservative", price: conservative, color: DS.Color.textSecondary)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(DS.Color.cardElevated)
        .clipShape(RoundedRectangle(cornerRadius: DS.radiusSmall))
    }

    private func buyZoneBadge(_ label: String, price: Double, color: Color) -> some View {
        VStack(spacing: 2) {
            Text(label)
                .font(DS.Font.caption(9))
                .foregroundColor(DS.Color.textSecondary)
            Text("$\(String(format: "%.2f", price))")
                .font(DS.Font.mono(13))
                .foregroundColor(color)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(color.opacity(0.1))
        .clipShape(RoundedRectangle(cornerRadius: 6))
    }

    private var tierBorderColor: Color {
        switch opportunity.tier {
        case 1: return DS.Color.tier1.opacity(0.4)
        case 2: return DS.Color.tier2.opacity(0.3)
        default: return DS.Color.border
        }
    }
}

// MARK: — Verdict chip

struct VerdictChip: View {
    let label: String
    let verdict: Verdict
    var isHighlighted = false

    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: verdict.icon)
                .font(.system(size: 9, weight: .bold))
            Text(isHighlighted ? "CIO: \(verdict.label)" : label)
                .font(DS.Font.caption(10))
        }
        .foregroundColor(verdict.color)
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .background(verdict.color.opacity(isHighlighted ? 0.2 : 0.1))
        .clipShape(Capsule())
        .overlay(
            Capsule().stroke(isHighlighted ? verdict.color.opacity(0.5) : .clear, lineWidth: 0.5)
        )
    }
}

// MARK: — Helper

private extension Opportunity {
    var signalShort: String {
        let theme = sourceCompany
        if theme.count > 30 { return String(theme.prefix(30)) + "…" }
        return theme
    }
}

#Preview {
    ScrollView {
        OpportunityCard(opportunity: .mock)
            .padding()
    }
    .background(DS.Color.background)
}
