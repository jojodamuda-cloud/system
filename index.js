import { eventSource, event_types } from "../../../../script.js";

const EXT = "system_flow";
const META_KEY = "system_flow_v1";
const $ = window.jQuery;

const BUILTIN_SYSTEMS = [
    ["roleplay","扮演角色系统","身份、角色背景、能力与扮演任务",true],
    ["pinduoduo","拼多多系统","拼单、优惠、随机日用品与活动",true],
    ["taobao","淘宝系统","商品搜索、购物、限时活动与隐藏商品",true],
    ["omniverse","万界全能系统","跨世界任务、能力成长与世界适配",true],
    ["dressing","换装系统","服装收集、套装、外观与搭配效果",true],
    ["faith","信仰系统","信仰值、信徒、等级与能力解锁",true],
    ["survival","求生系统","生存目标、资源管理与环境事件",true],
    ["攻略","攻略系统","目标角色关系、剧情节点与互动任务",true],
    ["cultivation","修仙系统","境界、灵根、功法、灵石与修炼",true],
    ["martial","习武系统","训练、体能成长、招式与武学等级",true],
    ["baidu","百度系统","资料检索、知识查询与信息整理",false],
];

const DEFAULT_STATE = () => ({
    version: 1,
    active: false,
    systems: [],
    customSystems: [],
    difficulty: "normal",
    currencyName: "积分",
    currency: 0,
    attributePoints: 0,
    profile: {
        name: "", age: null, gender: "", identity: "",
        body: { strength: 10, speed: 10, constitution: 10, stamina: 10, agility: 10 },
        mind: { iq: 100, memory: 10, observation: 10, learning: 10 },
        abilities: [], buffs: []
    },
    tasks: [],
    inventory: [],
    shopItems: [],
    pendingAction: null,
    shopUnlocks: {},
    logs: [],
    settings: { showChatNotice: true, autoAcceptAiActions: false }
});

let panel, promptTimer;
let activeTab = "tasks";

function ctx() { return window.SillyTavern?.getContext?.() ?? null; }
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
    if (!saved || saved.ownerChatKey !== chatKey) {
        c.chatMetadata[META_KEY] = { ...DEFAULT_STATE(), ownerChatKey: chatKey };
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
        profile: {
            ...d.profile,
            ...(source.profile || {}),
            body: { ...d.profile.body, ...(source.profile?.body || {}) },
            mind: { ...d.profile.mind, ...(source.profile?.mind || {}) },
            abilities: Array.isArray(source.profile?.abilities) ? source.profile.abilities : [],
            buffs: Array.isArray(source.profile?.buffs) ? source.profile.buffs : []
        },
        settings: { ...d.settings, ...(source.settings || {}) }
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
    return merged;
}
async function save() {
    const c = ctx();
    if (c?.saveMetadata) await c.saveMetadata();
    render();
    refreshPrompt();
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
    return [...BUILTIN_SYSTEMS.map(x => ({ id:x[0], name:x[1], description:x[2], shop:x[3], builtin:true })),
        ...(s.customSystems || [])];
}
function activeNames(s) { return (s.systems || []).map(x => allSystems(s).find(y=>y.id===x)?.name || x); }

function addLog(s, text) {
    s.logs.unshift({ id:id(), text, time:new Date().toISOString() });
    s.logs = s.logs.slice(0, 80);
}
function ensureActive(s) {
    if (!s?.active || !s.systems?.length) {
        notify("请先选择并启动至少一个系统。", "warning");
        return false;
    }
    return true;
}

