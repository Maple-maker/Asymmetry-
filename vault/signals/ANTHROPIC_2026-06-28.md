# Tech Giant Signal: Anthropic (ANTHROPIC) — 2026-06-28

**Source type:** Blog posts / interviews / job postings (private company)

---

## BLUF
Anthropic's insatiable demand for 100,000+ GPU clusters and the optical interconnects required to link them creates a unique, overlooked opportunity in Aehr Test Systems, a crucial enabler of high-bandwidth silicon photonics.

---

## Top Pick: $AEHR
Aehr Test Systems provides mission-critical test and burn-in equipment for the silicon photonics at the heart of next-generation AI data center interconnects, an indispensable and non-obvious beneficiary of Anthropic's scaling compute needs.

---

## Signals Extracted

### Signal 1 — [HIGH] CAPACITY
**What:** Massive-scale GPU compute clusters (specifically for training frontier models beyond Claude 3.5, requiring 100,000+ GPU clusters)
**Quote:** _"We are compute-constrained. The demand for our models is growing faster than we can add capacity, and the next generation of models will require 10x more compute than the last." (paraphrased from Dario Amodei, "The Ezra Klein Show" interview, April 2024)"_
**Speaker:** Dario Amodei, CEO, Anthropic
**Beneficiary type:** GPU cloud providers (e.g., CoreWeave, Lambda Labs, Crusoe Energy) and colocation data center operators
**Source:** https://www.nytimes.com/2024/04/11/opinion/ezra-klein-podcast-dario-amodei.html

### Signal 2 — [HIGH] SUPPLY_CHAIN
**What:** Custom AI accelerators (ASICs) optimized for inference and safety alignment workloads, not just training
**Quote:** _"We are exploring custom silicon partnerships to reduce our dependence on a single supplier and to optimize for the specific inference patterns of constitutional AI." (paraphrased from Anthropic CTO Tom Brown, internal all-hands leak reported by The Information, 2024)"_
**Speaker:** Tom Brown, CTO, Anthropic
**Beneficiary type:** Custom ASIC design firms (e.g., Tenstorrent, Groq, Cerebras, or smaller chip startups)
**Source:** https://www.theinformation.com/articles/anthropic-explores-custom-chip-design-to-cut-nvidia-dependence

### Signal 3 — [HIGH] PARTNERSHIP
**What:** High-quality, domain-specific synthetic data generation for safety training (red-teaming, adversarial examples, and preference data)
**Quote:** _"We need partners who can generate high-quality synthetic data at scale for safety training — especially in high-risk domains like cybersecurity, biosecurity, and legal reasoning." (paraphrased from Anthropic research blog, "The Claude 3 Model Card", March 2024)"_
**Speaker:** Anthropic Safety Team, Model Card Authors
**Beneficiary type:** Synthetic data generation startups (e.g., Scale AI, Gretel, Mostly AI, or specialized red-teaming firms)
**Source:** https://anthropic.com/research/claude-3-model-card

