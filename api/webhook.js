
"use strict";

const crypto = require("crypto");

const CONFIG = {
  BALE_TOKEN: process.env.BALE_BOT_TOKEN || "",
  OPENAI_KEY: process.env.OPENAI_API_KEY || "",
  OPENAI_MODEL: process.env.OPENAI_MODEL || "gpt-4o-mini",
  AI_BASE_URL: (process.env.AI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, ""),
  REDIS_URL: (process.env.UPSTASH_REDIS_REST_URL || "").replace(/\/+$/, ""),
  REDIS_TOKEN: process.env.UPSTASH_REDIS_REST_TOKEN || "",
  WEBHOOK_SECRET: process.env.BALE_WEBHOOK_SECRET || "",
  SETUP_SECRET: process.env.WEBHOOK_SETUP_SECRET || "",
  APP_URL: (process.env.APP_BASE_URL || "").replace(/\/+$/, ""),
  ADMIN_ID: String(process.env.ADMIN_USER_ID || process.env.ADMIN_BALE_USER_ID || ""),
  ADMIN_PASSWORD_1: process.env.ADMIN_PASSWORD_1 || "",
  ADMIN_PASSWORD_2: process.env.ADMIN_PASSWORD_2 || "",
  DAILY_QUOTA: Math.max(1, Number(process.env.DAILY_QUOTA || 20)),
  MONTHLY_QUOTA: Math.max(1, Number(process.env.MONTHLY_QUOTA || 300)),
  POLITICAL_KEYWORDS: process.env.POLITICAL_KEYWORDS || "انتخابات|رئیس جمهور|رئیس‌جمهور|مجلس شورای اسلامی|حزب سیاسی|نامزد انتخاباتی|رقابت انتخاباتی|تبلیغات انتخاباتی|سیاستمدار"
};

const BALE_API = "https://tapi.bale.ai/bot" + CONFIG.BALE_TOKEN;

const KEY = {
  user: id => "user:" + id,
  state: id => "state:" + id,
  username: name => "username:" + name.toLowerCase(),
  context: id => "context:" + id,
  history: id => "history:" + id,
  quotaDay: (id, date) => "quota:day:" + id + ":" + date,
  quotaMonth: (id, month) => "quota:month:" + id + ":" + month,
  adminAuth: id => "admin:auth:" + id,
  failedAdmin: id => "admin:failed:" + id,
  supportGroup: "config:support_group",
  ticket: id => "ticket:" + id,
  ticketSequence: "ticket:sequence",
  tickets: "tickets:all",
  users: "users:all",
  update: id => "processed:update:" + id,
  configDaily: "config:daily_quota",
  configMonthly: "config:monthly_quota",
  botEnabled: "config:bot_enabled",
  userDailyQuota: id => "user:quota:daily:" + id,
  userMonthlyQuota: id => "user:quota:monthly:" + id
};

const MAIN_MENU = [
  [{ text: "💬 گفت‌وگوی جدید", callback_data: "newchat" }],
  [{ text: "📚 تاریخچه گفتگوها", callback_data: "history" }],
  [{ text: "👤 حساب کاربری", callback_data: "account" }],
  [{ text: "🎧 پشتیبانی", callback_data: "support" }],
  [
    { text: "📖 راهنمای ربات", callback_data: "help" },
    { text: "ℹ️ درباره ربات", callback_data: "about" }
  ]
];

const ADMIN_MENU = [
  [
    { text: "📊 آمار ربات", callback_data: "admin:stats" },
    { text: "👥 کاربران", callback_data: "admin:users" }
  ],
  [
    { text: "🎟 سهمیه‌ها", callback_data: "admin:quota" },
    { text: "🎫 تیکت‌ها", callback_data: "admin:tickets" }
  ],
  [
    { text: "📨 پیام همگانی", callback_data: "admin:broadcast" },
    { text: "✉️ پیام خصوصی", callback_data: "admin:private" }
  ],
  [
    { text: "🔌 وضعیت سرویس‌ها", callback_data: "admin:status" },
    { text: "⚙️ تنظیمات", callback_data: "admin:settings" }
  ],
  [{ text: "🔘 روشن / خاموش کردن ربات", callback_data: "admin:togglebot" }],
  [{ text: "🚪 خروج از مدیریت", callback_data: "admin:logout" }]
];

const REPLY_KEYBOARD = {
  keyboard: [[{ text: "🔄 شروع مجدد" }]],
  resize_keyboard: true,
  is_persistent: true
};

function now() {
  return new Date();
}

function dateKey() {
  return now().toISOString().slice(0, 10);
}

function monthKey() {
  return now().toISOString().slice(0, 7);
}

function safeString(value) {
  return value === undefined || value === null ? "" : String(value);
}

function shortText(value, max = 300) {
  const text = safeString(value).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
  return text.length > max ? text.slice(0, max - 1) + "…" : text;
}

function parseBody(body) {
  if (!body) return {};
  if (typeof body === "object") return body;
  try {
    return JSON.parse(body);
  } catch {
    return {};
  }
}

function getRequestUrl(req) {
  try {
    return new URL(req.url, CONFIG.APP_URL || "https://example.invalid");
  } catch {
    return new URL("https://example.invalid");
  }
}

function constantTimeEqual(a, b) {
  const aa = Buffer.from(safeString(a));
  const bb = Buffer.from(safeString(b));
  if (aa.length !== bb.length || !aa.length) return false;
  return crypto.timingSafeEqual(aa, bb);
}

function validFullName(name) {
  const value = safeString(name).trim().replace(/\s+/g, " ");
  return value.length >= 4 && value.length <= 80 && value.split(" ").length >= 2;
}

function validUsername(username) {
  return /^[a-zA-Z][a-zA-Z0-9_]{3,19}$/.test(username);
}

function validPassword(password) {
  return typeof password === "string" && password.length >= 8 && password.length <= 128;
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return { salt, hash };
}

async function redis(...args) {
  if (!CONFIG.REDIS_URL || !CONFIG.REDIS_TOKEN) {
    throw new Error("REDIS_NOT_CONFIGURED");
  }

  const response = await fetch(CONFIG.REDIS_URL, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + CONFIG.REDIS_TOKEN,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(args)
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok || data.error) {
    console.error("REDIS_REQUEST_FAILED", response.status);
    throw new Error("REDIS_REQUEST_FAILED");
  }

  return data.result;
}

