'use strict';

/*
 * CHATGPT BALE BOT
 * Vercel Serverless - api/webhook.js
 *
 * Required Environment Variables:
 * BALE_BOT_TOKEN
 * UPSTASH_REDIS_REST_URL
 * UPSTASH_REDIS_REST_TOKEN
 * OPENAI_API_KEY
 * OPENAI_MODEL
 * AI_BASE_URL
 * ADMIN_USER_ID
 * ADMIN_PASSWORD_1
 * ADMIN_PASSWORD_2
 * BALE_WEBHOOK_SECRET
 * DAILY_QUOTA
 * MONTHLY_QUOTA
 * APP_BASE_URL
 *
 * Optional:
 * TAVILY_API_KEY
 * WEBHOOK_SETUP_SECRET
 */

const https = require('https');

const ENV = {
  BALE_TOKEN: process.env.BALE_BOT_TOKEN,
  REDIS_URL: (process.env.UPSTASH_REDIS_REST_URL || '').replace(/\/+$/, ''),
  REDIS_TOKEN: process.env.UPSTASH_REDIS_REST_TOKEN,
  AI_KEY: process.env.OPENAI_API_KEY,
  AI_MODEL: process.env.OPENAI_MODEL || 'gpt-4o-mini',
  AI_URL: (process.env.AI_BASE_URL || 'https://api.gapgpt.app/v1').replace(/\/+$/, ''),
  ADMIN_ID: String(process.env.ADMIN_USER_ID || ''),
  ADMIN_PASS_1: process.env.ADMIN_PASSWORD_1,
  ADMIN_PASS_2: process.env.ADMIN_PASSWORD_2,
  WEBHOOK_SECRET: process.env.BALE_WEBHOOK_SECRET || '',
  SETUP_SECRET: process.env.WEBHOOK_SETUP_SECRET || '',
  APP_URL: (process.env.APP_BASE_URL || '').replace(/\/+$/, ''),
  DAILY_QUOTA: Math.max(1, Number(process.env.DAILY_QUOTA || 30)),
  MONTHLY_QUOTA: Math.max(1, Number(process.env.MONTHLY_QUOTA || 500)),
  TAVILY_KEY: process.env.TAVILY_API_KEY || ''
};

const PREFIX = 'rezvan_gpt:';
const MAX_TEXT = 12000;
const MAX_HISTORY = 24;
const ADMIN_SESSION_SECONDS = 1800;
const ADMIN_LOCK_SECONDS = 3600;

const now = () => Math.floor(Date.now() / 1000);
const today = () => new Date().toISOString().slice(0, 10);
const month = () => new Date().toISOString().slice(0, 7);
const uid = () => Math.random().toString(36).slice(2, 12);
const key = (...parts) => PREFIX + parts.map(String).join(':');
const trim = (value, max = MAX_TEXT) => String(value ?? '').slice(0, max);
const safeJson = (value, fallback = null) => {
  try { return JSON.parse(value); } catch { return fallback; }
};

function requiredConfig() {
  const missing = [];
  if (!ENV.BALE_TOKEN) missing.push('BALE_BOT_TOKEN');
  if (!ENV.REDIS_URL) missing.push('UPSTASH_REDIS_REST_URL');
  if (!ENV.REDIS_TOKEN) missing.push('UPSTASH_REDIS_REST_TOKEN');
  if (!ENV.AI_KEY) missing.push('OPENAI_API_KEY');
  if (!ENV.ADMIN_ID) missing.push('ADMIN_USER_ID');
  if (!ENV.ADMIN_PASS_1) missing.push('ADMIN_PASSWORD_1');
  if (!ENV.ADMIN_PASS_2) missing.push('ADMIN_PASSWORD_2');
  return missing;
}

/* -------------------- Redis -------------------- */

