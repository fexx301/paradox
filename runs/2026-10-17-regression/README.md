# Regression test run — 2026-10-17 ~23:40 WAT

`test/paid-total-invariant.test.mjs` replays the live agent's reproducer and asserts that an
address-only edit leaves a paid order's total unchanged.

Ran in sandbox `sb-01m55wj8hdw4sz0jgs07zen29e` after restoring the clean store snapshot
(`seed-promo.sqlite`, sha256 `f2aec06875d09124…`), so nothing from the agent's earlier run was present.

Result on Vendure 3.7.3: **fails, as expected** (1 test, 0 pass, 1 fail, 48.7 s).

    RESULT: paid totalWithTax 139712 -> control 139712 -> after 140792; VIOLATION

Same figures as the agent's own run ($1,397.12 → $1,407.92, +$10.80): the replay is deterministic.
The test should pass once Vendure stops re-deriving discounts on a paid order from currently active promotions.
Full output: `test-run.log`.
