import { eventSource, event_types } from "../../../../script.js";

const EXT = "system_flow";
const META_KEY = "system_flow_v1";
const LOG_PREFIX = "[System Flow]";
const PLUGIN_VERSION = "0.1.6";
const WAND_ENTRY_ID = "system_flow_wand_entry";
const SETTINGS_DRAWER_ID = "system-flow-settings";

const DEFAULT_SYSTEM_FEATURES = ["tasks", "profile", "shop", "bag", "logs"];
const BUILTIN_SYSTEMS = [
    ["roleplay","扮演角色系统","身份、角色背景、能力与扮演任务",true,["profile","tasks","logs"]],
    ["pinduoduo","拼多多系统","拼单、优惠、随机日用品与活动",true,["tasks","shop","bag","logs"]],
    ["taobao","淘宝系统","商品搜索、购物、限时活动与隐藏商品",true,["tasks","shop","bag","logs"]],
    ["omniverse","万界全能系统","跨世界任务、能力成长与世界适配",true,DEFAULT_SYSTEM_FEATURES],
    ["dressing","换装系统","服装收集、套装、外观与搭配效果",true,["profile","shop","bag","logs"]],
    ["faith","信仰系统","信仰值、信徒、等级与能力解锁",true,["profile","tasks","shop","logs"]],
    ["survival","求生系统","生存目标、资源管理与环境事件",true,["profile","tasks","shop","bag","logs"]],
    ["攻略","攻略系统","目标角色关系、剧情节点与互动任务",true,["profile","tasks","logs"]],
    ["cultivation","修仙系统","境界、灵根、功法、灵石与修炼",true,["profile","tasks","shop","bag","logs"]],
    ["martial","习武系统","训练、体能成长、招式与武学等级",true,["profile","tasks","shop","bag","logs"]],
    ["baidu","百度系统","资料检索、知识查询与信息整理",false,["tasks","logs"]],
];

const ATTRIBUTE_LABELS = {
    body: "身体",
    mind: "智力",
    strength: "力量",
    speed: "速度",
    constitution: "体质",
    stamina: "耐力",
    agility: "敏捷",
    iq: "智商",
    memory: "记忆",
    observation: "观察",
    learning: "学习",
    intelligence: "智力",
    perception: "感知",
    charisma: "魅力"
};

const PERSONA_ATTRIBUTE_ALIASES = {
    strength: "strength",
    "力量": "strength",
    speed: "speed",
    "速度": "speed",
    constitution: "constitution",
    "体质": "constitution",
    stamina: "stamina",
    "耐力": "stamina",
    agility: "agility",
    "敏捷": "agility",
    iq: "iq",
    "智商": "iq",
    intelligence: "intelligence",
    "智力": "intelligence",
    memory: "memory",
    "记忆": "memory",
    observation: "observation",
    "观察": "observation",
    learning: "learning",
    "学习": "learning",
    perception: "perception",
    "感知": "perception",
    charisma: "charisma",
    "魅力": "charisma"
};

const DEFAULT_STATE = () => ({
    version: 1,
    dataSchemaVersion: 2,
    active: false,
    systems: [],
    customSystems: [],
    systemData: {},
    migration: {
        v2Complete: false,
        legacyAssignedTo: ""
    },
    difficulty: "normal",
    currencyName: "积分",
    currency: 0,
    attributePoints: 0,
    profile: {
        name: "", age: null, gender: "", identity: "",
        description: "", personality: "", background: "", appearance: "",
        body: { strength: 10, speed: 10, constitution: 10, stamina: 10, agility: 10 },
        mind: {
            iq: 100,
            memory: 10,
            observation: 10,
            learning: 10,
            intelligence: 10,
            perception: 10,
            charisma: 10
        },
        abilities: [], buffs: [],
        importMeta: {
            manualEdited: false,
            initialized: false,
            personaInitialized: false,
            personaVersion: 2,
            aiCharacterName: "",
            userPersonaName: "",
            importedAt: ""
        }
    },
    tasks: [],
    inventory: [],
    shopItems: [],
    pendingAction: null,
    shopUnlocks: {},
    logs: [],
    settings: { showChatNotice: true, autoAcceptAiActions: false },
    profileSources: {
        userPersona: null,
        updatedAt: ""
    }
});

let panel, promptTimer, keyboardHandler, entryObserver, entryObserverTimer, bootstrapTimer;
let activeTab = "tasks";
let uiView = "selection";
let selectionMode = "multi";
let selectionDraft = [];
let managementSystemId = "";
let initialized = false;
let bootstrapAttempts = 0;
let contextErrorReported = false;
let promptErrorReported = false;
let lastProcessedMessageKey = "";
const registeredListeners = new Map();

const diagnostics = {
    version: PLUGIN_VERSION,
    initialized: false,
    appReady: false,
    context: false,
    chatMetadata: false,
    saveMetadata: false,
    extensionPrompt: false,
    entries: {
        floating: false,
        wand: false,
        settings: false
    },
    events: {},
    lastOpenedFrom: "",
    lastSavedAt: "",
    lastError: ""
};

function reportError(scope, error) {
    const message = error instanceof Error ? error.message : String(error);
    diagnostics.lastError = `${scope}: ${message}`;
    console.error(`${LOG_PREFIX} ${scope}:`, error);
    updateSettingsStatus();
}

function diagnosticSummary() {
    return JSON.stringify(diagnostics, null, 2);
}

function ctx() {
    try {
        const context = globalThis.SillyTavern?.getContext?.();
        diagnostics.context = Boolean(context);
        diagnostics.chatMetadata = Boolean(context?.chatMetadata && typeof context.chatMetadata === "object");
        diagnostics.saveMetadata = typeof context?.saveMetadata === "function";
        diagnostics.extensionPrompt = typeof context?.setExtensionPrompt === "function";
        if (!context && !contextErrorReported) {
            contextErrorReported = true;
            reportError("getContext", new Error("SillyTavern.getContext() is unavailable."));
        }
        return context ?? null;
    } catch (error) {
        diagnostics.context = false;
        if (!contextErrorReported) {
            contextErrorReported = true;
            reportError("getContext", error);
        }
        return null;
    }
}

function cloneData(value) {
    if (value === null || value === undefined) return value;
    try {
        return JSON.parse(JSON.stringify(value));
    } catch {
        return value;
    }
}

function migrateProfile(source = {}) {
    const defaults = DEFAULT_STATE().profile;
    const profile = source && typeof source === "object" ? source : {};
    const migrated = {
        ...defaults,
        ...profile,
        body: { ...defaults.body, ...(profile.body || {}) },
        mind: { ...defaults.mind, ...(profile.mind || {}) },
        abilities: Array.isArray(profile.abilities) ? cloneData(profile.abilities) : [],
        buffs: Array.isArray(profile.buffs) ? cloneData(profile.buffs) : [],
        importMeta: {
            ...defaults.importMeta,
            ...(profile.importMeta || {})
        }
    };
    if (!migrated.importMeta.manualEdited && !migrated.importMeta.personaInitialized
        && migrated.importMeta.personaVersion !== 2) {
        migrated.description = "";
        migrated.personality = "";
        migrated.background = "";
        migrated.appearance = "";
    }
    migrated.importMeta.personaVersion = 2;
    migrated.importMeta.personaInitialized = Boolean(migrated.importMeta.personaInitialized);
    return migrated;
}

function migrateSystemBucket(source = {}, rootState = null) {
    const defaults = DEFAULT_STATE();
    const bucket = source && typeof source === "object" ? source : {};
    const merged = {
        ...defaults,
        ...cloneData(bucket),
        currencyName: bucket.currencyName ?? rootState?.currencyName ?? defaults.currencyName,
        currency: Math.max(0, Number(bucket.currency ?? 0) || 0),
        attributePoints: Math.max(0, Number(bucket.attributePoints ?? 0) || 0),
        difficulty: bucket.difficulty ?? rootState?.difficulty ?? defaults.difficulty,
        profile: migrateProfile(bucket.profile),
        pendingAction: bucket.pendingAction ?? null,
        settings: { ...defaults.settings, ...(bucket.settings || {}) },
        profileSources: {
            ...defaults.profileSources,
            ...(bucket.profileSources || {})
        }
    };
    delete merged.version;
    delete merged.dataSchemaVersion;
    delete merged.active;
    delete merged.systems;
    delete merged.customSystems;
    delete merged.systemData;
    delete merged.migration;
    for (const key of ["tasks", "inventory", "shopItems", "logs"]) {
        if (!Array.isArray(merged[key])) merged[key] = [];
    }
    if (!merged.shopUnlocks || typeof merged.shopUnlocks !== "object") merged.shopUnlocks = {};
    merged.tasks = merged.tasks.map(task => ({
        ...task,
        progress: Math.max(0, Math.min(100, Number(task.progress) || 0)),
        status: task.status || "active",
        reward: {
            currency: Math.max(0, Number(task.reward?.currency) || 0),
            attributePoints: Math.max(0, Number(task.reward?.attributePoints) || 0)
        }
    }));
    return merged;
}

