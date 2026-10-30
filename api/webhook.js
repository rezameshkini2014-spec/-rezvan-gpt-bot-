'use strict';

const crypto = require('crypto');

const ENV = process.env;
const C = {
  baleToken: ENV.BALE_BOT_TOKEN || '',
  redisUrl: (ENV.UPSTASH_REDIS_REST_URL || '').replace(/\/+$/, ''),
  redisToken: ENV.UPSTASH_REDIS_REST_TOKEN || '',
  aiKey: ENV.OPENAI_API_KEY || '',
  aiBase: (ENV.AI_BASE_URL || 'https://api.gapgpt.app/v1').replace(/\/+$/, ''),
  aiModel: ENV.OPENAI_MODEL || '',
  webhookSecret: ENV.BALE_WEBHOOK_SECRET || '',
  setupSecret: ENV.WEBHOOK_SETUP_SECRET || '',
  appUrl: (ENV.APP_BASE_URL || '').replace(/\/+$/, ''),
  adminId: String(ENV.ADMIN_USER_ID || ''),
  adminPass1: ENV.ADMIN_PASSWORD_1 || '',
  adminPass2: ENV.ADMIN_PASSWORD_2 || '',
  dailyQuota: Math.max(0, Number(ENV.DAILY_QUOTA || 20)),
  monthlyQuota: Math.max(0, Number(ENV.MONTHLY_QUOTA || 300)),
  politicalKeywords: ENV.POLITICAL_KEYWORDS || 'انتخابات|رئیس جمهور|رئیس‌جمهور|مجلس شورای اسلامی|حزب سیاسی|نامزد انتخاباتی|رقابت انتخاباتی|تبلیغات انتخاباتی|سیاستمدار'
};

const BALE_API = 'https://tapi.bale.ai/bot' + C.baleToken;

const K = {
  user: id => `user:${id}`,
  state: id => `state:${id}`,
  username: name => `username:${String(name).toLowerCase()}`,
  context: id => `context:${id}`,
  history: id => `history:${id}`,
  day: (id, d) => `quota:day:${id}:${d}`,
  month: (id, m) => `quota:month:${id}:${m}`,
  userDay: id => `user:quota:daily:${id}`,
  userMonth: id => `user:quota:monthly:${id}`,
  adminSession: id => `admin:session:${id}`,
  adminFail: id => `admin:failed:${id}`,
  adminLock: id => `admin:locked:${id}`,
  ticket: id => `ticket:${id}`,
  ticketSeq: 'ticket:sequence',
  tickets: 'tickets:all',
  users: 'users:all',
  supportGroup: 'config:support_group',
  botEnabled: 'config:bot_enabled',
  dailyConfig: 'config:daily_quota',
  monthlyConfig: 'config:monthly_quota',
  processed: id => `processed:update:${id}`,
  processing: id => `processing:update:${id}`,
  chatLock: id => `lock:chat:${id}`,
  aiRate: id => `rate:ai:${id}`,
  aiLock: id => `lock:ai:${id}`,
  broadcastIds: id => `broadcast:ids:${id}`,
  broadcastSent: id => `broadcast:sent:${id}`
};

const MENU = [
  [{ text: '💬 گفت‌وگوی جدید', callback_data: 'newchat' }],
  [{ text: '📚 تاریخچه گفتگوها', callback_data: 'history' }],
  [{ text: '👤 حساب کاربری', callback_data: 'account' }],
  [{ text: '🎧 پشتیبانی', callback_data: 'support' }],
  [{ text: '📖 راهنما', callback_data: 'help' }, { text: 'ℹ️ درباره', callback_data: 'about' }]
];

const ADMIN_MENU = [
  [{ text: '📊 آمار', callback_data: 'admin:stats' }, { text: '👥 کاربران', callback_data: 'admin:users' }],
  [{ text: '🎟 سهمیه‌ها', callback_data: 'admin:quota' }, { text: '🎫 تیکت‌ها', callback_data: 'admin:tickets' }],
  [{ text: '📨 پیام همگانی', callback_data: 'admin:broadcast' }, { text: '✉️ پیام خصوصی', callback_data: 'admin:private' }],
  [{ text: '🔌 وضعیت سرویس‌ها', callback_data: 'admin:status' }, { text: '⚙️ تنظیمات', callback_data: 'admin:settings' }],
  [{ text: '🔘 روشن / خاموش ربات', callback_data: 'admin:toggle' }],
  [{ text: '🚪 خروج', callback_data: 'admin:logout' }]
];

const REPLY = {
  keyboard: [[{ text: '🔄 شروع مجدد' }]],
  resize_keyboard: true
};

function str(v) {
  return v === undefined || v === null ? '' : String(v);
}

function clean(v, max = 3000) {
  return str(v)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .slice(0, max);
}

function nowIso() {
  return new Date().toISOString();
}

function dayKey() {
  return new Date().toISOString().slice(0, 10);
}

function monthKey() {
  return new Date().toISOString().slice(0, 7);
}

function parseJson(v, fallback = null) {
  try {
    return JSON.parse(v);
  } catch {
    return fallback;
  }
}

function timingSafe(a, b) {
  const x = Buffer.from(str(a));
  const y = Buffer.from(str(b));

  return x.length > 0 &&
    x.length === y.length &&
    crypto.timingSafeEqual(x, y);
}

function validName(v) {
  const s = clean(v, 80).trim().replace(/\s+/g, ' ');
  return s.length >= 4 && s.split(' ').length >= 2;
}

function validUsername(v) {
  return /^[a-zA-Z][a-zA-Z0-9_]{3,19}$/.test(str(v));
}

function validPassword(v) {
  return typeof v === 'string' &&
    v.length >= 8 &&
    v.length <= 128;
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');

  return {
    salt,
    hash: crypto.scryptSync(password, salt, 64).toString('hex')
  };
}

function verifyPassword(password, saved) {
  if (!saved || !saved.salt || !saved.hash) return false;

  const actual = crypto.scryptSync(password, saved.salt, 64);
  const expected = Buffer.from(saved.hash, 'hex');

  return actual.length === expected.length &&
    crypto.timingSafeEqual(actual, expected);
}

function requestUrl(req) {
  try {
    return new URL(req.url, C.appUrl || 'https://invalid.local');
  } catch {
    return new URL('https://invalid.local');
  }
}

function parseBody(body) {
  if (body && typeof body === 'object') return body;
  if (typeof body === 'string') return parseJson(body, {});
  return {};
}

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

