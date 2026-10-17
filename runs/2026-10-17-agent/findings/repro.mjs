// Standalone reproducer: an address-text-only modifyOrder on a PAID order re-prices it
// against the promotions active *now*, so a scheduled promotion that expired after
// payment is silently removed and the paid total rises.
// Usage: node findings/repro.mjs   (Node >= 18; Vendure at 127.0.0.1:3000)
const BASE = process.env.VENDURE_BASE || 'http://127.0.0.1:3000';
function client(url) {
  let token = null;
  return async (query, variables = {}) => {
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify({ query, variables }) });
    const t = r.headers.get('vendure-auth-token'); if (t) token = t;
    const j = await r.json(); if (j.errors) throw new Error(JSON.stringify(j.errors));
    return j.data;
  };
}
const A = client(BASE + '/admin-api'), S = client(BASE + '/shop-api');
const log = (label, x) => console.log(`\n## ${label}\n` + JSON.stringify(x, null, 1));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ORDER = `id code state subTotal subTotalWithTax shipping shippingWithTax total totalWithTax
  discounts{description adjustmentSource amount amountWithTax}
  lines{productVariant{id} quantity unitPriceWithTax proratedLinePriceWithTax}
  shippingLines{shippingMethod{id code} priceWithTax}
  shippingAddress{fullName streetLine1 city postalCode countryCode}
  payments{id method state amount} modifications{id priceChange note}`;
const snap = o => ({ state: o.state, subTotalWithTax: o.subTotalWithTax, shippingWithTax: o.shippingWithTax, totalWithTax: o.totalWithTax,
  discounts: o.discounts.map(d => `${d.adjustmentSource}: ${d.amountWithTax}`), lines: o.lines.map(l => `${l.productVariant.id} x${l.quantity} @${l.unitPriceWithTax}`),
  shipping: o.shippingLines.map(s => `${s.shippingMethod.code} ${s.priceWithTax}`), address: o.shippingAddress,
  payments: o.payments.map(p => `${p.method} ${p.state} ${p.amount}`), modifications: o.modifications.map(m => `${m.id} priceChange=${m.priceChange} ${m.note}`) });
const getOrder = async id => (await A(`query($id:ID!){order(id:$id){${ORDER}}}`, { id })).order;
const tx = async (id, state) => { const r = (await A(`mutation($id:ID!,$s:String!){transitionOrderToState(id:$id,state:$s){__typename ...on Order{state} ...on OrderStateTransitionError{message transitionError}}}`, { id, s: state })).transitionOrderToState; console.log(`transition ${id} -> ${state}:`, JSON.stringify(r)); return r; };
const modifyAddress = async (orderId, streetLine1, note) => {
  const input = { dryRun: false, orderId, note, updateShippingAddress: { streetLine1 } };
  console.log('\nmodifyOrder input:', JSON.stringify(input));
  const r = (await A(`mutation($input:ModifyOrderInput!){modifyOrder(input:$input){__typename ...on Order{${ORDER}} ...on ErrorResult{errorCode message}}}`, { input })).modifyOrder;
  if (r.__typename !== 'Order') throw new Error('modifyOrder failed: ' + JSON.stringify(r));
  return r;
};

const tag = Date.now().toString(36);
await A(`mutation{login(username:"superadmin",password:"superadmin"){...on CurrentUser{id}}}`);
log('Pre-existing promotions (left untouched)', (await A(`{promotions{items{id name enabled couponCode startsAt endsAt}}}`)).promotions.items);

const email = `repro-${tag}@example.test`;
// 1. Shop: guest cart for a fresh customer email (creates a new Customer record)., same country/zone throughout (GB, Europe zone), standard shipping, dummy payment.
await S(`mutation{addItemToOrder(productVariantId:"1",quantity:1){__typename ...on ErrorResult{message}}}`);
const sc = (await S(`mutation($i:CreateCustomerInput!){setCustomerForOrder(input:$i){__typename ...on Order{customer{id}} ...on ErrorResult{message}}}`, { i: { emailAddress: email, firstName: 'Repro', lastName: tag } })).setCustomerForOrder;
console.log('setCustomerForOrder:', JSON.stringify(sc));
if (sc.__typename !== 'Order') throw new Error('setCustomerForOrder failed');
const cust = { id: sc.customer.id, emailAddress: email };

// 2. Fresh customer group, so the test promotion can only affect this customer.
const group = (await A(`mutation($i:CreateCustomerGroupInput!){createCustomerGroup(input:$i){id name}}`, { i: { name: `repro-group-${tag}`, customerIds: [cust.id] } })).createCustomerGroup;

