const crypto = require("crypto");

const CONFIG = {
  BALE_TOKEN: process.env.BALE_BOT_TOKEN || "",
  OPENAI_KEY: process.env.OPENAI_API_KEY || "",
  OPENAI_MODEL: process.env.OPENAI_MODEL || "gpt-4o-mini",
  REDIS_URL: (process.env.UPSTASH_REDIS_REST_URL || "").replace(/\/+$/, ""),
  REDIS_TOKEN: process.env.UPSTASH_REDIS_REST_TOKEN || "",
  WEBHOOK_SECRET: process.env.BALE_WEBHOOK_SECRET || "",
  SETUP_SECRET: process.env.WEBHOOK_SETUP_SECRET || "",
  APP_URL: (process.env.APP_BASE_URL || "").replace(/\/+$/, ""),
  ADMIN_ID: String(process.env.ADMIN_USER_ID || ""),
  ADMIN_PASSWORD_1: process.env.ADMIN_PASSWORD_1 || "",
  ADMIN_PASSWORD_2: process.env.ADMIN_PASSWORD_2 || "",
  DAILY_QUOTA: Math.max(1, Number(process.env.DAILY_QUOTA || 20)),
  MONTHLY_QUOTA: Math.max(1, Number(process.env.MONTHLY_QUOTA || 300)),
  POLITICAL_KEYWORDS:
    process.env.POLITICAL_KEYWORDS ||
    "انتخابات|رئیس جمهور|رئیس‌جمهور|مجلس شورای اسلامی|حزب سیاسی|نامزد انتخاباتی|رقابت انتخاباتی|تبلیغات انتخاباتی|سیاستمدار"
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
  supportGroup: "config:support_group",
  ticket: id => "ticket:" + id,
  ticketSequence: "ticket:sequence",
  tickets: "tickets:all",
  users: "users:all",
  update: id => "processed:update:" + id,
  configDaily: "config:daily_quota",
  configMonthly: "config:monthly_quota",
  failedAdmin: id => "admin:failed:" + id
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
    { text: "🎫 تیکت‌های پشتیبانی", callback_data: "admin:tickets" }
  ],
  [
    { text: "🔌 وضعیت سرویس‌ها", callback_data: "admin:status" },
    { text: "⚙️ تنظیمات", callback_data: "admin:settings" }
  ],
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

function escapeText(value) {
  return safeString(value).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
}

