require("dotenv").config({ quiet: true });
const { PrismaClient } = require("@prisma/client");

const p = new PrismaClient();

async function main() {
  const amazon = await p.$queryRawUnsafe(`
    SELECT amazon_order_id, MAX(order_date) AS order_date, COUNT(*) AS items
    FROM amazon_order_details
    WHERE amazon_order_id IS NOT NULL AND amazon_order_id != ''
    GROUP BY amazon_order_id
    ORDER BY order_date DESC
    LIMIT 5
  `);

  const shopify = await p.$queryRawUnsafe(`
    SELECT shopify_order_id, MAX(order_date) AS order_date, COUNT(*) AS items,
           MAX(customer_name) AS customer_name
    FROM shopify_orders
    WHERE shopify_order_id IS NOT NULL AND shopify_order_id != ''
    GROUP BY shopify_order_id
    ORDER BY order_date DESC
    LIMIT 5
  `);

  const serialize = (rows) =>
    rows.map((r) =>
      Object.fromEntries(
        Object.entries(r).map(([k, v]) => [
          k,
          typeof v === "bigint" ? Number(v) : v,
        ]),
      ),
    );

  console.log("AMAZON");
  console.log(JSON.stringify(serialize(amazon), null, 2));
  console.log("SHOPIFY");
  console.log(JSON.stringify(serialize(shopify), null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => p.$disconnect());
