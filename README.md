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

The agent was not told the failing sequence or any expected number. A regression test now replays its finding on a clean copy of the store and **fails on Vendure 3.7.3** with the same figures ([`runs/2026-10-17-regression/`](runs/2026-10-17-regression/)).

**Viewer:** https://fexx301.github.io/paradox/viewer/ · Raw results: [`runs/2026-10-17-twins.md`](runs/2026-10-17-twins.md), [`runs/2026-10-17-agent/`](runs/2026-10-17-agent/).

This is a known defect class, public Vendure issue [#5356](https://github.com/vendurehq/vendure/issues/5356). Paradox's contribution is a reproducible way to prove it, not the discovery.

## How Stripe Projects and CreateOS are used

- **Stripe Projects** (`stripe projects init`, `add createos/project`) created the project, linked CreateOS, and stores the OpenRouter key as a project variable. See [`.projects/state.json`](.projects/state.json).
- **CreateOS Sandbox** runs the store (Vendure 3.7.3 on SQLite, `s-2vcpu-4gb`, `devbox:1`, egress limited to npm, GitHub, Node and OpenRouter). **Pause and fork** create the twins. The Vendure process kept running through each fork, so both twins start from the same in-memory and on-disk state.

## How to run it

You need the Stripe CLI with the Projects plugin, the `createos` CLI signed in on a plan that allows forks (Beginner: the store plus two twins), `jq`, and Node 20+.

1. **Project and keys.**
   ```bash
   stripe projects init paradox
   stripe projects add createos/project
   stripe projects variables set openrouter --env-key OPENROUTER_API_KEY --value <your-openrouter-key>
   ```
   The `createos` CLI reads `.env` in the current folder, and a `CREATEOS_*_API_KEY` there overrides your login. If Stripe Projects linked a different CreateOS account than the one you're signed in as, keep those keys out of `.env`.
2. **A store in a sandbox.**
   ```bash
   createos sandbox create --name paradox-store --shape s-2vcpu-4gb --rootfs devbox:1 \
     --egress registry.npmjs.org --egress github.com --egress objects.githubusercontent.com \
     --egress release-assets.githubusercontent.com --egress nodejs.org --egress openrouter.ai
   createos sandbox exec <store-id> -- bash -lc 'npx -y @vendure/create@3.7.3 shop --ci --db sqlite --use-npm'
   createos sandbox exec <store-id> -- bash -lc 'cd shop && nohup npm run dev:server > /root/server.log 2>&1 &'
   ```
   Run the server without the worker; on SQLite the two contend for locks.
3. **A paid order.** In the dashboard (`/dashboard`, `superadmin` / `superadmin`), create an automatic promotion (for example 10% off orders of $100+), then place an order over $100 and pay it with the test payment method. No real money moves.
4. **Twins.** Pause the store at that moment and run the twin runner:
   ```bash
   createos sandbox pause <store-id>
   scripts/twins.sh <store-id> <order-code>
   ```
   It forks the paused store into twins A and B, checks they start identical, replays the candidate edit in B only (promotion switched off after payment, then a billing-city-only edit), runs both controls in A, and writes `runs/<time>-twins/results.json`. Exit 0 means the drift reproduced and both controls passed.
5. **Regression test.** Inside a sandbox running the store (or anywhere `VENDURE_BASE` reaches one):
   ```bash
   node --test test/paid-total-invariant.test.mjs   # fails on Vendure 3.7.3
   ```
6. **The agent.** [`runs/2026-10-17-agent/RUN.md`](runs/2026-10-17-agent/RUN.md) and [`task.md`](runs/2026-10-17-agent/task.md) record the exact task and settings: Claude Code inside the sandbox, on OpenRouter.

## What's in the repo

| Path | What it is |
|---|---|
| `scripts/twins.sh` | The twin runner: fork, replay, controls, `results.json` |
| `test/paid-total-invariant.test.mjs` | Regression test that fails on 3.7.3 |
| `runs/` | Every run's evidence: the manual twins, the agent run, the regression run |
| `viewer/` | The results page, plus a tiny server so CreateOS can host it |
| `.projects/state.json` | Stripe Projects state: CreateOS and the OpenRouter variable |

**Tech:** Vendure 3.7.3 on SQLite · CreateOS Sandbox (`devbox:1`, pause, fork, resume, egress allowlists) · Stripe Projects · Claude Code on OpenRouter (Opus 5.5) · Node 24 · bash and `jq`.

## Honest notes

- The first twin comparison and its controls were run by hand through Vendure's Admin API; `scripts/twins.sh` now automates the same steps. The second finding came from the agent's own run. Its task was written by a second AI assistant (Femi's other agent), which launched the run; the claims were then checked against the store database.
- The test orders were placed with a second AI agent through the store's dashboard and APIs, then verified against the store database.
- Payments use Vendure's built-in test payment handler; no real money moves.
- A fork of this 4 GB box took 4–8 minutes, so twins are created before recording.
- Stripe Projects is linked to a different CreateOS account than the one running the sandboxes (an account-mapping issue CreateOS support is aware of).
- Before the event, throwaway feasibility tests were run and deleted: CLI setup and a hello-world sandbox, and a local Vendure test in which a blind agent found the issue #5356 path. All project code here was written during the build window, which started at 20:40 WAT (official window 20:30–01:30 WAT).
