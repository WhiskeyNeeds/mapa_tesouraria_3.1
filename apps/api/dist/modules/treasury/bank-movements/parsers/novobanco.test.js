import { describe, it, expect } from 'vitest';
import { parseNovoBanco } from './novobanco.js';
function latin1(s) {
    return Buffer.from(s, 'latin1');
}
// NovoBanco format: semicolon-separated, latin1, separate Débito/Crédito columns
const HEADER_DEBIT_CREDIT = '"Data Lançamento";"Data Valor";"Descrição";"Débito";"Crédito";"Saldo"';
const HEADER_MONTANTE = '"Data Movimento";"Data Valor";"Descrição";"Montante";"Saldo"';
function makeCSV(header, dataLines) {
    return latin1([header, ...dataLines].join('\n'));
}
describe('parseNovoBanco — Débito/Crédito format', () => {
    it('parses a credit movement (Crédito column)', () => {
        const buf = makeCSV(HEADER_DEBIT_CREDIT, [
            '"02-03-2026";"02-03-2026";"Transferência recebida";"";"500,00";"1.500,00"',
        ]);
        const result = parseNovoBanco(buf);
        expect(result).toHaveLength(1);
        expect(result[0].date).toBe('2026-03-02');
        expect(result[0].bookingDate).toBe('2026-03-02');
        expect(result[0].description).toBe('Transferência recebida');
        expect(result[0].amount).toBeCloseTo(500, 2);
        expect(result[0].balanceAfter).toBeCloseTo(1500, 2);
    });
    it('parses a debit movement (Débito column)', () => {
        const buf = makeCSV(HEADER_DEBIT_CREDIT, [
            '"01-03-2026";"01-03-2026";"Pagamento TSU";"250,00";"";"1.000,00"',
        ]);
        const result = parseNovoBanco(buf);
        expect(result).toHaveLength(1);
        expect(result[0].amount).toBeCloseTo(-250, 2);
        expect(result[0].balanceAfter).toBeCloseTo(1000, 2);
    });
    it('parses multiple movements', () => {
        const buf = makeCSV(HEADER_DEBIT_CREDIT, [
            '"03-03-2026";"03-03-2026";"Compra Online";"45,99";"";"954,01"',
            '"02-03-2026";"02-03-2026";"Salário";"";"2.000,00";"1.000,00"',
            '"01-03-2026";"01-03-2026";"Renda";"600,00";"";"1.000,00" ',
        ]);
        const result = parseNovoBanco(buf);
        expect(result).toHaveLength(3);
        expect(result[0].date).toBe('2026-03-03');
        expect(result[0].amount).toBeCloseTo(-45.99, 2);
        expect(result[1].amount).toBeCloseTo(2000, 2);
        expect(result[2].amount).toBeCloseTo(-600, 2);
    });
    it('handles thousands separators in amounts', () => {
        const buf = makeCSV(HEADER_DEBIT_CREDIT, [
            '"28-02-2026";"28-02-2026";"Pagamento fornecedor";"1.250,75";"";"8.749,25"',
        ]);
        const result = parseNovoBanco(buf);
        expect(result[0].amount).toBeCloseTo(-1250.75, 2);
        expect(result[0].balanceAfter).toBeCloseTo(8749.25, 2);
    });
    it('skips rows with empty date', () => {
        const buf = makeCSV(HEADER_DEBIT_CREDIT, [
            '"02-03-2026";"02-03-2026";"OK";"";"100,00";"200,00"',
            '"";"";"";"";"";"" ',
        ]);
        const result = parseNovoBanco(buf);
        expect(result).toHaveLength(1);
    });
    it('skips rows with too few columns', () => {
        const buf = makeCSV(HEADER_DEBIT_CREDIT, [
            '"02-03-2026";"02-03-2026"',
        ]);
        const result = parseNovoBanco(buf);
        expect(result).toHaveLength(0);
    });
    it('returns empty array when no data lines follow header', () => {
        const buf = makeCSV(HEADER_DEBIT_CREDIT, []);
        const result = parseNovoBanco(buf);
        expect(result).toHaveLength(0);
    });
    it('handles end-of-month dates correctly', () => {
        const buf = makeCSV(HEADER_DEBIT_CREDIT, [
            '"31-01-2026";"31-01-2026";"TEST";"";"100,00";"1.100,00"',
        ]);
        const result = parseNovoBanco(buf);
        expect(result[0].date).toBe('2026-01-31');
    });
});
describe('parseNovoBanco — Montante format', () => {
    it('parses a positive amount (credit)', () => {
        const buf = makeCSV(HEADER_MONTANTE, [
            '"02-03-2026";"02-03-2026";"Transferência";"750,00";"1.750,00"',
        ]);
        const result = parseNovoBanco(buf);
        expect(result).toHaveLength(1);
        expect(result[0].amount).toBeCloseTo(750, 2);
        expect(result[0].balanceAfter).toBeCloseTo(1750, 2);
    });
    it('parses a negative amount (debit)', () => {
        const buf = makeCSV(HEADER_MONTANTE, [
            '"01-03-2026";"01-03-2026";"Débito direto";"-99,50";"900,50"',
        ]);
        const result = parseNovoBanco(buf);
        expect(result).toHaveLength(1);
        expect(result[0].amount).toBeCloseTo(-99.5, 2);
    });
    it('parses multiple movements in Montante format', () => {
        const buf = makeCSV(HEADER_MONTANTE, [
            '"05-03-2026";"05-03-2026";"Compra";"-35,00";"965,00"',
            '"04-03-2026";"04-03-2026";"Recebimento";"200,00";"1.000,00"',
        ]);
        const result = parseNovoBanco(buf);
        expect(result).toHaveLength(2);
        expect(result[0].amount).toBeCloseTo(-35, 2);
        expect(result[1].amount).toBeCloseTo(200, 2);
    });
    it('skips rows with missing amount in Montante format', () => {
        const buf = makeCSV(HEADER_MONTANTE, [
            '"02-03-2026";"02-03-2026";"DESC";"  ";"1.000,00"',
        ]);
        const result = parseNovoBanco(buf);
        expect(result).toHaveLength(0);
    });
});
describe('parseNovoBanco — edge cases', () => {
    it('returns empty array for file with no recognizable header', () => {
        const buf = latin1('irrelevant;header;line\n01-01-2026;01-01-2026;desc;100,00');
        const result = parseNovoBanco(buf);
        expect(result).toHaveLength(0);
    });
    it('skips rows with completely missing date', () => {
        const buf = makeCSV(HEADER_DEBIT_CREDIT, [
            '"";"02-03-2026";"Bad row";"";"100,00";"200,00"',
            '"02-03-2026";"02-03-2026";"Good";"" ;"50,00";"150,00"',
        ]);
        const result = parseNovoBanco(buf);
        expect(result).toHaveLength(1);
        expect(result[0].description).toBe('Good');
    });
});
//# sourceMappingURL=novobanco.test.js.map