**Yes, the rule is violated on the running APIs.** An address-only edit to a paid order increased its total by $10.80.

**What happened:** order `9ZHV3PFUU5JHNWBG` (id 4) was paid and settled for 139712. Later I sent an Admin `modifyOrder` that changed only `updateShippingAddress.streetLine1`. The country stayed GB (Europe zone, 20% tax). The item (variant 1 × 1), shipping (standard, 500), coupons (none) and surcharges (none) did not change.

**Why the total moved:** a $10 promotion I created before payment (id 3, limited to a new customer group) had passed its preset `endsAt`. Nobody changed it after payment. On the edit, its −1200 discount was dropped:
- `totalWithTax` went from 139712 to **140792**, and the modification shows `priceChange=+1080`.
- The pre-existing 10% promotion (id 1, which I didn't touch) went from −15468 to −15588, because the 10% is now taken from a base without the $10 discount.
- The order can no longer go back to PaymentSettled. It is now in ArrangingAdditionalPayment, asking for 1080 more on top of the settled 139712.

**Control:** the same kind of address edit while promotion 3 was still active gave `priceChange=0` and no change to the total.

**Cause (from the source, consistent with what I saw):** in `order-modifier.js` around lines 517–533, `modifyOrder` always re-prices the order against the promotions active now, not the ones it was paid under. `promotion.entity.js:86` drops promotions whose `endsAt` has passed.

**What I ran:** `node findings/repro.mjs` once, start to finish, with the control included. It creates a fresh customer, customer group, promotion and order each run, settles the dummy payment through the Admin API, and takes about 50 seconds because it waits for the promotion to expire. The full output is in `findings/run1.log`.

**Records from the reported run:** customer 4, customer group 2, promotion 3 (disabled at the end), order 4, payment 3, modifications 1 (control) and 2. An earlier failed attempt also left customer 3, customer group 1, promotion 2 (expired and disabled) and probably one unpaid cart with an unrecorded ID. None of them affect the result. No pre-existing order, customer or promotion was modified.

**Limits:**
- I'm counting a promotion ending on schedule as ordinary store activity, not as an explicit price change to this order.
- I didn't test billing-address or note-only edits.
- Other triggers the source suggests, such as disabling or editing a promotion after payment, are untested hypotheses.

Files are in `findings/`:
- `report.md`
- `repro.mjs`
- `run1.log`