async function redis(...args) {
  if (!C.redisUrl || !C.redisToken) {
    throw new Error('REDIS_NOT_CONFIGURED');
  }

  const response = await fetch(C.redisUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${C.redisToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(args)
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok || data.error) {
    console.error(
      'REDIS_ERROR',
      response.status,
      clean(data.error, 300)
    );

    throw new Error('REDIS_REQUEST_FAILED');
  }

  return data.result;
}

async function get(key) {
  return redis('GET', key);
}

async function set(key, value, ...opts) {
  return redis('SET', key, value, ...opts);
}

async function getObj(key) {
  const v = await get(key);
  return v ? parseJson(v) : null;
}

async function setObj(key, value, ...opts) {
  return set(key, JSON.stringify(value), ...opts);
}

async function getUser(id) {
  return getObj(K.user(id));
}

async function saveUser(id, user) {
  return setObj(K.user(id), user);
}

async function getState(id) {
  return getObj(K.state(id));
}

async function saveState(id, state, ttl = 1800) {
  return setObj(K.state(id), state, 'EX', ttl);
}

async function clearState(id) {
  return redis('DEL', K.state(id));
}

async function isBotEnabled() {
  return (await get(K.botEnabled)) !== '0';
}

async function bale(method, payload) {
  if (!C.baleToken) {
    throw new Error('BALE_BOT_TOKEN_MISSING');
  }

  const response = await fetch(`${BALE_API}/${method}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok || data.ok === false || data.error) {
    console.error(
      'BALE_API_ERROR',
      method,
      response.status,
      clean(data.description || data.error, 250)
    );

    throw new Error('BALE_API_FAILED');
  }

  return data;
}

async function send(chatId, text, options = {}) {
  const payload = {
    chat_id: chatId,
    text: clean(text, 4000)
  };

  if (options.keyboard) {
    payload.reply_markup = options.keyboard;
  }

  if (options.inline) {
    payload.reply_markup = {
      inline_keyboard: options.inline
    };
  }

  return bale('sendMessage', payload);
}

async function answerCallback(id, text = '') {
  if (!id) return;

  try {
    await bale('answerCallbackQuery', {
      callback_query_id: id,
      text: clean(text, 180),
      show_alert: false
    });
  } catch (e) {
    console.error('CALLBACK_ANSWER_FAILED', e.message);
  }
}

async function mainMenu(chatId, user) {
  const first = clean(
    str(user.name).split(/\s+/)[0] || 'دوست عزیز',
    40
  );

  return send(
    chatId,
    `سلام ${first} عزیز! 🌟\n\nبه چت‌جی‌بی‌تی خوش آمدی. از منوی زیر استفاده کن.`,
    {
      keyboard: REPLY,
      inline: MENU
    }
  );
}

async function welcome(chatId) {
  return send(
    chatId,
    'سلام! به چت‌جی‌بی‌تی خوش آمدی. 🌟\n\nبرای استفاده از ربات ابتدا حساب کاربری بساز.',
    {
      keyboard: REPLY,
      inline: [
        [{ text: '📝 ثبت‌نام', callback_data: 'register' }],
        [
          { text: '📖 راهنما', callback_data: 'help' },
          { text: 'ℹ️ درباره', callback_data: 'about' }
        ]
      ]
    }
  );
}

async function start(chatId) {
  const user = await getUser(chatId);

  if (user && user.status === 'active') {
    return mainMenu(chatId, user);
  }

  if (user && user.status === 'blocked') {
    return send(
      chatId,
      'حساب کاربری تو مسدود شده است. برای پیگیری با پشتیبانی تماس بگیر.'
    );
  }

  return welcome(chatId);
}

async function requireActive(chatId) {
  const user = await getUser(chatId);

  if (!user || user.status !== 'active') {
    await send(
      chatId,
      'برای استفاده از این بخش ابتدا ثبت‌نام کن.',
      {
        keyboard: REPLY,
        inline: [
          [{ text: '📝 ثبت‌نام', callback_data: 'register' }]
        ]
      }
    );

    return null;
  }

  user.lastActiveAt = nowIso();
  await saveUser(chatId, user);

  return user;
}

async function beginRegistration(chatId) {
  const existing = await getUser(chatId);

  if (existing && existing.status === 'active') {
    return mainMenu(chatId, existing);
  }

  await saveState(chatId, {
    flow: 'register',
    step: 'name',
    data: {}
  });

  return send(
    chatId,
    '📝 ثبت‌نام\n\nمرحله ۱ از ۵\nنام و نام خانوادگی را وارد کن.\nبرای لغو، «لغو» را بفرست.'
  );
}

async function releaseUsername(username, chatId) {
  if (!username) return;

  const key = K.username(username);

  const script =
    "if redis.call('GET',KEYS[1])==ARGV[1] then " +
    "return redis.call('DEL',KEYS[1]) else return 0 end";

  await redis(
    'EVAL',
    script,
    1,
    key,
    `pending:${chatId}`
  );
}

async function cancelFlow(chatId, state) {
  if (
    state?.flow === 'register' &&
    state.data?.username
  ) {
    await releaseUsername(
      state.data.username,
      chatId
    ).catch(() => {});
  }

  await clearState(chatId);

  const user = await getUser(chatId);

  if (user?.status === 'active') {
    return mainMenu(chatId, user);
  }

  return welcome(chatId);
}

async function registrationStep(chatId, text, state) {
  const d = state.data || {};

  if (state.step === 'name') {
    const name = clean(text, 80)
      .trim()
      .replace(/\s+/g, ' ');

    if (!validName(name)) {
      return send(
        chatId,
        'نام و نام خانوادگی کامل وارد کن؛ مثال: علی رضایی.'
      );
    }

    d.name = name;

    await saveState(chatId, {
      flow: 'register',
      step: 'username',
      data: d
    });

    return send(
      chatId,
      'مرحله ۲ از ۵\nنام کاربری انگلیسی ۴ تا ۲۰ نویسه‌ای انتخاب کن. فقط حروف انگلیسی، عدد و زیرخط مجاز است.'
    );
  }

  if (state.step === 'username') {
    const username = clean(text, 30)
      .trim()
      .replace(/^@/, '');

    if (!validUsername(username)) {
      return send(
        chatId,
        'نام کاربری معتبر نیست. با حرف انگلیسی شروع شود و ۴ تا ۲۰ نویسه داشته باشد.'
      );
    }

    const key = K.username(username);

    const reserved = await redis(
      'SET',
      key,
      `pending:${chatId}`,
      'EX',
      1800,
      'NX'
    );

    if (reserved !== 'OK') {
      const owner = await get(key);

      if (
        owner !== `pending:${chatId}` &&
        owner !== String(chatId)
      ) {
        return send(
          chatId,
          'این نام کاربری قبلاً انتخاب شده است. نام دیگری وارد کن.'
        );
      }
    }

    d.username = username;

    await saveState(chatId, {
      flow: 'register',
      step: 'password',
      data: d
    });

    return send(
      chatId,
      'مرحله ۳ از ۵\nرمز عبور انتخاب کن. رمز باید حداقل ۸ نویسه داشته باشد.'
    );
  }

  if (state.step === 'password') {
    if (!validPassword(text)) {
      return send(
        chatId,
        'رمز باید حداقل ۸ و حداکثر ۱۲۸ نویسه داشته باشد.'
      );
    }

    d.password = hashPassword(text);

    await saveState(chatId, {
      flow: 'register',
      step: 'confirm_password',
      data: d
    });

    return send(
      chatId,
      'مرحله ۴ از ۵\nرمز عبور را دوباره وارد کن تا تأیید شود.'
    );
  }

  if (state.step === 'confirm_password') {
    if (!verifyPassword(text, d.password)) {
      return send(
        chatId,
        'دو رمز یکسان نیستند. دوباره رمز را وارد کن.'
      );
    }

    await saveState(chatId, {
      flow: 'register',
      step: 'final',
      data: d
    });

    return send(
      chatId,
      `مرحله ۵ از ۵ — تأیید نهایی\n\nنام: ${d.name}\nنام کاربری: @${d.username}\nرمز عبور: به‌صورت امن و هش‌شده ذخیره می‌شود.\n\nبرای ساخت حساب، دکمه تأیید را بزن.`,
      {
        inline: [
          [
            {
              text: '✅ تأیید و ساخت حساب',
              callback_data: 'reg:confirm'
            }
          ],
          [
            {
              text: '❌ لغو',
              callback_data: 'reg:cancel'
            }
          ]
        ]
      }
    );
  }
}

async function finishRegistration(chatId) {
  const state = await getState(chatId);

  if (
    !state ||
    state.flow !== 'register' ||
    state.step !== 'final'
  ) {
    return send(
      chatId,
      'اطلاعات ثبت‌نام پیدا نشد. دوباره شروع کن.'
    );
  }

  const d = state.data || {};

  if (
    !d.name ||
    !d.username ||
    !d.password?.salt ||
    !d.password?.hash
  ) {
    return send(
      chatId,
      'اطلاعات ثبت‌نام ناقص است. دوباره ثبت‌نام کن.'
    );
  }

  const script =
    "local v=redis.call('GET',KEYS[1]); " +
    "if v and v~=ARGV[1] and v~=ARGV[2] then return 0 end; " +
    "redis.call('SET',KEYS[1],ARGV[2]); " +
    "redis.call('SADD',KEYS[2],ARGV[2]); " +
    "return 1";

  const ok = await redis(
    'EVAL',
    script,
    2,
    K.username(d.username),
    K.users,
    `pending:${chatId}`,
    String(chatId)
  );

  if (Number(ok) !== 1) {
    await clearState(chatId);

    return send(
      chatId,
      'این نام کاربری دیگر در دسترس نیست. دوباره ثبت‌نام کن.'
    );
  }

  const user = {
    id: String(chatId),
    name: d.name,
    username: d.username,
    password: d.password,
    status: 'active',
    createdAt: nowIso(),
    lastActiveAt: nowIso()
  };

  await saveUser(chatId, user);
  await clearState(chatId);
  await redis('DEL', K.context(chatId));

  return mainMenu(chatId, user);
}

async function quotaLimits(chatId) {
  const [
    globalDay,
    globalMonth,
    personalDay,
    personalMonth
  ] = await Promise.all([
    get(K.dailyConfig),
    get(K.monthlyConfig),
    get(K.userDay(chatId)),
    get(K.userMonth(chatId))
  ]);

  const d = Number(
    personalDay !== null
      ? personalDay
      : (globalDay !== null ? globalDay : C.dailyQuota)
  );

  const m = Number(
    personalMonth !== null
      ? personalMonth
      : (globalMonth !== null ? globalMonth : C.monthlyQuota)
  );

  return {
    daily: Number.isFinite(d) && d >= 0
      ? d
      : C.dailyQuota,
    monthly: Number.isFinite(m) && m >= 0
      ? m
      : C.monthlyQuota
  };
}

async function usage(chatId) {
  const [d, m, limits] = await Promise.all([
    get(K.day(chatId, dayKey())),
    get(K.month(chatId, monthKey())),
    quotaLimits(chatId)
  ]);

  const day = Number(d || 0);
  const month = Number(m || 0);

  return {
    day,
    month,
    ...limits,
    dailyLeft: Math.max(0, limits.daily - day),
    monthlyLeft: Math.max(0, limits.monthly - month)
  };
}

async function consumeQuota(chatId) {
  const limits = await quotaLimits(chatId);

  const kd = K.day(chatId, dayKey());
  const km = K.month(chatId, monthKey());

  const script =
    "local d=tonumber(redis.call('GET',KEYS[1]) or '0'); " +
    "local m=tonumber(redis.call('GET',KEYS[2]) or '0'); " +
    "local dl=tonumber(ARGV[1]); " +
    "local ml=tonumber(ARGV[2]); " +
    "if d>=dl or m>=ml then return {0,d,m} end; " +
    "d=redis.call('INCR',KEYS[1]); " +
    "m=redis.call('INCR',KEYS[2]); " +
    "redis.call('EXPIRE',KEYS[1],172800); " +
    "redis.call('EXPIRE',KEYS[2],3456000); " +
    "return {1,d,m}";

  const result = await redis(
    'EVAL',
    script,
    2,
    kd,
    km,
    limits.daily,
    limits.monthly
  );

  return {
    allowed: Number(result?.[0]) === 1,
    day: Number(result?.[1] || 0),
    month: Number(result?.[2] || 0)
  };
}

async function refundQuota(chatId) {
  const script =
    "for i=1,2 do " +
    "local v=tonumber(redis.call('GET',KEYS[i]) or '0'); " +
    "if v>0 then redis.call('DECR',KEYS[i]) end; " +
    "end; return 1";

  return redis(
    'EVAL',
    script,
    2,
    K.day(chatId, dayKey()),
    K.month(chatId, monthKey())
  );
}

async function aiRateAllowed(chatId) {
  const script =
    "local n=redis.call('INCR',KEYS[1]); " +
    "if n==1 then redis.call('EXPIRE',KEYS[1],60) end; " +
    "return n";

  const n = Number(
    await redis('EVAL', script, 1, K.aiRate(chatId))
  );

  return n <= 8;
}

function isPolitical(text) {
  const terms = C.politicalKeywords
    .split('|')
    .map(x => x.trim())
    .filter(Boolean);

  return terms.some(term =>
    term && text.toLowerCase().includes(term.toLowerCase())
  );
}

async function getContext(chatId) {
  return (await getObj(K.context(chatId))) || [];
}

async function saveContext(chatId, context) {
  return setObj(
    K.context(chatId),
    context.slice(-12),
    'EX',
    60 * 60 * 24 * 30
  );
}

async function saveHistory(chatId, userText, assistantText) {
  const item = {
    at: nowIso(),
    user: clean(userText, 3000),
    assistant: clean(assistantText, 3500)
  };

  await redis(
    'LPUSH',
    K.history(chatId),
    JSON.stringify(item)
  );

  await redis(
    'LTRIM',
    K.history(chatId),
    0,
    49
  );
}

async function callAI(chatId, userText) {
  if (!C.aiKey || !C.aiModel) {
    throw new Error('AI_CONFIGURATION_MISSING');
  }

  const context = await getContext(chatId);

  const messages = [
    {
      role: 'system',
      content: 'تو یک دستیار هوشمند فارسی‌زبان هستی. پاسخ‌ها دقیق، محترمانه، روشن و متناسب با سن مخاطب باشند. اگر پاسخ را نمی‌دانی، صریح بگو.'
    },
    ...context,
    {
      role: 'user',
      content: clean(userText, 6000)
    }
  ];

  const response = await fetch(
    `${C.aiBase}/chat/completions`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${C.aiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: C.aiModel,
        messages,
        temperature: 0.7
      }),
      signal: AbortSignal.timeout(25000)
    }
  );

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    console.error(
      'GAPGPT_ERROR',
      response.status,
      clean(
        data.error?.message ||
        data.message ||
        data.error,
        500
      )
    );

    const e = new Error('AI_PROVIDER_ERROR');
    e.status = response.status;
    throw e;
  }

  const answer = data?.choices?.[0]?.message?.content;

  if (typeof answer !== 'string' || !answer.trim()) {
    throw new Error('AI_EMPTY_RESPONSE');
  }

  const updated = [
    ...context,
    {
      role: 'user',
      content: clean(userText, 6000)
    },
    {
      role: 'assistant',
      content: answer
    }
  ].slice(-12);

  await saveContext(chatId, updated);
  await saveHistory(chatId, userText, answer);

  return answer;
}

async function aiChat(chatId, text) {
  if (!text.trim()) {
    return send(chatId, 'پیامت خالی است. یک سؤال بنویس.');
  }

  if (isPolitical(text)) {
    return send(
      chatId,
      'این ربات برای گفت‌وگوی عمومی و آموزشی طراحی شده است و به درخواست‌های تبلیغاتی یا جهت‌دهی سیاسی پاسخ نمی‌دهد.'
    );
  }

  const lock = crypto.randomBytes(16).toString('hex');

  const locked = await set(
    K.aiLock(chatId),
    lock,
    'EX',
    90,
    'NX'
  );

  if (locked !== 'OK') {
    return send(
      chatId,
      'یک درخواست دیگر در حال پردازش است. کمی صبر کن و دوباره بفرست.'
    );
  }

  let charged = false;

  try {
    if (!(await aiRateAllowed(chatId))) {
      return send(
        chatId,
        'تعداد درخواست‌ها در این دقیقه زیاد است. کمی بعد دوباره تلاش کن.'
      );
    }

    const quota = await consumeQuota(chatId);

    if (!quota.allowed) {
      const u = await usage(chatId);

      return send(
        chatId,
        `سهمیه‌ات تمام شده است.\nمصرف امروز: ${u.day}/${u.daily}\nمصرف ماه: ${u.month}/${u.monthly}`
      );
    }

    charged = true;

    await send(chatId, '⏳ در حال دریافت پاسخ...');

    const answer = await callAI(chatId, text);

    await send(
      chatId,
      answer,
      { keyboard: REPLY }
    );
  } catch (e) {
    if (charged) {
      await refundQuota(chatId).catch(() => {});
    }

    console.error(
      'AI_CHAT_FAILED',
      e.message,
      e.status || ''
    );

    if (e.status === 401 || e.status === 403) {
      return send(
        chatId,
        'اتصال هوش مصنوعی مجاز نیست. کلید API را در تنظیمات Vercel بررسی کن.'
      );
    }

    if (e.status === 429) {
      return send(
        chatId,
        'سرویس هوش مصنوعی فعلاً محدودیت درخواست دارد. کمی بعد دوباره تلاش کن.'
      );
    }

    if (e.status >= 500) {
      return send(
        chatId,
        'سرویس هوش مصنوعی موقتاً پاسخ‌گو نیست. کمی بعد دوباره تلاش کن.'
      );
    }

    return send(
      chatId,
      'در دریافت پاسخ مشکلی پیش آمد. تنظیمات API و گزارش خطای Vercel را بررسی کن.'
    );
  } finally {
    const script =
      "if redis.call('GET',KEYS[1])==ARGV[1] then " +
      "return redis.call('DEL',KEYS[1]) else return 0 end";

    await redis(
      'EVAL',
      script,
      1,
      K.aiLock(chatId),
      lock
    ).catch(() => {});
  }
}

async function showHistory(chatId) {
  if (!(await requireActive(chatId))) return;

  const rows = await redis(
    'LRANGE',
    K.history(chatId),
    0,
    9
  );

  if (!Array.isArray(rows) || !rows.length) {
    return send(
      chatId,
      'هنوز گفت‌وگویی در تاریخچه ثبت نشده است.',
      {
        keyboard: REPLY,
        inline: [
          [{ text: '🏠 منوی اصلی', callback_data: 'main' }]
        ]
      }
    );
  }

  const text = rows.map((raw, i) => {
    const x = parseJson(raw, {});

    return `${i + 1}) ${clean(x.user, 180)}\nپاسخ: ${clean(x.assistant, 220)}`;
  }).join('\n\n──────────\n\n');

  return send(
    chatId,
    `📚 ده گفت‌وگوی اخیر\n\n${text}`,
    {
      keyboard: REPLY,
      inline: [
        [{ text: '🏠 منوی اصلی', callback_data: 'main' }]
      ]
    }
  );
}

async function showAccount(chatId) {
  const user = await requireActive(chatId);
  if (!user) return;

  const u = await usage(chatId);

  return send(
    chatId,
    `👤 حساب کاربری\n\nنام: ${user.name}\nنام کاربری: @${user.username}\nشناسه: ${user.id}\n\nمصرف امروز: ${u.day}/${u.daily}\nباقی‌مانده امروز: ${u.dailyLeft}\nمصرف ماه: ${u.month}/${u.monthly}\nباقی‌مانده ماه: ${u.monthlyLeft}`,
    {
      keyboard: REPLY,
      inline: [
        [{ text: '🏠 منوی اصلی', callback_data: 'main' }]
      ]
    }
  );
}

async function beginSupport(chatId) {
  if (!(await requireActive(chatId))) return;

  await saveState(chatId, {
    flow: 'support',
    step: 'message'
  });

  return send(
    chatId,
    '🎧 پیام خود را برای پشتیبانی بنویس. حداکثر ۳۰۰۰ نویسه. برای لغو «لغو» را بفرست.'
  );
}

async function createTicket(chatId, text) {
  const user = await getUser(chatId);

  if (!user || user.status !== 'active') return;

  const id = String(
    await redis('INCR', K.ticketSeq)
  );

  const ticket = {
    id,
    userId: String(chatId),
    username: user.username,
    name: user.name,
    message: clean(text, 3000),
    status: 'open',
    createdAt: nowIso(),
    updatedAt: nowIso(),
    replies: []
  };

  await setObj(K.ticket(id), ticket);

  await redis('LPUSH', K.tickets, id);
  await redis('LTRIM', K.tickets, 0, 499);

  await clearState(chatId);

  const group = await get(K.supportGroup);

  if (group) {
    await send(
      group,
      `🎫 تیکت جدید #${id}\nکاربر: ${user.name}\nشناسه: ${chatId}\n\n${ticket.message}`
    ).catch(e =>
      console.error('SUPPORT_GROUP_SEND_FAILED', e.message)
    );
  }

  return send(
    chatId,
    `✅ تیکت شماره ${id} ثبت شد.`,
    {
      keyboard: REPLY,
      inline: [
        [{ text: '🏠 منوی اصلی', callback_data: 'main' }]
      ]
    }
  );
}

