const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { spawn, execSync } = require("child_process");
const { Plugin, Setting, fetchPost, showMessage } = require("siyuan");

// 思源插件 require 不会按插件目录解析相对路径，工具清单与客户端配置必须内联。
const MCP_SERVER_NAME = "fsiyuanmcp";
const CLIENTS = [
  { id: "cursor-json", label: "Cursor / 通用 JSON" },
  { id: "claude-code", label: "Claude Code" },
  { id: "cherry-studio", label: "Cherry Studio" },
  { id: "opencode", label: "OpenCode" }
];
const TRANSPORTS = [{ id: "http", label: "HTTP/HTTPS" }];
const toolCatalog = {
  groups: [
    { group: "系统", tools: ["get_plugin_version"] },
    { group: "记录", tools: ["save_note"] },
    { group: "检索", tools: ["search_notes", "read_note", "list_docs"] },
    { group: "维护", tools: ["delete_content", "delete_docs"] }
  ],
  tools: [
    { name: "get_plugin_version", description: "返回 fsiyuanmcp MCP 插件与服务版本号", group: "系统" },
    {
      name: "save_note",
      description: "扁平保存笔记：title+markdown。同名更新保留 id；[[标题]] 转双链；仅可写笔记本",
      group: "记录"
    },
    {
      name: "search_notes",
      description: "关键字/标签检索（全库只读）；文档名→标题块；命中≤5 附全文",
      group: "检索"
    },
    {
      name: "read_note",
      description: "读取干净 Markdown；正文末尾附附件本地路径，Agent 可直接 Read 读文件",
      group: "检索"
    },
    {
      name: "list_docs",
      description: "列出笔记本顶层或某文档子文档（任意笔记本只读）",
      group: "检索"
    },
    {
      name: "delete_content",
      description: "默认删匹配块；整篇需 scope=document 且 confirm=true（仅可写笔记本）",
      group: "维护"
    },
    {
      name: "delete_docs",
      description: "按文档 id 批量删除（仅可写笔记本，confirm=true）",
      group: "维护"
    }
  ],
  resources: [
    { uri: "siyuan://tags", name: "tags", description: "已有标签列表，写入时可选复用", mimeType: "application/json" },
    { uri: "siyuan://notebooks", name: "notebooks", description: "笔记本列表，并标明哪个可写", mimeType: "application/json" }
  ]
};

function getMcpUrl(port, transport = "http") {
  const scheme = transport === "https" ? "https" : "http";
  return `${scheme}://127.0.0.1:${port}/mcp`;
}

function buildHttpEntry(port, transport, token, authEnabled) {
  const entry = { url: getMcpUrl(port, transport) };
  if (authEnabled && token) {
    entry.headers = { Authorization: `Bearer ${token}` };
  }
  return entry;
}

function buildConfig(clientId, transport, port, token, authEnabled = true) {
  const url = getMcpUrl(port, transport);
  const effectiveToken = authEnabled ? token : "";
  switch (clientId) {
    case "claude-code": {
      let toml = `[mcp_servers.${MCP_SERVER_NAME}]\nurl = "${url}"\nenabled = true\n`;
      if (effectiveToken) {
        toml += `http_headers = { "Authorization" = "Bearer ${effectiveToken}" }\n`;
      }
      return toml.trim();
    }
    case "opencode": {
      const payload = {
        $schema: "https://opencode.ai/config.json",
        mcp: {
          [MCP_SERVER_NAME]: {
            type: "remote",
            url,
            enabled: true
          }
        }
      };
      if (effectiveToken) {
        payload.mcp[MCP_SERVER_NAME].headers = { Authorization: `Bearer ${effectiveToken}` };
      }
      return JSON.stringify(payload, null, 2);
    }
    case "cherry-studio":
    case "cursor-json":
    default:
      return JSON.stringify(
        { mcpServers: { [MCP_SERVER_NAME]: buildHttpEntry(port, transport, effectiveToken, authEnabled) } },
        null,
        2
      );
  }
}

const STORAGE_KEY = "runtime-settings";
const DEFAULT_SETTINGS = {
  writableNotebookId: "",
  mcpPort: 3900,
  bindHost: "127.0.0.1",
  mcpAuthEnabled: true,
  mcpBearerToken: "",
  showTopbarStatus: true,
  autoStartOnBoot: true,
  autoStartDelayMs: 1500
};

function generateMcpToken() {
  return crypto.randomBytes(32).toString("hex");
}

const TOPBAR_ICON = "iconFsiyuanmcp";

function fetchPostAsync(url, data = {}) {
  return new Promise((resolve, reject) => {
    fetchPost(url, data, (response) => {
      if (response?.code !== 0) {
        reject(new Error(response?.msg || `API ${url} failed`));
        return;
      }
      resolve(response.data);
    });
  });
}

function listPidsListeningOnPort(port) {
  try {
    if (process.platform === "win32") {
      const out = execSync("netstat -ano -p TCP", { encoding: "utf8", windowsHide: true });
      const re = new RegExp(`127\\.0\\.0\\.1:${port}\\s+\\S+\\s+LISTENING\\s+(\\d+)`, "gi");
      const pids = new Set();
      let match = re.exec(out);
      while (match) {
        pids.add(Number(match[1]));
        match = re.exec(out);
      }
      return [...pids].filter((pid) => Number.isInteger(pid) && pid > 0);
    }
    const out = execSync(`lsof -nP -iTCP:${port} -sTCP:LISTEN -t`, { encoding: "utf8" });
    return out
      .split(/\s+/)
      .map((item) => Number(item))
      .filter((pid) => Number.isInteger(pid) && pid > 0);
  } catch (_error) {
    return [];
  }
}

function describePid(pid) {
  try {
    if (process.platform === "win32") {
      const json = execSync(
        `powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}' | Select-Object ProcessId,Name,CommandLine | ConvertTo-Json -Compress"`,
        { encoding: "utf8", windowsHide: true }
      ).trim();
      if (json) {
        const data = JSON.parse(json);
        return {
          pid,
          name: data.Name || "未知进程",
          commandLine: data.CommandLine || ""
        };
      }
    } else {
      const name = execSync(`ps -p ${pid} -o comm=`, { encoding: "utf8" }).trim();
      const commandLine = execSync(`ps -p ${pid} -o args=`, { encoding: "utf8" }).trim();
      return { pid, name: name || "未知进程", commandLine };
    }
  } catch (_error) {
    // ignore
  }
  return { pid, name: "未知进程", commandLine: "" };
}

function isOwnHistoricalMcp(item, pluginDir) {
  const cmd = String(item.commandLine || "").replace(/\\/g, "/").toLowerCase();
  if (cmd.includes("fsiyuanmcp/dist/server.js")) {
    return true;
  }
  if (pluginDir) {
    const script = path.join(pluginDir, "dist", "server.js").replace(/\\/g, "/").toLowerCase();
    if (script && cmd.includes(script)) {
      return true;
    }
  }
  return false;
}

