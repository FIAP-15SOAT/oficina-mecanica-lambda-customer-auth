export interface IHashService {
  compare(value: string, hashed: string): Promise<boolean>;
}
