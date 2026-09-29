import { generateKeyPair, exportPKCS8, exportSPKI } from 'jose';

/**
 * ES256 (ECDSA P-256) key pair for JWT signing — standing rule 12.
 *
 * ES256 rather than RSA: smaller tokens at equivalent strength and faster
 * verification, which matters because mobile clients verify on every request.
 *
 *   pnpm --filter @elourwa/api keygen >> .env
 *
 * Values are emitted as SINGLE-LINE, JSON-quoted strings. A raw multi-line PEM
 * in a .env is a trap: line-based tooling (`grep`, most CI secret editors) keeps
 * only the first line, and the truncated value fails much later with an opaque
 * "must be PKCS#8 formatted string" rather than at the point it was mangled.
 */
const { publicKey, privateKey } = await generateKeyPair('ES256', { extractable: true });

// JSON.stringify handles the quoting and the \n escaping in one step.
console.log('# ES256 JWT keys. Keep the private key out of version control.');
console.log(`JWT_PRIVATE_KEY=${JSON.stringify(await exportPKCS8(privateKey))}`);
console.log(`JWT_PUBLIC_KEY=${JSON.stringify(await exportSPKI(publicKey))}`);
