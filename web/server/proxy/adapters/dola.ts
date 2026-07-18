/**
 * Dola (Doubao) Adapter
 * Implements Dola web API protocol with chat, image generation, and writing modes
 * 
 * API endpoint: https://www.dola.com/chat/completion
 * Auth: Cookie-based (sessionid + passport cookies)
 * Response: SSE stream with custom JSON Patch protocol
 * 
 * Skills:
 *   - skill_type 0: Default chat (快速)
 *   - skill_type 3: Image generation (图像生成)
 *   - skill_type 2: Writing assistant (帮我写作)
 *   - skill_type 17: Video generation (视频生成)
 *   - skill_type 5: Translation (翻译)
 *   - skill_type 11: Photo Q&A (拍题答疑)
 */

import axios, { AxiosResponse } from 'axios'
import { Account, Provider } from '../../types.js'
import { PassThrough } from 'stream'

const DOLA_API_BASE = 'https://www.dola.com'

const FAKE_HEADERS: Record<string, string> = {
  Accept: '*/*',
  'Accept-Encoding': 'gzip, deflate, br, zstd',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  'Cache-Control': 'no-cache',
  Pragma: 'no-cache',
  Origin: DOLA_API_BASE,
  Referer: DOLA_API_BASE + '/',
  'Sec-Ch-Ua': '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
  'Sec-Ch-Ua-Mobile': '?0',
  'Sec-Ch-Ua-Platform': '"Windows"',
  'Sec-Fetch-Dest': 'empty',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Site': 'same-origin',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  Priority: 'u=1, i',
}

// Model → skill_type mapping
const MODEL_SKILL_MAP: Record<string, number> = {
  'dola-chat': 0,        // 快速 - default chat
  'dola-expert': 0,      // 专家 - deep thinking mode
  'dola-writing': 2,     // 帮我写作
  'dola-image': 3,       // 图像生成
  'dola-translate': 5,   // 翻译
  'dola-photo-qa': 11,   // 拍题答疑
  'dola-video': 17,      // 视频生成
}

interface DolaMessage {
  role: 'user' | 'assistant' | 'system'
  content: string | any[] | null
}

interface ChatCompletionRequest {
  model: string
  messages: DolaMessage[]
  stream?: boolean
  temperature?: number
}

function generateId(prefix: string = ''): string {
  return prefix + Date.now() + '-' + Math.random().toString(36).substring(2, 11)
}

/**
 * Extract the last user message from messages array
 */
function getLastUserMessage(messages: DolaMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg.role === 'user') {
      if (typeof msg.content === 'string') return msg.content
      if (Array.isArray(msg.content)) {
        return msg.content
          .filter((c: any) => c.type === 'text')
          .map((c: any) => c.text)
          .join('\n')
      }
    }
  }
  return ''
}

/**
 * Build conversation history context from messages
 */
function buildContext(messages: DolaMessage[]): string {
  const history = messages
    .filter(m => m.role !== 'system')
    .map(m => {
      const content = typeof m.content === 'string' ? m.content : ''
      const role = m.role === 'user' ? 'User' : 'Assistant'
      return `${role}: ${content}`
    })
    .join('\n\n')
  return history
}

/**
 * Parse SSE stream from Dola and extract AI response
 */
