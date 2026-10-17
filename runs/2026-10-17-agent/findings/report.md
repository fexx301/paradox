# Vendure 3.7.3 test store: a paid order's total changes after an address-only edit

## Rule tested
After an order is paid, ordinary admin activity must not change its total unless the operator explicitly changes its items or quantities, shipping method, coupon, surcharge or price. Fixing the text of an address in the same country and tax/shipping zone does not count as permission to re-price.

## Verdict: VIOLATED (seen on the running APIs)
I edited the address text of a paid order with the Admin API `modifyOrder` operation, using `updateShippingAddress.streetLine1` and nothing else. The order's `totalWithTax` went from **139712 to 140792** (+1080, i.e. +$10.80). The cause: a promotion that was scheduled before payment had reached its preset `endsAt`. After payment, nobody changed the promotion, the order, the items, the shipping or the country.

## Store configuration that applied (read from the APIs and `src/vendure-config.ts`)
- Default channel, USD, `pricesIncludeTax=false`. Default tax and shipping zone is Europe. GB is in Europe; variant 1 shows 20% tax (129900 net / 155880 gross).
- Payment method 1 `standard-payment` uses `dummy-payment-handler`. It authorizes; I settled the payment through the Admin API.
- Shipping method 1 `standard-shipping` is a flat 500.
- Pre-existing promotion 1, "Paradox Automatic 10% — $100+" (automatic, `minimum_order_amount` condition, `order_percentage_discount` action). I **left it untouched**. It applied to the test order and stayed enabled throughout.
- There are no custom plugins and no custom price, promotion or tax strategies.

## Records created by the run that produced the result (`node findings/repro.mjs`, log in `findings/run1.log`)
| Record | ID |
|---|---|
| Customer (guest, `repro-mvcy8luq@example.test`) | 4 |
| Customer group `repro-group-mvcy8luq` (contains only customer 4) | 2 |
| Promotion "Repro scheduled $10 off" (`customer_group` → group 2, `order_fixed_discount` 1000, `endsAt` = creation + 45 s) | 3 |
| Order `9ZHV3PFUU5JHNWBG` | 4 |
| Payment (dummy) | 3 |
| Order modifications | 1 (control), 2 (candidate) |

Leftovers from an earlier failed attempt of mine: customer 3 and customer group 1 were created. Promotion 2 was created, then expired and was set to `enabled:false` by me. One unpaid Shop-API cart may remain in AddingItems; I did not record its ID. That attempt failed because `setCustomerForOrder` returned `EmailAddressConflictError` for a customer created by the admin, so it never reached payment. Its records do not affect the result: promotion 2 was already disabled and expired before the run above.

## Executed operations, in order (all observed)
1. Admin `login`; `promotions` lists promotion 1 (and my disabled promotion 2).
2. Shop `addItemToOrder(productVariantId:"1", quantity:1)`.
3. Shop `setCustomerForOrder({emailAddress:"repro-…@example.test", firstName:"Repro", lastName:…})` → customer 4.
4. Admin `createCustomerGroup({name, customerIds:["4"]})` → group 2.
5. Admin `createPromotion` (enabled, no coupon, `endsAt` = now+45 s, condition `customer_group{customerGroupId:"2"}`, action `order_fixed_discount{discount:"1000"}`) → promotion 3.
6. Shop `setOrderShippingAddress({fullName:"Repro Customer", streetLine1:"1 Test Street", city:"London", postalCode:"SW1A 1AA", countryCode:"GB"})`.
7. Shop `setOrderShippingMethod(shippingMethodId:["1"])`, then `transitionOrderToState("ArrangingPayment")`, then `addPaymentToOrder({method:"standard-payment", metadata:{}})` → payment 3 Authorized, 139712.
8. Admin `settlePayment(id:"3")` → Settled. Order state is PaymentSettled. **Snapshot A.**
9. **Control:** Admin `transitionOrderToState(4,"Modifying")`, then `modifyOrder({dryRun:false, orderId:"4", note:"control: street text fix", updateShippingAddress:{streetLine1:"1 Test Street, Flat 2"}})`. **Snapshot B.** Then `transitionOrderToState(4,"PaymentSettled")` succeeded.
10. Waited 48 s with no API writes, until promotion 3's preset `endsAt` had passed. **Snapshot C** (read-only `order` query).
11. **Candidate:** Admin `transitionOrderToState(4,"Modifying")`, then `modifyOrder({dryRun:false, orderId:"4", note:"address text fix after promo end", updateShippingAddress:{streetLine1:"1 Test Street, Flat 2B"}})`. **Snapshot D.**
12. `transitionOrderToState(4,"PaymentSettled")` → `OrderStateTransitionError` "Can only transition to the ArrangingAdditionalPayment state". `transitionOrderToState(4,"ArrangingAdditionalPayment")` succeeded. **Snapshot E** (persisted).
13. Clean-up of my own record: `updatePromotion({id:"3", enabled:false})`.