async function getJson(key) {
  const value = await redis("GET", key);
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

async function setJson(key, value, ...options) {
  return redis("SET", key, JSON.stringify(value), ...options);
}

async function getState(id) {
  return getJson(KEY.state(id));
}

async function setState(id, state, seconds = 1800) {
  return setJson(KEY.state(id), state, "EX", seconds);
}

async function clearState(id) {
  return redis("DEL", KEY.state(id));
}

async function getUser(id) {
  return getJson(KEY.user(id));
}

async function saveUser(id, user) {
  return setJson(KEY.user(id), user);
}

async function getBotEnabled() {
  const value = await redis("GET", KEY.botEnabled);
  return value !== "0";
}

async function sendBale(method, payload) {
  if (!CONFIG.BALE_TOKEN) {
    throw new Error("BALE_TOKEN_NOT_CONFIGURED");
  }

  const response = await fetch(BALE_API + "/" + method, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok || data.ok === false || data.error) {
    console.error("BALE_API_ERROR", method, response.status);
    throw new Error("BALE_API_REQUEST_FAILED");
  }

  return data;
}

async function sendMessage(chatId, text, options = {}) {
  const payload = {
    chat_id: chatId,
    text: safeString(text)
  };

  if (options.keyboard) {
    payload.reply_markup = options.keyboard;
  }

  if (options.inline) {
    payload.reply_markup = { inline_keyboard: options.inline };
  }

  return sendBale("sendMessage", payload);
}

async function answerCallback(callbackId, text = "") {
  if (!callbackId) return;
  try {
    await sendBale("answerCallbackQuery", {
      callback_query_id: callbackId,
      text: shortText(text, 180),
      show_alert: false
    });
  } catch {}
}

async function mainMenuText(user) {
  const firstName = safeString(user.name).split(/\s+/)[0] || "دوست عزیز";
  return "سلام " + firstName + " عزیز! 🌟\n\n" +
    "به چت جی‌بی‌تی خوش آمدی.\n" +
    "می‌توانی سؤال بپرسی، متن بنویسی، ایده‌هایت را بررسی کنی و از هوش مصنوعی کمک بگیری.\n\n" +
    "از منوی زیر بخش موردنظرت را انتخاب کن. 👇";
}

async function showWelcome(chatId) {
  await sendMessage(
    chatId,
    "سلام! به چت جی‌بی‌تی خوش آمدی. 🌟\n\n" +
    "یک دستیار هوشمند برای گفت‌وگو، یادگیری، نوشتن، ایده‌پردازی و پاسخ به پرسش‌ها.\n\n" +
    "برای استفاده از امکانات ربات، ابتدا حساب کاربری بساز.\n\n" +
    "از کجا شروع کنیم؟",
    {
      keyboard: REPLY_KEYBOARD,
      inline: [
        [
          { text: "📝 ثبت‌نام", callback_data: "register" },
          { text: "📖 راهنما", callback_data: "help" }
        ],
        [{ text: "ℹ️ درباره ربات", callback_data: "about" }]
      ]
    }
  );
}

async function showMainMenu(chatId, user) {
  await sendMessage(chatId, await mainMenuText(user), {
    keyboard: REPLY_KEYBOARD,
    inline: MAIN_MENU
  });
}

async function startCommand(chatId) {
  const user = await getUser(chatId);
  if (user && user.status === "active") {
    return showMainMenu(chatId, user);
  }
  return showWelcome(chatId);
}

async function showHelp(chatId) {
  await sendMessage(
    chatId,
    "📖 راهنمای استفاده از چت جی‌بی‌تی\n\n" +
    "💬 گفت‌وگوی جدید: شروع یک گفت‌وگوی تازه.\n" +
    "📚 تاریخچه: مشاهدهٔ گفتگوهای قبلی.\n" +
    "👤 حساب کاربری: مشاهدهٔ اطلاعات حساب و سهمیه.\n" +
    "🎧 پشتیبانی: ارسال پیام به تیم پشتیبانی.\n\n" +
    "سؤالت را واضح و کامل بنویس تا پاسخ دقیق‌تری دریافت کنی.\n\n" +
    "پاسخ هوش مصنوعی ممکن است اشتباه باشد؛ اطلاعات مهم را بررسی کن.",
    {
      keyboard: REPLY_KEYBOARD,
      inline: [[{ text: "🏠 منوی اصلی", callback_data: "main" }]]
    }
  );
}

async function showAbout(chatId) {
  await sendMessage(
    chatId,
    "ℹ️ درباره چت جی‌بی‌تی\n\n" +
    "چت جی‌بی‌تی یک ربات گفت‌وگوی هوشمند در پیام‌رسان بله است.\n\n" +
    "✨ امکانات:\n" +
    "• گفت‌وگو با هوش مصنوعی\n" +
    "• تاریخچه گفتگوها\n" +
    "• حساب کاربری و سهمیه مصرف\n" +
    "• پشتیبانی از طریق ثبت تیکت",
    {
      keyboard: REPLY_KEYBOARD,
      inline: [[{ text: "🏠 منوی اصلی", callback_data: "main" }]]
    }
  );
}

async function beginRegistration(chatId) {
  const existing = await getUser(chatId);

  if (existing && existing.status === "active") {
    await sendMessage(
      chatId,
      "حساب کاربری تو از قبل ساخته شده است. نیازی به ثبت‌نام دوباره نیست. ✅",
      {
        keyboard: REPLY_KEYBOARD,
        inline: [[{ text: "🏠 منوی اصلی", callback_data: "main" }]]
      }
    );
    return;
  }

  await setState(chatId, {
    flow: "registration",
    step: "name",
    data: {}
  });

  await sendMessage(
    chatId,
    "📝 ثبت‌نام در چت جی‌بی‌تی\n\n" +
    "مرحله ۱ از ۴\n" +
    "لطفاً نام و نام خانوادگی خود را وارد کن.\n\n" +
    "برای انصراف، «لغو» را بفرست."
  );
}

async function releaseUsername(username, chatId) {
  if (!username) return;
  const key = KEY.username(username);
  const current = await redis("GET", key).catch(() => null);
  if (current === "pending:" + chatId) {
    await redis("DEL", key).catch(() => null);
  }
}

async function cancelRegistration(chatId, state) {
  if (state?.data?.username) {
    await releaseUsername(state.data.username, chatId);
  }

  await clearState(chatId);
  const user = await getUser(chatId);

  if (user && user.status === "active") {
    await sendMessage(
      chatId,
      "عملیات لغو شد. حساب کاربری و تاریخچه‌ات محفوظ است. ✅",
      {
        keyboard: REPLY_KEYBOARD,
        inline: MAIN_MENU
      }
    );
  } else {
    await sendMessage(
      chatId,
      "ثبت‌نام لغو شد. هر زمان آماده بودی، می‌توانی دوباره شروع کنی.",
      {
        keyboard: REPLY_KEYBOARD,
        inline: [[{ text: "📝 شروع ثبت‌نام", callback_data: "register" }]]
      }
    );
  }
}

async function handleRegistration(chatId, text, state) {
  const data = state.data || {};

  if (state.step === "name") {
    const name = safeString(text).trim().replace(/\s+/g, " ");

    if (!validFullName(name)) {
      await sendMessage(chatId, "لطفاً نام و نام خانوادگی را کامل وارد کن؛ مثلاً «علی رضایی».");
      return;
    }

    data.name = name;

    await setState(chatId, {
      flow: "registration",
      step: "username",
      data
    });

    await sendMessage(
      chatId,
      "مرحله ۲ از ۴\n" +
      "یک نام کاربری انگلیسی انتخاب کن.\n\n" +
      "• با حرف انگلیسی شروع شود.\n" +
      "• فقط حروف انگلیسی، عدد و زیرخط مجاز است.\n" +
      "• بین ۴ تا ۲۰ نویسه باشد.\n\n" +
      "مثال: ali_reza24"
    );
    return;
  }

  if (state.step === "username") {
    const username = safeString(text).trim().replace(/^@/, "");

    if (!validUsername(username)) {
      await sendMessage(chatId, "نام کاربری معتبر نیست. یک نام انگلیسی با ۴ تا ۲۰ نویسه وارد کن.");
      return;
    }

    const userKey = KEY.username(username);
    const existing = await redis("GET", userKey);

    if (existing && existing !== "pending:" + chatId && existing !== String(chatId)) {
      await sendMessage(chatId, "این نام کاربری قبلاً انتخاب شده است. لطفاً نام دیگری وارد کن.");
      return;
    }

    const reservation = await redis("SET", userKey, "pending:" + chatId, "EX", 1800, "NX");

    if (reservation !== "OK" && existing !== "pending:" + chatId && existing !== String(chatId)) {
      await sendMessage(chatId, "این نام کاربری در حال استفاده است. لطفاً نام دیگری انتخاب کن.");
      return;
    }

    data.username = username;

    await setState(chatId, {
      flow: "registration",
      step: "password",
      data
    });

    await sendMessage(
      chatId,
      "مرحله ۳ از ۴\n" +
      "یک رمز عبور انتخاب کن.\n\n" +
      "رمز باید حداقل ۸ نویسه داشته باشد."
    );
    return;
  }

  if (state.step === "password") {
    if (!validPassword(text)) {
      await sendMessage(chatId, "رمز عبور باید حداقل ۸ و حداکثر ۱۲۸ نویسه داشته باشد.");
      return;
    }

    data.password = hashPassword(text);

    await setState(chatId, {
      flow: "registration",
      step: "confirm",
      data
    });

    await sendMessage(
      chatId,
      "مرحله ۴ از ۴ — تأیید اطلاعات\n\n" +
      "👤 نام: " + data.name + "\n" +
      "🔑 نام کاربری: @" + data.username + "\n" +
      "🔒 رمز عبور: به‌صورت هش ذخیره می‌شود\n\n" +
      "اگر اطلاعات درست است، ثبت‌نام را نهایی کن.",
      {
        inline: [
          [{ text: "✅ تأیید و ساخت حساب", callback_data: "confirm_reg" }],
          [{ text: "❌ لغو ثبت‌نام", callback_data: "cancel_reg" }]
        ]
      }
    );
  }
}

async function finishRegistration(chatId) {
  const state = await getState(chatId);

  if (!state || state.flow !== "registration" || state.step !== "confirm") {
    await sendMessage(chatId, "مرحله ثبت‌نام پیدا نشد. لطفاً از ابتدا شروع کن.");
    return;
  }

  const data = state.data || {};

  if (!data.name || !data.username || !data.password) {
    await clearState(chatId);
    await sendMessage(chatId, "اطلاعات ثبت‌نام کامل نیست. لطفاً دوباره ثبت‌نام کن.");
    return;
  }

  const userKey = KEY.username(data.username);
  const reserved = await redis("GET", userKey);

  if (reserved && reserved !== "pending:" + chatId && reserved !== String(chatId)) {
    await clearState(chatId);
    await sendMessage(chatId, "این نام کاربری دیگر در دسترس نیست. ثبت‌نام را دوباره انجام بده.");
    return;
  }

  const user = {
    id: String(chatId),
    name: data.name,
    username: data.username,
    password: data.password,
    status: "active",
    createdAt: now().toISOString(),
    lastActiveAt: now().toISOString()
  };

  await saveUser(chatId, user);
  await redis("SET", userKey, String(chatId));
  await redis("SADD", KEY.users, String(chatId));
  await clearState(chatId);
  await redis("DEL", KEY.context(chatId));

  await sendMessage(
    chatId,
    "🎉 ثبت‌نام با موفقیت انجام شد!\n\n" +
    "حساب کاربری تو آماده است. اطلاعات ورودت را محرمانه نگه دار.",
    {
      keyboard: REPLY_KEYBOARD,
      inline: MAIN_MENU
    }
  );
}

async function requireUser(chatId) {
  const user = await getUser(chatId);

  if (!user || user.status !== "active") {
    await sendMessage(
      chatId,
      "برای استفاده از این بخش، ابتدا باید حساب کاربری بسازی. 📝",
      {
        keyboard: REPLY_KEYBOARD,
        inline: [[{ text: "📝 ثبت‌نام", callback_data: "register" }]]
      }
    );
    return null;
  }

  user.lastActiveAt = now().toISOString();
  await saveUser(chatId, user);
  return user;
}

async function getQuotaLimit(kind) {
  const key = kind === "daily" ? KEY.configDaily : KEY.configMonthly;
  const fallback = kind === "daily" ? CONFIG.DAILY_QUOTA : CONFIG.MONTHLY_QUOTA;
  const saved = await redis("GET", key);
  const value = Number(saved);

  return Number.isFinite(value) && value > 0 ? value : fallback;
}

async function getEffectiveQuota(chatId, kind) {
  const userKey = kind === "daily"
    ? KEY.userDailyQuota(chatId)
    : KEY.userMonthlyQuota(chatId);

  const personal = await redis("GET", userKey);

  if (personal !== null && personal !== "") {
    const value = Number(personal);
    if (Number.isFinite(value) && value >= 0) return value;
  }

  return getQuotaLimit(kind);
}

async function getQuotaUsage(chatId) {
  const day = Number((await redis("GET", KEY.quotaDay(chatId, dateKey()))) || 0);
  const month = Number((await redis("GET", KEY.quotaMonth(chatId, monthKey()))) || 0);
  const dailyLimit = await getEffectiveQuota(chatId, "daily");
  const monthlyLimit = await getEffectiveQuota(chatId, "monthly");

  return {
    day,
    month,
    dailyLimit,
    monthlyLimit,
    dailyLeft: Math.max(0, dailyLimit - day),
    monthlyLeft: Math.max(0, monthlyLimit - month)
  };
}

async function consumeQuota(chatId) {
  const day = KEY.quotaDay(chatId, dateKey());
  const month = KEY.quotaMonth(chatId, monthKey());
  const dailyLimit = await getEffectiveQuota(chatId, "daily");
  const monthlyLimit = await getEffectiveQuota(chatId, "monthly");

  const script = `
    local d = tonumber(redis.call("GET", KEYS[1]) or "0")
    local m = tonumber(redis.call("GET", KEYS[2]) or "0")
    local dl = tonumber(ARGV[1])
    local ml = tonumber(ARGV[2])

    if d >= dl then return {0, d, m} end
    if m >= ml then return {0, d, m} end

    d = redis.call("INCR", KEYS[1])
    m = redis.call("INCR", KEYS[2])

    redis.call("EXPIRE", KEYS[1], 172800)
    redis.call("EXPIRE", KEYS[2], 3456000)

    return {1, d, m}
  `;

  const result = await redis("EVAL", script, 2, day, month, dailyLimit, monthlyLimit);

  return {
    allowed: Number(result?.[0]) === 1,
    day: Number(result?.[1] || 0),
    month: Number(result?.[2] || 0)
  };
}

async function refundQuota(chatId) {
  const day = KEY.quotaDay(chatId, dateKey());
  const month = KEY.quotaMonth(chatId, monthKey());

  const script = `
    local d = tonumber(redis.call("GET", KEYS[1]) or "0")
    local m = tonumber(redis.call("GET", KEYS[2]) or "0")
    if d > 0 then redis.call("DECR", KEYS[1]) end
    if m > 0 then redis.call("DECR", KEYS[2]) end
    return 1
  `;

  await redis("EVAL", script, 2, day, month);
}

function isPoliticalRequest(text) {
  try {
    return new RegExp(CONFIG.POLITICAL_KEYWORDS, "i").test(safeString(text));
  } catch {
    return false;
  }
}

async function getContext(chatId) {
  const context = await getJson(KEY.context(chatId));
  return Array.isArray(context) ? context : [];
}

async function saveContext(chatId, context) {
  return setJson(KEY.context(chatId), context.slice(-12));
}

async function saveHistory(chatId, userText, assistantText) {
  const record = {
    time: now().toISOString(),
    user: shortText(userText, 2000),
    assistant: shortText(assistantText, 3000)
  };

  await redis("LPUSH", KEY.history(chatId), JSON.stringify(record));
  await redis("LTRIM", KEY.history(chatId), 0, 49);
}

async function callAI(chatId, userText) {
  if (!CONFIG.OPENAI_KEY) {
    throw new Error("OPENAI_KEY_NOT_CONFIGURED");
  }

  const context = await getContext(chatId);

  const messages = [
    {
      role: "system",
      content: "تو یک دستیار فارسی‌زبان دقیق، محترمانه و مفید هستی. پاسخ را متناسب با سؤال کاربر بده. اگر چیزی را نمی‌دانی، صادقانه بگو. اطلاعات ساختگی را به‌عنوان واقعیت ارائه نکن. پاسخ‌ها را روشن و منظم بنویس. اگر کاربر فارسی می‌نویسد، فارسی پاسخ بده."
    },
    ...context,
    { role: "user", content: userText }
  ];

  const response = await fetch(CONFIG.AI_BASE_URL + "/chat/completions", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + CONFIG.OPENAI_KEY,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: CONFIG.OPENAI_MODEL,
      messages,
      temperature: 0.7
    })
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    console.error("AI_REQUEST_FAILED", response.status, data.error?.type || "unknown");

    if (response.status === 401) throw new Error("OPENAI_AUTH_ERROR");
    if (response.status === 429) throw new Error("OPENAI_QUOTA_ERROR");

    throw new Error("OPENAI_REQUEST_ERROR");
  }

  const answer = data.choices?.[0]?.message?.content;

  if (!answer || typeof answer !== "string") {
    throw new Error("OPENAI_EMPTY_RESPONSE");
  }

  const updated = [
    ...context,
    { role: "user", content: userText },
    { role: "assistant", content: answer }
  ];

  await saveContext(chatId, updated);
  await saveHistory(chatId, userText, answer);

  return answer;
}

