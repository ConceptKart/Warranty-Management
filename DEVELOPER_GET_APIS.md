# Warranty GET APIs

**Base URL:** `https://warrantymanagement.conceptkart.co.in`

**Auth (one of):**
- Header: `x-crud-api-key: <CRUD_API_KEY>`
- Or admin login cookie via `POST /api/admin/login`

---

## Endpoints

```
GET /api/health

GET /api/api_tickets
GET /api/api_tickets?page=1&limit=20
GET /api/api_tickets?id={ticket_id}
GET /api/api_tickets?search={ticket_number_or_phone}
# Ticket rows include: customer_phone, customer_email, order_number, source_platform

GET /api/api_ticket_statuses
GET /api/api_ticket_statuses?id={status_id}

GET /api/api_orders
GET /api/api_orders?page=1&limit=20
GET /api/api_orders?id={order_id}

GET /api/api_customers
GET /api/api_customers?page=1&limit=20
GET /api/api_customers?id={customer_id}

GET /api/api_shipments
GET /api/api_shipments?page=1&limit=20
GET /api/api_shipments?id={shipment_id}
GET /api/api_shipments?awb={awb_number}

GET /api/api_bl_products
GET /api/api_bl_products?page=1&limit=20
GET /api/api_bl_products?id={id}

GET /api/api_category_issues
GET /api/api_category_issues?page=1&limit=20
GET /api/api_category_issues?id={id}

GET /api/api_baseorders
GET /api/api_baseorders?page=1&limit=20
GET /api/api_baseorders?id={id}
GET /api/api_baseorders?external_order_id={id}

GET /api/api_users
GET /api/api_users?id={user_id}
```

---

## Response

```json
{
  "status": true,
  "page": 1,
  "limit": 20,
  "total_records": 100,
  "data": []
}
```

- Channel: `source_platform` on ticket/order → `amazon` | `shopify`
- Phone: `customer_phone` on ticket (or `/api/api_orders?id={order_id}` / `/api/api_customers?id={customer_id}`)
- Ticket status: `status_id` → match `/api/api_ticket_statuses`
