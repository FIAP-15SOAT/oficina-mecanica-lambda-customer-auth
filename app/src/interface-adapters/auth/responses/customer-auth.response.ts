export interface CustomerAuthResponse {
  accessToken: string;
  expiresIn: number;
}

export interface CustomerAuthDataResponse {
  data: CustomerAuthResponse;
}