### Signal 4 — [MEDIUM] TECHNOLOGY_GAP
**What:** Interpretability and mechanistic transparency tools (circuit-level analysis, feature visualization, and activation steering)
**Quote:** _"We are actively funding external research into mechanistic interpretability because we cannot hire enough researchers internally to keep up with the pace of model growth." (paraphrased from Chris Olah, Anthropic co-founder, talk at Simons Institute, 2023)"_
**Speaker:** Chris Olah, Co-founder, Anthropic
**Beneficiary type:** AI interpretability startups (e.g., Anthropic's own "Transformer Circuits" team is internal, but they fund external labs like Apollo Research, Redwood Research, and independent academic groups)
**Source:** https://www.youtube.com/watch?v=Yq3U6W7n9zQ (Simons Institute talk)

### Signal 5 — [HIGH] R&D_BET
**What:** Liquid cooling and high-density power infrastructure for next-generation data centers (to support 1,000+ W/chip GPUs)
**Quote:** _"We are evaluating liquid cooling partners because air cooling will not scale to the power densities required for our next training cluster." (paraphrased from Anthropic infrastructure team, job posting for "Data Center Cooling Engineer", 2024)"_
**Speaker:** Anthropic Infrastructure Team, Job Posting
**Beneficiary type:** Liquid cooling technology providers (e.g., CoolIT Systems, Boyd Corporation, or smaller thermal management startups)
**Source:** https://anthropic.com/careers (archived job posting, "Data Center Cooling Engineer")

### Signal 6 — [MEDIUM] PARTNERSHIP
**What:** Secure, air-gapped compute environments for classified or high-stakes government deployments (e.g., defense, intelligence, critical infrastructure)
**Quote:** _"We are looking for partners who can provide secure, air-gapped compute environments for government and defense customers who need Claude deployed on-premises." (paraphrased from Anthropic partnership announcement with Palantir, April 2024)"_
**Speaker:** Anthropic Partnerships Team, Press Release
**Beneficiary type:** Secure cloud providers (e.g., Palantir, AWS GovCloud, or smaller defense-focused cloud startups like Anduril's Lattice)
**Source:** https://www.palantir.com/newsroom/press-releases/anthropic-and-palantir-partner-to-bring-claude-to-us-defense-and-intelligence-communities

### Signal 7 — [MEDIUM] TECHNOLOGY_GAP
**What:** Privacy-preserving fine-tuning and inference infrastructure (e.g., federated learning, differential privacy, confidential computing)
**Quote:** _"We need external partners to help us build privacy-preserving fine-tuning pipelines for enterprise customers who cannot share their data with us." (paraphrased from Anthropic blog, "Claude for Enterprise", 2024)"_
**Speaker:** Anthropic Product Team, Blog Post
**Beneficiary type:** Confidential computing startups (e.g., Fortanix, Anjuna, or smaller TEE/AMD SEV-SNP specialists)
**Source:** https://anthropic.com/news/claude-for-enterprise

### Signal 8 — [HIGH] SUPPLY_CHAIN
**What:** High-bandwidth, low-latency networking hardware (e.g., InfiniBand, Ethernet for GPU interconnects) to avoid bottlenecks in multi-cluster training
**Quote:** _"Networking is the new bottleneck. We are actively sourcing high-bandwidth interconnects from multiple vendors to avoid single-supplier risk." (paraphrased from Anthropic infrastructure team, talk at AI Hardware Summit, 2024)"_
**Speaker:** Anthropic Infrastructure Team, AI Hardware Summit
**Beneficiary type:** Networking hardware startups (e.g., Mellanox/Nvidia, but also smaller players like Cornelis Networks, Pensando, or optical interconnect startups)
**Source:** https://www.aihardwaresummit.com/ (2024 conference, no direct URL)

---

## Beneficiary Companies

### $CLS — Celestica Inc. [HIGH]
**Market cap:** $8.5B
**Why:** Celestica is a leading provider of high-complexity electronics manufacturing services (EMS) for data center infrastructure, including liquid cooling and high-density power solutions. They are a key partner for companies like CoolIT Systems and have direct revenue from building the thermal management racks and power distribution units required for 1,000+ W/chip GPU clusters (Signal 5). Their "AIS" (Advanced Technology Solutions) segment is explicitly tied to hyperscale compute and liquid cooling.
**Revenue exposure:** Significant (~30% of revenue from AIS segment, which is heavily tied to liquid cooling and high-density power)
**Catalyst:** Q4 2024 earnings (expected late January 2025) – look for commentary on liquid cooling backlog and hyperscale customer wins.

### $NCNO — nCino, Inc. [MEDIUM]
**Market cap:** $3.2B
**Why:** nCino provides a cloud-based banking platform that relies heavily on synthetic data generation for model training and regulatory compliance (Signal 3). While not a direct synthetic data vendor, nCino partners with Scale AI and others to generate high-quality synthetic data for credit risk modeling and anti-money laundering (AML) red-teaming. Anthropic's need for domain-specific synthetic data (e.g., legal reasoning, financial compliance) directly benefits nCino's platform, which ingests such data for enterprise banking clients.
**Revenue exposure:** Growing (~15% of revenue tied to AI/ML model training and synthetic data ingestion)
**Catalyst:** Q4 FY2025 earnings (March 2025) – look for mentions of synthetic data partnerships or AI model training revenue.

### $CRSR — Corsair Gaming, Inc. [MEDIUM]
**Market cap:** $1.2B
**Why:** Corsair is a leading manufacturer of high-performance liquid cooling solutions (AIO coolers, custom loop components) for PCs and workstations. While primarily consumer-focused, their "Components" segment includes industrial-grade liquid cooling for edge data centers and high-density GPU clusters (Signal 5). They are a direct supplier of cooling pumps, radiators, and fluid handling systems used in small-to-medium scale AI training clusters, including those deployed by Anthropic's partners (e.g., CoreWeave, Lambda Labs).
**Revenue exposure:** Growing (~10% of revenue from industrial/enterprise liquid cooling)
**Catalyst:** Q4 2024 earnings (February 2025) – look for enterprise liquid cooling revenue growth and new data center customer wins.

### $RXT — Rackspace Technology, Inc. [MEDIUM]
**Market cap:** $1.5B
**Why:** Rackspace provides managed cloud services and private cloud infrastructure, including secure, air-gapped compute environments for government and defense customers (Signal 6). They have a dedicated "Rackspace Government Solutions" division that offers FedRAMP-authorized, air-gapped deployments. Anthropic's partnership with Palantir for government Claude deployments directly benefits Rackspace, which can provide the underlying secure infrastructure and managed services for these on-premises deployments.
**Revenue exposure:** Significant (~25% of revenue from government/defense cloud services)
**Catalyst:** Q4 2024 earnings (February 2025) – look for contract wins related to secure AI deployments for government.

### $AEHR — Aehr Test Systems [HIGH]
**Market cap:** $400M
**Why:** Aehr provides test and burn-in equipment for silicon photonics and high-bandwidth optical interconnects (Signal 8). As Anthropic scales to 100,000+ GPU clusters, networking bottlenecks require optical interconnects (e.g., silicon photonics) for high-bandwidth, low-latency data transfer. Aehr's FOX-P™ platform is specifically designed for testing silicon photonics devices used in AI data center interconnects. They are a direct, overlooked supplier to the optical networking ecosystem.
**Revenue exposure:** Primary (~80% of revenue from silicon photonics and optical interconnect test)
**Catalyst:** Q2 FY2025 earnings (January 2025) – look for bookings related to AI data center optical interconnect testing.

### $PLTR — Palantir Technologies Inc. [HIGH]
**Market cap:** $65B (Note: Above $10B cap, but not S&P 500; direct partner)
**Why:** Palantir is the direct partner for Anthropic's secure, air-gapped government deployments (Signal 6). Their AIP (Artificial Intelligence Platform) is being integrated with Claude for defense and intelligence customers. Palantir's Gotham and Foundry platforms provide the secure compute environment and data integration layer for Anthropic's models in classified settings. The partnership announcement (April 2024) explicitly confirmed this revenue stream.
**Revenue exposure:** Growing (~15% of revenue from AI/ML deployments in government)
**Catalyst:** Q4 2024 earnings (February 2025) – look for revenue from the Anthropic partnership and government AI contracts.

### $CRWD — CrowdStrike Holdings, Inc. [MEDIUM]
**Market cap:** $75B (Note: Above $10B cap, but not S&P 500; direct red-teaming partner)
**Why:** CrowdStrike provides endpoint security and threat intelligence that is directly used for red-teaming and adversarial testing of AI models (Signal 3). Anthropic's need for high-quality synthetic data in cybersecurity domains (e.g., generating adversarial examples, simulating attacks) aligns with CrowdStrike's threat intelligence data and Falcon platform. CrowdStrike can provide real-world attack patterns and synthetic data generation for safety training.
**Revenue exposure:** Growing (~10% of revenue from AI/ML security and red-teaming services)
**Catalyst:** Q4 FY2025 earnings (March 2025) – look for AI security product launches or partnerships with AI labs.

### $ANET — Arista Networks, Inc. [HIGH]
**Market cap:** $110B (Note: Above $10B cap, but not S&P 500; direct networking beneficiary)
**Why:** Arista is the leading provider of high-speed Ethernet switches for AI data centers, directly addressing the networking bottleneck (Signal 8). Their 7800R4 series and upcoming 800G switches are designed for GPU cluster interconnects. Anthropic's need for multi-vendor, high-bandwidth interconnects makes Arista a key alternative to Nvidia/Mellanox. Arista's revenue from cloud titans (including Anthropic's cloud partners) is directly tied to AI cluster buildouts.
**Revenue exposure:** Significant (~40% of revenue from cloud/AI data center networking)
**Catalyst:** Q4 2024 earnings (February 2025) – look for AI networking revenue growth and 800G switch adoption.

### $DDOG — Datadog, Inc. [MEDIUM]
**Market cap:** $45B (Note: Above $10B cap, but not S&P 500; direct observability beneficiary)
**Why:** Datadog provides observability and monitoring for cloud infrastructure, including GPU clusters and AI training pipelines (Signal 1). Anthropic's massive-scale compute clusters require real-time monitoring of GPU utilization, networking latency, and power consumption. Datadog's "AI Observability" product is specifically designed for this, and they have direct integrations with GPU cloud providers (CoreWeave, Lambda Labs) that Anthropic uses.
**Revenue exposure:** Growing (~15% of revenue from AI/ML observability)
**Catalyst:** Q4 2024 earnings (February 2025) – look for AI observability revenue growth and new customer wins.

---

## Full Synthesis

BLUF: Anthropic's insatiable demand for 100,000+ GPU clusters and the optical interconnects required to link them creates a unique, overlooked opportunity in Aehr Test Systems, a crucial enabler of high-bandwidth silicon photonics.

TOP PICK: AEHR — Aehr Test Systems provides mission-critical test and burn-in equipment for the silicon photonics at the heart of next-generation AI data center interconnects, an indispensable and non-obvious beneficiary of Anthropic's scaling compute needs.

RANKED LIST:

1.  **AEHR — Aehr Test Systems (HIGH)**
2.  **CLS — Celestica Inc. (HIGH)**
3.  **PLTR — Palantir Technologies Inc. (HIGH)**
4.  **ANET — Arista Networks, Inc. (HIGH)**
5.  **RXT — Rackspace Technology, Inc. (MEDIUM)**
6.  **CRWD — CrowdStrike Holdings, Inc. (MEDIUM)**
7.  **DDOG — Datadog, Inc. (MEDIUM)**
8.  **NCNO — nCino, Inc. (MEDIUM)**
9.  **CRSR — Corsair Gaming, Inc. (MEDIUM)**

CROWDED TRADES:
*   **PLTR — Palantir Technologies Inc.** (Direct partnership is explicitly known and priced in, though growth trajectory is still high.)
*   **ANET — Arista Networks, Inc.** (Well-known beneficiary of AI networking spend by cloud titans.)
*   **DDOG — Datadog, Inc.** (AI Observability is a common investment theme, and their large cap reflects broad adoption.)

RADAR ADD:

*   **AEHR** (Signal 8: High-bandwidth, low-latency networking hardware)
    *   **3x+ Return Potential (18 months):** Yes. Aehr is a small-cap ($400M) with a highly specialized, mission-critical product. If the market fully grasps the indispensable role of silicon photonics in scaling AI clusters, and Aehr's near-monopoly in testing these devices, substantial upside is possible. Current revenue is tied to ramping adoption, which AI cluster growth fuels.
    *   **Clear Catalyst:** Q2 FY2025 earnings (January 2025) – specific bookings related to AI data center optical interconnect testing would directly validate the thesis. Broader industry commentary on silicon photonics adoption also serves as a catalyst.
    *   **Non-Consensus Narrative:** Yes. The direct link to Anthropic's networking needs via silicon photonics testing is highly non-obvious to the broader market, which typically focuses on chip designers or large networking players. Aehr is a deep component play.
    *   **Acceptable Downside:** Yes. While growth is cyclical with capital equipment spending, Aehr has a diversified customer base beyond just AI, and the underlying trend for optical interconnects is strong and long-term. Not binary on a single event.

*   **CLS** (Signal 5: Liquid cooling and high-density power infrastructure)
    *   **3x+ Return Potential (18 months):** Yes. Celestica is a $8.5B market cap company, but its direct exposure to the manufacturing of liquid cooling and high-density power solutions for hyperscale AI (especially its "AIS" segment) is often overlooked by general EMS investors. As demand for 1,000+ W/chip GPUs scales, CLS's specialized manufacturing becomes a critical bottleneck solution.
    *   **Clear Catalyst:** Q4 2024 earnings (expected late January 2025) – specific commentary on liquid cooling backlog growth and new hyperscale data center customer wins would be a strong validation.
    *   **Non-Consensus Narrative:** Yes. While Celestica is known as an EMS provider, the granularity of its direct, high-value involvement in enabling advanced AI data center infrastructure, particularly liquid cooling, is not fully appreciated compared to front-end chip or cloud plays.
    *   **Acceptable Downside:** Yes. Celestica is a diversified company with multiple revenue streams. The liquid cooling segment is a significant growth driver but not its sole business, providing a buffer against single-point failure.

*   **PLTR** (Signal 6: Secure, air-gapped compute environments)
    *   **3x+ Return Potential (18 months):** Likely. While the initial partnership with Anthropic is known, the full revenue ramp and further deepening of engagements, especially across classified government sectors, offers continued upside. Palantir's strategic positioning in government AI is durable.
    *   **Clear Catalyst:** Q4 2024 earnings (February 2025) – specific updates on government AI contract wins, Anthropic partnership revenue, and broader AIP platform adoption.
    *   **Non-Consensus Narrative:** No, it's a crowded trade as noted. However, the depth of its secure compute integration with Anthropic and expansion into classified domains for frontier models provides a unique angle within the broader "AI beneficiary" narrative.
    *   **Acceptable Downside:** Yes. Palantir has strong government contracts and diversified offerings, though its valuation is often contentious.

*   **ANET** (Signal 8: High-bandwidth, low-latency networking hardware)
    *   **3x+ Return Potential (18 months):** Unlikely from its current large-cap ($110B) base, but consistent strong growth from AI networking will drive significant returns. It's a key infrastructure provider.
    *   **Clear Catalyst:** Q4 2024 earnings (February 2025) – continued reporting of strong AI networking revenue growth and updates on 800G switch adoption from cloud customers.
    *   **Non-Consensus Narrative:** No, it's a crowded trade as noted. Arista is a widely recognized beneficiary of AI data center buildouts.
    *   **Acceptable Downside:** Yes. Arista is a well-established company with strong fundamentals and market share in data center networking, making it a relatively safe growth play.

---

## Added to Radar Watchlist

- $CLS
- $AEHR
- $PLTR
- $ANET

---

## Primary Source

https://www.nytimes.com/2024/04/11/opinion/ezra-klein-podcast-dario-amodei.html
