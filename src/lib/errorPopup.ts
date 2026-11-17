export interface ErrorPopupPayload {
  id: number;
  title: string;
  context?: string;
  message: string;
  causes: string[];
  suggestion?: string;
  status?: number;
}

export interface ShowErrorPopupOptions {
  title?: string;
  causes?: string[];
  suggestion?: string;
  status?: number;
}

type ErrorListener = (payload: ErrorPopupPayload | null) => void;

const listeners = new Set<ErrorListener>();
let nextPopupId = 1;
let currentPopup: ErrorPopupPayload | null = null;
let lastKey = '';
let lastShownAt = 0;

export function subscribeErrorPopup(listener: ErrorListener): () => void {
  listeners.add(listener);
  listener(currentPopup);
  return () => {
    listeners.delete(listener);
  };
}

function emit(payload: ErrorPopupPayload | null): void {
  currentPopup = payload;
  for (const listener of listeners) {
    listener(payload);
  }
}

export function closeErrorPopup(): void {
  emit(null);
}

function extractMessageAndStatus(err: unknown): { message: string; status?: number; isValidation?: boolean } {
  if (typeof err === 'string') {
    return { message: err.trim() };
  }
  if (err && typeof err === 'object') {
    const anyErr = err as {
      message?: unknown;
      error?: unknown;
      status?: unknown;
      isValidation?: unknown;
    };
    const msg =
      typeof anyErr.message === 'string'
        ? anyErr.message.trim()
        : typeof anyErr.error === 'string'
          ? anyErr.error.trim()
          : '';
    const status = typeof anyErr.status === 'number' ? anyErr.status : undefined;
    const isValidation = Boolean(anyErr.isValidation);
    return { message: msg, status, isValidation };
  }
  return { message: '' };
}

