import XLSX from 'xlsx';
import { cellToDate, cellToAmount, cellToString } from './utils.js';
// Header row index (0-based): row 8 in Excel = index 7
// Data starts at index 8
const HEADER_ROW = 7;
const DATA_START = 8;
export function parseBankinter(buffer) {
    const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true, raw: true });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', blankrows: false, raw: true });
    const results = [];
    for (let i = DATA_START; i < rows.length; i++) {
        const row = rows[i];
        if (!row || row.length < 4)
            continue;
        // Columns: Data Movimento | Data Valor | Descrição | Montante | Saldo
        const date = cellToDate(row[0]);
        const bookingDate = cellToDate(row[1]);
        const description = cellToString(row[2]);
        // Bankinter uses dot decimal: "-346.87"
        const amount = cellToAmount(row[3], 'plain');
        const balanceAfter = row[4] ? cellToAmount(row[4], 'plain') : undefined;
        if (!date || !description || isNaN(amount))
            continue;
        results.push({ date, bookingDate, description, amount, balanceAfter });
    }
    return results;
}
//# sourceMappingURL=bankinter.js.map