function parseDolaSSE(rawText: string): { text: string; images: string[]; videoUrl?: string } {
  const events = rawText.split('\n\n')
  let text = ''
  const images: string[] = []
  let videoUrl: string | undefined

  for (const ev of events) {
    const lines = ev.split('\n')
    let eventType = ''
    let dataLine = ''

    for (const line of lines) {
      if (line.startsWith('event: ')) eventType = line.substring(7)
      if (line.startsWith('data: ')) dataLine = line.substring(6)
    }

    if (!dataLine || eventType === 'SSE_HEARTBEAT') continue

    try {
      const d = JSON.parse(dataLine)

      // STREAM_MSG_NOTIFY - initial AI message with full text
      if (eventType === 'STREAM_MSG_NOTIFY' || eventType === 'FULL_MSG_NOTIFY') {
        const contentBlocks = d.content?.content_block || d.message?.content_block || []
        for (const b of contentBlocks) {
          // Text block (block_type 10000)
          if (b.block_type === 10000 && b.content?.text_block?.text) {
            if (d.meta?.user_type === 2 || d.message?.user_type === 2) {
              text += b.content.text_block.text
            }
          }
          // Image/Creation block (block_type 2074)
          if (b.block_type === 2074 && b.content?.creation_block?.creations) {
            for (const creation of b.content.creation_block.creations) {
              if (creation.image_url) images.push(creation.image_url)
              if (creation.video_url) videoUrl = creation.video_url
            }
          }
        }
      }

      // STREAM_CHUNK - incremental text patches
      if (eventType === 'STREAM_CHUNK' && d.patch_op) {
        for (const patch of d.patch_op) {
          if (patch.patch_value?.content_block) {
            for (const b of patch.patch_value.content_block) {
              if (b.block_type === 10000 && b.content?.text_block?.text) {
                text += b.content.text_block.text
              }
              if (b.block_type === 2074 && b.content?.creation_block?.creations) {
                for (const creation of b.content.creation_block.creations) {
                  if (creation.image_url) images.push(creation.image_url)
                  if (creation.video_url) videoUrl = creation.video_url
                }
              }
            }
          }
        }
      }

      // DOWNLINK_CMD - may contain image/video data
      if (eventType === 'DOWNLINK_CMD' && d.cmd_data) {
        const str = JSON.stringify(d)
        const urlMatches = str.match(/https?:\/\/[^"\s\\]+/gi)
        if (urlMatches) {
          for (const u of urlMatches) {
            if (u.match(/\.(png|jpg|jpeg|webp)/i) && !images.includes(u)) {
              images.push(u)
            }
            if (u.match(/\.(mp4|webm)/i)) {
              videoUrl = u
            }
          }
        }
      }
    } catch (e) {
      // skip unparseable
    }
  }

  return { text, images, videoUrl }
}

/**
 * Parse SSE stream chunks in real-time for streaming response
 */
function parseStreamChunk(dataLine: string): { text?: string; images?: string[]; done: boolean } {
  try {
    const d = JSON.parse(dataLine)
    let text = ''
    const images: string[] = []
    let done = false

    // STREAM_MSG_NOTIFY format: content.content_block[].content.text_block.text
    if (d.content?.content_block) {
      for (const b of d.content.content_block) {
        if (b.block_type === 10000 && b.content?.text_block?.text) {
          text += b.content.text_block.text
        }
        if (b.block_type === 2074 && b.content?.creation_block?.creations) {
          for (const c of b.content.creation_block.creations) {
            if (c.image_url) images.push(c.image_url)
          }
        }
        if (b.is_finish === true) done = true
      }
    }

    // STREAM_CHUNK format: patch_op[].patch_value.content_block[]
    if (d.patch_op) {
      for (const patch of d.patch_op) {
        if (patch.patch_value?.content_block) {
          for (const b of patch.patch_value.content_block) {
            if (b.block_type === 10000 && b.content?.text_block?.text) {
              text += b.content.text_block.text
            }
            if (b.block_type === 2074 && b.content?.creation_block?.creations) {
              for (const c of b.content.creation_block.creations) {
                if (c.image_url) images.push(c.image_url)
              }
            }
            if (b.is_finish === true) done = true
          }
        }
        // Check for finish signal
        if (patch.patch_object === 50 && patch.patch_value?.ext?.is_finish === '1') {
          done = true
        }
      }
    }

    // FULL_MSG_NOTIFY format: message.content[].content.text_block.text
    if (d.message?.content) {
      try {
        const blocks = typeof d.message.content === 'string' 
          ? JSON.parse(d.message.content) 
          : d.message.content
        for (const b of blocks) {
          if (b.block_type === 10000 && b.content?.text_block?.text) {
            // Only collect assistant messages (user_type 2 = assistant)
            if (d.message.user_type === 2 || d.message.user_type === '2') {
              text += b.content.text_block.text
            }
          }
        }
      } catch (e) { /* ignore */ }
    }

    return { text: text || undefined, images: images.length > 0 ? images : undefined, done }
  } catch {
    return { done: false }
  }
}

export async function dolaChatCompletion(
  provider: Provider,
  account: Account,
  request: ChatCompletionRequest,
  res: any
): Promise<void> {
  const { model, messages, stream } = request

  // Determine skill type from model
  const skillType = MODEL_SKILL_MAP[model] ?? 0

  // Get cookie from account
  const cookie = (account.credentials as any)?.token || (account.credentials as any)?.apiKey || ''
  if (!cookie) {
    throw new Error('Dola cookie not configured. Please set the cookie in account settings.')
  }

  // Get extra info from credentials
  let extraInfo: any = {}
  try {
    const raw = (account.credentials as any)?.extraInfo
    if (typeof raw === 'string') {
      extraInfo = JSON.parse(raw)
    } else if (typeof raw === 'object') {
      extraInfo = raw
    }
  } catch (e) { /* ignore */ }

  // Get msToken from account extra info
  const msToken = extraInfo.msToken || ''

  // Build the prompt - combine history for context
  const lastUserMsg = getLastUserMessage(messages)
  const context = buildContext(messages)

  // Use a conversation ID - we need to create or reuse one
  // For simplicity, we'll use a fixed conversation or create new ones
  const conversationId = extraInfo.conversationId || '38415797594164497'
  const botId = extraInfo.botId || '7339470689562525703'
  const deviceId = extraInfo.deviceId || '7626710695187121669'

  const messageId = generateId('dola-')
  const blockId = generateId('block-')
  const nowMs = Date.now()

  // Expert mode: need_deep_think = 3 (deep thinking), 0 = fast mode
  const isExpert = model === 'dola-expert'
  const thinkVal = isExpert ? 3 : 0

  // Build request body
  const requestBody = {
    client_meta: {
      local_conversation_id: `local_${Date.now() * 1000 % 1e16}`,
      conversation_id: conversationId,
      bot_id: botId,
      last_section_id: '',
      last_message_index: 0,
    },
    messages: [
      {
        local_message_id: messageId,
        content_block: [
          {
            block_type: 10000,
            content: {
              text_block: {
                text: context || lastUserMsg,
                icon_url: '',
                icon_url_dark: '',
                summary: '',
              },
              pc_event_block: '',
            },
            block_id: blockId,
            parent_id: '',
            meta_info: [],
            append_fields: [],
          },
        ],
        message_status: 0,
        input_skill: JSON.stringify({ skill_id: '0', skill_type: skillType }),
      },
    ],
    option: {
      send_message_scene: '',
      create_time_ms: nowMs,
      collect_id: '',
      is_audio: false,
      answer_with_suggest: false,
      tts_switch: false,
      need_deep_think: thinkVal,
      click_clear_context: false,
      from_suggest: false,
      is_regen: false,
      is_replace: false,
      is_from_click_option: false,
      is_from_click_softlink: false,
      disable_sse_cache: false,
      select_text_action: '',
      is_select_text: false,
      resend_for_regen: false,
      scene_type: 0,
      unique_key: generateId('key-'),
      start_seq: 0,
      need_create_conversation: false,
      regen_query_id: [],
      edit_query_id: [],
      regen_instruction: '',
      no_replace_for_regen: false,
      message_from: 0,
      shared_app_name: '',
      shared_app_id: '',
      sse_recv_event_options: { support_chunk_delta: true },
      is_ai_playground: false,
      is_old_user: false,
      recovery_option: {
        is_recovery: false,
        req_create_time_sec: Math.floor(nowMs / 1000),
        append_sse_event_scene: 0,
      },
      message_storage_type: 0,
    },
    user_context: [],
    ext: {
      use_deep_think: String(thinkVal),
      fp: '',
      sub_conv_firstmet_type: '1',
      collection_id: '',
      commerce_credit_config_enable: '0',
    },
  }

  // Build URL with query params
  const params = new URLSearchParams({
    aid: '495671',
    device_id: deviceId,
    device_platform: 'web',
    doubao_device_platform: 'web',
    doubao_pc_version: '3.27.5',
    language: 'zh',
    pc_version: '3.27.5',
    region: 'KR',
    samantha_web: '1',
    sys_region: 'KR',
    web_platform: 'browser',
    'use-olympus-account': '1',
  })

  if (msToken) {
    params.append('msToken', msToken)
  }

  const requestUrl = `${DOLA_API_BASE}/chat/completion?${params.toString()}`

  const headers = {
    ...FAKE_HEADERS,
    'Content-Type': 'application/json',
    Cookie: cookie,
  }

  try {
    const response: AxiosResponse = await axios.post(requestUrl, requestBody, {
      headers,
      responseType: 'stream',
      timeout: 120000,
    })

    if (stream) {
      // Streaming response
      res.setHeader('Content-Type', 'text/event-stream')
      res.setHeader('Cache-Control', 'no-cache')
      res.setHeader('Connection', 'keep-alive')

      const responseId = generateId('chatcmpl-')
      const created = Math.floor(Date.now() / 1000)
      let allText = ''
      const allImages: string[] = []
      let buffer = ''

      const stream2 = response.data as PassThrough

      stream2.on('data', (chunk: Buffer) => {
        buffer += chunk.toString()

        // Process complete SSE events (separated by \n\n)
        const events = buffer.split('\n\n')
        buffer = events.pop() || '' // Keep incomplete event in buffer

        for (const ev of events) {
          const lines = ev.split('\n')
          let eventType = ''
          let dataLine = ''

          for (const line of lines) {
            if (line.startsWith('event: ')) eventType = line.substring(7)
            if (line.startsWith('data: ')) dataLine = line.substring(6)
          }

          if (!dataLine || eventType === 'SSE_HEARTBEAT') continue

          const result = parseStreamChunk(dataLine)

          // Send text chunks
          if (result.text) {
            allText += result.text
            const sseData = {
              id: responseId,
              object: 'chat.completion.chunk',
              created,
              model,
              choices: [
                {
                  index: 0,
                  delta: { content: result.text },
                  finish_reason: null,
                },
              ],
            }
            res.write(`data: ${JSON.stringify(sseData)}\n\n`)
          }

          // Collect images
          if (result.images) {
            allImages.push(...result.images)
          }

          // Check for completion - only end on SSE_REPLY_END, not on is_finish in individual chunks
          if (eventType === 'SSE_REPLY_END') {
            // If we have images, send them as markdown
            if (allImages.length > 0 && stream) {
              const imageMarkdown = '\n\n' + allImages.map(url => `![image](${url})`).join('\n')
              const sseData = {
                id: responseId,
                object: 'chat.completion.chunk',
                created,
                model,
                choices: [
                  {
                    index: 0,
                    delta: { content: imageMarkdown },
                    finish_reason: null,
                  },
                ],
              }
              res.write(`data: ${JSON.stringify(sseData)}\n\n`)
            }

            const finalData = {
              id: responseId,
              object: 'chat.completion.chunk',
              created,
              model,
              choices: [
                {
                  index: 0,
                  delta: {},
                  finish_reason: 'stop',
                },
              ],
            }
            res.write(`data: ${JSON.stringify(finalData)}\n\n`)
            res.write('data: [DONE]\n\n')
            res.end()
            return
          }
        }
      })

      stream2.on('end', () => {
        // Process any remaining buffer
        if (buffer.trim()) {
          const lines = buffer.split('\n')
          let dataLine = ''
          for (const line of lines) {
            if (line.startsWith('data: ')) dataLine = line.substring(6)
          }
          if (dataLine) {
            const result = parseStreamChunk(dataLine)
            if (result.text) {
              const sseData = {
                id: generateId('chatcmpl-'),
                object: 'chat.completion.chunk',
                created: Math.floor(Date.now() / 1000),
                model,
                choices: [{ index: 0, delta: { content: result.text }, finish_reason: null }],
              }
              res.write(`data: ${JSON.stringify(sseData)}\n\n`)
            }
          }
        }

        // Send images if any
        if (allImages.length > 0) {
          const imageMarkdown = '\n\n' + allImages.map(url => `![image](${url})`).join('\n')
          const sseData = {
            id: generateId('chatcmpl-'),
            object: 'chat.completion.chunk',
            created: Math.floor(Date.now() / 1000),
            model,
            choices: [{ index: 0, delta: { content: imageMarkdown }, finish_reason: null }],
          }
          res.write(`data: ${JSON.stringify(sseData)}\n\n`)
        }

        const finalData = {
          id: generateId('chatcmpl-'),
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model,
          choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
        }
        res.write(`data: ${JSON.stringify(finalData)}\n\n`)
        res.write('data: [DONE]\n\n')
        res.end()
      })

      stream2.on('error', (err: Error) => {
        console.error('Dola stream error:', err)
        if (!res.writableEnded) {
          res.write(`data: ${JSON.stringify({ error: { message: err.message } })}\n\n`)
          res.end()
        }
      })
    } else {
      // Non-streaming response
      const rawText: string = await new Promise((resolve, reject) => {
        let data = ''
        const s = response.data as PassThrough
        s.on('data', (chunk: Buffer) => (data += chunk.toString()))
        s.on('end', () => resolve(data))
        s.on('error', reject)
      })

      const { text, images } = parseDolaSSE(rawText)

      // Build response
      let content = text
      if (images.length > 0) {
        content += '\n\n' + images.map(url => `![image](${url})`).join('\n')
      }

      const responseData = {
        id: generateId('chatcmpl-'),
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: Math.ceil((context || lastUserMsg).length / 4),
          completion_tokens: Math.ceil(content.length / 4),
          total_tokens: Math.ceil((context || lastUserMsg).length / 4) + Math.ceil(content.length / 4),
        },
      }

      res.json(responseData)
    }
  } catch (error: any) {
    console.error('Dola chat error:', error.message)
    if (error.response?.status === 401 || error.response?.status === 403) {
      throw new Error('Dola authentication failed. Cookie may have expired.')
    }
    throw error
  }
}

export const dolaSupportedModels = Object.keys(MODEL_SKILL_MAP)
