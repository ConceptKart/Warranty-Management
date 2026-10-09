/**
 * Portal BaseLinker live order status helpers
 * (ports WarrantyController::getTicketDetails / getOrderStatusInfo).
 */

import {
  baselinkerCall,
  type BaselinkerOrder,
} from "@/lib/cron/baselinker-client";

export type LiveStatusInfo = {
  status: string;
  description: string;
};

const FALLBACK_STATUS_MAP: Record<string, LiveStatusInfo> = {
  "1": {
    status: "New",
    description: "Order has been placed and is awaiting processing",
  },
  "2": {
    status: "Processing",
    description: "Order is being prepared for shipment",
  },
  "3": {
    status: "Shipped",
    description: "Order has been shipped and is on its way",
  },
  "4": {
    status: "Delivered",
    description: "Order has been successfully delivered",
  },
  "5": {
    status: "Cancelled",
    description: "Order has been cancelled",
  },
  "6": {
    status: "Returned",
    description: "Order has been returned",
  },
  "7": {
    status: "Refunded",
    description: "Order has been refunded",
  },
  "8": {
    status: "On Hold",
    description: "Order is temporarily on hold",
  },
  "9": {
    status: "Pending Payment",
    description: "Order is awaiting payment confirmation",
  },
  "10": {
    status: "Partially Shipped",
    description: "Part of the order has been shipped",
  },
  "11": {
    status: "Ready to Ship",
    description: "Order is packed and ready for shipment",
  },
  "12": {
    status: "Awaiting Stock",
    description: "Order is waiting for stock availability",
  },
};

/** Only numeric BaseLinker order ids can be fetched via getOrders. */
export function isNumericBaselinkerOrderId(value: string | null | undefined) {
  if (!value) return false;
  return /^\d{5,}$/.test(String(value).trim());
}

export async function getBaselinkerOrderById(
  orderId: string | number,
): Promise<BaselinkerOrder | null> {
  const id = Number(orderId);
  if (!Number.isFinite(id) || id <= 0) return null;

  try {
    // Approach 1: exact id_from = id_to (PHP BaseLinkerService::getOrderById)
    const data = await baselinkerCall("getOrders", {
      get_unconfirmed_orders: true,
      id_from: id,
      id_to: id,
    });
    const orders = (data.orders as BaselinkerOrder[] | undefined) ?? [];
    const exact = orders.find((o) => String(o.order_id) === String(id));
    if (exact) return exact;

    // Approach 2: small window around the id
    const data2 = await baselinkerCall("getOrders", {
      get_unconfirmed_orders: true,
      id_from: Math.max(1, id - 50),
      id_to: id + 50,
    });
    const orders2 = (data2.orders as BaselinkerOrder[] | undefined) ?? [];
    return orders2.find((o) => String(o.order_id) === String(id)) ?? null;
  } catch (error) {
    console.error("[baselinker getOrderById]", error);
    return null;
  }
}

async function getOrderStatusList(): Promise<
  Array<{ id: number | string; name?: string }>
> {
  try {
    const data = await baselinkerCall("getOrderStatusList", {});
    return (data.statuses as Array<{ id: number | string; name?: string }>) ?? [];
  } catch (error) {
    console.error("[baselinker getOrderStatusList]", error);
    return [];
  }
}

export async function getOrderStatusInfo(
  statusId: number | string | null | undefined,
): Promise<LiveStatusInfo> {
  const statusIdStr = statusId == null ? "" : String(statusId);
  if (!statusIdStr) {
    return {
      status: "Unknown Status",
      description: "Order status could not be determined",
    };
  }

  if (FALLBACK_STATUS_MAP[statusIdStr]) {
    return FALLBACK_STATUS_MAP[statusIdStr]!;
  }

  const statuses = await getOrderStatusList();
  const match = statuses.find((s) => String(s.id) === statusIdStr);
  if (match?.name) {
    return {
      status: match.name,
      description: `Live status from BaseLinker (ID: ${statusIdStr})`,
    };
  }

  if (/^\d+$/.test(statusIdStr) && Number(statusIdStr) > 1000) {
    return {
      status: `Custom Status ${statusIdStr}`,
      description: `Custom BaseLinker status with ID ${statusIdStr}. Live status name could not be retrieved.`,
    };
  }

  return {
    status: "Unknown Status",
    description: `Order status could not be determined (ID: ${statusIdStr})`,
  };
}