function createSystemBucket(source = null, rootState = null) {
    if (!source) return migrateSystemBucket({}, rootState);
    const legacy = {
        currencyName: source.currencyName,
        currency: source.currency,
        attributePoints: source.attributePoints,
        difficulty: source.difficulty,
        profile: source.profile,
        tasks: source.tasks,
        inventory: source.inventory,
        shopItems: source.shopItems,
        pendingAction: source.pendingAction,
        shopUnlocks: source.shopUnlocks,
        logs: source.logs,
        settings: source.settings,
        profileSources: source.profileSources
    };
    return migrateSystemBucket(legacy, rootState);
}

function hasLegacyData(stateLike) {
    return Math.max(0, Number(stateLike?.currency) || 0) > 0
        || Math.max(0, Number(stateLike?.attributePoints) || 0) > 0
        || ["tasks", "inventory", "shopItems", "logs"].some(key => Array.isArray(stateLike?.[key]) && stateLike[key].length > 0)
        || ["name", "gender", "identity", "description", "personality", "background", "appearance"]
            .some(key => Boolean(String(stateLike?.profile?.[key] || "").trim()));
}

function ensureSystemBucket(stateLike, systemId, allowLegacy = true) {
    if (!systemId) return null;
    if (!stateLike.systemData || typeof stateLike.systemData !== "object") stateLike.systemData = {};
    if (!stateLike.migration || typeof stateLike.migration !== "object") {
        stateLike.migration = { v2Complete: false, legacyAssignedTo: "" };
    }
    if (!stateLike.systemData[systemId]) {
        const claimLegacy = allowLegacy
            && !stateLike.migration.legacyAssignedTo
            && hasLegacyData(stateLike);
        stateLike.systemData[systemId] = createSystemBucket(claimLegacy ? stateLike : null, stateLike);
        if (!stateLike.migration.legacyAssignedTo) {
            stateLike.migration.legacyAssignedTo = systemId;
        }
    } else {
        stateLike.systemData[systemId] = migrateSystemBucket(stateLike.systemData[systemId], stateLike);
    }
    stateLike.migration.v2Complete = true;
    return stateLike.systemData[systemId];
}

function currentChatKey(c = ctx()) {
    if (!c) return null;
    const chat = Array.isArray(c.chat) ? c.chat : [];
    const chatId = c.chatId ?? c.chatFileName ?? c.chatName ?? c.groupId ?? null;
    const character = c.characterId ?? c.characterName ?? c.name2 ?? "";
    if (chatId !== null && chatId !== undefined && String(chatId)) return `${c.groupId ? "group" : "chat"}:${String(chatId)}:${String(character)}`;
    if (chat.length) {
        const first = chat[0] || {};
        return `fallback:${String(character)}:${String(first.send_date || first.timestamp || first.mes || first.name || "")}`;
    }
    return null;
}
function state() {
    const c = ctx();
    if (!c?.chatMetadata) return null;
    const chatKey = currentChatKey(c);
    if (!chatKey) return null;
    const saved = c.chatMetadata[META_KEY];
    if (!saved || typeof saved !== "object" || Array.isArray(saved)) {
        c.chatMetadata[META_KEY] = { ...DEFAULT_STATE(), ownerChatKey: chatKey };
    } else if (saved.ownerChatKey && saved.ownerChatKey !== chatKey) {
        // chatMetadata is already scoped to one chat. A changed key commonly means
        // the chat was renamed; retain its data instead of overwriting it.
        console.warn(`${LOG_PREFIX} Chat identity changed. Preserving the existing chat-scoped save.`, {
            previous: saved.ownerChatKey,
            current: chatKey
        });
    }
    c.chatMetadata[META_KEY] = migrate(c.chatMetadata[META_KEY]);
    c.chatMetadata[META_KEY].ownerChatKey = chatKey;
    return c.chatMetadata[META_KEY];
}
function migrate(s) {
    const d = DEFAULT_STATE();
    const source = s && typeof s === "object" ? s : {};
    const merged = {
        ...d,
        ...source,
        systems: Array.isArray(source.systems) ? [...new Set(source.systems.map(String))] : [],
        customSystems: Array.isArray(source.customSystems) ? cloneData(source.customSystems) : [],
        systemData: {},
        migration: { ...d.migration, ...(source.migration || {}) },
        profile: migrateProfile(source.profile),
        settings: { ...d.settings, ...(source.settings || {}) },
        profileSources: { ...d.profileSources, ...(source.profileSources || {}) }
    };
    for (const key of ["systems", "customSystems", "tasks", "inventory", "shopItems", "logs"]) {
        if (!Array.isArray(merged[key])) merged[key] = [];
    }
    if (!merged.shopUnlocks || typeof merged.shopUnlocks !== "object") merged.shopUnlocks = {};
    merged.tasks = merged.tasks.map(task => ({
        ...task,
        progress: Math.max(0, Math.min(100, Number(task.progress) || 0)),
        status: task.status || "active",
        reward: {
            currency: Math.max(0, Number(task.reward?.currency) || 0),
            attributePoints: Math.max(0, Number(task.reward?.attributePoints) || 0)
        }
    }));
    if (source.systemData && typeof source.systemData === "object" && !Array.isArray(source.systemData)) {
        for (const [systemId, bucket] of Object.entries(source.systemData)) {
            if (!systemId || !bucket || typeof bucket !== "object") continue;
            merged.systemData[systemId] = migrateSystemBucket(bucket, merged);
            if (!merged.migration.legacyAssignedTo) {
                merged.migration.legacyAssignedTo = systemId;
            }
        }
    }
    for (const systemId of merged.systems) {
        ensureSystemBucket(merged, systemId);
    }
    merged.migration.v2Complete = true;
    return merged;
}

function parseListValue(value) {
    return [...new Set(String(value || "")
        .replace(/^\[|\]$/g, "")
        .split(/[,，、;；|\n]/)
        .map(item => item.trim())
        .filter(item => item && item.length <= 80))]
        .slice(0, 30);
}

