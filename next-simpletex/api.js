/**
 * 火山方舟ARK API封装类
 */
class ArkAPIClient {
  /**
   * 初始化客户端
   * @param {Object} config 配置项
   * @param {string} config.apiKey ARK API Key
   * @param {string} [config.baseURL] API基础地址，默认：https://ark.cn-beijing.volces.com/api/v3
   * @param {string} [config.model] 默认使用的模型名，默认：doubao-seed-2-1-pro-260915
   * @param {number} [config.maxTokens] 默认最大生成token数，默认：300
   * @param {Object} [config.thinking] 默认深度思考配置，默认：{ type: "disabled" }
   */
  constructor(config) {
    if (!config?.apiKey) {
      throw new Error('ARK API Key 不能为空，请传入有效的apiKey');
    }

    // 基础配置
    this.config = {
      baseURL: config.baseURL || 'https://ark.cn-beijing.volces.com/api/v3',
      model: config.model || 'doubao-seed-2-1-pro-260915',
      maxTokens: config.maxTokens || 300,
      thinking: config.thinking || { type: "disabled" }, // 默认关闭深度思考
      apiKey: config.apiKey
    };

    // 通用请求头
    this.defaultHeaders = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.config.apiKey}`
    };
  }

  /**
   * 通用请求方法
   * @param {string} path 接口路径（如 /chat/completions）
   * @param {Object} options 请求选项（method、body等）
   * @returns {Promise<Object>} API响应结果
   */
  async _request(path, options = {}) {
    let timer = null;
    try {
      const url = options.url || `${this.config.baseURL}${path}`;
      const controller = options.timeout ? new AbortController() : null;
      if (controller) {
        timer = setTimeout(() => controller.abort(), options.timeout);
      }

      const response = await fetch(url, {
        method: options.method || 'POST',
        headers: { ...this.defaultHeaders, ...options.headers },
        body: options.body ? JSON.stringify(options.body) : null,
        signal: controller ? controller.signal : undefined
      });

      // 处理HTTP状态码错误
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API请求失败 [${response.status}]: ${errorText}`);
      }

      // 解析JSON响应
      const result = await response.json();
      return {
        success: true,
        data: result
      };
    } catch (error) {
      // 统一错误格式
      return {
        success: false,
        error: {
          message: error.message,
          stack: error.stack
        }
      };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /**
   * 获取当前 API Key 可用的模型列表
   * @param {Object} [options] 可选参数
   * @param {string} [options.proxyBase] CORS 代理前缀，如 https://proxy.corsfix.com/?
   * @returns {Promise<Object>} 响应结果，data.data 为模型数组
   */
  async listModels(options = {}) {
    const modelUrl = `${this.config.baseURL}/models`;
    const url = options.proxyBase ? `${options.proxyBase}${modelUrl}` : modelUrl;
    return this._request('', { method: 'GET', url, timeout: options.timeout || 10000 });
  }

  /**
   * 【工具函数】从模型列表中筛选出适合“图片转文本”场景的模型
   * 条件：支持 chat/completions、支持图片输入、输出文本、状态为 Published、支持关闭深度思考
   * @param {Array} models 模型数组
   * @returns {Array} 过滤后的模型数组
   */
  static filterVisionModels(models) {
    if (!Array.isArray(models)) return [];

    return models
      .filter(model => model?.api_supported?.['chat/completions'] === true)
      .filter(model => Array.isArray(model?.modalities?.input_modalities)
        && model.modalities.input_modalities.includes('image'))
      .filter(model => Array.isArray(model?.modalities?.output_modalities)
        && model.modalities.output_modalities.includes('text'))
      .filter(model => model.status === 'Published')
      .filter(model => Array.isArray(model?.features?.thinking?.types)
        && model.features.thinking.types.includes('disabled'))
      .sort((a, b) => (b.created || 0) - (a.created || 0));
  }

  /**
   * 图片+文本多模态对话请求
   * @param {Object} params 请求参数
   * @param {string} params.imageBase64 图片的Base64编码（不含data:image/png;base64,前缀）
   * @param {string} params.text 文本提问内容
   * @param {string} [params.model] 模型名，默认使用初始化时的配置
   * @param {number} [params.maxTokens] 最大生成token数，默认使用初始化时的配置
   * @param {Object} [params.thinking] 深度思考配置，默认使用初始化时的配置（如 { type: "disabled" }）
   * @returns {Promise<Object>} 响应结果
   */
  async chatWithImage(params) {
    if (!params?.imageBase64) {
      throw new Error('imageBase64 不能为空，请传入图片的Base64编码');
    }
    if (!params?.text) {
      throw new Error('text 不能为空，请传入提问的文本内容');
    }

    // 构造请求体
    const requestBody = {
      model: params.model || this.config.model,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: {
                url: `data:image/png;base64,${params.imageBase64}`
              }
            },
            {
              type: 'text',
              text: params.text
            }
          ]
        }
      ],
      max_tokens: params.maxTokens || this.config.maxTokens,
      thinking: params.thinking || this.config.thinking 
    };

    // 调用通用请求方法
    return this._request('/chat/completions', {
      method: 'POST',
      body: requestBody
    });
  }

  /**
   * 纯文本对话请求
   * @param {Object} params 请求参数
   * @param {string} params.text 文本提问内容
   * @param {string} [params.model] 模型名，默认使用初始化时的配置
   * @param {number} [params.maxTokens] 最大生成token数，默认使用初始化时的配置
   * @param {Object} [params.thinking] 深度思考配置，默认使用初始化时的配置（如 { type: "disabled" }）
   * @returns {Promise<Object>} 响应结果
   */
  async chatWithText(params) {
    if (!params?.text) {
      throw new Error('text 不能为空，请传入提问的文本内容');
    }

    // 构造请求体
    const requestBody = {
      model: params.model || this.config.model,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: params.text }
          ]
        }
      ],
      max_tokens: params.maxTokens || this.config.maxTokens,
      thinking: params.thinking || this.config.thinking 
    };

    return this._request('/chat/completions', {
      method: 'POST',
      body: requestBody
    });
  }

  /**
   * 【工具函数】将网页中的File对象（图片文件）转为Base64编码
   * @param {File} file 图片文件对象（如<input type="file">选择的文件）
   * @returns {Promise<string>} 图片的Base64编码（不含data:image/png;base64,前缀）
   */
  static fileToBase64(file) {
    return new Promise((resolve, reject) => {
      if (!file) {
        reject(new Error('未选择有效的图片文件'));
        return;
      }

      // 仅允许图片类型
      if (!file.type.startsWith('image/')) {
        reject(new Error('请选择图片文件（如PNG/JPG）'));
        return;
      }

      const reader = new FileReader();
      reader.onload = (e) => {
        // 去除Base64前缀（data:image/png;base64,）
        const base64Str = e.target.result.split(',')[1];
        resolve(base64Str);
      };
      reader.onerror = (error) => reject(error);
      reader.readAsDataURL(file);
    });
  }
}

// 暴露到全局
window.ArkAPIClient = ArkAPIClient;