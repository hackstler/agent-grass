export interface TokenEncryption {
  encrypt(plaintext: string): string;
  decrypt(encoded: string): string;
}
