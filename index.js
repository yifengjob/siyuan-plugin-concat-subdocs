const { Plugin, showMessage, Setting } = require('siyuan');

module.exports = class ConcatSubDocsPlugin extends Plugin {

    async onload() {
        this.config = {
            maxLevel: 1,
            maxCount: 10,
        };
        await this.loadConfig(); // 加载配置
        this.concatContainers = new Map();
        this.subdocElements = new Map(); // 存储子文档ID与其DOM元素的映射，用于快速更新
        this.lastToggleTime = 0;

        // 添加顶部工具栏按钮
        this.addTopBar({
            icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="1 1 22 22"><path fill="currentColor" d="M3 14V9h8v5zm0-7V5q0-.825.588-1.412T5 3h14q.825 0 1.413.588T21 5v2zm2 14q-.825 0-1.412-.587T3 19v-3h8v5zm8-7V9h8v2.3q-.95-.425-2.025-.25t-1.875.975L15.125 14zm0 8v-3.075l5.525-5.5q.225-.225.5-.325t.55-.1q.3 0 .575.113t.5.337l.925.925q.2.225.313.5t.112.55t-.1.563t-.325.512l-5.5 5.5zm6.575-5.6l.925-.975l-.925-.925l-.95.95z"/></svg>',
            title: this.i18n.toggleTitle,
            callback: () => this.toggleConcatForCurrentDoc(),
        });

        // 初始化设置
        this.setting = new Setting({
            confirmCallback: () => this.saveConfig(),
        });
        // 添加设置项：清除所有拼接状态
        this.setting.addItem({
            title: this.i18n.clearStatesTitle,
            description: this.i18n.clearStatesDesc,
            createActionElement: () => {
                const button = document.createElement('button');
                button.className = 'b3-button b3-button--outline';
                button.textContent = this.i18n.clearStatesTitle;
                button.addEventListener('click', () => this.clearAllConcatStates());
                return button;
            },
        });

        // 添加设置项：拼接文档最大层级
        this.setting.addItem({
            title: this.i18n.maxLevelTitle,
            description: this.i18n.maxLevelDesc,
            direction: 'row',
            createActionElement: () => {
                const input = document.createElement('input');
                input.type = 'number';
                input.className = 'b3-text-field';
                input.style.width = '100px';
                input.value = this.config.maxLevel;
                input.min = 1;
                input.step = 1;
                input.addEventListener('change', async () => {
                    const val = parseInt(input.value, 10);
                    if (isNaN(val) || val < 0) {
                        input.value = this.config.maxLevel;
                        return;
                    }
                    if (val > 3) {
                        input.value = 3;
                    }
                    this.config.maxLevel = Math.min(val, 3);
                    await this.saveData('config', this.config);
                });
                return input;
            },
        });

        // 添加设置项：拼接文档最大数量
        this.setting.addItem({
            title: this.i18n.maxCountTitle,
            description: this.i18n.maxCountDesc,
            direction: 'row',
            createActionElement: () => {
                const input = document.createElement('input');
                input.type = 'number';
                input.className = 'b3-text-field';
                input.style.width = '100px';
                input.value = this.config.maxCount;
                input.min = 10;
                input.step = 5;
                input.addEventListener('change', async () => {
                    const val = parseInt(input.value, 10);
                    if (isNaN(val) || val < 10) {
                        input.value = this.config.maxCount;
                        return;
                    }
                    if (val > 500) {
                        input.value = 500;
                    }
                    this.config.maxCount = Math.min(val, 500);
                    await this.saveData('config', this.config);
                });
                return input;
            }
        })

        this.eventBus.on('loaded-protyle-dynamic', this.onProtyleLoaded.bind(this));
        this.eventBus.on('loaded-protyle-static', this.onProtyleLoaded.bind(this));
        this.eventBus.on('unload-doc', this.handleDocUnload.bind(this));
        // 新增：监听文档更新事件
        this.eventBus.on('ws-main', this.handleWsMain.bind(this));
    }

    onunload() {
        this.removeAllConcatContainers();
        this.eventBus.off('loaded-protyle-dynamic', this.onProtyleLoaded);
        this.eventBus.off('loaded-protyle-static', this.onProtyleLoaded);
        this.eventBus.off('unload-doc', this.handleDocUnload);
        this.eventBus.off('ws-main', this.handleWsMain);
        // if (this.setting) this.setting.destroy();
    }
    async loadConfig() {
        const saved = await this.loadData('config');
        console.log('saved max level：', saved);
        if (saved) {
            this.config = { ...this.config, ...saved };
        }
    }

    async saveConfig() {
        await this.saveData('config', this.config);
    }
    // 处理 ws-main 事件，捕获块更新
    async handleWsMain(event) {
        const detail = event.detail;
        if (!detail || !detail.data || !Array.isArray(detail.data)) return;

        // 遍历每个操作
        for (const item of detail.data) {
            if (!item.doOperations || !Array.isArray(item.doOperations)) continue;
            for (const op of item.doOperations) {
                // 关注更新操作（action === 'update'）
                if (op.action !== 'update') continue;

                // 获取更新的块 ID
                const blockId = op.id;
                if (!blockId) continue;

                // 检查该块是否属于某个子文档（可能是文档本身或文档内的块）
                // 我们需要找到其根文档 ID
                try {
                    const blockInfo = await this.getBlockInfo(blockId);
                    if (!blockInfo) continue;
                    const rootId = blockInfo.rootID;
                    if (!rootId) continue;

                    // 如果根文档 ID 是我们正在拼接的某个子文档，则刷新它
                    if (this.subdocElements.has(rootId)) {
                        const element = this.subdocElements.get(rootId);
                        if (element && element.parentNode) {
                            // 重新获取内容并更新
                            const newContent = await this.getDocRenderedContent(rootId);
                            const contentDiv = element.querySelector('.concat-subdoc-content');
                            if (contentDiv) {
                                contentDiv.innerHTML = newContent;
                                // 设置子文档内容不可编辑
                                this.setSubElementNotEditable(contentDiv);
                            }
                        }
                    }
                } catch (e) {
                    console.error('处理更新事件失败', e);
                }
            }
        }
    }

    // 清除所有文档的拼接状态
    async clearAllConcatStates() {
        if (!confirm(this.i18n.clearConfirm)) return;

        showMessage(this.i18n.clearing, 5000);

        try {
            const sql = "SELECT id FROM blocks WHERE type = 'd'";
            const result = await this.callApi('/api/query/sql', { stmt: sql });
            if (!result || !Array.isArray(result) || result.length === 0) {
                showMessage(this.i18n.noDocFound, 3000, 'info');
                return;
            }

            const docIds = result.map(row => row.id);
            const total = docIds.length;
            let processed = 0;

            const BATCH_SIZE = 50;
            for (let i = 0; i < docIds.length; i += BATCH_SIZE) {
                const batch = docIds.slice(i, i + BATCH_SIZE);
                const updates = batch.map(id => ({
                    id,
                    data: { 'custom-concat': 'false' },
                }));
                await this.callApi('/api/attr/batchSetBlockAttrs', { updates });
                processed += batch.length;
            }

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

            showMessage(this.i18n.clearSuccess.replace('{count}', processed), 5000);
        } catch (e) {
            console.error('清除拼接状态失败', e);
            showMessage(this.i18n.clearFail, 5000, 'error');
        }
    }

    async callApi(url, data) {
        const response = await fetch(url, {
            method: 'POST',
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
            console.error('API解析失败', url, e);
            throw e;
        }
    }

    getDocIdFromElement(protyleElement) {
        const rootBlock = protyleElement.querySelector('[data-node-id]');
        return rootBlock ? rootBlock.getAttribute('data-node-id') : null;
    }

    async onProtyleLoaded(event) {
        const protyle = event.detail.protyle;
        if (!protyle) return;
        const docId = this.getDocIdFromElement(protyle.element);
        if (!docId) return;

        const enabled = await this.getConcatState(docId);
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
            if (editorElement) editorElement.classList.remove('concat-maindoc-editor');
            const existing = editorElement.nextElementSibling;
            if (existing && existing.matches(`.concat-subdocs-container[data-doc-id="${docId}"]`)) {
                existing.remove(); // 存在则移除
            }
            this.concatContainers.delete(docId);
        }
    }

    handleDocUnload(event) {
        const { docId } = event.detail;
        if (docId) {
            this.concatContainers.delete(docId);
            // 清理 subdocElements 中属于该文档的子文档（可选，但不需要，因为子文档元素会被移除）
        }
    }

    async toggleConcatForCurrentDoc() {
        const now = Date.now();
        if (now - this.lastToggleTime < 100) return;
        this.lastToggleTime = now;

        const visibleProtyle = document.querySelector('.protyle:not(.fn__none)');
        if (!visibleProtyle) {
            showMessage(this.i18n.noCurrentDoc, 3000, 'error');
            return;
        }

        const docId = this.getDocIdFromElement(visibleProtyle);
        if (!docId) {
            showMessage(this.i18n.noDocId, 3000, 'error');
            return;
        }

        const editorElement = visibleProtyle.querySelector('.protyle-wysiwyg');
        if (!editorElement) {
            showMessage(this.i18n.editorUnavailable, 3000, 'error');
            return;
        }

        const subDocs = await this.getSubDocs(docId);
        if (subDocs.length === 0) {
            showMessage(this.i18n.noSubDocs, 3000, 'info');
            return;
        }

        const existing = editorElement.nextElementSibling;
        if (existing && existing.matches(`.concat-subdocs-container[data-doc-id="${docId}"]`)) {
            existing.remove();
            editorElement.classList.remove('concat-maindoc-editor');
            this.concatContainers.delete(docId);
            await this.setConcatState(docId, false);
        } else {
            await this.enableConcat(docId, editorElement);
            await this.setConcatState(docId, true);
        }

    }

    async getConcatState(docId) {
        try {
            const attrs = await this.getBlockAttrs(docId);
            return attrs['custom-concat'] === 'true';
        } catch { return false; }
    }

    async setConcatState(docId, state) {
        try {
            await this.setBlockAttrs(docId, { 'custom-concat': state ? 'true' : 'false' });
        } catch (e) {
            console.error(`设置文档 ${docId} 拼接状态失败`, e);
        }
    }

    async getBlockAttrs(blockId) {
        return this.callApi('/api/attr/getBlockAttrs', { id: blockId });
    }

    async setBlockAttrs(blockId, attrs) {
        return this.callApi('/api/attr/setBlockAttrs', { id: blockId, attrs });
    }

    async getAllSubDocs(parentDocId, currentLevel = 1) {
        if (this.config.maxLevel > 0 && currentLevel > this.config.maxLevel) {
            return [];
        }
        const result = [];
        const directSubs = await this.getSubDocs(parentDocId);
        for (const sub of directSubs) {
            result.push(sub);
            const descendants = await this.getAllSubDocs(sub.id, currentLevel + 1);
            result.push(...descendants);
        }
        return result;
    }
    async getSubDocs(parentDocId) {
        try {
            const parentDoc = await this.getBlockInfo(parentDocId);
            if (!parentDoc) return [];

            const notebookId = parentDoc.box;      // 笔记本 ID，如 "20260226211740-1wsng5r"
            const parentPath = parentDoc.path;     // 父文档路径，如 "/20260301155859-ywn4crv/20260303160555-jz989fv.sy"

            // 调用正确的 API
            const data = await this.callApi('/api/filetree/listDocsByPath', {
                notebook: notebookId,
                path: parentPath,
                // app 参数不是必需的，但可以保留
            });

            if (data && data.files && Array.isArray(data.files)) {
                // files 数组已经按文件树顺序排列，直接返回
                return data.files.map(file => ({
                    id: file.id,
                    name: file.name.replace(/\.sy$/, ''), // 去除 .sy 后缀，保持原名
                    path: file.path,
                }));
            }
        } catch (e) {
            console.warn('listDocsByPath 失败，降级为 SQL 排序', e);
        }

        // 降级方案：使用 SQL 查询并按 sort 排序（作为备用）
        try {
            const parentDoc = await this.getBlockInfo(parentDocId);
            if (!parentDoc) return [];
            const parentPath = parentDoc.path;
            const parentDir = parentPath.replace(/\.sy$/, '');
            const sql = `
                SELECT id, name, path
                FROM blocks
                WHERE path LIKE '${parentDir}/%'
                AND type = 'd'
                AND path NOT LIKE '${parentDir}/%/%'
                ORDER BY sort ASC
            `;
            const result = await this.callApi('/api/query/sql', { stmt: sql });
            if (result && result.length > 0) {
                return result.map(row => ({ id: row.id, name: row.name || '', path: row.path }));
            }
        } catch (e) {
            console.error('获取子文档失败', e);
        }
        return [];
    }

    stripFrontMatter(markdown) {
        if (typeof markdown !== 'string') return markdown;
        const lines = markdown.split('\n');
        if (lines.length > 0 && lines[0].trim() === '---') {
            let endIndex = -1;
            for (let i = 1; i < lines.length; i++) {
                if (lines[i].trim() === '---') {
                    endIndex = i;
                    break;
                }
            }
            if (endIndex !== -1) {
                lines.splice(0, endIndex + 1);
                return lines.join('\n').trim();
            }
        }
        return markdown;
    }

    renderMarkdownWithLute(markdown) {
        if (!window.Lute) return null;
        try {
            const lute = window.Lute.New();
            if (lute && typeof lute.MarkdownStr === 'function') {
                return lute.MarkdownStr('', markdown);
            } else if (lute && typeof lute.Md2HTML === 'function') {
                return lute.Md2HTML(markdown);
            }
        } catch (e) {
            console.error('Lute 渲染失败', e);
        }
        return null;
    }

    async getDocRenderedContent(docId) {
        // 优先使用 getDoc 获取已渲染的 HTML
        try {
            const data = await this.callApi('/api/filetree/getDoc', { id: docId });
            if (data && data.content) {
                return data.content;
            }
        } catch (e) {
            console.warn('getDoc 失败，降级为 Lute 渲染', e);
        }

        // 降级方案：使用 Lute 渲染 Markdown
        console.log(`文档 ${docId} 降级为 Lute 渲染`);
        try {
            const mdData = await this.callApi('/api/export/exportMdContent', { id: docId });
            if (mdData && mdData.content) {
                let markdown = mdData.content;
                markdown = this.stripFrontMatter(markdown);
                const html = this.renderMarkdownWithLute(markdown);
                if (html) return html;
                return `<pre>${markdown}</pre>`;
            }
        } catch { }

        // 最后降级为纯文本
        console.log(`文档 ${docId} 降级为纯文本`);
        try {
            const mdData = await this.callApi('/api/export/exportMdContent', { id: docId });
            if (mdData && mdData.content) {
                let markdown = mdData.content;
                markdown = this.stripFrontMatter(markdown);
                return `<pre>${markdown}</pre>`;
            }
        } catch (e) {
            console.error('获取文档内容失败', docId, e);
        }
        return `<p>${this.i18n.loadSubDocfailed}</p>`;
    }

    async enableConcat(docId, editorElement) {
        editorElement.classList.add('concat-maindoc-editor');

        const existing = editorElement.nextElementSibling;
        if (existing && existing.matches(`.concat-subdocs-container[data-doc-id="${docId}"]`)) {
            existing.remove();
        }
        let subDocs = await this.getAllSubDocs(docId);
        if (subDocs.length === 0) return;

        if (this.config.maxCount > 0 && subDocs.length > this.config.maxCount) {
            subDocs = subDocs.slice(0, this.config.maxCount);
            // 可以提示用户已截断，但为避免频繁提示，可选
            showMessage(this.i18n.maxCountReached.replace(/\{count\}/g, this.config.maxCount), 3000, 'info');
        }

        const container = document.createElement('div');
        container.className = 'concat-subdocs-container';
        container.setAttribute('data-doc-id', docId);
        container.contentEditable = "false";
        // 复制 editorElement 的样式到 container 中
        container.style.cssText = editorElement.style.cssText;
        // 将 container 插入到 editorElement 之后
        editorElement.insertAdjacentElement('afterend', container);

        const promises = subDocs.map(async (subDoc) => {
            const content = await this.getDocRenderedContent(subDoc.id);
            return { ...subDoc, content };
        });
        const docsWithContent = await Promise.all(promises);

        for (const subDoc of docsWithContent) {
            const subDocContainer = document.createElement('div');
            subDocContainer.classList.add('protyle-wysiwyg', 'concat-subdoc-item', 'protyle-custom');
            subDocContainer.setAttribute('data-subdoc-id', subDoc.id);

            const header = document.createElement('div');
            header.className = 'protyle-title__input';
            header.textContent = subDoc.name || this.i18n.subDocTitle;
            header.contentEditable = "false";
            subDocContainer.appendChild(header);

            const contentDiv = document.createElement('div');
            contentDiv.className = 'concat-subdoc-content protyle-wysiwyg';
            contentDiv.innerHTML = subDoc.content;
            contentDiv.contentEditable = "false";

            // 将所有后代元素设置为只读
            this.setSubElementNotEditable(contentDiv);

            // 思源原生块引用，实现悬停预览
            const editLink = document.createElement('span');
            editLink.className = 'concat-edit-link';
            editLink.setAttribute('data-type', 'block-ref');
            editLink.setAttribute('data-id', subDoc.id);
            editLink.title = this.i18n.editLinkTitle;
            editLink.innerHTML = '<svg class="icon" style="width:16px;height:16px"><use xlink:href="#iconEdit"></use></svg>';

            subDocContainer.appendChild(contentDiv);
            subDocContainer.appendChild(editLink);
            container.appendChild(subDocContainer);

            this.subdocElements.set(subDoc.id, subDocContainer);
        }

        container.querySelectorAll('.concat-edit-link').forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const id = link.getAttribute('data-id');
                if (id) this.openDocument(id);
            });
        });

        this.concatContainers.set(docId, { container });
    }

    setSubElementNotEditable(contentDiv) {
        const allElements = contentDiv.querySelectorAll('*');
        allElements.forEach(el => {
            el.contentEditable = "false";
            // el.removeAttribute('data-type'); // 删除 data-type 属性
            // el.style.pointerEvents = 'none';
        });
    }

    removeAllConcatContainers() {
        for (const docId of this.concatContainers.keys()) {
            const data = this.concatContainers.get(docId);
            data.container?.parentNode?.removeChild(data.container);
            this.concatContainers.delete(docId);
        }
        this.subdocElements.clear(); // 清空映射
    }

    openDocument(docId) {
        window.open(`siyuan://blocks/${docId}`, '_blank');
    }

    async getBlockInfo(blockId) {
        try {
            return await this.callApi('/api/block/getBlockInfo', { id: blockId });
        } catch { return null; }
    }

    saveConfig() { }
};
