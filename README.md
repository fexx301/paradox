# Paradox

Paradox proves when an online store's **paid** order total changes even though nobody changed what the customer bought.

It runs a real Vendure store inside a CreateOS sandbox, freezes it at the moment an order is paid, and forks it into two identical twins. One twin is left alone; the other gets a single, supposedly harmless edit. If the receipts differ, that difference is the proof. Controls rule out coincidence.

Built during the CreateOS × Stripe Projects hackathon, 17 Oct 2026.

## Result

Order `4WQVKNWLNGQ5TFV6` was paid at **$339.80** with an automatic 10% promotion (−$37.20).

| Twin | What happened | Total |
|---|---|---|
| A | nothing | **$339.80** |
| B | promotion disabled after payment, then only the billing city edited | **$377.00** |

The paid total rose **+$37.20**, exactly the discount the customer received.

Controls on twin A:
- **No drift:** the same billing-city edit with the promotion still enabled leaves the total at $339.80.
- **Eligible promotion:** a real change (quantity 1 → 2) reprices to $674.60 and keeps the 10% discount.

So the address edit alone is harmless. The drift appears only when a promotion changes after payment, and legitimate edits still reprice correctly.

## Second finding: the live agent run

An AI agent (Opus 5.5 via OpenRouter, running Claude Code inside the CreateOS sandbox, 10 turns, 3 min 22 s) wrote and ran its own probe in twin B. A scheduled promotion expired, then only the address on a paid order was edited, and the total rose from **$1,397.12 to $1,407.92 (+$10.80)**. Nobody switched the promotion off. Its control edit before expiry left the total unchanged. The agent created its own scheduled promotions and that order as store data during the run. Every figure was checked against the store database: [`runs/2026-10-17-agent/VERIFIED.md`](runs/2026-10-17-agent/VERIFIED.md).

Raw results: [`runs/2026-10-17-twins.md`](runs/2026-10-17-twins.md), [`runs/2026-10-17-agent/`](runs/2026-10-17-agent/). Viewer: [`viewer/index.html`](viewer/index.html).

This is a known defect class, public Vendure issue [#5356](https://github.com/vendurehq/vendure/issues/5356). Paradox's contribution is a reproducible way to prove it, not the discovery.

## How Stripe Projects and CreateOS are used

- **Stripe Projects** (`stripe projects init`, `add createos/project`) created the project, linked CreateOS, and stores the OpenRouter key as a project variable. See [`.projects/state.json`](.projects/state.json).
- **CreateOS Sandbox** runs the store (Vendure 3.7.3 on SQLite, `s-2vcpu-4gb`, `devbox:1`, egress limited to npm, GitHub, Node and OpenRouter). **Pause and fork** create the twins. The Vendure process kept running through each fork, so both twins start from the same in-memory and on-disk state.

## Honest notes

- The first twin comparison and its controls were run by hand through Vendure's Admin API. The second finding came from the agent's own run; its task was written by a person, and its claims were checked against the store.
- The test orders were placed with a second AI agent through the store's dashboard and APIs, then verified against the store database.
- Payments use Vendure's built-in test payment handler; no real money moves.
- A fork of this 4 GB box took 4–8 minutes, so twins are created before recording.
- Stripe Projects is linked to a different CreateOS account than the one running the sandboxes (an account-mapping issue CreateOS support is aware of).
- Before the event, throwaway feasibility tests (CLI setup, a hello-world sandbox, a local Vendure probe) were run and deleted. All project code here was written during the build window.
