/**
 * @fileoverview 思源笔记子文档拼接插件（优化版，使用 Protyle 临时渲染）
 * @description 将当前文档的子文档内容拼接显示在主文档下方，支持多层级递归
 * @author yifeng
 * @version 1.0.11
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
 * @property {number} MAX_COUNT - 最大允许拼接的子文档数量上限
 * @property {number} MAX_LEVEL - 最大允许递归层级上限
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
  STORAGE_NAME: "concat-subdocs",
  MAX_COUNT: 500,
  MAX_LEVEL: 5,
  RENDER_DEBOUNCE_MS: 100,
  RENDER_TIMEOUT_MS: 2000,
  CONCURRENCY_LIMIT: 5,

  FLOATING_EDIT_BUTTON: {
    TOP: { MIN: 105, MAX: 500 },
    BOTTOM: { MIN: 50, MAX: 300 },
  },

  DEFAULT_CONFIG: {
    maxLevel: 1,
    maxCount: 10,
    floatingEditButtonTopDistance: 105,
    floatingEditButtonBottomDistance: 55,
    floatingEditButtonDirection: "right",
    showSubDocTitle: true,
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

  ICON: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="1 1 22 22"><path fill="currentColor" d="M3 14V9h8v5zm0-7V5q0-.825.588-1.412T5 3h14q.825 0 1.413.588T21 5v2zm2 14q-.825 0-1.412-.587T3 19v-3h8v5zm8-7V9h8v2.3q-.95-.425-2.025-.25t-1.875.975L15.125 14zm0 8v-3.075l5.525-5.5q.225-.225.5-.325t.55-.1q.3 0 .575.113t.5.337l.925.925q.2.225.313.5t.112.55t-.1.563t-.325.512l-5.5 5.5zm6.575-5.6l.925-.975l-.925-.925l-.95.95z"/>',

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
   * @param {number} maxLevel - 最大允许层级
   * @returns {Promise<Array>} 所有符合条件的子文档数组
   */
  async getAllSubDocs(parentDocId, currentLevel = 1, maxLevel = 1) {
    if (maxLevel > 0 && currentLevel > maxLevel) {
      return [];
    }

    const result = [];
    const directSubs = await this.getSubDocs(parentDocId);

    for (const sub of directSubs) {
      result.push(sub);
      const descendants = await this.getAllSubDocs(
        sub.id,
        currentLevel + 1,
        maxLevel,
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
    if (!confirm(this.plugin.i18n.clearConfirm)) return;

    showMessage(this.plugin.i18n.clearing, 5000);

    try {
      const sql = "SELECT id FROM blocks WHERE type = 'd'";
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

      this.cleanupCurrentTabs();
      showMessage(
        this.plugin.i18n.clearSuccess.replace(/\{count\}/g, processed),
        5000,
      );
    } catch (e) {
      console.error("清除拼接状态失败", e);
      showMessage(this.plugin.i18n.clearFail, 5000, "error");
    }
  }

  /**
   * 清理当前所有已打开标签页中插入的拼接容器
   */
  cleanupCurrentTabs() {
    if (this.plugin.app && this.plugin.app.workspace) {
      for (const tab of this.plugin.app.workspace.tabs) {
        const docId = tab.model?.documentId;
        if (docId && this.plugin.concatContainers.has(docId)) {
          const data = this.plugin.concatContainers.get(docId);
          if (data && data.container) data.container.remove();
          this.plugin.concatContainers.delete(docId);
        }
      }
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
    const containerClass = getDocScopedClass(CONFIG.CSS_CLASSES.CONTAINER, docId);
    const container = document.createElement("div");
    container.className = CONFIG.CSS_CLASSES.CONTAINER + " " + containerClass;
    container.setAttribute(CONFIG.ATTRIBUTES.DOC_ID, docId);
    container.contentEditable = "false";
    container.style.cssText = editorElement.style.cssText;

    const mainDocEditorClass = getDocScopedClass(CONFIG.CSS_CLASSES.MAIN_DOC_EDITOR, docId);
    const style = document.createElement("style");
    style.textContent = `
      .${mainDocEditorClass} {
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

    const containers = document.querySelectorAll(".concat-subdoc-item");

    containers.forEach((container) => {
      const editLink = container.querySelector(".concat-edit-link");
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
    this.plugin.setting.addItem(this.createClearStateSetting());
    this.plugin.setting.addItem(this.createMaxLevelSetting());
    this.plugin.setting.addItem(this.createMaxCountSetting());
    this.plugin.setting.addItem(this.createFloatingTopDistanceSetting());
    this.plugin.setting.addItem(this.createFloatingBottomDistanceSetting());
    this.plugin.setting.addItem(this.createShowSubDocTitleSetting());
    this.plugin.setting.addItem(this.createFloatingDirectionSetting());
  }

  /**
   * 创建“清除所有拼接状态”按钮项
   * @returns {Object} 设置项定义
   * @private
   */
  createClearStateSetting() {
    return {
      title: this.plugin.i18n.clearStatesTitle,
      description: this.plugin.i18n.clearStatesDesc,
      createActionElement: () => {
        const button = document.createElement("button");
        button.className = "b3-button b3-button--outline";
        button.textContent = this.plugin.i18n.clearStatesTitle;
        button.addEventListener("click", () =>
          this.plugin.stateService.clearAllConcatStates(),
        );
        return button;
      },
    };
  }

  /**
   * 创建最大层级设置项
   * @returns {Object} 设置项定义
   * @private
   */
  createMaxLevelSetting() {
    return this.createNumberInputSetting(
      this.plugin.i18n.maxLevelTitle,
      this.plugin.i18n.maxLevelDesc.replace(/\{maxLevel\}/g, CONFIG.MAX_LEVEL),
      "maxLevel",
      1,
      CONFIG.MAX_LEVEL,
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
      this.plugin.i18n.maxCountTitle,
      this.plugin.i18n.maxCountDesc.replace(/\{maxCount\}/g, CONFIG.MAX_COUNT),
      "maxCount",
      10,
      CONFIG.MAX_COUNT,
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
          this.plugin.config.showSubDocTitle = input.checked;
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
  createFloatingDirectionSetting() {
    return {
      title: this.plugin.i18n.floatingEditButtonDirectionTitle,
      description: this.plugin.i18n.floatingEditButtonDirectionDesc,
      direction: "row",
      createActionElement: () => {
        const container = document.createElement("div");

        const radioLeft = document.createElement("input");
        radioLeft.className = "b3-switch";
        radioLeft.style.marginRight = "8px";
        radioLeft.type = "radio";
        radioLeft.name = "direction";
        radioLeft.value = "left";
        radioLeft.id = "direction-left";

        const labelLeft = document.createElement("label");
        labelLeft.className = "b3-label--inner";
        labelLeft.htmlFor = "direction-left";
        labelLeft.textContent =
          this.plugin.i18n.floatingEditButtonDirectionLeft;
        radioLeft.checked =
          this.plugin.config.floatingEditButtonDirection === "left";

        radioLeft.addEventListener("change", () => {
          if (radioLeft.checked) {
            this.plugin.config.floatingEditButtonDirection = "left";
          }
        });

        const radioRight = document.createElement("input");
        radioRight.className = "b3-switch";
        radioRight.style.marginRight = "8px";
        radioRight.style.marginLeft = "8px";
        radioRight.type = "radio";
        radioRight.name = "direction";
        radioRight.value = "right";
        radioRight.id = "direction-right";

        const labelRight = document.createElement("label");
        labelRight.className = "b3-label--inner";
        labelRight.htmlFor = "direction-right";
        labelRight.textContent =
          this.plugin.i18n.floatingEditButtonDirectionRight;
        radioRight.checked =
          this.plugin.config.floatingEditButtonDirection === "right";

        radioRight.addEventListener("change", () => {
          if (radioRight.checked) {
            this.plugin.config.floatingEditButtonDirection = "right";
          }
        });

        container.appendChild(radioLeft);
        container.appendChild(labelLeft);
        container.appendChild(radioRight);
        container.appendChild(labelRight);

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
          this.plugin.config[configKey] = Math.min(val, max);
          input.value = this.plugin.config[configKey];
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
    this.concatContainers = new Map(); // 存储文档ID -> { container, observer, editorElement }
    this.subdocElements = new Map(); // 存储子文档ID -> DOM元素
    this.lastToggleTime = 0; // 防抖用的上次点击时间
    this.rafId = null; // requestAnimationFrame ID（未使用但保留）

    this.initServices();
    this.settingsService.init();
    this.eventListenerManager.registerWindowListeners();
    this.eventListenerManager.registerMutationObserver(
      debounce(() => this.positionService.updatePositions(), 10),
    );
    this.eventListenerManager.registerEventBusListeners();
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

    const enabled = await this.blockService.getConcatState(docId);
    this.componentService.createToggleButton(protyle, enabled, docId);

    const editorElement = protyle.wysiwyg.element;

    if (enabled) {
      const subDocs = await this.documentService.getSubDocs(docId);
      if (subDocs.length > 0) {
        await this.enableConcat(docId, editorElement).catch(console.error);
      } else {
        await this.blockService.setConcatState(docId, false);
      }
    } else {
      const mainDocEditorClass = getDocScopedClass(CONFIG.CSS_CLASSES.MAIN_DOC_EDITOR, docId);
      editorElement.classList.remove(mainDocEditorClass);

      const containerClass = getDocScopedClass(CONFIG.CSS_CLASSES.CONTAINER, docId);
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
      if (data && data.observer) data.observer.disconnect();
      this.concatContainers.delete(docId);
    }
  }

  /**
   * 处理 ws-main 事件（实时同步更新子文档内容）
   * @param {CustomEvent} event - 事件对象，detail 中包含操作数据
   */
  async handleWsMain(event) {
    const detail = event.detail;
    if (!detail || !detail.data || !Array.isArray(detail.data)) return;

    for (const item of detail.data) {
      if (!item.doOperations || !Array.isArray(item.doOperations)) continue;

      for (const op of item.doOperations) {
        if (!["update", "delete", "insert", "move"].includes(op.action))
          continue;

        const blockId = op.id;
        if (!blockId) continue;

        // 处理文档块删除：移除对应的子文档容器
        if (op.action === "delete" && op.type === "d") {
          const subdocContainer = document.querySelector(
            `.concat-subdoc-item[data-subdoc-id="${blockId}"]`,
          );
          if (subdocContainer) {
            subdocContainer.remove();
            this.subdocElements.delete(blockId);
          }
          continue;
        }

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
                `[data-node-id="${op.id}"]`,
              );
              if (element) {
                const ancestor = element.closest("[data-subdoc-id]");
                if (ancestor) rootId = ancestor.getAttribute("data-subdoc-id");
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
          const element = this.subdocElements.get(rootId);
          if (element?.parentNode) {
            const newHtml = await this.documentService.renderSubDocHtml(rootId);
            const contentDiv = element.querySelector(
              `.${CONFIG.CSS_CLASSES.SUBDOC_CONTENT}`,
            );
            if (contentDiv) {
              contentDiv.innerHTML = newHtml;
              this.componentService.setContentEditable(contentDiv);
            }
          }
        }
      }
    }
  }

  /**
   * 插件卸载时的清理
   * @override
   */
  onunload() {
    this.removeAllConcatContainers();
    this.eventListenerManager.cleanup();
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
  }

  /**
   * 保存插件配置
   * @returns {Promise<void>}
   */
  async saveConfig() {
    this.saveData(CONFIG.STORAGE_NAME, this.config)
      .then(() => {
        showMessage(this.i18n.configSavedSuccess, 2000);
      })
      .catch((error) => {
        showMessage(this.i18n.configSavedFail);
        console.error(error);
      });
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

    const containerClass = getDocScopedClass(CONFIG.CSS_CLASSES.CONTAINER, docId);
    const existing = editorElement.nextElementSibling;
    if (
      existing &&
      existing.matches(
        `.${containerClass}[${CONFIG.ATTRIBUTES.DOC_ID}="${docId}"]`,
      )
    ) {
      // 断开 observer 并移除容器
      const data = this.concatContainers.get(docId);
      if (data && data.observer) data.observer.disconnect();
      existing.remove();
      const mainDocEditorClass = getDocScopedClass(CONFIG.CSS_CLASSES.MAIN_DOC_EDITOR, docId);
      editorElement.classList.remove(mainDocEditorClass);
      this.concatContainers.delete(docId);
      await this.blockService.setConcatState(docId, false);
    } else {
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
    const mainDocEditorClass = getDocScopedClass(CONFIG.CSS_CLASSES.MAIN_DOC_EDITOR, docId);
    editorElement.classList.add(CONFIG.CSS_CLASSES.MAIN_DOC_EDITOR, mainDocEditorClass);

    // 移除已存在的容器并断开旧 observer
    const containerClass = getDocScopedClass(CONFIG.CSS_CLASSES.CONTAINER, docId);
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
      this.config.maxLevel,
    );
    if (subDocs.length === 0) return;

    if (this.config.maxCount > 0 && subDocs.length > this.config.maxCount) {
      subDocs = subDocs.slice(0, this.config.maxCount);
      showMessage(
        this.i18n.maxCountReached.replace(/\{count\}/g, this.config.maxCount),
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
      this.subdocElements.set(subDoc.id, subDocContainer);
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
    this.concatContainers.set(docId, { container, observer, editorElement });

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