function shortText(value, max = 300) {
  const text = escapeText(value);
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

async function isAdminAuthenticated(id) {
  if (String(id) !== CONFIG.ADMIN_ID) return false;
  const value = await redis("GET", KEY.adminAuth(id));
  return value === "1";
}

async function sendBale(method, payload) {
  if (!CONFIG.BALE_TOKEN) throw new Error("BALE_TOKEN_NOT_CONFIGURED");

  const response = await fetch(BALE_API + "/" + method, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok || data.ok === false || data.error) {
    throw new Error("BALE_API_REQUEST_FAILED");
  }

  return data;
}

async function sendMessage(chatId, text, options = {}) {
  const payload = {
    chat_id: chatId,
    text: safeString(text)
  };

  if (options.keyboard) payload.reply_markup = options.keyboard;
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

async function editMessage(chatId, messageId, text, inline) {
  const payload = {
    chat_id: chatId,
    message_id: messageId,
    text: safeString(text)
  };

  if (inline) payload.reply_markup = { inline_keyboard: inline };

  try {
    return await sendBale("editMessageText", payload);
  } catch {
    return sendMessage(chatId, text, { inline });
  }
}

async function safeSend(chatId, text, options = {}) {
  try {
    return await sendMessage(chatId, text, options);
  } catch (error) {
    console.error("SEND_MESSAGE_FAILED", error.message);
    throw error;
  }
}

function mainMenuText(user) {
  const firstName = safeString(user.name).split(/\s+/)[0] || "دوست عزیز";
  return (
    "سلام " + firstName + " عزیز! 🌟\n\n" +
    "به چت جی‌بی‌تی خوش آمدی.\n" +
    "اینجا می‌توانی سؤال بپرسی، ایده‌هایت را بررسی کنی، متن بنویسی، مفاهیم را یاد بگیری و برای حل مسئله‌ها کمک بگیری.\n\n" +
    "از منوی زیر، بخش موردنظرت را انتخاب کن. 👇"
  );
}

async function showWelcome(chatId) {
  const text =
    "سلام! به چت جی‌بی‌تی خوش آمدی. 🌟\n\n" +
    "یک دستیار هوشمند برای گفت‌وگو، یادگیری، نوشتن، ایده‌پردازی و پاسخ به پرسش‌های تو.\n\n" +
    "برای استفاده از امکانات ربات، ابتدا حساب کاربری بساز. ثبت‌نام رایگان است و رمز عبورت به‌صورت متن ساده ذخیره نمی‌شود.\n\n" +
    "از کجا شروع کنیم؟";

  await sendMessage(chatId, text, {
    keyboard: REPLY_KEYBOARD,
    inline: [
      [
        { text: "📝 ثبت‌نام", callback_data: "register" },
        { text: "📖 راهنما", callback_data: "help" }
      ],
      [{ text: "ℹ️ درباره ربات", callback_data: "about" }]
    ]
  });
}

async function showMainMenu(chatId, user) {
  await sendMessage(chatId, mainMenuText(user), {
    keyboard: REPLY_KEYBOARD,
    inline: MAIN_MENU
  });
}

async function startCommand(chatId) {
  const user = await getUser(chatId);

  if (user && user.status === "active") {
    await showMainMenu(chatId, user);
  } else {
    await showWelcome(chatId);
  }
}

async function showHelp(chatId) {
  await sendMessage(
    chatId,
    "📖 راهنمای استفاده از چت جی‌بی‌تی\n\n" +
      "💬 گفت‌وگوی جدید: یک گفت‌وگوی تازه را شروع می‌کند.\n" +
      "📚 تاریخچه: پیام‌ها و پاسخ‌های قبلی ذخیره‌شده را نمایش می‌دهد.\n" +
      "👤 حساب کاربری: اطلاعات حساب و سهمیه باقی‌مانده را نشان می‌دهد.\n" +
      "🎧 پشتیبانی: پیام خود را برای تیم پشتیبانی ارسال می‌کنی.\n\n" +
      "نکته‌ها:\n" +
      "• سؤال خود را واضح و کامل بنویس.\n" +
      "• برای اصلاح پاسخ، توضیح بده چه تغییری می‌خواهی.\n" +
      "• پاسخ هوش مصنوعی ممکن است اشتباه باشد؛ اطلاعات مهم را بررسی کن.\n" +
      "• سهمیه استفاده محدود است و پس از پایان سهمیه باید منتظر دوره بعدی بمانی.\n" +
      "• برای برگشت به شروع، دکمه «🔄 شروع مجدد» را بزن.",
    { keyboard: REPLY_KEYBOARD, inline: [[{ text: "🏠 منوی اصلی", callback_data: "main" }]] }
  );
}

async function showAbout(chatId) {
  await sendMessage(
    chatId,
    "ℹ️ درباره چت جی‌بی‌تی\n\n" +
      "چت جی‌بی‌تی یک ربات گفت‌وگوی هوشمند در پیام‌رسان بله است که از سرویس هوش مصنوعی متصل‌شده به آن برای تولید پاسخ استفاده می‌کند.\n\n" +
      "✨ امکانات اصلی:\n" +
      "• گفت‌وگو با هوش مصنوعی\n" +
      "• نگهداری تاریخچه گفتگوها\n" +
      "• حساب کاربری و سهمیه مصرف\n" +
      "• پشتیبانی از طریق ثبت تیکت\n\n" +
      "حفظ امنیت حساب مهم است. رمز عبور خود را برای هیچ‌کس ارسال نکن و اطلاعات حساس را در گفت‌وگو وارد نکن.",
    { keyboard: REPLY_KEYBOARD, inline: [[{ text: "🏠 منوی اصلی", callback_data: "main" }]] }
  );
}

async function beginRegistration(chatId) {
  const existing = await getUser(chatId);
  if (existing && existing.status === "active") {
    await sendMessage(chatId, "حساب کاربری تو از قبل ساخته شده است. نیازی به ثبت‌نام دوباره نیست. ✅", {
      keyboard: REPLY_KEYBOARD,
      inline: [[{ text: "🏠 منوی اصلی", callback_data: "main" }]]
    });
    return;
  }

  await setState(chatId, { flow: "registration", step: "name", data: {} });
  await sendMessage(
    chatId,
    "📝 ثبت‌نام در چت جی‌بی‌تی\n\n" +
      "خوشحالیم که به جمع ما پیوستی!\n\n" +
      "مرحله ۱ از ۴\n" +
      "لطفاً نام و نام خانوادگی خود را وارد کن.\n\n" +
      "برای انصراف، «لغو» را بفرست."
  );
}

async function cancelRegistration(chatId, state) {
  if (state && state.flow === "registration" && state.data && state.data.username) {
    const reservationKey = KEY.username(state.data.username);
    const reserved = await redis("GET", reservationKey).catch(() => null);
    if (reserved === "pending:" + chatId) {
      await redis("DEL", reservationKey).catch(() => null);
    }
  }

  await clearState(chatId);
  const user = await getUser(chatId);

  if (user && user.status === "active") {
    await sendMessage(chatId, "عملیات لغو شد. حساب کاربری و تاریخچه‌ات محفوظ است. ✅", {
      keyboard: REPLY_KEYBOARD,
      inline: MAIN_MENU
    });
  } else {
    await sendMessage(chatId, "ثبت‌نام لغو شد. هر زمان آماده بودی، می‌توانی دوباره شروع کنی.", {
      keyboard: REPLY_KEYBOARD,
      inline: [[{ text: "📝 شروع ثبت‌نام", callback_data: "register" }]]
    });
  }
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

function verifyPassword(password, saved) {
  if (!saved || !saved.salt || !saved.hash) return false;
  try {
    const candidate = crypto.scryptSync(password, saved.salt, 64);
    const original = Buffer.from(saved.hash, "hex");
    return candidate.length === original.length && crypto.timingSafeEqual(candidate, original);
  } catch {
    return false;
  }
}

async function handleRegistration(chatId, text, state) {
  const data = state.data || {};

  if (state.step === "name") {
    const name = safeString(text).trim().replace(/\s+/g, " ");
    if (!validFullName(name)) {
      await sendMessage(chatId, "لطفاً نام و نام خانوادگی را کامل وارد کن؛ مثلاً «علی رضایی».\n\nبرای انصراف «لغو» را بفرست.");
      return;
    }

    data.name = name;
    await setState(chatId, { flow: "registration", step: "username", data });
    await sendMessage(
      chatId,
      "عالی است! ✨\n\nمرحله ۲ از ۴\nیک نام کاربری انگلیسی انتخاب کن.\n\n" +
        "قواعد نام کاربری:\n" +
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
      await sendMessage(chatId, "این نام کاربری معتبر نیست. یک نام کاربری انگلیسی با ۴ تا ۲۰ نویسه وارد کن.");
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
    await setState(chatId, { flow: "registration", step: "password", data });
    await sendMessage(
      chatId,
      "نام کاربری انتخاب شد. ✅\n\nمرحله ۳ از ۴\nیک رمز عبور برای حسابت انتخاب کن.\n\n" +
        "رمز عبور باید حداقل ۸ نویسه داشته باشد. برای امنیت، از رمز عبور حساب‌های دیگر خود استفاده نکن.\n\n" +
        "رمز عبور تو به‌صورت متن ساده ذخیره نمی‌شود."
    );
    return;
  }

  if (state.step === "password") {
    if (!validPassword(text)) {
      await sendMessage(chatId, "رمز عبور باید حداقل ۸ و حداکثر ۱۲۸ نویسه داشته باشد. دوباره تلاش کن.");
      return;
    }

    data.password = hashPassword(text);
    await setState(chatId, { flow: "registration", step: "confirm", data });

    await sendMessage(
      chatId,
      "مرحله ۴ از ۴ — تأیید اطلاعات\n\n" +
        "👤 نام: " + data.name + "\n" +
        "🔑 نام کاربری: @" + data.username + "\n" +
        "🔒 رمز عبور: ثبت و به‌صورت امن هش می‌شود\n\n" +
        "پایه تحصیلی پرسیده نمی‌شود و در حساب ذخیره نخواهد شد.\n\n" +
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
    await sendMessage(chatId, "متأسفانه نام کاربری دیگر در دسترس نیست. ثبت‌نام را دوباره انجام بده.");
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
      "حساب کاربری تو آماده است. از این پس می‌توانی با همین حساب از امکانات ربات استفاده کنی.\n\n" +
      "🔐 اطلاعات ورودت را محرمانه نگه دار.\n" +
      "💬 برای شروع گفت‌وگو، دکمه مربوطه را انتخاب کن.",
    { keyboard: REPLY_KEYBOARD, inline: MAIN_MENU }
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

async function getQuotaUsage(chatId) {
  const day = Number((await redis("GET", KEY.quotaDay(chatId, dateKey()))) || 0);
  const month = Number((await redis("GET", KEY.quotaMonth(chatId, monthKey()))) || 0);
  const dailyLimit = await getQuotaLimit("daily");
  const monthlyLimit = await getQuotaLimit("monthly");

  return {
    day,
    month,
    dailyLimit,
    monthlyLimit,
    dailyLeft: Math.max(0, dailyLimit - day),
    monthlyLeft: Math.max(0, monthlyLimit - month)
  };
}

async function incrementQuota(chatId) {
  const dayKey = KEY.quotaDay(chatId, dateKey());
  const month = KEY.quotaMonth(chatId, monthKey());

  await redis("INCR", dayKey);
  await redis("EXPIRE", dayKey, 172800);

  await redis("INCR", month);
  await redis("EXPIRE", month, 3456000);
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

async function callOpenAI(chatId, userText) {
  if (!CONFIG.OPENAI_KEY) throw new Error("OPENAI_KEY_NOT_CONFIGURED");

  const context = await getContext(chatId);
  const messages = [
    {
      role: "system",
      content:
        "تو دستیار فارسی‌زبان دقیق، محترمانه و مفید هستی. پاسخ را متناسب با سؤال کاربر بده. اگر چیزی را نمی‌دانی، صادقانه بگو. اطلاعات ساختگی را به‌عنوان واقعیت ارائه نکن. پاسخ‌ها را روشن و منظم بنویس. اگر کاربر فارسی می‌نویسد، فارسی پاسخ بده."
    },
    ...context,
    { role: "user", content: userText }
  ];

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
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
    console.error("OPENAI_REQUEST_FAILED", response.status, data.error?.type || "unknown");
    if (response.status === 401) throw new Error("OPENAI_AUTH_ERROR");
    if (response.status === 429) throw new Error("OPENAI_QUOTA_ERROR");
    throw new Error("OPENAI_REQUEST_ERROR");
  }

  const answer = data.choices?.[0]?.message?.content;
  if (!answer || typeof answer !== "string") throw new Error("OPENAI_EMPTY_RESPONSE");

  const updated = [
    ...context,
    { role: "user", content: userText },
    { role: "assistant", content: answer }
  ];

  await saveContext(chatId, updated);
  await saveHistory(chatId, userText, answer);
  await incrementQuota(chatId);

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
        "سهمیه ماهانه باقی‌مانده: " + quota.monthlyLeft + "\n\n" +
        "پس از تمدید دوره مربوطه، می‌توانی دوباره گفت‌وگو کنی."
    );
    return;
  }

  await sendMessage(chatId, "⏳ درخواستت دریافت شد؛ دارم پاسخ را آماده می‌کنم…");

  try {
    const answer = await callOpenAI(chatId, userText);
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
    console.error("AI_CHAT_FAILED", error.message);

    let message =
      "متأسفانه هنگام دریافت پاسخ مشکلی پیش آمد. درخواستت با موفقیت تکمیل نشد؛ کمی بعد دوباره تلاش کن.";

    if (error.message === "OPENAI_KEY_NOT_CONFIGURED") {
      message = "سرویس هوش مصنوعی هنوز پیکربندی نشده است. مدیر ربات باید کلید API را در متغیر OPENAI_API_KEY تنظیم کند.";
    } else if (error.message === "OPENAI_AUTH_ERROR") {
      message = "کلید API هوش مصنوعی معتبر نیست. مدیر ربات باید تنظیمات API را بررسی کند.";
    } else if (error.message === "OPENAI_QUOTA_ERROR") {
      message = "سرویس هوش مصنوعی فعلاً درخواست را نپذیرفت؛ ممکن است اعتبار API تمام شده یا محدودیت نرخ فعال باشد.";
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
      "📚 هنوز گفت‌وگویی در تاریخچه ثبت نشده است.\n\n" +
        "وقتی اولین سؤال خود را بپرسی و پاسخ موفق دریافت کنی، تاریخچه‌ات اینجا نمایش داده می‌شود.",
      { keyboard: REPLY_KEYBOARD, inline: [[{ text: "💬 شروع گفت‌وگوی جدید", callback_data: "newchat" }]] }
    );
    return;
  }

  const lines = ["📚 تاریخچه گفت‌وگوهای اخیر", "", "آخرین ۱۰ گفت‌وگوی ثبت‌شده:"];
  for (let i = 0; i < records.length; i++) {
    try {
      const item = JSON.parse(records[i]);
      const date = new Date(item.time).toLocaleString("fa-IR", { timeZone: "Asia/Tehran" });
      lines.push(
        "",
        (i + 1) + ". 🕒 " + date,
        "🧑 پرسش: " + shortText(item.user, 170),
        "🤖 پاسخ: " + shortText(item.assistant, 220)
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
      "نام و نام خانوادگی: " + user.name + "\n" +
      "نام کاربری: @" + user.username + "\n" +
      "وضعیت حساب: " + (user.status === "active" ? "فعال ✅" : "غیرفعال") + "\n" +
      "تاریخ ثبت‌نام: " + new Date(user.createdAt).toLocaleDateString("fa-IR", { timeZone: "Asia/Tehran" }) + "\n\n" +
      "📊 سهمیه استفاده\n" +
      "مصرف امروز: " + quota.day + " از " + quota.dailyLimit + "\n" +
      "باقی‌مانده امروز: " + quota.dailyLeft + "\n\n" +
      "مصرف این ماه: " + quota.month + " از " + quota.monthlyLimit + "\n" +
      "باقی‌مانده این ماه: " + quota.monthlyLeft + "\n\n" +
      "🔐 رمز عبور در این صفحه نمایش داده نمی‌شود.",
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
      "🎧 پشتیبانی\n\n" +
        "بخش پشتیبانی هنوز توسط مدیر راه‌اندازی نشده است. پیام تو فعلاً ثبت نمی‌شود.\n\n" +
        "لطفاً کمی بعد دوباره امتحان کن.",
      { keyboard: REPLY_KEYBOARD, inline: [[{ text: "🏠 منوی اصلی", callback_data: "main" }]] }
    );
    return;
  }

  await setState(chatId, { flow: "support", step: "message" });
  await sendMessage(
    chatId,
    "🎧 پشتیبانی چت جی‌بی‌تی\n\n" +
      "مشکل یا سؤال خود را با جزئیات بنویس تا به تیم پشتیبانی ارسال شود.\n\n" +
      "برای انصراف، «لغو» را بفرست."
  );
}

async function createTicket(chatId, text) {
  const user = await getUser(chatId);
  const groupId = await redis("GET", KEY.supportGroup);

  if (!groupId) {
    await clearState(chatId);
    await sendMessage(chatId, "در حال حاضر گروه پشتیبانی تنظیم نشده است؛ تیکت ارسال نشد.");
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
      "🎫 تیکت جدید پشتیبانی\n\n" +
        "شماره تیکت: #" + id + "\n" +
        "نام کاربر: " + ticket.name + "\n" +
        "نام کاربری: @" + (ticket.username || "ثبت نشده") + "\n" +
        "شناسه کاربر: " + ticket.userId + "\n\n" +
        "متن پیام:\n" + ticket.text + "\n\n" +
        "برای پاسخ، وارد پنل خصوصی مدیریت ربات شو و بخش «تیکت‌های پشتیبانی» را باز کن.\n" +
        "پاسخ‌گویی از طریق Reply به این پیام لازم نیست."
    );
  } catch (error) {
    console.error("SUPPORT_GROUP_SEND_FAILED", error.message);
    ticket.status = "delivery_error";
    await setJson(KEY.ticket(id), ticket);
    await sendMessage(chatId, "تیکت ساخته شد، اما ارسال اعلان به گروه پشتیبانی ناموفق بود. مدیر باید دسترسی ربات به گروه را بررسی کند.");
    return;
  }

  await sendMessage(
    chatId,
    "✅ پیام تو با موفقیت برای پشتیبانی ارسال شد.\n\n" +
      "شماره پیگیری: #" + id + "\n\n" +
      "پاسخ پشتیبانی از طریق همین ربات برایت ارسال می‌شود.",
    { keyboard: REPLY_KEYBOARD, inline: [[{ text: "🏠 منوی اصلی", callback_data: "main" }]] }
  );
}

async function showAdminMenu(chatId) {
  await sendMessage(chatId, "🛡 پنل مدیریت چت جی‌بی‌تی\n\nیکی از بخش‌های زیر را انتخاب کن.", {
    keyboard: REPLY_KEYBOARD,
    inline: ADMIN_MENU
  });
}

async function beginAdminLogin(chatId) {
  if (String(chatId) !== CONFIG.ADMIN_ID || !CONFIG.ADMIN_ID) {
    return;
  }

  const failures = Number((await redis("GET", KEY.failedAdmin(chatId))) || 0);
  if (failures >= 8) {
    await sendMessage(chatId, "ورود مدیریت موقتاً محدود شده است. تنظیمات امنیتی را بررسی کن.");
    return;
  }

  await setState(chatId, { flow: "admin_login", step: "password1" });
  await sendMessage(chatId, "🔐 ورود امن به پنل مدیریت\n\nرمز عبور اول را وارد کن.");
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
      await sendMessage(chatId, "❌ رمز اول نادرست است. ورود مدیریت انجام نشد.");
      console.error("ADMIN_LOGIN_FAILED", chatId, n);
      return;
    }

    await setState(chatId, { flow: "admin_login", step: "password2" });
    await sendMessage(chatId, "مرحله اول تأیید شد. 🔒\n\nاکنون رمز عبور دوم را وارد کن.");
    return;
  }

  if (state.step === "password2") {
    if (!CONFIG.ADMIN_PASSWORD_2 || !constantTimeEqual(text, CONFIG.ADMIN_PASSWORD_2)) {
      const n = await redis("INCR", KEY.failedAdmin(chatId));
      await redis("EXPIRE", KEY.failedAdmin(chatId), 3600);
      await clearState(chatId);
      await sendMessage(chatId, "❌ رمز دوم نادرست است. ورود مدیریت انجام نشد.");
      console.error("ADMIN_LOGIN_FAILED", chatId, n);
      return;
    }

    await redis("SET", KEY.adminAuth(chatId), "1", "EX", 1800);
    await redis("DEL", KEY.failedAdmin(chatId));
    await clearState(chatId);
    console.error("ADMIN_LOGIN_SUCCESS", chatId);
    await showAdminMenu(chatId);
  }
}

async function showAdminStats(chatId) {
  if (!(await isAdminAuthenticated(chatId))) return;

  const users = Number((await redis("SCARD", KEY.users)) || 0);
  const ticketIds = await redis("LRANGE", KEY.tickets, 0, 499);
  let open = 0;
  let closed = 0;

  if (Array.isArray(ticketIds)) {
    for (const id of ticketIds.slice(0, 100)) {
      const ticket = await getJson(KEY.ticket(id));
      if (ticket?.status === "open") open++;
      else if (ticket?.status === "closed") closed++;
    }
  }

  await sendMessage(
    chatId,
    "📊 آمار ربات\n\n" +
      "👥 تعداد حساب‌های ثبت‌شده: " + users + "\n" +
      "🎫 تیکت‌های باز: " + open + "\n" +
      "✅ تیکت‌های بسته‌شده: " + closed + "\n\n" +
      "این آمار از داده‌های ذخیره‌شده در پایگاه داده خوانده شده است.",
    { keyboard: REPLY_KEYBOARD, inline: [[{ text: "⬅️ بازگشت به مدیریت", callback_data: "admin:menu" }]] }
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
          "• " + user.name + " — @" + user.username + "\n" +
          "  شناسه: " + id + " | وضعیت: " + user.status
        );
      }
    }
  }

  await sendMessage(
    chatId,
    "👥 کاربران ثبت‌نام‌شده\n\n" +
      (users.length ? users.join("\n\n") : "هنوز کاربری ثبت‌نام نکرده است.") +
      "\n\nبرای حفظ امنیت، رمز عبور کاربران نمایش داده نمی‌شود.",
    { keyboard: REPLY_KEYBOARD, inline: [[{ text: "⬅️ بازگشت به مدیریت", callback_data: "admin:menu" }]] }
  );
}

