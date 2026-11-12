# BizLedger API notes

The API uses JSON responses with the existing `{ "success": true, "data": ... }` envelope. All insight endpoints require the BizLedger session cookie or a valid bearer JWT. Dashboard access uses `dashboard:read`; analytics and reports use `reports:read` (ADMIN, MANAGER and STAFF currently have these read permissions).

## Dashboard

### `GET /api/dashboard`

Returns live overview cards, recent orders/payments/audit activity, low-stock products, trend series, top-selling products and current inventory counts. `dateFrom` and `dateTo` are optional ISO dates; without them the period is the latest 30 calendar days. `dateTo` is inclusive. Current stock and current receivables/payables are point-in-time values and are intentionally not restricted to the activity period.

Example: `GET /api/dashboard?dateFrom=2026-10-01&dateTo=2026-10-31`

Response data includes `range`, `overview`, `recentTransactions`, `recentPayments`, `recentOrderActivities`, `lowStockAlerts`, `trends`, `topSellingProducts` and `inventoryOverview`.

Metric definitions:

- **Active products / inventory units / low stock:** `products` where `is_active=true`; sum current `stock_quantity`; alert when stock is less than or equal to `min_stock_level`. Units are not normalized across products.
- **Total sales:** delivered (`DELIVERED`) `sales_orders.total_amount`, less returned quantity valued pro rata against each sales line's saved `line_total`. Pending and cancelled orders are excluded.
- **Total purchases:** fully received (`RECEIVED`) purchase order values. Draft, sent, confirmed, partially received and cancelled orders are excluded from this completed-order card.
- **Sales revenue:** issued `SALES` invoice values for delivered sales orders, less returned item value calculated pro rata from the saved sales order line totals. This is invoice value, not money collected. No credit note or refund model currently exists.
- **Purchase expenditure:** issued `PURCHASE` invoice values for fully received purchase orders. It is invoice value, not money paid to suppliers.
- **Receivables/payables:** for every issued invoice, `max(total_amount - sum(payments.amount), 0)` by invoice type. These are current balances; a fully paid invoice contributes zero. Overdue balances additionally require a due date before today.
- **Collections / supplier payments:** payment rows grouped by their saved `payment_date` and invoice type. They are cash movement, not sales or purchase value.
- **Pending orders:** purchase statuses `DRAFT`, `SENT`, `CONFIRMED`, `PARTIALLY_RECEIVED`; sales statuses `NEW`, `CONFIRMED`, `PROCESSING`, `DISPATCHED`, restricted to the selected activity period.
- **Returns:** returned sales item value reduces sales revenue and net product units. Invoice and payment histories remain unchanged because the existing schema has no credit notes or refunds.

## Analytics

### `GET /api/analytics`

Query parameters: optional `dateFrom`, `dateTo` (inclusive ISO dates); `groupBy=daily|weekly|monthly` (default `daily`). The default activity window is 90 days. Returns the selected range, revenue/expenditure and payment trend buckets, product-wise sales and purchases, inventory movements, current low-stock analysis, supplier/buyer delivered/received order summaries and current outstanding balances.

Sales trends use delivered, invoiced sales less saved return value. Purchase trends use purchase invoices for received orders. Collection and supplier-payment trends use payment dates. Product sales require delivered sales orders; product purchases use received quantities from received/partially received orders. Product-line purchase values are prorated by received quantity; order-level additional charges are not allocated to products.

## Reports

### `GET /api/reports`

Required query parameter `type` is one of `sales`, `purchases`, `inventory`, `low-stock`, `product-sales`, `product-purchases`, `supplier-transactions`, `buyer-transactions`, `receivables`, `payables`, `revenue-expenditure`, `payments`.

Shared optional query parameters: `dateFrom`, `dateTo` (inclusive ISO dates; default latest 365 days), `search`, `page` (default 1), `pageSize` (default 20, maximum 100), `status`, `sortBy=date|name|amount|quantity`, `sortOrder=asc|desc`. Partner/product reports also accept `supplierId`, `buyerId` and `productId` as applicable. Low-stock reports are a current stock snapshot and are not historicalized by date. Supplier and buyer transaction history reports include order and payment rows; their summary keeps order value and payment amount in separate fields.

Response: `{ success, data: { type, range, summary: { count, amount, paymentAmount, paymentCount, quantity }, items, pagination: { page, pageSize, total, totalPages } } }`. Summary totals cover the complete filtered result set; `items` contains only the requested page. Canceled and non-completed orders may remain visible in operational order reports, but only delivered sales and received purchases contribute to completed-order summary amounts. Product purchase values use received line quantities and exclude unallocated order-level charges.

### `GET /api/reports/export.csv`

Accepts the same filters as `GET /api/reports` and returns all matching report rows (not just the current page) as a UTF-8 CSV attachment. CSV fields beginning with spreadsheet formula operators are escaped. The export applies the same report filters, sort and calculations.

Example: `GET /api/reports/export.csv?type=payments&dateFrom=2026-10-01&dateTo=2026-10-31&sortBy=date&sortOrder=desc`

## Errors

- `401` missing or invalid authentication.
- `403` role lacks the relevant read permission.
- `422` invalid dates, report type, sorting, status or pagination parameters. Validation responses include an `errors` array.
- `500` unexpected database/server error in the common error envelope.

Date windows use UTC start-of-day boundaries and include the entire `dateTo` day. Dashboard, analytics and reports calculate money with Decimal.js and return monetary totals as decimal strings.
