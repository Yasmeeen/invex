import mongoose from 'mongoose';
import User from '../../DB/models/user.model.js';
import { canUseBookings, canUseProfit, canUseReports } from './policy.js';
import { createProvider } from './provider.js';
import { toolBookings, toolProfit, toolSales } from './tools.js';
import { searchMarketPrices } from './web_search.js';

function todayRangeISO() {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const to = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

/** Monday–Sunday range for the current calendar week (local time). */
function thisWeekRangeISO() {
  const now = new Date();
  const dayFromMonday = (now.getDay() + 6) % 7; // Mon=0 … Sun=6
  const from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dayFromMonday);
  const to = new Date(from.getFullYear(), from.getMonth(), from.getDate() + 6, 23, 59, 59, 999);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

function pickIsoDate(s) {
  const m = String(s || '').match(/\b(\d{4}-\d{2}-\d{2})\b/g);
  return m || [];
}

/** English / Arabic cues for “this week” (UI quick actions, natural chat). */
function messageImpliesCurrentWeek(message) {
  const raw = String(message || '');
  if (/\bweek\b/i.test(raw) || /\bweekly\b/i.test(raw)) return true;
  const n = raw
    .replace(/[؟?!.،,:;()"']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/ة/g, 'ه')
    .replace(/[أإآٱ]/g, 'ا');
  return (
    n.includes('اسبوع') ||
    n.includes('الاسبوع') ||
    n.includes('هذا الاسبوع') ||
    n.includes('الاسبوع دا') ||
    n.includes('الاسبوع ده')
  );
}

function inferRange({ message, from, to }) {
  if (from && to) return { from, to };
  const dates = pickIsoDate(message);
  if (dates.length >= 2) return { from: dates[0], to: dates[1] };
  if (dates.length === 1) return { from: dates[0], to: dates[0] };
  if (messageImpliesCurrentWeek(message)) return thisWeekRangeISO();
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
    if (isGlobal) {
      effectiveBranchId =
        branchId && mongoose.Types.ObjectId.isValid(String(branchId))
          ? String(branchId)
          : null;
    } else {
      effectiveBranchId = user.branch ? String(user.branch) : null;
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
      const answer = ar
        ? `الفترة: ${rf} إلى ${rt}\nالإيرادات: ${s.totalRevenue || 0}\nالتكلفة: ${s.totalCost || 0}\nربح التشغيل: ${s.tradingProfit || 0}\nمصاريف الفرع (الفترة): ${s.branchOperatingCost || 0}\nصافي الربح: ${s.netProfit || 0}`
        : `Range: ${rf} to ${rt}\nRevenue: ${s.totalRevenue || 0}\nCost: ${s.totalCost || 0}\nTrading profit: ${s.tradingProfit || 0}\nBranch operating cost (range): ${s.branchOperatingCost || 0}\nNet profit: ${s.netProfit || 0}`;
      return res.json({ answer, meta: { intent: i, role, range: { from: rf, to: rt } } });
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
      const answer = ar
        ? `الفترة: ${rf} إلى ${rt}\nإجمالي المبيعات: ${s.totalSales || 0}\nعدد الفواتير: ${s.totalOrders || 0}\nمتوسط قيمة الفاتورة: ${s.averageOrderValue || 0}`
        : `Range: ${rf} to ${rt}\nTotal sales: ${s.totalSales || 0}\nTotal orders: ${s.totalOrders || 0}\nAvg order: ${s.averageOrderValue || 0}`;
      return res.json({ answer, meta: { intent: i, role, range: { from: rf, to: rt } } });
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
      const top = (out.jsonBody?.topProducts || []).slice(0, 5);
      const topLine =
        top.length > 0
          ? top.map((x) => `${x.productName || 'Product'}: ${x.bookingCount || 0}`).join(ar ? '، ' : ', ')
          : ar
            ? 'لا يوجد.'
            : 'None.';
      const answer = ar
        ? `الفترة: ${rf} إلى ${rt}\nالحجوزات (نشطة): ${summary.activeCount || 0}\nالحجوزات (ملغاة): ${summary.cancelledCount || 0}\nأكثر المنتجات حجزًا: ${topLine}`
        : `Range: ${rf} to ${rt}\nBookings (active): ${summary.activeCount || 0}\nBookings (cancelled): ${summary.cancelledCount || 0}\nTop booked products: ${topLine}`;
      return res.json({ answer, meta: { intent: i, role, range: { from: rf, to: rt } } });
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

