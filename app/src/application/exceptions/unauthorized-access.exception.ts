import { ApplicationException } from './application.exception';

export class UnauthorizedAccessException extends ApplicationException {
  constructor(message = 'Credenciais inválidas') {
    super(message);
  }
}