async function adminAuth(id) {
  return id === C.adminId &&
    !!(await get(K.adminSession(id)));
}

async function adminLoginStart(id) {
  if (id !== C.adminId) return;

  if (!C.adminPass1 || !C.adminPass2) {
    return send(
      id,
      'رمزهای مدیریت در Vercel تنظیم نشده‌اند.'
    );
  }

  const locked = await get(K.adminLock(id));

  if (locked) {
    return send(
      id,
      'به‌دلیل تلاش ناموفق، ورود مدیریت موقتاً قفل است.'
    );
  }

  await saveState(id, {
    flow: 'admin_login',
    step: 'password1'
  });

  return send(
    id,
    '🔐 ورود مدیریت\nرمز اول را وارد کن.'
  );
}

async function adminLoginStep(id, text, state) {
  const locked = await get(K.adminLock(id));

  if (locked) {
    await clearState(id);

    return send(
      id,
      'ورود مدیریت موقتاً قفل است.'
    );
  }

  if (state.step === 'password1') {
    if (!timingSafe(text, C.adminPass1)) {
      return adminLoginFailed(id);
    }

    await saveState(id, {
      flow: 'admin_login',
      step: 'password2'
    });

    return send(id, 'رمز دوم را وارد کن.');
  }

  if (state.step === 'password2') {
    if (!timingSafe(text, C.adminPass2)) {
      return adminLoginFailed(id);
    }

    await redis('DEL', K.adminFail(id));

    await set(
      K.adminSession(id),
      crypto.randomBytes(32).toString('hex'),
      'EX',
      1800
    );

    await clearState(id);

    return adminMenu(id);
  }
}

