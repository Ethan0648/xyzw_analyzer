const {toRaw} = Vue;
// 创建Vue应用
const App = {
    data() {
        return {
            // WebSocket相关
            websocket: null,
            isConnected: false,
            connectionError: false,
            connecting: false,

            // 消息数据
            messages: [],
            currentJson: '',

            // 最大消息数量限制，防止内存占用过多
            maxMessages: 100,

            // 筛选相关
            filterDirection: 'all', // 'all', 'client', 'server'
            filterCmd: '',
            // 排除相关
            excludedCommands: [], // 存储被排除的命令列表
            // 备注相关
            commandNotes: {}, // 存储命令备注，格式: {cmd: 'note'}
            keyNotes: {},     // 存储键备注，格式: {cmd: {key: 'note'}}
            currentEditingNote: null, // 当前正在编辑的备注对象
            noteDialogVisible: false, // 备注对话框可见性
            noteContent: '',          // 备注内容

            // 脚本日志相关
            scriptLogs: [],           // 存储脚本日志
            scriptLogVisible: false,  // 日志窗口可见性
            scriptLogMinimized: false, // 日志窗口是否最小化
            scriptLogPosition: {x: 20, y: 100}, // 日志窗口位置
            isDraggingLog: false,     // 是否正在拖动日志窗口
            dragOffset: {x: 0, y: 0}, // 拖动偏移量
            maxScriptLogs: 500,       // 最大日志数量
            scriptLogFilter: "",      // 脚本日志筛选
            // Tab相关
            activeTab: 'detail',
            debugContent: '',
            jsonTitle: '',
            // 脚本管理相关
            scriptManagerVisible: false,  // 脚本管理对话框可见性
            scriptEditVisible: false,     // 脚本编辑对话框可见性
            scripts: [],                  // 脚本列表
            currentScript: null,          // 当前编辑的脚本
            scriptsLoading: false,        // 脚本加载状态
            scriptBackup: null,           // 脚本编辑备份
            monacoEditor: null,           // Monaco 编辑器实例
            scriptEditActiveTab: 'editor', // 脚本编辑当前激活的 Tab
        };
    },
// 添加watch监听noteDialogVisible的变化
    watch: {
        noteDialogVisible(newVal) {
            // 当对话框关闭时，如果是键备注，重新渲染JSON视图
            if (!newVal && this.currentEditingNote && this.currentEditingNote.type === 'key') {
                this.$nextTick(() => {
                    this.addJsonKeyClickHandlers();
                });
            }
        },
        scriptEditVisible(newVal) {
            if (newVal) {
                // 当对话框打开时，初始化编辑器
                this.$nextTick(() => {
                    this.initMonacoEditor();
                });
            }
        }

    },
    computed: {
        // 连接状态类型
        connectionStatusType() {
            if (this.isConnected) return 'success';
            if (this.connectionError) return 'danger';
            return 'info';
        },

        // 连接状态文本
        connectionStatusText() {
            if (this.isConnected) return '已连接';
            if (this.connectionError) return '连接错误';
            return '已断开';
        },
        connectionButtonText() {
            if (this.isConnected) return '断开链接';
            return '重新链接';
        },
        // 修改filteredMessages计算属性，添加排除命令的逻辑
        filteredMessages() {
            return this.messages.filter(message => {
                // 排除指定命令
                if (this.excludedCommands.includes(message.parsedMsg.cmd)) {
                    return false;
                }

                // 方向筛选
                if (this.filterDirection !== 'all' && message.call !== this.filterDirection) {
                    return false;
                }

                // 命令筛选
                if (this.filterCmd && (!message.parsedMsg.cmd ||
                    !message.parsedMsg.cmd.toLowerCase().includes(this.filterCmd.toLowerCase()))) {
                    return false;
                }


                return true;
            });
        },
        filteredScriptLogs() {
            if (!this.scriptLogFilter) {
                return this.scriptLogs;
            }
            return this.scriptLogs.filter(log => log.script === this.scriptLogFilter);
        },

        // 获取所有脚本名称（用于筛选）
        scriptNames() {
            const names = new Set();
            this.scriptLogs.forEach(log => {
                if (log.script) {
                    names.add(log.script);
                }
            });
            return Array.from(names);
        },

    },

    mounted() {
        // 组件挂载后自动连接WebSocket
        this.connectWebSocket();
        // 加载备注
        this.loadNotes();
        // 加载排除命令列表
        this.loadExcludedCommands();

        this.loadScripts();
        window.ElMessage = ElementPlus.ElMessage;
        window.addScriptLog = (scriptName, message, level) => {
            this.addScriptLog(scriptName, message, level);
        };
    },

    beforeUnmount() {
        const editor = Vue.toRaw(this.monacoEditor);
        if (editor && typeof editor.dispose === 'function') {
            try {
                editor.dispose();
            } catch (e) {
                console.error('销毁编辑器错误:', e);
            }
        }
        this.monacoEditor = null;
        // 组件卸载前关闭WebSocket连接
        this.closeWebSocket();

    },

    methods: {
        // 连接WebSocket
        connectWebSocket() {
            const wsUrl = "ws://127.0.0.1:12582/ws";

            // 如果已有连接，先关闭
            if (this.websocket && this.websocket.readyState !== WebSocket.CLOSED) {
                this.websocket.close();
            }

            this.connecting = true;
            this.websocket = new WebSocket(wsUrl);

            // 连接成功
            this.websocket.onopen = () => {
                this.isConnected = true;
                this.connectionError = false;
                this.connecting = false;
                this.$message.success('WebSocket 连接成功');
            };

            // 接收消息
            this.websocket.onmessage = (event) => {
                try {
                    const message = JSON.parse(event.data);
                    this.processMessage(message);
                } catch (e) {
                    console.error('消息解析错误:', e);
                    this.$message.error('消息解析错误: ' + e.message);
                }
            };

            // 连接关闭
            this.websocket.onclose = () => {
                this.isConnected = false;
                this.connectionError = false;
                this.connecting = false;
                this.$message.warning('WebSocket 连接已关闭');
            };

            // 连接错误
            this.websocket.onerror = () => {
                this.isConnected = false;
                this.connectionError = true;
                this.connecting = false;
                this.$message.error('WebSocket 连接错误');
            };
        },

        // 关闭WebSocket连接
        closeWebSocket() {
            if (this.websocket && this.websocket.readyState !== WebSocket.CLOSED) {
                this.websocket.close();
            }
        },

        // 重新连接
        reconnect() {
            if (this.isConnected) {
                this.closeWebSocket();
            } else {
                this.connectWebSocket();
            }
        },

        // 处理接收到的消息
        // 处理接收到的消息
        processMessage(message) {
            try {
                // 解析消息内容
                const parsedMsg = JSON.parse(message.msg);

                // 创建新消息对象
                const newMessage = {
                    call: message.call,
                    msg: message.msg,
                    title: message.title || '',
                    parsedMsg: parsedMsg,
                    timestamp: Date.now(),
                    expanded: false
                };

                // 添加到消息列表开头
                this.messages.unshift(newMessage);

                // 限制消息数量
                if (this.messages.length > this.maxMessages) {
                    this.messages = this.messages.slice(0, this.maxMessages);
                }

                // 如果是服务器发来的消息，执行启用的脚本（盐场 raw 包只展示，不跑用户脚本）
                if (message.call === 'server') {
                    if (parsedMsg.cmd !== '__SALT_AGENT_RAW__' &&
                        !this.excludedCommands.includes(parsedMsg.cmd)) {
                        this.executeScripts(newMessage);
                    }
                }
            } catch (e) {
                console.error('消息处理错误:', e);
                this.$message.error('消息处理错误: ' + e.message);
            }
        },
        // 执行脚本
        executeScripts(message) {
            if (!this.isConnected || !message || !message.parsedMsg) {
                return;
            }

            if (message.parsedMsg.cmd === '__SALT_AGENT_RAW__') {
                return;
            }

            // 只处理服务器发来的消息
            if (message.call !== 'server') {
                return;
            }

            // 获取启用的脚本
            const enabledScripts = this.scripts.filter(script => script.enabled);
            if (enabledScripts.length === 0) {
                return;
            }

            // 执行每个启用的脚本
            for (const script of enabledScripts) {
                try {
                    // 创建脚本函数，传递脚本名称
                    const scriptFunction = this.createScriptFunction(script.content, script.name);

                    // 执行脚本
                    const result = scriptFunction(message.parsedMsg);

                    if (result !== undefined) {
                        console.log(`脚本 "${script.name}" 执行结果:`, result);
                    }
                } catch (error) {
                    console.error(`脚本 "${script.name}" 执行错误:`, error);
                    this.$message.error(`脚本 "${script.name}" 执行错误: ${error.message}`);
                }
            }
        },
        // 创建脚本函数
        createScriptFunction(scriptContent, scriptName) {
            try {
                // 创建一个安全的执行环境
                // 传入 messageData 作为参数，并提供一些有用的工具函数
                const functionBody = `
            "use strict";
            // 提供一些工具函数
            const log = function(message,type = 'info') { 
                console.log("[脚本日志]", message); 
                // 将日志发送到日志窗口，使用传入的脚本名称
                window.addScriptLog("${scriptName}", message, type);
                return message;
            };
            
            const notify = function(message, type = 'info') {
                // 使用全局的 ElMessage
                if (type === 'success') {
                    window.ElMessage.success(message);
                } else if (type === 'warning') {
                    window.ElMessage.warning(message);
                } else if (type === 'error') {
                    window.ElMessage.error(message);
                } else {
                    window.ElMessage.info(message);
                }
                // 同时添加到日志，使用传入的脚本名称
                window.addScriptLog("${scriptName}", message, type);
                return message;
            };
            
            // 执行用户脚本
            try {
                ${scriptContent}
                
                // 如果脚本中定义了 process 函数，则调用它
                if (typeof process === 'function') {
                    return process(messageData);
                }
                
                return undefined;
            } catch (e) {
                console.error("脚本执行错误:", e);
                window.addScriptLog("${scriptName}", "执行错误: " + e.message, 'error');
                throw e;
            }
        `;

                // 创建函数
                return new Function('messageData', functionBody);
            } catch (error) {
                console.error("创建脚本函数错误:", error);
                throw error;
            }
        },
        // 切换消息展开/折叠状态
        toggleExpand(message) {
            message.expanded = !message.expanded;
        },


        // 查看消息详情时，设置调试内容
        viewMessageDetail(message) {
            try {
                this.currentMessage = message; // 保存当前查看的消息，用于键备注
                console.log(this.currentMessage)
                this.currentJson = this.formatJson(message.parsedMsg);
                this.jsonTitle = `${message.parsedMsg.cmd}   (${this.commandNotes[message.parsedMsg.cmd] || ''})`;

                // 设置调试内容为body部分
                if (message.parsedMsg.body) {
                    this.debugContent = this.formatJson(message.parsedMsg.body);
                } else {
                    this.debugContent = '{}';
                }

                // 在DOM更新后添加JSON键的点击事件
                this.$nextTick(() => {
                    this.addJsonKeyClickHandlers();

                    // 为所有JSON对象的开括号行添加点击事件
                    document.querySelectorAll('.json-toggle-row').forEach(row => {
                        row.addEventListener('click', (e) => {
                            if (e.target.classList.contains('json-toggle-icon')) return;

                            const toggleIcon = row.querySelector('.json-toggle-icon');
                            if (toggleIcon) {
                                this.toggleJsonNode(toggleIcon);
                            }
                        });
                    });
                });
            } catch (e) {
                console.error('JSON格式化错误:', e);
                this.$message.error('JSON格式化错误: ' + e.message);
            }
        },
        // 格式化调试内容
        formatDebugContent() {
            try {
                const jsonObj = JSON.parse(this.debugContent);
                this.debugContent = this.formatJson(jsonObj);
                this.$message.success('格式化成功');
            } catch (e) {
                this.$message.error('JSON格式错误: ' + e.message);
            }
        },
        openGame() {
            if (!this.isConnected) {
                this.$message.error('WebSocket未连接');
                return;
            }
            try {
                const jsonObj = {};

                // 发送到后端队列
                fetch('/api/debug/openGame', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(jsonObj)
                })
                    .then(response => {
                        if (!response.ok) {
                            throw new Error('发送失败');
                        }
                        return response.json();
                    })
                    .then(data => {
                        if (data.success === false) {
                            throw new Error('清先使用小程序/QQ登录咸鱼之王，然后再使用网页登录功能！');
                        }
                        window.open("https://xxz-xyzw-res.hortorgames.com/h5web/index.html")
                    })
                    .catch(error => {
                        this.$message.error('登录失败: ' + error.message);
                    });
            } catch (e) {
                this.$message.error('JSON格式错误: ' + e.message);
            }
        },
        // 发送调试消息
        sendDebugMessage() {
            if (!this.isConnected) {
                this.$message.error('WebSocket未连接');
                return;
            }

            try {
                const jsonObj = {};
                jsonObj.cmd = this.currentMessage.parsedMsg.cmd;
                jsonObj.data = JSON.parse(this.debugContent)
                // 发送到后端队列
                fetch('/api/debug/send', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(jsonObj)
                })
                    .then(response => {
                        if (!response.ok) {
                            throw new Error('发送失败');
                        }
                        return response.json();
                    })
                    .then(data => {
                        this.$message.success('消息已加入队列，将在2秒内发送');
                    })
                    .catch(error => {
                        this.$message.error('发送失败: ' + error.message);
                    });
            } catch (e) {
                this.$message.error('JSON格式错误: ' + e.message);
            }
        },

