import { importPKCS8, SignJWT } from 'jose';

import {
  IssuedToken,
  ITokenIssuerService,
} from '@application/ports/output/token-issuer.service.interface';
import { TokenSigningException } from '@infrastructure/exceptions/token-signing.exception';

export const TOKEN_ALGORITHM = 'RS256';

type SigningKey = Awaited<ReturnType<typeof importPKCS8>>;

export interface TokenIssuerSettings {
  issuer: string;
  audience: string;
  ttlSeconds: number;
  keyId: string;
}

export class JoseTokenIssuerService implements ITokenIssuerService {
  private constructor(
    private readonly privateKey: SigningKey,
    private readonly settings: TokenIssuerSettings,
  ) {}

  static async create(
    privateKeyPem: string,
    settings: TokenIssuerSettings,
  ): Promise<JoseTokenIssuerService> {
    try {
      const privateKey = await importPKCS8(privateKeyPem, TOKEN_ALGORITHM);

      return new JoseTokenIssuerService(privateKey, settings);
    } catch (error) {
      throw new TokenSigningException('chave privada inválida', { cause: error });
    }
  }

  async issueAccessToken(subjectId: string): Promise<IssuedToken> {
    const issuedAt = Math.floor(Date.now() / 1000);
    const expiresAt = issuedAt + this.settings.ttlSeconds;

    try {
      const accessToken = await new SignJWT({})
        .setProtectedHeader({ alg: TOKEN_ALGORITHM, kid: this.settings.keyId })
        .setSubject(subjectId)
        .setIssuer(this.settings.issuer)
        .setAudience(this.settings.audience)
        .setIssuedAt(issuedAt)
        .setExpirationTime(expiresAt)
        .sign(this.privateKey);

      return { accessToken, expiresIn: this.settings.ttlSeconds };
    } catch (error) {
      throw new TokenSigningException(`sujeito ${subjectId}`, { cause: error });
    }
  }
}
