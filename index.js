/**
 * @fileoverview 思源笔记子文档拼接插件（优化版，使用 Protyle 临时渲染）
 * @description 将当前文档的子文档内容拼接显示在主文档下方，支持多层级递归
 * @author yifeng
 * @version 1.0.15
 * @license AGPL-3.0
 */

const { Plugin, showMessage, Setting, Protyle } = require("siyuan");

// ============================================================================
// 配置常量
// ============================================================================

/**
 * 插件全局配置常量
 * @constant {Object}
 * @property {string} STORAGE_NAME - 存储配置的键名
 * @property {number} MAXIMUM_NUMBER_OF_DOCUMENTS - 最大允许拼接的子文档数量上限
 * @property {number} MAX_DOCUMENT_HIERARCHY_LEVEL - 最大允许递归层级上限
 * @property {number} RENDER_DEBOUNCE_MS - 渲染稳定判断的防抖延迟（毫秒）
 * @property {number} RENDER_TIMEOUT_MS - 渲染最大等待超时（毫秒）
 * @property {number} CONCURRENCY_LIMIT - 并发渲染子文档的数量
 * @property {Object} FLOATING_EDIT_BUTTON - 浮动编辑按钮的边界限制
 * @property {Object} DEFAULT_CONFIG - 默认配置值
 * @property {Object} API - 思源笔记 API 路径
 * @property {Object} EVENTS - 事件总线事件名
 * @property {Object} SELECTORS - 需要监听滚动的容器选择器
 * @property {string} ICON - 开关按钮图标 SVG
 * @property {Object} CSS_CLASSES - 插件使用的 CSS 类名（无后缀基类）
 * @property {Object} ATTRIBUTES - 自定义数据属性名
 */
const CONFIG = {
  STORAGE_NAME: "config.json",
  MAXIMUM_NUMBER_OF_DOCUMENTS: 500,
  MAX_DOCUMENT_HIERARCHY_LEVEL: 5,
  RENDER_DEBOUNCE_MS: 100,
  RENDER_TIMEOUT_MS: 2000,
  CONCURRENCY_LIMIT: 5,

  FLOATING_EDIT_BUTTON: {
    TOP: { MIN: 105, MAX: 500 },
    BOTTOM: { MIN: 50, MAX: 300 },
  },

  DEFAULT_CONFIG: {
    maxDocumentHierarchyLevel: 3,
    maximumNumberOfDocuments: 10,
    floatingEditButtonTopDistance: 105,
    floatingEditButtonBottomDistance: 55,
    floatingEditButtonDirection: "right",
    showSubDocTitle: true,
    restoreOnStartup: false,
  },

  API: {
    GET_BLOCK_ATTRS: "/api/attr/getBlockAttrs",
    SET_BLOCK_ATTRS: "/api/attr/setBlockAttrs",
    GET_BLOCK_INFO: "/api/block/getBlockInfo",
    GET_DOC: "/api/filetree/getDoc",
    EXPORT_MD: "/api/export/exportMdContent",
    LIST_DOCS: "/api/filetree/listDocsByPath",
    QUERY_SQL: "/api/query/sql",
  },

  EVENTS: {
    PROTYLE_DYNAMIC: "loaded-protyle-dynamic",
    PROTYLE_STATIC: "loaded-protyle-static",
    UNLOAD_DOC: "unload-doc",
    WS_MAIN: "ws-main",
  },

  SELECTORS: {
    SCROLL_CONTAINERS: [
      ".fn__flex-1",
      ".protyle",
      ".layout__tab-content",
      ".fn__flex-column",
    ],
  },

  ICON: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-1 -1 34 34" width="256" height="256"><path d="M1.038 16c0-0.652 0.529-1.181 1.181-1.181v0h2.362c0.652 0 1.181 0.529 1.181 1.181s-0.529 1.181-1.181 1.181v0h-2.362c-0.652 0-1.181-0.529-1.181-1.181v0zM7.338 16c0-0.652 0.529-1.181 1.181-1.181v0h2.363c0.652 0 1.181 0.529 1.181 1.181s-0.529 1.181-1.181 1.181v0h-2.363c-0.652 0-1.181-0.529-1.181-1.181v0zM13.637 16c0-0.652 0.529-1.181 1.181-1.181v0h2.362c0.652 0 1.181 0.529 1.181 1.181s-0.529 1.181-1.181 1.181v0h-2.363c-0.652 0-1.181-0.529-1.181-1.181v0zM19.938 16c0-0.652 0.529-1.181 1.181-1.181v0h2.363c0.652 0 1.181 0.529 1.181 1.181s-0.529 1.181-1.181 1.181v0h-2.363c-0.652 0-1.181-0.529-1.181-1.181v0zM26.237 16c0-0.652 0.529-1.181 1.181-1.181v0h2.363c0.652 0 1.181 0.529 1.181 1.181s-0.529 1.181-1.181 1.181v0h-2.363c-0.652 0-1.181-0.529-1.181-1.181v0zM4.581 0.25c-0.652 0-1.181 0.529-1.181 1.181v0 6.694c0 1.74 1.41 3.15 3.15 3.15v0h18.9c1.74 0 3.15-1.41 3.15-3.15v0-6.694c0-0.652-0.529-1.181-1.181-1.181s-1.181 0.529-1.181 1.181v0 6.694c0 0.435-0.353 0.787-0.788 0.787v0h-18.9c-0.435 0-0.787-0.353-0.787-0.787v0-6.694c0-0.652-0.529-1.181-1.181-1.181v0zM27.419 31.75c0.652 0 1.181-0.529 1.181-1.181v0-6.694c0-1.74-1.41-3.15-3.15-3.15v0h-18.9c-1.74 0-3.15 1.41-3.15 3.15v0 6.694c0 0.652 0.529 1.181 1.181 1.181s1.181-0.529 1.181-1.181v0-6.694c0-0.435 0.353-0.788 0.787-0.788v0h18.9c0.435 0 0.788 0.353 0.788 0.788v0 6.694c0 0.652-0.529 1.181-1.181 1.181z" fill="currentColor"/></svg>',

  CSS_CLASSES: {
    CONTAINER: "concat-subdocs-container",
    SUBDOC_ITEM: "concat-subdoc-item",
    SUBDOC_CONTENT: "concat-subdoc-content",
    EDIT_LINK: "concat-edit-link",
    TOGGLE_BUTTON: "concat-toggle-button",
    TOGGLE_ENABLED: "concat-enabled",
    MAIN_DOC_EDITOR: "concat-maindoc-editor",
  },

  ATTRIBUTES: {
    CONCAT_STATE: "custom-concat",
    DOC_ID: "data-doc-id",
    SUBDOC_ID: "data-subdoc-id",
    NODE_ID: "data-node-id",
  },
};

// ============================================================================
// 工具函数
// ============================================================================

/**
 * 并发限制函数，控制同时执行的异步任务数量
 * @template T
 * @param {Array} items - 待处理的数据项数组
 * @param {Function} handler - 处理每个数据项的异步函数，接收一个参数 item
 * @param {number} concurrency - 最大并发数，默认 5
 * @returns {Promise<Array<T>>} 所有任务执行结果的数组
 */
async function pLimit(items, handler, concurrency = CONFIG.CONCURRENCY_LIMIT) {
  const results = [];
  const executing = new Set();

  for (const item of items) {
    const p = Promise.resolve().then(() => handler(item));
    results.push(p);

    const e = p.then(() => executing.delete(e));
    executing.add(e);

    if (executing.size >= concurrency) {
      await Promise.race(executing);
    }
  }

  return Promise.all(results);
}

/**
 * 防抖函数，延迟执行直到连续调用停止
 * @param {Function} func - 需要防抖的函数
 * @param {number} wait - 等待时间（毫秒）
 * @returns {Function} 防抖后的函数
 */
function debounce(func, wait) {
  let timeout;

  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };

    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

/**
 * 生成带有文档 ID 后缀的 CSS 类名，用于隔离不同文档的样式
 * @param {string} baseClass - 基础类名（来自 CONFIG.CSS_CLASSES）
 * @param {string} docId - 文档 ID
 * @returns {string} 带后缀的类名
 */
function getDocScopedClass(baseClass, docId) {
  return `${baseClass}--${docId}`;
}

// ============================================================================
// 服务类 - API 服务
// ============================================================================

/**
 * API 服务类，封装对思源笔记后端接口的调用
 */