async function redis(command) {
  const response = await fetch(ENV.REDIS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${ENV.REDIS_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(command)
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok || data.error) {
    throw new Error(data.error || `Redis HTTP ${response.status}`);
  }

  return data.result;
}

async function get(keyName) {
  const result = await redis(['GET', keyName]);
  return result == null ? null : safeJson(result, result);
}

async function set(keyName, value, ttl) {
  const args = ['SET', keyName, typeof value === 'string' ? value : JSON.stringify(value)];
  if (ttl) args.push('EX', String(ttl));
  return redis(args);
}

async function del(keyName) {
  return redis(['DEL', keyName]);
}

async function incr(keyName, ttl) {
  const result = await redis(['INCR', keyName]);
  if (result === 1 && ttl) {
    await redis(['EXPIRE', keyName, String(ttl)]);
  }
  return Number(result);
}

async function listPush(keyName, value, max = 100) {
  await redis(['LPUSH', keyName, JSON.stringify(value)]);
  await redis(['LTRIM', keyName, '0', String(max - 1)]);
}

async function listGet(keyName, start = 0, end = 50) {
  const result = await redis(['LRANGE', keyName, String(start), String(end)]);
  return (result || []).map(item => safeJson(item, null)).filter(Boolean);
}

async function setAdd(keyName, value) {
  return redis(['SADD', keyName, String(value)]);
}

async function setMembers(keyName) {
  return (await redis(['SMEMBERS', keyName])) || [];
}

async function exists(keyName) {
  return Number(await redis(['EXISTS', keyName])) > 0;
}

/* -------------------- Bale API -------------------- */

const baleBase = `https://tapi.bale.ai/bot${ENV.BALE_TOKEN}`;

async function bale(method, payload = {}) {
  const response = await fetch(`${baleBase}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok || data.ok === false) {
    throw new Error(data.description || `Bale API error: ${response.status}`);
  }

  return data.result;
}

async function send(chatId, text, extra = {}) {
  return bale('sendMessage', {
    chat_id: chatId,
    text: trim(text),
    ...extra
  });
}

async function sendInline(chatId, text, buttons, extra = {}) {
  return send(chatId, text, {
    ...extra,
    reply_markup: {
      inline_keyboard: buttons
    }
  });
}

async function answerCallback(callbackId, text = '') {
  try {
    await bale('answerCallbackQuery', {
      callback_query_id: callbackId,
      text: trim(text, 180),
      show_alert: false
    });
  } catch {}
}

async function editMessage(chatId, messageId, text, buttons) {
  const payload = {
    chat_id: chatId,
    message_id: messageId,
    text: trim(text)
  };

  if (buttons) {
    payload.reply_markup = { inline_keyboard: buttons };
  }

  return bale('editMessageText', payload);
}

async function removeKeyboard(chatId, text) {
  return send(chatId, text, {
    reply_markup: { remove_keyboard: true }
  });
}

/* -------------------- User data -------------------- */

async function getUser(userId) {
  return get(key('user', userId));
}

async function saveUser(user) {
  user.updated_at = now();
  await set(key('user', user.id), user);
  await setAdd(key('users'), user.id);
}

async function createUser(userId, chatId, from = {}) {
  let user = await getUser(userId);
  if (user) return user;

  user = {
    id: String(userId),
    chat_id: String(chatId),
    first_name: '',
    last_name: '',
    registered: false,
    blocked: false,
    created_at: now(),
    updated_at: now(),
    active_chat: null,
    preferences: {
      tone: 'متعادل',
      answer_length: 'متوسط',
      language: 'فارسی',
      custom_instructions: ''
    }
  };

  await saveUser(user);
  await set(key('registration', userId), { step: 'first_name' });
  return user;
}

async function getRegistration(userId) {
  return get(key('registration', userId));
}

async function setRegistration(userId, state) {
  return set(key('registration', userId), state, 3600);
}

async function finishRegistration(user) {
  user.registered = true;
  user.active_chat = uid();

  await saveUser(user);
  await set(key('chat', user.id, user.active_chat), {
    id: user.active_chat,
    title: 'گفتگوی اول',
    messages: [],
    created_at: now(),
    updated_at: now()
  });

  await setAdd(key('user_chats', user.id), user.active_chat);
  await del(key('registration', user.id));
  await logEvent('registration', user.id, 'ثبت‌نام کاربر');
}

async function isBlocked(userId) {
  const user = await getUser(userId);
  return !!user?.blocked;
}

/* -------------------- Logging -------------------- */

async function logEvent(type, userId, description) {
  await listPush(key('audit'), {
    type,
    user_id: String(userId || ''),
    description: trim(description, 500),
    time: now()
  }, 300);
}

/* -------------------- Menus -------------------- */

async function mainMenu(chatId) {
  await sendInline(chatId, '🤖 **چت‌جی‌پی‌تی**\n\nیکی از بخش‌های زیر را انتخاب کنید:', [
    [
      { text: '💬 گفتگوی جدید', callback_data: 'chat:new' },
      { text: '🗂 گفتگوهای من', callback_data: 'chat:list' }
    ],
    [
      { text: '👤 حساب کاربری', callback_data: 'account' },
      { text: '⚙️ تنظیمات پاسخ', callback_data: 'settings' }
    ],
    [
      { text: '🎫 پشتیبانی', callback_data: 'support' },
      { text: '📊 سهمیه مصرف', callback_data: 'quota' }
    ],
    [
      { text: 'ℹ️ راهنما', callback_data: 'help' }
    ]
  ]);
}

async function showHelp(chatId) {
  await sendInline(chatId,
    'ℹ️ **راهنمای ربات**\n\n' +
    '• برای شروع، گفتگوی جدید را انتخاب کنید.\n' +
    '• پیام خود را ارسال کنید تا هوش مصنوعی پاسخ دهد.\n' +
    '• گفتگوهای مختلف، تاریخچه جداگانه دارند.\n' +
    '• از بخش تنظیمات می‌توانید سبک پاسخ‌ها را تغییر دهید.\n' +
    '• برای ارتباط با پشتیبانی، بخش پشتیبانی را باز کنید.\n\n' +
    'دستورها:\n' +
    '/start - شروع\n' +
    '/menu - منوی اصلی\n' +
    '/new - گفتگوی جدید\n' +
    '/cancel - لغو عملیات جاری',
    [[{ text: '↩️ منوی اصلی', callback_data: 'menu' }]]
  );
}

/* -------------------- Registration -------------------- */

async function startRegistration(chatId, userId) {
  await createUser(userId, chatId);
  const user = await getUser(userId);

  if (user?.registered) {
    await mainMenu(chatId);
    return;
  }

  await setRegistration(userId, { step: 'first_name' });
  await send(chatId,
    'سلام! 👋\n\n' +
    'به ربات چت‌جی‌پی‌تی خوش آمدید.\n' +
    'برای ساخت حساب، لطفاً نام خود را ارسال کنید.'
  );
}

async function handleRegistration(chatId, userId, text) {
  const state = await getRegistration(userId);
  if (!state) return false;

  const user = await getUser(userId);
  const value = trim(text, 60).trim();

  if (!value || value.startsWith('/')) {
    await send(chatId, 'لطفاً یک مقدار معتبر وارد کنید.');
    return true;
  }

  if (state.step === 'first_name') {
    user.first_name = value;
    await saveUser(user);
    await setRegistration(userId, { step: 'last_name' });
    await send(chatId, 'حالا نام خانوادگی خود را ارسال کنید.');
    return true;
  }

  if (state.step === 'last_name') {
    user.last_name = value;
    await finishRegistration(user);

    await send(chatId,
      `ثبت‌نام شما با موفقیت انجام شد، ${user.first_name} ${user.last_name}!\n\n` +
      'حساب شما آماده استفاده است. 🎉'
    );

    await mainMenu(chatId);
    return true;
  }

  return true;
}

/* -------------------- Conversations -------------------- */

async function getChat(userId, chatId) {
  return get(key('chat', userId, chatId));
}

async function saveChat(userId, chat) {
  chat.updated_at = now();
  await set(key('chat', userId, chat.id), chat);
}

async function createConversation(user) {
  const id = uid();
  const chat = {
    id,
    title: 'گفتگوی جدید',
    messages: [],
    created_at: now(),
    updated_at: now()
  };

  await saveChat(user.id, chat);
  await setAdd(key('user_chats', user.id), id);

  user.active_chat = id;
  await saveUser(user);
  return chat;
}

async function listConversations(userId) {
  const ids = await setMembers(key('user_chats', userId));
  const chats = [];

  for (const id of ids.slice(0, 50)) {
    const chat = await getChat(userId, id);
    if (chat) chats.push(chat);
  }

  return chats.sort((a, b) => b.updated_at - a.updated_at);
}

async function showConversations(chatId, userId) {
  const chats = await listConversations(userId);

  if (!chats.length) {
    await sendInline(chatId, 'هنوز گفتگویی ندارید.', [
      [{ text: '➕ ساخت گفتگوی جدید', callback_data: 'chat:new' }],
      [{ text: '↩️ منوی اصلی', callback_data: 'menu' }]
    ]);
    return;
  }

  const buttons = chats.slice(0, 20).map(chat => [{
    text: `${chat.id === (await getUser(userId)).active_chat ? '🟢 ' : ''}${trim(chat.title, 35)}`,
    callback_data: `chat:open:${chat.id}`
  }]);

  buttons.push([{ text: '➕ گفتگوی جدید', callback_data: 'chat:new' }]);
  buttons.push([{ text: '↩️ منوی اصلی', callback_data: 'menu' }]);

  await sendInline(chatId, '🗂 **گفتگوهای شما**\n\nبرای باز کردن گفتگو انتخاب کنید:', buttons);
}

async function showConversationOptions(chatId, userId, conversationId) {
  const chat = await getChat(userId, conversationId);
  if (!chat) {
    await send(chatId, 'این گفتگو پیدا نشد.');
    return;
  }

  const user = await getUser(userId);
  user.active_chat = conversationId;
  await saveUser(user);

  await sendInline(chatId,
    `💬 **${chat.title}**\n\nگفتگو فعال شد. پیام خود را ارسال کنید.`,
    [
      [
        { text: '✏️ تغییر نام', callback_data: `chat:rename:${conversationId}` },
        { text: '🗑 حذف گفتگو', callback_data: `chat:delete:${conversationId}` }
      ],
      [{ text: '↩️ گفتگوهای من', callback_data: 'chat:list' }]
    ]
  );
}

/* -------------------- Quotas -------------------- */

async function getQuota(userId) {
  const daily = Number(await redis(['GET', key('quota_day', userId, today())]) || 0);
  const monthly = Number(await redis(['GET', key('quota_month', userId, month())]) || 0);

  return {
    daily,
    monthly,
    daily_limit: ENV.DAILY_QUOTA,
    monthly_limit: ENV.MONTHLY_QUOTA
  };
}

async function quotaAllowed(userId) {
  if (String(userId) === ENV.ADMIN_ID) return true;

  const user = await getUser(userId);
  if (user?.unlimited) return true;

  const quota = await getQuota(userId);
  return quota.daily < quota.daily_limit && quota.monthly < quota.monthly_limit;
}

async function consumeQuota(userId) {
  if (String(userId) === ENV.ADMIN_ID) return;
  const user = await getUser(userId);
  if (user?.unlimited) return;

  await incr(key('quota_day', userId, today()), 172800);
  await incr(key('quota_month', userId, month()), 2678400);
}

async function showQuota(chatId, userId) {
  const quota = await getQuota(userId);
  const user = await getUser(userId);

  await sendInline(chatId,
    '📊 **وضعیت سهمیه شما**\n\n' +
    `مصرف امروز: ${quota.daily} از ${quota.daily_limit}\n` +
    `مصرف این ماه: ${quota.monthly} از ${quota.monthly_limit}\n` +
    `وضعیت حساب: ${user?.unlimited ? 'نامحدود' : 'عادی'}`,
    [[{ text: '↩️ منوی اصلی', callback_data: 'menu' }]]
  );
}

/* -------------------- AI provider -------------------- */

async function callAI(messages, user) {
  const systemPrompt =
    'تو یک دستیار هوشمند فارسی‌زبان هستی. پاسخ‌ها باید دقیق، مفید، روشن و صادقانه باشند. ' +
    'اگر پاسخ را نمی‌دانی، صریح بگو. اطلاعات ساختگی تولید نکن. ' +
    `لحن پاسخ: ${user.preferences?.tone || 'متعادل'}. ` +
    `طول پاسخ: ${user.preferences?.answer_length || 'متوسط'}. ` +
    `زبان پاسخ: ${user.preferences?.language || 'فارسی'}. ` +
    `دستورهای تکمیلی کاربر: ${user.preferences?.custom_instructions || 'ندارد'}.`;

  const payload = {
    model: ENV.AI_MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      ...messages
    ],
    temperature: 0.7
  };

  const response = await fetch(`${ENV.AI_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${ENV.AI_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error?.message || `AI HTTP ${response.status}`);
  }

  const answer = data.choices?.[0]?.message?.content;
  if (!answer) throw new Error('پاسخ هوش مصنوعی خالی بود.');

  return typeof answer === 'string' ? answer : JSON.stringify(answer);
}

/* -------------------- Optional web search -------------------- */

async function webSearch(query) {
  if (!ENV.TAVILY_KEY) {
    throw new Error('جستجوی وب فعال نیست؛ TAVILY_API_KEY تنظیم نشده است.');
  }

  const response = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: ENV.TAVILY_KEY,
      query: trim(query, 500),
      search_depth: 'basic',
      max_results: 5,
      include_answer: true
    })
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error('خطا در جستجوی وب.');

  return {
    answer: data.answer || '',
    results: (data.results || []).map(item => ({
      title: item.title,
      url: item.url,
      content: trim(item.content, 1200)
    }))
  };
}

