import { httpError } from '../../../lib/errors.js';
const PORTUGUESE_IBAN_LENGTH = 25;
export function sanitizeIban(input) {
    return input.replace(/\s+/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, PORTUGUESE_IBAN_LENGTH);
}
export function assertValidIban(input) {
    const iban = sanitizeIban(input);
    if (!iban)
        return;
    if (iban.length < 4) {
        throw httpError(400, 'IBAN inválido: formato incompleto.');
    }
    const country = iban.slice(0, 2);
    const checkDigits = iban.slice(2, 4);
    if (!/^[A-Z]{2}$/.test(country)) {
        throw httpError(400, 'IBAN inválido: código de país inválido.');
    }
    if (country !== 'PT') {
        throw httpError(400, 'IBAN inválido: contas portuguesas têm de começar por PT.');
    }
    if (iban.length !== PORTUGUESE_IBAN_LENGTH) {
        throw httpError(400, `IBAN inválido: IBAN PT exige ${PORTUGUESE_IBAN_LENGTH} caracteres.`);
    }
    if (!/^\d{2}$/.test(checkDigits)) {
        throw httpError(400, 'IBAN inválido: os dígitos de controlo (posições 3 e 4) devem ser numéricos.');
    }
    if (!/^[A-Z0-9]+$/.test(iban)) {
        throw httpError(400, 'IBAN inválido: contém caracteres não permitidos.');
    }
}
//# sourceMappingURL=iban.js.map