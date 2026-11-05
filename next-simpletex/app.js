/**
 * app.js - 公式图片转LaTeX页面交互逻辑
 * 依赖api.js中的ArkAPIClient类，使用KaTeX渲染LaTeX公式
 */
document.addEventListener('DOMContentLoaded', () => {
  // ==================== Cookie 工具函数====================
  // days 不传时使用极长有效期，即“不限日期”（浏览器可能会限制最大有效期）
  const COOKIE_EXPIRES_FOREVER = 'Fri, 31 Dec 9999 23:59:59 GMT';

  function setCookie(name, value, days) {
    let expires = COOKIE_EXPIRES_FOREVER;
    if (typeof days === 'number') {
      const date = new Date();
      date.setTime(date.getTime() + (days * 24 * 60 * 60 * 1000));
      expires = date.toUTCString();
    }
    document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/`;
  }

  function getCookie(name) {
    const cookieArr = document.cookie.split('; ');
    for (let cookie of cookieArr) {
      const [key, value] = cookie.split('=');
      if (key === name) {
        return decodeURIComponent(value);
      }
    }
    return null;
  }

  function removeCookie(name) {
    document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;`;
  }

  // ==================== 模型列表缓存 ====================
  const MODEL_LIST_COOKIE = 'ark_model_list';

  function getCachedModelList() {
    const raw = getCookie(MODEL_LIST_COOKIE);
    if (!raw) return [];

    try {
      const list = JSON.parse(raw);
      if (!Array.isArray(list)) return [];

      return list
        .filter(item => item && item.id)
        .map(item => ({
          id: String(item.id),
          name: item.name || String(item.id),
          version: item.version || ''
        }));
    } catch (e) {
      return [];
    }
  }

  function saveModelListToCookie(models) {
    const compact = models.map(model => ({
      id: model.id,
      name: model.name || model.id,
      version: model.version || ''
    }));
    const value = JSON.stringify(compact);

    // Cookie 单条通常限制 4KB，超限就不缓存
    if (encodeURIComponent(value).length > 3800) return;

    setCookie(MODEL_LIST_COOKIE, value);
  }

  // ==================== 默认配置项 ====================
  const DEFAULT_CONFIG = {
    apiKey: '',
    model: 'doubao-seed-2-1-pro-260915',
    maxTokens: 500,
    thinking: { type: "disabled" }
  };

  // ==================== 获取DOM元素 ====================
  const dom = {
    // 新增：模态窗相关DOM
    settingsBtn: document.getElementById('settingsBtn'),
    configModal: document.getElementById('configModal'),
    closeModalBtn: document.getElementById('closeModalBtn'),
    cancelConfigBtn: document.getElementById('cancelConfigBtn'),
    // 配置表单DOM（保持不变）
    apiKeyInput: document.getElementById('apiKeyInput'),
    modelSelect: document.getElementById('modelSelect'),
    refreshModelsBtn: document.getElementById('refreshModelsBtn'),
    maxTokensInput: document.getElementById('maxTokensInput'),
    thinkingSelect: document.getElementById('thinkingSelect'),
    saveConfigBtn: document.getElementById('saveConfigBtn'),
    // 原有DOM（保持不变）
    uploadArea: document.getElementById('uploadArea'),
    fileInput: document.getElementById('fileInput'),
    previewImg: document.getElementById('previewImg'),
    loading: document.getElementById('loading'),
    resultArea: document.getElementById('resultArea'),
    latexCode: document.getElementById('latexCode'),
    latexPreview: document.getElementById('latexPreview'),
    copyBtn: document.getElementById('copyBtn'),
    resetBtn: document.getElementById('resetBtn'),
    refreshRenderBtn: document.getElementById('refreshRenderBtn'),
    errorTip: document.getElementById('errorTip'),
    successTip: document.getElementById('successTip')
  };

  // ==================== 模态窗交互逻辑 ====================
  // 打开模态窗
  function openConfigModal() {
    dom.configModal.classList.add('active');
    // 打开时自动聚焦到API Key输入框（提升用户体验）
    dom.apiKeyInput.focus();
    // 禁止背景滚动
    document.body.style.overflow = 'hidden';
    // 优先读取 Cookie 缓存，没有缓存时才请求接口
    loadModelOptionsFromCacheOrApi();
  }

  // 关闭模态窗
  function closeConfigModal() {
    dom.configModal.classList.remove('active');
    // 恢复背景滚动
    document.body.style.overflow = '';
    // 清空提示
    hideAllTips();
  }

  // ==================== 初始化配置 ====================
  let currentConfig = { ...DEFAULT_CONFIG };
  let arkClient = null;
  let modelListRequestId = 0;

  // Ark 的 /models 接口没有开放浏览器 CORS 预检，默认通过自建 Cloudflare Worker 代理获取
  // Worker 源码见 ark-cors-proxy.worker.js
  const MODEL_LIST_PROXY = 'https://ark-cors-proxy.byc.de5.net/?';

  // 单次请求，失败后由用户点击“获取模型列表”手动重试
  async function requestModelList(client) {
    return client.listModels({ proxyBase: MODEL_LIST_PROXY });
  }

  // 渲染模型下拉框；models 为空时显示占位提示
  function renderModelOptions(models, placeholder, preferredModel) {
    const desired = preferredModel || dom.modelSelect.value || currentConfig.model || DEFAULT_CONFIG.model;
    const list = Array.isArray(models) ? models.slice() : [];

    if (list.length > 0 && desired && !list.some(model => model.id === desired)) {
      // 保留当前配置的模型，避免接口未返回该模型时配置丢失
      list.unshift({ id: desired, name: desired, version: '当前配置' });
    }

    dom.modelSelect.innerHTML = '';

    if (list.length === 0) {
      dom.modelSelect.appendChild(new Option(placeholder || '暂无可用模型', ''));
      dom.modelSelect.disabled = true;
      return;
    }

    list.forEach(model => {
      const label = model.version
        ? `${model.name || model.id}（${model.version}）`
        : (model.name || model.id);
      const option = new Option(label, model.id);
      option.title = model.id;
      dom.modelSelect.appendChild(option);
    });

    dom.modelSelect.disabled = false;
    dom.modelSelect.value = list.some(model => model.id === desired) ? desired : list[0].id;
  }

  // 有 Cookie 缓存时直接使用，返回是否命中缓存
  function loadModelOptionsFromCache() {
    const cachedModels = getCachedModelList();
    if (cachedModels.length > 0) {
      renderModelOptions(cachedModels, '暂无可用模型');
      return true;
    }
    return false;
  }

  function loadModelOptionsFromCacheOrApi() {
    if (loadModelOptionsFromCache()) return;
    loadModelOptions();
  }

  // 从 ARK API 拉取模型列表并按图片转文本场景过滤
  async function loadModelOptions() {
    const apiKey = (dom.apiKeyInput.value || '').trim();
    const requestId = ++modelListRequestId;
    const preferredModel = dom.modelSelect.value || currentConfig.model;

    if (!apiKey) {
      renderModelOptions([], '请先填写 API Key 后加载模型', preferredModel);
      return;
    }

    dom.modelSelect.disabled = true;
    dom.modelSelect.innerHTML = '';
    dom.modelSelect.appendChild(new Option('模型加载中…', ''));
    if (dom.refreshModelsBtn) dom.refreshModelsBtn.disabled = true;

    try {
      const client = new ArkAPIClient({ apiKey });
      const response = await requestModelList(client);
      if (requestId !== modelListRequestId) return;

      if (!response.success) {
        throw new Error(response.error?.message || '未知错误');
      }

      const models = ArkAPIClient.filterVisionModels(response.data?.data);
      // 成功获取后缓存到 Cookie，下次打开直接使用
      saveModelListToCookie(models);
      renderModelOptions(models, '没有找到支持图片输入的模型', preferredModel);
    } catch (error) {
      if (requestId !== modelListRequestId) return;

      // 加载失败时优先保留缓存的模型，其次保留当前配置模型
      const cachedModels = getCachedModelList();
      const fallback = cachedModels.length > 0
        ? cachedModels
        : (currentConfig.model
          ? [{ id: currentConfig.model, name: currentConfig.model, version: '当前配置' }]
          : []);
      renderModelOptions(fallback, `模型列表加载失败：${error.message}`, preferredModel);
      showErrorTip(`模型列表加载失败：${error.message}（可点击“获取模型列表”重试）`);
    } finally {
      if (requestId === modelListRequestId && dom.refreshModelsBtn) {
        dom.refreshModelsBtn.disabled = false;
      }
    }
  }

  function loadConfigFromCookie() {
    const savedConfig = getCookie('ark_latex_config');
    if (savedConfig) {
      try {
        const parsedConfig = JSON.parse(savedConfig);
        currentConfig = { ...DEFAULT_CONFIG, ...parsedConfig };
        
        // 填充到表单
        dom.apiKeyInput.value = currentConfig.apiKey || '';
        dom.maxTokensInput.value = currentConfig.maxTokens || DEFAULT_CONFIG.maxTokens;
        dom.thinkingSelect.value = currentConfig.thinking.type || 'disabled';
      } catch (e) {
        showErrorTip('配置解析失败，使用默认配置');
      }
    } else {
      // 无Cookie时填充默认值到表单
      dom.maxTokensInput.value = DEFAULT_CONFIG.maxTokens;
      dom.thinkingSelect.value = DEFAULT_CONFIG.thinking.type;
    }
    renderModelOptions(getCachedModelList(), '请先填写 API Key 后加载模型');
    // 初始化API客户端
    initArkClient();
  }

  function initArkClient() {
    try {
      if (arkClient) {
        arkClient = null; // 释放旧实例
      }
      arkClient = new ArkAPIClient(currentConfig);
    } catch (error) {
      showErrorTip(`API客户端初始化失败：${error.message}`);
    }
  }

  function saveConfigToCookie() {
    const newConfig = {
      apiKey: dom.apiKeyInput.value.trim(),
      model: dom.modelSelect.value,
      maxTokens: parseInt(dom.maxTokensInput.value) || DEFAULT_CONFIG.maxTokens,
      thinking: { type: dom.thinkingSelect.value }
    };

    // 验证API Key必填
    if (!newConfig.apiKey) {
      showErrorTip('API Key不能为空');
      return;
    }

    // 验证模型已选择
    if (!newConfig.model) {
      showErrorTip('请先选择模型（可点击“获取模型列表”重新加载）');
      return;
    }

    // 验证maxTokens为数字
    if (isNaN(newConfig.maxTokens) || newConfig.maxTokens < 100) {
      showErrorTip('最大Token数必须是≥100的数字');
      return;
    }

    // 保存到Cookie（不限日期）
    setCookie('ark_latex_config', JSON.stringify(newConfig));
    currentConfig = newConfig;
    
    // 重新初始化客户端
    initArkClient();
    showSuccessTip('配置保存成功！');
    // 保存成功后自动关闭模态窗
    setTimeout(() => {
      closeConfigModal();
      dom.successTip.style.display = 'none';
    }, 300);
  }

  // ==================== 初始化事件监听 ====================
  function initEventListeners() {
    // 新增：模态窗相关事件
    dom.settingsBtn.addEventListener('click', openConfigModal);
    dom.closeModalBtn.addEventListener('click', closeConfigModal);
    dom.cancelConfigBtn.addEventListener('click', closeConfigModal);
    // 点击模态窗遮罩层关闭
    dom.configModal.addEventListener('click', (e) => {
      if (e.target === dom.configModal) {
        closeConfigModal();
      }
    });
    // ESC键关闭模态窗
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && dom.configModal.classList.contains('active')) {
        closeConfigModal();
      }
    });

    // 保存配置按钮事件
    dom.saveConfigBtn.addEventListener('click', saveConfigToCookie);

    // 重新加载模型列表
    if (dom.refreshModelsBtn) {
      dom.refreshModelsBtn.addEventListener('click', loadModelOptions);
    }
    // 没有缓存时，填入 API Key 后自动加载一次；已有缓存则手动点“获取模型列表”
    dom.apiKeyInput.addEventListener('change', () => {
      if (getCachedModelList().length === 0) {
        loadModelOptions();
      }
    });

    // 事件监听
    dom.uploadArea.addEventListener('click', () => {
      dom.fileInput.click();
    });

    dom.fileInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (file) await handleImageFile(file);
    });

    document.addEventListener('paste', async (e) => {
      const items = (e.clipboardData || e.originalEvent.clipboardData).items;
      for (let item of items) {
        if (item.kind === 'file' && item.type.startsWith('image/')) {
          const file = item.getAsFile();
          await handleImageFile(file);
          break;
        }
      }
    });

    dom.copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(dom.latexCode.value);
        showSuccessTip('LaTeX代码已成功复制到剪贴板！');
        setTimeout(() => dom.successTip.style.display = 'none', 3000);
      } catch (error) {
        showErrorTip('复制失败：' + error.message);
      }
    });

    dom.resetBtn.addEventListener('click', resetPage);

    dom.refreshRenderBtn.addEventListener('click', () => {
      renderLatexWithKaTeX();
    });

    dom.latexCode.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.ctrlKey) {
        e.preventDefault();
        renderLatexWithKaTeX();
      }
    });
  }

  // ==================== 核心函数====================
  async function handleImageFile(file) {
    // 验证API Key是否配置
    if (!currentConfig.apiKey) {
      showErrorTip('请先点击侧边设置按钮配置并保存API Key！');
      return;
    }

    try {
      hideAllTips();
      dom.loading.style.display = 'block';
      dom.resultArea.style.display = 'none';

      dom.previewImg.src = URL.createObjectURL(file);
      dom.previewImg.style.display = 'block';

      const imageBase64 = await ArkAPIClient.fileToBase64(file);

      const prompt = `请精准识别图片中的所有数学公式，包括多行公式、分式、根式、矩阵、积分/求和符号等，将其转换为标准LaTeX代码。要求：
1. 仅输出LaTeX代码，无任何多余符号（如$$、\[ \]）；
2. 多行公式保持原有结构，使用aligned等环境时仅保留核心代码；
3. 确保符号、下标、上标、特殊字符（如希腊字母、箭头、运算符）完全匹配图片内容。`

      const response = await arkClient.chatWithImage({
        imageBase64,
        text: prompt,
        model: currentConfig.model,
        maxTokens: currentConfig.maxTokens,
        thinking: currentConfig.thinking
      });

      dom.loading.style.display = 'none';
      if (response.success) {
        const latexResult = response.data.choices[0]?.message?.content || '';
        if (latexResult) {
          dom.latexCode.value = latexResult;
          dom.resultArea.style.display = 'block';
          renderLatexWithKaTeX();
        } else {
          showErrorTip('未识别到公式，请上传清晰的公式图片重试');
        }
      } else {
        showErrorTip('API调用失败：' + response.error.message);
      }
    } catch (error) {
      dom.loading.style.display = 'none';
      showErrorTip('处理图片失败：' + error.message);
    }
  }

  function renderLatexWithKaTeX() {
    try {
      const latexCode = dom.latexCode.value.trim();
      if (!latexCode) {
        dom.latexPreview.innerHTML = '请输入有效的LaTeX公式代码';
        return;
      }

      dom.latexPreview.innerHTML = '';

      const katexOptions = {
        displayMode: true,
        throwOnError: false,
        errorColor: '#f5222d',
        strict: 'ignore',
        trust: true
      };

      let cleanCode = latexCode;
      cleanCode = cleanCode.replace(/^\$\$|\$\$$/g, '').replace(/^\\\(|\\\)$/g, '').replace(/^$|$$/g, '');

      katex.render(cleanCode, dom.latexPreview, katexOptions);

    } catch (error) {
      dom.latexPreview.innerHTML = `渲染异常：${error.message}<br>请检查LaTeX代码是否符合KaTeX语法规范`;
    }
  }

  function showErrorTip(message) {
    dom.errorTip.textContent = message;
    dom.errorTip.style.display = 'block';
  }

  function showSuccessTip(message) {
    dom.successTip.textContent = message;
    dom.successTip.style.display = 'block';
  }

  function hideAllTips() {
    dom.errorTip.style.display = 'none';
    dom.successTip.style.display = 'none';
  }

  function resetPage() {
    dom.fileInput.value = '';
    dom.previewImg.src = '';
    dom.previewImg.style.display = 'none';
    dom.resultArea.style.display = 'none';
    dom.latexCode.value = '';
    dom.latexPreview.innerHTML = '请编辑上方LaTeX代码，点击「刷新渲染」查看效果';
    hideAllTips();
  }

  // ==================== 检测API Key配置状态并自动打开模态窗 ====================
  function checkApiKeyConfig() {
    const savedConfig = getCookie('ark_latex_config');
    // 条件1：Cookie不存在  条件2：Cookie存在但apiKey为空/未配置
    if (!savedConfig || (savedConfig && JSON.parse(savedConfig).apiKey?.trim() === '')) {
      // 延迟打开（避免页面还没完全渲染就弹出，提升体验）
      setTimeout(() => {
        openConfigModal();
        // 显示提示信息，引导用户配置
        showErrorTip('请先配置API Key后再使用功能！');
      }, 300);
    }
  }


  // ==================== 初始化执行 ====================
  loadConfigFromCookie(); // 加载Cookie配置
  initEventListeners();   // 初始化事件
  checkApiKeyConfig();
});