/* -------------------- AI message handling -------------------- */

async function handleAIMessage(chatId, userId, text, searchMode = false) {
  const user = await getUser(userId);

  if (!user?.registered) {
    await startRegistration(chatId, userId);
    return;
  }

  if (user.blocked) {
    await send(chatId, 'دسترسی حساب شما به ربات غیرفعال شده است.');
    return;
  }

  if (!user.active_chat) {
    const newChat = await createConversation(user);
    user.active_chat = newChat.id;
  }

  if (!(await quotaAllowed(userId))) {
    await sendInline(chatId,
      '⛔ سهمیه استفاده شما به پایان رسیده است.\n\nبرای مشاهده جزئیات، دکمه زیر را انتخاب کنید.',
      [[{ text: '📊 مشاهده سهمیه', callback_data: 'quota' }]]
    );
    return;
  }

  const chat = await getChat(userId, user.active_chat);
  if (!chat) {
    const newChat = await createConversation(user);
    user.active_chat = newChat.id;
    await saveUser(user);
  }

  const activeChat = await getChat(userId, user.active_chat);

  let prompt = text;

  if (searchMode) {
    try {
      const search = await webSearch(text);
      prompt =
        'این اطلاعات از جستجوی وب به دست آمده‌اند. آن‌ها را بررسی و خلاصه کن. ' +
        'در صورت وجود منبع، لینک آن را در پاسخ بیاور.\n\n' +
        JSON.stringify(search);
    } catch (error) {
      await send(chatId, `⚠️ ${error.message}`);
      return;
    }
  }

  activeChat.messages.push({
    role: 'user',
    content: prompt
  });

  activeChat.messages = activeChat.messages.slice(-MAX_HISTORY);

  await send(chatId, '⏳ در حال پردازش پیام شما...');
  const statusMessageId = null;

  try {
    const answer = await callAI(activeChat.messages, user);

    activeChat.messages.push({
      role: 'assistant',
      content: answer
    });

    activeChat.messages = activeChat.messages.slice(-MAX_HISTORY);

    if (activeChat.title === 'گفتگوی جدید' || activeChat.title === 'گفتگوی اول') {
      activeChat.title = trim(text, 35).replace(/\n/g, ' ') || 'گفتگوی جدید';
    }

    await saveChat(userId, activeChat);
    await consumeQuota(userId);

    await sendLongText(chatId, answer);
    await logEvent('ai_message', userId, 'پاسخ هوش مصنوعی ارسال شد.');
  } catch (error) {
    activeChat.messages.pop();
    await saveChat(userId, activeChat);

    await send(chatId,
      '❌ در دریافت پاسخ از هوش مصنوعی خطایی رخ داد.\n\n' +
      'لطفاً کمی بعد دوباره تلاش کنید.\n' +
      `شناسه خطا: ${uid()}`
    );

    console.error('AI ERROR:', error.message);
  }
}