class ApiService {
  /**
   * 通用 API 调用方法
   * @param {string} url - 接口路径（相对于思源服务地址）
   * @param {Object} data - 请求体数据
   * @returns {Promise<Object>} 接口返回的 data 字段
   * @throws {Error} 网络错误或业务错误
   */
  async callApi(url, data) {
    const response = await fetch(url, {
      method: "POST",
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const text = await response.text();
    if (!text) return null;

    try {
      const json = JSON.parse(text);
      if (json.code !== 0) {
        throw new Error(json.msg);
      }
      return json.data;
    } catch (e) {
      console.error("API 解析失败", url, e);
      throw e;
    }
  }

  /**
   * 获取块属性
   * @param {string} blockId - 块 ID
   * @returns {Promise<Object>} 属性对象
   */
  async getBlockAttrs(blockId) {
    return this.callApi(CONFIG.API.GET_BLOCK_ATTRS, { id: blockId });
  }

  /**
   * 设置块属性
   * @param {string} blockId - 块 ID
   * @param {Object} attrs - 要设置的属性键值对
   * @returns {Promise<Object>}
   */
  async setBlockAttrs(blockId, attrs) {
    return this.callApi(CONFIG.API.SET_BLOCK_ATTRS, { id: blockId, attrs });
  }

  /**
   * 获取块基本信息（所在笔记本、路径等）
   * @param {string} blockId - 块 ID
   * @returns {Promise<Object|null>}
   */
  async getBlockInfo(blockId) {
    try {
      return await this.callApi(CONFIG.API.GET_BLOCK_INFO, { id: blockId });
    } catch {
      return null;
    }
  }

  /**
   * 获取文档的完整数据（包含内容）
   * @param {string} docId - 文档块 ID
   * @returns {Promise<Object>}
   */
  async getDoc(docId) {
    return this.callApi(CONFIG.API.GET_DOC, { id: docId });
  }

  /**
   * 导出文档为 Markdown 格式
   * @param {string} docId - 文档块 ID
   * @returns {Promise<Object>} 包含 content 字段的 Markdown 内容
   */
  async exportMd(docId) {
    return this.callApi(CONFIG.API.EXPORT_MD, { id: docId });
  }

  /**
   * 列出指定路径下的文档（直接子文档）
   * @param {string} notebook - 笔记本 ID
   * @param {string} path - 父文档路径
   * @returns {Promise<Object>} 包含 files 数组的响应
   */
  async listDocs(notebook, path) {
    return this.callApi(CONFIG.API.LIST_DOCS, { notebook, path });
  }

  /**
   * 执行 SQL 查询
   * @param {string} stmt - SQL 语句
   * @returns {Promise<Array>} 查询结果数组
   */
  async querySql(stmt) {
    return this.callApi(CONFIG.API.QUERY_SQL, { stmt });
  }
}

// ============================================================================
// 服务类 - 块服务
// ============================================================================

/**
 * 块服务类，处理与文档块相关的属性读写和元素查找
 */
class BlockService {
  /**
   * @param {ApiService} apiService - API 服务实例
   */
  constructor(apiService) {
    this.api = apiService;
  }

  /**
   * 获取文档的拼接状态（是否启用拼接）
   * @param {string} docId - 文档块 ID
   * @returns {Promise<boolean>}
   */
  async getConcatState(docId) {
    try {
      const attrs = await this.api.getBlockAttrs(docId);
      return attrs[CONFIG.ATTRIBUTES.CONCAT_STATE] === "true";
    } catch {
      return false;
    }
  }

  /**
   * 设置文档的拼接状态
   * @param {string} docId - 文档块 ID
   * @param {boolean} state - true 启用拼接，false 禁用
   * @returns {Promise<void>}
   */
  async setConcatState(docId, state) {
    try {
      await this.api.setBlockAttrs(docId, {
        [CONFIG.ATTRIBUTES.CONCAT_STATE]: state ? "true" : "false",
      });
    } catch (e) {
      console.error(`设置文档 ${docId} 拼接状态失败`, e);
    }
  }

  /**
   * 从 Protyle 的 DOM 元素中提取当前文档的 ID
   * @param {Element} protyleElement - Protyle 的根元素
   * @returns {string|null}
   */
  getDocIdFromElement(protyleElement) {
    const rootBlock = protyleElement.querySelector(
      `[${CONFIG.ATTRIBUTES.NODE_ID}]`,
    );
    return rootBlock ? rootBlock.getAttribute(CONFIG.ATTRIBUTES.NODE_ID) : null;
  }
}

// ============================================================================
// 服务类 - 文档服务
// ============================================================================

/**
 * 文档服务类，负责获取子文档、渲染内容等
 */
class DocumentService {
  /**
   * @param {ApiService} apiService - API 服务实例
   * @param {Plugin} plugin - 插件主实例（用于获取 app）
   */
  constructor(apiService, plugin) {
    this.api = apiService;
    this.plugin = plugin;
  }

  /**
   * 获取指定文档的直接子文档（第一级）
   * 优先使用 listDocsByPath API，失败后降级为 SQL 查询
   * @param {string} parentDocId - 父文档 ID
   * @returns {Promise<Array<{id: string, name: string, path: string}>>}
   */
  async getSubDocs(parentDocId) {
    try {
      const parentDoc = await this.api.getBlockInfo(parentDocId);
      if (!parentDoc) return [];

      const data = await this.api.listDocs(parentDoc.box, parentDoc.path);

      if (data && data.files && Array.isArray(data.files)) {
        return data.files.map((file) => ({
          id: file.id,
          name: file.name.replace(/\.sy$/, ""),
          path: file.path,
        }));
      }
    } catch (e) {
      console.warn("listDocsByPath 失败，降级为 SQL 排序", e);
    }

    return this.getSubDocsBySql(parentDocId);
  }

  /**
   * 使用 SQL 查询获取直接子文档（备用方案）
   * @param {string} parentDocId - 父文档 ID
   * @returns {Promise<Array>}
   */
  async getSubDocsBySql(parentDocId) {
    try {
      const parentDoc = await this.api.getBlockInfo(parentDocId);
      if (!parentDoc) return [];

      const parentDir = parentDoc.path.replace(/\.sy$/, "");
      const escapedParentDir = parentDir.replace(/'/g, "''");

      const sql = `
        SELECT id, name, path
        FROM blocks
        WHERE path LIKE '${escapedParentDir}/%'
        AND type = 'd'
        AND path NOT LIKE '${escapedParentDir}/%/%'
        ORDER BY sort ASC
      `;

      const result = await this.api.querySql(sql);

      if (result && result.length > 0) {
        return result.map((row) => ({
          id: row.id,
          name: row.name || "",
          path: row.path,
        }));
      }
    } catch (e) {
      console.error("获取子文档失败", e);
    }

    return [];
  }

  /**
   * 递归获取指定文档的所有子文档（按层级限制）
   * @param {string} parentDocId - 父文档 ID
   * @param {number} currentLevel - 当前层级（内部递归用）
   * @param {number} maxDocumentHierarchyLevel - 最大允许层级
   * @returns {Promise<Array>} 所有符合条件的子文档数组
   */
  async getAllSubDocs(
    parentDocId,
    currentLevel = 1,
    maxDocumentHierarchyLevel = 1,
  ) {
    if (
      maxDocumentHierarchyLevel > 0 &&
      currentLevel > maxDocumentHierarchyLevel
    ) {
      return [];
    }

    const result = [];
    const directSubs = await this.getSubDocs(parentDocId);

    for (const sub of directSubs) {
      result.push(sub);
      const descendants = await this.getAllSubDocs(
        sub.id,
        currentLevel + 1,
        maxDocumentHierarchyLevel,
      );
      result.push(...descendants);
    }

    return result;
  }

  /**
   * 临时渲染子文档，返回渲染后的 HTML（渲染完成后 Protyle 被销毁）
   * @param {string} subDocId 子文档 ID
   * @returns {Promise<string>}
   */
  async renderSubDocHtml(subDocId) {
    return new Promise((resolve, reject) => {
      let resolved = false;
      let protyle = null;
      let observer = null;
      let debounceTimeoutId = null;
      let maxTimeoutId = null;

      // 创建隐藏挂载点（移出视口，不影响布局）
      const mountPoint = document.createElement("div");
      mountPoint.style.position = "absolute";
      mountPoint.style.left = "-9999px";
      mountPoint.style.top = "0";
      mountPoint.style.width = "1px";
      mountPoint.style.height = "1px";
      mountPoint.style.overflow = "hidden";
      document.body.appendChild(mountPoint);

      // 统一的清理与结束函数
      const finish = (html, isError = false) => {
        if (resolved) return;
        resolved = true;

        if (observer) observer.disconnect();
        clearTimeout(debounceTimeoutId);
        clearTimeout(maxTimeoutId);

        try {
          protyle?.destroy();
        } catch (e) {
          // 忽略销毁错误
        }
        mountPoint.remove();

        if (isError) {
          reject(html); // 此处 html 实际为 error 对象
        } else {
          resolve(html);
        }
      };

      try {
        // 创建 Protyle 实例（只读模式，根据配置决定是否显示内置标题）
        protyle = new Protyle(this.plugin.app, mountPoint, {
          blockId: subDocId,
          rootId: subDocId,
          mode: "wysiwyg",
          title: this.plugin.config.showSubDocTitle || false,
          editor: {
            readonly: true,
          },
          typewriterMode: false,
          autoFocus: false,
          render: {
            background: false,
            title: this.plugin.config.showSubDocTitle || false,
            titleShowTop: false,
            hideTitleOnZoom: false,
            gutter: false,
            scroll: false,
            breadcrumb: false,
            breadcrumbDocName: false,
          },
        });
      } catch (e) {
        finish(e, true);
        return;
      }

      // 使用 MutationObserver 检测渲染稳定（监听子节点变化）
      observer = new MutationObserver(() => {
        clearTimeout(debounceTimeoutId);
        debounceTimeoutId = setTimeout(() => {
          const html = mountPoint.innerHTML;
          finish(html);
        }, CONFIG.RENDER_DEBOUNCE_MS);
      });

      observer.observe(mountPoint, {
        childList: true,
        subtree: true,
      });

      // 设置最大超时，防止无限等待
      maxTimeoutId = setTimeout(() => {
        const html = mountPoint.innerHTML;
        finish(html);
      }, CONFIG.RENDER_TIMEOUT_MS);
    });
  }

  /**
   * 在新标签页中打开指定文档（思源内部链接）
   * @param {string} docId - 文档 ID
   */
  openDocument(docId) {
    window.open(`siyuan://blocks/${docId}`, "_blank");
  }
}

// ============================================================================
// 服务类 - 状态服务
// ============================================================================

/**
 * 状态服务类，处理批量清除拼接状态等全局操作
 */
class StateService {
  /**
   * @param {Plugin} plugin - 插件主实例
   * @param {BlockService} blockService - 块服务实例
   */
  constructor(plugin, blockService) {
    this.plugin = plugin;
    this.blockService = blockService;
  }

  /**
   * 清除所有文档的拼接状态（即关闭所有已启用的拼接）
   * @returns {Promise<void>}
   */
  async clearAllConcatStates() {
    try {
      const sql = `SELECT id FROM blocks WHERE type = 'd' AND ial LIKE '%${CONFIG.ATTRIBUTES.CONCAT_STATE}=%'`;
      const result = await this.plugin.callApi(CONFIG.API.QUERY_SQL, {
        stmt: sql,
      });

      if (!result || !Array.isArray(result) || result.length === 0) {
        showMessage(this.plugin.i18n.noDocFound, 3000, "info");
        return;
      }

      const docIds = result.map((row) => row.id);
      let processed = 0;

      await pLimit(
        docIds,
        async (id) => {
          try {
            await this.blockService.setConcatState(id, false);
            processed++;
          } catch (e) {
            console.error(`设置文档 ${id} 属性失败`, e);
          }
        },
        10,
      );
      if (processed > 0) {
        showMessage(
          this.plugin.i18n.clearSuccess.replace(/\{count\}/g, processed),
          2000,
        );
      }
    } catch (e) {
      console.error("清除拼接状态失败", e);
      showMessage(this.plugin.i18n.clearFail, 5000, "error");
    }
  }
}

// ============================================================================
// 服务类 - UI 组件服务
// ============================================================================

/**
 * UI 组件服务类，负责创建和操作 DOM 元素
 */
class ComponentService {
  /**
   * @param {Plugin} plugin - 插件主实例
   */
  constructor(plugin) {
    this.plugin = plugin;
  }

  /**
   * 创建用于包裹所有子文档的外部容器
   * @param {string} docId - 当前主文档 ID
   * @param {HTMLElement} editorElement - 主文档编辑器元素（.protyle-wysiwyg）
   * @returns {HTMLDivElement}
   */
  createConcatContainer(docId, editorElement) {
    const containerClass = getDocScopedClass(
      CONFIG.CSS_CLASSES.CONTAINER,
      docId,
    );
    const container = document.createElement("div");
    container.className = `${CONFIG.CSS_CLASSES.CONTAINER} ${containerClass}`;
    container.setAttribute(CONFIG.ATTRIBUTES.DOC_ID, docId);
    container.contentEditable = "false";
    container.style.cssText = editorElement.style.cssText;

    const mainDocEditorClass = getDocScopedClass(
      CONFIG.CSS_CLASSES.MAIN_DOC_EDITOR,
      docId,
    );
    const style = document.createElement("style");
    style.textContent = `
      .${mainDocEditorClass}:has(+ .${containerClass}),
      .${CONFIG.CSS_CLASSES.CONTAINER} .${CONFIG.CSS_CLASSES.CONTAINER} {
        padding-bottom: ${editorElement.style.paddingTop || "0px"}!important;
      }
      .${containerClass} { 
        padding: 0 0 ${editorElement.style.paddingBottom}!important;
      }
    `;
    container.appendChild(style);

    return container;
  }

  /**
   * 创建单个子文档的展示容器（包含内容和编辑链接）
   * @param {Object} subDoc - 子文档对象，包含 id, name
   * @param {HTMLElement} editorElement - 主文档编辑器元素（用于继承样式）
   * @returns {HTMLDivElement}
   */
  createSubDocContainer(subDoc, editorElement) {
    const subDocContainer = document.createElement("div");
    subDocContainer.classList.add(
      "protyle-wysiwyg",
      CONFIG.CSS_CLASSES.SUBDOC_ITEM,
      "protyle-custom",
    );
    subDocContainer.setAttribute(CONFIG.ATTRIBUTES.SUBDOC_ID, subDoc.id);
    subDocContainer.style.cssText = editorElement.style.cssText;
    subDocContainer.style.paddingBottom = editorElement.style.paddingTop;

    this.appendContentSection(subDocContainer, editorElement);
    this.appendEditLink(subDocContainer, subDoc);

    return subDocContainer;
  }

  /**
   * 添加内容区域（初始为空，后续填充 HTML）
   * @param {HTMLElement} container - 子文档容器
   * @param {HTMLElement} editorElement - 主文档编辑器元素
   * @private
   */
  appendContentSection(container, editorElement) {
    const contentDiv = document.createElement("div");
    contentDiv.className = `${CONFIG.CSS_CLASSES.SUBDOC_CONTENT} protyle-wysiwyg protyle-wysiwyg--attr`;
    contentDiv.contentEditable = "false";
    container.appendChild(contentDiv);
  }

  /**
   * 添加编辑链接（跳转到子文档）
   * @param {HTMLElement} container - 子文档容器
   * @param {Object} subDoc - 子文档对象
   * @private
   */
  appendEditLink(container, subDoc) {
    const editLink = document.createElement("span");
    editLink.className = CONFIG.CSS_CLASSES.EDIT_LINK;
    editLink.setAttribute("data-type", "block-ref");
    editLink.setAttribute("data-id", subDoc.id);
    editLink.title = this.plugin.i18n.editLinkTitle;
    editLink.innerHTML =
      '<svg class="icon"><use xlink:href="#iconEdit"></use></svg>';

    container.appendChild(editLink);
  }

  /**
   * 递归设置元素及其所有子元素为不可编辑（contentEditable = false）
   * @param {HTMLElement} element - 目标元素
   * @param {string} value - 要设置的值，默认为 "false"
   */
  setContentEditable(element, value = "false") {
    const allElements = element.querySelectorAll("*");
    allElements.forEach((el) => {
      el.contentEditable = value;
    });
  }

  /**
   * 在文档标题栏创建/更新拼接开关按钮
   * @param {Object} protyle - Protyle 实例
   * @param {boolean} enabled - 当前是否启用拼接
   * @param {string} docId - 当前文档 ID
   */
  createToggleButton(protyle, enabled, docId) {
    if (!protyle?.breadcrumb?.element) {
      return;
    }
    const breadcrumbBar = protyle.breadcrumb.element;
    const breadcrumbSpace = breadcrumbBar.nextElementSibling;

    if (
      breadcrumbSpace &&
      breadcrumbSpace.matches(".protyle-breadcrumb__space")
    ) {
      this.removeExistingButton(breadcrumbSpace);

      const toggleButton = document.createElement("button");
      toggleButton.innerHTML = CONFIG.ICON;
      toggleButton.className = `block__icon fn__flex-center ariaLabel ${CONFIG.CSS_CLASSES.TOGGLE_BUTTON} ${enabled ? CONFIG.CSS_CLASSES.TOGGLE_ENABLED : ""}`;
      toggleButton.ariaLabel = this.plugin.i18n.toggleTitle;

      toggleButton.onclick = async () => {
        await this.plugin.toggleConcatForCurrentDoc(toggleButton, docId);
        const newEnabled = await this.plugin.blockService.getConcatState(docId);
        toggleButton.classList.toggle(
          CONFIG.CSS_CLASSES.TOGGLE_ENABLED,
          newEnabled,
        );
      };

      breadcrumbSpace.insertAdjacentElement("afterend", toggleButton);
    }
  }

  /**
   * 移除已存在的开关按钮
   * @param {HTMLElement} breadcrumbSpace - 面包屑后面的空白元素
   * @private
   */
  removeExistingButton(breadcrumbSpace) {
    const existing = breadcrumbSpace.nextElementSibling;
    if (existing && existing.matches(`.${CONFIG.CSS_CLASSES.TOGGLE_BUTTON}`)) {
      existing.remove();
    }
  }

  /**
   * 移除所有已插入的拼接容器并清空映射
   * @param {Map} concatContainers - 文档 ID 到容器数据的映射
   * @param {Map} subdocElements - 子文档 ID 到 DOM 元素的映射
   */
  removeAllContainers(concatContainers, subdocElements) {
    for (const docId of concatContainers.keys()) {
      const data = concatContainers.get(docId);
      data.container?.parentNode?.removeChild(data.container);
      concatContainers.delete(docId);
    }
    // 清空所有子文档元素映射
    for (const containers of subdocElements.values()) {
      containers.forEach((container) => container?.remove());
    }
    subdocElements.clear();
  }
}

// ============================================================================
// 服务类 - 位置服务
// ============================================================================

/**
 * 位置服务类，负责计算并更新子文档右侧浮动编辑按钮的位置
 */
class PositionService {
  /**
   * @param {Plugin} plugin - 插件主实例
   */
  constructor(plugin) {
    this.plugin = plugin;
  }

  /**
   * 更新所有可见子文档的浮动编辑按钮位置（由滚动、窗口大小改变等触发）
   */
  updatePositions() {
    const viewportHeight = window.innerHeight;
    const topSafe = this.plugin.config.floatingEditButtonTopDistance;
    const bottomSafe = this.plugin.config.floatingEditButtonBottomDistance;
    const leftDir = this.plugin.config.floatingEditButtonDirection === "left";
    const safePadding = 1;
    const verticalMargin = 14;

    const containers = document.querySelectorAll(
      `.${CONFIG.CSS_CLASSES.SUBDOC_ITEM}`,
    );

    containers.forEach((container) => {
      const editLink = container.querySelector(
        `.${CONFIG.CSS_CLASSES.EDIT_LINK}`,
      );
      if (!editLink) return;

      const protyle = container.closest(".protyle");
      if (!protyle) return;

      this.updateSinglePosition(
        container,
        editLink,
        protyle,
        viewportHeight,
        topSafe,
        bottomSafe,
        leftDir,
        safePadding,
        verticalMargin,
      );
    });
  }

  /**
   * 更新单个编辑按钮的位置
   * @param {HTMLElement} container - 子文档容器
   * @param {HTMLElement} editLink - 编辑链接元素
   * @param {HTMLElement} protyle - 父级 Protyle 容器
   * @param {number} viewportHeight - 视口高度
   * @param {number} topSafe - 顶部安全距离
   * @param {number} bottomSafe - 底部安全距离
   * @param {boolean} leftDir - 是否优先靠左显示
   * @param {number} safePadding - 额外内边距
   * @param {number} verticalMargin - 垂直方向边距
   * @private
   */
  updateSinglePosition(
    container,
    editLink,
    protyle,
    viewportHeight,
    topSafe,
    bottomSafe,
    leftDir,
    safePadding,
    verticalMargin,
  ) {
    const protyleRect = protyle.getBoundingClientRect();
    let visualTop = protyleRect.top;

    const breadcrumb = protyle.querySelector(".protyle-breadcrumb");
    if (breadcrumb) {
      const breadcrumbRect = breadcrumb.getBoundingClientRect();
      visualTop = Math.max(visualTop, breadcrumbRect.bottom);
    }

    const effectiveTop = Math.max(visualTop, topSafe) + safePadding;
    const protyleContentBottom = protyleRect.top + protyle.clientHeight;
    const effectiveBottom =
      Math.min(protyleContentBottom, viewportHeight - bottomSafe) - safePadding;

    if (effectiveTop >= effectiveBottom) return;

    const editLinkRect = editLink.getBoundingClientRect();
    const editLinkWidth = editLinkRect.width;
    const editLinkHeight = editLinkRect.height;

    const containerRect = container.getBoundingClientRect();
    const containerTop = containerRect.top;
    const containerHeight = containerRect.height;
    const containerBottom = containerRect.bottom;

    this.setHorizontalPosition(editLink, container, editLinkWidth, leftDir);
    this.setVerticalPosition(
      editLink,
      container,
      containerTop,
      containerBottom,
      containerHeight,
      effectiveTop,
      effectiveBottom,
      editLinkHeight,
      viewportHeight,
      verticalMargin,
      topSafe,
    );
  }

  /**
   * 设置按钮的水平位置（根据配置向左或向右浮动）
   * @param {HTMLElement} editLink - 编辑链接元素
   * @param {HTMLElement} container - 子文档容器
   * @param {number} editLinkWidth - 编辑链接宽度
   * @param {boolean} leftDir - 是否优先靠左
   * @private
   */
  setHorizontalPosition(editLink, container, editLinkWidth, leftDir) {
    const containerPaddingLeft = parseInt(container.style.paddingLeft) || 0;
    const containerPaddingRight = parseInt(container.style.paddingRight) || 0;

    if (leftDir && containerPaddingLeft > 1.2 * editLinkWidth) {
      editLink.style.right = "auto";
      editLink.style.left = `${containerPaddingLeft - 1.2 * editLinkWidth}px`;
    } else if (!leftDir && containerPaddingRight > 1.2 * editLinkWidth) {
      editLink.style.left = "auto";
      editLink.style.right = `${containerPaddingRight - 1.2 * editLinkWidth}px`;
    } else {
      editLink.style.left = `${containerPaddingLeft}px`;
      editLink.style.right = "auto";
    }
  }

  /**
   * 设置按钮的垂直位置（考虑可见区域自动调整）
   * @param {HTMLElement} editLink - 编辑链接元素
   * @param {HTMLElement} container - 子文档容器
   * @param {number} containerTop - 容器顶部位置（相对于视口）
   * @param {number} containerBottom - 容器底部位置
   * @param {number} containerHeight - 容器高度
   * @param {number} effectiveTop - 有效可视区域顶部（绝对）
   * @param {number} effectiveBottom - 有效可视区域底部（绝对）
   * @param {number} editLinkHeight - 编辑链接高度
   * @param {number} viewportHeight - 视口高度
   * @param {number} verticalMargin - 垂直边距
   * @param {number} topSafe - 顶部安全距离（fallback）
   * @private
   */
  setVerticalPosition(
    editLink,
    container,
    containerTop,
    containerBottom,
    containerHeight,
    effectiveTop,
    effectiveBottom,
    editLinkHeight,
    viewportHeight,
    verticalMargin,
    topSafe,
  ) {
    if (containerBottom < effectiveTop || containerTop > effectiveBottom) {
      editLink.style.transform = `translateY(${topSafe}px)`;
      return;
    }

    const visibleTopInContainer = Math.max(0, effectiveTop - containerTop);
    const visibleBottomInContainer = Math.min(
      containerHeight,
      effectiveBottom - containerTop,
    );

    let minTop = visibleTopInContainer + verticalMargin;
    let maxTop = visibleBottomInContainer - editLinkHeight - verticalMargin;

    if (minTop > maxTop) {
      minTop = visibleTopInContainer;
      maxTop = visibleBottomInContainer - editLinkHeight;
    }

    minTop = Math.max(0, Math.min(minTop, containerHeight - editLinkHeight));
    maxTop = Math.max(0, Math.min(maxTop, containerHeight - editLinkHeight));

    if (minTop > maxTop) {
      editLink.style.transform = `translateY(${topSafe}px)`;
      return;
    }

    const preferTop = this.shouldPreferTop(
      containerTop,
      containerBottom,
      viewportHeight,
    );
    let finalTop = preferTop ? minTop : maxTop;
    finalTop = Math.max(minTop, Math.min(maxTop, finalTop));

    editLink.style.transform = `translateY(${finalTop}px)`;
  }

  /**
   * 判断按钮应优先靠近顶部还是底部
   * @param {number} containerTop - 容器顶部位置
   * @param {number} containerBottom - 容器底部位置
   * @param {number} viewportHeight - 视口高度
   * @returns {boolean} true 表示优先顶部，false 表示优先底部
   * @private
   */
  shouldPreferTop(containerTop, containerBottom, viewportHeight) {
    const viewportCenterY = viewportHeight / 2;

    if (containerTop < 0 && containerBottom > viewportHeight) {
      return false;
    } else if (containerBottom < viewportCenterY) {
      return true;
    } else if (containerTop > viewportCenterY) {
      return false;
    } else {
      const distTop = viewportCenterY - containerTop;
      const distBottom = containerBottom - viewportCenterY;
      return distTop > distBottom;
    }
  }
}

// ============================================================================
// 服务类 - 设置面板服务
// ============================================================================

/**
 * 设置面板服务类，负责构建插件的设置界面
 */
class SettingsService {
  /**
   * @param {Plugin} plugin - 插件主实例
   */
  constructor(plugin) {
    this.plugin = plugin;
  }

  /**
   * 初始化设置面板
   */
  init() {
    this.plugin.setting = new Setting({
      confirmCallback: async () => await this.plugin.saveConfig(),
      destroyCallback: async () => await this.plugin.loadConfig(),
    });

    this.addSettingItems();
  }

  /**
   * 添加所有设置项
   * @private
   */
  addSettingItems() {
    this.plugin.setting.addItem(this.createMaxLevelSetting());
    this.plugin.setting.addItem(this.createMaxCountSetting());
    this.plugin.setting.addItem(this.createFloatingTopDistanceSetting());
    this.plugin.setting.addItem(this.createFloatingBottomDistanceSetting());
    this.plugin.setting.addItem(this.createShowSubDocTitleSetting());
    this.plugin.setting.addItem(
      this.createFloatingEditButtonOnLeftSideOfDocumentSetting(),
    );
    this.plugin.setting.addItem(this.createRestoreOnStartupSetting());
  }

  /**
   * 创建最大层级设置项
   * @returns {Object} 设置项定义
   * @private
   */
  createMaxLevelSetting() {
    return this.createNumberInputSetting(
      this.plugin.i18n.maxDocumentHierarchyLevelTitle,
      this.plugin.i18n.maxDocumentHierarchyLevelDesc.replace(
        /\{maxDocumentHierarchyLevel\}/g,
        CONFIG.MAX_DOCUMENT_HIERARCHY_LEVEL,
      ),
      "maxDocumentHierarchyLevel",
      1,
      CONFIG.MAX_DOCUMENT_HIERARCHY_LEVEL,
      1,
    );
  }

  /**
   * 创建最大文档数量设置项
   * @returns {Object} 设置项定义
   * @private
   */
  createMaxCountSetting() {
    return this.createNumberInputSetting(
      this.plugin.i18n.maximumNumberOfDocumentsTitle,
      this.plugin.i18n.maximumNumberOfDocumentsDesc.replace(
        /\{maximumNumberOfDocuments\}/g,
        CONFIG.MAXIMUM_NUMBER_OF_DOCUMENTS,
      ),
      "maximumNumberOfDocuments",
      10,
      CONFIG.MAXIMUM_NUMBER_OF_DOCUMENTS,
      5,
    );
  }

  /**
   * 创建顶部安全距离设置项
   * @returns {Object} 设置项定义
   * @private
   */
  createFloatingTopDistanceSetting() {
    return this.createNumberInputSetting(
      this.plugin.i18n.floatingEditButtonTopDistanceTitle,
      this.plugin.i18n.floatingEditButtonTopDistanceDesc
        .replace(/\{minDistance\}/g, CONFIG.FLOATING_EDIT_BUTTON.TOP.MIN)
        .replace(/\{maxDistance\}/g, CONFIG.FLOATING_EDIT_BUTTON.TOP.MAX),
      "floatingEditButtonTopDistance",
      CONFIG.FLOATING_EDIT_BUTTON.TOP.MIN,
      CONFIG.FLOATING_EDIT_BUTTON.TOP.MAX,
      1,
    );
  }

  /**
   * 创建底部安全距离设置项
   * @returns {Object} 设置项定义
   * @private
   */
  createFloatingBottomDistanceSetting() {
    return this.createNumberInputSetting(
      this.plugin.i18n.floatingEditButtonBottomDistanceTitle,
      this.plugin.i18n.floatingEditButtonBottomDistanceDesc
        .replace(/\{minDistance\}/g, CONFIG.FLOATING_EDIT_BUTTON.BOTTOM.MIN)
        .replace(/\{maxDistance\}/g, CONFIG.FLOATING_EDIT_BUTTON.BOTTOM.MAX),
      "floatingEditButtonBottomDistance",
      CONFIG.FLOATING_EDIT_BUTTON.BOTTOM.MIN,
      CONFIG.FLOATING_EDIT_BUTTON.BOTTOM.MAX,
      1,
    );
  }

  /**
   * 创建显示子文档标题设置项
   * @returns {Object} 设置项定义
   * @private
   */
  createShowSubDocTitleSetting() {
    return {
      title: this.plugin.i18n.showSubDocTitleTitle,
      description: this.plugin.i18n.showSubDocTitleDesc,
      direction: "row",
      createActionElement: () => {
        const container = document.createElement("div");
        const input = document.createElement("input");
        input.type = "checkbox";
        input.className = "b3-switch";
        input.checked = this.plugin.config.showSubDocTitle;
        input.addEventListener("change", () => {
          if (!this.plugin.unSavedConfig) {
            this.plugin.unSavedConfig = { ...this.plugin.config };
          }
          this.plugin.unSavedConfig.showSubDocTitle = input.checked;
        });
        container.appendChild(input);
        return container;
      },
    };
  }

  /**
   * 创建浮动按钮方向设置项（左右选择）
   * @returns {Object} 设置项定义
   * @private
   */
  createFloatingEditButtonOnLeftSideOfDocumentSetting() {
    return {
      title: this.plugin.i18n.floatingEditButtonOnLeftSideOfDocumentTitle,
      description: this.plugin.i18n.floatingEditButtonOnLeftSideOfDocumentDesc,
      direction: "row",
      createActionElement: () => {
        const container = document.createElement("div");
        const input = document.createElement("input");
        input.type = "checkbox";
        input.className = "b3-switch";
        input.checked =
          this.plugin.config.floatingEditButtonOnLeftSideOfDocument || false;
        input.addEventListener("change", () => {
          if (!this.plugin.unSavedConfig) {
            this.plugin.unSavedConfig = { ...this.plugin.config };
          }
          this.plugin.unSavedConfig.floatingEditButtonOnLeftSideOfDocument =
            input.checked;
        });
        container.appendChild(input);
        return container;
      },
    };
  }
  /**
   * 启动时是否恢复文档拼接状态
   * @returns {Object} 设置项定义
   * @private
   */
  createRestoreOnStartupSetting() {
    return {
      title: this.plugin.i18n.restoreOnStartupTitle,
      description: this.plugin.i18n.restoreOnStartupDesc,
      direction: "row",
      createActionElement: () => {
        const container = document.createElement("div");
        const input = document.createElement("input");
        input.type = "checkbox";
        input.className = "b3-switch";
        input.checked = this.plugin.config.restoreOnStartup || false;
        input.addEventListener("change", () => {
          if (!this.plugin.unSavedConfig) {
            this.plugin.unSavedConfig = { ...this.plugin.config };
          }
          this.plugin.unSavedConfig.restoreOnStartup = input.checked;
        });
        container.appendChild(input);
        return container;
      },
    };
  }

  /**
   * 辅助方法：创建数字输入框设置项
   * @param {string} title - 标题
   * @param {string} description - 描述
   * @param {string} configKey - 配置键名
   * @param {number} min - 最小值
   * @param {number} max - 最大值
   * @param {number} step - 步长
   * @returns {Object} 设置项定义
   * @private
   */
  createNumberInputSetting(title, description, configKey, min, max, step) {
    return {
      title,
      description,
      direction: "row",
      createActionElement: () => {
        const input = document.createElement("input");
        input.type = "number";
        input.className = "b3-text-field";
        input.style.width = "100px";
        input.value = this.plugin.config[configKey];
        input.min = min;
        input.max = max;
        input.step = step;

        input.addEventListener("change", () => {
          const val = parseInt(input.value, 10);
          if (isNaN(val) || val < min) {
            input.value = this.plugin.config[configKey];
            return;
          }
          if (!this.plugin.unSavedConfig) {
            this.plugin.unSavedConfig = { ...this.plugin.config };
          }
          this.plugin.unSavedConfig[configKey] = Math.min(val, max);
          input.value = this.plugin.unSavedConfig[configKey];
        });

        return input;
      },
    };
  }
}

// ============================================================================
// 事件监听器管理
// ============================================================================

/**
 * 事件监听管理器，统一注册和清理各类事件监听器
 */
class EventListenerManager {
  /**
   * @param {Plugin} plugin - 插件主实例
   */
  constructor(plugin) {
    this.plugin = plugin;
    this.cleanupFunctions = [];
  }

  /**
   * 注册所有窗口级别的事件监听器
   */
  registerWindowListeners() {
    const refreshPositions = () =>
      this.plugin.positionService.updatePositions();
    const scrollHandler = debounce(refreshPositions, 10);
    const resizeHandler = debounce(refreshPositions, 10);

    this.registerScrollListeners(scrollHandler);
    this.registerResizeListener(resizeHandler);
    this.registerMouseMoveListener(refreshPositions);
  }

  /**
   * 注册滚动事件监听器（包括窗口和内部滚动容器）
   * @param {Function} handler - 处理函数
   * @private
   */
  registerScrollListeners(handler) {
    window.addEventListener("scroll", handler, { capture: true });
    this.cleanupFunctions.push(() => {
      window.removeEventListener("scroll", handler, { capture: true });
    });

    this.registerInternalScrollListeners(handler);
  }

  /**
   * 为内部可能滚动的容器添加滚动监听（延迟执行确保 DOM 已就绪）
   * @param {Function} handler - 处理函数
   * @private
   */
  registerInternalScrollListeners(handler) {
    setTimeout(() => {
      CONFIG.SELECTORS.SCROLL_CONTAINERS.forEach((selector) => {
        const containers = document.querySelectorAll(selector);
        containers.forEach((container) => {
          if (!container._hasScrollListener) {
            container.addEventListener("scroll", handler, { passive: true });
            container._hasScrollListener = true;
            this.cleanupFunctions.push(() => {
              container.removeEventListener("scroll", handler);
              delete container._hasScrollListener;
            });
          }
        });
      });
    }, 50);
  }

  /**
   * 注册窗口大小改变监听
   * @param {Function} handler - 处理函数
   * @private
   */
  registerResizeListener(handler) {
    window.addEventListener("resize", handler);
    this.cleanupFunctions.push(() => {
      window.removeEventListener("resize", handler);
    });
  }

  /**
   * 注册鼠标移动监听（用于动态调整位置）
   * @param {Function} handler - 处理函数
   * @private
   */
  registerMouseMoveListener(handler) {
    window.addEventListener("mousemove", handler, { passive: true });
    this.cleanupFunctions.push(() => {
      window.removeEventListener("mousemove", handler);
    });
  }

  /**
   * 注册 MutationObserver 以监听 DOM 变化，对新出现的滚动容器添加监听
   * @param {Function} handler - 滚动处理函数
   */
  registerMutationObserver(handler) {
    const observer = new MutationObserver(() => {
      CONFIG.SELECTORS.SCROLL_CONTAINERS.forEach((selector) => {
        const containers = document.querySelectorAll(selector);
        containers.forEach((container) => {
          if (!container._hasScrollListener) {
            container.addEventListener("scroll", handler, { passive: true });
            container._hasScrollListener = true;
            this.cleanupFunctions.push(() => {
              container.removeEventListener("scroll", handler);
              delete container._hasScrollListener;
            });
          }
        });
      });
    });

    observer.observe(document.body, { childList: true, subtree: true });
    this.cleanupFunctions.push(() => observer.disconnect());
  }

  /**
   * 注册思源事件总线（eventBus）上的事件监听
   */
  registerEventBusListeners() {
    this.plugin.eventBus.on(
      CONFIG.EVENTS.PROTYLE_DYNAMIC,
      this.plugin.boundOnProtyleLoaded,
    );
    this.plugin.eventBus.on(
      CONFIG.EVENTS.PROTYLE_STATIC,
      this.plugin.boundOnProtyleLoaded,
    );
    this.plugin.eventBus.on(
      CONFIG.EVENTS.UNLOAD_DOC,
      this.plugin.boundHandleDocUnload,
    );
    this.plugin.eventBus.on(
      CONFIG.EVENTS.WS_MAIN,
      this.plugin.boundHandleWsMain,
    );
  }

  /**
   * 清理所有已注册的监听器
   */
  cleanup() {
    this.cleanupFunctions.forEach((fn) => fn());
    this.cleanupFunctions = [];

    if (this.plugin.rafId) {
      cancelAnimationFrame(this.plugin.rafId);
      this.plugin.rafId = null;
    }
  }
}

// ============================================================================
// 插件主类
// ============================================================================

/**
 * 思源笔记子文档拼接插件主类
 * @extends Plugin
 */
module.exports = class ConcatSubDocsPlugin extends Plugin {
  /**
   * 插件加载时的初始化
   * @override
   */
  async onload() {
    await this.loadConfig();
    this.concatContainers = new Map(); // 存储文档ID -> { container, observer, editorElement, subDocIds }
    this.subdocElements = new Map(); // 存储子文档ID -> DOM元素数组
    this.renderDebounceTimers = new Map();
    this.lastToggleTime = 0; // 防抖用的上次点击时间
    this.unSavedConfig = null;
    this.rafId = null; // requestAnimationFrame ID（未使用但保留）

    // ======================================================================
    // 文档关系缓存（修改：docChildrenMap 存储有序数组）
    // ======================================================================
    this.docParentMap = new Map(); // docId -> parentDocId
    this.docChildrenMap = new Map(); // parentDocId -> string[] (有序子文档ID)
    this.docPathMap = new Map(); // docId -> path

    this.initServices();
    this.settingsService.init();
    this.eventListenerManager.registerWindowListeners();
    this.eventListenerManager.registerMutationObserver(
      debounce(() => this.positionService.updatePositions(), 10),
    );
    this.eventListenerManager.registerEventBusListeners();

    // 插件加载后初始化文档关系缓存
    this.initDocRelationCache().catch(console.error);
  }

  /**
   * 初始化文档关系缓存（遍历当前打开的文档）
   */
  async initDocRelationCache() {
    if (!this.app || !this.app.workspace) return;

    const tabs = this.app.workspace.tabs;
    for (const tab of tabs) {
      const docId = tab.model?.documentId;
      if (docId) {
        await this.updateDocRelationCache(docId);
      }
    }
  }

  /**
   * 更新单个文档的关系缓存
   * @param {string} docId - 文档 ID
   */
  async updateDocRelationCache(docId) {
    try {
      const blockInfo = await this.apiService.getBlockInfo(docId);
      if (!blockInfo) return;

      const path = blockInfo.path;
      this.docPathMap.set(docId, path);

      const parentPath = path.replace(/\/[^/]+\.sy$/, "");
      if (parentPath !== path) {
        // 优先从缓存查找父文档
        let parentId = null;
        for (const [cachedId, cachedPath] of this.docPathMap.entries()) {
          if (cachedPath === parentPath + ".sy") {
            parentId = cachedId;
            break;
          }
        }

        // 缓存未命中时使用 SQL 查询
        if (!parentId) {
          try {
            const sql = `SELECT id FROM blocks WHERE path = '${parentPath}.sy' AND type = 'd'`;
            const result = await this.apiService.querySql(sql);
            if (result && result.length > 0) {
              parentId = result[0].id;
            }
          } catch (e) {
            console.debug(`[缓存] 查询父文档失败 ${docId}`, e.message);
          }
        }

        if (parentId) {
          this.docParentMap.set(docId, parentId);

          // 修改：docChildrenMap 改为数组存储，并避免重复
          if (!this.docChildrenMap.has(parentId)) {
            this.docChildrenMap.set(parentId, []);
          }
          const children = this.docChildrenMap.get(parentId);
          // 避免重复添加（一般不会，但安全处理）
          if (!children.includes(docId)) {
            children.push(docId);
          }
        }
      }
    } catch (e) {
      console.debug(`[缓存] 更新文档关系失败 ${docId}`, e.message);
    }
  }

  /**
   * 从缓存中获取文档的所有子孙文档 ID（深度优先顺序）
   * @param {string} docId - 文档 ID
   * @returns {Array<string>} 子孙文档 ID 数组（深度优先）
   */
  getDescendantIdsFromCache(docId) {
    const descendants = [];
    const stack = [{ id: docId, index: 0 }]; // 栈帧：{ id, index }

    while (stack.length > 0) {
      const top = stack[stack.length - 1];
      const children = this.docChildrenMap.get(top.id) || [];

      if (top.index < children.length) {
        const child = children[top.index];
        top.index++;
        descendants.push(child);
        stack.push({ id: child, index: 0 });
      } else {
        stack.pop();
      }
    }

    return descendants;
  }

  /**
   * 清理文档关系缓存
   * @param {string} docId - 文档 ID
   */
  clearDocRelationCache(docId) {
    // 获取所有子孙文档
    const allDescendants = this.getDescendantIdsFromCache(docId);

    // 清理子孙文档的缓存
    for (const descendantId of allDescendants) {
      const parentId = this.docParentMap.get(descendantId);
      if (parentId) {
        const children = this.docChildrenMap.get(parentId);
        if (children) {
          const index = children.indexOf(descendantId);
          if (index !== -1) children.splice(index, 1);
        }
      }
      this.docParentMap.delete(descendantId);
      this.docChildrenMap.delete(descendantId);
      this.docPathMap.delete(descendantId);
    }

    // 清理当前文档的缓存
    const parentId = this.docParentMap.get(docId);
    if (parentId) {
      const children = this.docChildrenMap.get(parentId);
      if (children) {
        const index = children.indexOf(docId);
        if (index !== -1) children.splice(index, 1);
      }
    }
    this.docParentMap.delete(docId);
    this.docChildrenMap.delete(docId);
    this.docPathMap.delete(docId);
  }

  /**
   * 初始化所有服务类
   * @private
   */
  initServices() {
    this.apiService = new ApiService();
    this.blockService = new BlockService(this.apiService);
    // 传入插件实例以在 DocumentService 中使用 this.app
    this.documentService = new DocumentService(this.apiService, this);
    this.stateService = new StateService(this, this.blockService);
    this.componentService = new ComponentService(this);
    this.positionService = new PositionService(this);
    this.settingsService = new SettingsService(this);
    this.eventListenerManager = new EventListenerManager(this);

    // 绑定事件处理函数到当前实例
    this.boundOnProtyleLoaded = this.handleProtyleLoaded.bind(this);
    this.boundHandleDocUnload = this.handleDocUnload.bind(this);
    this.boundHandleWsMain = this.handleWsMain.bind(this);
  }

  /**
   * 处理 Protyle 加载完成事件（动态加载或静态加载）
   * @param {CustomEvent} event - 事件对象，detail 中包含 protyle
   */
  async handleProtyleLoaded(event) {
    const protyle = event.detail.protyle;
    if (!protyle) return;

    const docId = this.blockService.getDocIdFromElement(protyle.element);
    if (!docId) return;

    // 更新文档关系缓存
    await this.updateDocRelationCache(docId);

    const enabled = await this.blockService.getConcatState(docId);
    this.componentService.createToggleButton(
      protyle,
      this.config.restoreOnStartup && enabled,
      docId,
    );

    const editorElement = protyle.wysiwyg.element;

    if (this.config.restoreOnStartup && enabled) {
      const subDocs = await this.documentService.getSubDocs(docId);
      if (subDocs.length > 0) {
        await this.enableConcat(docId, editorElement).catch(console.error);
      } else {
        await this.blockService.setConcatState(docId, false);
      }
    } else {
      const mainDocEditorClass = getDocScopedClass(
        CONFIG.CSS_CLASSES.MAIN_DOC_EDITOR,
        docId,
      );
      editorElement.classList.remove(mainDocEditorClass);

      const containerClass = getDocScopedClass(
        CONFIG.CSS_CLASSES.CONTAINER,
        docId,
      );
      const existing = editorElement.nextElementSibling;
      if (
        existing &&
        existing.matches(
          `.${containerClass}[${CONFIG.ATTRIBUTES.DOC_ID}="${docId}"]`,
        )
      ) {
        existing.remove();
      }

      this.concatContainers.delete(docId);
    }
  }

  /**
   * 处理文档卸载事件
   * @param {CustomEvent} event - 事件对象，detail 中包含 docId
   */
  handleDocUnload(event) {
    const { docId } = event.detail;
    if (docId) {
      const data = this.concatContainers.get(docId);
      if (data) {
        // 断开 observer
        if (data.observer) data.observer.disconnect();

        // 清理 subdocElements 中该主文档对应的子文档容器引用
        if (data.subDocIds && Array.isArray(data.subDocIds)) {
          for (const subDocId of data.subDocIds) {
            const containers = this.subdocElements.get(subDocId);
            if (containers && Array.isArray(containers)) {
              // 过滤掉属于当前主文档的容器（通过父级容器判断）
              const filtered = containers.filter(
                (container) => container.parentElement !== data.container,
              );
              if (filtered.length === 0) {
                this.subdocElements.delete(subDocId);
              } else {
                this.subdocElements.set(subDocId, filtered);
              }
            }
          }
        }

        // 删除主文档容器引用
        this.concatContainers.delete(docId);
      }
    }
  }

  /**
   * 处理 ws-main 事件（实时同步更新子文档内容）
   * 支持：文档级操作（增删改移）+ 块级操作（内容更新）
   * @param {CustomEvent} event - 事件对象，detail 中包含操作数据
   */
  async handleWsMain(event) {
    const detail = event.detail;
    if (!detail) return;

    // ======================================================================
    // 第一部分：处理文档级操作（通过 detail.cmd 判断）
    // ======================================================================
    const cmd = detail.cmd;
    if (cmd) {
      await this.handleDocLevelCommand(cmd, detail);
    }

    // ======================================================================
    // 第二部分：处理块级操作（通过 detail.data 判断）
    // ======================================================================
    if (!detail.data || !Array.isArray(detail.data)) return;

    for (const item of detail.data) {
      if (!item.doOperations || !Array.isArray(item.doOperations)) continue;

      for (const op of item.doOperations) {
        // 支持的块级操作类型
        const supportedActions = [
          "update",
          "delete",
          "insert",
          "move",
          "mark",
          "create",
          "remove",
          "fold",
          "unfold",
        ];
        if (!supportedActions.includes(op.action)) continue;

        const blockId = op.id;
        if (!blockId) continue;

        // 获取操作块的根文档 ID
        let rootId = null;
        try {
          if (op.action === "delete") {
            if (op.parentID) {
              const parentInfo = await this.apiService.getBlockInfo(
                op.parentID,
              );
              if (parentInfo) rootId = parentInfo.rootID;
            }
            if (!rootId) {
              const element = document.querySelector(
                `[${CONFIG.ATTRIBUTES.NODE_ID}="${op.id}"]`,
              );
              if (element) {
                const ancestor = element.closest(
                  `[${CONFIG.ATTRIBUTES.SUBDOC_ID}]`,
                );
                if (ancestor)
                  rootId = ancestor.getAttribute(CONFIG.ATTRIBUTES.SUBDOC_ID);
              }
            }
          } else {
            const blockInfo = await this.apiService.getBlockInfo(blockId);
            if (blockInfo) rootId = blockInfo.rootID;
          }
        } catch (e) {
          console.warn("获取块信息失败，可能已删除", e);
          continue;
        }

        if (!rootId) continue;

        // 如果该子文档正在显示中，则重新获取其内容并更新
        if (this.subdocElements.has(rootId)) {
          const elements = this.subdocElements.get(rootId);

          // 防抖：避免频繁操作导致多次渲染
          if (this.renderDebounceTimers.has(rootId)) {
            clearTimeout(this.renderDebounceTimers.get(rootId));
          }

          const timer = setTimeout(async () => {
            try {
              const newHtml =
                await this.documentService.renderSubDocHtml(rootId);

              for (const element of elements) {
                if (element?.parentNode) {
                  const contentDiv = element.querySelector(
                    `.${CONFIG.CSS_CLASSES.SUBDOC_CONTENT}`,
                  );
                  if (contentDiv) {
                    contentDiv.innerHTML = newHtml;
                    this.componentService.setContentEditable(contentDiv);
                  }
                }
              }
            } catch (e) {
              console.warn(`渲染子文档 ${rootId} 失败`, e);
            }
          }, CONFIG.RENDER_DEBOUNCE_MS);

          this.renderDebounceTimers.set(rootId, timer);
        }
      }
    }
  }

  /**
   * 处理文档级命令（create、removeDoc、moveDoc、rename 等）
   * @param {string} cmd - 命令名称
   * @param {Object} detail - 事件详情
   */
  async handleDocLevelCommand(cmd, detail) {
    switch (cmd) {
      // ------------------------------------------------------------------
      // 删除文档
      // ------------------------------------------------------------------
      case "removeDoc":
        await this.handleRemoveDoc(detail);
        break;

      // ------------------------------------------------------------------
      // 新增文档
      // ------------------------------------------------------------------
      case "create":
        await this.handleCreateDoc(detail);
        break;

      // ------------------------------------------------------------------
      // 移动文档
      // ------------------------------------------------------------------
      case "moveDoc":
        await this.handleMoveDoc(detail);
        break;

      // ------------------------------------------------------------------
      // 重命名文档（更新标题）
      // ------------------------------------------------------------------
      case "rename":
        await this.handleRenameDoc(detail);
        break;

      // ------------------------------------------------------------------
      // 文档排序变化（同级拖拽排序）
      // ------------------------------------------------------------------
      case "filetreeSortChanged":
        await this.handleFiletreeSortChanged(detail);
        break;

      // ------------------------------------------------------------------
      // 其他文档级操作（可选扩展）
      // ------------------------------------------------------------------
      case "copyDoc":
        // 复制文档后可能需要刷新父文档的子文档列表
        await this.handleCopyDoc(detail);
        break;

      default:
        // 未知命令，忽略
        break;
    }
  }

  /**
   * 处理删除文档（支持级联删除）
   * @param {Object} detail - 事件详情
   */
  async handleRemoveDoc(detail) {
    // ======================================================================
    // 1. 从 detail.data.ids 数组中获取被删除的文档 ID 列表
    // ======================================================================
    const deletedIds = detail.data?.ids;
    if (!deletedIds || !Array.isArray(deletedIds) || deletedIds.length === 0) {
      console.warn("删除文档：缺少有效的 ids 字段");
      return;
    }

    // ======================================================================
    // 2. 从缓存中获取所有子孙文档 ID
    // ======================================================================
    const allIdsToDelete = new Set(deletedIds);

    for (const docId of deletedIds) {
      const descendantIds = this.getDescendantIdsFromCache(docId);
      descendantIds.forEach((id) => allIdsToDelete.add(id));
    }

    const allIdsArray = Array.from(allIdsToDelete);

    // ======================================================================
    // 3. 遍历处理每个被删除的文档
    // ======================================================================
    for (const docId of allIdsArray) {
      if (!docId) continue;
      await this.cleanupDoc(docId);
      // 清理关系缓存
      this.clearDocRelationCache(docId);
    }

  }

  /**
   * 清理单个文档的拼接引用
   * @param {string} docId - 文档 ID
   */
  async cleanupDoc(docId) {
    // 1. 移除所有显示中的子文档容器
    const containers = document.querySelectorAll(
      `.${CONFIG.CSS_CLASSES.SUBDOC_ITEM}[${CONFIG.ATTRIBUTES.SUBDOC_ID}="${docId}"]`,
    );
    containers.forEach((container) => container.remove());

    // 2. 清理 subdocElements 映射
    this.subdocElements.delete(docId);

    // 3. 清理所有主文档中对该子文档的引用
    for (const [parentDocId, data] of this.concatContainers.entries()) {
      if (data.subDocIds && data.subDocIds.includes(docId)) {
        data.subDocIds = data.subDocIds.filter((id) => id !== docId);

        // 移除对应的 DOM 容器
        const subContainer = data.container.querySelector(
          `[${CONFIG.ATTRIBUTES.SUBDOC_ID}="${docId}"]`,
        );
        if (subContainer) {
          subContainer.remove();
        }

        // 如果子文档列表为空，可选择关闭拼接或保留空容器
        if (data.subDocIds.length === 0) {
          console.log(`文档 ${parentDocId} 的所有子文档已删除`);
        }
      }
    }
  }

  /**
   * 获取文档的所有子孙文档 ID（级联删除用）
   * @param {string} docId - 文档 ID
   * @returns {Promise<Array<string>>} 子孙文档 ID 数组
   */
  async getAllDescendantIds(docId) {
    const descendants = [];

    try {
      const blockInfo = await this.apiService.getBlockInfo(docId);
      if (!blockInfo) return descendants;

      const parentPath = blockInfo.path.replace(/\.sy$/, "");

      // 查询所有子孙文档（路径以父文档路径开头）
      const sql = `
      SELECT id, path 
      FROM blocks 
      WHERE path LIKE '${parentPath}/%' 
      AND type = 'd'
      ORDER BY path ASC
    `;

      const result = await this.apiService.querySql(sql);
      if (result && result.length > 0) {
        descendants.push(...result.map((r) => r.id));
      }
    } catch (e) {
      const isIndexing =
        e.message &&
        (e.message.includes("索引") ||
          e.message.toLowerCase().includes("indexing"));

      if (isIndexing) {
        console.debug(
          `[getAllDescendantIds] 文档 ${docId} 索引中，跳过子孙文档查询`,
        );
      } else {
        console.warn("获取子孙文档列表失败", e);
      }
    }

    return descendants;
  }

  /**
   * 处理新增文档
   * @param {Object} detail - 事件详情
   */
  async handleCreateDoc(detail) {
    // ======================================================================
    // 从 path 中提取新文档 ID
    // ======================================================================
    const docPath = detail.data?.path;
    if (!docPath || typeof docPath !== "string") {
      console.warn("新增文档：缺少有效的 path 字段");
      return;
    }

    // 路径格式：/notebookId/parentPath/docId.sy
    // 提取文档 ID（最后一段，去掉 .sy 后缀）
    const pathSegments = docPath.split("/").filter((s) => s.length > 0);
    const docFileName = pathSegments[pathSegments.length - 1];
    const newDocId = docFileName.replace(/\.sy$/, "");

    if (!newDocId) {
      console.warn("新增文档：无法从路径提取文档 ID", docPath);
      return;
    }

    // ======================================================================
    // 1. 优先从缓存获取父文档 ID（最快）
    // ======================================================================
    let parentDocId = null;
    const parentPath = docPath.replace(/\/[^/]+\.sy$/, "");

    if (parentPath !== docPath) {
      // 方案 1：从缓存中查找父文档
      for (const [cachedDocId, cachedPath] of this.docPathMap.entries()) {
        if (cachedPath === parentPath + ".sy") {
          parentDocId = cachedDocId;
          break;
        }
      }

      // 方案 2：SQL 查询父文档 ID
      if (!parentDocId) {
        try {
          const sql = `SELECT id FROM blocks WHERE path = '${parentPath}.sy' AND type = 'd'`;
          const result = await this.apiService.querySql(sql);
          if (result && result.length > 0) {
            parentDocId = result[0].id;
          }
        } catch (e) {
          console.debug(`[SQL] 查询父文档失败`, e.message);
        }
      }

      // 方案 3：从 detail 中获取（如果有）
      if (!parentDocId && detail.data?.parentDocID) {
        parentDocId = detail.data.parentDocID;
      }
    }

    if (!parentDocId) {
      await this.updateDocRelationCache(newDocId);
      return;
    }

    // ======================================================================
    // 2. 更新文档关系缓存
    // ======================================================================
    await this.updateDocRelationCache(newDocId);

    // ======================================================================
    // 3. 检查是否有主文档应该显示这个新子文档
    // ======================================================================
    for (const [docId, data] of this.concatContainers.entries()) {
      const isSubDoc = await this.isDirectOrIndirectSubDoc(newDocId, docId);

      if (!isSubDoc) continue;

      // 检查数量限制
      if (
        this.config.maximumNumberOfDocuments > 0 &&
        data.subDocIds.length >= this.config.maximumNumberOfDocuments
      ) {
        showMessage(
          this.i18n.maximumNumberOfDocumentsReached.replace(
            /\{maximumNumberOfDocuments\}/g,
            this.config.maximumNumberOfDocuments,
          ),
          3000,
          "info",
        );
        continue;
      }

      // 检查层级限制
      const level = await this.getDocLevel(newDocId, docId);
      if (
        this.config.maxDocumentHierarchyLevel > 0 &&
        level > this.config.maxDocumentHierarchyLevel
      ) {
        continue;
      }

      // 检查 DOM 是否已存在（可能由 filetreeSortChanged 提前创建了缓存但 DOM 未渲染）
      const existingDom = data.container.querySelector(
        `[${CONFIG.ATTRIBUTES.SUBDOC_ID}="${newDocId}"]`,
      );
      if (existingDom) {
        // DOM 已存在，无需重复创建
        continue;
      }

      // 渲染 HTML
      let html;
      try {
        html = await this.documentService.renderSubDocHtml(newDocId);
      } catch (e) {
        console.warn(`渲染新子文档 ${newDocId} 失败`, e);
        continue;
      }

      // 创建子文档容器
      const subDocContainer = this.componentService.createSubDocContainer(
        {
          id: newDocId,
          name: detail.data?.name || docFileName.replace(/\.sy$/, ""),
        },
        data.editorElement,
      );

      const contentDiv = subDocContainer.querySelector(
        `.${CONFIG.CSS_CLASSES.SUBDOC_CONTENT}`,
      );
      if (contentDiv) {
        contentDiv.innerHTML = html;
        this.componentService.setContentEditable(contentDiv);
      }

      // 绑定编辑链接点击事件
      const editLink = subDocContainer.querySelector(
        `.${CONFIG.CSS_CLASSES.EDIT_LINK}`,
      );
      if (editLink) {
        editLink.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          const id = editLink.getAttribute("data-id");
          if (id) this.documentService.openDocument(id);
        });
      }

      // 将新容器追加到主文档容器末尾（稍后统一排序）
      data.container.appendChild(subDocContainer);

      // 更新 subdocElements 映射
      if (!this.subdocElements.has(newDocId)) {
        this.subdocElements.set(newDocId, []);
      }
      this.subdocElements.get(newDocId).push(subDocContainer);

      // 如果 newDocId 不在 subDocIds 中，则添加（通常 filetreeSortChanged 已添加，但安全起见检查）
      if (!data.subDocIds.includes(newDocId)) {
        data.subDocIds.push(newDocId);
      }

      // 重新排序整个容器，确保新文档位于正确位置（基于当前 subDocIds 顺序）
      this._reorderSubDocs(docId, data, data.subDocIds);
    }
  }

  /**
   * 获取新文档应该插入的位置（只在同级兄弟文档中排序）
   * @param {string} newDocId - 新文档 ID
   * @param {Array<string>} existingSubDocIds - 已存在的子文档 ID 列表（所有层级）
   * @param {string} directParentId - 新文档的直接父文档 ID
   * @returns {Promise<number>} 插入位置索引（-1 表示追加到末尾）
   */
  async getSubDocInsertPosition(newDocId, existingSubDocIds, directParentId) {
    try {
      if (existingSubDocIds.length === 0) return -1;

      // 1. 获取新文档的路径信息
      const newDocInfo = await this.apiService.getBlockInfo(newDocId);
      if (!newDocInfo) return -1;

      const notebookId = newDocInfo.box;
      const parentPath = newDocInfo.path.replace(/\/[^/]+\.sy$/, "");

      if (parentPath === newDocInfo.path) return -1;

      // 2. 获取父文档下的所有直接子文档（兄弟文档列表，已按 sort 排序）
      const listData = await this.apiService.listDocs(notebookId, parentPath);

      if (!listData || !listData.files || !Array.isArray(listData.files)) {
        console.debug(
          "[getSubDocInsertPosition] listDocsByPath 失败，使用降级方案",
        );
        return this.getInsertPositionFromExisting(existingSubDocIds, newDocId);
      }

      // 3. 构建兄弟文档 ID 列表（按 API 返回顺序，即 sort 顺序）
      const siblingIds = [];
      for (const file of listData.files) {
        const docId = file.id || file.name?.replace(/\.sy$/, "");
        if (docId) {
          siblingIds.push(docId);
        }
      }

      // 4. 找到新文档在兄弟文档中的位置索引
      const newDocIndexInSiblings = siblingIds.indexOf(newDocId);

      // 如果新文档不在兄弟列表中（可能还未完全同步），使用 sort 值比较
      if (newDocIndexInSiblings === -1) {
        console.debug(
          "[getSubDocInsertPosition] 新文档不在兄弟列表中，使用 sort 比较",
        );
        return this.getInsertPositionBySort(
          newDocId,
          existingSubDocIds,
          siblingIds,
          listData.files,
        );
      }

      // 5. 在 existingSubDocIds 中找到第 newDocIndexInSiblings 个兄弟文档的位置
      let siblingCount = 0;
      for (let i = 0; i < existingSubDocIds.length; i++) {
        const existingId = existingSubDocIds[i];

        // 检查是否是兄弟文档（在 siblingIds 中）
        const siblingIndex = siblingIds.indexOf(existingId);
        if (siblingIndex === -1) {
          continue; // 不是同级兄弟，跳过
        }

        // 如果这个兄弟文档在新文档之前，继续计数
        if (siblingIndex < newDocIndexInSiblings) {
          siblingCount++;
          continue;
        }

        // 找到第一个在新文档之后的兄弟文档，插入到它前面
        return i;
      }

      // 6. 所有兄弟文档都在新文档之前，插入到最后一个兄弟文档之后
      let lastSiblingIndex = -1;
      for (let i = 0; i < existingSubDocIds.length; i++) {
        if (siblingIds.includes(existingSubDocIds[i])) {
          lastSiblingIndex = i;
        }
      }

      if (lastSiblingIndex >= 0) {
        return lastSiblingIndex + 1;
      }

      // 7. 【新增】如果没有兄弟文档，找到父文档的位置，插入到父文档之后
      const parentIndex = existingSubDocIds.indexOf(directParentId);
      if (parentIndex >= 0) {
        return parentIndex + 1;
      }
      return -1;
    } catch (e) {
      console.debug(`[getSubDocInsertPosition] 获取插入位置失败`, e.message);
      return this.getInsertPositionFromExisting(existingSubDocIds, newDocId);
    }
  }

  /**
   * 降级方案：通过 sort 值比较确定插入位置
   * @param {string} newDocId - 新文档 ID
   * @param {Array<string>} existingSubDocIds - 已存在的子文档 ID 列表
   * @param {Array<string>} siblingIds - 兄弟文档 ID 列表
   * @param {Array} files - listDocs 返回的 files 数组
   * @returns {Promise<number>} 插入位置索引
   */
  async getInsertPositionBySort(
    newDocId,
    existingSubDocIds,
    siblingIds,
    files,
  ) {
    try {
      // 构建 sort 映射
      const sortMap = new Map();
      for (const file of files) {
        const docId = file.id || file.name?.replace(/\.sy$/, "");
        if (docId) {
          sortMap.set(docId, file.sort || 0);
        }
      }

      // 获取新文档的 sort 值
      const newDocInfo = await this.apiService.getBlockInfo(newDocId);
      if (!newDocInfo) return -1;

      const newSort = sortMap.get(newDocId) || newDocInfo.sort || 0;
      let lastSiblingIndex = -1;

      for (let i = 0; i < existingSubDocIds.length; i++) {
        const existingId = existingSubDocIds[i];

        if (!siblingIds.includes(existingId)) {
          continue;
        }

        lastSiblingIndex = i;
        const existingSort = sortMap.get(existingId) || 0;

        if (newSort < existingSort) {
          return i;
        }
      }

      if (lastSiblingIndex >= 0) {
        return lastSiblingIndex + 1;
      }

      return -1;
    } catch (e) {
      console.debug(`[getInsertPositionBySort] 失败`, e.message);
      return -1;
    }
  }

  /**
   * 降级方案：从现有子文档的块信息获取 sort 值
   * @param {Array<string>} existingSubDocIds - 已存在的子文档 ID 列表
   * @param {string} newDocId - 新文档 ID
   * @returns {Promise<number>} 插入位置索引
   */
  async getInsertPositionFromExisting(existingSubDocIds, newDocId) {
    try {
      const newDocInfo = await this.apiService.getBlockInfo(newDocId);
      if (!newDocInfo) return -1;

      const newSort = newDocInfo.sort || 0;
      let lastSiblingIndex = -1;

      for (let i = 0; i < existingSubDocIds.length; i++) {
        const existingInfo = await this.apiService.getBlockInfo(
          existingSubDocIds[i],
        );
        if (existingInfo && existingInfo.sort !== undefined) {
          lastSiblingIndex = i;
          if (newSort < existingInfo.sort) {
            return i;
          }
        }
      }

      if (lastSiblingIndex >= 0) {
        return lastSiblingIndex + 1;
      }

      return -1;
    } catch (e) {
      console.debug(`[getInsertPositionFromExisting] 降级方案失败`, e.message);
      return -1;
    }
  }

  /**
   * 处理重命名文档（更新标题）
   * @param {Object} detail - 事件详情
   */
  async handleRenameDoc(detail) {
    const docId = detail.id || detail.data?.id;
    const newName = detail.data?.refText || detail.data?.title;
    if (!docId) return;

    // 如果该文档正在被拼接显示，更新其标题
    if (this.subdocElements.has(docId)) {
      const containers = this.subdocElements.get(docId);

      for (const container of containers) {
        if (container?.parentNode) {
          // 更新编辑链接的 title 属性
          const editLink = container.querySelector(
            `.${CONFIG.CSS_CLASSES.EDIT_LINK}`,
          );
          if (editLink && newName) {
            editLink.title = `${this.i18n.editLinkTitle}: ${newName}`;
          }

          // 重新渲染以更新标题显示
          try {
            const newHtml = await this.documentService.renderSubDocHtml(docId);
            const contentDiv = container.querySelector(
              `.${CONFIG.CSS_CLASSES.SUBDOC_CONTENT}`,
            );
            if (contentDiv) {
              contentDiv.innerHTML = newHtml;
              this.componentService.setContentEditable(contentDiv);
            }
          } catch (e) {
            console.warn(`重命名后渲染子文档 ${docId} 失败`, e);
          }
        }
      }
    }
  }

  /**
   * 处理移动文档（修复版本）
   * @param {Object} detail - 事件详情
   */
  async handleMoveDoc(detail) {
    // ======================================================================
    // 1. 从事件参数中提取路径信息（不依赖数据库查询）
    // ======================================================================
    const fromPath = detail.data?.fromPath;
    const newPath = detail.data?.newPath;

    if (
      !fromPath ||
      !newPath ||
      typeof fromPath !== "string" ||
      typeof newPath !== "string"
    ) {
      console.debug("[handleMoveDoc] 缺少 fromPath 或 newPath");
      return;
    }

    // 提取文档 ID
    const pathSegments = newPath.split("/").filter((s) => s.length > 0);
    const docFileName = pathSegments[pathSegments.length - 1];
    const docId = docFileName.replace(/\.sy$/, "");

    if (!docId) {
      console.debug("[handleMoveDoc] 无法提取文档 ID");
      return;
    }

    // 提取原父文档路径和新父文档路径
    const fromParentPath = fromPath.replace(/\/[^/]+\.sy$/, "");
    const newParentPath = newPath.replace(/\/[^/]+\.sy$/, "");

    // ======================================================================
    // 2. 从缓存查找父文档 ID
    // ======================================================================
    let oldParentDocId = null;
    let newParentDocId = null;

    if (fromParentPath !== fromPath) {
      for (const [cachedId, cachedPath] of this.docPathMap.entries()) {
        if (cachedPath === fromParentPath + ".sy") {
          oldParentDocId = cachedId;
          break;
        }
      }
    }

    if (newParentPath !== newPath) {
      for (const [cachedId, cachedPath] of this.docPathMap.entries()) {
        if (cachedPath === newParentPath + ".sy") {
          newParentDocId = cachedId;
          break;
        }
      }
    }

    // ======================================================================
    // 3. 递归更新被移动文档及其所有子孙的路径缓存
    // ======================================================================
    // 更新当前文档的路径
    this.docPathMap.set(docId, newPath);

    // 查询所有子孙文档（基于原路径）
    const fromPathWithoutExt = fromPath.replace(/\.sy$/, "");
    const newPathWithoutExt = newPath.replace(/\.sy$/, "");

    try {
      const descendantsSql = `SELECT id, path FROM blocks WHERE path LIKE '${fromPathWithoutExt}/%' AND type = 'd'`;
      const descendants = await this.apiService.querySql(descendantsSql);
      for (const row of descendants) {
        const oldChildPath = row.path;
        const newChildPath = oldChildPath.replace(
          fromPathWithoutExt,
          newPathWithoutExt,
        );
        this.docPathMap.set(row.id, newChildPath);
      }
    } catch (e) {
      console.debug("[handleMoveDoc] 更新子孙路径缓存失败", e.message);
    }

    // ======================================================================
    // 4. 更新父子关系缓存（仅修改直接父文档）
    // ======================================================================
    if (oldParentDocId) {
      const oldChildren = this.docChildrenMap.get(oldParentDocId);
      if (oldChildren) {
        const index = oldChildren.indexOf(docId);
        if (index !== -1) oldChildren.splice(index, 1);
      }
    }

    if (newParentDocId) {
      this.docParentMap.set(docId, newParentDocId);
      if (!this.docChildrenMap.has(newParentDocId)) {
        this.docChildrenMap.set(newParentDocId, []);
      }
      const newChildren = this.docChildrenMap.get(newParentDocId);
      if (!newChildren.includes(docId)) {
        newChildren.push(docId); // 暂追加末尾，后续刷新时会重新排序
      }
    }

    // ======================================================================
    // 5. 遍历所有主文档，更新拼接区域中的文档归属
    // ======================================================================
    for (const [parentDocId, data] of this.concatContainers.entries()) {
      const wasSubDoc = data.subDocIds.includes(docId);

      // 检查新位置是否还在当前主文档的有效层级范围内
      let isNowSubDoc = false;
      if (newParentDocId) {
        // 修复：如果新父文档就是当前主文档本身，视为有效
        const isNewParentValid =
          newParentDocId === parentDocId ||
          (await this.isDirectOrIndirectSubDoc(newParentDocId, parentDocId));
        const level = await this.getDocLevel(docId, parentDocId);
        isNowSubDoc =
          isNewParentValid && level <= this.config.maxDocumentHierarchyLevel;
      }

      if (wasSubDoc && !isNowSubDoc) {
        // 【从原父文档拼接区域移除】
        const subContainer = data.container.querySelector(
          `[${CONFIG.ATTRIBUTES.SUBDOC_ID}="${docId}"]`,
        );
        if (subContainer) {
          subContainer.remove();
        }
        data.subDocIds = data.subDocIds.filter((id) => id !== docId);

        const containers = this.subdocElements.get(docId);
        if (containers) {
          const filtered = containers.filter(
            (c) => c.parentElement !== data.container,
          );
          if (filtered.length === 0) {
            this.subdocElements.delete(docId);
          } else {
            this.subdocElements.set(docId, filtered);
          }
        }
      } else if (!wasSubDoc && isNowSubDoc) {
        // 【添加到新父文档拼接区域】- 先追加到末尾，后续刷新时会调整顺序
        try {
          const html = await this.documentService.renderSubDocHtml(docId);
          const subDocContainer = this.componentService.createSubDocContainer(
            { id: docId, name: docFileName.replace(/\.sy$/, "") },
            data.editorElement,
          );

          const contentDiv = subDocContainer.querySelector(
            `.${CONFIG.CSS_CLASSES.SUBDOC_CONTENT}`,
          );
          if (contentDiv) {
            contentDiv.innerHTML = html;
            this.componentService.setContentEditable(contentDiv);
          }

          data.container.appendChild(subDocContainer);
          data.subDocIds.push(docId);

          if (!this.subdocElements.has(docId)) {
            this.subdocElements.set(docId, []);
          }
          this.subdocElements.get(docId).push(subDocContainer);
        } catch (e) {
          console.warn(`渲染移动后的子文档 ${docId} 失败`, e);
        }
      }
    }

    // ======================================================================
    // 6. 收集所有受影响的主文档并刷新拼接列表
    // ======================================================================
    const affectedMainDocs = new Set();
    for (const mainDocId of this.concatContainers.keys()) {
      // 修复：如果旧父文档就是主文档本身，也加入受影响列表
      if (
        oldParentDocId &&
        (oldParentDocId === mainDocId ||
          (await this.isDirectOrIndirectSubDoc(oldParentDocId, mainDocId)))
      ) {
        affectedMainDocs.add(mainDocId);
      }
      if (
        newParentDocId &&
        (newParentDocId === mainDocId ||
          (await this.isDirectOrIndirectSubDoc(newParentDocId, mainDocId)))
      ) {
        affectedMainDocs.add(mainDocId);
      }
    }

    for (const mainDocId of affectedMainDocs) {
      const data = this.concatContainers.get(mainDocId);
      if (data) {
        const newOrder = this._getFlattenSubDocIds(mainDocId);
        if (newOrder && !this._arraysEqual(data.subDocIds, newOrder)) {
          this._reorderSubDocs(mainDocId, data, newOrder);
          data.subDocIds = newOrder;
        }
      }
    }
  }

  /**
   * 处理文档排序变化事件（同级拖拽排序）
   * @param {Object} detail - 事件详情
   */
  async handleFiletreeSortChanged(detail) {
    const { childIDs, parentPath } = detail.data || {};

    if (!childIDs || !Array.isArray(childIDs) || !parentPath) {
      console.debug("[handleFiletreeSortChanged] 缺少必要数据");
      return;
    }

    // 1. 根据 parentPath 获取父文档 ID
    let parentDocId = null;
    // 优先从缓存查找
    for (const [id, path] of this.docPathMap.entries()) {
      if (path === parentPath + ".sy") {
        parentDocId = id;
        break;
      }
    }
    if (!parentDocId) {
      try {
        const sql = `SELECT id FROM blocks WHERE path = '${parentPath}.sy' AND type = 'd'`;
        const result = await this.apiService.querySql(sql);
        if (result && result.length > 0) {
          parentDocId = result[0].id;
        }
      } catch (e) {
        console.debug("[handleFiletreeSortChanged] 查询父文档失败", e.message);
      }
    }
    if (!parentDocId) {
      return;
    }

    // 2. 更新缓存中该父文档的直接子文档顺序
    this.docChildrenMap.set(parentDocId, childIDs.slice());

    // 3. 遍历所有开启拼接的主文档
    for (const [docId, data] of this.concatContainers.entries()) {
      // 检查主文档是否包含该父文档（父文档等于主文档自身也视为有效）
      const isParentInScope =
        parentDocId === docId ||
        (await this.isDirectOrIndirectSubDoc(parentDocId, docId));
      if (!isParentInScope) {
        continue;
      }

      // 从缓存中重新生成深度优先的扁平子文档列表
      const newOrder = this._getFlattenSubDocIds(docId);
      if (!newOrder) continue;

      // 与当前列表对比，如果顺序不同则更新 DOM
      if (!this._arraysEqual(data.subDocIds, newOrder)) {
        this._reorderSubDocs(docId, data, newOrder);
        data.subDocIds = newOrder; // 更新存储的列表
      }
    }
  }

  /**
   * 从缓存中深度优先获取文档的所有后代文档 ID（不包括自身）
   * @param {string} rootId 根文档 ID
   * @returns {string[]} 扁平的后代文档 ID 数组（深度优先）
   */
  _getFlattenSubDocIds(rootId) {
    const result = [];
    const stack = [{ id: rootId, index: 0 }]; // 栈帧：{ id, index }

    while (stack.length > 0) {
      const top = stack[stack.length - 1];
      const children = this.docChildrenMap.get(top.id) || [];

      if (top.index < children.length) {
        const child = children[top.index];
        top.index++; // 移动到下一个子节点
        result.push(child);
        stack.push({ id: child, index: 0 }); // 开始处理这个子节点
      } else {
        stack.pop(); // 当前节点的所有子节点处理完毕，回溯
      }
    }

    return result;
  }

  /**
   * 重新排列指定主文档的子文档容器顺序
   * @param {string} docId 主文档 ID（仅用于日志）
   * @param {Object} data 主文档的拼接数据
   * @param {string[]} newOrder 新的子文档 ID 顺序
   */
  _reorderSubDocs(docId, data, newOrder) {
    const container = data.container;
    if (!container) return;

    // 将现有子文档按新顺序重新插入到容器末尾（会自然调整顺序）
    for (const subId of newOrder) {
      const subElem = container.querySelector(
        `[${CONFIG.ATTRIBUTES.SUBDOC_ID}="${subId}"]`,
      );
      if (subElem) {
        container.appendChild(subElem); // 移动元素到末尾
      } else {
        // 忽略：console.warn(`子文档 ${subId} 的 DOM 元素不存在，可能已被移除`);
      }
    }
  }

  /**
   * 比较两个数组是否相等（顺序敏感）
   * @param {Array} a
   * @param {Array} b
   * @returns {boolean}
   */
  _arraysEqual(a, b) {
    if (a === b) return true;
    if (!a || !b) return false;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  }

  /**
   * 处理复制文档（可选扩展）
   * @param {Object} detail - 事件详情
   */
  async handleCopyDoc(detail) {
    // 复制文档后，新文档可能需要添加到父文档的拼接列表
    // 复用 create 逻辑
    await this.handleCreateDoc(detail);
  }

  /**
   * 根据路径获取父文档 ID
   * @param {string} path - 文档路径
   * @returns {Promise<string|null>}
   */
  async getParentDocIdByPath(path) {
    try {
      // 路径格式：/notebookId/path/to/doc.sy
      // 父文档路径：/notebookId/path/to
      const parentPath = path.replace(/\/[^/]+\.sy$/, "");
      if (parentPath === path) return null;

      // 方案 1：优先从缓存查找
      for (const [docId, cachedPath] of this.docPathMap.entries()) {
        if (cachedPath === parentPath + ".sy") {
          return docId;
        }
      }

      // 方案 2：SQL 查询（比 listDocs 更可靠）
      const sql = `SELECT id FROM blocks WHERE path = '${parentPath}.sy' AND type = 'd'`;
      const result = await this.apiService.querySql(sql);
      if (result && result.length > 0) {
        return result[0].id;
      }

      return null;
    } catch (e) {
      // 静默处理错误，返回 null
      console.debug(`[getParentDocIdByPath] 获取父文档失败：${e.message}`);
      return null;
    }
  }

  /**
   * 判断文档 B 是否是文档 A 的子文档（直接或间接）
   * @param {string} childDocId - 子文档 ID
   * @param {string} parentDocId - 父文档 ID
   * @returns {Promise<boolean>}
   */
  async isDirectOrIndirectSubDoc(childDocId, parentDocId) {
    try {
      const childInfo = await this.apiService.getBlockInfo(childDocId);
      const parentInfo = await this.apiService.getBlockInfo(parentDocId);

      if (!childInfo || !parentInfo) {
        return false;
      }

      const parentPath = parentInfo.path.replace(/\.sy$/, "");
      const childPath = childInfo.path;

      // 子文档路径应该以父文档路径开头
      const result = childPath.startsWith(parentPath + "/");
      return result;
    } catch {
      return false;
    }
  }

  /**
   * 检查 candidateId 是否是 targetId 的祖先文档
   * @param {string} candidateId - 候选祖先文档 ID
   * @param {string} targetId - 目标文档 ID
   * @returns {Promise<boolean>}
   */
  async isDocAncestor(candidateId, targetId) {
    try {
      const candidateInfo = await this.apiService.getBlockInfo(candidateId);
      const targetInfo = await this.apiService.getBlockInfo(targetId);

      if (!candidateInfo || !targetInfo) {
        return false;
      }

      const candidatePath = candidateInfo.path.replace(/\.sy$/, "");
      const targetPath = targetInfo.path;

      // 目标文档路径应该以候选祖先路径开头
      return targetPath.startsWith(candidatePath + "/");
    } catch {
      return false;
    }
  }

  /**
   * 获取文档相对于父文档的层级
   * @param {string} childDocId - 子文档 ID
   * @param {string} parentDocId - 父文档 ID
   * @returns {Promise<number>}
   */
  async getDocLevel(childDocId, parentDocId) {
    try {
      const childInfo = await this.apiService.getBlockInfo(childDocId);
      const parentInfo = await this.apiService.getBlockInfo(parentDocId);

      if (!childInfo || !parentInfo) return 1;

      const parentPath = parentInfo.path.replace(/\.sy$/, "");
      const childPath = childInfo.path.replace(/\.sy$/, "");

      const relativePath = childPath.replace(parentPath, "");
      const segments = relativePath.split("/").filter((s) => s.length > 0);

      return segments.length;
    } catch {
      return 1;
    }
  }
  /**
   * 插件卸载时的清理
   * @override
   */
  onunload() {
    // 清理所有防抖定时器
    for (const timer of this.renderDebounceTimers.values()) {
      clearTimeout(timer);
    }
    this.renderDebounceTimers.clear();
    this.removeAllConcatContainers();
    this.eventListenerManager.cleanup();
    this.stateService.clearAllConcatStates();
  }

  /**
   * 插件卸载（删除数据）时的处理
   * @override
   */
  uninstall() {
    this.removeData(CONFIG.STORAGE_NAME)
      .then(() => {
        console.log(`卸载 [${this.name}] 删除 [${CONFIG.STORAGE_NAME}] 成功`);
      })
      .catch((e) => {
        console.error(
          `卸载 [${this.name}] 删除 [${CONFIG.STORAGE_NAME}] 失败：${e.msg}`,
        );
      });
  }

  /**
   * 加载插件配置
   * @returns {Promise<void>}
   */
  async loadConfig() {
    this.config = { ...CONFIG.DEFAULT_CONFIG };
    const saved = await this.loadData(CONFIG.STORAGE_NAME);
    if (saved) {
      this.config = { ...this.config, ...saved };
    }
    this.unSavedConfig = null;
  }

  /**
   * 保存插件配置
   * @returns {Promise<void>}
   */
  async saveConfig() {
    const oldConfig = { ...this.config };
    const configToSave = this.unSavedConfig || this.config;

    this.saveData(CONFIG.STORAGE_NAME, configToSave)
      .then(() => {
        showMessage(this.i18n.configSavedSuccess, 2000);
        this.config = { ...this.config, ...configToSave };
        this.unSavedConfig = null;
        this.refreshAllConcatDocs(oldConfig);
      })
      .catch((error) => {
        showMessage(this.i18n.configSavedFail);
        console.error(error);
      });
  }
  /**
   * 更新配置后刷新所有拼接状态
   * @param {Object} oldConfig - 旧配置
   * @returns {Promise<void>}
   */
  async refreshAllConcatDocs(oldConfig) {
    if (!this.concatContainers || this.concatContainers.size === 0) {
      return;
    }

    const needRefresh =
      oldConfig.showSubDocTitle !== this.config.showSubDocTitle ||
      oldConfig.maxDocumentHierarchyLevel !==
        this.config.maxDocumentHierarchyLevel ||
      oldConfig.maximumNumberOfDocuments !==
        this.config.maximumNumberOfDocuments;

    if (!needRefresh) {
      return;
    }

    showMessage(
      this.i18n.refreshingStates || "正在刷新拼接状态，请稍候...",
      2000,
    );

    for (const [docId, data] of this.concatContainers.entries()) {
      try {
        const { editorElement } = data;
        if (!editorElement) continue;

        const containerClass = getDocScopedClass(
          CONFIG.CSS_CLASSES.CONTAINER,
          docId,
        );
        const existing = editorElement.nextElementSibling;
        if (
          existing &&
          existing.matches(
            `.${containerClass}[${CONFIG.ATTRIBUTES.DOC_ID}="${docId}"]`,
          )
        ) {
          if (data.observer) data.observer.disconnect();
          existing.remove();
        }

        const subDocs = await this.documentService.getSubDocs(docId);
        if (subDocs.length > 0) {
          await this.enableConcat(docId, editorElement);
        }
      } catch (e) {
        console.error(`刷新文档 ${docId} 失败`, e);
      }
    }
  }
  /**
   * 切换当前文档的拼接状态（开关按钮点击时调用）
   * @param {HTMLElement} toggleButton - 开关按钮元素
   * @param {string} docId - 当前文档 ID
   * @returns {Promise<void>}
   */
  async toggleConcatForCurrentDoc(toggleButton, docId) {
    const now = Date.now();
    if (now - this.lastToggleTime < 100) return;
    this.lastToggleTime = now;

    if (!toggleButton) {
      showMessage(this.i18n.noToggleButton, 3000, "error");
      return;
    }

    if (!docId) {
      showMessage(this.i18n.noDocId, 3000, "error");
      return;
    }

    const visibleProtyle = toggleButton.closest(".protyle");
    if (!visibleProtyle) {
      showMessage(this.i18n.noCurrentDoc, 3000, "error");
      return;
    }

    const editorElement = visibleProtyle.querySelector(".protyle-wysiwyg");
    if (!editorElement) {
      showMessage(this.i18n.editorUnavailable, 3000, "error");
      return;
    }

    const subDocs = await this.documentService.getSubDocs(docId);
    if (subDocs.length === 0) {
      showMessage(this.i18n.noSubDocs, 3000, "info");
      await this.blockService.setConcatState(docId, false);
      return;
    }

    const containerClass = getDocScopedClass(
      CONFIG.CSS_CLASSES.CONTAINER,
      docId,
    );
    const mainDocEditorClass = getDocScopedClass(
      CONFIG.CSS_CLASSES.MAIN_DOC_EDITOR,
      docId,
    );
    const existing = editorElement.nextElementSibling;

    if (
      existing &&
      existing.matches(
        `.${containerClass}[${CONFIG.ATTRIBUTES.DOC_ID}="${docId}"]`,
      )
    ) {
      // ======================================================================
      // 关闭拼接：清理 DOM 和内存引用
      // ======================================================================
      const data = this.concatContainers.get(docId);
      if (data) {
        // 1. 断开 observer
        if (data.observer) data.observer.disconnect();

        // 2. 清理 subdocElements 引用
        if (data.subDocIds && Array.isArray(data.subDocIds)) {
          for (const subDocId of data.subDocIds) {
            const containers = this.subdocElements.get(subDocId);
            if (containers && Array.isArray(containers)) {
              const filtered = containers.filter(
                (container) => container.parentElement !== data.container,
              );
              if (filtered.length === 0) {
                this.subdocElements.delete(subDocId);
              } else {
                this.subdocElements.set(subDocId, filtered);
              }
            }
          }
        }

        // 3. 删除主文档容器引用
        this.concatContainers.delete(docId);
      }

      // 4. 【关键修复】移除容器 DOM 元素
      existing.remove();

      // 5. 【关键修复】移除主文档编辑器 CSS 类
      editorElement.classList.remove(
        CONFIG.CSS_CLASSES.MAIN_DOC_EDITOR,
        mainDocEditorClass,
      );

      // 6. 更新块属性状态
      await this.blockService.setConcatState(docId, false);
    } else {
      // ======================================================================
      // 开启拼接
      // ======================================================================
      await this.enableConcat(docId, editorElement);
      await this.blockService.setConcatState(docId, true);
    }
  }

  /**
   * 启用拼接功能：获取子文档内容并插入到主文档下方
   * @param {string} docId - 当前文档 ID
   * @param {HTMLElement} editorElement - 编辑器元素
   * @returns {Promise<void>}
   */
  async enableConcat(docId, editorElement) {
    const mainDocEditorClass = getDocScopedClass(
      CONFIG.CSS_CLASSES.MAIN_DOC_EDITOR,
      docId,
    );
    editorElement.classList.add(
      CONFIG.CSS_CLASSES.MAIN_DOC_EDITOR,
      mainDocEditorClass,
    );

    // 移除已存在的容器并断开旧 observer
    const containerClass = getDocScopedClass(
      CONFIG.CSS_CLASSES.CONTAINER,
      docId,
    );
    const existing = editorElement.nextElementSibling;
    if (
      existing &&
      existing.matches(
        `.${containerClass}[${CONFIG.ATTRIBUTES.DOC_ID}="${docId}"]`,
      )
    ) {
      const oldData = this.concatContainers.get(docId);
      if (oldData && oldData.observer) oldData.observer.disconnect();
      existing.remove();
    }

    let subDocs = await this.documentService.getAllSubDocs(
      docId,
      1,
      this.config.maxDocumentHierarchyLevel,
    );
    if (subDocs.length === 0) return;

    if (
      this.config.maximumNumberOfDocuments > 0 &&
      subDocs.length > this.config.maximumNumberOfDocuments
    ) {
      subDocs = subDocs.slice(0, this.config.maximumNumberOfDocuments);
      showMessage(
        this.i18n.maximumNumberOfDocumentsReached.replace(
          /\{maximumNumberOfDocuments\}/g,
          this.config.maximumNumberOfDocuments,
        ),
        3000,
        "info",
      );
    }

    const container = this.componentService.createConcatContainer(
      docId,
      editorElement,
    );
    editorElement.insertAdjacentElement("afterend", container);

    // 并发渲染所有子文档的 HTML
    const results = await pLimit(
      subDocs,
      async (subDoc) => {
        const html = await this.documentService.renderSubDocHtml(subDoc.id);
        return { subDoc, html };
      },
      CONFIG.CONCURRENCY_LIMIT,
    );

    for (const { subDoc, html } of results) {
      const subDocContainer = this.componentService.createSubDocContainer(
        subDoc,
        editorElement,
      );
      const contentDiv = subDocContainer.querySelector(
        `.${CONFIG.CSS_CLASSES.SUBDOC_CONTENT}`,
      );
      if (contentDiv) {
        contentDiv.innerHTML = html;
        this.componentService.setContentEditable(contentDiv);
      }
      container.appendChild(subDocContainer);
      if (!this.subdocElements.has(subDoc.id)) {
        this.subdocElements.set(subDoc.id, []);
      }
      this.subdocElements.get(subDoc.id).push(subDocContainer);
    }

    container
      .querySelectorAll(`.${CONFIG.CSS_CLASSES.EDIT_LINK}`)
      .forEach((link) => {
        link.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          const id = link.getAttribute("data-id");
          if (id) this.documentService.openDocument(id);
        });
      });

