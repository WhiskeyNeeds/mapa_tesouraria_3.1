export interface MovementSnapshot {
    id: string;
    date: Date;
    amount: number;
    balanceAfter: number | null;
    source: string;
}
/**
 * Finds the tail of an imported movement chain for a given day.
 * The tail is the movement whose balanceAfter is not the starting balance of any other movement.
 * Needed because CSV exports are newest-first: createdAt order != chain order.
 */
export declare function findDayTail(imported: MovementSnapshot[]): MovementSnapshot | undefined;
/**
 * Computes the balanceAfter for each MANUAL movement.
 * bankRunning anchors to the latest bank-verified balance of the day.
 * manualCumulative accumulates forever across days (never resets).
 */
export declare function computeManualBalances(openingBalance: number, movements: MovementSnapshot[]): {
    id: string;
    balanceAfter: number;
}[];
/**
 * Computes the final account balance:
 * 1. Anchors on the last bank-verified balance (source != MANUAL)
 * 2. Adds all manual movement amounts on top
 */
export declare function resolveAccountBalance(openingBalance: number, movements: MovementSnapshot[]): number;
//# sourceMappingURL=balance.d.ts.map