function classifyPortOccupants(port, pluginDir) {
  const all = listPidsListeningOnPort(port).map(describePid);
  return {
    own: all.filter((item) => isOwnHistoricalMcp(item, pluginDir)),
    foreign: all.filter((item) => !isOwnHistoricalMcp(item, pluginDir))
  };
}

function formatForeignOccupants(port, occupants) {
  if (!occupants.length) {
    return "";
  }
  const lines = occupants.map((item) => {
    const cmd = item.commandLine ? `\n命令行：${item.commandLine}` : "";
    return `PID ${item.pid}  ${item.name}${cmd}`;
  });
  return `端口 ${port} 被思源之外的进程占用，没有自动结束。\n\n${lines.join("\n\n")}\n\n请自行结束该进程，或在设置里更换端口后再启动。`;
}

function killOwnChild(pid) {
  try {
    if (process.platform === "win32") {
      execSync(`taskkill /PID ${pid} /T /F`, { stdio: "ignore", windowsHide: true });
      return;
    }
    process.kill(pid, "SIGTERM");
  } catch (_error) {
    // ignore
  }
}

function getSiyuanBaseUrl() {
  return window.location.origin.replace(/\/$/, "");
}

function getSiyuanToken() {
  return window.siyuan?.config?.api?.token || "";
}

