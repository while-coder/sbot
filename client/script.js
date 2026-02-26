const API = window.location.origin;
let settings = {};
let mcpServers = {};
let mcpBuiltins = [];
let globalSkills = [];
let skillBuiltins = [];

// ===== Toast =====
function showToast(msg, type = 'success') {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.className = 'toast show ' + type;
    setTimeout(() => el.className = 'toast', 2500);
}
function esc(s) { if (!s) return ''; const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

// ===== API =====
async function apiFetch(path, method = 'GET', body = undefined) {
    const opts = { method, headers: { 'Content-Type': 'application/json' } };
    if (body !== undefined) opts.body = JSON.stringify(body);
    const res = await fetch(API + path, opts);
    const data = await res.json();
    if (!data.success) throw new Error(data.message || '请求失败');
    return data;
}

// ===== 加载数据 =====
async function loadSettings() {
    try {
        const res = await apiFetch('/api/settings');
        settings = res.data || {};
        renderAll();
    } catch (e) { showToast(e.message, 'error'); }
}

async function loadMcp() {
    try {
        const res = await apiFetch('/api/mcp');
        mcpBuiltins = res.data?.builtins || [];
        mcpServers = res.data?.servers || {};
        renderMcpTable();
    } catch (e) { showToast(e.message, 'error'); }
}

function renderAll() {
    renderGeneralPage();
    renderAgentsTable();
    renderModelsTable();
    renderEmbeddingsTable();
    renderMemoryPage();
}

// ===== 基本设置 =====
function renderGeneralPage() {
    document.getElementById('larkAppId').value = settings.lark?.appId || '';
    document.getElementById('larkAppSecret').value = settings.lark?.appSecret || '';
}

// 已移除旧的 Plan 模式相关代码

async function saveGeneralSettings() {
    try {
        settings.lark = settings.lark || {};
        settings.lark.appId = document.getElementById('larkAppId').value;
        settings.lark.appSecret = document.getElementById('larkAppSecret').value;
        await apiFetch('/api/settings', 'PUT', settings);
        showToast('保存成功');
    } catch (e) { showToast(e.message, 'error'); }
}

// ===== 模型管理 =====
let editingModelName = null;

function renderModelsTable() {
    const models = settings.models || {};
    const tbody = document.getElementById('modelsTableBody');
    const entries = Object.entries(models);
    if (entries.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#94a3b8;padding:40px">暂无模型</td></tr>';
        return;
    }
    tbody.innerHTML = entries.map(([name, m]) => {
        return '<tr>' +
            '<td>' + esc(name) + '</td>' +
            '<td>' + esc(m.provider) + '</td>' +
            '<td>' + esc(m.baseURL) + '</td>' +
            '<td>' + esc(m.model) + '</td>' +
            '<td>' +
                '<button class="btn btn-outline-dark btn-sm" onclick="editModel(\'' + esc(name) + '\')">编辑</button> ' +
                '<button class="btn btn-danger btn-sm" onclick="deleteModel(\'' + esc(name) + '\')">删除</button>' +
            '</td></tr>';
    }).join('');
}

function showModelModal(name) {
    editingModelName = name || null;
    const m = name ? (settings.models || {})[name] : {};
    document.getElementById('modelModalTitle').textContent = name ? '编辑模型' : '添加模型';
    document.getElementById('modelName').value = name || '';
    document.getElementById('modelProvider').value = m.provider || 'openai';
    document.getElementById('modelBaseURL').value = m.baseURL || '';
    document.getElementById('modelApiKey').value = m.apiKey || '';
    document.getElementById('modelModel').value = m.model || '';
    document.getElementById('modelTemperature').value = m.temperature ?? '';
    document.getElementById('modelModal').classList.add('show');
}
function editModel(name) { showModelModal(name); }
function closeModelModal() { document.getElementById('modelModal').classList.remove('show'); }

async function saveModel() {
    try {
        const name = document.getElementById('modelName').value.trim();
        if (!name) { showToast('名称不能为空', 'error'); return; }
        settings.models = settings.models || {};
        if (editingModelName && editingModelName !== name) {
            delete settings.models[editingModelName];
        }
        const temp = document.getElementById('modelTemperature').value;
        settings.models[name] = {
            provider: document.getElementById('modelProvider').value,
            baseURL: document.getElementById('modelBaseURL').value,
            apiKey: document.getElementById('modelApiKey').value,
            model: document.getElementById('modelModel').value,
        };
        if (temp !== '') settings.models[name].temperature = parseFloat(temp);
        await apiFetch('/api/settings', 'PUT', settings);
        closeModelModal();
        showToast('保存成功');
        renderAll();
    } catch (e) { showToast(e.message, 'error'); }
}

async function deleteModel(name) {
    if (!confirm('确定要删除模型 "' + name + '" 吗？')) return;
    try {
        delete settings.models[name];
        await apiFetch('/api/settings', 'PUT', settings);
        showToast('删除成功');
        renderAll();
    } catch (e) { showToast(e.message, 'error'); }
}

// ===== Embedding 管理 =====
let editingEmbeddingName = null;

function renderEmbeddingsTable() {
    const embeddings = settings.embeddings || {};
    const tbody = document.getElementById('embeddingsTableBody');
    const entries = Object.entries(embeddings);
    if (entries.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#94a3b8;padding:40px">暂无 Embedding</td></tr>';
        return;
    }
    tbody.innerHTML = entries.map(([name, m]) =>
        '<tr>' +
        '<td>' + esc(name) + '</td>' +
        '<td>' + esc(m.provider) + '</td>' +
        '<td>' + esc(m.baseURL) + '</td>' +
        '<td>' + esc(m.model) + '</td>' +
        '<td>' +
            '<button class="btn btn-outline-dark btn-sm" onclick="editEmbedding(\'' + esc(name) + '\')">编辑</button> ' +
            '<button class="btn btn-danger btn-sm" onclick="deleteEmbedding(\'' + esc(name) + '\')">删除</button>' +
        '</td></tr>'
    ).join('');
    // 更新记忆页的 embedding 下拉
    renderMemorySelects();
}

function showEmbeddingModal(name) {
    editingEmbeddingName = name || null;
    const m = name ? (settings.embeddings || {})[name] : {};
    document.getElementById('embeddingModalTitle').textContent = name ? '编辑 Embedding' : '添加 Embedding';
    document.getElementById('embeddingName').value = name || '';
    document.getElementById('embeddingProvider').value = m.provider || 'openai';
    document.getElementById('embeddingBaseURL').value = m.baseURL || '';
    document.getElementById('embeddingApiKey').value = m.apiKey || '';
    document.getElementById('embeddingModel').value = m.model || '';
    document.getElementById('embeddingModal').classList.add('show');
}
function editEmbedding(name) { showEmbeddingModal(name); }
function closeEmbeddingModal() { document.getElementById('embeddingModal').classList.remove('show'); }

async function saveEmbedding() {
    try {
        const name = document.getElementById('embeddingName').value.trim();
        if (!name) { showToast('名称不能为空', 'error'); return; }
        settings.embeddings = settings.embeddings || {};
        if (editingEmbeddingName && editingEmbeddingName !== name) {
            delete settings.embeddings[editingEmbeddingName];
        }
        settings.embeddings[name] = {
            provider: document.getElementById('embeddingProvider').value,
            baseURL: document.getElementById('embeddingBaseURL').value,
            apiKey: document.getElementById('embeddingApiKey').value,
            model: document.getElementById('embeddingModel').value,
        };
        await apiFetch('/api/settings', 'PUT', settings);
        closeEmbeddingModal();
        showToast('保存成功');
        renderAll();
    } catch (e) { showToast(e.message, 'error'); }
}

async function deleteEmbedding(name) {
    if (!confirm('确定要删除 Embedding "' + name + '" 吗？')) return;
    try {
        delete settings.embeddings[name];
        await apiFetch('/api/settings', 'PUT', settings);
        showToast('删除成功');
        renderAll();
    } catch (e) { showToast(e.message, 'error'); }
}

// ===== 记忆设置 =====
function renderMemoryPage() {
    const mem = settings.memory || {};
    document.getElementById('memoryEnabled').checked = !!mem.enabled;
    document.getElementById('memoryMode').value = mem.mode || 'human_and_ai';
    document.getElementById('memoryMaxAgeDays').value = mem.maxAgeDays ?? 90;
    renderMemorySelects();
}

function renderMemorySelects() {
    const mem = settings.memory || {};
    const models = Object.keys(settings.models || {});
    const embeddings = Object.keys(settings.embeddings || {});

    fillSelect('memoryEmbedding', embeddings, mem.embedding, false);
    fillSelect('memoryEvaluator', models, mem.evaluator, true);
    fillSelect('memoryExtractor', models, mem.extractor, true);
    fillSelect('memoryCompressor', models, mem.compressor, true);
}

function fillSelect(id, options, current, allowEmpty) {
    const sel = document.getElementById(id);
    let html = allowEmpty ? '<option value="">不使用</option>' : '';
    html += options.map(o => '<option value="' + esc(o) + '"' + (o === current ? ' selected' : '') + '>' + esc(o) + '</option>').join('');
    sel.innerHTML = html;
}

async function saveMemorySettings() {
    try {
        settings.memory = settings.memory || {};
        settings.memory.enabled = document.getElementById('memoryEnabled').checked;
        settings.memory.mode = document.getElementById('memoryMode').value || undefined;
        settings.memory.maxAgeDays = parseInt(document.getElementById('memoryMaxAgeDays').value) || 90;
        settings.memory.embedding = document.getElementById('memoryEmbedding').value || undefined;
        settings.memory.evaluator = document.getElementById('memoryEvaluator').value || undefined;
        settings.memory.extractor = document.getElementById('memoryExtractor').value || undefined;
        settings.memory.compressor = document.getElementById('memoryCompressor').value || undefined;
        await apiFetch('/api/settings', 'PUT', settings);
        showToast('保存成功');
    } catch (e) { showToast(e.message, 'error'); }
}

// ===== MCP 管理 =====
let editingMcpName = null;
let viewingMcpName = null;
let agentMcpServers = {};
let agentMcpGlobals = [];
let currentAgentMcpName = null;
function _mcpServers() { return currentAgentMcpName ? agentMcpServers : mcpServers; }
function _mcpEndpoint() { return currentAgentMcpName ? `/api/agents/${currentAgentMcpName}/mcp` : '/api/mcp'; }
function _mcpRenderTable() { if (currentAgentMcpName) renderAgentMcpTable(); else renderMcpTable(); }

// ===== Agent MCP 页面 =====
async function openAgentMcpPage(agentName) {
    currentAgentMcpName = agentName;
    document.getElementById('agentMcpTitle').textContent = 'Agent: ' + agentName + ' — MCP 配置';
    document.querySelectorAll('.sidebar-item[data-page]').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.page-content').forEach(p => p.classList.toggle('active', p.id === 'page-agent-mcp'));
    await loadAgentMcp();
}
function closeAgentMcpPage() {
    currentAgentMcpName = null;
    document.querySelectorAll('.sidebar-item[data-page]').forEach(t => t.classList.toggle('active', t.dataset.page === 'page-agents'));
    document.querySelectorAll('.page-content').forEach(p => p.classList.toggle('active', p.id === 'page-agents'));
}
async function loadAgentMcp() {
    try {
        const res = await apiFetch('/api/agents/' + encodeURIComponent(currentAgentMcpName) + '/mcp');
        agentMcpGlobals = res.data?.globals || [];
        agentMcpServers = res.data?.servers || {};
    } catch (e) {
        agentMcpGlobals = [];
        agentMcpServers = {};
    }
    renderAgentMcpTable();
}
function renderAgentMcpTable() {
    const tbody = document.getElementById('agentMcpTableBody');
    const entries = Object.entries(agentMcpServers);
    if (agentMcpGlobals.length === 0 && entries.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:#94a3b8;padding:40px">暂无 MCP 服务</td></tr>';
        return;
    }
    const globalRows = agentMcpGlobals.map(name => {
        const isBuiltin = mcpBuiltins.includes(name);
        const globalCfg = mcpServers[name];
        const badge = isBuiltin ? '内置' : '全局';
        const type = isBuiltin ? '内置' : (globalCfg?.url ? 'http' : (globalCfg?.command ? 'stdio' : '全局'));
        const addr = isBuiltin ? '-' : (globalCfg?.url || (globalCfg?.command ? [globalCfg.command, ...(globalCfg.args || [])].join(' ') : '-'));
        return '<tr>' +
            '<td>' + esc(name) + ' <span style="color:#64748b;font-size:11px">(' + badge + ')</span></td>' +
            '<td>' + esc(type) + '</td>' +
            '<td>' + esc(addr) + '</td>' +
            '<td><button class="btn btn-outline-dark btn-sm" onclick="viewMcpTools(\'' + esc(name) + '\')">查看</button></td>' +
        '</tr>';
    }).join('');
    const serverRows = entries.map(([name, cfg]) => {
        const type = cfg.url ? 'http' : (cfg.command ? 'stdio' : cfg.type || '-');
        const addr = cfg.url || (cfg.command ? [cfg.command, ...(cfg.args || [])].join(' ') : '-');
        return '<tr>' +
            '<td>' + esc(name) + '</td>' +
            '<td>' + esc(type) + '</td>' +
            '<td>' + esc(addr) + '</td>' +
            '<td>' +
                '<button class="btn btn-outline-dark btn-sm" onclick="viewMcpTools(\'' + esc(name) + '\')">查看</button> ' +
                '<button class="btn btn-outline-dark btn-sm" onclick="editMcp(\'' + esc(name) + '\')">编辑</button> ' +
                '<button class="btn btn-danger btn-sm" onclick="deleteMcp(\'' + esc(name) + '\')">删除</button>' +
            '</td></tr>';
    }).join('');
    tbody.innerHTML = globalRows + serverRows;
}

function renderMcpTable() {
    const tbody = document.getElementById('mcpTableBody');
    const entries = Object.entries(mcpServers);
    const builtinRows = mcpBuiltins.map(name =>
        '<tr>' +
            '<td>' + esc(name) + '</td>' +
            '<td>内置</td>' +
            '<td>-</td>' +
            '<td><button class="btn btn-outline-dark btn-sm" onclick="viewMcpTools(\'' + esc(name) + '\')">查看</button></td>' +
        '</tr>'
    ).join('');
    if (entries.length === 0) {
        tbody.innerHTML = builtinRows;
        return;
    }
    tbody.innerHTML = builtinRows + entries.map(([name, cfg]) => {
        const type = cfg.url ? 'http' : (cfg.command ? 'stdio' : cfg.type || '-');
        const addr = cfg.url || (cfg.command ? [cfg.command, ...(cfg.args || [])].join(' ') : '-');
        return '<tr>' +
            '<td>' + esc(name) + '</td>' +
            '<td>' + esc(type) + '</td>' +
            '<td>' + esc(addr) + '</td>' +
            '<td>' +
                '<button class="btn btn-outline-dark btn-sm" onclick="viewMcpTools(\'' + esc(name) + '\')">查看</button> ' +
                '<button class="btn btn-outline-dark btn-sm" onclick="editMcp(\'' + esc(name) + '\')">编辑</button> ' +
                '<button class="btn btn-danger btn-sm" onclick="deleteMcp(\'' + esc(name) + '\')">删除</button>' +
            '</td></tr>';
    }).join('');
}

// ===== List Editor =====
function renderListEditor(containerId, label, items, placeholder) {
    const c = document.getElementById(containerId);
    let html = '<div class="list-editor"><div class="list-editor-label"><span>' + esc(label) + '</span>' +
        '<button class="btn btn-outline-dark btn-sm" onclick="listEditorAdd(\'' + containerId + '\',\'' + esc(placeholder) + '\')">+</button></div>' +
        '<div class="list-editor-items" id="' + containerId + '_items">';
    (items || []).forEach((v) => {
        html += '<div class="list-editor-row"><input type="text" value="' + esc(v) + '" placeholder="' + esc(placeholder) + '">' +
            '<button onclick="this.parentElement.remove()">x</button></div>';
    });
    html += '</div></div>';
    c.innerHTML = html;
}
function listEditorAdd(containerId, placeholder) {
    const items = document.getElementById(containerId + '_items');
    const row = document.createElement('div');
    row.className = 'list-editor-row';
    row.innerHTML = '<input type="text" placeholder="' + esc(placeholder) + '"><button onclick="this.parentElement.remove()">x</button>';
    items.appendChild(row);
}
function listEditorGetValues(containerId) {
    const items = document.getElementById(containerId + '_items');
    if (!items) return [];
    return Array.from(items.querySelectorAll('input')).map(i => i.value.trim()).filter(Boolean);
}

// ===== KV Editor =====
function renderKvEditor(containerId, label, obj, keyPh, valPh) {
    const c = document.getElementById(containerId);
    let html = '<div class="kv-editor"><div class="kv-editor-label"><span>' + esc(label) + '</span>' +
        '<button class="btn btn-outline-dark btn-sm" onclick="kvEditorAdd(\'' + containerId + '\',\'' + esc(keyPh) + '\',\'' + esc(valPh) + '\')">+</button></div>' +
        '<div class="kv-editor-items" id="' + containerId + '_items">';
    Object.entries(obj || {}).forEach(([k, v]) => {
        html += '<div class="kv-editor-row"><input type="text" value="' + esc(k) + '" placeholder="' + esc(keyPh) + '">' +
            '<input type="text" value="' + esc(String(v)) + '" placeholder="' + esc(valPh) + '">' +
            '<button onclick="this.parentElement.remove()">x</button></div>';
    });
    html += '</div></div>';
    c.innerHTML = html;
}
function kvEditorAdd(containerId, keyPh, valPh) {
    const items = document.getElementById(containerId + '_items');
    const row = document.createElement('div');
    row.className = 'kv-editor-row';
    row.innerHTML = '<input type="text" placeholder="' + esc(keyPh) + '"><input type="text" placeholder="' + esc(valPh) + '"><button onclick="this.parentElement.remove()">x</button>';
    items.appendChild(row);
}
function kvEditorGetValues(containerId) {
    const items = document.getElementById(containerId + '_items');
    if (!items) return {};
    const result = {};
    items.querySelectorAll('.kv-editor-row').forEach(row => {
        const inputs = row.querySelectorAll('input');
        const k = inputs[0].value.trim();
        const v = inputs[1].value.trim();
        if (k) result[k] = v;
    });
    return result;
}

// ===== MCP Modal =====
function onMcpTypeChange() {
    const isStdio = document.getElementById('mcpType').value === 'stdio';
    document.getElementById('mcpFieldsHttp').style.display = isStdio ? 'none' : '';
    document.getElementById('mcpFieldsStdio').style.display = isStdio ? '' : 'none';
}

function showMcpModal(name) {
    editingMcpName = name || null;
    document.getElementById('mcpModalTitle').textContent = name ? '编辑 MCP 服务' : '添加 MCP 服务';
    document.getElementById('mcpName').value = name || '';

    const cfg = name ? (_mcpServers()[name] || {}) : {};
    const isStdio = !!cfg.command || cfg.type === 'stdio' || cfg.transport === 'stdio';

    document.getElementById('mcpType').value = isStdio ? 'stdio' : 'http';
    onMcpTypeChange();

    // HTTP
    document.getElementById('mcpUrl').value = cfg.url || '';
    renderKvEditor('mcpHeadersEditor', 'Headers', cfg.headers, 'Key', 'Value');

    // Stdio
    document.getElementById('mcpCommand').value = cfg.command || '';
    renderListEditor('mcpArgsEditor', 'Args', Array.isArray(cfg.args) ? cfg.args : [], '参数');
    renderKvEditor('mcpEnvEditor', 'Env 环境变量', cfg.env, '变量名', '值');
    document.getElementById('mcpCwd').value = cfg.cwd || '';

    // Common
    document.getElementById('mcpToolTimeout').value = cfg.defaultToolTimeout || '';

    document.getElementById('mcpModal').classList.add('show');
}
function editMcp(name) { showMcpModal(name); }
function closeMcpModal() { document.getElementById('mcpModal').classList.remove('show'); }

async function saveMcp() {
    try {
        const name = document.getElementById('mcpName').value.trim();
        if (!name) { showToast('名称不能为空', 'error'); return; }

        const type = document.getElementById('mcpType').value;
        const cfg = {};

        if (type === 'stdio') {
            const command = document.getElementById('mcpCommand').value.trim();
            if (!command) { showToast('Command 不能为空', 'error'); return; }
            cfg.command = command;
            cfg.args = listEditorGetValues('mcpArgsEditor');
            const env = kvEditorGetValues('mcpEnvEditor');
            if (Object.keys(env).length > 0) cfg.env = env;
            const cwd = document.getElementById('mcpCwd').value.trim();
            if (cwd) cfg.cwd = cwd;
        } else {
            const url = document.getElementById('mcpUrl').value.trim();
            if (!url) { showToast('URL 不能为空', 'error'); return; }
            cfg.type = 'http';
            cfg.url = url;
            const headers = kvEditorGetValues('mcpHeadersEditor');
            if (Object.keys(headers).length > 0) cfg.headers = headers;
        }

        // Common
        const timeout = document.getElementById('mcpToolTimeout').value.trim();
        if (timeout) cfg.defaultToolTimeout = parseInt(timeout);

        // 如果名称变更，删除旧条目
        if (editingMcpName && editingMcpName !== name) {
            delete _mcpServers()[editingMcpName];
        }
        _mcpServers()[name] = cfg;
        await apiFetch(_mcpEndpoint(), 'PUT', _mcpServers());
        closeMcpModal();
        showToast('保存成功');
        _mcpRenderTable();
    } catch (e) { showToast(e.message, 'error'); }
}

async function deleteMcp(name) {
    if (!confirm('确定要删除 MCP "' + name + '" 吗？')) return;
    try {
        delete _mcpServers()[name];
        await apiFetch(_mcpEndpoint(), 'PUT', _mcpServers());
        showToast('删除成功');
        _mcpRenderTable();
    } catch (e) { showToast(e.message, 'error'); }
}

// ===== MCP Tools 查看 =====
async function viewMcpTools(name) {
    const isBuiltin = mcpBuiltins.includes(name);
    const isAgentGlobal = agentMcpGlobals.includes(name);
    const cfg = _mcpServers()[name];
    if (!isBuiltin && !isAgentGlobal && !cfg) { showToast('MCP 配置不存在', 'error'); return; }
    viewingMcpName = name;
    document.getElementById('mcpToolsModalTitle').innerHTML = esc(name) + '<span class="tools-count"></span>';
    document.getElementById('mcpToolsBody').innerHTML = '<div class="tools-loading">连接中，正在获取工具列表...</div>';
    document.getElementById('mcpToolsModal').classList.add('show');
    try {
        const toolsEndpoint = (currentAgentMcpName && cfg)
            ? `/api/agents/${encodeURIComponent(currentAgentMcpName)}/mcp/tools`
            : '/api/mcp/tools';
        const res = await apiFetch(toolsEndpoint, 'POST', { name });
        const tools = res.data || [];
        document.querySelector('#mcpToolsModalTitle .tools-count').textContent = '(' + tools.length + ' 个工具)';
        if (tools.length === 0) {
            document.getElementById('mcpToolsBody').innerHTML = '<div class="tools-loading">该 MCP 服务没有可用的工具</div>';
            return;
        }
        const disabledAutoSet = new Set(Array.isArray(cfg?.disabledAutoApproveTools) ? cfg.disabledAutoApproveTools : []);
        const isAgentMcp = !!currentAgentMcpName && !!cfg; // 只对 agent 私有服务显示自动批准开关
        document.getElementById('mcpToolsBody').innerHTML = '<ul class="tools-list">' +
            tools.map((t, i) =>
                '<li>' +
                '<div class="tool-header">' +
                    '<div class="tool-name" onclick="toggleToolParams(this)">' + esc(t.name) + '</div>' +
                    (isAgentMcp ? (
                    '<div class="tool-switches">' +
                        '<div class="tool-switch">' +
                            '<span class="tool-switch-label">自动批准</span>' +
                            '<label class="toggle"><input type="checkbox" ' +
                                (!disabledAutoSet.has(t.name) ? 'checked ' : '') +
                                'onchange="toggleToolAutoApprove(\'' + esc(t.name) + '\', this.checked)">' +
                                '<span class="toggle-slider"></span></label>' +
                        '</div>' +
                    '</div>'
                    ) : '') +
                '</div>' +
                (t.description ? '<div class="tool-desc">' + esc(t.description) + '</div>' : '') +
                '<div class="tool-params" id="toolParams_' + i + '">' + renderToolParams(t.parameters) + '</div>' +
                '</li>'
            ).join('') + '</ul>';
    } catch (e) {
        document.getElementById('mcpToolsBody').innerHTML = '<div class="tools-error">获取失败: ' + esc(e.message) + '</div>';
    }
}

async function toggleToolAutoApprove(toolName, autoApprove) {
    const cfg = _mcpServers()[viewingMcpName];
    if (!cfg) return;
    if (!Array.isArray(cfg.disabledAutoApproveTools)) cfg.disabledAutoApproveTools = [];
    if (autoApprove) {
        cfg.disabledAutoApproveTools = cfg.disabledAutoApproveTools.filter(n => n !== toolName);
    } else {
        if (!cfg.disabledAutoApproveTools.includes(toolName)) cfg.disabledAutoApproveTools.push(toolName);
    }
    if (cfg.disabledAutoApproveTools.length === 0) delete cfg.disabledAutoApproveTools;
    await apiFetch(_mcpEndpoint(), 'PUT', _mcpServers());
}

function toggleToolParams(el) {
    el.classList.toggle('expanded');
    const li = el.closest('li');
    const params = li ? li.querySelector('.tool-params') : null;
    if (params) params.classList.toggle('show');
}

function renderToolParams(schema) {
    if (!schema || !schema.properties || Object.keys(schema.properties).length === 0) {
        return '<div class="tool-no-params">无参数</div>';
    }
    const required = new Set(schema.required || []);
    return Object.entries(schema.properties).map(([name, prop]) => {
        let html = '<div class="tool-param">';
        html += '<div><span class="param-name">' + esc(name) + '</span>';
        html += '<span class="param-type">' + esc(formatParamType(prop)) + '</span>';
        if (required.has(name)) html += '<span class="param-required">*必填</span>';
        html += '</div>';
        if (prop.description) html += '<div class="param-desc">' + esc(prop.description) + '</div>';
        if (prop.enum) html += '<div class="param-enum">可选值: ' + prop.enum.map(v => esc(String(v))).join(' | ') + '</div>';
        if (prop.default !== undefined) html += '<div class="param-default">默认值: ' + esc(String(prop.default)) + '</div>';
        if (prop.type === 'object' && prop.properties) {
            html += '<div style="margin-left:12px;margin-top:4px;border-left:2px solid #f1f5f9;padding-left:10px">' + renderToolParams(prop) + '</div>';
        }
        if (prop.type === 'array' && prop.items) {
            html += '<div class="param-desc">元素类型: ' + esc(formatParamType(prop.items)) + '</div>';
            if (prop.items.type === 'object' && prop.items.properties) {
                html += '<div style="margin-left:12px;margin-top:4px;border-left:2px solid #f1f5f9;padding-left:10px">' + renderToolParams(prop.items) + '</div>';
            }
        }
        html += '</div>';
        return html;
    }).join('');
}

function formatParamType(prop) {
    if (!prop) return 'any';
    if (prop.type === 'array') {
        if (prop.items) return formatParamType(prop.items) + '[]';
        return 'array';
    }
    if (prop.type) return prop.type;
    if (prop.anyOf) return prop.anyOf.map(s => s.type || 'any').join(' | ');
    if (prop.oneOf) return prop.oneOf.map(s => s.type || 'any').join(' | ');
    return 'any';
}

function closeMcpToolsModal() { document.getElementById('mcpToolsModal').classList.remove('show'); }

// ===== Plan Agent 管理 (per-mode) =====
let editingAgentMode = '';
// ===== Agents 管理 =====
let editingAgentName = null;
let editingSubAgentParentType = null;
let editingSubAgentIndex = -1;
let tempSubAgents = []; // 临时存储子 agents
let tempMcpNames = [];  // 临时存储 MCP 服务器名称
let tempSkillsDirs = []; // 临时存储 Skills 目录

function renderAgentsTable() {
    const agents = settings.agents || {};
    const tbody = document.getElementById('agentsTableBody');
    const entries = Object.entries(agents);
    if (entries.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#94a3b8;padding:40px">暂无 Agent</td></tr>';
        return;
    }
    tbody.innerHTML = entries.map(([name, agent]) => {
        const isActive = name === settings.agent;
        const typeLabels = { single: 'Single', react: 'ReAct', supervisor: 'Supervisor' };
        const typeLabel = typeLabels[agent.type] || agent.type;
        const model = agent.model || '-';
        const desc = agent.systemPrompt ? (agent.systemPrompt.substring(0, 30) + '...') : '-';
        const activateBtn = isActive
            ? '<button class="btn btn-sm" style="background:#dcfce7;color:#16a34a;border:1px solid #bbf7d0;cursor:default">激活</button> '
            : '<button class="btn btn-outline-dark btn-sm" onclick="activateAgent(\'' + esc(name) + '\')">激活</button> ';
        return '<tr class="' + (isActive ? 'active-row' : '') + '">' +
            '<td>' + esc(name) + '</td>' +
            '<td>' + esc(typeLabel) + '</td>' +
            '<td>' + esc(model) + '</td>' +
            '<td>' + esc(desc) + '</td>' +
            '<td>' +
                activateBtn +
                '<button class="btn btn-outline-dark btn-sm" onclick="openAgentMcpPage(\'' + esc(name) + '\')">MCP配置</button> ' +
                '<button class="btn btn-outline-dark btn-sm" onclick="openAgentSkillsPage(\'' + esc(name) + '\')">Skills配置</button> ' +
                '<button class="btn btn-outline-dark btn-sm" onclick="editAgent(\'' + esc(name) + '\')">编辑</button> ' +
                '<button class="btn btn-outline-dark btn-sm" onclick="copyAgent(\'' + esc(name) + '\')">复制</button> ' +
                '<button class="btn btn-danger btn-sm" onclick="deleteAgent(\'' + esc(name) + '\')">删除</button>' +
            '</td></tr>';
    }).join('');
}

async function activateAgent(name) {
    try {
        settings.agent = name;
        await apiFetch('/api/settings', 'PUT', settings);
        renderAgentsTable();
        showToast('已激活 ' + name);
    } catch (e) { showToast(e.message, 'error'); }
}


function renderMcpCheckboxes() {
    const container = document.getElementById('mcpNamesContainer');
    if (!container) return;
    const keys = Object.keys(mcpServers);
    if (mcpBuiltins.length === 0 && keys.length === 0) {
        container.innerHTML = '<div style="color:#94a3b8;font-size:12px;padding:4px">暂无全局 MCP 服务器</div>';
        return;
    }
    const builtinItems = mcpBuiltins.map(name =>
        '<label class="check-item"><input type="checkbox"' +
        (tempMcpNames.includes(name) ? ' checked' : '') +
        ' onchange="toggleMcpName(\'' + esc(name) + '\', this.checked)"><span>' + esc(name) + ' <span style="color:#64748b;font-size:11px">(内置)</span></span></label>'
    ).join('');
    const serverItems = keys.map(name =>
        '<label class="check-item"><input type="checkbox"' +
        (tempMcpNames.includes(name) ? ' checked' : '') +
        ' onchange="toggleMcpName(\'' + esc(name) + '\', this.checked)"><span>' + esc(name) + '</span></label>'
    ).join('');
    container.innerHTML = '<div class="check-row">' + builtinItems + serverItems + '</div>';
}

function toggleMcpName(name, checked) {
    if (checked) { if (!tempMcpNames.includes(name)) tempMcpNames.push(name); }
    else { tempMcpNames = tempMcpNames.filter(n => n !== name); }
}

function renderSkillsCheckboxes() {
    const container = document.getElementById('skillsDirsContainer');
    if (!container) return;
    if (skillBuiltins.length === 0 && globalSkills.length === 0) {
        container.innerHTML = '<div style="color:#94a3b8;font-size:12px;padding:4px">暂无全局 Skills</div>';
        return;
    }
    const builtinItems = skillBuiltins.map(s =>
        '<label class="check-item"><input type="checkbox"' +
        (tempSkillsDirs.includes(s.name) ? ' checked' : '') +
        ' onchange="toggleSkillName(\'' + esc(s.name) + '\', this.checked)"><span>' + esc(s.name) + ' <span style="color:#64748b;font-size:11px">(内置)</span></span></label>'
    ).join('');
    const skillItems = globalSkills.map(s =>
        '<label class="check-item"><input type="checkbox"' +
        (tempSkillsDirs.includes(s.name) ? ' checked' : '') +
        ' onchange="toggleSkillName(\'' + esc(s.name) + '\', this.checked)"><span>' + esc(s.name) + '</span></label>'
    ).join('');
    container.innerHTML = '<div class="check-row">' + builtinItems + skillItems + '</div>';
}

function toggleSkillName(name, checked) {
    if (checked) { if (!tempSkillsDirs.includes(name)) tempSkillsDirs.push(name); }
    else { tempSkillsDirs = tempSkillsDirs.filter(n => n !== name); }
}

function showAgentModal() {
    editingAgentName = null;
    tempSubAgents = [];
    tempMcpNames = [];
    tempSkillsDirs = [];
    document.getElementById('agentModalTitle').textContent = '添加 Agent';
    document.getElementById('agentName').value = '';
    document.getElementById('agentType').value = 'single';
    fillModelSelects();
    clearAgentFields();
    onAgentTypeChange();
    document.getElementById('agentModal').classList.add('show');
}

function editAgent(name) {
    const agent = settings.agents[name];
    if (!agent) return;
    editingAgentName = name;
    document.getElementById('agentModalTitle').textContent = '编辑 Agent';
    document.getElementById('agentName').value = name;
    document.getElementById('agentType').value = agent.type;
    fillModelSelects();

    if (agent.type === 'single') {
        document.getElementById('agentModelSingle').value = agent.model || '';
        document.getElementById('agentSystemPromptSingle').value = agent.systemPrompt || '';
    } else if (agent.type === 'react') {
        document.getElementById('agentSystemPromptReact').value = agent.systemPrompt || '';
        document.getElementById('agentMaxIterations').value = agent.maxIterations || 5;
        document.getElementById('agentThinkModel').value = agent.think?.model || '';
        document.getElementById('agentReflectModel').value = agent.reflect?.model || '';
        tempSubAgents = Array.isArray(agent.agents) ? agent.agents : [];
    } else if (agent.type === 'supervisor') {
        document.getElementById('agentSystemPromptSupervisor').value = agent.systemPrompt || '';
        document.getElementById('agentMaxRounds').value = agent.maxRounds || 10;
        document.getElementById('agentSupervisorModel').value = agent.supervisor?.model || '';
        tempSubAgents = Array.isArray(agent.agents) ? agent.agents : [];
    }

    tempMcpNames = Array.isArray(agent.mcp) ? [...agent.mcp] : [];
    tempSkillsDirs = Array.isArray(agent.skills) ? [...agent.skills] : [];

    onAgentTypeChange();
    renderSubAgents(agent.type);
    renderMcpCheckboxes();
    renderSkillsCheckboxes();
    document.getElementById('agentModal').classList.add('show');
}

function closeAgentModal() {
    document.getElementById('agentModal').classList.remove('show');
    tempSubAgents = [];
    tempMcpNames = [];
    tempSkillsDirs = [];
}

function fillModelSelects() {
    const models = settings.models || {};
    const options = Object.keys(models).map(k =>
        '<option value="' + esc(k) + '">' + esc(k) + '</option>'
    ).join('');
    document.getElementById('agentModelSingle').innerHTML = options;
    document.getElementById('agentThinkModel').innerHTML = options;
    document.getElementById('agentReflectModel').innerHTML = options;
    document.getElementById('agentSupervisorModel').innerHTML = options;
}

function fillSubAgentSelect(excludeName) {
    const agents = settings.agents || {};
    const options = Object.keys(agents)
        .filter(k => k !== excludeName)
        .map(k => '<option value="' + esc(k) + '">' + esc(k) + ' (' + esc(agents[k].type) + ')</option>')
        .join('');
    document.getElementById('subAgentRef').innerHTML = options || '<option value="">暂无可用 Agent</option>';
}

function clearAgentFields() {
    document.getElementById('agentModelSingle').value = '';
    document.getElementById('agentSystemPromptSingle').value = '';
    document.getElementById('agentSystemPromptReact').value = '';
    document.getElementById('agentSystemPromptSupervisor').value = '';
    document.getElementById('agentMaxIterations').value = '5';
    document.getElementById('agentThinkModel').value = '';
    document.getElementById('agentReflectModel').value = '';
    document.getElementById('agentMaxRounds').value = '10';
    document.getElementById('agentSupervisorModel').value = '';
    tempMcpNames = [];
    tempSkillsDirs = [];
    renderMcpCheckboxes();
    renderSkillsCheckboxes();
}

function onAgentTypeChange() {
    const type = document.getElementById('agentType').value;
    document.getElementById('agentFieldsSingle').style.display = type === 'single' ? 'block' : 'none';
    document.getElementById('agentFieldsReact').style.display = type === 'react' ? 'block' : 'none';
    document.getElementById('agentFieldsSupervisor').style.display = type === 'supervisor' ? 'block' : 'none';
}

async function saveAgent() {
    try {
        const name = document.getElementById('agentName').value.trim();
        const type = document.getElementById('agentType').value;
        if (!name) { showToast('名称不能为空', 'error'); return; }

        let agentConfig = { type };


        if (type === 'single') {
            const model = document.getElementById('agentModelSingle').value.trim();
            const systemPrompt = document.getElementById('agentSystemPromptSingle').value.trim();
            if (model) agentConfig.model = model;
            if (systemPrompt) agentConfig.systemPrompt = systemPrompt;
        } else if (type === 'react') {
            const systemPrompt = document.getElementById('agentSystemPromptReact').value.trim();
            if (systemPrompt) agentConfig.systemPrompt = systemPrompt;

            const maxIterations = parseInt(document.getElementById('agentMaxIterations').value) || 5;
            agentConfig.maxIterations = maxIterations;

            const thinkModel = document.getElementById('agentThinkModel').value.trim();
            if (thinkModel) agentConfig.think = { model: thinkModel };

            const reflectModel = document.getElementById('agentReflectModel').value.trim();
            if (reflectModel) agentConfig.reflect = { model: reflectModel };

            agentConfig.agents = tempSubAgents;
        } else if (type === 'supervisor') {
            const systemPrompt = document.getElementById('agentSystemPromptSupervisor').value.trim();
            if (systemPrompt) agentConfig.systemPrompt = systemPrompt;

            const maxRounds = parseInt(document.getElementById('agentMaxRounds').value) || 10;
            agentConfig.maxRounds = maxRounds;

            const supervisorModel = document.getElementById('agentSupervisorModel').value.trim();
            if (supervisorModel) agentConfig.supervisor = { model: supervisorModel };

            agentConfig.agents = tempSubAgents;
        }

        if (tempMcpNames.length > 0) agentConfig.mcp = [...tempMcpNames];
        if (tempSkillsDirs.length > 0) agentConfig.skills = [...tempSkillsDirs];

        settings.agents = settings.agents || {};
        if (editingAgentName && editingAgentName !== name) {
            delete settings.agents[editingAgentName];
            if (settings.agent === editingAgentName) settings.agent = name;
        }
        settings.agents[name] = agentConfig;

        await apiFetch('/api/settings', 'PUT', settings);
        closeAgentModal();
        showToast('保存成功');
        renderAgentsTable();
        renderGeneralPage();
    } catch (e) { showToast(e.message, 'error'); }
}

async function copyAgent(name) {
    const agent = settings.agents[name];
    if (!agent) return;
    const agents = settings.agents;
    let newName = name + '-copy';
    let i = 2;
    while (agents[newName]) newName = name + '-copy' + (i++);
    try {
        agents[newName] = JSON.parse(JSON.stringify(agent));
        await apiFetch('/api/settings', 'PUT', settings);
        showToast('已复制为 ' + newName);
        renderAgentsTable();
    } catch (e) { showToast(e.message, 'error'); }
}

async function deleteAgent(name) {
    if (!confirm('确定要删除 Agent "' + name + '" 吗？')) return;
    try {
        delete settings.agents[name];
        if (settings.agent === name) {
            settings.agent = Object.keys(settings.agents)[0] || '';
        }
        await apiFetch('/api/settings', 'PUT', settings);
        showToast('删除成功');
        renderAgentsTable();
        renderGeneralPage();
    } catch (e) { showToast(e.message, 'error'); }
}

// ===== 子 Agent 管理 =====
function renderSubAgents(parentType) {
    const containerId = parentType === 'supervisor' ? 'supervisorSubAgentsContainer' : 'reactSubAgentsContainer';
    const container = document.getElementById(containerId);
    if (!container) return;

    if (tempSubAgents.length === 0) {
        container.innerHTML = '<div style="color:#94a3b8;font-size:12px;padding:8px">暂无子 Agent</div>';
        return;
    }

    container.innerHTML = tempSubAgents.map((ref, i) => {
        const entry = (settings.agents || {})[ref.name];
        const typeLabel = entry ? ' (' + esc(entry.type) + ')' : '';
        return '<div style="padding:8px;margin-bottom:8px;border:1px solid #e2e8f0;border-radius:4px;background:#f8fafc">' +
            '<div style="display:flex;align-items:center;justify-content:space-between">' +
                '<div style="font-size:13px;font-weight:500">' + esc(ref.name) + '<span style="font-weight:400;color:#64748b">' + typeLabel + '</span></div>' +
                '<div>' +
                    '<button class="btn btn-outline-dark btn-sm" onclick="editSubAgent(\'' + parentType + '\',' + i + ')">编辑</button> ' +
                    '<button class="btn btn-danger btn-sm" onclick="deleteSubAgent(' + i + ')">删除</button>' +
                '</div>' +
            '</div>' +
            '<div style="font-size:11px;color:#64748b;margin-top:4px">' + esc(ref.desc || '') + '</div>' +
        '</div>';
    }).join('');
}

function addSubAgent(parentType) {
    editingSubAgentParentType = parentType;
    editingSubAgentIndex = -1;
    document.getElementById('subAgentModalTitle').textContent = '添加子 Agent';
    const currentName = document.getElementById('agentName').value;
    fillSubAgentSelect(currentName);
    document.getElementById('subAgentRef').value = '';
    document.getElementById('subAgentDesc').value = '';
    document.getElementById('subAgentModal').classList.add('show');
}

function editSubAgent(parentType, index) {
    const ref = tempSubAgents[index];
    if (!ref) return;
    editingSubAgentParentType = parentType;
    editingSubAgentIndex = index;
    document.getElementById('subAgentModalTitle').textContent = '编辑子 Agent';
    const currentName = document.getElementById('agentName').value;
    fillSubAgentSelect(currentName);
    document.getElementById('subAgentRef').value = ref.name;
    document.getElementById('subAgentDesc').value = ref.desc || '';
    document.getElementById('subAgentModal').classList.add('show');
}

function closeSubAgentModal() {
    document.getElementById('subAgentModal').classList.remove('show');
}

function saveSubAgent() {
    const name = document.getElementById('subAgentRef').value;
    const desc = document.getElementById('subAgentDesc').value.trim();
    if (!name) { showToast('请选择一个 Agent', 'error'); return; }
    if (!desc) { showToast('描述不能为空', 'error'); return; }

    const ref = { name, desc };
    if (editingSubAgentIndex >= 0) {
        tempSubAgents[editingSubAgentIndex] = ref;
    } else {
        tempSubAgents.push(ref);
    }

    renderSubAgents(editingSubAgentParentType);
    closeSubAgentModal();
    showToast('子 Agent 已更新');
}

function deleteSubAgent(index) {
    if (!confirm('确定要删除此子 Agent 吗？')) return;
    tempSubAgents.splice(index, 1);
    const type = document.getElementById('agentType').value;
    renderSubAgents(type);
    showToast('子 Agent 已删除');
}

// ===== Skills 管理 =====
let currentSkillsAgent = null; // null = 全局 skills, string = agent name
let editingSkillOldName = null;

function _skillsEndpoint() { return currentSkillsAgent ? '/api/agents/' + encodeURIComponent(currentSkillsAgent) + '/skills' : '/api/skills'; }

async function loadSkills() {
    try {
        const res = await apiFetch(_skillsEndpoint());
        const skills = res.data?.skills || [];
        let globals;
        if (!currentSkillsAgent) {
            const builtins = res.data?.builtins || [];
            skillBuiltins = builtins;
            globalSkills = skills;
            globals = builtins.map(s => ({ ...s, isBuiltin: true }));
        } else {
            globals = res.data?.globals || [];
        }
        const tbodyId = currentSkillsAgent ? 'agentSkillsTableBody' : 'skillsTableBody';
        renderSkillsTable(skills, globals, tbodyId);
    } catch (e) { showToast(e.message, 'error'); }
}

async function loadGlobalSkills() {
    currentSkillsAgent = null;
    await loadSkills();
}

function renderSkillsTable(skills, globals, tbodyId) {
    const tbody = document.getElementById(tbodyId);
    if (globals.length === 0 && skills.length === 0) {
        tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;color:#94a3b8;padding:40px">暂无 Skill</td></tr>';
        return;
    }
    const globalRows = globals.map(s => {
        const badge = s.isBuiltin !== false ? '内置' : '全局';
        return '<tr>' +
            '<td style="font-family:Consolas,Monaco,monospace">' + esc(s.name) + ' <span style="color:#64748b;font-size:11px">(' + badge + ')</span></td>' +
            '<td>' + esc(s.description || '-') + '</td>' +
            '<td>-</td>' +
            '</tr>';
    }).join('');
    const skillRows = skills.map(s =>
        '<tr>' +
        '<td style="font-family:Consolas,Monaco,monospace">' + esc(s.name) + '</td>' +
        '<td>' + esc(s.description || '-') + '</td>' +
        '<td>' +
            '<button class="btn btn-outline-dark btn-sm" onclick="editSkill(\'' + esc(s.name) + '\')">编辑</button> ' +
            '<button class="btn btn-danger btn-sm" onclick="deleteSkillItem(\'' + esc(s.name) + '\')">删除</button>' +
        '</td></tr>'
    ).join('');
    tbody.innerHTML = globalRows + skillRows;
}

function showSkillModal(name) {
    editingSkillOldName = name || null;
    document.getElementById('skillModalTitle').textContent = name ? '编辑 Skill' : '添加 Skill';
    document.getElementById('skillNameInput').value = name || '';
    document.getElementById('skillNameInput').disabled = !!name;
    document.getElementById('skillContent').value = '';
    if (name) {
        apiFetch(_skillsEndpoint() + '/' + encodeURIComponent(name))
            .then(res => { document.getElementById('skillContent').value = res.data.content; })
            .catch(e => showToast(e.message, 'error'));
    } else {
        document.getElementById('skillContent').value = '---\nname: \ndescription: \"\"\n---\n\n';
    }
    document.getElementById('skillModal').classList.add('show');
}

function editSkill(name) { showSkillModal(name); }

function closeSkillModal() {
    document.getElementById('skillModal').classList.remove('show');
    document.getElementById('skillNameInput').disabled = false;
}

async function saveSkill() {
    try {
        const name = document.getElementById('skillNameInput').value.trim();
        const content = document.getElementById('skillContent').value;
        if (!name) { showToast('名称不能为空', 'error'); return; }
        if (!content.trim()) { showToast('内容不能为空', 'error'); return; }
        await apiFetch(_skillsEndpoint() + '/' + encodeURIComponent(name), 'PUT', { content });
        closeSkillModal();
        showToast('保存成功');
        await loadSkills();
    } catch (e) { showToast(e.message, 'error'); }
}

async function deleteSkillItem(name) {
    if (!confirm('确定要删除 Skill "' + name + '" 吗？此操作将删除整个 Skill 目录！')) return;
    try {
        await apiFetch(_skillsEndpoint() + '/' + encodeURIComponent(name), 'DELETE');
        showToast('删除成功');
        await loadSkills();
    } catch (e) { showToast(e.message, 'error'); }
}

// ===== Agent Skills 页面 =====
async function openAgentSkillsPage(agentName) {
    currentSkillsAgent = agentName;
    document.getElementById('agentSkillsTitle').textContent = 'Agent: ' + agentName + ' — Skills 配置';
    document.getElementById('agentSkillsPathDisplay').textContent = '~/.sbot/agents/' + agentName + '/skills/';
    document.querySelectorAll('.sidebar-item[data-page]').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.page-content').forEach(p => p.classList.toggle('active', p.id === 'page-agent-skills'));
    await loadSkills();
}

function closeAgentSkillsPage() {
    currentSkillsAgent = null;
    document.querySelectorAll('.sidebar-item[data-page]').forEach(t => t.classList.toggle('active', t.dataset.page === 'page-agents'));
    document.querySelectorAll('.page-content').forEach(p => p.classList.toggle('active', p.id === 'page-agents'));
}

// ===== 重载配置 =====
async function reloadConfig() {
    try {
        await apiFetch('/api/reload', 'POST');
        showToast('配置已重载');
        await loadSettings();
        await loadMcp();
    } catch (e) { showToast(e.message, 'error'); }
}

// ===== 历史记录管理 =====
let _lastHistoryUserId = null;

async function loadHistoryUsers() {
    try {
        const res = await apiFetch('/api/users');
        const users = res.data || [];
        const sel = document.getElementById('historyUserSelect');
        sel.innerHTML = users.length === 0
            ? '<option value="">暂无用户</option>'
            : users.map(u => '<option value="' + esc(u) + '">' + esc(u) + '</option>').join('');
        // 恢复上次选中的用户
        if (_lastHistoryUserId && users.includes(_lastHistoryUserId)) {
            sel.value = _lastHistoryUserId;
        }
        if (users.length > 0) await loadHistory();
    } catch (e) { showToast(e.message, 'error'); }
}

async function loadHistory() {
    const userId = document.getElementById('historyUserSelect').value;
    if (!userId) return;
    _lastHistoryUserId = userId;
    try {
        const res = await apiFetch('/api/users/' + encodeURIComponent(userId) + '/history');
        renderHistoryMessages(res.data || []);
    } catch (e) { showToast(e.message, 'error'); }
}

function renderHistoryMessages(messages) {
    const container = document.getElementById('historyMessages');
    if (messages.length === 0) {
        container.innerHTML = '<div style="text-align:center;color:#94a3b8;padding:60px">暂无历史记录</div>';
        return;
    }
    // 建立 tool_call_id → tool message 映射
    const toolResultMap = {};
    for (const m of messages) {
        if (m.role === 'tool' && m.tool_call_id) {
            toolResultMap[m.tool_call_id] = m;
        }
    }
    const parts = [];
    for (const m of messages) {
        // tool 消息内嵌在对应 AI 消息的 tool_call 里，不单独渲染
        if (m.role === 'tool' && m.tool_call_id) continue;
        parts.push(renderOneMessage(m, toolResultMap));
    }
    container.innerHTML = parts.join('');
    container.scrollTop = container.scrollHeight;
}

function fmtTs(ts) {
    if (!ts) return '';
    try { return new Date(ts).toLocaleString(); } catch { return ''; }
}

function renderOneMessage(m, toolResultMap) {
    const role = m.role || 'unknown';
    const ts = m.timestamp ? '<div class="msg-ts">' + esc(fmtTs(m.timestamp)) + '</div>' : '';
    if (role === 'human') {
        return '<div class="msg-row human">' + ts +
            '<div class="msg-bubble human"><div class="msg-role">用户</div>' + esc(m.content) + '</div>' +
            '</div>';
    }
    if (role === 'ai') {
        let inner = '';
        if (m.content) {
            inner += '<div class="msg-bubble ai"><div class="msg-role">AI</div>' + esc(m.content) + '</div>';
        }
        if (m.tool_calls && m.tool_calls.length > 0) {
            const callsHtml = m.tool_calls.map(tc => {
                const result = toolResultMap[tc.id];
                let item = '<div class="tool-call-item">' +
                    '<div class="tool-call-header" onclick="toggleToolCall(this)">' +
                    '<span class="tool-call-name">' + esc(tc.name) + '</span></div>' +
                    '<div class="tool-call-detail">' +
                    '<div class="tool-call-args">' + esc(JSON.stringify(tc.args, null, 2)) + '</div>';
                if (result) {
                    item += '<div class="tool-call-result">' +
                        '<div class="tool-call-result-label">返回结果</div>' +
                        esc(result.content) + '</div>';
                }
                item += '</div></div>';
                return item;
            }).join('');
            inner += '<div class="msg-tool-calls"><div class="msg-role">Tool Calls (' + m.tool_calls.length + ')</div>' + callsHtml + '</div>';
        }
        return '<div class="msg-row ai">' + ts + inner + '</div>';
    }
    if (role === 'tool') {
        const name = m.name ? ' · ' + m.name : '';
        return '<div class="msg-row ai">' +
            '<div class="msg-bubble tool"><div class="msg-role">Tool' + esc(name) + '</div>' + esc(m.content) + '</div>' +
            '</div>';
    }
    // system / unknown
    return '<div class="msg-row ai">' + ts +
        '<div class="msg-bubble ai"><div class="msg-role">' + esc(role) + '</div>' + esc(m.content) + '</div>' +
        '</div>';
}

function toggleToolCall(header) {
    header.classList.toggle('expanded');
    header.nextElementSibling.classList.toggle('show');
}

async function clearHistory() {
    const userId = document.getElementById('historyUserSelect').value;
    if (!userId || !confirm('确定要清除 ' + userId + ' 的所有历史记录吗？')) return;
    try {
        await apiFetch('/api/users/' + encodeURIComponent(userId) + '/history', 'DELETE');
        showToast('历史已清除');
        renderHistoryMessages([]);
    } catch (e) { showToast(e.message, 'error'); }
}

// ===== 聊天输入 =====
(function () {
    // Enter 发送，Shift+Enter 换行，自动高度
    document.addEventListener('DOMContentLoaded', () => {
        const ta = document.getElementById('chatInput');
        if (!ta) return;
        ta.addEventListener('keydown', e => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendChatMessage();
            }
        });
        ta.addEventListener('input', () => {
            ta.style.height = 'auto';
            ta.style.height = Math.min(ta.scrollHeight, 160) + 'px';
        });
    });
})();