async function adminLoginFailed(id) {
  const n = Number(
    await redis('INCR', K.adminFail(id))
  );

  if (n === 1) {
    await redis('EXPIRE', K.adminFail(id), 3600);
  }

  await clearState(id);

  if (n >= 8) {
    await set(
      K.adminLock(id),
      '1',
      'EX',
      3600
    );

    return send(
      id,
      '۸ تلاش ناموفق ثبت شد. ورود مدیریت برای یک ساعت قفل شد.'
    );
  }

  return send(
    id,
    `رمز نادرست است. تلاش ناموفق ${n} از ۸.`
  );
}

async function adminMenu(id) {
  if (!(await adminAuth(id))) {
    return send(id, 'ابتدا وارد مدیریت شو.');
  }

  return send(
    id,
    '⚙️ پنل مدیریت',
    {
      keyboard: REPLY,
      inline: ADMIN_MENU
    }
  );
}

async function adminStats(id) {
  if (!(await adminAuth(id))) return;

  const [users, tickets] = await Promise.all([
    redis('SCARD', K.users),
    redis('LLEN', K.tickets)
  ]);

  return send(
    id,
    `📊 آمار\n\nتعداد کاربران ثبت‌نام‌شده: ${users}\nتعداد شناسه‌های تیکت ذخیره‌شده: ${tickets}`,
    {
      keyboard: REPLY,
      inline: [
        [{ text: '⬅️ مدیریت', callback_data: 'admin:menu' }]
      ]
    }
  );
}

