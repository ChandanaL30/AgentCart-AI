# AgentCart AI

> **Autonomous Commerce with Deterministic Landed-Cost Guardrails & PayPal Sandbox Integration**  
> Built for the PayPal AI Hackathon • Next.js 16 • React 19 • TypeScript • PostgreSQL • Vitest

---

## Executive Summary & Problem Statement

Most AI shopping assistants suffer from the **"Sticker Price Illusion"**: they search for products that appear to satisfy a user's budget based strictly on the listing price. When the buyer proceeds to checkout, unforeseen freight fees, logistics surcharges, and regional sales taxes push the final charge well beyond the user's hard limit. Worse, traditional LLM wrappers silently relax constraints, recommend out-of-stock items, or hallucinate pricing without cryptographic auditability.

**AgentCart AI solves this fundamentally:**
1. **Deterministic Landed-Cost Arithmetic**: Computes the complete all-in cost (base price + carrier shipping fee + regional sales tax) strictly in **integer minor units (cents)** to eliminate floating-point drift.
2. **Authoritative Hard Guardrails**: An un-compromised server-side Guardrail Engine deterministically rejects any candidate whose landed total exceeds the user's budget, even if the item sticker price was within range. **The LLM is never allowed to override or relax hard constraints.**
3. **Review-Before-Purchase**: Every recommendation is staged as a cryptographically locked, expiring purchase proposal that requires explicit human review and approval before invoking payment gateways.
4. **Official PayPal Sandbox Integration**: Direct integration with the **PayPal Orders API v2** (`/v2/checkout/orders`), supporting genuine buyer approval with idempotency keys and double-capture prevention.

---

## Architecture Diagram

```mermaid
flowchart TD
    User([Buyer / Judge]) -->|1. Natural Language Query & Hard Budget| WebUI[Next.js 16 Web Application]
    WebUI -->|2. HttpOnly SameSite Session| API[Server Boundaries / Next.js API Routes]
    
    subgraph Agentic Orchestration Layer
        API -->|3. Initialize Run & Token Hash| Orchestrator[Agent Orchestrator]
        Orchestrator -->|4. Tool Call 1| SearchTool[search_products Tool]
        SearchTool --> Catalog[(Seed Catalog / PostgreSQL)]
        
        Orchestrator -->|5. Tool Call 2| Guardrails[rank_and_evaluate_catalog Tool]
        Guardrails --> Calc[Integer Cents Landed-Cost Calculator]
        Calc --> Policy{Strict Guardrail Check}
        
        Policy -->|Landed Cost > Budget| Disqualify[Disqualify Candidate & Record Audit Overage]
        Policy -->|All Constraints Pass| Rank[Deterministic Score & Multi-Factor Rank]
        
        Orchestrator -->|6. Tool Call 3 Optional| CompareTool[compare_products Tool]
        Orchestrator -->|7. Tool Call 4| StageTool[stage_purchase_proposal Tool]
    end

    StageTool -->|8. Lock Landed Cost & Snapshot| ProposalStore[(Purchase Proposals Store)]
    Orchestrator -.->|Real-time SSE Stream| WebUI
    
    subgraph Human-in-the-Loop & PayPal Checkout Layer
        WebUI -->|9. Inspect Rationale & Disqualified Audit| Review[Review-Before-Purchase Area]
        Review -->|10. Explicit Buyer Approval| VerifyAPI[/api/proposals/verify]
        VerifyAPI -->|11. Create Order with Landed Total| CreateOrder[/api/paypal/create-order]
        CreateOrder -->|v2/checkout/orders| PayPal[(PayPal Orders API v2)]
        PayPal -->|12. Buyer Approves in Sandbox| OnApprove[Buyer Approval]
        OnApprove -->|13. Capture Order with Idempotency| CaptureAPI[/api/paypal/capture-order]
        CaptureAPI -->|14. Emit Verified Receipt| Receipt[(Verified Checkout Receipt)]
    end
```

---

## Deterministic Judge-Demo Scenario ($150 Budget vs $12 Shipping)

AgentCart AI provides a built-in deterministic scenario designed to showcase the agent's core differentiator to hackathon judges:

### Scenario Walkthrough

1. **User Request**: `"Find wireless headphones under $150"` with hard delivery constraint $\le 3$ days and minimum rating $4.5★$.
2. **Candidate Item Discovered**:
   - Product: `Audio-Technica ATH-M50xBT2 Wireless Over-Ear Headphones` (`prod_audiotechnica_m50xbt2`).
   - Sticker Listing Price: **$145.00** (under the $150 budget cap!).
   - Shipping Fee: **$12.00**.
   - Subtotal before tax: **$157.00** (exceeds the $150 budget *before any sales tax*!).
   - Landed Total with 8.25% Tax: **$168.96** ($16,896 cents).
