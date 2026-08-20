/**
 * Cifra de segredos guardados no banco.
 *
 * Existe por causa de duas credenciais que o sistema precisa armazenar e que
 * não são dele:
 *
 *   - o token do LinkedIn, que publica no perfil de outra pessoa;
 *   - o token OAuth do GitHub com escopo `repo`, que o dev concede de forma
 *     opcional para incluir repositórios onde é apenas colaborador. Não existe
 *     escopo somente-leitura para repositório privado no OAuth clássico, então
 *     esse token lê E escreve em tudo que a pessoa alcança.
 *
 * Nenhum dos dois pode ficar em claro numa tabela. O que isto protege é
 * especificamente o cenário de dump do banco — quem tiver o ambiente da
 * aplicação inteiro tem a chave também, e nada aqui muda isso.
 *
 * AES-256-GCM: cifra e autentica na mesma operação, então adulterar o texto
 * cifrado é detectado na hora de decifrar em vez de virar lixo silencioso.
 */

import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from "node:crypto";

/** Prefixo de versão, para trocar de algoritmo sem quebrar o que já está gravado. */
const VERSION = "v1";
const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;

export class CryptoKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CryptoKeyError";
  }
}

export class DecryptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DecryptionError";
  }
}

/** Gera uma chave nova, em hex. Uso: colocar em TOKEN_ENCRYPTION_KEY. */
export function generateEncryptionKey(): string {
  return randomBytes(KEY_BYTES).toString("hex");
}

function parseKey(keyHex: string): Buffer {
  if (!/^[0-9a-fA-F]{64}$/.test(keyHex)) {
    throw new CryptoKeyError(
      "TOKEN_ENCRYPTION_KEY precisa ser 32 bytes em hexadecimal (64 caracteres). " +
        "Gere com: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
    );
  }
  return Buffer.from(keyHex, "hex");
}

/**
 * Devolve `v1.<iv>.<tag>.<ciphertext>`, tudo em base64url.
 *
 * O IV é sorteado a cada chamada, então cifrar o mesmo valor duas vezes dá
 * resultados diferentes — é o que impede alguém de olhar a tabela e concluir
 * que dois usuários têm o mesmo token.
 */
export function encryptSecret(plaintext: string, keyHex: string): string {
  const key = parseKey(keyHex);
  const iv = randomBytes(IV_BYTES);

  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [VERSION, iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(".");
}

export function decryptSecret(payload: string, keyHex: string): string {
  const key = parseKey(keyHex);
  const parts = payload.split(".");

  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new DecryptionError(`Formato irreconhecível. Esperado "${VERSION}.<iv>.<tag>.<dados>".`);
  }

  const iv = Buffer.from(parts[1] ?? "", "base64url");
  const tag = Buffer.from(parts[2] ?? "", "base64url");
  const ciphertext = Buffer.from(parts[3] ?? "", "base64url");

  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new DecryptionError("Vetor de inicialização ou marca de autenticação com tamanho errado.");
  }

  try {
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    // Chave errada e texto adulterado falham do mesmo jeito, e a mensagem não
    // distingue os dois de propósito: dizer qual foi ajuda quem está tentando.
    throw new DecryptionError("Não foi possível decifrar: chave incorreta ou dado adulterado.");
  }
}

/** Comparação em tempo constante, tolerante a tamanhos diferentes. */
export function secretsMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
