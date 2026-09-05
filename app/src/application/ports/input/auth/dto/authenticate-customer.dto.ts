export interface AuthenticateCustomerInputDto {
  cpf: string;
  password: string;
}

export interface AuthenticateCustomerOutputDto {
  accessToken: string;
  expiresIn: number;
}