let _chatSending = false;
const _chatQueue = []; // { query: string }

function _chatQueueRender() {
    const el = document.getElementById('chatQueue');
    if (!el) return;
    if (_chatQueue.length === 0) { el.style.display = 'none'; return; }
    el.style.display = 'flex';
    el.innerHTML = '<div class="chat-queue-label">待发送（' + _chatQueue.length + '）</div>' +
        _chatQueue.map((item, i) =>
            '<div class="chat-queue-item">' +
            '<span class="chat-queue-text">' + esc(item.query) + '</span>' +
            '<button class="chat-queue-del" onclick="chatQueueRemove(' + i + ')" title="移除">×</button>' +
            '</div>'
        ).join('');
}

function chatQueueRemove(idx) {
    _chatQueue.splice(idx, 1);
    _chatQueueRender();
}

async function sendChatMessage() {
    const userId = document.getElementById('historyUserSelect').value;
    const ta = document.getElementById('chatInput');
    const query = ta.value.trim();
    if (!userId || !query) return;

    ta.value = '';
    ta.style.height = 'auto';
    ta.focus();

    if (_chatSending) {
        _chatQueue.push({ query });
        _chatQueueRender();
        return;
    }

    await _sendOneChatMessage(userId, query);
    await _drainChatQueue();
}