// 添加新方法，用于处理JSON键的点击事件
        addJsonKeyClickHandlers() {
            const jsonContent = document.querySelector('.json-content pre');
            if (!jsonContent) return;

            // 解析JSON并创建带有点击事件的DOM结构
            const jsonObj = this.currentMessage?.parsedMsg;
            if (!jsonObj) return;

            // 清空原有内容
            jsonContent.innerHTML = '';

            // 创建格式化的JSON视图
            const formattedView = this.createFormattedJsonView(jsonObj);
            jsonContent.appendChild(formattedView);
        },

// 创建格式化的JSON视图
        createFormattedJsonView(jsonObj, path = '', level = 0) {
            const container = document.createElement('div');
            container.className = 'json-object-container';

            const indent = '  '.repeat(level);
            const cmd = this.currentMessage?.parsedMsg?.cmd;

            // 添加开括号和折叠控制
            const openBraceRow = document.createElement('div');
            openBraceRow.className = 'json-row json-toggle-row';

            // 添加折叠/展开图标
            const toggleIcon = document.createElement('span');
            toggleIcon.className = 'json-toggle-icon expanded';
            toggleIcon.innerHTML = '▼';
            toggleIcon.addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggleJsonNode(e.target);
            });
            openBraceRow.appendChild(toggleIcon);

            const openBrace = document.createElement('span');
            openBrace.textContent = '{';
            openBraceRow.appendChild(openBrace);
            container.appendChild(openBraceRow);

            // 创建内容容器，用于折叠/展开
            const contentContainer = document.createElement('div');
            contentContainer.className = 'json-content-container';
            container.appendChild(contentContainer);

            // 处理所有键值对
            const keys = Object.keys(jsonObj);
            keys.forEach((key, index) => {
                const keyPath = path ? `${path}.${key}` : key;
                const value = jsonObj[key];
                const hasNote = this.hasKeyNote(cmd, keyPath);
                const note = this.getKeyNote(cmd, keyPath);

                const row = document.createElement('div');
                row.className = 'json-row';
                row.style.marginLeft = '20px';

                // 键名
                const keySpan = document.createElement('span');
                keySpan.className = 'json-key';
                keySpan.textContent = `"${key}": `;
                row.appendChild(keySpan);

                // 值
                if (typeof value === 'object' && value !== null) {
                    // 递归处理嵌套对象
                    const nestedContainer = this.createFormattedJsonView(value, keyPath, level + 1);
                    row.appendChild(nestedContainer);
                } else {
                    const valueSpan = document.createElement('span');
                    valueSpan.className = typeof value === 'string' ? 'json-string' : 'json-value';
                    valueSpan.textContent = typeof value === 'string' ? `"${value}"` : `${value}`;
                    row.appendChild(valueSpan);
                }

                // 添加逗号
                if (index < keys.length - 1) {
                    const comma = document.createElement('span');
                    comma.textContent = ',';
                    row.appendChild(comma);
                }

                // 添加备注或添加备注按钮
                if (hasNote) {
                    const noteSpan = document.createElement('span');
                    noteSpan.className = 'json-note';
                    noteSpan.textContent = `/* ${note} */`;
                    noteSpan.title = "点击编辑备注";

                    // 添加点击事件
                    noteSpan.addEventListener('click', (e) => {
                        e.stopPropagation();
                        this.openKeyNoteDialog(this.currentMessage, keyPath);
                    });

                    row.appendChild(noteSpan);
                } else {
                    const addNoteSpan = document.createElement('span');
                    addNoteSpan.className = 'json-add-note';
                    addNoteSpan.textContent = '+';
                    addNoteSpan.title = "添加备注";

                    // 添加点击事件
                    addNoteSpan.addEventListener('click', (e) => {
                        e.stopPropagation();
                        this.openKeyNoteDialog(this.currentMessage, keyPath);
                    });

                    row.appendChild(addNoteSpan);
                }

                contentContainer.appendChild(row);
            });

            // 添加闭括号
            const closeBraceRow = document.createElement('div');
            closeBraceRow.className = 'json-row';
            if (level > 0) {
                closeBraceRow.style.marginLeft = '  '.repeat(level - 1);
            }
            const closeBrace = document.createElement('span');
            closeBrace.textContent = '}';
            closeBraceRow.appendChild(closeBrace);
            container.appendChild(closeBraceRow);

            return container;
        },
        // 添加新方法：切换JSON节点的展开/折叠状态
        toggleJsonNode(toggleIcon) {
            const row = toggleIcon.closest('.json-toggle-row');
            const contentContainer = row.nextElementSibling;

            if (toggleIcon.classList.contains('expanded')) {
                // 折叠
                toggleIcon.classList.remove('expanded');
                toggleIcon.classList.add('collapsed');
                toggleIcon.innerHTML = '▶';
                contentContainer.style.display = 'none';
            } else {
                // 展开
                toggleIcon.classList.remove('collapsed');
                toggleIcon.classList.add('expanded');
                toggleIcon.innerHTML = '▼';
                contentContainer.style.display = 'block';
            }
        },
        // 格式化JSON并添加备注功能
        renderJsonWithNotes(json, path = '') {
            if (!json || typeof json !== 'object') return '';

            const cmd = this.currentMessage?.parsedMsg?.cmd;
            if (!cmd) return this.formatJson(json);

            let result = '{\n';
            const keys = Object.keys(json);

            keys.forEach((key, index) => {
                const value = json[key];
                const keyPath = path ? `${path}.${key}` : key;
                const hasNote = this.hasKeyNote(cmd, keyPath);
                const note = this.getKeyNote(cmd, keyPath);

                result += `  "${key}": `;

                if (typeof value === 'object' && value !== null) {
                    result += this.renderJsonWithNotes(value, keyPath);
                } else if (typeof value === 'string') {
                    result += `"${value}"`;
                } else {
                    result += value;
                }

                if (index < keys.length - 1) {
                    result += ',';
                }

                if (hasNote) {
                    result += ` /* ${note} */`;
                }

                result += '\n';
            });

            result += '}';
            return result;
        },
        // 添加新方法，用于渲染带HTML的JSON
        renderJsonWithNotesHtml(json) {
            if (!json) return '';

            const cmd = this.currentMessage?.parsedMsg?.cmd;
            if (!cmd) return this.formatJson(json);

            // 使用递归函数处理JSON
            const processObject = (obj, path = '') => {
                if (!obj || typeof obj !== 'object') return '';

                let result = '{\n';
                const keys = Object.keys(obj);

                keys.forEach((key, index) => {
                    const value = obj[key];
                    const keyPath = path ? `${path}.${key}` : key;
                    const hasNote = this.hasKeyNote(cmd, keyPath);
                    const note = this.getKeyNote(cmd, keyPath);

                    // 添加键名
                    result += `  <span class="json-key">"${key}"</span>: `;

                    // 处理值
                    if (typeof value === 'object' && value !== null) {
                        result += processObject(value, keyPath);
                    } else if (typeof value === 'string') {
                        result += `<span class="json-string">"${value}"</span>`;
                    } else {
                        result += `<span class="json-value">${value}</span>`;
                    }

                    if (index < keys.length - 1) {
                        result += ',';
                    }

                    // 添加备注
                    if (hasNote) {
                        result += ` <span class="json-note" @click="openKeyNoteDialog(currentMessage, '${keyPath}')">/* ${note} */</span>`;
                    } else {
                        result += ` <span class="json-add-note" @click="openKeyNoteDialog(currentMessage, '${keyPath}')">+</span>`;
                    }

                    result += '\n';
                });

                result += '}';
                return result;
            };

            return processObject(json);
        },
        // 重置筛选条件
        resetFilters() {

            this.filterDirection = 'all';
            this.filterCmd = '';
            this.$message.success('筛选条件已重置');
        },
        // 清空所有消息
        clearMessages() {
            this.messages = [];
            this.currentJson = '';
            this.$message.success('消息已清空');
        },