async function handleAIChat(chatId, text) {
  const user = await requireUser(chatId);
  if (!user) return;

  const userText = safeString(text).trim();

  if (!userText) {
    await sendMessage(chatId, "پیامت خالی است. لطفاً سؤال یا درخواستت را بنویس.");
    return;
  }

  if (userText.length > 6000) {
    await sendMessage(chatId, "پیامت خیلی طولانی است. لطفاً آن را کوتاه‌تر کن و دوباره بفرست.");
    return;
  }

  if (isPoliticalRequest(userText)) {
    await sendMessage(
      chatId,
      "متأسفم، طبق تنظیمات فعلی این ربات، درخواست‌های سیاسی پردازش نمی‌شوند.\n\n" +
      "می‌توانی سؤال دیگری درباره یادگیری، نوشتن، فناوری، علوم یا موضوعات عمومی مطرح کنی."
    );
    return;
  }

  const quota = await getQuotaUsage(chatId);

  if (quota.dailyLeft <= 0 || quota.monthlyLeft <= 0) {
    await sendMessage(
      chatId,
      "⏳ سهمیه استفاده از هوش مصنوعی به پایان رسیده است.\n\n" +
      "سهمیه روزانه باقی‌مانده: " + quota.dailyLeft + "\n" +
      "سهمیه ماهانه باقی‌مانده: " + quota.monthlyLeft
    );
    return;
  }

  const consumed = await consumeQuota(chatId);

  if (!consumed.allowed) {
    await sendMessage(chatId, "⏳ سهمیه استفاده از هوش مصنوعی به پایان رسیده است.");
    return;
  }

  await sendMessage(chatId, "⏳ درخواستت دریافت شد؛ دارم آن را بررسی می‌کنم…");

  try {
    const answer = await callAI(chatId, userText);
    const latestQuota = await getQuotaUsage(chatId);

    await sendMessage(
      chatId,
      answer + "\n\n" +
      "━━━━━━━━━━━━━━\n" +
      "📊 سهمیه باقی‌مانده امروز: " + latestQuota.dailyLeft + "\n" +
      "📅 سهمیه باقی‌مانده این ماه: " + latestQuota.monthlyLeft,
      { keyboard: REPLY_KEYBOARD }
    );
  } catch (error) {
    await refundQuota(chatId);
    console.error("AI_CHAT_FAILED", error.message);

    let message = "متأسفانه درخواست کامل نشد. کمی بعد دوباره تلاش کن.";

    if (error.message === "OPENAI_KEY_NOT_CONFIGURED") {
      message = "سرویس هوش مصنوعی پیکربندی نشده است. مدیر باید OPENAI_API_KEY را در Vercel تنظیم کند.";
    } else if (error.message === "OPENAI_AUTH_ERROR") {
      message = "کلید API معتبر نیست یا سرویس آن را نپذیرفته است. مدیر باید تنظیمات API را بررسی کند.";
    } else if (error.message === "OPENAI_QUOTA_ERROR") {
      message = "سرویس API درخواست را نپذیرفت؛ ممکن است اعتبار یا محدودیت درخواست مشکل داشته باشد.";
    }

    await sendMessage(chatId, message, { keyboard: REPLY_KEYBOARD });
  }
}

