import { generateKeyPairSync } from 'node:crypto';
import { decodeJwt, decodeProtectedHeader, importSPKI, jwtVerify, SignJWT } from 'jose';

import { TokenSigningException } from '@infrastructure/exceptions/token-signing.exception';
import { JoseTokenIssuerService } from '@infrastructure/security/jose-token-issuer.service';

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

const SETTINGS = {
  issuer: 'oficina-customer-auth',
  audience: 'oficina-api',
  ttlSeconds: 3600,
  keyId: 'customer-auth-test',
};

const SUBJECT = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

describe('JoseTokenIssuerService', () => {
  let issuer: JoseTokenIssuerService;

  beforeEach(async () => {
    issuer = await JoseTokenIssuerService.create(privateKey, SETTINGS);
  });

  it('should issue a token verifiable with the public key distributed to the API', async () => {
    const { accessToken, expiresIn } = await issuer.issueAccessToken(SUBJECT);

    const verified = await jwtVerify(accessToken, await importSPKI(publicKey, 'RS256'), {
      algorithms: ['RS256'],
      issuer: SETTINGS.issuer,
      audience: SETTINGS.audience,
    });

    expect(verified.payload.sub).toBe(SUBJECT);
    expect(expiresIn).toBe(3600);
  });

  /**
   * The assertion that matters is the **negative** one: a claim added by mistake
   * — CPF, e-mail, customer id, role — fails here.
   */
  it('should carry exactly the agreed claims and nothing else', async () => {
    const { accessToken } = await issuer.issueAccessToken(SUBJECT);

    expect(Object.keys(decodeJwt(accessToken)).sort()).toEqual(['aud', 'exp', 'iat', 'iss', 'sub']);
  });

  it('should identify the key in the JOSE header, so rotation needs no contract change', async () => {
    const { accessToken } = await issuer.issueAccessToken(SUBJECT);

    expect(decodeProtectedHeader(accessToken)).toEqual({ alg: 'RS256', kid: SETTINGS.keyId });
  });

  it('should expire the token after the configured validity', async () => {
    const { accessToken } = await issuer.issueAccessToken(SUBJECT);
    const { iat, exp } = decodeJwt(accessToken);

    expect(exp! - iat!).toBe(SETTINGS.ttlSeconds);
  });

  it('should not be verifiable with a different key pair', async () => {
    const other = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    });

    const { accessToken } = await issuer.issueAccessToken(SUBJECT);

    await expect(
      jwtVerify(accessToken, await importSPKI(other.publicKey, 'RS256')),
    ).rejects.toThrow();
  });

  /**
   * The key is imported during composition, not on the first signature: an
   * invalid PEM fails there, pointing the diagnosis at the deployment instead of
   * the runtime. The environment is not aborted — it keeps answering 500 in the
   * documented envelope, because a platform error is not in the contract.
   */
  it('should fail while initializing when the PEM is invalid', async () => {
    await expect(JoseTokenIssuerService.create('nem parece um PEM', SETTINGS)).rejects.toThrow(
      TokenSigningException,
    );
  });

  it('should wrap a signing failure, naming the subject and keeping the cause', async () => {
    const cause = new Error('hsm offline');
    const sign = jest.spyOn(SignJWT.prototype, 'sign').mockRejectedValue(cause);

    await expect(issuer.issueAccessToken(SUBJECT)).rejects.toMatchObject({
      name: 'TokenSigningException',
      cause,
    });
    await expect(issuer.issueAccessToken(SUBJECT)).rejects.toThrow(SUBJECT);

    sign.mockRestore();
  });

  it('should describe a signing failure with no detail', () => {
    expect(new TokenSigningException().message).toBe('Falha ao assinar o token');
  });
});
