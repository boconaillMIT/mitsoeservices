-- Read-only AeroAstro extract. Bind profit_center='061000' and fiscal_period
-- to a verified TIME_MONTH key. Inspect the preflight result first: Warehouse
-- profit-center identifiers may have a P prefix; do not match other centers.
-- Derives posted balances using the existing Summary Statement extraction.
-- Expenses deliberately exclude revenue, transfers, principal and settlement.
-- Definitions: https://web.mit.edu/warehouse/metadata/fields/cost_collectors_accessible.html
-- https://web.mit.edu/warehouse/metadata/fields/gl_account_report.html
WITH aa AS (
 SELECT COST_COLLECTOR_KEY,COST_COLLECTOR_ID,COST_COLLECTOR_NAME,
        PROFIT_CENTER_ID,PROFIT_CENTER_NAME,FUND_CENTER_NAME,ADMIN_FLAG,POOL_CODE,
        IS_CLOSED_COST_COLLECTOR,COST_COLLECTOR_EXPIRATION_DATE
 FROM WAREUSER.COST_COLLECTORS_ACCESSIBLE
 WHERE PROFIT_CENTER_ID IN (:profit_center,'P'||:profit_center)
), amounts AS (
 SELECT ss.COST_COLLECTOR_KEY,COUNT(*) AS SOURCE_LINES,
        SUM(ss.TOTAL_INSTITUTE_BUDGET)+SUM(-ss.CUMULATIVE_AMOUNT) AS CURRENT_BALANCE,
        SUM(CASE WHEN gl.IS_EXPENSE_ACCOUNT='Y' AND gl.IS_TRANSFER_ACCOUNT='N'
                 THEN ss.FYTD_AMOUNT ELSE 0 END) AS YTD_EXPENSES,
        SUM(CASE WHEN gl.IS_EXPENSE_ACCOUNT='Y' AND gl.IS_TRANSFER_ACCOUNT='N'
                      AND ss.FYTD_AMOUNT IS NULL THEN 1 ELSE 0 END) AS MISSING_EXPENSE_VALUES,
        SUM(CASE WHEN ss.TOTAL_INSTITUTE_BUDGET IS NULL OR ss.CUMULATIVE_AMOUNT IS NULL
                 THEN 1 ELSE 0 END) AS MISSING_BALANCE_VALUES,
        SUM(ss.COMMITMENT_AMOUNT) AS RECORDED_COMMITMENTS
 FROM WAREUSER.SUMMARY_STATEMENT_DETAIL ss
 JOIN aa ON aa.COST_COLLECTOR_KEY=ss.COST_COLLECTOR_KEY
 JOIN WAREUSER.GL_ACCOUNT_REPORT gl ON gl.GL_ACCOUNT_KEY=ss.GL_ACCOUNT_KEY
 WHERE ss.TIME_MONTH_KEY=:fiscal_period
   AND gl.REPORT_TYPE_CODE='CEMIT-0'
   AND gl.LEVEL1_CATEGORY<>'Principal'
   AND gl.IS_SETTLEMENT_ACCOUNT='N'
   AND gl.GL_ACCOUNT_ID NOT IN ('800600','800601','800602','800603','800701')
 GROUP BY ss.COST_COLLECTOR_KEY
)
SELECT aa.COST_COLLECTOR_ID AS "account",aa.COST_COLLECTOR_NAME AS "name",
       aa.PROFIT_CENTER_ID AS "profitCenter",aa.PROFIT_CENTER_NAME AS "profitCenterName",
       aa.FUND_CENTER_NAME AS "fundCenter",aa.ADMIN_FLAG AS "control",aa.POOL_CODE AS "pool",
       CASE WHEN aa.IS_CLOSED_COST_COLLECTOR='Y' THEN 'Closed' ELSE 'Open' END AS "status",
       TO_CHAR(aa.COST_COLLECTOR_EXPIRATION_DATE,'YYYY-MM-DD') AS "endDate",
       CASE WHEN amounts.MISSING_BALANCE_VALUES=0 THEN amounts.CURRENT_BALANCE END AS "currentBalance",
       CASE WHEN amounts.MISSING_EXPENSE_VALUES=0 THEN amounts.YTD_EXPENSES END AS "ytdExpenses",
       amounts.RECORDED_COMMITMENTS AS "commitments",amounts.SOURCE_LINES AS "sourceLines"
FROM aa LEFT JOIN amounts ON amounts.COST_COLLECTOR_KEY=aa.COST_COLLECTOR_KEY
ORDER BY aa.COST_COLLECTOR_ID
