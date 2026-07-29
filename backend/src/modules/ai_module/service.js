import mongoose from 'mongoose';
import moment from 'moment-timezone';
import User from '../../DB/models/user.model.js';
import Branch from '../../DB/models/branch.model.js';
import { canUseBookings, canUseProfit, canUseReports } from './policy.js';
import { createProvider } from './provider.js';
import { toolBookings, toolProfit, toolSales } from './tools.js';
import { searchMarketPrices } from './web_search.js';

/** Match reports/orders business calendar (Egypt). */
const VIXA_TZ = 'Africa/Cairo';

function normalizeArabicText(s) {
  return String(s || '')
    .replace(/[؟?!.،,:;()"']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/ة/g, 'ه')
    .replace(/[أإآٱ]/g, 'ا');
}

function formatCairoISODate(d = moment.tz(VIXA_TZ)) {
  return moment.tz(d, VIXA_TZ).format('YYYY-MM-DD');
}

function todayRangeISO() {
  // IMPORTANT: use Africa/Cairo, not UTC / server-local, so “النهارده” matches store day.
  const iso = formatCairoISODate();
  return { from: iso, to: iso };
}

function yesterdayRangeISO() {
  const iso = formatCairoISODate(moment.tz(VIXA_TZ).subtract(1, 'day'));
  return { from: iso, to: iso };
}

/** Monday–Sunday range for the current calendar week (Cairo). */
function thisWeekRangeISO() {
  const from = moment.tz(VIXA_TZ).startOf('isoWeek'); // Monday
  const to = from.clone().endOf('isoWeek'); // Sunday
  return { from: from.format('YYYY-MM-DD'), to: to.format('YYYY-MM-DD') };
}

function thisMonthRangeISO() {
  const now = moment.tz(VIXA_TZ);
  return {
    from: now.clone().startOf('month').format('YYYY-MM-DD'),
    to: now.clone().endOf('month').format('YYYY-MM-DD'),
  };
}

function pickIsoDate(s) {
  const m = String(s || '').match(/\b(\d{4}-\d{2}-\d{2})\b/g);
  return m || [];
}

function escapeRegex(s) {
  return String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function pickDMYDatesToISO(s) {
  const out = [];
  const re = /\b(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})\b/g;
  const raw = String(s || '');
  let m;
  // eslint-disable-next-line no-cond-assign
  while ((m = re.exec(raw))) {
    const dd = String(m[1]).padStart(2, '0');
    const mm = String(m[2]).padStart(2, '0');
    const yyyy = String(m[3]);
    out.push(`${yyyy}-${mm}-${dd}`);
  }
  return out;
}

/** English / Arabic cues for “this week” (UI quick actions, natural chat). */
function messageImpliesCurrentWeek(message) {
  const raw = String(message || '');
  if (/\bweek\b/i.test(raw) || /\bweekly\b/i.test(raw)) return true;
  const n = normalizeArabicText(raw);
  return (
    n.includes('اسبوع') ||
    n.includes('الاسبوع') ||
    n.includes('هذا الاسبوع') ||
    n.includes('الاسبوع دا') ||
    n.includes('الاسبوع ده')
  );
}

function messageImpliesToday(message) {
  const raw = String(message || '');
  if (/\btoday\b/i.test(raw)) return true;
  const n = normalizeArabicText(raw);
  return (
    n.includes('اليوم') ||
    n.includes('النهارده') ||
    n.includes('نهارده') ||
    n.includes('النهاردة') ||
    n.includes('نهاردة')
  );
}

function messageImpliesYesterday(message) {
  const raw = String(message || '');
  if (/\byesterday\b/i.test(raw)) return true;
  const n = normalizeArabicText(raw);
  return n.includes('امبارح') || n.includes('امس');
}

function messageImpliesCurrentMonth(message) {
  const raw = String(message || '');
  if (/\bmonth\b/i.test(raw) || /\bmonthly\b/i.test(raw)) return true;
  const n = normalizeArabicText(raw);
  return (
    n.includes('شهر') ||
    n.includes('الشهر') ||
    n.includes('هذا الشهر') ||
    n.includes('الشهر دا') ||
    n.includes('الشهر ده')
  );
}

function extractBranchNameFromMessage(message) {
  const raw = String(message || '');
  // Prefer quoted branch names (can contain spaces).
  // Examples:
  // - "... on branch 'Alex 2'"
  // - "مبيعات النهارده فرع 'سوهاج 1'"
  let m = raw.match(/(?:\bbranch\b|فرع)\s*(?:[:\-]|\s)?\s*['"«]\s*([^'"»\n]+?)\s*['"»]/i);
  let name = m && m[1] ? String(m[1]).trim() : '';

  // Unquoted: capture the rest of the line after "branch/فرع" then trim trailing report/time words.
  if (!name) {
    m = raw.match(/(?:\bbranch\b|فرع)\s*(?:[:\-]|\s)?\s*([^\n]+)/i);
    name = m && m[1] ? String(m[1]).trim() : '';
  }

  if (!name) return null;

  // Remove common trailing words accidentally captured (sales/profit/bookings + time cues).
  // Keep it conservative: only strip from the end.
  const cleanup = (s) => {
    let out = String(s || '').trim();
    // Normalize punctuation to spaces so suffix stripping works.
    out = out.replace(/[؟?!.،,:;()"]/g, ' ').replace(/\s+/g, ' ').trim();
    const suffixes = [
      'sales',
      'profit',
      'bookings',
      'مبيعات',
      'ارباح',
      'أرباح',
      'ربح',
      'حجوزات',
      'حجز',
      'اليوم',
      'النهارده',
      'نهارده',
      'امبارح',
      'امس',
      'اسبوع',
      'الاسبوع',
      'شهر',
      'الشهر',
    ];
    // Strip multiple suffix tokens if present.
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const before = out;
      for (const suf of suffixes) {
        const re = new RegExp(`\\s*\\b${escapeRegex(suf)}\\b\\s*$`, 'i');
        out = out.replace(re, '').trim();
      }
      if (out === before) break;
    }
    return out.trim();
  };

  name = cleanup(name);
  return name || null;
}

async function resolveBranchIdFromMessage(message) {
  const name = extractBranchNameFromMessage(message);
  if (!name) return null;

  const esc = escapeRegex(name);
  let b = await Branch.findOne({ name: { $regex: new RegExp(`^${esc}$`, 'i') } })
    .select('_id name')
    .lean();
  if (!b) {
    b = await Branch.findOne({ name: { $regex: new RegExp(esc, 'i') } }).select('_id name').lean();
  }
  if (!b) return { branchId: null, branchName: name };
  return { branchId: String(b._id), branchName: String(b.name || '') };
}

function inferRange({ message, from, to }) {
  if (from && to) return { from, to };
  // Prefer explicit dates (YYYY-MM-DD) or (DD/MM/YYYY).
  const dates = [...pickIsoDate(message), ...pickDMYDatesToISO(message)];
  if (dates.length >= 2) return { from: dates[0], to: dates[1] };
  if (dates.length === 1) return { from: dates[0], to: dates[0] };
  if (messageImpliesCurrentMonth(message)) return thisMonthRangeISO();
  if (messageImpliesCurrentWeek(message)) return thisWeekRangeISO();
  if (messageImpliesYesterday(message)) return yesterdayRangeISO();
  if (messageImpliesToday(message)) return todayRangeISO();
  // default: today
  return todayRangeISO();
}

function intent(message) {
  const raw = String(message || '').toLowerCase();
  // Basic Arabic normalization: unify ة→ه, remove punctuation that may break includes().
  const t = raw
    .replace(/[؟?!.،,:;()"']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const tArNorm = t.replace(/ة/g, 'ه');
  const has = (arr) => arr.some((w) => t.includes(w) || tArNorm.includes(String(w).replace(/ة/g, 'ه')));
  if (has(['سعر', 'تسعير', 'market', 'price', 'range'])) return 'pricing';
  if (has(['حجز', 'حجوز', 'booking', 'booked'])) return 'bookings';
  // Profit: include plural "أرباح" — it does NOT contain the substring "ربح" (أ ر ب ا ح vs ر ب ح).
  if (
    has([
      'مكسب',
      'ربح',
      'أرباح',
      'ارباح',
      'صافي',
      'profit',
      'net',
      'margin',
    ])
  )
    return 'profit';
  // Sales / invoices keywords: accept common Arabic spellings (ة/ه) + plural forms.
  if (
    has([
      'بكام',
      'مبيعات',
      'sales',
      'revenue',
      'orders',
      'invoice',
      'invoices',
      'فاتورة',
      'فواتير',
      'فاتوره',
      'فاتورت',
    ])
  )
    return 'sales';
  return 'general';
}

function langIsArabic(uiLang) {
  return String(uiLang || '').toLowerCase().startsWith('ar');
}

export const chat = async (req, res) => {
  try {
    const { message, userId, from, to, branchId, uiLang } = req.body || {};
    const msg = String(message || '').trim();
    if (!msg) return res.status(400).json({ error: 'message is required' });
    if (!userId || !mongoose.Types.ObjectId.isValid(String(userId))) {
      return res.status(400).json({ error: 'userId is required' });
    }

    const user = await User.findById(String(userId)).lean();
    if (!user) return res.status(404).json({ error: 'User not found' });
    const role = String(user.role || '');

    const { from: rf, to: rt } = inferRange({ message: msg, from, to });

    // Branch scoping: global roles can ask for a specific branch; others are forced to their branch.
    let effectiveBranchId = null;
    const isGlobal = role === 'Super Admin' || role === 'Co Admin';
    let branchMeta = { source: 'none', branchId: null, branchName: null };
    if (isGlobal) {
      if (branchId && mongoose.Types.ObjectId.isValid(String(branchId))) {
        effectiveBranchId = String(branchId);
        branchMeta = { source: 'body.branchId', branchId: effectiveBranchId, branchName: null };
      } else {
        const resolved = await resolveBranchIdFromMessage(msg);
        if (resolved?.branchId) {
          effectiveBranchId = resolved.branchId;
          branchMeta = {
            source: 'message.branchName',
            branchId: resolved.branchId,
            branchName: resolved.branchName,
          };
        } else if (resolved?.branchName) {
          // Branch name was present but not found in DB; keep meta for debugging.
          branchMeta = { source: 'message.branchName_not_found', branchId: null, branchName: resolved.branchName };
        }
      }
    } else {
      effectiveBranchId = user.branch ? String(user.branch) : null;
      branchMeta = { source: 'user.branch', branchId: effectiveBranchId, branchName: null };
    }

    const i = intent(msg);
    const ar = langIsArabic(uiLang);

    if (i === 'profit') {
      if (!canUseReports(role) || !canUseProfit(role)) {
        return res.status(403).json({
          error: ar
            ? 'ليس لديك صلاحية لعرض تقرير الأرباح.'
            : 'You do not have permission to access profit report.',
        });
      }
      const out = await toolProfit({
        from: rf,
        to: rt,
        branch_id: effectiveBranchId || undefined,
        groupBy: 'daily',
      });
      if (out.statusCode >= 400) return res.status(out.statusCode).json(out.jsonBody);
      const s = out.jsonBody?.summary || {};
      const branchLine = branchMeta?.branchName
        ? ar
          ? `الفرع: ${branchMeta.branchName}\n`
          : `Branch: ${branchMeta.branchName}\n`
        : '';
      const answer = ar
        ? `${branchLine}الفترة: ${rf} إلى ${rt}\nالإيرادات: ${s.totalRevenue || 0}\nالتكلفة: ${s.totalCost || 0}\nربح التشغيل: ${s.tradingProfit || 0}\nمصاريف الفرع (الفترة): ${s.branchOperatingCost || 0}\nصافي الربح: ${s.netProfit || 0}`
        : `${branchLine}Range: ${rf} to ${rt}\nRevenue: ${s.totalRevenue || 0}\nCost: ${s.totalCost || 0}\nTrading profit: ${s.tradingProfit || 0}\nBranch operating cost (range): ${s.branchOperatingCost || 0}\nNet profit: ${s.netProfit || 0}`;
      return res.json({ answer, meta: { intent: i, role, range: { from: rf, to: rt }, branch: branchMeta } });
    }

    if (i === 'sales') {
      if (!canUseReports(role)) {
        return res.status(403).json({
          error: ar ? 'ليس لديك صلاحية لعرض التقارير.' : 'You do not have permission to access reports.',
        });
      }
      const out = await toolSales({
        from: rf,
        to: rt,
        branch_id: effectiveBranchId || undefined,
        groupBy: 'daily',
      });
      if (out.statusCode >= 400) return res.status(out.statusCode).json(out.jsonBody);
      const s = out.jsonBody?.summary || {};
      const branchLine = branchMeta?.branchName
        ? ar
          ? `الفرع: ${branchMeta.branchName}\n`
          : `Branch: ${branchMeta.branchName}\n`
        : '';
      const answer = ar
        ? `${branchLine}الفترة: ${rf} إلى ${rt}\nإجمالي المبيعات: ${s.totalSales || 0}\nعدد الفواتير: ${s.totalOrders || 0}\nمتوسط قيمة الفاتورة: ${s.averageOrderValue || 0}`
        : `${branchLine}Range: ${rf} to ${rt}\nTotal sales: ${s.totalSales || 0}\nTotal orders: ${s.totalOrders || 0}\nAvg order: ${s.averageOrderValue || 0}`;
      return res.json({ answer, meta: { intent: i, role, range: { from: rf, to: rt }, branch: branchMeta } });
    }

    if (i === 'bookings') {
      if (!canUseBookings(role)) {
        return res.status(403).json({
          error: ar ? 'ليس لديك صلاحية لعرض الحجوزات.' : 'You do not have permission to access bookings.',
        });
      }
      const out = await toolBookings({
        from: rf,
        to: rt,
        branch_id: effectiveBranchId || undefined,
        groupBy: 'daily',
        page: 1,
        limit: 50,
      });
      if (out.statusCode >= 400) return res.status(out.statusCode).json(out.jsonBody);
      const summary = out.jsonBody?.summary || {};
      const branchLine = branchMeta?.branchName
        ? ar
          ? `الفرع: ${branchMeta.branchName}\n`
          : `Branch: ${branchMeta.branchName}\n`
        : '';
      const top = (out.jsonBody?.topProducts || []).slice(0, 5);
      const topLine =
        top.length > 0
          ? top.map((x) => `${x.productName || 'Product'}: ${x.bookingCount || 0}`).join(ar ? '، ' : ', ')
          : ar
            ? 'لا يوجد.'
            : 'None.';
      const answer = ar
        ? `${branchLine}الفترة: ${rf} إلى ${rt}\nالحجوزات (نشطة): ${summary.activeCount || 0}\nالحجوزات (ملغاة): ${summary.cancelledCount || 0}\nأكثر المنتجات حجزًا: ${topLine}`
        : `${branchLine}Range: ${rf} to ${rt}\nBookings (active): ${summary.activeCount || 0}\nBookings (cancelled): ${summary.cancelledCount || 0}\nTop booked products: ${topLine}`;
      return res.json({ answer, meta: { intent: i, role, range: { from: rf, to: rt }, branch: branchMeta } });
    }

    if (i === 'pricing') {
      const search = await searchMarketPrices(msg);
      if (!search) {
        return res.json({
          answer: ar
            ? 'بحث الأسعار الخارجي غير مُفعّل أو غير مُكوَّن. يمكن تفعيل INTERNET_ALLOWED وإضافة SERPAPI_KEY.'
            : 'External price search is not enabled/configured. Set INTERNET_ALLOWED=true and SERPAPI_KEY.',
          meta: { intent: i, role },
        });
      }
      const sources = search.sources || [];
      const answer = ar
        ? `هذه مصادر خارجية قد تساعد في تقدير نطاق السعر. راجعي الروابط ثم قارنيها مع تكلفة المنتج وهوامش الربح في تقارير النظام.`
        : `Here are external sources that may help estimate a market price range. Review the links and compare with your internal costs and margins.`;
      return res.json({ answer, sources, meta: { intent: i, role, fetchedAt: search.fetchedAt } });
    }

    // General fallback: if provider configured, use it to answer general system questions.
    const provider = createProvider();
    if (!provider) {
      return res.json({
        answer: ar
          ? 'أنا Vixa. اسأليني مثلًا: "مبيعات النهارده"، "الحجوزات النهارده"، "الربح من 2026-04-01 إلى 2026-04-14".'
          : 'I am Vixa. Try: "Sales today", "Bookings today", or "Profit from 2026-04-01 to 2026-04-14".',
        meta: { intent: i, role },
      });
    }

    const system = ar
      ? 'أنت مساعد داخل نظام متجر. لا تخمّن أرقام. إذا احتجت أرقام اطلب من المستخدم تحديد تقرير/فترة.'
      : 'You are an assistant inside a retail system. Do not invent numbers. If numbers are needed, ask for a report/time range.';
    try {
      const answer = await provider.generateText({ system, user: msg });
      return res.json({ answer, meta: { intent: i, role } });
    } catch (err) {
      // Do not fail the whole endpoint when provider quota/network fails.
      console.warn('ai.provider:', err?.message || err);
      return res.json({
        answer: ar
          ? 'حالياً خدمة الذكاء الاصطناعي الخارجية غير متاحة. اسأليني عن التقارير (مبيعات/حجوزات/أرباح) وسأجيب من بيانات النظام مباشرة.'
          : 'External AI provider is currently unavailable. Ask about reports (sales/bookings/profit) and I will answer from internal data.',
        meta: { intent: i, role, providerError: true },
      });
    }
  } catch (e) {
    console.error('ai.chat:', e);
    return res.status(500).json({ error: 'AI chat failed' });
  }
};