// 排除指定命令的消息
        excludeCommand(cmd) {
            if (!this.excludedCommands.includes(cmd)) {
                this.excludedCommands.push(cmd);
                // 保存到本地存储
                localStorage.setItem('excludedCommands', JSON.stringify(this.excludedCommands));
                this.$message.success(`已排除命令: ${cmd}`);
            }
        },

        // 取消排除命令
        includeCommand(cmd) {
            const index = this.excludedCommands.indexOf(cmd);
            if (index > -1) {
                this.excludedCommands.splice(index, 1);
                // 保存到本地存储
                localStorage.setItem('excludedCommands', JSON.stringify(this.excludedCommands));
                this.$message.success(`已取消排除命令: ${cmd}`);
            }
        },

        // 加载排除命令列表
        loadExcludedCommands() {
            const excludedCommands = localStorage.getItem('excludedCommands');
            if (excludedCommands) {
                this.excludedCommands = JSON.parse(excludedCommands);
            }
        },
        // 复制JSON到剪贴板
        copyJson() {
            if (!this.currentJson) {
                this.$message.warning('没有内容可复制');
                return;
            }

            navigator.clipboard.writeText(this.currentJson)
                .then(() => {
                    this.$message.success('已复制到剪贴板');
                })
                .catch(() => {
                    this.$message.error('复制失败，请手动复制');
                });
        },

        // 格式化JSON
        formatJson(json) {
            return JSON.stringify(json, null, 2);
        },

        // 获取格式化的时间
        getCurrentTime(timestamp) {
            const date = timestamp ? new Date(timestamp) : new Date();
            const hours = String(date.getHours()).padStart(2, '0');
            const minutes = String(date.getMinutes()).padStart(2, '0');
            const seconds = String(date.getSeconds()).padStart(2, '0');
            return `${hours}:${minutes}:${seconds}`;
        },
        // 保存备注到本地存储
        // 修改saveNotes方法，将备注数据保存到后端
        saveNotes() {
            // 同时保存到本地存储作为备份
            localStorage.setItem('commandNotes', JSON.stringify(this.commandNotes));
            localStorage.setItem('keyNotes', JSON.stringify(this.keyNotes));

            // 发送到后端保存
            fetch('/api/notes/save', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    commandNotes: this.commandNotes,
                    keyNotes: this.keyNotes
                })
            })
                .then(response => {
                    if (!response.ok) {
                        throw new Error('保存备注失败');
                    }
                    return response.json();
                })
                .then(data => {
                    console.log('备注数据保存成功');
                })
                .catch(error => {
                    console.error('保存备注错误:', error);
                    this.$message.error('保存备注失败: ' + error.message);
                });
        },

        // 修改loadNotes方法，从后端加载备注数据
        loadNotes() {
            fetch('/api/notes/load')
                .then(response => {
                    if (!response.ok) {
                        throw new Error('加载备注失败');
                    }
                    return response.json();
                })
                .then(data => {
                    this.commandNotes = data.commandNotes || {};
                    this.keyNotes = data.keyNotes || {};
                    console.log('备注数据加载成功');
                })
                .catch(error => {
                    console.error('加载备注错误:', error);
                    this.$message.error('加载备注失败: ' + error.message);

                    // 加载失败时尝试从本地存储加载
                    const commandNotes = localStorage.getItem('commandNotes');
                    const keyNotes = localStorage.getItem('keyNotes');

                    if (commandNotes) {
                        this.commandNotes = JSON.parse(commandNotes);
                    }

                    if (keyNotes) {
                        this.keyNotes = JSON.parse(keyNotes);
                    }
                });
        },
        // 打开命令备注对话框
        openCommandNoteDialog(message) {
            const cmd = message.parsedMsg.cmd;
            this.currentEditingNote = {type: 'command', cmd};
            this.noteContent = this.commandNotes[cmd] || '';
            this.noteDialogVisible = true;
        },

        // 打开键备注对话框
        // 修改openKeyNoteDialog方法
        openKeyNoteDialog(message, key) {
            if (!message) {
                message = this.currentMessage;
            }

            if (!message) {
                this.$message.error('无法获取消息信息');
                return;
            }

            const cmd = message.parsedMsg.cmd;
            this.currentEditingNote = {type: 'key', cmd, key};

            // 初始化嵌套对象
            if (!this.keyNotes[cmd]) {
                this.keyNotes[cmd] = {};
            }

            this.noteContent = this.keyNotes[cmd][key] || '';
            this.noteDialogVisible = true;
        },

        // 保存备注
        // 修改saveNote方法
        saveNote() {
            if (!this.currentEditingNote) return;

            if (this.currentEditingNote.type === 'command') {
                const {cmd} = this.currentEditingNote;
                if (this.noteContent.trim()) {
                    this.commandNotes[cmd] = this.noteContent;
                } else {
                    delete this.commandNotes[cmd];
                }
            } else if (this.currentEditingNote.type === 'key') {
                const {cmd, key} = this.currentEditingNote;
                if (!this.keyNotes[cmd]) {
                    this.keyNotes[cmd] = {};
                }

                if (this.noteContent.trim()) {
                    this.keyNotes[cmd][key] = this.noteContent;
                } else {
                    delete this.keyNotes[cmd][key];
                    // 如果没有键备注了，清理空对象
                    if (Object.keys(this.keyNotes[cmd]).length === 0) {
                        delete this.keyNotes[cmd];
                    }
                }
            }

            // 保存到本地存储
            this.saveNotes();
            this.noteDialogVisible = false;
            this.$message.success('备注已保存');

            // 如果当前正在查看JSON详情，重新渲染JSON视图
            if (this.currentMessage) {
                this.$nextTick(() => {
                    this.addJsonKeyClickHandlers();
                });
            }
        },

        // 获取命令备注
        getCommandNote(cmd) {
            return this.commandNotes[cmd] || '';
        },

        // 获取键备注
        getKeyNote(cmd, key) {
            if (!this.keyNotes[cmd]) return '';
            return this.keyNotes[cmd][key] || '';
        },

        // 检查命令是否有备注
        hasCommandNote(cmd) {
            return !!this.commandNotes[cmd];
        },

        // 检查键是否有备注
        hasKeyNote(cmd, key) {
            if (!this.keyNotes[cmd]) return false;
            return !!this.keyNotes[cmd][key];
        },
        // 处理排除命令下拉菜单的选择
        handleExcludedCommand(command) {
            if (command === 'clear-all') {
                // 清除所有排除
                this.clearAllExcludes();
            } else {
                // 取消排除特定命令
                this.includeCommand(command);
            }
        },

        // 清除所有排除
        clearAllExcludes() {
            if (this.excludedCommands.length === 0) return;

            this.excludedCommands = [];
            localStorage.setItem('excludedCommands', JSON.stringify(this.excludedCommands));
            this.$message.success('已取消所有排除');
        },

        // 打开脚本管理器
        openScriptManager() {
            this.scriptManagerVisible = true;
            this.scripts = []; // 先清空脚本列表
            this.loadScripts();
        },

        // 加载脚本列表
        loadScripts() {
            this.scriptsLoading = true;
            fetch('/api/scripts/load')
                .then(response => {
                    if (!response.ok) {
                        throw new Error('加载脚本失败');
                    }
                    return response.json();
                })
                .then(data => {
                    this.scripts = data.scripts || [];
                    console.log('脚本数据加载成功');
                })
                .catch(error => {
                    console.error('加载脚本错误:', error);
                    this.$message.error('加载脚本失败: ' + error.message);
                })
                .finally(() => {
                    this.scriptsLoading = false;
                });
        },

        // 创建新脚本
        createNewScript() {
            const newScript = {
                id: '',
                name: '新脚本',
                content: `// 这是一个示例脚本
// 定义一个处理函数，接收消息数据作为参数
function process(messageData) {
  // 获取消息命令
  const cmd = messageData.cmd;
  
  // 根据不同的命令执行不同的操作
  if (cmd === '某个特定命令') {
    // 处理特定命令的逻辑
    log('收到特定命令: ' + cmd);
    
    // 可以访问消息的所有字段
    if (messageData.data && messageData.data.someField) {
      notify('发现特定字段: ' + messageData.data.someField, 'success');
    }
    
    // 返回处理结果（可选）
    return '处理完成';
  }
  
  // 可以处理所有类型的消息
  log('收到消息: ' + cmd);
}`,
                enabled: false,
                createdAt: new Date().toISOString(),
                editing: true
            };

            // 直接编辑新脚本，而不是添加到数组中
            // this.scripts.unshift(newScript); // 删除这行，避免重复添加
            this.currentScript = newScript;
            this.scriptEditVisible = true;
            this.scriptEditActiveTab = 'editor';

            // 在下一个周期初始化编辑器
            this.$nextTick(() => {
                this.initMonacoEditor();
            });
        },


        // 编辑脚本
        editScript(script) {
            // 备份脚本，以便取消编辑时恢复
            this.scriptBackup = JSON.parse(JSON.stringify(script));

            // 标记为编辑状态
            script.editing = true;

            // 打开编辑对话框
            this.currentScript = script;
            this.scriptEditActiveTab = 'editor'; // 默认打开编辑器标签页
            this.scriptEditVisible = true;
        },