async function showHistory(chatId) {
  const user = await requireUser(chatId);
  if (!user) return;

  const records = await redis("LRANGE", KEY.history(chatId), 0, 9);

  if (!Array.isArray(records) || records.length === 0) {
    await sendMessage(
      chatId,
      "📚 هنوز گفت‌وگویی در تاریخچه ثبت نشده است.",
      {
        keyboard: REPLY_KEYBOARD,
        inline: [[{ text: "💬 شروع گفت‌وگوی جدید", callback_data: "newchat" }]]
      }
    );
    return;
  }

  const lines = ["📚 تاریخچه گفت‌وگوهای اخیر", ""];

  for (let i = 0; i < records.length; i++) {
    try {
      const item = JSON.parse(records[i]);
      const date = new Date(item.time).toLocaleString("fa-IR", {
        timeZone: "Asia/Tehran"
      });

      lines.push(
        (i + 1) + ". 🕒 " + date,
        "🧑 درخواست: " + shortText(item.user, 170),
        "🤖 پاسخ: " + shortText(item.assistant, 220),
        ""
      );
    } catch {}
  }

  await sendMessage(chatId, lines.join("\n"), {
    keyboard: REPLY_KEYBOARD,
    inline: [
      [{ text: "💬 گفت‌وگوی جدید", callback_data: "newchat" }],
      [{ text: "🏠 منوی اصلی", callback_data: "main" }]
    ]
  });
}

async function showAccount(chatId) {
  const user = await requireUser(chatId);
  if (!user) return;

  const quota = await getQuotaUsage(chatId);

  await sendMessage(
    chatId,
    "👤 حساب کاربری تو\n\n" +
    "نام: " + user.name + "\n" +
    "نام کاربری: @" + user.username + "\n" +
    "شناسه: " + user.id + "\n" +
    "وضعیت: " + (user.status === "active" ? "فعال ✅" : "غیرفعال") + "\n" +
    "تاریخ ثبت‌نام: " +
    new Date(user.createdAt).toLocaleDateString("fa-IR", {
      timeZone: "Asia/Tehran"
    }) +
    "\n\n" +
    "📊 سهمیه\n" +
    "مصرف امروز: " + quota.day + " از " + quota.dailyLimit + "\n" +
    "باقی‌مانده امروز: " + quota.dailyLeft + "\n" +
    "مصرف این ماه: " + quota.month + " از " + quota.monthlyLimit + "\n" +
    "باقی‌مانده این ماه: " + quota.monthlyLeft + "\n\n" +
    "🔐 رمز عبور نمایش داده نمی‌شود.",
    {
      keyboard: REPLY_KEYBOARD,
      inline: [[{ text: "🏠 منوی اصلی", callback_data: "main" }]]
    }
  );
}

async function beginSupport(chatId) {
  const user = await requireUser(chatId);
  if (!user) return;

  const groupId = await redis("GET", KEY.supportGroup);

  if (!groupId) {
    await sendMessage(
      chatId,
      "🎧 گروه پشتیبانی هنوز توسط مدیر راه‌اندازی نشده است.",
      { keyboard: REPLY_KEYBOARD }
    );
    return;
  }

  await setState(chatId, {
    flow: "support",
    step: "message"
  });

  await sendMessage(chatId, "🎧 مشکل یا سؤال خود را بنویس.\n\nبرای انصراف، «لغو» را بفرست.");
}

async function createTicket(chatId, text) {
  const user = await getUser(chatId);
  const groupId = await redis("GET", KEY.supportGroup);

  if (!groupId) {
    await clearState(chatId);
    await sendMessage(chatId, "گروه پشتیبانی تنظیم نشده است؛ تیکت ارسال نشد.");
    return;
  }

  const id = await redis("INCR", KEY.ticketSequence);

  const ticket = {
    id: String(id),
    userId: String(chatId),
    name: user?.name || "کاربر",
    username: user?.username || "",
    text: shortText(text, 3000),
    status: "open",
    createdAt: now().toISOString(),
    updatedAt: now().toISOString(),
    replies: []
  };

  await setJson(KEY.ticket(id), ticket);
  await redis("LPUSH", KEY.tickets, String(id));
  await redis("LTRIM", KEY.tickets, 0, 499);
  await clearState(chatId);

  try {
    await sendMessage(
      groupId,
      "🎫 تیکت جدید\n\n" +
      "شماره: #" + id + "\n" +
      "نام: " + ticket.name + "\n" +
      "نام کاربری: @" + (ticket.username || "ثبت نشده") + "\n" +
      "شناسه: " + ticket.userId + "\n\n" +
      "پیام:\n" + ticket.text
    );
  } catch (error) {
    console.error("SUPPORT_GROUP_SEND_FAILED", error.message);
    ticket.status = "delivery_error";
    await setJson(KEY.ticket(id), ticket);
    await sendMessage(chatId, "تیکت ساخته شد، اما اعلان گروه ارسال نشد.");
    return;
  }

  await sendMessage(
    chatId,
    "✅ پیام تو برای پشتیبانی ارسال شد.\nشماره پیگیری: #" + id,
    {
      keyboard: REPLY_KEYBOARD,
      inline: [[{ text: "🏠 منوی اصلی", callback_data: "main" }]]
    }
  );
}

async function isAdminAuthenticated(id) {
  if (String(id) !== CONFIG.ADMIN_ID || !CONFIG.ADMIN_ID) return false;
  const value = await redis("GET", KEY.adminAuth(id));
  return value === "1";
}

async function beginAdminLogin(chatId) {
  if (String(chatId) !== CONFIG.ADMIN_ID || !CONFIG.ADMIN_ID) return;

  const failures = Number((await redis("GET", KEY.failedAdmin(chatId))) || 0);

  if (failures >= 8) {
    await sendMessage(chatId, "ورود مدیریت موقتاً محدود شده است. بعداً دوباره تلاش کن.");
    return;
  }

  await setState(chatId, {
    flow: "admin_login",
    step: "password1"
  });

  await sendMessage(chatId, "🔐 رمز عبور اول مدیریت را وارد کن.");
}

async function handleAdminLogin(chatId, text, state) {
  if (String(chatId) !== CONFIG.ADMIN_ID) {
    await clearState(chatId);
    return;
  }

  if (state.step === "password1") {
    if (!CONFIG.ADMIN_PASSWORD_1 || !constantTimeEqual(text, CONFIG.ADMIN_PASSWORD_1)) {
      const n = await redis("INCR", KEY.failedAdmin(chatId));
      await redis("EXPIRE", KEY.failedAdmin(chatId), 3600);
      await clearState(chatId);
      await sendMessage(chatId, "❌ رمز اول نادرست است.");
      console.error("ADMIN_LOGIN_FAILED", n);
      return;
    }

    await setState(chatId, {
      flow: "admin_login",
      step: "password2"
    });

    await sendMessage(chatId, "مرحله اول تأیید شد. رمز دوم را وارد کن.");
    return;
  }

  if (state.step === "password2") {
    if (!CONFIG.ADMIN_PASSWORD_2 || !constantTimeEqual(text, CONFIG.ADMIN_PASSWORD_2)) {
      const n = await redis("INCR", KEY.failedAdmin(chatId));
      await redis("EXPIRE", KEY.failedAdmin(chatId), 3600);
      await clearState(chatId);
      await sendMessage(chatId, "❌ رمز دوم نادرست است.");
      console.error("ADMIN_LOGIN_FAILED", n);
      return;
    }

    await redis("SET", KEY.adminAuth(chatId), "1", "EX", 1800);
    await redis("DEL", KEY.failedAdmin(chatId));
    await clearState(chatId);
    await showAdminMenu(chatId);
  }
}

async function showAdminMenu(chatId) {
  await sendMessage(
    chatId,
    "🛡 پنل مدیریت چت جی‌بی‌تی\n\nیک بخش را انتخاب کن.",
    {
      keyboard: REPLY_KEYBOARD,
      inline: ADMIN_MENU
    }
  );
}

async function showAdminStats(chatId) {
  if (!(await isAdminAuthenticated(chatId))) return;

  const users = Number((await redis("SCARD", KEY.users)) || 0);
  const ticketIds = await redis("LRANGE", KEY.tickets, 0, 499);

  let open = 0;
  let closed = 0;
  let deliveryError = 0;

  if (Array.isArray(ticketIds)) {
    for (const id of ticketIds) {
      const ticket = await getJson(KEY.ticket(id));
      if (ticket?.status === "open") open++;
      else if (ticket?.status === "closed") closed++;
      else if (ticket?.status === "delivery_error") deliveryError++;
    }
  }

  await sendMessage(
    chatId,
    "📊 آمار ربات\n\n" +
    "👥 کاربران ثبت‌نام‌شده: " + users + "\n" +
    "🎫 تیکت‌های باز: " + open + "\n" +
    "✅ تیکت‌های بسته‌شده: " + closed + "\n" +
    "⚠️ خطای ارسال تیکت: " + deliveryError,
    {
      keyboard: REPLY_KEYBOARD,
      inline: [[{ text: "⬅️ بازگشت به مدیریت", callback_data: "admin:menu" }]]
    }
  );
}

