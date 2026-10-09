import { getTrackingPageData } from "@/lib/admin/shipway-tracking";
import { ShipwayTrackingManager } from "@/components/admin/shipway-tracking-manager";

export default async function AdminShipwayTrackingPage() {
  const { trackingStats, apiStats, shipmentsForUpdate } =
    await getTrackingPageData();

  return (
    <ShipwayTrackingManager
      statusCounts={trackingStats.shipment_status}
      activeCache={trackingStats.cache_stats.active_cache}
      apiStats={apiStats}
      pending={shipmentsForUpdate}
    />
  );
}