// 初始化代码编辑器
        initMonacoEditor() {
            this.$nextTick(() => {
                // 如果编辑器已存在，先销毁它
                const editor = Vue.toRaw(this.monacoEditor);
                if (editor && typeof editor.dispose === 'function') {
                    try {
                        editor.dispose();
                    } catch (e) {
                        console.error('销毁旧编辑器错误:', e);
                    }
                    this.monacoEditor = null;
                }

                // 配置 Monaco 编辑器加载器
                require.config({paths: {'vs': 'https://cdn.staticfile.net/monaco-editor/0.45.0/min/vs'}});

                // 加载编辑器
                require(['vs/editor/editor.main'], () => {
                    try {
                        const editorElement = document.getElementById('monaco-editor');
                        if (!editorElement) {
                            console.error('无法找到编辑器DOM元素');
                            return;
                        }

                        this.monacoEditor = monaco.editor.create(editorElement, {
                            value: this.currentScript.content || '',
                            language: 'javascript',
                            theme: 'vs',
                            automaticLayout: true,
                            // 其他配置保持不变
                        });

                        // 添加快捷键支持
                        this.monacoEditor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
                            this.saveScriptContent();
                        });

                        this.monacoEditor.addCommand(monaco.KeyMod.Alt | monaco.KeyCode.KeyF, () => {
                            this.formatScriptCode();
                        });
                    } catch (e) {
                        console.error('创建编辑器错误:', e);
                        this.$message.error('创建编辑器失败: ' + e.message);
                    }
                });
            });
        },
        formatScriptCode() {
            if (!this.monacoEditor) return;

            try {
                const editor = Vue.toRaw(this.monacoEditor);
                editor.getAction('editor.action.formatDocument').run().then(() => {
                    this.$message.success('代码格式化成功');
                }).catch(err => {
                    console.error('格式化错误:', err);
                    this.$message.error('代码格式化失败');
                });
            } catch (e) {
                console.error('格式化操作错误:', e);
                this.$message.error('格式化操作失败');
            }
        },

        // 保存脚本内容
        saveScriptContent() {
            // 使用延时操作可以避免性能问题
            setTimeout(() => {
                if (this.monacoEditor) {
                    try {
                        const editor = Vue.toRaw(this.monacoEditor);
                        this.currentScript.content = editor.getValue();

                        // 销毁编辑器实例
                        if (editor && typeof editor.dispose === 'function') {
                            try {
                                editor.dispose();
                            } catch (e) {
                                console.error('销毁编辑器错误:', e);
                            }
                        }
                        this.monacoEditor = null;

                        this.scriptEditVisible = false;
                        this.saveScript(this.currentScript);

                        // 保存后重新加载脚本列表，确保数据一致性
                        this.loadScripts();
                    } catch (e) {
                        console.error('获取编辑器内容错误:', e);
                        this.$message.error('获取编辑器内容失败');
                    }
                } else {
                    this.scriptEditVisible = false;
                    this.saveScript(this.currentScript);

                    // 保存后重新加载脚本列表，确保数据一致性
                    this.loadScripts();
                }
            }, 10);
        },
