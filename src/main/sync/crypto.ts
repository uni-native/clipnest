import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

export interface SealedMessage {
  type: 'sealed'
  nonce: string
  content: string
  tag: string
}

export function deriveSyncKey(secret: string): Buffer {
  const value = secret.trim()
  if (Buffer.byteLength(value, 'utf8') < 32) {
    throw new Error('同步口令至少需要 32 个字符')
  }
  return createHash('sha256').update(value, 'utf8').digest()
}

export function groupFingerprint(secret: string): string {
  return createHash('sha256').update(secret.trim(), 'utf8').digest('hex').slice(0, 16)
}

export function encryptMessage(key: Buffer, value: unknown): SealedMessage {
  const nonce = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, nonce)
  const content = Buffer.concat([
    cipher.update(JSON.stringify(value), 'utf8'),
    cipher.final(),
  ])
  return {
    type: 'sealed',
    nonce: nonce.toString('base64'),
    content: content.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
  }
}

export function decryptMessage(key: Buffer, value: unknown): unknown {
  if (!isSealedMessage(value)) throw new Error('未加密的同步消息')
  const nonce = fromBase64(value.nonce)
  const content = fromBase64(value.content)
  const tag = fromBase64(value.tag)
  if (nonce.length !== 12 || tag.length !== 16) throw new Error('同步消息格式无效')
  const decipher = createDecipheriv('aes-256-gcm', key, nonce)
  decipher.setAuthTag(tag)
  const plain = Buffer.concat([decipher.update(content), decipher.final()])
  return JSON.parse(plain.toString('utf8')) as unknown
}

function fromBase64(value: string): Buffer {
  const decoded = Buffer.from(value, 'base64')
  if (decoded.toString('base64') !== value) throw new Error('同步消息编码无效')
  return decoded
}

function isSealedMessage(value: unknown): value is SealedMessage {
  if (!value || typeof value !== 'object') return false
  const message = value as Partial<SealedMessage>
  return message.type === 'sealed'
    && typeof message.nonce === 'string'
    && typeof message.content === 'string'
    && typeof message.tag === 'string'
}