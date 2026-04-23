export function parsePortugueseAmount(s) {
    return parseFloat(s.trim().replace(/\./g, '').replace(',', '.'));
}
export function parseDotDecimalAmount(s) {
    return parseFloat(s.trim().replace(/,/g, ''));
}
export function parseDateDMY(s, sep = '-') {
    const parts = s.trim().split(sep);
    if (parts.length !== 3)
        return s;
    const [d, m, y] = parts;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
}
export function cellToDate(val) {
    if (val instanceof Date)
        return val.toISOString().substring(0, 10);
    if (typeof val === 'string' && val.trim()) {
        const s = val.trim();
        if (s.includes('/'))
            return parseDateDMY(s, '/');
        return parseDateDMY(s, '-');
    }
    return '';
}
export function cellToAmount(val, format = 'plain') {
    if (typeof val === 'number')
        return val;
    if (typeof val === 'string' && val.trim()) {
        const s = val.trim();
        if (format === 'pt')
            return parsePortugueseAmount(s);
        if (format === 'dot')
            return parseDotDecimalAmount(s);
        return parseFloat(s);
    }
    return 0;
}
export function cellToString(val) {
    if (val == null)
        return '';
    return String(val).trim();
}
//# sourceMappingURL=utils.js.map