async function _drainChatQueue() {
    while (_chatQueue.length > 0) {
        const item = _chatQueue.shift();
        _chatQueueRender();
        const userId = document.getElementById('historyUserSelect').value;
        await _sendOneChatMessage(userId, item.query);
    }
}

async function _sendOneChatMessage(userId, query) {
    _chatSending = true;

    // 立即显示用户消息
    const container = document.getElementById('historyMessages');
    const userRow = document.createElement('div');
    userRow.className = 'msg-row human';
    userRow.innerHTML = '<div class="msg-ts">' + esc(fmtTs(new Date().toISOString())) + '</div>' +
        '<div class="msg-bubble human"><div class="msg-role">用户</div>' + esc(query) + '</div>';
    container.appendChild(userRow);

    // AI 占位气泡（流式更新）
    const aiRow = document.createElement('div');
    aiRow.className = 'msg-row ai';
    const aiBubble = document.createElement('div');
    aiBubble.className = 'msg-bubble ai streaming';
    aiBubble.innerHTML = '<div class="msg-role">AI</div><span style="color:#94a3b8">思考中…</span>';
    aiRow.appendChild(aiBubble);
    container.appendChild(aiRow);
    container.scrollTop = container.scrollHeight;

    try {
        const response = await fetch(API + '/api/users/' + encodeURIComponent(userId) + '/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query }),
        });
        if (!response.ok) throw new Error('请求失败: ' + response.status);

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        let streamContent = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += decoder.decode(value, { stream: true });
            const lines = buf.split('\n');
            buf = lines.pop();
            for (const line of lines) {
                if (!line.startsWith('data: ')) continue;
                let evt;
                try { evt = JSON.parse(line.slice(6)); } catch { continue; }
                if (evt.type === 'stream') {
                    streamContent = evt.content;
                    aiBubble.innerHTML = '<div class="msg-role">AI</div>' + esc(streamContent).replace(/\n/g, '<br>');
                    container.scrollTop = container.scrollHeight;
                } else if (evt.type === 'tool_call') {
                    const toolTag = document.createElement('div');
                    toolTag.className = 'msg-tool-calls';
                    toolTag.innerHTML = '<div class="msg-role">Tool Call</div>' +
                        '<div class="tool-call-item"><div class="tool-call-header expanded" onclick="toggleToolCall(this)">' +
                        '<span class="tool-call-name">' + esc(evt.name) + '</span></div>' +
                        '<div class="tool-call-detail show"><div class="tool-call-args">' +
                        esc(JSON.stringify(evt.args, null, 2)) + '</div></div></div>';
                    aiRow.appendChild(toolTag);
                    container.scrollTop = container.scrollHeight;
                } else if (evt.type === 'done') {
                    aiBubble.classList.remove('streaming');
                    await loadHistory();
                } else if (evt.type === 'error') {
                    aiBubble.classList.remove('streaming');
                    aiBubble.innerHTML += '<br><span style="color:#ef4444">错误: ' + esc(evt.message) + '</span>';
                }
            }
        }
    } catch (e) {
        aiBubble.classList.remove('streaming');
        aiBubble.innerHTML += '<br><span style="color:#ef4444">错误: ' + esc(e.message) + '</span>';
    } finally {
        _chatSending = false;
    }
}

