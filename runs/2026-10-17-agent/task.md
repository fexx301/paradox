You are investigating the money consistency of a running Vendure 3.7.3 test store. The store source is at /root/shop. Its Admin API is http://127.0.0.1:3000/admin-api and its Shop API is http://127.0.0.1:3000/shop-api. The admin login is superadmin / superadmin. The configured dummy payment handler moves no real money.

The owner's rule is: once an order has been paid, ordinary administrative activity must not change that order's total unless the operator explicitly changes its purchased items or quantities, shipping method, coupon, surcharge, or price. A non-pricing contact or address-text correction in the same country and tax/shipping zone does not authorize a price change.

Find out whether the actual running APIs can violate that rule. Explore the API schema and the installed source, form a hypothesis, and execute it. A useful finding needs observed before/after totals and discounts, not just a suspicious code path. Changes caused by a different tax zone/country, different shipping service, changed quantities, partial cancellations, refunds, or an explicit price adjustment do not qualify.

The box contains earlier test records. Establish your own clean starting state using new test customer/order/promotion records as needed; record their IDs. You may modify the new records you create. Leave pre-existing orders, customers, and promotions as you found them. Use only the dummy payment method and settle your test order before comparing a paid total. Make every run's assumptions explicit, including which store configuration applies to the paid order.

If you find a qualifying violation:
1. Save findings/report.md with the tested rule, starting state, exact API operations and variables in order, IDs, before/after totals and discounts, and what stayed unchanged. Clearly distinguish executed observations from hypotheses.
2. Save findings/repro.mjs, a standalone Node script that uses the documented localhost APIs and creates fresh test records so a reviewer can reproduce the candidate. It must not depend on IDs left over from your exploratory attempts. Avoid creating duplicate active promotions that silently change your own result.
3. Run your reproducer. If time permits, reduce unnecessary steps and include one control demonstrating that an ordinary edit does not always change the total. State exactly which checks you executed.

If you do not find a qualifying violation, save an honest report listing what you attempted and what remains unproven. Do not invent a result or call a source-only hypothesis a reproduced bug.

Work within this twin only. Read source files under /root/shop and write your scripts and findings in your current work directory. Do not edit the store source/configuration, read its raw SQLite database, stop or restart its server, or install infrastructure. Do not use CreateOS control commands, touch other sandboxes, or run cos down. You have no task involving the original box or twin A.

Do not search the web, consult issue trackers, pull requests, changelogs, release notes, prior agent transcripts, shell history, or existing demonstration artifacts. Read only the local installed implementation and API schema needed for this investigation. Do not read credential files, inspect environment secrets, or print credentials/tokens. Store session tokens privately in memory if needed for API calls.

You have at most 40 turns and 10 minutes. Prioritize one concrete executed experiment and a clear final report. Finish by stating whether the rule was violated, the paths of your artifacts, and any limits on your conclusion.
