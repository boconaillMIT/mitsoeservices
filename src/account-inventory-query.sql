-- Run using the DAF's own Warehouse credentials. This inventories accessible
-- accounts only: no financial amounts, School filter, or Quickbase commitments.
-- It does NOT establish which accounts may be shared with a unit.
SELECT DISTINCT
    COST_COLLECTOR_ID AS "Cost Object",
    COST_COLLECTOR_NAME AS "Cost Object Name",
    FUND_CENTER_NAME AS "Fund Center",
    PROFIT_CENTER_NAME AS "Profit Center",
    ADMIN_FLAG AS "Control",
    IS_CLOSED_COST_COLLECTOR AS "Closed"
FROM WAREUSER.COST_COLLECTORS_ACCESSIBLE
ORDER BY "Fund Center", "Cost Object";