// 取消编辑
        cancelScriptEdit() {
            // 销毁编辑器实例
            const editor = Vue.toRaw(this.monacoEditor);
            if (editor && typeof editor.dispose === 'function') {
                try {
                    editor.dispose();
                } catch (e) {
                    console.error('销毁编辑器错误:', e);
                }
            }
            this.monacoEditor = null;

            this.scriptEditVisible = false;

            if (this.currentScript.id === '') {
                // 如果是新创建的脚本，直接从列表中移除
                const index = this.scripts.findIndex(s => s === this.currentScript);
                if (index !== -1) {
                    this.scripts.splice(index, 1);
                }
            } else if (this.scriptBackup) {
                // 恢复备份数据
                const index = this.scripts.findIndex(s => s.id === this.currentScript.id);
                if (index !== -1) {
                    this.scripts[index] = {...this.scriptBackup, editing: false};
                }
            }

            // 清除备份和当前编辑脚本
            this.scriptBackup = null;

            // 延迟设置currentScript为null，确保对话框已完全关闭
            setTimeout(() => {
                this.currentScript = null;
            }, 100);
        },


        // 保存脚本
        saveScript(script) {
            // 移除编辑状态标记
            const scriptToSave = {...script};
            delete scriptToSave.editing;

            // 添加日志，帮助调试
            console.log('保存脚本:', scriptToSave);

            fetch('/api/scripts/save', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(scriptToSave)
            })
                .then(response => {
                    if (!response.ok) {
                        throw new Error('保存脚本失败');
                    }
                    return response.json();
                })
                .then(data => {
                    this.$message.success('脚本保存成功');

                    // 更新脚本列表中的数据
                    const index = this.scripts.findIndex(s => s.id === data.id);
                    if (index !== -1) {
                        this.scripts[index] = {...data, editing: false};
                    } else {
                        this.scripts.unshift({...data, editing: false});
                    }
                })
                .catch(error => {
                    console.error('保存脚本错误:', error);
                    this.$message.error('保存脚本失败: ' + error.message);
                });
        },
