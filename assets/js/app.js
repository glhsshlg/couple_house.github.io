/* =========================================================
   朝暮 · Our Little Universe
   Vanilla JavaScript — no dependencies, no backend.
   ========================================================= */
(() => {
  'use strict';

  const DB_NAME = 'zhaomu-couple-db';
  const DB_VERSION = 1;
  const STORES = ['events', 'photos', 'diaries', 'wishes', 'capsules', 'files'];
  const SETTINGS_KEY = 'zhaomu_settings_v1';
  const SEED_KEY = 'zhaomu_seeded_v1';

  const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

  const QUOTES = [
    '爱不是彼此凝视，而是一起朝同一个方向看。',
    '所谓浪漫，就是和同一个人，一次又一次地爱上人间。',
    '愿我们的日子，清浅而长，平淡而暖。',
    '你是我藏在普通日子里，最不普通的欢喜。',
    '想把每一个“下次见”，都变成“明天见”。',
    '喜欢是乍见之欢，爱是久处不厌。',
    '世界很大，幸好我们的轨迹有交点。',
    '和你在一起之后，连晚风都像在说情话。',
    '最好的关系，是一起长大，也一起犯傻。',
    '我们不必完美，只要始终站在彼此这一边。',
    '漫长岁月里，想做你反复确认的偏爱。',
    '生活的答案很多，而你是我的标准答案之一。'
  ];

  const DEFAULT_SETTINGS = {
    names: '小鹿 & 阿屿',
    togetherDate: '2023-05-20',
    tagline: '收藏每一次心动，也收藏那些看似平常、却只想和你一起度过的小日子。'
  };

  const state = {
    settings: { ...DEFAULT_SETTINGS },
    events: [],
    photos: [],
    diaries: [],
    wishes: [],
    capsules: [],
    photoFilter: 'all',
    diarySearch: '',
    activePhotoId: null,
    activeDiaryId: null,
    activeCapsuleId: null,
    editingDiaryId: null,
    currentMood: '开心',
    pendingPdfFile: null,
    editorAttachment: null
  };

  const memory = {
    events: [],
    photos: [],
    diaries: [],
    wishes: [],
    capsules: [],
    files: []
  };

  let db = null;
  let dbUnavailable = false;
  let modalStack = [];
  let confirmResolve = null;
  let toastTimer = null;
  let lastToday = '';
  let quoteSeed = 0;

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const byId = (id) => document.getElementById(id);

  /* =======================================================
     Small utilities
  ======================================================= */
  function escapeHTML(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[char]));
  }

  function escapeAttr(value) {
    return escapeHTML(value).replace(/`/g, '&#96;');
  }

  function uid(prefix = 'item') {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return `${prefix}-${window.crypto.randomUUID()}`;
    }
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
  }

  function pad(number) {
    return String(number).padStart(2, '0');
  }

  function todayDate() {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }

  function localISO(date) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  function todayISO() {
    return localISO(todayDate());
  }

  function dateOffsetISO(days) {
    const date = new Date();
    date.setHours(12, 0, 0, 0);
    date.setDate(date.getDate() + Number(days || 0));
    return localISO(date);
  }

  function parseISO(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
    if (!match) return null;
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    if (
      date.getFullYear() !== Number(match[1]) ||
      date.getMonth() !== Number(match[2]) - 1 ||
      date.getDate() !== Number(match[3])
    ) {
      return null;
    }
    return date;
  }

  function utcDay(date) {
    return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  }

  function diffDays(from, to) {
    return Math.round((utcDay(to) - utcDay(from)) / 86400000);
  }

  function formatCN(value) {
    const date = value instanceof Date ? value : parseISO(value);
    if (!date) return '日期未知';
    return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
  }

  function formatDot(value) {
    const date = value instanceof Date ? value : parseISO(value);
    if (!date) return '--';
    return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())}`;
  }

  function weekdayCN(value) {
    const date = value instanceof Date ? value : parseISO(value);
    if (!date) return '';
    return `周${WEEKDAYS[date.getDay()]}`;
  }

  function formatStamp(timestamp) {
    if (!timestamp) return '--';
    const date = new Date(timestamp);
    return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function formatBytes(bytes) {
    const value = Number(bytes) || 0;
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
    return `${(value / 1024 / 1024).toFixed(1)} MB`;
  }

  function daysTogether() {
    const start = parseISO(state.settings.togetherDate);
    if (!start) return 0;
    return Math.max(0, diffDays(start, todayDate()) + 1);
  }

  function getNextAnnual(isoDate) {
    const base = parseISO(isoDate);
    if (!base) return null;
    const today = todayDate();
    let year = today.getFullYear();
    let next = new Date(year, base.getMonth(), base.getDate());
    if (next < today) {
      year += 1;
      next = new Date(year, base.getMonth(), base.getDate());
    }
    const ordinal = Math.max(0, next.getFullYear() - base.getFullYear());
    return {
      date: next,
      iso: localISO(next),
      days: diffDays(today, next),
      ordinal
    };
  }

  function fileBaseName(name) {
    const clean = String(name || '')
      .replace(/\.[^.]+$/, '')
      .replace(/[_-]+/g, ' ')
      .trim();
    return clean.slice(0, 40) || '未命名回忆';
  }

  function sanitizeFilename(value) {
    return String(value || '日记')
      .replace(/[\\/:*?"<>|]/g, '-')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 60) || '日记';
  }

  function debounce(fn, delay) {
    let timer = 0;
    return function debounced(...args) {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => fn.apply(this, args), delay);
    };
  }

  function showToast(message, type = '') {
    const toast = byId('toast');
    if (!toast) return;
    window.clearTimeout(toastTimer);
    toast.textContent = message;
    toast.classList.toggle('is-error', type === 'error');
    toast.classList.add('is-visible');
    toastTimer = window.setTimeout(() => {
      toast.classList.remove('is-visible');
    }, 2800);
  }

  /* =======================================================
     IndexedDB storage (with in-memory fallback)
  ======================================================= */
  function openDatabase() {
    return new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) {
        reject(new Error('当前浏览器不支持 IndexedDB'));
        return;
      }
      const request = window.indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        STORES.forEach((storeName) => {
          if (!database.objectStoreNames.contains(storeName)) {
            database.createObjectStore(storeName, { keyPath: 'id' });
          }
        });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('数据库打开失败'));
      request.onblocked = () => reject(new Error('数据库被其他页面占用'));
    });
  }

  function storeGetAll(storeName) {
    if (!db) return Promise.resolve((memory[storeName] || []).slice());
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, 'readonly');
      const request = transaction.objectStore(storeName).getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  function storeGet(storeName, id) {
    if (!db) {
      return Promise.resolve((memory[storeName] || []).find((entry) => entry.id === id) || null);
    }
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, 'readonly');
      const request = transaction.objectStore(storeName).get(id);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  function storePut(storeName, record) {
    if (!db) {
      const list = memory[storeName] || (memory[storeName] = []);
      const index = list.findIndex((entry) => entry.id === record.id);
      if (index >= 0) list[index] = record;
      else list.push(record);
      return Promise.resolve(record);
    }
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, 'readwrite');
      transaction.objectStore(storeName).put(record);
      transaction.oncomplete = () => resolve(record);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || new Error('保存失败'));
    });
  }

  function storeDelete(storeName, id) {
    if (!db) {
      memory[storeName] = (memory[storeName] || []).filter((entry) => entry.id !== id);
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, 'readwrite');
      transaction.objectStore(storeName).delete(id);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || new Error('删除失败'));
    });
  }

  function storeClear(storeName) {
    if (!db) {
      memory[storeName] = [];
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, 'readwrite');
      transaction.objectStore(storeName).clear();
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  }

  /* =======================================================
     Settings
  ======================================================= */
  function loadSettings() {
    try {
      const raw = window.localStorage.getItem(SETTINGS_KEY);
      if (!raw) return { ...DEFAULT_SETTINGS };
      const parsed = JSON.parse(raw);
      const names = String(parsed.names || '').trim().slice(0, 24) || DEFAULT_SETTINGS.names;
      const tagline = typeof parsed.tagline === 'string'
        ? parsed.tagline.trim().slice(0, 90)
        : DEFAULT_SETTINGS.tagline;
      let togetherDate = parseISO(parsed.togetherDate) ? parsed.togetherDate : DEFAULT_SETTINGS.togetherDate;
      if (parseISO(togetherDate) > todayDate()) togetherDate = DEFAULT_SETTINGS.togetherDate;
      return {
        names,
        togetherDate,
        tagline: tagline || DEFAULT_SETTINGS.tagline
      };
    } catch (error) {
      return { ...DEFAULT_SETTINGS };
    }
  }

  function persistSettings() {
    try {
      window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
      return true;
    } catch (error) {
      return false;
    }
  }

  function readSeedMarker() {
    try {
      return window.localStorage.getItem(SEED_KEY) === '1';
    } catch (error) {
      return false;
    }
  }

  function writeSeedMarker() {
    try {
      window.localStorage.setItem(SEED_KEY, '1');
    } catch (error) {
      /* The database marker is not critical. */
    }
  }

  /* =======================================================
     First-run sample data
  ======================================================= */
  async function seedCollections() {
    const now = Date.now();

    const events = [
      {
        id: 'demo-event-sea',
        title: '第一次一起看海',
        date: '2022-07-18',
        kind: 'anniversary',
        emoji: '🌊',
        note: '风很大，你把外套分给了我一半。',
        createdAt: now - 86400000 * 60,
        demo: true
      },
      {
        id: 'demo-event-birthday',
        title: '阿屿的生日',
        date: '1998-10-26',
        kind: 'anniversary',
        emoji: '🎂',
        note: '今年也要第一个和你说生日快乐。',
        createdAt: now - 86400000 * 59,
        demo: true
      },
      {
        id: 'demo-event-aurora',
        title: '去冰岛看极光',
        date: dateOffsetISO(128),
        kind: 'countdown',
        emoji: '✈️',
        note: '机票还没买，期待先存好。',
        createdAt: now - 86400000 * 58,
        demo: true
      }
    ];

    const photos = [
      {
        id: 'demo-photo-sea',
        src: 'assets/img/memory-1.svg',
        caption: '海边的第八个黄昏',
        date: dateOffsetISO(-2),
        favorite: true,
        width: 1200,
        height: 900,
        createdAt: now - 86400000 * 2,
        demo: true
      },
      {
        id: 'demo-photo-cafe',
        src: 'assets/img/memory-2.svg',
        caption: '雨天的两杯热拿铁',
        date: dateOffsetISO(-16),
        favorite: false,
        width: 1200,
        height: 900,
        createdAt: now - 86400000 * 16,
        demo: true
      },
      {
        id: 'demo-photo-stars',
        src: 'assets/img/memory-3.svg',
        caption: '山野里的星星，和我们',
        date: dateOffsetISO(-43),
        favorite: true,
        width: 1200,
        height: 900,
        createdAt: now - 86400000 * 43,
        demo: true
      },
      {
        id: 'demo-photo-picnic',
        src: 'assets/img/memory-4.svg',
        caption: '春天把野餐布铺在风里',
        date: dateOffsetISO(-71),
        favorite: false,
        width: 1200,
        height: 900,
        createdAt: now - 86400000 * 71,
        demo: true
      },
      {
        id: 'demo-photo-city',
        src: 'assets/img/memory-5.svg',
        caption: '晚风把路灯吹得很温柔',
        date: dateOffsetISO(-96),
        favorite: true,
        width: 1200,
        height: 900,
        createdAt: now - 86400000 * 96,
        demo: true
      },
      {
        id: 'demo-photo-breakfast',
        src: 'assets/img/memory-6.svg',
        caption: '阳光落在两个人的早餐上',
        date: dateOffsetISO(-124),
        favorite: false,
        width: 1200,
        height: 900,
        createdAt: now - 86400000 * 124,
        demo: true
      }
    ];

    const diaries = [
      {
        id: 'demo-diary-rain',
        title: '雨落下的时候，刚好你在',
        date: dateOffsetISO(-2),
        mood: '心动',
        weather: '小雨',
        tags: ['日常', '雨天'],
        content: `今天下班时，天空忽然下起很大的雨。

我站在便利店门口，看见你撑着一把并不大的伞跑过来，裤脚湿了一截。你把伞往我这边倾了倾，说：“怕你等太久。”

那一刻，雨声好像都变轻了。

回家的路上，我们挤在同一把伞下。你走得很慢，我就也跟着慢下来。

> 原来喜欢一个人，是连下雨天都变得值得纪念。

到家后你煮了姜茶，有点辣，但很暖。今天也是很喜欢你的一天。`,
        createdAt: now - 86400000 * 2,
        updatedAt: now - 86400000 * 2,
        demo: true
      },
      {
        id: 'demo-diary-weekend',
        title: '关于周末的两件小事',
        date: dateOffsetISO(-18),
        mood: '平静',
        weather: '晴',
        tags: ['周末', '碎碎念'],
        content: `这个周末没有出门，我们在家做了两件很小的事：

- 一起把阳台上的薄荷换了新盆
- 看完了那部一直拖着没看的电影

电影结尾很普通，我却记得你靠在我肩膀上睡着的样子。醒来后你问我演到哪里了，我骗你说：“刚好演到最精彩的地方。”

**今日份喜欢**：阳光、薄荷、旧电影，还有一个睡着的你。

---

下周想和你去逛一次花市。`,
        createdAt: now - 86400000 * 18,
        updatedAt: now - 86400000 * 18,
        demo: true
      }
    ];

    const wishes = [
      { id: 'demo-wish-1', text: '一起去看一次极光', done: false, createdAt: now - 86400000 * 30, demo: true },
      { id: 'demo-wish-2', text: '在凌晨的海边等一场日出', done: true, createdAt: now - 86400000 * 29, demo: true },
      { id: 'demo-wish-3', text: '养一只叫“年糕”的小狗', done: false, createdAt: now - 86400000 * 28, demo: true },
      { id: 'demo-wish-4', text: '给对方做一顿完整的晚餐', done: true, createdAt: now - 86400000 * 27, demo: true },
      { id: 'demo-wish-5', text: '去一次没有计划的旅行', done: false, createdAt: now - 86400000 * 26, demo: true }
    ];

    const capsules = [
      {
        id: 'demo-capsule-future',
        title: '写给一年后的我们',
        unlockDate: dateOffsetISO(365),
        content: `写给一年后的我们：

如果你们读到这封信的时候，还是会在下班路上分享同一副耳机，还是会为了晚饭吃什么讨论很久，那我想，这一年应该过得还不错。

希望我们去了更多地方，也把平凡的日子过得更熟练了一点。希望吵完架以后，还是有人愿意先递上一杯热水。

如果有时候觉得生活有点难，就想想写下这封信的晚上——我们正认真地相信，未来会很好。

一年后见。要一直相爱。`,
        createdAt: now - 86400000 * 5,
        demo: true
      },
      {
        id: 'demo-capsule-summer',
        title: '写给下一个夏天',
        unlockDate: dateOffsetISO(90),
        content: `给下一个夏天的我们：

不知道这个时候，我们有没有学会在很热的时候也不发脾气。有没有一起去吃那家总在排队的冰淇淋，有没有在傍晚的风里散过很多次步。

如果生活还是忙忙碌碌，那就允许自己偶尔停下来。买半个西瓜，坐在阳台上听蝉鸣，把风扇调到最小档。

夏天会过去，但我们会一直在。`,
        createdAt: now - 86400000 * 3,
        demo: true
      },
      {
        id: 'demo-capsule-newyear',
        title: '第一次一起跨年',
        unlockDate: dateOffsetISO(-32),
        content: `零点的烟花在窗外炸开的时候，你忽然转过头对我说：“新年快乐。”

周围很吵，我却听得很清楚。

那是我们一起过的第一个新年。我们在便利店里买了最后两罐热可可，坐在江边的台阶上，把所有没头没脑的愿望都许了一遍。

现在再看，愿望有没有实现好像没那么重要。重要的是，那时候的我们，真的相信未来会来。`,
        createdAt: now - 86400000 * 400,
        openedAt: now - 86400000 * 30,
        demo: true
      }
    ];

    await Promise.all([
      ...events.map((item) => storePut('events', item)),
      ...photos.map((item) => storePut('photos', item)),
      ...diaries.map((item) => storePut('diaries', item)),
      ...wishes.map((item) => storePut('wishes', item)),
      ...capsules.map((item) => storePut('capsules', item))
    ]);
  }

  async function loadCollections() {
    const [events, photos, diaries, wishes, capsules] = await Promise.all([
      storeGetAll('events'),
      storeGetAll('photos'),
      storeGetAll('diaries'),
      storeGetAll('wishes'),
      storeGetAll('capsules')
    ]);
    state.events = events;
    state.photos = photos;
    state.diaries = diaries;
    state.wishes = wishes;
    state.capsules = capsules;
  }

  /* =======================================================
     Modal, confirm and toast
  ======================================================= */
  function openModal(id, options = {}) {
    const modal = byId(id);
    if (!modal) return;
    if (!modal.classList.contains('is-open')) {
      modal.classList.add('is-open');
      modal.setAttribute('aria-hidden', 'false');
      if (!modalStack.includes(id)) modalStack.push(id);
      document.body.classList.add('modal-open');
    }
    if (options.focus) {
      window.setTimeout(() => {
        if (!modal.classList.contains('is-open')) return;
        const target = $(options.focus, modal);
        if (target && typeof target.focus === 'function') {
          target.focus({ preventScroll: true });
        }
      }, 120);
    }
  }

  function closeModal(id) {
    const modal = byId(id);
    if (!modal || !modal.classList.contains('is-open')) return;
    modal.classList.remove('is-open');
    modal.setAttribute('aria-hidden', 'true');
    modalStack = modalStack.filter((item) => item !== id);
    if (!modalStack.length) document.body.classList.remove('modal-open');
  }

  function closeTopModal() {
    if (!modalStack.length) return;
    const id = modalStack[modalStack.length - 1];
    if (id === 'confirm-modal') {
      settleConfirm(false);
      return;
    }
    closeModal(id);
  }

  function askConfirm(options = {}) {
    const title = options.title || '确认一下';
    const message = options.message || '这个操作不可以撤销。';
    const confirmText = options.confirmText || '确认删除';

    if (confirmResolve) {
      const previous = confirmResolve;
      confirmResolve = null;
      previous(false);
    }

    byId('confirm-title').textContent = title;
    byId('confirm-message').textContent = message;
    byId('confirm-ok').textContent = confirmText;

    return new Promise((resolve) => {
      confirmResolve = resolve;
      openModal('confirm-modal', { focus: '#confirm-cancel' });
    });
  }

  function settleConfirm(result) {
    if (!confirmResolve) {
      closeModal('confirm-modal');
      return;
    }
    const resolve = confirmResolve;
    confirmResolve = null;
    closeModal('confirm-modal');
    resolve(Boolean(result));
  }

  /* =======================================================
     Markdown renderer
  ======================================================= */
  function inlineMarkdown(text) {
    const codeSpans = [];
    let output = escapeHTML(text);

    output = output.replace(/`([^`\n]+)`/g, (match, code) => {
      codeSpans.push(`<code>${code}</code>`);
      return `\u0001C${codeSpans.length - 1}\u0001`;
    });

    const isSafeUrl = (url) => {
      const decoded = String(url).replace(/&amp;/g, '&').trim();
      return /^(https?:|mailto:)/i.test(decoded) ||
        /^(#|\/|\.{1,2}\/)/.test(decoded);
    };

    output = output.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+[^)]*)?\)/g, (match, alt, url) => {
      if (!isSafeUrl(url)) return alt;
      return `<img src="${url}" alt="${alt}" loading="lazy">`;
    });

    output = output.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+[^)]*)?\)/g, (match, label, url) => {
      if (!isSafeUrl(url)) return label;
      const external = /^https?:/i.test(url.replace(/&amp;/g, '&'));
      return `<a href="${url}"${external ? ' target="_blank" rel="noopener noreferrer"' : ''}>${label}</a>`;
    });

    output = output
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/__([^_]+)__/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
      .replace(/(^|[^_])_([^_\n]+)_/g, '$1<em>$2</em>')
      .replace(/~~([^~]+)~~/g, '<del>$1</del>');

    output = output.replace(/\u0001C(\d+)\u0001/g, (match, index) => codeSpans[Number(index)] || '');
    return output;
  }

  function renderMarkdown(source) {
    const raw = String(source || '').replace(/\r\n?/g, '\n');
    if (!raw.trim()) return '<p class="md-empty">还没有内容。</p>';

    const codeBlocks = [];
    let text = raw.replace(/```([^\n`]*)\n([\s\S]*?)```/g, (match, language, code) => {
      const lang = language.trim();
      codeBlocks.push(`<pre${lang ? ` data-lang="${escapeAttr(lang)}"` : ''}><code>${escapeHTML(code.replace(/\n$/, ''))}</code></pre>`);
      return `\n\u0000CODE${codeBlocks.length - 1}\u0000\n`;
    });

    const lines = text.split('\n');
    const out = [];
    let index = 0;

    const isBlockStart = (line) => {
      return /^#{1,6}\s+/.test(line) ||
        /^>\s?/.test(line) ||
        /^\s*([-*+]|\d+\.)\s+/.test(line) ||
        /^\s*(---+|\*\*\*+|___+)\s*$/.test(line) ||
        /^\u0000CODE\d+\u0000$/.test(line);
    };

    while (index < lines.length) {
      const line = lines[index];

      if (!line.trim()) {
        index += 1;
        continue;
      }

      const codeMatch = line.match(/^\u0000CODE(\d+)\u0000$/);
      if (codeMatch) {
        out.push(codeBlocks[Number(codeMatch[1])] || '');
        index += 1;
        continue;
      }

      const heading = line.match(/^(#{1,6})\s+(.*)$/);
      if (heading) {
        const level = heading[1].length;
        out.push(`<h${level}>${inlineMarkdown(heading[2].trim())}</h${level}>`);
        index += 1;
        continue;
      }

      if (/^\s*(---+|\*\*\*+|___+)\s*$/.test(line)) {
        out.push('<hr>');
        index += 1;
        continue;
      }

      if (/^>\s?/.test(line)) {
        const quoteLines = [];
        while (index < lines.length && /^>\s?/.test(lines[index])) {
          quoteLines.push(lines[index].replace(/^>\s?/, ''));
          index += 1;
        }
        const quoteHtml = quoteLines
          .map((quoteLine) => quoteLine.trim() ? `<p>${inlineMarkdown(quoteLine)}</p>` : '')
          .join('');
        out.push(`<blockquote>${quoteHtml}</blockquote>`);
        continue;
      }

      const listMatch = line.match(/^\s*([-*+]|(\d+)\.)\s+(.*)$/);
      if (listMatch) {
        const ordered = Boolean(listMatch[2]);
        const items = [];
        while (index < lines.length) {
          const itemMatch = lines[index].match(/^\s*([-*+]|(\d+)\.)\s+(.*)$/);
          if (!itemMatch || Boolean(itemMatch[2]) !== ordered) break;
          items.push(itemMatch[3]);
          index += 1;
        }
        const tag = ordered ? 'ol' : 'ul';
        out.push(`<${tag}>${items.map((item) => `<li>${inlineMarkdown(item)}</li>`).join('')}</${tag}>`);
        continue;
      }

      const paragraph = [line];
      index += 1;
      while (index < lines.length && lines[index].trim() && !isBlockStart(lines[index])) {
        paragraph.push(lines[index]);
        index += 1;
      }
      out.push(`<p>${paragraph.map((paragraphLine) => inlineMarkdown(paragraphLine)).join('<br>')}</p>`);
    }

    return out.join('\n');
  }

  function stripMarkdown(source) {
    return String(source || '')
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/^#{1,6}\s+/gm, '')
      .replace(/^\s*>\s?/gm, '')
      .replace(/^\s*[-*+]\s+/gm, '')
      .replace(/^\s*\d+\.\s+/gm, '')
      .replace(/[*_~`]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function firstContentTitle(content) {
    const firstLine = String(content || '')
      .replace(/\r/g, '')
      .split('\n')
      .map((line) => line.trim())
      .find(Boolean);
    if (!firstLine) return '';
    return stripMarkdown(firstLine).slice(0, 60);
  }

  /* =======================================================
     Rendering — hero, settings and stats
  ======================================================= */
  function renderHero() {
    const days = daysTogether();
    const names = state.settings.names || '我们';
    const tagline = state.settings.tagline || DEFAULT_SETTINGS.tagline;
    const startAnniversary = getNextAnnual(state.settings.togetherDate);

    byId('hero-desc').innerHTML = `给 <strong>${escapeHTML(names)}</strong> 的私藏角落。${escapeHTML(tagline)}`;
    byId('footer-names').textContent = names;
    byId('hero-photo-caption').textContent = `我们的第 ${days} 个黄昏`;
    byId('days-together').textContent = days;
    byId('feature-days').textContent = days;
    byId('feature-date').textContent = `${formatCN(state.settings.togetherDate)} · 我们的起点`;
    byId('feature-sub').textContent = days > 1
      ? `相爱第 ${days} 天 · 今天也在好好喜欢你`
      : '故事从今天开始';

    if (startAnniversary) {
      byId('feature-next').textContent = startAnniversary.days === 0
        ? '今天 · 纪念日快乐'
        : `${formatDot(startAnniversary.iso)} · 还有 ${startAnniversary.days} 天`;
    }

    const upcoming = getNextUpcomingItem();
    if (upcoming) {
      byId('hero-next-title').textContent = upcoming.title;
      byId('hero-next-count').textContent = upcoming.days === 0 ? '今天' : upcoming.days;
      const suffix = byId('hero-next-count').nextElementSibling;
      if (suffix) suffix.textContent = upcoming.days === 0 ? '' : '天后';
      byId('hero-next-date').textContent = `${formatDot(upcoming.iso)} · ${upcoming.sub}`;
      byId('hero-next-days').textContent = upcoming.days;
    } else {
      byId('hero-next-title').textContent = '普通又珍贵的一天';
      byId('hero-next-count').textContent = '∞';
      byId('hero-next-date').textContent = '期待下一个被记下的日子';
      byId('hero-next-days').textContent = '∞';
    }

    document.title = `${names} · 朝暮`;
  }

  function renderStats() {
    const done = state.wishes.filter((wish) => wish.done).length;
    byId('stat-days').textContent = daysTogether();
    byId('stat-photos').textContent = state.photos.length;
    byId('stat-diaries').textContent = state.diaries.length;
    byId('stat-wishes').textContent = `${done}/${state.wishes.length}`;
    byId('photo-total-mini').textContent = state.photos.length;
    byId('footer-year').textContent = new Date().getFullYear();
  }

  /* =======================================================
     Anniversaries
  ======================================================= */
  function decorateEvent(event) {
    const annual = event.kind === 'anniversary';
    const parsed = parseISO(event.date);
    if (!parsed) return null;

    let days = 0;
    let nextISO = event.date;
    let ordinal = 0;

    if (annual) {
      const next = getNextAnnual(event.date);
      if (!next) return null;
      days = next.days;
      nextISO = next.iso;
      ordinal = next.ordinal;
    } else {
      days = diffDays(todayDate(), parsed);
    }

    return {
      raw: event,
      annual,
      days,
      nextISO,
      ordinal,
      past: days < 0,
      sortKey: days >= 0 ? days : 1000000 + Math.abs(days)
    };
  }

  function getNextUpcomingItem() {
    const items = [];
    const together = getNextAnnual(state.settings.togetherDate);
    if (together) {
      items.push({
        title: '在一起纪念日',
        days: together.days,
        iso: together.iso,
        sub: together.ordinal > 0 ? `第 ${together.ordinal} 个纪念日` : '我们的起点'
      });
    }

    state.events.forEach((event) => {
      const decorated = decorateEvent(event);
      if (!decorated || decorated.days < 0) return;
      items.push({
        title: event.title,
        days: decorated.days,
        iso: decorated.nextISO,
        sub: event.kind === 'anniversary' ? '每年纪念日' : '一次倒计时'
      });
    });

    items.sort((a, b) => a.days - b.days);
    return items[0] || null;
  }

  function renderDates() {
    const decorated = state.events
      .map(decorateEvent)
      .filter(Boolean)
      .sort((a, b) => a.sortKey - b.sortKey);

    const cards = decorated.map(({ raw, annual, days, nextISO, ordinal, past }) => {
      const date = parseISO(raw.date);
      const countValue = days === 0 ? '今天' : Math.abs(days);
      const countSuffix = days === 0 ? '' : (days > 0 ? '天后' : '天前');
      const kicker = annual
        ? `每年纪念 · ${date.getMonth() + 1}月${date.getDate()}日`
        : `一次倒计时 · ${formatDot(raw.date)}`;
      const nextLeft = annual ? `下一次 · ${formatDot(nextISO)}` : `约定日 · ${formatCN(raw.date)}`;
      let nextRight = '';
      if (annual) {
        nextRight = ordinal > 0 ? `第 ${ordinal} 个年头` : '第一年';
      } else {
        nextRight = days >= 0 ? (days === 0 ? '就是今天' : '正在奔赴') : '已经成为回忆';
      }

      return `
        <article class="event-card${past ? ' past' : ''}" data-event-card="${escapeAttr(raw.id)}">
          <div class="event-top">
            <span class="event-emoji" aria-hidden="true">${escapeHTML(raw.emoji || '✨')}</span>
            <div class="event-tools">
              <button class="icon-mini" type="button" data-edit-event="${escapeAttr(raw.id)}" aria-label="编辑 ${escapeAttr(raw.title)}"><svg class="icon"><use href="#i-pen"></use></svg></button>
              <button class="icon-mini" type="button" data-delete-event="${escapeAttr(raw.id)}" aria-label="删除 ${escapeAttr(raw.title)}"><svg class="icon"><use href="#i-trash"></use></svg></button>
            </div>
          </div>
          <p class="event-kicker">${escapeHTML(kicker)}</p>
          <h3>${escapeHTML(raw.title)}</h3>
          <div class="event-count"><strong>${escapeHTML(countValue)}</strong><span>${escapeHTML(countSuffix)}</span></div>
          <p class="event-note">${escapeHTML(raw.note || ' ') || '&nbsp;'}</p>
          <div class="event-next"><span>${escapeHTML(nextLeft)}</span><span>${escapeHTML(nextRight)}</span></div>
        </article>
      `;
    }).join('');

    byId('event-grid').innerHTML = `
      ${cards}
      <button class="event-add-tile" type="button" data-add-event>
        <span><svg class="icon"><use href="#i-plus"></use></svg></span>
        <strong>再记一个日子</strong>
      </button>
    `;
  }

  function openEventForm(event = null) {
    const form = byId('event-form');
    form.reset();
    byId('event-id').value = '';
    byId('event-date').value = todayISO();
    byId('event-kind-hint').textContent = '每年都会在这一天提醒你，适合生日、相识纪念日。';
    byId('event-modal-title').textContent = '添加一个重要日子';

    if (event) {
      byId('event-id').value = event.id;
      byId('event-title').value = event.title || '';
      byId('event-date').value = event.date || todayISO();
      const radio = $(`input[name="event-kind"][value="${event.kind === 'countdown' ? 'countdown' : 'anniversary'}"]`, form);
      if (radio) radio.checked = true;
      byId('event-emoji').value = event.emoji || '🌷';
      byId('event-note').value = event.note || '';
      byId('event-modal-title').textContent = '编辑这个重要日子';
      updateEventKindHint();
    }

    openModal('event-modal', { focus: '#event-title' });
  }

  function updateEventKindHint() {
    const selected = $('input[name="event-kind"]:checked');
    const isAnnual = !selected || selected.value === 'anniversary';
    byId('event-kind-hint').textContent = isAnnual
      ? '每年都会在这一天提醒你，适合生日、相识纪念日。'
      : '只倒计时到这一个日期，适合旅行、演唱会或某个特别的约定。';
  }

  async function saveEvent(event) {
    const id = byId('event-id').value;
    const existing = state.events.find((item) => item.id === id);
    const kindInput = $('input[name="event-kind"]:checked');
    const title = byId('event-title').value.trim();
    const date = byId('event-date').value;
    const kind = kindInput ? kindInput.value : 'anniversary';
    const emoji = byId('event-emoji').value || '✨';
    const note = byId('event-note').value.trim().slice(0, 80);

    if (!title) {
      showToast('先给这个日子起个名字吧');
      byId('event-title').focus();
      return;
    }
    if (!parseISO(date)) {
      showToast('请选择一个有效的日期', 'error');
      return;
    }

    const record = {
      id: existing ? existing.id : uid('event'),
      title,
      date,
      kind,
      emoji,
      note,
      createdAt: existing ? existing.createdAt : Date.now(),
      demo: existing ? Boolean(existing.demo) : false
    };

    try {
      await storePut('events', record);
      if (existing) {
        state.events = state.events.map((item) => item.id === existing.id ? record : item);
      } else {
        state.events.push(record);
      }
      closeModal('event-modal');
      renderDates();
      renderHero();
      showToast(existing ? '这个日子已经更新' : '重要日子已经收好');
    } catch (error) {
      console.error(error);
      showToast('保存失败，请稍后再试', 'error');
    }
  }

  async function deleteEvent(id) {
    const event = state.events.find((item) => item.id === id);
    if (!event) return;
    const confirmed = await askConfirm({
      title: '删掉这个日子？',
      message: `“${event.title}”会从纪念日清单中移除，但你们的回忆不会。`,
      confirmText: '确认删除'
    });
    if (!confirmed) return;

    try {
      await storeDelete('events', id);
      state.events = state.events.filter((item) => item.id !== id);
      renderDates();
      renderHero();
      showToast('已经把这个日子从清单里移除');
    } catch (error) {
      console.error(error);
      showToast('删除失败，请稍后再试', 'error');
    }
  }

  /* =======================================================
     Photos
  ======================================================= */
  function getVisiblePhotos() {
    let list = state.photos.slice();
    if (state.photoFilter === 'favorite') {
      list = list.filter((photo) => photo.favorite);
    }
    return list.sort((a, b) => {
      const createdDiff = (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0);
      if (createdDiff !== 0) return createdDiff;
      return String(b.date || '').localeCompare(String(a.date || ''));
    });
  }

  function renderPhotos() {
    const allCount = state.photos.length;
    const visible = getVisiblePhotos();
    const gallery = byId('gallery');
    const empty = byId('gallery-empty');

    byId('photo-count').textContent = `${allCount} 张回忆`;

    gallery.innerHTML = visible.map((photo) => {
      const caption = photo.caption || '未命名回忆';
      return `
        <article class="photo-card" data-photo-id="${escapeAttr(photo.id)}" tabindex="0" role="button" aria-label="查看照片：${escapeAttr(caption)}">
          <img src="${escapeAttr(photo.src)}" alt="${escapeAttr(caption)}" width="${Number(photo.width) || 1200}" height="${Number(photo.height) || 900}" loading="lazy">
          ${photo.demo ? '<span class="photo-demo-tag">示例回忆</span>' : ''}
          <button class="photo-fav${photo.favorite ? ' is-fav' : ''}" type="button" data-fav-photo="${escapeAttr(photo.id)}" aria-label="${photo.favorite ? '取消收藏' : '收藏这张照片'}" aria-pressed="${photo.favorite ? 'true' : 'false'}">
            <svg class="icon"><use href="#i-star"></use></svg>
          </button>
          <div class="photo-overlay">
            <div class="photo-caption">
              <strong>${escapeHTML(caption)}</strong>
              <span>${escapeHTML(formatDot(photo.date))}</span>
            </div>
          </div>
        </article>
      `;
    }).join('');

    const isEmpty = visible.length === 0;
    empty.hidden = !isEmpty;
    gallery.hidden = isEmpty;

    if (isEmpty) {
      const title = $('#gallery-empty h3');
      const description = $('#gallery-empty p');
      const action = byId('empty-upload');
      if (state.photoFilter === 'favorite' && allCount > 0) {
        title.textContent = '还没有收藏的照片';
        description.textContent = '在照片右上角点亮小星星，最喜欢的瞬间就会出现在这里。';
        action.textContent = '看看全部回忆';
      } else {
        title.textContent = '这里还空着一面墙';
        description.textContent = '上传你们的第一张合照，让这面墙慢慢满起来。';
        action.textContent = '选择照片';
      }
    }
  }

  function loadImageElement(source) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('图片无法读取'));
      image.src = source;
    });
  }

  async function compressImage(file) {
    if (!file.type.startsWith('image/')) throw new Error('不是图片文件');
    if (file.size > 30 * 1024 * 1024) throw new Error('图片超过 30MB');

    let source = null;
    let objectUrl = '';
    try {
      if ('createImageBitmap' in window) {
        try {
          source = await createImageBitmap(file, { imageOrientation: 'from-image' });
        } catch (error) {
          source = null;
        }
      }
      if (!source) {
        objectUrl = URL.createObjectURL(file);
        source = await loadImageElement(objectUrl);
      }

      const width = source.width || source.naturalWidth;
      const height = source.height || source.naturalHeight;
      if (!width || !height) throw new Error('图片尺寸无法识别');

      const maxSide = 1600;
      const ratio = Math.min(1, maxSide / Math.max(width, height));
      const targetWidth = Math.max(1, Math.round(width * ratio));
      const targetHeight = Math.max(1, Math.round(height * ratio));

      const canvas = document.createElement('canvas');
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      const context = canvas.getContext('2d');
      context.fillStyle = '#fbf6f0';
      context.fillRect(0, 0, targetWidth, targetHeight);
      context.drawImage(source, 0, 0, targetWidth, targetHeight);

      const src = canvas.toDataURL('image/jpeg', 0.84);
      if (!src || src.length < 100) throw new Error('图片处理失败');

      return { src, width: targetWidth, height: targetHeight };
    } finally {
      if (source && typeof source.close === 'function') source.close();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    }
  }

  async function handlePhotoFiles(fileList) {
    let files = Array.from(fileList || []).filter((file) => file.type.startsWith('image/'));
    if (!files.length) {
      showToast('请选择图片文件（JPG / PNG / WebP）', 'error');
      return;
    }

    let truncated = false;
    if (files.length > 20) {
      files = files.slice(0, 20);
      truncated = true;
    }

    const uploadButton = byId('upload-photo');
    uploadButton.disabled = true;
    showToast(`正在把 ${files.length} 张照片收好…`);

    let added = 0;
    let failed = 0;
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      try {
        const result = await compressImage(file);
        const photo = {
          id: uid('photo'),
          src: result.src,
          width: result.width,
          height: result.height,
          caption: fileBaseName(file.name),
          date: todayISO(),
          favorite: false,
          createdAt: Date.now() + index,
          demo: false
        };
        await storePut('photos', photo);
        state.photos.unshift(photo);
        added += 1;
      } catch (error) {
        console.warn('Photo failed:', file.name, error);
        failed += 1;
      }
    }

    uploadButton.disabled = false;
    byId('photo-input').value = '';
    if (added && state.photoFilter === 'favorite') {
      state.photoFilter = 'all';
      syncPhotoFilterTabs();
    }
    renderPhotos();
    renderStats();

    if (added && failed) {
      showToast(`收好了 ${added} 张，另有 ${failed} 张无法读取`);
    } else if (added) {
      showToast(truncated ? `一次最多收 20 张，已收好 ${added} 张` : `已经收好 ${added} 张新照片`);
    } else {
      showToast('照片读取失败，换一张试试', 'error');
    }
  }

  function openLightbox(photoId) {
    if (!photoId) return;
    const visible = getVisiblePhotos();
    if (!visible.some((photo) => photo.id === photoId)) return;
    state.activePhotoId = photoId;
    updateLightbox();
    openModal('lightbox');
  }

  function updateLightbox() {
    const visible = getVisiblePhotos();
    const index = visible.findIndex((photo) => photo.id === state.activePhotoId);
    if (index < 0) {
      closeModal('lightbox');
      return;
    }
    const photo = visible[index];
    const image = byId('lightbox-image');
    image.src = photo.src;
    image.alt = photo.caption || '我们的照片';
    byId('lightbox-date').textContent = `${formatDot(photo.date)}${photo.demo ? ' · 示例回忆' : ''}`;
    byId('lightbox-caption').value = photo.caption || '';
    byId('lightbox-count').textContent = `${index + 1} / ${visible.length}`;
    byId('lightbox-prev').disabled = visible.length <= 1;
    byId('lightbox-next').disabled = visible.length <= 1;

    const favoriteButton = byId('lightbox-favorite');
    favoriteButton.classList.toggle('is-fav', Boolean(photo.favorite));
    favoriteButton.querySelector('span').textContent = photo.favorite ? '已收藏' : '收藏';
    favoriteButton.setAttribute('aria-pressed', photo.favorite ? 'true' : 'false');
  }

  function navigateLightbox(direction) {
    const visible = getVisiblePhotos();
    if (visible.length <= 1) return;
    const index = visible.findIndex((photo) => photo.id === state.activePhotoId);
    if (index < 0) return;
    const nextIndex = (index + direction + visible.length) % visible.length;
    state.activePhotoId = visible[nextIndex].id;
    updateLightbox();
  }

  async function saveLightboxCaption(silent = false) {
    const photo = state.photos.find((item) => item.id === state.activePhotoId);
    if (!photo) return;
    const caption = byId('lightbox-caption').value.trim().slice(0, 80) || '未命名回忆';
    photo.caption = caption;
    photo.updatedAt = Date.now();
    try {
      await storePut('photos', photo);
      renderPhotos();
      updateLightbox();
      if (!silent) showToast('照片里的故事已经保存');
    } catch (error) {
      console.error(error);
      showToast('保存失败，请稍后再试', 'error');
    }
  }

  async function togglePhotoFavorite(photoId) {
    const photo = state.photos.find((item) => item.id === photoId);
    if (!photo) return;
    photo.favorite = !photo.favorite;
    try {
      await storePut('photos', photo);
      renderPhotos();
      updateLightbox();
      showToast(photo.favorite ? '已经放进收藏' : '已从收藏中移除');
    } catch (error) {
      console.error(error);
      showToast('操作失败，请稍后再试', 'error');
    }
  }

  async function deleteActivePhoto() {
    const photo = state.photos.find((item) => item.id === state.activePhotoId);
    if (!photo) return;
    const confirmed = await askConfirm({
      title: '删掉这张照片？',
      message: '这张照片会从相册里移除，删除后无法恢复。',
      confirmText: '确认删除'
    });
    if (!confirmed) return;

    try {
      await storeDelete('photos', photo.id);
      state.photos = state.photos.filter((item) => item.id !== photo.id);
      closeModal('lightbox');
      state.activePhotoId = null;
      renderPhotos();
      renderStats();
      showToast('照片已经从相册移除');
    } catch (error) {
      console.error(error);
      showToast('删除失败，请稍后再试', 'error');
    }
  }

  /* =======================================================
     Diary
  ======================================================= */
  function renderDiaries() {
    const query = state.diarySearch.trim().toLowerCase();
    const sorted = state.diaries.slice().sort((a, b) => {
      const dateDiff = String(b.date || '').localeCompare(String(a.date || ''));
      if (dateDiff !== 0) return dateDiff;
      return (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0);
    });
    const filtered = sorted.filter((diary) => {
      if (!query) return true;
      const haystack = [diary.title, diary.content, (diary.tags || []).join(' ')]
        .join(' ')
        .toLowerCase();
      return haystack.includes(query);
    });

    byId('diary-count').textContent = query ? `找到 ${filtered.length} 篇` : `共 ${state.diaries.length} 篇`;
    const list = byId('diary-list');
    const empty = byId('diary-empty');
    const isEmpty = filtered.length === 0;
    list.hidden = isEmpty;
    empty.hidden = !isEmpty;

    if (isEmpty) {
      const title = $('#diary-empty h3');
      const description = $('#diary-empty p');
      if (query) {
        title.textContent = '没有找到这篇日记';
        description.textContent = '换一个关键词试试，或者写下新的一页。';
        byId('empty-diary').textContent = '写一篇新的';
      } else {
        title.textContent = '今天，想记下点什么？';
        description.textContent = '哪怕只有一句“今天也很喜欢你”，也值得被写下来。';
        byId('empty-diary').textContent = '打开空白日记';
      }
    }

    list.innerHTML = filtered.map((diary) => {
      const excerpt = stripMarkdown(diary.content).slice(0, 150);
      const tags = (diary.tags || []).slice(0, 3).map((tag) => `<span class="diary-tag">#${escapeHTML(tag)}</span>`).join('');
      const attachment = diary.attachment
        ? `<span class="diary-attachment-mark"><svg class="icon"><use href="#i-paperclip"></use></svg>PDF</span>`
        : '';
      return `
        <article class="diary-card" data-diary-id="${escapeAttr(diary.id)}" tabindex="0" role="button" aria-label="阅读日记：${escapeAttr(diary.title || '无题')}">
          <div class="diary-card-date">
            <span>${escapeHTML(formatDot(diary.date))} · ${escapeHTML(weekdayCN(diary.date))}</span>
            <i></i>
            <span class="diary-mood">${escapeHTML(diary.mood || '日常')}${diary.weather ? ` · ${escapeHTML(diary.weather)}` : ''}</span>
          </div>
          <h3>${escapeHTML(diary.title || '无题')}${attachment}</h3>
          <p class="diary-excerpt">${escapeHTML(excerpt || '这一页写得很轻，等你翻开。')}</p>
          <div class="diary-card-foot">
            <div class="diary-tags">${tags || '<span class="diary-tag">#随手记</span>'}</div>
            <span class="diary-open">翻开看看<svg class="icon"><use href="#i-arrow"></use></svg></span>
          </div>
        </article>
      `;
    }).join('');
  }

  function setEditorTab(tab) {
    const writeTab = byId('tab-write');
    const previewTab = byId('tab-preview');
    const content = byId('diary-content');
    const preview = byId('diary-preview');
    const isPreview = tab === 'preview';

    writeTab.classList.toggle('is-active', !isPreview);
    previewTab.classList.toggle('is-active', isPreview);
    writeTab.setAttribute('aria-selected', String(!isPreview));
    previewTab.setAttribute('aria-selected', String(isPreview));
    content.hidden = isPreview;
    preview.hidden = !isPreview;

    if (isPreview) {
      preview.innerHTML = renderMarkdown(content.value);
    }
  }

  function updateMoodPicker(mood) {
    state.currentMood = mood || '开心';
    $$('#mood-picker button').forEach((button) => {
      const active = button.dataset.mood === state.currentMood;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
  }

  function renderAttachmentChip() {
    const chip = byId('diary-attachment-chip');
    const attachment = state.editorAttachment;
    chip.hidden = !attachment;
    if (attachment) {
      byId('attachment-name').textContent = attachment.name || 'PDF 附件.pdf';
      byId('attachment-size').textContent = `${formatBytes(attachment.size)} · 保存日记时一并存好`;
    }
  }

  function updateDiaryWordcount() {
    const content = byId('diary-content').value;
    const count = content.replace(/\s/g, '').length;
    byId('diary-wordcount').textContent = count;
    if (!byId('diary-preview').hidden) {
      byId('diary-preview').innerHTML = renderMarkdown(content);
    }
  }

  function openDiaryEditor(diary = null) {
    const form = byId('diary-form');
    form.reset();
    state.editingDiaryId = diary ? diary.id : null;
    state.pendingPdfFile = null;
    state.currentMood = diary ? (diary.mood || '开心') : '开心';
    state.editorAttachment = diary && diary.attachment
      ? { ...diary.attachment }
      : null;

    byId('diary-id').value = diary ? diary.id : '';
    byId('diary-title').value = diary ? (diary.title || '') : '';
    byId('diary-date').value = diary ? (diary.date || todayISO()) : todayISO();
    byId('diary-weather').value = diary ? (diary.weather || '晴') : '晴';
    byId('diary-tags').value = diary ? (diary.tags || []).join(' ') : '';
    byId('diary-content').value = diary ? (diary.content || '') : '';
    byId('diary-editor-title').textContent = diary ? '编辑这篇日记' : '写下今天';
    updateMoodPicker(state.currentMood);
    renderAttachmentChip();
    updateDiaryWordcount();
    setEditorTab('write');

    openModal('diary-editor-modal', { focus: diary ? '#diary-content' : '#diary-title' });
  }

  function insertMarkdown(type) {
    const textarea = byId('diary-content');
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const value = textarea.value;
    const selected = value.slice(start, end);
    let insertion = '';
    let cursorOffset = 0;

    const wrap = (before, after, placeholder) => {
      const middle = selected || placeholder;
      insertion = `${before}${middle}${after}`;
      cursorOffset = before.length + middle.length + after.length;
      if (!selected) {
        return { selectionStart: start + before.length, selectionEnd: start + before.length + middle.length };
      }
      return null;
    };

    let range = null;

    switch (type) {
      case 'bold':
        range = wrap('**', '**', '加粗的文字');
        break;
      case 'italic':
        range = wrap('*', '*', '倾斜的心事');
        break;
      case 'heading':
        insertion = `## ${selected || '一个小标题'}`;
        cursorOffset = insertion.length;
        range = { selectionStart: start + 3, selectionEnd: start + 3 + (selected || '一个小标题').length };
        break;
      case 'quote':
        insertion = `> ${selected || '想记住的一句话'}`;
        cursorOffset = insertion.length;
        range = { selectionStart: start + 2, selectionEnd: start + 2 + (selected || '想记住的一句话').length };
        break;
      case 'list':
        insertion = `- ${selected || '第一件小事'}`;
        cursorOffset = insertion.length;
        range = { selectionStart: start + 2, selectionEnd: start + 2 + (selected || '第一件小事').length };
        break;
      case 'link':
        insertion = `[${selected || '链接文字'}](https://)`;
        cursorOffset = insertion.length;
        range = {
          selectionStart: start + (selected || '链接文字').length + 3,
          selectionEnd: start + (selected || '链接文字').length + 11
        };
        break;
      default:
        return;
    }

    textarea.value = value.slice(0, start) + insertion + value.slice(end);
    textarea.focus();
    if (range) {
      textarea.setSelectionRange(range.selectionStart, range.selectionEnd);
    } else {
      textarea.setSelectionRange(start + cursorOffset, start + cursorOffset);
    }
    updateDiaryWordcount();
  }

  function parseTags(value) {
    return Array.from(new Set(
      String(value || '')
        .split(/[\s,，#]+/)
        .map((tag) => tag.trim())
        .filter(Boolean)
        .slice(0, 6)
    ));
  }

  async function saveDiary() {
    const existing = state.editingDiaryId
      ? state.diaries.find((diary) => diary.id === state.editingDiaryId)
      : null;

    const titleInput = byId('diary-title').value.trim();
    const content = byId('diary-content').value;
    const date = byId('diary-date').value || todayISO();
    const mood = state.currentMood || '开心';
    const weather = byId('diary-weather').value || '晴';
    const tags = parseTags(byId('diary-tags').value);
    const title = titleInput || firstContentTitle(content);

    if (!title && !content.trim()) {
      showToast('先写下标题，或者一点想说的话吧');
      byId('diary-title').focus();
      return;
    }
    if (!parseISO(date)) {
      showToast('请选择一个有效的日记日期', 'error');
      return;
    }

    const submitButton = $('#diary-form button[type="submit"]');
    submitButton.disabled = true;

    try {
      let attachment = null;
      if (state.pendingPdfFile) {
        const file = state.pendingPdfFile;
        const buffer = await file.arrayBuffer();
        const fileId = uid('file');
        await storePut('files', {
          id: fileId,
          name: file.name,
          type: file.type || 'application/pdf',
          size: file.size,
          data: buffer,
          createdAt: Date.now()
        });
        attachment = {
          fileId,
          name: file.name,
          type: file.type || 'application/pdf',
          size: file.size
        };
      } else if (state.editorAttachment && state.editorAttachment.fileId) {
        attachment = { ...state.editorAttachment };
      }

      const previousAttachment = existing && existing.attachment ? existing.attachment : null;
      if (previousAttachment && (!attachment || previousAttachment.fileId !== attachment.fileId)) {
        try {
          await storeDelete('files', previousAttachment.fileId);
        } catch (error) {
          console.warn('Old attachment cleanup failed:', error);
        }
      }

      const record = {
        id: existing ? existing.id : uid('diary'),
        title: title || '无题日记',
        date,
        mood,
        weather,
        tags,
        content,
        createdAt: existing ? existing.createdAt : Date.now(),
        updatedAt: Date.now(),
        demo: existing ? Boolean(existing.demo) : false
      };
      if (attachment) record.attachment = attachment;

      await storePut('diaries', record);

      if (existing) {
        state.diaries = state.diaries.map((diary) => diary.id === existing.id ? record : diary);
      } else {
        state.diaries.push(record);
      }

      state.editingDiaryId = null;
      state.pendingPdfFile = null;
      state.editorAttachment = null;
      closeModal('diary-editor-modal');
      renderDiaries();
      renderStats();
      showToast(existing ? '日记已经更新' : '今天被好好收进日记里了');
      window.setTimeout(() => openDiaryReader(record.id), 180);
    } catch (error) {
      console.error(error);
      showToast('保存失败，请稍后再试', 'error');
    } finally {
      submitButton.disabled = false;
    }
  }

  function openDiaryReader(id) {
    const diary = state.diaries.find((item) => item.id === id);
    if (!diary) return;
    state.activeDiaryId = id;

    const tags = (diary.tags || []).map((tag) => `<span>#${escapeHTML(tag)}</span>`).join('');
    const attachment = diary.attachment
      ? `<div class="reader-attachment" data-open-attachment="${escapeAttr(diary.attachment.fileId)}" role="button" tabindex="0">
           <span class="attachment-icon">PDF</span>
           <div><strong>${escapeHTML(diary.attachment.name || 'PDF 附件.pdf')}</strong><small>${escapeHTML(formatBytes(diary.attachment.size))} · 点击打开附件</small></div>
           <svg class="icon"><use href="#i-arrow"></use></svg>
         </div>`
      : '';

    byId('diary-view-article').innerHTML = `
      <div class="reader-date-line">
        <span>${escapeHTML(formatCN(diary.date))}</span>
        <i></i>
        <span>${escapeHTML(weekdayCN(diary.date))}</span>
        <span class="reader-mood">${escapeHTML(diary.mood || '日常')}${diary.weather ? ` · ${escapeHTML(diary.weather)}` : ''}</span>
      </div>
      <h1 id="diary-view-title">${escapeHTML(diary.title || '无题')}</h1>
      <div class="reader-meta">
        <span>写于 ${escapeHTML(formatStamp(diary.createdAt))}</span>
        ${diary.updatedAt && diary.updatedAt !== diary.createdAt ? `<span class="dot"></span><span>最近编辑 ${escapeHTML(formatStamp(diary.updatedAt))}</span>` : ''}
      </div>
      ${tags ? `<div class="reader-tags">${tags}</div>` : ''}
      <div class="markdown-body">${renderMarkdown(diary.content)}</div>
      ${attachment}
    `;

    byId('view-attachment').hidden = !diary.attachment;
    openModal('diary-view-modal');
  }

  function exportDiaryMarkdown(diary) {
    if (!diary) return;
    const tags = (diary.tags || []).map((tag) => `#${tag}`).join(' ');
    const body = [
      `# ${diary.title || '无题'}`,
      '',
      `> ${formatCN(diary.date)} · ${diary.mood || '日常'} · ${diary.weather || '晴'}`,
      tags ? `>\n> ${tags}` : '',
      '',
      diary.content || '',
      '',
      '---',
      `写于朝暮 · ${state.settings.names}`
    ].filter((line) => line !== null).join('\n');

    const blob = new Blob([body], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${sanitizeFilename(diary.title)}.md`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1500);
    showToast('Markdown 文件已经在下载');
  }

  function exportDiaryPDF(diary) {
    if (!diary) return;
    const popup = window.open('', '_blank');
    if (!popup) {
      showToast('打印窗口被浏览器拦截了，请允许弹窗后再试', 'error');
      return;
    }

    const tags = (diary.tags || []).map((tag) => `<span>#${escapeHTML(tag)}</span>`).join('');
    const names = escapeHTML(state.settings.names);
    const title = escapeHTML(diary.title || '无题');
    const attachmentNote = diary.attachment
      ? `<div class="attachment">PDF 附件：${escapeHTML(diary.attachment.name || '附件.pdf')}（请回到朝暮查看）</div>`
      : '';

    const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>${title} · 朝暮</title>
<style>
  @page { size: A4; margin: 22mm 20mm; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    color: #403031;
    background: #fff;
    font-family: "Songti SC", "STSong", "Noto Serif SC", "SimSun", serif;
    font-size: 12pt;
    line-height: 1.95;
  }
  .brand { color: #a55f65; font-size: 8pt; letter-spacing: .22em; font-weight: 600; }
  .meta { margin-top: 12px; color: #937d79; font-size: 8.5pt; letter-spacing: .04em; font-family: "PingFang SC", "Microsoft YaHei", sans-serif; }
  h1 { margin: 18px 0 10px; font-size: 27pt; line-height: 1.3; font-weight: 500; letter-spacing: -.03em; }
  .tags { margin: 8px 0 20px; }
  .tags span { display: inline-block; margin-right: 5px; padding: 2px 8px; border-radius: 20px; background: #faebe6; color: #a55f65; font: 8pt "PingFang SC", "Microsoft YaHei", sans-serif; }
  hr { margin: 20px 0 26px; border: 0; border-top: 1px solid #eadcd4; }
  .content { font-size: 11.5pt; line-height: 2.05; }
  .content h1, .content h2, .content h3, .content h4 { font-weight: 600; color: #5a3b3d; line-height: 1.45; margin: 1.4em 0 .5em; }
  .content h1 { font-size: 20pt; } .content h2 { font-size: 16pt; } .content h3 { font-size: 14pt; }
  .content p { margin: 0 0 1em; }
  .content strong { color: #3f3031; }
  .content em { color: #a55f65; }
  .content a { color: #a55f65; }
  .content blockquote { margin: 1em 0; padding: 8px 16px; border-left: 2px solid #c88787; background: #faf0eb; }
  .content blockquote p:last-child { margin-bottom: 0; }
  .content ul, .content ol { padding-left: 1.5em; }
  .content li { margin-bottom: .3em; }
  .content code { padding: 1px 4px; border-radius: 3px; background: #f6ebe6; font-family: Consolas, monospace; font-size: .9em; }
  .content pre { padding: 13px; border-radius: 6px; background: #3b2c30; color: #f3e5da; overflow-wrap: anywhere; white-space: pre-wrap; }
  .content pre code { background: transparent; padding: 0; }
  .content img { max-width: 100%; }
  .attachment { margin-top: 24px; padding: 9px 12px; border: 1px solid #eadcd4; border-radius: 6px; color: #937d79; font-size: 8.5pt; font-family: "PingFang SC", "Microsoft YaHei", sans-serif; }
  .footer { margin-top: 42px; padding-top: 15px; border-top: 1px solid #eadcd4; color: #a89590; font-size: 8pt; letter-spacing: .05em; font-family: "PingFang SC", "Microsoft YaHei", sans-serif; display: flex; justify-content: space-between; gap: 20px; }
  .print-button { position: fixed; right: 22px; bottom: 22px; padding: 10px 18px; border: 0; border-radius: 999px; color: #fff; background: #a55f65; font: 12px "PingFang SC", "Microsoft YaHei", sans-serif; cursor: pointer; box-shadow: 0 8px 24px rgba(111,66,72,.2); }
  @media print { .print-button { display: none; } }
</style>
</head>
<body>
  <div class="brand">朝暮 · OUR LITTLE UNIVERSE</div>
  <div class="meta">${escapeHTML(formatCN(diary.date))} · ${escapeHTML(weekdayCN(diary.date))} · ${escapeHTML(diary.mood || '日常')}${diary.weather ? ` · ${escapeHTML(diary.weather)}` : ''}</div>
  <h1>${title}</h1>
  ${tags ? `<div class="tags">${tags}</div>` : ''}
  <hr>
  <div class="content">${renderMarkdown(diary.content)}</div>
  ${attachmentNote}
  <div class="footer"><span>写于 ${escapeHTML(formatStamp(diary.createdAt))}</span><span>${names} · 朝暮</span></div>
  <button class="print-button" onclick="window.print()">打印 / 另存为 PDF</button>
  <script>window.addEventListener('load', function () { setTimeout(function () { window.print(); }, 450); });<\/script>
</body>
</html>`;

    try {
      popup.document.open();
      popup.document.write(html);
      popup.document.close();
      popup.focus();
    } catch (error) {
      console.error(error);
      popup.close();
      showToast('无法创建打印页面，请稍后再试', 'error');
    }
  }

  async function openAttachment(fileId) {
    if (!fileId) return;
    const popup = window.open('', '_blank');
    try {
      const record = await storeGet('files', fileId);
      if (!record || !record.data) {
        if (popup) popup.close();
        showToast('找不到这个 PDF 附件，可能已被清理', 'error');
        return;
      }
      const blob = new Blob([record.data], { type: record.type || 'application/pdf' });
      const url = URL.createObjectURL(blob);
      if (popup) {
        popup.location.href = url;
      } else {
        const link = document.createElement('a');
        link.href = url;
        link.target = '_blank';
        link.rel = 'noopener';
        document.body.appendChild(link);
        link.click();
        link.remove();
        showToast('如果附件没有打开，请允许本站弹出窗口', 'error');
      }
      window.setTimeout(() => URL.revokeObjectURL(url), 120000);
    } catch (error) {
      console.error(error);
      if (popup) popup.close();
      showToast('附件打开失败，请稍后再试', 'error');
    }
  }

  async function deleteDiaryRecord(diary) {
    if (!diary) return;
    if (diary.attachment && diary.attachment.fileId) {
      try {
        await storeDelete('files', diary.attachment.fileId);
      } catch (error) {
        console.warn('Attachment delete failed:', error);
      }
    }
    await storeDelete('diaries', diary.id);
    state.diaries = state.diaries.filter((item) => item.id !== diary.id);
  }

  async function deleteActiveDiary() {
    const diary = state.diaries.find((item) => item.id === state.activeDiaryId);
    if (!diary) return;
    const confirmed = await askConfirm({
      title: '删掉这篇日记？',
      message: `“${diary.title || '无题'}”会从朝暮里永远消失，删除后无法恢复。`,
      confirmText: '确认删除'
    });
    if (!confirmed) return;

    try {
      await deleteDiaryRecord(diary);
      closeModal('diary-view-modal');
      state.activeDiaryId = null;
      renderDiaries();
      renderStats();
      showToast('这一页已经从日记里移除');
    } catch (error) {
      console.error(error);
      showToast('删除失败，请稍后再试', 'error');
    }
  }

  /* =======================================================
     Wish list
  ======================================================= */
  function renderWishes() {
    const total = state.wishes.length;
    const done = state.wishes.filter((wish) => wish.done).length;
    const percent = total ? Math.round((done / total) * 100) : 0;

    byId('wish-ring').style.setProperty('--progress', percent);
    byId('wish-percent').textContent = `${percent}%`;
    byId('wish-done').textContent = done;
    byId('wish-total').textContent = total;

    const sorted = state.wishes.slice().sort((a, b) => {
      const doneDiff = Number(a.done) - Number(b.done);
      if (doneDiff !== 0) return doneDiff;
      return (Number(a.createdAt) || 0) - (Number(b.createdAt) || 0);
    });

    const list = byId('wish-list');
    list.innerHTML = sorted.map((wish) => `
      <li class="wish-item${wish.done ? ' is-done' : ''}" data-wish-id="${escapeAttr(wish.id)}">
        <button class="wish-check" type="button" data-wish-toggle="${escapeAttr(wish.id)}" aria-label="${wish.done ? '标记为未完成' : '标记为完成'}" aria-pressed="${wish.done ? 'true' : 'false'}">
          <svg class="icon"><use href="#i-check"></use></svg>
        </button>
        <span class="wish-text">${escapeHTML(wish.text)}</span>
        <button class="wish-delete" type="button" data-wish-delete="${escapeAttr(wish.id)}" aria-label="删除这件事"><svg class="icon"><use href="#i-trash"></use></svg></button>
      </li>
    `).join('');

    byId('wish-empty').hidden = total > 0;
    if (total === 0) {
      byId('wish-hint').textContent = '先写下第一件想一起做的事吧。';
    } else if (done === total) {
      byId('wish-hint').textContent = '清单上的每一件小事，都和你一起完成了。';
    } else {
      byId('wish-hint').textContent = `还有 ${total - done} 件小事，等我们一起完成。`;
    }

    renderStats();
  }

  async function addWish(text) {
    const clean = String(text || '').trim().slice(0, 60);
    if (!clean) return;
    if (state.wishes.some((wish) => wish.text.toLowerCase() === clean.toLowerCase())) {
      showToast('清单里已经有这件小事啦');
      return;
    }
    const wish = {
      id: uid('wish'),
      text: clean,
      done: false,
      createdAt: Date.now(),
      demo: false
    };
    try {
      await storePut('wishes', wish);
      state.wishes.push(wish);
      renderWishes();
      byId('wish-input').value = '';
      showToast('已经放进我们的清单');
    } catch (error) {
      console.error(error);
      showToast('添加失败，请稍后再试', 'error');
    }
  }

  async function toggleWish(id) {
    const wish = state.wishes.find((item) => item.id === id);
    if (!wish) return;
    wish.done = !wish.done;
    wish.doneAt = wish.done ? Date.now() : null;
    try {
      await storePut('wishes', wish);
      renderWishes();
      if (wish.done) showToast('又完成一件和你的小事');
    } catch (error) {
      console.error(error);
      showToast('操作失败，请稍后再试', 'error');
    }
  }

  async function deleteWish(id) {
    const wish = state.wishes.find((item) => item.id === id);
    if (!wish) return;
    const confirmed = await askConfirm({
      title: '从清单里移除？',
      message: `“${wish.text}”会从心愿清单里消失。`,
      confirmText: '确认移除'
    });
    if (!confirmed) return;
    try {
      await storeDelete('wishes', id);
      state.wishes = state.wishes.filter((item) => item.id !== id);
      renderWishes();
      showToast('已经移除');
    } catch (error) {
      console.error(error);
      showToast('删除失败，请稍后再试', 'error');
    }
  }

  function pickRandomWish() {
    const candidates = state.wishes.filter((wish) => !wish.done);
    if (!candidates.length) {
      showToast(state.wishes.length ? '清单已经全部完成，去写点新的愿望吧' : '先在清单里写一件想一起做的事吧');
      return;
    }
    const wish = candidates[Math.floor(Math.random() * candidates.length)];
    const row = $(`[data-wish-id="${wish.id}"]`);
    if (row) {
      row.classList.remove('is-picked');
      void row.offsetWidth;
      row.classList.add('is-picked');
      row.scrollIntoView({ behavior: 'smooth', block: 'center' });
      window.setTimeout(() => row.classList.remove('is-picked'), 2200);
    }
    showToast(`今天就去做：${wish.text}`);
  }

  /* =======================================================
     Time capsule
  ======================================================= */
  function renderCapsules() {
    const today = todayDate();
    const sorted = state.capsules.slice().sort((a, b) => {
      const aDays = diffDays(today, parseISO(a.unlockDate) || today);
      const bDays = diffDays(today, parseISO(b.unlockDate) || today);
      const aLocked = aDays > 0 ? 1 : 0;
      const bLocked = bDays > 0 ? 1 : 0;
      if (aLocked !== bLocked) return bLocked - aLocked;
      if (aLocked && bLocked) return aDays - bDays;
      return (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0);
    });

    const grid = byId('capsule-list');
    grid.innerHTML = sorted.map((capsule) => {
      const unlockDate = parseISO(capsule.unlockDate);
      const days = unlockDate ? diffDays(today, unlockDate) : 0;
      const locked = days > 0;
      return `
        <article class="capsule-card${locked ? '' : ' is-unlocked'}" data-capsule-id="${escapeAttr(capsule.id)}" tabindex="0" role="button" aria-label="${locked ? '未到开启时间的信' : '拆开这封信'}">
          <div class="capsule-top">
            <span class="capsule-seal"><svg class="icon"><use href="${locked ? '#i-lock' : '#i-mail'}"></use></svg></span>
            <span class="capsule-status">${locked ? 'SEALED' : 'READY TO OPEN'}</span>
          </div>
          <h3>${escapeHTML(capsule.title || '给未来的我们')}</h3>
          <p class="capsule-meta">约定于 ${escapeHTML(formatCN(capsule.unlockDate))} · ${capsule.demo ? '示例信件' : '只属于我们'}</p>
          ${locked
            ? `<div class="capsule-countdown"><strong>${days}</strong><span>天后拆开</span></div>`
            : `<div class="capsule-open-mark">拆开这封信<svg class="icon"><use href="#i-arrow"></use></svg></div>`}
        </article>
      `;
    }).join('');

    byId('capsule-empty').hidden = state.capsules.length > 0;
  }

  function openCapsuleForm() {
    const form = byId('capsule-form');
    form.reset();
    byId('capsule-id').value = '';
    byId('capsule-date').min = todayISO();
    byId('capsule-date').value = dateOffsetISO(365);
    openModal('capsule-modal', { focus: '#capsule-title' });
  }

  async function saveCapsule() {
    const title = byId('capsule-title').value.trim();
    const unlockDate = byId('capsule-date').value;
    const content = byId('capsule-content').value.trim();

    if (!title) {
      showToast('先给这封信起个标题吧');
      byId('capsule-title').focus();
      return;
    }
    if (!parseISO(unlockDate)) {
      showToast('请选择一个可以开启的日期', 'error');
      return;
    }
    if (diffDays(todayDate(), parseISO(unlockDate)) < 0) {
      showToast('开启日期不能早于今天', 'error');
      return;
    }
    if (!content) {
      showToast('写一点想对未来的我们说的话吧');
      byId('capsule-content').focus();
      return;
    }

    const capsule = {
      id: uid('capsule'),
      title,
      unlockDate,
      content,
      createdAt: Date.now(),
      demo: false
    };

    try {
      await storePut('capsules', capsule);
      state.capsules.push(capsule);
      closeModal('capsule-modal');
      renderCapsules();
      showToast('信已经封存，交给时间保管');
    } catch (error) {
      console.error(error);
      showToast('封存失败，请稍后再试', 'error');
    }
  }

  function openCapsuleReader(id) {
    const capsule = state.capsules.find((item) => item.id === id);
    if (!capsule) return;

    const days = diffDays(todayDate(), parseISO(capsule.unlockDate));
    if (days > 0) {
      showToast(`还有 ${days} 天，再耐心等一等这封信`);
      return;
    }

    state.activeCapsuleId = id;
    byId('capsule-view-title').textContent = capsule.title || '给未来的我们';
    byId('capsule-view-kicker').textContent = capsule.openedAt ? 'A LETTER WE KEPT' : 'OPENED LETTER';
    byId('capsule-view-meta').innerHTML = `
      <span>约定于 ${escapeHTML(formatCN(capsule.unlockDate))}</span>
      <span>封存于 ${escapeHTML(formatStamp(capsule.createdAt))}</span>
    `;
    byId('capsule-view-body').textContent = capsule.content || '';
    openModal('capsule-view-modal');

    if (!capsule.openedAt) {
      capsule.openedAt = Date.now();
      storePut('capsules', capsule).catch((error) => console.warn('Capsule open state failed:', error));
    }
  }

  async function deleteActiveCapsule() {
    const capsule = state.capsules.find((item) => item.id === state.activeCapsuleId);
    if (!capsule) return;
    const confirmed = await askConfirm({
      title: '删掉这封信？',
      message: `“${capsule.title || '给未来的我们'}”会被永久删除，不能再拆开。`,
      confirmText: '确认删除'
    });
    if (!confirmed) return;

    try {
      await storeDelete('capsules', capsule.id);
      state.capsules = state.capsules.filter((item) => item.id !== capsule.id);
      closeModal('capsule-view-modal');
      state.activeCapsuleId = null;
      renderCapsules();
      showToast('信已经从时光里取回');
    } catch (error) {
      console.error(error);
      showToast('删除失败，请稍后再试', 'error');
    }
  }

  /* =======================================================
     Settings
  ======================================================= */
  function openSettings() {
    byId('setting-names').value = state.settings.names || '';
    byId('setting-date').value = state.settings.togetherDate || DEFAULT_SETTINGS.togetherDate;
    byId('setting-date').max = todayISO();
    byId('setting-tagline').value = state.settings.tagline || '';
    openModal('settings-modal', { focus: '#setting-names' });
  }

  async function saveSettings() {
    const names = byId('setting-names').value.trim().slice(0, 24);
    const togetherDate = byId('setting-date').value;
    const tagline = byId('setting-tagline').value.trim().slice(0, 90);

    if (!names) {
      showToast('写下你们的名字吧');
      byId('setting-names').focus();
      return;
    }
    if (!parseISO(togetherDate)) {
      showToast('请选择一个有效的纪念日', 'error');
      return;
    }
    if (parseISO(togetherDate) > todayDate()) {
      showToast('在一起的第一天不能晚于今天', 'error');
      return;
    }

    state.settings = {
      names,
      togetherDate,
      tagline: tagline || DEFAULT_SETTINGS.tagline
    };

    const persisted = persistSettings();
    renderHero();
    renderDates();
    closeModal('settings-modal');
    showToast(persisted ? '这里已经变成你们的样子了' : '设置已更新，但浏览器没有允许本地保存');
  }

  async function clearDemoContent() {
    const demoEvents = state.events.filter((item) => item.demo);
    const demoPhotos = state.photos.filter((item) => item.demo);
    const demoDiaries = state.diaries.filter((item) => item.demo);
    const demoWishes = state.wishes.filter((item) => item.demo);
    const demoCapsules = state.capsules.filter((item) => item.demo);
    const count = demoEvents.length + demoPhotos.length + demoDiaries.length + demoWishes.length + demoCapsules.length;

    if (!count) {
      showToast('已经没有示例内容了');
      return;
    }

    const confirmed = await askConfirm({
      title: '清除示例内容？',
      message: '只会删除首次打开时预置的插画和文字，不会影响你上传的照片和写下的内容。',
      confirmText: '清除示例'
    });
    if (!confirmed) return;

    try {
      for (const diary of demoDiaries) {
        if (diary.attachment && diary.attachment.fileId) {
          await storeDelete('files', diary.attachment.fileId).catch(() => {});
        }
      }
      await Promise.all([
        ...demoEvents.map((item) => storeDelete('events', item.id)),
        ...demoPhotos.map((item) => storeDelete('photos', item.id)),
        ...demoDiaries.map((item) => storeDelete('diaries', item.id)),
        ...demoWishes.map((item) => storeDelete('wishes', item.id)),
        ...demoCapsules.map((item) => storeDelete('capsules', item.id))
      ]);
      state.events = state.events.filter((item) => !item.demo);
      state.photos = state.photos.filter((item) => !item.demo);
      state.diaries = state.diaries.filter((item) => !item.demo);
      state.wishes = state.wishes.filter((item) => !item.demo);
      state.capsules = state.capsules.filter((item) => !item.demo);
      renderAll();
      closeModal('settings-modal');
      showToast('示例内容已经清空，接下来交给你们');
    } catch (error) {
      console.error(error);
      showToast('清除失败，请稍后再试', 'error');
    }
  }

  async function resetEverything() {
    const confirmed = await askConfirm({
      title: '清空整站内容？',
      message: '所有照片、日记、纪念日、心愿和时光胶囊都会被永久删除。你们的名字和起点会保留。',
      confirmText: '全部清空'
    });
    if (!confirmed) return;

    try {
      await Promise.all(STORES.map((storeName) => storeClear(storeName)));
      state.events = [];
      state.photos = [];
      state.diaries = [];
      state.wishes = [];
      state.capsules = [];
      closeModal('settings-modal');
      renderAll();
      showToast('整站已经清空，新的故事可以开始了');
    } catch (error) {
      console.error(error);
      showToast('清空失败，请稍后再试', 'error');
    }
  }

  /* =======================================================
     Daily note, clock, navigation
  ======================================================= */
  function setDailyQuote(index) {
    if (!QUOTES.length) return;
    const quoteIndex = ((index % QUOTES.length) + QUOTES.length) % QUOTES.length;
    quoteSeed = quoteIndex;
    byId('daily-quote').textContent = `“${QUOTES[quoteIndex]}”`;
  }

  function dayOfYear() {
    const now = new Date();
    const start = new Date(now.getFullYear(), 0, 0);
    return Math.floor((now - start) / 86400000);
  }

  function refreshQuote() {
    if (QUOTES.length <= 1) return;
    let next = quoteSeed;
    while (next === quoteSeed) {
      next = Math.floor(Math.random() * QUOTES.length);
    }
    setDailyQuote(next);
  }

  function updateClock() {
    const now = new Date();
    byId('live-date').textContent = `${now.getMonth() + 1}月${now.getDate()}日 · ${weekdayCN(now)}`;
    byId('live-clock').textContent = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

    const currentDay = todayISO();
    if (lastToday && currentDay !== lastToday) {
      lastToday = currentDay;
      renderHero();
      renderDates();
      renderCapsules();
    }
    lastToday = currentDay;
  }

  function setupNavigation() {
    const navLinks = $$('[data-nav]');
    const mobileLinks = $$('[data-mobile-nav]');
    const sections = ['dates', 'album', 'diary', 'wishes', 'capsule']
      .map((id) => byId(id))
      .filter(Boolean);
    const header = $('.site-header');
    let ticking = false;

    const update = () => {
      const scrollY = window.scrollY || window.pageYOffset;
      if (header) header.classList.toggle('is-scrolled', scrollY > 18);

      const probe = scrollY + window.innerHeight * 0.3;
      let current = '';
      sections.forEach((section) => {
        const top = section.getBoundingClientRect().top + scrollY;
        if (top <= probe) current = section.id;
      });
      if ((window.innerHeight + scrollY) >= document.documentElement.scrollHeight - 30) {
        current = 'capsule';
      }

      navLinks.forEach((link) => link.classList.toggle('is-active', link.dataset.nav === current));
      mobileLinks.forEach((link) => link.classList.toggle('is-active', link.dataset.mobileNav === current));
      ticking = false;
    };

    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(update);
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    update();
  }

  function setupReveal() {
    const elements = $$('.reveal');
    if (!('IntersectionObserver' in window)) {
      elements.forEach((element) => element.classList.add('is-visible'));
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -5% 0px' });
    elements.forEach((element) => observer.observe(element));
  }

  /* =======================================================
     Render all
  ======================================================= */
  function renderAll() {
    renderHero();
    renderStats();
    renderDates();
    renderPhotos();
    renderDiaries();
    renderWishes();
    renderCapsules();
  }

  /* =======================================================
     Event bindings
  ======================================================= */
  function bindEvents() {
    /* Settings */
    byId('open-settings').addEventListener('click', openSettings);
    byId('footer-settings').addEventListener('click', openSettings);
    byId('edit-start').addEventListener('click', openSettings);
    byId('settings-form').addEventListener('submit', (event) => {
      event.preventDefault();
      saveSettings();
    });
    byId('clear-demo').addEventListener('click', clearDemoContent);
    byId('reset-all').addEventListener('click', resetEverything);

    /* Hero shortcuts */
    byId('hero-write').addEventListener('click', () => openDiaryEditor());
    byId('new-diary').addEventListener('click', () => openDiaryEditor());
    byId('empty-diary').addEventListener('click', () => openDiaryEditor());

    /* Generic close buttons */
    document.addEventListener('click', (event) => {
      const closer = event.target.closest('[data-close]');
      if (!closer) return;
      const id = closer.dataset.close;
      if (!id) return;
      if (id === 'confirm-modal') {
        settleConfirm(false);
      } else {
        closeModal(id);
      }
    });

    /* Confirm dialog */
    byId('confirm-cancel').addEventListener('click', () => settleConfirm(false));
    byId('confirm-ok').addEventListener('click', () => settleConfirm(true));

    /* Anniversary form */
    byId('add-event').addEventListener('click', () => openEventForm());
    $$('input[name="event-kind"]').forEach((radio) => {
      radio.addEventListener('change', updateEventKindHint);
    });
    byId('event-form').addEventListener('submit', (event) => {
      event.preventDefault();
      saveEvent();
    });

    byId('event-grid').addEventListener('click', (event) => {
      const addButton = event.target.closest('[data-add-event]');
      if (addButton) {
        openEventForm();
        return;
      }
      const editButton = event.target.closest('[data-edit-event]');
      if (editButton) {
        const found = state.events.find((item) => item.id === editButton.dataset.editEvent);
        if (found) openEventForm(found);
        return;
      }
      const deleteButton = event.target.closest('[data-delete-event]');
      if (deleteButton) {
        deleteEvent(deleteButton.dataset.deleteEvent);
      }
    });

    /* Photo upload */
    const photoInput = byId('photo-input');
    byId('upload-photo').addEventListener('click', () => photoInput.click());
    byId('empty-upload').addEventListener('click', () => {
      if (state.photoFilter === 'favorite' && state.photos.length > 0) {
        state.photoFilter = 'all';
        syncPhotoFilterTabs();
        renderPhotos();
      } else {
        photoInput.click();
      }
    });
    photoInput.addEventListener('change', () => handlePhotoFiles(photoInput.files));

    const dropZone = byId('drop-zone');
    dropZone.addEventListener('click', () => photoInput.click());
    dropZone.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        photoInput.click();
      }
    });
    ['dragenter', 'dragover'].forEach((type) => {
      dropZone.addEventListener(type, (event) => {
        event.preventDefault();
        event.stopPropagation();
        dropZone.classList.add('is-dragging');
      });
    });
    ['dragleave', 'dragend'].forEach((type) => {
      dropZone.addEventListener(type, () => dropZone.classList.remove('is-dragging'));
    });
    dropZone.addEventListener('drop', (event) => {
      event.preventDefault();
      event.stopPropagation();
      dropZone.classList.remove('is-dragging');
      handlePhotoFiles(event.dataTransfer.files);
    });
    document.addEventListener('dragover', (event) => {
      if (!event.target.closest('#drop-zone')) event.preventDefault();
    });
    document.addEventListener('drop', (event) => {
      if (!event.target.closest('#drop-zone')) event.preventDefault();
    });

    $$('[data-photo-filter]').forEach((button) => {
      button.addEventListener('click', () => {
        state.photoFilter = button.dataset.photoFilter;
        syncPhotoFilterTabs();
        renderPhotos();
      });
    });

    byId('gallery').addEventListener('click', (event) => {
      const favorite = event.target.closest('[data-fav-photo]');
      if (favorite) {
        event.stopPropagation();
        togglePhotoFavorite(favorite.dataset.favPhoto);
        return;
      }
      const card = event.target.closest('[data-photo-id]');
      if (card) openLightbox(card.dataset.photoId);
    });

    byId('gallery').addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      if (event.target.closest('button')) return;
      const card = event.target.closest('[data-photo-id]');
      if (!card) return;
      event.preventDefault();
      openLightbox(card.dataset.photoId);
    });

    /* Lightbox */
    byId('lightbox-prev').addEventListener('click', () => navigateLightbox(-1));
    byId('lightbox-next').addEventListener('click', () => navigateLightbox(1));
    byId('lightbox-save').addEventListener('click', () => saveLightboxCaption());
    byId('lightbox-favorite').addEventListener('click', () => {
      if (state.activePhotoId) togglePhotoFavorite(state.activePhotoId);
    });
    byId('lightbox-delete').addEventListener('click', deleteActivePhoto);
    byId('lightbox-caption').addEventListener('keydown', (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault();
        saveLightboxCaption();
      }
    });

    /* Diary editor */
    byId('diary-form').addEventListener('submit', (event) => {
      event.preventDefault();
      saveDiary();
    });
    byId('diary-content').addEventListener('input', updateDiaryWordcount);
    byId('tab-write').addEventListener('click', () => setEditorTab('write'));
    byId('tab-preview').addEventListener('click', () => setEditorTab('preview'));

    $$('#format-tools button').forEach((button) => {
      button.addEventListener('click', () => insertMarkdown(button.dataset.format));
    });

    byId('mood-picker').addEventListener('click', (event) => {
      const button = event.target.closest('[data-mood]');
      if (button) updateMoodPicker(button.dataset.mood);
    });

    byId('import-md').addEventListener('click', () => byId('md-input').click());
    byId('md-input').addEventListener('change', async () => {
      const input = byId('md-input');
      const file = input.files && input.files[0];
      if (!file) return;
      if (file.size > 2 * 1024 * 1024) {
        showToast('Markdown 文件不能超过 2MB', 'error');
        input.value = '';
        return;
      }
      try {
        const text = await file.text();
        if (!text.trim()) {
          showToast('这个 Markdown 文件是空的', 'error');
          input.value = '';
          return;
        }
        if (byId('diary-content').value.trim()) {
          const confirmed = await askConfirm({
            title: '导入并替换当前内容？',
            message: '编辑器里已经有一些文字，导入后会用文件内容替换它们。',
            confirmText: '继续导入'
          });
          if (!confirmed) {
            input.value = '';
            return;
          }
        }
        byId('diary-content').value = text;
        if (!byId('diary-title').value.trim()) {
          const heading = text.match(/^\s*#\s+(.+)$/m);
          if (heading) byId('diary-title').value = heading[1].trim().slice(0, 60);
        }
        updateDiaryWordcount();
        setEditorTab('write');
        showToast('Markdown 已经导入编辑器');
      } catch (error) {
        console.error(error);
        showToast('Markdown 读取失败，请换一个文件', 'error');
      } finally {
        input.value = '';
      }
    });

    byId('attach-pdf').addEventListener('click', () => byId('pdf-input').click());
    byId('pdf-input').addEventListener('change', () => {
      const input = byId('pdf-input');
      const file = input.files && input.files[0];
      if (!file) return;
      if (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) {
        showToast('请选择 PDF 文件', 'error');
        input.value = '';
        return;
      }
      if (file.size > 10 * 1024 * 1024) {
        showToast('PDF 附件不能超过 10MB', 'error');
        input.value = '';
        return;
      }
      state.pendingPdfFile = file;
      state.editorAttachment = {
        name: file.name,
        size: file.size,
        type: 'application/pdf',
        pending: true
      };
      renderAttachmentChip();
      showToast('PDF 已附上，保存日记时一起存好');
      input.value = '';
    });

    byId('remove-attachment').addEventListener('click', () => {
      state.pendingPdfFile = null;
      state.editorAttachment = null;
      renderAttachmentChip();
    });

    /* Diary list + reader */
    byId('diary-search').addEventListener('input', (event) => {
      state.diarySearch = event.target.value;
      renderDiaries();
    });

    byId('diary-list').addEventListener('click', (event) => {
      const card = event.target.closest('[data-diary-id]');
      if (card) openDiaryReader(card.dataset.diaryId);
    });
    byId('diary-list').addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const card = event.target.closest('[data-diary-id]');
      if (!card) return;
      event.preventDefault();
      openDiaryReader(card.dataset.diaryId);
    });

    byId('view-export-md').addEventListener('click', () => {
      const diary = state.diaries.find((item) => item.id === state.activeDiaryId);
      exportDiaryMarkdown(diary);
    });
    byId('view-export-pdf').addEventListener('click', () => {
      const diary = state.diaries.find((item) => item.id === state.activeDiaryId);
      exportDiaryPDF(diary);
    });
    byId('view-edit').addEventListener('click', () => {
      const diary = state.diaries.find((item) => item.id === state.activeDiaryId);
      if (!diary) return;
      closeModal('diary-view-modal');
      openDiaryEditor(diary);
    });
    byId('view-delete').addEventListener('click', deleteActiveDiary);
    byId('view-attachment').addEventListener('click', () => {
      const diary = state.diaries.find((item) => item.id === state.activeDiaryId);
      if (diary && diary.attachment) openAttachment(diary.attachment.fileId);
    });
    byId('diary-view-article').addEventListener('click', (event) => {
      const attachment = event.target.closest('[data-open-attachment]');
      if (attachment) openAttachment(attachment.dataset.openAttachment);
    });
    byId('diary-view-article').addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const attachment = event.target.closest('[data-open-attachment]');
      if (!attachment) return;
      event.preventDefault();
      openAttachment(attachment.dataset.openAttachment);
    });

    /* Wishes */
    byId('wish-form').addEventListener('submit', (event) => {
      event.preventDefault();
      addWish(byId('wish-input').value);
    });
    byId('wish-list').addEventListener('click', (event) => {
      const toggle = event.target.closest('[data-wish-toggle]');
      if (toggle) {
        toggleWish(toggle.dataset.wishToggle);
        return;
      }
      const remove = event.target.closest('[data-wish-delete]');
      if (remove) deleteWish(remove.dataset.wishDelete);
    });
    byId('wish-random').addEventListener('click', pickRandomWish);

    /* Time capsule */
    byId('new-capsule').addEventListener('click', openCapsuleForm);
    byId('capsule-form').addEventListener('submit', (event) => {
      event.preventDefault();
      saveCapsule();
    });
    byId('capsule-list').addEventListener('click', (event) => {
      const card = event.target.closest('[data-capsule-id]');
      if (card) openCapsuleReader(card.dataset.capsuleId);
    });
    byId('capsule-list').addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const card = event.target.closest('[data-capsule-id]');
      if (!card) return;
      event.preventDefault();
      openCapsuleReader(card.dataset.capsuleId);
    });
    byId('capsule-view-close').addEventListener('click', () => closeModal('capsule-view-modal'));
    byId('capsule-view-delete').addEventListener('click', deleteActiveCapsule);

    /* Daily quote */
    byId('refresh-quote').addEventListener('click', refreshQuote);

    /* Keyboard navigation */
    document.addEventListener('keydown', (event) => {
      const lightboxOpen = byId('lightbox').classList.contains('is-open');
      if (event.key === 'Escape') {
        if (byId('confirm-modal').classList.contains('is-open')) {
          settleConfirm(false);
          return;
        }
        if (lightboxOpen) {
          closeModal('lightbox');
          return;
        }
        if (modalStack.length) closeTopModal();
        return;
      }

      if (!lightboxOpen) return;
      const activeTag = document.activeElement ? document.activeElement.tagName : '';
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(activeTag)) return;
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        navigateLightbox(-1);
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        navigateLightbox(1);
      }
    });

    /* Keep all displayed counts fresh when tabs are restored. */
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        updateClock();
        renderDates();
        renderCapsules();
      }
    });
  }

  function syncPhotoFilterTabs() {
    $$('[data-photo-filter]').forEach((button) => {
      button.classList.toggle('is-active', button.dataset.photoFilter === state.photoFilter);
    });
  }

  /* =======================================================
     Boot
  ======================================================= */
  async function init() {
    state.settings = loadSettings();
    lastToday = todayISO();

    try {
      db = await openDatabase();
    } catch (error) {
      console.warn('IndexedDB unavailable, using in-memory storage:', error);
      dbUnavailable = true;
      db = null;
    }

    try {
      await loadCollections();
      const total = state.events.length + state.photos.length + state.diaries.length + state.wishes.length + state.capsules.length;
      if (!readSeedMarker() && total === 0) {
        await seedCollections();
        await loadCollections();
        writeSeedMarker();
        window.setTimeout(() => {
          showToast('先放了一些示例回忆，可随时在设置里清除');
        }, 900);
      }
    } catch (error) {
      console.error('Data load failed:', error);
      showToast('回忆加载失败，刷新页面再试一次', 'error');
    }

    setDailyQuote(dayOfYear());
    bindEvents();
    renderAll();
    syncPhotoFilterTabs();

    byId('diary-date').value = todayISO();
    byId('capsule-date').min = todayISO();
    byId('setting-date').max = todayISO();
    byId('event-date').value = todayISO();

    updateClock();
    window.setInterval(updateClock, 1000);
    setupNavigation();
    setupReveal();

    if (dbUnavailable) {
      window.setTimeout(() => {
        showToast('当前浏览器无法使用本地数据库，内容只会保留在本页', 'error');
      }, 2200);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
