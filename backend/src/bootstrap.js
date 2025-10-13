import cors from 'cors';
import categoriesRoutes from './modules/categories_module/router.js';
import branchesRoutes from './modules/branches_module/router.js';
import ordersRoutes from './modules/orders_module/router.js';
import productRoutes from './modules/products_module/router.js';
import userRoutes from './modules/userModule/user.controller.js';
import dashboardRoutes from './modules/dashboard_module/router.js';
import connectToMongoDB from './DB/connection.js';


const PORT = process.env.PORT || 3000;

const bootstrap = (app, express) => {
  // Middleware
  app.use(express.json());

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
  app.use('/api/dashboard', dashboardRoutes);

  // Start server
  app.listen(PORT, () => {
    console.log(`🚀 Server running at http://localhost:${PORT}`);
  });
};

export default bootstrap;