module.exports = class FSiYuanMcpPlugin extends Plugin {
  constructor(...args) {
    super(...args);
    this.settings = { ...DEFAULT_SETTINGS };
    this.serverProcess = null;
    this.serverStatus = "stopped";
    this.topbarElement = undefined;
    this.statusTimer = undefined;
    this.notebooks = [];
    this.clientConfigState = { clientId: "cursor-json", transportId: "http" };
    this.connectionStatusDot = undefined;
    this.connectionStatusText = undefined;
    this.clientConfigPreview = undefined;
    this.clientConfigRefs = {};
    this.httpPanelRefs = {};
    this.runtimeStarted = false;
    this.autoStartTimer = undefined;
    this.lastStatusDetail = "";
  }

  async onload() {
    try {
      this.loadStyles();
      this.registerIcons();
      try {
        await this.loadSettings();
      } catch (error) {
        console.error("[fsiyuanmcp] load settings failed", error);
      }
      this.registerSettingsUI();
      this.refreshMarketplaceIconCache();
      try {
        await this.loadNotebooks();
        this.refreshNotebookSelect();
      } catch (error) {
        console.error("[fsiyuanmcp] load notebooks failed", error);
      }
      this.startRuntime();
    } catch (error) {
      console.error("[fsiyuanmcp] onload failed", error);
      showMessage(`fsiyuanmcp 加载失败: ${error.message || error}`);
      try {
        this.registerSettingsUI();
      } catch (settingError) {
        console.error("[fsiyuanmcp] register settings failed", settingError);
      }
    }
  }

  onLayoutReady() {
    this.startRuntime();
    this.refreshMarketplaceIconCache();
  }

  refreshMarketplaceIconCache() {
    const name = this.name || MCP_SERVER_NAME;
    fetch(`/plugins/${name}/icon.png`, { cache: "reload" }).catch(() => {});
  }

  startRuntime() {
    if (this.runtimeStarted) {
      this.mountTopbar();
      return;
    }
    this.runtimeStarted = true;
    this.mountTopbar();
    this.updateTopbarText(this.getStatusText());
    if (this.settings.autoStartOnBoot) {
      this.scheduleAutoStart();
    }
  }

  mountTopbar() {
    if (!this.settings.showTopbarStatus || this.topbarElement) {
      return;
    }
    try {
      this.topbarElement = this.addTopBar({
        icon: TOPBAR_ICON,
        title: this.getHoverStatusText(),
        position: "right",
        callback: () => {
          showMessage(this.getHoverStatusText());
        }
      });
      if (this.topbarElement) {
        this.topbarElement.classList.add("fsiyuanmcp-topbar");
        this.updateTopbarText();
      }
    } catch (error) {
      console.warn("[fsiyuanmcp] addTopBar skipped until layout is ready", error);
    }
  }

  onunload() {
    this.runtimeStarted = false;
    this.topbarElement = undefined;
    if (this.autoStartTimer) {
      clearTimeout(this.autoStartTimer);
      this.autoStartTimer = undefined;
    }
    if (this.statusTimer) {
      clearInterval(this.statusTimer);
      this.statusTimer = undefined;
    }
    this.stopServer();
  }

  loadStyles() {
    if (document.querySelector('link[data-fsiyuanmcp-style="true"]')) {
      return;
    }
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = `/plugins/${this.name}/index.css`;
    link.setAttribute("data-fsiyuanmcp-style", "true");
    document.head.appendChild(link);
  }

  registerIcons() {
    this.addIcons(`
<symbol id="${TOPBAR_ICON}" viewBox="0 0 32 32" fill="none">
  <rect x="5" y="5" width="22" height="22" rx="5" stroke="currentColor" stroke-width="2" stroke-linejoin="round"></rect>
  <circle cx="5" cy="16" r="3.2" stroke="currentColor" stroke-width="2"></circle>
  <circle cx="27" cy="16" r="3.2" stroke="currentColor" stroke-width="2"></circle>
  <path d="M11 16h10" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path>
</symbol>`);
  }

  async loadSettings() {
    const saved = (await this.loadData(STORAGE_KEY)) || {};
    const local = this.readLocalSettings();
    const merged = { ...DEFAULT_SETTINGS, ...local, ...saved };
    merged.autoStartDelayMs = this.normalizeDelay(merged.autoStartDelayMs);
    merged.mcpPort = Number(merged.mcpPort) || 3900;
    if (!merged.mcpBearerToken) {
      merged.mcpBearerToken = generateMcpToken();
    }
    this.settings = merged;
    this.writeLocalSettings();
  }

  readLocalSettings() {
    try {
      const filePath = path.join(this.getPluginDir(), "plugin-settings.json");
      if (!fs.existsSync(filePath)) {
        return {};
      }
      return JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""));
    } catch (error) {
      console.warn("[fsiyuanmcp] read local settings failed", error);
      return {};
    }
  }

  writeLocalSettings() {
    try {
      const filePath = path.join(this.getPluginDir(), "plugin-settings.json");
      fs.writeFileSync(filePath, JSON.stringify(this.settings, null, 2), "utf8");
    } catch (error) {
      console.warn("[fsiyuanmcp] write local settings failed", error);
    }
  }

  async saveSettings() {
    this.writeLocalSettings();
    await this.saveData(STORAGE_KEY, this.settings);
  }

  async loadNotebooks() {
    try {
      const data = await fetchPostAsync("/api/notebook/lsNotebooks", {});
      this.notebooks = Array.isArray(data?.notebooks) ? data.notebooks : [];
      if (!this.settings.writableNotebookId && this.notebooks.length > 0) {
        this.settings.writableNotebookId = this.notebooks[0].id;
        this.writeLocalSettings();
      }
    } catch (error) {
      console.error("[fsiyuanmcp] load notebooks failed", error);
      this.notebooks = [];
    }
  }

  registerSettingsUI() {
    if (this.setting) {
      return;
    }
    const notebookSelect = document.createElement("select");
    notebookSelect.className = "b3-select fn__block";
    this.renderNotebookOptions(notebookSelect);

    const delayInput = document.createElement("input");
    delayInput.className = "b3-text-field fn__flex-center fn__size200";
    delayInput.type = "number";
    delayInput.min = "1000";
    delayInput.max = "2000";
    delayInput.value = String(this.settings.autoStartDelayMs);

    this.setting = new Setting({
      width: "760px",
      height: "80vh",
      confirmCallback: async () => {
        if (!this.settings.writableNotebookId) {
          showMessage("请先选择 Agent 可写笔记本");
          throw new Error("missing writable notebook");
        }
        this.syncHttpPanelToSettings();
        this.settings.autoStartDelayMs = this.normalizeDelay(Number(delayInput.value));
        delayInput.value = String(this.settings.autoStartDelayMs);
        await this.saveSettings();
        await this.writeRuntimeConfigFile();
        this.refreshClientConfigPreview();
        if (this.settings.autoStartOnBoot) {
          await this.restartServer();
        }
        showMessage("设置已保存");
      }
    });
    this.notebookSelect = notebookSelect;

    this.setting.addItem({
      title: "",
      description: "",
      createActionElement: () => this.buildSettingsTabs({ notebookSelect, delayInput })
    });

    this.refreshConnectionStatusBar();
    this.patchSettingOpen();
  }

  buildSettingsTabs({ notebookSelect, delayInput }) {
    const root = document.createElement("div");
    root.className = "fsiyuanmcp-settings-tabs";

    const bar = document.createElement("div");
    bar.className = "fsiyuanmcp-tabs__bar";
    bar.setAttribute("role", "tablist");

    const panels = document.createElement("div");
    panels.className = "fsiyuanmcp-tabs__panels";

    const tabs = [
      { id: "config", label: "配置" },
      { id: "intro", label: "MCP 介绍" },
      { id: "server", label: "MCP 服务器 HTTP" }
    ];

    const activateTab = (tabId) => {
      for (const tab of tabs) {
        const btn = bar.querySelector(`[data-tab="${tab.id}"]`);
        const panel = panels.querySelector(`[data-tab="${tab.id}"]`);
        const active = tab.id === tabId;
        if (btn) {
          btn.classList.toggle("fsiyuanmcp-tabs__btn--active", active);
          btn.setAttribute("aria-selected", active ? "true" : "false");
        }
        if (panel) {
          panel.hidden = !active;
        }
      }
    };

    for (const tab of tabs) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "fsiyuanmcp-tabs__btn";
      btn.dataset.tab = tab.id;
      btn.textContent = tab.label;
      btn.setAttribute("role", "tab");
      btn.addEventListener("click", () => activateTab(tab.id));
      bar.appendChild(btn);

      const panel = document.createElement("div");
      panel.className = "fsiyuanmcp-tabs__panel";
      panel.dataset.tab = tab.id;
      panel.setAttribute("role", "tabpanel");
      panels.appendChild(panel);
    }

    panels.querySelector('[data-tab="config"]').appendChild(this.buildConfigTabPanel({ notebookSelect, delayInput }));
    panels.querySelector('[data-tab="intro"]').appendChild(this.buildIntroTabPanel());
    panels.querySelector('[data-tab="server"]').appendChild(this.buildServerTabPanel());

    root.append(bar, panels);
    activateTab("config");
    return root;
  }

  buildConfigTabPanel({ notebookSelect, delayInput }) {
    const panel = document.createElement("div");
    panel.className = "fsiyuanmcp-tab-stack";

    const notebookSection = document.createElement("section");
    notebookSection.className = "fsiyuanmcp-config-section";
    notebookSection.innerHTML = `
      <div class="fsiyuanmcp-tab-section-title">Agent 可写笔记本</div>
      <div class="fsiyuanmcp-hint">仅该笔记本允许 MCP 写入，其它笔记本只读</div>
    `;
    notebookSection.appendChild(notebookSelect);

    const topbarSection = document.createElement("section");
    topbarSection.className = "fsiyuanmcp-config-section";
    const topbarTitle = document.createElement("div");
    topbarTitle.className = "fsiyuanmcp-tab-section-title";
    topbarTitle.textContent = "顶栏显示 MCP 状态";
    const topbarHint = document.createElement("div");
    topbarHint.className = "fsiyuanmcp-hint";
    topbarHint.textContent = "开启后在顶栏显示 MCP 运行状态";
    const topbarRow = document.createElement("label");
    topbarRow.className = "fsiyuanmcp-row";
    const topbarToggle = document.createElement("input");
    topbarToggle.className = "b3-switch fn__flex-center";
    topbarToggle.type = "checkbox";
    topbarToggle.checked = this.settings.showTopbarStatus;
    topbarToggle.addEventListener("change", async () => {
      this.settings.showTopbarStatus = topbarToggle.checked;
      await this.saveSettings();
      showMessage("顶栏显示设置将在刷新插件后生效");
    });
    topbarRow.append(topbarToggle, document.createTextNode(" 在顶栏显示 MCP 状态"));
    topbarSection.append(topbarTitle, topbarHint, topbarRow);

    const autoStartSection = document.createElement("section");
    autoStartSection.className = "fsiyuanmcp-config-section";
    const autoStartTitle = document.createElement("div");
    autoStartTitle.className = "fsiyuanmcp-tab-section-title";
    autoStartTitle.textContent = "插件启用时自动启动 MCP 服务";
    const autoStartHint = document.createElement("div");
    autoStartHint.className = "fsiyuanmcp-hint";
    autoStartHint.textContent = "思源启动或关闭后再打开本插件，都会延迟自动拉起 MCP";
    const autoStartRow = document.createElement("label");
    autoStartRow.className = "fsiyuanmcp-row";
    const autoStartToggle = document.createElement("input");
    autoStartToggle.className = "b3-switch fn__flex-center";
    autoStartToggle.type = "checkbox";
    autoStartToggle.checked = this.settings.autoStartOnBoot;
    autoStartToggle.addEventListener("change", async () => {
      this.settings.autoStartOnBoot = autoStartToggle.checked;
      await this.saveSettings();
    });
    autoStartRow.append(autoStartToggle, document.createTextNode(" 随思源启动自动拉起服务"));
    autoStartSection.append(autoStartTitle, autoStartHint, autoStartRow);

    const delaySection = document.createElement("section");
    delaySection.className = "fsiyuanmcp-config-section";
    const delayTitle = document.createElement("div");
    delayTitle.className = "fsiyuanmcp-tab-section-title";
    delayTitle.textContent = "自动启动延迟（1000-2000ms）";
    const delayHint = document.createElement("div");
    delayHint.className = "fsiyuanmcp-hint";
    delayHint.textContent = "插件启用后延迟 1-2 秒再启动 MCP";
    delayInput.className = "b3-text-field fn__block";
    delaySection.append(delayTitle, delayHint, delayInput);

    panel.append(notebookSection, topbarSection, autoStartSection, delaySection);
    return panel;
  }

  buildIntroTabPanel() {
    const panel = document.createElement("div");
    panel.className = "fsiyuanmcp-tab-stack";

    const intro = document.createElement("div");
    intro.className = "fsiyuanmcp-hint";
    intro.innerHTML =
      "扁平长标题笔记 + 标签/双链图谱。Agent 用 <code>save_note</code> 写入（仅可写笔记本），" +
      "<code>search_notes</code> / <code>list_docs</code> / <code>read_note</code> 全库只读浏览。" +
      "<code>read_note</code> 正文末尾会附附件本地路径。";

    const toolsTitle = document.createElement("div");
    toolsTitle.className = "fsiyuanmcp-tab-section-title";
    toolsTitle.textContent = "工具与资源";

    panel.append(intro, toolsTitle, this.buildToolsOverviewElement());
    return panel;
  }

  buildServerTabPanel() {
    const panel = document.createElement("div");
    panel.className = "fsiyuanmcp-tab-stack";

    const httpTitle = document.createElement("div");
    httpTitle.className = "fsiyuanmcp-tab-section-title";
    httpTitle.textContent = "MCP 服务器 HTTP";
    const httpHint = document.createElement("div");
    httpHint.className = "fsiyuanmcp-hint";
    httpHint.textContent = "适合桌面端直连、WSL、局域网访问。进程在监听即视为运行中。";

    const clientTitle = document.createElement("div");
    clientTitle.className = "fsiyuanmcp-tab-section-title";
    clientTitle.textContent = "常用客户端配置";
    const clientHint = document.createElement("div");
    clientHint.className = "fsiyuanmcp-hint";
    clientHint.textContent = "选择客户端后复制配置，HTTP 地址使用当前端口与令牌。";

    panel.append(httpTitle, httpHint, this.buildHttpConnectionPanel(), clientTitle, clientHint, this.buildClientConfigPanel());
    this.refreshClientConfigPreview();
    return panel;
  }

  patchSettingOpen() {
    if (!this.setting || this.setting.__fsiyuanmcpPatched) {
      return;
    }
    const originalOpen = this.setting.open.bind(this.setting);
    this.setting.open = (name) => {
      originalOpen(name);
      requestAnimationFrame(() => this.fixSettingLayout());
    };
    this.setting.__fsiyuanmcpPatched = true;
  }

  fixSettingLayout() {
    const dialog = this.setting?.dialog?.element;
    if (!dialog) {
      return;
    }
    dialog.classList.add("fsiyuanmcp-settings-dialog");
    const container = dialog.querySelector(".b3-dialog__container");
    if (container) {
      container.style.height = "80vh";
      container.style.maxHeight = "80vh";
    }
    const body = dialog.querySelector(".b3-dialog__body");
    if (body) {
      body.style.display = "flex";
      body.style.flexDirection = "column";
      body.style.minHeight = "0";
      body.style.overflow = "hidden";
      body.style.flex = "1";
    }
    const content = dialog.querySelector(".b3-dialog__content");
    if (content) {
      content.style.overflowY = "auto";
      content.style.overflowX = "hidden";
      content.style.minHeight = "0";
      content.style.flex = "1 1 auto";
    }
    dialog.querySelectorAll(".b3-label:has(.fsiyuanmcp-settings-tabs)").forEach((wrap) => {
      for (const child of wrap.children) {
        if (child.classList.contains("fsiyuanmcp-settings-tabs")) {
          continue;
        }
        if (!child.querySelector(".fsiyuanmcp-settings-tabs")) {
          child.style.display = "none";
        }
      }
    });
    const tabsRoot = dialog.querySelector(".fsiyuanmcp-settings-tabs");
    if (tabsRoot && content) {
      let node = tabsRoot;
      while (node && node !== content) {
        node.classList.remove("fn__size200", "fn__flex-center");
        node.style.overflow = "visible";
        node.style.maxHeight = "none";
        node.style.height = "auto";
        node.style.minHeight = "0";
        node.style.flex = "none";
        node = node.parentElement;
      }
    }
    dialog
      .querySelectorAll(
        ".fsiyuanmcp-settings-tabs, .fsiyuanmcp-tabs__panels, .fsiyuanmcp-tabs__panel, .fsiyuanmcp-tab-stack, .fsiyuanmcp-tools, .fsiyuanmcp-panel"
      )
      .forEach((el) => {
      el.classList.remove("fn__size200", "fn__flex-center", "fn__block");
      el.style.width = "100%";
      el.style.maxWidth = "100%";
      el.style.flex = "none";
      el.style.overflow = "visible";
      el.style.maxHeight = "none";
      el.style.height = "auto";
      const wrap = el.closest(".b3-label");
      if (wrap) {
        wrap.style.display = "flex";
        wrap.style.flexDirection = "column";
        wrap.style.alignItems = "stretch";
        wrap.style.height = "auto";
        wrap.style.flex = "none";
        wrap.style.padding = "0";
      }
    });
  }

  buildHttpConnectionPanel() {
    const container = document.createElement("div");
    container.className = "fsiyuanmcp-panel";

    const toolbar = document.createElement("div");
    toolbar.className = "fsiyuanmcp-toolbar";

    const status = document.createElement("span");
    status.className = "fsiyuanmcp-status";
    const dot = document.createElement("span");
    this.connectionStatusDot = dot;
    const statusText = document.createElement("span");
    statusText.textContent = "已停止";
    this.connectionStatusText = statusText;
    status.append(dot, statusText);

    const actions = document.createElement("div");
    actions.className = "fsiyuanmcp-toolbar__actions";
    const startButton = document.createElement("button");
    startButton.className = "b3-button b3-button--outline";
    startButton.type = "button";
    startButton.textContent = "启动";
    startButton.addEventListener("click", async () => {
      if (this.isServerProcessAlive() || this.serverStatus === "starting") {
        this.stopServer();
        this.updateStartButtonLabel(startButton);
        return;
      }
      this.syncHttpPanelToSettings();
      await this.saveSettings();
      await this.writeRuntimeConfigFile();
      await this.startServer();
      this.updateStartButtonLabel(startButton);
    });

    const saveRestartButton = document.createElement("button");
    saveRestartButton.className = "b3-button";
    saveRestartButton.type = "button";
    saveRestartButton.textContent = "保存并重启";
    saveRestartButton.addEventListener("click", async () => {
      this.syncHttpPanelToSettings();
      await this.saveSettings();
      await this.writeRuntimeConfigFile();
      this.refreshClientConfigPreview();
      await this.restartServer();
      showMessage("已保存并重启 MCP 服务");
      this.updateStartButtonLabel(startButton);
    });
    actions.append(startButton, saveRestartButton);
    toolbar.append(status, actions);

    const portRow = document.createElement("div");
    portRow.className = "fsiyuanmcp-row";
    const portLabel = document.createElement("div");
    portLabel.className = "fsiyuanmcp-row__label";
    portLabel.textContent = "端口";
    const portInput = document.createElement("input");
    portInput.className = "b3-text-field fsiyuanmcp-row__control";
    portInput.type = "number";
    portInput.min = "1024";
    portInput.max = "65535";
    portInput.value = String(this.settings.mcpPort);
    portRow.append(portLabel, portInput);

    const authRow = document.createElement("label");
    authRow.className = "fsiyuanmcp-row";
    const authToggle = document.createElement("input");
    authToggle.className = "b3-switch";
    authToggle.type = "checkbox";
    authToggle.checked = this.settings.mcpAuthEnabled;
    const authText = document.createElement("span");
    authText.textContent = "启用 Bearer Token 鉴权";
    authRow.append(authToggle, authText);

    const tokenLabel = document.createElement("div");
    tokenLabel.className = "fsiyuanmcp-row__label";
    tokenLabel.textContent = "令牌";
    const tokenWrap = document.createElement("div");
    tokenWrap.style.display = "flex";
    tokenWrap.style.flexDirection = "column";
    tokenWrap.style.gap = "8px";
    const tokenRow = document.createElement("div");
    tokenRow.className = "fsiyuanmcp-token-row";
    const tokenInput = document.createElement("input");
    tokenInput.className = "b3-text-field";
    tokenInput.value = this.settings.mcpBearerToken;
    tokenInput.readOnly = true;
    const copyTokenButton = document.createElement("button");
    copyTokenButton.className = "b3-button b3-button--outline";
    copyTokenButton.type = "button";
    copyTokenButton.textContent = "复制";
    copyTokenButton.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(tokenInput.value);
        showMessage("令牌已复制");
      } catch (error) {
        showMessage(`复制失败: ${error.message || error}`);
      }
    });
    const regenTokenButton = document.createElement("button");
    regenTokenButton.className = "b3-button b3-button--outline";
    regenTokenButton.type = "button";
    regenTokenButton.textContent = "重新生成";
    regenTokenButton.addEventListener("click", async () => {
      tokenInput.value = generateMcpToken();
      this.settings.mcpBearerToken = tokenInput.value;
      this.writeLocalSettings();
      this.refreshClientConfigPreview();
      showMessage("令牌已重新生成，请点击「保存并重启」");
    });
    tokenRow.append(tokenInput, copyTokenButton, regenTokenButton);
    tokenWrap.append(tokenRow);
    const tokenBlock = document.createElement("div");
    tokenBlock.className = "fsiyuanmcp-row";
    tokenBlock.style.alignItems = "flex-start";
    tokenBlock.append(tokenLabel, tokenWrap);
    tokenWrap.style.flex = "1";
    tokenWrap.style.minWidth = "0";

    const refreshPreview = () => this.refreshClientConfigPreview();
    portInput.addEventListener("input", refreshPreview);
    authToggle.addEventListener("change", refreshPreview);

    const versionBlock = document.createElement("div");
    versionBlock.className = "fsiyuanmcp-row";
    versionBlock.style.alignItems = "flex-start";
    const versionLabel = document.createElement("div");
    versionLabel.className = "fsiyuanmcp-row__label";
    versionLabel.textContent = "版本核对";
    const versionWrap = document.createElement("div");
    versionWrap.style.display = "flex";
    versionWrap.style.flexDirection = "column";
    versionWrap.style.gap = "8px";
    versionWrap.style.flex = "1";
    versionWrap.style.minWidth = "0";
    const versionButton = document.createElement("button");
    versionButton.className = "b3-button b3-button--outline";
    versionButton.type = "button";
    versionButton.textContent = "读取后端版本";
    versionButton.style.alignSelf = "flex-start";
    versionButton.addEventListener("click", async () => {
      versionButton.disabled = true;
      try {
        await this.checkBackendVersion();
      } finally {
        versionButton.disabled = false;
      }
    });
    const versionResult = document.createElement("div");
    versionResult.className = "fsiyuanmcp-hint";
    versionWrap.append(versionButton, versionResult);
    versionBlock.append(versionLabel, versionWrap);

    this.httpPanelRefs = { portInput, authToggle, tokenInput, startButton, versionResult };
    this.updateStartButtonLabel(startButton);
    this.refreshConnectionStatusBar();
    this.renderVersionCheckHint();

    container.append(toolbar, portRow, authRow, tokenBlock, versionBlock);
    return container;
  }

  getFrontendPluginVersion() {
    try {
      const pluginJson = path.join(this.getPluginDir(), "plugin.json");
      const parsed = JSON.parse(fs.readFileSync(pluginJson, "utf8"));
      return String(parsed.version || "");
    } catch (_error) {
      return "";
    }
  }

  renderVersionCheckHint() {
    const result = this.httpPanelRefs.versionResult;
    if (!result) {
      return;
    }
    const frontend = this.getFrontendPluginVersion() || "未知";
    result.className = "fsiyuanmcp-hint";
    result.textContent = `前端插件 ${frontend}。点按钮读取当前监听端口上的后端进程版本。`;
  }

  async fetchBackendVersion(port) {
    const res = await fetch(`http://127.0.0.1:${port}/version`, { method: "GET" });
    if (res.status === 404) {
      return { kind: "stale", version: "", message: "后端没有 /version（旧进程）" };
    }
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const body = await res.json();
    const version = String(body.version || body.pluginVersion || "");
    if (!version) {
      return { kind: "stale", version: "", message: "后端未返回版本号（旧进程）" };
    }
    return { kind: "ok", version, pid: body.pid };
  }

  async checkBackendVersion() {
    const result = this.httpPanelRefs.versionResult;
    if (!result) {
      return;
    }
    const frontend = this.getFrontendPluginVersion() || "未知";
    const port = Number(this.httpPanelRefs.portInput?.value) || this.settings.mcpPort || 3900;
    result.className = "fsiyuanmcp-hint";
    result.textContent = "正在读取后端版本…";
    try {
      const backend = await this.fetchBackendVersion(port);
      if (backend.kind === "stale") {
        result.className = "fsiyuanmcp-version fsiyuanmcp-version--mismatch";
        result.textContent = `前端 ${frontend}，${backend.message}。请点「保存并重启」。`;
        return;
      }
      if (backend.version === frontend) {
        result.className = "fsiyuanmcp-version fsiyuanmcp-version--match";
        result.textContent = `前端 ${frontend}，后端 ${backend.version}（一致${backend.pid ? `，pid ${backend.pid}` : ""}）`;
        return;
      }
      result.className = "fsiyuanmcp-version fsiyuanmcp-version--mismatch";
      result.textContent = `前端 ${frontend}，后端 ${backend.version}（不一致，仍是旧进程）。请点「保存并重启」。`;
    } catch (_error) {
      result.className = "fsiyuanmcp-version fsiyuanmcp-version--offline";
      result.textContent = `前端 ${frontend}，后端未响应（服务未启动或端口 ${port} 不对）`;
    }
  }

  syncHttpPanelToSettings() {
    const { portInput, authToggle, tokenInput } = this.httpPanelRefs;
    if (!portInput) {
      return;
    }
    this.settings.mcpPort = Number(portInput.value) || 3900;
    this.settings.mcpAuthEnabled = !!authToggle?.checked;
    this.settings.mcpBearerToken = tokenInput?.value || this.settings.mcpBearerToken;
  }

  updateStartButtonLabel(startButton) {
    if (!startButton) {
      return;
    }
    const running = this.isServerProcessAlive() || this.getDisplayStatus() === "starting";
    startButton.textContent = running ? "停止" : "启动";
  }

  buildClientConfigPanel() {
    const container = document.createElement("div");
    container.className = "fsiyuanmcp-panel";

    const toolbar = document.createElement("div");
    toolbar.className = "fsiyuanmcp-client-config__toolbar";

    const clientField = document.createElement("label");
    clientField.className = "fsiyuanmcp-client-config__field";
    const clientLabel = document.createElement("span");
    clientLabel.textContent = "客户端";
    const clientSelect = document.createElement("select");
    clientSelect.className = "b3-select";
    for (const client of CLIENTS) {
      const option = document.createElement("option");
      option.value = client.id;
      option.textContent = client.label;
      if (client.id === this.clientConfigState.clientId) {
        option.selected = true;
      }
      clientSelect.appendChild(option);
    }
    clientField.append(clientLabel, clientSelect);

    const transportField = document.createElement("label");
    transportField.className = "fsiyuanmcp-client-config__field";
    const transportLabel = document.createElement("span");
    transportLabel.textContent = "连接方式";
    const transportSelect = document.createElement("select");
    transportSelect.className = "b3-select";
    for (const transport of TRANSPORTS) {
      const option = document.createElement("option");
      option.value = transport.id;
      option.textContent = transport.label;
      if (transport.id === this.clientConfigState.transportId) {
        option.selected = true;
      }
      transportSelect.appendChild(option);
    }
    transportField.append(transportLabel, transportSelect);

    const copyButton = document.createElement("button");
    copyButton.className = "b3-button b3-button--outline";
    copyButton.type = "button";
    copyButton.textContent = "复制配置";
    copyButton.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(this.clientConfigPreview?.textContent || "");
        showMessage("配置已复制");
      } catch (error) {
        showMessage(`复制失败: ${error.message || error}`);
      }
    });

    toolbar.append(clientField, transportField, copyButton);

    const preview = document.createElement("pre");
    preview.className = "fsiyuanmcp-client-config__preview b3-code";
    this.clientConfigPreview = preview;

    const hint = document.createElement("div");
    hint.className = "fsiyuanmcp-hint";
    hint.innerHTML =
      "复制许多 MCP 客户端通用的 <code>mcpServers</code> JSON。<br/>" +
      "先选择客户端和连接方式，再复制对应格式。地址使用当前 MCP 服务器 HTTP 端口与令牌。";

    container.append(toolbar, preview, hint);

    const refresh = () => this.refreshClientConfigPreview();
    clientSelect.addEventListener("change", () => {
      this.clientConfigState.clientId = clientSelect.value;
      refresh();
    });
    transportSelect.addEventListener("change", () => {
      this.clientConfigState.transportId = transportSelect.value;
      refresh();
    });

    this.clientConfigRefs = { clientSelect, transportSelect };
    refresh();
    return container;
  }

  refreshClientConfigPreview() {
    if (!this.clientConfigPreview) {
      return;
    }
    const port = Number(this.httpPanelRefs.portInput?.value) || this.settings.mcpPort || 3900;
    const authEnabled = !!this.httpPanelRefs.authToggle?.checked;
    const token = this.httpPanelRefs.tokenInput?.value || this.settings.mcpBearerToken || "";
    this.clientConfigPreview.textContent = buildConfig(
      this.clientConfigState.clientId,
      this.clientConfigState.transportId,
      port,
      token,
      authEnabled
    );
  }

  refreshConnectionStatusBar() {
    if (!this.connectionStatusDot || !this.connectionStatusText) {
      return;
    }
    const status = this.getDisplayStatus();
    const map = {
      running: { className: "fsiyuanmcp-status__dot--running", text: "运行中" },
      starting: { className: "fsiyuanmcp-status__dot--starting", text: "启动中" },
      error: { className: "fsiyuanmcp-status__dot--error", text: "异常" },
      stopped: { className: "fsiyuanmcp-status__dot--stopped", text: "已停止" }
    };
    const current = map[status] || map.stopped;
    this.connectionStatusDot.className = `fsiyuanmcp-status__dot ${current.className}`;
    this.connectionStatusText.textContent = current.text;
    this.updateStartButtonLabel(this.httpPanelRefs.startButton);
  }

  isServerProcessAlive() {
    return Boolean(this.serverProcess && this.serverProcess.exitCode === null && !this.serverProcess.killed);
  }

  getDisplayStatus() {
    if (this.serverStatus === "starting") {
      return "starting";
    }
    if (this.isServerProcessAlive()) {
      return "running";
    }
    return this.serverStatus;
  }

  buildToolsOverviewElement() {
    const container = document.createElement("div");
    container.className = "fsiyuanmcp-tools";

    for (const group of toolCatalog.groups) {
      const section = document.createElement("section");
      section.className = "fsiyuanmcp-tools__group";
      const heading = document.createElement("div");
      heading.className = "fsiyuanmcp-tools__title";
      heading.textContent = group.group;
      section.appendChild(heading);

      const list = document.createElement("ul");
      list.className = "fsiyuanmcp-tools__list";

      for (const toolName of group.tools) {
        const tool = toolCatalog.tools.find((item) => item.name === toolName);
        const item = document.createElement("li");
        const code = document.createElement("code");
        code.textContent = toolName;
        item.appendChild(code);
        if (tool?.description) {
          item.title = tool.description;
          const desc = document.createElement("span");
          desc.className = "fsiyuanmcp-tools__desc";
          desc.textContent = ` ${tool.description}`;
          item.appendChild(desc);
        }
        list.appendChild(item);
      }

      section.appendChild(list);
      container.appendChild(section);
    }

    if (toolCatalog.resources?.length) {
      const section = document.createElement("section");
      section.className = "fsiyuanmcp-tools__group";
      const heading = document.createElement("div");
      heading.className = "fsiyuanmcp-tools__title";
      heading.textContent = "资源";
      section.appendChild(heading);
      const list = document.createElement("ul");
      list.className = "fsiyuanmcp-tools__list";
      for (const resource of toolCatalog.resources) {
        const item = document.createElement("li");
        const code = document.createElement("code");
        code.textContent = resource.uri;
        item.appendChild(code);
        if (resource.description) {
          const desc = document.createElement("span");
          desc.className = "fsiyuanmcp-tools__desc";
          desc.textContent = ` ${resource.description}`;
          item.appendChild(desc);
        }
        list.appendChild(item);
      }
      section.appendChild(list);
      container.appendChild(section);
    }

    return container;
  }

  refreshNotebookSelect() {
    if (!this.notebookSelect) {
      return;
    }
    this.renderNotebookOptions(this.notebookSelect);
  }

  renderNotebookOptions(selectElement) {
    selectElement.innerHTML = "";
    if (this.notebooks.length === 0) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "未找到笔记本";
      selectElement.appendChild(option);
      return;
    }
    for (const notebook of this.notebooks) {
      const option = document.createElement("option");
      option.value = notebook.id;
      option.textContent = `${notebook.name} (${notebook.id})`;
      if (notebook.id === this.settings.writableNotebookId) {
        option.selected = true;
      }
      selectElement.appendChild(option);
    }
    if (!selectElement.dataset.boundChange) {
      selectElement.dataset.boundChange = "true";
      selectElement.addEventListener("change", async () => {
        this.settings.writableNotebookId = selectElement.value;
        await this.saveSettings();
      });
    }
  }

  buildCursorConfigText() {
    return buildConfig(
      "cursor-json",
      "http",
      this.settings.mcpPort,
      this.settings.mcpBearerToken,
      this.settings.mcpAuthEnabled
    );
  }

  normalizeDelay(value) {
    if (!Number.isFinite(value)) {
      return 1500;
    }
    return Math.max(1000, Math.min(2000, Math.round(value)));
  }

  getStatusText() {
    const map = {
      running: "MCP: 运行中",
      starting: "MCP: 启动中",
      error: "MCP: 异常",
      stopped: "MCP: 已停止"
    };
    return map[this.getDisplayStatus()] || "MCP: 已停止";
  }

  getHoverStatusText() {
    const port = this.settings.mcpPort;
    const status = this.getDisplayStatus();
    if (status === "running") {
      this.lastStatusDetail = "";
      return `MCP 运行中（端口 ${port}）`;
    }
    if (status === "starting") {
      return `MCP 启动中（端口 ${port}）`;
    }
    if (status === "error") {
      return this.lastStatusDetail
        ? `MCP 异常：${this.lastStatusDetail}`
        : `MCP 异常（端口 ${port}）`;
    }
    return `MCP 已停止（端口 ${port}）`;
  }

  scheduleAutoStart() {
    if (!this.settings.writableNotebookId) {
      this.serverStatus = "error";
      this.lastStatusDetail = "请先配置笔记本";
      this.updateTopbarText();
      showMessage("请先在插件设置中选择 Agent 可写笔记本");
      return;
    }
    this.serverStatus = "starting";
    this.updateTopbarText(this.getStatusText());
    this.refreshConnectionStatusBar();
    if (this.autoStartTimer) {
      clearTimeout(this.autoStartTimer);
    }
    this.autoStartTimer = setTimeout(async () => {
      this.autoStartTimer = undefined;
      try {
        await this.startServer();
      } catch (error) {
        this.serverStatus = "error";
        this.lastStatusDetail = error instanceof Error ? error.message : String(error);
        this.updateTopbarText();
        this.refreshConnectionStatusBar();
        console.error("[fsiyuanmcp] auto start failed", error);
        showMessage(`MCP 启动失败: ${error.message || error}`);
      }
    }, this.settings.autoStartDelayMs);
  }

  getPluginDir() {
    const name = this.name || "fsiyuanmcp";
    const system = window.siyuan?.config?.system || {};
    const candidates = [
      system.dataDir ? path.join(system.dataDir, "plugins", name) : "",
      system.workspaceDir ? path.join(system.workspaceDir, "data", "plugins", name) : "",
      this.app?.pluginsPath ? path.join(this.app.pluginsPath, name) : ""
    ].filter(Boolean);
    const existing = candidates.find((dir) => fs.existsSync(dir));
    if (existing) {
      return existing;
    }
    if (candidates[0]) {
      return candidates[0];
    }
    throw new Error("无法定位插件目录（window.siyuan.config.system.dataDir 为空）");
  }

  getRuntimeConfigPath() {
    return path.join(this.getPluginDir(), "runtime-config.json");
  }

  getServerScriptPath() {
    return path.join(this.getPluginDir(), "dist", "server.js");
  }

  buildRuntimeConfig() {
    return {
      siyuanBaseUrl: getSiyuanBaseUrl(),
      siyuanToken: getSiyuanToken(),
      writableNotebookId: this.settings.writableNotebookId,
      port: this.settings.mcpPort,
      bindHost: this.settings.bindHost,
      mcpAuthEnabled: this.settings.mcpAuthEnabled,
      mcpBearerToken: this.settings.mcpBearerToken,
      showTopbarStatus: this.settings.showTopbarStatus,
      autoStartOnBoot: this.settings.autoStartOnBoot,
      autoStartDelayMs: this.settings.autoStartDelayMs,
      mcpUrl: `http://127.0.0.1:${this.settings.mcpPort}/mcp`
    };
  }

  async writeRuntimeConfigFile() {
    const configPath = this.getRuntimeConfigPath();
    fs.writeFileSync(configPath, JSON.stringify(this.buildRuntimeConfig(), null, 2), "utf8");
    return configPath;
  }

  async startServer() {
    if (this.isServerProcessAlive()) {
      this.stopServer();
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
    this.serverProcess = null;
    if (!this.settings.writableNotebookId) {
      this.serverStatus = "error";
      this.lastStatusDetail = "请先配置笔记本";
      this.updateTopbarText();
      return;
    }

    try {
      const pluginDir = this.getPluginDir();
      const serverScript = path.join(pluginDir, "dist", "server.js");
      if (!fs.existsSync(serverScript)) {
        this.serverStatus = "error";
        this.lastStatusDetail = "缺少 dist/server.js";
        this.updateTopbarText();
        showMessage("请先在本插件目录执行 npm install && npm run build");
        return;
      }

      const expressPath = path.join(pluginDir, "node_modules", "express");
      if (!fs.existsSync(expressPath)) {
        this.serverStatus = "error";
        this.lastStatusDetail = "缺少依赖";
        this.updateTopbarText();
        showMessage("请先在插件目录执行 npm install");
        return;
      }

      this.syncHttpPanelToSettings();
      const configPath = await this.writeRuntimeConfigFile();
      const blocked = await this.reclaimOwnPortOrExplain(this.settings.mcpPort, pluginDir);
      if (blocked) {
        return;
      }
      this.serverStatus = "starting";
      this.updateTopbarText(this.getStatusText());
      this.refreshConnectionStatusBar();

      const child = spawn(process.execPath, [serverScript], {
        cwd: this.getPluginDir(),
        env: {
          ...process.env,
          ELECTRON_RUN_AS_NODE: "1",
          FSIYUANMCP_AUTOSTART: "1",
          FSIYUANMCP_CONFIG: configPath
        },
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true
      });

      this.serverProcess = child;

      child.stdout?.on("data", (chunk) => {
        console.log(`[fsiyuanmcp] ${String(chunk)}`);
      });
      child.stderr?.on("data", (chunk) => {
        const text = String(chunk);
        console.error(`[fsiyuanmcp] ${text}`);
        if (text.includes("EADDRINUSE")) {
          void this.reclaimOwnPortOrExplain(this.settings.mcpPort, pluginDir);
        }
      });
      child.on("error", (error) => {
        this.serverStatus = "error";
        this.lastStatusDetail = error instanceof Error ? error.message : String(error);
        this.serverProcess = null;
        this.updateTopbarText();
        console.error("[fsiyuanmcp] spawn error", error);
      });
      child.on("exit", (code) => {
        this.serverProcess = null;
        if (this.serverStatus === "stopped") {
          this.refreshConnectionStatusBar();
          return;
        }
        if (code !== 0) {
          this.serverStatus = "error";
          this.lastStatusDetail = `进程退出 ${code}`;
          this.updateTopbarText();
        } else {
          this.serverStatus = "stopped";
          this.updateTopbarText();
        }
        this.refreshConnectionStatusBar();
      });

      const ready = await this.waitForHealth(this.settings.mcpPort, 15000);
      if (!ready) {
        throw new Error("MCP 服务启动超时");
      }
      this.serverStatus = "running";
      this.updateTopbarText(this.getStatusText());
      this.refreshConnectionStatusBar();
      this.startStatusPolling();
    } catch (error) {
      this.serverStatus = "error";
      this.lastStatusDetail = error instanceof Error ? error.message : String(error);
      this.updateTopbarText();
      this.refreshConnectionStatusBar();
      console.error("[fsiyuanmcp] start server failed", error);
      showMessage(`MCP 启动失败: ${error.message || error}`);
      this.stopServer();
    }
  }

  async reclaimOwnPortOrExplain(port, pluginDir) {
    const first = classifyPortOccupants(port, pluginDir);
    for (const item of first.own) {
      console.log(`[fsiyuanmcp] 结束本插件历史进程 PID ${item.pid}`);
      killOwnChild(item.pid);
    }
    if (first.own.length > 0) {
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
    const left = classifyPortOccupants(port, pluginDir);
    const leftoverOwn = left.own.filter((item) => item.pid !== this.serverProcess?.pid);
    if (leftoverOwn.length > 0) {
      const message = `未能结束本插件占用端口 ${port} 的历史进程：\n` +
        leftoverOwn.map((item) => `PID ${item.pid}  ${item.name}`).join("\n");
      this.serverStatus = "error";
      this.lastStatusDetail = leftoverOwn.map((item) => `PID ${item.pid}`).join("、");
      this.updateTopbarText();
      this.refreshConnectionStatusBar();
      console.error("[fsiyuanmcp] " + message);
      showMessage(message, 0, "error");
      return true;
    }
    if (left.foreign.length > 0) {
      const message = formatForeignOccupants(port, left.foreign);
      this.serverStatus = "error";
      this.lastStatusDetail = `端口 ${port} 被其它进程占用`;
      this.updateTopbarText();
      this.refreshConnectionStatusBar();
      console.error("[fsiyuanmcp] " + message);
      showMessage(message, 0, "error");
      return true;
    }
    return false;
  }

  async restartServer() {
    this.stopServer();
    await this.startServer();
  }

  stopServer() {
    const childPid = this.serverProcess?.pid;
    if (this.serverProcess) {
      try {
        this.serverProcess.kill();
      } catch (error) {
        console.error("[fsiyuanmcp] stop server failed", error);
      }
      if (childPid) {
        killOwnChild(childPid);
      }
    }
    this.serverProcess = null;
    this.serverStatus = "stopped";
    this.updateTopbarText(this.getStatusText());
    this.refreshConnectionStatusBar();
  }

  async waitForHealth(port, timeoutMs) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/healthz`, { method: "GET" });
        if (res.ok) {
          return true;
        }
      } catch (_error) {
        // retry
      }
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    return false;
  }

  startStatusPolling() {
    if (this.statusTimer) {
      return;
    }
    this.statusTimer = setInterval(async () => {
      if (this.isServerProcessAlive()) {
        if (this.serverStatus !== "starting") {
          this.serverStatus = "running";
        }
        this.updateTopbarText(this.getStatusText());
        this.refreshConnectionStatusBar();
        return;
      }
      try {
        const res = await fetch(`http://127.0.0.1:${this.settings.mcpPort}/healthz`, {
          method: "GET"
        });
        if (res.ok) {
          this.serverStatus = "running";
        }
      } catch (_error) {
        if (this.serverStatus === "starting") {
          return;
        }
        if (this.serverStatus === "running") {
          this.serverStatus = "stopped";
        }
      }
      this.updateTopbarText(this.getStatusText());
      this.refreshConnectionStatusBar();
    }, 3000);
  }

  updateTopbarText(_text) {
    if (!this.settings.showTopbarStatus || !this.topbarElement) {
      return;
    }
    const label = this.getHoverStatusText();
    this.topbarElement.setAttribute("aria-label", label);
    this.topbarElement.setAttribute("data-title", label);
    this.topbarElement.setAttribute("title", label);
    const abnormal = !["running", "starting"].includes(this.getDisplayStatus());
    this.topbarElement.classList.toggle("fsiyuanmcp-topbar--error", abnormal);
  }
};