async function sendLongText(chatId, text) {
  const value = String(text || '');
  const limit = 3800;

  if (value.length <= limit) {
    await send(chatId, value);
    return;
  }

  for (let i = 0; i < value.length; i += limit) {
    await send(chatId, value.slice(i, i + limit));
  }
}

/* -------------------- Preferences -------------------- */

async function showSettings(chatId, userId) {
  const user = await getUser(userId);
  const p = user.preferences || {};

  await sendInline(chatId,
    '⚙️ **تنظیمات پاسخ‌ها**\n\n' +
    `لحن فعلی: ${p.tone}\n` +
    `طول پاسخ: ${p.answer_length}\n` +
    `زبان: ${p.language}\n` +
    `دستور شخصی: ${p.custom_instructions || 'ثبت نشده'}`,
    [
      [
        { text: '🎭 تغییر لحن', callback_data: 'settings:tone' },
        { text: '📏 طول پاسخ', callback_data: 'settings:length' }
      ],
      [
        { text: '🌐 زبان پاسخ', callback_data: 'settings:language' },
        { text: '📝 دستور شخصی', callback_data: 'settings:custom' }
      ],
      [{ text: '↩️ منوی اصلی', callback_data: 'menu' }]
    ]
  );
}

async function updatePreference(userId, field, value) {
  const user = await getUser(userId);
  user.preferences = user.preferences || {};
  user.preferences[field] = value;
  await saveUser(user);
}

/* -------------------- Account -------------------- */

async function showAccount(chatId, userId) {
  const user = await getUser(userId);
  const chats = await listConversations(userId);

  await sendInline(chatId,
    '👤 **حساب کاربری**\n\n' +
    `نام: ${user.first_name || '-'}\n` +
    `نام خانوادگی: ${user.last_name || '-'}\n` +
    `شناسه بله: ${user.id}\n` +
    `تعداد گفتگوها: ${chats.length}\n` +
    `تاریخ عضویت: ${new Date(user.created_at * 1000).toLocaleDateString('fa-IR')}`,
    [[{ text: '↩️ منوی اصلی', callback_data: 'menu' }]]
  );
}

/* -------------------- Support tickets -------------------- */

async function createTicket(userId, message) {
  const id = uid();
  const ticket = {
    id,
    user_id: String(userId),
    message: trim(message, 3000),
    status: 'open',
    replies: [],
    created_at: now(),
    updated_at: now()
  };

  await set(key('ticket', id), ticket);
  await setAdd(key('tickets'), id);
  await setAdd(key('user_tickets', userId), id);

  return ticket;
}

async function showSupport(chatId, userId) {
  await sendInline(chatId,
    '🎫 **پشتیبانی**\n\nبرای ارسال درخواست پشتیبانی، گزینه زیر را انتخاب کنید.',
    [
      [{ text: '✉️ ثبت درخواست جدید', callback_data: 'support:new' }],
      [{ text: '📂 درخواست‌های من', callback_data: 'support:list' }],
      [{ text: '↩️ منوی اصلی', callback_data: 'menu' }]
    ]
  );
}

async function showUserTickets(chatId, userId) {
  const ids = await setMembers(key('user_tickets', userId));
  const buttons = [];

  for (const id of ids.slice(0, 15)) {
    const ticket = await get(key('ticket', id));
    if (ticket) {
      buttons.push([{
        text: `درخواست ${id} - ${ticket.status === 'open' ? 'باز' : 'بسته'}`,
        callback_data: `ticket:view:${id}`
      }]);
    }
  }

  buttons.push([{ text: '↩️ بازگشت', callback_data: 'support' }]);

  await sendInline(chatId,
    buttons.length > 1 ? '📂 درخواست‌های پشتیبانی شما:' : 'درخواستی ثبت نشده است.',
    buttons
  );
}

/* -------------------- Admin authentication -------------------- */

async function adminIsLoggedIn(userId) {
  if (String(userId) !== ENV.ADMIN_ID) return false;
  const session = await get(key('admin_session', userId));
  return !!session && session.expires_at > now();
}

async function startAdminLogin(chatId, userId) {
  if (String(userId) !== ENV.ADMIN_ID) {
    await send(chatId, '⛔ دسترسی غیرمجاز.');
    return;
  }

  const lock = await get(key('admin_lock', userId));
  if (lock && lock.until > now()) {
    await send(chatId, '⛔ ورود مدیریت موقتاً قفل شده است.');
    return;
  }

  await set(key('admin_login', userId), { step: 1 }, 300);
  await send(chatId, '🔐 ورود مدیریت\n\nرمز عبور اول را ارسال کنید.');
}

