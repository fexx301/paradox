#!/usr/bin/env bash
# Paradox twin runner.
# Forks a paused Vendure store (frozen at the paid-order moment) into twins A and B,
# checks they start identical, replays the candidate edit in B only, runs the two
# controls in A, and writes results.json. Exit 0 = drift reproduced and controls pass.
#
#   scripts/twins.sh <paused-store-sandbox-id> [order-code]
#   TWIN_A=<id> [TWIN_B=<id>] scripts/twins.sh …   reuse twins already forked from that store
#
# Needs: createos CLI signed in (Beginner plan: the store plus two forks), jq.
set -euo pipefail

SRC=${1:?usage: scripts/twins.sh <paused-store-sandbox-id> [order-code]}
ORDER=${2:-4WQVKNWLNGQ5TFV6}
PROMO_ID=${PROMO_ID:-1}
OUT=${OUT:-runs/$(date -u +%Y%m%dT%H%M%SZ)-twins}
mkdir -p "$OUT"

status(){ createos -o json sandbox ls | jq -r --arg i "$1" '.[]?|select(.id==$i).status'; }
inbox(){ createos sandbox exec "$1" -- bash -lc "ORDER=$ORDER PROMO_ID=$PROMO_ID; $2"; }
js(){ jq -e . <<<"$1" >/dev/null 2>&1 && printf '%s' "$1" || printf null; }   # raw reply as JSON, or null

# The pause is the shared starting point: both twins are cloned from the same frozen state.
[ "$(status "$SRC")" = paused ] || { echo "store $SRC must be paused (createos sandbox pause $SRC)" >&2; exit 2; }

fork(){ # fork paused (the auto-resume can stall), then resume explicitly; prints "<id> <seconds>"
  local t0=$SECONDS id
  id=$(createos -o json sandbox fork --paused "$SRC" | jq -r .id)
  [ -n "$id" ] && [ "$id" != null ] || { echo "fork of $SRC failed" >&2; return 1; }
  createos sandbox resume "$id" >/dev/null 2>&1 || true
  echo "$id $((SECONDS - t0))"
}

# One fork at a time: parallel forks of the same store left a twin that would not resume.
# TWIN_A / TWIN_B reuse a twin already forked from this same paused store.
if [ -n "${TWIN_A:-}" ]; then A=$TWIN_A FA=${FORK_A_S:-null}; else echo "forking twin A from ${SRC}…" >&2; read -r A FA < <(fork); fi
if [ -n "${TWIN_B:-}" ]; then B=$TWIN_B FB=${FORK_B_S:-null}; else echo "forking twin B from ${SRC}…" >&2; read -r B FB < <(fork); fi
[ -n "${A:-}" ] && [ -n "${B:-}" ] || { echo "fork failed" >&2; exit 1; }
echo "twin A $A (${FA}s) · twin B $B (${FB}s)" >&2

READY='for i in $(seq 1 60); do c=$(curl -s -o /dev/null -w "%{http_code}" -X POST -H "content-type: application/json" -d "{\"query\":\"{products(options:{take:1}){totalItems}}\"}" localhost:3000/shop-api); [ "$c" = 200 ] && exit 0; sleep 3; done; exit 1'
READ='sqlite3 -separator " " /root/shop/vendure.sqlite "select state, subTotalWithTax+shippingWithTax from \"order\" where code=\"$ORDER\";"'
LOGIN='H="content-type: application/json"; AA=localhost:3000/admin-api; curl -s -c /tmp/j -b /tmp/j -X POST -H "$H" -d "{\"query\":\"mutation{login(username:\\\"superadmin\\\",password:\\\"superadmin\\\"){__typename}}\"}" $AA >/dev/null; OID=$(sqlite3 /root/shop/vendure.sqlite "select id from \"order\" where code=\"$ORDER\";")'
MODIFYING='curl -s -c /tmp/j -b /tmp/j -X POST -H "$H" -d "{\"query\":\"mutation{transitionOrderToState(id:$OID,state:\\\"Modifying\\\"){__typename}}\"}" $AA >/dev/null'
CITY='curl -s -c /tmp/j -b /tmp/j -X POST -H "$H" -d "{\"query\":\"mutation{modifyOrder(input:{orderId:$OID,dryRun:false,updateBillingAddress:{city:\\\"Lagos\\\"}}){__typename ...on Order{totalWithTax discounts{amountWithTax}} ...on ErrorResult{errorCode}}}\"}" $AA'

ready(){ # a fork can come up paused, and a just-resumed box can refuse exec briefly
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    [ "$(status "$1")" = paused ] && createos sandbox resume "$1" >/dev/null 2>&1
    inbox "$1" "$READY" && return 0; sleep 5
  done; return 1; }
