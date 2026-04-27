const PORTUGUESE_IBAN_LENGTH = 25

function ibanToNumeric(iban: string): string {
    const rearranged = iban.slice(4) + iban.slice(0, 4)
    let out = ''
    for (const ch of rearranged) {
        const code = ch.charCodeAt(0)
        if (code >= 65 && code <= 90) out += String(code - 55)
        else out += ch
    }
    return out
}

function mod97(value: string): number {
    let remainder = 0
    for (const digit of value) {
        remainder = (remainder * 10 + Number(digit)) % 97
    }
    return remainder
}

export function sanitizeIban(input: string): string {
    return input.replace(/\s+/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, PORTUGUESE_IBAN_LENGTH)
}

export function formatIbanInput(input: string): string {
    const clean = sanitizeIban(input)
    return clean.match(/.{1,4}/g)?.join(' ') ?? clean
}

export interface IbanValidationResult {
    isValid: boolean
    countryCode: string
    expectedLength: number | null
    actualLength: number
    checkDigitsAreNumeric: boolean
    controlDigitsValid: boolean
    reason?: 'invalid-country' | 'not-portuguese' | 'invalid-length' | 'invalid-characters' | 'incomplete'
}

export function validateIban(input: string): IbanValidationResult {
    const iban = sanitizeIban(input)
    const result: IbanValidationResult = {
        isValid: false,
        countryCode: iban.slice(0, 2),
        expectedLength: null,
        actualLength: iban.length,
        checkDigitsAreNumeric: /^\d{2}$/.test(iban.slice(2, 4)),
        controlDigitsValid: false,
    }

    if (!iban) {
        result.reason = 'incomplete'
        return result
    }

    if (iban.length < 4) {
        result.reason = 'incomplete'
        return result
    }

    if (!/^[A-Z]{2}$/.test(result.countryCode)) {
        result.reason = 'invalid-country'
        return result
    }

    if (result.countryCode !== 'PT') {
        result.reason = 'not-portuguese'
        return result
    }

    result.expectedLength = PORTUGUESE_IBAN_LENGTH

    if (result.actualLength !== result.expectedLength) {
        result.reason = 'invalid-length'
        return result
    }

    if (!/^[A-Z0-9]+$/.test(iban)) {
        result.reason = 'invalid-characters'
        return result
    }

    if (!result.checkDigitsAreNumeric) {
        result.reason = 'invalid-characters'
        return result
    }

    result.controlDigitsValid = mod97(ibanToNumeric(iban)) === 1
    result.isValid = true

    return result
}
