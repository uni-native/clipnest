const fs = require('node:fs')

const inputFile = process.argv[2]
const outputFile = process.argv[3]
const voice = process.argv[4]
const style = process.argv[5]
const apiKey = process.env.MIMO_API_KEY

if (!inputFile || !outputFile || !voice || !style) {
  throw new Error('参数缺失：输入文本、输出音频、声音与表达要求均为必填项')
}
if (!apiKey) throw new Error('缺少 MIMO_API_KEY 环境变量')

async function main() {
  const text = fs.readFileSync(inputFile, 'utf8').trim()
  const response = await fetch('https://api.xiaomimimo.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'mimo-v2.5-tts',
      messages: [
        { role: 'assistant', content: text },
        { role: 'user', content: style },
      ],
      audio: { format: 'wav', voice },
    }),
  })

  if (!response.ok) {
    const body = (await response.text()).slice(0, 800)
    throw new Error(`MiMo TTS 请求失败 ${response.status}: ${body}`)
  }
  const result = await response.json()
  const audio = result?.choices?.[0]?.message?.audio?.data
  if (!audio) throw new Error('MiMo TTS 返回中没有音频数据')
  fs.writeFileSync(outputFile, Buffer.from(audio, 'base64'))
  process.stdout.write(JSON.stringify({ ok: true, voice, output: outputFile }))
}

main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
