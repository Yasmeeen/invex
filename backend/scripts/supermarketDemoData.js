/** Demo catalog for an Egyptian butcher shop (Arabic names, EGP). */

export const DEMO_STORE = {
  storeName: 'جزارة أبو علي',
  storePhoneNumber: '0227654321',
  receiptLanguage: 'ar',
  weightSalesEnabled: true,
  cutFromSourceEnabled: true,
  deliveryOrdersEnabled: true,
  cashierPurchaseExchangeEnabled: false,
};

/** Fixed monthly costs sized so demo daily trading profit stays green except the 15th. */
export const DEMO_BRANCHES = [
  {
    key: 'maadi',
    name: 'فرع المعادي',
    storeAddress: 'شارع 9، المعادي، القاهرة',
    rent: 9000,
    employeesSalary: 24000,
    branchInvoices: 1600,
    expenses: 1200,
    salespeople: ['أحمد سيد', 'محمود حسن', 'سارة علي'],
    deliveryStaff: ['محمد الدليفري', 'خالد توصيل', 'يوسف شحن'],
  },
  {
    key: 'nasr',
    name: 'فرع مدينة نصر',
    storeAddress: 'شارع عباس العقاد، مدينة نصر، القاهرة',
    rent: 10000,
    employeesSalary: 26000,
    branchInvoices: 1800,
    expenses: 1400,
    salespeople: ['كريم يوسف', 'نورا إبراهيم', 'ياسمين فتحي'],
    deliveryStaff: ['حسام دليفري', 'إبراهيم توصيل'],
  },
  {
    key: 'zayed',
    name: 'فرع الشيخ زايد',
    storeAddress: 'المحور المركزي، الشيخ زايد، الجيزة',
    rent: 9500,
    employeesSalary: 25000,
    branchInvoices: 1700,
    expenses: 1300,
    salespeople: ['عمر خالد', 'مريم نبيل', 'تامر رضا'],
    deliveryStaff: ['أمير توصيل', 'سامي دليفري'],
  },
];

export const DEMO_USERS = [
  {
    name: 'مدير النظام',
    email: 'admin@abuali-butcher.demo',
    password: 'Demo1234!',
    role: 'Super Admin',
    locale: 'ar',
  },
  {
    name: 'كاشير المعادي',
    email: 'cashier.maadi@abuali-butcher.demo',
    password: 'Demo1234!',
    role: 'Cashier',
    locale: 'ar',
    branchKey: 'maadi',
  },
  {
    name: 'كاشير مدينة نصر',
    email: 'cashier.nasr@abuali-butcher.demo',
    password: 'Demo1234!',
    role: 'Cashier',
    locale: 'ar',
    branchKey: 'nasr',
  },
];

/**
 * Fridge pieces (isSource) hold kg. Cuts (sourceKey) sell by name/price and deduct from the source.
 */
