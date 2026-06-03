import SwiftUI

// AI council members and their verdicts
struct CouncilDebateView: View {
    let opportunity: Opportunity

    private let models: [(name: String, icon: String, verdict: Verdict)] = []

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            // Council members row
            HStack(spacing: 0) {
                ForEach(councilMembers, id: \.name) { member in
                    councilMemberBadge(member)
                }
            }
            .padding(12)
            .background(DS.Color.cardElevated)
            .clipShape(RoundedRectangle(cornerRadius: DS.radiusSmall))

            // Bull case
            caseBlock(
                title: "BULL CASE",
                icon: "arrow.up.right.circle.fill",
                color: DS.Color.bull,
                text: opportunity.bullCase ?? "See full vault report for complete bull case analysis."
            )

            // Bear case (collapsed preview)
            caseBlock(
                title: "BEAR CASE",
                icon: "arrow.down.right.circle.fill",
                color: DS.Color.bear,
                text: opportunity.bearCase ?? "See full vault report for complete bear case analysis."
            )

            // Invalidation trigger — the most actionable line
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 6) {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .foregroundColor(DS.Color.bear)
                        .font(.system(size: 12))
                    Text("INVALIDATION TRIGGER")
                        .font(DS.Font.caption(10))
                        .foregroundColor(DS.Color.bear)
                }
                Text(opportunity.invalidationTrigger)
                    .font(DS.Font.body(13))
                    .foregroundColor(.white)
            }
            .padding(12)
            .background(DS.Color.bear.opacity(0.08))
            .overlay(
                RoundedRectangle(cornerRadius: 8)
                    .stroke(DS.Color.bear.opacity(0.3), lineWidth: 0.5)
            )
            .clipShape(RoundedRectangle(cornerRadius: 8))
        }
    }

    // MARK: — Council members

    private var councilMembers: [(name: String, color: Color, verdict: Verdict)] {
        [
            ("Gemini",   DS.Color.tier2,   opportunity.geminiVerdict),
            ("DeepSeek", DS.Color.accent,  opportunity.deepseekVerdict),
            ("CIO",      DS.Color.tier1,   opportunity.debateVerdict),
        ]
    }

    private func councilMemberBadge(_ member: (name: String, color: Color, verdict: Verdict)) -> some View {
        VStack(spacing: 4) {
            ZStack {
                Circle()
                    .fill(member.color.opacity(0.15))
                    .frame(width: 36, height: 36)
                Text(member.name.prefix(1))
                    .font(DS.Font.displayBold(14))
                    .foregroundColor(member.color)
            }
            Text(member.name)
                .font(DS.Font.caption(9))
                .foregroundColor(DS.Color.textSecondary)
            HStack(spacing: 2) {
                Image(systemName: member.verdict.icon)
                    .font(.system(size: 8, weight: .bold))
                Text(member.verdict.label)
                    .font(DS.Font.caption(9))
            }
            .foregroundColor(member.verdict.color)
        }
        .frame(maxWidth: .infinity)
    }

    private func caseBlock(title: String, icon: String, color: Color, text: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                Image(systemName: icon)
                    .foregroundColor(color)
                    .font(.system(size: 13))
                Text(title)
                    .font(DS.Font.caption(11))
                    .foregroundColor(color)
            }
            Text(text)
                .font(DS.Font.body(14))
                .foregroundColor(DS.Color.textSecondary)
                .lineLimit(6)
        }
        .padding(12)
        .background(color.opacity(0.05))
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }
}