async function adminUsers(id) {
  if (!(await adminAuth(id))) return;

  const ids = await redis('SMEMBERS', K.users);
  const rows = [];

  for (
    const uid of (
      Array.isArray(ids) ? ids.slice(0, 10) : []
    )
  ) {
    const u = await getUser(uid);

    if (u) {
      rows.push([
        {
          text: `${clean(u.name, 24)} — ${u.status}`,
          callback_data: `admin:user:${uid}`
        }
      ]);
    }
  }

  rows.push([
    {
      text: '🔎 جست‌وجوی کاربر',
      callback_data: 'admin:searchuser'
    }
  ]);

  rows.push([
    {
      text: '⬅️ مدیریت',
      callback_data: 'admin:menu'
    }
  ]);

  return send(
    id,
    `👥 کاربران\nتعداد کل: ${(Array.isArray(ids) ? ids.length : 0)}\n\nبرای دیدن اطلاعات کاربر، نام او را انتخاب کن یا جست‌وجو را بزن.`,
    { inline: rows }
  );
}

async function adminUser(id, target) {
  if (!(await adminAuth(id))) return;

  const user = await getUser(target);

  if (!user) {
    return send(id, 'کاربر پیدا نشد.');
  }

  const u = await usage(target);

  return send(
    id,
    `👤 اطلاعات کاربر\n\nنام: ${user.name}\nنام کاربری: @${user.username}\nشناسه: ${user.id}\nوضعیت: ${user.status}\nثبت‌نام: ${user.createdAt}\nمصرف روز: ${u.day}/${u.daily}\nمصرف ماه: ${u.month}/${u.monthly}`,
    {
      keyboard: REPLY,
      inline: [
        [
          {
            text: user.status === 'blocked'
              ? '✅ رفع مسدودی'
              : '⛔ مسدودسازی',
            callback_data: `admin:block:${target}`
          }
        ],
        [
          {
            text: '✉️ پیام خصوصی',
            callback_data: `admin:privateuser:${target}`
          },
          {
            text: '♻️ صفرکردن مصرف',
            callback_data: `admin:reset:${target}`
          }
        ],
        [
          {
            text: '🎟 سهمیه اختصاصی',
            callback_data: `admin:userquota:${target}`
          }
        ],
        [
          {
            text: '⬅️ مدیریت',
            callback_data: 'admin:menu'
          }
        ]
      ]
    }
  );
}

async function adminBlock(id, target) {
  if (!(await adminAuth(id))) return;

  const user = await getUser(target);

  if (!user) {
    return send(id, 'کاربر پیدا نشد.');
  }

  user.status = user.status === 'blocked'
    ? 'active'
    : 'blocked';

  await saveUser(target, user);

  return adminUser(id, target);
}

async function adminQuotaMenu(id) {
  if (!(await adminAuth(id))) return;

  const d = await get(K.dailyConfig);
  const m = await get(K.monthlyConfig);

  await saveState(id, {
    flow: 'admin',
    step: 'global_quota'
  });

  return send(
    id,
    `سهمیه فعلی\nروزانه: ${d ?? C.dailyQuota}\nماهانه: ${m ?? C.monthlyQuota}\n\nبرای تغییر، یکی از این قالب‌ها را بفرست:\nروزانه 20\nماهانه 300`
  );
}

async function resetUsage(id, target) {
  if (!(await adminAuth(id))) return;

  await redis(
    'DEL',
    K.day(target, dayKey()),
    K.month(target, monthKey())
  );

  return send(
    id,
    'مصرف روزانه و ماهانه فعلی کاربر صفر شد.',
    {
      keyboard: REPLY,
      inline: [
        [
          {
            text: '👤 بازگشت به کاربر',
            callback_data: `admin:user:${target}`
          }
        ]
      ]
    }
  );
}

async function setUserQuota(id, target, text) {
  if (!(await adminAuth(id))) return;

  const m = clean(text, 100)
    .trim()
    .match(/^(روزانه|ماهانه)\s+(\d+)$/);

  if (!m) {
    return send(
      id,
      'قالب صحیح: روزانه 20 یا ماهانه 300'
    );
  }

  const n = Number(m[2]);

  if (!Number.isInteger(n) || n > 100000) {
    return send(
      id,
      'عدد باید بین صفر تا ۱۰۰۰۰۰ باشد.'
    );
  }

  await set(
    m[1] === 'روزانه'
      ? K.userDay(target)
      : K.userMonth(target),
    String(n)
  );

  await clearState(id);

  return adminUser(id, target);
}

async function setGlobalQuota(id, text) {
  if (!(await adminAuth(id))) return;

  const m = clean(text, 100)
    .trim()
    .match(/^(روزانه|ماهانه)\s+(\d+)$/);

  if (!m) {
    return send(
      id,
      'قالب صحیح: روزانه 20 یا ماهانه 300'
    );
  }

  const n = Number(m[2]);

  if (!Number.isInteger(n) || n > 100000) {
    return send(
      id,
      'عدد باید بین صفر تا ۱۰۰۰۰۰ باشد.'
    );
  }

  await set(
    m[1] === 'روزانه'
      ? K.dailyConfig
      : K.monthlyConfig,
    String(n)
  );

  await clearState(id);

  return send(
    id,
    '✅ سهمیه عمومی تغییر کرد.',
    {
      keyboard: REPLY,
      inline: [
        [{ text: '⬅️ مدیریت', callback_data: 'admin:menu' }]
      ]
    }
  );
}

async function beginPrivate(id, target = '') {
  if (!(await adminAuth(id))) return;

  if (!target) {
    await saveState(id, {
      flow: 'admin',
      step: 'private_id'
    });

    return send(
      id,
      'شناسه عددی کاربر را بفرست.'
    );
  }

  if (!(await getUser(target))) {
    return send(id, 'کاربر پیدا نشد.');
  }

  await saveState(id, {
    flow: 'admin',
    step: 'private_text',
    target
  });

  return send(id, 'متن پیام خصوصی را بفرست.');
}

async function sendPrivate(id, target, text) {
  if (!(await adminAuth(id))) return;

  await send(
    target,
    `📩 پیام مدیریت:\n\n${clean(text, 3000)}`
  );

  await clearState(id);

  return send(
    id,
    '✅ پیام ارسال شد.',
    {
      keyboard: REPLY,
      inline: [
        [{ text: '⬅️ مدیریت', callback_data: 'admin:menu' }]
      ]
    }
  );
}

async function beginBroadcast(id) {
  if (!(await adminAuth(id))) return;

  await saveState(id, {
    flow: 'admin',
    step: 'broadcast_text'
  });

  return send(
    id,
    'متن پیام همگانی را بفرست. پیش از ارسال، تأیید نهایی می‌گیری.'
  );
}

async function sendBroadcastDraft(id, text) {
  await saveState(id, {
    flow: 'admin',
    step: 'broadcast_confirm',
    text: clean(text, 3000)
  });

  return send(
    id,
    `پیش‌نمایش پیام همگانی:\n\n${clean(text, 3000)}\n\nآیا ارسال شود؟`,
    {
      inline: [
        [
          {
            text: '✅ تأیید ارسال',
            callback_data: 'admin:broadcast:confirm'
          },
          {
            text: '❌ لغو',
            callback_data: 'admin:broadcast:cancel'
          }
        ]
      ]
    }
  );
}