async function handleAdminLogin(chatId, userId, text) {
  if (String(userId) !== ENV.ADMIN_ID) return false;

  const state = await get(key('admin_login', userId));
  if (!state) return false;

  if (state.step === 1) {
    if (text !== ENV.ADMIN_PASS_1) {
      await adminLoginFailed(chatId, userId);
      return true;
    }

    await set(key('admin_login', userId), { step: 2 }, 300);
    await send(chatId, 'رمز اول تأیید شد.\n\nرمز عبور دوم را ارسال کنید.');
    return true;
  }

  if (state.step === 2) {
    if (text !== ENV.ADMIN_PASS_2) {
      await adminLoginFailed(chatId, userId);
      return true;
    }

    await del(key('admin_login', userId));
    await del(key('admin_failures', userId));
    await set(key('admin_session', userId), {
      created_at: now(),
      expires_at: now() + ADMIN_SESSION_SECONDS
    }, ADMIN_SESSION_SECONDS);

    await logEvent('admin_login', userId, 'ورود موفق مدیریت');
    await adminMenu(chatId);
    return true;
  }

  return true;
}

async function adminLoginFailed(chatId, userId) {
  const failures = await incr(key('admin_failures', userId), ADMIN_LOCK_SECONDS);

  if (failures >= 8) {
    await set(key('admin_lock', userId), {
      until: now() + ADMIN_LOCK_SECONDS
    }, ADMIN_LOCK_SECONDS);

    await del(key('admin_login', userId));
    await send(chatId, '⛔ تعداد تلاش‌های ناموفق بیش از حد مجاز است. ورود به مدت یک ساعت قفل شد.');
  } else {
    await send(chatId, `❌ رمز اشتباه است. تلاش ناموفق ${failures} از 8.`);
  }
}

async function adminMenu(chatId) {
  await sendInline(chatId, '🛡 **پنل مدیریت**\n\nبخش موردنظر را انتخاب کنید:', [
    [
      { text: '📊 آمار ربات', callback_data: 'admin:stats' },
      { text: '👥 کاربران', callback_data: 'admin:users' }
    ],
    [
      { text: '🎫 درخواست‌های پشتیبانی', callback_data: 'admin:tickets' },
      { text: '📢 پیام همگانی', callback_data: 'admin:broadcast' }
    ],
    [
      { text: '🔧 وضعیت سیستم', callback_data: 'admin:status' },
      { text: '📜 گزارش فعالیت', callback_data: 'admin:audit' }
    ],
    [{ text: '🚪 خروج از مدیریت', callback_data: 'admin:logout' }]
  ]);
}

async function adminStats(chatId) {
  const users = await setMembers(key('users'));
  const tickets = await setMembers(key('tickets'));
  let active = 0;
  let blocked = 0;

  for (const id of users) {
    const user = await getUser(id);
    if (user?.blocked) blocked++;
    if (user?.registered) active++;
  }

  await sendInline(chatId,
    '📊 **آمار ربات**\n\n' +
    `کل کاربران: ${users.length}\n` +
    `کاربران ثبت‌نام‌شده: ${active}\n` +
    `کاربران مسدود: ${blocked}\n` +
    `کل درخواست‌های پشتیبانی: ${tickets.length}`,
    [[{ text: '↩️ پنل مدیریت', callback_data: 'admin:menu' }]]
  );
}

async function adminUsers(chatId, page = 0) {
  const ids = await setMembers(key('users'));
  const start = page * 10;
  const selected = ids.slice(start, start + 10);
  const buttons = [];

  for (const id of selected) {
    const user = await getUser(id);
    if (!user) continue;

    buttons.push([{
      text: `${user.blocked ? '🚫' : '👤'} ${user.first_name || 'بدون نام'} ${user.last_name || ''} | ${id}`,
      callback_data: `admin:user:${id}`
    }]);
  }

  const nav = [];
  if (page > 0) {
    nav.push({ text: '⬅️ قبلی', callback_data: `admin:users:${page - 1}` });
  }
  if (start + 10 < ids.length) {
    nav.push({ text: 'بعدی ➡️', callback_data: `admin:users:${page + 1}` });
  }
  if (nav.length) buttons.push(nav);

  buttons.push([{ text: '↩️ پنل مدیریت', callback_data: 'admin:menu' }]);

  await sendInline(chatId,
    `👥 **مدیریت کاربران**\nصفحه ${page + 1} از ${Math.max(1, Math.ceil(ids.length / 10))}`,
    buttons
  );
}

async function adminUserDetails(chatId, userId) {
  const user = await getUser(userId);
  if (!user) {
    await send(chatId, 'کاربر پیدا نشد.');
    return;
  }

  await sendInline(chatId,
    '👤 **اطلاعات کاربر**\n\n' +
    `شناسه: ${user.id}\n` +
    `نام: ${user.first_name} ${user.last_name}\n` +
    `ثبت‌نام: ${user.registered ? 'بله' : 'خیر'}\n` +
    `مسدود: ${user.blocked ? 'بله' : 'خیر'}\n` +
    `سهمیه نامحدود: ${user.unlimited ? 'بله' : 'خیر'}`,
    [
      [
        { text: user.blocked ? '✅ رفع مسدودی' : '🚫 مسدود کردن', callback_data: `admin:block:${userId}` },
        { text: '♾ سهمیه نامحدود', callback_data: `admin:unlimited:${userId}` }
      ],
      [{ text: '✉️ ارسال پیام خصوصی', callback_data: `admin:message:${userId}` }],
      [{ text: '↩️ کاربران', callback_data: 'admin:users' }]
    ]
  );
}

async function adminTickets(chatId) {
  const ids = await setMembers(key('tickets'));
  const buttons = [];

  for (const id of ids.slice(0, 20)) {
    const ticket = await get(key('ticket', id));
    if (!ticket) continue;

    buttons.push([{
      text: `${ticket.status === 'open' ? '🟢' : '⚪'} ${id} | ${ticket.user_id}`,
      callback_data: `admin:ticket:${id}`
    }]);
  }

  buttons.push([{ text: '↩️ پنل مدیریت', callback_data: 'admin:menu' }]);
  await sendInline(chatId, '🎫 **درخواست‌های پشتیبانی**', buttons);
}

