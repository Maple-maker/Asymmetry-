import SwiftUI

struct SourceView: View {
    let opportunity: Opportunity

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            // Original source quote
            if let quote = opportunity.sourceQuote, !quote.isEmpty {
                VStack(alignment: .leading, spacing: 6) {
                    Text("ORIGINAL SIGNAL")
                        .font(DS.Font.caption(10))
                        .foregroundColor(DS.Color.textSecondary)
                    HStack(alignment: .top, spacing: 10) {
                        Rectangle()
                            .fill(DS.Color.tier1)
                            .frame(width: 3)
                        Text(""\(quote)"")
                            .font(DS.Font.body(14))
                            .foregroundColor(.white)
                            .italic()
                    }
                    Text("— \(opportunity.sourceCompany)")
                        .font(DS.Font.caption(12))
                        .foregroundColor(DS.Color.textSecondary)
                        .padding(.leading, 13)
                }
                .padding(12)
                .background(DS.Color.tier1.opacity(0.05))
                .overlay(RoundedRectangle(cornerRadius: 8).stroke(DS.Color.tier1.opacity(0.2), lineWidth: 0.5))
                .clipShape(RoundedRectangle(cornerRadius: 8))
            }

            // Signal chain
            VStack(alignment: .leading, spacing: 8) {
                Text("SIGNAL CHAIN")
                    .font(DS.Font.caption(10))
                    .foregroundColor(DS.Color.textSecondary)

                signalStep(icon: "antenna.radiowaves.left.and.right", label: "Catalyst detected", detail: opportunity.sourceCompany, color: DS.Color.tier2)
                chainArrow
                signalStep(icon: "brain", label: "AI Council analysis", detail: "Gemini · DeepSeek · CIO synthesis", color: DS.Color.accent)
                chainArrow
                signalStep(icon: "chart.bar.fill", label: "Conviction scored", detail: "\(Int(opportunity.overallScore))/100 — \(opportunity.tier.tierShort)", color: opportunity.tier.tierColor)
                chainArrow
                signalStep(icon: "bell.fill", label: "Alert delivered", detail: opportunity.publishedAt.formatted(date: .abbreviated, time: .shortened), color: DS.Color.bull)
            }
            .padding(12)
            .background(DS.Color.cardElevated)
            .clipShape(RoundedRectangle(cornerRadius: 8))

            // Full report link
            if let mdPath = opportunity.fullReportMd {
                Button(action: {}) {
                    HStack(spacing: 8) {
                        Image(systemName: "doc.text.fill")
                            .font(.system(size: 14))
                        Text("Read full vault report")
                            .font(DS.Font.body(14))
                        Spacer()
                        Image(systemName: "arrow.up.right")
                            .font(.system(size: 12))
                    }
                    .foregroundColor(DS.Color.tier2)
                    .padding(12)
                    .background(DS.Color.tier2.opacity(0.1))
                    .overlay(RoundedRectangle(cornerRadius: 8).stroke(DS.Color.tier2.opacity(0.3), lineWidth: 0.5))
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                }
            }
        }
    }

    private func signalStep(icon: String, label: String, detail: String, color: Color) -> some View {
        HStack(spacing: 10) {
            Image(systemName: icon)
                .font(.system(size: 13))
                .foregroundColor(color)
                .frame(width: 24)
            VStack(alignment: .leading, spacing: 1) {
                Text(label)
                    .font(DS.Font.caption(12))
                    .foregroundColor(.white)
                Text(detail)
                    .font(DS.Font.caption(11))
                    .foregroundColor(DS.Color.textSecondary)
            }
        }
    }

    private var chainArrow: some View {
        Image(systemName: "arrow.down")
            .font(.system(size: 10))
            .foregroundColor(DS.Color.textMuted)
            .padding(.leading, 7)
    }
}

struct BearCaseView: View {
    let opportunity: Opportunity

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if let bear = opportunity.bearCase {
                Text(bear)
                    .font(DS.Font.body(14))
                    .foregroundColor(DS.Color.textSecondary)
            }

            // Invalidation trigger — the exit condition
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 6) {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundColor(DS.Color.bear)
                        .font(.system(size: 12))
                    Text("EXIT CONDITION")
                        .font(DS.Font.caption(10))
                        .foregroundColor(DS.Color.bear)
                }
                Text(opportunity.invalidationTrigger)
                    .font(DS.Font.body(14))
                    .foregroundColor(.white)
            }
            .padding(12)
            .background(DS.Color.bear.opacity(0.08))
            .overlay(RoundedRectangle(cornerRadius: 8).stroke(DS.Color.bear.opacity(0.3), lineWidth: 0.5))
            .clipShape(RoundedRectangle(cornerRadius: 8))
        }
    }
}