async function showAdminUsers(chatId) {
  if (!(await isAdminAuthenticated(chatId))) return;

  const ids = await redis("SMEMBERS", KEY.users);
  const users = [];

  if (Array.isArray(ids)) {
    for (const id of ids.slice(-15).reverse()) {
      const user = await getUser(id);
      if (user) {
        users.push(
          "• " + user.name + " — @" + user.username +
          "\nشناسه: " + id +
          " | وضعیت: " + user.status
        );
      }
    }
  }

  await sendMessage(
    chatId,
    "👥 کاربران ثبت‌نام‌شده\n\n" +
    (users.length ? users.join("\n\n") : "هنوز کاربری ثبت‌نام نکرده است.") +
    "\n\nبرای جست‌وجوی کاربر، شناسه یا نام کاربری او را بفرست.",
    {
      keyboard: REPLY_KEYBOARD,
      inline: [
        [{ text: "🔎 جست‌وجوی کاربر", callback_data: "admin:searchuser" }],
        [{ text: "⬅️ بازگشت به مدیریت", callback_data: "admin:menu" }]
      ]
    }
  );
}

async function showAdminUser(chatId, targetId) {
  if (!(await isAdminAuthenticated(chatId))) return;

  const user = await getUser(targetId);

  if (!user) {
    await sendMessage(chatId, "کاربری با این مشخصات پیدا نشد.");
    return;
  }

  const quota = await getQuotaUsage(targetId);

  await sendMessage(
    chatId,
    "👤 اطلاعات کاربر\n\n" +
    "نام: " + user.name + "\n" +
    "نام کاربری: @" + user.username + "\n" +
    "شناسه: " + user.id + "\n" +
    "وضعیت: " + user.status + "\n" +
    "ثبت‌نام: " + user.createdAt + "\n" +
    "آخرین فعالیت: " + (user.lastActiveAt || "نامشخص") + "\n\n" +
    "مصرف امروز: " + quota.day + " از " + quota.dailyLimit + "\n" +
    "مصرف ماه: " + quota.month + " از " + quota.monthlyLimit + "\n\n" +
    "رمز عبور نمایش داده نمی‌شود.",
    {
      keyboard: REPLY_KEYBOARD,
      inline: [
        [{
          text: user.status === "blocked" ? "🔓 رفع مسدودسازی" : "🚫 مسدودسازی کاربر",
          callback_data: "admin:block:" + targetId
        }],
        [{
          text: "✉️ ارسال پیام خصوصی",
          callback_data: "admin:privateuser:" + targetId
        }],
        [{
          text: "🎟 تنظیم سهمیه اختصاصی",
          callback_data: "admin:userquota:" + targetId
        }],
        [{
          text: "🔄 صفرکردن مصرف",
          callback_data: "admin:resetquota:" + targetId
        }],
        [{
          text: "⬅️ بازگشت به کاربران",
          callback_data: "admin:users"
        }]
      ]
    }
  );
}

async function toggleUserBlock(chatId, targetId) {
  if (!(await isAdminAuthenticated(chatId))) return;

  if (String(targetId) === CONFIG.ADMIN_ID) {
    await sendMessage(chatId, "امکان مسدودکردن مدیر اصلی وجود ندارد.");
    return;
  }

  const user = await getUser(targetId);

  if (!user) {
    await sendMessage(chatId, "کاربر پیدا نشد.");
    return;
  }

  user.status = user.status === "blocked" ? "active" : "blocked";
  await saveUser(targetId, user);

  await sendMessage(
    chatId,
    user.status === "blocked" ? "🚫 کاربر مسدود شد." : "✅ مسدودسازی کاربر برداشته شد.",
    {
      keyboard: REPLY_KEYBOARD,
      inline: [[{ text: "👤 مشاهده کاربر", callback_data: "admin:user:" + targetId }]]
    }
  );
}

async function showAdminQuota(chatId) {
  if (!(await isAdminAuthenticated(chatId))) return;

  const daily = await getQuotaLimit("daily");
  const monthly = await getQuotaLimit("monthly");

  await sendMessage(
    chatId,
    "🎟 مدیریت سهمیه‌ها\n\n" +
    "سهمیه روزانه همگانی: " + daily + "\n" +
    "سهمیه ماهانه همگانی: " + monthly + "\n\n" +
    "برای تغییر سهمیه روزانه بنویس:\nروزانه 25\n\n" +
    "برای تغییر سهمیه ماهانه بنویس:\nماهانه 400\n\n" +
    "برای تنظیم سهمیه یک کاربر، شناسه او را همراه مقدار بفرست.",
    {
      keyboard: REPLY_KEYBOARD,
      inline: [
        [{ text: "🔄 صفرکردن مصرف کاربر", callback_data: "admin:resetuser" }],
        [{ text: "⬅️ بازگشت به مدیریت", callback_data: "admin:menu" }]
      ]
    }
  );

  await setState(chatId, {
    flow: "admin",
    step: "quota"
  });
}

async function resetUserQuota(chatId, targetId) {
  if (!(await isAdminAuthenticated(chatId))) return;

  const user = await getUser(targetId);

  if (!user) {
    await sendMessage(chatId, "کاربر پیدا نشد.");
    return;
  }

  await redis(
    "DEL",
    KEY.quotaDay(targetId, dateKey()),
    KEY.quotaMonth(targetId, monthKey())
  );

  await sendMessage(chatId, "✅ مصرف روزانه و ماهانهٔ کاربر صفر شد.");
}

async function handleAdminQuotaText(chatId, text) {
  const value = safeString(text).trim();
  const dailyMatch = value.match(/^روزانه\s+(\d+)$/);
  const monthlyMatch = value.match(/^ماهانه\s+(\d+)$/);

  if (dailyMatch || monthlyMatch) {
    const amount = Number((dailyMatch || monthlyMatch)[1]);

    if (!Number.isInteger(amount) || amount < 1 || amount > 100000) {
      await sendMessage(chatId, "عدد باید بین ۱ تا ۱۰۰۰۰۰ باشد.");
      return;
    }

    if (dailyMatch) {
      await redis("SET", KEY.configDaily, String(amount));
    } else {
      await redis("SET", KEY.configMonthly, String(amount));
    }

    await clearState(chatId);

    await sendMessage(
      chatId,
      "✅ سهمیه همگانی با موفقیت تغییر کرد: " + amount,
      {
        keyboard: REPLY_KEYBOARD,
        inline: [[{ text: "🎟 مدیریت سهمیه‌ها", callback_data: "admin:quota" }]]
      }
    );
    return;
  }

  const personal = value.match(/^(روزانه|ماهانه)\s+(\d+)\s+(\d+)$/);

  if (personal) {
    const kind = personal[1] === "روزانه" ? "daily" : "monthly";
    const targetId = personal[2];
    const amount = Number(personal[3]);

    if (!Number.isInteger(amount) || amount < 0 || amount > 100000) {
      await sendMessage(chatId, "عدد سهمیه باید بین صفر تا ۱۰۰۰۰۰ باشد.");
      return;
    }

    const user = await getUser(targetId);

    if (!user) {
      await sendMessage(chatId, "کاربر پیدا نشد.");
      return;
    }

    const key = kind === "daily"
      ? KEY.userDailyQuota(targetId)
      : KEY.userMonthlyQuota(targetId);

    await redis("SET", key, String(amount));
    await clearState(chatId);
    await sendMessage(chatId, "✅ سهمیه اختصاصی کاربر تنظیم شد.");
    return;
  }

  await sendMessage(
    chatId,
    "فرمت واردشده صحیح نیست.\n\n" +
    "نمونه سهمیه همگانی:\nروزانه 25\nماهانه 400\n\n" +
    "نمونه سهمیه اختصاصی:\nروزانه 123456789 25\nماهانه 123456789 400"
  );
}

async function beginBroadcast(chatId) {
  if (!(await isAdminAuthenticated(chatId))) return;

  await setState(chatId, {
    flow: "admin",
    step: "broadcast"
  });

  await sendMessage(
    chatId,
    "📨 متن پیام همگانی را بفرست.\n\n" +
    "این پیام برای تمام کاربران ثبت‌نام‌شده ارسال می‌شود.\n" +
    "برای انصراف «لغو» را بفرست."
  );
}

async function sendBroadcast(chatId, text) {
  if (!(await isAdminAuthenticated(chatId))) return;

  const ids = await redis("SMEMBERS", KEY.users);

  if (!Array.isArray(ids) || ids.length === 0) {
    await clearState(chatId);
    await sendMessage(chatId, "کاربری برای ارسال پیام وجود ندارد.");
    return;
  }

  await setState(chatId, {
    flow: "admin",
    step: "broadcast_confirm",
    data: { text: shortText(text, 3500) }
  });

  await sendMessage(
    chatId,
    "⚠️ تأیید ارسال پیام همگانی\n\n" +
    "تعداد کاربران: " + ids.length + "\n\n" +
    "متن پیام:\n" + shortText(text, 2500) +
    "\n\nآیا ارسال را تأیید می‌کنی؟",
    {
      inline: [
        [{ text: "✅ تأیید ارسال", callback_data: "admin:confirmbroadcast" }],
        [{ text: "❌ انصراف", callback_data: "admin:cancelbroadcast" }]
      ]
    }
  );
}