3. **Guardrail Enforcement**:
   - The Guardrail Engine detects: `$16,896¢ > $15,000¢` (`EXCEEDS_BUDGET`).
   - **The candidate is disqualified and NOT staged for purchase.**
   - An activity warning event is emitted in real time: `[Guardrail Enforced] Disqualified candidate "Audio-Technica ATH-M50xBT2" — Sticker: $145.00, Shipping: $12.00, Landed Total: $168.96. Total landed cost ($168.96) exceeds user budget limit ($150.00) by $18.96.`
4. **Compliant Alternative Staged**:
   - The agent evaluates remaining catalog inventory and identifies `Anker Soundcore Life Q30` (`prod_anker_q30`):
     - Base Price: $79.99
     - Shipping: $0.00 (Free shipping)
     - Estimated Tax: $6.60
     - Total Landed Cost: **$86.59** (well within the $150 budget).
     - Delivery Days: 2 days $\le$ 3 days.
     - Rating: 4.6★ $\ge$ 4.5★.
   - The agent stages `Anker Soundcore Life Q30` as Proposal `#prop_...` for human review.
5. **Audit UI**:
   - The UI displays the staged Anker proposal, side-by-side alternatives, and a dedicated **"Guardrail Audit: Disqualified Candidates"** card explaining why Audio-Technica failed.

### How to Reproduce in 1 Click:
- Open the application and click the **"Run Judge Demo Scenario"** button in the top banner.
- Or select the quick-start template: `"Find wireless headphones under $150 [Judge Demo]"`.

---

## Technology Stack

| Layer | Technology | Purpose |
| :--- | :--- | :--- |
| **Framework** | Next.js 16 (App Router, Turbopack) | Server Components, streaming API routes, and static generation |
| **Language** | TypeScript 5 (Strict Mode) | Strict type checking, zero `any` leaks in core stores |
| **UI & Styling** | Tailwind CSS v4, Lucide Icons | Dark mode glassmorphism, responsive mobile-to-desktop grid |
| **Database** | PostgreSQL + Prisma ORM 6 | Optional durable persistence for sessions, runs, proposals, checkouts |
| **Validation** | Zod 3 | Boundary runtime validation for API bodies, query params, schemas |
| **Streaming** | Server-Sent Events (SSE) | Real-time agent event stream with REST fallback |
| **Payments** | PayPal Orders API v2 (`@paypal/react-paypal-js`) | Sandbox order creation, buyer approval, and authoritative capture |
| **Testing** | Vitest 3 | 11 automated test suites, 97 passing unit and integration tests |

---

## Operation Modes & Setup Guide

AgentCart AI is engineered for zero-dependency portability:

### Mode A: Deterministic Offline Demo Mode (Default, Zero-Dependency)
- **No database required**: In-memory thread-safe stores handle guest sessions, active runs, proposals, and checkouts.
- **No external AI API key required**: `LLM_PROVIDER="mock"` uses a deterministic mock adapter that parses free text and extracts 6-factor constraints with 0ms latency.
- **PayPal Simulation Mode**: When live credentials are placeholder, executes server-side simulated PayPal Sandbox capture with full guardrail re-validation and cryptographic HMAC signature.

### Mode B: PostgreSQL Persistence Mode (Production / Full Stack)
- Configure `DATABASE_URL` in `.env.local`.
- Prisma migrations create PostgreSQL schemas: `GuestSession`, `AgentRun`, `AgentEvent`, `PurchaseProposal`, `CheckoutSession`, `Product`.

### Mode C: Live PayPal Sandbox Mode
- Configure `NEXT_PUBLIC_PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET` in `.env.local`.
- Set `PAYPAL_ENVIRONMENT="sandbox"`.
- Uses official PayPal Orders API v2 endpoints (`https://api-m.sandbox.paypal.com/v2/checkout/orders`).

---

## Step-by-Step Installation

### 1. Clone & Install Dependencies
```bash
git clone https://github.com/your-username/agentcart-AI.git
cd agentcart-AI
npm install
```

### 2. Configure Environment Variables
Copy `.env.example` to `.env.local`:
```bash
cp .env.example .env.local
```

Example `.env.local`:
```ini
NEXT_PUBLIC_APP_URL="http://localhost:3000"
NODE_ENV="development"

# Optional: In-memory store active when DATABASE_URL is commented out
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/agentcart_ai?schema=public"

# Cryptographic secret for signing guest session cookies
SESSION_SECRET="agentcart_super_secure_random_session_secret_change_in_production_32chars"

# PayPal Developer Sandbox (https://developer.paypal.com)
NEXT_PUBLIC_PAYPAL_CLIENT_ID="sandbox_paypal_client_id_placeholder"
PAYPAL_CLIENT_SECRET="sandbox_paypal_client_secret_placeholder"
PAYPAL_ENVIRONMENT="sandbox"

# AI Provider ("mock" for deterministic demo; "openai", "gemini" also supported)
LLM_PROVIDER="mock"
```