async function executeBroadcast(id) {
  if (!(await adminAuth(id))) return;

  let state = await getState(id);

  if (!state) {
    return send(id, 'پیش‌نویس پیام پیدا نشد.');
  }

  if (state.step === 'broadcast_confirm') {
    if (!state.text) {
      return send(id, 'متن پیام پیدا نشد.');
    }

    const ids = await redis('SMEMBERS', K.users);

    await setObj(
      K.broadcastIds(id),
      Array.isArray(ids) ? ids : [],
      'EX',
      3600
    );

    await redis('DEL', K.broadcastSent(id));

    state = {
      flow: 'admin',
      step: 'broadcast_running',
      text: state.text,
      offset: 0,
      ok: 0,
      failed: 0
    };

    await saveState(id, state, 3600);
  }

  if (state.step !== 'broadcast_running') {
    return send(
      id,
      'ارسال همگانی در وضعیت معتبری نیست.'
    );
  }

  const ids = await getObj(K.broadcastIds(id)) || [];

  const batch = ids.slice(
    Number(state.offset || 0),
    Number(state.offset || 0) + 15
  );

  let ok = Number(state.ok || 0);
  let failed = Number(state.failed || 0);

  for (const target of batch) {
    if (
      await redis(
        'SISMEMBER',
        K.broadcastSent(id),
        String(target)
      )
    ) {
      continue;
    }

    try {
      await send(
        target,
        `📢 پیام مدیریت:\n\n${state.text}`
      );

      await redis(
        'SADD',
        K.broadcastSent(id),
        String(target)
      );

      ok++;
    } catch {
      failed++;

      await redis(
        'SADD',
        K.broadcastSent(id),
        String(target)
      );
    }
  }

  const offset = Number(state.offset || 0) + batch.length;

  if (offset >= ids.length) {
    await clearState(id);

    await redis(
      'DEL',
      K.broadcastIds(id),
      K.broadcastSent(id)
    );

    return send(
      id,
      `ارسال همگانی تمام شد.\nموفق: ${ok}\nناموفق: ${failed}\nتعداد کل: ${ids.length}`,
      {
        inline: [
          [{ text: '⬅️ مدیریت', callback_data: 'admin:menu' }]
        ]
      }
    );
  }

  await saveState(
    id,
    {
      ...state,
      offset,
      ok,
      failed
    },
    3600
  );

  return send(
    id,
    `بخش ${Math.ceil(offset / 15)} از ${Math.ceil(ids.length / 15)} پردازش شد.\nموفق: ${ok} | ناموفق: ${failed}\nبرای ادامه، دکمه را بزن.`,
    {
      inline: [
        [
          {
            text: 'ادامه ارسال',
            callback_data: 'admin:broadcast:continue'
          },
          {
            text: 'لغو',
            callback_data: 'admin:broadcast:cancel'
          }
        ]
      ]
    }
  );
}

async function showTickets(id) {
  if (!(await adminAuth(id))) return;

  const ids = await redis(
    'LRANGE',
    K.tickets,
    0,
    9
  );

  if (!Array.isArray(ids) || !ids.length) {
    return send(id, 'تیکتی ثبت نشده است.');
  }

  const rows = [];

  for (const tid of ids) {
    const t = await getObj(K.ticket(tid));

    if (t) {
      rows.push([
        {
          text: `#${tid} — ${t.status} — ${clean(t.name, 25)}`,
          callback_data: `ticket:${tid}`
        }
      ]);
    }
  }

  return send(
    id,
    '🎫 ده تیکت اخیر:',
    {
      inline: [
        ...rows,
        [{ text: '⬅️ مدیریت', callback_data: 'admin:menu' }]
      ]
    }
  );
}

async function showTicket(id, tid) {
  if (!(await adminAuth(id))) return;

  const t = await getObj(K.ticket(tid));

  if (!t) {
    return send(id, 'تیکت پیدا نشد.');
  }

  return send(
    id,
    `تیکت #${tid}\nکاربر: ${t.name} (@${t.username})\nشناسه: ${t.userId}\nوضعیت: ${t.status}\n\n${t.message}\n\nپاسخ‌ها: ${(t.replies || []).length}`,
    {
      inline: [
        [
          {
            text: '✍️ پاسخ',
            callback_data: `ticket:reply:${tid}`
          },
          {
            text: t.status === 'closed'
              ? 'بازگشایی'
              : 'بستن',
            callback_data: `ticket:toggle:${tid}`
          }
        ],
        [
          {
            text: '⬅️ تیکت‌ها',
            callback_data: 'admin:tickets'
          }
        ]
      ]
    }
  );
}

async function replyTicketStart(id, tid) {
  if (!(await adminAuth(id))) return;

  const t = await getObj(K.ticket(tid));

  if (!t) {
    return send(id, 'تیکت پیدا نشد.');
  }

  await saveState(id, {
    flow: 'admin',
    step: 'ticket_reply',
    ticketId: String(tid)
  });

  return send(
    id,
    `پاسخ تیکت #${tid} را بنویس.`
  );
}

async function replyTicket(id, tid, text) {
  if (!(await adminAuth(id))) return;

  const t = await getObj(K.ticket(tid));

  if (!t) {
    await clearState(id);
    return send(id, 'تیکت پیدا نشد.');
  }

  await send(
    t.userId,
    `📩 پاسخ پشتیبانی به تیکت #${tid}:\n\n${clean(text, 3000)}`
  );

  t.replies = Array.isArray(t.replies)
    ? t.replies
    : [];

  t.replies.push({
    text: clean(text, 3000),
    at: nowIso(),
    by: id
  });

  t.status = 'open';
  t.updatedAt = nowIso();

  await setObj(K.ticket(tid), t);
  await clearState(id);

  return send(
    id,
    '✅ پاسخ ارسال شد.',
    {
      inline: [
        [
          {
            text: '🎫 مشاهده تیکت',
            callback_data: `ticket:${tid}`
          }
        ],
        [
          {
            text: '⬅️ تیکت‌ها',
            callback_data: 'admin:tickets'
          }
        ]
      ]
    }
  );
}

async function toggleTicket(id, tid) {
  if (!(await adminAuth(id))) return;

  const t = await getObj(K.ticket(tid));

  if (!t) {
    return send(id, 'تیکت پیدا نشد.');
  }

  t.status = t.status === 'closed'
    ? 'open'
    : 'closed';

  t.updatedAt = nowIso();

  await setObj(K.ticket(tid), t);

  return showTicket(id, tid);
}

async function adminStatus(id) {
  if (!(await adminAuth(id))) return;

  const group = await get(K.supportGroup);

  return send(
    id,
    `🔌 وضعیت تنظیمات\nبله: ${C.baleToken ? 'تنظیم شده' : 'تنظیم نشده'}\nGapGPT Key: ${C.aiKey ? 'تنظیم شده' : 'تنظیم نشده'}\nGapGPT Base URL: ${C.aiBase}\nمدل: ${C.aiModel || 'تنظیم نشده'}\nUpstash: ${C.redisUrl && C.redisToken ? 'تنظیم شده' : 'تنظیم نشده'}\nگروه پشتیبانی: ${group ? 'تنظیم شده' : 'تنظیم نشده'}\nربات: ${(await isBotEnabled()) ? 'روشن' : 'خاموش'}\n\nاین بخش وجود متغیرها را بررسی می‌کند، نه سلامت زنده سرویس‌ها.`,
    {
      inline: [
        [{ text: '⬅️ مدیریت', callback_data: 'admin:menu' }]
      ]
    }
  );
}