async function executeBroadcast(chatId) {
  if (!(await isAdminAuthenticated(chatId))) return;

  const state = await getState(chatId);

  if (!state || state.step !== "broadcast_confirm" || !state.data?.text) {
    await sendMessage(chatId, "اطلاعات ارسال پیدا نشد.");
    return;
  }

  const ids = await redis("SMEMBERS", KEY.users);

  if (!Array.isArray(ids)) {
    await sendMessage(chatId, "فهرست کاربران قابل دریافت نیست.");
    return;
  }

  const message = state.data.text;
  await clearState(chatId);

  let success = 0;
  let failed = 0;

  await sendMessage(chatId, "⏳ ارسال پیام همگانی آغاز شد.\nتعداد کاربران: " + ids.length);

  for (const id of ids) {
    try {
      const user = await getUser(id);

      if (!user || user.status !== "active") {
        failed++;
        continue;
      }

      await sendMessage(id, message);
      success++;
    } catch {
      failed++;
    }
  }

  await sendMessage(
    chatId,
    "✅ ارسال همگانی به پایان رسید.\n\n" +
    "ارسال موفق: " + success + "\n" +
    "ارسال ناموفق: " + failed + "\n" +
    "تعداد کل: " + ids.length,
    {
      keyboard: REPLY_KEYBOARD,
      inline: [[{ text: "⬅️ پنل مدیریت", callback_data: "admin:menu" }]]
    }
  );
}

async function beginPrivateMessage(chatId, targetId = "") {
  if (!(await isAdminAuthenticated(chatId))) return;

  await setState(chatId, {
    flow: "admin",
    step: targetId ? "private_text" : "private_id",
    targetId: String(targetId || "")
  });

  if (targetId) {
    await sendMessage(chatId, "✉️ متن پیام برای کاربر " + targetId + " را بفرست.");
  } else {
    await sendMessage(chatId, "شناسه عددی کاربر موردنظر را بفرست.");
  }
}

async function sendPrivateMessage(chatId, targetId, text) {
  if (!(await isAdminAuthenticated(chatId))) return;

  const user = await getUser(targetId);

  if (!user) {
    await clearState(chatId);
    await sendMessage(chatId, "کاربر پیدا نشد.");
    return;
  }

  try {
    await sendMessage(targetId, "📩 پیام مدیریت\n\n" + shortText(text, 3500));
    await clearState(chatId);
    await sendMessage(chatId, "✅ پیام خصوصی ارسال شد.");
  } catch {
    await sendMessage(chatId, "❌ ارسال پیام خصوصی ناموفق بود.");
  }
}

async function showAdminTickets(chatId) {
  if (!(await isAdminAuthenticated(chatId))) return;

  const ids = await redis("LRANGE", KEY.tickets, 0, 19);
  const buttons = [];

  if (Array.isArray(ids)) {
    for (const id of ids) {
      const ticket = await getJson(KEY.ticket(id));
      if (!ticket) continue;

      buttons.push([{
        text:
          (ticket.status === "open" ? "🟠 " :
            ticket.status === "closed" ? "✅ " : "⚠️ ") +
          "#" + ticket.id + " — " + shortText(ticket.name, 22),
        callback_data: "ticket:" + ticket.id
      }]);
    }
  }

  if (!buttons.length) {
    await sendMessage(
      chatId,
      "🎫 هنوز تیکتی ثبت نشده است.",
      {
        keyboard: REPLY_KEYBOARD,
        inline: [[{ text: "⬅️ بازگشت به مدیریت", callback_data: "admin:menu" }]]
      }
    );
    return;
  }

  buttons.push([{ text: "⬅️ بازگشت به مدیریت", callback_data: "admin:menu" }]);

  await sendMessage(chatId, "🎫 فهرست تیکت‌های اخیر\n\nیک تیکت را انتخاب کن.", {
    keyboard: REPLY_KEYBOARD,
    inline: buttons
  });
}

async function showTicket(chatId, ticketId) {
  if (!(await isAdminAuthenticated(chatId))) return;

  const ticket = await getJson(KEY.ticket(ticketId));

  if (!ticket) {
    await sendMessage(chatId, "این تیکت پیدا نشد.");
    return;
  }

  await sendMessage(
    chatId,
    "🎫 تیکت #" + ticket.id + "\n\n" +
    "نام کاربر: " + ticket.name + "\n" +
    "نام کاربری: @" + (ticket.username || "ثبت نشده") + "\n" +
    "شناسه کاربر: " + ticket.userId + "\n" +
    "وضعیت: " + ticket.status + "\n" +
    "زمان ثبت: " +
    new Date(ticket.createdAt).toLocaleString("fa-IR", {
      timeZone: "Asia/Tehran"
    }) +
    "\n\nمتن پیام:\n" + ticket.text,
    {
      keyboard: REPLY_KEYBOARD,
      inline: [
        [{ text: "✉️ پاسخ به تیکت", callback_data: "ticketreply:" + ticket.id }],
        [{
          text: ticket.status === "closed" ? "🔓 بازگشایی تیکت" : "✅ بستن تیکت",
          callback_data: "ticketclose:" + ticket.id
        }],
        [{ text: "⬅️ فهرست تیکت‌ها", callback_data: "admin:tickets" }]
      ]
    }
  );
}

async function beginTicketReply(chatId, ticketId) {
  if (!(await isAdminAuthenticated(chatId))) return;

  const ticket = await getJson(KEY.ticket(ticketId));

  if (!ticket) {
    await sendMessage(chatId, "تیکت پیدا نشد.");
    return;
  }

  await setState(chatId, {
    flow: "admin",
    step: "ticket_reply",
    ticketId: String(ticketId)
  });

  await sendMessage(
    chatId,
    "✉️ پاسخ به تیکت #" + ticketId + "\n\n" +
    "متن پاسخ را بفرست.\nبرای لغو، «لغو» را ارسال کن."
  );
}

async function sendTicketReply(chatId, ticketId, text) {
  if (!(await isAdminAuthenticated(chatId))) return;

  const ticket = await getJson(KEY.ticket(ticketId));

  if (!ticket) {
    await clearState(chatId);
    await sendMessage(chatId, "تیکت پیدا نشد.");
    return;
  }

  try {
    await sendMessage(
      ticket.userId,
      "📩 پاسخ تیم پشتیبانی\n\n" +
      "شماره تیکت: #" + ticket.id + "\n\n" +
      safeString(text) +
      "\n\nاز اینکه با ما در ارتباط بودی سپاسگزاریم."
    );
  } catch {
    await sendMessage(chatId, "ارسال پاسخ ناموفق بود. شناسه کاربر یا دسترسی ربات را بررسی کن.");
    return;
  }

  ticket.replies = Array.isArray(ticket.replies) ? ticket.replies : [];
  ticket.replies.push({
    text: shortText(text, 3000),
    at: now().toISOString(),
    by: String(chatId)
  });

  ticket.status = "open";
  ticket.updatedAt = now().toISOString();

  await setJson(KEY.ticket(ticket.id), ticket);
  await clearState(chatId);

  await sendMessage(
    chatId,
    "✅ پاسخ به کاربر ارسال شد.",
    {
      keyboard: REPLY_KEYBOARD,
      inline: [
        [{ text: "🎫 مشاهده تیکت", callback_data: "ticket:" + ticket.id }],
        [{ text: "📚 فهرست تیکت‌ها", callback_data: "admin:tickets" }]
      ]
    }
  );
}

async function toggleTicketStatus(chatId, ticketId) {
  if (!(await isAdminAuthenticated(chatId))) return;

  const ticket = await getJson(KEY.ticket(ticketId));

  if (!ticket) {
    await sendMessage(chatId, "تیکت پیدا نشد.");
    return;
  }

  ticket.status = ticket.status === "closed" ? "open" : "closed";
  ticket.updatedAt = now().toISOString();

  await setJson(KEY.ticket(ticket.id), ticket);

  await sendMessage(
    chatId,
    "وضعیت تیکت #" + ticket.id + " به «" +
    (ticket.status === "closed" ? "بسته‌شده" : "باز") +
    "» تغییر کرد.",
    {
      keyboard: REPLY_KEYBOARD,
      inline: [[{ text: "🎫 مشاهده تیکت", callback_data: "ticket:" + ticket.id }]]
    }
  );
}