## Before and after (observed values, in minor units)
| | A: paid | B: control edit | C: after expiry, no edit | D/E: 2nd address edit |
|---|---|---|---|---|
| state | PaymentSettled | Modifying→PaymentSettled | PaymentSettled | Modifying→ArrangingAdditionalPayment |
| subTotalWithTax | 139212 | 139212 | 139212 | **140292** |
| shippingWithTax | 500 | 500 | 500 | 500 |
| totalWithTax | 139712 | 139712 | 139712 | **140792** |
| discounts | PROMOTION:3 −1200; PROMOTION:1 −15468 | same | same | **PROMOTION:1 −15588 only** |
| modification priceChange | – | 0 | – | **+1080** |
| settled payment | 139712 | 139712 | 139712 | 139712 (now short by 1080) |

What stayed the same between A and E: the line (variant 1 × 1 at unitPriceWithTax 155880), the shipping line (standard-shipping, 500), the country (GB, so same tax/shipping zone, same 20% tax), the customer, the coupon codes (none), surcharges (none), and the payment. Promotion 1 was never edited. Its amount moved from −15468 to −15588 only because the 10% is now taken from a base that no longer includes the $10 fixed discount. The only input in the modification was the `streetLine1` text.

The control (step 9) shows that an address-only edit does **not** always change the total: while promotion 3 was still active, priceChange was 0.

## Mechanism (hypothesis supported by the source, consistent with what I observed)
`node_modules/@vendure/core/dist/service/helpers/order-modifier/order-modifier.js` (around lines 464–535): `modifyOrder` always calls `promotionService.getActivePromotionsInChannel(ctx)` and `orderCalculator.applyPriceAdjustments(ctx, order, promotions, …)`, even when the input holds only `updateShippingAddress`. `Promotion.test()` (`entity/promotion/promotion.entity.js:86`) rejects promotions whose `endsAt` is in the past. So any edit re-prices the paid order against the promotions active now, not the ones it was paid under. As a result the order went to ArrangingAdditionalPayment and asks the customer for 1080 more. I did not run any other trigger that the source suggests, for example disabling a promotion or changing its conditions after payment, so those remain hypotheses.

## Assumptions and limits
- I treat a promotion that ends on schedule as "ordinary" store activity, not an explicit price change to this order. Nobody touched the promotion after payment. I disabled it only after the candidate step, as clean-up.
- The test promotion was scoped to a new customer group so it could not affect other customers' orders. Pre-existing promotion 1 was active and also applied; its amount is shown separately above.
- One run of the full script was executed. It includes the control. I did not test billing-address-only or note-only edits.
- Final state of my records: order 4 is in ArrangingAdditionalPayment with 1080 outstanding (paid 139712, total 140792). Promotion 3 is disabled. No pre-existing orders, customers or promotions were modified.

## Artifacts
- `findings/repro.mjs`: standalone script that creates fresh records each run and takes about 50 s because of the wait for expiry. Run with `node findings/repro.mjs`.
- `findings/run1.log`: full output of the run described above.
