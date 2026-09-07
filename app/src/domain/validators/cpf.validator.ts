const CPF_LENGTH = 11;

const REPEATED_DIGITS = /^(\d)\1{10}$/;

const NON_DIGIT = /\D/g;

export function normalizeCpf(value: string): string {
  return value.replaceAll(NON_DIGIT, '');
}

export function isValidCpf(value: string): boolean {
  const cpf = normalizeCpf(value);

  if (cpf.length !== CPF_LENGTH) {
    return false;
  }

  if (REPEATED_DIGITS.test(cpf)) {
    return false;
  }

  return checkDigit(cpf, 9) && checkDigit(cpf, 10);
}

function checkDigit(cpf: string, position: number): boolean {
  let sum = 0;

  for (let index = 0; index < position; index += 1) {
    sum += Number.parseInt(cpf[index], 10) * (position + 1 - index);
  }

  const remainder = sum % 11;
  const expected = remainder < 2 ? 0 : 11 - remainder;

  return Number.parseInt(cpf[position], 10) === expected;
}