async function showAdminStatus(chatId) {
  if (!(await isAdminAuthenticated(chatId))) return;

  const support = await redis("GET", KEY.supportGroup);
  const botEnabled = await getBotEnabled();

  await sendMessage(
    chatId,
    "🔌 وضعیت سرویس‌ها\n\n" +
    "بله: " + (CONFIG.BALE_TOKEN ? "توکن تنظیم شده ✅" : "تنظیم نشده ❌") + "\n" +
    "هوش مصنوعی: " + (CONFIG.OPENAI_KEY ? "کلید تنظیم شده ✅" : "تنظیم نشده ❌") + "\n" +
    "مدل گفت‌وگو: " + CONFIG.OPENAI_MODEL + "\n" +
    "آدرس API: " + CONFIG.AI_BASE_URL + "\n" +
    "Upstash Redis: " +
    (CONFIG.REDIS_URL && CONFIG.REDIS_TOKEN ? "تنظیم شده ✅" : "تنظیم نشده ❌") + "\n" +
    "گروه پشتیبانی: " + (support ? "تنظیم شده ✅" : "تنظیم نشده ❌") + "\n" +
    "وضعیت ربات: " + (botEnabled ? "روشن 🟢" : "خاموش 🔴") +
    "\n\nاین صفحه وجود تنظیمات را بررسی می‌کند؛ سلامت واقعی APIها باید با درخواست آزمایشی سنجیده شود.",
    {
      keyboard: REPLY_KEYBOARD,
      inline: [[{ text: "⬅️ بازگشت به مدیریت", callback_data: "admin:menu" }]]
    }
  );
}

async function showAdminSettings(chatId) {
  if (!(await isAdminAuthenticated(chatId))) return;

  await sendMessage(
    chatId,
    "⚙️ تنظیمات مدیریت\n\n" +
    "برای اتصال گروه پشتیبانی:\n" +
    "۱. ربات را به گروه اضافه کن.\n" +
    "۲. ربات باید اجازه ارسال پیام داشته باشد.\n" +
    "۳. در گروه دستور /set_support_group را با حساب مدیر اصلی بفرست.\n\n" +
    "متغیرهای API در تنظیمات محیطی Vercel قرار دارند:\n" +
    "OPENAI_API_KEY\n" +
    "OPENAI_MODEL\n" +
    "AI_BASE_URL\n\n" +
    "برای تغییر آن‌ها، متغیرها را در Vercel ویرایش و پروژه را دوباره Deploy کن.\n" +
    "کلید API را در چت یا گروه ارسال نکن.",
    {
      keyboard: REPLY_KEYBOARD,
      inline: [[{ text: "⬅️ بازگشت به مدیریت", callback_data: "admin:menu" }]]
    }
  );
}

async function toggleBot(chatId) {
  if (!(await isAdminAuthenticated(chatId))) return;

  const enabled = await getBotEnabled();
  await redis("SET", KEY.botEnabled, enabled ? "0" : "1");

  await sendMessage(
    chatId,
    enabled
      ? "🔴 ربات خاموش شد. مدیر همچنان به پنل مدیریت دسترسی دارد."
      : "🟢 ربات روشن شد.",
    {
      keyboard: REPLY_KEYBOARD,
      inline: [[{ text: "⬅️ بازگشت به مدیریت", callback_data: "admin:menu" }]]
    }
  );
}

async function handleAdminState(chatId, text, state) {
  if (!(await isAdminAuthenticated(chatId))) {
    await clearState(chatId);
    await sendMessage(chatId, "نشست مدیریت معتبر نیست. دوباره وارد پنل مدیریت شو.");
    return;
  }

  if (state.step === "ticket_reply") {
    return sendTicketReply(chatId, state.ticketId, text);
  }

  if (state.step === "quota") {
    return handleAdminQuotaText(chatId, text);
  }

  if (state.step === "search_user") {
    const query = safeString(text).trim().replace(/^@/, "");
    const ids = await redis("SMEMBERS", KEY.users);

    if (!Array.isArray(ids)) {
      await sendMessage(chatId, "فهرست کاربران قابل دریافت نیست.");
      return;
    }

    let found = null;

    for (const id of ids) {
      const user = await getUser(id);

      if (
        user &&
        (String(user.id) === query || user.username?.toLowerCase() === query.toLowerCase())
      ) {
        found = user;
        break;
      }
    }

    await clearState(chatId);

    if (!found) {
      await sendMessage(chatId, "کاربری با این مشخصات پیدا نشد.");
      return;
    }

    return showAdminUser(chatId, found.id);
  }

  if (state.step === "broadcast") {
    return sendBroadcast(chatId, text);
  }

  if (state.step === "broadcast_confirm") {
    await sendMessage(chatId, "برای تأیید یا لغو ارسال از دکمه‌های پیام قبلی استفاده کن.");
    return;
  }

  if (state.step === "private_id") {
    const targetId = safeString(text).trim();

    if (!/^\d+$/.test(targetId)) {
      await sendMessage(chatId, "شناسه باید عددی باشد.");
      return;
    }

    const user = await getUser(targetId);

    if (!user) {
      await sendMessage(chatId, "کاربر پیدا نشد. شناسه دیگری وارد کن.");
      return;
    }

    await setState(chatId, {
      flow: "admin",
      step: "private_text",
      targetId
    });

    await sendMessage(chatId, "متن پیام را برای این کاربر بفرست.");
    return;
  }

  if (state.step === "private_text") {
    return sendPrivateMessage(chatId, state.targetId, text);
  }
}

async function handleCallback(update) {
  const callback = update.callback_query;
  const data = safeString(callback.data);
  const chatId = String(callback.from?.id || callback.message?.chat?.id || "");
  const messageChatId = String(callback.message?.chat?.id || chatId);

  await answerCallback(callback.id);
  if (!chatId) return;

  if (data === "register") return beginRegistration(chatId);
  if (data === "help") return showHelp(messageChatId);
  if (data === "about") return showAbout(messageChatId);
  if (data === "main") return startCommand(messageChatId);

  if (data === "confirm_reg") return finishRegistration(chatId);

  if (data === "cancel_reg") {
    return cancelRegistration(chatId, await getState(chatId));
  }

  if (data === "newchat") {
    const user = await requireUser(chatId);
    if (!user) return;

    await redis("DEL", KEY.context(chatId));

    await sendMessage(
      chatId,
      "💬 گفت‌وگوی جدید آماده است!\n\n" +
      "حالا سؤال یا درخواستت را بنویس. تاریخچه قبلی حذف نشده است.",
      { keyboard: REPLY_KEYBOARD }
    );
    return;
  }

  if (data === "history") return showHistory(chatId);
  if (data === "account") return showAccount(chatId);
  if (data === "support") return beginSupport(chatId);

  if (
    data.startsWith("admin:") ||
    data.startsWith("ticket:") ||
    data.startsWith("ticketreply:") ||
    data.startsWith("ticketclose:")
  ) {
    if (!(await isAdminAuthenticated(chatId))) {
      await sendMessage(chatId, "برای استفاده از پنل مدیریت، ابتدا با حساب مدیر اصلی وارد شو.");
      return;
    }

    if (data === "admin:menu") return showAdminMenu(chatId);
    if (data === "admin:stats") return showAdminStats(chatId);
    if (data === "admin:users") return showAdminUsers(chatId);
    if (data === "admin:quota") return showAdminQuota(chatId);
    if (data === "admin:status") return showAdminStatus(chatId);
    if (data === "admin:settings") return showAdminSettings(chatId);
    if (data === "admin:tickets") return showAdminTickets(chatId);
    if (data === "admin:broadcast") return beginBroadcast(chatId);
    if (data === "admin:private") return beginPrivateMessage(chatId);

    if (data === "admin:searchuser") {
      await setState(chatId, {
        flow: "admin",
        step: "search_user"
      });

      await sendMessage(chatId, "شناسه عددی یا نام کاربری کاربر را بفرست.");
      return;
    }

    if (data === "admin:resetuser") {
      await setState(chatId, {
        flow: "admin",
        step: "reset_user"
      });

      await sendMessage(chatId, "شناسه کاربری را که می‌خواهی مصرفش صفر شود بفرست.");
      return;
    }

    if (data === "admin:togglebot") return toggleBot(chatId);
    if (data === "admin:confirmbroadcast") return executeBroadcast(chatId);

    if (data === "admin:cancelbroadcast") {
      await clearState(chatId);

      await sendMessage(
        chatId,
        "ارسال همگانی لغو شد.",
        {
          keyboard: REPLY_KEYBOARD,
          inline: [[{ text: "⬅️ پنل مدیریت", callback_data: "admin:menu" }]]
        }
      );
      return;
    }

    if (data === "admin:logout") {
      await redis("DEL", KEY.adminAuth(chatId));
      await clearState(chatId);

      await sendMessage(chatId, "از پنل مدیریت خارج شدی. 🔒", {
        keyboard: REPLY_KEYBOARD
      });
      return;
    }

    if (data.startsWith("admin:block:")) {
      return toggleUserBlock(chatId, data.slice("admin:block:".length));
    }

    if (data.startsWith("admin:user:")) {
      return showAdminUser(chatId, data.slice("admin:user:".length));
    }

    if (data.startsWith("admin:privateuser:")) {
      return beginPrivateMessage(chatId, data.slice("admin:privateuser:".length));
    }

    if (data.startsWith("admin:resetquota:")) {
      return resetUserQuota(chatId, data.slice("admin:resetquota:".length));
    }

    if (data.startsWith("admin:userquota:")) {
      const targetId = data.slice("admin:userquota:".length);

      await setState(chatId, {
        flow: "admin",
        step: "user_quota",
        targetId
      });

      await sendMessage(
        chatId,
        "سهمیه اختصاصی را با این قالب بفرست:\nروزانه 20\nیا\nماهانه 300"
      );
      return;
    }

    if (data.startsWith("ticketreply:")) {
      return beginTicketReply(chatId, data.slice("ticketreply:".length));
    }

    if (data.startsWith("ticketclose:")) {
      return toggleTicketStatus(chatId, data.slice("ticketclose:".length));
    }

    if (data.startsWith("ticket:")) {
      return showTicket(chatId, data.slice("ticket:".length));
    }
  }
}

