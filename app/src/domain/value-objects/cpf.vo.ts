import { DomainValidationException } from '../exceptions/domain-validation.exception';
import { isValidCpf, normalizeCpf } from '../validators/cpf.validator';

const FORMATTED_CPF = /^(\d{3})(\d{3})(\d{3})(\d{2})$/;

export class Cpf {
  private constructor(public readonly value: string) {}

  static create(value: string | null | undefined): Cpf {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new DomainValidationException('CPF é obrigatório');
    }

    if (!isValidCpf(value)) {
      throw new DomainValidationException('CPF inválido');
    }

    return new Cpf(normalizeCpf(value));
  }

  get formatted(): string {
    return this.value.replace(FORMATTED_CPF, '$1.$2.$3-$4');
  }
}
