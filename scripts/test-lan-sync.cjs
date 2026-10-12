const assert = require('node:assert/strict')
const path = require('node:path')
const vm = require('node:vm')
const http = require('node:http')
const crypto = require('node:crypto')
const { once } = require('node:events')
const esbuild = require('esbuild')
const WebSocket = require('ws')
const root = path.resolve(__dirname, '..')
const handlers = new Map()
const messages = []
const clipboard = { value: '', writeText(value) { this.value = value }, writeImage() {} }
const settings = { lanSync: { enabled: false, port: 0, token: '', pin: '', deviceName: 'QA-PC', sendEnabled: true, receiveEnabled: true } }
const code = esbuild.buildSync({entryPoints:[path.join(root,'src/main/lan/server.ts')],bundle:true,write:false,format:'cjs',platform:'node',external:['electron','ws'],alias:{'@shared':path.join(root,'src/shared')}}).outputFiles[0].text
const moduleFixture = {exports:{}}
vm.runInNewContext(code, {
  module:moduleFixture,exports:moduleFixture.exports,Buffer,URL,AbortController,fetch,console,process,setTimeout,clearTimeout,setInterval,clearInterval,
  require(name) {
    if(name==='electron') return {app:{getAppPath:()=>root},clipboard,ipcMain:{handle:(name,handler)=>handlers.set(name,handler)},nativeImage:{createFromBuffer:()=>({isEmpty:()=>false})}}
    if(name==='node:dgram') return {createSocket:()=>({on(){return this},bind(_port,ready){ready()},setBroadcast(){},close(){},send(){}})}
    return require(name)
  },
})
const service = moduleFixture.exports
let handle, socket, pushServer
const wait = ms => new Promise(resolve=>setTimeout(resolve,ms))
async function next(type) {
  for(let i=0;i<100;i++) {
    const index = messages.findIndex(message=>message.t===type)
    if(index>=0) return messages.splice(index,1)[0]
    await wait(20)
  }
  throw new Error('No response: '+type)
}
async function freePort() {
  const server = http.createServer()
  server.listen(0,'127.0.0.1'); await once(server,'listening')
  const port = server.address().port
  await new Promise(resolve=>server.close(resolve))
  return port
}
async function main() {
  const port = await freePort()
  handle = service.startLanSync({store:{getSettings:()=>settings,saveSettings:patch=>{settings.lanSync={...settings.lanSync,...patch.lanSync};return settings}}})
  assert.equal(service.getLanStatus().enabled,false)
  service.registerLanIpc()
  assert.equal(handlers.size,4)
  service.setLanConfig({enabled:true,port})
  const address = 'http://127.0.0.1:'+port
  assert.equal((await fetch(address+'/ping')).status,200)
  assert.equal((await fetch(address+'/pending',{headers:{'X-Token':'invalid'}})).status,403)
  const token = settings.lanSync.token
  socket = new WebSocket('ws://127.0.0.1:'+port)
  socket.on('message',bytes=>messages.push(JSON.parse(String(bytes))))
  await once(socket,'open')
  socket.send(JSON.stringify({t:'pair',pin:'invalid',device:'QA-phone'}))
  assert.equal((await next('auth-fail')).reason,'pin')
  socket.send(JSON.stringify({t:'pair',pin:settings.lanSync.pin,device:'QA-phone'}))
  assert.equal((await next('paired')).token,token)
  const text = 'LAN test clipboard'
  socket.send(JSON.stringify({t:'clip',id:'qa',ts:Date.now(),kind:'text',text,hash:crypto.createHash('sha256').update(text).digest('hex')}))
  await wait(50); assert.equal(clipboard.value,text)
  service.setLanConfig({receiveEnabled:false})
  socket.send(JSON.stringify({t:'clip',id:'qa2',ts:Date.now(),kind:'text',text:'ignored',hash:'ignored'}))
  await wait(50); assert.equal(clipboard.value,text)
  service.setLanConfig({receiveEnabled:true})
  const post = {type:'text',preview:'PC test clipboard',hash:'qa-local'}
  handle.notifyLocalCapture(post)
  assert.equal((await next('clip')).text,post.preview)
  const pending = await (await fetch(address+'/pending',{headers:{'X-Token':token}})).json()
  assert.equal(pending.clips[0].text,post.preview)
  let pushed = ''
  pushServer = http.createServer(async(req,res)=>{for await(const chunk of req) pushed+=chunk;res.writeHead(204);res.end()})
  pushServer.listen(0,'127.0.0.1'); await once(pushServer,'listening')
  assert.equal((await fetch(address+'/register',{method:'POST',headers:{'X-Token':token},body:JSON.stringify({port:pushServer.address().port,device:'QA-IME'})})).status,204)
  handle.notifyLocalCapture({type:'text',preview:'Input method test',hash:'qa-ime'})
  for(let i=0;i<100&&!pushed;i++) await wait(20)
  assert.equal(JSON.parse(pushed).text,'Input method test')
  assert.equal((await fetch(address+'/clip',{method:'POST',headers:{'X-Token':token},body:JSON.stringify({kind:'text',text:'IME test clipboard',port:pushServer.address().port})})).status,204)
  assert.equal(clipboard.value,'IME test clipboard')
  service.setLanConfig({enabled:false})
  assert.equal(service.getLanStatus().listening,false)
  console.log('PASS: disabled default, IPC registration, token rejection, PIN pairing, WS send/receive, receive toggle, pending retrieval, HTTP push/receive, stop')
}
main().catch(error=>{console.error('[lan-test]',error);process.exitCode=1}).finally(async()=>{
  socket?.terminate()
  handle?.stop()
  if(pushServer) await new Promise(resolve=>pushServer.close(resolve))
})
