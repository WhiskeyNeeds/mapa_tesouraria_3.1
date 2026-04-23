import type { CsvMovement } from '../bank-movements.service.js';
export type SupportedBank = 'CGD' | 'BCP' | 'BPI' | 'Bankinter' | 'Santander' | 'NovoBanco';
export declare function detectBank(buffer: Buffer): SupportedBank | null;
export declare function parseStatementFile(buffer: Buffer, bank: SupportedBank): CsvMovement[];
export { SupportedBank as BankType };
//# sourceMappingURL=index.d.ts.map