async function showAdminQuota(chatId) {
  if (!(await isAdminAuthenticated(chatId))) return;

  const daily = await getQuotaLimit("daily");
  const monthly = await getQuotaLimit("monthly");

  await sendMessage(
    chatId,
    "🎟 مدیریت سهمیه‌ها\n\n" +
      "سهمیه روزانه فعلی: " + daily + "\n" +
      "سهمیه ماهانه فعلی: " + monthly + "\n\n" +
      "برای تغییر سهمیه روزانه، بنویس:\nروزانه 25\n\n" +
      "برای تغییر سهمیه ماهانه، بنویس:\nماهانه 400\n\n" +
      "عدد باید بین ۱ تا ۱۰۰۰۰۰ باشد.",
    { keyboard: REPLY_KEYBOARD, inline: [[{ text: "⬅️ بازگشت به مدیریت", callback_data: "admin:menu" }]] }
  );

  await setState(chatId, { flow: "admin", step: "quota" });
}

async function showAdminStatus(chatId) {
  if (!(await isAdminAuthenticated(chatId))) return;

  const support = await redis("GET", KEY.supportGroup);
  const redisReady = Boolean(CONFIG.REDIS_URL && CONFIG.REDIS_TOKEN);
  const baleReady = Boolean(CONFIG.BALE_TOKEN);
  const openaiReady = Boolean(CONFIG.OPENAI_KEY);

  await sendMessage(
    chatId,
    "🔌 وضعیت پیکربندی سرویس‌ها\n\n" +
      "بله: " + (baleReady ? "توکن تنظیم شده ✅" : "توکن تنظیم نشده ❌") + "\n" +
      "هوش مصنوعی: " + (openaiReady ? "کلید تنظیم شده ✅" : "کلید تنظیم نشده ❌") + "\n" +
      "Upstash Redis: " + (redisReady ? "متغیرها تنظیم شده‌اند ✅" : "تنظیم نشده ❌") + "\n" +
      "گروه پشتیبانی: " + (support ? "تنظیم شده ✅" : "تنظیم نشده ❌") + "\n\n" +
      "این صفحه فقط وجود تنظیمات را بررسی می‌کند؛ به‌معنای تضمین دسترس‌پذیری سرویس‌ها نیست.\n" +
      "کلیدهای محرمانه در این صفحه نمایش داده نمی‌شوند.",
    { keyboard: REPLY_KEYBOARD, inline: [[{ text: "⬅️ بازگشت به مدیریت", callback_data: "admin:menu" }]] }
  );
}

