import path from 'path';
import cors from 'cors';
import categoriesRoutes from './modules/categories_module/router.js';
import branchesRoutes from './modules/branches_module/router.js';
import ordersRoutes from './modules/orders_module/router.js';
import productRoutes from './modules/products_module/router.js';
import userRoutes from './modules/userModule/user.controller.js';
import vendorRoutes from './modules/vendors_module/router.js';
import dashboardRoutes from './modules/dashboard_module/router.js';
import clientsRoutes from './modules/clients_module/router.js';
import connectToMongoDB from './DB/connection.js';
import purchasingRoutes from './modules/purchasing_module/router.js';
import settingsRoutes from './modules/settings_module/router.js';
import uploadRoutes from './modules/uploads_module/router.js';
import reportsRoutes from './modules/reports_module/router.js';
import productBookingsRoutes from './modules/product_bookings_module/router.js';
import notificationsRoutes from './modules/notifications_module/router.js';
import auditRoutes from './modules/audit_module/router.js';
import aiRoutes from './modules/ai_module/router.js';
import productPurchaseRequestsRoutes from './modules/product_purchase_requests_module/router.js';
import dailyExpensesRoutes from './modules/daily_expenses_module/router.js';
import drawerCloseRoutes from './modules/drawer_close_module/router.js';
import treasuryAccountsRoutes from './modules/treasury_accounts_module/router.js';

const bootstrap = (app, express) => {
  // Middleware
  // Image uploads are sent as data URLs from frontend, so allow larger JSON bodies.
  app.use(express.json({ limit: '10mb' }));

  // Local product images when Cloudinary is not configured (see uploads_module/service.js)
  app.use(
    '/uploads',
    express.static(path.join(process.cwd(), 'public', 'uploads'))
  );

  // Health check route
  app.get('/', (req, res) => {
    res.send('✅ Hello from Node.js API running on AWS!');
  });

  // Enable CORS
  app.use(cors({
    credentials: true,
    origin: '*'
  }));

  // Connect to MongoDB
  connectToMongoDB();

  // Routes
  app.use('/api/products', productRoutes);
  app.use('/api/categories', categoriesRoutes);
  app.use('/api/branches', branchesRoutes);
  app.use('/api/orders', ordersRoutes);
  app.use('/api/users', userRoutes);
  app.use('/api/vendors', vendorRoutes);
  app.use('/api/purchasing', purchasingRoutes);
  app.use('/api/dashboard', dashboardRoutes);
  app.use('/api/clients', clientsRoutes);
  app.use('/api/settings', settingsRoutes);
  app.use('/api/uploads', uploadRoutes);
  app.use('/api/reports', reportsRoutes);
  app.use('/api/product-bookings', productBookingsRoutes);
  app.use('/api/notifications', notificationsRoutes);
  app.use('/api/audits', auditRoutes);
  app.use('/api/ai', aiRoutes);
  app.use('/api/product-purchase-requests', productPurchaseRequestsRoutes);
  app.use('/api/daily-expenses', dailyExpensesRoutes);
  app.use('/api/drawer-close', drawerCloseRoutes);
  app.use('/api/treasury', treasuryAccountsRoutes);

  return app;
};

export default bootstrap;