function installPrompt() {
    const c = ctx();
    if (!c?.setExtensionPrompt) return;
    const s = state();
    if (!s?.active) {
        c.setExtensionPrompt(EXT, "", 1, 0, false);
        return;
    }
    const prompt = [
        "【System Flow 系统流规则】",
        `当前启用系统：${activeNames(s).join("、")}。`,
        `当前货币：${s.currencyName}；积分：${s.currency}；可用属性点：${s.attributePoints}。`,
        `当前个人资料：${JSON.stringify(s.profile)}。`,
        `当前任务：${JSON.stringify(s.tasks.map(t=>({id:t.id,title:t.title,status:t.status,description:t.description,reward:t.reward})))}。`,
        "你负责根据用户实际剧情判断是否出现任务、事件、奖励或系统解锁。不得声称插件已执行任何数据变更。",
        "如需请求插件执行数据变更，请在回复末尾附上一个 <SF_ACTION>...</SF_ACTION> JSON 对象。每次最多一个对象。",
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
function renderPendingAction(action) {
    if (!panel || !action) return;
    const safe = esc(JSON.stringify(action, null, 2));
    const holder = panel.querySelector("#sf-ai-pending");
    if (!holder) return;
    holder.innerHTML = `<div class="sf-card sf-pending"><b>AI 提交了一项系统操作提议</b><pre>${safe}</pre><div class="sf-actions"><button id="sf-ai-approve" class="sf-primary">验证并执行</button><button id="sf-ai-dismiss">忽略</button></div></div>`;
    holder.querySelector("#sf-ai-approve").onclick = () => applyAiAction(action);
    holder.querySelector("#sf-ai-dismiss").onclick = async () => {
        const s = state();
        if (s) { s.pendingAction = null; await save(); }
        holder.innerHTML = "";
    };
}
async function applyAiAction(a) {
    const s = state();
    if (!s || !ensureActive(s)) return;
    if (a.type === "task_create") {
        const title = String(a.title || "").trim().slice(0,100);
        if (!title) return notify("任务缺少标题。","error");
        const reward = a.reward || {};
        const currency = Math.max(0, Math.min(1000000, Math.floor(Number(reward.currency)||0)));
        const points = Math.max(0, Math.min(10000, Math.floor(Number(reward.attributePoints)||0)));
        s.tasks.unshift({ id:id(), title, description:String(a.description||"").slice(0,1000),
            status:"active", progress:0, reward:{currency,attributePoints:points}, source:"AI提议", createdAt:Date.now() });
        addLog(s, `新增任务：${title}`);
    } else if (a.type === "task_progress") {
        const t = s.tasks.find(x=>x.id===a.taskId && x.status==="active");
        if (!t) return notify("找不到可更新的进行中任务。","error");
        t.progress = Math.max(0,Math.min(100,Math.floor(Number(a.progress)||0)));
        addLog(s, `任务进度更新：${t.title} ${t.progress}%`);
    } else if (a.type === "task_complete") {
        const t = s.tasks.find(x=>x.id===a.taskId && x.status==="active");
        if (!t) return notify("任务不存在或已经完成。","error");
        if (t.progress < 100) return notify("任务尚未达到100%进度，不能领取奖励。","warning");
        t.status = "completed";
        s.currency += t.reward.currency || 0;
        s.attributePoints += t.reward.attributePoints || 0;
        addLog(s, `任务完成：${t.title}；获得 ${t.reward.currency||0}${s.currencyName}、${t.reward.attributePoints||0} 属性点`);
    } else if (a.type === "event_notice") {
        addLog(s, `系统事件：${String(a.title||"新事件")} — ${String(a.description||"")}`);
    } else if (a.type === "unlock_shop") {
        const sys = allSystems(s).find(x=>x.id===a.systemId);
        if (!sys || !sys.shop) return notify("该系统没有商城，或系统不存在。","error");
        s.shopUnlocks[sys.id] = true;
        addLog(s, `商城已解锁：${sys.name}`);
    } else {
        return notify("不支持的AI操作类型。","error");
    }
    s.pendingAction = null;
    await save();
    notify("AI提议已通过验证并执行。");
}

function systemSelector(s) {
    const items = allSystems(s);
    return `<div class="sf-grid">${items.map(x=>`<label class="sf-system"><input type="checkbox" value="${esc(x.id)}" ${s.systems.includes(x.id)?"checked":""}><span><b>${esc(x.name)}</b><small>${esc(x.description)}</small><em>${x.shop?"含商城":"无商城"}</em></span></label>`).join("")}</div>`;
}
function render() {
    if (!panel) return;
    const s = state();
    if (!s) {
        panel.innerHTML = `<div class="sf-empty">请先打开一个聊天记录，再使用系统流插件。</div>`;
        return;
    }
    const active = s.active && s.systems.length;
    panel.innerHTML = `
      <div class="sf-header"><div><div class="sf-eyebrow">SYSTEM FLOW · MULTIVERSE SYSTEM MANAGER</div><h2>万界系统管理局</h2><small>${active ? "运行中："+esc(activeNames(s).join(" / ")) : "尚未启动系统"}</small></div><span class="sf-status ${active?"on":""}">${active?"运行中":"未启动"}</span></div>
      <div id="sf-ai-pending"></div>
      <section class="sf-card"><h3>系统选择</h3><p class="sf-muted">可同时选择多个系统，也可以随机抽取。</p>${systemSelector(s)}
        <div class="sf-row"><button id="sf-random-one">随机一个</button><button id="sf-random-many">随机两个</button><button id="sf-start" class="sf-primary">启动所选系统</button><button id="sf-stop">暂停系统</button></div>
      </section>
      <section class="sf-card"><h3>自定义系统</h3>
        <div class="sf-form"><input id="sf-custom-name" placeholder="系统名称"><textarea id="sf-custom-desc" placeholder="系统背景、规则、任务机制、特殊能力等"></textarea>
        <label class="sf-inline"><input id="sf-custom-shop" type="checkbox" checked>拥有系统商城</label>
        <label>商城价格档位 <select id="sf-difficulty"><option value="easy" ${s.difficulty==="easy"?"selected":""}>简单（低价）</option><option value="normal" ${s.difficulty==="normal"?"selected":""}>正常</option><option value="hell" ${s.difficulty==="hell"?"selected":""}>地狱级（高价）</option></select></label>
        <button id="sf-create-custom" class="sf-primary">创建并加入系统库</button></div>
        <div class="sf-chip-list">${s.customSystems.map(x=>`<span class="sf-chip">${esc(x.name)}</span>`).join("")||'<span class="sf-muted">尚无自定义系统</span>'}</div>
      </section>
      <div class="sf-tabs"><button data-tab="tasks" class="${activeTab==="tasks"?"active":""}">任务中心</button><button data-tab="profile" class="${activeTab==="profile"?"active":""}">角色档案</button><button data-tab="shop" class="${activeTab==="shop"?"active":""}">系统商城</button><button data-tab="bag" class="${activeTab==="bag"?"active":""}">随身背包</button><button data-tab="logs" class="${activeTab==="logs"?"active":""}">运行日志</button></div>
      <div id="sf-tab-content">${renderTab(s,activeTab)}</div>
      <div class="sf-footer"><span>◆</span> 数据绑定当前聊天　/　切换聊天自动切换存档　<span>◆</span></div>`;
    panel.querySelector("#sf-start").onclick = async () => {
        const chosen = [...panel.querySelectorAll(".sf-system input:checked")].map(x=>x.value);
        if (!chosen.length) return notify("至少选择一个系统。","warning");
        s.systems = chosen; s.active = true; s.difficulty = panel.querySelector("#sf-difficulty").value || s.difficulty;
        addLog(s, `启动系统：${activeNames(s).join("、")}`); await save(); notify("系统已启动。");
    };
    panel.querySelector("#sf-stop").onclick = async () => { s.active=false; await save(); notify("系统已暂停。"); };
    panel.querySelector("#sf-random-one").onclick = () => randomSelect(1);
    panel.querySelector("#sf-random-many").onclick = () => randomSelect(2);
    panel.querySelector("#sf-create-custom").onclick = async () => {
        const name = panel.querySelector("#sf-custom-name").value.trim();
        const description = panel.querySelector("#sf-custom-desc").value.trim();
        if (!name || !description) return notify("请填写系统名称和设定。","warning");
        const custom = { id:`custom_${id()}`, name, description, shop:panel.querySelector("#sf-custom-shop").checked, builtin:false };
        s.customSystems.push(custom); s.difficulty = panel.querySelector("#sf-difficulty").value;
        await save(); notify("自定义系统已加入系统库。");
    };
    panel.querySelectorAll(".sf-tabs button").forEach(b=>b.onclick=()=>{
        activeTab = b.dataset.tab;
        panel.querySelectorAll(".sf-tabs button").forEach(x=>x.classList.toggle("active",x===b));
        panel.querySelector("#sf-tab-content").innerHTML=renderTab(s,activeTab);
        bindTab(s,activeTab);
    });
    bindTab(s,activeTab);
    if (s.pendingAction) renderPendingAction(s.pendingAction);
}
function randomSelect(n) {
    const s=state(); if(!s)return;
    const ids=allSystems(s).map(x=>x.id);
    for (let i = ids.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [ids[i], ids[j]] = [ids[j], ids[i]];
    }
    const shuffled=ids.slice(0,n);
    s.systems=shuffled; s.active=true; addLog(s,`随机抽取：${activeNames(s).join("、")}`);
    save().then(()=>notify(`已随机启动：${activeNames(s).join("、")}`));
}
function renderTab(s, tab) {
    if (tab==="tasks") return `<div class="sf-card"><div class="sf-row sf-between"><h3>任务中心</h3><button id="sf-add-task">＋ 手动创建任务</button></div>${s.tasks.length?s.tasks.map(t=>`<div class="sf-list-item"><b>${esc(t.title)}</b><p>${esc(t.description)}</p><div class="sf-progress"><i style="width:${Math.max(0,Math.min(100,t.progress))}%"></i></div><small>${t.progress}% · ${esc(t.status==="completed"?"已完成":"进行中")} · 奖励：${t.reward.currency||0}${esc(s.currencyName)} / ${t.reward.attributePoints||0}属性点</small><div class="sf-row"><button data-progress="${t.id}">进度+25%</button>${t.status==="active"&&t.progress>=100?`<button data-complete="${t.id}" class="sf-primary">领取奖励</button>`:""}</div></div>`).join(""):'<p class="sf-muted">暂无任务。AI可以根据剧情提出任务，等待你确认。</p>'}</div>`;
    if (tab==="profile") return `<div class="sf-card"><h3>个人资料</h3><div class="sf-stats"><div><small>积分</small><b>${s.currency} ${esc(s.currencyName)}</b></div><div><small>可用属性点</small><b>${s.attributePoints}</b></div></div><div class="sf-form"><input id="sf-name" placeholder="姓名" value="${esc(s.profile.name)}"><input id="sf-age" type="number" min="0" placeholder="年龄" value="${esc(s.profile.age??"")}"><input id="sf-gender" placeholder="性别" value="${esc(s.profile.gender)}"><input id="sf-identity" placeholder="身份" value="${esc(s.profile.identity)}"><button id="sf-save-profile" class="sf-primary">保存资料</button></div><h4>身体属性</h4>${Object.entries(s.profile.body).map(([k,v])=>attrRow(k,v)).join("")}<h4>智力属性</h4>${Object.entries(s.profile.mind).map(([k,v])=>attrRow(k,v)).join("")}<div class="sf-form"><select id="sf-attr-kind"><option value="body">身体属性</option><option value="mind">智力属性</option></select><select id="sf-attr-key">${Object.keys(s.profile.body).map(k=>`<option value="${k}">身体 · ${k}</option>`).join("")}${Object.keys(s.profile.mind).map(k=>`<option value="${k}">智力 · ${k}</option>`).join("")}</select><input id="sf-attr-points" type="number" min="1" value="1"><button id="sf-add-attr" class="sf-primary">消耗属性点加点</button></div><h4>能力与BUFF</h4><p>${[...s.profile.abilities,...s.profile.buffs].map(esc).join("、")||"暂无"}</p></div>`;
    if (tab==="shop") {
        const shops=allSystems(s).filter(x=>x.shop && (s.systems.includes(x.id)) && (x.builtin || s.shopUnlocks[x.id]!==false));
        return `<div class="sf-card"><h3>系统商城</h3><p class="sf-muted">价格档位：${({easy:"简单",normal:"正常",hell:"地狱级"})[s.difficulty]} · 当前倍率 ×${priceFactor(s)}</p>${shops.length?shops.map(x=>`<div class="sf-list-item"><b>${esc(x.name)}商城</b><div class="sf-row"><button data-shop-add="${x.id}">添加自定义商品</button></div><div class="sf-muted">商品由用户配置或后续AI提议，经确认后上架。</div></div>`).join(""):'<p class="sf-muted">当前没有可用商城。百度系统默认不提供商城。</p>'}<h4>当前商品</h4>${(s.shopItems||[]).map(p=>`<div class="sf-list-item"><b>${esc(p.name)}</b><p>${esc(p.description)}</p><small>${Math.round(p.price*priceFactor(s))} ${esc(s.currencyName)}</small><button data-buy="${p.id}">购买</button></div>`).join("")||'<p class="sf-muted">暂无商品，可添加自定义商品。</p>'}</div>`;
    }
    if (tab==="bag") return `<div class="sf-card"><h3>系统背包</h3>${s.inventory.length?s.inventory.map(x=>`<div class="sf-list-item"><b>${esc(x.name)} ×${x.quantity}</b><p>${esc(x.description||"")}</p><small>${esc(x.kind||"道具")} · ${x.duration?`剩余 ${x.duration}`:""}</small><button data-use="${x.id}">使用</button></div>`).join(""):'<p class="sf-muted">背包为空。</p>'}</div>`;
    return `<div class="sf-card"><h3>系统记录</h3>${s.logs.map(x=>`<div class="sf-log">${esc(new Date(x.time).toLocaleString())} · ${esc(x.text)}</div>`).join("")||'<p class="sf-muted">暂无记录。</p>'}</div>`;
}
function attrRow(k,v){return `<div class="sf-attr"><span>${esc(k)}</span><b>${esc(v)}</b></div>`;}
function bindTab(s,tab) {
    const box=panel.querySelector("#sf-tab-content"); if(!box)return;
    if(tab==="tasks"){
        box.querySelector("#sf-add-task")?.addEventListener("click",async()=>{
            const title=prompt("任务名称？"); if(!title)return;
            const description=prompt("任务说明？")||"";
            s.tasks.unshift({id:id(),title,description,status:"active",progress:0,reward:{currency:0,attributePoints:0},source:"手动",createdAt:Date.now()});
            await save();
        });
        box.querySelectorAll("[data-progress]").forEach(b=>b.onclick=async()=>{
            const t=s.tasks.find(x=>x.id===b.dataset.progress); if(!t||t.status!=="active")return;
            t.progress=Math.min(100,t.progress+25); await save();
        });
        box.querySelectorAll("[data-complete]").forEach(b=>b.onclick=async()=>{
            const t=s.tasks.find(x=>x.id===b.dataset.complete); if(!t||t.progress<100)return;
            t.status="completed";s.currency+=t.reward.currency||0;s.attributePoints+=t.reward.attributePoints||0;
            addLog(s,`完成任务：${t.title}`);await save();
        });
    }
    if(tab==="profile"){
        box.querySelector("#sf-save-profile").onclick=async()=>{
            s.profile.name=box.querySelector("#sf-name").value;
            s.profile.age=box.querySelector("#sf-age").value===""?null:Number(box.querySelector("#sf-age").value);
            s.profile.gender=box.querySelector("#sf-gender").value;
            s.profile.identity=box.querySelector("#sf-identity").value;
            await save();
        };
        box.querySelector("#sf-add-attr").onclick=async()=>{
            const kind=box.querySelector("#sf-attr-kind").value,key=box.querySelector("#sf-attr-key").value;
            const n=Math.floor(Number(box.querySelector("#sf-attr-points").value));
            if(!Number.isFinite(n)||n<1)return notify("加点数量必须大于0。","warning");
            if(s.attributePoints<n)return notify("可用属性点不足。","warning");
            if(!(key in s.profile[kind]))return;
            s.attributePoints-=n;s.profile[kind][key]+=n;
            addLog(s,`${kind==="body"?"身体":"智力"}属性 ${key} 增加 ${n} 点`);await save();
        };
    }
    if(tab==="shop"){
        box.querySelectorAll("[data-shop-add]").forEach(b=>b.onclick=async()=>{
            const name=prompt("商品名称？");if(!name)return;
            const description=prompt("商品说明？")||"";
            const base=Math.max(1,Number(prompt("基础价格（未乘难度倍率）？","20"))||20);
            const s2=state();s2.shopItems=s2.shopItems||[];
            s2.shopItems.push({id:id(),systemId:b.dataset.shopAdd,name,description,price:base});
            await save();
        });
        box.querySelectorAll("[data-buy]").forEach(b=>b.onclick=async()=>{
            const p=(s.shopItems||[]).find(x=>x.id===b.dataset.buy);if(!p)return;
            const cost=Math.ceil(p.price*priceFactor(s));
            if(s.currency<cost)return notify("积分不足。","warning");
            if(!confirm(`购买 ${p.name}，花费 ${cost}${s.currencyName}？`))return;
            s.currency-=cost;s.inventory.push({id:id(),name:p.name,description:p.description,quantity:1,kind:"商城物品"});
            addLog(s,`购买商品：${p.name}`);await save();
        });
    }
    if(tab==="bag"){
        box.querySelectorAll("[data-use]").forEach(b=>b.onclick=async()=>{
            const item=s.inventory.find(x=>x.id===b.dataset.use);if(!item)return;
            notify(`已标记使用：${item.name}。具体效果需由剧情和系统设定决定。`,"info");
        });
    }
}

function mount() {
    if (document.querySelector("#system-flow-root")) {
        panel = document.querySelector("#sf-panel");
        return;
    }
    const root = document.createElement("div");
    root.id = "system-flow-root";
    root.className = "sf-root";
    root.innerHTML = `
      <button id="sf-fab" type="button" aria-label="打开万界系统管理局" title="万界系统管理局">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.2 6.1 17.9 9.8M4 20l4.7-1 10.9-10.9a2.6 2.6 0 0 0-3.7-3.7L5 15.3 4 20Z"/><path d="m13 7.3 3.7 3.7M4 20l4.1-.9"/></svg>
      </button>
      <div id="sf-modal" class="sf-modal" aria-hidden="true">
        <div class="sf-backdrop" data-sf-close></div>
        <section class="sf-window" role="dialog" aria-modal="true" aria-label="万界系统管理局">
          <div class="sf-window-head"><b>万界系统管理局 · System Flow</b><button id="sf-close" type="button" aria-label="关闭">×</button></div>
          <div id="sf-panel"></div>
        </section>
      </div>`;
    document.body.appendChild(root);
    panel = root.querySelector("#sf-panel");
    const modal = root.querySelector("#sf-modal");
    root.querySelector("#sf-fab").addEventListener("click", () => {
        modal.classList.add("open"); modal.setAttribute("aria-hidden", "false"); render();
    });
    const close = () => { modal.classList.remove("open"); modal.setAttribute("aria-hidden", "true"); };
    root.querySelector("#sf-close").addEventListener("click", close);
    root.querySelector("[data-sf-close]").addEventListener("click", close);
    document.addEventListener("keydown", e => { if (e.key === "Escape") close(); });
    render();
}
function onChatChanged(){
    panel = document.querySelector("#sf-panel");
    const modal = document.querySelector("#sf-modal");
    if (modal?.classList.contains("open")) render();
    refreshPrompt();
}
function onChatChanged(){ panel=document.querySelector("#sf-panel"); render(); refreshPrompt(); }
function onGenerationEnded() {
    const chat = ctx()?.chat;
    const lastMessage = Array.isArray(chat) ? chat[chat.length - 1] : null;
    if (lastMessage && !lastMessage.is_user) onMessageReceived(lastMessage);
    refreshPrompt();
}
function onMessageReceived(data) {
    const textValue = extractMessageText(data);
    const action = parseAiAction(textValue);
    if (action) {
        const s = state();
        if (!s || !s.active) return;
        s.pendingAction = action;
        save();
    }
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

function init() {
    mount();
    if (!document.querySelector("#system-flow-root")) {
        const observer = new MutationObserver(() => {
            mount();
            if (document.querySelector("#system-flow-root")) observer.disconnect();
        });
        observer.observe(document.body, { childList: true, subtree: true });
    }
    refreshPrompt();
    if (eventSource && event_types?.CHAT_CHANGED) eventSource.on(event_types.CHAT_CHANGED,onChatChanged);
    if (eventSource && event_types?.MESSAGE_RECEIVED) eventSource.on(event_types.MESSAGE_RECEIVED,onMessageReceived);
    if (eventSource && event_types?.GENERATION_ENDED) eventSource.on(event_types.GENERATION_ENDED,onGenerationEnded);
    console.info("[System Flow] loaded");
}
if (document.readyState==="loading") document.addEventListener("DOMContentLoaded",init,{once:true}); else init();
