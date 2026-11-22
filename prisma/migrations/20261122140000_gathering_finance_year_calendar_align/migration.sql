-- Prisma stores UTC instants in timestamp(3) columns without a time zone.
-- Explicitly convert to UTC before casting so the session time zone cannot shift the bounds.
DO $$
DECLARE
    aligned_count bigint;
    already_aligned_count bigint;
    backup_count bigint;
    transaction_mismatch_count bigint;
    due_mismatch_count bigint;
    late_december_count bigint;
    year_totals record;
BEGIN
    CREATE TABLE IF NOT EXISTS "gathering_finance_year_range_backups" (
        "id" TEXT PRIMARY KEY,
        "financeYearId" TEXT NOT NULL UNIQUE,
        "groupId" TEXT NOT NULL,
        "year" INTEGER NOT NULL,
        "status" TEXT NOT NULL,
        "startsAt" TIMESTAMP(3) NOT NULL,
        "endsAt" TIMESTAMP(3) NOT NULL,
        "openingBalanceWon" INTEGER NOT NULL,
        "backedUpAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    -- Keep the backup and update consistent if another session writes finance years.
    LOCK TABLE "gathering_finance_years" IN SHARE ROW EXCLUSIVE MODE;

    WITH calendar_ranges AS (
        SELECT "id",
            (make_timestamptz("year" - 1, 12, 31, 15, 0, 0, 'UTC')
                AT TIME ZONE 'UTC')::timestamp(3) AS new_start,
            ((make_timestamptz("year", 12, 31, 15, 0, 0, 'UTC') - interval '1 millisecond')
                AT TIME ZONE 'UTC')::timestamp(3) AS new_end
        FROM "gathering_finance_years"
    ), changed_years AS MATERIALIZED (
        SELECT y.*, r.new_start, r.new_end
        FROM "gathering_finance_years" y
        JOIN calendar_ranges r ON r."id" = y."id"
        WHERE (y."startsAt", y."endsAt") IS DISTINCT FROM (r.new_start, r.new_end)
    ), backups AS (
        INSERT INTO "gathering_finance_year_range_backups"
            ("id", "financeYearId", "groupId", "year", "status", "startsAt", "endsAt", "openingBalanceWon")
        SELECT 'rangbak_' || "id", "id", "groupId", "year", "status"::text,
            "startsAt", "endsAt", "openingBalanceWon"
        FROM changed_years
        ON CONFLICT ("financeYearId") DO NOTHING
    )
    UPDATE "gathering_finance_years" y
    SET "startsAt" = c.new_start, "endsAt" = c.new_end
    FROM changed_years c
    WHERE y."id" = c."id";

    GET DIAGNOSTICS aligned_count = ROW_COUNT;
    SELECT count(*) - aligned_count INTO already_aligned_count FROM "gathering_finance_years";
    SELECT count(*) INTO backup_count FROM "gathering_finance_year_range_backups";

    WITH transaction_dates AS (
        SELECT y."year", t."paidAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Seoul' AS paid_kst
        FROM "gathering_finance_transactions" t
        JOIN "gathering_finance_years" y ON y."id" = t."financeYearId"
    )
    SELECT count(*) FILTER (WHERE extract(year FROM paid_kst) <> "year"),
        count(*) FILTER (WHERE extract(month FROM paid_kst) = 12 AND extract(day FROM paid_kst) >= 24)
    INTO transaction_mismatch_count, late_december_count
    FROM transaction_dates;

    SELECT count(*) INTO due_mismatch_count
    FROM "gathering_member_dues" d
    JOIN "gathering_finance_years" y ON y."id" = d."financeYearId"
    WHERE extract(year FROM (d."paidAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Seoul')) <> y."year";

    RAISE NOTICE 'Finance year calendar alignment: aligned=%, already_aligned=%, backups=%',
        aligned_count, already_aligned_count, backup_count;
    RAISE NOTICE 'would_move_if_by_date: transactions=%, dues=%; transactions_paid_dec_24_to_31_kst=%',
        transaction_mismatch_count, due_mismatch_count, late_december_count;

    FOR year_totals IN
        SELECT y."id", y."year", y."status", y."openingBalanceWon",
            coalesce(sum(t."amountWon") FILTER (WHERE t."direction" = 'INCOME'), 0) AS income_won,
            coalesce(sum(t."amountWon") FILTER (WHERE t."direction" = 'EXPENSE'), 0) AS expense_won
        FROM "gathering_finance_years" y
        LEFT JOIN "gathering_finance_transactions" t ON t."financeYearId" = y."id"
        GROUP BY y."id"
        ORDER BY y."year", y."id"
    LOOP
        RAISE NOTICE 'financeYearId=%, year=%, status=%, incomeWon=%, expenseWon=%, openingBalanceWon=%',
            year_totals."id", year_totals."year", year_totals."status",
            year_totals.income_won, year_totals.expense_won, year_totals."openingBalanceWon";
    END LOOP;
END
$$;
