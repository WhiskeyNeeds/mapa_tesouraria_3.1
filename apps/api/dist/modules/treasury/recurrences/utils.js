export function computeNextDate(current, frequency) {
    const d = new Date(current);
    switch (frequency) {
        case 'MONTHLY':
            d.setMonth(d.getMonth() + 1);
            break;
        case 'QUARTERLY':
            d.setMonth(d.getMonth() + 3);
            break;
        case 'SEMIANNUAL':
            d.setMonth(d.getMonth() + 6);
            break;
        case 'ANNUAL':
            d.setFullYear(d.getFullYear() + 1);
            break;
        case 'CUSTOM':
            d.setMonth(d.getMonth() + 1);
            break;
    }
    return d;
}
//# sourceMappingURL=utils.js.map