export const DEMO_CATEGORIES = [
  {
    code: 'BEEF',
    name: 'لحوم بقري',
    sellByWeight: true,
    weightUnit: 'kg',
    products: [
      { name: 'فخدة بقري (ثلاجة)', price: 340, netPrice: 290, stock: 48, isSource: true, sourceKey: 'beef_thigh' },
      { name: 'صدر بقري (ثلاجة)', price: 330, netPrice: 280, stock: 42, isSource: true, sourceKey: 'beef_chest' },
      { name: 'عجل بقري (ثلاجة)', price: 310, netPrice: 265, stock: 160, isSource: true, sourceKey: 'beef_calf' },
      { name: 'بفتيك', price: 420, netPrice: 290, stock: 0, sourceKey: 'beef_thigh' },
      { name: 'أنتركوت', price: 390, netPrice: 280, stock: 0, sourceKey: 'beef_chest' },
      { name: 'شاتوه', price: 410, netPrice: 285, stock: 0, sourceKey: 'beef_thigh' },
      { name: 'كباب حلة', price: 340, netPrice: 265, stock: 0, sourceKey: 'beef_calf' },
      { name: 'مفروم بقري', price: 330, netPrice: 265, stock: 0, sourceKey: 'beef_calf' },
      { name: 'ريش بقري', price: 380, netPrice: 280, stock: 0, sourceKey: 'beef_chest' },
    ],
  },
  {
    code: 'LAMB',
    name: 'لحوم ضاني',
    sellByWeight: true,
    weightUnit: 'kg',
    products: [
      { name: 'ذبيحة ضاني (ثلاجة)', price: 400, netPrice: 350, stock: 70, isSource: true, sourceKey: 'lamb_carcass' },
      { name: 'فخدة ضاني (ثلاجة)', price: 450, netPrice: 390, stock: 28, isSource: true, sourceKey: 'lamb_thigh' },
      { name: 'ريش ضاني', price: 480, netPrice: 350, stock: 0, sourceKey: 'lamb_carcass' },
      { name: 'موزة ضاني', price: 490, netPrice: 390, stock: 0, sourceKey: 'lamb_thigh' },
      { name: 'ضاني مفروم', price: 420, netPrice: 350, stock: 0, sourceKey: 'lamb_carcass' },
    ],
  },
  {
    code: 'POULTRY',
    name: 'دواجن',
    sellByWeight: true,
    weightUnit: 'kg',
    products: [
      { name: 'فراخ بلدي كاملة (ثلاجة)', price: 95, netPrice: 82, stock: 180, isSource: true, sourceKey: 'chicken_whole' },
      { name: 'صدور دجاج', price: 145, netPrice: 82, stock: 0, sourceKey: 'chicken_whole' },
      { name: 'أوراك دجاج', price: 110, netPrice: 82, stock: 0, sourceKey: 'chicken_whole' },
      { name: 'أجنحة دجاج', price: 85, netPrice: 82, stock: 0, sourceKey: 'chicken_whole' },
    ],
  },
  {
    code: 'OFFAL',
    name: 'أحشاء',
    sellByWeight: true,
    weightUnit: 'kg',
    products: [
      { name: 'كبدة بقري', price: 180, netPrice: 155, stock: 35, isSource: true, sourceKey: 'liver' },
      { name: 'كلاوي', price: 95, netPrice: 80, stock: 18, isSource: true, sourceKey: 'kidney' },
      { name: 'مخ', price: 95, netPrice: 80, stock: 12, isSource: true, sourceKey: 'brain' },
      { name: 'كرشة', price: 70, netPrice: 55, stock: 22, isSource: true, sourceKey: 'tripe' },
    ],
  },
  {
    code: 'PACK',
    name: 'تعبئة جاهزة',
    sellByWeight: false,
    products: [
      { name: 'سجق بلدي 500 جم', price: 85, netPrice: 68, stock: 90 },
      { name: 'برجر بقري 8 قطع', price: 95, netPrice: 75, stock: 70 },
      { name: 'كفتة متبلة 1 كجم', price: 140, netPrice: 110, stock: 55 },
    ],
  },
];

export const DEMO_CLIENTS = [
  { name: 'محمد عبدالله', phone: '01001234567', address: 'المعادي، القاهرة' },
  { name: 'فاطمة حسين', phone: '01002345678', address: 'مدينة نصر' },
  { name: 'أحمد محمود', phone: '01003456789', address: 'الشيخ زايد' },
  { name: 'نورهان سامي', phone: '01004567890', address: 'التجمع الخامس' },
  { name: 'خالد عمر', phone: '01005678901', address: 'المعادي' },
  { name: 'مريم أحمد', phone: '01006789012', address: 'حلوان' },
  { name: 'يوسف إبراهيم', phone: '01007890123', address: 'مدينة نصر' },
  { name: 'هبة محمد', phone: '01008901234', address: '6 أكتوبر' },
  { name: 'عبدالرحمن علي', phone: '01009012345', address: 'المعادي' },
  { name: 'سلمى حسن', phone: '01101234567', address: 'الزمالك' },
  { name: 'كريم ناصر', phone: '01102345678', address: 'مدينة نصر' },
  { name: 'دينا سامح', phone: '01103456789', address: 'الشيخ زايد' },
  { name: 'مطعم أبو رضا', phone: '01000000003', address: 'التجمع الخامس' },
  { name: 'كافتيريا المدرسة', phone: '01000000005', address: 'المعادي' },
  { name: 'عميل نقدي', phone: '01000000001', address: '—' },
  { name: 'عميل نقدي 2', phone: '01000000002', address: '—' },
  { name: 'فندق النيل', phone: '01000000010', address: 'الزمالك' },
];

export const DEMO_VENDORS = [
  {
    nameOfcompany: 'مزرعة أبو علي للماشية',
    name: 'أ/ سامح رجب',
    phone: '0223456789',
    email: 'farm@abuali.eg',
    paymentTerms: ['cash'],
    categoryCodes: ['BEEF', 'OFFAL'],
  },
  {
    nameOfcompany: 'مزارع الضأن الصعيد',
    name: 'أ/ حسن عبدالعال',
    phone: '0224567890',
    email: 'lamb@saeed.eg',
    paymentTerms: ['Deferred'],
    categoryCodes: ['LAMB'],
  },
  {
    nameOfcompany: 'مزارع الدواجن الحديثة',
    name: 'أ/ هشام فؤاد',
    phone: '0225678901',
    email: 'orders@modernpoultry.eg',
    paymentTerms: ['cash'],
    categoryCodes: ['POULTRY'],
  },
  {
    nameOfcompany: 'تعبئة اللحوم المتحدة',
    name: 'أ/ وائل عادل',
    phone: '0226789012',
    email: 'pack@unitedmeat.eg',
    paymentTerms: ['cash'],
    categoryCodes: ['PACK'],
  },
];