    // 创建 ResizeObserver 监听编辑器样式变化
    const observer = new ResizeObserver(
      debounce(() => {
        this.updateSubdocStyles(docId);
      }, 100),
    );
    observer.observe(editorElement);

    // 存储容器、observer 和编辑器元素，便于后续更新和清理
    const subDocIds = results.map(({ subDoc }) => subDoc.id);
    this.concatContainers.set(docId, {
      container,
      observer,
      editorElement,
      subDocIds, // 新增：记录该主文档使用的子文档 ID 列表
    });

    // 立即同步一次样式
    this.updateSubdocStyles(docId);
    setTimeout(() => this.positionService.updatePositions(), 10);
  }

  /**
   * 更新指定文档的所有子文档容器样式，使其与主文档编辑器保持一致
   * @param {string} docId - 文档 ID
   */
  updateSubdocStyles(docId) {
    const data = this.concatContainers.get(docId);
    if (!data) return;
    const { container, editorElement } = data;
    if (!container || !editorElement) return;

    const editorStyle = editorElement.style.cssText;
    // 更新外部容器样式
    container.style.cssText = editorStyle;

    // 更新每个子文档项样式，并保留其特有的 paddingBottom（与编辑器 paddingTop 一致）
    const subItems = container.querySelectorAll(
      `.${CONFIG.CSS_CLASSES.SUBDOC_ITEM}`,
    );
    subItems.forEach((item) => {
      item.style.cssText = editorStyle;
      item.style.paddingBottom = editorElement.style.paddingTop;
    });
  }

  /**
   * 移除所有已插入的拼接容器
   */
  removeAllConcatContainers() {
    // 断开所有 observer
    for (const [docId, data] of this.concatContainers.entries()) {
      if (data.observer) data.observer.disconnect();
    }
    this.componentService.removeAllContainers(
      this.concatContainers,
      this.subdocElements,
    );
  }

  /**
   * 封装 API 调用（供外部使用）
   * @param {string} url - API 路径
   * @param {Object} data - 请求数据
   * @returns {Promise<Object>}
   */
  async callApi(url, data) {
    return this.apiService.callApi(url, data);
  }

  /**
   * 获取块属性（供外部使用）
   * @param {string} blockId - 块 ID
   * @returns {Promise<Object>}
   */
  async getBlockAttrs(blockId) {
    return this.apiService.getBlockAttrs(blockId);
  }

  /**
   * 设置块属性（供外部使用）
   * @param {string} blockId - 块 ID
   * @param {Object} attrs - 属性键值对
   * @returns {Promise<Object>}
   */
  async setBlockAttrs(blockId, attrs) {
    return this.apiService.setBlockAttrs(blockId, attrs);
  }

  /**
   * 获取块信息（供外部使用）
   * @param {string} blockId - 块 ID
   * @returns {Promise<Object|null>}
   */
  async getBlockInfo(blockId) {
    return this.apiService.getBlockInfo(blockId);
  }
};