async function adminTicketDetails(chatId, ticketId) {
  const ticket = await get(key('ticket', ticketId));
  if (!ticket) {
    await send(chatId, 'درخواست پیدا نشد.');
    return;
  }

  await sendInline(chatId,
    `🎫 **درخواست ${ticket.id}**\n\n` +
    `شناسه کاربر: ${ticket.user_id}\n` +
    `وضعیت: ${ticket.status}\n\n` +
    `متن درخواست:\n${ticket.message}\n\n` +
    `تعداد پاسخ‌ها: ${ticket.replies.length}`,
    [
      [{ text: '✍️ پاسخ به کاربر', callback_data: `admin:reply:${ticketId}` }],
      [{ text: ticket.status === 'open' ? '🔒 بستن درخواست' : '🔓 بازگشایی', callback_data: `admin:ticketstatus:${ticketId}` }],
      [{ text: '↩️ درخواست‌ها', callback_data: 'admin:tickets' }]
    ]
  );
}

async function adminStatus(chatId) {
  const missing = requiredConfig();

  await sendInline(chatId,
    '🔧 **وضعیت پیکربندی**\n\n' +
    `اتصال توکن بله: ${ENV.BALE_TOKEN ? 'تنظیم شده' : 'تنظیم نشده'}\n` +
    `اتصال Redis: ${ENV.REDIS_URL && ENV.REDIS_TOKEN ? 'تنظیم شده' : 'تنظیم نشده'}\n` +
    `کلید هوش مصنوعی: ${ENV.AI_KEY ? 'تنظیم شده' : 'تنظیم نشده'}\n` +
    `مدل: ${ENV.AI_MODEL}\n` +
    `جستجوی وب: ${ENV.TAVILY_KEY ? 'فعال' : 'غیرفعال'}\n` +
    `تنظیمات ناقص: ${missing.length ? missing.join(', ') : 'ندارد'}`,
    [[{ text: '↩️ پنل مدیریت', callback_data: 'admin:menu' }]]
  );
}

async function adminAudit(chatId) {
  const logs = await listGet(key('audit'), 0, 15);
  const text = logs.map(item =>
    `• ${new Date(item.time * 1000).toLocaleString('fa-IR')} | ${item.type} | ${item.user_id} | ${item.description}`
  ).join('\n');

  await sendInline(chatId,
    `📜 **گزارش فعالیت‌ها**\n\n${text || 'گزارشی ثبت نشده است.'}`,
    [[{ text: '↩️ پنل مدیریت', callback_data: 'admin:menu' }]]
  );
}

/* -------------------- Admin actions -------------------- */

async function handleAdminAction(chatId, userId, data) {
  if (!(await adminIsLoggedIn(userId))) {
    await send(chatId, '⛔ نشست مدیریت معتبر نیست. دوباره وارد شوید.');
    return;
  }

  if (data === 'admin:menu') return adminMenu(chatId);
  if (data === 'admin:stats') return adminStats(chatId);
  if (data === 'admin:users') return adminUsers(chatId, 0);
  if (data.startsWith('admin:users:')) return adminUsers(chatId, Number(data.split(':')[2]) || 0);
  if (data === 'admin:tickets') return adminTickets(chatId);
  if (data === 'admin:status') return adminStatus(chatId);
  if (data === 'admin:audit') return adminAudit(chatId);

  if (data === 'admin:logout') {
    await del(key('admin_session', userId));
    await send(chatId, 'از پنل مدیریت خارج شدید.');
    return;
  }

  if (data.startsWith('admin:user:')) {
    return adminUserDetails(chatId, data.slice('admin:user:'.length));
  }

  if (data.startsWith('admin:block:')) {
    const targetId = data.slice('admin:block:'.length);
    const target = await getUser(targetId);
    if (!target) return send(chatId, 'کاربر پیدا نشد.');

    target.blocked = !target.blocked;
    await saveUser(target);
    await logEvent('admin_block', userId, `تغییر وضعیت مسدودی کاربر ${targetId}`);

    await send(chatId, target.blocked ? 'کاربر مسدود شد.' : 'مسدودی کاربر برداشته شد.');
    return adminUserDetails(chatId, targetId);
  }

  if (data.startsWith('admin:unlimited:')) {
    const targetId = data.slice('admin:unlimited:'.length);
    const target = await getUser(targetId);
    if (!target) return send(chatId, 'کاربر پیدا نشد.');

    target.unlimited = !target.unlimited;
    await saveUser(target);
    await logEvent('admin_unlimited', userId, `تغییر سهمیه کاربر ${targetId}`);

    await send(chatId, target.unlimited ? 'سهمیه نامحدود فعال شد.' : 'سهمیه نامحدود غیرفعال شد.');
    return adminUserDetails(chatId, targetId);
  }

  if (data.startsWith('admin:message:')) {
    const targetId = data.slice('admin:message:'.length);
    await set(key('state', userId), {
      type: 'admin_message',
      target_id: targetId
    }, 600);
    return send(chatId, 'متن پیام خصوصی برای این کاربر را ارسال کنید.');
  }

  if (data.startsWith('admin:ticket:')) {
    return adminTicketDetails(chatId, data.slice('admin:ticket:'.length));
  }

  if (data.startsWith('admin:reply:')) {
    const ticketId = data.slice('admin:reply:'.length);
    await set(key('state', userId), {
      type: 'admin_ticket_reply',
      ticket_id: ticketId
    }, 600);
    return send(chatId, 'متن پاسخ به درخواست را ارسال کنید.');
  }

  if (data.startsWith('admin:ticketstatus:')) {
    const ticketId = data.slice('admin:ticketstatus:'.length);
    const ticket = await get(key('ticket', ticketId));
    if (!ticket) return send(chatId, 'درخواست پیدا نشد.');

    ticket.status = ticket.status === 'open' ? 'closed' : 'open';
    ticket.updated_at = now();
    await set(key('ticket', ticketId), ticket);

    await send(chatId, `وضعیت درخواست تغییر کرد: ${ticket.status}`);
    await send(ticket.user_id, `وضعیت درخواست پشتیبانی ${ticket.id} به ${ticket.status === 'open' ? 'باز' : 'بسته'} تغییر کرد.`);
    return adminTicketDetails(chatId, ticketId);
  }

  if (data === 'admin:broadcast') {
    await set(key('state', userId), { type: 'admin_broadcast' }, 600);
    return send(chatId, 'متن پیام همگانی را ارسال کنید.');
  }
}

/* -------------------- Text states -------------------- */