function parsePersonaAttributes(text) {
    const attributes = {};
    const aliasPattern = Object.keys(PERSONA_ATTRIBUTE_ALIASES)
        .sort((a, b) => b.length - a.length)
        .map(alias => alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
        .join("|");
    const pattern = new RegExp(`(?:^|[\\s,，、;；|:：])(${aliasPattern})\\s*(?:[:：=]\\s*|\\s+)(-?\\d+(?:\\.\\d+)?)`, "gi");
    let match;
    while ((match = pattern.exec(text))) {
        const alias = match[1];
        if (!alias) continue;
        const value = Number(match[2]);
        if (Number.isFinite(value)) {
            const key = PERSONA_ATTRIBUTE_ALIASES[alias] || PERSONA_ATTRIBUTE_ALIASES[alias.toLowerCase()];
            if (key) attributes[key] = value;
        }
    }
    return attributes;
}

function parseUserPersonaFields(description) {
    const text = String(description || "")
        .replace(/\\r\\n|\\n|\\r/g, "\n")
        .replace(/\r/g, "");
    const fields = {
        gender: "",
        age: "",
        height: "",
        constitution: "",
        attributes: parsePersonaAttributes(text),
        buffs: [],
        abilities: []
    };
    const labels = {
        gender: ["性别", "gender", "sex"],
        age: ["年龄", "age"],
        height: ["身高", "height"],
        constitution: ["体质", "constitution"],
        buffs: ["buff", "buffs", "增益", "状态"],
        abilities: ["能力", "技能", "abilities", "ability", "skills"]
    };
    const allLabels = Object.values(labels).flat()
        .map(label => label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
        .join("|");
    const segments = text.split(new RegExp(`\\n|(?=(?:${allLabels})\\s*[:：])`, "i"));
    for (const segment of segments) {
        const match = segment.match(/^\s*(?:[-*•]\s*)?([^:：]{1,20})\s*[:：]\s*([\s\S]*)$/);
        if (!match) continue;
        const label = match[1].trim().toLowerCase();
        const value = match[2].trim();
        for (const [field, aliases] of Object.entries(labels)) {
            if (!aliases.some(alias => alias.toLowerCase() === label)) continue;
            if (["buffs", "abilities"].includes(field)) fields[field] = parseListValue(value);
            else fields[field] = value;
            break;
        }
    }
    if (!fields.attributes.constitution && /^\d+(?:\.\d+)?$/.test(fields.constitution)) {
        fields.attributes.constitution = Number(fields.constitution);
    }
    return fields;
}

function getUserPersonaSnapshot(context = ctx()) {
    if (!context) return null;
    const powerUser = context.powerUserSettings || {};
    const personas = powerUser.personas && typeof powerUser.personas === "object" ? powerUser.personas : {};
    const descriptions = powerUser.persona_descriptions && typeof powerUser.persona_descriptions === "object"
        ? powerUser.persona_descriptions
        : {};
    const chatPersona = String(context.chatMetadata?.persona || "").trim();
    const nameMatchedAvatar = Object.keys(personas)
        .find(avatar => String(personas[avatar]) === String(context.name1 || "").trim());
    const personaKey = chatPersona || nameMatchedAvatar || "";
    const description = String(
        powerUser.persona_description
        || descriptions[personaKey]?.description
        || ""
    ).trim();
    const configured = Boolean(description || (personaKey && (personas[personaKey] || descriptions[personaKey])));
    const fields = parseUserPersonaFields(description);
    return {
        configured,
        personaKey,
        fields,
        sourceType: "user-persona",
        updatedAt: new Date().toISOString()
    };
}

function importProfileSources(bucket) {
    if (!bucket?.profile) return;
    const persona = getUserPersonaSnapshot();
    bucket.profileSources = {
        ...(bucket.profileSources || {}),
        userPersona: persona,
        updatedAt: new Date().toISOString()
    };
    if (!persona?.configured) return;
    const profile = bucket.profile;
    if (profile.importMeta?.manualEdited || profile.importMeta?.personaInitialized) return;
    const defaults = DEFAULT_STATE().profile;
    for (const [key, value] of Object.entries(persona.fields.attributes)) {
        if (key in profile.body && profile.body[key] === defaults.body[key]) {
            profile.body[key] = value;
        } else if (key in profile.mind && profile.mind[key] === defaults.mind[key]) {
            profile.mind[key] = value;
        }
    }
    if (!profile.abilities.length && persona.fields.abilities.length) {
        profile.abilities = [...persona.fields.abilities];
    }
    if (!profile.buffs.length && persona.fields.buffs.length) {
        profile.buffs = [...persona.fields.buffs];
    }
    profile.importMeta = {
        ...profile.importMeta,
        initialized: true,
        personaInitialized: true,
        personaVersion: 2,
        importedAt: new Date().toISOString()
    };
}

function attributeLabel(key) {
    return ATTRIBUTE_LABELS[key] || String(key);
}

async function save() {
    const c = ctx();
    if (!c?.saveMetadata) {
        diagnostics.saveMetadata = false;
        reportError("saveMetadata", new Error("saveMetadata() is unavailable; changes remain in the current panel session only."));
        return;
    }
    try {
        await c.saveMetadata();
        diagnostics.lastSavedAt = new Date().toLocaleString();
    } catch (error) {
        reportError("saveMetadata", error);
    }
    render();
    refreshPrompt();
    updateSettingsStatus();
}
function notify(msg, type="success") {
    if (window.toastr?.[type]) window.toastr[type](msg, "System Flow");
    else console.log(`[System Flow] ${msg}`);
}
function esc(v) {
    return String(v ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
}
function id() { return `sf_${Date.now()}_${Math.random().toString(36).slice(2,8)}`; }
function priceFactor(s) { return ({ easy: 0.5, normal: 1, hell: 3 })[s.difficulty] || 1; }
function allSystems(s) {
    return [
        ...BUILTIN_SYSTEMS.map(x => ({
            id: x[0],
            name: x[1],
            description: x[2],
            shop: x[3],
            features: [...new Set(x[4] || DEFAULT_SYSTEM_FEATURES)],
            builtin: true
        })),
        ...(s.customSystems || []).map(system => ({
            ...system,
            shop: system.shop !== false,
            features: Array.isArray(system.features)
                ? [...new Set(system.features)]
                : [...DEFAULT_SYSTEM_FEATURES]
        }))
    ];
}
function activeNames(s) { return (s.systems || []).map(x => allSystems(s).find(y=>y.id===x)?.name || x); }
function getSystemDefinition(s, systemId) {
    return allSystems(s).find(system => system.id === systemId) || null;
}
function hasSystemFeature(system, feature) {
    return Boolean(system?.features?.includes(feature));
}
function ensureManagementSystem(s) {
    const selected = Array.isArray(s?.systems) ? s.systems : [];
    if (!selected.length) {
        managementSystemId = "";
        return null;
    }
    if (!selected.includes(managementSystemId)) {
        managementSystemId = selected[0];
    }
    return getSystemDefinition(s, managementSystemId);
}

function addLog(s, text) {
    s.logs.unshift({ id:id(), text, time:new Date().toISOString() });
    s.logs = s.logs.slice(0, 80);
}
function ensureActive(s) {
    if (!s) {
        notify("请先选择并进入至少一个系统。", "warning");
        return false;
    }
    return true;
}

function installPrompt() {
    const c = ctx();
    if (!c?.setExtensionPrompt) {
        diagnostics.extensionPrompt = false;
        if (!promptErrorReported) {
            promptErrorReported = true;
            reportError("setExtensionPrompt", new Error("Prompt injection is unavailable; the management UI remains usable."));
        }
        return;
    }
    diagnostics.extensionPrompt = true;
    const s = state();
    if (!s?.active || !s.systems?.length) {
        c.setExtensionPrompt(EXT, "", 1, 0, false);
        return;
    }
    const systemSummaries = s.systems.map(systemId => {
        const system = getSystemDefinition(s, systemId);
        const bucket = ensureSystemBucket(s, systemId);
        return {
            systemId,
            systemName: system?.name || systemId,
            shopEnabled: Boolean(system?.shop),
            currencyName: bucket.currencyName,
            currency: bucket.currency,
            attributePoints: bucket.attributePoints,
            profile: bucket.profile,
            userPersona: bucket.profileSources?.userPersona?.fields || null,
            tasks: bucket.tasks.map(task => ({
                id: task.id,
                title: task.title,
                status: task.status,
                description: task.description,
                reward: task.reward
            }))
        };
    });
    const prompt = [
        "【System Flow 系统流规则】",
        `当前启用系统：${systemSummaries.map(item => `${item.systemName} (${item.systemId})`).join("、")}。`,
        `各系统独立状态：${JSON.stringify(systemSummaries)}。`,
        "你负责根据用户实际剧情判断是否出现任务、事件、奖励或系统解锁。不得声称插件已执行任何数据变更。",
        "如需请求插件执行数据变更，请在回复末尾附上一个 <SF_ACTION>...</SF_ACTION> JSON 对象。每次最多一个对象。",
        systemSummaries.length > 1
            ? "当前存在多个系统，action 必须包含 systemId，且只能使用上面列出的 systemId。"
            : "单系统时 systemId 可省略，插件会使用当前系统。",
        "支持的 action：",
        "1. task_create: {type:'task_create',title,description,reward:{currency:number,attributePoints:number},systemId?}",
        "2. task_progress: {type:'task_progress',taskId,progress:number}，progress 为 0-100。",
        "3. task_complete: {type:'task_complete',taskId}。插件将检查任务状态并发放预设奖励。",
        "4. event_notice: {type:'event_notice',title,description}",
        "5. unlock_shop: {type:'unlock_shop',systemId}",
        "不要输出购买、加点、发放道具等未经用户操作的命令。所有AI提议都需要用户在面板中确认。",
        "不得覆盖用户既有身份、世界观或角色设定；系统设定必须适配当前故事。"
    ].join("\n");
    c.setExtensionPrompt(EXT, prompt, 1, 0, false);
}
function refreshPrompt() {
    clearTimeout(promptTimer);
    promptTimer = setTimeout(installPrompt, 80);
}

function parseAiAction(text) {
    const m = String(text || "").match(/<SF_ACTION>\s*([\s\S]*?)\s*<\/SF_ACTION>/i);
    if (!m) return null;
    try {
        const obj = JSON.parse(m[1]);
        if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
        return obj;
    } catch { return null; }
}
function renderPendingAction(action, bucket, systemId, systemName) {
    if (!panel || !action) return;
    const safe = esc(JSON.stringify(action, null, 2));
    const holder = panel.querySelector("#sf-ai-pending");
    if (!holder) return;
    holder.innerHTML = `<div class="sf-card sf-pending"><b>AI 提交了一项系统操作提议</b><small>目标系统：${esc(systemName)}</small><pre>${safe}</pre><div class="sf-actions"><button id="sf-ai-approve" class="sf-primary">验证并执行</button><button id="sf-ai-dismiss">忽略</button></div></div>`;
    holder.querySelector("#sf-ai-approve").onclick = () => applyAiAction(action, bucket, systemId);
    holder.querySelector("#sf-ai-dismiss").onclick = async () => {
        const root = state();
        const currentBucket = root ? ensureSystemBucket(root, systemId) : null;
        if (!currentBucket) return;
        currentBucket.pendingAction = null;
        await save();
        holder.innerHTML = "";
    };
}
async function applyAiAction(a, bucket, systemId) {
    const root = state();
    if (!root) return;
    const system = getSystemDefinition(root, systemId);
    if (!system || !root.systems.includes(systemId)) {
        return notify("目标系统不在当前启用列表中。","error");
    }
    bucket = ensureSystemBucket(root, systemId);
    if (!bucket || !ensureActive(bucket)) return;
    if (a.type === "task_create") {
        if (!hasSystemFeature(system, "tasks")) return notify("当前系统不支持任务。","warning");
        const title = String(a.title || "").trim().slice(0,100);
        if (!title) return notify("任务缺少标题。","error");
        const reward = a.reward || {};
        const currency = Math.max(0, Math.min(1000000, Math.floor(Number(reward.currency)||0)));
        const points = Math.max(0, Math.min(10000, Math.floor(Number(reward.attributePoints)||0)));
        bucket.tasks.unshift({ id:id(), title, description:String(a.description||"").slice(0,1000),
            status:"active", progress:0, reward:{currency,attributePoints:points}, source:"AI提议", createdAt:Date.now() });
        addLog(bucket, `新增任务：${title}`);
    } else if (a.type === "task_progress") {
        if (!hasSystemFeature(system, "tasks")) return notify("当前系统不支持任务。","warning");
        const t = bucket.tasks.find(x=>x.id===a.taskId && x.status==="active");
        if (!t) return notify("找不到可更新的进行中任务。","error");
        t.progress = Math.max(0,Math.min(100,Math.floor(Number(a.progress)||0)));
        addLog(bucket, `任务进度更新：${t.title} ${t.progress}%`);
    } else if (a.type === "task_complete") {
        if (!hasSystemFeature(system, "tasks")) return notify("当前系统不支持任务。","warning");
        const t = bucket.tasks.find(x=>x.id===a.taskId && x.status==="active");
        if (!t) return notify("任务不存在或已经完成。","error");
        if (t.progress < 100) return notify("任务尚未达到100%进度，不能领取奖励。","warning");
        t.status = "completed";
        bucket.currency += t.reward.currency || 0;
        bucket.attributePoints += t.reward.attributePoints || 0;
        addLog(bucket, `任务完成：${t.title}；获得 ${t.reward.currency||0}${bucket.currencyName}、${t.reward.attributePoints||0} 属性点`);
    } else if (a.type === "event_notice") {
        addLog(bucket, `系统事件：${String(a.title||"新事件")} — ${String(a.description||"")}`);
    } else if (a.type === "unlock_shop") {
        const sys = getSystemDefinition(root, a.systemId);
        if (!sys || !sys.shop) return notify("该系统没有商城，或系统不存在。","error");
        ensureSystemBucket(root, sys.id).shopUnlocks[sys.id] = true;
        addLog(bucket, `商城已解锁：${sys.name}`);
    } else {
        return notify("不支持的AI操作类型。","error");
    }
    bucket.pendingAction = null;
    await save();
    notify("AI提议已通过验证并执行。");
}

const FEATURE_LABELS = {
    tasks: "任务",
    profile: "角色资料",
    shop: "商城",
    bag: "背包",
    logs: "日志"
};

function systemFeatureText(system) {
    return system.features.map(feature => FEATURE_LABELS[feature] || feature).join(" · ");
}

function systemCards(s) {
    const selected = new Set(selectionDraft);
    return `<div class="sf-system-grid">${allSystems(s).map(system => {
        const isSelected = selected.has(system.id);
        return `
          <label class="sf-system-card ${isSelected ? "selected" : ""}" data-system-card="${esc(system.id)}" role="checkbox" tabindex="0" aria-checked="${isSelected}">
            <input class="sf-system-checkbox" type="checkbox" value="${esc(system.id)}" ${isSelected ? "checked" : ""}>
            <span class="sf-system-mark"><i class="fa-solid ${system.builtin ? "fa-cube" : "fa-wand-magic-sparkles"}"></i></span>
            <span class="sf-system-copy"><b>${esc(system.name)}</b><small>${esc(system.description)}</small><em>${esc(systemFeatureText(system))}</em></span>
            <span class="sf-system-check" aria-hidden="true">✓</span>
          </label>`;
    }).join("")}</div>`;
}

function updateSelectionCardStyles() {
    panel?.querySelectorAll(".sf-system-card").forEach(card => {
        const checkbox = card.querySelector(".sf-system-checkbox");
        const selected = Boolean(checkbox?.checked);
        card.classList.toggle("selected", selected);
        card.setAttribute("aria-checked", String(selected));
    });
}

function renderSelection(s) {
    if (!selectionDraft.length && s.systems.length) selectionDraft = [...s.systems];
    panel.innerHTML = `
      <div class="sf-page sf-selection-page">
        <div class="sf-header"><div><div class="sf-eyebrow">SYSTEM FLOW · SELECT SYSTEM</div><h2>选择你的系统</h2><small>先确认系统，再进入独立的管理控制台</small></div><span class="sf-status ${s.active ? "on" : ""}">${s.active ? "已有系统" : "新系统"}</span></div>
        <section class="sf-card sf-selection-card">
          <div class="sf-section-heading"><div><h3>可用系统</h3><p class="sf-muted">点击卡片选择。可单系统运行，也可组合多个系统。</p></div>
          <div class="sf-segment"><button id="sf-mode-single" class="${selectionMode === "single" ? "active" : ""}">单选</button><button id="sf-mode-multi" class="${selectionMode === "multi" ? "active" : ""}">多选</button></div></div>
          ${systemCards(s)}
          <button id="sf-open-custom-create" type="button" class="sf-custom-entry"><span class="sf-system-mark"><i class="fa-solid fa-plus"></i></span><span><b>自定义系统</b><small>创建新的系统名称、简介和支持功能</small></span><i class="fa-solid fa-chevron-right" aria-hidden="true"></i></button>
          <div class="sf-selection-setting"><label>商城价格档位 <select id="sf-difficulty"><option value="easy" ${s.difficulty === "easy" ? "selected" : ""}>简单（低价）</option><option value="normal" ${s.difficulty === "normal" ? "selected" : ""}>正常</option><option value="hell" ${s.difficulty === "hell" ? "selected" : ""}>地狱级（高价）</option></select></label></div>
          <div class="sf-selection-actions">
            <button id="sf-random-one"><i class="fa-solid fa-shuffle"></i> 随机一个</button>
            <button id="sf-random-many"><i class="fa-solid fa-shuffle"></i> 随机两个</button>
            <button id="sf-confirm-selection" class="sf-primary sf-confirm-button">确认选择 / 进入系统</button>
          </div>
        </section>
        <div class="sf-footer"><span>◆</span> 选择页不修改现有任务、积分、背包或日志 <span>◆</span></div>
      </div>`;

    panel.querySelectorAll(".sf-system-card").forEach(card => {
        const checkbox = card.querySelector(".sf-system-checkbox");
        const toggle = event => {
            if (event.target === checkbox) return;
            event.preventDefault();
            checkbox.checked = !checkbox.checked;
            checkbox.dispatchEvent(new Event("change", { bubbles: true }));
        };
        card.addEventListener("click", toggle);
        card.addEventListener("keydown", event => {
            if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                toggle(event);
            }
        });
        checkbox.addEventListener("change", () => {
            if (selectionMode === "single" && checkbox.checked) {
                panel.querySelectorAll(".sf-system-checkbox").forEach(other => {
                    if (other !== checkbox) other.checked = false;
                });
            }
            if (selectionMode === "single" && checkbox.checked) {
                selectionDraft = [checkbox.value];
            } else if (checkbox.checked) {
                selectionDraft = [...new Set([...selectionDraft, checkbox.value])];
            } else {
                selectionDraft = selectionDraft.filter(value => value !== checkbox.value);
            }
            updateSelectionCardStyles();
        });
    });
    panel.querySelector("#sf-mode-single").onclick = () => {
        selectionMode = "single";
        panel.querySelector("#sf-mode-single").classList.add("active");
        panel.querySelector("#sf-mode-multi").classList.remove("active");
        const checked = [...panel.querySelectorAll(".sf-system-checkbox")].filter(input => input.checked);
        checked.slice(1).forEach(input => { input.checked = false; });
        selectionDraft = checked.length ? [checked[0].value] : [];
        updateSelectionCardStyles();
    };
    panel.querySelector("#sf-mode-multi").onclick = () => {
        selectionMode = "multi";
        panel.querySelector("#sf-mode-multi").classList.add("active");
        panel.querySelector("#sf-mode-single").classList.remove("active");
    };
    panel.querySelector("#sf-random-one").onclick = () => randomizeSelection(s, 1);
    panel.querySelector("#sf-random-many").onclick = () => randomizeSelection(s, 2);
    panel.querySelector("#sf-open-custom-create").onclick = () => {
        uiView = "custom-create";
        render();
    };
    panel.querySelector("#sf-confirm-selection").onclick = async () => {
        const chosen = [...new Set(selectionDraft)];
        if (!chosen.length) return notify("请至少选择一个系统。", "warning");
        const current = state();
        if (!current) return notify("当前聊天存档不可用。", "error");
        const previous = new Set(current.systems);
        current.systems = chosen;
        current.active = true;
        current.difficulty = panel.querySelector("#sf-difficulty").value || current.difficulty;
        for (const systemId of chosen) {
            const bucket = ensureSystemBucket(current, systemId);
            bucket.difficulty = current.difficulty;
            if (!previous.has(systemId)) addLog(bucket, `进入系统：${getSystemDefinition(current, systemId)?.name || systemId}`);
        }
        managementSystemId = chosen[0];
        const system = getSystemDefinition(current, chosen[0]);
        activeTab = system?.features?.[0] || "tasks";
        uiView = "management";
        await save();
        notify("系统选择已确认。");
    };
}

function renderCustomCreate(s) {
    const featureOptions = [
        ["tasks", "任务"],
        ["profile", "角色资料"],
        ["shop", "商城"],
        ["bag", "背包"],
        ["logs", "日志"]
    ];
    panel.innerHTML = `
      <div class="sf-page sf-custom-create-page">
        <div class="sf-header"><div><div class="sf-eyebrow">SYSTEM FLOW · CUSTOM SYSTEM</div><h2>创建自定义系统</h2><small>创建完成后返回系统选择页，并保留原有选择</small></div><button id="sf-custom-close" class="sf-icon-button" aria-label="关闭">×</button></div>
        <div class="sf-card sf-custom-dialog" role="dialog" aria-modal="true" aria-label="创建自定义系统">
          <div class="sf-form">
            <label>系统名称<input id="sf-custom-name" maxlength="80" placeholder="例如：炼金术系统"></label>
            <label>系统简介<textarea id="sf-custom-desc" maxlength="1200" placeholder="系统规则、机制与特殊能力"></textarea></label>
            <fieldset class="sf-feature-fieldset"><legend>支持的功能</legend>${featureOptions.map(([value, label]) => `<label class="sf-inline"><input class="sf-custom-feature" type="checkbox" value="${value}" ${value === "tasks" ? "checked" : ""}>${label}</label>`).join("")}</fieldset>
          </div>
          <div class="sf-custom-actions"><button id="sf-custom-cancel">取消</button><button id="sf-custom-create" class="sf-primary">确认创建</button></div>
        </div>
      </div>`;
    const close = () => {
        uiView = "selection";
        render();
    };
    panel.querySelector("#sf-custom-close").onclick = close;
    panel.querySelector("#sf-custom-cancel").onclick = close;
    panel.querySelector("#sf-custom-create").onclick = async () => {
        const name = panel.querySelector("#sf-custom-name").value.trim();
        const description = panel.querySelector("#sf-custom-desc").value.trim();
        const features = [...panel.querySelectorAll(".sf-custom-feature")]
            .filter(input => input.checked || input.hasAttribute("checked"))
            .map(input => input.value);
        if (!name) return notify("请填写系统名称。", "warning");
        if (!description) return notify("请填写系统简介。", "warning");
        if (!features.length) return notify("请至少选择一个支持功能。", "warning");
        const current = state();
        if (!current) return notify("当前聊天存档不可用。", "error");
        const custom = {
            id: `custom_${id()}`,
            name,
            description,
            shop: features.includes("shop"),
            features,
            builtin: false
        };
        current.customSystems.push(custom);
        selectionDraft = [...new Set([...selectionDraft, custom.id])];
        uiView = "selection";
        await save();
        notify("自定义系统已创建并选中。");
    };
}

function randomizeSelection(s, count) {
    const ids = allSystems(s).map(system => system.id);
    for (let i = ids.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [ids[i], ids[j]] = [ids[j], ids[i]];
    }
    selectionDraft = ids.slice(0, Math.min(count, ids.length));
    selectionMode = selectionDraft.length > 1 ? "multi" : "single";
    panel.querySelector("#sf-mode-multi")?.classList.toggle("active", selectionMode === "multi");
    panel.querySelector("#sf-mode-single")?.classList.toggle("active", selectionMode === "single");
    panel.querySelectorAll(".sf-system-checkbox").forEach(input => {
        input.checked = selectionDraft.includes(input.value);
    });
    updateSelectionCardStyles();
    notify(`已随机选择 ${selectionDraft.length} 个系统，请确认后进入。`, "info");
}

function renderManagement(s) {
    const system = ensureManagementSystem(s);
    if (!system) {
        uiView = "selection";
        selectionDraft = [];
        renderSelection(s);
        return;
    }
    const bucket = ensureSystemBucket(s, managementSystemId);
    importProfileSources(bucket);
    const features = system.features.filter(feature => FEATURE_LABELS[feature]);
    if (!features.includes(activeTab)) activeTab = features[0] || "logs";
    const tabs = features.map(feature => `<button data-tab="${feature}" class="${activeTab === feature ? "active" : ""}">${FEATURE_LABELS[feature]}</button>`).join("");
    const systemSwitches = s.systems.length > 1
        ? `<div class="sf-system-switcher">${s.systems.map(systemId => {
            const item = getSystemDefinition(s, systemId);
            return `<button data-manage-system="${esc(systemId)}" class="${systemId === managementSystemId ? "active" : ""}">${esc(item?.name || systemId)}</button>`;
        }).join("")}</div>`
        : "";
    panel.innerHTML = `
      <div class="sf-page sf-management-page">
        <div class="sf-header"><div><div class="sf-eyebrow">SYSTEM FLOW · ACTIVE CONTROL</div><h2>${esc(system.name)}</h2><small>${s.systems.length > 1 ? `多系统组合：${esc(activeNames(s).join(" / "))}` : "当前系统独立存档"}</small></div><span class="sf-status on">运行中</span></div>
        <div class="sf-management-toolbar"><button id="sf-back-selection"><i class="fa-solid fa-arrow-left"></i> 更换 / 返回系统</button><div class="sf-mini-stats"><span>${esc(bucket.currencyName)} <b>${bucket.currency}</b></span><span>属性点 <b>${bucket.attributePoints}</b></span><span>任务 <b>${bucket.tasks.length}</b></span></div></div>
        ${systemSwitches}
        <div class="sf-card sf-system-brief"><h3>系统规则摘要</h3><p>${esc(system.description)}</p><small>可用模块：${esc(systemFeatureText(system))}</small></div>
        <div class="sf-tabs">${tabs}</div>
        <div id="sf-ai-pending"></div>
        <div id="sf-tab-content">${renderTab(bucket, activeTab, system, s)}</div>
        <div class="sf-footer"><span>◆</span> ${esc(system.name)} · 数据绑定当前聊天 <span>◆</span></div>
      </div>`;
    panel.querySelector("#sf-back-selection").onclick = () => {
        selectionDraft = [...s.systems];
        uiView = "selection";
        render();
    };
    panel.querySelectorAll("[data-manage-system]").forEach(button => {
        button.onclick = () => {
            managementSystemId = button.dataset.manageSystem;
            const nextSystem = getSystemDefinition(s, managementSystemId);
            activeTab = nextSystem?.features?.[0] || "logs";
            render();
        };
    });
    panel.querySelectorAll(".sf-tabs button").forEach(button => {
        button.onclick = () => {
            activeTab = button.dataset.tab;
            render();
        };
    });
    bindTab(bucket, activeTab, system, s);
    if (bucket.pendingAction) renderPendingAction(bucket.pendingAction, bucket, managementSystemId, system.name);
}

function render() {
    if (!panel) return;
    const s = state();
    if (!s) {
        const message = diagnostics.context
            ? "当前没有可用的聊天存档。请打开一个聊天，或重新初始化插件。"
            : "SillyTavern 上下文暂不可用。插件入口会保留，可在扩展设置中查看诊断信息。";
        panel.innerHTML = `
          <div class="sf-header"><div><div class="sf-eyebrow">SYSTEM FLOW · DIAGNOSTICS</div><h2>万界系统管理局</h2><small>界面已保留，数据操作等待上下文恢复</small></div><span class="sf-status">等待连接</span></div>
          <div class="sf-card"><h3>暂时无法读取聊天存档</h3><p class="sf-muted">${esc(message)}</p>
          <pre class="sf-diagnostics">${esc(diagnosticSummary())}</pre>
          <div class="sf-row"><button id="sf-retry-init" class="sf-primary">重新检测插件状态</button></div></div>`;
        panel.querySelector("#sf-retry-init")?.addEventListener("click", () => {
            init(true);
            render();
            updateSettingsStatus();
        });
        return;
    }
    if (uiView === "custom-create") renderCustomCreate(s);
    else if (uiView === "management" && s.systems.length) renderManagement(s);
    else renderSelection(s);
}
function profileEditor(bucket) {
    const profile = bucket.profile;
    const persona = bucket.profileSources?.userPersona;
    const fields = persona?.fields || {};
    const attributeText = Object.entries(fields.attributes || {})
        .map(([key, value]) => `${attributeLabel(key)} ${value}`)
        .join(" · ");
    const personaRows = [
        ["性别", fields.gender],
        ["年龄", fields.age],
        ["身高", fields.height],
        ["体质", fields.constitution],
        ["数值属性", attributeText],
        ["Buff", fields.buffs?.join("、")],
        ["能力", fields.abilities?.join("、")]
    ];
    return `<div class="sf-card">
      <div class="sf-section-heading"><div><h3>当前 User Persona</h3><p class="sf-muted">只读取当前用户 Persona 中明确标注的字段；不读取 AI 角色卡或长篇自由描述。</p></div><button id="sf-refresh-persona" class="sf-secondary">刷新资料</button></div>
      ${persona?.configured ? `<div class="sf-persona-fields">${personaRows.map(([label, value]) => `<div class="${value ? "" : "is-missing"}"><small>${label}</small><b>${esc(value || "未提供")}</b></div>`).join("")}</div>` : '<div class="sf-empty"><b>User Persona 尚未设置</b><p>请在 SillyTavern 的 Persona 管理中选择用户 Persona。插件不会生成或猜测角色资料。</p></div>'}
      <div class="sf-stats"><div><small>${esc(bucket.currencyName)}</small><b>${bucket.currency}</b></div><div><small>可用属性点</small><b>${bucket.attributePoints}</b></div></div>
      <h4>系统成长数值</h4><p class="sf-muted">这些数值属于插件系统成长，Persona 首次读取只补默认值，之后不会覆盖已有成长。</p>
      <h4>身体</h4>${Object.entries(profile.body).map(([key, value]) => attrRow(key, value)).join("")}
      <h4>智力</h4>${Object.entries(profile.mind).map(([key, value]) => attrRow(key, value)).join("")}
      <div class="sf-form sf-attribute-form"><label>属性类别<select id="sf-attr-kind"><option value="body">身体</option><option value="mind">智力</option></select></label>
      <label>属性<select id="sf-attr-key">${Object.keys(profile.body).map(key => `<option value="${key}">身体 · ${attributeLabel(key)}</option>`).join("")}${Object.keys(profile.mind).map(key => `<option value="${key}">智力 · ${attributeLabel(key)}</option>`).join("")}</select></label>
      <label>增加点数<input id="sf-attr-points" type="number" min="1" value="1"></label><button id="sf-add-attr" class="sf-primary">消耗属性点加点</button></div>
      <h4>系统能力</h4><div class="sf-chip-list">${profile.abilities.map(item => `<span class="sf-chip">${esc(item)}</span>`).join("") || '<span class="sf-muted">暂无能力</span>'}</div>
      <div class="sf-row"><button id="sf-add-ability">＋ 添加能力</button><button id="sf-remove-ability">移除能力</button></div>
      <h4>系统 Buff</h4><div class="sf-chip-list">${profile.buffs.map(item => `<span class="sf-chip">${esc(item)}</span>`).join("") || '<span class="sf-muted">暂无 Buff</span>'}</div>
      <div class="sf-row"><button id="sf-add-buff">＋ 添加 Buff</button><button id="sf-remove-buff">移除 Buff</button></div>
    </div>`;
}

function renderTab(bucket, tab, system, root) {
    if (tab === "tasks") return `<div class="sf-card"><div class="sf-row sf-between"><h3>任务中心</h3><button id="sf-add-task">＋ 手动创建任务</button></div>${bucket.tasks.length ? bucket.tasks.map(task => `<div class="sf-list-item"><b>${esc(task.title)}</b><p>${esc(task.description)}</p><div class="sf-progress"><i style="width:${Math.max(0, Math.min(100, task.progress))}%"></i></div><small>${task.progress}% · ${esc(task.status === "completed" ? "已完成" : "进行中")} · 奖励：${task.reward.currency || 0}${esc(bucket.currencyName)} / ${task.reward.attributePoints || 0} 属性点</small><div class="sf-row"><button data-progress="${task.id}">进度 +25%</button>${task.status === "active" && task.progress >= 100 ? `<button data-complete="${task.id}" class="sf-primary">领取奖励</button>` : ""}</div></div>`).join("") : '<p class="sf-muted">暂无任务。AI 可以根据剧情提出任务，等待你确认。</p>'}</div>`;
    if (tab === "profile") return profileEditor(bucket);
    if (tab === "shop") {
        const items = (bucket.shopItems || []).filter(item => !item.systemId || item.systemId === system.id);
        return `<div class="sf-card"><div class="sf-section-heading"><div><h3>${esc(system.name)}商城</h3><p class="sf-muted">价格档位：${({ easy: "简单", normal: "正常", hell: "地狱级" })[bucket.difficulty]} · 当前倍率 ×${priceFactor(bucket)}</p></div><button data-shop-add="${esc(system.id)}">添加商品</button></div>${items.map(item => `<div class="sf-list-item"><b>${esc(item.name)}</b><p>${esc(item.description)}</p><small>${Math.round(item.price * priceFactor(bucket))} ${esc(bucket.currencyName)}</small><button data-buy="${item.id}">购买</button></div>`).join("") || '<p class="sf-muted">暂无商品，可添加自定义商品或等待 AI 提议解锁。</p>'}</div>`;
    }
    if (tab === "bag") return `<div class="sf-card"><h3>系统背包</h3>${bucket.inventory.length ? bucket.inventory.map(item => `<div class="sf-list-item"><b>${esc(item.name)} ×${item.quantity}</b><p>${esc(item.description || "")}</p><small>${esc(item.kind || "道具")} · ${item.duration ? `剩余 ${item.duration}` : ""}</small><button data-use="${item.id}">使用</button></div>`).join("") : '<p class="sf-muted">背包为空。</p>'}</div>`;
    return `<div class="sf-card"><h3>系统记录</h3>${bucket.logs.map(log => `<div class="sf-log">${esc(new Date(log.time).toLocaleString())} · ${esc(log.text)}</div>`).join("") || '<p class="sf-muted">暂无记录。</p>'}</div>`;
}

function attrRow(key, value) {
    return `<div class="sf-attr"><span>${esc(attributeLabel(key))}</span><b>${esc(value)}</b></div>`;
}

function bindTab(bucket, tab, system, root) {
    const box = panel.querySelector("#sf-tab-content");
    if (!box) return;
    const freshBucket = () => {
        const currentRoot = state();
        if (!currentRoot?.systems?.includes(system.id)) return null;
        return ensureSystemBucket(currentRoot, system.id);
    };
    if (tab === "tasks") {
        box.querySelector("#sf-add-task")?.addEventListener("click", async () => {
            const current = freshBucket();
            if (!current) return notify("当前系统已不在选择列表中。", "warning");
            const title = prompt("任务名称？");
            if (!title) return;
            const description = prompt("任务说明？") || "";
            current.tasks.unshift({ id: id(), title, description, status: "active", progress: 0, reward: { currency: 0, attributePoints: 0 }, source: "手动", createdAt: Date.now() });
            await save();
        });
        box.querySelectorAll("[data-progress]").forEach(button => button.onclick = async () => {
            const current = freshBucket();
            if (!current) return;
            const task = current.tasks.find(item => item.id === button.dataset.progress);
            if (!task || task.status !== "active") return;
            task.progress = Math.min(100, task.progress + 25);
            await save();
        });
        box.querySelectorAll("[data-complete]").forEach(button => button.onclick = async () => {
            const current = freshBucket();
            if (!current) return;
            const task = current.tasks.find(item => item.id === button.dataset.complete);
            if (!task || task.progress < 100) return;
            task.status = "completed";
            current.currency += task.reward.currency || 0;
            current.attributePoints += task.reward.attributePoints || 0;
            addLog(current, `完成任务：${task.title}`);
            await save();
        });
    }
    if (tab === "profile") {
        box.querySelector("#sf-refresh-persona")?.addEventListener("click", async () => {
            const current = freshBucket();
            if (!current) return;
            importProfileSources(current);
            await save();
            notify("已刷新当前 User Persona 资料。");
        });
        box.querySelector("#sf-add-ability")?.addEventListener("click", async () => {
            const current = freshBucket();
            if (!current) return;
            const value = String(prompt("能力名称？") || "").trim();
            if (!value) return;
            if (!current.profile.abilities.includes(value)) current.profile.abilities.push(value);
            current.profile.importMeta.manualEdited = true;
            await save();
        });
        box.querySelector("#sf-remove-ability")?.addEventListener("click", async () => {
            const current = freshBucket();
            if (!current) return;
            if (!current.profile.abilities.length) return notify("当前没有可移除的能力。", "info");
            const value = String(prompt(`要移除的能力：\n${current.profile.abilities.join("、")}`) || "").trim();
            if (!value) return;
            current.profile.abilities = current.profile.abilities.filter(item => item !== value);
            current.profile.importMeta.manualEdited = true;
            await save();
        });
        box.querySelector("#sf-add-buff")?.addEventListener("click", async () => {
            const current = freshBucket();
            if (!current) return;
            const value = String(prompt("Buff 名称？") || "").trim();
            if (!value) return;
            if (!current.profile.buffs.includes(value)) current.profile.buffs.push(value);
            current.profile.importMeta.manualEdited = true;
            await save();
        });
        box.querySelector("#sf-remove-buff")?.addEventListener("click", async () => {
            const current = freshBucket();
            if (!current) return;
            if (!current.profile.buffs.length) return notify("当前没有可移除的 Buff。", "info");
            const value = String(prompt(`要移除的 Buff：\n${current.profile.buffs.join("、")}`) || "").trim();
            if (!value) return;
            current.profile.buffs = current.profile.buffs.filter(item => item !== value);
            current.profile.importMeta.manualEdited = true;
            await save();
        });
        box.querySelector("#sf-add-attr").onclick = async () => {
            const current = freshBucket();
            if (!current) return;
            const kind = box.querySelector("#sf-attr-kind").value;
            const key = box.querySelector("#sf-attr-key").value;
            const points = Math.floor(Number(box.querySelector("#sf-attr-points").value));
            if (!Number.isFinite(points) || points < 1) return notify("加点数量必须大于 0。", "warning");
            if (current.attributePoints < points) return notify("可用属性点不足。", "warning");
            if (!(key in current.profile[kind])) return;
            current.attributePoints -= points;
            current.profile[kind][key] += points;
            current.profile.importMeta.manualEdited = true;
            addLog(current, `${attributeLabel(kind)}属性「${attributeLabel(key)}」增加 ${points} 点`);
            await save();
        };
    }
    if (tab === "shop") {
        box.querySelectorAll("[data-shop-add]").forEach(button => button.onclick = async () => {
            const current = freshBucket();
            if (!current) return;
            const name = prompt("商品名称？");
            if (!name) return;
            const description = prompt("商品说明？") || "";
            const price = Math.max(1, Number(prompt("基础价格（未乘难度倍率）？", "20")) || 20);
            current.shopItems.push({ id: id(), systemId: button.dataset.shopAdd, name, description, price });
            await save();
        });
        box.querySelectorAll("[data-buy]").forEach(button => button.onclick = async () => {
            const current = freshBucket();
            if (!current) return;
            const product = current.shopItems.find(item => item.id === button.dataset.buy);
            if (!product) return;
            const cost = Math.ceil(product.price * priceFactor(current));
            if (current.currency < cost) return notify("积分不足。", "warning");
            if (!confirm(`购买 ${product.name}，花费 ${cost}${current.currencyName}？`)) return;
            current.currency -= cost;
            current.inventory.push({ id: id(), name: product.name, description: product.description, quantity: 1, kind: "商城物品" });
            addLog(current, `购买商品：${product.name}`);
            await save();
        });
    }
    if (tab === "bag") {
        box.querySelectorAll("[data-use]").forEach(button => button.onclick = async () => {
            const current = freshBucket();
            if (!current) return;
            const item = current.inventory.find(entry => entry.id === button.dataset.use);
            if (!item) return;
            notify(`已标记使用：${item.name}。具体效果需由剧情和系统设定决定。`, "info");
        });
    }
}

function setModalOpen(open) {
    const modal = document.querySelector("#sf-modal");
    if (!modal) return false;
    modal.classList.toggle("open", open);
    modal.setAttribute("aria-hidden", String(!open));
    document.querySelector("#sf-fab")?.setAttribute("aria-expanded", String(open));
    if (open) render();
    updateSettingsStatus();
    return open;
}

function openManager(source = "unknown") {
    diagnostics.lastOpenedFrom = source;
    if (!mount()) {
        reportError("openManager", new Error("The management shell could not be mounted."));
        return false;
    }
    const s = state();
    uiView = "selection";
    selectionDraft = s?.systems ? [...s.systems] : [];
    selectionMode = selectionDraft.length > 1 ? "multi" : "single";
    return setModalOpen(true);
}

function mount() {
    let root = document.querySelector("#system-flow-root");
    const isComplete = root?.querySelector("#sf-fab")
        && root.querySelector("#sf-modal")
        && root.querySelector("#sf-panel")
        && root.querySelector("#sf-close")
        && root.querySelector("[data-sf-close]")
        && root.dataset.sfVersion === PLUGIN_VERSION;
    if (root && !isComplete) {
        root.remove();
        root = null;
    }
    if (root) {
        panel = root.querySelector("#sf-panel");
        diagnostics.entries.floating = true;
        mountLaunchEntries();
        return true;
    }
    if (!document.body) return false;

    root = document.createElement("div");
    root.id = "system-flow-root";
    root.className = "sf-root";
    root.dataset.sfVersion = PLUGIN_VERSION;
    root.innerHTML = `
      <button id="sf-fab" type="button" aria-label="打开万界系统管理局" aria-controls="sf-modal" aria-expanded="false" title="万界系统管理局">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.2 6.1 17.9 9.8M4 20l4.7-1 10.9-10.9a2.6 2.6 0 0 0-3.7-3.7L5 15.3 4 20Z"/><path d="m13 7.3 3.7 3.7M4 20l4.1-.9"/></svg>
      </button>
      <div id="sf-modal" class="sf-modal" aria-hidden="true">
        <div class="sf-backdrop" data-sf-close></div>
        <section class="sf-window" role="dialog" aria-modal="true" aria-label="万界系统管理局">
          <div class="sf-window-head"><b>万界系统管理局 · System Flow</b><button id="sf-close" type="button" aria-label="关闭">×</button></div>
          <div id="sf-panel"></div>
        </section>
      </div>`;

    root.querySelector("#sf-fab").addEventListener("click", () => {
        const modal = root.querySelector("#sf-modal");
        if (modal.classList.contains("open")) setModalOpen(false);
        else openManager("floating");
    });
    root.querySelector("#sf-close").addEventListener("click", () => setModalOpen(false));
    root.querySelector("[data-sf-close]").addEventListener("click", () => setModalOpen(false));

    panel = root.querySelector("#sf-panel");
    document.body.appendChild(root);
    diagnostics.entries.floating = true;
    render();
    mountLaunchEntries();
    updateSettingsStatus();
    return true;
}

function mountWandEntry() {
    const menu = document.querySelector("#extensionsMenu");
    if (!menu) {
        diagnostics.entries.wand = false;
        return false;
    }

    let entry = document.querySelector(`#${WAND_ENTRY_ID}`);
    if (entry && entry.parentElement !== menu) {
        entry.remove();
        entry = null;
    }
    if (!entry) {
        entry = document.createElement("div");
        entry.id = WAND_ENTRY_ID;
        entry.className = "list-group-item flex-container flexGap5 interactable";
        entry.setAttribute("role", "button");
        entry.setAttribute("tabindex", "0");
        entry.setAttribute("aria-label", "打开万界系统管理局");
        entry.innerHTML = `
          <i class="fa-solid fa-paintbrush extensionsMenuExtensionButton" aria-hidden="true"></i>
          <span>万界系统管理局</span>`;
        menu.append(entry);
    }
    if (entry.dataset.sfBound !== PLUGIN_VERSION) {
        entry.dataset.sfBound = PLUGIN_VERSION;
        entry.addEventListener("click", () => openManager("wand-menu"));
        entry.addEventListener("keydown", event => {
            if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                openManager("wand-menu");
            }
        });
    }
    diagnostics.entries.wand = true;
    return true;
}

function mountSettingsEntry() {
    let drawer = document.querySelector(`#${SETTINGS_DRAWER_ID}`);
    const container = document.querySelector("#extensions_settings2")
        ?? document.querySelector("#extensions_settings");

    if (drawer && drawer.dataset.sfVersion !== PLUGIN_VERSION) {
        drawer.remove();
        drawer = null;
    }
    if (drawer && container && drawer.parentElement !== container) {
        container.append(drawer);
    }
    if (!drawer) {
        if (!container) {
            diagnostics.entries.settings = false;
            return false;
        }
        drawer = document.createElement("div");
        drawer.id = SETTINGS_DRAWER_ID;
        drawer.dataset.sfVersion = PLUGIN_VERSION;
        drawer.innerHTML = `
          <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header" role="button" tabindex="0">
              <b><i class="fa-solid fa-paintbrush system-flow-settings-icon" aria-hidden="true"></i> 万界系统管理局</b>
              <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content">
              <p class="system-flow-settings-copy">系统流控制台入口、运行状态和当前聊天存档诊断。</p>
              <div class="system-flow-status-grid">
                <div><small>插件版本</small><b id="sf-settings-version">${PLUGIN_VERSION}</b></div>
                <div><small>初始化状态</small><b id="sf-settings-init">等待初始化</b></div>
                <div><small>入口状态</small><b id="sf-settings-entries">检测中</b></div>
                <div><small>最近保存</small><b id="sf-settings-last-saved">尚未保存</b></div>
              </div>
              <div class="system-flow-chat-status">
                <small>当前聊天存档</small>
                <b id="sf-settings-chat">检测中</b>
              </div>
              <button id="sf-open-settings-panel" type="button" class="menu_button menu_button_icon">
                <i class="fa-solid fa-up-right-from-square" aria-hidden="true"></i>
                <span>打开系统管理局</span>
              </button>
              <div class="system-flow-error-box">
                <small>最近错误 / 诊断</small>
                <code id="sf-settings-error">暂无错误</code>
              </div>
            </div>
          </div>`;
        container.append(drawer);
    }

    const button = drawer.querySelector("#sf-open-settings-panel");
    if (button && button.dataset.sfBound !== PLUGIN_VERSION) {
        button.dataset.sfBound = PLUGIN_VERSION;
        button.addEventListener("click", () => openManager("extension-settings"));
    }
    const toggle = drawer.querySelector(".inline-drawer-toggle");
    if (toggle && toggle.dataset.sfBound !== PLUGIN_VERSION) {
        toggle.dataset.sfBound = PLUGIN_VERSION;
        toggle.addEventListener("keydown", event => {
            if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                toggle.click();
            }
        });
    }
    diagnostics.entries.settings = true;
    updateSettingsStatus();
    return true;
}