async function adminSettings(id) {
  if (!(await adminAuth(id))) return;

  return send(
    id,
    '⚙️ تنظیمات\n\nبرای تعیین گروه پشتیبانی، ربات را به گروه اضافه کن و دستور /set_support_group را با حساب مدیر اصلی در گروه بفرست.\n\nکلید API، مدل و آدرس API از Environment Variables در Vercel خوانده می‌شوند. پس از تغییر آن‌ها باید Deploy جدید انجام شود.',
    {
      inline: [
        [{ text: '⬅️ مدیریت', callback_data: 'admin:menu' }]
      ]
    }
  );
}

async function toggleBot(id) {
  if (!(await adminAuth(id))) return;

  const enabled = await isBotEnabled();

  await set(
    K.botEnabled,
    enabled ? '0' : '1'
  );

  return send(
    id,
    enabled ? '🔴 ربات خاموش شد.' : '🟢 ربات روشن شد.',
    {
      inline: [
        [{ text: '⬅️ مدیریت', callback_data: 'admin:menu' }]
      ]
    }
  );
}

async function handleAdminState(id, text, state) {
  if (!(await adminAuth(id))) {
    await clearState(id);

    return send(
      id,
      'نشست مدیریت معتبر نیست. دوباره وارد شو.'
    );
  }

  if (state.step === 'search_user') {
    const q = clean(text, 80)
      .trim()
      .replace(/^@/, '');

    const ids = await redis('SMEMBERS', K.users);

    let found = null;

    for (const uid of (Array.isArray(ids) ? ids : [])) {
      const u = await getUser(uid);

      if (
        u &&
        (
          String(uid) === q ||
          String(u.username).toLowerCase() === q.toLowerCase()
        )
      ) {
        found = u;
        break;
      }
    }

    await clearState(id);

    return found
      ? adminUser(id, found.id)
      : send(id, 'کاربر پیدا نشد.');
  }

  if (state.step === 'global_quota') {
    return setGlobalQuota(id, text);
  }

  if (state.step === 'user_quota') {
    return setUserQuota(id, state.target, text);
  }

  if (state.step === 'private_id') {
    const target = clean(text, 30).trim();

    if (!/^\d+$/.test(target)) {
      return send(id, 'شناسه باید عددی باشد.');
    }

    if (!(await getUser(target))) {
      return send(id, 'کاربر پیدا نشد.');
    }

    await saveState(id, {
      flow: 'admin',
      step: 'private_text',
      target
    });

    return send(id, 'متن پیام خصوصی را بفرست.');
  }

  if (state.step === 'private_text') {
    return sendPrivate(id, state.target, text);
  }

  if (state.step === 'broadcast_text') {
    return sendBroadcastDraft(id, text);
  }

  if (state.step === 'ticket_reply') {
    return replyTicket(id, state.ticketId, text);
  }
}

async function callback(update) {
  const cb = update.callback_query;
  const data = str(cb.data);
  const id = String(cb.from?.id || '');
  const chatId = String(cb.message?.chat?.id || id);

  await answerCallback(cb.id);

  if (!id) return;

  if (data === 'register') {
    return beginRegistration(chatId);
  }

  if (data === 'help') {
    return send(
      chatId,
      '📖 راهنما\nبرای گفت‌وگو ثبت‌نام کن. از منوی گفت‌وگوی جدید، تاریخچه، حساب و پشتیبانی استفاده کن.',
      {
        inline: [
          [{ text: '🏠 منوی اصلی', callback_data: 'main' }]
        ]
      }
    );
  }

  if (data === 'about') {
    return send(
      chatId,
      'ℹ️ چت‌جی‌بی‌تی، ربات گفت‌وگوی هوشمند در پیام‌رسان بله با تاریخچه، سهمیه و پشتیبانی.',
      {
        inline: [
          [{ text: '🏠 منوی اصلی', callback_data: 'main' }]
        ]
      }
    );
  }

  if (data === 'main') {
    return start(chatId);
  }

  if (data === 'reg:confirm') {
    return finishRegistration(chatId);
  }

  if (data === 'reg:cancel') {
    return cancelFlow(
      chatId,
      await getState(chatId)
    );
  }

  if (data === 'newchat') {
    if (!(await requireActive(chatId))) return;

    await redis('DEL', K.context(chatId));

    return send(
      chatId,
      '💬 گفت‌وگوی جدید آماده است. پیام خود را بفرست.',
      { keyboard: REPLY }
    );
  }

  if (data === 'history') {
    return showHistory(chatId);
  }

  if (data === 'account') {
    return showAccount(chatId);
  }

  if (data === 'support') {
    return beginSupport(chatId);
  }

  if (
    data.startsWith('admin:') ||
    data.startsWith('ticket:')
  ) {
    if (!(await adminAuth(id))) {
      return send(
        chatId,
        'برای استفاده از مدیریت، ابتدا با شناسه مدیر وارد شو.'
      );
    }

    if (data === 'admin:menu') {
      return adminMenu(id);
    }

    if (data === 'admin:stats') {
      return adminStats(id);
    }

    if (data === 'admin:users') {
      return adminUsers(id);
    }

    if (data === 'admin:searchuser') {
      await saveState(id, {
        flow: 'admin',
        step: 'search_user'
      });

      return send(
        id,
        'شناسه عددی یا نام کاربری کاربر را بفرست.'
      );
    }

    if (data === 'admin:quota') {
      return adminQuotaMenu(id);
    }

    if (data === 'admin:tickets') {
      return showTickets(id);
    }

    if (data === 'admin:broadcast') {
      return beginBroadcast(id);
    }

    if (data === 'admin:private') {
      return beginPrivate(id);
    }

    if (data === 'admin:status') {
      return adminStatus(id);
    }

    if (data === 'admin:settings') {
      return adminSettings(id);
    }

    if (data === 'admin:toggle') {
      return toggleBot(id);
    }

    if (data === 'admin:logout') {
      await redis('DEL', K.adminSession(id));
      await clearState(id);

      return send(id, 'از مدیریت خارج شدی.');
    }

    if (
      data === 'admin:broadcast:confirm' ||
      data === 'admin:broadcast:continue'
    ) {
      return executeBroadcast(id);
    }

    if (data === 'admin:broadcast:cancel') {
      await clearState(id);

      await redis(
        'DEL',
        K.broadcastIds(id),
        K.broadcastSent(id)
      );

      return send(
        id,
        'ارسال لغو شد.',
        {
          inline: [
            [{ text: '⬅️ مدیریت', callback_data: 'admin:menu' }]
          ]
        }
      );
    }

    if (data.startsWith('admin:block:')) {
      return adminBlock(id, data.slice(12));
    }

    if (data.startsWith('admin:user:')) {
      return adminUser(id, data.slice(11));
    }

    if (data.startsWith('admin:privateuser:')) {
      return beginPrivate(id, data.slice(18));
    }

    if (data.startsWith('admin:reset:')) {
      return resetUsage(id, data.slice(12));
    }

    if (data.startsWith('admin:userquota:')) {
      const target = data.slice(16);

      await saveState(id, {
        flow: 'admin',
        step: 'user_quota',
        target
      });

      return send(
        id,
        'سهمیه اختصاصی را بفرست؛ مثال: روزانه 20 یا ماهانه 300'
      );
    }

    if (data.startsWith('ticket:reply:')) {
      return replyTicketStart(id, data.slice(13));
    }

    if (data.startsWith('ticket:toggle:')) {
      return toggleTicket(id, data.slice(14));
    }

    if (data.startsWith('ticket:')) {
      return showTicket(id, data.slice(6));
    }
  }
}