// 添加一个专门用于保存脚本名称的函数
        saveScriptName(script) {
            // 如果名称为空，设置一个默认名称
            if (!script.name || script.name.trim() === '') {
                script.name = '未命名脚本';
            }

            // 保存脚本
            this.saveScript(script);
        },
        // 开始编辑脚本名称
        // 开始编辑脚本名称 (Vue 3版本)
        startEditName(script, event) {
            // 防止事件冒泡
            if (event) {
                event.stopPropagation();
            }

            // 标记为名称编辑状态
            script.nameEditing = true;

            // 在下一个DOM更新周期后聚焦输入框
            this.$nextTick(() => {
                const inputs = this.$refs.nameInput;
                if (inputs && inputs.length) {
                    // 找到对应的输入框并聚焦
                    for (const input of inputs) {
                        if (input.$el.closest('tr').contains(event.target)) {
                            input.focus();
                            break;
                        }
                    }
                }
            });
        },

// 完成编辑脚本名称
        finishEditName(script) {
            // 如果名称为空，设置默认名称
            if (!script.name || script.name.trim() === '') {
                script.name = '未命名脚本';
            }

            // 取消名称编辑状态
            script.nameEditing = false;

            // 保存脚本
            this.saveScript(script);
        },
        // 取消编辑
        cancelEdit(script) {
            // 如果有备份，恢复名称
            if (this.scriptBackup && script.id === this.scriptBackup.id) {
                script.name = this.scriptBackup.name;
            }

            // 移除编辑状态
            script.editing = false;
        },

        // 删除脚本
        deleteScript(script) {
            this.$confirm('确定要删除脚本 "' + script.name + '" 吗?', '提示', {
                confirmButtonText: '确定',
                cancelButtonText: '取消',
                type: 'warning'
            }).then(() => {
                fetch('/api/scripts/delete', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({id: script.id})
                })
                    .then(response => {
                        if (!response.ok) {
                            throw new Error('删除脚本失败');
                        }
                        return response.json();
                    })
                    .then(data => {
                        this.$message.success('脚本删除成功');

                        // 从列表中移除
                        const index = this.scripts.findIndex(s => s.id === script.id);
                        if (index !== -1) {
                            this.scripts.splice(index, 1);
                        }
                    })
                    .catch(error => {
                        console.error('删除脚本错误:', error);
                        this.$message.error('删除脚本失败: ' + error.message);
                    });
            }).catch(() => {
                // 取消删除
            });
        },

        // 切换脚本启用状态
        toggleScriptStatus(script) {
            const scriptToSave = {...script};
            delete scriptToSave.editing;

            fetch('/api/scripts/save', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(scriptToSave)
            })
                .then(response => {
                    if (!response.ok) {
                        throw new Error('更新脚本状态失败');
                    }
                    return response.json();
                })
                .then(data => {
                    this.$message.success(`脚本已${data.enabled ? '启用' : '禁用'}`);
                })
                .catch(error => {
                    console.error('更新脚本状态错误:', error);
                    this.$message.error('更新脚本状态失败: ' + error.message);

                    // 恢复原状态
                    script.enabled = !script.enabled;
                });
        },

        // 格式化日期
        formatDate(dateString) {
            if (!dateString) return '';
            const date = new Date(dateString);
            return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}`;
        },

// 切换脚本日志窗口显示状态
        toggleScriptLog() {
            this.scriptLogVisible = !this.scriptLogVisible;
            if (this.scriptLogVisible) {
                // 显示日志窗口时，滚动到底部
                this.$nextTick(() => {
                    this.scrollLogToBottom();
                });
            }
        },

// 关闭脚本日志窗口
        closeScriptLog() {
            this.scriptLogVisible = false;
        },

// 最小化/展开脚本日志窗口
        minimizeScriptLog() {
            this.scriptLogMinimized = !this.scriptLogMinimized;
            if (!this.scriptLogMinimized) {
                // 展开时滚动到底部
                this.$nextTick(() => {
                    this.scrollLogToBottom();
                });
            }
        },

// 清空脚本日志
        clearScriptLogs() {
            this.scriptLogs = [];
            this.$message.success('脚本日志已清空');
        },

// 添加脚本日志
        addScriptLog(scriptName, message, level = 'info') {
            // 添加新日志
            this.scriptLogs.push({
                timestamp: new Date(),
                script: scriptName || '未知脚本',
                message: message,
                level: level
            });

            // 限制日志数量
            if (this.scriptLogs.length > this.maxScriptLogs) {
                this.scriptLogs = this.scriptLogs.slice(-this.maxScriptLogs);
            }

            // 如果日志窗口可见且未最小化，滚动到底部
            if (this.scriptLogVisible && !this.scriptLogMinimized) {
                this.$nextTick(() => {
                    this.scrollLogToBottom();
                });
            }
        },

// 滚动日志到底部
        scrollLogToBottom() {
            const scrollbar = this.$refs.scriptLogScrollbar;
            if (scrollbar) {
                scrollbar.setScrollTop(99999);
            }
        },

// 格式化日志时间
        formatLogTime(timestamp) {
            const date = new Date(timestamp);
            const hours = date.getHours().toString().padStart(2, '0');
            const minutes = date.getMinutes().toString().padStart(2, '0');
            const seconds = date.getSeconds().toString().padStart(2, '0');
            const milliseconds = date.getMilliseconds().toString().padStart(3, '0');
            return `${hours}:${minutes}:${seconds}.${milliseconds}`;
        },

// 开始拖动日志窗口
        startDragScriptLog(event) {
            // 忽略按钮点击事件
            if (event.target.tagName === 'BUTTON' || event.target.closest('button')) {
                return;
            }

            this.isDraggingLog = true;
            const rect = event.currentTarget.parentElement.getBoundingClientRect();
            this.dragOffset = {
                x: event.clientX - rect.left,
                y: event.clientY - rect.top
            };

            // 添加全局事件监听
            document.addEventListener('mousemove', this.dragScriptLog);
            document.addEventListener('mouseup', this.stopDragScriptLog);
        },

// 拖动日志窗口
        dragScriptLog(event) {
            if (!this.isDraggingLog) return;

            this.scriptLogPosition = {
                x: event.clientX - this.dragOffset.x,
                y: event.clientY - this.dragOffset.y
            };
        },

// 停止拖动日志窗口
        stopDragScriptLog() {
            this.isDraggingLog = false;

            // 移除全局事件监听
            document.removeEventListener('mousemove', this.dragScriptLog);
            document.removeEventListener('mouseup', this.stopDragScriptLog);
        },
    }
};

// 创建Vue应用并挂载
const app = Vue.createApp(App);

// 注册Element Plus图标
for (const [key, component] of Object.entries(ElementPlusIconsVue)) {
    app.component(key, component);
}

// 使用Element Plus
app.use(ElementPlus);

// 挂载应用
app.mount('#app');