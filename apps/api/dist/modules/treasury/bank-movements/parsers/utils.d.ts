import type { CsvMovement } from '../bank-movements.service.js';
export type ParsedMovement = CsvMovement;
export declare function parsePortugueseAmount(s: string): number;
export declare function parseDotDecimalAmount(s: string): number;
export declare function parseDateDMY(s: string, sep?: '/' | '-'): string;
export declare function cellToDate(val: unknown): string;
export declare function cellToAmount(val: unknown, format?: 'pt' | 'dot' | 'plain'): number;
export declare function cellToString(val: unknown): string;
//# sourceMappingURL=utils.d.ts.map