import { createKimiExecutor } from './kimi.js';

const PROVIDERS = {
  kimi: { name: 'Kimi', endpoint: 'https://api.moonshot.cn/v1/chat/completions', models: ['kimi-k2.5'] },
  deepseek: { name: 'DeepSeek', endpoint: 'https://api.deepseek.com/chat/completions', models: ['deepseek-flash', 'deepseek-v4-pro'] }
};

export function createProviderRegistry({ kimiKey = process.env.MOONSHOT_API_KEY || '', deepseekKey = process.env.DEEPSEEK_API_KEY || '', fetchImpl = fetch } = {}) {
  const keys = { kimi: kimiKey, deepseek: deepseekKey };
  let selected = process.env.AI_PROVIDER === 'deepseek' || (!kimiKey && !!deepseekKey) ? 'deepseek' : 'kimi';
  let model = selected === 'deepseek' ? process.env.DEEPSEEK_MODEL || 'deepseek-flash' : process.env.MOONSHOT_MODEL || 'kimi-k2.5';
  if (!PROVIDERS[selected].models.includes(model)) model = PROVIDERS[selected].models[0];
  const status = () => ({ id: selected, name: PROVIDERS[selected].name, model, configured: !!keys[selected], providers: Object.entries(PROVIDERS).map(([id, value]) => ({ id, name: value.name, models: value.models, configured: !!keys[id] })) });
  return {
    status,
    configure({ provider = selected, model: requestedModel, key } = {}) {
      if (!PROVIDERS[provider]) throw new Error('不支持该模型服务');
      const nextModel = requestedModel || (provider === selected ? model : PROVIDERS[provider].models[0]);
      if (!PROVIDERS[provider].models.includes(nextModel)) throw new Error('不支持该模型');
      if (key !== undefined) {
        if (typeof key !== 'string' || key.length > 500) throw new Error('API 密钥格式无效');
        if (key.trim()) keys[provider] = key.trim();
      }
      selected = provider;
      model = nextModel;
      return status();
    },
    async execute(context) {
      const provider = context.run.provider?.id || selected;
      const chosenModel = context.run.provider?.model || model;
      const config = PROVIDERS[provider];
      if (!config || !config.models.includes(chosenModel)) throw new Error('该任务的模型配置不可用');
      const execute = createKimiExecutor({ key: keys[provider], model: chosenModel, endpoint: config.endpoint, providerName: config.name, fetchImpl });
      return execute(context);
    },
    async testConnection() {
      if (!keys[selected]) throw new Error(`请先输入 ${PROVIDERS[selected].name} API 密钥`);
      const config = PROVIDERS[selected];
      const response = await fetchImpl(config.endpoint, { method: 'POST', headers: { Authorization: `Bearer ${keys[selected]}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model, messages: [{ role: 'user', content: '请只回复 OK' }], max_tokens: 8 }), signal: AbortSignal.timeout(20000) });
      if (!response.ok) throw new Error(`${config.name} 连接失败（HTTP ${response.status}）`);
      const payload = await response.json();
      if (!payload.choices?.length) throw new Error(`${config.name} 未返回有效结果`);
      return { ok: true, name: config.name, model };
    }
  };
}
