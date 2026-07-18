import type { BuiltinProviderConfig } from '../../store/types'

export const qwenAiConfig: BuiltinProviderConfig = {
  id: 'qwen-ai',
  name: 'Qwen AI (International)',
  type: 'builtin',
  authType: 'jwt',
  apiEndpoint: 'https://chat.qwen.ai',
  chatPath: '/api/v2/chat/completions',
  headers: {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    source: 'web',
  },
  enabled: true,
  description: 'Qwen AI international version (chat.qwen.ai)',
  supportedModels: [
    // Qwen3.7 series
    'Qwen3.7-Plus',
    'Qwen3.7-Max',
    // Qwen3.6 series
    'Qwen3.6-Plus',
    'Qwen3.6-Max-Preview',
    'Qwen3.6-27B',
    'Qwen3.6-35B-A3B',
    // Existing models
    'Qwen3.5-Plus',
    'Qwen3.5-397B-A17B',
    'Qwen3-Max',
    'Qwen3-235B-A22B-2507',
    'Qwen3-Coder',
    'Qwen3-VL-235B-A22B',
    'Qwen3-Omni-Flash',
  ],
  modelMappings: {
    'Qwen3.7-Plus': 'qwen3.7-plus',
    'Qwen3.7-Max': 'qwen3.7-max',
    'Qwen3.6-Plus': 'qwen3.6-plus',
    'Qwen3.6-Max-Preview': 'qwen3.6-max-preview',
    'Qwen3.6-27B': 'qwen3.6-27b',
    'Qwen3.6-35B-A3B': 'qwen3.6-35b-a3b',
    'Qwen3.5-Plus': 'qwen3.5-plus',
    'Qwen3.5-397B-A17B': 'qwen3.5-397b-a17b',
    'Qwen3-Max': 'qwen3-max-2026-01-23',
    'Qwen3-235B-A22B-2507': 'qwen-plus-2025-07-28',
    'Qwen3-Coder': 'qwen3-coder-plus',
    'Qwen3-VL-235B-A22B': 'qwen3-vl-plus',
    'Qwen3-Omni-Flash': 'qwen3-omni-flash-2025-12-01',
  },
  credentialFields: [
    {
      name: 'token',
      label: 'Auth Token',
      type: 'password',
      required: true,
      placeholder: 'Enter JWT token from chat.qwen.ai',
      helpText: 'JWT token obtained from chat.qwen.ai Local Storage (key: "token")',
    },
    {
      name: 'cookies',
      label: 'Cookies (Optional)',
      type: 'textarea',
      required: false,
      placeholder: 'Optional cookies for enhanced compatibility',
      helpText: 'Full cookie string from browser DevTools (optional but recommended)',
    },
  ],
}

export default qwenAiConfig