ready "$A" && ready "$B" || { echo "store not answering in a twin" >&2; exit 1; }

# Twins must start identical, or a difference proves nothing.
read -r A_STATE A0 < <(inbox "$A" "$READ" | tail -1)
read -r B_STATE B0 < <(inbox "$B" "$READ" | tail -1)
[ "$A_STATE $A0" = "$B_STATE $B0" ] || { echo "twins differ before any edit: A=$A_STATE $A0 B=$B_STATE $B0" >&2; exit 1; }
[ "$A_STATE" = PaymentSettled ] || { echo "order $ORDER is $A_STATE, not PaymentSettled" >&2; exit 1; }

# Twin B: the candidate. Promotion switched off after payment, then a billing-city-only edit.
B_EDIT=$(inbox "$B" "$LOGIN; curl -s -c /tmp/j -b /tmp/j -X POST -H \"\$H\" -d '{\"query\":\"mutation{updatePromotion(input:{id:'\$PROMO_ID',enabled:false}){__typename}}\"}' \$AA >/dev/null; $MODIFYING; $CITY" | tail -1)
read -r B_STATE1 B1 < <(inbox "$B" "$READ" | tail -1)

# Twin A, control 1: the same billing-city edit with the promotion still on.
A_CITY=$(inbox "$A" "$LOGIN; $MODIFYING; $CITY" | tail -1)
read -r _ A1 < <(inbox "$A" "$READ" | tail -1)

# Twin A, control 2: a real change (quantity +1, dry run) must still reprice with the discount.
A_QTY=$(inbox "$A" "$LOGIN; L=\$(sqlite3 /root/shop/vendure.sqlite \"select id||':'||quantity from order_line where orderId=\$OID limit 1;\"); curl -s -c /tmp/j -b /tmp/j -X POST -H \"\$H\" -d \"{\\\"query\\\":\\\"mutation{modifyOrder(input:{orderId:\$OID,dryRun:true,adjustOrderLines:[{orderLineId:\${L%%:*},quantity:\$((\${L##*:}+1))}]}){__typename ...on Order{totalWithTax discounts{amountWithTax}} ...on ErrorResult{errorCode}}}\\\"}\" \$AA" | tail -1)
A2=$(jq -r '.data.modifyOrder.totalWithTax // empty' <<<"$A_QTY" 2>/dev/null || true)
A2_DISC=$(jq -r '[.data.modifyOrder.discounts[]?.amountWithTax] | add // 0' <<<"$A_QTY" 2>/dev/null || echo 0)

DRIFT=$((B1 - B0))
NO_DRIFT=$([ "$A1" = "$A0" ] && echo pass || echo fail)
ELIGIBLE=$([ -n "$A2" ] && [ "$A2" != "$A0" ] && [ "$A2_DISC" -lt 0 ] && echo pass || echo fail)

jq -n --arg order "$ORDER" --arg src "$SRC" --arg a "$A" --arg b "$B" \
  --argjson fa "$FA" --argjson fb "$FB" --argjson a0 "$A0" --argjson b1 "$B1" --argjson a1 "$A1" \
  --argjson a2 "${A2:-null}" --argjson a2d "$A2_DISC" --argjson drift "$DRIFT" \
  --arg bstate "$B_STATE1" --arg nd "$NO_DRIFT" --arg el "$ELIGIBLE" \
  --argjson bedit "$(js "$B_EDIT")" --argjson acity "$(js "$A_CITY")" --argjson aqty "$(js "$A_QTY")" '{
    order: $order, source_sandbox: $src, paid_total_cents: $a0,
    twin_a: { sandbox: $a, fork_seconds: $fa, action: "none", total_cents: $a0 },
    twin_b: { sandbox: $b, fork_seconds: $fb, action: "promotion disabled after payment, then billing city only",
              state: $bstate, total_cents: $b1, drift_cents: $drift },
    controls: {
      no_drift: { action: "billing city only, promotion on", total_cents: $a1, verdict: $nd },
      eligible_promotion: { action: "dry run, quantity +1", total_cents: $a2, discount_cents: $a2d, verdict: $el } },
    raw: { b_edit: $bedit, a_city: $acity, a_quantity: $aqty } }' > "$OUT/results.json"

printf 'A %s · B %s · drift %+d cents · no-drift %s · eligible %s → %s\n' "$A0" "$B1" "$DRIFT" "$NO_DRIFT" "$ELIGIBLE" "$OUT/results.json"
[ "$DRIFT" -ne 0 ] && [ "$NO_DRIFT" = pass ] && [ "$ELIGIBLE" = pass ]
