/**
 * @fileoverview 思源笔记子文档拼接插件
 * @description 将当前文档的子文档内容拼接显示在主文档下方，支持多层级递归
 * @author SiYuan Plugin Team
 * @version 1.0.0
 */

const { Plugin, showMessage, Setting } = require("siyuan");

/** 插件数据存储名称 */
const STORAGE_NAME = "concat-subdocs";

/** 拼接子文档最大数量限制 */
const MAX_COUNT = 500;

/** 递归获取子文档的最大层级深度 */
const MAX_LEVEL = 5;

/** 工具栏按钮图标 SVG */
const ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="1 1 22 22"><path fill="currentColor" d="M3 14V9h8v5zm0-7V5q0-.825.588-1.412T5 3h14q.825 0 1.413.588T21 5v2zm2 14q-.825 0-1.412-.587T3 19v-3h8v5zm8-7V9h8v2.3q-.95-.425-2.025-.25t-1.875.975L15.125 14zm0 8v-3.075l5.525-5.5q.225-.225.5-.325t.55-.1q.3 0 .575.113t.5.337l.925.925q.2.225.313.5t.112.55t-.1.563t-.325.512l-5.5 5.5zm6.575-5.6l.925-.975l-.925-.925l-.95.95z"/></svg>';

/**
 * 子文档拼接插件主类
 * 功能：将当前文档的子文档内容拼接显示在主文档下方
 * @extends Plugin
 */
