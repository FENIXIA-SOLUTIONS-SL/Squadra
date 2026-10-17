/**
 * Minimal WebSocket server side (RFC 6455) for squadra-server: text frames,
 * ping/pong and close, with fragmented messages reassembled. Only Node
 * built-ins — no dependencies.
 *
 *   server.on('upgrade', (req, socket, head) => {
 *     const ws = acceptWebSocket(req, socket, head)
 *     if (!ws) return
 *     ws.onmessage = text => …
 *     ws.onclose = () => …
 *     ws.send('hello')
 *   })
 */

import { createHash } from 'node:crypto'

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'
const MAX_MESSAGE = 2 * 1024 * 1024 // per message, after reassembly

export function acceptWebSocket(req, socket, head, { maxMessage = MAX_MESSAGE } = {}) {
  const key = req.headers['sec-websocket-key']
  if (req.headers.upgrade?.toLowerCase() !== 'websocket' || !key) {
    socket.end('HTTP/1.1 400 Bad Request\r\n\r\n')
    return null
  }
  const accept = createHash('sha1').update(key + GUID).digest('base64')
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
    `Sec-WebSocket-Accept: ${accept}\r\n\r\n`)
  socket.setNoDelay(true)
  socket.setTimeout(0)

  let buf = head?.length ? Buffer.from(head) : Buffer.alloc(0)
  let fragments = []
  let fragmentsSize = 0
  let fragmentOpcode = 0
  let closed = false

  const ws = {
    onmessage: () => {},
    onclose: () => {},
    get open() { return !closed },
    send(text) {
      if (closed) return false
      socket.write(frame(0x1, Buffer.from(String(text), 'utf8')))
      return true
    },
    close(code = 1000, reason = '') {
      if (closed) return
      const r = Buffer.from(String(reason).slice(0, 120), 'utf8')
      const body = Buffer.alloc(2 + r.length)
      body.writeUInt16BE(code, 0)
      r.copy(body, 2)
      try { socket.write(frame(0x8, body)) } catch {}
      finish()
      setTimeout(() => socket.destroy(), 1000).unref()
      socket.end()
    },
    // Bytes waiting to be written: used to drop output for slow viewers.
    get buffered() { return socket.writableLength },
  }

  function finish() {
    if (closed) return
    closed = true
    try { ws.onclose() } catch {}
  }

  function fail(code, reason) { ws.close(code, reason) }

  socket.on('data', chunk => {
    buf = buf.length ? Buffer.concat([buf, chunk]) : chunk
    parse()
  })
  socket.on('close', finish)
  socket.on('error', finish)
  if (buf.length) setImmediate(parse)

  function parse() {
    while (!closed && buf.length >= 2) {
      const b0 = buf[0], b1 = buf[1]
      const fin = (b0 & 0x80) !== 0
      const opcode = b0 & 0x0f
      const masked = (b1 & 0x80) !== 0
      let len = b1 & 0x7f
      let off = 2
      if (len === 126) {
        if (buf.length < 4) return
        len = buf.readUInt16BE(2); off = 4
      } else if (len === 127) {
        if (buf.length < 10) return
        const big = buf.readBigUInt64BE(2)
        if (big > BigInt(maxMessage)) return fail(1009, 'message too big')
        len = Number(big); off = 10
      }
      if (!masked) return fail(1002, 'client frames must be masked')
      if (len > maxMessage) return fail(1009, 'message too big')
      if (buf.length < off + 4 + len) return
      const mask = buf.subarray(off, off + 4)
      const payload = Buffer.from(buf.subarray(off + 4, off + 4 + len))
      for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3]
      buf = buf.subarray(off + 4 + len)

      if (opcode === 0x8) { // close
        const code = payload.length >= 2 ? payload.readUInt16BE(0) : 1000
        ws.close(code === 1005 || code === 1006 ? 1000 : code)
        return
      }
      if (opcode === 0x9) { socket.write(frame(0xA, payload)); continue } // ping → pong
      if (opcode === 0xA) continue                                       // pong
      if (opcode === 0x1 || opcode === 0x2) {
        if (fragments.length) return fail(1002, 'expected a continuation frame')
        fragmentOpcode = opcode
      } else if (opcode !== 0x0) {
        return fail(1002, 'unknown opcode')
      } else if (!fragments.length) {
        return fail(1002, 'unexpected continuation frame')
      }
      fragments.push(payload)
      fragmentsSize += payload.length
      if (fragmentsSize > maxMessage) return fail(1009, 'message too big')
      if (!fin) continue
      const data = Buffer.concat(fragments)
      fragments = []; fragmentsSize = 0
      if (fragmentOpcode === 0x1) {
        try { ws.onmessage(data.toString('utf8')) } catch (err) { process.stderr.write(`squadra-server: websocket handler: ${err?.stack ?? err}\n`) }
      }
    }
  }

  return ws
}

function frame(opcode, payload) {
  const len = payload.length
  let header
  if (len < 126) {
    header = Buffer.from([0x80 | opcode, len])
  } else if (len < 65536) {
    header = Buffer.alloc(4); header[0] = 0x80 | opcode; header[1] = 126; header.writeUInt16BE(len, 2)
  } else {
    header = Buffer.alloc(10); header[0] = 0x80 | opcode; header[1] = 127; header.writeBigUInt64BE(BigInt(len), 2)
  }
  return Buffer.concat([header, payload])
}
