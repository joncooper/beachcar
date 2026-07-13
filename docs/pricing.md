# Managed Research pricing

## Recommendation

Launch one paid plan: **Managed Research at $29/month**, with a **7-day free trial**, monthly cancellation, and no annual plan at first.

Keep **Agent-connected curation included**. A user who brings Codex, Claude, or another MCP client pays Beachcar nothing for inference because their agent owns the model and tool costs. Managed Research is the convenience tier: Beachcar pays for the hosted Agent, Workflow, source monitoring, browser runner, AI Gateway inference, and automatic publication.

This packaging matches the architecture and creates the right incentive. Beachcar earns money when it incurs recurring research cost; it does not tax users for connecting an agent they already operate.

## Why $29

The market separates inexpensive alerts from products that promise judgment:

- AutoScout Pro is advertised at **$5/month**, a useful anchor for commodity monitoring and alerts: [AutoScout pricing](https://www.autocarscout.com/).
- Getreeba advertises **€19/month Navigator** and **€29/month Expert**, closer to an AI-assisted buying workflow: [Getreeba pricing](https://www.getreeba.com/).
- Notiflex begins at **$45/month** for its Starter auction-intelligence tier, with a much more expensive professional tier: [Notiflex pricing](https://notiflex.app/).

Beachcar Managed Research does materially more than an alert: it applies an individual taste profile, combines source evidence, reasons about fit and value, delegates browser work, publishes a deliberately small dossier-backed shortlist, and learns from review gestures. At launch, `$29` is high enough to signal that difference while remaining plausible for an enthusiast during an active search.

Do not launch at `$5–10`. That price compares Beachcar to saved searches and leaves too little room for browser-heavy outliers, support, and continued product refinement. Do not launch above `$39` before the recommendations have earned consistent trust across more users and niches.

## Delivery-cost model

Beachcar currently defaults managed scoring to GPT-4.1. OpenAI lists GPT-4.1 at **$2 per million input tokens** and **$8 per million output tokens**: [GPT-4.1 model pricing](https://developers.openai.com/api/docs/models/gpt-4.1). Cloudflare AI Gateway Unified Billing adds a **5% fee to paid model usage**: [AI Gateway Unified Billing](https://developers.cloudflare.com/ai-gateway/features/unified-billing/).

An illustrative scoring run with 5,000 input tokens and 600 output tokens costs:

```text
(5,000 × $2 / 1,000,000) + (600 × $8 / 1,000,000) = $0.0148
30 daily runs = $0.444/month
AI Gateway 5% fee = $0.022/month
Illustrative monthly scoring cost = $0.466/user
```

That is not the whole delivery cost. Source access, retries, image work, container time, larger prompts, and occasional open-ended browser research create the real variance. Cloudflare's Workers paid plan has an account-level base charge and included usage rather than a new base charge for every user: [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/). Containers are metered separately and should be watched as the browser path grows: [Containers pricing](https://developers.cloudflare.com/containers/pricing/).

Use **$5 per active subscriber-month** as the launch operating ceiling for variable infrastructure and model cost. At `$29`, that leaves roughly **83% gross margin before payment processing, taxes, support, and shared fixed infrastructure**.

| Scenario | Model + Gateway | Browser, storage, edge allocation | Total variable cost | Gross margin at $29 |
| --- | ---: | ---: | ---: | ---: |
| Normal daily scoring | $0.47 | $1.00 | $1.47 | 94.9% |
| Browser-heavy month | $2.00 | $3.00 | $5.00 | 82.8% |
| Exception month | $6.00 | $4.00 | $10.00 | 65.5% |

These are planning scenarios, not promises. Replace them with cohort measurements after launch.

## Plan definition

Create one public Clerk B2C plan:

| Setting | Value |
| --- | --- |
| Plan name | Managed Research |
| Plan slug | `managed-research` |
| Monthly price | `$29` |
| Trial | `7 days` |
| Required feature | `managed_research` |
| Annual price | Do not launch yet |

Clerk's PricingTable can render checkout in the PWA, while the session `fea` claim provides request-time authorization and billing webhooks persist entitlement state for background schedules: [Clerk Billing overview](https://clerk.com/docs/guides/billing/overview), [session token claims](https://clerk.com/docs/guides/sessions/session-tokens), and [billing webhooks](https://clerk.com/docs/guides/development/webhooks/billing).

An annual plan is unattractive at launch because car shopping is episodic. First measure median paid lifetime and pause/cancel behavior. If users keep Beachcar for collection monitoring after a purchase, test **$240/year** later (about two months free). If most users leave within three months, keep the honest monthly plan.

## Cost and abuse controls

- Keep the D1 per-user managed defaults at **$0.50/day** and **$5/month** until real usage supports a change.
- Set an AI Gateway account budget and alert below the hard ceiling: [AI Gateway spend limits](https://developers.cloudflare.com/ai-gateway/features/spend-limits/).
- Require `managed_research` before manual queueing, schedule synchronization, scheduled callback execution, and Workflow inference.
- Fail managed runs closed when required AI scoring fails. Never substitute deterministic recommendations merely to produce a result.
- Record tokens and cost per run, then review median, p90, and maximum cost by cohort.
- Add a product-visible “usage unusually high” state before silently degrading quality.

## Launch questions to measure

After the first 10–20 subscribers, review:

1. Trial-to-paid conversion after users receive at least three shortlists.
2. Recommendation save/love rate versus the free agent-connected path.
3. Monthly variable cost at median and p90.
4. Paid lifetime and the proportion who pause after buying a car.
5. Whether `$29` objections are about price or insufficient trust in the recommendations.

Price should move only after Beachcar can distinguish those causes. If conversion is weak but strong-fit engagement is high, test `$24`; if conversion and retention are healthy and browser research is costly, test `$35` for new users rather than degrading the work.
