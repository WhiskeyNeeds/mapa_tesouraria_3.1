/**
 * Finds the tail of an imported movement chain for a given day.
 * The tail is the movement whose balanceAfter is not the starting balance of any other movement.
 * Needed because CSV exports are newest-first: createdAt order != chain order.
 */
export function findDayTail(imported) {
    if (imported.length === 0)
        return undefined;
    if (imported.length === 1)
        return imported[0];
    const startingBalances = new Set(imported.map((m) => Math.round((m.balanceAfter - m.amount) * 100)));
    return imported.find((m) => !startingBalances.has(Math.round(m.balanceAfter * 100)));
}
/**
 * Computes the balanceAfter for each MANUAL movement.
 * bankRunning anchors to the latest bank-verified balance of the day.
 * manualCumulative accumulates forever across days (never resets).
 */
export function computeManualBalances(openingBalance, movements) {
    const sorted = [...movements].sort((a, b) => {
        const d = a.date.getTime() - b.date.getTime();
        return d !== 0 ? d : 0;
    });
    const byDay = new Map();
    for (const m of sorted) {
        const day = m.date.toISOString().slice(0, 10);
        if (!byDay.has(day))
            byDay.set(day, []);
        byDay.get(day).push(m);
    }
    let bankRunning = openingBalance;
    let manualCumulative = 0;
    const updates = [];
    for (const dayMovs of byDay.values()) {
        const imported = dayMovs.filter((m) => m.source !== 'MANUAL' && m.balanceAfter !== null);
        const tail = findDayTail(imported);
        if (tail)
            bankRunning = tail.balanceAfter;
        for (const mov of dayMovs.filter((m) => m.source === 'MANUAL')) {
            manualCumulative += mov.amount;
            updates.push({ id: mov.id, balanceAfter: bankRunning + manualCumulative });
        }
    }
    return updates;
}
/**
 * Computes the final account balance:
 * 1. Anchors on the last bank-verified balance (source != MANUAL)
 * 2. Adds all manual movement amounts on top
 */
export function resolveAccountBalance(openingBalance, movements) {
    const imported = movements.filter((m) => m.source !== 'MANUAL' && m.balanceAfter !== null);
    let chainBalance;
    if (imported.length === 0) {
        chainBalance = openingBalance;
    }
    else {
        const maxDate = imported.reduce((max, m) => m.date > max ? m.date : max, imported[0].date);
        const lastDay = imported.filter((m) => m.date.getTime() === maxDate.getTime());
        const tail = findDayTail(lastDay);
        chainBalance = tail ? tail.balanceAfter : lastDay[0].balanceAfter;
    }
    const manualSum = movements
        .filter((m) => m.source === 'MANUAL')
        .reduce((sum, m) => sum + m.amount, 0);
    return chainBalance + manualSum;
}
//# sourceMappingURL=balance.js.map