function mountLaunchEntries() {
    mountWandEntry();
    mountSettingsEntry();

    if (diagnostics.entries.wand && diagnostics.entries.settings) {
        entryObserver?.disconnect();
        entryObserver = null;
        clearTimeout(entryObserverTimer);
        entryObserverTimer = null;
        return true;
    }
    if (!entryObserver && document.body) {
        const deadline = Date.now() + 15000;
        entryObserver = new MutationObserver(() => {
            mountWandEntry();
            mountSettingsEntry();
            if ((diagnostics.entries.wand && diagnostics.entries.settings) || Date.now() > deadline) {
                entryObserver?.disconnect();
                entryObserver = null;
                clearTimeout(entryObserverTimer);
                entryObserverTimer = null;
            }
            updateSettingsStatus();
        });
        entryObserver.observe(document.body, { childList: true, subtree: true });
        entryObserverTimer = setTimeout(() => {
            entryObserver?.disconnect();
            entryObserver = null;
            entryObserverTimer = null;
            updateSettingsStatus();
        }, 15000);
    }
    return false;
}

function updateSettingsStatus() {
    const version = document.querySelector("#sf-settings-version");
    const init = document.querySelector("#sf-settings-init");
    const entries = document.querySelector("#sf-settings-entries");
    const chat = document.querySelector("#sf-settings-chat");
    const saved = document.querySelector("#sf-settings-last-saved");
    const error = document.querySelector("#sf-settings-error");
    if (!version || !init || !entries || !chat || !saved || !error) return;

    version.textContent = PLUGIN_VERSION;
    init.textContent = diagnostics.initialized ? "已初始化" : "初始化中";
    entries.textContent = [
        diagnostics.entries.floating ? "悬浮✓" : "悬浮×",
        diagnostics.entries.wand ? "魔法棒✓" : "魔法棒×",
        diagnostics.entries.settings ? "设置✓" : "设置×"
    ].join(" · ");
    saved.textContent = diagnostics.lastSavedAt || "尚未保存";

    const context = ctx();
    if (!context) {
        chat.textContent = "上下文不可用";
    } else if (!context.chatMetadata || typeof context.chatMetadata !== "object") {
        chat.textContent = "chatMetadata 不可用，无法保存聊天数据";
    } else {
        const chatKey = currentChatKey(context);
        if (!chatKey) {
            chat.textContent = "当前没有活动聊天";
        } else {
            const current = context.chatMetadata[META_KEY];
            const systemIds = Array.isArray(current?.systems) ? current.systems : [];
            const taskCount = systemIds.reduce((total, systemId) => {
                const tasks = current?.systemData?.[systemId]?.tasks;
                return total + (Array.isArray(tasks) ? tasks.length : 0);
            }, 0);
            chat.textContent = current
                ? `已绑定：${chatKey} · ${systemIds.length} 个系统 · ${taskCount} 个任务`
                : `等待首次保存：${chatKey}`;
        }
    }
    const eventStatus = Object.entries(diagnostics.events)
        .map(([name, status]) => `${name}:${status}`)
        .join(" · ");
    error.textContent = diagnostics.lastError || (eventStatus ? `事件：${eventStatus}` : "暂无错误");
}