async function showAdminSettings(chatId) {
  if (!(await isAdminAuthenticated(chatId))) return;

  await sendMessage(
    chatId,
    "⚙️ تنظیمات مدیریت\n\n" +
      "برای اتصال گروه پشتیبانی:\n" +
      "۱. ربات را به گروه موردنظر اضافه کن.\n" +
      "۲. در گروه، ربات را مدیر کن و دسترسی ارسال پیام بده.\n" +
      "۳. با حساب مدیر اصلی، در همان گروه دستور زیر را بفرست:\n\n" +
      "/set_support_group\n\n" +
      "برای تغییر کلید هوش مصنوعی، توکن بله یا تنظیمات محرمانه، متغیرهای محیطی Vercel را تغییر بده و پروژه را دوباره Deploy کن.\n\n" +
      "⚠️ کلید API را داخل چت یا گروه ارسال نکن.",
    { keyboard: REPLY_KEYBOARD, inline: [[{ text: "⬅️ بازگشت به مدیریت", callback_data: "admin:menu" }]] }
  );
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
        text: (ticket.status === "open" ? "🟠 " : ticket.status === "closed" ? "✅ " : "⚠️ ") +
          "#" + ticket.id + " — " + shortText(ticket.name, 22),
        callback_data: "ticket:" + ticket.id
      }]);
    }
  }

  if (!buttons.length) {
    await sendMessage(chatId, "🎫 هنوز تیکتی ثبت نشده است.", {
      keyboard: REPLY_KEYBOARD,
      inline: [[{ text: "⬅️ بازگشت به مدیریت", callback_data: "admin:menu" }]]
    });
    return;
  }

  buttons.push([{ text: "⬅️ بازگشت به مدیریت", callback_data: "admin:menu" }]);
  await sendMessage(chatId, "🎫 فهرست تیکت‌های اخیر\n\nبرای مشاهده جزئیات، یک تیکت را انتخاب کن.", {
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
    "🎫 جزئیات تیکت #" + ticket.id + "\n\n" +
      "نام کاربر: " + ticket.name + "\n" +
      "نام کاربری: @" + (ticket.username || "ثبت نشده") + "\n" +
      "شناسه کاربر: " + ticket.userId + "\n" +
      "وضعیت: " + ticket.status + "\n" +
      "زمان ثبت: " + new Date(ticket.createdAt).toLocaleString("fa-IR", { timeZone: "Asia/Tehran" }) + "\n\n" +
      "متن پیام:\n" + ticket.text,
    {
      keyboard: REPLY_KEYBOARD,
      inline: [
        [{ text: "✉️ پاسخ به تیکت", callback_data: "ticketreply:" + ticket.id }],
        [{ text: ticket.status === "closed" ? "🔓 بازگشایی تیکت" : "✅ بستن تیکت", callback_data: "ticketclose:" + ticket.id }],
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

  await setState(chatId, { flow: "admin", step: "ticket_reply", ticketId: String(ticketId) });
  await sendMessage(
    chatId,
    "✉️ پاسخ به تیکت #" + ticketId + "\n\n" +
      "متن پاسخ را ارسال کن. پاسخ از طریق ربات برای کاربر فرستاده می‌شود.\n\n" +
      "برای لغو، «لغو» را بفرست.\n" +
      "نیازی به Reply به پیام گروه نیست."
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
        safeString(text) + "\n\n" +
        "از اینکه با ما در ارتباط بودی سپاسگزاریم."
    );
  } catch (error) {
    console.error("TICKET_REPLY_DELIVERY_FAILED", ticket.id, error.message);
    await sendMessage(chatId, "ارسال پاسخ به کاربر ناموفق بود. شناسه کاربر یا دسترسی ربات را بررسی کن.");
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
  await sendMessage(chatId, "✅ پاسخ به کاربر ارسال شد.", {
    keyboard: REPLY_KEYBOARD,
    inline: [
      [{ text: "🎫 مشاهده تیکت", callback_data: "ticket:" + ticket.id }],
      [{ text: "📚 فهرست تیکت‌ها", callback_data: "admin:tickets" }]
    ]
  });
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
    "وضعیت تیکت #" + ticket.id + " به «" + (ticket.status === "closed" ? "بسته‌شده" : "باز") + "» تغییر کرد.",
    {
      keyboard: REPLY_KEYBOARD,
      inline: [[{ text: "🎫 مشاهده تیکت", callback_data: "ticket:" + ticket.id }]]
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
    await sendTicketReply(chatId, state.ticketId, text);
    return;
  }

  if (state.step === "quota") {
    const value = safeString(text).trim();
    const dailyMatch = value.match(/^روزانه\s+(\d+)$/);
    const monthlyMatch = value.match(/^ماهانه\s+(\d+)$/);

    if (!dailyMatch && !monthlyMatch) {
      await sendMessage(chatId, "فرمت درست نیست. نمونه:\nروزانه 25\nیا\nماهانه 400");
      return;
    }

    const amount = Number((dailyMatch || monthlyMatch)[1]);
    if (!Number.isInteger(amount) || amount < 1 || amount > 100000) {
      await sendMessage(chatId, "عدد باید بین ۱ تا ۱۰۰۰۰۰ باشد.");
      return;
    }

    if (dailyMatch) await redis("SET", KEY.configDaily, String(amount));
    else await redis("SET", KEY.configMonthly, String(amount));

    await clearState(chatId);
    await sendMessage(chatId, "✅ سهمیه جدید ذخیره شد: " + amount, {
      keyboard: REPLY_KEYBOARD,
      inline: [[{ text: "🎟 مدیریت سهمیه‌ها", callback_data: "admin:quota" }]]
    });
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
        "حالا سؤال یا درخواستت را بنویس. تاریخچه گفت‌وگوهای قبلی حذف نشده است.",
      { keyboard: REPLY_KEYBOARD }
    );
    return;
  }

  if (data === "history") return showHistory(chatId);
  if (data === "account") return showAccount(chatId);
  if (data === "support") return beginSupport(chatId);

  if (data.startsWith("admin:") || data.startsWith("ticket:") ||
      data.startsWith("ticketreply:") || data.startsWith("ticketclose:")) {
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

    if (data === "admin:logout") {
      await redis("DEL", KEY.adminAuth(chatId));
      await clearState(chatId);
      await sendMessage(chatId, "از پنل مدیریت خارج شدی. 🔒", {
        keyboard: REPLY_KEYBOARD
      });
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

async function handleGroupMessage(message) {
  const chatId = String(message.chat?.id || "");
  const senderId = String(message.from?.id || "");
  const text = safeString(message.text).trim();

  if (!text.startsWith("/set_support_group")) return;

  if (!CONFIG.ADMIN_ID || senderId !== CONFIG.ADMIN_ID) {
    return;
  }

  await redis("SET", KEY.supportGroup, chatId);
  await sendMessage(
    chatId,
    "✅ گروه پشتیبانی با موفقیت تنظیم شد.\n\n" +
      "تیکت‌های جدید به این گروه ارسال می‌شوند.\n" +
      "برای پاسخ به کاربران، مدیر باید از پنل خصوصی ربات استفاده کند؛ پاسخ با Reply به پیام گروه لازم نیست."
  );
}

async function handlePrivateMessage(message) {
  const chatId = String(message.chat?.id || "");
  const text = safeString(message.text).trim();

  if (!chatId) return;

  if (text === "/start" || text === "🔄 شروع مجدد") {
    await clearState(chatId);
    await startCommand(chatId);
    return;
  }

  if (text === "/set_support_group") {
    await sendMessage(chatId, "این دستور را در گروه پشتیبانی ارسال کن، نه در گفت‌وگوی خصوصی.");
    return;
  }

  if (text === "مدیریت ۱۰۰۱") {
    if (chatId === CONFIG.ADMIN_ID) await beginAdminLogin(chatId);
    return;
  }

  const state = await getState(chatId);

  if (text === "لغو") {
    if (state) {
      if (state.flow === "registration") return cancelRegistration(chatId, state);
      await clearState(chatId);
      await sendMessage(chatId, "عملیات لغو شد.", { keyboard: REPLY_KEYBOARD });
      return;
    }

    await sendMessage(chatId, "عملیاتی برای لغو وجود ندارد.", { keyboard: REPLY_KEYBOARD });
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
      await sendMessage(chatId, "پیام پشتیبانی حداکثر ۳۰۰۰ نویسه می‌تواند باشد. لطفاً کوتاه‌ترش کن.");
      return;
    }
    return createTicket(chatId, text);
  }

  if (state?.flow === "admin") {
    return handleAdminState(chatId, text, state);
  }

  if (text.startsWith("/")) {
    await sendMessage(chatId, "این دستور شناخته نشد. برای دیدن امکانات، /start را بفرست.", {
      keyboard: REPLY_KEYBOARD
    });
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

async function setupWebhook(res) {
  if (!CONFIG.BALE_TOKEN || !CONFIG.APP_URL || !CONFIG.WEBHOOK_SECRET) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({
      ok: false,
      message: "BALE_BOT_TOKEN، APP_BASE_URL و BALE_WEBHOOK_SECRET باید تنظیم شوند."
    }));
    return;
  }

  const webhookUrl =
    CONFIG.APP_URL + "/api/webhook?secret=" + encodeURIComponent(CONFIG.WEBHOOK_SECRET);

  try {
    const result = await sendBale("setWebhook", { url: webhookUrl });
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({
      ok: true,
      message: "درخواست ثبت Webhook ارسال شد. پاسخ سرویس بله:",
      result
    }));
  } catch (error) {
    console.error("WEBHOOK_SETUP_FAILED", error.message);
    res.statusCode = 502;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({
      ok: false,
      message: "ثبت Webhook ناموفق بود. توکن ربات و پشتیبانی API بله را بررسی کن."
    }));
  }
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  const url = getRequestUrl(req);

  if (req.method === "GET") {
    const setupValue = url.searchParams.get("setup");
    if (setupValue && CONFIG.SETUP_SECRET && constantTimeEqual(setupValue, CONFIG.SETUP_SECRET)) {
      return setupWebhook(res);
    }

    if (url.searchParams.get("secret") && CONFIG.WEBHOOK_SECRET &&
        constantTimeEqual(url.searchParams.get("secret"), CONFIG.WEBHOOK_SECRET)) {
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify({
        ok: true,
        service: "bale-chatgpt-assistant",
        message: "Webhook endpoint is reachable."
      }));
      return;
    }

    res.statusCode = 403;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ ok: false, message: "دسترسی مجاز نیست." }));
    return;
  }

  if (req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("Allow", "GET, POST");
    res.end("Method Not Allowed");
    return;
  }

  if (!CONFIG.WEBHOOK_SECRET ||
      !constantTimeEqual(url.searchParams.get("secret"), CONFIG.WEBHOOK_SECRET)) {
    res.statusCode = 401;
    res.end("Unauthorized");
    return;
  }

  const update = parseBody(req.body);

  try {
    await processUpdate(update);
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ ok: true }));
  } catch (error) {
    console.error("UPDATE_PROCESSING_FAILED", error.message);
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ ok: false, message: "update_processing_failed" }));
  }
};