module.exports = class ConcatSubDocsPlugin extends Plugin {
  /**
   * 插件加载时初始化
   * - 加载配置
   * - 初始化数据结构
   * - 注册事件监听
   * - 初始化设置面板
   * @returns {Promise<void>}
   */
  async onload() {
    await this.loadConfig(); // 加载配置
    this.concatContainers = new Map(); // 存储主文档 ID 与拼接容器的映射
    this.subdocElements = new Map(); // 存储子文档 ID 与其 DOM 元素的映射，用于快速更新
    this.lastToggleTime = 0; // 上次切换时间戳，用于防抖

    // 存储清理函数，用于卸载时移除事件监听
    this.cleanupFunctions = [];
    // 性能优化：存储当前鼠标 Y 坐标和当前悬停的容器
    this.currentMouseY = 0;
    this.currentHoverContainer = null;
    this.rafId = null; // requestAnimationFrame ID，用于动画帧调度

    // 添加顶部工具栏按钮（已禁用）
    // this.addTopBar({
    //   icon: ICON,
    //   title: this.i18n.toggleTitle,
    //   callback: () => this.toggleConcatForCurrentDoc(),
    // });

    // 初始化设置面板
    this.setting = new Setting({
      confirmCallback: async () => {
        await this.saveConfig();
      },
      destroyCallback: async () => {
        // 点取消时重新加载配置，以防用户修改了参数但未保存直接退出，导致内存配置与配置文件不一致
        await this.loadConfig();
      },
    });

    // 添加设置项：清除所有拼接状态
    this.setting.addItem({
      title: this.i18n.clearStatesTitle,
      description: this.i18n.clearStatesDesc,
      createActionElement: () => {
        const button = document.createElement("button");
        button.className = "b3-button b3-button--outline";
        button.textContent = this.i18n.clearStatesTitle;
        button.addEventListener("click", () => this.clearAllConcatStates());
        return button;
      },
    });

    // 添加设置项：拼接文档最大层级
    this.setting.addItem({
      title: this.i18n.maxLevelTitle,
      description: this.i18n.maxLevelDesc,
      direction: "row",
      createActionElement: () => {
        const input = document.createElement("input");
        input.type = "number";
        input.className = "b3-text-field";
        input.style.width = "100px";
        input.value = this.config.maxLevel;
        input.min = 1;
        input.step = 1;
        input.addEventListener("change", async () => {
          const val = parseInt(input.value, 10);
          if (isNaN(val) || val < 0) {
            input.value = this.config.maxLevel;
            return;
          }
          if (val > MAX_LEVEL) {
            input.value = MAX_LEVEL;
          }
          this.config.maxLevel = Math.min(val, MAX_LEVEL);
          // await this.saveData(STORAGE_NAME, this.config);
        });
        return input;
      },
    });

    // 添加设置项：拼接文档最大数量
    this.setting.addItem({
      title: this.i18n.maxCountTitle,
      description: this.i18n.maxCountDesc,
      direction: "row",
      createActionElement: () => {
        const input = document.createElement("input");
        input.type = "number";
        input.className = "b3-text-field";
        input.style.width = "100px";
        input.value = this.config.maxCount;
        input.min = 10;
        input.step = 5;
        input.addEventListener("change", async () => {
          const val = parseInt(input.value, 10);
          if (isNaN(val) || val < 10) {
            input.value = this.config.maxCount;
            return;
          }
          if (val > MAX_COUNT) {
            input.value = MAX_COUNT;
          }
          this.config.maxCount = Math.min(val, MAX_COUNT);
          // await this.saveData(STORAGE_NAME, this.config);
        });
        return input;
      },
    });

    // 创建位置刷新函数（用于滚动/resize 时更新编辑链接位置）
    const refreshPositions = () => {
      this.updateEditLinkPositions();
    };
    // 防抖处理，避免频繁触发
    const scrollHandler = this.debounce(refreshPositions, 10);
    const resizeHandler = this.debounce(refreshPositions, 10);

    // 鼠标移动处理器，用于追踪悬停容器
    const mouseMoveHandler = (e) => {
      this.currentMouseY = e.clientY;
      const hoverContainer = document
        .elementFromPoint(e.clientX, e.clientY)
        ?.closest(".concat-subdoc-item");
      this.currentHoverContainer = hoverContainer;

      // 使用 requestAnimationFrame 优化性能，避免频繁更新
      if (!this.rafId) {
        this.rafId = requestAnimationFrame(() => {
          this.updateEditLinkPositions();
          this.rafId = null;
        });
      }
    };

    // 监听 window 滚动和 resize
    window.addEventListener("scroll", scrollHandler, true);
    window.addEventListener("resize", resizeHandler);
    window.addEventListener("mousemove", mouseMoveHandler, { passive: true });

    // 思源笔记内部滚动容器监听（关键修复）
    const internalScrollContainers = [
      ".fn__flex-1",
      ".protyle",
      ".layout__tab-content",
      ".fn__flex-column",
    ];

    // 延迟绑定内部滚动监听（确保 DOM 已加载）
    setTimeout(() => {
      internalScrollContainers.forEach((selector) => {
        const containers = document.querySelectorAll(selector);
        containers.forEach((container) => {
          container.addEventListener("scroll", scrollHandler, {
            passive: true,
          });
          this.cleanupFunctions.push(() => {
            container.removeEventListener("scroll", scrollHandler);
          });
        });
      });
    }, 50);

    // 监听 DOM 变化，动态添加新的滚动容器监听
    const observer = new MutationObserver(() => {
      internalScrollContainers.forEach((selector) => {
        const containers = document.querySelectorAll(selector);
        containers.forEach((container) => {
          if (!container._hasScrollListener) {
            container.addEventListener("scroll", scrollHandler, {
              passive: true,
            });
            container._hasScrollListener = true;
            this.cleanupFunctions.push(() => {
              container.removeEventListener("scroll", scrollHandler);
            });
          }
        });
      });
    });

    observer.observe(document.body, { childList: true, subtree: true });
    this.cleanupFunctions.push(() => observer.disconnect());

    // 注册窗口事件清理函数
    this.cleanupFunctions.push(() => {
      window.removeEventListener("scroll", scrollHandler, true);
      window.removeEventListener("resize", resizeHandler);
      window.removeEventListener("mousemove", mouseMoveHandler);
      if (this.rafId) {
        cancelAnimationFrame(this.rafId);
      }
    });

    // 注册事件总线监听
    this.eventBus.on("loaded-protyle-dynamic", this.onProtyleLoaded.bind(this));
    this.eventBus.on("loaded-protyle-static", this.onProtyleLoaded.bind(this));
    this.eventBus.on("unload-doc", this.handleDocUnload.bind(this));
    // 新增：监听文档更新事件，实现内容实时同步
    this.eventBus.on("ws-main", this.handleWsMain.bind(this));
  }

  /**
   * 插件卸载时清理资源
   * - 移除所有拼接容器
   * - 注销事件监听
   * - 清理定时器
   */
  onunload() {
    this.removeAllConcatContainers();
    this.eventBus.off("loaded-protyle-dynamic", this.onProtyleLoaded);
    this.eventBus.off("loaded-protyle-static", this.onProtyleLoaded);
    this.eventBus.off("unload-doc", this.handleDocUnload);
    this.eventBus.off("ws-main", this.handleWsMain);
    // if (this.setting) this.setting.destroy();
    // 清理窗口事件监听器
    if (this.cleanupFunctions) {
      this.cleanupFunctions.forEach((fn) => fn());
      this.cleanupFunctions = [];
    }
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  /**
   * 插件卸载时删除插件数据
   */
  uninstall() {
    this.removeData(STORAGE_NAME)
      .then(() => {
        console.log(`卸载 [${this.name}] 删除 [${STORAGE_NAME}] 成功`);
      })
      .catch((e) => {
        console.error(
          `卸载 [${this.name}] 删除 [${STORAGE_NAME}] 失败： ${e.msg}`,
        );
      });
  }

  /**
   * 加载插件配置
   * @returns {Promise<void>}
   */
  async loadConfig() {
    this.config = {
      maxLevel: 1,
      maxCount: 10,
    };
    const saved = await this.loadData(STORAGE_NAME);
    if (saved) {
      this.config = { ...this.config, ...saved };
    }
  }
  /**
   * 保存配置
   */
  async saveConfig() {
    try {
      await this.saveData(STORAGE_NAME, this.config);
      showMessage(this.i18n.configSavedSuccess, 2000);
    } catch (error) {
      showMessage(this.i18n.configSavedFailed);
      console.error(error);
    }
  }
  /**
   * 处理 ws-main 事件，捕获块更新
   * 当子文档内容发生变化时，实时更新拼接显示
   * @param {Object} event - 事件对象
   */
  async handleWsMain(event) {
    const detail = event.detail;
    if (!detail || !detail.data || !Array.isArray(detail.data)) return;

    for (const item of detail.data) {
      if (!item.doOperations || !Array.isArray(item.doOperations)) continue;
      for (const op of item.doOperations) {
        // 只处理更新、删除、插入、移动操作
        if (
          op.action !== "update" &&
          op.action !== "delete" &&
          op.action !== "insert" &&
          op.action !== "move"
        )
          continue;

        const blockId = op.id;
        if (!blockId) continue;

        let rootId = null;
        try {
          if (op.action === "delete") {
            // 删除操作：通过父块 ID 获取根文档
            if (op.parentID) {
              const parentInfo = await this.getBlockInfo(op.parentID).catch(
                () => null,
              );
              if (parentInfo) rootId = parentInfo.rootID;
            } else {
              // 通过在文档中查找<div data-node-id="op.id"></div>元素，然后获取父元素
              const element = document.querySelector(
                `[data-node-id="${op.id}"]`,
              );
              if (element) {
                const ancestor = element.closest("[data-subdoc-id]");
                if (ancestor) {
                  rootId = ancestor.getAttribute("data-subdoc-id");
                }
              }
            }
          } else {
            // 其他操作：直接获取块信息
            const blockInfo = await this.getBlockInfo(blockId);
            if (blockInfo) rootId = blockInfo.rootID;
          }
        } catch (e) {
          console.warn("获取块信息失败，可能已删除", e);
          continue;
        }

        if (!rootId) continue;

        // 如果该子文档正在拼接显示中，则更新其内容
        if (this.subdocElements.has(rootId)) {
          const element = this.subdocElements.get(rootId);
          if (element?.parentNode) {
            const newContent = await this.getDocRenderedContent(rootId);
            const contentDiv = element.querySelector(".concat-subdoc-content");
            if (contentDiv) {
              contentDiv.innerHTML = newContent;
              this.setSubElementNotEditable(contentDiv);
            }
          }
        }
      }
    }
  }

  /**
   * 清除所有文档的拼接状态
   * 批量将所有文档的 custom-concat 属性设置为 false
   * @returns {Promise<void>}
   */
  async clearAllConcatStates() {
    if (!confirm(this.i18n.clearConfirm)) return;

    showMessage(this.i18n.clearing, 5000);

    try {
      // 查询所有文档块
      const sql = "SELECT id FROM blocks WHERE type = 'd'";
      const result = await this.callApi("/api/query/sql", { stmt: sql });
      if (!result || !Array.isArray(result) || result.length === 0) {
        showMessage(this.i18n.noDocFound, 3000, "info");
        return;
      }

      const docIds = result.map((row) => row.id);
      const total = docIds.length;
      let processed = 0;

      // 分批处理，避免单次请求过大
      const BATCH_SIZE = 50;
      for (let i = 0; i < docIds.length; i += BATCH_SIZE) {
        const batch = docIds.slice(i, i + BATCH_SIZE);
        const updates = batch.map((id) => ({
          id,
          data: { "custom-concat": "false" },
        }));
        await this.callApi("/api/attr/batchSetBlockAttrs", { updates });
        processed += batch.length;
      }

      // 清理当前打开的文档容器
      if (this.app && this.app.workspace) {
        const tabs = this.app.workspace.tabs;
        for (const tab of tabs) {
          const docId = tab.model?.documentId;
          if (docId && this.concatContainers.has(docId)) {
            const data = this.concatContainers.get(docId);
            if (data && data.container) {
              data.container.remove();
            }
            this.concatContainers.delete(docId);
          }
        }
      }

      showMessage(
        this.i18n.clearSuccess.replace(/\{count\}/g, processed),
        5000,
      );
    } catch (e) {
      console.error("清除拼接状态失败", e);
      showMessage(this.i18n.clearFail, 5000, "error");
    }
  }

  /**
   * 调用思源笔记 API
   * @param {string} url - API 路径
   * @param {Object} data - 请求数据
   * @returns {Promise<any>} API 响应数据
   */
  async callApi(url, data) {
    const response = await fetch(url, {
      method: "POST",
      body: JSON.stringify(data),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = await response.text();
    if (!text) return null;
    try {
      const json = JSON.parse(text);
      if (json.code !== 0) throw new Error(json.msg);
      return json.data;
    } catch (e) {
      console.error("API 解析失败", url, e);
      throw e;
    }
  }

  /**
   * 从 Protyle 元素获取文档 ID
   * @param {HTMLElement} protyleElement - Protyle 元素
   * @returns {string|null} 文档 ID
   */
  getDocIdFromElement(protyleElement) {
    const rootBlock = protyleElement.querySelector("[data-node-id]");
    return rootBlock ? rootBlock.getAttribute("data-node-id") : null;
  }

  /**
   * Protyle 加载完成时的处理
   * - 检查拼接状态
   * - 创建切换按钮
   * - 启用拼接（如果需要）
   * @param {Object} event - 事件对象
   */
  async onProtyleLoaded(event) {
    const protyle = event.detail.protyle;
    if (!protyle) return;
    const docId = this.getDocIdFromElement(protyle.element);
    if (!docId) return;

    const enabled = await this.getConcatState(docId);

    this.createToggleButton(protyle, enabled, docId);

    const editorElement = protyle.wysiwyg.element;
    if (enabled) {
      const subDocs = await this.getSubDocs(docId);
      if (subDocs.length > 0) {
        setTimeout(() => {
          this.enableConcat(docId, editorElement).catch(console.error);
        }, 10);
      } else {
        await this.setConcatState(docId, false);
      }
    } else {
      if (editorElement)
        editorElement.classList.remove("concat-maindoc-editor");
      const existing = editorElement.nextElementSibling;
      if (
        existing &&
        existing.matches(`.concat-subdocs-container[data-doc-id="${docId}"]`)
      ) {
        existing.remove(); // 存在则移除
      }
      this.concatContainers.delete(docId);
    }
  }

  /**
   * 创建拼接状态切换按钮
   * @param {Object} protyle - Protyle 实例
   * @param {boolean} enabled - 当前是否启用
   * @param {string} docId - 文档 ID
   */
  createToggleButton(protyle, enabled, docId) {
    const breadcrumb_bar = protyle.breadcrumb.element;
    const breadcrumb__space = breadcrumb_bar.nextElementSibling;
    if (
      breadcrumb__space &&
      breadcrumb__space.matches(".protyle-breadcrumb__space")
    ) {
      // 移除已存在的按钮
      const existing = breadcrumb__space.nextElementSibling;
      if (existing && existing.matches(".concat-toggle-button")) {
        existing.remove();
      }
      const toggleButton = document.createElement("button");
      toggleButton.innerHTML = ICON;
      toggleButton.className = `block__icon fn__flex-center ariaLabel concat-toggle-button ${enabled ? "concat-enabled" : ""}`;
      toggleButton.ariaLabel = this.i18n.toggleTitle;
      toggleButton.onclick = () => {
        this.toggleConcatForCurrentDoc();
        this.getConcatState(docId).then((enabled) => {
          toggleButton.classList.toggle("concat-enabled", !enabled);
        });
      };
      breadcrumb__space.insertAdjacentElement("afterend", toggleButton);
    }
  }

  /**
   * 文档卸载时的处理
   * @param {Object} event - 事件对象
   */
  handleDocUnload(event) {
    const { docId } = event.detail;
    if (docId) {
      this.concatContainers.delete(docId);
      // 清理 subdocElements 中属于该文档的子文档（可选，但不需要，因为子文档元素会被移除）
    }
  }

  /**
   * 切换当前文档的拼接状态
   * @returns {Promise<void>}
   */
  async toggleConcatForCurrentDoc() {
    // 防抖：避免快速连续点击
    const now = Date.now();
    if (now - this.lastToggleTime < 100) return;
    this.lastToggleTime = now;

    const visibleProtyle = document.querySelector(".protyle:not(.fn__none)");
    if (!visibleProtyle) {
      showMessage(this.i18n.noCurrentDoc, 3000, "error");
      return;
    }

    const docId = this.getDocIdFromElement(visibleProtyle);
    if (!docId) {
      showMessage(this.i18n.noDocId, 3000, "error");
      return;
    }

    const editorElement = visibleProtyle.querySelector(".protyle-wysiwyg");
    if (!editorElement) {
      showMessage(this.i18n.editorUnavailable, 3000, "error");
      return;
    }

    const subDocs = await this.getSubDocs(docId);
    if (subDocs.length === 0) {
      showMessage(this.i18n.noSubDocs, 3000, "info");
      return;
    }

    // 检查是否已存在拼接容器
    const existing = editorElement.nextElementSibling;
    if (
      existing &&
      existing.matches(`.concat-subdocs-container[data-doc-id="${docId}"]`)
    ) {
      // 存在则移除，关闭拼接
      existing.remove();
      editorElement.classList.remove("concat-maindoc-editor");
      this.concatContainers.delete(docId);
      await this.setConcatState(docId, false);
    } else {
      // 不存在则启用拼接
      await this.enableConcat(docId, editorElement);
      await this.setConcatState(docId, true);
    }
  }

  /**
   * 获取文档的拼接状态
   * @param {string} docId - 文档 ID
   * @returns {Promise<boolean>} 是否启用拼接
   */
  async getConcatState(docId) {
    try {
      const attrs = await this.getBlockAttrs(docId);
      return attrs["custom-concat"] === "true";
    } catch {
      return false;
    }
  }

  /**
   * 设置文档的拼接状态
   * @param {string} docId - 文档 ID
   * @param {boolean} state - 状态值
   * @returns {Promise<void>}
   */
  async setConcatState(docId, state) {
    try {
      await this.setBlockAttrs(docId, {
        "custom-concat": state ? "true" : "false",
      });
    } catch (e) {
      console.error(`设置文档 ${docId} 拼接状态失败`, e);
    }
  }

  /**
   * 获取块的属性
   * @param {string} blockId - 块 ID
   * @returns {Promise<Object>} 属性对象
   */
  async getBlockAttrs(blockId) {
    return this.callApi("/api/attr/getBlockAttrs", { id: blockId });
  }

  /**
   * 设置块的属性
   * @param {string} blockId - 块 ID
   * @param {Object} attrs - 属性对象
   * @returns {Promise<Object>} API 响应
   */
  async setBlockAttrs(blockId, attrs) {
    return this.callApi("/api/attr/setBlockAttrs", { id: blockId, attrs });
  }

  /**
   * 递归获取所有子文档（支持多层级）
   * @param {string} parentDocId - 父文档 ID
   * @param {number} currentLevel - 当前层级
   * @returns {Promise<Array>} 子文档数组
   */
  async getAllSubDocs(parentDocId, currentLevel = 1) {
    // 检查是否超过最大层级
    if (this.config.maxLevel > 0 && currentLevel > this.config.maxLevel) {
      return [];
    }
    const result = [];
    const directSubs = await this.getSubDocs(parentDocId);
    for (const sub of directSubs) {
      result.push(sub);
      // 递归获取下级子文档
      const descendants = await this.getAllSubDocs(sub.id, currentLevel + 1);
      result.push(...descendants);
    }
    return result;
  }

  /**
   * 获取直接子文档列表
   * 优先使用 listDocsByPath API，失败时降级为 SQL 查询
   * @param {string} parentDocId - 父文档 ID
   * @returns {Promise<Array>} 子文档数组
   */
  async getSubDocs(parentDocId) {
    try {
      const parentDoc = await this.getBlockInfo(parentDocId);
      if (!parentDoc) return [];

      const notebookId = parentDoc.box; // 笔记本 ID
      const parentPath = parentDoc.path; // 父文档路径

      // 调用正确的 API
      const data = await this.callApi("/api/filetree/listDocsByPath", {
        notebook: notebookId,
        path: parentPath,
      });

      if (data && data.files && Array.isArray(data.files)) {
        // files 数组已经按文件树顺序排列，直接返回
        return data.files.map((file) => ({
          id: file.id,
          name: file.name.replace(/\.sy$/, ""), // 去除 .sy 后缀
          path: file.path,
        }));
      }
    } catch (e) {
      console.warn("listDocsByPath 失败，降级为 SQL 排序", e);
    }

    // 降级方案：使用 SQL 查询并按 sort 排序（作为备用）
    try {
      const parentDoc = await this.getBlockInfo(parentDocId);
      if (!parentDoc) return [];
      const parentPath = parentDoc.path;
      const parentDir = parentPath.replace(/\.sy$/, "");
      const sql = `
                SELECT id, name, path
                FROM blocks
                WHERE path LIKE '${parentDir}/%'
                AND type = 'd'
                AND path NOT LIKE '${parentDir}/%/%'
                ORDER BY sort ASC
            `;
      const result = await this.callApi("/api/query/sql", { stmt: sql });
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
   * 移除 Markdown 内容中的 Front Matter（YAML 头）
   * @param {string} markdown - Markdown 内容
   * @returns {string} 处理后的内容
   */
  stripFrontMatter(markdown) {
    if (typeof markdown !== "string") return markdown;
    const lines = markdown.split("\n");
    if (lines.length > 0 && lines[0].trim() === "---") {
      let endIndex = -1;
      for (let i = 1; i < lines.length; i++) {
        if (lines[i].trim() === "---") {
          endIndex = i;
          break;
        }
      }
      if (endIndex !== -1) {
        lines.splice(0, endIndex + 1);
        return lines.join("\n").trim();
      }
    }
    return markdown;
  }

  /**
   * 使用 Lute 渲染 Markdown 为 HTML
   * @param {string} markdown - Markdown 内容
   * @returns {string|null} HTML 内容
   */
  renderMarkdownWithLute(markdown) {
    if (!window.Lute) return null;
    try {
      const lute = window.Lute.New();
      if (lute && typeof lute.MarkdownStr === "function") {
        return lute.MarkdownStr("", markdown);
      } else if (lute && typeof lute.Md2HTML === "function") {
        return lute.Md2HTML(markdown);
      }
    } catch (e) {
      console.error("Lute 渲染失败", e);
    }
    return null;
  }

  /**
   * 获取文档渲染后的 HTML 内容
   * 优先级：getDoc API > Lute 渲染 > 纯文本
   * @param {string} docId - 文档 ID
   * @returns {Promise<string>} HTML 内容
   */
  async getDocRenderedContent(docId) {
    // 优先使用 getDoc 获取已渲染的 HTML
    try {
      const data = await this.callApi("/api/filetree/getDoc", { id: docId });
      if (data && data.content) {
        return data.content;
      }
    } catch (e) {
      console.warn("getDoc 失败，降级为 Lute 渲染", e);
    }

    // 降级方案：使用 Lute 渲染 Markdown
    console.log(`文档 ${docId} 降级为 Lute 渲染`);
    try {
      const mdData = await this.callApi("/api/export/exportMdContent", {
        id: docId,
      });
      if (mdData && mdData.content) {
        let markdown = mdData.content;
        markdown = this.stripFrontMatter(markdown);
        const html = this.renderMarkdownWithLute(markdown);
        if (html) return html;
        return `<pre>${markdown}</pre>`;
      }
    } catch {}

    // 最后降级为纯文本
    console.log(`文档 ${docId} 降级为纯文本`);
    try {
      const mdData = await this.callApi("/api/export/exportMdContent", {
        id: docId,
      });
      if (mdData && mdData.content) {
        let markdown = mdData.content;
        markdown = this.stripFrontMatter(markdown);
        return `<pre>${markdown}</pre>`;
      }
    } catch (e) {
      console.error("获取文档内容失败", docId, e);
    }
    return `<p>${this.i18n.loadSubDocfailed}</p>`;
  }

  /**
   * 启用文档拼接功能
   * 创建拼接容器并渲染所有子文档内容
   * @param {string} docId - 主文档 ID
   * @param {HTMLElement} editorElement - 编辑器元素
   * @returns {Promise<void>}
   */
  async enableConcat(docId, editorElement) {
    editorElement.classList.add("concat-maindoc-editor");

    // 移除已存在的拼接容器
    const existing = editorElement.nextElementSibling;
    if (
      existing &&
      existing.matches(`.concat-subdocs-container[data-doc-id="${docId}"]`)
    ) {
      existing.remove();
    }

    // 获取所有子文档
    let subDocs = await this.getAllSubDocs(docId);
    if (subDocs.length === 0) return;

    // 检查是否超过最大数量限制
    if (this.config.maxCount > 0 && subDocs.length > this.config.maxCount) {
      subDocs = subDocs.slice(0, this.config.maxCount);
      showMessage(
        this.i18n.maxCountReached.replace(/\{count\}/g, this.config.maxCount),
        3000,
        "info",
      );
    }

    // 创建拼接容器
    const container = document.createElement("div");
    container.className = "concat-subdocs-container";
    container.setAttribute("data-doc-id", docId);
    container.contentEditable = "false";
    container.style.cssText = editorElement.style.cssText;
    editorElement.insertAdjacentElement("afterend", container);

    // 并行获取所有子文档内容
    const promises = subDocs.map(async (subDoc) => {
      const content = await this.getDocRenderedContent(subDoc.id);
      return { ...subDoc, content };
    });
    const docsWithContent = await Promise.all(promises);

    // 渲染每个子文档
    for (const subDoc of docsWithContent) {
      const subDocContainer = document.createElement("div");
      subDocContainer.classList.add(
        "protyle-wysiwyg",
        "concat-subdoc-item",
        "protyle-custom",
      );
      subDocContainer.setAttribute("data-subdoc-id", subDoc.id);

      // 创建标题
      const header = document.createElement("div");
      header.className = "protyle-title__input";
      header.textContent = subDoc.name || this.i18n.subDocTitle;
      header.contentEditable = "false";
      subDocContainer.appendChild(header);

      // 创建内容区域
      const contentDiv = document.createElement("div");
      contentDiv.className = "concat-subdoc-content protyle-wysiwyg";
      contentDiv.innerHTML = subDoc.content;
      contentDiv.contentEditable = "false";

      // 将所有后代元素设置为只读
      this.setSubElementNotEditable(contentDiv);

      // 创建编辑链接（思源原生块引用，实现悬停预览）
      const editLink = document.createElement("span");
      editLink.className = "concat-edit-link";
      editLink.setAttribute("data-type", "block-ref");
      editLink.setAttribute("data-id", subDoc.id);
      editLink.title = this.i18n.editLinkTitle;
      editLink.innerHTML =
        '<svg class="icon" style="width:16px;height:16px"><use xlink:href="#iconEdit"></use></svg>';

      subDocContainer.appendChild(contentDiv);
      subDocContainer.appendChild(editLink);
      container.appendChild(subDocContainer);

      // 存储子文档元素映射
      this.subdocElements.set(subDoc.id, subDocContainer);
    }

    // 绑定编辑链接点击事件
    container.querySelectorAll(".concat-edit-link").forEach((link) => {
      link.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const id = link.getAttribute("data-id");
        if (id) this.openDocument(id);
      });
    });

    this.concatContainers.set(docId, { container });
    // 初始化 editLink 和浮动按钮位置
    setTimeout(() => {
      this.updateEditLinkPositions();
    }, 10);
  }

  /**
   * 将子文档内容区域的所有元素设置为不可编辑
   * @param {HTMLElement} contentDiv - 内容区域元素
   */
  setSubElementNotEditable(contentDiv) {
    const allElements = contentDiv.querySelectorAll("*");
    allElements.forEach((el) => {
      el.contentEditable = "false";
    });
  }

  /**
   * 移除所有拼接容器
   */
  removeAllConcatContainers() {
    for (const docId of this.concatContainers.keys()) {
      const data = this.concatContainers.get(docId);
      data.container?.parentNode?.removeChild(data.container);
      this.concatContainers.delete(docId);
    }
    this.subdocElements.clear(); // 清空映射
  }

  /**
   * 在新标签页打开文档
   * @param {string} docId - 文档 ID
   */
  openDocument(docId) {
    window.open(`siyuan://blocks/${docId}`, "_blank");
  }

  /**
   * 获取块信息
   * @param {string} blockId - 块 ID
   * @returns {Promise<Object|null>} 块信息对象
   */
  async getBlockInfo(blockId) {
    try {
      return await this.callApi("/api/block/getBlockInfo", { id: blockId });
    } catch {
      return null;
    }
  }

  /**
   * 更新所有编辑链接的位置
   * 根据容器位置和视口大小动态调整链接位置，确保始终可见
   */
  updateEditLinkPositions() {
    const editLinkHeight = 28;
    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;

    // 屏幕安全边距（避开顶部工具栏和底部状态栏）
    const TOP_SAFE = 105;
    const BOTTOM_SAFE = 45;
    const HORIZONTAL_SAFE = 20; // 水平方向最小留白

    // 预估浮窗宽度（仅用于水平左移判断）
    const FLOAT_WIDTH = 320;

    // 水平左移阈值：右侧空间小于此值时切换到左侧
    const LEFT_SHIFT_THRESHOLD = 50;

    const containers = document.querySelectorAll(".concat-subdoc-item");
    const viewportCenterY = viewportHeight / 2; // 窗口垂直中心

    containers.forEach((container) => {
      const editLink = container.querySelector(".concat-edit-link");
      if (!editLink) return;

      const containerRect = container.getBoundingClientRect();
      const containerTop = containerRect.top;
      const containerHeight = containerRect.height;
      const containerBottom = containerRect.bottom;

      // ----- 水平方向：优先右侧，仅当右侧空间极小时才左移 -----
      const screenRightSpace = viewportWidth - containerRect.right;
      if (screenRightSpace < LEFT_SHIFT_THRESHOLD) {
        editLink.classList.add("concat-edit-link--left");
      } else {
        editLink.classList.remove("concat-edit-link--left");
      }

      // 容器完全不可见，保持默认位置
      if (containerBottom < 0 || containerTop > viewportHeight) {
        editLink.style.transform = `translateY(${TOP_SAFE}px)`;
        return;
      }

      // ----- 计算链接在容器内的垂直安全范围 -----
      const visibleTop = Math.max(0, containerTop);
      const visibleBottom = Math.min(viewportHeight, containerBottom);

      const minTopVisible = visibleTop - containerTop;
      const maxTopVisible = visibleBottom - containerTop - editLinkHeight;

      const minTopScreen = TOP_SAFE - containerTop;
      const maxTopScreen =
        viewportHeight - BOTTOM_SAFE - editLinkHeight - containerTop;

      let minTop = Math.max(minTopVisible, minTopScreen);
      let maxTop = Math.min(maxTopVisible, maxTopScreen);

      if (minTop > maxTop) {
        minTop = minTopVisible;
        maxTop = maxTopVisible;
      }

      minTop = Math.max(0, Math.min(minTop, containerHeight - editLinkHeight));
      maxTop = Math.max(0, Math.min(maxTop, containerHeight - editLinkHeight));
      if (minTop > maxTop) {
        const fallback = Math.min(containerHeight - editLinkHeight, TOP_SAFE);
        editLink.style.transform = `translateY(${fallback}px)`;
        return;
      }

      // ----- 根据窗口垂直中心与容器的关系决定链接靠上还是靠下 -----
      let preferTop; // true=放顶部，false=放底部

      // 特殊规则：容器高度超过视窗且上下边缘均超出时，优先放到底部
      if (containerTop < 0 && containerBottom > viewportHeight) {
        preferTop = false;
      } else {
        // 判断容器相对于窗口垂直中心的位置
        if (containerBottom < viewportCenterY) {
          // 容器整体在窗口中心上方 → 链接靠上
          preferTop = true;
        } else if (containerTop > viewportCenterY) {
          // 容器整体在窗口中心下方 → 链接靠下
          preferTop = false;
        } else {
          // 窗口中心在容器内部 → 比较上下边离中心的距离
          const distTop = viewportCenterY - containerTop;
          const distBottom = containerBottom - viewportCenterY;
          preferTop = distTop > distBottom;
        }
      }

      let finalTop = preferTop ? minTop : maxTop;

      // 最终验证：确保链接绝对位置符合屏幕安全边距
      const linkAbsTop = containerTop + finalTop;
      const linkAbsBottom = linkAbsTop + editLinkHeight;
      if (linkAbsTop < TOP_SAFE) {
        finalTop += TOP_SAFE - linkAbsTop;
      }
      if (linkAbsBottom > viewportHeight - BOTTOM_SAFE) {
        finalTop -= linkAbsBottom - (viewportHeight - BOTTOM_SAFE);
      }

      // 最后约束到 [minTop, maxTop] 范围内
      finalTop = Math.max(minTop, Math.min(maxTop, finalTop));

      editLink.style.transform = `translateY(${finalTop}px)`;
    });
  }

  /**
   * 防抖函数
   * @param {Function} func - 需要防抖的函数
   * @param {number} wait - 等待时间（毫秒）
   * @returns {Function} 防抖后的函数
   */
  debounce(func, wait) {
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
};