async function handleState(chatId, userId, text) {
  const state = await get(key('state', userId));
  if (!state) return false;

  if (state.type === 'rename_chat') {
    const user = await getUser(userId);
    const chat = await getChat(userId, state.chat_id);

    if (!chat) {
      await del(key('state', userId));
      await send(chatId, 'گفتگو پیدا نشد.');
      return true;
    }

    chat.title = trim(text, 50);
    await saveChat(userId, chat);
    await del(key('state', userId));
    await send(chatId, 'نام گفتگو تغییر کرد.');
    return true;
  }

  if (state.type === 'support_new') {
    const ticket = await createTicket(userId, text);
    await del(key('state', userId));

    await sendInline(chatId,
      `✅ درخواست پشتیبانی شما ثبت شد.\n\nشناسه درخواست: ${ticket.id}`,
      [[{ text: '↩️ منوی اصلی', callback_data: 'menu' }]]
    );

    if (ENV.ADMIN_ID) {
      await sendInline(ENV.ADMIN_ID,
        `🎫 درخواست پشتیبانی جدید\n\nشناسه: ${ticket.id}\nکاربر: ${userId}\n\n${ticket.message}`,
        [[{ text: 'مشاهده درخواست', callback_data: `admin:ticket:${ticket.id}` }]]
      ).catch(() => {});
    }

    return true;
  }

  if (state.type === 'settings_custom') {
    await updatePreference(userId, 'custom_instructions', trim(text, 1000));
    await del(key('state', userId));
    await send(chatId, 'دستور شخصی شما ذخیره شد.');
    await showSettings(chatId, userId);
    return true;
  }

  if (state.type === 'admin_message') {
    if (!(await adminIsLoggedIn(userId))) return true;

    const target = await getUser(state.target_id);
    if (!target) {
      await send(chatId, 'کاربر پیدا نشد.');
    } else {
      await send(target.chat_id, `📩 پیام مدیریت:\n\n${trim(text, 3000)}`);
      await send(chatId, 'پیام ارسال شد.');
      await logEvent('admin_private_message', userId, `پیام به ${state.target_id}`);
    }

    await del(key('state', userId));
    return true;
  }

  if (state.type === 'admin_ticket_reply') {
    if (!(await adminIsLoggedIn(userId))) return true;

    const ticket = await get(key('ticket', state.ticket_id));
    if (!ticket) {
      await send(chatId, 'درخواست پیدا نشد.');
    } else {
      ticket.replies.push({
        from: 'admin',
        message: trim(text, 3000),
        time: now()
      });

      ticket.updated_at = now();
      await set(key('ticket', ticket.id), ticket);

      const target = await getUser(ticket.user_id);
      if (target) {
        await send(target.chat_id,
          `📩 پاسخ پشتیبانی\n\nدرخواست: ${ticket.id}\n\n${trim(text, 3000)}`
        );
      }

      await send(chatId, 'پاسخ ارسال شد.');
    }

    await del(key('state', userId));
    return true;
  }

  if (state.type === 'admin_broadcast') {
    if (!(await adminIsLoggedIn(userId))) return true;

    const ids = await setMembers(key('users'));
    await del(key('state', userId));

    await send(chatId, `📢 ارسال پیام همگانی آغاز شد.\nتعداد کاربران: ${ids.length}`);

    let sent = 0;
    let failed = 0;

    for (const id of ids) {
      const user = await getUser(id);
      if (!user || !user.registered || user.blocked) continue;

      try {
        await send(user.chat_id, trim(text, 3000));
        sent++;
      } catch {
        failed++;
      }

      if ((sent + failed) % 20 === 0) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    await logEvent('broadcast', userId, `ارسال موفق: ${sent}، ناموفق: ${failed}`);
    await send(chatId, `✅ ارسال همگانی پایان یافت.\n\nموفق: ${sent}\nناموفق: ${failed}`);
    return true;
  }

  return false;
}

/* -------------------- Callback handler -------------------- */

async function handleCallback(callback) {
  const data = String(callback.data || '');
  const userId = String(callback.from?.id || '');
  const chatId = String(callback.message?.chat?.id || userId);

  await answerCallback(callback.id);

  if (!userId) return;

  if (data.startsWith('admin:')) {
    return handleAdminAction(chatId, userId, data);
  }

  const user = await getUser(userId);

  if (!user?.registered && data !== 'menu') {
    await startRegistration(chatId, userId);
    return;
  }

  if (data === 'menu') return mainMenu(chatId);
  if (data === 'help') return showHelp(chatId);
  if (data === 'account') return showAccount(chatId, userId);
  if (data === 'quota') return showQuota(chatId, userId);
  if (data === 'settings') return showSettings(chatId, userId);
  if (data === 'support') return showSupport(chatId, userId);
  if (data === 'support:new') {
    await set(key('state', userId), { type: 'support_new' }, 1800);
    return send(chatId, 'لطفاً متن درخواست خود را ارسال کنید.');
  }
  if (data === 'support:list') return showUserTickets(chatId, userId);

  if (data === 'chat:new') {
    const chat = await createConversation(user);
    return sendInline(chatId,
      '✅ گفتگوی جدید ساخته شد.\n\nپیام خود را ارسال کنید.',
      [[{ text: '🗂 گفتگوهای من', callback_data: 'chat:list' }]]
    );
  }

  if (data === 'chat:list') return showConversations(chatId, userId);

  if (data.startsWith('chat:open:')) {
    return showConversationOptions(chatId, userId, data.slice('chat:open:'.length));
  }

  if (data.startsWith('chat:rename:')) {
    const chatIdToRename = data.slice('chat:rename:'.length);
    await set(key('state', userId), {
      type: 'rename_chat',
      chat_id: chatIdToRename
    }, 600);
    return send(chatId, 'نام جدید گفتگو را ارسال کنید.');
  }

  if (data.startsWith('chat:delete:')) {
    const chatIdToDelete = data.slice('chat:delete:'.length);
    await del(key('chat', userId, chatIdToDelete));
    await redis(['SREM', key('user_chats', userId), chatIdToDelete]);

    const current = await getUser(userId);
    if (current.active_chat === chatIdToDelete) {
      const remaining = await listConversations(userId);
      current.active_chat = remaining[0]?.id || null;

      if (!current.active_chat) {
        const newChat = await createConversation(current);
        current.active_chat = newChat.id;
      }

      await saveUser(current);
    }

    return send(chatId, 'گفتگو حذف شد.');
  }

  if (data === 'settings:tone') {
    return sendInline(chatId, 'لحن پاسخ را انتخاب کنید:', [
      [
        { text: 'متعادل', callback_data: 'pref:tone:متعادل' },
        { text: 'رسمی', callback_data: 'pref:tone:رسمی' }
      ],
      [
        { text: 'دوستانه', callback_data: 'pref:tone:دوستانه' },
        { text: 'تخصصی', callback_data: 'pref:tone:تخصصی' }
      ]
    ]);
  }

  if (data === 'settings:length') {
    return sendInline(chatId, 'طول پاسخ را انتخاب کنید:', [
      [
        { text: 'کوتاه', callback_data: 'pref:length:کوتاه' },
        { text: 'متوسط', callback_data: 'pref:length:متوسط' },
        { text: 'مفصل', callback_data: 'pref:length:مفصل' }
      ]
    ]);
  }

  if (data === 'settings:language') {
    return sendInline(chatId, 'زبان پاسخ را انتخاب کنید:', [
      [
        { text: 'فارسی', callback_data: 'pref:language:فارسی' },
        { text: 'English', callback_data: 'pref:language:English' }
      ]
    ]);
  }

  if (data === 'settings:custom') {
    await set(key('state', userId), { type: 'settings_custom' }, 600);
    return send(chatId, 'دستور یا توضیح دلخواه خود را برای شخصی‌سازی پاسخ‌ها ارسال کنید.');
  }

  if (data.startsWith('pref:tone:')) {
    await updatePreference(userId, 'tone', data.slice('pref:tone:'.length));
    await send(chatId, 'لحن پاسخ ذخیره شد.');
    return showSettings(chatId, userId);
  }

  if (data.startsWith('pref:length:')) {
    await updatePreference(userId, 'answer_length', data.slice('pref:length:'.length));
    await send(chatId, 'طول پاسخ ذخیره شد.');
    return showSettings(chatId, userId);
  }

  if (data.startsWith('pref:language:')) {
    await updatePreference(userId, 'language', data.slice('pref:language:'.length));
    await send(chatId, 'زبان پاسخ ذخیره شد.');
    return showSettings(chatId, userId);
  }

  if (data.startsWith('ticket:view:')) {
    const ticketId = data.slice('ticket:view:'.length);
    const ticket = await get(key('ticket', ticketId));

    if (!ticket || ticket.user_id !== userId) {
      return send(chatId, 'درخواست پیدا نشد.');
    }

    const replies = ticket.replies.map(reply =>
      `${reply.from === 'admin' ? 'پشتیبانی' : 'شما'}: ${reply.message}`
    ).join('\n\n');

    return sendInline(chatId,
      `🎫 **درخواست ${ticket.id}**\n\n` +
      `وضعیت: ${ticket.status}\n\n` +
      `${ticket.message}\n\n` +
      `پاسخ‌ها:\n${replies || 'هنوز پاسخی ثبت نشده است.'}`,
      [[{ text: '↩️ درخواست‌های من', callback_data: 'support:list' }]]
    );
  }
}

/* -------------------- Incoming messages -------------------- */

async function handleMessage(message) {
  const chatId = String(message.chat?.id || '');
  const userId = String(message.from?.id || '');
  const text = trim(message.text || '').trim();

  if (!chatId || !userId) return;

  if (message.chat?.type && message.chat.type !== 'private') {
    await send(chatId, 'این ربات فقط در گفتگوی خصوصی قابل استفاده است.');
    return;
  }

  if (await isBlocked(userId)) {
    await send(chatId, 'دسترسی شما به ربات غیرفعال شده است.');
    return;
  }

  if (text === '/start') {
    return startRegistration(chatId, userId);
  }

  if (text === '/cancel') {
    await del(key('state', userId));
    await del(key('registration', userId));
    await send(chatId, 'عملیات جاری لغو شد.');
    return;
  }

  if (text === '/admin') {
    return startAdminLogin(chatId, userId);
  }

  if (String(userId) === ENV.ADMIN_ID) {
    if (await handleAdminLogin(chatId, userId, text)) return;
  }

  if (text === '/menu') {
    const user = await getUser(userId);
    if (!user?.registered) return startRegistration(chatId, userId);
    return mainMenu(chatId);
  }

  if (text === '/new') {
    const user = await getUser(userId);
    if (!user?.registered) return startRegistration(chatId, userId);
    const chat = await createConversation(user);
    return send(chatId, 'گفتگوی جدید ساخته شد. پیام خود را ارسال کنید.');
  }

  const registrationHandled = await handleRegistration(chatId, userId, text);
  if (registrationHandled) return;

  const stateHandled = await handleState(chatId, userId, text);
  if (stateHandled) return;

  if (!text) {
    await send(chatId, 'فعلاً فقط پیام متنی پشتیبانی می‌شود.');
    return;
  }

  if (text.startsWith('/search ')) {
    return handleAIMessage(chatId, userId, text.slice(8).trim(), true);
  }

  if (text === '/search') {
    await send(chatId, 'عبارت موردنظر را بعد از دستور جستجو وارد کنید.\nمثال:\n/search آخرین اخبار فناوری');
    return;
  }

  return handleAIMessage(chatId, userId, text, false);
}

/* -------------------- Webhook -------------------- */

async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      return res.status(200).json({
        ok: true,
        service: 'ChatGPT Bale Bot',
        version: '1.0.0',
        configured: requiredConfig().length === 0
      });
    }

    if (req.method !== 'POST') {
      return res.status(405).json({ ok: false, error: 'Method not allowed' });
    }

    const missing = requiredConfig();
    if (missing.length) {
      console.error('Missing environment variables:', missing);
      return res.status(500).json({
        ok: false,
        error: 'Server configuration incomplete',
        missing
      });
    }

    if (ENV.WEBHOOK_SECRET) {
      const supplied = req.headers['x-telegram-bot-api-secret-token'] ||
        req.headers['x-bale-bot-api-secret-token'] ||
        req.headers['x-webhook-secret'];

      if (supplied !== ENV.WEBHOOK_SECRET) {
        return res.status(401).json({ ok: false, error: 'Unauthorized' });
      }
    }

    const update = req.body || {};

    if (update.callback_query) {
      await handleCallback(update.callback_query);
    } else if (update.message) {
      await handleMessage(update.message);
    }

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('WEBHOOK ERROR:', error);
    return res.status(200).json({
      ok: false,
      error: 'Internal processing error'
    });
  }
}

module.exports = handler;
