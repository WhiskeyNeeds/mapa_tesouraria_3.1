import type { CsvMovement } from '../bank-movements.service.js'
import { parseCGD } from './cgd.js'
import { parseBCP } from './bcp.js'
import { parseBPI } from './bpi.js'
import { parseBankinter } from './bankinter.js'
import { parseSantander } from './santander.js'

export type SupportedBank = 'CGD' | 'BCP' | 'BPI' | 'Bankinter' | 'Santander' | 'NovoBanco'

export function parseStatementFile(buffer: Buffer, bank: SupportedBank): CsvMovement[] {
  switch (bank) {
    case 'CGD': return parseCGD(buffer)
    case 'BCP': return parseBCP(buffer)
    case 'BPI': return parseBPI(buffer)
    case 'Bankinter': return parseBankinter(buffer)
    case 'Santander': return parseSantander(buffer)
    case 'NovoBanco': throw new Error('Novo Banco format not supported yet')
    default: throw new Error(`Unknown bank: ${bank}`)
  }
}

export { SupportedBank as BankType }