### 3. Database Migrations & Seeding (If using PostgreSQL)
```bash
# Generate Prisma Client
npm run prisma:generate

# Apply migrations
npm run prisma:migrate

# Seed demo catalog
npm run prisma:seed
```

### 4. Start Development Server
```bash
npm run dev
```
Navigate to [http://localhost:3000](http://localhost:3000).

---

## Automated Verification Suite

All commands are validated and passing with zero errors:

```bash
# 1. Run full Vitest test suite (11 suites, 97 tests)
npm test

# 2. Run TypeScript strict type-checking
npx tsc --noEmit

# 3. Run ESLint code quality checks
npm run lint

# 4. Run Next.js production build
npm run build
```

### Test Suite Summary (97 Passing Tests)
- `session.test.ts`: Cryptographic token generation, HttpOnly cookie serialization, timing-safe HMAC validation.
- `phase2-guardrails.test.ts`: Landed-cost integer math, budget overage detection, out-of-stock and delivery filters.
- `agent-tools.test.ts`: Bounded tool execution limits, schema validation, and tool dispatching.
- `phase3-agentic-workflow.test.ts`: Multi-candidate ranking, transparent rationale generation, proposal staging.
- `phase4-checkout.test.ts`: PayPal order creation, session authorization, 15-minute proposal expiration, idempotency.
- `phase5-security-e2e.test.ts`: All 14 security audit scenarios including cross-session proposal tampering, double capture prevention, and payment reconciliation.
- `phase6-judge-demo.test.ts`: The deterministic $150 budget vs $12 shipping candidate rejection and alternative staging.
- `custom-prompts.test.ts`: 16 regression tests for arbitrary natural language product queries and multi-currency formats.

---

## PayPal Sandbox Integration Guide

1. Log in to [developer.paypal.com](https://developer.paypal.com) and navigate to **Apps & Credentials** $\rightarrow$ **Sandbox**.
2. Create a REST API app to generate your `Client ID` and `Secret Key`.
3. Add credentials to `.env.local`:
   ```ini
   NEXT_PUBLIC_PAYPAL_CLIENT_ID="<your_client_id>"
   PAYPAL_CLIENT_SECRET="<your_client_secret>"
   PAYPAL_ENVIRONMENT="sandbox"
   ```
4. In **Sandbox Accounts**, note the personal buyer login credentials (`buyer@personal.example.com`).
5. In AgentCart AI, stage an eligible proposal, click **"Approve & Lock Proposal"**, and click the golden PayPal button.
6. The PayPal Sandbox modal will pop up. Log in with your Sandbox buyer account, approve the exact landed cost, and receive an authentic, verified `CheckoutReceipt` with your PayPal Order ID and Capture ID.

---

## Security Audit & Compliance

- **Guest Session Isolation**: Sessions use 32-byte cryptographically secure random tokens stored in `HttpOnly`, `SameSite=Lax` cookies with `Secure=true` in production. Timing-safe comparison (`crypto.timingSafeEqual`) prevents side-channel token enumeration.
- **Session Scoping**: All proposals, event streams, checkout sessions, and receipts are bound to the session's token hash. Attempting to purchase another session's proposal returns HTTP `403 Forbidden`.
- **Bounded Tool Calls**: The agent orchestrator strictly enforces a maximum limit of 8 tool executions per run to eliminate infinite loops and denial-of-service risks.
- **Idempotency**: PayPal order creation and order capture require client-supplied idempotency keys (`idempotencyKey`). Duplicate requests return the cached receipt without double charging.
- **Zero Client Credential Leakage**: PayPal client secrets and LLM keys are strictly server-side; client bundles only receive public environment variables (`NEXT_PUBLIC_`).

---

## Known Limitations

1. **Single-Item Proposal Scope**: Currently, each shopping proposal targets a single primary item and its landed cost. Multi-item cart pooling is scheduled for Phase 7.
2. **Standard Demo Tax Rate**: Estimated sales tax defaults to 8.25% (standard US representative metro average). Production deployments can integrate live tax rating APIs (e.g., TaxJar or Avalara).
3. **Currency Conversion**: All demo transactions settle canonically in USD. Queries specifying international currencies (INR, EUR, GBP) convert against canonical catalog baseline rates for filtering.

---

## License

This project is licensed under the [MIT License](LICENSE).