function onChatChanged() {
    panel = document.querySelector("#sf-panel");
    lastProcessedMessageKey = "";
    const s = state();
    selectionDraft = s?.systems ? [...s.systems] : [];
    if (uiView === "custom-create") uiView = "selection";
    if (uiView === "management") ensureManagementSystem(s);
    mountLaunchEntries();
    const modal = document.querySelector("#sf-modal");
    if (modal?.classList.contains("open")) render();
    refreshPrompt();
    updateSettingsStatus();
}

function messageKey(context, index, message) {
    return `${currentChatKey(context) || "no-chat"}:${index}:${message?.swipe_id ?? 0}`;
}

function processMessage(message, key) {
    if (!message || message.is_user || key === lastProcessedMessageKey) return false;
    lastProcessedMessageKey = key;
    const textValue = extractMessageText(message);
    const action = parseAiAction(textValue);
    if (!action) return false;
    const s = state();
    if (!s || !s.active) return false;
    let systemId = s.systems[0];
    if (s.systems.length > 1 && action.systemId) {
        if (!s.systems.includes(String(action.systemId))) {
            console.warn(`${LOG_PREFIX} Ignoring AI action for an inactive system.`, action.systemId);
            return false;
        }
        systemId = String(action.systemId);
    } else if (s.systems.length > 1 && s.systems.includes(managementSystemId)) {
        systemId = managementSystemId;
    }
    if (!systemId) return false;
    action.systemId = systemId;
    const bucket = ensureSystemBucket(s, systemId);
    bucket.pendingAction = action;
    save();
    return true;
}