// 2b. Fresh scheduled promotion: $10 off for that group, ending ~45s from now (a sale with an end date).
const PROMO_SECONDS = 45;
const endsAt = new Date(Date.now() + PROMO_SECONDS * 1000).toISOString();
const promoInput = { enabled: true, startsAt: null, endsAt, couponCode: null, perCustomerUsageLimit: null,
  translations: [{ languageCode: 'en', name: `Repro scheduled $10 off ${tag}` }],
  conditions: [{ code: 'customer_group', arguments: [{ name: 'customerGroupId', value: String(group.id) }] }],
  actions: [{ code: 'order_fixed_discount', arguments: [{ name: 'discount', value: '1000' }] }] };
const promo = (await A(`mutation($i:CreatePromotionInput!){createPromotion(input:$i){__typename ...on Promotion{id name endsAt} ...on ErrorResult{message}}}`, { i: promoInput })).createPromotion;
log('Created test records', { customer: cust, group, promotion: promo });

// 3. Shop: same country/zone throughout (GB, Europe zone), standard shipping, dummy payment.
await S(`mutation($i:CreateAddressInput!){setOrderShippingAddress(input:$i){__typename}}`, { i: { fullName: 'Repro Customer', streetLine1: '1 Test Street', city: 'London', postalCode: 'SW1A 1AA', countryCode: 'GB' } });
await S(`mutation{setOrderShippingMethod(shippingMethodId:["1"]){__typename ...on ErrorResult{message}}}`);
await S(`mutation{transitionOrderToState(state:"ArrangingPayment"){__typename ...on ErrorResult{message}}}`);
const paid = (await S(`mutation{addPaymentToOrder(input:{method:"standard-payment",metadata:{}}){__typename ...on Order{id code state totalWithTax payments{id state amount}} ...on ErrorResult{message}}}`)).addPaymentToOrder;
console.log('addPaymentToOrder:', JSON.stringify(paid));
const orderId = paid.id;
for (const p of paid.payments) if (p.state === 'Authorized') console.log('settlePayment:', JSON.stringify((await A(`mutation($id:ID!){settlePayment(id:$id){__typename ...on Payment{state} ...on ErrorResult{message}}}`, { id: p.id })).settlePayment));
const before = await getOrder(orderId);
log(`A. Paid order ${before.code} (id ${orderId}) BEFORE any modification`, snap(before));
if (before.state !== 'PaymentSettled') throw new Error('order not settled');
if (!before.discounts.some(d => d.adjustmentSource === `PROMOTION:${promo.id}`)) throw new Error('test promotion not applied before payment');

// 4. CONTROL: address-text-only edit while the promotion is still within its schedule.
await tx(orderId, 'Modifying');
const ctrl = await modifyAddress(orderId, '1 Test Street, Flat 2', 'control: street text fix');
log('B. CONTROL after address-only edit (promotion still scheduled-active)', snap(ctrl));
await tx(orderId, 'PaymentSettled');

// 5. Wait for the promotion's pre-set endsAt to pass. No admin changes anything meanwhile.
const waitMs = Math.max(0, new Date(endsAt).getTime() - Date.now()) + 3000;
console.log(`\nwaiting ${Math.round(waitMs / 1000)}s for promotion ${promo.id} endsAt=${endsAt} to pass...`);
await sleep(waitMs);
const unchangedPaid = await getOrder(orderId);
log('C. Paid order after expiry, before second edit (no recalculation yet)', snap(unchangedPaid));

// 6. CANDIDATE: another address-text-only edit (same country GB / same zone / same shipping method).
await tx(orderId, 'Modifying');
const after = await modifyAddress(orderId, '1 Test Street, Flat 2B', 'address text fix after promo end');
log('D. AFTER second address-only edit', snap(after));
const next = await tx(orderId, 'PaymentSettled');
if (next.__typename !== 'Order') await tx(orderId, 'ArrangingAdditionalPayment');
log('E. Final persisted order', snap(await getOrder(orderId)));

console.log(`\nRESULT: paid totalWithTax ${before.totalWithTax} -> control ${ctrl.totalWithTax} -> after ${after.totalWithTax}; ` +
  (after.totalWithTax !== before.totalWithTax ? 'VIOLATION: address-only edit changed the paid total' : 'no change'));
// Cleanup of own record only: disable the (already expired) test promotion.
await A(`mutation($i:UpdatePromotionInput!){updatePromotion(input:$i){__typename}}`, { i: { id: promo.id, enabled: false } });
console.log(JSON.stringify({ customerId: cust.id, customerGroupId: group.id, promotionId: promo.id, orderId, orderCode: before.code }));