async function handleAdminUserQuota(chatId, text, state) {
  if (!(await isAdminAuthenticated(chatId))) return;

  const user = await getUser(state.targetId);

  if (!user) {
    await clearState(chatId);
    await sendMessage(chatId, "کاربر پیدا نشد.");
    return;
  }

  const match = safeString(text).trim().match(/^(روزانه|ماهانه)\s+(\d+)$/);

  if (!match) {
    await sendMessage(chatId, "فرمت صحیح:\nروزانه 20\nیا\nماهانه 300");
    return;
  }

  const amount = Number(match[2]);

  if (!Number.isInteger(amount) || amount < 0 || amount > 100000) {
    await sendMessage(chatId, "عدد باید بین صفر تا ۱۰۰۰۰۰ باشد.");
    return;
  }

  const key = match[1] === "روزانه"
    ? KEY.userDailyQuota(state.targetId)
    : KEY.userMonthlyQuota(state.targetId);

  await redis("SET", key, String(amount));
  await clearState(chatId);

  await sendMessage(
    chatId,
    "✅ سهمیه اختصاصی کاربر تغییر کرد.",
    {
      keyboard: REPLY_KEYBOARD,
      inline: [[{ text: "👤 مشاهده کاربر", callback_data: "admin:user:" + state.targetId }]]
    }
  );
}

async function handleAdminResetUser(chatId, text) {
  if (!(await isAdminAuthenticated(chatId))) return;

  const targetId = safeString(text).trim();

  if (!/^\d+$/.test(targetId)) {
    await sendMessage(chatId, "شناسه باید عددی باشد.");
    return;
  }

  await clearState(chatId);
  return resetUserQuota(chatId, targetId);
}

async function handleGroupMessage(message) {
  const chatId = String(message.chat?.id || "");
  const senderId = String(message.from?.id || "");
  const text = safeString(message.text).trim();

  if (!text.startsWith("/set_support_group")) return;
  if (!CONFIG.ADMIN_ID || senderId !== CONFIG.ADMIN_ID) return;

  await redis("SET", KEY.supportGroup, chatId);

  await sendMessage(
    chatId,
    "✅ گروه پشتیبانی تنظیم شد.\n\n" +
    "تیکت‌های جدید به این گروه ارسال می‌شوند. پاسخ به کاربران از پنل خصوصی مدیریت انجام می‌شود."
  );
}

async function handlePrivateMessage(message) {
  const chatId = String(message.chat?.id || "");
  const text = safeString(message.text).trim();

  if (!chatId) return;

  if (text === "/start" || text === "🔄 شروع مجدد") {
    await clearState(chatId);
    return startCommand(chatId);
  }

  if (text === "/set_support_group") {
    await sendMessage(chatId, "این دستور را در گروه پشتیبانی ارسال کن، نه در گفت‌وگوی خصوصی.");
    return;
  }

  if (text === "مدیریت ۱۰۰۱") {
    if (chatId === CONFIG.ADMIN_ID) return beginAdminLogin(chatId);
    return;
  }

  const state = await getState(chatId);

  if (text === "لغو") {
    if (state) {
      if (state.flow === "registration") {
        return cancelRegistration(chatId, state);
      }

      await clearState(chatId);
      await sendMessage(chatId, "عملیات لغو شد.", { keyboard: REPLY_KEYBOARD });
      return;
    }

    await sendMessage(chatId, "عملیاتی برای لغو وجود ندارد.", {
      keyboard: REPLY_KEYBOARD
    });
    return;
  }

  if (state?.flow === "registration") {
    return handleRegistration(chatId, text, state);
  }

  if (state?.flow === "admin_login") {
    return handleAdminLogin(chatId, text, state);
  }

  if (state?.flow === "support" && state.step === "message") {
    if (text.length < 3) {
      await sendMessage(chatId, "لطفاً پیام خود را کمی کامل‌تر بنویس.");
      return;
    }

    if (text.length > 3000) {
      await sendMessage(chatId, "پیام پشتیبانی حداکثر ۳۰۰۰ نویسه می‌تواند باشد.");
      return;
    }

    return createTicket(chatId, text);
  }

  if (state?.flow === "admin") {
    if (state.step === "user_quota") {
      return handleAdminUserQuota(chatId, text, state);
    }

    if (state.step === "reset_user") {
      return handleAdminResetUser(chatId, text);
    }

    return handleAdminState(chatId, text, state);
  }

  if (text.startsWith("/")) {
    await sendMessage(
      chatId,
      "این دستور شناخته نشد. برای دیدن امکانات، /start را بفرست.",
      { keyboard: REPLY_KEYBOARD }
    );
    return;
  }

  const user = await getUser(chatId);

  if (!user || user.status !== "active") {
    await sendMessage(
      chatId,
      "برای شروع گفت‌وگو، ابتدا حساب کاربری بساز. 📝",
      {
        keyboard: REPLY_KEYBOARD,
        inline: [[{ text: "📝 ثبت‌نام", callback_data: "register" }]]
      }
    );
    return;
  }

  if (user.status === "blocked") {
    await sendMessage(
      chatId,
      "حساب کاربری تو مسدود شده است. برای پیگیری با پشتیبانی تماس بگیر."
    );
    return;
  }

  if (!(await getBotEnabled()) && chatId !== CONFIG.ADMIN_ID) {
    await sendMessage(
      chatId,
      "🔴 ربات در حال حاضر موقتاً غیرفعال است.\nلطفاً بعداً دوباره مراجعه کن."
    );
    return;
  }

  await handleAIChat(chatId, text);
}

async function processUpdate(update) {
  if (!update || typeof update !== "object") return;

  if (update.update_id !== undefined && update.update_id !== null) {
    const result = await redis(
      "SET",
      KEY.update(update.update_id),
      "1",
      "EX",
      86400,
      "NX"
    );

    if (result !== "OK") return;
  }

  if (update.callback_query) {
    await handleCallback(update);
    return;
  }

  const message = update.message || update.edited_message;
  if (!message) return;

  const chatType = message.chat?.type;

  if (chatType === "group" || chatType === "supergroup") {
    await handleGroupMessage(message);
    return;
  }

  if (chatType === "private") {
    await handlePrivateMessage(message);
  }
}

function sendJson(res, statusCode, body) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

async function setupWebhook(res) {
  if (!CONFIG.BALE_TOKEN || !CONFIG.APP_URL || !CONFIG.WEBHOOK_SECRET) {
    return sendJson(res, 500, {
      ok: false,
      message: "BALE_BOT_TOKEN، APP_BASE_URL و BALE_WEBHOOK_SECRET باید تنظیم شوند."
    });
  }

  const webhookUrl = CONFIG.APP_URL + "/api/webhook?secret=" +
    encodeURIComponent(CONFIG.WEBHOOK_SECRET);

  try {
    const result = await sendBale("setWebhook", { url: webhookUrl });

    return sendJson(res, 200, {
      ok: true,
      message: "درخواست ثبت Webhook ارسال شد.",
      result
    });
  } catch (error) {
    console.error("WEBHOOK_SETUP_FAILED", error.message);

    return sendJson(res, 502, {
      ok: false,
      message: "ثبت Webhook ناموفق بود. توکن ربات و پشتیبانی API بله را بررسی کن."
    });
  }
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  const url = getRequestUrl(req);

  if (req.method === "GET") {
    const setupValue = url.searchParams.get("setup");

    if (
      setupValue &&
      CONFIG.SETUP_SECRET &&
      constantTimeEqual(setupValue, CONFIG.SETUP_SECRET)
    ) {
      return setupWebhook(res);
    }

    if (
      url.searchParams.get("secret") &&
      CONFIG.WEBHOOK_SECRET &&
      constantTimeEqual(url.searchParams.get("secret"), CONFIG.WEBHOOK_SECRET)
    ) {
      return sendJson(res, 200, {
        ok: true,
        service: "bale-chatgpt-assistant",
        message: "Webhook endpoint is reachable."
      });
    }

    return sendJson(res, 403, {
      ok: false,
      message: "دسترسی مجاز نیست."
    });
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    res.statusCode = 405;
    res.end("Method Not Allowed");
    return;
  }

  if (
    !CONFIG.WEBHOOK_SECRET ||
    !constantTimeEqual(url.searchParams.get("secret"), CONFIG.WEBHOOK_SECRET)
  ) {
    res.statusCode = 401;
    res.end("Unauthorized");
    return;
  }

  const update = parseBody(req.body);

  try {
    await processUpdate(update);
    return sendJson(res, 200, { ok: true });
  } catch (error) {
    console.error("UPDATE_PROCESSING_FAILED", error.message);

    return sendJson(res, 500, {
      ok: false,
      message: "update_processing_failed"
    });
  }
};
