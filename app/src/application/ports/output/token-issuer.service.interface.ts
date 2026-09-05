export interface IssuedToken {
  accessToken: string;
  expiresIn: number;
}

export interface ITokenIssuerService {
  issueAccessToken(subjectId: string): Promise<IssuedToken>;
}