function onMessageReceived(messageId) {
    const c = ctx();
    const chat = Array.isArray(c?.chat) ? c.chat : [];
    const index = Number.isInteger(messageId) ? messageId : chat.indexOf(messageId);
    const message = index >= 0 ? chat[index] : null;
    if (!message) {
        console.warn(`${LOG_PREFIX} MESSAGE_RECEIVED did not resolve to a chat message.`, { messageId });
        return;
    }
    processMessage(message, messageKey(c, index, message));
}

function onGenerationEnded() {
    // MESSAGE_RECEIVED is the primary path in SillyTavern 1.19.x. Keep this
    // bounded fallback for providers that finish without emitting that event.
    const c = ctx();
    const chat = Array.isArray(c?.chat) ? c.chat : [];
    const index = chat.length - 1;
    const message = index >= 0 ? chat[index] : null;
    if (message && !message.is_user) {
        processMessage(message, messageKey(c, index, message));
    }
    refreshPrompt();
    updateSettingsStatus();
}

function onPersonaChanged() {
    const modal = document.querySelector("#sf-modal");
    if (modal?.classList.contains("open")) render();
    refreshPrompt();
    updateSettingsStatus();
}

function extractMessageText(data, seen = new WeakSet(), depth = 0) {
    if (typeof data === "string") return data;
    if (!data || typeof data !== "object" || depth > 8 || seen.has(data)) return "";
    seen.add(data);
    if (Array.isArray(data)) {
        return data.map(item => extractMessageText(item, seen, depth + 1)).filter(Boolean).join("\n");
    }
    for (const key of ["mes", "message", "text", "content", "raw_mes", "parts"]) {
        const value = data[key];
        if (typeof value === "string") return value;
        if (value && typeof value === "object") {
            const nested = extractMessageText(value, seen, depth + 1);
            if (nested) return nested;
        }
    }
    return "";
}