async function groupMessage(message) {
  const chatId = String(message.chat?.id || '');
  const sender = String(message.from?.id || '');

  if (sender !== C.adminId) return;

  const text = str(message.text).trim();

  if (text === '/set_support_group') {
    await set(K.supportGroup, chatId);

    return send(
      chatId,
      '✅ این گروه به‌عنوان گروه پشتیبانی تنظیم شد.'
    );
  }
}

async function privateMessage(message) {
  const id = String(message.chat?.id || '');
  const text = str(message.text || '').trim();

  if (!id) return;

  if (
    text === '/start' ||
    text === '🔄 شروع مجدد'
  ) {
    await clearState(id);
    return start(id);
  }

  if (text === '/set_support_group') {
    return send(
      id,
      'این دستور را داخل گروه پشتیبانی ارسال کن.'
    );
  }

  if (
    (text === '/admin' || text === 'مدیریت ۱۰۰۱') &&
    id === C.adminId
  ) {
    return adminLoginStart(id);
  }

  const state = await getState(id);

  if (text === 'لغو') {
    return cancelFlow(id, state);
  }

  if (state?.flow === 'register') {
    return registrationStep(id, text, state);
  }

  if (state?.flow === 'admin_login') {
    return adminLoginStep(id, text, state);
  }

  if (
    state?.flow === 'support' &&
    state.step === 'message'
  ) {
    if (text.length < 3 || text.length > 3000) {
      return send(
        id,
        'پیام باید بین ۳ تا ۳۰۰۰ نویسه باشد.'
      );
    }

    return createTicket(id, text);
  }

  if (state?.flow === 'admin') {
    return handleAdminState(id, text, state);
  }

  if (text.startsWith('/')) {
    return send(
      id,
      'این دستور شناخته‌شده نیست. /start را بفرست.'
    );
  }

  const user = await getUser(id);

  if (!user) {
    return send(
      id,
      'برای شروع گفت‌وگو ابتدا ثبت‌نام کن.',
      {
        inline: [
          [{ text: '📝 ثبت‌نام', callback_data: 'register' }]
        ]
      }
    );
  }

  if (user.status === 'blocked') {
    return send(
      id,
      'حساب کاربری تو مسدود شده است. برای پیگیری با پشتیبانی تماس بگیر.'
    );
  }

  if (
    !(await isBotEnabled()) &&
    id !== C.adminId
  ) {
    return send(
      id,
      '🔴 ربات موقتاً غیرفعال است.'
    );
  }

  return aiChat(id, text);
}

async function processUpdate(update) {
  if (update.callback_query) {
    return callback(update);
  }

  const message =
    update.message ||
    update.edited_message;

  if (!message) return;

  const type = message.chat?.type;

  if (
    type === 'group' ||
    type === 'supergroup'
  ) {
    return groupMessage(message);
  }

  if (type === 'private') {
    return privateMessage(message);
  }
}

async function setupWebhook(res) {
  if (
    !C.baleToken ||
    !C.appUrl ||
    !C.webhookSecret
  ) {
    return sendJson(
      res,
      500,
      {
        ok: false,
        message: 'تنظیم BALE_BOT_TOKEN، APP_BASE_URL و BALE_WEBHOOK_SECRET ضروری است.'
      }
    );
  }

  const webhook =
    `${C.appUrl}/api/webhook?secret=${encodeURIComponent(C.webhookSecret)}`;

  try {
    const result = await bale(
      'setWebhook',
      { url: webhook }
    );

    return sendJson(
      res,
      200,
      {
        ok: true,
        message: 'درخواست ثبت وب‌هوک ارسال شد.',
        result
      }
    );
  } catch (e) {
    console.error(
      'WEBHOOK_SETUP_ERROR',
      e.message
    );

    return sendJson(
      res,
      502,
      {
        ok: false,
        message: 'ثبت وب‌هوک ناموفق بود؛ توکن و API بله را بررسی کن.'
      }
    );
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  const url = requestUrl(req);

  if (req.method === 'GET') {
    const setup = url.searchParams.get('setup');

    if (
      setup &&
      C.setupSecret &&
      timingSafe(setup, C.setupSecret)
    ) {
      return setupWebhook(res);
    }

    const secret = url.searchParams.get('secret');

    if (
      secret &&
      C.webhookSecret &&
      timingSafe(secret, C.webhookSecret)
    ) {
      return sendJson(
        res,
        200,
        {
          ok: true,
          service: 'bale-gapgpt-bot',
          message: 'Webhook endpoint is reachable.'
        }
      );
    }

    return sendJson(
      res,
      403,
      {
        ok: false,
        message: 'دسترسی مجاز نیست.'
      }
    );
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');

    return sendJson(
      res,
      405,
      {
        ok: false,
        message: 'Method Not Allowed'
      }
    );
  }

  if (
    !C.webhookSecret ||
    !timingSafe(
      url.searchParams.get('secret'),
      C.webhookSecret
    )
  ) {
    return sendJson(
      res,
      401,
      {
        ok: false,
        message: 'Unauthorized'
      }
    );
  }

  const update = parseBody(req.body);

  if (
    !update ||
    typeof update !== 'object' ||
    update.update_id === undefined
  ) {
    return sendJson(
      res,
      400,
      {
        ok: false,
        message: 'Invalid update'
      }
    );
  }

  const id = String(update.update_id);
  const token = crypto.randomBytes(16).toString('hex');

  try {
    if (await get(K.processed(id))) {
      return sendJson(
        res,
        200,
        {
          ok: true,
          duplicate: true
        }
      );
    }

    const acquired = await set(
      K.processing(id),
      token,
      'EX',
      120,
      'NX'
    );

    if (acquired !== 'OK') {
      return sendJson(
        res,
        503,
        {
          ok: false,
          message: 'Update is being processed; retry later.'
        }
      );
    }

    let chatLockKey = null;
    let chatLockToken = null;

    try {
      const message =
        update.message ||
        update.edited_message;

      const chatId = String(
        update.callback_query?.message?.chat?.id ||
        message?.chat?.id ||
        ''
      );

      if (chatId) {
        chatLockKey = K.chatLock(chatId);
        chatLockToken = crypto.randomBytes(16).toString('hex');

        const chatAcquired = await set(
          chatLockKey,
          chatLockToken,
          'EX',
          90,
          'NX'
        );

        if (chatAcquired !== 'OK') {
          return sendJson(
            res,
            503,
            {
              ok: false,
              message: 'Chat is busy; retry later.'
            }
          );
        }
      }

      await processUpdate(update);

      await set(
        K.processed(id),
        '1',
        'EX',
        86400
      );

      return sendJson(
        res,
        200,
        { ok: true }
      );
    } catch (e) {
      console.error(
        'UPDATE_FAILED',
        id,
        e.message
      );

      return sendJson(
        res,
        500,
        {
          ok: false,
          message: 'update_processing_failed'
        }
      );
    } finally {
      const script =
        "if redis.call('GET',KEYS[1])==ARGV[1] then " +
        "return redis.call('DEL',KEYS[1]) else return 0 end";

      if (chatLockKey && chatLockToken) {
        await redis(
          'EVAL',
          script,
          1,
          chatLockKey,
          chatLockToken
        ).catch(() => {});
      }

      await redis(
        'EVAL',
        script,
        1,
        K.processing(id),
        token
      ).catch(() => {});
    }
  } catch (e) {
    console.error(
      'WEBHOOK_REDIS_ERROR',
      e.message
    );

    return sendJson(
      res,
      503,
      {
        ok : false,
        message: 'Temporary storage error; retry later.'
      }
    );
  }
};