export function analyzeErrorToPopup(
  err: unknown,
  context?: string,
  opts?: ShowErrorPopupOptions,
): Omit<ErrorPopupPayload, 'id'> {
  const extracted = extractMessageAndStatus(err);
  const status = opts?.status ?? extracted.status;
  let message = extracted.message || 'تعذر إتمام العملية المطلوبة بسبب خطأ غير متوقع.';
  let title = opts?.title || (context ? `تعذر إتمام عملية: ${context}` : 'تنبيه: تعذر إتمام العملية');
  const causes: string[] = [...(opts?.causes || [])];
  let suggestion = opts?.suggestion || '';

  const lower = message.toLowerCase();

  // Translate any raw network / runtime technical messages into crisp Arabic
  if (
    lower.includes('failed to fetch') ||
    lower.includes('networkerror') ||
    lower.includes('load failed') ||
    lower.includes('network request failed')
  ) {
    title = context ? `انقطع الاتصال أثناء: ${context}` : 'تعذر الاتصال بالخادم';
    message = 'تعذر الوصول إلى خادم النظام لإتمام هذا الطلب.';
    causes.push(
      'انقطاع مؤقت في اتصال الإنترنت أو الشبكة المحلية.',
      'توقف أو إعادة تشغيل خادم النظام في الخلفية.',
    );
    suggestion = 'تحقق من استقرار الاتصال بالإنترنت ثم أعد المحاولة بعد لحظات.';
  } else if (causes.length === 0) {
    // Specific domain & SQLite diagnostic rules
    if (/موجود مسبقاً|مسجل مسبقاً|مستخدم لحساب آخر|مكرر|unique/i.test(message) || status === 409) {
      if (/مرتبط|وجود|رأس مال|رصيد|وصفات|دواء|مستحق|foreign key/i.test(message)) {
        title = context ? `رفض الحذف أو التعديل: ${context}` : 'لا يمكن تنفيذ العملية لوجود ارتباطات';
        causes.push(
          'هذا السجل مرتبط ببيانات أخرى نشطة في النظام (مثل فواتير، تشغيلات مخزون، أو وصفات طبية).',
          'أو يوجد رصيد مالي مفتوح لم يتم تسويته بعد.',
        );
        suggestion = 'قم بتسوية الأرصدة أو نقل/حذف السجلات المرتبطة أولاً قبل تنفيذ الحذف.';
      } else {
        causes.push(
          'القيمة المدخلة (مثل الباركود، البريد الإلكتروني، اسم المستخدم، أو رمز الحساب) مستخدمة بالفعل في سجل آخر.',
          'تم إرسال نفس الطلب مرتين متتاليتين.',
        );
        suggestion = 'تحقق من الحقول الفريدة وقم بتعديل القيمة المكررة ثم أعد الحفظ.';
      }
    } else if (status === 403 || /صلاحية|غير مصرح|محظورة/i.test(message)) {
      title = 'صلاحية غير كافية لتنفيذ العملية';
      causes.push(
        'حسابك الحالي لا يملك الإذن المطلوب لتنفيذ هذا الإجراء.',
        'أو أن العملية مخصصة لنطاق صيدلية أخرى أو لإدارة المنصة فقط.',
      );
      suggestion = 'اطلب من مالك الصيدلية أو مدير النظام تفعيل الصلاحية المناسبة لحسابك من شاشة إدارة المستخدمين.';
    } else if (status === 404 || /غير موجود/i.test(message)) {
      causes.push(
        'تم حذف السجل مسبقاً أو لم يعد متاحاً ضمن بيانات الصيدلية الحالية.',
        'قد يكون الاختيار الحالي قديماً ولم يتم تحديث القائمة.',
      );
      suggestion = 'حدّث الصفحة أو أعد اختيار السجل الصحيح من القائمة ثم حاول مرة أخرى.';
    } else if (/الكمية|المخزون|لا يكفي|نفد|تشغيلة|رصيد.*صنف/i.test(message)) {
      causes.push(
        'الكمية المطلوبة أكبر من الرصيد الفعلي المتاح في المستودع أو التشغيلات النشطة.',
        'قد تكون التشغيلات المتبقية معزولة أو منتهية الصلاحية.',
      );
      suggestion = 'راجع رصيد الدواء والتشغيلات في صفحة المخزون أو اختر كمية متوافرة.';
    } else if (/انتهاء|منتهي|الصلاحية|ترخيص/i.test(message)) {
      causes.push(
        'انتهاء مدة الصلاحية للدواء/التشغيلة أو انتهاء ترخيص استخدام النظام.',
        'أو أن تاريخ الانتهاء أقدم من تاريخ الإنتاج أو تاريخ اليوم.',
      );
      suggestion = 'راجع التواريخ المسجلة أو تواصل مع الإدارة لتجديد الترخيص.';
    } else if (/الائتمان|آجل|عميل نقدي/i.test(message)) {
      causes.push(
        'محاولة إنشاء فاتورة آجلة للعميل النقدي العام أو تجاوز سقف الائتمان المحدد للعميل.',
      );
      suggestion = 'اختر عميلاً مسجلاً بسقف ائتمان كافٍ، أو سدد جزءاً من المديونية، أو استخدم الدفع النقدي.';
    } else if (/مقيد|الرقابة|الوطنية|الوصفة/i.test(message)) {
      causes.push(
        'الأدوية الخاضعة للرقابة الدوائية تتطلب تسجيل بيانات المريض (رقم الهوية الوطنية) ورقم الوصفة واسم الطبيب.',
      );
      suggestion = 'أكمل بيانات الرقابة الدوائية في نافذة الدفع ثم أعد إتمام الفاتورة.';
    } else if (/غير متوازن|مدين|دائن|سطرين/i.test(message)) {
      causes.push(
        'إجمالي الجانب المدين لا يساوي إجمالي الجانب الدائن في القيد المحاسبي.',
        'أو يحتوي القيد على أقل من سطرين صحيحين أو حسابات غير محددة.',
      );
      suggestion = 'تأكد من تطابق مجموع المدين مع مجموع الدائن واختيار حساب لكل سطر.';
    } else if (/صورة|ميغابايت|أبعاد|png|webp|تالف/i.test(message)) {
      causes.push(
        'نوع الملف غير مدعوم (الأنواع المسموحة: PNG وJPG وJPEG وWebP فقط).',
        'أو أن حجم الصورة يتجاوز 2 ميغابايت أو أبعادها خارج النطاق (24×24 إلى 4096×4096 بكسل).',
      );
      suggestion = 'اختر صورة صالحة بحجم أقل من 2 ميغابايت وبصيغة PNG أو JPG أو WebP.';
    } else if (/كلمة المرور/i.test(message)) {
      causes.push(
        'كلمة المرور الحالية غير مطابقة أو كلمة المرور الجديدة قصيرة جداً (أقل من 4 خانات).',
      );
      suggestion = 'تحقق من حالة الأحرف واللغة عند كتابة كلمة المرور وحاول مرة أخرى.';
    } else if (/وردية/i.test(message)) {
      causes.push('لا توجد وردية كاشير مفتوحة حالياً أو تم إغلاق الوردية مسبقاً.');
      suggestion = 'افتح وردية كاشير جديدة من أعلى صفحة نقطة البيع وحدد العهدة الافتتاحية.';
    } else if (/json|استيراد|نسخة احتياطية|تالف/i.test(message)) {
      causes.push(
        'ملف النسخة الاحتياطية غير صالح أو يخص صيدلية أخرى أو تم تعديله يدوياً.',
      );
      suggestion = 'اختر ملف نسخة احتياطية JSON صحيحاً تم تصديره من نفس النظام.';
    } else if (status && status >= 500) {
      causes.push(
        'حدث عطل مؤقت في معالجة الطلب داخل الخادم أو قاعدة البيانات.',
        'تأكد من سلامة المدخلات الرقمية وعدم وجود قيم غير متوقعة.',
      );
      suggestion = 'أعد المحاولة مرة أخرى، وإذا استمر الخطأ راجع سجل العمليات أو تواصل مع الدعم الفني.';
    } else {
      causes.push(
        'قد يكون هناك حقل إلزامي فارغ أو قيمة غير صالحة (مثل سعر أو كمية سالبة أو تاريخ غير صحيح).',
        'أو عدم توافق البيانات المدخلة مع قواعد النظام (مثال: تكرار اسم أو رقم مسجل مسبقاً).',
      );
      suggestion = 'راجع الحقول المميزة وتأكد من صحة البيانات المدخلة ثم أعد المحاولة.';
    }
  }

  return {
    title,
    context,
    message,
    causes,
    suggestion: suggestion || 'يرجى مراجعة البيانات المدخلة والمحاولة مرة أخرى.',
    status,
  };
}

/**
 * Displays a unified Error Popup Modal across any page in the system.
 * Automatically deduplicates rapid identical errors and enriches context if a page handler provides one.
 */
export function showErrorPopup(err: unknown, context?: string, opts?: ShowErrorPopupOptions): void {
  const payload = analyzeErrorToPopup(err, context, opts);
  const key = `${payload.message}|${payload.status ?? ''}`;
  const now = Date.now();

  if (currentPopup && key === lastKey && now - lastShownAt < 600) {
    // Enrich currently shown popup if caller provided a more specific Arabic operation context
    if (context && !currentPopup.context) {
      emit({
        ...currentPopup,
        context,
        title: opts?.title || `تعذر إتمام عملية: ${context}`,
      });
    }
    return;
  }

  lastKey = key;
  lastShownAt = now;
  emit({
    id: nextPopupId++,
    ...payload,
  });
}

export function validationError(message: string, context?: string, causes?: string[], suggestion?: string): void {
  showErrorPopup(message, context, {
    title: context ? `بيانات غير مكتملة أو غير صالحة: ${context}` : 'تحقق من البيانات المدخلة',
    causes: causes && causes.length > 0 ? causes : undefined,
    suggestion,
  });
}