// ===== 长期记忆管理 =====
async function loadMemoryUsers() {
    try {
        const res = await apiFetch('/api/users');
        const users = res.data || [];
        const sel = document.getElementById('memoryUserSelect');
        sel.innerHTML = users.length === 0
            ? '<option value="">暂无用户</option>'
            : users.map(u => '<option value="' + esc(u) + '">' + esc(u) + '</option>').join('');
        if (users.length > 0) await loadUserMemory();
    } catch (e) { showToast(e.message, 'error'); }
}

async function loadUserMemory() {
    const userId = document.getElementById('memoryUserSelect').value;
    if (!userId) return;
    try {
        const res = await apiFetch('/api/users/' + encodeURIComponent(userId) + '/memory');
        renderMemoryTable(userId, res.data || []);
    } catch (e) { showToast(e.message, 'error'); }
}

function renderMemoryTable(userId, memories) {
    const tbody = document.getElementById('userMemoryTableBody');
    if (memories.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#94a3b8;padding:40px">暂无记忆</td></tr>';
        return;
    }
    tbody.innerHTML = memories.map(m => {
        const date = m.timestamp ? new Date(m.timestamp).toLocaleString() : '-';
        const tags = (m.tags || []).join(', ');
        return '<tr>' +
            '<td style="max-width:420px;white-space:normal;word-break:break-word">' + esc(m.content) + '</td>' +
            '<td>' + (m.importance != null ? m.importance.toFixed(2) : '-') + '</td>' +
            '<td style="white-space:nowrap">' + esc(date) + '</td>' +
            '<td>' + esc(tags) + '</td>' +
            '<td><button class="btn btn-danger btn-sm" onclick="deleteMemory(\'' + esc(userId) + '\',\'' + esc(m.id) + '\')">删除</button></td>' +
            '</tr>';
    }).join('');
}

