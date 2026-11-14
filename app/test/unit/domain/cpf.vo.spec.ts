import { DomainValidationException } from '@domain/exceptions/domain-validation.exception';
import { Cpf } from '@domain/value-objects/cpf.vo';

describe('Cpf', () => {
  it.each(['12345678909', '52998224725', '11144477735'])(
    'should accept the valid cpf %s',
    (value) => {
      expect(Cpf.create(value).value).toBe(value);
    },
  );

  /**
   * Normalization strips **every** non-digit character, not only punctuation:
   * the value looked up must match exactly the 11 digits the API stores, and a
   * CPF typed with spaces must not become a row not found.
   */
  it.each([
    ['123.456.789-09', '12345678909'],
    ['123 456 789 09', '12345678909'],
    ['  12345678909  ', '12345678909'],
  ])('should normalize %s into %s', (input, normalized) => {
    expect(Cpf.create(input).value).toBe(normalized);
  });

  it.each([
    ['an incorrect check digit', '12345678900'],
    ['fewer than 11 digits', '1234567890'],
    ['more than 11 digits', '123456789012'],
    ['a sequence of identical digits', '11111111111'],
    ['text without digits', 'abcdefghijk'],
  ])('should reject a cpf with %s', (_case, value) => {
    expect(() => Cpf.create(value)).toThrow(DomainValidationException);
  });

  it.each([null, undefined, '', '   '])('should reject the absent value %p', (value) => {
    expect(() => Cpf.create(value)).toThrow('CPF é obrigatório');
  });

  /**
   * The punctuated form exists for the log: on it the masker keeps the shape
   * (`***.***.789-09`), while on the 11 raw digits it would produce `12***09`,
   * which reveals the start and destroys the shape.
   */
  it('should expose the punctuated form used by the log', () => {
    expect(Cpf.create('12345678909').formatted).toBe('123.456.789-09');
  });
});
