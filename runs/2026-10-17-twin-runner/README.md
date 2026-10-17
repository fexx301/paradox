# Twin runner run — 2026-10-18 ~00:17 WAT

`scripts/twins.sh sb-01m55s7v3a7y8mhyvtdh0sfew3 4WQVKNWLNGQ5TFV6`, against the store paused at the paid moment.

Both twins were forked by the script from that same paused store: twin A (93 s) in an earlier invocation and
twin B (265 s) in a later one, after a fork that would not resume was deleted. This run reused them
(`TWIN_A` / `TWIN_B`), checked that both start identical (`PaymentSettled`, $339.80), then ran the
candidate in B and both controls in A.

| | Total |
|---|---|
| Twin A, no edit | $339.80 |
| Twin B, promotion off after payment, then billing city only | $377.00 (+$37.20) |
| Control: same edit with the promotion on | $339.80 — pass |
| Control: quantity +1, dry run | $674.60, discount −$74.40 — pass |

Same figures as the hand-run comparison in `../2026-10-17-twins.md`. Raw API replies are in `results.json` under `raw`.