async function deleteMemory(userId, memoryId) {
    try {
        await apiFetch('/api/users/' + encodeURIComponent(userId) + '/memory/' + encodeURIComponent(memoryId), 'DELETE');
        showToast('删除成功');
        await loadUserMemory();
    } catch (e) { showToast(e.message, 'error'); }
}

async function clearAllMemory() {
    const userId = document.getElementById('memoryUserSelect').value;
    if (!userId || !confirm('确定要清除 ' + userId + ' 的所有记忆吗？')) return;
    try {
        await apiFetch('/api/users/' + encodeURIComponent(userId) + '/memory', 'DELETE');
        showToast('已清除所有记忆');
        renderMemoryTable(userId, []);
    } catch (e) { showToast(e.message, 'error'); }
}

// ===== 导航切换 =====
document.querySelectorAll('.sidebar-item[data-page]').forEach(el => {
    el.addEventListener('click', () => {
        const target = el.dataset.page;
        currentAgentMcpName = null;
        document.querySelectorAll('.sidebar-item[data-page]').forEach(t => t.classList.toggle('active', t === el));
        document.querySelectorAll('.page-content').forEach(p => p.classList.toggle('active', p.id === target));
        if (target === 'page-mcp') loadMcp();
        if (target === 'page-skills') loadGlobalSkills();
        if (target === 'page-history') loadHistoryUsers();
        if (target === 'page-user-memory') loadMemoryUsers();
    });
});

// ===== 初始化 =====
(async function init() {
    await loadSettings();
    await loadMcp();
    try {
        const r = await apiFetch('/api/skills');
        skillBuiltins = r.data?.builtins || [];
        globalSkills = r.data?.skills || [];
    } catch (e) {}
})();