function registerListener(eventName, handler) {
    const type = event_types?.[eventName];
    if (!type || typeof eventSource?.on !== "function") {
        diagnostics.events[eventName] = type ? "eventSource unavailable" : "event type unavailable";
        console.warn(`${LOG_PREFIX} Optional event is unavailable: ${eventName}`);
        return false;
    }
    if (registeredListeners.has(type)) return true;
    eventSource.on(type, handler);
    registeredListeners.set(type, handler);
    diagnostics.events[eventName] = "registered";
    return true;
}

function scheduleBootstrapRetry() {
    if (bootstrapAttempts >= 20 || bootstrapTimer) return;
    const delay = Math.min(250 + bootstrapAttempts * 100, 2000);
    bootstrapTimer = setTimeout(() => {
        bootstrapTimer = null;
        bootstrapAttempts += 1;
        init(true);
    }, delay);
}

function onAppReady() {
    diagnostics.appReady = true;
    init(true);
    mountLaunchEntries();
    updateSettingsStatus();
}

function init(force = false) {
    if (initialized && !force) {
        mount();
        mountLaunchEntries();
        updateSettingsStatus();
        return true;
    }
    const wasInitialized = initialized;
    try {
        if (!document.body) throw new Error("document.body is not ready.");
        if (!mount()) throw new Error("The management shell could not be mounted.");

        registerListener("APP_READY", onAppReady);
        registerListener("CHAT_CHANGED", onChatChanged);
        registerListener("MESSAGE_RECEIVED", onMessageReceived);
        registerListener("GENERATION_ENDED", onGenerationEnded);
        registerListener("PERSONA_CHANGED", onPersonaChanged);
        registerListener("PERSONA_UPDATED", onPersonaChanged);

        if (!keyboardHandler) {
            keyboardHandler = event => {
                if (event.key === "Escape" && document.querySelector("#sf-modal.open")) {
                    setModalOpen(false);
                }
            };
            document.addEventListener("keydown", keyboardHandler);
        }

        initialized = true;
        diagnostics.initialized = true;
        mountLaunchEntries();
        refreshPrompt();
        updateSettingsStatus();
        if (!wasInitialized) {
            console.info(`${LOG_PREFIX} loaded v${PLUGIN_VERSION} for SillyTavern 1.19.x`, diagnostics.entries);
        }
        return true;
    } catch (error) {
        diagnostics.initialized = false;
        reportError("initialization", error);
        scheduleBootstrapRetry();
        return false;
    }
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => init(), { once: true });
} else {
    init();
}
