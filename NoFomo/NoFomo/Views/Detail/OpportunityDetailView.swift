import SwiftUI

struct OpportunityDetailView: View {
    let opportunity: Opportunity
    @Environment(\.dismiss) private var dismiss
    @State private var expandedSection: Section? = .bluf

    enum Section: String, CaseIterable {
        case bluf        = "BLUF"
        case council     = "AI Council Debate"
        case financials  = "Financials"
        case buyZones    = "Buy Zones"
        case bearCase    = "Bear Case"
        case source      = "Source"
    }

    var body: some View {
        ZStack(alignment: .top) {
            DS.Color.background.ignoresSafeArea()

            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    // ── Hero header
                    heroHeader
                        .padding(.horizontal, DS.paddingScreen)
                        .padding(.top, 16)

                    // ── Score row
                    scoreRow
                        .padding(.horizontal, DS.paddingScreen)
                        .padding(.top, 16)

                    // ── Probability bar
                    probabilitySection
                        .padding(.horizontal, DS.paddingScreen)
                        .padding(.top, 16)

                    // ── Expandable sections
                    VStack(spacing: 8) {
                        ForEach(Section.allCases, id: \.self) { section in
                            sectionCard(section)
                        }
                    }
                    .padding(.horizontal, DS.paddingScreen)
                    .padding(.top, 16)
                    .padding(.bottom, 100)
                }
            }
        }
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                Button(action: {}) {
                    Image(systemName: "square.and.arrow.up")
                        .foregroundColor(DS.Color.textSecondary)
                }
            }
        }
    }

    // MARK: — Hero

    private var heroHeader: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Text(opportunity.tier.tierShort)
                    .font(DS.Font.caption(11))
                    .foregroundColor(opportunity.tier.tierColor)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 4)
                    .background(opportunity.tier.tierColor.opacity(0.15))
                    .clipShape(Capsule())

                ProbabilityBadge(probability: opportunity.probabilityScore)

                Spacer()

                Text(opportunity.publishedAt.timeAgo)
                    .font(DS.Font.caption(11))
                    .foregroundColor(DS.Color.textMuted)
            }

            HStack(alignment: .bottom, spacing: 10) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("$\(opportunity.ticker)")
                        .font(DS.Font.displayBold(32))
                        .foregroundColor(.white)
                    Text(opportunity.companyName)
                        .font(DS.Font.body(15))
                        .foregroundColor(DS.Color.textSecondary)
                }
                Spacer()
                if let price = opportunity.snap?.price {
                    VStack(alignment: .trailing, spacing: 2) {
                        Text("$\(String(format: "%.2f", price))")
                            .font(DS.Font.mono(22))
                            .foregroundColor(.white)
                        if let upside = opportunity.upsidePct {
                            Text("+\(Int(upside))% target")
                                .font(DS.Font.caption(12))
                                .foregroundColor(DS.Color.bull)
                        }
                    }
                }
            }

            // Source signal tag
            HStack(spacing: 6) {
                Image(systemName: "bolt.fill")
                    .font(.system(size: 10))
                    .foregroundColor(DS.Color.tier1)
                Text("Signal from \(opportunity.sourceCompany)")
                    .font(DS.Font.caption(12))
                    .foregroundColor(DS.Color.textSecondary)
            }
        }
    }

    // MARK: — Score row

    private var scoreRow: some View {
        HStack(spacing: 16) {
            ScoreGauge(score: opportunity.overallScore, size: 72)

            VStack(spacing: 6) {
                DimensionBar(label: "Asymmetry", score: opportunity.asymmetryScore)
                DimensionBar(label: "Conviction", score: opportunity.convictionScore)
                DimensionBar(label: "Catalyst", score: opportunity.catalystScore)
                DimensionBar(label: "Management", score: opportunity.managementScore)
            }
        }
        .padding(DS.paddingCard)
        .background(DS.Color.card)
        .clipShape(RoundedRectangle(cornerRadius: DS.radiusCard))
    }

    // MARK: — Probability

    private var probabilitySection: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("CATALYST PROBABILITY")
                    .font(DS.Font.caption(10))
                    .foregroundColor(DS.Color.textSecondary)
                Spacer()
                Text("\(Int(opportunity.probabilityScore))%")
                    .font(DS.Font.mono(20))
                    .foregroundColor(opportunity.probabilityScore >= 65 ? DS.Color.bull : DS.Color.neutral)
            }
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    RoundedRectangle(cornerRadius: 4)
                        .fill(DS.Color.border)
                        .frame(height: 8)
                    RoundedRectangle(cornerRadius: 4)
                        .fill(probability_gradient)
                        .frame(width: geo.size.width * opportunity.probabilityScore / 100, height: 8)
                }
            }
            .frame(height: 8)
            Text(opportunity.catalyst)
                .font(DS.Font.body(13))
                .foregroundColor(DS.Color.textSecondary)
        }
        .padding(DS.paddingCard)
        .background(DS.Color.card)
        .clipShape(RoundedRectangle(cornerRadius: DS.radiusCard))
    }

    private var probability_gradient: LinearGradient {
        LinearGradient(colors: [DS.Color.neutral, DS.Color.bull], startPoint: .leading, endPoint: .trailing)
    }

    // MARK: — Expandable sections

    @ViewBuilder
    private func sectionCard(_ section: Section) -> some View {
        let isExpanded = expandedSection == section

        VStack(spacing: 0) {
            Button(action: { withAnimation(.spring(response: 0.3)) { expandedSection = isExpanded ? nil : section } }) {
                HStack {
                    Text(section.rawValue.uppercased())
                        .font(DS.Font.caption(11))
                        .foregroundColor(DS.Color.textSecondary)
                    Spacer()
                    Image(systemName: isExpanded ? "chevron.up" : "chevron.down")
                        .font(.system(size: 12))
                        .foregroundColor(DS.Color.textMuted)
                }
                .padding(DS.paddingCard)
            }

            if isExpanded {
                Divider().background(DS.Color.border)
                sectionContent(section)
                    .padding(DS.paddingCard)
            }
        }
        .background(DS.Color.card)
        .clipShape(RoundedRectangle(cornerRadius: DS.radiusCard))
    }

    @ViewBuilder
    private func sectionContent(_ section: Section) -> some View {
        switch section {
        case .bluf:
            VStack(alignment: .leading, spacing: 12) {
                Text(opportunity.bluf)
                    .font(DS.Font.body())
                    .foregroundColor(.white)
                if !opportunity.marketMiss.isEmpty {
                    Text("Market miss: \(opportunity.marketMiss)")
                        .font(DS.Font.body(14))
                        .foregroundColor(DS.Color.textSecondary)
                        .padding(10)
                        .background(DS.Color.accent.opacity(0.1))
                        .clipShape(RoundedRectangle(cornerRadius: 8))
                }
            }

        case .council:
            CouncilDebateView(opportunity: opportunity)

        case .financials:
            FinancialsView(snap: opportunity.snap, opportunity: opportunity)

        case .buyZones:
            BuyZoneView(opportunity: opportunity)

        case .bearCase:
            BearCaseView(opportunity: opportunity)

        case .source:
            SourceView(opportunity: opportunity)
        }
    }
}

// MARK: — Date helper

private extension Date {
    var timeAgo: String {
        let diff = Date().timeIntervalSince(self)
        if diff < 3600 { return "\(Int(diff/60))m ago" }
        if diff < 86400 { return "\(Int(diff/3600))h ago" }
        return "\(Int(diff/86400))d ago"
    }
}
